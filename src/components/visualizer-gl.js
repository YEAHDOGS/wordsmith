// Draws the video visualizers (visualizer-scenes.js) with WebGL 1, which every browser on the app's floor has.
// Each frame it reads the analyser (src/lib/recorder.svelte.js), folds the spectrum into 128 log-spaced bins, works
// out bass, mid, high, overall level and a beat, and uploads it all as two 1-pixel-tall textures and a few uniforms.
// Shaders compile on first use of each scene. A picked image or video is the scene's background texture.
import { parseHex } from '../lib/color-math.js';
import { SCENE_SHADERS } from './visualizer-scenes.js';

const VERTEX = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;
// Two triangles covering the screen.
const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
const QUAD_VERTICES = 6;
const SPECTRUM_BINS = 128;
const WAVE_SAMPLES = 256;
// The spectrum's range: below the lowest bin is rumble, above the highest is hiss nobody sees.
const LOW_HZ = 40;
const HIGH_HZ = 12_000;
// Band edges for bass, mid and high (Hz).
const BASS_HZ = 250;
const MID_HZ = 2_000;
// Each band's level eases toward the new value: up fast, down slower, so motion reads as punchy, not jittery.
const RISE = 0.6;
const FALL = 0.12;
// A beat: bass this much above its running average, at least this loud, and this long after the last one.
const BEAT_RATIO = 1.32;
const BEAT_FLOOR = 0.28;
const BEAT_GAP_MS = 180;
const BASS_AVERAGE = 0.05;
// The beat pulse decays to 1/e in about this long.
const BEAT_DECAY_MS = 220;
// Quiet rooms still hum: bins are lifted toward the top by this curve so speech fills the bars.
const SPECTRUM_CURVE = 0.8;
const BYTE = 255;
// Frame time used for the first frame, and the most one frame may count (a tab that was hidden comes back calm).
const FIRST_FRAME_MS = 16;
const MAX_FRAME_MS = 100;
// Overall level runs low next to the bands; this brings speech up to about half.
const LEVEL_GAIN = 1.6;
const COLOR_UNIFORMS = /** @type {const} */ (['uA', 'uB', 'uC', 'uGlow']);
const FLOAT_UNIFORMS = /** @type {const} */ (['uTime', 'uBass', 'uMid', 'uHigh', 'uLevel', 'uBeat', 'uHasBg']);

/** @typedef {[number, number, number]} Rgb 0..1 */

/** A #rrggbb color as 0..1 channels, black if unreadable. @param {string} hex @returns {Rgb} */
export function hexColor(hex) {
  return /** @type {Rgb} */ ((parseHex(hex) || [0, 0, 0]).map((channel) => channel / BYTE));
}

/** A theme token's color as 0..1 channels. @param {string} name --ws-* token */
export const tokenColor = (name) => hexColor(getComputedStyle(document.documentElement).getPropertyValue(name));

export class Visualizer {
  /** @type {WebGLRenderingContext} */ gl;
  /** @type {Record<string, { program: WebGLProgram, uniforms: Record<string, WebGLUniformLocation | null> }>} */ #programs = {};
  /** @type {WebGLTexture[]} */ #textures = [];
  #spectrum = new Uint8Array(SPECTRUM_BINS);
  #wave = new Uint8Array(WAVE_SAMPLES);
  /** @type {Uint8Array} */ #frequencies = new Uint8Array(0);
  /** @type {Uint8Array} */ #samples = new Uint8Array(0);
  /** Smoothed band levels and the beat. */
  levels = { bass: 0, mid: 0, high: 0, level: 0, beat: 0 };
  #bassAverage = 0;
  #lastBeat = 0;
  #lastFrame = 0;
  /** @type {HTMLImageElement | HTMLVideoElement | null} */ #background = null;
  #backgroundCrop = [1, 1];

  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    // Spectrum, waveform and background, on texture units 0, 1 and 2.
    for (let unit = 0; unit < 3; unit++) {
      const texture = /** @type {WebGLTexture} */ (gl.createTexture());
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array(1));
      this.#textures.push(texture);
    }
  }

  /** @param {string} source @param {number} type */
  #shader(source, type) {
    const { gl } = this;
    const shader = /** @type {WebGLShader} */ (gl.createShader(type));
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Shader failed');
    return shader;
  }

  /** Compiles a scene the first time it's drawn. @param {keyof typeof SCENE_SHADERS} scene */
  #program(scene) {
    if (this.#programs[scene]) return this.#programs[scene];
    const { gl } = this;
    const program = /** @type {WebGLProgram} */ (gl.createProgram());
    gl.attachShader(program, this.#shader(VERTEX, gl.VERTEX_SHADER));
    gl.attachShader(program, this.#shader(SCENE_SHADERS[scene], gl.FRAGMENT_SHADER));
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Program failed');
    const names = ['uRes', 'uBgCrop', 'uSpec', 'uWave', 'uBg', ...COLOR_UNIFORMS, ...FLOAT_UNIFORMS];
    const uniforms = Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)]));
    this.#programs[scene] = { program, uniforms };
    return this.#programs[scene];
  }

  /** Checks a scene compiles here, so the studio can leave out any this GPU can't draw. @param {keyof typeof SCENE_SHADERS} scene */
  supports(scene) {
    try {
      this.#program(scene);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * An image or video to draw behind the scene, or null for the scene's own. Call again after the output size changes,
   * so an image's crop is worked out for the new shape (a video's is, every frame).
   * @param {HTMLImageElement | HTMLVideoElement | null} media
   */
  setBackground(media) {
    this.#background = media;
    if (media instanceof HTMLImageElement) this.#uploadBackground();
  }

  #uploadBackground() {
    const { gl } = this;
    const media = this.#background;
    if (!media) return;
    const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
    const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
    if (!width || !height) return;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.#textures[2]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, media);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // Cover: crop whichever side overflows the frame.
    const frame = gl.drawingBufferWidth / gl.drawingBufferHeight;
    const picture = width / height;
    this.#backgroundCrop = picture > frame ? [frame / picture, 1] : [1, picture / frame];
  }

  /** Reads the analyser into the spectrum, waveform and levels. @param {AnalyserNode | null} analyser @param {number} now ms */
  #listen(analyser, now) {
    const elapsed = this.#lastFrame ? Math.min(MAX_FRAME_MS, now - this.#lastFrame) : FIRST_FRAME_MS;
    this.#lastFrame = now;
    const levels = this.levels;
    levels.beat *= Math.exp(-elapsed / BEAT_DECAY_MS);
    if (!analyser) {
      this.#spectrum.fill(0);
      this.#wave.fill(BYTE / 2);
      for (const band of /** @type {const} */ (['bass', 'mid', 'high', 'level'])) levels[band] += (0 - levels[band]) * FALL;
      return;
    }
    if (this.#frequencies.length !== analyser.frequencyBinCount) {
      this.#frequencies = new Uint8Array(analyser.frequencyBinCount);
      this.#samples = new Uint8Array(analyser.fftSize);
    }
    analyser.getByteFrequencyData(this.#frequencies);
    analyser.getByteTimeDomainData(this.#samples);
    const nyquist = analyser.context.sampleRate / 2;
    const binHz = nyquist / this.#frequencies.length;
    // Log-spaced bins: each holds the loudest raw bin in its slice.
    for (let bin = 0; bin < SPECTRUM_BINS; bin++) {
      const from = Math.floor((LOW_HZ * Math.pow(HIGH_HZ / LOW_HZ, bin / SPECTRUM_BINS)) / binHz);
      const to = Math.max(from + 1, Math.floor((LOW_HZ * Math.pow(HIGH_HZ / LOW_HZ, (bin + 1) / SPECTRUM_BINS)) / binHz));
      let loud = 0;
      for (let raw = from; raw < to && raw < this.#frequencies.length; raw++) loud = Math.max(loud, this.#frequencies[raw]);
      this.#spectrum[bin] = Math.round(Math.pow(loud / BYTE, SPECTRUM_CURVE) * BYTE);
    }
    const step = this.#samples.length / WAVE_SAMPLES;
    for (let sample = 0; sample < WAVE_SAMPLES; sample++) this.#wave[sample] = this.#samples[Math.floor(sample * step)];
    /** @param {number} low @param {number} high */
    const band = (low, high) => {
      let sum = 0;
      let count = 0;
      for (let raw = Math.max(1, Math.floor(low / binHz)); raw < Math.min(this.#frequencies.length, high / binHz); raw++, count++) sum += this.#frequencies[raw];
      return count ? sum / count / BYTE : 0;
    };
    /** @param {'bass' | 'mid' | 'high' | 'level'} name @param {number} value */
    const ease = (name, value) => (levels[name] += (value - levels[name]) * (value > levels[name] ? RISE : FALL));
    const bass = band(LOW_HZ, BASS_HZ);
    ease('bass', bass);
    ease('mid', band(BASS_HZ, MID_HZ));
    ease('high', band(MID_HZ, HIGH_HZ));
    ease('level', band(LOW_HZ, HIGH_HZ) * LEVEL_GAIN);
    if (bass > BEAT_FLOOR && bass > this.#bassAverage * BEAT_RATIO && now - this.#lastBeat > BEAT_GAP_MS) {
      levels.beat = 1;
      this.#lastBeat = now;
    }
    this.#bassAverage += (bass - this.#bassAverage) * BASS_AVERAGE;
  }

  /**
   * Draws one frame.
   * @param {{ scene: keyof typeof SCENE_SHADERS, analyser: AnalyserNode | null, time: number, palette: Rgb[], glow: Rgb }} frame
   * palette is the scene's three colors; time in seconds
   */
  draw({ scene, analyser, time, palette, glow }) {
    const { gl } = this;
    this.#listen(analyser, performance.now());
    if (this.#background instanceof HTMLVideoElement && this.#background.readyState >= this.#background.HAVE_CURRENT_DATA) this.#uploadBackground();
    const { program, uniforms } = this.#program(scene);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(program);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#textures[0]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, SPECTRUM_BINS, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.#spectrum);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.#textures[1]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, WAVE_SAMPLES, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.#wave);
    gl.uniform1i(uniforms.uSpec, 0);
    gl.uniform1i(uniforms.uWave, 1);
    gl.uniform1i(uniforms.uBg, 2);
    gl.uniform2f(uniforms.uRes, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform2f(uniforms.uBgCrop, this.#backgroundCrop[0], this.#backgroundCrop[1]);
    const { bass, mid, high, level, beat } = this.levels;
    const floats = { uTime: time, uBass: bass, uMid: mid, uHigh: high, uLevel: Math.min(1, level), uBeat: beat, uHasBg: this.#background ? 1 : 0 };
    for (const name of FLOAT_UNIFORMS) gl.uniform1f(uniforms[name], floats[name]);
    [...palette, glow].forEach((color, index) => gl.uniform3f(uniforms[COLOR_UNIFORMS[index]], color[0], color[1], color[2]));
    gl.drawArrays(gl.TRIANGLES, 0, QUAD_VERTICES);
  }

  destroy() {
    const { gl } = this;
    for (const { program } of Object.values(this.#programs)) gl.deleteProgram(program);
    for (const texture of this.#textures) gl.deleteTexture(texture);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

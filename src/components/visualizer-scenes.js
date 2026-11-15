// The video visualizers: one WebGL 1 fragment shader per scene, drawn over a full-screen quad by visualizer-gl.js.
// Every scene reads the same uniforms: the sound (a 128-bin spectrum and a 256-sample waveform as 1-pixel-tall
// textures, bass/mid/high/level 0..1 and a beat that jumps to 1 and decays), time, the output size, an optional
// background image or video (uBg, cover-fitted through uBgCrop), and four colors: the scene's palette uA, uB, uC
// (--ws-viz-<scene>-a/b/c tokens in src/styles/theme.css) and uGlow, the glow color picked in the studio.
// Names and descriptions are in visualizer.json under the same ids.

/** Shared header: precision, uniforms and helpers. */
const COMMON = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uLevel;
uniform float uBeat;
uniform float uHasBg;
uniform vec2 uBgCrop;
uniform sampler2D uSpec;
uniform sampler2D uWave;
uniform sampler2D uBg;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform vec3 uGlow;
const float PI = 3.14159265;
const float TAU = 6.28318531;

float spec(float x) { return texture2D(uSpec, vec2(clamp(x, 0.0, 1.0), 0.5)).r; }
float wave(float x) { return texture2D(uWave, vec2(clamp(x, 0.0, 1.0), 0.5)).r * 2.0 - 1.0; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float aspect() { return uRes.x / uRes.y; }
// y runs -1 (bottom) to 1 (top); x the same, stretched by the aspect ratio.
vec2 centered() { return (vUv - 0.5) * vec2(aspect(), 1.0) * 2.0; }
// 0..1 around a circle, mirrored so both halves match and there's no seam where the angle wraps.
float around(vec2 p) { return abs(fract((atan(p.y, p.x) + PI) / TAU) * 2.0 - 1.0); }
mat2 turn(float angle) { return mat2(cos(angle), -sin(angle), sin(angle), cos(angle)); }
// The picked background, cover-fitted and nudged bigger on the bass, or the scene's own when there is none.
vec3 backdrop(vec3 fallback, float dim) {
  if (uHasBg < 0.5) return fallback;
  vec2 uv = (vUv - 0.5) * uBgCrop / (1.0 + uBass * 0.05) + 0.5;
  return mix(fallback, texture2D(uBg, uv).rgb, dim);
}
// Shared finish: soft vignette, CRT-ish scanlines, a flash on the beat.
vec3 finish(vec3 color, float scan) {
  vec2 edge = vUv - 0.5;
  color *= 1.0 - dot(edge, edge) * 0.9;
  color *= 1.0 - scan * 0.5 * (0.5 + 0.5 * sin(gl_FragCoord.y * PI));
  return color + uGlow * uBeat * 0.06;
}
`;

/** The DOGS spine: a glowing center line with the spectrum branching off both sides, on the 1px grid. */
const SPINE = `
void main() {
  vec2 p = centered();
  vec3 color = backdrop(uA, 0.3);
  // The 1px grid, every 64 px.
  vec2 cell = mod(gl_FragCoord.xy, 64.0);
  color = mix(color, uB, step(cell.x, 1.0) + step(cell.y, 1.0) > 0.0 ? 0.9 : 0.0);
  // Bars: bass at the bottom, treble at the top, mirrored around the spine.
  float rows = 48.0;
  float f = (p.y + 1.0) * 0.5;
  float row = (floor(f * rows) + 0.5) / rows;
  float level = spec(row);
  float reach = level * aspect() * 0.92;
  float gap = step(0.22, fract(f * rows));
  float bar = step(abs(p.x), reach) * gap;
  vec3 barColor = mix(uC, uGlow, row);
  color = mix(color, barColor * (0.55 + 0.45 * (1.0 - abs(p.x) / max(reach, 0.001))), bar);
  color += barColor * gap * 0.55 * exp(-abs(abs(p.x) - reach) * 22.0) * level;
  // The spine: a bright line, vertebrae that light up with each row's level.
  float spine = exp(-abs(p.x) * uRes.y * 0.35);
  color += uGlow * spine * (0.8 + uLevel * 2.0);
  float vertebra = step(abs(p.x), 0.018 + level * 0.03) * step(0.55, fract(f * rows));
  color = mix(color, mix(uGlow, vec3(1.0), 0.6), vertebra * (0.3 + level));
  // A ring that blooms out from the middle on each beat.
  float ring = abs(length(p) - (1.0 - uBeat) * 1.6);
  color += uGlow * exp(-ring * 30.0) * uBeat * 0.6;
  gl_FragColor = vec4(finish(color, 0.35), 1.0);
}
`;

/** Anime night: a full moon ringed by the spectrum, cherry blossoms drifting down, stars that twinkle on the highs. */
const SAKURA = `
void main() {
  vec2 p = centered();
  vec3 sky = mix(uB, uA, smoothstep(-0.9, 1.0, p.y));
  vec3 color = backdrop(sky, 0.55);
  // Stars.
  vec2 starCell = floor(gl_FragCoord.xy / 3.0);
  float star = step(0.9965, hash(starCell));
  color += star * (0.35 + 0.65 * uHigh) * (0.5 + 0.5 * sin(uTime * 3.0 + hash(starCell + 7.0) * 40.0));
  // The moon, breathing with the bass.
  vec2 moonAt = vec2(0.0, 0.22);
  float radius = 0.3 + uBass * 0.05 + uBeat * 0.025;
  vec2 m = p - moonAt;
  float d = length(m);
  color += uC * 0.4 * exp(-max(d - radius, 0.0) * 5.0);
  vec3 moon = mix(uGlow, vec3(1.0), 0.8) - noise(m * 9.0) * 0.08;
  color = mix(color, moon, smoothstep(radius, radius - 0.008, d));
  // Spectrum ring around it.
  float bins = 90.0;
  float a = around(m);
  float level = spec(floor(a * bins) / bins);
  float inner = radius + 0.035;
  float outer = inner + 0.015 + level * 0.42;
  float segment = step(0.32, fract(a * bins));
  color = mix(color, uGlow, step(inner, d) * step(d, outer) * segment);
  color += uGlow * 0.6 * exp(-abs(d - outer) * 45.0) * segment * level;
  // Hills.
  float hill = -0.72 + 0.07 * sin(p.x * 1.6 + 0.6) + 0.06 * noise(vec2(p.x * 2.2, 3.0));
  color = mix(color, uA * 0.3, smoothstep(hill + 0.006, hill - 0.006, p.y));
  // Petals: each drifts down, sways, and spins.
  for (int i = 0; i < 40; i++) {
    float n = float(i);
    float h1 = hash(vec2(n, 1.3));
    float h2 = hash(vec2(n, 7.1));
    float h3 = hash(vec2(n, 3.7));
    vec2 at = vec2((h1 * 2.0 - 1.0) * aspect() * 1.1 + sin(uTime * (0.4 + h2) + n) * 0.18, 1.25 - mod(uTime * (0.07 + h2 * 0.1) + h3 * 2.5, 2.5));
    vec2 q = turn(uTime * (0.6 + h1) + n) * (p - at);
    float size = 0.016 + h3 * 0.024 + uMid * 0.006;
    float petal = smoothstep(1.0, 0.65, length(q / vec2(size, size * 0.58)));
    petal *= 1.0 - smoothstep(0.0, size * 0.35, -q.x) * step(abs(q.y), size * 0.12);
    color = mix(color, mix(uC, vec3(1.0), 0.3 * h2), petal * 0.92);
  }
  gl_FragColor = vec4(finish(color, 0.15), 1.0);
}
`;

/** Retro anime sunset: a striped sun pumping to the bass, spectrum mountains, and a neon grid racing toward you. */
const SUNSET = `
void main() {
  vec2 p = centered();
  float horizon = -0.12;
  vec3 color;
  if (p.y > horizon) {
    vec3 sky = mix(uC, uA, smoothstep(horizon, 1.0, p.y));
    color = backdrop(sky, 0.6);
    vec2 sunAt = vec2(0.0, horizon + 0.4);
    float radius = 0.4 + uBass * 0.05;
    float d = length(p - sunAt);
    float below = smoothstep(sunAt.y + 0.05, sunAt.y - radius, p.y);
    float stripes = step(below * 0.55, fract((p.y - sunAt.y) * 16.0 + uTime * 0.5));
    vec3 sun = mix(uB, uGlow, smoothstep(sunAt.y - radius, sunAt.y + radius, p.y));
    color = mix(color, sun, smoothstep(radius, radius - 0.006, d) * stripes);
    color += uB * 0.3 * exp(-max(d - radius, 0.0) * 4.0) * (0.6 + uBeat);
    // Mountains: noise for the shape, the spectrum for the peaks.
    float x = abs(p.x / aspect());
    float ridge = horizon + 0.03 + 0.14 * noise(vec2(p.x * 2.4, 1.0)) + spec(x) * 0.26 * smoothstep(0.0, 0.35, x);
    color = mix(color, uA * 0.4, smoothstep(ridge + 0.004, ridge - 0.004, p.y));
    color += uGlow * 0.7 * exp(-abs(p.y - ridge) * 140.0);
  } else {
    // The floor grid in perspective; line width worked out per pixel so far lines stay crisp.
    float depth = horizon - p.y + 0.0001;
    float z = 0.35 / depth;
    vec2 grid = vec2(p.x * z, z + uTime * (1.0 + uLevel * 3.5));
    vec2 toLine = 0.5 - abs(fract(grid) - 0.5);
    float pixel = 2.0 / uRes.y;
    float wide = max(1.0 - smoothstep(0.0, z * pixel * 1.6, toLine.x), 1.0 - smoothstep(0.0, 0.35 / (depth * depth) * pixel * 1.6, toLine.y));
    color = mix(uA * 0.35, uB, wide);
    color = mix(color, uC, exp(-depth * 7.0) * 0.7);
  }
  // The waveform as a neon line just above the horizon.
  float line = horizon + 0.02 + wave(vUv.x) * 0.1;
  color += uGlow * exp(-abs(p.y - line) * 160.0) * (0.6 + uLevel);
  gl_FragColor = vec4(finish(color, 0.5), 1.0);
}
`;

/** Manga impact panel: halftone paper, speed lines that thicken with loudness, a burst on every beat. */
const IMPACT = `
void main() {
  vec2 p = centered();
  float d = length(p);
  float angle = (atan(p.y, p.x) + PI) / TAU;
  vec3 color = backdrop(uA, 0.4);
  // Halftone, heavier toward the edges.
  vec2 dotCell = fract(gl_FragCoord.xy / 7.0) - 0.5;
  float tone = smoothstep(0.3, 1.5, d) * 0.62;
  color = mix(color, uB, step(length(dotCell), tone * 0.55) * 0.55);
  // Speed lines: thin wedges, reshuffled 12 times a second.
  float bands = 200.0;
  float band = floor(angle * bands);
  float pick = hash(vec2(band, floor(uTime * 12.0)));
  float starts = 0.32 + pick * 0.7 - uLevel * 0.35;
  float wedge = 1.0 - smoothstep(0.0, 0.5, abs(fract(angle * bands) - 0.5) * 2.0 - (1.0 - pick) * 0.9);
  color = mix(color, uB, step(starts, d) * step(pick, 0.3 + uLevel * 0.6) * wedge);
  // The burst.
  float spikes = 16.0;
  float burst = (0.28 + uBeat * 0.55) * (0.72 + 0.28 * abs(sin(angle * TAU * spikes * 0.5 + floor(uTime * 8.0))));
  color = mix(color, uC, step(d, burst) * step(0.04, uBeat));
  color = mix(color, uB, smoothstep(0.012, 0.0, abs(d - burst)) * step(0.04, uBeat));
  // The voice: a waveform ring, with the glow color inside on loud bits.
  float a = around(p);
  float ring = 0.25 + wave(a) * 0.09 + uBass * 0.05;
  color = mix(color, mix(uA, uGlow, uLevel * 0.8), smoothstep(ring - 0.008, ring - 0.016, d));
  color = mix(color, uB, smoothstep(0.014, 0.0, abs(d - ring)));
  // Panel border, 6 px of ink.
  vec2 fromEdge = min(gl_FragCoord.xy, uRes - gl_FragCoord.xy);
  color = mix(color, uB, step(min(fromEdge.x, fromEdge.y), 6.0));
  gl_FragColor = vec4(color, 1.0);
}
`;

/** A summoning circle: turning rings of runes and a hexagram, spectrum spikes around it, sparks rising. */
const MAGIC = `
void main() {
  vec2 p = centered();
  vec3 color = backdrop(uA, 0.4);
  color += uB * 0.35 * exp(-length(p) * 1.6);
  float d = length(p);
  float spin = uTime * 0.22;
  float radius = 0.76 + uBass * 0.04;
  float glow = 0.0;
  glow += smoothstep(0.006, 0.0, abs(d - radius));
  glow += smoothstep(0.004, 0.0, abs(d - radius * 0.92));
  glow += smoothstep(0.004, 0.0, abs(d - radius * 0.56));
  glow += smoothstep(0.003, 0.0, abs(d - radius * 0.49));
  // Runes: broken ticks in the band between the outer rings, turning one way.
  vec2 r = turn(spin) * p;
  float slot = fract((atan(r.y, r.x) + PI) / TAU * 54.0);
  float runeId = floor((atan(r.y, r.x) + PI) / TAU * 54.0);
  float inBand = step(radius * 0.935, d) * step(d, radius * 0.985);
  glow += inBand * step(0.22, slot) * step(slot, 0.78) * step(0.4, hash(vec2(runeId, floor(d * 90.0)))) * 0.85;
  // Inner runes, turning the other way.
  vec2 r2 = turn(-spin * 1.5) * p;
  float slot2 = fract((atan(r2.y, r2.x) + PI) / TAU * 30.0);
  glow += step(radius * 0.5, d) * step(d, radius * 0.55) * step(0.3, slot2) * step(slot2, 0.7) * 0.7;
  // The hexagram: two triangles, each turning its own way.
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    vec2 q = turn(spin * (fk > 0.5 ? -1.3 : 1.0)) * p;
    for (int e = 0; e < 3; e++) {
      float side = float(e) * TAU / 3.0 + fk * PI / 3.0;
      glow += smoothstep(0.005, 0.0, abs(dot(q, vec2(cos(side), sin(side))) - radius * 0.46)) * step(d, radius * 0.92);
    }
  }
  // Spectrum spikes around the outside.
  float a = around(p);
  float bins = 80.0;
  float level = spec(floor(a * bins) / bins);
  glow += step(radius + 0.02, d) * step(d, radius + 0.03 + level * 0.36) * step(0.42, fract(a * bins));
  // Sparks drifting up out of the circle.
  for (int i = 0; i < 28; i++) {
    float n = float(i);
    float h1 = hash(vec2(n, 2.1));
    float h2 = hash(vec2(n, 5.3));
    float rise = fract(uTime * (0.08 + h2 * 0.12) + h1);
    vec2 at = vec2((h1 * 2.0 - 1.0) * radius, -radius + rise * 2.2);
    glow += smoothstep(0.012 + uHigh * 0.01, 0.0, length(p - at)) * (1.0 - rise) * 1.4;
  }
  color += uC * glow * (0.7 + uLevel * 1.3 + uBeat * 0.7);
  color += uGlow * glow * 0.25;
  gl_FragColor = vec4(finish(color, 0.2), 1.0);
}
`;

/** Hyperspace: star streaks rushing out of the middle, faster the louder you are, and rings pulsing to the beat. */
const WARP = `
void main() {
  vec2 p = centered();
  vec3 color = backdrop(uA, 0.35);
  float d = length(p);
  float angle = (atan(p.y, p.x) + PI) / TAU;
  float speed = 0.5 + uLevel * 3.0;
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float bands = 80.0 + fl * 70.0;
    float id = floor(angle * bands);
    float h = hash(vec2(id, fl + 1.0));
    float z = fract(h * 7.0 + uTime * speed * (0.12 + fl * 0.06));
    float reach = z * z * 2.2;
    float tail = 0.015 + z * 0.12 * speed;
    float streak = smoothstep(tail, 0.0, abs(d - reach)) * step(d, reach) * step(abs(fract(angle * bands) - 0.5), 0.06 + z * 0.06);
    color += mix(uB, uC, h) * streak * z * 1.8;
  }
  // Tunnel rings, one per beat-ish, sized by the spectrum.
  float tunnel = fract(0.18 / (d + 0.05) + uTime * speed * 0.25);
  float level = spec(around(p) * 0.6);
  color += uGlow * smoothstep(0.04, 0.0, abs(tunnel - 0.5)) * (0.15 + level * 0.8) * smoothstep(0.05, 0.4, d);
  color += uGlow * exp(-d * 4.0) * (0.25 + uBass * 1.2);
  gl_FragColor = vec4(finish(color, 0.15), 1.0);
}
`;

/** Scene ids in the order the studio lists them; the first is the default. */
export const SCENES = /** @type {const} */ (['spine', 'sakura', 'sunset', 'impact', 'magic', 'warp']);

/** @type {Record<typeof SCENES[number], string>} */
export const SCENE_SHADERS = {
  spine: COMMON + SPINE,
  sakura: COMMON + SAKURA,
  sunset: COMMON + SUNSET,
  impact: COMMON + IMPACT,
  magic: COMMON + MAGIC,
  warp: COMMON + WARP,
};

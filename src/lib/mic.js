// Microphone capture for local speech (src/lib/speech.svelte.js): opens the microphone and hands back 16 kHz mono
// audio in 100 ms pieces, as the raw float32 bytes the speech engine takes. The resampling runs in an AudioWorklet,
// off the main thread; the worklet is small enough to live here as text rather than in a file of its own.

const TARGET_RATE = 16_000;
// 100 ms of audio per message: small enough to feel live, large enough not to flood the engine.
const CHUNK_SAMPLES = 1_600;
const PROCESSOR = 'ws-capture';
// Each output sample is the average of the input samples it spans: a cheap low-pass that keeps speech clean when the
// microphone runs at 44.1 or 48 kHz. At 16 kHz it passes samples straight through.
const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / options.processorOptions.rate;
    this.size = options.processorOptions.chunk;
    this.out = new Float32Array(this.size);
    this.filled = 0;
    this.position = 0;
    this.sum = 0;
    this.count = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let index = 0; index < input.length; index++) {
      this.sum += input[index];
      this.count++;
      this.position++;
      if (this.position < this.ratio) continue;
      this.position -= this.ratio;
      this.out[this.filled++] = this.sum / this.count;
      this.sum = 0;
      this.count = 0;
      if (this.filled < this.size) continue;
      this.port.postMessage(this.out.buffer, [this.out.buffer]);
      this.out = new Float32Array(this.size);
      this.filled = 0;
    }
    return true;
  }
}
registerProcessor('${PROCESSOR}', Capture);`;

/**
 * Opens the microphone. Rejects (NotAllowedError when the user or the system said no) if it can't.
 * @param {(audio: Uint8Array) => void} onAudio called with each 100 ms of 16 kHz mono float32 samples
 * @returns {Promise<() => void>} closes the microphone
 */
export async function openMic(onAudio) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  /** @type {AudioContext} */
  let context;
  try {
    // Most WebViews resample for us; the worklet handles the ones that insist on their own rate.
    context = new AudioContext({ sampleRate: TARGET_RATE });
  } catch {
    context = new AudioContext();
  }
  const close = () => {
    for (const track of stream.getTracks()) track.stop();
    context.close().catch(() => {});
  };
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
  try {
    await context.audioWorklet.addModule(url);
    const node = new AudioWorkletNode(context, PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 0, processorOptions: { rate: TARGET_RATE, chunk: CHUNK_SAMPLES } });
    node.port.onmessage = (event) => onAudio(new Uint8Array(event.data));
    context.createMediaStreamSource(stream).connect(node);
  } catch (error) {
    close();
    throw error;
  } finally {
    URL.revokeObjectURL(url);
  }
  return close;
}

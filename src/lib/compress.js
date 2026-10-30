// Gets media down to size before it uploads, so nothing over the limits in models.js ever reaches R2 (the server
// enforces the same limits). Images over MAX_IMAGE_BYTES or wider than MAX_SIDE_PX are redrawn on a canvas, at most
// MAX_SIDE_PX on the long side, and encoded as WebP (JPEG on browsers that can't encode WebP, such as Safari 15),
// stepping the quality down and then the size until they fit. Small images upload untouched. GIFs keep their animation,
// so they are sent as they are; videos can't be re-encoded without a large library, so both are only checked.
// Audio and documents are size-checked and carry the type their extension names.
import { MAX_AUDIO_BYTES, MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, VIDEO_TYPES, attachmentKind, uploadType } from './models.js';

const MAX_SIDE_PX = 2560;
const MIN_SIDE_PX = 480;
const QUALITIES = [0.86, 0.76, 0.66, 0.56];
// When the lowest quality is still too big, the image shrinks by this much and tries again.
const SHRINK_STEP = 0.8;
const PASS_THROUGH = ['image/gif'];
const WEBP = 'image/webp';
const JPEG = 'image/jpeg';
const BYTES_PER_MB = 1024 * 1024;
// Checked once: Safari before 16 hands back a PNG when asked for WebP.
const OUTPUT_TYPE = document.createElement('canvas').toDataURL(WEBP).startsWith(`data:${WEBP}`) ? WEBP : JPEG;
// Opaque background for JPEG, which has no transparency (transparent screenshots would otherwise turn black).
const JPEG_BACKGROUND = 'white';

/** @param {number} bytes */
const megabytes = (bytes) => `${Math.round((bytes / BYTES_PER_MB) * 10) / 10} MB`;

/**
 * The file to upload: the original when it already fits, otherwise a smaller re-encoded copy. Throws an Error with
 * a readable message when it can't be made to fit (a large video or GIF, or an image that won't shrink enough).
 * @param {File} file
 * @returns {Promise<File>}
 */
export async function prepareForUpload(file) {
  const type = uploadType(file);
  const kind = attachmentKind(type);
  if (kind === 'document') {
    if (file.size > MAX_DOCUMENT_BYTES) throw new Error(`${file.name} is ${megabytes(file.size)}; documents can be at most ${megabytes(MAX_DOCUMENT_BYTES)}.`);
    return file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
  }
  if (kind === 'audio' || VIDEO_TYPES.includes(file.type) || PASS_THROUGH.includes(file.type)) {
    const max = kind === 'audio' ? MAX_AUDIO_BYTES : VIDEO_TYPES.includes(file.type) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    const label = kind === 'audio' ? 'Audio files' : VIDEO_TYPES.includes(file.type) ? 'Videos' : 'GIFs';
    if (file.size > max) throw new Error(`${file.name} is ${megabytes(file.size)}; ${label} can be at most ${megabytes(max)}.`);
    return file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
  }
  const bitmap = await createImageBitmap(file);
  try {
    const longSide = Math.max(bitmap.width, bitmap.height);
    if (file.size <= MAX_IMAGE_BYTES && longSide <= MAX_SIDE_PX) return file;
    let scale = Math.min(1, MAX_SIDE_PX / longSide);
    while (longSide * scale >= MIN_SIDE_PX) {
      const blob = await encode(bitmap, scale);
      if (blob) return new File([blob], file.name.replace(/\.[^.]+$/, '') + (OUTPUT_TYPE === WEBP ? '.webp' : '.jpg'), { type: OUTPUT_TYPE, lastModified: file.lastModified });
      scale *= SHRINK_STEP;
    }
    throw new Error(`${file.name} couldn't be made smaller than ${megabytes(MAX_IMAGE_BYTES)}.`);
  } finally {
    bitmap.close();
  }
}

/**
 * Draws the image at a scale and tries each quality; the first encoding under the limit, or null.
 * @param {ImageBitmap} bitmap @param {number} scale
 * @returns {Promise<Blob | null>}
 */
async function encode(bitmap, scale) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  if (OUTPUT_TYPE === JPEG) {
    context.fillStyle = JPEG_BACKGROUND;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of QUALITIES) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, OUTPUT_TYPE, quality));
    if (blob && blob.size <= MAX_IMAGE_BYTES) return blob;
  }
  return null;
}

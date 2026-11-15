// Saves a file to the device. Phones (and the mobile apps, whose WebViews ignore downloads) get the share sheet, which
// saves to Files or sends it on; everything else downloads it. Used by the recorder's exports and the Tapes page.

const TOUCH_ONLY = '(hover: none) and (pointer: coarse)';
// A download's address is freed this long after the click, once the browser has taken the file.
const REVOKE_MS = 1_000;

/** @param {Blob} blob @param {string} name */
export async function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (matchMedia(TOUCH_ONLY).matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      if (/** @type {Error} */ (error)?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS);
}

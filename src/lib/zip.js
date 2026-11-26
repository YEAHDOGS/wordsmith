// A small .zip writer, so "Download my data" needs no library. Files are stored as they are (no compression): every
// unzip tool reads that, and the audio, video and images that make up most of an export are compressed already.
// Classic zip only (no zip64): under 4 GB and 65,535 files, which the caller keeps to (src/lib/data-export.js).

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_RECORD_BYTES = 22;
// Version 2.0, the lowest that covers folders in names.
const VERSION = 20;
// Bit 11: names are UTF-8.
const UTF8_NAMES = 0x0800;
const STORED = 0;
const CRC_POLYNOMIAL = 0xedb88320;
const DOS_EPOCH_YEAR = 1980;
// The numbers passed to setUint16 and setUint32 below are the byte offsets of the zip format's header fields.
/** Most files a classic zip holds. */
export const MAX_ZIP_FILES = 65_535;

const CRC_TABLE = new Uint32Array(256).map((_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? CRC_POLYNOMIAL ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

/** CRC-32 of some bytes, as zip wants it. @param {Uint8Array} bytes */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A date as zip's two 16-bit fields (2-second steps, local time). @param {Date} date */
function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = (Math.max(0, date.getFullYear() - DOS_EPOCH_YEAR) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * Packs files into a .zip. Names use "/" for folders.
 * @param {{ name: string, data: Uint8Array, date?: Date }[]} files
 * @returns {Blob}
 */
export function zip(files) {
  if (files.length > MAX_ZIP_FILES) throw new Error(`A zip holds at most ${MAX_ZIP_FILES} files`);
  const encoder = new TextEncoder();
  /** @type {(Uint8Array | ArrayBuffer)[]} */
  const parts = [];
  /** @type {ArrayBuffer[]} */
  const directory = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const { time, day } = dosTime(file.date ?? new Date());
    const crc = crc32(file.data);
    const size = file.data.length;
    const local = new DataView(new ArrayBuffer(LOCAL_HEADER_BYTES));
    local.setUint32(0, LOCAL_HEADER, true);
    local.setUint16(4, VERSION, true);
    local.setUint16(6, UTF8_NAMES, true);
    local.setUint16(8, STORED, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    const central = new DataView(new ArrayBuffer(CENTRAL_HEADER_BYTES));
    central.setUint32(0, CENTRAL_HEADER, true);
    central.setUint16(4, VERSION, true);
    central.setUint16(6, VERSION, true);
    central.setUint16(8, UTF8_NAMES, true);
    central.setUint16(10, STORED, true);
    central.setUint16(12, time, true);
    central.setUint16(14, day, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true);
    central.setUint32(24, size, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    parts.push(local.buffer, name, file.data);
    directory.push(central.buffer, name.buffer.slice(name.byteOffset, name.byteOffset + name.byteLength));
    offset += LOCAL_HEADER_BYTES + name.length + size;
  }
  const directoryBytes = directory.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(END_RECORD_BYTES));
  end.setUint32(0, END_RECORD, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directoryBytes, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end.buffer], { type: 'application/zip' });
}

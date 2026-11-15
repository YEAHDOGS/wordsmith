// Wraps Opus packets in an Ogg file (RFC 7845), the .ogg every browser and phone plays. Used for tapes by both
// encoders in src/lib/tape-encode.js: the desktop apps' libopus (src/tauri/src/tapes/mod.rs) and the browser's own
// (WebCodecs), which both hand over bare packets. Mono only, which is all tapes use.
// An Ogg file is a run of pages: "OggS", flags, the granule position (48 kHz samples up to the end of the page's last
// packet), a serial number, the page's index, a CRC, then a lacing table of segment lengths and the data.

const CAPTURE = [0x4f, 0x67, 0x67, 0x53]; // "OggS"
const OPUS_HEAD = 'OpusHead';
const OPUS_TAGS = 'OpusTags';
const VENDOR = 'wordsmith by DOGS';
const OPUS_VERSION = 1;
const CHANNELS = 1;
const MAPPING_FAMILY = 0;
const HEAD_BYTES = 19;
// Page flags
const CONTINUED = 0;
const FIRST_PAGE = 0x02;
const LAST_PAGE = 0x04;
const PAGE_HEADER_BYTES = 27;
const MAX_SEGMENTS = 255;
const SEGMENT_BYTES = 255;
// About a second of 20 ms packets per page: small pages let players seek, while headers stay a sliver of the file.
const PACKETS_PER_PAGE = 50;
const CRC_POLYNOMIAL = 0x04c11db7;
const BYTE_BITS = 8;
const TOP_BIT = 0x80000000;
const TYPE = 'audio/ogg';

/** CRC-32 lookup for Ogg (polynomial 0x04c11db7, not reflected), built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index++) {
    let crc = index << 24;
    for (let bit = 0; bit < BYTE_BITS; bit++) crc = crc & TOP_BIT ? (crc << 1) ^ CRC_POLYNOMIAL : crc << 1;
    table[index] = crc >>> 0;
  }
  return table;
})();

/** @param {Uint8Array} bytes */
function crc(bytes) {
  let value = 0;
  for (const byte of bytes) value = ((value << 8) ^ CRC_TABLE[((value >>> 24) ^ byte) & 0xff]) >>> 0;
  return value;
}

/** @typedef {{ data: Uint8Array, samples: number }} OpusPacket one packet and how many 48 kHz samples it holds */

/**
 * One Ogg page holding whole packets.
 * @param {Uint8Array[]} packets @param {{ flags: number, granule: number, serial: number, index: number }} page
 */
function writePage(packets, { flags, granule, serial, index }) {
  /** @type {number[]} */
  const lacing = [];
  for (const packet of packets) {
    for (let left = packet.length; ; left -= SEGMENT_BYTES) {
      lacing.push(Math.min(left, SEGMENT_BYTES));
      // A packet ends on a segment shorter than 255 bytes, so a length that's a multiple of 255 adds a 0.
      if (left < SEGMENT_BYTES) break;
    }
  }
  const body = packets.reduce((sum, packet) => sum + packet.length, 0);
  const page = new Uint8Array(PAGE_HEADER_BYTES + lacing.length + body);
  const view = new DataView(page.buffer);
  page.set(CAPTURE, 0);
  page[5] = flags;
  view.setBigInt64(6, BigInt(granule), true);
  view.setUint32(14, serial, true);
  view.setUint32(18, index, true);
  page[26] = lacing.length;
  page.set(lacing, PAGE_HEADER_BYTES);
  let offset = PAGE_HEADER_BYTES + lacing.length;
  for (const packet of packets) {
    page.set(packet, offset);
    offset += packet.length;
  }
  view.setUint32(22, crc(page), true);
  return page;
}

/** Segments a packet takes in the lacing table. @param {Uint8Array} packet */
const segmentsOf = (packet) => Math.floor(packet.length / SEGMENT_BYTES) + 1;

/** @param {string} text */
const ascii = (text) => new TextEncoder().encode(text);

/**
 * An Ogg Opus file from encoded packets.
 * @param {{ packets: OpusPacket[], preSkip: number, samples: number, inputRate: number }} audio
 *   preSkip: samples the decoder drops at the start (the encoder's delay); samples: 48 kHz samples of real audio,
 *   so the decoder also drops the silence that pads the last packet; inputRate: the rate the audio was recorded at
 * @returns {Blob}
 */
export function oggOpus({ packets, preSkip, samples, inputRate }) {
  const serial = crypto.getRandomValues(new Uint32Array(1))[0];
  const head = new Uint8Array(HEAD_BYTES);
  const headView = new DataView(head.buffer);
  head.set(ascii(OPUS_HEAD), 0);
  head[8] = OPUS_VERSION;
  head[9] = CHANNELS;
  headView.setUint16(10, preSkip, true);
  headView.setUint32(12, inputRate, true);
  headView.setInt16(16, 0, true);
  head[18] = MAPPING_FAMILY;
  const vendor = ascii(VENDOR);
  const tags = new Uint8Array(OPUS_TAGS.length + 4 + vendor.length + 4);
  tags.set(ascii(OPUS_TAGS), 0);
  new DataView(tags.buffer).setUint32(OPUS_TAGS.length, vendor.length, true);
  tags.set(vendor, OPUS_TAGS.length + 4);

  const pages = [writePage([head], { flags: FIRST_PAGE, granule: 0, serial, index: 0 }), writePage([tags], { flags: CONTINUED, granule: 0, serial, index: 1 })];
  const end = preSkip + samples;
  let granule = 0;
  /** @type {Uint8Array[]} */
  let pending = [];
  let segments = 0;
  packets.forEach((packet, position) => {
    if (pending.length && (pending.length >= PACKETS_PER_PAGE || segments + segmentsOf(packet.data) > MAX_SEGMENTS)) {
      pages.push(writePage(pending, { flags: CONTINUED, granule, serial, index: pages.length }));
      pending = [];
      segments = 0;
    }
    pending.push(packet.data);
    segments += segmentsOf(packet.data);
    granule += packet.samples;
    // The last page's granule marks where the real audio ends.
    if (position === packets.length - 1) pages.push(writePage(pending, { flags: LAST_PAGE, granule: Math.min(granule, end), serial, index: pages.length }));
  });
  return new Blob(pages, { type: TYPE });
}

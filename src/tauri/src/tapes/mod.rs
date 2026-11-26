//! Tapes on the desktop apps: shrinking voice recordings before they upload. The web app (src/lib/tape-encode.js)
//! hands over the original file's bytes as the request body of `tape_encode`; this decodes it (audio.rs), mixes it to
//! mono at 48 kHz and encodes Opus at a voice bitrate. The answer is the bare Opus packets, which the web app wraps in
//! an Ogg file (src/lib/ogg-opus.js, the one muxer for this path and the browser's own encoder):
//!
//! `pre-skip: u32 LE` `samples: u64 LE` (48 kHz samples of real audio), then per packet `length: u16 LE` + its bytes.
//!
//! A 128 kbps MP3 comes out about a fifth of its size. Phones, which can't run this, use the browser's encoder instead.
pub mod audio;

use opus::{Application, Bitrate, Channels, Encoder};
use tauri::ipc::{InvokeBody, Request, Response};

/// Opus works at 48 kHz; the file's own rate is converted on the way in.
pub const OPUS_RATE: u32 = 48_000;
/// 20 ms frames: Opus's default, and the best quality per bit for speech.
const FRAME: usize = 960;
/// Bits per second. Speech stays clear and rap over a beat still sounds like itself; models.js says the same.
const BITRATE: i32 = 24_000;
/// libopus's slowest, best encoding: a recording is encoded once and played back many times.
const COMPLEXITY: i32 = 10;
/// Larger than any packet at this bitrate can be.
const MAX_PACKET: usize = 4_000;
/// The request header naming the original file's extension ("mp3"), which helps find its format.
const EXTENSION_HEADER: &str = "tape-extension";
const MAX_EXTENSION: usize = 8;
const EMPTY: &str = "This recording has no sound in it";
/// The answer's pre-skip and sample count, before the packets.
const HEADER_BYTES: usize = 12;

/// Encodes the request body (an audio file) to Opus packets; see the module docs for the answer's layout.
#[tauri::command(async)]
pub fn tape_encode(request: Request<'_>) -> Result<Response, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the recording's bytes".into());
    };
    let extension: String = request
        .headers()
        .get(EXTENSION_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(MAX_EXTENSION)
        .collect();
    encode(bytes.clone(), &extension).map(Response::new)
}

/// Decodes, resamples and encodes one recording.
fn encode(bytes: Vec<u8>, extension: &str) -> Result<Vec<u8>, String> {
    let mut encoder = Encoder::new(OPUS_RATE, Channels::Mono, Application::Audio).map_err(|error| error.to_string())?;
    encoder.set_bitrate(Bitrate::Bits(BITRATE)).map_err(|error| error.to_string())?;
    encoder.set_vbr(true).map_err(|error| error.to_string())?;
    encoder.set_complexity(COMPLEXITY).map_err(|error| error.to_string())?;
    let pre_skip = encoder.get_lookahead().map_err(|error| error.to_string())? as u32;

    let mut packer = Packer { encoder, frame: Vec::with_capacity(FRAME), packets: Vec::new(), samples: 0, failure: None };
    let mut converter = audio::Converter::new(OPUS_RATE);
    audio::decode_mono(bytes, extension, &mut |input, rate| {
        converter.push(input, rate, &mut |sample| packer.push(sample));
        packer.failure.is_none()
    })?;
    if !converter.finish(&mut |sample| packer.push(sample)) {
        return Err(EMPTY.into());
    }
    if packer.samples == 0 {
        return Err(EMPTY.into());
    }
    // The encoder runs `pre_skip` samples behind: feed silence until every real sample has come out the other side.
    let real = packer.samples;
    while packer.samples - (packer.frame.len() as u64) < real + u64::from(pre_skip) {
        packer.push(0.0);
    }
    if let Some(error) = packer.failure {
        return Err(error);
    }

    let mut out = Vec::with_capacity(packer.packets.len() + HEADER_BYTES);
    out.extend_from_slice(&pre_skip.to_le_bytes());
    out.extend_from_slice(&real.to_le_bytes());
    out.extend_from_slice(&packer.packets);
    Ok(out)
}

/// Gathers samples into 20 ms frames and encodes each one as it fills, length first.
struct Packer {
    encoder: Encoder,
    frame: Vec<f32>,
    packets: Vec<u8>,
    /// Samples pushed so far, silence at the end included.
    samples: u64,
    failure: Option<String>,
}

impl Packer {
    fn push(&mut self, sample: f32) {
        self.frame.push(sample);
        self.samples += 1;
        if self.frame.len() < FRAME {
            return;
        }
        let mut packet = [0u8; MAX_PACKET];
        match self.encoder.encode_float(&self.frame, &mut packet) {
            Ok(length) => {
                self.packets.extend_from_slice(&(length as u16).to_le_bytes());
                self.packets.extend_from_slice(&packet[..length]);
            }
            Err(error) => {
                self.failure.get_or_insert(error.to_string());
            }
        }
        self.frame.clear();
    }
}


//! Audio plumbing for tapes, with no Tauri in it: decode a recording held in memory to mono samples as it goes
//! (symphonia for what recorders save, libopus for tapes as stored), and change their sample rate on the fly (a small
//! windowed-sinc resampler). Nothing here holds a whole decoded file, so an hour-long recording takes no more memory
//! than a short one.
use std::f32::consts::PI;
use std::io::Cursor;

use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

const NOT_AUDIO: &str = "This file has no audio wordsmith can read";
/// Filter taps on each side of a sample. Eight is plenty for speech at voice bitrates and keeps long files quick.
const HALF_TAPS: usize = 8;
/// Fractional positions the filter is precomputed for; each output sample uses the nearest.
const PHASES: usize = 512;
/// Opus decodes at 48 kHz.
const OPUS_RATE: u32 = 48_000;
/// The longest Opus frame (120 ms at 48 kHz), per channel.
const MAX_OPUS_FRAME: usize = 5_760;
const MAX_OPUS_CHANNELS: usize = 2;
const OGG_CAPTURE: &[u8] = b"OggS";
const OPUS_HEAD: &[u8] = b"OpusHead";
/// OpusHead sits in the first page, a few dozen bytes in.
const OGG_HEAD_SEARCH: usize = 64;
const OGG_PAGE_HEADER: usize = 27;
const OGG_SEGMENT_MAX: usize = 255;
const OPUS_HEAD_CHANNELS: usize = 9;
const OPUS_HEAD_PRE_SKIP: usize = 10;
/// The highest sample rate a recording may claim. A damaged header claiming more would make the resampler's filter
/// table gigabytes long.
const MAX_SAMPLE_RATE: u32 = 384_000;
/// The OpusHead and OpusTags packets come before the audio.
const OPUS_HEADER_PACKETS: usize = 2;

/// Where decoded audio goes: mono samples and their rate. It answers false to stop decoding early (the engine
/// went away, or the encoder failed), so nothing is decoded that would only be thrown away.
pub type Sink<'a> = dyn FnMut(&[f32], u32) -> bool + 'a;

/// Decodes `bytes` (MP3, M4A/AAC, WAV, FLAC or Ogg Vorbis; `extension` is a hint) and hands `sink` mono samples at
/// the file's own rate, one decoded packet at a time. Damaged packets are skipped, as players do.
pub fn decode_mono(bytes: Vec<u8>, extension: &str, sink: &mut Sink) -> Result<(), String> {
    let source = MediaSourceStream::new(Box::new(Cursor::new(bytes)), Default::default());
    let mut hint = Hint::new();
    if !extension.is_empty() {
        hint.with_extension(extension);
    }
    let mut format = symphonia::default::get_probe()
        .probe(&hint, source, FormatOptions::default(), MetadataOptions::default())
        .map_err(|_| NOT_AUDIO.to_string())?;
    let track = format.default_track(TrackType::Audio).ok_or(NOT_AUDIO)?;
    let track_id = track.id;
    let params = track.codec_params.as_ref().and_then(|params| params.audio()).ok_or(NOT_AUDIO)?;
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(params, &AudioDecoderOptions::default())
        .map_err(|error| format!("Can't decode this file: {error}"))?;
    let mut interleaved: Vec<f32> = Vec::new();
    let mut mono: Vec<f32> = Vec::new();
    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => return Ok(()),
            // A file cut short (a recording app killed mid-write) still keeps everything before the cut.
            Err(Error::IoError(_)) => return Ok(()),
            Err(error) => return Err(error.to_string()),
        };
        if packet.track_id != track_id {
            continue;
        }
        let buffer = match decoder.decode(&packet) {
            Ok(buffer) => buffer,
            Err(Error::DecodeError(_)) => continue,
            Err(error) => return Err(error.to_string()),
        };
        let channels = buffer.spec().channels().count().max(1);
        let rate = buffer.spec().rate();
        if rate == 0 || rate > MAX_SAMPLE_RATE {
            return Err(NOT_AUDIO.into());
        }
        buffer.copy_to_vec_interleaved(&mut interleaved);
        mono.clear();
        mono.extend(interleaved.chunks_exact(channels).map(|frame| frame.iter().sum::<f32>() / channels as f32));
        if !mono.is_empty() && !sink(&mono, rate) {
            return Ok(());
        }
    }
}

/// Streaming sample-rate converter: push samples in at one rate, get them out at another.
pub struct Resampler {
    /// Input samples per output sample.
    step: f64,
    /// Where the next output sample falls, in input samples from the start of `history`.
    position: f64,
    history: Vec<f32>,
    /// Filter taps on each side, in input samples (wider when shrinking the rate, to filter out what can't be kept).
    reach: usize,
    /// PHASES rows of 2 * reach taps.
    table: Vec<f32>,
    passthrough: bool,
}

impl Resampler {
    pub fn new(from: u32, to: u32) -> Self {
        let step = f64::from(from) / f64::from(to);
        // Below 1 when the rate drops: the cutoff moves down to the new rate's Nyquist frequency.
        let cutoff = (1.0 / step).min(1.0) as f32;
        let reach = (HALF_TAPS as f32 / cutoff).ceil() as usize;
        let width = 2 * reach;
        let mut table = vec![0.0; PHASES * width];
        for phase in 0..PHASES {
            let fraction = phase as f32 / PHASES as f32;
            let row = &mut table[phase * width..(phase + 1) * width];
            for (tap, weight) in row.iter_mut().enumerate() {
                // Distance from the output point to input sample `tap` (taps run from 1 - reach to reach).
                let distance = tap as f32 + 1.0 - reach as f32 - fraction;
                let x = distance * cutoff;
                let sinc = if x.abs() < f32::EPSILON { 1.0 } else { (PI * x).sin() / (PI * x) };
                let window = 0.5 + 0.5 * (PI * distance / reach as f32).cos();
                *weight = cutoff * sinc * window;
            }
        }
        // Starts with silence before the first sample, so the opening is filtered like the rest.
        Resampler { step, position: reach as f64, history: vec![0.0; reach], reach, table, passthrough: from == to }
    }

    /// Feeds input samples; every output sample they complete goes to `out`.
    pub fn push(&mut self, input: &[f32], out: &mut dyn FnMut(f32)) {
        if self.passthrough {
            input.iter().for_each(|sample| out(*sample));
            return;
        }
        self.history.extend_from_slice(input);
        let width = 2 * self.reach;
        while (self.position as usize) + self.reach < self.history.len() {
            let whole = self.position as usize;
            let phase = (((self.position - whole as f64) * PHASES as f64) as usize).min(PHASES - 1);
            let taps = &self.table[phase * width..(phase + 1) * width];
            let window = &self.history[whole + 1 - self.reach..=whole + self.reach];
            out(window.iter().zip(taps).map(|(sample, weight)| sample * weight).sum());
            self.position += self.step;
        }
        // Keep only what the next output sample still reaches back to.
        let keep_from = (self.position as usize).saturating_sub(self.reach);
        self.history.drain(..keep_from);
        self.position -= keep_from as f64;
    }

    /// Pushes silence through, so the last real samples come out.
    pub fn finish(&mut self, out: &mut dyn FnMut(f32)) {
        if !self.passthrough {
            self.push(&vec![0.0; 2 * self.reach], out);
        }
    }
}

/// Resamples a decoded stream to one rate, following the source when its rate changes part-way (HE-AAC can).
pub struct Converter {
    to: u32,
    from: u32,
    resampler: Option<Resampler>,
}

impl Converter {
    pub fn new(to: u32) -> Self {
        Converter { to, from: 0, resampler: None }
    }

    /// Feeds samples at `rate`; every output sample they complete goes to `out`.
    pub fn push(&mut self, input: &[f32], rate: u32, out: &mut dyn FnMut(f32)) {
        if rate != self.from {
            if let Some(mut done) = self.resampler.take() {
                done.finish(out);
            }
            self.from = rate;
        }
        let to = self.to;
        self.resampler.get_or_insert_with(|| Resampler::new(rate, to)).push(input, out);
    }

    /// Lets the last samples out. False when no audio ever came in.
    pub fn finish(&mut self, out: &mut dyn FnMut(f32)) -> bool {
        let Some(mut resampler) = self.resampler.take() else {
            return false;
        };
        resampler.finish(out);
        true
    }
}

/// Whether `bytes` is an Ogg Opus file (a tape as stored), which symphonia can't decode.
pub fn is_ogg_opus(bytes: &[u8]) -> bool {
    bytes.starts_with(OGG_CAPTURE) && bytes.windows(OPUS_HEAD.len()).take(OGG_HEAD_SEARCH).any(|window| window == OPUS_HEAD)
}

/// Decodes an Ogg Opus file held in memory, handing `sink` mono samples at 48 kHz page by page. The encoder's delay
/// (the header's pre-skip) is dropped, as players do. A file cut short keeps the audio before the cut.
pub fn decode_ogg_opus(bytes: &[u8], sink: &mut Sink) -> Result<(), String> {
    let mut decoder: Option<(opus::Decoder, usize)> = None;
    let mut skip = 0usize;
    let mut packets = 0usize;
    let mut packet: Vec<u8> = Vec::new();
    let mut output = vec![0.0f32; MAX_OPUS_FRAME * MAX_OPUS_CHANNELS];
    let mut mono: Vec<f32> = Vec::new();
    let mut offset = 0usize;
    // Past the headers, running out of bytes is a recording cut short, not a broken file.
    let cut = |packets: usize| if packets > OPUS_HEADER_PACKETS { Ok(()) } else { Err(NOT_AUDIO.to_string()) };
    while offset < bytes.len() {
        let Some(header) = bytes.get(offset..offset + OGG_PAGE_HEADER) else {
            return cut(packets);
        };
        if !header.starts_with(OGG_CAPTURE) {
            return cut(packets);
        }
        let segments = usize::from(header[OGG_PAGE_HEADER - 1]);
        let Some(lacing) = bytes.get(offset + OGG_PAGE_HEADER..offset + OGG_PAGE_HEADER + segments) else {
            return cut(packets);
        };
        let mut body = offset + OGG_PAGE_HEADER + segments;
        for &lace in lacing {
            let lace = usize::from(lace);
            let Some(piece) = bytes.get(body..body + lace) else {
                return cut(packets);
            };
            packet.extend_from_slice(piece);
            body += lace;
            // A packet ends on a segment shorter than 255 bytes; a full one carries on into the next.
            if lace == OGG_SEGMENT_MAX {
                continue;
            }
            match packets {
                // OpusHead: channel count at byte 9, pre-skip at 10.
                0 => {
                    if !packet.starts_with(OPUS_HEAD) {
                        return Err(NOT_AUDIO.into());
                    }
                    let channels = usize::from(*packet.get(OPUS_HEAD_CHANNELS).ok_or(NOT_AUDIO)?).clamp(1, MAX_OPUS_CHANNELS);
                    skip = usize::from(u16::from_le_bytes([*packet.get(OPUS_HEAD_PRE_SKIP).ok_or(NOT_AUDIO)?, *packet.get(OPUS_HEAD_PRE_SKIP + 1).ok_or(NOT_AUDIO)?]));
                    let layout = if channels == 1 { opus::Channels::Mono } else { opus::Channels::Stereo };
                    decoder = Some((opus::Decoder::new(OPUS_RATE, layout).map_err(|error| error.to_string())?, channels));
                }
                // OpusTags: nothing the engine needs.
                1 => {}
                _ => {
                    let (opus, channels) = decoder.as_mut().ok_or(NOT_AUDIO)?;
                    // A damaged packet is skipped, as players do.
                    if let Ok(frames) = opus.decode_float(&packet, &mut output, false) {
                        mono.clear();
                        mono.extend(output[..frames * *channels].chunks_exact(*channels).map(|frame| frame.iter().sum::<f32>() / *channels as f32));
                        let dropped = skip.min(mono.len());
                        skip -= dropped;
                        if mono.len() > dropped && !sink(&mono[dropped..], OPUS_RATE) {
                            return Ok(());
                        }
                    }
                }
            }
            packets += 1;
            packet.clear();
        }
        offset = body;
    }
    Ok(())
}

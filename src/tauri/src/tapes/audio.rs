//! Audio plumbing for tapes, with no Tauri in it: decode a recording held in memory to mono samples as it goes
//! (symphonia), and change their sample rate on the fly (a small windowed-sinc resampler). Nothing here holds a whole
//! decoded file, so an hour-long recording takes no more memory than a short one.
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

/// Decodes `bytes` (MP3, M4A/AAC, WAV, FLAC or Ogg Vorbis; `extension` is a hint) and hands `sink` mono samples at
/// the file's own rate, one decoded packet at a time. Damaged packets are skipped, as players do.
pub fn decode_mono(bytes: Vec<u8>, extension: &str, sink: &mut dyn FnMut(&[f32], u32)) -> Result<(), String> {
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
        buffer.copy_to_vec_interleaved(&mut interleaved);
        mono.clear();
        mono.extend(interleaved.chunks_exact(channels).map(|frame| frame.iter().sum::<f32>() / channels as f32));
        if !mono.is_empty() {
            sink(&mono, rate);
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

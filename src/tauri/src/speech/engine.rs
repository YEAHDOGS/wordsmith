//! The listening loop of local speech, with no Tauri in it: 16 kHz mono audio comes in over a channel, a voice
//! activity model (Silero) finds where each utterance starts and ends, and the speech model turns each utterance into
//! text. Models that can stream report words while you are still speaking (`Event::Interim`); the others answer once
//! per utterance. Runs on its own thread, started by `speech_start` in mod.rs.
use std::collections::VecDeque;
use std::sync::mpsc::Receiver;

use transcribe_cpp::{Model, Result, RunOptions, Session, StreamOptions, VadSession};

/// Sample rate every model here takes.
pub const SAMPLE_RATE: usize = 16_000;
/// A frame at or above this speech probability starts an utterance.
const SPEECH_ON: f32 = 0.5;
/// Inside an utterance, a frame under this counts as silence.
const SPEECH_OFF: f32 = 0.35;
/// This much unbroken silence ends an utterance: long enough for a breath, short enough to feel live.
const END_SILENCE_MS: usize = 700;
/// Audio kept from just before speech was detected, so the first syllable isn't clipped.
const PRE_ROLL_MS: usize = 320;
/// A monologue with no pause is cut here and transcribed in pieces.
const MAX_UTTERANCE_MS: usize = 28_000;
/// Anything shorter is a click or a cough, not speech.
const MIN_UTTERANCE_MS: usize = 200;

/// What the microphone side sends in.
pub enum Input {
    Audio(Vec<f32>),
    Stop,
}

/// What the loop reports back.
pub enum Event {
    /// Speech started: an utterance is being heard.
    Speaking,
    /// The utterance so far (streaming models only); replaces the previous interim text.
    Interim(String),
    /// A finished utterance.
    Final(String),
}

enum Step {
    Start(Vec<f32>),
    Speech(Vec<f32>),
    End,
    Stop,
}

/// Cuts the incoming audio into utterances with the voice activity model, one model frame at a time.
struct Endpointer<'a> {
    vad: VadSession,
    input: &'a Receiver<Input>,
    frame: usize,
    /// Audio that doesn't fill a frame yet.
    carry: Vec<f32>,
    pre_roll: VecDeque<f32>,
    speaking: bool,
    silent_frames: usize,
    spoken_frames: usize,
    steps: VecDeque<Step>,
    stopped: bool,
}

impl<'a> Endpointer<'a> {
    fn new(vad_model: &Model, input: &'a Receiver<Input>) -> Result<Self> {
        let frame = vad_model.vad_info()?.frame_samples.max(1) as usize;
        Ok(Endpointer {
            vad: vad_model.vad_session()?,
            input,
            frame,
            carry: Vec::new(),
            pre_roll: VecDeque::new(),
            speaking: false,
            silent_frames: 0,
            spoken_frames: 0,
            steps: VecDeque::new(),
            stopped: false,
        })
    }

    fn frames(&self, ms: usize) -> usize {
        (ms * SAMPLE_RATE / 1000).div_ceil(self.frame)
    }

    /// The next step, waiting for audio when none is ready. A closed channel counts as Stop.
    fn next(&mut self) -> Result<Step> {
        loop {
            if let Some(step) = self.steps.pop_front() {
                return Ok(step);
            }
            if self.stopped {
                return Ok(Step::Stop);
            }
            match self.input.recv() {
                Ok(Input::Audio(audio)) => self.push(&audio)?,
                Ok(Input::Stop) | Err(_) => {
                    self.stopped = true;
                    if self.speaking {
                        self.speaking = false;
                        self.steps.push_back(Step::End);
                    }
                }
            }
        }
    }

    fn push(&mut self, audio: &[f32]) -> Result<()> {
        self.carry.extend_from_slice(audio);
        let mut offset = 0;
        while self.carry.len() - offset >= self.frame {
            let frame = self.carry[offset..offset + self.frame].to_vec();
            offset += self.frame;
            let probability = self.vad.stream_feed(&frame)?.probs.last().copied().unwrap_or(0.0);
            self.frame_scored(frame, probability);
        }
        self.carry.drain(..offset);
        Ok(())
    }

    fn frame_scored(&mut self, frame: Vec<f32>, probability: f32) {
        if !self.speaking {
            self.pre_roll.extend(frame);
            let keep = PRE_ROLL_MS * SAMPLE_RATE / 1000 + self.frame;
            let extra = self.pre_roll.len().saturating_sub(keep);
            self.pre_roll.drain(..extra);
            if probability >= SPEECH_ON {
                self.speaking = true;
                self.silent_frames = 0;
                self.spoken_frames = 0;
                self.steps.push_back(Step::Start(self.pre_roll.drain(..).collect()));
            }
            return;
        }
        self.steps.push_back(Step::Speech(frame));
        self.spoken_frames += 1;
        self.silent_frames = if probability < SPEECH_OFF { self.silent_frames + 1 } else { 0 };
        if self.silent_frames >= self.frames(END_SILENCE_MS) || self.spoken_frames >= self.frames(MAX_UTTERANCE_MS) {
            self.speaking = false;
            self.steps.push_back(Step::End);
        }
    }
}

/// Listens until `Input::Stop` (or the channel closes), reporting through `emit`. Speech still being heard when the
/// stop arrives is transcribed before this returns.
pub fn listen(model: &Model, vad_model: &Model, options: &RunOptions, input: &Receiver<Input>, emit: &mut dyn FnMut(Event)) -> Result<()> {
    let streaming = model.capabilities()?.supports_streaming;
    let mut session = model.session()?;
    let mut steps = Endpointer::new(vad_model, input)?;
    loop {
        let first = loop {
            match steps.next()? {
                Step::Start(audio) => break audio,
                Step::Stop => return Ok(()),
                Step::Speech(_) | Step::End => {}
            }
        };
        emit(Event::Speaking);
        let (text, stopped) = if streaming {
            stream_utterance(&mut session, options, first, &mut steps, emit)?
        } else {
            batch_utterance(&mut session, options, first, &mut steps)?
        };
        let text = text.trim();
        if !text.is_empty() {
            emit(Event::Final(text.to_string()));
        }
        if stopped {
            return Ok(());
        }
    }
}

/// One utterance through a streaming model. Returns its text and whether a Stop ended it.
fn stream_utterance(session: &mut Session, options: &RunOptions, first: Vec<f32>, steps: &mut Endpointer, emit: &mut dyn FnMut(Event)) -> Result<(String, bool)> {
    let mut stream = session.stream(options, &StreamOptions::default())?;
    let mut audio = first;
    let stopped = loop {
        if stream.feed(&audio)?.result_changed {
            emit(Event::Interim(stream.text().display().trim().to_string()));
        }
        match steps.next()? {
            Step::Speech(next) => audio = next,
            Step::End | Step::Start(_) => break false,
            Step::Stop => break true,
        }
    };
    stream.finalize()?;
    let text = stream.text();
    Ok((if text.full.trim().is_empty() { text.display() } else { text.full }, stopped))
}

/// One utterance through a model that takes whole clips. Returns its text and whether a Stop ended it.
fn batch_utterance(session: &mut Session, options: &RunOptions, first: Vec<f32>, steps: &mut Endpointer) -> Result<(String, bool)> {
    let mut audio = first;
    let stopped = loop {
        match steps.next()? {
            Step::Speech(next) => audio.extend(next),
            Step::End | Step::Start(_) => break false,
            Step::Stop => break true,
        }
    };
    if audio.len() < MIN_UTTERANCE_MS * SAMPLE_RATE / 1000 {
        return Ok((String::new(), stopped));
    }
    Ok((session.run(&audio, options)?.text, stopped))
}

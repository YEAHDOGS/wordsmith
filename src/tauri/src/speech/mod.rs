//! Local speech-to-text for the desktop apps: speech models run on this machine through transcribe.cpp (ggml), so
//! nothing you say leaves it. The web app drives everything from src/lib/speech.svelte.js:
//! - model files live in <app data>/speech/models. The WebView downloads them from Hugging Face and hands the bytes
//!   over in chunks (`speech_download_*`); the file only gets its real name once its SHA-256 matches the catalog.
//! - `speech_start` loads the chosen model (kept loaded between sessions until `speech_unload`) and starts the
//!   listening loop in engine.rs on its own thread; `speech_feed` passes it microphone audio (16 kHz mono f32, as the
//!   raw request body); results come back on the channel given to `speech_start`.
mod engine;

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::ipc::{Channel, InvokeBody, Request};
use tauri::{AppHandle, Manager, Runtime, State};
use transcribe_cpp::{Backend, Feature, Model, ModelOptions, RunOptions};

const MODELS_DIR: &str = "speech/models";
const MODEL_EXTENSION: &str = ".gguf";
/// A download in progress keeps this suffix until its checksum is verified.
const PARTIAL_EXTENSION: &str = ".part";
const MAX_FILE_NAME: usize = 128;
const BYTES_PER_SAMPLE: usize = 4;

/// What the listening thread reports to the web app.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SpeechEvent {
    /// The model is being read from disk.
    Loading,
    /// Ready and hearing the microphone. `backend` is where the model runs (CPU, Metal...).
    Listening { backend: String, streaming: bool },
    Speaking,
    Interim { text: String },
    Final { text: String },
    Stopped,
    Error { message: String },
}

struct Loaded {
    file: String,
    cpu_only: bool,
    model: Model,
}

struct Download {
    file: String,
    part: PathBuf,
    out: File,
    hash: Sha256,
    written: u64,
}

#[derive(Default)]
pub struct Speech {
    model: Mutex<Option<Loaded>>,
    vad: Mutex<Option<(String, Model)>>,
    /// The running listening session's audio input.
    input: Mutex<Option<Sender<engine::Input>>>,
    download: Mutex<Option<Download>>,
}

/// Adds the speech state and commands to the app.
pub fn register<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.manage(Speech::default()).invoke_handler(tauri::generate_handler![
        speech_models,
        speech_download_begin,
        speech_download_chunk,
        speech_download_finish,
        speech_download_cancel,
        speech_delete,
        speech_start,
        speech_feed,
        speech_stop,
        speech_unload,
    ])
}

/// A model file name from the web app, checked so it can only ever name a file inside the models folder.
fn safe_name(name: &str) -> Result<&str, String> {
    let plain = name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if plain && name.ends_with(MODEL_EXTENSION) && !name.starts_with('.') && name.len() <= MAX_FILE_NAME {
        return Ok(name);
    }
    Err(format!("Not a model file name: {name}"))
}

fn models_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?.join(MODELS_DIR);
    fs::create_dir_all(&dir).map_err(|error| format!("Could not create {}: {error}", dir.display()))?;
    Ok(dir)
}

/// The model files that finished downloading.
#[tauri::command]
fn speech_models<R: Runtime>(app: AppHandle<R>) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(models_dir(&app)?).map_err(|error| error.to_string())?;
    Ok(entries
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .filter(|name| name.ends_with(MODEL_EXTENSION))
        .collect())
}

/// Starts (or restarts) a download: the bytes that follow go to `<file>.part`.
#[tauri::command]
fn speech_download_begin<R: Runtime>(app: AppHandle<R>, state: State<'_, Speech>, file: String) -> Result<(), String> {
    let part = models_dir(&app)?.join(format!("{}{PARTIAL_EXTENSION}", safe_name(&file)?));
    let out = OpenOptions::new().write(true).create(true).truncate(true).open(&part).map_err(|error| error.to_string())?;
    let previous = state.download.lock().unwrap().replace(Download { file, part, out, hash: Sha256::new(), written: 0 });
    if let Some(previous) = previous {
        let _ = fs::remove_file(previous.part);
    }
    Ok(())
}

/// Appends the request body to the download. Returns the bytes written so far.
#[tauri::command]
fn speech_download_chunk(request: Request<'_>, state: State<'_, Speech>) -> Result<u64, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected bytes".into());
    };
    let mut guard = state.download.lock().unwrap();
    let download = guard.as_mut().ok_or("No download in progress")?;
    download.out.write_all(bytes).map_err(|error| format!("Could not write the model (disk full?): {error}"))?;
    download.hash.update(bytes);
    download.written += bytes.len() as u64;
    Ok(download.written)
}

/// Ends the download: the file is kept only if its SHA-256 is the one the catalog lists.
#[tauri::command]
fn speech_download_finish<R: Runtime>(app: AppHandle<R>, state: State<'_, Speech>, sha256: String) -> Result<(), String> {
    let download = state.download.lock().unwrap().take().ok_or("No download in progress")?;
    let Download { file, part, out, hash, .. } = download;
    out.sync_all().map_err(|error| error.to_string())?;
    drop(out);
    let actual: String = hash.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
    if !actual.eq_ignore_ascii_case(&sha256) {
        let _ = fs::remove_file(&part);
        return Err("The download was damaged on the way (checksum mismatch). Try again.".into());
    }
    fs::rename(&part, models_dir(&app)?.join(&file)).map_err(|error| error.to_string())
}

#[tauri::command]
fn speech_download_cancel(state: State<'_, Speech>) {
    if let Some(download) = state.download.lock().unwrap().take() {
        drop(download.out);
        let _ = fs::remove_file(download.part);
    }
}

/// Deletes a downloaded model, unloading it first if it is the one in memory.
#[tauri::command]
fn speech_delete<R: Runtime>(app: AppHandle<R>, state: State<'_, Speech>, file: String) -> Result<(), String> {
    let path = models_dir(&app)?.join(safe_name(&file)?);
    let mut loaded = state.model.lock().unwrap();
    if loaded.as_ref().is_some_and(|model| model.file == file) {
        *loaded = None;
    }
    fs::remove_file(path).map_err(|error| error.to_string())
}

/// The speech model, from memory when it is the one already loaded.
fn load_model(state: &Speech, dir: &PathBuf, file: &str, cpu_only: bool) -> Result<Model, String> {
    let mut loaded = state.model.lock().unwrap();
    if let Some(current) = loaded.as_ref().filter(|current| current.file == file && current.cpu_only == cpu_only) {
        return Ok(current.model.clone());
    }
    // Free the old model before reading the new one: two large models at once may not fit in memory.
    *loaded = None;
    let options = ModelOptions { backend: if cpu_only { Backend::Cpu } else { Backend::Auto }, ..Default::default() };
    let model = Model::load_with(dir.join(file), &options).map_err(|error| format!("Could not load {file}: {error}"))?;
    *loaded = Some(Loaded { file: file.to_string(), cpu_only, model: model.clone() });
    Ok(model)
}

/// The voice activity model. Tiny, so it always runs on the CPU and stays loaded.
fn load_vad(state: &Speech, dir: &PathBuf, file: &str) -> Result<Model, String> {
    let mut loaded = state.vad.lock().unwrap();
    if let Some((_, model)) = loaded.as_ref().filter(|(current, _)| current == file) {
        return Ok(model.clone());
    }
    let options = ModelOptions { backend: Backend::Cpu, ..Default::default() };
    let model = Model::load_with(dir.join(file), &options).map_err(|error| format!("Could not load {file}: {error}"))?;
    *loaded = Some((file.to_string(), model.clone()));
    Ok(model)
}

/// Starts listening. Returns at once; loading and everything heard is reported on `on_event`, ending with Stopped or Error.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn speech_start<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, Speech>,
    model: String,
    vad: String,
    cpu_only: bool,
    language: Option<String>,
    vocabulary: Vec<String>,
    on_event: Channel<SpeechEvent>,
) -> Result<(), String> {
    safe_name(&model)?;
    safe_name(&vad)?;
    let dir = models_dir(&app)?;
    let (sender, receiver) = channel();
    if let Some(previous) = state.input.lock().unwrap().replace(sender) {
        let _ = previous.send(engine::Input::Stop);
    }
    std::thread::spawn(move || {
        let state = app.state::<Speech>();
        let _ = on_event.send(SpeechEvent::Loading);
        let outcome = (|| -> Result<(), String> {
            let speech_model = load_model(&state, &dir, &model, cpu_only)?;
            let vad_model = load_vad(&state, &dir, &vad)?;
            let streaming = speech_model.capabilities().map_err(|error| error.to_string())?.supports_streaming;
            let options = RunOptions {
                language: language.filter(|code| !code.is_empty()),
                vocabulary: if speech_model.supports(Feature::Vocabulary) { vocabulary } else { Vec::new() },
                ..Default::default()
            };
            let _ = on_event.send(SpeechEvent::Listening { backend: speech_model.backend(), streaming });
            engine::listen(&speech_model, &vad_model, &options, &receiver, &mut |event| {
                let _ = on_event.send(match event {
                    engine::Event::Speaking => SpeechEvent::Speaking,
                    engine::Event::Interim(text) => SpeechEvent::Interim { text },
                    engine::Event::Final(text) => SpeechEvent::Final { text },
                });
            })
            .map_err(|error| error.to_string())
        })();
        let _ = on_event.send(match outcome {
            Ok(()) => SpeechEvent::Stopped,
            Err(message) => SpeechEvent::Error { message },
        });
    });
    Ok(())
}

/// Microphone audio for the running session: the request body is 16 kHz mono f32 samples, little endian.
#[tauri::command]
fn speech_feed(request: Request<'_>, state: State<'_, Speech>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected audio bytes".into());
    };
    let samples = bytes.chunks_exact(BYTES_PER_SAMPLE).map(|sample| f32::from_le_bytes([sample[0], sample[1], sample[2], sample[3]])).collect();
    if let Some(input) = state.input.lock().unwrap().as_ref() {
        let _ = input.send(engine::Input::Audio(samples));
    }
    Ok(())
}

/// Stops listening. Speech already heard is still transcribed and reported before Stopped.
#[tauri::command]
fn speech_stop(state: State<'_, Speech>) {
    if let Some(input) = state.input.lock().unwrap().take() {
        let _ = input.send(engine::Input::Stop);
    }
}

/// Frees the loaded models' memory. A session that is still listening keeps its own until it ends.
#[tauri::command]
fn speech_unload(state: State<'_, Speech>) {
    *state.model.lock().unwrap() = None;
    *state.vad.lock().unwrap() = None;
}

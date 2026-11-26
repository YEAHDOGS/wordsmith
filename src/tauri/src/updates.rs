//! In-app updates for the desktop apps (Windows, macOS, Linux), driven by src/lib/updates.svelte.js. The app asks
//! for `latest.json` on the newest GitHub release (the endpoint in tauri.conf.json), which the release job of
//! .github/workflows/build-apps.yml writes with each installer's signature. A newer version is downloaded in the
//! background and kept in memory, checked against the public key in tauri.conf.json, and installed only when you press
//! Restart: nothing interrupts what you are doing.
use std::sync::{Mutex, PoisonError};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const NOTHING_READY: &str = "No update has been downloaded yet";

/// The downloaded update waiting for a restart, and its bytes (already checked against the signature).
#[derive(Default)]
pub struct Updates {
    ready: Mutex<Option<(Update, Vec<u8>)>>,
}

/// A newer version, as the web app shows it.
#[derive(Clone, Serialize)]
pub struct Found {
    version: String,
    notes: String,
}

impl From<&Update> for Found {
    fn from(update: &Update) -> Self {
        Found { version: update.version.clone(), notes: update.body.clone().unwrap_or_default() }
    }
}

/// Looks for a newer version and downloads it, reporting progress (0 to 1) on `on_progress`. Returns it once it is
/// ready to install, or None when this is the newest. A version already downloaded isn't fetched again.
#[tauri::command]
pub async fn update_fetch<R: Runtime>(app: AppHandle<R>, state: State<'_, Updates>, on_progress: Channel<f64>) -> Result<Option<Found>, String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Ok(None);
    };
    if let Some((ready, _)) = state.ready.lock().unwrap_or_else(PoisonError::into_inner).as_ref().filter(|(ready, _)| ready.version == update.version) {
        return Ok(Some(Found::from(ready)));
    }
    let mut received: u64 = 0;
    let bytes = update
        .download(
            |chunk, total| {
                received += chunk as u64;
                if let Some(total) = total.filter(|total| *total > 0) {
                    let _ = on_progress.send(received as f64 / total as f64);
                }
            },
            || {},
        )
        .await
        .map_err(|error| error.to_string())?;
    let found = Found::from(&update);
    *state.ready.lock().unwrap_or_else(PoisonError::into_inner) = Some((update, bytes));
    Ok(Some(found))
}

/// Installs the downloaded update and restarts into it. On Windows the installer closes the app and opens the new
/// version itself; on macOS and Linux the app restarts once the files are in place.
#[tauri::command]
pub fn update_install<R: Runtime>(app: AppHandle<R>, state: State<'_, Updates>) -> Result<(), String> {
    let Some((update, bytes)) = state.ready.lock().unwrap_or_else(PoisonError::into_inner).take() else {
        return Err(NOTHING_READY.into());
    };
    update.install(&bytes).map_err(|error| error.to_string())?;
    app.restart()
}

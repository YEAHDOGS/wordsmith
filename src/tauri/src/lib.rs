#[cfg(desktop)]
mod speech;
#[cfg(desktop)]
mod tapes;
#[cfg(desktop)]
mod updates;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    // Local speech-to-text (src/speech/mod.rs), shrinking tapes (src/tapes/mod.rs) and in-app updates (src/updates.rs)
    // run on the desktop apps only. Tauri keeps a single command list, so every desktop command is registered here.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(speech::Speech::default())
        .manage(updates::Updates::default())
        .invoke_handler(tauri::generate_handler![
            speech::speech_models,
            speech::speech_download_begin,
            speech::speech_download_chunk,
            speech::speech_download_finish,
            speech::speech_download_cancel,
            speech::speech_delete,
            speech::speech_start,
            speech::speech_feed,
            speech::speech_stop,
            speech::speech_unload,
            tapes::tape_encode,
            updates::update_fetch,
            updates::update_install,
        ]);
    builder
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

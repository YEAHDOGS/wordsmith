#[cfg(desktop)]
mod speech;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    // Local speech-to-text runs on the desktop apps only (see src/speech/mod.rs).
    #[cfg(desktop)]
    let builder = speech::register(builder);
    builder
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

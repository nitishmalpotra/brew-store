mod brew;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            brew::brew_run,
            brew::brew_query,
            brew::brew_exists,
            brew::install_homebrew
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

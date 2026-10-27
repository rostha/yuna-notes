mod store;
use std::sync::Mutex;
use store::{Note, NoteInput, NoteStore};
use tauri::Manager;
type State = Mutex<NoteStore>;

#[tauri::command]
fn list_notes(state: tauri::State<'_, State>) -> Result<Vec<Note>, String> {
    state
        .lock()
        .map_err(|_| "Notebook is unavailable".to_string())?
        .list()
}
#[tauri::command]
fn create_note(state: tauri::State<'_, State>) -> Result<Note, String> {
    state
        .lock()
        .map_err(|_| "Notebook is unavailable".to_string())?
        .create()
}
#[tauri::command]
fn save_note(
    state: tauri::State<'_, State>,
    id: String,
    version: i64,
    input: NoteInput,
) -> Result<Note, String> {
    state
        .lock()
        .map_err(|_| "Notebook is unavailable".to_string())?
        .save(&id, version, input)
}
#[tauri::command]
fn delete_note(state: tauri::State<'_, State>, id: String, version: i64) -> Result<(), String> {
    state
        .lock()
        .map_err(|_| "Notebook is unavailable".to_string())?
        .delete(&id, version)
}
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let store = NoteStore::open(dir.join("notes.sqlite")).map_err(std::io::Error::other)?;
            app.manage(Mutex::new(store));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_notes,
            create_note,
            save_note,
            delete_note
        ])
        .run(tauri::generate_context!())
        .expect("Could not launch Yuna Notes");
}

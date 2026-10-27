use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub pinned: bool,
    pub version: i64,
    pub created_at: i64,
    pub updated_at: i64,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NoteInput {
    pub title: String,
    pub content: String,
    pub pinned: bool,
}
pub struct NoteStore {
    conn: Connection,
}
fn row_note(row: &Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        title: row.get(1)?,
        content: row.get(2)?,
        pinned: row.get(3)?,
        version: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}
fn db_error(error: rusqlite::Error) -> String {
    eprintln!("Notebook database error: {error}");
    "Unable to access the notebook. Your unsaved text is still in the editor.".into()
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn validate(input: &NoteInput) -> Result<(), String> {
    let title_len = input.title.trim().encode_utf16().count();
    if title_len == 0 || title_len > 200 {
        return Err("Use a title between 1 and 200 characters.".into());
    }
    if input.content.encode_utf16().count() > 100_000 {
        return Err("Keep each note under 100,000 characters.".into());
    }
    Ok(())
}
impl NoteStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(db_error)?;
        conn.busy_timeout(std::time::Duration::from_secs(3))
            .map_err(db_error)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL,pinned INTEGER NOT NULL CHECK(pinned IN (0,1)),version INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);").map_err(db_error)?;
        Ok(Self { conn })
    }
    pub fn list(&self) -> Result<Vec<Note>, String> {
        let mut stmt = self.conn.prepare("SELECT id,title,content,pinned,version,created_at,updated_at FROM notes ORDER BY pinned DESC,updated_at DESC,id").map_err(db_error)?;
        let rows = stmt.query_map([], row_note).map_err(db_error)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)
    }
    fn get(&self, id: &str) -> Result<Note, String> {
        self.conn.query_row("SELECT id,title,content,pinned,version,created_at,updated_at FROM notes WHERE id=?",[id],row_note).map_err(db_error)
    }
    pub fn create(&self) -> Result<Note, String> {
        let id = Uuid::new_v4().to_string();
        let time = now();
        self.conn
            .execute(
                "INSERT INTO notes VALUES (?,'Untitled note','',0,1,?,?)",
                params![id, time, time],
            )
            .map_err(db_error)?;
        self.get(&id)
    }
    pub fn save(&self, id: &str, version: i64, input: NoteInput) -> Result<Note, String> {
        validate(&input)?;
        let changed=self.conn.execute("UPDATE notes SET title=?,content=?,pinned=?,version=version+1,updated_at=? WHERE id=? AND version=?",params![input.title.trim(),input.content,input.pinned,now(),id,version]).map_err(db_error)?;
        if changed == 0 {
            return Err("This note changed or was deleted. Reopen it before saving; your current text is still here.".into());
        }
        self.get(id)
    }
    pub fn delete(&self, id: &str, version: i64) -> Result<(), String> {
        let changed = self
            .conn
            .execute(
                "DELETE FROM notes WHERE id=? AND version=?",
                params![id, version],
            )
            .map_err(db_error)?;
        if changed == 0 {
            return Err("This note changed or was deleted. Reopen it before deleting.".into());
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn input(title: &str) -> NoteInput {
        NoteInput {
            title: title.into(),
            content: "A useful idea".into(),
            pinned: true,
        }
    }
    #[test]
    fn saves_persists_and_deletes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.sqlite");
        let id;
        {
            let db = NoteStore::open(&path).unwrap();
            let n = db.create().unwrap();
            id = n.id.clone();
            let saved = db.save(&n.id, n.version, input("A real note")).unwrap();
            assert_eq!(saved.version, 2);
            assert!(saved.pinned);
        }
        let db = NoteStore::open(&path).unwrap();
        let notes = db.list().unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title, "A real note");
        db.delete(&id, 2).unwrap();
        assert!(db.list().unwrap().is_empty());
    }
    #[test]
    fn stale_updates_and_deletes_cannot_overwrite_new_data() {
        let db = NoteStore::open(":memory:").unwrap();
        let n = db.create().unwrap();
        db.save(&n.id, 1, input("New text")).unwrap();
        assert!(db.save(&n.id, 1, input("Stale text")).is_err());
        assert!(db.delete(&n.id, 1).is_err());
        assert_eq!(db.list().unwrap()[0].title, "New text");
    }
    #[test]
    fn validates_lengths_and_uses_bound_parameters() {
        let db = NoteStore::open(":memory:").unwrap();
        let n = db.create().unwrap();
        assert!(db.save(&n.id, 1, input("  ")).is_err());
        assert!(db.save(&n.id, 1, input(&"x".repeat(201))).is_err());
        assert!(db
            .save(
                &n.id,
                1,
                NoteInput {
                    title: "a".into(),
                    content: "x".repeat(100001),
                    pinned: false
                }
            )
            .is_err());
        let title = "Robert'); DROP TABLE notes;--";
        db.save(&n.id, 1, input(title)).unwrap();
        assert_eq!(db.list().unwrap()[0].title, title);
    }
}

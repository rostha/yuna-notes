import { useEffect, useRef, useState } from "react";
import { getRepository, type Repository } from "./storage";
import { sortNotes, type Note, type NoteInput } from "./types";
const fresh: NoteInput = { title: "", content: "", pinned: false };
function Mark() {
  return (
    <svg
      aria-hidden="true"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M5 4h14v16H5zM9 8h6M9 12h6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function App() {
  const [notes, setNotes] = useState<Note[]>([]),
    [selected, setSelected] = useState<Note | null>(null),
    [draft, setDraft] = useState<NoteInput>(fresh);
  const [query, setQuery] = useState(""),
    [view, setView] = useState<"all" | "pinned">("all"),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [desktop, setDesktop] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const repo = useRef<Repository | null>(null),
    titleRef = useRef<HTMLInputElement>(null),
    newNoteId = useRef<string | null>(null),
    mutationLock = useRef(false);
  const dirty =
    !!selected &&
    (draft.title !== selected.title ||
      draft.content !== selected.content ||
      draft.pinned !== selected.pinned);
  useEffect(() => {
    let active = true;
    getRepository()
      .then(async (r) => {
        const list = await r.repository.list();
        if (!active) return;
        repo.current = r.repository;
        setDesktop(r.desktop);
        setNotes(list);
        if (list[0]) {
          setSelected(list[0]);
          setDraft({
            title: list[0].title,
            content: list[0].content,
            pinned: list[0].pinned,
          });
        }
        setReady(true);
      })
      .catch((e) => {
        if (active) setError(String(e instanceof Error ? e.message : e));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    function unload(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const stop = await getCurrentWindow().onCloseRequested((event) => {
          if (
            (dirty || mutationLock.current) &&
            !window.confirm("You have unsaved work. Close without saving?")
          )
            event.preventDefault();
        });
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() =>
        setError(
          "Close protection is unavailable. Save your note before closing the window.",
        ),
      );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [desktop, dirty]);
  useEffect(() => {
    if (!busy && selected?.id === newNoteId.current) {
      titleRef.current?.focus();
      titleRef.current?.select();
      newNoteId.current = null;
    }
  }, [selected?.id, busy]);
  function mayLeave() {
    return !dirty || window.confirm("Discard your unsaved changes?");
  }
  function choose(note: Note) {
    if (busy || !mayLeave()) return;
    setSelected(note);
    setDraft({ title: note.title, content: note.content, pinned: note.pinned });
    setError("");
    setNotice("");
  }
  async function run(action: () => Promise<void>) {
    if (mutationLock.current || !repo.current) return;
    mutationLock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }
  async function create() {
    if (!mayLeave()) return;
    await run(async () => {
      const note = await repo.current!.create();
      newNoteId.current = note.id;
      setNotes((old) => sortNotes([note, ...old]));
      setSelected(note);
      setDraft({
        title: note.title,
        content: note.content,
        pinned: note.pinned,
      });
    });
  }
  async function save() {
    if (!selected || !dirty) return;
    const note = selected,
      input = draft;
    await run(async () => {
      const saved = await repo.current!.save(note, input);
      setNotes((old) =>
        sortNotes(old.map((n) => (n.id === saved.id ? saved : n))),
      );
      setSelected(saved);
      setDraft({
        title: saved.title,
        content: saved.content,
        pinned: saved.pinned,
      });
      setNotice("Saved on this device");
    });
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        if (ready && !busy) void create();
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  function exportNote() {
    if (!selected) return;
    const url = URL.createObjectURL(
      new Blob([`# ${draft.title}\n\n${draft.content}\n`], {
        type: "text/markdown;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download =
      (draft.title
        .replace(/[^a-zA-Z0-9 _-]/g, "")
        .trim()
        .slice(0, 80) || "note") + ".md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Markdown export created");
  }
  const visible = notes.filter(
    (n) =>
      (view === "all" || n.pinned) &&
      `${n.title} ${n.content}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="notebook">
      <aside className="sidebar">
        <a href="/" className="brand">
          <span>
            <Mark />
          </span>
          yuna<span className="brand-label">notes</span>
        </a>
        <button
          className="new-note"
          disabled={!ready || busy}
          onClick={() => void create()}
        >
          <span>＋</span> New note <kbd>⌘ / Ctrl N</kbd>
        </button>
        <label className="search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search notes"
            placeholder="Search your thoughts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <nav aria-label="Note filters">
          <button
            className={view === "all" ? "active" : ""}
            onClick={() => setView("all")}
            aria-pressed={view === "all"}
          >
            All notes <span>{notes.length}</span>
          </button>
          <button
            className={view === "pinned" ? "active" : ""}
            onClick={() => setView("pinned")}
            aria-pressed={view === "pinned"}
          >
            Pinned <span>{notes.filter((n) => n.pinned).length}</span>
          </button>
        </nav>
        <p className="section-label">YOUR PAGES</p>
        <div className="note-list">
          {visible.map((note) => (
            <button
              key={note.id}
              aria-label={`Open ${note.title}`}
              className={`note-preview ${selected?.id === note.id ? "selected" : ""}`}
              onClick={() => choose(note)}
              disabled={busy}
            >
              <span className="preview-title">
                {note.pinned ? (
                  <span className="pin-dot" aria-label="Pinned" />
                ) : null}
                {note.title}
              </span>
              <span className="preview-body">
                {note.content.replace(/\n/g, " ") ||
                  "A blank page, just for you."}
              </span>
              <span className="preview-date">
                {new Date(note.updatedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </button>
          ))}
          {ready && visible.length === 0 ? (
            <p className="list-empty">
              {query
                ? "No notes found."
                : view === "pinned"
                  ? "Pin a note to keep it close."
                  : "Your next idea starts here."}
            </p>
          ) : null}
        </div>
        <div className="storage-label">
          <span className="status-dot" />
          {desktop ? "Desktop · SQLite" : "Browser preview · local storage"}
        </div>
      </aside>
      <main className="main">
        <header className="editor-toolbar">
          <span className="breadcrumb">
            My notebook <span>/</span>{" "}
            {selected ? "A little space to think" : "Welcome"}
          </span>
          <div className="toolbar-actions">
            {selected ? (
              <>
                <button
                  onClick={exportNote}
                  disabled={busy}
                  className="text-button"
                >
                  Export .md ↗
                </button>
                <button
                  className="save"
                  disabled={!dirty || busy}
                  onClick={() => void save()}
                >
                  {busy ? "Saving…" : "Save note"}
                </button>
              </>
            ) : null}
          </div>
        </header>
        {error ? (
          <div className="error" role="alert">
            {error}
            {!ready ? (
              <button onClick={() => window.location.reload()}>Retry</button>
            ) : null}
          </div>
        ) : null}
        {!ready && !error ? (
          <p className="loading" role="status">
            Opening your notebook…
          </p>
        ) : null}
        {selected ? (
          <article className="page">
            <div className="page-meta">
              <span>PERSONAL NOTES</span>
              <button
                className={`pin-button ${draft.pinned ? "is-pinned" : ""}`}
                disabled={busy}
                aria-pressed={draft.pinned}
                onClick={() => setDraft({ ...draft, pinned: !draft.pinned })}
              >
                {draft.pinned ? "◆ Pinned" : "◇ Pin note"}
              </button>
            </div>
            <input
              ref={titleRef}
              className="note-title"
              aria-label="Note title"
              placeholder="Untitled note"
              maxLength={200}
              value={draft.title}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <p className="date-line">
              Last edited{" "}
              {new Date(selected.updatedAt).toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
              <span className={dirty ? "unsaved" : ""}>
                {dirty ? "● Unsaved changes" : "✓ Saved"}
              </span>
            </p>
            <textarea
              className="note-content"
              aria-label="Note content"
              placeholder="Let the idea unfold. Plain text and Markdown are welcome here…"
              maxLength={100000}
              value={draft.content}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            />
            <footer className="page-footer">
              <span>
                {draft.content.trim()
                  ? draft.content.trim().split(/\s+/).length
                  : 0}{" "}
                words <span>·</span> {draft.content.length.toLocaleString()}{" "}
                characters
              </span>
              <button
                className="delete"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete “${selected.title}”? This cannot be undone.`,
                    )
                  ) {
                    const current = selected;
                    void run(async () => {
                      await repo.current!.remove(current);
                      const remaining = await repo.current!.list();
                      setNotes(remaining);
                      setSelected(remaining[0] || null);
                      setDraft(
                        remaining[0]
                          ? {
                              title: remaining[0].title,
                              content: remaining[0].content,
                              pinned: remaining[0].pinned,
                            }
                          : fresh,
                      );
                    });
                  }
                }}
              >
                Delete note
              </button>
            </footer>
          </article>
        ) : ready ? (
          <section className="welcome">
            <div className="welcome-mark">
              <Mark />
            </div>
            <p className="section-label">A QUIETER CORNER</p>
            <h1>
              Good ideas need
              <br />
              <em>a little room.</em>
            </h1>
            <p>
              Capture the thought. Keep it close.
              <br />
              Your notes stay on your device.
            </p>
            <button
              className="save"
              onClick={() => void create()}
              disabled={busy}
            >
              Write your first note ＋
            </button>
          </section>
        ) : null}
        <div className="notice" role="status" aria-live="polite">
          {notice}
        </div>
      </main>
    </div>
  );
}

import { type Note, type NoteInput, sortNotes, validateInput } from "./types";
export interface Repository {
  list(): Promise<Note[]>;
  create(): Promise<Note>;
  save(note: Note, input: NoteInput): Promise<Note>;
  remove(note: Note): Promise<void>;
}
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const KEY = "yuna-notes:v1";
async function withWriteLock<T>(work: () => T): Promise<T> {
  // Serialize preview writes across tabs when the browser supports Web Locks.
  if (typeof window !== "undefined" && navigator.locks)
    return navigator.locks.request(KEY, async () => work());
  return work();
}
export function browserRepository(storage: StoragePort): Repository {
  function read(): Note[] {
    const raw = storage.getItem(KEY);
    if (!raw) return [];
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        "Saved notes could not be read. Browser storage has been left unchanged.",
      );
    }
    if (
      !Array.isArray(data) ||
      data.some(
        (n) =>
          !n ||
          typeof n.id !== "string" ||
          typeof n.title !== "string" ||
          typeof n.content !== "string" ||
          typeof n.pinned !== "boolean" ||
          !Number.isInteger(n.version) ||
          n.version < 1 ||
          !Number.isFinite(n.createdAt) ||
          !Number.isFinite(n.updatedAt),
      )
    )
      throw new Error(
        "Unsupported saved notes. Browser storage has been left unchanged.",
      );
    return data as Note[];
  }
  function write(notes: Note[]) {
    try {
      storage.setItem(KEY, JSON.stringify(notes));
    } catch {
      throw new Error(
        "Unable to save: browser storage is full or unavailable. Copy your text before closing.",
      );
    }
  }
  function current(note: Note, notes: Note[]) {
    const found = notes.find((n) => n.id === note.id);
    if (!found) throw new Error("This note was deleted in another tab.");
    if (found.version !== note.version)
      throw new Error(
        "This note changed in another tab. Reopen it before saving; your current text is still here.",
      );
    return found;
  }
  return {
    async list() {
      return sortNotes(read());
    },
    async create() {
      return withWriteLock(() => {
        const notes = read(),
          now = Date.now();
        const note: Note = {
          id: crypto.randomUUID(),
          title: "Untitled note",
          content: "",
          pinned: false,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        write([...notes, note]);
        return note;
      });
    },
    async save(note, input) {
      return withWriteLock(() => {
        const p = validateInput(input),
          notes = read();
        current(note, notes);
        const updated = {
          ...note,
          ...p,
          version: note.version + 1,
          updatedAt: Date.now(),
        };
        write(notes.map((n) => (n.id === note.id ? updated : n)));
        return updated;
      });
    },
    async remove(note) {
      return withWriteLock(() => {
        const notes = read();
        current(note, notes);
        write(notes.filter((n) => n.id !== note.id));
      });
    },
  };
}
export async function getRepository(): Promise<{
  repository: Repository;
  desktop: boolean;
}> {
  const { isTauri, invoke } = await import("@tauri-apps/api/core");
  if (isTauri())
    return {
      desktop: true,
      repository: {
        list: () => invoke("list_notes"),
        create: () => invoke("create_note"),
        save: (note, input) =>
          invoke("save_note", {
            id: note.id,
            version: note.version,
            input: validateInput(input),
          }),
        remove: (note) =>
          invoke("delete_note", { id: note.id, version: note.version }),
      },
    };
  return { desktop: false, repository: browserRepository(localStorage) };
}

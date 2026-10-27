export interface Note {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
}
export interface NoteInput {
  title: string;
  content: string;
  pinned: boolean;
}
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      b.updatedAt - a.updatedAt ||
      a.id.localeCompare(b.id),
  );
}
export function validateInput(input: NoteInput): NoteInput {
  if (
    typeof input.title !== "string" ||
    typeof input.content !== "string" ||
    typeof input.pinned !== "boolean"
  )
    throw new Error("Invalid note.");
  const title = input.title.trim();
  if (!title || title.length > 200)
    throw new Error("Use a title between 1 and 200 characters.");
  if (input.content.length > 100000)
    throw new Error("Keep each note under 100,000 characters.");
  return { title, content: input.content, pinned: input.pinned };
}

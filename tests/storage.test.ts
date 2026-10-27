import { test } from "node:test";
import assert from "node:assert/strict";
import { browserRepository } from "../src/storage";
import { sortNotes, validateInput } from "../src/types";
function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}
test("browser preview CRUD persists across repository instances", async () => {
  const storage = memory(),
    repo = browserRepository(storage);
  assert.deepEqual(await repo.list(), []);
  const note = await repo.create();
  const updated = await repo.save(note, {
    title: "  A thought  ",
    content: "Hello",
    pinned: true,
  });
  assert.equal(updated.title, "A thought");
  assert.equal(updated.version, 2);
  const reopened = browserRepository(storage);
  assert.equal((await reopened.list())[0].content, "Hello");
  await reopened.remove(updated);
  assert.deepEqual(await repo.list(), []);
});
test("stale edits and deletes preserve a newer version", async () => {
  const repo = browserRepository(memory()),
    note = await repo.create();
  await repo.save(note, { title: "New", content: "keep", pinned: false });
  await assert.rejects(
    repo.save(note, { title: "Old", content: "lost", pinned: false }),
    /another tab/,
  );
  await assert.rejects(repo.remove(note), /another tab/);
  assert.equal((await repo.list())[0].content, "keep");
});
test("storage corruption and quota failures never silently discard data", async () => {
  const store = memory();
  store.setItem("yuna-notes:v1", "not json");
  await assert.rejects(browserRepository(store).list(), /left unchanged/);
  assert.equal(store.getItem("yuna-notes:v1"), "not json");
  const full = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  await assert.rejects(browserRepository(full).create(), /storage is full/);
});
test("validates content limits and orders pins first without mutating input", () => {
  assert.throws(() =>
    validateInput({ title: " ", content: "", pinned: false }),
  );
  assert.throws(() =>
    validateInput({ title: "x".repeat(201), content: "", pinned: false }),
  );
  assert.throws(() =>
    validateInput({ title: "x", content: "x".repeat(100001), pinned: false }),
  );
  const a = {
      id: "a",
      title: "A",
      content: "",
      pinned: false,
      version: 1,
      createdAt: 1,
      updatedAt: 9,
    },
    b = { ...a, id: "b", pinned: true, updatedAt: 1 };
  const list = [a, b];
  assert.equal(sortNotes(list)[0].id, "b");
  assert.equal(list[0].id, "a");
});

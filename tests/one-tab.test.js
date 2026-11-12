import { test, eq } from "./run.js";
import { createOneTab } from "../assets/one-tab.js";

// the browser's storage shared by the windows of one site
function shared() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test("a newer window takes the trainer: the older one steps aside on its next check", () => {
  const storage = shared();
  const seen = [];
  const a = createOneTab({ storage, onTakenOver: () => seen.push("a") });
  eq(a.check(), true, "alone, it works");
  const b = createOneTab({ storage, onTakenOver: () => seen.push("b") });
  eq([a.check(), b.check(), a.passive(), seen], [false, true, true, ["a"]]);
  a.check();
  eq(seen, ["a"], "told once");
});

test("no message is needed: a window that slept through the takeover learns it before it writes", () => {
  const storage = shared();
  const a = createOneTab({ storage });
  createOneTab({ storage });            // opened while the first one was asleep in the background
  eq(a.check(), false);
});

test("the window stepped aside takes the trainer back when asked", () => {
  const storage = shared();
  const a = createOneTab({ storage });
  const b = createOneTab({ storage });
  a.check();
  a.claim();
  eq([a.check(), b.check(), b.passive()], [true, false, true]);
});

test("another window taking over is noticed from the storage event at once", () => {
  const storage = shared();
  let told = 0;
  const a = createOneTab({ storage, onTakenOver: () => told++ });
  const b = createOneTab({ storage });
  a.onStorage({ key: a.key, newValue: storage.getItem(a.key) });
  eq([a.passive(), told, b.passive()], [true, 1, false]);
});

test("without storage (private mode) a window just works", () => {
  const broken = { getItem: () => { throw new Error("no storage"); }, setItem: () => { throw new Error("no storage"); } };
  const a = createOneTab({ storage: broken });
  eq(a.check(), true);
});

import { test, eq } from "./run.js";
import { createOneTab } from "../assets/one-tab.js";

const tick = () => new Promise((r) => setTimeout(r, 20));
// BroadcastChannel goes through the browser between windows; here the windows share a bus in memory
function bus() {
  const all = new Set();
  return () => {
    const me = { listeners: [], addEventListener: (_, f) => me.listeners.push(f), close: () => all.delete(me),
      postMessage: (data) => { for (const o of all) if (o !== me) queueMicrotask(() => o.listeners.forEach((f) => f({ data }))); } };
    all.add(me);
    return me;
  };
}

test("a newer window of the trainer makes the older one step aside", async () => {
  const open = bus();
  const seen = [];
  const a = createOneTab({ open, onTakenOver: () => seen.push("a") });
  await tick();
  const b = createOneTab({ open, onTakenOver: () => seen.push("b") });
  await tick();
  eq([a.passive(), b.passive(), seen], [true, false, ["a"]]);
  a.close(); b.close();
});

test("the window stepped aside takes over again when asked", async () => {
  const open = bus();
  const a = createOneTab({ open });
  await tick();
  const b = createOneTab({ open });
  await tick();
  a.claim();
  await tick();
  eq([a.passive(), b.passive()], [false, true]);
  a.close(); b.close();
});

test("one window alone stays active", async () => {
  const a = createOneTab({ open: bus() });
  await tick();
  eq(a.passive(), false);
  a.close();
});

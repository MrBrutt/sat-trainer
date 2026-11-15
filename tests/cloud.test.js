import { test, eq } from "./run.js";
import { makeAdapter } from "../assets/cloud.js";
import { joinCopies } from "../assets/account.js";

// Firestore as the adapter uses it: documents by path, server reads, transactions, listeners.
function fakeFirestore() {
  const docs = new Map();
  const subs = [];
  const snap = (p) => { const d = docs.get(p); return { exists: () => !!d, data: () => d, metadata: { hasPendingWrites: false, fromCache: false } }; };
  const notify = (p) => { for (const s of subs) if (s.path === p) setTimeout(() => s.cb(snap(p))); };
  const put = (p, value) => { docs.set(p, { json: JSON.stringify(value), at: 0 }); notify(p); };
  const F = {
    doc: (db, ...path) => ({ path: path.join("/") }),
    getDocFromServer: async (ref) => snap(ref.path),
    setDoc: async (ref, data) => { docs.set(ref.path, data); notify(ref.path); },
    serverTimestamp: () => 0,
    runTransaction: async (db, fn) => {
      const writes = [];
      const res = await fn({ get: async (ref) => snap(ref.path), set: (ref, data) => writes.push([ref.path, data]) });
      for (const [p, d] of writes) { docs.set(p, d); notify(p); }
      return res;
    },
    onSnapshot: (ref, cb) => { const s = { path: ref.path, cb }; subs.push(s); return () => subs.splice(subs.indexOf(s), 1); },
  };
  const read = (p) => (docs.has(p) ? JSON.parse(docs.get(p).json) : undefined);
  return { F, put, read };
}
const tick = () => new Promise((r) => setTimeout(r, 10));

test("the new code sees what a page from before 12 November wrote to the old place", async () => {
  const fs = fakeFirestore();
  fs.put("users/u1/sync/progress", { q1: { t: 1 } });
  fs.put("users/u1/state/progress", { q2: { t: 2 } });          // the old page's answer
  const a = makeAdapter(fs.F, null, "u1", joinCopies);
  eq(await a.get("progress"), { q1: { t: 1 }, q2: { t: 2 } });
});

test("a write goes to both places, so an old page sees it too", async () => {
  const fs = fakeFirestore();
  fs.put("users/u1/state/progress", { q2: { t: 2 } });
  const a = makeAdapter(fs.F, null, "u1", joinCopies);
  const res = await a.update("progress", (latest) => ({ ...latest, q3: { t: 3 } }));
  const all = { q2: { t: 2 }, q3: { t: 3 } };
  eq([fs.read("users/u1/sync/progress"), fs.read("users/u1/state/progress"), res.remote], [all, all, { q2: { t: 2 } }]);
});

test("an old page writing later is heard, joined with the new copy", async () => {
  const fs = fakeFirestore();
  fs.put("users/u1/sync/progress", { q1: { t: 1 } });
  const a = makeAdapter(fs.F, null, "u1", joinCopies);
  await a.get("progress");
  const heard = [];
  a.watch("progress", (v) => heard.push(v));
  await tick();
  fs.put("users/u1/state/progress", { q9: { t: 9 } });           // the old page answers a question
  await tick();
  eq(heard[heard.length - 1], { q1: { t: 1 }, q9: { t: 9 } });
});

test("nothing new to write leaves both places as they are", async () => {
  const fs = fakeFirestore();
  const same = { q1: { t: 1 } };
  fs.put("users/u1/sync/progress", same); fs.put("users/u1/state/progress", same);
  const a = makeAdapter(fs.F, null, "u1", joinCopies);
  const res = await a.update("progress", () => undefined);
  eq([res.value, fs.read("users/u1/sync/progress"), fs.read("users/u1/state/progress")], [undefined, same, same]);
});

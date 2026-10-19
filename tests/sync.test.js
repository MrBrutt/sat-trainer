import { test, eq } from "./run.js";
import { createSync } from "../assets/sync.js";
import { mergeMap, newer } from "../assets/merge.js";

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5)); };

// The account: one store, every device watching it. A writer does not hear its own write back
// (the real adapter drops Firestore's local echo); `hold` keeps writes unconfirmed and unsaved.
function fakeAccount() {
  const store = {};
  const watchers = [];
  const account = {
    store, hold: false,
    adapter() {
      const me = {};
      return {
        get: async (name) => clone(store[name]),
        set: (name, v) => {
          if (account.hold) return new Promise(() => {});
          store[name] = clone(v);
          for (const w of watchers) if (w.name === name && w.from !== me) setTimeout(() => w.cb(clone(v)));
          return Promise.resolve();
        },
        watch: (name, cb) => { const w = { name, cb, from: me }; watchers.push(w); return () => watchers.splice(watchers.indexOf(w), 1); },
        online: () => true,
      };
    },
  };
  return account;
}

// A device: its own answers and its own record of what was last agreed with the account.
function device(account, progress = {}, kept = new Map()) {
  const dev = { progress, kept };
  dev.sync = createSync({
    adapter: account.adapter(),
    sections: { progress: { read: () => dev.progress, apply: (v) => { dev.progress = v; }, merge: (b, l, r) => mergeMap(b, l, r, newer((x) => x.t)) } },
    base: { get: (n) => clone(kept.get(n)), set: (n, v) => kept.set(n, clone(v)) },
    delay: 0,
  });
  return dev;
}

test("first sync unions both devices", async () => {
  const acc = fakeAccount();
  const a = device(acc, { q1: { c: "A", t: 1 } });
  const b = device(acc, { q2: { c: "B", t: 2 } });
  await a.sync.start();
  await b.sync.start();
  await settle();
  const both = { q1: { c: "A", t: 1 }, q2: { c: "B", t: 2 } };
  eq(acc.store.progress, both, "account");
  eq(a.progress, both, "device A");
  eq(b.progress, both, "device B");
});

test("an answer on device A appears on B", async () => {
  const acc = fakeAccount();
  const a = device(acc), b = device(acc);
  await a.sync.start(); await b.sync.start();
  a.progress = { ...a.progress, q3: { c: "C", t: 3 } };
  a.sync.notify("progress");
  await settle();
  eq(b.progress, { q3: { c: "C", t: 3 } });
});

test("deletion on one device reaches the other", async () => {
  const acc = fakeAccount();
  const a = device(acc, { q1: { c: "A", t: 1 }, q2: { c: "B", t: 2 } });
  const b = device(acc);
  await a.sync.start(); await b.sync.start(); await settle();
  a.progress = {};                 // "Сбросить прогресс"
  a.sync.notify("progress");
  await settle();
  eq(acc.store.progress, {}, "account");
  eq(b.progress, {}, "device B");
});

test("unconfirmed write is pushed again on next start", async () => {
  const acc = fakeAccount();
  const kept = new Map();
  const a = device(acc, {}, kept);
  await a.sync.start(); await settle();
  acc.hold = true;                 // offline: the write never reaches the account
  a.progress = { q1: { c: "A", t: 5 } };
  a.sync.notify("progress");
  await settle();
  a.sync.stop();                   // the page is closed
  acc.hold = false;
  const again = device(acc, a.progress, kept);
  await again.sync.start(); await settle();
  eq(acc.store.progress, { q1: { c: "A", t: 5 } });
});

test("both devices answer the same question — the later answer wins on both", async () => {
  const acc = fakeAccount();
  const a = device(acc), b = device(acc);
  await a.sync.start(); await b.sync.start(); await settle();
  acc.hold = true;
  a.progress = { q1: { c: "A", t: 10 } }; a.sync.notify("progress");
  b.progress = { q1: { c: "B", t: 20 } }; b.sync.notify("progress");
  await settle();
  a.sync.stop(); b.sync.stop();
  acc.hold = false;
  const a2 = device(acc, a.progress, a.kept), b2 = device(acc, b.progress, b.kept);
  await a2.sync.start(); await b2.sync.start(); await settle();
  eq(a2.progress, { q1: { c: "B", t: 20 } }, "device A");
  eq(b2.progress, { q1: { c: "B", t: 20 } }, "device B");
});

test("status goes saving → saved around a write", async () => {
  const acc = fakeAccount();
  const seen = [];
  const dev = { progress: { q1: { t: 1 } } };
  const sync = createSync({
    adapter: acc.adapter(),
    sections: { progress: { read: () => dev.progress, apply: (v) => { dev.progress = v; }, merge: (b, l, r) => mergeMap(b, l, r, newer((x) => x.t)) } },
    base: { get: () => undefined, set: () => {} },
    onStatus: (s) => seen.push(s),
    delay: 0,
  });
  await sync.start(); await settle();
  eq(seen.includes("saving"), true, "saving reported");
  eq(seen[seen.length - 1], "saved", "last status");
});

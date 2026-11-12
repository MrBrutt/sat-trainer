import { test, eq } from "./run.js";
import { MERGE } from "../assets/account.js";

test("vocab: a card reviewed on both devices keeps the later review; other fields merge on their own", () => {
  const b = { srs: { cogent: { last: 1, ivl: 1 } }, known: ["apple"], level: "middle", user: {}, edits: {} };
  const l = { srs: { cogent: { last: 9, ivl: 3 } }, known: ["apple", "table"], level: "middle", user: {}, edits: {} };
  const r = { srs: { cogent: { last: 5, ivl: 4 }, terse: { last: 6, ivl: 1 } }, known: [], level: "test", user: {}, edits: {} };
  eq(MERGE.vocab(b, l, r), {
    srs: { cogent: { last: 9, ivl: 3 }, terse: { last: 6, ivl: 1 } },
    known: ["table"], level: "test", user: {}, edits: {},
  });
});

test("vocab: the newer size test result wins", () => {
  const b = { test: { at: 1, size: 8000 } };
  eq(MERGE.vocab(b, { test: { at: 3, size: 9900 } }, { test: { at: 2, size: 9000 } }).test, { at: 3, size: 9900 });
});

test("vocab: first sign-in with an empty account keeps everything on the device", () => {
  const l = { srs: { a: { last: 1 } }, known: ["x"], level: "test", daily: { date: "d", newCount: 3 } };
  eq(MERGE.vocab(undefined, l, undefined), l);
});

test("activity: a day studied on both devices keeps the larger counts", () => {
  const b = { days: {} };
  const l = { days: { "2026-10-19": { q: 5, ok: 4, w: 10 } }, bestRun: 3, unlocked: ["a"] };
  const r = { days: { "2026-10-19": { q: 2, ok: 2, w: 30, closed: true } }, bestRun: 7, unlocked: ["b"] };
  eq(MERGE.activity(b, l, r), { days: { "2026-10-19": { q: 5, ok: 4, w: 30, closed: true } }, bestRun: 7, unlocked: ["a", "b"] });
});

test("flags: unflagging on one device reaches the account", () => {
  eq(MERGE.flags(["q1", "q2"], ["q2"], ["q1", "q2"]), ["q2"]);
});

import { syncSources } from "../assets/account.js";

const want = { list: { s1: { fileName: "a.pdf", importedAt: 1 } }, numbers: { q1: 1, q2: 2 } };

test("sources wait for a missing pdf, then build the questions once it arrives", async () => {
  const installs = [];
  const install = async (list, numbers) => { installs.push({ ids: list.map((s) => s.id), numbers }); };
  eq(await syncSources(want, { ids: [], numbers: {} }, async () => null, install), "waiting", "pdf not uploaded yet");
  eq(installs.length, 0, "nothing built while waiting");
  eq(await syncSources(want, { ids: [], numbers: {} }, async () => new Uint8Array([1]), install), "done", "pdf arrived");
  eq(installs, [{ ids: ["s1"], numbers: { q1: 1, q2: 2 } }]);
});

test("sources already in place do nothing", async () => {
  let built = false;
  eq(await syncSources(want, { ids: ["s1"], numbers: { q1: 1, q2: 2 } }, async () => new Uint8Array([1]), async () => { built = true; }), "same");
  eq(built, false);
});

test("an account without sources leaves the device's questions alone", async () => {
  let built = false;
  const install = async () => { built = true; };
  eq(await syncSources(undefined, { ids: ["s1"], numbers: {} }, async () => null, install), "same");
  eq(await syncSources({ list: {}, numbers: {} }, { ids: ["s1"], numbers: {} }, async () => null, install), "same");
  eq(built, false);
});

test("new question numbers from the account rebuild the set", async () => {
  let got = null;
  eq(await syncSources(want, { ids: ["s1"], numbers: { q1: 2, q2: 1 } }, async () => new Uint8Array([1]), async (list, numbers) => { got = numbers; }), "done");
  eq(got, { q1: 1, q2: 2 });
});

test("numbers the account keeps for questions not on this device do not rebuild the set", async () => {
  let built = false;
  const more = { list: want.list, numbers: { q1: 1, q2: 2, q9: 9 } };
  eq(await syncSources(more, { ids: ["s1"], numbers: { q1: 1, q2: 2 } }, async () => new Uint8Array([1]), async () => { built = true; }), "same");
  eq(built, false);
});

test("the same PDF loaded on two devices does not rebuild the set over and over", async () => {
  // both copies were built in; the questions came from s2, so s1 is no longer a source of the set
  const two = { list: { s1: { importedAt: 1 }, s2: { importedAt: 2 } }, numbers: { q1: 1 } };
  let built = false;
  eq(await syncSources(two, { ids: ["s2"], covered: ["s1", "s2"], numbers: { q1: 1 } }, async () => new Uint8Array([1]), async () => { built = true; }), "same");
  eq(built, false);
});

test("a PDF removed in the account is removed here", async () => {
  let got = null;
  const one = { list: { s2: { importedAt: 2 } }, numbers: { q1: 1 } };
  eq(await syncSources(one, { ids: ["s1", "s2"], covered: ["s1", "s2"], numbers: { q1: 1 } }, async () => new Uint8Array([1]), async (list) => { got = list.map((s) => s.id); }), "done");
  eq(got, ["s2"]);
});

test("a device that has not read its questions yet does not drop the list of PDFs", () => {
  const list = { list: { s1: { importedAt: 1 } }, numbers: { q1: 1 } };
  eq(MERGE.sources(list, undefined, list), list);
});

import { createAccount } from "../assets/account.js";

function accountWith(cloud, more = {}) {
  const stored = new Map();
  const box = (v) => ({ read: () => v, write: (x) => { v = x; } });
  return createAccount({
    ls: { get: (k, d) => (stored.has(k) ? JSON.parse(stored.get(k)) : d), set: (k, v) => stored.set(k, JSON.stringify(v)), del: (k) => stored.delete(k) },
    icon: () => "", esc: (s) => s, toast: () => {},
    data: { progress: box({}), review: box({}), flags: box([]), vocab: box({ srs: {}, known: [] }), activity: box({ days: {} }) },
    sets: {
      current: () => ({ list: { s1: { fileName: "a.pdf", importedAt: 1 } }, numbers: { q1: 1 } }),
      have: () => ({ ids: ["s1"], covered: ["s1"], numbers: { q1: 1 } }),
      stored: async () => new Uint8Array([1]), store: async () => {}, install: async () => {},
    },
    changed: () => {},
    openCloud: async () => cloud,
    ...more,
  });
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
function cloudWith({ get, set }) {
  let tell = null;
  return {
    onUser: (cb) => { tell = cb; },
    signIn: async () => { const user = { uid: "u1", email: "" }; await tell(user); return { user }; },
    signOut: async () => tell(null),
    adapter: () => ({ get, set, watch: () => () => {}, online: () => true }),
    hasPdf: async () => true, putPdf: async () => {}, getPdf: async () => null,
  };
}

test("a start that failed while online is tried again, with no change of connection", async () => {
  const store = {};
  let fails = 1;
  const cloud = cloudWith({
    get: async (n) => { if (fails > 0) { fails--; throw new Error("Failed to get document because the client is offline."); } return store[n]; },
    set: async (n, v) => { store[n] = v; },
  });
  const account = accountWith(cloud, { retryMs: [5] });
  await account.actions["sign-in"]();
  for (let i = 0; i < 40 && store.progress === undefined; i++) await tick();
  eq(store.progress, {}, "synced after the retry");
  await cloud.signOut();
});

test("the sync chip names the part that failed and the reason", async () => {
  const cloud = cloudWith({
    get: async () => undefined,
    set: async (n) => { if (n === "flags") { const e = new Error("Missing or insufficient permissions."); e.code = "permission-denied"; throw e; } },
  });
  const account = accountWith(cloud, { retryMs: [60_000] });
  await account.actions["sign-in"]();
  for (let i = 0; i < 20 && !/error/.test(account.chip()); i++) await tick();
  const chip = account.chip();
  eq([/flags/.test(chip), /permission-denied/.test(chip)], [true, true]);
  await cloud.signOut();
});


test("a PDF upload that failed is tried again when the connection is back", async () => {
  const store = {};
  let tell = null, broken = true, uploads = 0;
  const cloud = {
    onUser: (cb) => { tell = cb; },
    signIn: async () => { const user = { uid: "u1", email: "" }; await tell(user); return { user }; },
    signOut: async () => tell(null),
    adapter: () => ({ get: async (n) => store[n], set: async (n, v) => { store[n] = v; }, watch: () => () => {}, online: () => true }),
    hasPdf: async () => uploads > 0,
    putPdf: async () => { if (broken) throw new Error("no connection"); uploads++; },
    getPdf: async () => null,
  };
  const account = accountWith(cloud);
  await account.actions["sign-in"]();
  eq(store.sources, undefined, "the list waits for its PDF");
  broken = false;
  dispatchEvent(new Event("online"));
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 5));
  eq(uploads, 1, "uploaded");
  eq(Object.keys(store.sources?.list || {}), ["s1"], "listed");
  await cloud.signOut();
});

test("a device signed in before the sync record moved stays signed in, and agrees on nothing old", async () => {
  let opened = 0;
  const cloud = cloudWith({ get: async () => undefined, set: async () => {} });
  const stored = new Map([["sat-trainer:sync:v1", JSON.stringify({ uid: "u1", email: "", on: true, base: { progress: { q9: { t: 1 } } } })]]);
  const account = createAccount({
    ls: { get: (k, d) => (stored.has(k) ? JSON.parse(stored.get(k)) : d), set: (k, v) => stored.set(k, JSON.stringify(v)), del: (k) => stored.delete(k) },
    icon: () => "", esc: (s) => s, toast: () => {},
    data: { progress: { read: () => ({}), write: () => {} } },
    sets: { current: () => null, have: () => ({ ids: [], covered: [], numbers: {} }), stored: async () => null, store: async () => {}, install: async () => {} },
    changed: () => {},
    openCloud: async () => { opened++; return cloud; },
  });
  await account.init();
  const now = JSON.parse(stored.get("sat-trainer:sync:v2") || "null");
  eq([opened, now?.uid, now?.on, now?.base], [1, "u1", true, {}]);
});

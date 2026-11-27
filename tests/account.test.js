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

test("vocab: a grade taken back on one device is not brought back by another", () => {
  const graded = { last: 200, due: 900, reps: 3 };
  const restored = { last: 100, due: 500, reps: 2, edited: 300 };   // the old record, put back later
  const b = { srs: { w: graded } };
  eq(MERGE.vocab(b, { srs: { w: graded } }, { srs: { w: restored } }).srs.w, restored);
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

// Pages still running the code from before 12 November read and write the account's old place; the
// new code joins both copies, so neither side stops seeing the other.
import { joinCopies } from "../assets/account.js";

test("an old page's copy of the answers is joined with the new one, nothing dropped", () => {
  eq(joinCopies("progress", { q1: { t: 1 }, q2: { t: 5 } }, { q2: { t: 3 }, q3: { t: 7 } }), { q1: { t: 1 }, q2: { t: 5 }, q3: { t: 7 } });
});

test("a day's counts from both copies keep the larger", () => {
  eq(joinCopies("activity", { days: { "2026-11-15": { q: 2, w: 9 } } }, { days: { "2026-11-15": { q: 6, w: 3 } } }).days["2026-11-15"], { q: 6, w: 9 });
});

test("a copy missing on one side is the other side's", () => {
  eq([joinCopies("progress", undefined, { q1: { t: 1 } }), joinCopies("review", { q1: { last: 1 } }, undefined)], [{ q1: { t: 1 } }, { q1: { last: 1 } }]);
});

// A phone in the background loses its connection to the account and may not hear what the computer
// wrote meanwhile; coming back to the page after a while reads everything afresh.
test("back on the page after a minute away, the account is read afresh", async () => {
  const store = {};
  let reads = 0;
  const cloud = cloudWith({ get: async (n) => { reads++; return store[n]; }, set: async (n, v) => { store[n] = v; } });
  const account = accountWith(cloud);
  await account.actions["sign-in"]();
  for (let i = 0; i < 20 && store.progress === undefined; i++) await tick();
  const before = reads;
  document.dispatchEvent(new Event("visibilitychange"));
  await tick(20);
  eq(reads, before, "a moment later: nothing to read again");
  const now = Date.now;
  Date.now = () => now() + 61_000;
  try {
    document.dispatchEvent(new Event("visibilitychange"));
    for (let i = 0; i < 20 && reads === before; i++) await tick();
  } finally { Date.now = now; }
  eq(reads > before, true, "read again");
  await cloud.signOut();
});

// One screenshot of the menu from each device says where answers are lost: here, or in which place.
test("the menu shows the answers here and in both places of the account", async () => {
  const cloud = cloudWith({ get: async () => undefined, set: async () => {} });
  cloud.adapter = () => ({
    get: async (n) => (n === "progress" ? { q1: { t: 1 }, q2: { t: 2 } } : undefined),
    set: async () => {}, watch: () => () => {}, online: () => true,
    seen: () => ({ at: new Date(2026, 10, 15, 19, 5).getTime(), copies: { progress: { sync: { q1: { t: 1 } }, state: { q1: { t: 1 }, q2: { t: 2 } } } } }),
  });
  const account = accountWith(cloud, {
    data: { progress: { read: () => ({ q1: { t: 1 }, "~gone": {} }), write: () => {} } },
  });
  await account.actions["sign-in"]();
  const menu = account.menuHtml();
  eq([/здесь 1\b/.test(menu), /в аккаунте 2\b/.test(menu), /новое место 1, старое 2/.test(menu), /19:05/.test(menu)], [true, true, true, true]);
  eq(typeof account.actions["sync-reload"], "function", "a way to read the account again by hand");
  await cloud.signOut();
});

// The phone's sign-in dropped by itself and the page went on quietly without the account for days.
// A device that was signed in and is no longer, without the student signing out, says so.
function droppable() {
  let tell = null;
  return {
    drop: () => tell(null),
    cloud: {
      onUser: (cb) => { tell = cb; },
      signIn: async () => { const user = { uid: "u1", email: "me@x" }; await tell(user); return { user }; },
      signOut: async () => tell(null),
      adapter: () => ({ get: async () => undefined, set: async () => {}, watch: () => () => {}, online: () => true }),
      hasPdf: async () => true, putPdf: async () => {}, getPdf: async () => null,
    },
  };
}

test("a sign-in that dropped by itself is shown, with a way to sign in again", async () => {
  const d = droppable();
  const account = accountWith(d.cloud);
  await account.actions["sign-in"]();
  d.drop();                                      // Google's session on this device is gone
  await tick();
  eq([/Не в аккаунте/.test(account.chip()), /data-action="sign-in"/.test(account.chip())], [true, true]);
  eq([/сбросился/.test(account.menuHtml()), /me@x/.test(account.menuHtml())], [true, true]);
  eq(/data-action="sign-in"/.test(account.strip()), true, "a strip across the page, seen on a phone too");
});

test("after a reload the dropped sign-in is still shown, not forgotten", async () => {
  const stored = new Map([["sat-trainer:sync:v2", JSON.stringify({ uid: "u1", email: "me@x", on: true, base: {} })]]);
  const d = droppable();
  const account = createAccount({
    ls: { get: (k, def) => (stored.has(k) ? JSON.parse(stored.get(k)) : def), set: (k, v) => stored.set(k, JSON.stringify(v)), del: (k) => stored.delete(k) },
    icon: () => "", esc: (s) => s, toast: () => {},
    data: { progress: { read: () => ({}), write: () => {} } },
    sets: { current: () => null, have: () => ({ ids: [], covered: [], numbers: {} }), stored: async () => null, store: async () => {}, install: async () => {} },
    changed: () => {},
    openCloud: async () => d.cloud,
  });
  await account.init();
  d.drop();                                      // Firebase reports: nobody signed in here
  await tick();
  eq(/Не в аккаунте/.test(account.chip()), true);
});

test("signing out on purpose stays quiet", async () => {
  const d = droppable();
  const account = accountWith(d.cloud);
  await account.actions["sign-in"]();
  await account.actions["sign-out"]();
  await tick();
  eq([/Не в аккаунте/.test(account.chip()), /сбросился/.test(account.menuHtml()), account.strip()], [false, false, ""]);
});

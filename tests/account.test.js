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

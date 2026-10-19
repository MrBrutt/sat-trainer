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

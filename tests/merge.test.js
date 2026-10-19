import { test, eq } from "./run.js";
import { same, mergeValue, mergeSet, mergeMap, newer } from "../assets/merge.js";

const byT = newer((x) => x.t);

test("same ignores key order", () => {
  eq(same({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }), true);
  eq(same({ a: 1 }, { a: 2 }), false);
});

test("mergeMap keeps keys added on either side", () => {
  const b = { q1: { t: 1 } };
  eq(mergeMap(b, { q1: { t: 1 }, q2: { t: 5 } }, { q1: { t: 1 }, q3: { t: 6 } }, byT), { q1: { t: 1 }, q2: { t: 5 }, q3: { t: 6 } });
});

test("mergeMap: a key deleted on one side and untouched on the other is deleted", () => {
  const b = { q1: { t: 1 }, q2: { t: 2 } };
  eq(mergeMap(b, { q2: { t: 2 } }, { q1: { t: 1 }, q2: { t: 2 } }, byT), { q2: { t: 2 } });
  eq(mergeMap(b, b, {}, byT), {});
});

test("mergeMap: both sides changed a key — the later t wins", () => {
  const b = { q1: { t: 1, c: "A" } };
  eq(mergeMap(b, { q1: { t: 9, c: "B" } }, { q1: { t: 5, c: "C" } }, byT), { q1: { t: 9, c: "B" } });
  eq(mergeMap(b, { q1: { t: 5, c: "B" } }, { q1: { t: 9, c: "C" } }, byT), { q1: { t: 9, c: "C" } });
});

test("mergeMap: changed on one side and deleted on the other keeps the change", () => {
  const b = { q1: { t: 1 } };
  eq(mergeMap(b, { q1: { t: 4 } }, {}, byT), { q1: { t: 4 } });
  eq(mergeMap(b, {}, { q1: { t: 4 } }, byT), { q1: { t: 4 } });
});

test("mergeMap with no base (first sync) unions both sides", () => {
  eq(mergeMap(undefined, { a: { t: 1 }, c: { t: 3 } }, { b: { t: 2 }, c: { t: 7 } }, byT), { a: { t: 1 }, b: { t: 2 }, c: { t: 7 } });
  eq(mergeMap(undefined, { a: { t: 1 } }, undefined, byT), { a: { t: 1 } });
});

test("mergeSet applies adds and removes from both sides", () => {
  eq(mergeSet([1, 2], [1, 2, 3], [2]), [2, 3]);
  eq(mergeSet(undefined, ["a"], ["b"]), ["a", "b"]);
});

test("mergeValue: the unchanged side takes the other; both changed — local", () => {
  eq(mergeValue("middle", "middle", "advanced"), "advanced");
  eq(mergeValue("middle", "basic", "middle"), "basic");
  eq(mergeValue("middle", "basic", "advanced"), "basic");
  eq(mergeValue(undefined, undefined, 20), 20);
});

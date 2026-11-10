import { test, eq } from "./run.js";
import { paceFor, rushed, rushStats } from "../assets/timer.js";

const words = (n) => Array.from({ length: n }, () => "word").join(" ");
const Q = (n, extra = {}) => ({ section: "Reading and Writing", stem: [{ runs: [{ t: words(n - 4) }] }], prompt: { runs: [{ t: "" }] },
  choices: ["a", "b", "c", "d"].map((t) => ({ runs: [{ t }] })), ...extra });

test("a short question gets less time than a long one", () => {
  eq([paceFor(Q(75)), paceFor(Q(250))], [50000, 110000]);
});

test("an average question gets the SAT's average time", () => {
  const ms = paceFor(Q(137));
  eq(ms >= 65000 && ms <= 75000, true, `${ms}`);
});

test("a chart or table adds time", () => {
  eq(paceFor(Q(200, { hasFigure: true })) - paceFor(Q(200)), 15000);
});

test("math keeps its pace", () => {
  eq(paceFor(Q(40, { section: "Math" })), 95000);
});

const q = Q(200);   // norm 1:30

test("a wrong answer far faster than the norm is a rush", () => {
  eq(rushed(q, { ok: false, ms: 30000 }), true);
  eq(rushed(q, { ok: false, ms: 70000 }), false, "slow enough");
  eq(rushed(q, { ok: true, ms: 20000 }), false, "right");
});

test("giving up is not a rush", () => {
  eq(rushed(q, { ok: false, revealed: true, ms: 5000 }), false);
});

test("an answer without a time is not a rush", () => {
  eq(rushed(q, { ok: false }), false);
});

test("rushed mistakes among all mistakes", () => {
  const qs = [{ ...q, id: "a" }, { ...q, id: "b" }, { ...q, id: "c" }, { ...q, id: "d" }];
  const progress = { a: { ok: false, ms: 20000 }, b: { ok: false, ms: 80000 }, c: { ok: true, ms: 10000 } };
  eq(rushStats(qs, progress), { rushed: 1, wrong: 2 });
});

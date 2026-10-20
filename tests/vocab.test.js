import { test, eq } from "./run.js";
import { schedule, previewIntervals, readyIndex, requeue } from "../assets/vocab.js";

const now = new Date(2026, 9, 20, 12).getTime();
const MIN = 60_000;

test("every answer waits longer than the one before it, in every card state", () => {
  const bad = [];
  for (const reps of [0, 1, 2, 3, 5]) for (const ivl of [0, 1, 2, 3, 4, 6, 10, 25, 60]) for (const ease of [1.3, 1.45, 1.65, 2.0, 2.5, 3.0]) {
    if (reps === 0 && ivl) continue;
    const st = { due: 0, ivl, ease, reps, lapses: 0, last: 1 };
    const [h, g, e] = [2, 3, 4].map((x) => schedule(st, x, now).due);
    if (!(h < g && g < e)) bad.push({ reps, ivl, ease });
  }
  eq(bad, []);
});

test("a new card: «Сложно» comes back in 10 minutes, «Помню» tomorrow, «Легко» in 4 days", () => {
  eq(previewIntervals(null, now), ["<1 мин", "10 мин", "1 д", "4 д"]);
  const hard = schedule(null, 2, now);
  eq(hard.due, now + 10 * MIN, "due");
  eq(hard.reps, 0, "still learning");
});

test("a forgotten card offers the same choices as a new one", () => {
  const forgot = schedule({ due: 0, ivl: 10, ease: 2.5, reps: 3, lapses: 0, last: 1 }, 1, now);
  eq(previewIntervals(forgot, now + MIN), ["<1 мин", "10 мин", "1 д", "4 д"]);
});

test("«Помню» after «Сложно» on a new card gives a day", () => {
  const hard = schedule(null, 2, now);
  eq(schedule(hard, 3, now + 10 * MIN).ivl, 1);
});

test("the next card skips a word that is still waiting its minute", () => {
  const st = { a: { last: 1, due: now + MIN }, b: undefined, c: { last: 1, due: now - 1 } };
  eq(readyIndex(["a", "b", "c"], (k) => st[k], now), 1);
  eq(readyIndex(["a", "c"], (k) => st[k], now), 1);
});

test("nothing is ready when only waiting words are left", () => {
  eq(readyIndex(["a"], () => ({ last: 1, due: now + MIN }), now), -1);
  eq(readyIndex(["a"], () => ({ last: 1, due: now + MIN }), now + MIN), 0);
});

test("a forgotten word goes four cards back, or to the end of a shorter queue", () => {
  eq(requeue(["b", "c", "d", "e", "f", "g"], "a", 4), ["b", "c", "d", "e", "a", "f", "g"]);
  eq(requeue(["b"], "a", 4), ["b", "a"]);
  eq(requeue([], "a", 4), ["a"]);
  eq(requeue(["b", "c"], "a", Infinity), ["b", "c", "a"]);
});

import { test, eq } from "./run.js";
import { schedule, previewIntervals, readyIndex, requeue, answerCard, startOfDay } from "../assets/vocab.js";

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

// ---------------------------------------------------------------- «выучено»

import { isMastered, statusOf } from "../assets/vocab.js";

const DAY = 864e5;
const onDay = (d) => now + d * DAY;
// passes on the given days: grade 3 unless a pair [day, grade] says otherwise
const study = (days, st = null) => days.reduce((s, d) => (Array.isArray(d) ? schedule(s, d[1], onDay(d[0])) : schedule(s, 3, onDay(d))), st);

test("three passes on three days make a word learned", () => {
  eq(statusOf(study([0, 1]), false), "learning", "after two");
  const st = study([0, 1, 4]);
  eq(statusOf(st, false), "mastered", "after three");
  eq(isMastered(st), true);
});

test("«Легко» counts as a pass", () => {
  eq(statusOf(study([[0, 4], [4, 4], [12, 3]]), false), "mastered");
});

test("two passes on one day count once", () => {
  eq(statusOf(study([0, 0, 1]), false), "learning");
  eq(statusOf(study([0, 0, 1, 4]), false), "mastered");
});

test("«Сложно» breaks the run", () => {
  eq(statusOf(study([0, 1, [4, 2], 5, 6]), false), "learning");
  eq(statusOf(study([0, 1, [4, 2], 5, 6, 9]), false), "mastered");
});

test("the pass that makes a word learned sends it 2–3 weeks ahead", () => {
  const before = study([0, 1]);
  eq(schedule(before, 3, onDay(4)).ivl, 14, "помню");
  eq(schedule(before, 4, onDay(4)).ivl, 21, "легко");
});

test("a learned word comes back rarely and offers a week, three weeks and a month", () => {
  const st = study([0, 1, 4]);
  eq(previewIntervals(st, onDay(18)), ["<1 мин", "7 д", "21 д", "1 мес"]);
});

test("forgetting a learned word makes it «изучаю» again, and the run starts over", () => {
  const forgot = schedule(study([0, 1, 4]), 1, onDay(18));
  eq(statusOf(forgot, false), "learning");
  eq(isMastered(forgot), false);
  eq(statusOf(study([18, 19], forgot), false), "learning");
  eq(statusOf(study([18, 19, 22], forgot), false), "mastered");
});

test("«Сложно» on a learned word keeps it learned, a week ahead", () => {
  const hard = schedule(study([0, 1, 4]), 2, onDay(18));
  eq(statusOf(hard, false), "mastered");
  eq(hard.ivl, 7);
});

test("a card from before this change counts its earlier reviews", () => {
  const old = { due: 0, ivl: 2, ease: 2.5, reps: 3, lapses: 0, last: 1 };   // no good, no mastered
  eq(statusOf(old, false), "learning", "nothing changes until it is reviewed");
  const st = schedule(old, 3, now);
  eq(statusOf(st, false), "mastered", "next pass");
  eq(st.ivl, 14);
});

test("a long interval from before this change still reads as learned", () => {
  eq(statusOf({ due: 0, ivl: 21, ease: 2.5, reps: 5, lapses: 0, last: 1 }, false), "mastered");
});

test("a new word answered right at first sight was known: back in 4 days", () => {
  const st = answerCard(null, true, now);
  eq(st.ivl, 4);
  eq(st.due, startOfDay(now) + 4 * DAY);
});

test("not knowing a word never learned costs nothing but a minute", () => {
  const st = answerCard(null, false, now);
  eq([st.due, st.ease, st.lapses, st.reps], [now + MIN, 2.5, 0, 0]);
});

test("a new word missed, then answered right, comes back tomorrow", () => {
  const missed = answerCard(null, false, now);
  eq(answerCard(missed, true, now + 5 * MIN).ivl, 1);
  eq(answerCard(answerCard(missed, false, now + 2 * MIN), false, now + 4 * MIN).ease, 2.5, "still never learned");
});

test("a word on review: right is «Помню», wrong is «Не помню»", () => {
  const st = { due: now, ivl: 3, ease: 2.5, reps: 2, lapses: 0, last: now - 3 * DAY, good: 2, goodDay: 0 };
  eq(answerCard(st, true, now), schedule(st, 3, now));
  eq(answerCard(st, false, now), schedule(st, 1, now));
  eq(answerCard(st, false, now).ease < 2.5, true, "forgetting a learned word lowers its ease");
});

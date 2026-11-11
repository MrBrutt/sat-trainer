import { test, eq } from "./run.js";
import { gradeReview, enqueueReview, reviewAttempt, firstTryScore, weakSpots, examPlan } from "../assets/today.js";

const at = (d, h) => new Date(2026, 10, d, h).getTime();   // November 2026, local time

test("an answer given while reviewing is shown until the mistake comes due again", () => {
  const answer = { c: "D", ok: false, t: at(7, 17) };
  const r = gradeReview(enqueueReview(null, at(6, 10), true), false, answer.t);
  eq(reviewAttempt(r, answer, at(7, 18)), answer, "same day");
});

test("a page left open overnight asks yesterday's mistake afresh", () => {
  const answer = { c: "D", ok: false, t: at(6, 23) };
  const r = gradeReview(enqueueReview(null, at(6, 10), true), false, answer.t);
  eq(reviewAttempt(r, answer, at(7, 17)), null);
});

test("a fixed mistake keeps its last answer", () => {
  const answer = { c: "C", ok: true, t: at(7, 17) };
  const r = { ...enqueueReview(null, at(1, 10)), step: 2, done: true };
  eq(reviewAttempt(r, answer, at(9, 12)), answer);
});

test("no answer yet", () => {
  eq(reviewAttempt(enqueueReview(null, at(6, 10), true), undefined, at(7, 17)), null);
});

const qs = (...ids) => ids.map((id) => ({ id }));

test("the score counts first answers and tells fixed mistakes apart", () => {
  const progress = { a: { ok: true }, b: { ok: false }, c: { ok: false } };
  const review = { b: { done: true }, c: { done: false } };
  eq(firstTryScore(qs("a", "b", "c", "d"), progress, review), { answered: 3, right: 1, fixed: 1, pct: 33 });
});

test("only a first answer that was wrong counts as fixed", () => {
  const progress = { a: { ok: true } };
  eq(firstTryScore(qs("a", "b"), progress, { a: { done: true }, b: { done: true } }).fixed, 0);
});

test("no answers yet", () => {
  eq(firstTryScore(qs("a"), {}, {}), { answered: 0, right: 0, fixed: 0, pct: 0 });
});

test("weak spots: the lowest first-try accuracy first, types with few answers last", () => {
  const sk = (id, skill) => ({ id, skill });
  const qs = [sk("a1", "Inferences"), sk("a2", "Inferences"), sk("a3", "Inferences"), sk("a4", "Inferences"),
    sk("b1", "Transitions"), sk("b2", "Transitions"), sk("b3", "Transitions"), sk("c1", "Boundaries"), sk("c2", "Boundaries"),
    sk("d1", "Command of Evidence: Quantitative")];
  const progress = { a1: { ok: false }, a2: { ok: true }, a3: { ok: true }, b1: { ok: false }, b2: { ok: false }, b3: { ok: true }, c1: { ok: false } };
  const r = weakSpots(qs, progress);
  eq(r.map((x) => x.skill), ["Transitions", "Inferences", "Boundaries"]);
  eq(r[0], { skill: "Transitions", domain: "Expression of Ideas", answered: 3, right: 1, pct: 33, rushed: 0, left: 0 });
  eq(r[1].left, 1);
  eq(r[2].answered, 1, "too few to rank");
});

test("a fast wrong answer counts as a rush in its type", () => {
  const q = { id: "x", skill: "Words in Context", stem: [], choices: [] };
  eq(weakSpots([q], { x: { ok: false, ms: 3000 } })[0].rushed, 1);
});

test("exam plan: days left, study days to the day before the exam, questions per day", () => {
  eq(examPlan("2026-11-11", "2026-12-05", "", 341), { toExam: 24, studyDays: 24, perDay: 15, last: "2026-12-04" });
});

test("a departure date earlier than the exam shortens the study days", () => {
  eq(examPlan("2026-11-11", "2026-12-05", "2026-11-28", 341), { toExam: 24, studyDays: 18, perDay: 19, last: "2026-11-28" });
});

test("a last day on or after the exam is the day before it; a last day gone leaves no study days", () => {
  eq(examPlan("2026-11-11", "2026-12-05", "2026-12-09", 48).last, "2026-12-04");
  eq(examPlan("2026-11-30", "2026-12-05", "2026-11-28", 40), { toExam: 5, studyDays: 0, perDay: 40, last: "2026-11-28" });
});

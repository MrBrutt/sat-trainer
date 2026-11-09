import { test, eq } from "./run.js";
import { gradeReview, enqueueReview, reviewAttempt, firstTryScore } from "../assets/today.js";

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

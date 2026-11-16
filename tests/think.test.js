import { test, eq } from "./run.js";
import { stepStats, createThink, relationOf } from "../assets/think.js";

const run = (t) => ({ runs: [{ t }] });
const wic = (id, text, prompt = "Which choice completes the text with the most logical and precise word or phrase?") => ({
  id, skill: "Words in Context", stem: [run(text)], prompt: run(prompt),
  choices: ["A", "B", "C", "D"].map((letter) => ({ letter, runs: [{ t: "word" }] })), correct: "A",
});
const NEARLY = "As used in the text, what does the word “charge” most nearly mean?";
const CLUE = "Although it was ______ then, it is common now.";

function setup({ answered = false } = {}) {
  return createThink({ esc: (s) => s, icon: () => "", answerOf: () => (answered ? { c: "A" } : null), refresh: () => {} });
}

// ---------------------------------------------------------------- Transitions, Command of Evidence, Inferences

const choiceQ = (id, skill, correct, prompt = "Which choice completes the text with the most logical transition?") => ({
  id, skill, stem: [run("One thing happened. ______ another did.")], prompt: run(prompt),
  choices: [correct, "Meanwhile,", "For example,", "Similarly,"].map((t, i) => ({ letter: "ABCD"[i], runs: [{ t }] })), correct: "A",
});

// The student found typing first a waste of time («it could be anything»): these open with the choices.
test("Words in Context, Command of Evidence and Inferences show the choices at once", () => {
  const t = setup();
  const qs = [wic("a", CLUE), wic("b", "The charge was false.", NEARLY),
    choiceQ("c", "Command of Evidence", "x", "Which quotation most effectively illustrates the claim?"),
    choiceQ("d", "Inferences", "x", "Which choice most logically completes the text?")];
  eq(qs.map((q) => t.locked(q)), [false, false, false, false]);
  eq(qs.map((q) => t.take(q)), [{}, {}, {}, {}]);
});

test("other questions, and answered ones, have no steps", () => {
  eq(setup().locked({ ...choiceQ("a", "Transitions", "Thus,"), skill: "Boundaries" }), false);
  eq(setup({ answered: true }).locked(choiceQ("a", "Transitions", "Thus,")), false);
});

test("«Решить заново» asks again", () => {
  const t = setup();
  const q = choiceQ("a", "Transitions", "Thus,");
  t.locked(q);
  t.actions["think-rel"]({ dataset: { rel: "cause" } });
  eq(t.locked(q), false);
  t.reset(q.id);
  eq(t.locked(q), true);
});

test("results with the step are told from those before it", () => {
  const qs = [wic("a", ""), { ...wic("b", ""), skill: "Inferences" }, { ...wic("c", ""), skill: "Transitions" }, { ...wic("d", ""), skill: "Transitions" }, { ...wic("e", ""), skill: "Boundaries" }];
  const progress = { a: { ok: true, own: "x" }, b: { ok: false, own: "y" }, c: { ok: true, rel: "cause" }, d: { ok: false }, e: { ok: true } };
  eq(stepStats(qs, progress), { steps: { n: 1, ok: 1 }, before: { n: 1, ok: 0 } });
});

test("relations of transitions", () => {
  const rel = (t) => relationOf(choiceQ("a", "Transitions", t));
  eq([rel("By contrast,"), rel("Thus,"), rel("For instance,"), rel("Similarly,"), rel("Previously,"), rel("In so doing,")],
    ["contrast", "cause", "example", "more", "time", "cause"]);
  eq(rel("Of course,"), null);
});

test("in Transitions the student names the relation first, and a wrong one is corrected", () => {
  const t = setup();
  const q = choiceQ("a", "Transitions", "Therefore,");
  eq(t.locked(q), true);
  eq((t.html(q).match(/data-action="think-rel"/g) || []).length, 5);
  t.actions["think-rel"]({ dataset: { rel: "contrast" } });
  eq(t.locked(q), false, "the choices open");
  eq(/причин/i.test(t.note(q)), true, "says which relation it is");
  eq(t.take(q), { rel: "contrast", relOk: false });
});

test("a right relation is confirmed", () => {
  const t = setup();
  const q = choiceQ("a", "Transitions", "However,");
  t.locked(q);
  t.actions["think-rel"]({ dataset: { rel: "contrast" } });
  eq(t.take(q), { rel: "contrast", relOk: true });
});

test("an unknown transition is asked without a verdict", () => {
  const t = setup();
  const q = choiceQ("a", "Transitions", "Of course,");
  t.locked(q);
  t.actions["think-rel"]({ dataset: { rel: "time" } });
  eq([t.locked(q), /неверно|нет,|здесь связь/i.test(t.note(q))], [false, false]);
  eq(t.take(q), { rel: "time" });
});

test("the feedback shows what the student did", () => {
  const t = setup();
  // answers from the days of the typed step keep what the student wrote
  eq(/Ваше слово было: «rare»/.test(t.feedback(wic("a", CLUE), { own: "rare" })), true);
  eq(/Ваша мысль была: «x»/.test(t.feedback(choiceQ("b", "Inferences", "x"), { own: "x" })), true);
  eq(/причин/i.test(t.feedback(choiceQ("c", "Transitions", "Thus,"), { rel: "contrast", relOk: false })), true);
  eq(t.feedback(choiceQ("d", "Transitions", "Thus,"), {}), "");
});

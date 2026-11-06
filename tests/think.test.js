import { test, eq } from "./run.js";
import { clueWords, coveredWord, stepStats, createThink } from "../assets/think.js";

const run = (t) => ({ runs: [{ t }] });
const wic = (id, text, prompt = "Which choice completes the text with the most logical and precise word or phrase?") => ({
  id, skill: "Words in Context", stem: [run(text)], prompt: run(prompt),
  choices: ["A", "B", "C", "D"].map((letter) => ({ letter, runs: [{ t: "word" }] })), correct: "A",
});
const NEARLY = "As used in the text, what does the word “charge” most nearly mean?";
const words = (q) => clueWords(q).map((c) => `${c.kind}:${c.text}`);

test("a contrast word in the sentence with the blank is the clue", () => {
  eq(words(wic("a", "Early on it was rare. Although it was ______ then, it is common now.")), ["contrast:although"]);
});

test("only the sentence with the blank counts", () => {
  eq(words(wic("a", "This failed, but nobody minded. The result was ______.")), []);
});

test("cause and continuation words are clues too", () => {
  eq(words(wic("a", "It was ______ because the winter was long.")), ["cause:because"]);
  eq(words(wic("a", "It is ______; indeed, she says so herself.")), ["same:indeed"]);
});

test("\"but also\" adds, it does not contrast", () => {
  eq(words(wic("a", "It can not only ______ the past but also predict the future.")), ["same:not only", "same:but also"]);
});

test("\"yet to\" is not a contrast", () => {
  eq(words(wic("a", "Scientists have yet to ______ the cause.")), []);
});

test("nothing to mark in a «most nearly mean» question", () => {
  eq(clueWords(wic("a", "She agreed, but the charge was false.", NEARLY)), []);
  eq(coveredWord(wic("a", "The charge was false.", NEARLY)), "charge");
  eq(coveredWord(wic("a", "It was ______.")), null);
});

function setup({ answered = false, original = false } = {}) {
  const think = createThink({ esc: (s) => s, icon: () => "", answerOf: () => (answered ? { c: "A" } : null), isOriginal: () => original, refresh: () => {} });
  return think;
}
const own = (t, text) => { t.onInput({ target: { id: "think-own", value: text } }); t.go(); };
const CLUE = "Although it was ______ then, it is common now.";

test("the clue comes first, then the student's own word, then the choices", () => {
  const t = setup();
  const q = wic("a", CLUE);
  eq(t.locked(q), true);
  eq(/Шаг 1 из 2/.test(t.html(q)), true, "step 1");
  t.actions["think-clue"]({ dataset: { w: "Although" } });
  eq(/Шаг 2 из 2/.test(t.html(q)), true, "step 2");
  eq(/контраст/i.test(t.html(q)), true, "says what the word does");
  own(t, "rare");
  eq(t.locked(q), false, "open");
  eq(t.take(q), { own: "rare", clue: true });
});

test("a wrong tap names the right word and goes on", () => {
  const t = setup();
  const q = wic("a", CLUE);
  t.locked(q);
  t.actions["think-clue"]({ dataset: { w: "common" } });
  eq(/although/i.test(t.html(q)), true, "names it");
  eq(/Шаг 2 из 2/.test(t.html(q)), true, "goes on");
  own(t, "rare");
  eq(t.take(q), { own: "rare", clue: false });
});

test("no clue in the sentence: only the student's own word", () => {
  const t = setup();
  const q = wic("a", "The result was ______.");
  eq(/Шаг/.test(t.html(q)), false);
  own(t, "good");
  eq(t.locked(q), false);
  eq(t.take(q), { own: "good" });
});

test("the question stays closed until the student has written something", () => {
  const t = setup();
  const q = wic("a", "The result was ______.");
  t.locked(q);
  t.go();
  eq(t.locked(q), true, "nothing written");
  own(t, " ");
  eq(t.locked(q), true, "spaces");
  own(t, "хороший");
  eq(t.locked(q), false, "any language");
});

test("small words of a phrase do not count as the clue", () => {
  const t = setup();
  const q = wic("a", "It was ______ due to the rain.");
  t.locked(q);
  t.actions["think-clue"]({ dataset: { w: "to" } });
  own(t, "wet");
  eq(t.take(q).clue, false);
  const again = wic("b", "It was ______ due to the rain.");
  t.locked(again);
  t.actions["think-clue"]({ dataset: { w: "due" } });
  own(t, "wet");
  eq(t.take(again).clue, true);
});

test("the original PDF view has no text to tap", () => {
  const t = setup({ original: true });
  const q = wic("a", CLUE);
  eq(/Шаг/.test(t.html(q)), false);
});

test("other questions, and answered ones, have no steps", () => {
  const t = setup();
  eq(t.locked({ ...wic("a", CLUE), skill: "Transitions" }), false);
  eq(setup({ answered: true }).locked(wic("a", CLUE)), false);
});

test("«Решить заново» asks again", () => {
  const t = setup();
  const q = wic("a", "The result was ______.");
  t.locked(q);
  own(t, "good");
  eq(t.locked(q), false);
  t.reset(q.id);
  eq(t.locked(q), true);
});

const page = (html) => { const el = document.createElement("div"); el.innerHTML = html; return el; };

test("in the clue step the words of the passage can be tapped", () => {
  const t = setup();
  const q = wic("a", CLUE);
  const root = page(`<article class="passage"><p>Although it was <span class="blank"></span> then.</p></article>`);
  eq(t.decorate(q, root), true);
  const cw = [...root.querySelectorAll(".cw")];
  eq(cw[0].dataset.action, "think-clue");
  eq(cw[0].dataset.w, "Although");
  eq(cw.length, 4);
  eq(root.querySelectorAll(".blank").length, 1);
});

test("after a tap the clue is marked and words are no longer wrapped", () => {
  const t = setup();
  const q = wic("a", CLUE);
  t.locked(q);
  t.actions["think-clue"]({ dataset: { w: "although" } });
  const root = page(`<article class="passage"><p>Although it was <span class="blank"></span> then.</p></article>`);
  eq(t.decorate(q, root), false);
  eq(root.querySelector(".clue-mark").textContent, "Although");
  eq(root.querySelectorAll(".cw").length, 0);
});

test("the word of a «most nearly mean» question is covered until the student writes", () => {
  const t = setup();
  const q = wic("a", "The charge was false.", NEARLY);
  const root = page(`<article class="passage"><p>The <u>charge</u> was false.</p></article><div class="prompt">the word “charge” most nearly</div>`);
  t.decorate(q, root);
  eq(/charge/.test(root.textContent), false, "covered");
  eq(root.querySelectorAll(".covered").length, 2);
  own(t, "accusation");
  const after = page(`<article class="passage"><p>The <u>charge</u> was false.</p></article>`);
  t.decorate(q, after);
  eq(/charge/.test(after.textContent), true, "open again");
});

test("results with the steps are told from those before them", () => {
  const qs = [wic("a", ""), wic("b", ""), wic("c", ""), { ...wic("d", ""), skill: "Transitions" }];
  const progress = { a: { ok: true, own: "x" }, b: { ok: false, own: "y" }, c: { ok: true }, d: { ok: true, own: "z" } };
  eq(stepStats(qs, progress), { steps: { n: 2, ok: 1 }, before: { n: 1, ok: 1 } });
});

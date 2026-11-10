import { test, eq } from "./run.js";
import { createVocab, VOCAB_DEFAULT, gateRanks } from "../assets/vocab-ui.js";
import { createPrep } from "../assets/prep.js";

const run = (t) => ({ runs: [{ t }] });
const question = (id, skill, words, n = 1) => ({
  id, n, skill, stem: [run("A short passage.")], prompt: run("Which choice completes the text?"),
  choices: ["A", "B", "C", "D"].map((letter, i) => ({ letter, runs: [{ t: words[i] }] })), correct: "A", rationale: [],
});

function setup(questions, vocab = {}) {
  const S = { set: { questions }, vocab: { ...VOCAB_DEFAULT(), ...vocab }, progress: {}, ui: { view: "today" }, session: null };
  const v = createVocab({
    S, $: (s) => document.querySelector(s), icon: () => "", esc: (s) => String(s), toast: () => {}, plural: (n, a) => a,
    ls: { get: (k, d) => d, set: () => {} }, KEY: {}, confirmDialog: async () => true,
    saveUi: () => {}, current: () => null, openQuestion: () => {}, refreshChrome: () => {}, ai: () => null, inClaude: () => false,
    onWordDone: () => {}, refreshQuestion: () => {}, refreshTrainer: () => {},
  });
  return { S, v };
}
const wordsIn = async (v, q) => { for (let i = 0; i < 400 && v.gateOf(q).loading; i++) await new Promise((r) => setTimeout(r, 25)); };
const reading = (id, text) => question(id, "Text Structure and Purpose", [text, "to show", "to tell", "to ask"]);

test("today's cards are chosen after the word lists load, not before", async () => {
  const q = reading("q1", "to assess and modify");
  const { S, v } = setup([q], { level: "basic" });
  v.rebuild();
  v.dueTotal();                                     // the first screen draws while the lists still load
  await wordsIn(v, q);
  eq(v.dueTotal() > 0, true, "the words of the question's choices are in today's cards");
  eq(S.session.queue.includes("assess"), true);
});

test("a session already started keeps its place when the word lists arrive", async () => {
  const q = reading("q1", "to assess and modify");
  const { S, v } = setup([q], { level: "basic" });
  v.rebuild();
  v.dueTotal();
  S.session.reviewed = 3;
  const session = S.session;
  await wordsIn(v, q);
  eq(S.session === session, true);
});

test("a level that came from the account changes which words a question needs", async () => {
  const q = reading("q1", "to assess and modify");
  const { S, v } = setup([q], { level: "advanced" });
  v.rebuild();
  await wordsIn(v, q);
  eq(v.gateOf(q).cards.length, 0, "advanced: nothing hard");
  S.vocab = { ...S.vocab, level: "basic" };
  v.accountChanged();
  eq(v.gateOf(q).cards.length > 0, true, "basic: words to learn");
});

test("a progress file sets the level on a new device, and leaves it alone on a used one", async () => {
  const incoming = { level: "test", newPerDay: 30, test: { at: 1, zipf: 4 }, srs: { adorn: { last: 1, due: 0, ivl: 1, ease: 2.5, reps: 1 } } };
  const fresh = setup([]);
  fresh.v.merge(incoming);
  eq([fresh.S.vocab.level, fresh.S.vocab.newPerDay], ["test", 30], "new device");
  const used = setup([], { srs: { cogent: { last: 2, due: 0, ivl: 1, ease: 2.5, reps: 1 } }, level: "basic" });
  used.v.merge(incoming);
  eq([used.S.vocab.level, used.S.vocab.newPerDay], ["basic", 20], "used device");
});

test("K on the waiting screen does not mark a word nobody is looking at", async () => {
  const q = question("q1", "Words in Context", ["adorn", "cogent", "terse", "prudent"]);
  const later = Date.now() + 60_000;
  const { S, v } = setup([q], { srs: { adorn: { last: 1, due: later, ivl: 0, ease: 2.5, reps: 0 } } });
  v.rebuild();
  await wordsIn(v, q);
  S.ui.view = "vocab";
  S.session = { queue: ["adorn"], revealed: false, reviewed: 0, learnedNew: 0, day: new Date().toDateString() };
  v.dueTotal();
  eq(v.onKey({ key: "k" }), false);
  eq(S.vocab.known, []);
});

// ---------------------------------------------------------------- a card: see a new word, then recall it

const MIN = 60_000;
async function cardsOf(srs = {}) {
  const q = question("q1", "Words in Context", ["adorn", "cogent", "terse", "prudent"]);
  const { S, v } = setup([q], { srs });
  v.rebuild();
  await wordsIn(v, q);
  S.ui.view = "vocab";
  S.session = { queue: ["adorn", "cogent", "terse", "prudent"], revealed: false, reviewed: 0, learnedNew: 0, day: new Date().toDateString() };
  return { S, v };
}
const learned = (now = Date.now()) => ({ last: now - 3 * 864e5, due: now - 1, ivl: 3, ease: 2.5, reps: 2, lapses: 0, good: 2, goodDay: 0 });

test("a new word is shown with its meaning, not asked; it comes back a few cards later at no cost", async () => {
  const { S, v } = await cardsOf();
  const t = Date.now();
  eq(v.onKey({ key: " " }), true);
  const st = S.vocab.srs.adorn;
  eq([st.ease, st.reps, st.due >= t + MIN, st.due < t + 2 * MIN], [2.5, 0, true, true]);
  eq(S.session.queue, ["cogent", "terse", "prudent", "adorn"]);
});

test("a word met before is recalled: Space shows the meaning, → is «Вспомнил»", async () => {
  const { S, v } = await cardsOf({ adorn: learned() });
  eq(v.onKey({ key: "ArrowRight" }), false, "nothing to grade before the meaning is shown");
  v.onKey({ key: " " });
  eq(S.session.revealed, true);
  v.onKey({ key: "ArrowRight" });
  eq([S.vocab.srs.adorn.reps, S.vocab.srs.adorn.ivl > 3, S.session.queue.includes("adorn")], [3, true, false]);
});

test("← is «Не вспомнил»: the word comes back a few cards later", async () => {
  const { S, v } = await cardsOf({ adorn: learned() });
  v.onKey({ key: " " });
  v.onKey({ key: "ArrowLeft" });
  eq([S.vocab.srs.adorn.reps, S.vocab.srs.adorn.ease < 2.5, S.session.queue.indexOf("adorn")], [0, true, 3]);
});

test("a new word seen a minute ago and recalled goes to tomorrow, without ease lost", async () => {
  const t = Date.now();
  const { S, v } = await cardsOf({ adorn: { last: t - 2 * MIN, due: t - MIN, ivl: 0, ease: 2.5, reps: 0, lapses: 0 } });
  v.onKey({ key: " " });
  v.onKey({ key: "2" });
  eq([S.vocab.srs.adorn.ivl, S.vocab.srs.adorn.ease], [1, 2.5]);
});

test("words studied before are not called new on the screen before a question", () => {
  const forgot = { key: "adorn", term: "adorn", def: "to decorate", st: { last: 1, reps: 0 }, review: false };
  const due = { key: "cogent", term: "cogent", def: "convincing", st: { last: 1, reps: 2 }, review: true };
  const q = question("q1", "Words in Context", ["adorn", "cogent", "terse", "prudent"]);
  const prep = createPrep({
    S: {}, esc: (s) => s, icon: () => "", plural: (n, a, b, c) => (n === 1 ? a : n < 5 ? b : c), toast: () => {},
    vocab: { gateOf: () => ({ loading: false, cards: [forgot, due], missing: [forgot, due] }), fetchGateDefs: () => {} },
    answerOf: () => null, current: () => q, refresh: () => {},
  });
  eq(/нов/.test(prep.html(q).replace(/<[^>]+>/g, "")), false);
});

// ---------------------------------------------------------------- which new words come first

const Q = (id, n, extra = {}) => ({ id, n, ...extra });
const ranks = (questions, gates, opts) => Object.fromEntries(gateRanks(questions, new Map(Object.entries(gates)), { progress: {}, review: {}, focus: () => true, ...opts }));

test("the words of a mistake waiting for review come before those of the questions ahead", () => {
  const r = ranks([Q("a", 1), Q("b", 2)], { a: ["shrewd"], b: ["opaque"] }, { progress: { a: { ok: false } }, review: { a: { done: false } } });
  eq([r.shrewd.tier, r.opaque.tier], [1, 2]);
});

test("words of a fixed mistake wait", () => {
  const r = ranks([Q("a", 1)], { a: ["shrewd"] }, { progress: { a: { ok: false } }, review: { a: { done: true } } });
  eq(r.shrewd, undefined);
});

test("answered questions pull nothing", () => {
  const r = ranks([Q("a", 1)], { a: ["shrewd"] }, { progress: { a: { ok: true } } });
  eq(r.shrewd, undefined);
});

test("the questions ahead go by number", () => {
  const r = ranks([Q("b", 7), Q("a", 3)], { a: ["shrewd"], b: ["opaque"] });
  eq(r.shrewd.n < r.opaque.n, true);
});

test("a shared word takes its earliest place", () => {
  const r = ranks([Q("a", 3), Q("b", 9)], { a: ["opaque"], b: ["opaque", "shrewd"] });
  eq([r.opaque.n < r.shrewd.n, Object.keys(r).length], [true, 2]);
});

test("the block in focus comes first", () => {
  const r = ranks([Q("a", 1, { skill: "Transitions" }), Q("b", 200, { skill: "Command of Evidence" })], { a: ["opaque"], b: ["shrewd"] },
    { focus: (q) => q.skill === "Command of Evidence" });
  eq(r.shrewd.n < r.opaque.n, true);
});

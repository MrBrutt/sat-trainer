import { test, eq } from "./run.js";
import { createVocab, VOCAB_DEFAULT } from "../assets/vocab-ui.js";
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

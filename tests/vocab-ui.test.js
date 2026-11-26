import { test, eq } from "./run.js";
import { createVocab, VOCAB_DEFAULT, gateRanks, swipeOutcome, trimAround } from "../assets/vocab-ui.js";
import { createPrep } from "../assets/prep.js";

const run = (t) => ({ runs: [{ t }] });
const question = (id, skill, words, n = 1) => ({
  id, n, skill, stem: [run("A short passage.")], prompt: run("Which choice completes the text?"),
  choices: ["A", "B", "C", "D"].map((letter, i) => ({ letter, runs: [{ t: words[i] }] })), correct: "A", rationale: [],
});

function setup(questions, vocab = {}, more = {}) {
  const S = { set: { questions }, vocab: { ...VOCAB_DEFAULT(), ...vocab }, progress: {}, ui: { view: "today" }, session: null };
  const v = createVocab({
    S, $: (s) => document.querySelector(s), icon: () => "", esc: (s) => String(s), toast: () => {}, plural: (n, a) => a,
    ls: { get: (k, d) => d, set: () => {} }, KEY: {}, confirmDialog: async () => true,
    saveUi: () => {}, current: () => null, openQuestion: () => {}, refreshChrome: () => {}, ai: () => null, inClaude: () => false,
    onWordDone: () => {}, refreshQuestion: () => {}, refreshTrainer: () => {}, ...more,
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
async function cardsOf(srs = {}, more = {}) {
  const q = question("q1", "Words in Context", ["adorn", "cogent", "terse", "prudent"]);
  const { S, v } = setup([q], { srs }, more);
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

test("K pressed by mistake is taken back: the word is first again and no longer «знаю»", async () => {
  const count = { done: 0, undone: 0 };
  const { S, v } = await cardsOf({}, { onWordDone: () => count.done++, onWordUndone: () => count.undone++ });
  v.onKey({ key: "k" });
  eq([S.vocab.known, S.session.queue[0]], [["adorn"], "cogent"]);
  eq(v.onKey({ key: "z" }), true);
  eq([S.vocab.known, S.session.queue[0], count], [[], "adorn", { done: 1, undone: 1 }]);
});

test("the way back after K is a button too, and it stays after the last card", async () => {
  const { S, v } = await cardsOf();
  S.session.queue = ["adorn"];
  v.onKey({ key: "k" });
  eq(S.session.queue, []);
  v.actions["v-undo-known"]();
  eq([S.vocab.known, S.session.queue], [[], ["adorn"]]);
});

test("the way back closes once the next card is done", async () => {
  const { S, v } = await cardsOf();
  v.onKey({ key: "k" });
  v.onKey({ key: " " });
  eq(v.onKey({ key: "z" }), false);
  eq(S.vocab.known, ["adorn"]);
});

test("K on a new word uses up one of the day's new words; «Вернуть» gives it back", async () => {
  const { S, v } = await cardsOf();
  v.onKey({ key: "k" });
  eq(S.vocab.daily.newCount, 1);
  v.onKey({ key: "z" });
  eq(S.vocab.daily.newCount, 0);
});

test("new words marked «знаю» are not made up for when the page reloads", async () => {
  const q = question("q1", "Words in Context", ["adorn", "cogent", "terse", "prudent"]);
  const { S, v } = setup([q], { newPerDay: 2 });
  v.rebuild();
  await wordsIn(v, q);
  S.ui.view = "vocab";
  eq(v.dueTotal(), 2);
  v.onKey({ key: "k" });
  v.onKey({ key: "k" });
  eq(v.dueTotal(), 0);
  S.session = null;
  eq(v.dueTotal(), 0);
});

test("progress on a word now learned on its base word's card carries over to it", async () => {
  const q = reading("q1", "Their admiration for the depiction grew.");
  const st = learned();
  const { S, v } = setup([q], { srs: { admiration: st }, known: ["depiction"] });
  v.rebuild();
  await wordsIn(v, q);
  eq([S.vocab.srs.admire, v.card("admire")?.status, S.vocab.known.includes("depict")], [st, "learning", true]);
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

// ---------------------------------------------------------------- swiping a card on a phone

test("a swipe across the card counts; a short or slow nudge does not", () => {
  eq(swipeOutcome({ dx: 150, dy: 10, ms: 400, width: 360 }), "right");
  eq(swipeOutcome({ dx: -150, dy: 5, ms: 400, width: 360 }), "left");
  eq(swipeOutcome({ dx: 50, dy: 0, ms: 400, width: 360 }), null);
});

test("a quick flick counts even when short", () => {
  eq(swipeOutcome({ dx: 60, dy: 5, ms: 80, width: 360 }), "right");
});

test("scrolling up or down is no swipe", () => {
  eq(swipeOutcome({ dx: 120, dy: 200, ms: 300, width: 360 }), null);
});

// ---------------------------------------------------------------- a question's sentence on a card, made short

test("a long sentence from a question is cut to the words around the word", () => {
  eq(trimAround("one two three four five six ", " seven eight nine ten eleven.", 3), { before: "…four five six ", after: " seven eight nine…", cut: true });
});

test("a short sentence stays whole", () => {
  eq(trimAround("A ", " ran.", 10), { before: "A ", after: " ran.", cut: false });
});

// ---------------------------------------------------------------- the card on screen stays put

const dueNow = () => ({ last: Date.now() - 120_000, due: Date.now() - 60_000, ivl: 0, ease: 2.5, reps: 0, lapses: 0 });
const mapLs = () => { const m = new Map(); return { get: (k, d) => (m.has(k) ? JSON.parse(m.get(k)) : d), set: (k, v) => m.set(k, JSON.stringify(v)) }; };

test("the card on screen stays first when today's cards are put together again", async () => {
  const { S, v } = await cardsOf({ adorn: dueNow() });
  S.session = { queue: ["terse", "adorn", "cogent", "prudent"], revealed: false, reviewed: 3, learnedNew: 1, day: new Date().toDateString() };
  v.dueTotal();
  v.accountChanged();
  v.dueTotal();
  eq(S.session.queue[0], "terse");
});

test("after a reload the same card is first, turned over as it was", async () => {
  const ls = mapLs(), KEY = { cardFront: "front" };
  const q = question("q1", "Words in Context", ["adorn", "cogent", "terse", "prudent"]);
  const one = setup([q], { srs: { adorn: dueNow(), terse: { ...dueNow(), due: Date.now() - 10_000 } } }, { ls, KEY });
  one.v.rebuild();
  await wordsIn(one.v, q);
  one.S.ui.view = "vocab";
  one.S.session = { queue: ["terse", "adorn", "cogent", "prudent"], revealed: true, reviewed: 3, learnedNew: 1, day: new Date().toDateString() };
  one.v.dueTotal();
  const two = setup([q], one.S.vocab, { ls, KEY });
  two.v.rebuild();
  await wordsIn(two.v, q);
  two.S.ui.view = "vocab";
  two.v.dueTotal();
  eq([two.S.session.queue[0], two.S.session.revealed], ["terse", true]);
});

test("a card finished on another device is not held on screen", async () => {
  const { S, v } = await cardsOf({ adorn: dueNow() });
  S.session = { queue: ["terse", "adorn", "cogent", "prudent"], revealed: false, reviewed: 3, learnedNew: 1, day: new Date().toDateString() };
  v.dueTotal();
  S.vocab.known = ["terse"];
  v.accountChanged();
  v.dueTotal();
  eq(S.session.queue.includes("terse"), false);
});

test("a reload keeps the card even when the page draws before the word lists are in", async () => {
  const ls = mapLs(), KEY = { cardFront: "front" };
  const q = question("q1", "Words in Context", ["adorn", "cogent", "terse", "prudent"]);
  const srs = { adorn: dueNow(), terse: { ...dueNow(), due: Date.now() - 10_000 } };
  const one = setup([q], { srs }, { ls, KEY });
  one.v.rebuild();
  await wordsIn(one.v, q);
  one.S.ui.view = "vocab";
  one.S.session = { queue: ["terse", "adorn", "cogent", "prudent"], revealed: true, reviewed: 3, learnedNew: 1, day: new Date().toDateString() };
  one.v.dueTotal();
  const two = setup([q], one.S.vocab, { ls, KEY });
  two.S.ui.view = "vocab";
  two.v.dueTotal();            // the first screen, before the lists
  two.v.rebuild();
  await wordsIn(two.v, q);
  two.v.dueTotal();
  eq([two.S.session.queue[0], two.S.session.revealed], ["terse", true]);
});

// ---------------------------------------------------------------- arrows on a Mac: the card slides away

test("an arrow slides the card away and grades it once, even when pressed again during the slide", async () => {
  const { S, v } = await cardsOf({ adorn: learned(), cogent: learned() });
  const card = document.createElement("article");
  card.className = "card flash";
  document.body.append(card);
  try {
    S.session.revealed = true;
    v.onKey({ key: "ArrowRight" });
    eq([card.classList.contains("slide-right"), S.vocab.srs.adorn.reps], [true, 2], "sliding: not graded yet");
    v.onKey({ key: "ArrowRight" });            // pressed again before the slide is over
    await new Promise((r) => setTimeout(r, 250));
    eq([S.vocab.srs.adorn.reps, S.session.queue.includes("adorn")], [3, false]);
  } finally {
    card.remove();
  }
});

test("Space and at once an arrow: the arrow counts, though the card was still turning over", async () => {
  const { S, v } = await cardsOf({ adorn: learned() });
  const card = document.createElement("article");
  card.className = "card flash";
  document.body.append(card);
  try {
    v.onKey({ key: " " });                     // turning over
    v.onKey({ key: "ArrowRight" });            // before the turn is over
    await new Promise((r) => setTimeout(r, 250));
    eq([S.vocab.srs.adorn.reps, S.session.queue.includes("adorn")], [3, false]);
  } finally {
    card.remove();
  }
});

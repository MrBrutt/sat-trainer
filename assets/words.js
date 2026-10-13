// Hard words in passages and answer choices. A word counts as hard when it is rarer in everyday
// English than the learner's level (Zipf frequency). Frequencies: wordfreq by Robyn Speer,
// CC BY-SA 4.0 — assets/data/en-zipf.txt (built by scripts/build_wordfreq.py).
// Definitions: assets/data/defs.txt, written for this trainer.
import { plain } from "./parser.js";
import { termKey, stripArticle } from "./vocab.js";

export const LEVELS = [
  { id: "basic", label: "Начальный", zipf: 4.6 },
  { id: "middle", label: "Средний", zipf: 4.2 },
  { id: "advanced", label: "Продвинутый", zipf: 3.7 },
];
export const levelZipf = (id) => (LEVELS.find((l) => l.id === id) || LEVELS[1]).zipf;

let freq = null;
let loading = null;

// Data files carry the app version too, so a deploy is not hidden behind a cached copy.
export function dataUrl(name) {
  const url = new URL(`./data/${name}`, import.meta.url);
  const v = new URL(import.meta.url).searchParams.get("v");
  if (v) url.searchParams.set("v", v);
  return url;
}

export function loadFrequencies() {
  if (freq) return Promise.resolve(freq);
  loading ||= fetch(dataUrl("en-zipf.txt"))
    .then((r) => (r.ok ? r.text() : ""))
    .then((txt) => {
      const m = new Map();
      for (const line of txt.split("\n")) {
        if (!line || line[0] === "#") continue;
        const [band, ...ws] = line.split(" ");
        const z = Number(band) / 10;
        for (const w of ws) if (w) m.set(w, z);
      }
      freq = m;
      return m;
    })
    .catch(() => (freq = new Map()));
  return loading;
}

export const wordsReady = () => !!freq && freq.size > 0;   // false while loading or when the list failed to load
const zipf = (w) => freq?.get(w) ?? 2.5;   // not in the list = rarer than Zipf 3.0

// ---------------------------------------------------------------- definitions
// One line per word: key|part of speech|definition|example (the example is optional).

let defs = null;
let defsLoading = null;

export function loadDefs() {
  if (defs) return Promise.resolve(defs);
  defsLoading ||= fetch(dataUrl("defs.txt"))
    .then((r) => (r.ok ? r.text() : ""))
    .then((txt) => {
      const m = new Map();
      for (const line of txt.split("\n")) {
        if (!line || line[0] === "#") continue;
        const [key, p, d, x] = line.split("|");
        if (key && d) m.set(key, { p: p || "", d, x: x || "" });
      }
      defs = m;
      return m;
    })
    .catch(() => (defs = new Map()));
  return defsLoading;
}

// All definitions, for picking wrong options in a quiz: [{key, p, d}].
export const defsPool = () => (defs ? [...defs].map(([key, v]) => ({ key, p: v.p, d: v.d })) : []);

// The trainer's own definition of a word: {p, d, x} or null.
export function defOf(key) {
  if (!defs || !key) return null;
  return defs.get(key) || defs.get(stripArticle(key)) || (freq ? defs.get(lemma(key)) : null) || null;
}

// ---------------------------------------------------------------- base forms

// Base form: "males" → male, "posed" → pose, "stopping" → stop, "studies" → study.
// Only candidates the frequency list knows are kept.
export function lemma(word) {
  const w = word.toLowerCase().replace(/’/g, "'").replace(/'s$/, "");
  if (!freq) return w;
  const has = (x) => x.length > 2 && freq.has(x);
  const pick = (...xs) => xs.find(has);
  const verb = (stem) => {
    if (stem.length < 3) return null;
    if (/([^aeioulsfz])\1$/.test(stem)) return pick(stem.slice(0, -1), stem);        // stopp → stop
    if (/([lsfz])\1$/.test(stem)) return pick(stem, stem.slice(0, -1));                // fall; controll → control
    if (/[^aeiou][aeiouy][^aeiouwxy]$/.test(stem)) return pick(stem + "e", stem);     // pos → pose, stat → state
    const a = has(stem) ? stem : null, b = has(stem + "e") ? stem + "e" : null;      // sing / please
    return a && b ? (zipf(a) >= zipf(b) ? a : b) : a || b;
  };
  let r = null;
  if (/ie[sd]$/.test(w)) r = pick(w.slice(0, -3) + "y", /s$/.test(w) ? w.slice(0, -1) : "");
  else if (/(?:ss|x|z|ch|sh)es$/.test(w)) r = pick(w.slice(0, -2), w.slice(0, -1));   // classes, boxes
  else if (/ses$/.test(w)) r = pick(w.slice(0, -1), w.slice(0, -2));                   // senses → sense
  else if (/[^su']s$/.test(w)) r = pick(w.slice(0, -1));                              // not "glass", "virus"
  else if (/ed$/.test(w)) r = verb(w.slice(0, -2));
  else if (/ing$/.test(w)) r = verb(w.slice(0, -3));
  // a rare plural the list does not know: "exoplanets", "magpies"
  if (!r && w.length > 5 && !freq.has(w)) {
    r = /[ctrglnmd]ies$/.test(w) ? w.slice(0, -3) + "y"            // insufficiencies; but magpies, wrasses
      : /(?:x|z|ch|sh)es$/.test(w) ? w.slice(0, -2) : /[^su']s$|sses$/.test(w) ? w.slice(0, -1) : null;
  }
  return r || w;
}

// ---------------------------------------------------------------- finding hard words

const WORD = /\p{L}+(?:['’-]\p{L}+)*/gu;   // letters of any alphabet: "Jünger", "‘Ōlelo"
const atSentenceStart = (text, i) => /(^|[.!?:;"“(\n—–]\s*)$/.test(text.slice(Math.max(0, i - 3), i));

function hardness(form) {
  const low = form.toLowerCase().replace(/’/g, "'").replace(/'s$/, "");
  const lem = lemma(low);
  // "nineteenth-century" is easy if every part is easy; "self-effacement" is hard if any part is
  const parts = low.split("-");
  const z = parts.length > 1
    ? Math.min(...parts.map((p) => Math.max(zipf(p), zipf(lemma(p)))))
    : Math.max(zipf(low), zipf(lem));
  return { low, lem: parts.length > 1 ? low : lem, z };
}

function sentenceAround(text, i) {
  const start = Math.max(text.lastIndexOf(". ", i), text.lastIndexOf("? ", i), text.lastIndexOf("! ", i), text.lastIndexOf("\n", i));
  let end = text.slice(i).search(/[.!?](\s|$)|\n/);
  end = end < 0 ? text.length : i + end + 1;
  return { from: start < 0 ? 0 : start + (text[start] === "\n" ? 1 : 2), to: end };
}

// Names of people and places: words written with a capital letter in the middle of a sentence,
// after "Mr." or an initial, or rare words that never appear in lower case ("Flewellen argues…").
function namesIn(text) {
  const names = new Set();
  const lower = new Set();
  for (const m of text.matchAll(WORD)) if (!/^\p{Lu}/u.test(m[0])) lower.add(m[0].toLowerCase());
  const all = [...text.matchAll(WORD)];
  all.forEach((m, i) => {
    if (!/^\p{Lu}/u.test(m[0])) return;
    const low = m[0].toLowerCase().replace(/’s$|'s$/, "");
    const titled = /(?:\b(?:Mr|Mrs|Ms|Dr|St)|\b\p{Lu})\.\s*$/u.test(text.slice(Math.max(0, m.index - 5), m.index));   // "Mr. Verloc", "O. Flewellen"
    const next = all[i + 1];
    const firstName = next && /^\p{Lu}/u.test(next[0]) && text.slice(m.index + m[0].length, next.index) === " ";   // "Enrique Seira et al."
    if (titled || !atSentenceStart(text, m.index) || (!lower.has(low) && (firstName || !freq.has(low)))) names.add(low);
  });
  return names;
}

// Hard words of one text, first occurrence of each: [{key, form, zipf, before, after}].
// `context` is a longer text to recognize names in (a choice alone may start with one).
export function hardWordsIn(text, threshold, skip = new Set(), context = text) {
  if (!wordsReady()) return [];
  const names = namesIn(context);
  const out = new Map();
  let prev = null;
  for (const m of text.matchAll(WORD)) {
    const form = m[0].replace(/(?:'|’)s$/, "").replace(/-(?:and|or|to)$/i, "");   // "nineteenth-and" (a lost space)
    const before = prev;
    prev = m;
    if (form.length < 4 || /^[A-Z]{2,}/.test(form) || /['’](?:t|ll|re|ve|d|m)$/i.test(form)) continue;   // short words, acronyms, "hadn’t"
    if (text[m.index - 1] === "/" || text[m.index + m[0].length] === "/") continue;   // "mixtap/e/ssay", "Seminole/Muscogee"
    if (names.has(form.toLowerCase())) continue;                          // names of people and places
    // the second half of a Latin species name: "Gymnorhina tibicen", "B. terrenus"
    const unknown = !freq.has(form.toLowerCase());
    const genus = before && /^\p{Lu}/u.test(before[0]) && text.slice(before.index + before[0].length, m.index) === " "
      && (names.has(before[0].toLowerCase()) || !freq.has(before[0].toLowerCase()));
    if (unknown && (genus || /\b[A-Z]\.\s+$/.test(text.slice(Math.max(0, m.index - 4), m.index)))) continue;
    const { lem, z } = hardness(form);
    if (z >= threshold || skip.has(lem) || out.has(lem)) continue;
    const { from, to } = sentenceAround(text, m.index);
    out.set(lem, { key: lem, form, zipf: z, before: text.slice(from, m.index), after: text.slice(m.index + form.length, to) });
  }
  return [...out.values()];
}

const isWic = (q) => /words in context/i.test(q.skill);

// What a student sees before answering must not give the answer away: the word asked about in
// "what does the word X most nearly mean" and the answer choices themselves are left out.
export function spoilerWords(q) {
  const skip = new Set();
  const target = plain(q.prompt).match(/the word ["“]([^"”]+)["”]/i);
  if (target) skip.add(lemma(target[1]));
  if (isWic(q)) {
    for (const c of q.choices || []) for (const w of plain(c).match(WORD) || []) skip.add(lemma(w));
  }
  return skip;
}

export const passageText = (q) => q.stem.map(plain).join("\n");

// Words a student has to know to understand the answer choices. In "Words in Context" every
// choice is such a word; elsewhere the choices are sentences, and their hard words count.
export function choiceWords(q, threshold) {
  if (!q.choices?.length) return [];
  if (isWic(q)) {
    const terms = q.choices.map((c) => plain(c).trim()).filter((t) => t && t.split(/\s+/).length <= 4);
    return [...new Set(terms.map((t) => termKey(stripArticle(t))).filter((k) => k && k.length <= 40))];
  }
  const all = q.choices.map(plain).join("\n");
  const context = passageText(q) + "\n" + all;
  return hardWordsIn(all, threshold, new Set(), context).map((h) => h.key);
}

// Deck cards for hard words across all questions: words of the passages, and words of the answer
// choices outside "Words in Context" (those come from buildDeck). A choice is never used as an
// example, so a card does not show the answers before the question.
export function buildTextDeck(questions, threshold) {
  const deck = new Map();
  const get = (key, q, zipf) => deck.get(key) || deck.set(key, {
    key, term: key, def: null, examples: [], qids: [], role: "text", src: "auto", qnum: q.n, zipf,
  }).get(key);
  for (const q of questions) {
    for (const h of hardWordsIn(passageText(q), threshold, spoilerWords(q))) {
      const card = get(h.key, q, h.zipf);
      if (!card.qids.includes(q.id)) card.qids.push(q.id);
      if (card.examples.length < 3) {
        card.examples.push({ before: h.before, term: h.form, after: h.after, qid: q.id, n: q.n, kind: "passage", safe: true });
      }
    }
    if (isWic(q)) continue;
    for (const key of choiceWords(q, threshold)) {
      const card = get(key, q, zipf(key));
      card.role = "choice";
      if (!card.qids.includes(q.id)) card.qids.push(q.id);
    }
  }
  return [...deck.values()];
}

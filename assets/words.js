// Hard words in passages. A word counts as hard when it is rarer in everyday English than the
// learner's level (Zipf frequency). Frequencies: wordfreq by Robyn Speer, CC BY-SA 4.0 —
// assets/data/en-zipf.txt (built by scripts/build_wordfreq.py).
import { plain } from "./parser.js";

export const LEVELS = [
  { id: "basic", label: "Начальный", zipf: 4.6 },
  { id: "middle", label: "Средний", zipf: 4.2 },
  { id: "advanced", label: "Продвинутый", zipf: 3.7 },
];
export const levelZipf = (id) => (LEVELS.find((l) => l.id === id) || LEVELS[1]).zipf;

let freq = null;
let loading = null;

export function loadFrequencies() {
  if (freq) return Promise.resolve(freq);
  loading ||= fetch(new URL("./data/en-zipf.txt", import.meta.url))
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

export const wordsReady = () => !!freq && freq.size > 0;
const zipf = (w) => freq?.get(w) ?? 2.5;   // not in the list = rarer than Zipf 3.0

// Base form: try usual English endings, keep a candidate the frequency list knows.
export function lemma(word) {
  const w = word.toLowerCase().replace(/’/g, "'").replace(/'s$/, "");
  if (!freq) return w;
  const c = [];
  if (w.endsWith("ies") || w.endsWith("ied")) c.push(w.slice(0, -3) + "y");
  if (w.endsWith("es")) c.push(w.slice(0, -2));
  if (w.endsWith("s") && !w.endsWith("ss")) c.push(w.slice(0, -1));
  if (w.endsWith("ed")) { c.push(w.slice(0, -2), w.slice(0, -1)); if (/(.)\1ed$/.test(w)) c.push(w.slice(0, -3)); }
  if (w.endsWith("ing")) { c.push(w.slice(0, -3), w.slice(0, -3) + "e"); if (/(.)\1ing$/.test(w)) c.push(w.slice(0, -4)); }
  for (const x of c) if (x.length > 2 && freq.has(x)) return x;
  return w;
}

const WORD = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
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

// Hard words of one text, first occurrence of each: [{key, form, zipf, before, after}]
export function hardWordsIn(text, threshold, skip = new Set()) {
  if (!freq) return [];
  const names = new Set();
  for (const m of text.matchAll(WORD)) {
    if (/^[A-Z]/.test(m[0]) && !atSentenceStart(text, m.index)) names.add(m[0].toLowerCase().replace(/’s$|'s$/, ""));
  }
  const out = new Map();
  for (const m of text.matchAll(WORD)) {
    const form = m[0].replace(/(?:'|’)s$/, "");
    if (form.length < 4 || /^[A-Z]{2,}/.test(form)) continue;            // short words, acronyms
    if (names.has(form.toLowerCase())) continue;                          // names of people and places
    const { lem, z } = hardness(form);
    if (z >= threshold || skip.has(lem) || out.has(lem)) continue;
    const { from, to } = sentenceAround(text, m.index);
    out.set(lem, { key: lem, form, zipf: z, before: text.slice(from, m.index), after: text.slice(m.index + form.length, to) });
  }
  return [...out.values()];
}

// What a student sees before answering must not give the answer away: the word asked about in
// "what does the word X most nearly mean" and the answer choices themselves are left out.
export function spoilerWords(q) {
  const skip = new Set();
  const target = plain(q.prompt).match(/the word ["“]([^"”]+)["”]/i);
  if (target) skip.add(lemma(target[1]));
  if (/words in context/i.test(q.skill)) {
    for (const c of q.choices || []) for (const w of plain(c).match(WORD) || []) skip.add(lemma(w));
  }
  return skip;
}

export const passageText = (q) => q.stem.map(plain).join("\n");

// Deck cards for hard passage words across all questions.
export function buildTextDeck(questions, threshold) {
  const deck = new Map();
  for (const q of questions) {
    for (const h of hardWordsIn(passageText(q), threshold, spoilerWords(q))) {
      const card = deck.get(h.key) || {
        key: h.key, term: h.key, def: null, examples: [], qids: [], role: "text", src: "auto", qnum: q.n, zipf: h.zipf,
      };
      if (!card.qids.includes(q.id)) card.qids.push(q.id);
      if (card.examples.length < 3) {
        card.examples.push({ before: h.before, term: h.form, after: h.after, qid: q.id, n: q.n, kind: "passage", safe: true });
      }
      deck.set(h.key, card);
    }
  }
  return [...deck.values()];
}

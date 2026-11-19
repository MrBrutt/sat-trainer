// Hard words in passages and answer choices. A word counts as hard when it is rarer in everyday
// English than the learner's level (Zipf frequency). Frequencies: wordfreq by Robyn Speer,
// CC BY-SA 4.0 — assets/data/en-zipf.txt (built by scripts/build_wordfreq.py).
// Definitions: assets/data/defs.txt, written for this trainer.
import { plain } from "./parser.js";
import { termKey, stripArticle } from "./vocab.js";
import { domainOf } from "./domains.js";
import { OBVIOUS } from "./obvious-words.js";

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
  else if (/(?:ss|us|x|z|ch|sh)es$/.test(w)) r = pick(w.slice(0, -2), w.slice(0, -1));   // classes, boxes, buses
  else if (/ses$/.test(w)) r = pick(w.slice(0, -1), w.slice(0, -2));                   // senses → sense
  else if (/[^su']s$/.test(w)) r = pick(w.slice(0, -1));                              // not "glass", "virus"
  else if (/ed$/.test(w)) r = verb(w.slice(0, -2));
  else if (/ing$/.test(w)) r = verb(w.slice(0, -3));
  // a rare plural the list does not know: "exoplanets", "magpies", "platypuses"
  if (!r && w.length > 5 && !freq.has(w)) {
    r = /[ctrglnmd]ies$/.test(w) ? w.slice(0, -3) + "y"            // insufficiencies; but magpies, wrasses
      : /(?:us|x|z|ch|sh)es$/.test(w) ? w.slice(0, -2) : /[^su']s$|sses$/.test(w) ? w.slice(0, -1) : null;
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
  const common = (w) => (OBVIOUS.has(w) || OBVIOUS.has(lemma(w)) ? Infinity : Math.max(zipf(w), zipf(lemma(w))));
  const z = OBVIOUS.has(low) ? Infinity : Math.min(...parts.map(common));
  return { low, lem: parts.length > 1 ? low : lem, z };
}

// A hyphenated word is learned by its hard parts: "subduction-like" by "subduction", "whitefly-infested"
// by "whitefly" and "infest" (2026-11-18: a card of its own only repeated the word's card). Set
// expressions, whose meaning is not their hard part's ("tailor-made" is not about tailors), keep a
// card of their own; so do words whose hard part is too short to be a card ("awe-inspiring").
const WHOLE = new Set(["tailor-made", "fully-fledged", "full-fledged", "hunter-gatherer", "hunter-gatherers", "peer-reviewed",
  "hook-and-eye", "dare-devil", "smooth-hound", "look-alike", "terra-cotta", "orb-weaver", "awe-inspiring"]);
// Prefixes are no words of their own: "socio-political", "non-indigenous", "self-governance".
const PREFIX = /^(?:anti|semi|multi|inter|intra|ultra|pseudo|quasi|proto|micro|macro|mega|socio|trans|neo|mid|non|pre|post|self|cross|counter|over|under|super|sub|extra|bio|geo|eco)$/i;

// A word made from another word of the deck is learned on that word's card: attributable on attribute,
// precisely and precision on precise (2026-11-18: two cards repeated one word). The question's sentence
// keeps the form it has. Families whose meanings part stay two cards: elevation (height) and elevate,
// sustainable and sustain, tension and tense, proposition and propose, obligation and oblige.
// A Words in Context choice keeps its exact form, so pairs whose derived word is such a choice
// (predatory, probability, situated, discernible) are left out: the base would be a second card.
export const DERIVED = Object.fromEntries(`
  precision,precisely>precise plausibility,plausibly>plausible spatiality,spatially>spatial deliberately,deliberation>deliberate
  posited,positing>posit vigorous,vigorously>vigor acceleration>accelerate accomplishment>accomplish admiration>admire
  adoption>adopt adviser>advise alignment>align alteration>alter alternately>alternate approximation>approximate assertion>assert
  attraction>attract attributable>attribute breezy>breeze carver>carve comparably>comparable comparatively>comparative
  complication>complicate conclusively>conclusive conspicuously>conspicuous conversely>converse delicately>delicate
  departure>depart dependence>depend depiction>depict deposition>deposit descendant>descend deviation>deviate
  dismissive>dismiss disproportionately>disproportionate disruption>disrupt emergence>emerge
  employer>employ endurance>endure evaluation>evaluate extinction>extinct fittingly>fitting flexibility>flexible
  generalism>generalist governance>govern healer>heal herbivory>herbivorous inconsistency>inconsistent indirectly>indirect
  inherently>inherent insightful>insight insufficiency>insufficient irreversibility>irreversible mildness>mild notably>notable
  outcompeting>outcompete partially>partial persistent>persist porous>pore prediction>predict
  preservation>preserve prevalence>prevalent promptly>prompt protogynous>protogyny
  reevaluated>reevaluate refinement>refine refutation>refute rejection>reject reluctance>reluctant resemblance>resemble
  resilience>resilient restrictive>restrict robustness>robust scholarly>scholar simultaneously>simultaneous
  speculative>speculate stiffer>stiff subduct>subduction superficially>superficial susceptibility>susceptible
  sustainably>sustainable torsional>torsion tribal>tribe
  inevitably>inevitable exclusively>exclusive substantially>substantial inexplicably>inexplicable
  appropriateness>appropriate corroboration>corroborate diverged>diverge unpretentiousness>unpretentious
`.trim().split(/\s+/)
  .flatMap((pair) => { const [forms, base] = pair.split(">"); return forms.split(",").map((f) => [f, base]); }));

// Words the passage explains where they stand are no cards there (2026-11-18): a definition in
// parentheses right after the word, «cygnets (young swans)»; one between two dashes, «dwarfs—small,
// dense remnants of past stars—»; «—that is,» after it; «known as» or «called» before it. An aside
// in parentheses, «(as is often the case)», «(e.g., …)», or a Latin name, «(Cygnus atratus)», explains
// nothing. Only that place is skipped: where the word stands unexplained, it is a card as before.
const NOT_A_DEFINITION = new RegExp(String.raw`^(?:e\.\s?g\.|i\.\s?e\.|\d)|^(?:as|such|see|which|who|whose|where|reported|including|especially|often|sometimes|usually|for|in|at|on|about|approximately|roughly|around|and|or|but|if|though|although|despite|not|also|now|then|from|by|with|between|this|that|these|those|its|their|his|her|our|more|less|only|some|many|all|nearly|perhaps|so|unlike|relative|rather|genus|species|family)\b|^(?:the|an?)\s+\p{Lu}|\betc\.|^(?:\w+\s)?(?:meters?|kilometers?|centimeters?|millimeters?|grams?|kilograms?|nanograms?|micrograms?|pounds?|ounces?|percent|degrees?|years?|days?|hours?|minutes?|seconds?|kit)\b`, "iu");
export function explainedAt(text, i, len) {
  const after = text.slice(i + len, i + len + 160);
  const before = text.slice(Math.max(0, i - 30), i);
  const paren = after.match(/^s?\s*\(([^()]{2,120})\)/);
  if (paren && /^\p{Ll}/u.test(paren[1]) && !NOT_A_DEFINITION.test(paren[1]) && paren[1].split(/\s+/).length <= 15) return true;
  const dashes = after.match(/^s?\s*[—–]\s*([^—–.;!?]{3,120}?)\s*[—–]/);
  if (dashes && /^\p{Ll}/u.test(dashes[1]) && !NOT_A_DEFINITION.test(dashes[1])) return true;
  if (/^s?\s*[—–,(]\s*(?:that is|i\.\s?e\.)/i.test(after)) return true;
  return /(?:\bknown as|(?<!so-)\bcalled|\btermed|\breferred to as|\bdubbed)\s+(?:the\s+|an?\s+)?["“]?$/i.test(before);
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
    const whole = hardness(form);
    if (skip.has(whole.lem)) continue;
    // [text, where it starts]: the word itself, or the hard parts of a hyphenated one
    const pieces = !form.includes("-") || WHOLE.has(whole.low) ? [[form, m.index]] : [];
    if (!pieces.length) {
      let at = m.index;
      for (const [k, part] of form.split("-").entries()) {
        const i = at;
        at += part.length + 1;
        if (part.length < 4 || PREFIX.test(part) || (k > 0 && /^\p{Lu}/u.test(part)) || names.has(part.toLowerCase())) continue;
        pieces.push([part, i]);
      }
    }
    for (const [piece, i] of pieces) {
      const { lem, z } = piece === form ? whole : hardness(piece);
      const key = DERIVED[lem] || lem;
      if (z >= threshold || skip.has(lem) || skip.has(key) || out.has(key) || explainedAt(text, i, piece.length)) continue;
      const { from, to } = sentenceAround(text, i);
      out.set(key, { key, form: piece, zipf: z, before: text.slice(from, i), after: text.slice(i + piece.length, to) });
    }
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
  if (domainOf(q) === "Standard English Conventions") return [];    // grammar: what the words mean is not the point
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

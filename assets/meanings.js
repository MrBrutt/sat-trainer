// "Word → pick its meaning": the four meanings shown for a word, in the check before a question
// and on the cards.
import { defsPool } from "./words.js";

export const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
export const posOf = (p) => (p || "").split(/[./]/)[0];

// A meaning shown as an option looks like all the others: no part of speech in front ("noun: The
// state of…", "v. to give; n. the amount"), only the first meaning or part of speech, a small first
// letter, no full stop. A dictionary meaning (`dictionary`) is also cut to the length of the
// trainer's own: they run to 70 characters, a longer option would be the answer.
const POS = { noun: "n.", verb: "v.", adjective: "adj.", adverb: "adv." };
// meanings saved from Wiktionary before its <style> was dropped, some cut at 220 characters
// in the middle of the style
export const noStyles = (d) => d.replace(/\s*\.mw-parser-output[^}]*(?:\}|…?$)/g, "").trim();
const MAX = 70;
export function plainMeaning(def, pos = "", dictionary = false) {
  let d = noStyles(String(def || "").split(" · ")[0]);
  const m = d.match(/^(noun|verb|adjective|adverb|proper noun|pronoun|preposition|conjunction|interjection|phrase|prepositional phrase|idiom):\s*/i);
  if (m) { d = d.slice(m[0].length); pos = pos || POS[m[1].toLowerCase()] || ""; }
  // the trainer's meaning for two parts of speech: "v. to give; n. the amount produced"
  const label = d.match(/^(adj|n|v|adv)\.\s+/);
  if (label) { d = d.slice(label[0].length).split(/;\s*(?:adj|n|v|adv)\.\s/)[0]; pos = `${label[1]}.`; }
  if (dictionary && d.length > MAX) {
    const head = d.slice(0, MAX);
    const stop = Math.max(head.lastIndexOf(";"), head.lastIndexOf(","));
    d = stop > 15 ? head.slice(0, stop) : `${head.slice(0, head.lastIndexOf(" "))}…`;
  }
  d = d.replace(/\.$/, "").trim();
  if (/^[A-Z][a-z]/.test(d)) d = d[0].toLowerCase() + d.slice(1);
  return { def: d, pos };
}

// A meaning that can stand as a wrong option. Meanings that name their part of speech ("adj. main;
// n. the head of a school") or a word's form ("past participle of eat", "British spelling of…")
// would stand out as plainly not the answer.
export const fitsAsWrong = (d) => !/^(?:adj|n|v|adv)\.\s/.test(d) && !/\b(?:spelling|participle|plural|past|form) of\b/i.test(d);

// The trainer's meanings to draw wrong ones from.
export const meaningPool = () => shuffle(defsPool().filter((x) => fitsAsWrong(x.d)));

// Three wrong meanings: one of another choice of the same question (telling them apart is the
// point), the rest from words of the same part of speech.
export function meaningOptions(card, siblings, pool) {
  const wrong = [];
  const used = new Set([card.def]);
  const take = (d) => { if (d && !used.has(d) && wrong.length < 3) { used.add(d); wrong.push(d); } };
  for (const c of shuffle(siblings).slice(0, 1)) take(c.def);
  const from = Math.floor(Math.random() * pool.length);     // a different stretch of the pool for every word
  const around = pool.slice(from).concat(pool.slice(0, from));
  for (const x of around) if (posOf(x.p) === posOf(card.pos)) take(x.d);
  for (const x of around) take(x.d);
  return shuffle([card.def, ...wrong]);
}

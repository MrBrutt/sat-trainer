// Vocabulary: builds a word deck from "Words in Context" questions and schedules reviews.
import { plain } from "./parser.js";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const termKey = (t) => t.trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ");

const ABBREV = /(?:\b[A-Z]|\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|etc|al|e\.g|i\.e|U\.S|ca|No))\.$/;

function sentences(text) {
  const parts = text.split(/(?<=[.!?][”"’)]?)\s+(?=[“"(]?[A-Z])/);
  const out = [];
  for (const p of parts) {
    // "W.E.B. Du Bois", "et al. modeled" are not sentence ends
    if (out.length && ABBREV.test(out[out.length - 1])) out[out.length - 1] += " " + p;
    else out.push(p);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

export const stripArticle = (t) => t.trim().replace(/^(?:an?|the)\s+/i, "");

// Context sentence for a word the user picked themselves.
export function makeExample(text, term, extra) {
  return example(sentenceWith(text, term), term, extra);
}

function sentenceWith(text, term) {
  for (const form of new Set([term.trim(), stripArticle(term)])) {
    const re = new RegExp(`\\b${esc(form).replace(/\s+/g, "\\s+")}\\b`, "i");
    const hit = sentences(text).find((s) => re.test(s));
    if (hit) return hit;
  }
  return null;
}

// Splits a sentence around the term so the UI can highlight it.
function example(sentence, term, extra) {
  if (!sentence) return null;
  const re = new RegExp(`\\b(?:${esc(term.trim()).replace(/\s+/g, "\\s+")}|${esc(stripArticle(term)).replace(/\s+/g, "\\s+")})\\b`, "i");
  const m = sentence.match(re);
  if (!m) return { before: sentence, term: "", after: "", ...extra };
  return { before: sentence.slice(0, m.index), term: m[0], after: sentence.slice(m.index + m[0].length), ...extra };
}

// Every answer choice of a "Words in Context" question becomes a card, and so does the word asked
// about in "what does the word X most nearly mean". Definitions come from assets/data/defs.txt.
// Sentences from a question are examples only once it is answered (the UI hides them before).
export function buildDeck(questions) {
  const deck = new Map();
  const add = (term, data) => {
    term = stripArticle(term);
    const key = termKey(term);
    if (!key || key.length > 40) return;
    const card = deck.get(key) || { key, term, def: null, examples: [], qids: [], role: "distractor", src: "auto", qnum: data.n };
    if (data.example && !card.examples.some((e) => e.before + e.term + e.after === data.example.before + data.example.term + data.example.after)) {
      card.examples.push(data.example);
    }
    if (!card.qids.includes(data.qid)) card.qids.push(data.qid);
    if (data.role === "answer" || data.role === "target") card.role = data.role;
    deck.set(key, card);
  };

  for (const q of questions) {
    if (!/words in context/i.test(q.skill) || !q.choices.length) continue;
    const stemText = q.stem.map(plain).join(" ");
    const target = plain(q.prompt).match(/the word ["“]([^"”]+)["”]/i);
    if (target) {
      // "As used in the text, what does the word X most nearly mean?"
      const word = target[1];
      add(word, { example: example(sentenceWith(stemText, word), word, { qid: q.id, n: q.n, kind: "passage" }), qid: q.id, n: q.n, role: "target" });
    }
    for (const c of q.choices) {
      const term = plain(c).trim();
      if (!term || term.split(/\s+/).length > 4) continue;
      let ex = null;
      if (!target && c.letter === q.correct) {
        // the passage sentence with the blank filled in
        const blankSentence = sentences(stemText).find((s) => /_{3,}/.test(s));
        if (blankSentence) {
          const [b, ...rest] = blankSentence.split(/_{3,}/);
          ex = { before: b, term, after: rest.join("____"), qid: q.id, n: q.n, kind: "passage" };
        }
      }
      add(term, { example: ex, qid: q.id, n: q.n, role: c.letter === q.correct ? "answer" : "distractor" });
    }
  }
  return [...deck.values()];
}

// ---------------------------------------------------------------- spaced repetition (SM-2 style)

const DAY = 86400000;
export const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const MASTERED_DAYS = 21;

export function newState() {
  return { due: 0, ivl: 0, ease: 2.5, reps: 0, lapses: 0, last: 0 };
}

const AGAIN = 60_000;              // "не помню": back in this session after a minute
const HARD_STEP = 10 * 60_000;     // "сложно" on a new or forgotten card: back in this session after 10 minutes

// Days until the next review after "hard", "good" and "easy". Each waits longer than the one before:
// after "easy" on first sight (4 days) "hard" scales those 4 days, so "good" must not stay at 3.
// A new or forgotten card (reps 0) has no "hard" in days: it comes back in this session instead.
function intervals(s) {
  if (s.reps === 0) return { hard: 0, good: 1, easy: 4 };
  const hard = Math.max(1, Math.round(s.ivl * 1.2));
  const good = Math.max(hard + 1, s.reps === 1 ? 3 : Math.round(s.ivl * s.ease));
  const easy = Math.max(good + 1, Math.round(s.ivl * s.ease * 1.3));
  return { hard, good, easy };
}

// grade: 1 again, 2 hard, 3 good, 4 easy
export function schedule(st, grade, now = Date.now()) {
  const s = { ...(st || newState()) };
  s.last = now;
  if (grade === 1) {
    s.lapses += s.reps > 0 ? 1 : 0;
    s.reps = 0;
    s.ivl = 0;
    s.ease = Math.max(1.3, s.ease - 0.2);
    s.due = now + AGAIN;
    return s;
  }
  if (grade === 2 && s.reps === 0) {
    s.ivl = 0;
    s.due = now + HARD_STEP;
    return s;
  }
  const next = intervals(s);
  if (grade === 2) {
    s.ivl = next.hard;
    s.ease = Math.max(1.3, s.ease - 0.15);
  } else if (grade === 3) {
    s.ivl = next.good;
  } else {
    s.ivl = next.easy;
    s.ease += 0.15;
  }
  s.reps += 1;
  s.due = startOfDay(now) + s.ivl * DAY;
  return s;
}

export function previewIntervals(st, now = Date.now()) {
  return [1, 2, 3, 4].map((g) => {
    const n = schedule(st, g, now);
    if (g === 1) return "<1 мин";
    return n.ivl ? fmtDays(n.ivl) : `${Math.round((n.due - now) / 60_000)} мин`;
  });
}

// The card to show next: the first in the queue that is not waiting out its minutes after
// "не помню" or "сложно". -1 when every card left is waiting.
export function readyIndex(queue, stOf, now = Date.now()) {
  return queue.findIndex((k) => { const st = stOf(k); return !(st?.last && st.due > now); });
}

// A word shown again in this session goes `gap` cards back (to the end of a shorter queue).
export function requeue(queue, key, gap) {
  const q = queue.filter((k) => k !== key);
  q.splice(Math.min(gap, q.length), 0, key);
  return q;
}

export function fmtDays(d) {
  if (d < 1) return "сегодня";
  if (d < 30) return `${d} д`;
  if (d < 365) return `${Math.round(d / 30)} мес`;
  return `${(d / 365).toFixed(1)} г`;
}

export function statusOf(st, known) {
  if (known) return "known";
  if (!st || (!st.reps && !st.last)) return "new";
  return st.ivl >= MASTERED_DAYS ? "mastered" : "learning";
}

// ---------------------------------------------------------------- dictionary fallback
// Used for words the trainer has no definition for (e.g. a word the student adds).
// Only the word itself is sent. Returns a string, null (no entry anywhere) or undefined (network trouble — try later).

async function getJson(url, ms = 7000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

const textOf = (html) => new DOMParser().parseFromString(html, "text/html").body.textContent.replace(/\s+/g, " ").trim();
const FORM_OF = /^(?:(?:simple\s+)?past(?:\s+tense)?|past\s+participle|present\s+participle|third-person\s+singular[\w\s-]*|plural|comparative|superlative)[^.]*?\bof\s+([A-Za-z-]+)/i;

async function wiktionary(word, depth = 0, preferPos = null) {
  const data = await getJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
  if (!data) return null;
  const defs = [];
  const entries = [...(data.en || [])];
  if (preferPos) entries.sort((a, b) => (b.partOfSpeech === preferPos) - (a.partOfSpeech === preferPos));
  for (const entry of entries) {
    const d = (entry.definitions || []).map((x) => textOf(x.definition || "")).find((t) => t.length > 1);
    if (!d) continue;
    const form = d.match(FORM_OF);
    if (form && depth === 0 && !defs.length) {
      const kind = form[0].toLowerCase();
      const pos = /plural/.test(kind) ? "Noun" : /comparative|superlative/.test(kind) ? "Adjective" : "Verb";
      const base = await wiktionary(form[1], 1, pos);
      if (base) return `${base} (форма слова ${form[1]})`;
    }
    defs.push(`${entry.partOfSpeech ? entry.partOfSpeech.toLowerCase() + ": " : ""}${d}`);
    // a second meaning only when the first one is short
    if (defs.length >= 2 || defs[0].length > 70) break;
  }
  return defs.length ? defs.join(" · ") : null;
}

let freeDictionaryDown = false;
async function freeDictionary(word) {
  if (freeDictionaryDown) throw new Error("down");
  let data;
  try { data = await getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, 5000); }
  catch (e) { freeDictionaryDown = true; throw e; }
  const m = data?.[0]?.meanings?.[0];
  const d = m?.definitions?.[0]?.definition;
  return d ? `${m.partOfSpeech ? m.partOfSpeech + ": " : ""}${d}` : null;
}

export async function lookup(term) {
  const t = term.trim().toLowerCase();
  // "subsumed in" -> also try "subsumed"; "an arduous" -> "arduous"
  const tries = [...new Set([t, stripArticle(t), stripArticle(t).replace(/\s+(?:in|of|to|by|with|from|for|among|about|toward|on|as|at)$/i, "")])];
  let networkTrouble = false;
  for (const source of [wiktionary, freeDictionary]) {
    for (const w of tries) {
      try {
        const d = await source(w);
        if (d) return d.length > 220 ? d.slice(0, 217) + "…" : d;
      } catch {
        // Wiktionary is the primary source; a dead fallback alone is not "offline"
        if (source === wiktionary) networkTrouble = true;
      }
    }
  }
  return networkTrouble ? undefined : null;
}

// Vocabulary: builds a word deck from "Words in Context" questions and schedules reviews.
import { plain } from "./parser.js";

const Q = `["“”]`;                     // straight or curly quote
const NOT_Q = `[^"“”]`;
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

function cleanDef(d) {
  if (!d) return null;
  d = d.trim()
    .replace(/^that\s+/i, "")
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\s,;:—–-]+$/, "")
    .replace(/\.$/, "");
  if (d.length < 2 || d.length > 160) return null;
  // explanations of why a choice fails are not definitions
  if (/n[’']t\b|\bmake sense\b|\bthe text\b|\bthe author\b/i.test(d)) return null;
  if (/^(?:they|it|he|she|this|these|those|there|we)\b/i.test(d)) return null;
  return d;
}

// Keeps "carried out, entrusted, or promised" together but stops before ", until researchers found …".
function trimClause(s) {
  const parts = s.split(/,\s+/);
  let out = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i], words = p.split(/\s+/).length;
    const listItem = /^or\s/i.test(p) ? words <= 6 : words <= 3 && i + 1 < parts.length && /^or\s/i.test(parts[i + 1]);
    if (!listItem) break;
    out += ", " + p;
  }
  return out;
}

export const stripArticle = (t) => t.trim().replace(/^(?:an?|the)\s+/i, "");

// Finds College Board's own gloss for a term inside rationale text.
export function findDefinition(term, text) {
  for (const form of new Set([term.trim(), stripArticle(term)])) {
    const d = glossFor(form, text);
    if (d) return d;
  }
  return null;
}

function glossFor(term, text) {
  const t = esc(term).replace(/\s+/g, "\\s+");
  const qt = `${Q}${t}[,.]?${Q}`;
  const END = `[^.;—–]+`;
  const person = new RegExp(`(?:A\\s+person|Someone)\\s+who\\s+is\\s+${qt}\\s+(${END})`, "i");
  const patterns = [
    // In this context, "inertia" means a tendency …  /  "appropriate," which means suitable
    new RegExp(`${qt}\\s*,?\\s*(?:which\\s+)?(?:in\\s+this\\s+context\\s+)?(?:would\\s+)?(?:most\\s+nearly\\s+)?means?\\s+(${END})`, "i"),
    // "desultory," which in this context would mean …
    new RegExp(`${qt}\\s*,?\\s*which\\s+[^.]{0,30}?mean\\s+(${END})`, "i"),
    // "spurious," or false, …   /   "a contentious" one, or one causing controversy
    new RegExp(`${qt}(?:\\s+one)?\\s*,?\\s+or\\s+(?:that\\s+)?(${END})`, "i"),
    // subsumed in (meaning included in)
    new RegExp(`(?:${qt}|\\b${t})\\s*\\((?:meaning|i\\.e\\.,?)\\s+([^)]+)\\)`, "i"),
    // "a discernible" explanation—meaning an explanation capable of …
    new RegExp(`${qt}[^.]{0,30}?[—–-]\\s*meaning\\s+(${END})`, "i"),
    // "summations" would be final conclusions …  /  "deterrents to" something would mean …
    new RegExp(`${qt}(?:\\s+(?:something|someone|one|\\w+))?\\s+would\\s+(?:most\\s+nearly\\s+)?(?:mean|be|suggest)\\s+(?!that\\b)(${END})`, "i"),
    // A person who is "dogmatic" believes strongly …
    person,
    // A scheme is a plan or systematic arrangement …  /  "Succinctly" describes …
    new RegExp(`(?:^|[.!?]\\s+)(?:An?\\s+|The\\s+)?${Q}?${t}${Q}?\\s+(?:is|are|means|describes)\\s+(${END})`, "i"),
    // "an inconclusive" explanation—an explanation that does not resolve …
    new RegExp(`${qt}(?:\\s+\\w+)?\\s*[—–]\\s*(an?\\s+${END})`, "i"),
    // "to say … was "approximate" would mean that …"
    new RegExp(`${qt}\\s+would\\s+(?:most\\s+nearly\\s+)?mean\\s+(${END})`, "i"),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    const d = m && cleanDef(trimClause(m[1]));
    if (d) return re === person ? `someone who ${d}` : d;
  }
  return null;
}

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

export function buildDeck(questions) {
  const deck = new Map();
  const add = (term, data) => {
    term = stripArticle(term);
    const key = termKey(term);
    if (!key || key.length > 40) return;
    const card = deck.get(key) || { key, term, def: null, examples: [], qids: [], role: "distractor", src: "auto", qnum: data.n };
    if (!card.def && data.def) card.def = data.def;
    if (data.example && !card.examples.some((e) => e.before + e.term + e.after === data.example.before + data.example.term + data.example.after)) {
      card.examples.push(data.example);
    }
    if (!card.qids.includes(data.qid)) card.qids.push(data.qid);
    if (data.role === "answer" || data.role === "target") card.role = data.role;
    deck.set(key, card);
  };

  for (const q of questions) {
    if (!/words in context/i.test(q.skill) || !q.choices.length) continue;
    const rat = q.rationale.map(plain).join(" ");
    const stemText = q.stem.map(plain).join(" ");
    const prompt = plain(q.prompt);
    const target = prompt.match(/the word ["“]([^"”]+)["”]/i);

    if (target) {
      // "As used in the text, what does the word X most nearly mean?"
      const word = target[1];
      const answer = q.choices.find((c) => c.letter === q.correct);
      const ex = example(sentenceWith(stemText, word), word, { qid: q.id, n: q.n, kind: "passage" });
      const meaning = answer ? plain(answer).replace(/^./, (ch) => ch.toLowerCase()) : null;
      add(word, { def: meaning ? `в этом тексте ≈ ${meaning}` : findDefinition(word, rat), example: ex, qid: q.id, n: q.n, role: "target" });
      continue;
    }

    for (const c of q.choices) {
      const term = plain(c).trim();
      if (!term || term.split(/\s+/).length > 4) continue;
      const def = findDefinition(term, rat);
      let ex;
      if (c.letter === q.correct) {
        // the passage sentence with the blank filled in
        const blankSentence = sentences(stemText).find((s) => /_{3,}/.test(s));
        ex = blankSentence
          ? (() => { const [b, ...rest] = blankSentence.split(/_{3,}/); return { before: b, term, after: rest.join("____"), qid: q.id, n: q.n, kind: "passage" }; })()
          : null;
      } else {
        ex = example(sentenceWith(rat, term), term, { qid: q.id, n: q.n, kind: "rationale" });
      }
      add(term, { def, example: ex, qid: q.id, n: q.n, role: c.letter === q.correct ? "answer" : "distractor" });
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

// grade: 1 again, 2 hard, 3 good, 4 easy
export function schedule(st, grade, now = Date.now()) {
  const s = { ...(st || newState()) };
  s.last = now;
  if (grade === 1) {
    s.lapses += s.reps > 0 ? 1 : 0;
    s.reps = 0;
    s.ivl = 0;
    s.ease = Math.max(1.3, s.ease - 0.2);
    s.due = now + 60_000;            // comes back later in the same session
    return s;
  }
  if (grade === 2) {
    s.ivl = s.reps === 0 ? 1 : Math.max(1, Math.round(s.ivl * 1.2));
    s.ease = Math.max(1.3, s.ease - 0.15);
  } else if (grade === 3) {
    s.ivl = s.reps === 0 ? 1 : s.reps === 1 ? 3 : Math.max(s.ivl + 1, Math.round(s.ivl * s.ease));
  } else {
    s.ivl = s.reps === 0 ? 4 : Math.max(s.ivl + 2, Math.round(s.ivl * s.ease * 1.3));
    s.ease += 0.15;
  }
  s.reps += 1;
  s.due = startOfDay(now) + s.ivl * DAY;
  return s;
}

export function previewIntervals(st, now = Date.now()) {
  return [1, 2, 3, 4].map((g) => {
    const n = schedule(st, g, now);
    return g === 1 ? "<1 мин" : fmtDays(n.ivl);
  });
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

// Russian translations from Wiktionary's translation tables (first sense first), stress marks removed.
async function wiktionaryRu(word) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`https://en.wiktionary.org/api/rest_v1/page/html/${encodeURIComponent(word)}`, { signal: ctl.signal });
    if (!r.ok) return null;
    const doc = new DOMParser().parseFromString(await r.text(), "text/html");
    const out = [];
    for (const el of doc.querySelectorAll('[lang="ru"]')) {
      const t = el.textContent.normalize("NFD").replace(/\u0301/g, "").normalize("NFC").trim();
      if (/[а-яё]/i.test(t) && t.length < 40 && !out.includes(t)) out.push(t);
      if (out.length >= 4) break;
    }
    return out.length ? out.join(", ") : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Definition (and, when Wiktionary has one, a Russian translation) for a word: {d, ru} | null | undefined.
export async function lookupWithRu(term) {
  const d = await lookup(term);
  if (!d) return d;
  const base = (d.match(/\(форма слова ([A-Za-z-]+)\)$/) || [])[1] || stripArticle(term.trim().toLowerCase());
  return { d, ru: await wiktionaryRu(base) };
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

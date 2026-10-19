import { parseQuestionBank, openPdf, renderRegion, plain } from "./parser.js";
import { createVocab, VOCAB_DEFAULT } from "./vocab-ui.js";
import { createAssistant } from "./assistant.js";
import { createToday, ACTIVITY_DEFAULT, enqueueReview, gradeReview, isDue, REVIEW_DAYS, dayKey } from "./today.js";
import { createTimer, fmtTime, paceFor } from "./timer.js";
import { createPrep } from "./prep.js";
import { toB64, fromB64 } from "./bytes.js";
import { createAccount } from "./account.js";

const app = document.getElementById("app");
const $ = (s, el = document) => el.querySelector(s);

const SET_VERSION = 2; // bump when the parser output changes; stored sets are rebuilt from the saved PDF
const KEY = {
  progress: "sat-trainer:progress:v1",
  flags: "sat-trainer:flags:v1",
  ui: "sat-trainer:ui:v1",
  theme: "sat-trainer:theme",
  vocab: "sat-trainer:vocab:v1",
  dict: "sat-trainer:dict:v1",
  chats: "sat-trainer:chats:v1",
  review: "sat-trainer:review:v1",
  activity: "sat-trainer:activity:v1",
  timing: "sat-trainer:timing:v1",
  aiTier: "sat-trainer:ai-tier",
};
const PALETTE = ["#3b82f6", "#14b8a6", "#8b5cf6", "#f59e0b", "#ec4899", "#22c55e", "#ef4444", "#0ea5e9", "#a855f7", "#84cc16"];
// College Board's own ordering of Reading and Writing skills
const SKILL_ORDER = [
  "Central Ideas and Details", "Command of Evidence", "Inferences",
  "Words in Context", "Text Structure and Purpose", "Cross-Text Connections",
  "Rhetorical Synthesis", "Transitions", "Boundaries", "Form, Structure, and Sense",
];
const DIFF_LEVEL = { easy: 1, medium: 2, hard: 3 };
const DIFF_RU = { easy: "Лёгкие", medium: "Средние", hard: "Сложные" };

// ---------------------------------------------------------------- storage

// Sections of data that also live in the student's account: saving one here tells the account.
const SYNCED = { [KEY.progress]: "progress", [KEY.review]: "review", [KEY.flags]: "flags", [KEY.vocab]: "vocab", [KEY.activity]: "activity" };
let account = null;

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
    if (SYNCED[k]) account?.notify(SYNCED[k]);
  },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

const db = {
  open() {
    return (this._p ||= new Promise((res, rej) => {
      const r = indexedDB.open("sat-trainer", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  },
  async tx(mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction("kv", mode);
      const out = fn(t.objectStore("kv"));
      t.oncomplete = () => res(out && "result" in out ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  },
  get(k) { return this.tx("readonly", (s) => s.get(k)); },
  set(k, v) { return this.tx("readwrite", (s) => s.put(v, k)); },
  clear() { return this.tx("readwrite", (s) => s.clear()); },
  del(k) { return this.tx("readwrite", (s) => s.delete(k)); },
};

const S = {
  set: null,
  progress: ls.get(KEY.progress, {}),          // id -> { c, ok, t, revealed? }
  flags: new Set(ls.get(KEY.flags, [])),
  ui: Object.assign({ skill: "all", status: "all", cur: null, original: {}, view: "questions", vtab: "study", vfilter: "all", vq: "" }, ls.get(KEY.ui, {})),
  vocab: Object.assign(VOCAB_DEFAULT(), ls.get(KEY.vocab, {})),
  review: ls.get(KEY.review, {}),              // id -> spaced review of a mistake
  activity: Object.assign(ACTIVITY_DEFAULT(), ls.get(KEY.activity, {})),
  attempt: {},                                 // answers given while reviewing (this visit)
  session: null,                               // current flashcard session
  struck: {},                                  // id -> Set of crossed-out letters (this session)
  explainOpen: {},
  anim: null,
  pdfs: new Map(),                             // opened PDFs by source, for the original view
};
const saveProgress = () => ls.set(KEY.progress, S.progress);
const saveFlags = () => ls.set(KEY.flags, [...S.flags]);
const saveReview = () => ls.set(KEY.review, S.review);
const saveUi = () => ls.set(KEY.ui, { ...S.ui, vq: "" }); // search text is not kept between visits
S.ui.vq = "";

// ---------------------------------------------------------------- helpers

const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  rotate: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  dots: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  cards: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  list: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  sparkles: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  today: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  cloudCheck: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="m9.5 13.5 2 2 3.5-3.5"/>',
  cloudOff: '<path d="m2 2 20 20"/><path d="M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.2"/><path d="M21.53 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 10.5 5.1"/>',
};
const icon = (n, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
const LOGO = `<div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg></div>`;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function plural(n, one, few, many) {
  if (n % 10 === 1 && n % 100 !== 11) return one;
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) return few;
  return many;
}
const qWord = (n) => `${n} ${plural(n, "вопрос", "вопроса", "вопросов")}`;

function toast(msg) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.setAttribute("role", "status");
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2800);
}

function confirmDialog(title, text, okLabel, danger = false) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.innerHTML = `<h3>${esc(title)}</h3><p>${esc(text)}</p>
      <div class="row"><button class="btn btn-outline" value="cancel">Отмена</button>
      <button class="btn ${danger ? "btn-danger" : "btn-primary"}" value="ok">${esc(okLabel)}</button></div>`;
    document.body.append(d);
    d.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) d.close(b.value); });
    d.addEventListener("close", () => { resolve(d.returnValue === "ok"); d.remove(); });
    d.showModal();
  });
}

const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};

let ai = null;
const vocab = createVocab({
  S, $, icon, esc, toast, ls, KEY, plural, confirmDialog,
  saveUi: () => saveUi(),
  current: () => cur(),
  openQuestion: (id) => { S.ui.view = "questions"; saveUi(); renderTopbar(); go(id); },
  refreshChrome: () => renderTopbar(),
  ai: () => ai,
  inClaude: () => !!window.claude,   // inside claude.ai the page cannot reach other sites
  onWordDone: () => today.log("w"),
  refreshQuestion: () => { if (S.set && $("#main") && S.ui.view === "questions") renderQuestion(); },
  refreshTrainer: () => { if (S.set && $("#main") && S.ui.view === "questions") { renderSidebar(); renderQuestion(); } },
});
const prep = createPrep({
  S, esc, icon, plural, toast, vocab,
  answerOf: (q) => answerOf(q),
  current: () => cur(),
  refresh: (scrollTop) => { if (S.set && $("#main") && S.ui.view === "questions") { renderSidebar(); renderQuestion(scrollTop); } },
});
ai = createAssistant({
  S, $, icon, esc, toast, ls, KEY, confirmDialog,
  current: () => (S.set ? cur() : null),
  currentCardKey: () => vocab.currentKey(),
  vocabCard: (key) => vocab.card(key),
  answerOf: (id) => { const q = S.set?.questions.find((x) => x.id === id); return q ? answerOf(q) : null; },
  onAvailable: () => { if (S.set && $("#main")) renderAll(); },
  onThreadsChanged: () => { if (S.set && $("#main") && S.ui.view === "questions") renderQuestion(); },
});
const timer = createTimer({ ls, KEY, onTick: () => timerTick() });
const today = createToday({
  S, $, icon, esc, toast, ls, KEY, plural,
  vocabDue: () => vocab.dueTotal(),
  wordsStudied: () => vocab.studied(),
  readyCount: () => S.set.questions.filter(isReady).length,
  refreshChrome: () => renderTopbar(),
});
account = createAccount({
  ls, icon, esc, toast,
  data: {
    progress: { read: () => S.progress, write: (v) => { S.progress = v; saveProgress(); } },
    review: { read: () => S.review, write: (v) => { S.review = v; saveReview(); } },
    flags: { read: () => [...S.flags], write: (v) => { S.flags = new Set(v); saveFlags(); } },
    vocab: { read: () => S.vocab, write: (v) => { S.vocab = Object.assign(VOCAB_DEFAULT(), v); ls.set(KEY.vocab, S.vocab); vocab.invalidate(); vocab.resetSession(); } },
    activity: { read: () => S.activity, write: (v) => { S.activity = Object.assign(ACTIVITY_DEFAULT(), v); ls.set(KEY.activity, S.activity); } },
  },
  sets: {
    current: () => (S.set ? {
      list: Object.fromEntries(S.set.sources.map((s) => [s.id, { fileName: s.fileName, importedAt: s.importedAt }])),
      numbers: Object.fromEntries(S.set.questions.map((q) => [q.id, q.n])),
    } : null),
    have: () => ({ ids: S.set?.sources.map((s) => s.id) || [], numbers: Object.fromEntries((S.set?.questions || []).map((q) => [q.id, q.n])) }),
    stored: async (id) => { try { return (await db.get(pdfKey(id))) || null; } catch { return null; } },
    store: async (id, bytes) => { try { await db.set(pdfKey(id), bytes); } catch (e) { console.warn("IndexedDB unavailable", e); } },
    // questions from the account: on a new device they replace the start page
    install: async (list, numbers) => {
      const first = !S.set;
      if (first) showImporting();
      try {
        const set = await installSources(list, numbers, async (id) => { try { return await db.get(pdfKey(id)); } catch { return null; } }, { skills: S.set?.skills, label: "Загружаю вопросы" });
        if (!set) { if (first) showLanding(); return; }
        await saveSet(set, S.set);
        S.set = set;
        S.pdfs = new Map();
        if (first) { S.ui = { ...S.ui, skill: "all", status: "all", diff: "all", cur: null }; saveUi(); }
        showTrainer();
        if (first) toast(`Вопросы из аккаунта: ${qWord(set.questions.length)}`);
      } catch (e) {
        console.error(e);
        if (first) showLanding(importError(e));
      }
    },
  },
  // the account brought changes: redraw, but not under someone typing
  changed: () => {
    if (S.set && $("#main")) {
      if (document.activeElement?.matches("input, textarea")) renderTopbar(); else renderAll();
    } else if ($("#dz")) showLanding();
  },
});

// ---------------------------------------------------------------- rich text

function runsHtml(runs) {
  return runs.map((r) => {
    let h = esc(r.t)
      .replace(/_{3,}/g, '<span class="blank" role="img" aria-label="пропуск"></span>')
      .replace(/\n/g, "<br>");
    if (r.v === "sub") h = `<sub>${h}</sub>`;
    else if (r.v === "sup") h = `<sup>${h}</sup>`;
    if (r.i) h = `<em>${h}</em>`;
    if (r.b) h = `<strong>${h}</strong>`;
    if (r.u) h = `<u>${h}</u>`;
    return h;
  }).join("");
}

function stemHtml(q) {
  let html = "", verse = null, verseGap = 0;
  const flush = () => { if (verse) html += `<div class="verse">${verse}</div>`; verse = null; };
  for (const p of q.stem) {
    const t = plain(p).trim();
    if (p.indent) {
      // the first gap inside a verse block sets the normal line pitch; bigger gaps are stanza breaks
      if (verse === null) { verse = ""; verseGap = 0; }
      else if (!verseGap) verseGap = p.gap;
      const stanza = verseGap && p.gap > verseGap * 1.5;
      verse += `<p${stanza ? ' class="stanza"' : ""}>${runsHtml(p.runs)}</p>`;
      continue;
    }
    flush();
    if (/^Text \d+$/i.test(t)) { html += `<div class="text-label">${esc(t)}</div>`; continue; }
    const cls = /^The following text/i.test(t) ? ' class="intro"' : "";
    html += `<p${cls}>${runsHtml(p.runs)}</p>`;
  }
  flush();
  return html;
}

function sliceRuns(runs, a, b) {
  const out = [];
  let pos = 0;
  for (const r of runs) {
    const s = pos, e = pos + r.t.length;
    pos = e;
    if (e <= a || s >= b) continue;
    out.push({ ...r, t: r.t.slice(Math.max(0, a - s), Math.min(r.t.length, b - s)) });
  }
  if (out.length) {
    out[0].t = out[0].t.replace(/^\s+/, "");
    out[out.length - 1].t = out[out.length - 1].t.replace(/\s+$/, "");
  }
  return out.filter((r) => r.t);
}

const RE_CHOICE = /Choices? ([A-D])((?:(?:,\s*|\s+)(?:and\s+|or\s+)?[A-D])*)\s+(?:is|are)\s+(incorrect|the best answer|correct|the best)/g;

// Splits rationale paragraphs at "Choice X is …" sentences so each choice gets its own block.
function splitRationale(paras) {
  const items = [];
  for (const p of paras) {
    const t = plain(p);
    const cuts = [0];
    for (const m of t.matchAll(RE_CHOICE)) {
      if (m.index > 0 && /[.!?"”’)]\s+$/.test(t.slice(0, m.index))) cuts.push(m.index);
    }
    cuts.push(t.length);
    for (let k = 0; k < cuts.length - 1; k++) {
      const runs = sliceRuns(p.runs, cuts[k], cuts[k + 1]);
      if (!runs.length) continue;
      const seg = runs.map((r) => r.t).join("");
      RE_CHOICE.lastIndex = 0;
      const m = new RegExp("^" + RE_CHOICE.source).exec(seg);
      items.push(m
        ? { runs, letters: (m[1] + m[2]).match(/[A-D]/g), verdict: m[3] }
        : { runs, letters: null });
    }
  }
  return items;
}

function ratHtml(q) {
  let lastBest = false;
  return splitRationale(q.rationale).map((it) => {
    if (!it.letters) return `<div class="rat plain ${lastBest ? "best" : ""}"><p>${runsHtml(it.runs)}</p></div>`;
    lastBest = it.verdict !== "incorrect" && (!q.correct || it.letters.includes(q.correct));
    return `<div class="rat ${lastBest ? "best" : ""}">
      <div class="rat-badges">${it.letters.map((l) => `<span class="rat-badge">${l}</span>`).join("")}</div>
      <p>${runsHtml(it.runs)}</p></div>`;
  }).join("");
}

function diffBars(d) {
  const n = DIFF_LEVEL[String(d).toLowerCase()] || 0;
  return `<span class="diff" aria-hidden="true">${[1, 2, 3].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>`;
}

// ---------------------------------------------------------------- set preparation

// Questions from several PDF exports live in one set. Each PDF is stored separately (for the
// "original PDF" view); questions keep their number for good, new ones are numbered after the last.
const LEGACY = "legacy";                                   // the single PDF of sets made before multi-PDF
const pdfKey = (id) => (id === LEGACY ? "pdf" : `pdf:${id}`);
const sourceOf = (q) => q.src?.pdf || LEGACY;

function skillRank(name, firstSeen) {
  const k = SKILL_ORDER.findIndex((x) => x.toLowerCase() === name.toLowerCase());
  return k >= 0 ? k : 100 + (firstSeen.get(name) ?? 0);
}

function normalizeSet(set) {
  if (!set.sources) {
    set.sources = [{ id: LEGACY, fileName: set.fileName, importedAt: set.importedAt, count: set.questions.length, added: set.questions.length }];
  }
  return set;
}

function finishSet(questions, sources, oldSkills = []) {
  questions.sort((a, b) => a.n - b.n);
  const uniq = (k) => [...new Set(questions.map((q) => q[k]).filter(Boolean))];
  const first = new Map();
  questions.forEach((q, i) => { if (!first.has(q.skill)) first.set(q.skill, i); });
  // keep the colour a skill already had; new skills take colours nobody uses yet
  const colors = new Map(oldSkills.map((sk) => [sk.name, sk.color]));
  const free = PALETTE.filter((c) => ![...colors.values()].includes(c));
  const skills = uniq("skill")
    .sort((a, b) => skillRank(a, first) - skillRank(b, first))
    .map((name, i) => {
      if (!colors.has(name)) colors.set(name, free.shift() || PALETTE[i % PALETTE.length]);
      const qs = questions.filter((q) => q.skill === name);
      return { name, color: colors.get(name), count: qs.length, domain: qs[0].domain || "" };
    });
  const domains = uniq("domain");
  const diffs = uniq("difficulty").sort((a, b) => (DIFF_LEVEL[a.toLowerCase()] || 9) - (DIFF_LEVEL[b.toLowerCase()] || 9));
  const last = sources[sources.length - 1] || {};
  return {
    version: SET_VERSION,
    fileName: last.fileName,
    importedAt: last.importedAt || Date.now(),
    title: domains.length === 1 ? domains[0] : uniq("section").length === 1 ? uniq("section")[0] : "Question Bank",
    subtitle: [uniq("assessment").join(", "), domains.length > 1 ? `${domains.length} ${plural(domains.length, "домен", "домена", "доменов")}` : uniq("section").join(", "), diffs.join(" · ")].filter(Boolean).join(" · "),
    skills,
    difficulties: diffs,
    questions,
    sources,
  };
}

// Adds a parsed PDF to a set (or starts one). `numbers` pins numbers when a set is rebuilt.
function addQuestions(base, parsed, source, numbers = null) {
  const byId = new Map((base?.questions || []).map((q) => [q.id, q]));
  const taken = [...byId.values()].map((q) => q.n).concat(numbers ? [...numbers.values()] : []);
  let next = Math.max(0, ...taken) + 1;
  const first = new Map();
  parsed.questions.forEach((q, i) => { if (!first.has(q.skill)) first.set(q.skill, i); });
  const incoming = parsed.questions
    .map((q, i) => ({ ...q, order: i, src: { ...q.src, pdf: source.id } }))
    .sort((a, b) => skillRank(a.skill, first) - skillRank(b.skill, first) || a.order - b.order);
  let added = 0, same = 0;
  for (const q of incoming) {
    const prev = byId.get(q.id);
    if (prev) { byId.set(q.id, { ...q, n: prev.n }); same++; }
    else { byId.set(q.id, { ...q, n: numbers?.get(q.id) ?? next++ }); added++; }
  }
  const questions = [...byId.values()];
  const used = new Set(questions.map(sourceOf));
  const sources = [...(base?.sources || []), { ...source, count: parsed.questions.length, added }].filter((s) => used.has(s.id));
  return { set: finishSet(questions, sources, base?.skills), added, same };
}

// ---------------------------------------------------------------- landing & import

// `note` is a message that is not an error, e.g. after progress came from a file without questions.
function showLanding(error, note) {
  document.body.classList.remove("sidebar-open");
  app.innerHTML = `
  <div class="landing"><div class="landing-card">
    <div class="landing-brand">${LOGO}<span>SAT Trainer</span></div>
    <h1>Решайте вопросы из College Board Question Bank интерактивно</h1>
    <p class="lead">Загрузите PDF-экспорт из Educator Question Bank и получите тренажёр: мгновенная проверка ответа, подробные разборы, работа над ошибками и статистика по навыкам.</p>
    <label class="dropzone" id="dz">
      <input type="file" accept="application/pdf,.pdf" id="file">
      <div class="dz-icon">${icon("upload")}</div>
      <div class="dz-title">Перетащите PDF сюда или нажмите, чтобы выбрать</div>
      <div class="dz-sub">Экспорт с вариантом «With correct answers and explanations»</div>
    </label>
    ${error ? `<div class="alert" role="alert">${icon("alert")}<div>${esc(error)}</div></div>` : ""}
    ${note ? `<div class="alert note" role="status">${icon("check")}<div>${esc(note)}</div></div>` : ""}
    <div class="landing-alt">
      <label class="btn btn-ghost">
        <input type="file" id="file-restore" hidden>
        ${icon("history", "icon-sm")} Перенести прогресс с другого устройства
      </label>
      <span class="muted">Файл, сохранённый в меню «Сохранить прогресс в файл»</span>
    </div>
    ${account.landingHtml()}
    <div class="privacy">${icon("lock", "icon-sm")}<span>Файл обрабатывается прямо в браузере и никуда не отправляется. Вопросы и прогресс хранятся только на этом устройстве.</span></div>
    <ol class="steps">
      <li><div class="n">1</div>Откройте <a href="https://satsuiteeducatorquestionbank.collegeboard.org/digital/search" target="_blank" rel="noopener">Educator Question Bank</a></li>
      <li><div class="n">2</div>Выберите тест, раздел, домены и сложность, отметьте вопросы</li>
      <li><div class="n">3</div><b>Export</b> → <b>With correct answers and explanations</b> → <b>Download PDF</b></li>
      <li><div class="n">4</div>Загрузите скачанный PDF сюда</li>
    </ol>
    <div class="landing-foot">Неофициальный проект, не связан с College Board. SAT® — зарегистрированная торговая марка College Board.</div>
  </div></div>`;
  const dz = $("#dz");
  $("#file").addEventListener("change", (e) => importFile(e.target.files[0]));
  $("#file-restore").addEventListener("change", (e) => { importFile(e.target.files[0], { restore: true }); e.target.value = ""; });
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("drag"); importFile(e.dataTransfer.files[0]); });
}

function showImporting() {
  document.body.classList.remove("sidebar-open");
  app.innerHTML = `
  <div class="landing"><div class="landing-card">
    <div class="landing-brand">${LOGO}<span>SAT Trainer</span></div>
    <div class="dropzone" style="cursor:default">
      <div class="dz-icon">${icon("file")}</div>
      <div class="dz-title" id="imp-title">Читаю PDF…</div>
      <div class="import-progress"><div class="bar"><span id="imp-bar" style="width:0%"></span></div></div>
      <div class="dz-sub">Распознаю вопросы, варианты ответов, курсив и подчёркивания</div>
    </div>
  </div></div>`;
}

// `restore`: picked with a progress-file button. Its picker has no type filter (iOS greys out .json
// files behind one), and a phone may save the file as "….json.txt", so anything but a PDF is tried as progress.
async function importFile(file, { restore = false } = {}) {
  if (!file) return;
  const pdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
  if (/\.json$/i.test(file.name) || /json$/i.test(file.type) || (restore && !pdf)) return restoreProgress(file);
  if (!pdf) {
    if (S.set) toast("Нужен PDF-файл"); else showLanding("Нужен PDF-файл.");
    return;
  }
  const mode = S.importMode || "add";
  S.importMode = null;
  runImport(new Uint8Array(await file.arrayBuffer()), file.name, { mode });
}

// ---------------------------------------------------------------- progress backup

// The file carries the PDFs and question numbers too, so on another device it is all that is needed.
async function backupProgress() {
  const pdfs = [];
  for (const src of S.set?.sources || []) {
    let bytes = null;
    try { bytes = await db.get(pdfKey(src.id)); } catch { /* IndexedDB unavailable */ }
    if (bytes) pdfs.push({ id: src.id, fileName: src.fileName, importedAt: src.importedAt, data: toB64(bytes) });
  }
  const numbers = Object.fromEntries((S.set?.questions || []).map((q) => [q.id, q.n]));
  const data = { app: "sat-trainer", kind: "progress", version: 2, exportedAt: new Date().toISOString(), progress: S.progress, flags: [...S.flags], vocab: S.vocab, chats: ai.threads(), review: S.review, activity: S.activity, numbers, pdfs };
  const json = JSON.stringify(data, null, 1);
  const filename = `sat-trainer-progress-${new Date().toISOString().slice(0, 10)}.json`;
  if (window.claude) {
    // inside claude.ai plain download links are inert; the viewer confirms the save instead
    let downloads = null;
    try { downloads = await window.claude.use?.("downloads"); } catch { /* not served here */ }
    if (!downloads) { toast("Сохранение файлов здесь недоступно"); return; }
    try { await downloads.save({ filename, data: json }); toast(`Сохранено ответов: ${Object.keys(S.progress).length}`); }
    catch (e) { if (e?.code !== "declined") toast("Не удалось сохранить файл"); }
    return;
  }
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Сохранено ответов: ${Object.keys(S.progress).length}`);
}

async function restoreProgress(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { data = null; }
  if (!data || data.app !== "sat-trainer" || typeof data.progress !== "object") {
    if (S.set) toast("Это не файл прогресса SAT Trainer"); else showLanding("Это не файл прогресса SAT Trainer. Нужен файл, сохранённый в меню «Сохранить прогресс в файл».");
    return;
  }
  // a device without questions builds them from the PDFs in the file (files saved before October 19 have none)
  const pdfs = Array.isArray(data.pdfs) ? data.pdfs.filter((p) => p?.id && p.data) : [];
  let built = false;
  if (!S.set && pdfs.length) {
    showImporting();
    try {
      const bytes = new Map(pdfs.map((p) => [p.id, fromB64(p.data)]));
      for (const [id, b] of bytes) {
        try { await db.set(pdfKey(id), b); } catch (e) { console.warn("IndexedDB unavailable", e); }
      }
      const set = await installSources(pdfs, data.numbers, async (id) => bytes.get(id) || null);
      if (set) {
        await saveSet(set, null);
        S.set = set;
        S.pdfs = new Map();
        S.ui = { ...S.ui, skill: "all", status: "all", diff: "all", cur: null };
        saveUi();
        account.setsChanged();
        built = true;
      }
    } catch (e) {
      console.error(e);
      showLanding(importError(e));
      return;
    }
  }
  // merge: for a question answered in both places keep the most recent attempt
  let added = 0;
  for (const [id, p] of Object.entries(data.progress)) {
    if (!p || typeof p !== "object") continue;
    const mine = S.progress[id];
    if (!mine || (p.t || 0) > (mine.t || 0)) { S.progress[id] = p; added++; }
  }
  (data.flags || []).forEach((id) => S.flags.add(id));
  const words = vocab.merge(data.vocab);
  ai.merge(data.chats);
  for (const [id, r] of Object.entries(data.review || {})) {
    const mine = S.review[id];
    if (!mine || (r.last || r.added || 0) > (mine.last || mine.added || 0)) S.review[id] = r;
  }
  saveReview();
  today.merge(data.activity);
  saveProgress();
  saveFlags();
  const summary = `Восстановлено ответов: ${added}${words ? `, слов: ${words}` : ""}`;
  if (built) showTrainer();
  else if (S.set) renderAll();
  else return showLanding(null, `${summary}. В файле нет вопросов — выберите PDF, тот же, что на другом устройстве, и ответы встанут на свои места.`);
  toast(summary);
}

// Builds the set from PDFs by source, keeping question numbers (a progress file or a stored set
// brings them). `bytesOf(id)` gives a PDF's bytes, or null when it is not here: that one is left out.
async function installSources(list, numbers, bytesOf, { skills = [], label = "Читаю PDF" } = {}) {
  const pinned = new Map(Object.entries(numbers || {}));
  let acc = null;
  for (const [i, src] of list.entries()) {
    const bytes = await bytesOf(src.id);
    if (!bytes) continue;
    const parsed = await parseWithProgress(bytes, list.length > 1 ? `${label} ${i + 1} из ${list.length}` : label);
    acc = addQuestions(acc, parsed, { id: src.id, fileName: src.fileName, importedAt: src.importedAt }, pinned).set;
  }
  if (acc) acc.skills = finishSet(acc.questions, acc.sources, skills).skills;
  return acc;
}

function keepStorage() {
  // ask the browser not to evict our data under storage pressure / inactivity
  try { navigator.storage?.persist?.(); } catch { /* not supported */ }
}

const importError = (e) =>
  e.message === "NO_ANSWERS" ? "В этом PDF нет правильных ответов. Экспортируйте вариант «With correct answers and explanations»." :
  e.message === "NOT_QUESTION_BANK" ? "В этом файле нет вопросов College Board. Нужен оригинальный PDF, скачанный в Question Bank кнопкой Export → «With correct answers and explanations» → Download PDF, а не переделанный или распечатанный файл." :
  "Не удалось прочитать PDF: " + (e.message || e);

const parseWithProgress = (bytes, label = "Читаю PDF") => parseQuestionBank(bytes, (p) => {
  const pct = Math.round(p * 100);
  const bar = $("#imp-bar"), title = $("#imp-title");
  if (bar) bar.style.width = pct + "%";
  if (title) title.textContent = `${label}… ${pct}%`;
});

async function saveSet(set, previous) {
  const used = new Set(set.sources.map((src) => src.id));
  try {
    await db.set("set", set);
    for (const src of previous?.sources || []) if (!used.has(src.id)) await db.del(pdfKey(src.id));
  } catch (e) { console.warn("IndexedDB unavailable", e); }
}

// mode "add" puts the PDF's questions next to the ones already here; "replace" starts over.
async function runImport(bytes, fileName, { mode = "add" } = {}) {
  const base = mode === "add" && S.set ? normalizeSet(S.set) : null;
  showImporting();
  try {
    const parsed = await parseWithProgress(bytes);
    const source = { id: `s${Date.now().toString(36)}`, fileName, importedAt: Date.now() };
    const { set, added, same } = addQuestions(base, parsed, source);
    try { await db.set(pdfKey(source.id), bytes); } catch (e) { console.warn("IndexedDB unavailable", e); }
    await saveSet(set, S.set);
    S.set = set;
    S.pdfs = new Map();
    if (!base) S.ui = { ...S.ui, skill: "all", status: "all", diff: "all", cur: null };
    saveUi();
    account.setsChanged({ replace: mode === "replace" });
    showTrainer();
    if (!base) toast(`Готово: ${qWord(set.questions.length)}`);
    else if (!added) toast(`Новых вопросов нет: все ${parsed.questions.length} уже есть в тренажёре`);
    else toast(`Добавлено ${qWord(added)}${same ? ` · ${same} уже были` : ""} · всего ${set.questions.length}`);
  } catch (e) {
    console.error(e);
    if (S.set) { showTrainer(); toast(importError(e)); } else showLanding(importError(e));
  }
}

// After a parser update every stored PDF is read again; question numbers stay as they were.
async function rebuildSet(saved) {
  normalizeSet(saved);
  const numbers = Object.fromEntries(saved.questions.map((q) => [q.id, q.n]));
  showImporting();
  try {
    const acc = await installSources(saved.sources, numbers, (id) => db.get(pdfKey(id)), { skills: saved.skills, label: "Обновляю PDF" });
    if (!acc) return showLanding();
    await saveSet(acc, saved);
    S.set = acc;
    S.pdfs = new Map();
    showTrainer();
  } catch (e) {
    console.error(e);
    showLanding(importError(e));
  }
}

// ---------------------------------------------------------------- trainer

const skillOf = (q) => S.set.skills.find((s) => s.name === q.skill) || { color: "#888" };
const cur = () => S.set.questions.find((q) => q.id === S.ui.cur);
const statusOf = (id) => (!S.progress[id] ? "todo" : S.progress[id].ok ? "right" : "wrong");
const isOriginal = (q) => S.ui.original[q.id] ?? q.hasFigure;
// Each attempt is timed on its own: a first answer and a review of the same question.
const timingKey = (q) => (inReview(q) ? `r:${q.id}` : q.id);
function timerTick() {
  const q = S.set && S.ui.view === "questions" ? cur() : null;
  timer.sync(q && !answerOf(q) && !prep.locked(q) ? timingKey(q) : null);   // learning the words is not question time
  const el = document.getElementById("qtimer");
  if (!el || !q) return;
  const st = timer.state();
  el.querySelector("b").textContent = fmtTime(st.ms);
  el.classList.toggle("paused", !st.running);
  el.classList.toggle("over", st.ms > paceFor(q));
  el.title = st.running ? `Время на вопрос · темп SAT ${fmtTime(paceFor(q))}` : st.idle ? "Пауза: 3 минуты без действий" : "Пауза: вкладка не активна";
}
// Average time of first answers (optionally for one skill).
function avgTime(pred = () => true) {
  const ms = S.set.questions.filter((q) => pred(q) && S.progress[q.id]?.ms > 0).map((q) => S.progress[q.id].ms);
  return ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0;
}
function timeNote(q, pr) {
  if (!pr?.ms) return "";
  const pace = paceFor(q), avg = avgTime();
  const cls = pr.ms <= pace ? "fast" : pr.ms <= pace * 1.5 ? "slow" : "over";
  return `<span class="fnote time ${cls}">${icon("timer", "icon-sm")} ${fmtTime(pr.ms)} на вопрос${avg ? ` · в среднем ${fmtTime(avg)}` : ""} · темп SAT ${fmtTime(pace)}</span>`;
}
// Reviewing a mistake shows the question fresh; the first answer stays in S.progress for the statistics.
const inReview = (q) => S.ui.status === "review" && (isDue(S.review[q.id]) || !!S.attempt[q.id]);
const answerOf = (q) => (inReview(q) ? S.attempt[q.id] || null : S.progress[q.id]);
const dueReviewCount = () => S.set.questions.filter((q) => isDue(S.review[q.id])).length;
// Not answered yet, and every word of its answer choices is learned.
const isReady = (q) => { if (S.progress[q.id]) return false; const g = vocab.gateOf(q); return !g.loading && !g.missing.length; };
function whenDue(r) {
  const days = Math.round((r.due - new Date().setHours(0, 0, 0, 0)) / 864e5);
  return days <= 0 ? "сегодня" : days === 1 ? "завтра" : `через ${days} ${plural(days, "день", "дня", "дней")}`;
}
// Mistakes waiting for a later day, soonest first.
const upcomingReviews = () => S.set.questions
  .filter((q) => S.review[q.id] && !S.review[q.id].done && !isDue(S.review[q.id]))
  .sort((a, b) => S.review[a.id].due - S.review[b.id].due || a.n - b.n);

function matches(q) {
  if (S.ui.skill !== "all" && q.skill !== S.ui.skill) return false;
  if (S.ui.diff && S.ui.diff !== "all" && q.difficulty !== S.ui.diff) return false;
  if (S.ui.status === "all") return true;
  if (S.ui.status === "flag") return S.flags.has(q.id);
  if (S.ui.status === "review") return isDue(S.review[q.id]) || !!S.attempt[q.id];
  if (S.ui.status === "ready") return isReady(q);
  return statusOf(q.id) === S.ui.status;
}
// The open question stays in the list even after it stops matching (e.g. answered while filtering "todo").
const visible = () => S.set.questions.filter((q) => q.id === S.ui.cur || matches(q));

function ensureCurrent() {
  const filtered = S.set.questions.filter(matches);
  if (!cur() || !filtered.some((q) => q.id === S.ui.cur)) S.ui.cur = filtered.length ? filtered[0].id : null;
  saveUi();
}

function showTrainer() {
  app.innerHTML = `
    <header class="topbar" id="topbar"></header>
    <div class="layout">
      <aside class="sidebar" id="sidebar" aria-label="Список вопросов"></aside>
      <main class="main" id="main"></main>
    </div>
    <div class="backdrop" data-action="close-sidebar"></div>
    <input type="file" id="file2" accept="application/pdf,.pdf" hidden>
    <input type="file" id="file3" hidden>`;
  $("#file2").addEventListener("change", (e) => { importFile(e.target.files[0]); e.target.value = ""; });
  $("#file3").addEventListener("change", (e) => { importFile(e.target.files[0], { restore: true }); e.target.value = ""; });
  keepStorage();
  vocab.rebuild();
  S.session = null;
  let added = false;
  for (const q of S.set.questions) {
    const p = S.progress[q.id];
    if (p && !p.ok && !S.review[q.id]) { S.review[q.id] = enqueueReview(null, Date.now(), true); added = true; }
  }
  if (added) saveReview();
  if (S.ui.lastDay !== dayKey()) { S.ui.view = "today"; S.ui.lastDay = dayKey(); saveUi(); }
  if (!cur()) ensureCurrent();
  renderAll(true);
}

function renderAll(scrollTop = false) {
  renderTopbar();
  queueMicrotask(timerTick);
  if (S.ui.view === "today") {
    vocab.hidePop();
    $("#sidebar").setAttribute("aria-label", "Обзор");
    today.renderSidebar();
    today.renderMain(scrollTop);
    return;
  }
  if (S.ui.view === "vocab") {
    vocab.hidePop();
    $("#sidebar").setAttribute("aria-label", "Словарь");
    vocab.renderSidebar();
    vocab.renderMain(scrollTop);
    return;
  }
  $("#sidebar").setAttribute("aria-label", "Список вопросов");
  renderSidebar();
  renderQuestion(scrollTop);
}

function renderTopbar() {
  const qs = S.set.questions;
  const answered = qs.filter((q) => S.progress[q.id]).length;
  const right = qs.filter((q) => S.progress[q.id]?.ok).length;
  const acc = answered ? Math.round((right / answered) * 100) : 0;
  $("#topbar").innerHTML = `
    <button class="icon-btn only-mobile" data-action="open-sidebar" aria-label="Список вопросов">${icon("menu")}</button>
    <div class="brand">${LOGO}<span>SAT Trainer</span></div>
    <div class="set-title"><span class="set-name">${esc(S.set.title)}</span><span class="set-sub">${esc(S.set.subtitle)}</span></div>
    <nav class="tabs" aria-label="Разделы">
      <button class="tab ${S.ui.view === "today" ? "active" : ""}" data-action="view" data-view="today" aria-current="${S.ui.view === "today"}">${icon("today", "icon-sm")}<span>Сегодня</span>${(() => { const n = today.remaining(); return n ? `<span class="tab-badge" title="Задач на сегодня">${n}</span>` : `<span class="tab-done" title="День закрыт">${icon("check", "icon-sm")}</span>`; })()}</button>
      <button class="tab ${S.ui.view === "questions" ? "active" : ""}" data-action="view" data-view="questions" aria-current="${S.ui.view === "questions"}">${icon("book", "icon-sm")}<span>Вопросы</span>${(() => { const n = dueReviewCount(); return n ? `<span class="tab-badge warn" title="Ошибок на повтор">${n}</span>` : ""; })()}</button>
      <button class="tab ${S.ui.view === "vocab" ? "active" : ""}" data-action="view" data-view="vocab" aria-current="${S.ui.view === "vocab"}">${icon("cards", "icon-sm")}<span>Словарь</span>${(() => { const n = vocab.dueTotal(); return n ? `<span class="tab-badge" title="Карточек на сегодня">${n}</span>` : ""; })()}</button>
    </nav>
    <div class="spacer"></div>
    ${(() => { const n = today.streak(); return `<button class="streak-chip ${n ? "on" : ""} ${today.isClosed(dayKey()) ? "closed" : ""}" data-action="view" data-view="today" title="${n ? `Серия: ${n} ${plural(n, "день", "дня", "дней")} подряд` : "Закройте день, чтобы начать серию"}">${icon("flame", "icon-sm")}<b>${n}</b></button>`; })()}
    <div class="score" title="Решено ${answered} из ${qs.length}, верно ${right}">
      <div class="ring" style="--p:${answered / qs.length};--ok-p:${right / qs.length}"></div>
      <div><b>${answered}</b>/${qs.length}<span class="label"> решено</span>${answered ? ` · <b>${acc}%</b><span class="label"> верно</span>` : ""}</div>
    </div>
    ${account.chip()}
    <button class="icon-btn" data-action="theme" aria-label="Сменить тему" title="Сменить тему">${icon(isDark() ? "sun" : "moon")}</button>
    <div class="menu-wrap">
      <button class="icon-btn" data-action="menu" aria-label="Меню" aria-haspopup="menu" aria-expanded="false">${icon("dots")}</button>
      <div class="menu" id="menu" role="menu" hidden>
        ${account.menuHtml()}
        <button role="menuitem" data-action="load-new">${icon("upload")} Добавить ещё PDF</button>
        <button role="menuitem" data-action="load-replace">${icon("file")} Начать заново с другим PDF</button>
        <hr>
        <button role="menuitem" data-action="backup">${icon("download")} Сохранить прогресс в файл</button>
        <button role="menuitem" data-action="restore">${icon("history")} Восстановить прогресс из файла</button>
        <hr>
        <button role="menuitem" data-action="reset-progress">${icon("rotate")} Сбросить прогресс</button>
        <hr>
        <button role="menuitem" class="danger" data-action="wipe">${icon("trash")} Удалить данные из браузера</button>
      </div>
    </div>`;
}

function renderSidebar() {
  const qs = S.set.questions;
  const inSkill = (q) => (S.ui.skill === "all" || q.skill === S.ui.skill) && (!S.ui.diff || S.ui.diff === "all" || q.difficulty === S.ui.diff);
  const count = (st) => qs.filter((q) => inSkill(q) && (st === "all" || (st === "flag" ? S.flags.has(q.id) : st === "review" ? isDue(S.review[q.id]) : st === "ready" ? isReady(q) : statusOf(q.id) === st))).length;
  const list = visible();
  const skills = [{ name: "all", label: "Все навыки", count: qs.length, color: "var(--text-2)" }, ...S.set.skills];
  const multiDomain = new Set(S.set.skills.map((sk) => sk.domain)).size > 1;
  const diffs = S.set.difficulties || [];
  const statuses = [["all", "Все"], ["review", "Повторить"], ["todo", "Не решены"], ["ready", "Слова выучены"], ["wrong", "Ошибки"], ["right", "Верно"], ["flag", "Отмеченные"]];
  const stats = S.set.skills.map((s) => {
    const sq = qs.filter((q) => q.skill === s.name);
    const ok = sq.filter((q) => S.progress[q.id]?.ok).length;
    const bad = sq.filter((q) => S.progress[q.id] && !S.progress[q.id].ok).length;
    const pct = ok + bad ? Math.round((ok / (ok + bad)) * 100) + "%" : "—";
    const t = avgTime((q) => q.skill === s.name);
    return `<div class="stat-row"><div class="top"><span class="dot" style="--c:${s.color}"></span><span class="name">${esc(s.name)}</span><span class="num">${ok + bad}/${sq.length} · ${pct}${t ? ` · ⌀${fmtTime(t)}` : ""}</span></div>
      <div class="split-bar"><span class="ok" style="width:${(ok / sq.length) * 100}%"></span><span class="bad" style="width:${(bad / sq.length) * 100}%"></span></div></div>`;
  }).join("");
  const date = new Date(S.set.importedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

  $("#sidebar").innerHTML = `
    <div>
      <div class="side-label">Навык</div>
      <div class="skill-list">${skills.map((s, i) => `
        ${multiDomain && s.domain && s.domain !== skills[i - 1]?.domain ? `<div class="skill-domain">${esc(s.domain)}</div>` : ""}
        <button class="skill-item ${S.ui.skill === s.name ? "active" : ""}" data-action="skill" data-skill="${esc(s.name)}" aria-pressed="${S.ui.skill === s.name}">
          <span class="dot" style="--c:${s.color}"></span><span class="name">${esc(s.label || s.name)}</span><span class="count">${s.count}</span>
        </button>`).join("")}
      </div>
    </div>
    ${diffs.length > 1 ? `<div>
      <div class="side-label">Сложность</div>
      <div class="chips">${["all", ...diffs].map((d) => `
        <button class="chip ${(S.ui.diff || "all") === d ? "active" : ""}" data-action="diff" data-diff="${esc(d)}" aria-pressed="${(S.ui.diff || "all") === d}">${d === "all" ? "Любая" : `${diffBars(d)} ${esc(DIFF_RU[d.toLowerCase()] || d)}`}<span class="count">${d === "all" ? qs.length : qs.filter((q) => q.difficulty === d).length}</span></button>`).join("")}
      </div>
    </div>` : ""}
    <div>
      <div class="side-label">Статус</div>
      <div class="chips">${statuses.map(([k, label]) => `
        <button class="chip ${S.ui.status === k ? "active" : ""} ${k === "review" && count(k) ? "chip-warn" : ""}" data-action="status" data-status="${k}" aria-pressed="${S.ui.status === k}"${k === "ready" ? ' title="Не решены, и все слова из вариантов ответа уже выучены"' : ""}>${k === "review" ? icon("clock", "icon-sm") : k === "ready" ? icon("cards", "icon-sm") : ""}${label}<span class="count">${count(k)}</span></button>`).join("")}
      </div>
    </div>
    <div>
      <div class="side-label"><span>Вопросы</span><span>${list.length}</span></div>
      <div class="qgrid">${list.map((q) => {
        const st = statusOf(q.id);
        const rv = S.review[q.id];
        const at = S.ui.status === "review" ? S.attempt[q.id] : null;
        const g = !answerOf(q) && vocab.gateOf(q);
        const cls = [at ? (at.ok ? "ok" : "bad") : st === "right" ? "ok" : st === "wrong" ? "bad" : "",
          rv && !rv.done ? "rq" : "", rv?.done ? "fixed" : "", g && !g.loading && g.missing.length ? "closed" : "",
          q.id === S.ui.cur ? "current" : "", S.flags.has(q.id) ? "flag" : ""].join(" ");
        const lockNote = g && !g.loading && g.missing.length ? `, сначала ${g.missing.length} ${plural(g.missing.length, "слово", "слова", "слов")}` : "";
        return `<button class="qcell ${cls}" style="--c:${skillOf(q).color}" data-action="go" data-id="${q.id}" aria-label="Вопрос ${q.n}${lockNote}" title="${lockNote ? `Вопрос ${q.n}${lockNote}` : ""}"${q.id === S.ui.cur ? ' aria-current="true"' : ""}>${q.n}</button>`;
      }).join("")}</div>
    </div>
    ${S.ui.status === "review" ? upcomingHtml() : ""}
    <div>
      <div class="side-label">Статистика</div>
      <div class="stat-rows">${stats}</div>
    </div>
    <div class="side-foot">
      <span title="${esc(S.set.sources.map((src) => `${src.fileName} — ${src.count} вопр.`).join("\n"))}">${icon("file", "icon-sm")} ${S.set.sources.length > 1 ? `${S.set.sources.length} ${plural(S.set.sources.length, "файл", "файла", "файлов")} PDF · ${qWord(qs.length)}` : `${esc(S.set.fileName || "PDF")} · ${date}`}</span>
      <button class="btn btn-ghost btn-sm" style="justify-content:flex-start;padding:0 6px;margin-left:-6px" data-action="load-new">${icon("upload", "icon-sm")} Добавить ещё PDF</button>
      <span>${icon("lock", "icon-sm")} Прогресс сохраняется автоматически в этом браузере</span>
      <button class="btn btn-ghost btn-sm" style="justify-content:flex-start;padding:0 6px;margin-left:-6px" data-action="backup">${icon("download", "icon-sm")} Сохранить копию прогресса</button>
    </div>`;
  $(".qcell.current", $("#sidebar"))?.scrollIntoView({ block: "nearest" });
}

function upcomingHtml() {
  const list = upcomingReviews();
  if (!list.length) return "";
  const groups = new Map();
  for (const q of list) {
    const label = whenDue(S.review[q.id]);
    groups.set(label, [...(groups.get(label) || []), q]);
  }
  return `<div>
    <div class="side-label"><span>Скоро в повторении</span><span>${list.length}</span></div>
    <div class="upcoming">${[...groups].map(([label, qs]) => `
      <div class="up-row"><span class="up-when">${label}</span>
        <span class="up-nums">${qs.map((q) => `<span class="up-num" style="--c:${skillOf(q).color}" title="${esc(q.skill)}">${q.n}</span>`).join("")}</span></div>`).join("")}
    </div>
  </div>`;
}

function choicesHtml(q, pr, orig) {
  if (!q.choices.length) {
    if (pr) return "";
    return `<div class="card" style="padding:16px;display:flex;gap:10px;flex-wrap:wrap">
      <input id="spr" class="btn btn-outline" style="flex:1;min-width:160px;cursor:text;justify-content:flex-start" placeholder="Ваш ответ" autocomplete="off">
      <button class="btn btn-primary" data-action="check-spr">Проверить</button></div>`;
  }
  const struck = S.struck[q.id] || new Set();
  return `<div class="choices ${orig ? "compact-choices" : ""}" role="group" aria-label="Варианты ответа">${q.choices.map((c) => {
    let cls = "", ic = "";
    if (pr) {
      if (c.letter === q.correct) { cls = "correct"; ic = icon("check"); }
      else if (c.letter === pr.c) { cls = "wrong"; ic = icon("x"); }
      else cls = "dim";
      if (S.anim && S.anim.id === q.id && S.anim.letter === c.letter) cls += pr.ok ? " pop" : " shake";
    } else if (struck.has(c.letter)) cls = "struck";
    return `<div class="choice-row">
      <button class="choice ${cls}" data-action="answer" data-letter="${c.letter}" ${pr ? "disabled" : ""}>
        <span class="letter">${c.letter}</span><span class="ctext">${runsHtml(c.runs)}</span><span class="cicon">${ic}</span>
      </button>
      ${!pr && !orig ? `<button class="strike ${struck.has(c.letter) ? "on" : ""}" data-action="strike" data-letter="${c.letter}" title="Вычеркнуть вариант (Shift+${c.letter})" aria-label="Вычеркнуть вариант ${c.letter}" aria-pressed="${struck.has(c.letter)}">${icon("ban")}</button>` : ""}
    </div>`;
  }).join("")}</div>`;
}

function reviewBanner(q, pr) {
  const r = S.review[q.id];
  if (!pr) {
    return `<div class="review-banner">${icon("clock", "icon-sm")}<span><b>Повторение ошибки</b> · верных подряд: ${r?.step || 0} из ${REVIEW_DAYS.length}. Решите вопрос заново — прошлый ответ скрыт.</span></div>`;
  }
  const next = r?.done ? "Закреплено — вопрос больше не будет повторяться." :
    pr.ok ? `Следующий повтор через ${REVIEW_DAYS[r.step]} ${plural(REVIEW_DAYS[r.step], "день", "дня", "дней")}.` : "Повторим завтра.";
  return `<div class="review-banner ${r?.done ? "fixed" : pr.ok ? "ok" : "bad"}">${icon(r?.done ? "trophy" : "clock", "icon-sm")}<span><b>${r?.done ? "Ошибка исправлена!" : "Повторение"}</b> · ${next}</span></div>`;
}

function feedbackHtml(q, pr) {
  if (!pr) return "";
  const answer = q.correct || esc(q.correctText);
  if (pr.ok) {
    return `<div class="feedback ok" role="status"><div class="fic">${icon("check")}</div>
      <div class="ftext"><strong>Верно!</strong>Правильный ответ — ${answer}${timeNote(q, pr)}</div></div>`;
  }
  const head = pr.revealed ? "Ответ показан" : `Неверно${pr.c ? ` — вы выбрали ${esc(pr.c)}` : ""}`;
  const queued = !inReview(q) && S.review[q.id] && !S.review[q.id].done;
  return `<div class="feedback bad" role="status"><div class="fic">${icon("x")}</div>
    <div class="ftext"><strong>${head}</strong>Правильный ответ — ${answer}
      ${timeNote(q, pr)}
      ${queued ? `<span class="fnote">${icon("clock", "icon-sm")} Вопрос добавлен в повторение ошибок — вернётся ${whenDue(S.review[q.id])}.</span>` : ""}</div>
    ${inReview(q) ? "" : `<button class="btn btn-outline btn-sm" data-action="retry">${icon("rotate", "icon-sm")} Ещё раз</button>`}</div>`;
}

function explainHtml(q, pr) {
  if (!pr) {
    return `<section class="card explain">
      <div class="explain-head" style="cursor:default">${icon("bulb")} Разбор <span class="hint">откроется после ответа</span></div>
      <div class="locked"><button class="btn btn-ghost btn-sm" data-action="reveal" title="Засчитается как ошибка">${icon("eye", "icon-sm")} Сдаться и показать ответ</button></div>
    </section>`;
  }
  const open = S.explainOpen[q.id] !== false;
  const body = isOriginal(q)
    ? q.src.rationale.map((_, i) => `<div class="orig" data-region="rat-${i}"></div>`).join("")
    : ratHtml(q);
  return `<section class="card explain ${open ? "open" : ""}">
    <button class="explain-head" data-action="toggle-explain" aria-expanded="${open}">${icon("bulb")} Разбор <span class="chev">${icon("down")}</span></button>
    ${open ? `<div class="explain-body">${body}</div>` : ""}
  </section>`;
}

function renderQuestion(scrollTop = false) {
  const main = $("#main");
  const list = visible();
  const q = cur();
  if (!q || !list.length) {
    if (S.ui.status === "review") {
      const next = upcomingReviews();
      main.innerHTML = `<div class="empty"><h3>На сегодня повторять нечего</h3>
        <p>${next.length ? `Ошибки возвращаются на следующий день после ответа. Ближайшие: ${next.slice(0, 8).map((x) => `№${x.n} — ${whenDue(S.review[x.id])}`).join(", ")}${next.length > 8 ? "…" : ""}.` : "Все ошибки закреплены или их пока нет."}</p>
        <button class="btn btn-outline" data-action="today-new">Решать новые вопросы</button></div>`;
      return;
    }
    if (S.ui.status === "ready") {
      main.innerHTML = `<div class="empty"><h3>Пока нет вопросов, к которым выучены все слова</h3>
        <p>Откройте нерешённый вопрос — тренажёр покажет слова из его вариантов ответа, проверит их и откроет вопрос. Или учите слова в карточках: они идут в порядке вопросов.</p>
        <div class="row" style="justify-content:center"><button class="btn btn-primary" data-action="status" data-status="todo">К нерешённым вопросам</button>
        <button class="btn btn-outline" data-action="today-words">Учить слова</button></div></div>`;
      return;
    }
    main.innerHTML = `<div class="empty"><h3>Здесь пусто</h3><p>По выбранным фильтрам вопросов нет.</p>
      <button class="btn btn-outline" data-action="clear-filters">Сбросить фильтры</button></div>`;
    return;
  }
  const pos = list.indexOf(q);
  const review = inReview(q);
  const pr = answerOf(q);
  const orig = isOriginal(q);
  const sk = skillOf(q);
  const nav = `<nav class="qnav" aria-label="Навигация по вопросам">
      <button class="btn btn-outline" data-action="prev" ${pos <= 0 ? "disabled" : ""} aria-label="Предыдущий вопрос">${icon("left")}<span class="btn-label">Назад</span></button>
      <div class="spacer"></div>
      ${pr && !review ? `<button class="btn btn-ghost" data-action="retry" aria-label="Решить заново">${icon("rotate")}<span class="btn-label">Решить заново</span></button>` : ""}
      <button class="btn btn-primary" data-action="next" ${pos >= list.length - 1 ? "disabled" : ""} aria-label="Следующий вопрос"><span class="btn-label">Далее</span>${icon("right")}</button>
    </nav>`;
  if (prep.locked(q)) {
    // the question stays closed until the words of its answer choices are learned
    main.innerHTML = `<div class="qwrap">
      ${review ? reviewBanner(q, pr) : ""}
      <div class="qhead">
        <div class="qnum">Вопрос ${q.n} <span>· ${pos + 1} из ${list.length}</span></div>
        <span class="badge badge-skill" style="--c:${sk.color}"><span class="dot"></span>${esc(q.skill)}</span>
        ${q.difficulty ? `<span class="badge">${diffBars(q.difficulty)} ${esc(q.difficulty)}</span>` : ""}
        <div class="spacer"></div>
        <span class="mono" title="Question ID в College Board">${esc(q.id)}</span>
      </div>
      ${prep.html(q)}
      ${nav}
    </div>`;
    S.anim = null;
    timerTick();
    ai.follow();
    if (scrollTop) window.scrollTo({ top: 0 });
    return;
  }
  main.innerHTML = `<div class="qwrap">
    ${review ? reviewBanner(q, pr) : ""}
    <div class="qhead">
      <div class="qnum">Вопрос ${q.n} <span>· ${pos + 1} из ${list.length}</span></div>
      ${!pr && !S.ui.hideTimer ? `<span class="qtimer" id="qtimer">${icon("timer", "icon-sm")}<b>0:00</b></span>` : ""}
      <span class="badge badge-skill" style="--c:${sk.color}"><span class="dot"></span>${esc(q.skill)}</span>
      ${q.difficulty ? `<span class="badge">${diffBars(q.difficulty)} ${esc(q.difficulty)}</span>` : ""}
      <div class="spacer"></div>
      <span class="mono" title="Question ID в College Board">${esc(q.id)}</span>
      <div class="qtools">
        <button class="icon-btn" data-action="flag" aria-pressed="${S.flags.has(q.id)}" title="Отметить вопрос (F)" aria-label="Отметить вопрос">${icon("flag")}</button>
        <button class="icon-btn" data-action="original" aria-pressed="${orig}" title="Оригинальная вёрстка PDF (O)" aria-label="Оригинальная вёрстка PDF">${icon("image")}</button>
        ${ai.available() ? `<button class="btn btn-outline btn-sm ai-q ${ai.hasThread(`q:${q.id}`) ? "has-thread" : ""}" data-action="ai-ask-question" title="Спросить Claude про этот вопрос">${icon("sparkles", "icon-sm")}<span class="btn-label">Спросить Claude</span></button>` : ""}
      </div>
    </div>
    ${orig
      ? `<div class="orig" data-region="question"></div><div class="orig-note">${icon("image", "icon-sm")} Оригинальная вёрстка из PDF</div>`
      : `<article class="card passage">${stemHtml(q)}</article>${q.prompt ? `<div class="prompt">${runsHtml(q.prompt.runs)}</div>` : ""}`}
    ${choicesHtml(q, pr, orig)}
    ${feedbackHtml(q, pr)}
    ${explainHtml(q, pr)}
    ${pr ? vocab.questionWordsHtml(q) : ""}
    ${nav}
    <div class="hints">
      <span><kbd>A</kbd>–<kbd>D</kbd> ответ</span><span><kbd>Shift</kbd>+<kbd>A</kbd> вычеркнуть</span>
      <span><kbd>←</kbd> <kbd>→</kbd> навигация</span><span><kbd>E</kbd> разбор</span><span><kbd>F</kbd> отметить</span>
    </div>
  </div>`;
  S.anim = null;
  if (!orig) vocab.decoratePassage(q, main.querySelector(".passage"));
  timerTick();
  ai.follow();
  if (orig || (pr && isOriginal(q))) fillOriginals(q);
  if (scrollTop) window.scrollTo({ top: 0 });
}

async function fillOriginals(q) {
  const els = [...document.querySelectorAll("#main [data-region]")];
  if (!els.length) return;
  try {
    S.pdfs ||= new Map();
    const id = sourceOf(q);
    if (!S.pdfs.has(id)) {
      const bytes = await db.get(pdfKey(id));
      if (!bytes) throw new Error("no pdf");
      S.pdfs.set(id, await openPdf(bytes));
    }
    for (const el of els) {
      const key = el.dataset.region;
      const region = key === "question" ? q.src.question : q.src.rationale[+key.split("-")[1]];
      const canvas = await renderRegion(S.pdfs.get(id), region, el.clientWidth - 28);
      if (cur()?.id !== q.id) return;
      el.replaceChildren(canvas);
    }
  } catch (e) {
    console.warn(e);
    els.forEach((el) => (el.innerHTML = `<div class="orig-note">Оригинал недоступен: загрузите PDF ещё раз.</div>`));
  }
}

// ---------------------------------------------------------------- actions

function go(id, scroll = true) {
  vocab.hideWord();
  prep.leave();
  S.ui.cur = id;
  saveUi();
  document.body.classList.remove("sidebar-open");
  renderSidebar();
  renderQuestion(scroll);
}

function step(d) {
  const list = visible();
  const i = list.findIndex((q) => q.id === S.ui.cur);
  const next = list[i + d];
  if (next) go(next.id);
}

// Records an answer: a review attempt reschedules the mistake, a first attempt may start a review.
function record(q, result) {
  result = { ...result, ms: timer.take(timingKey(q)) };
  vocab.invalidate();
  if (inReview(q)) {
    S.attempt[q.id] = result;
    S.review[q.id] = { ...gradeReview(S.review[q.id], result.ok), lastMs: result.ms };
    saveReview();
    today.log("r", result.ok, result.ms);
    return;
  }
  S.progress[q.id] = result;
  saveProgress();
  if (!result.ok) { S.review[q.id] = enqueueReview(S.review[q.id]); saveReview(); }
  today.log("q", result.ok, result.ms);
}

function answer(letter) {
  const q = cur();
  if (!q || answerOf(q) || prep.locked(q) || !q.choices.some((c) => c.letter === letter)) return;
  record(q, { c: letter, ok: letter === q.correct, t: Date.now() });
  S.anim = { id: q.id, letter };
  S.explainOpen[q.id] = true;
  renderAll();
  $(".feedback")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function checkSpr() {
  const q = cur();
  const val = $("#spr")?.value.trim();
  if (!q || !val || prep.locked(q)) return;
  const norm = (s) => s.replace(/\s+/g, "").replace(/^\+/, "").toLowerCase();
  const ok = String(q.correctText || "").split(/[,;]| or /).map(norm).filter(Boolean).includes(norm(val));
  record(q, { c: val, ok, t: Date.now() });
  renderAll();
}

function retry() {
  const q = cur();
  if (!q || inReview(q)) return;
  delete S.progress[q.id];
  delete S.struck[q.id];
  timer.reset(q.id);   // a new attempt starts from zero
  saveProgress();
  renderAll();
}

function strike(letter) {
  const q = cur();
  if (!q || answerOf(q)) return;
  const set = (S.struck[q.id] ||= new Set());
  set.has(letter) ? set.delete(letter) : set.add(letter);
  renderQuestion();
}

function setFilter(kind, value) {
  S.ui[kind] = value;
  const filtered = S.set.questions.filter(matches);
  if (!filtered.some((q) => q.id === S.ui.cur)) S.ui.cur = filtered.length ? filtered[0].id : null;
  saveUi();
  renderAll(true);
}

function toggleMenu(force) {
  const m = $("#menu");
  if (!m) return;
  const open = force ?? m.hidden;
  m.hidden = !open;
  $('[data-action="menu"]')?.setAttribute("aria-expanded", String(open));
}

const ACTIONS = {
  answer: (el) => answer(el.dataset.letter),
  strike: (el) => strike(el.dataset.letter),
  "check-spr": checkSpr,
  reveal: () => {
    const q = cur();
    if (!q || answerOf(q) || prep.locked(q)) return;
    record(q, { c: null, ok: false, revealed: true, t: Date.now() });
    S.explainOpen[q.id] = true;
    renderAll();
  },
  retry,
  next: () => step(1),
  prev: () => step(-1),
  go: (el) => go(el.dataset.id),
  skill: (el) => setFilter("skill", el.dataset.skill),
  diff: (el) => setFilter("diff", el.dataset.diff),
  status: (el) => setFilter("status", el.dataset.status),
  "clear-filters": () => { S.ui.status = "all"; S.ui.diff = "all"; setFilter("skill", "all"); },
  flag: () => {
    const q = cur();
    if (!q) return;
    S.flags.has(q.id) ? S.flags.delete(q.id) : S.flags.add(q.id);
    saveFlags();
    renderSidebar();
    renderQuestion();
    toast(S.flags.has(q.id) ? "Вопрос отмечен" : "Отметка снята");
  },
  original: () => {
    const q = cur();
    if (!q) return;
    S.ui.original[q.id] = !isOriginal(q);
    saveUi();
    renderQuestion();
  },
  "toggle-explain": () => {
    const q = cur();
    if (!q || !answerOf(q)) return;
    S.explainOpen[q.id] = S.explainOpen[q.id] === false;
    renderQuestion();
  },
  theme: () => {
    const next = isDark() ? "light" : "dark";
    try { localStorage.setItem(KEY.theme, next); } catch { /* storage unavailable */ }
    document.documentElement.dataset.theme = next;
    renderTopbar();
    if (cur() && isOriginal(cur())) renderQuestion();
  },
  menu: () => toggleMenu(),
  "load-new": () => { toggleMenu(false); S.importMode = "add"; $("#file2").click(); },
  "load-replace": async () => {
    toggleMenu(false);
    if (!(await confirmDialog("Начать с другого PDF?", "Текущие вопросы уберутся из тренажёра, их место займёт новый файл. Ответы, ошибки и словарь сохранятся — если позже добавить старый PDF снова, прогресс по нему вернётся.", "Выбрать PDF"))) return;
    S.importMode = "replace";
    $("#file2").click();
  },
  backup: () => { toggleMenu(false); backupProgress(); },
  restore: () => { toggleMenu(false); $("#file3").click(); },
  "reset-progress": async () => {
    toggleMenu(false);
    if (!(await confirmDialog("Сбросить прогресс?", "Все ответы и статистика по вопросам будут удалены. Вопросы и словарь останутся.", "Сбросить", true))) return;
    S.progress = {};
    S.struck = {};
    S.review = {};
    S.attempt = {};
    saveProgress();
    saveReview();
    renderAll();
    toast("Прогресс сброшен");
  },
  wipe: async () => {
    ls.del(KEY.timing);
    toggleMenu(false);
    if (!(await confirmDialog("Удалить все данные?", `Из браузера будут удалены загруженный PDF, вопросы, прогресс и отметки.${account.signedIn() ? " Вы выйдете из аккаунта, а в самом аккаунте всё останется." : ""}`, "Удалить", true))) return;
    await account.forget();
    try { await db.clear(); } catch { /* nothing stored */ }
    [KEY.progress, KEY.flags, KEY.ui, KEY.vocab, KEY.dict, KEY.review, KEY.activity].forEach(ls.del);
    ai.wipe();
    Object.assign(S, { set: null, progress: {}, flags: new Set(), struck: {}, pdfs: new Map(), vocab: VOCAB_DEFAULT(), session: null, review: {}, activity: ACTIVITY_DEFAULT(), attempt: {} });
    S.ui = { skill: "all", status: "all", cur: null, original: {}, view: "questions", vtab: "study", vfilter: "all", vq: "" };
    showLanding();
  },
  view: (el) => {
    vocab.hideWord();
    S.ui.view = el.dataset.view;
    saveUi();
    document.body.classList.remove("sidebar-open");
    renderAll(true);
  },
  ...vocab.actions,
  ...ai.actions,
  ...today.actions,
  ...account.actions,
  ...prep.actions,
  "today-review": () => { S.ui.view = "questions"; S.ui.skill = "all"; setFilter("status", "review"); },
  "timer-visible": () => { S.ui.hideTimer = !S.ui.hideTimer; saveUi(); renderAll(); toast(S.ui.hideTimer ? "Таймер скрыт — время всё равно считается" : "Таймер показан"); },
  "today-new": () => { S.ui.view = "questions"; S.ui.skill = "all"; setFilter("status", "todo"); },
  "today-words": () => { S.ui.view = "vocab"; S.ui.vtab = "study"; S.session = null; saveUi(); renderAll(true); },
  "open-sidebar": () => document.body.classList.add("sidebar-open"),
  "close-sidebar": () => document.body.classList.remove("sidebar-open"),
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!e.target.closest(".menu-wrap")) toggleMenu(false);
  if (!el || !S.set) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) fn(el);
});

document.addEventListener("keydown", (e) => {
  if (!S.set || !$("#main") || e.metaKey || e.ctrlKey || e.altKey) return;
  const inField = e.target instanceof Element && !!e.target.closest("input, textarea, select, dialog");
  if (S.ui.view === "today") {
    if (e.key === "Escape") { document.body.classList.remove("sidebar-open"); ai.close(); document.querySelector(".celebrate")?.remove(); }
    return;
  }
  if (S.ui.view === "vocab") {
    if (e.key === "Escape") { document.body.classList.remove("sidebar-open"); ai.close(); }
    else if (!inField && vocab.onKey(e)) e.preventDefault();
    return;
  }
  if (inField) {
    if (e.key === "Enter" && e.target.id === "spr") checkSpr();
    return;
  }
  if (cur() && prep.locked(cur())) {
    if (prep.onKey(e)) e.preventDefault();
    else if (e.key === "ArrowRight") { step(1); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { step(-1); e.preventDefault(); }
    return;
  }
  const k = e.key.toLowerCase();
  const letter = "abcd".includes(k) && k.length === 1 ? k.toUpperCase() : "1234".includes(k) && k.length === 1 ? "ABCD"[+k - 1] : null;
  if (letter) { e.shiftKey ? strike(letter) : answer(letter); }
  else if (k === "arrowright") step(1);
  else if (k === "arrowleft") step(-1);
  else if (k === "enter" && cur() && answerOf(cur())) step(1);
  else if (k === "e") ACTIONS["toggle-explain"]();
  else if (k === "f") ACTIONS.flag();
  else if (k === "o") ACTIONS.original();
  else if (k === "r" && cur() && answerOf(cur())) retry();
  else if (k === "escape") { toggleMenu(false); document.body.classList.remove("sidebar-open"); ai.close(); }
  else return;
  e.preventDefault();
});

document.addEventListener("input", (e) => { if (S.set) vocab.onInput(e); });
document.addEventListener("submit", (e) => { if (S.set) vocab.onSubmit(e); });

// a PDF dropped anywhere is added to the questions already here
window.addEventListener("dragover", (e) => { if (S.set) e.preventDefault(); });
window.addEventListener("drop", (e) => {
  if (!S.set) return;
  e.preventDefault();
  importFile(e.dataTransfer.files[0]);
});

// ---------------------------------------------------------------- boot

ai.init();

// GitHub Pages lets browsers keep files for 10 minutes. On start, compare with the deployed
// version and reload once when a newer one is out (the claude.ai build is always served fresh).
async function freshen() {
  const mine = document.querySelector('meta[name="app-version"]')?.content;
  if (window.claude || !mine || mine === "0") return false;
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    const { version } = await res.json();
    if (!version || version === mine || sessionStorage.getItem("sat-trainer:reloaded") === version) return false;
    sessionStorage.setItem("sat-trainer:reloaded", version);
    await fetch(location.pathname, { cache: "reload" });   // refresh the cached page itself
    location.reload();
    return true;
  } catch {
    return false;
  }
}

(async function boot() {
  if (await freshen()) return;
  account.init();       // a device that was signed in reconnects in the background
  const params = new URLSearchParams(location.search);
  const src = params.get("src");
  if (src) {
    const url = new URL(src, location.href);
    history.replaceState(null, "", location.pathname);
    if (url.origin === location.origin) {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      let saved = null;
      try { saved = await db.get("set"); } catch { /* IndexedDB unavailable */ }
      if (saved?.version === SET_VERSION) S.set = normalizeSet(saved);
      return runImport(bytes, url.pathname.split("/").pop(), { mode: params.get("mode") || "add" });
    }
  }
  let saved = null;
  try { saved = await db.get("set"); } catch { /* IndexedDB unavailable */ }
  if (saved && saved.version === SET_VERSION) {
    S.set = normalizeSet(saved);
    showTrainer();
    return;
  }
  if (saved) return rebuildSet(saved);
  showLanding();
})();

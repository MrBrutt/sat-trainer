import { parseQuestionBank, openPdf, renderRegion, plain } from "./parser.js";

const app = document.getElementById("app");
const $ = (s, el = document) => el.querySelector(s);

const SET_VERSION = 2; // bump when the parser output changes; stored sets are rebuilt from the saved PDF
const KEY = {
  progress: "sat-trainer:progress:v1",
  flags: "sat-trainer:flags:v1",
  ui: "sat-trainer:ui:v1",
  theme: "sat-trainer:theme",
};
const PALETTE = ["#3b82f6", "#14b8a6", "#8b5cf6", "#f59e0b", "#ec4899", "#22c55e", "#ef4444", "#0ea5e9", "#a855f7", "#84cc16"];
// College Board's own ordering of Reading and Writing skills
const SKILL_ORDER = [
  "Central Ideas and Details", "Command of Evidence", "Inferences",
  "Words in Context", "Text Structure and Purpose", "Cross-Text Connections",
  "Rhetorical Synthesis", "Transitions", "Boundaries", "Form, Structure, and Sense",
];
const DIFF_LEVEL = { easy: 1, medium: 2, hard: 3 };

// ---------------------------------------------------------------- storage

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
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
};

const S = {
  set: null,
  progress: ls.get(KEY.progress, {}),          // id -> { c, ok, t, revealed? }
  flags: new Set(ls.get(KEY.flags, [])),
  ui: Object.assign({ skill: "all", status: "all", cur: null, original: {} }, ls.get(KEY.ui, {})),
  struck: {},                                  // id -> Set of crossed-out letters (this session)
  explainOpen: {},
  anim: null,
  pdf: null,
  pdfBytes: null,
};
const saveProgress = () => ls.set(KEY.progress, S.progress);
const saveFlags = () => ls.set(KEY.flags, [...S.flags]);
const saveUi = () => ls.set(KEY.ui, S.ui);

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

const isDark = () => document.documentElement.dataset.theme === "dark";

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

function prepareSet(parsed, fileName) {
  const first = new Map();
  parsed.questions.forEach((q, i) => { if (!first.has(q.skill)) first.set(q.skill, i); });
  const rank = (s) => {
    const k = SKILL_ORDER.findIndex((x) => x.toLowerCase() === s.toLowerCase());
    return k >= 0 ? k : 100 + first.get(s);
  };
  const questions = parsed.questions
    .map((q, i) => ({ ...q, order: i }))
    .sort((a, b) => rank(a.skill) - rank(b.skill) || a.order - b.order);
  questions.forEach((q, i) => (q.n = i + 1));
  const uniq = (k) => [...new Set(questions.map((q) => q[k]).filter(Boolean))];
  const skills = uniq("skill").map((name, i) => ({
    name, color: PALETTE[i % PALETTE.length], count: questions.filter((q) => q.skill === name).length,
  }));
  const domains = uniq("domain");
  const diffs = uniq("difficulty").sort((a, b) => (DIFF_LEVEL[a.toLowerCase()] || 9) - (DIFF_LEVEL[b.toLowerCase()] || 9));
  return {
    version: SET_VERSION,
    fileName,
    importedAt: Date.now(),
    title: domains.length === 1 ? domains[0] : uniq("section")[0] || "Question Bank",
    subtitle: [uniq("assessment").join(", "), uniq("section").join(", "), diffs.join(" · ")].filter(Boolean).join(" · "),
    skills,
    questions,
  };
}

// ---------------------------------------------------------------- landing & import

function showLanding(error) {
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

async function importFile(file) {
  if (!file) return;
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
    if (S.set) toast("Нужен PDF-файл"); else showLanding("Нужен PDF-файл.");
    return;
  }
  runImport(new Uint8Array(await file.arrayBuffer()), file.name);
}

async function runImport(bytes, fileName, { quiet = false } = {}) {
  showImporting();
  try {
    const parsed = await parseQuestionBank(bytes, (p) => {
      const pct = Math.round(p * 100);
      const bar = $("#imp-bar"), title = $("#imp-title");
      if (bar) bar.style.width = pct + "%";
      if (title) title.textContent = `Читаю PDF… ${pct}%`;
    });
    const set = prepareSet(parsed, fileName);
    S.set = set;
    S.pdf = null;
    S.pdfBytes = bytes;
    try { await db.set("set", set); await db.set("pdf", bytes); } catch (e) { console.warn("IndexedDB unavailable", e); }
    if (!quiet) S.ui = { ...S.ui, skill: "all", status: "all", cur: null };
    saveUi();
    showTrainer();
    if (!quiet) toast(`Готово: ${qWord(set.questions.length)}`);
  } catch (e) {
    console.error(e);
    const msg =
      e.message === "NO_ANSWERS" ? "В этом PDF нет правильных ответов. Экспортируйте вариант «With correct answers and explanations»." :
      e.message === "NOT_QUESTION_BANK" ? "В этом файле нет вопросов College Board. Нужен оригинальный PDF, скачанный в Question Bank кнопкой Export → «With correct answers and explanations» → Download PDF, а не переделанный или распечатанный файл." :
      "Не удалось прочитать PDF: " + (e.message || e);
    if (S.set) { showTrainer(); toast(msg); } else showLanding(msg);
  }
}

// ---------------------------------------------------------------- trainer

const skillOf = (q) => S.set.skills.find((s) => s.name === q.skill) || { color: "#888" };
const cur = () => S.set.questions.find((q) => q.id === S.ui.cur);
const statusOf = (id) => (!S.progress[id] ? "todo" : S.progress[id].ok ? "right" : "wrong");
const isOriginal = (q) => S.ui.original[q.id] ?? q.hasFigure;

function matches(q) {
  if (S.ui.skill !== "all" && q.skill !== S.ui.skill) return false;
  if (S.ui.status === "all") return true;
  if (S.ui.status === "flag") return S.flags.has(q.id);
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
    <input type="file" id="file2" accept="application/pdf,.pdf" hidden>`;
  $("#file2").addEventListener("change", (e) => importFile(e.target.files[0]));
  if (!cur()) ensureCurrent();
  renderAll(true);
}

function renderAll(scrollTop = false) {
  renderTopbar();
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
    <div class="spacer"></div>
    <div class="score" title="Решено ${answered} из ${qs.length}, верно ${right}">
      <div class="ring" style="--p:${answered / qs.length};--ok-p:${right / qs.length}"></div>
      <div><b>${answered}</b>/${qs.length}<span class="label"> решено</span>${answered ? ` · <b>${acc}%</b><span class="label"> верно</span>` : ""}</div>
    </div>
    <button class="icon-btn" data-action="theme" aria-label="Сменить тему" title="Сменить тему">${icon(isDark() ? "sun" : "moon")}</button>
    <div class="menu-wrap">
      <button class="icon-btn" data-action="menu" aria-label="Меню" aria-haspopup="menu" aria-expanded="false">${icon("dots")}</button>
      <div class="menu" id="menu" role="menu" hidden>
        <button role="menuitem" data-action="load-new">${icon("upload")} Загрузить другой PDF</button>
        <button role="menuitem" data-action="reset-progress">${icon("rotate")} Сбросить прогресс</button>
        <hr>
        <button role="menuitem" class="danger" data-action="wipe">${icon("trash")} Удалить данные из браузера</button>
      </div>
    </div>`;
}

function renderSidebar() {
  const qs = S.set.questions;
  const inSkill = (q) => S.ui.skill === "all" || q.skill === S.ui.skill;
  const count = (st) => qs.filter((q) => inSkill(q) && (st === "all" || (st === "flag" ? S.flags.has(q.id) : statusOf(q.id) === st))).length;
  const list = visible();
  const skills = [{ name: "all", label: "Все навыки", count: qs.length, color: "var(--text-2)" }, ...S.set.skills];
  const statuses = [["all", "Все"], ["todo", "Не решены"], ["wrong", "Ошибки"], ["right", "Верно"], ["flag", "Отмеченные"]];
  const stats = S.set.skills.map((s) => {
    const sq = qs.filter((q) => q.skill === s.name);
    const ok = sq.filter((q) => S.progress[q.id]?.ok).length;
    const bad = sq.filter((q) => S.progress[q.id] && !S.progress[q.id].ok).length;
    const pct = ok + bad ? Math.round((ok / (ok + bad)) * 100) + "%" : "—";
    return `<div class="stat-row"><div class="top"><span class="dot" style="--c:${s.color}"></span><span class="name">${esc(s.name)}</span><span class="num">${ok + bad}/${sq.length} · ${pct}</span></div>
      <div class="split-bar"><span class="ok" style="width:${(ok / sq.length) * 100}%"></span><span class="bad" style="width:${(bad / sq.length) * 100}%"></span></div></div>`;
  }).join("");
  const date = new Date(S.set.importedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

  $("#sidebar").innerHTML = `
    <div>
      <div class="side-label">Навык</div>
      <div class="skill-list">${skills.map((s) => `
        <button class="skill-item ${S.ui.skill === s.name ? "active" : ""}" data-action="skill" data-skill="${esc(s.name)}" aria-pressed="${S.ui.skill === s.name}">
          <span class="dot" style="--c:${s.color}"></span><span class="name">${esc(s.label || s.name)}</span><span class="count">${s.count}</span>
        </button>`).join("")}
      </div>
    </div>
    <div>
      <div class="side-label">Статус</div>
      <div class="chips">${statuses.map(([k, label]) => `
        <button class="chip ${S.ui.status === k ? "active" : ""}" data-action="status" data-status="${k}" aria-pressed="${S.ui.status === k}">${label}<span class="count">${count(k)}</span></button>`).join("")}
      </div>
    </div>
    <div>
      <div class="side-label"><span>Вопросы</span><span>${list.length}</span></div>
      <div class="qgrid">${list.map((q) => {
        const st = statusOf(q.id);
        const cls = [st === "right" ? "ok" : st === "wrong" ? "bad" : "", q.id === S.ui.cur ? "current" : "", S.flags.has(q.id) ? "flag" : ""].join(" ");
        return `<button class="qcell ${cls}" style="--c:${skillOf(q).color}" data-action="go" data-id="${q.id}" aria-label="Вопрос ${q.n}"${q.id === S.ui.cur ? ' aria-current="true"' : ""}>${q.n}</button>`;
      }).join("")}</div>
    </div>
    <div>
      <div class="side-label">Статистика</div>
      <div class="stat-rows">${stats}</div>
    </div>
    <div class="side-foot">
      <span>${icon("file", "icon-sm")} ${esc(S.set.fileName || "PDF")} · ${date}</span>
      <span>${icon("lock", "icon-sm")} Данные хранятся только в этом браузере</span>
    </div>`;
  $(".qcell.current", $("#sidebar"))?.scrollIntoView({ block: "nearest" });
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

function feedbackHtml(q, pr) {
  if (!pr) return "";
  const answer = q.correct || esc(q.correctText);
  if (pr.ok) {
    return `<div class="feedback ok" role="status"><div class="fic">${icon("check")}</div>
      <div class="ftext"><strong>Верно!</strong>Правильный ответ — ${answer}</div></div>`;
  }
  const head = pr.revealed ? "Ответ показан" : `Неверно${pr.c ? ` — вы выбрали ${esc(pr.c)}` : ""}`;
  return `<div class="feedback bad" role="status"><div class="fic">${icon("x")}</div>
    <div class="ftext"><strong>${head}</strong>Правильный ответ — ${answer}</div>
    <button class="btn btn-outline btn-sm" data-action="retry">${icon("rotate", "icon-sm")} Ещё раз</button></div>`;
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
    main.innerHTML = `<div class="empty"><h3>Здесь пусто</h3><p>По выбранным фильтрам вопросов нет.</p>
      <button class="btn btn-outline" data-action="clear-filters">Сбросить фильтры</button></div>`;
    return;
  }
  const pos = list.indexOf(q);
  const pr = S.progress[q.id];
  const orig = isOriginal(q);
  const sk = skillOf(q);
  main.innerHTML = `<div class="qwrap">
    <div class="qhead">
      <div class="qnum">Вопрос ${q.n} <span>· ${pos + 1} из ${list.length}</span></div>
      <span class="badge badge-skill" style="--c:${sk.color}"><span class="dot"></span>${esc(q.skill)}</span>
      ${q.difficulty ? `<span class="badge">${diffBars(q.difficulty)} ${esc(q.difficulty)}</span>` : ""}
      <div class="spacer"></div>
      <span class="mono" title="Question ID в College Board">${esc(q.id)}</span>
      <div class="qtools">
        <button class="icon-btn" data-action="flag" aria-pressed="${S.flags.has(q.id)}" title="Отметить вопрос (F)" aria-label="Отметить вопрос">${icon("flag")}</button>
        <button class="icon-btn" data-action="original" aria-pressed="${orig}" title="Оригинальная вёрстка PDF (O)" aria-label="Оригинальная вёрстка PDF">${icon("image")}</button>
      </div>
    </div>
    ${orig
      ? `<div class="orig" data-region="question"></div><div class="orig-note">${icon("image", "icon-sm")} Оригинальная вёрстка из PDF</div>`
      : `<article class="card passage">${stemHtml(q)}</article>${q.prompt ? `<div class="prompt">${runsHtml(q.prompt.runs)}</div>` : ""}`}
    ${choicesHtml(q, pr, orig)}
    ${feedbackHtml(q, pr)}
    ${explainHtml(q, pr)}
    <nav class="qnav" aria-label="Навигация по вопросам">
      <button class="btn btn-outline" data-action="prev" ${pos <= 0 ? "disabled" : ""} aria-label="Предыдущий вопрос">${icon("left")}<span class="btn-label">Назад</span></button>
      <div class="spacer"></div>
      ${pr ? `<button class="btn btn-ghost" data-action="retry" aria-label="Решить заново">${icon("rotate")}<span class="btn-label">Решить заново</span></button>` : ""}
      <button class="btn btn-primary" data-action="next" ${pos >= list.length - 1 ? "disabled" : ""} aria-label="Следующий вопрос"><span class="btn-label">Далее</span>${icon("right")}</button>
    </nav>
    <div class="hints">
      <span><kbd>A</kbd>–<kbd>D</kbd> ответ</span><span><kbd>Shift</kbd>+<kbd>A</kbd> вычеркнуть</span>
      <span><kbd>←</kbd> <kbd>→</kbd> навигация</span><span><kbd>E</kbd> разбор</span><span><kbd>F</kbd> отметить</span>
    </div>
  </div>`;
  S.anim = null;
  if (orig || (pr && isOriginal(q))) fillOriginals(q);
  if (scrollTop) window.scrollTo({ top: 0 });
}

async function fillOriginals(q) {
  const els = [...document.querySelectorAll("#main [data-region]")];
  if (!els.length) return;
  try {
    if (!S.pdf) {
      S.pdfBytes ||= await db.get("pdf");
      if (!S.pdfBytes) throw new Error("no pdf");
      S.pdf = await openPdf(S.pdfBytes);
    }
    for (const el of els) {
      const key = el.dataset.region;
      const region = key === "question" ? q.src.question : q.src.rationale[+key.split("-")[1]];
      const canvas = await renderRegion(S.pdf, region, el.clientWidth - 28);
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

function answer(letter) {
  const q = cur();
  if (!q || S.progress[q.id] || !q.choices.some((c) => c.letter === letter)) return;
  S.progress[q.id] = { c: letter, ok: letter === q.correct, t: Date.now() };
  saveProgress();
  S.anim = { id: q.id, letter };
  S.explainOpen[q.id] = true;
  renderAll();
  $(".feedback")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function checkSpr() {
  const q = cur();
  const val = $("#spr")?.value.trim();
  if (!q || !val) return;
  const norm = (s) => s.replace(/\s+/g, "").replace(/^\+/, "").toLowerCase();
  const ok = String(q.correctText || "").split(/[,;]| or /).map(norm).filter(Boolean).includes(norm(val));
  S.progress[q.id] = { c: val, ok, t: Date.now() };
  saveProgress();
  renderAll();
}

function retry() {
  const q = cur();
  if (!q) return;
  delete S.progress[q.id];
  delete S.struck[q.id];
  saveProgress();
  renderAll();
}

function strike(letter) {
  const q = cur();
  if (!q || S.progress[q.id]) return;
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
    if (!q || S.progress[q.id]) return;
    S.progress[q.id] = { c: null, ok: false, revealed: true, t: Date.now() };
    S.explainOpen[q.id] = true;
    saveProgress();
    renderAll();
  },
  retry,
  next: () => step(1),
  prev: () => step(-1),
  go: (el) => go(el.dataset.id),
  skill: (el) => setFilter("skill", el.dataset.skill),
  status: (el) => setFilter("status", el.dataset.status),
  "clear-filters": () => { S.ui.status = "all"; setFilter("skill", "all"); },
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
    if (!q || !S.progress[q.id]) return;
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
  "load-new": () => { toggleMenu(false); $("#file2").click(); },
  "reset-progress": async () => {
    toggleMenu(false);
    if (!(await confirmDialog("Сбросить прогресс?", "Все ответы и статистика будут удалены. Сами вопросы останутся.", "Сбросить", true))) return;
    S.progress = {};
    S.struck = {};
    saveProgress();
    renderAll();
    toast("Прогресс сброшен");
  },
  wipe: async () => {
    toggleMenu(false);
    if (!(await confirmDialog("Удалить все данные?", "Из браузера будут удалены загруженный PDF, вопросы, прогресс и отметки.", "Удалить", true))) return;
    try { await db.clear(); } catch { /* nothing stored */ }
    [KEY.progress, KEY.flags, KEY.ui].forEach(ls.del);
    Object.assign(S, { set: null, progress: {}, flags: new Set(), struck: {}, pdf: null, pdfBytes: null });
    S.ui = { skill: "all", status: "all", cur: null, original: {} };
    showLanding();
  },
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
  if (e.target.closest("input, textarea, select, dialog")) {
    if (e.key === "Enter" && e.target.id === "spr") checkSpr();
    return;
  }
  const k = e.key.toLowerCase();
  const letter = "abcd".includes(k) && k.length === 1 ? k.toUpperCase() : "1234".includes(k) && k.length === 1 ? "ABCD"[+k - 1] : null;
  if (letter) { e.shiftKey ? strike(letter) : answer(letter); }
  else if (k === "arrowright") step(1);
  else if (k === "arrowleft") step(-1);
  else if (k === "enter" && cur() && S.progress[cur().id]) step(1);
  else if (k === "e") ACTIONS["toggle-explain"]();
  else if (k === "f") ACTIONS.flag();
  else if (k === "o") ACTIONS.original();
  else if (k === "r" && cur() && S.progress[cur().id]) retry();
  else if (k === "escape") { toggleMenu(false); document.body.classList.remove("sidebar-open"); }
  else return;
  e.preventDefault();
});

// a PDF dropped anywhere replaces the current set
window.addEventListener("dragover", (e) => { if (S.set) e.preventDefault(); });
window.addEventListener("drop", (e) => {
  if (!S.set) return;
  e.preventDefault();
  importFile(e.dataTransfer.files[0]);
});

// ---------------------------------------------------------------- boot

(async function boot() {
  const src = new URLSearchParams(location.search).get("src");
  if (src) {
    const url = new URL(src, location.href);
    history.replaceState(null, "", location.pathname);
    if (url.origin === location.origin) {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      return runImport(bytes, url.pathname.split("/").pop());
    }
  }
  let saved = null;
  try { saved = await db.get("set"); } catch { /* IndexedDB unavailable */ }
  if (saved && saved.version === SET_VERSION) {
    S.set = saved;
    showTrainer();
    return;
  }
  if (saved) {
    let bytes = null;
    try { bytes = await db.get("pdf"); } catch { /* IndexedDB unavailable */ }
    if (bytes) return runImport(bytes, saved.fileName, { quiet: true });
  }
  showLanding();
})();

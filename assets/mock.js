// Пробник: the Reading and Writing section as on the SAT — two modules of 27 questions and 32 minutes,
// the blocks in the exam's order, the second module harder or easier by the first. No help on the way:
// no words before a question, no think-first steps, no feedback. At the end, a score range out of 800.
import { paceFor, fmtTime, rushed } from "./timer.js";
import { skillName } from "./domains.js";

// One module: College Board's shares of the four blocks (about 28%, 26%, 26%, 20%) over 27 questions.
export const BLUEPRINT = [
  { domain: "Craft and Structure", skills: [["Words in Context", 4], ["Text Structure and Purpose", 2], ["Cross-Text Connections", 1]] },
  { domain: "Information and Ideas", skills: [["Central Ideas and Details", 2], ["Command of Evidence", 3], ["Inferences", 2]] },
  { domain: "Standard English Conventions", skills: [["Boundaries", 3], ["Form, Structure, and Sense", 4]], byDifficulty: true },
  { domain: "Expression of Ideas", skills: [["Transitions", 3], ["Rhetorical Synthesis", 3]] },
];
export const MODULE_MINUTES = 32;
const MIN = 60_000;

const RANK = { Easy: 0, Medium: 1, Hard: 2 };
const diffOf = (q) => (q.difficulty in RANK ? q.difficulty : "Medium");
// the difficulty wanted for each place of a type, and what to take when there is none of it
const TARGETS = { mixed: ["Medium", "Easy", "Hard", "Medium"], harder: ["Hard", "Medium", "Hard", "Hard"], easier: ["Easy", "Medium", "Easy", "Easy"] };
const FALLBACK = { Easy: ["Easy", "Medium", "Hard"], Medium: ["Medium", "Easy", "Hard"], Hard: ["Hard", "Medium", "Easy"] };

// A module's question ids in the exam's order: the blocks in turn; inside a block by type, then easier
// first; grammar by difficulty alone. Questions not answered yet come first; when a type runs short,
// the ones answered longest ago.
export function buildModule(questions, progress, { level = "mixed", exclude = new Set(), rng = Math.random } = {}) {
  const taken = new Set(exclude);
  const out = [];
  for (const block of BLUEPRINT) {
    const picked = [];
    block.skills.forEach(([skill, n], s) => {
      const pool = questions.filter((q) => skillName(q.skill) === skill);
      for (let i = 0; i < n; i++) {
        const q = choose(pool, TARGETS[level][i % 4]);
        if (!q) break;
        taken.add(q.id);
        picked.push({ q, s });
      }
    });
    picked.sort((a, b) => (block.byDifficulty ? 0 : a.s - b.s) || RANK[diffOf(a.q)] - RANK[diffOf(b.q)] || a.s - b.s);
    out.push(...picked.map((p) => p.q.id));
  }
  return out;

  function choose(pool, want) {
    for (const d of FALLBACK[want]) {
      const fresh = pool.filter((q) => !taken.has(q.id) && !progress[q.id] && diffOf(q) === d);
      if (fresh.length) return fresh[Math.floor(rng() * fresh.length)];
    }
    const old = pool.filter((q) => !taken.has(q.id) && progress[q.id]).sort((a, b) => (progress[a.id].t || 0) - (progress[b.id].t || 0));
    return old[0] || null;
  }
}

// Two thirds right or more: the harder second module. College Board does not publish its rule.
export const routeOf = (correct, total) => (total && correct * 3 >= total * 2 ? "harder" : "easier");

// College Board, «Scoring Your SAT Practice Test #7» (paper version of the digital test): Reading and
// Writing raw score 0–66 → section score range. Checked on the student's Bluebook mock: 40 of 54 →
// 580–640, Bluebook gave 630.
const TABLE = [[200, 200], [210, 220], [210, 220], [210, 220], [210, 220], [210, 230], [210, 240], [210, 250], [220, 260], [220, 270],
  [220, 280], [230, 290], [230, 300], [240, 310], [240, 320], [250, 330], [270, 330], [300, 340], [310, 350], [320, 360],
  [320, 360], [330, 370], [340, 380], [350, 390], [350, 390], [360, 400], [370, 410], [370, 410], [380, 420], [390, 430],
  [400, 440], [410, 450], [410, 450], [420, 460], [430, 470], [440, 480], [450, 490], [460, 500], [470, 510], [470, 530],
  [480, 540], [490, 550], [500, 560], [510, 570], [520, 580], [530, 590], [540, 600], [560, 620], [570, 630], [580, 640],
  [590, 650], [600, 660], [610, 670], [630, 690], [640, 700], [660, 700], [670, 710], [680, 720], [690, 730], [710, 750],
  [720, 760], [730, 770], [750, 770], [760, 780], [770, 790], [780, 800], [800, 800]];
export const scoreRange = (correct, total) => TABLE[total ? Math.round((correct / total) * 66) : 0];

// The mock's outcome: right per module, per type (right, rushed, longer than its norm), the wrong ids.
// A question left without an answer is wrong, as on the test.
export function resultOf(modules, byId) {
  const rows = new Map();
  const wrong = [];
  const perModule = modules.map((m) => {
    let ok = 0;
    for (const id of m.ids) {
      const q = byId.get(id);
      if (!q) continue;
      const right = m.answers[id] === q.correct;
      const ms = m.ms?.[id] || 0;
      const skill = skillName(q.skill);
      const row = rows.get(skill) || { skill, n: 0, ok: 0, rushed: 0, slow: 0 };
      row.n++;
      if (right) { row.ok++; ok++; } else wrong.push(id);
      if (m.answers[id] && rushed(q, { ok: right, ms })) row.rushed++;
      if (ms > paceFor(q)) row.slow++;
      rows.set(skill, row);
    }
    return ok;
  });
  const order = BLUEPRINT.flatMap((b) => b.skills.map(([s]) => s));
  const skills = [...rows.values()].sort((a, b) => order.indexOf(a.skill) - order.indexOf(b.skill));
  return { correct: perModule.reduce((a, b) => a + b, 0), total: modules.reduce((n, m) => n + m.ids.length, 0), perModule, skills, wrong };
}

// ---------------------------------------------------------------- screens

export function createMock(ctx) {
  const { S, $, icon, esc, toast, ls, KEY, plural, confirmDialog } = ctx;
  let state = ls.get(KEY.mock, null);        // the mock in progress, or finished and not closed yet
  let history = ls.get(KEY.mocks, {});       // finished mocks by id
  let ticker = null;
  let warned = false;

  const save = () => ls.set(KEY.mock, state);
  const saveHistory = () => ls.set(KEY.mocks, history);
  const byId = () => new Map(S.set.questions.map((q) => [q.id, q]));
  const running = () => state && (state.stage === 0 || state.stage === 1);
  const mod = () => (running() ? state.modules[state.stage] : null);
  const curId = () => mod()?.ids[state.pos] || null;
  const left = () => Math.max(0, (mod()?.endsAt || 0) - Date.now());
  const qWord = (n) => `${n} ${plural(n, "вопрос", "вопроса", "вопросов")}`;
  const onScreen = () => S.ui.view === "mock";
  const newModule = (level, ids) => ({ level, ids, answers: {}, ms: {}, flags: [], endsAt: Date.now() + MODULE_MINUTES * MIN });

  // Time on each question: the one on screen gathers time until the next render or a step away.
  function stamp(showing = onScreen()) {
    if (!state) return;
    const m = mod();
    const now = Date.now();
    if (m && state.view && m.ids.includes(state.view.id)) m.ms[state.view.id] = (m.ms[state.view.id] || 0) + Math.max(0, Math.min(now, m.endsAt) - state.view.since);
    state.view = m && showing ? { id: curId(), since: now } : null;
  }
  // leaving the mock's screen stops the clock of the question on it (the module's clock runs on)
  function pause() { if (state) { stamp(false); save(); } }

  function tick() {
    if (!running()) { clearInterval(ticker); ticker = null; return; }
    const ms = left();
    const el = document.getElementById("mtimer");
    if (el) el.querySelector("b").textContent = fmtTime(ms);
    const big = document.getElementById("mtimer-side");
    if (big) big.textContent = fmtTime(ms);
    if (ms <= 5 * MIN && ms > 0 && !warned) { warned = true; toast("Осталось 5 минут"); el?.classList.add("warn"); }
    if (ms <= 0) finishModule(true);
  }
  function startTicker() { if (!ticker && running()) ticker = setInterval(tick, 500); }

  function refresh(scrollTop = false) { if (onScreen()) ctx.renderAll(scrollTop); else ctx.refreshChrome(); }

  async function start() {
    if (!S.set) return;
    const ok = await confirmDialog("Начать пробник?",
      "Два модуля по 27 вопросов, на каждый 32 минуты — как Reading and Writing на SAT. Подсказок, проверки слов и разборов не будет: ответы и оценка балла — в конце. Таймер не останавливается.",
      "Начать");
    if (!ok) return;
    state = { id: `m${Date.now()}`, at: Date.now(), stage: 0, pos: 0, modules: [newModule("mixed", buildModule(S.set.questions, S.progress, { level: "mixed" }))] };
    warned = false;
    save();
    openView();
  }
  function openView() { S.ui.view = "mock"; ctx.saveUi(); ctx.renderAll(true); startTicker(); }

  function finishModule(auto = false) {
    const m = mod();
    if (!m) return;
    stamp();
    if (state.stage === 0) {
      const map = byId();
      const ok = m.ids.filter((id) => m.answers[id] === map.get(id)?.correct).length;
      state.route = routeOf(ok, m.ids.length);
      state.stage = "break";
    } else finishMock();
    state.view = null;
    save();
    if (auto) toast("Время модуля вышло");
    refresh(true);
  }

  function startSecond() {
    if (state?.stage !== "break") return;
    const ids = buildModule(S.set.questions, S.progress, { level: state.route, exclude: new Set(state.modules[0].ids) });
    state.modules.push(newModule(state.route, ids));
    state.stage = 1;
    state.pos = 0;
    warned = false;
    save();
    refresh(true);
    startTicker();
  }

  function finishMock() {
    const map = byId();
    const r = resultOf(state.modules, map);
    // first answers go to the trainer: statistics, the day's plan, mistakes to review
    for (const m of state.modules) {
      for (const id of m.ids) {
        const q = map.get(id), c = m.answers[id];
        if (!q || !c || S.progress[id]) continue;
        ctx.recordFirst(q, { c, ok: c === q.correct, t: Date.now(), ms: m.ms[id] || 0, mock: state.id });
      }
    }
    history[state.id] = { at: state.at, correct: r.correct, total: r.total, perModule: r.perModule, route: state.route, range: scoreRange(r.correct, r.total), skills: r.skills, wrong: r.wrong };
    saveHistory();
    state.stage = "done";
  }

  function go(i) {
    const m = mod();
    if (!m || i < 0 || i >= m.ids.length) return;
    stamp();
    state.pos = i;
    save();
    ctx.renderAll(true);
  }
  function answer(letter) {
    const q = byId().get(curId());
    if (!q || !q.choices.some((c) => c.letter === letter)) return;
    const m = mod();
    m.answers[q.id] = m.answers[q.id] === letter ? undefined : letter;
    if (!m.answers[q.id]) delete m.answers[q.id];
    S.struck[q.id]?.delete(letter);
    save();
    ctx.renderAll();
  }
  function strike(letter) {
    const id = curId();
    if (!id) return;
    const set = (S.struck[id] ||= new Set());
    set.has(letter) ? set.delete(letter) : set.add(letter);
    if (set.has(letter) && mod().answers[id] === letter) delete mod().answers[id];
    save();
    ctx.renderAll();
  }
  function flag() {
    const m = mod(), id = curId();
    if (!m || !id) return;
    m.flags = m.flags.includes(id) ? m.flags.filter((x) => x !== id) : [...m.flags, id];
    save();
    ctx.renderAll();
  }
  async function askFinish() {
    const m = mod();
    if (!m) return;
    const blank = m.ids.filter((id) => !m.answers[id]).length;
    const text = blank
      ? `Без ответа ${qWord(blank)} — на экзамене это ошибки. До конца модуля ${fmtTime(left())}.`
      : `До конца модуля ${fmtTime(left())}. Вернуться к вопросам этого модуля будет нельзя.`;
    if (await confirmDialog(state.stage === 0 ? "Завершить модуль 1?" : "Завершить пробник?", text, "Завершить")) finishModule();
  }

  // ---------------------------------------------------------------- render

  function renderSidebar() {
    const side = $("#sidebar");
    if (!side) return;
    const m = mod();
    if (!m) { side.innerHTML = `<div><div class="side-label">Пробник</div><p class="muted" style="font-size:13px">Reading and Writing: два модуля по 27 вопросов и 32 минуты.</p></div>`; return; }
    const answered = m.ids.filter((id) => m.answers[id]).length;
    side.innerHTML = `<div>
        <div class="side-label"><span>Модуль ${state.stage + 1} из 2</span><span>${answered} из ${m.ids.length}</span></div>
        <div class="mock-clock ${S.ui.mockTimerHidden ? "hidden" : ""}">${icon("timer")}<b id="mtimer-side">${fmtTime(left())}</b></div>
        <div class="qgrid">${m.ids.map((id, i) => `<button class="qcell ${m.answers[id] ? "answered" : ""} ${i === state.pos ? "current" : ""} ${m.flags.includes(id) ? "flag" : ""}" data-action="mock-go" data-i="${i}" aria-label="Вопрос ${i + 1}">${i + 1}</button>`).join("")}</div>
        <div class="mock-legend"><span><i class="qcell answered"></i> есть ответ</span><span><i class="qcell flag"></i> отмечен</span></div>
      </div>
      <div class="mock-side-actions">
        <button class="btn btn-primary" data-action="mock-finish">${state.stage === 0 ? "Завершить модуль 1" : "Завершить пробник"}</button>
        <button class="btn btn-ghost btn-sm" data-action="mock-quit">Прервать пробник</button>
      </div>`;
  }

  function renderMain(scrollTop = false) {
    const main = $("#main");
    if (!main) return;
    if (!state) { S.ui.view = "today"; ctx.saveUi(); ctx.renderAll(true); return; }
    if (running() && left() <= 0) { finishModule(true); return; }
    if (state.stage === "break") main.innerHTML = breakHtml();
    else if (state.stage === "done") main.innerHTML = resultHtml();
    else main.innerHTML = questionHtml();
    stamp();
    save();
    startTicker();
    if (running()) {
      const q = byId().get(curId());
      if (q) ctx.fillOriginals(q, () => onScreen() && curId() === q.id);
    }
    if (scrollTop) window.scrollTo({ top: 0 });
  }

  function questionHtml() {
    const m = mod(), q = byId().get(curId());
    if (!q) return `<div class="empty"><h3>Вопрос не найден</h3><p>Похоже, набор вопросов изменился.</p><button class="btn btn-outline" data-action="mock-quit">Прервать пробник</button></div>`;
    const orig = q.hasFigure && !ctx.passageOf(q);
    const struck = S.struck[q.id] || new Set();
    const picked = m.answers[q.id];
    const last = state.pos === m.ids.length - 1;
    return `<div class="qwrap mock">
      <div class="qhead">
        <div class="qnum">Модуль ${state.stage + 1} <span>· вопрос ${state.pos + 1} из ${m.ids.length}</span></div>
        ${S.ui.mockTimerHidden ? "" : `<span class="qtimer mock-timer ${left() <= 5 * MIN ? "warn" : ""}" id="mtimer">${icon("timer", "icon-sm")}<b>${fmtTime(left())}</b></span>`}
        <button class="btn btn-ghost btn-sm" data-action="mock-timer">${S.ui.mockTimerHidden ? "Показать время" : "Скрыть время"}</button>
        <div class="spacer"></div>
        <button class="icon-btn" data-action="mock-flag" aria-pressed="${m.flags.includes(q.id)}" title="Отметить, чтобы вернуться (F)" aria-label="Отметить вопрос">${icon("flag")}</button>
      </div>
      ${orig
        ? `<div class="orig" data-region="question"></div>`
        : `${ctx.passageOf(q) ? `<div class="orig figure" data-region="figure"></div>` : ""}<article class="card passage">${ctx.stemHtml(ctx.passageOf(q) ? [ctx.passageOf(q)] : q.stem)}</article>${q.prompt ? `<div class="prompt">${ctx.runsHtml(q.prompt.runs)}</div>` : ""}`}
      <div class="choices ${orig ? "compact-choices" : ""}" role="group" aria-label="Варианты ответа">${q.choices.map((c) => `
        <div class="choice-row">
          <button class="choice ${picked === c.letter ? "picked" : ""} ${struck.has(c.letter) ? "struck" : ""}" data-action="mock-answer" data-letter="${c.letter}" aria-pressed="${picked === c.letter}">
            <span class="letter">${c.letter}</span><span class="ctext">${ctx.runsHtml(c.runs)}</span><span class="cicon"></span>
          </button>
          <button class="strike ${struck.has(c.letter) ? "on" : ""}" data-action="mock-strike" data-letter="${c.letter}" title="Вычеркнуть вариант (Shift+${c.letter})" aria-label="Вычеркнуть вариант ${c.letter}" aria-pressed="${struck.has(c.letter)}">${icon("ban")}</button>
        </div>`).join("")}</div>
      <nav class="qnav" aria-label="Навигация по пробнику">
        <button class="btn btn-outline" data-action="mock-prev" ${state.pos === 0 ? "disabled" : ""}>${icon("left")}<span class="btn-label">Назад</span></button>
        <div class="spacer"></div>
        ${last ? `<button class="btn btn-primary" data-action="mock-finish">${state.stage === 0 ? "Завершить модуль 1" : "Завершить пробник"}</button>`
          : `<button class="btn btn-primary" data-action="mock-next"><span class="btn-label">Далее</span>${icon("right")}</button>`}
      </nav>
      <div class="hints">
        <span><kbd>A</kbd>–<kbd>D</kbd> ответ</span><span><kbd>Shift</kbd>+<kbd>A</kbd> вычеркнуть</span>
        <span><kbd>←</kbd> <kbd>→</kbd> вопросы</span><span><kbd>F</kbd> отметить</span>
      </div>
    </div>`;
  }

  function breakHtml() {
    const harder = state.route === "harder";
    return `<div class="qwrap"><section class="card mock-panel">
      <div class="done-icon">${icon("check")}</div>
      <h2>Модуль 1 завершён</h2>
      <p>Второй модуль — <b>${harder ? "трудный" : "полегче"}</b>: ${harder ? "в первом модуле верно две трети вопросов или больше, как на SAT, дальше вопросы труднее." : "в первом модуле верно меньше двух третей, поэтому вопросы будут полегче — на SAT такой модуль ограничивает балл."}</p>
      <p class="muted">На экзамене второй модуль начинается сразу. На него снова ${MODULE_MINUTES} минуты.</p>
      <button class="btn btn-primary btn-lg" data-action="mock-second">Начать модуль 2</button>
    </section></div>`;
  }

  function resultHtml() {
    const r = history[state.id];
    if (!r) return `<div class="empty"><h3>Результат не найден</h3><button class="btn btn-outline" data-action="mock-close">Закрыть</button></div>`;
    return `<div class="qwrap">${resultBody(r)}
      <div class="row" style="justify-content:center;margin-top:18px"><button class="btn btn-primary btn-lg" data-action="mock-close">Готово</button></div></div>`;
  }

  function resultBody(r) {
    const map = byId();
    const wrong = r.wrong.map((id) => map.get(id)).filter(Boolean);
    const date = new Date(r.at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    return `<section class="card mock-panel mock-result">
        <div class="mock-score"><b>${r.range[0]}–${r.range[1]}</b><span>из 800 · оценка</span></div>
        <p>Верно <b>${r.correct} из ${r.total}</b> · модуль 1: ${r.perModule[0] ?? 0} · модуль 2 (${r.route === "harder" ? "трудный" : "полегче"}): ${r.perModule[1] ?? 0}</p>
        <p class="muted">Пересчёт по официальной таблице College Board для бумажной версии пробника: верные ответы переводятся в число из 66 и в диапазон. Точный балл даёт только Bluebook.${r.route === "harder" ? "" : " Второй модуль был полегче: на настоящем SAT это ограничивает балл (по неофициальным оценкам — около 560–630)."}</p>
        <p class="muted">${date}</p>
      </section>
      <section class="card today-block">
        <div class="block-head"><h3>По типам вопросов</h3><span>спешка — ошибка быстрее 60% нормы</span></div>
        <table class="mock-table"><thead><tr><th>Тип</th><th>Верно</th><th>В спешке</th><th>Дольше нормы</th></tr></thead><tbody>
          ${r.skills.map((s) => `<tr class="${s.ok < s.n ? "has-miss" : ""}"><td>${esc(s.skill)}</td><td><b>${s.ok}</b> из ${s.n}</td><td>${s.rushed || "—"}</td><td>${s.slow || "—"}</td></tr>`).join("")}
        </tbody></table>
      </section>
      ${wrong.length ? `<section class="card today-block">
        <div class="block-head"><h3>Ошибки</h3><span>${wrong.length} · новые уже в повторе</span></div>
        <div class="mock-wrong">${wrong.map((q) => `<button class="qcell bad" data-action="mock-open" data-id="${esc(q.id)}" title="${esc(q.skill)}">${q.n}</button>`).join("")}</div>
        <div class="row" style="margin-top:12px"><button class="btn btn-outline btn-sm" data-action="today-review">${icon("clock", "icon-sm")} Повторять ошибки</button></div>
      </section>` : ""}`;
  }

  // The block on «Сегодня»: start, go on, or the last result.
  function card() {
    if (!S.set) return "";
    const done = Object.values(history).sort((a, b) => b.at - a.at);
    const lastLine = done.length ? `Последний: <b>${done[0].range[0]}–${done[0].range[1]}</b> · верно ${done[0].correct} из ${done[0].total} · ${new Date(done[0].at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}${done.length > 1 ? ` · всего ${done.length}` : ""}` : "В конце — оценка балла из 800 по таблице College Board.";
    if (running()) {
      return `<section class="card task mock-card"><div class="task-icon">${icon("timer")}</div>
        <div class="task-body"><div class="task-title">Пробник идёт</div><div class="task-sub">Модуль ${state.stage + 1} из 2 · осталось ${fmtTime(left())}</div></div>
        <button class="btn btn-primary btn-sm" data-action="mock-resume">Продолжить ${icon("right", "icon-sm")}</button></section>`;
    }
    if (state?.stage === "break") {
      return `<section class="card task mock-card"><div class="task-icon">${icon("timer")}</div>
        <div class="task-body"><div class="task-title">Пробник: модуль 1 пройден</div><div class="task-sub">Осталось начать второй модуль</div></div>
        <button class="btn btn-primary btn-sm" data-action="mock-resume">Продолжить ${icon("right", "icon-sm")}</button></section>`;
    }
    return `<section class="card task mock-card"><div class="task-icon">${icon("timer")}</div>
      <div class="task-body"><div class="task-title">Пробник Reading and Writing</div>
        <div class="task-sub">2 модуля по 27 вопросов и 32 минуты, как на SAT, без подсказок. ${lastLine}</div></div>
      <button class="btn btn-outline btn-sm" data-action="mock-start">Начать ${icon("right", "icon-sm")}</button></section>`;
  }

  function onKey(e) {
    if (!running() || !onScreen()) return false;
    const k = e.key.toLowerCase();
    const letter = "abcd".includes(k) && k.length === 1 ? k.toUpperCase() : "1234".includes(k) && k.length === 1 ? "ABCD"[+k - 1] : null;
    if (letter) { e.shiftKey ? strike(letter) : answer(letter); return true; }
    if (e.key === "ArrowRight") { go(state.pos + 1); return true; }
    if (e.key === "ArrowLeft") { go(state.pos - 1); return true; }
    if (k === "f") { flag(); return true; }
    return false;
  }

  const actions = {
    "mock-start": start,
    "mock-resume": openView,
    "mock-answer": (el) => answer(el.dataset.letter),
    "mock-strike": (el) => strike(el.dataset.letter),
    "mock-go": (el) => go(+el.dataset.i),
    "mock-prev": () => go(state.pos - 1),
    "mock-next": () => go(state.pos + 1),
    "mock-flag": flag,
    "mock-timer": () => { S.ui.mockTimerHidden = !S.ui.mockTimerHidden; ctx.saveUi(); ctx.renderAll(); },
    "mock-finish": askFinish,
    "mock-second": startSecond,
    "mock-close": () => { state = null; save(); S.ui.view = "today"; ctx.saveUi(); ctx.renderAll(true); },
    "mock-open": (el) => ctx.openQuestion(el.dataset.id),
    "mock-quit": async () => {
      if (!(await confirmDialog("Прервать пробник?", "Ответы этого пробника не сохранятся, вопросы останутся нерешёнными.", "Прервать", true))) return;
      state = null; save(); clearInterval(ticker); ticker = null;
      S.ui.view = "today"; ctx.saveUi(); ctx.renderAll(true);
    },
  };

  startTicker();
  return {
    card, renderMain, renderSidebar, onKey, actions, pause,
    history: () => history,
    setHistory: (v) => { history = v || {}; saveHistory(); },
  };
}

// Daily routine: spaced review of mistakes, the "Today" plan, streaks, activity calendar and achievements.
import { startOfDay } from "./vocab.js";

const DAY = 86400000;
export const REVIEW_DAYS = [1, 3, 7];   // a mistake comes back after 1, 3, then 7 days; 3 right in a row = fixed

export const dayKey = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const shiftDay = (key, n) => { const [y, m, d] = key.split("-").map(Number); return dayKey(new Date(y, m - 1, d + n).getTime()); };

// ---------------------------------------------------------------- review scheduling

export function enqueueReview(r, now = Date.now(), dueNow = false) {
  if (r && !r.done) return r;
  return { due: dueNow ? now : startOfDay(now) + DAY, step: 0, lapses: r?.lapses || 0, done: false, added: now, last: 0 };
}

export function gradeReview(r, ok, now = Date.now()) {
  const n = { ...(r || enqueueReview(null, now)), last: now };
  if (ok) {
    n.step += 1;
    if (n.step >= REVIEW_DAYS.length) { n.done = true; n.fixedAt = now; }
    else n.due = startOfDay(now) + REVIEW_DAYS[n.step] * DAY;
  } else {
    n.step = 0;
    n.lapses += 1;
    n.done = false;
    n.due = startOfDay(now) + DAY;
  }
  return n;
}

export const isDue = (r, now = Date.now()) => !!r && !r.done && r.due <= now;

export const ACTIVITY_DEFAULT = () => ({ days: {}, goalNew: 10, run: 0, bestRun: 0, bestStreak: 0, unlocked: [], remind: "19:00" });

// ---------------------------------------------------------------- the module

export function createToday(ctx) {
  const { S, $, icon, esc, toast, ls, KEY, plural } = ctx;
  const save = () => ls.set(KEY.activity, S.activity);
  const today = () => dayKey();
  const day = (k = today()) => (S.activity.days[k] ||= { q: 0, ok: 0, r: 0, rok: 0, w: 0 });
  const points = (d) => (d ? d.q + d.r + Math.ceil(d.w / 3) : 0);

  // ---------------------------------------------------------------- tasks & streak

  function tasks() {
    const qs = S.set.questions;
    const now = Date.now();
    const d = S.activity.days[today()] || {};
    const dueReviews = qs.filter((q) => isDue(S.review[q.id], now)).length;
    const reviewTotal = (d.r || 0) + dueReviews;
    const cardsLeft = ctx.vocabDue();
    const cardsTotal = (d.w || 0) + cardsLeft;
    const unanswered = qs.filter((q) => !S.progress[q.id]).length;
    const target = Math.min(S.activity.goalNew, (d.q || 0) + unanswered);
    return [
      {
        id: "review", icon: "clock", title: "Повторить ошибки",
        done: dueReviews === 0, cur: d.r || 0, total: reviewTotal,
        sub: dueReviews ? `${dueReviews} ${plural(dueReviews, "вопрос ждёт", "вопроса ждут", "вопросов ждут")} повторения`
          : reviewTotal ? "Все повторы на сегодня сделаны" : "Сегодня повторять нечего",
        action: "today-review", cta: "Повторять",
      },
      {
        id: "words", icon: "cards", title: "Карточки слов",
        done: cardsLeft === 0, cur: d.w || 0, total: cardsTotal,
        sub: cardsLeft ? `Осталось ${cardsLeft} ${plural(cardsLeft, "карточка", "карточки", "карточек")}`
          : cardsTotal ? "Все карточки на сегодня пройдены" : "Карточек на сегодня нет",
        action: "today-words", cta: "Учить",
      },
      {
        id: "new", icon: "target", title: "Новые вопросы",
        done: (d.q || 0) >= target, cur: Math.min(d.q || 0, target), total: target,
        sub: target ? `${d.q || 0} из ${target} на сегодня` : "Все вопросы набора решены",
        action: "today-new", cta: "Решать",
      },
    ];
  }

  const isClosed = (k) => !!S.activity.days[k]?.closed;

  function streak() {
    let k = isClosed(today()) ? today() : shiftDay(today(), -1);
    let n = 0;
    while (isClosed(k)) { n++; k = shiftDay(k, -1); }
    return n;
  }

  // Call after anything that may finish a task.
  function check() {
    if (!S.set) return;
    const d = S.activity.days[today()];
    if (d && !d.closed && points(d) > 0 && tasks().every((t) => t.done)) {
      d.closed = true;
      S.activity.bestStreak = Math.max(S.activity.bestStreak || 0, streak());
      save();
      celebrate();
    }
    checkAchievements();
  }

  function log(kind, ok) {
    const d = day();
    if (kind === "q") { d.q++; if (ok) d.ok++; }
    if (kind === "r") { d.r++; if (ok) d.rok++; }
    if (kind === "w") d.w++;
    if (kind === "q" || kind === "r") {
      S.activity.run = ok ? (S.activity.run || 0) + 1 : 0;
      S.activity.bestRun = Math.max(S.activity.bestRun || 0, S.activity.run);
    }
    save();
    check();
  }

  // ---------------------------------------------------------------- achievements

  function achievements() {
    const qs = S.set.questions;
    const answered = qs.filter((q) => S.progress[q.id]).length;
    const fixed = Object.values(S.review).filter((r) => r.done).length;
    const words = ctx.wordsStudied();
    const best = Math.max(S.activity.bestStreak || 0, streak());
    return [
      { id: "first", icon: "check", title: "Первый шаг", desc: "Решить первый вопрос", cur: answered, goal: 1 },
      { id: "q10", icon: "target", title: "Разогрев", desc: "Решить 10 вопросов", cur: answered, goal: 10 },
      { id: "q50", icon: "target", title: "Полсотни", desc: "Решить 50 вопросов", cur: answered, goal: 50 },
      { id: "all", icon: "trophy", title: "Весь набор", desc: `Решить все ${qs.length} вопросов`, cur: answered, goal: qs.length },
      { id: "run10", icon: "sparkles", title: "Снайпер", desc: "10 верных ответов подряд", cur: S.activity.bestRun || 0, goal: 10 },
      { id: "fix5", icon: "rotate", title: "Работа над ошибками", desc: "Закрепить 5 ошибок повторами", cur: fixed, goal: 5 },
      { id: "w50", icon: "cards", title: "Словарный запас", desc: "Пройти 50 слов в карточках", cur: words, goal: 50 },
      { id: "s3", icon: "flame", title: "Три дня подряд", desc: "Серия из 3 закрытых дней", cur: best, goal: 3 },
      { id: "s7", icon: "flame", title: "Неделя", desc: "Серия из 7 закрытых дней", cur: best, goal: 7 },
      { id: "s30", icon: "flame", title: "Месяц", desc: "Серия из 30 закрытых дней", cur: best, goal: 30 },
    ];
  }

  function checkAchievements() {
    const got = new Set(S.activity.unlocked || []);
    const fresh = achievements().filter((a) => a.cur >= a.goal && a.goal > 0 && !got.has(a.id));
    if (!fresh.length) return;
    for (const a of fresh) got.add(a.id);
    S.activity.unlocked = [...got];
    save();
    if (!document.querySelector(".celebrate")) toast(`Достижение: ${fresh.map((a) => a.title).join(", ")}`);
  }

  // ---------------------------------------------------------------- celebration

  function celebrate() {
    const n = streak();
    const el = document.createElement("div");
    el.className = "celebrate";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "День закрыт");
    el.innerHTML = `<canvas aria-hidden="true"></canvas>
      <div class="celebrate-card">
        <div class="celebrate-flame">${icon("flame")}</div>
        <h2>День закрыт!</h2>
        <p class="celebrate-streak"><b>${n}</b> ${plural(n, "день", "дня", "дней")} подряд</p>
        <p>${n >= (S.activity.bestStreak || 0) && n > 1 ? "Это ваша лучшая серия." : "Завтра приходите снова, чтобы серия продолжилась."}</p>
        <button class="btn btn-primary btn-lg" data-action="celebrate-close">Продолжить</button>
      </div>`;
    document.body.append(el);
    el.querySelector(".btn").focus();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) confetti(el.querySelector("canvas"));
  }

  function confetti(canvas) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = (canvas.width = innerWidth * dpr), h = (canvas.height = innerHeight * dpr);
    const g = canvas.getContext("2d");
    const css = getComputedStyle(document.documentElement);
    const colors = ["--primary", "--ok", "--warn", "--bad"].map((v) => css.getPropertyValue(v).trim() || "#888");
    const parts = Array.from({ length: 140 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3, y: h * 0.42, vx: (Math.random() - 0.5) * 16 * dpr, vy: (-Math.random() * 15 - 5) * dpr,
      s: (4 + Math.random() * 5) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: colors[(Math.random() * colors.length) | 0],
    }));
    const t0 = performance.now();
    const frame = (t) => {
      if (!canvas.isConnected || t - t0 > 2600) return;
      g.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.vy += 0.45 * dpr; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); g.restore();
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- calendar reminder (.ics)

  function reminderIcs(time) {
    const [hh, mm] = (time || "19:00").split(":").map(Number);
    const d = new Date();
    const stamp = (x) => `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, "0")}${String(x.getDate()).padStart(2, "0")}`;
    const t = `${String(hh).padStart(2, "0")}${String(mm).padStart(2, "0")}00`;
    const url = location.href.split("#")[0];
    return [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SAT Trainer//RU", "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:sat-trainer-daily-${Date.now()}@mrbrutt.github.io`,
      `DTSTAMP:${stamp(d)}T000000Z`,
      `DTSTART:${stamp(d)}T${t}`,
      "DURATION:PT25M",
      "RRULE:FREQ=DAILY",
      "SUMMARY:SAT: закрыть день в тренажёре",
      `DESCRIPTION:Повторить ошибки\\, пройти карточки слов и решить новые вопросы. ${url}`,
      `URL:${url}`,
      "BEGIN:VALARM", "TRIGGER:PT0M", "ACTION:DISPLAY", "DESCRIPTION:SAT Trainer", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
  }

  function downloadReminder() {
    const blob = new Blob([reminderIcs(S.activity.remind)], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sat-trainer-reminder.ics";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("Откройте скачанный файл — событие добавится в Календарь");
  }

  // ---------------------------------------------------------------- view

  function heatmapHtml() {
    const weeks = 26;
    const end = new Date(); end.setHours(0, 0, 0, 0);
    const startMonday = new Date(end); startMonday.setDate(end.getDate() - ((end.getDay() + 6) % 7) - (weeks - 1) * 7);
    const cells = [];
    const months = [];
    for (let w = 0; w < weeks; w++) {
      for (let i = 0; i < 7; i++) {
        const dt = new Date(startMonday); dt.setDate(startMonday.getDate() + w * 7 + i);
        const k = dayKey(dt.getTime());
        const future = dt > end;
        const d = S.activity.days[k];
        const p = points(d);
        const lvl = !p ? 0 : p < 5 ? 1 : p < 10 ? 2 : p < 20 ? 3 : 4;
        const label = dt.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
        const tip = future ? "" : d ? `${label}: ${d.q} нов. вопросов, ${d.r} повторов, ${d.w} карточек${d.closed ? " · день закрыт" : ""}` : `${label}: без занятий`;
        cells.push(`<i class="hm l${lvl} ${d?.closed ? "closed" : ""} ${future ? "future" : ""} ${k === today() ? "today" : ""}" style="grid-column:${w + 1};grid-row:${i + 1}" title="${esc(tip)}"></i>`);
        if (i === 0 && dt.getDate() <= 7) months.push(`<span style="grid-column:${w + 1}">${dt.toLocaleDateString("ru-RU", { month: "short" }).replace(".", "")}</span>`);
      }
    }
    return `<div class="hm-wrap"><div class="hm-months" style="grid-template-columns:repeat(${weeks},var(--hm))">${months.join("")}</div>
      <div class="hm-grid" style="grid-template-columns:repeat(${weeks},var(--hm))">${cells.join("")}</div></div>`;
  }

  function renderMain(scrollTop = false) {
    const main = $("#main");
    if (!main) return;
    const ts = tasks();
    const doneCount = ts.filter((t) => t.done).length;
    const closed = isClosed(today());
    const n = streak();
    const hour = new Date().getHours();
    const hello = hour < 5 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
    const left = ts.filter((t) => !t.done).length;
    const ach = achievements();
    const got = new Set(S.activity.unlocked || []);
    const inClaude = !!window.claude;
    const totalPts = Object.values(S.activity.days).filter((d) => points(d) > 0).length;

    main.innerHTML = `<div class="today">
      <section class="card today-hero ${closed ? "is-closed" : ""}">
        <div class="streak-badge ${n ? "on" : ""}" title="Серия закрытых дней">${icon("flame")}<b>${n}</b><span>${plural(n, "день", "дня", "дней")} подряд</span></div>
        <div class="hero-text">
          <h2>${hello}!</h2>
          <p>${closed ? "День закрыт. Можно остановиться — или решить ещё пару вопросов." :
            left === 3 ? "Три задачи — и день закрыт. Начните с повторов: они короткие." :
            `Осталось ${left} ${plural(left, "задача", "задачи", "задач")}, чтобы закрыть день${n ? " и продолжить серию" : ""}.`}</p>
        </div>
        <div class="day-ring" style="--p:${doneCount / 3}" aria-label="Выполнено ${doneCount} из 3"><span><b>${doneCount}</b>/3</span></div>
      </section>

      <section class="task-list">${ts.map((t) => `
        <div class="card task ${t.done ? "done" : ""}">
          <div class="task-icon">${icon(t.done ? "check" : t.icon)}</div>
          <div class="task-body">
            <div class="task-title">${t.title}</div>
            <div class="task-sub">${t.sub}</div>
            ${t.total ? `<div class="bar"><span style="width:${Math.round((t.cur / t.total) * 100)}%"></span></div>` : ""}
          </div>
          <button class="btn ${t.done ? "btn-ghost" : "btn-primary"} btn-sm" data-action="${t.action}">${t.done ? "Ещё" : t.cta} ${icon("right", "icon-sm")}</button>
        </div>`).join("")}
      </section>

      <section class="card today-block">
        <div class="block-head"><h3>Активность</h3><span>Лучшая серия: <b>${Math.max(S.activity.bestStreak || 0, n)}</b> · дней с занятиями: <b>${totalPts}</b></span></div>
        ${heatmapHtml()}
        <div class="hm-legend"><span>меньше</span><i class="hm l0"></i><i class="hm l1"></i><i class="hm l2"></i><i class="hm l3"></i><i class="hm l4"></i><span>больше</span><i class="hm l2 closed"></i><span>день закрыт</span></div>
      </section>

      <section class="card today-block">
        <div class="block-head"><h3>Достижения</h3><span>${got.size} из ${ach.length}</span></div>
        <div class="ach-grid">${ach.map((a) => {
          const on = got.has(a.id) || a.cur >= a.goal;
          return `<div class="ach ${on ? "on" : ""}" title="${esc(a.desc)}">
            <div class="ach-icon">${icon(a.icon)}</div>
            <div class="ach-text"><b>${a.title}</b><span>${on ? a.desc : `${Math.min(a.cur, a.goal)} / ${a.goal} · ${a.desc}`}</span></div>
          </div>`;
        }).join("")}</div>
      </section>

      <section class="card today-block">
        <div class="block-head"><h3>Настройки дня</h3></div>
        <div class="setting">
          <span>Новых вопросов в день</span>
          <div class="chips">${[5, 10, 15, 20, 30].map((k) => `<button class="chip ${S.activity.goalNew === k ? "active" : ""}" data-action="today-goal" data-n="${k}">${k}</button>`).join("")}</div>
        </div>
        <div class="setting">
          <span>Ежедневное напоминание</span>
          ${inClaude
            ? `<span class="muted">Поставьте повторяющееся напоминание в Календаре или Напоминаниях на телефоне — например, на ${esc(S.activity.remind)}.</span>`
            : `<div class="row"><input type="time" id="remind-time" class="time-input" value="${esc(S.activity.remind)}" aria-label="Время напоминания">
               <button class="btn btn-outline btn-sm" data-action="today-remind">${icon("bell", "icon-sm")} Добавить в Календарь</button></div>`}
        </div>
      </section>
    </div>`;
    // on narrow screens show the latest weeks first
    const hm = main.querySelector(".hm-wrap");
    if (hm) hm.scrollLeft = hm.scrollWidth;
    if (scrollTop) window.scrollTo({ top: 0 });
  }

  function renderSidebar() {
    const qs = S.set.questions;
    const answered = qs.filter((q) => S.progress[q.id]).length;
    const right = qs.filter((q) => S.progress[q.id]?.ok).length;
    const reviews = Object.values(S.review);
    const inQueue = reviews.filter((r) => !r.done).length;
    const fixed = reviews.filter((r) => r.done).length;
    const tomorrow = startOfDay() + 2 * DAY;
    const nextReviews = reviews.filter((r) => !r.done && r.due >= Date.now() && r.due < tomorrow).length;
    const week = startOfDay() + 8 * DAY;
    const weekReviews = reviews.filter((r) => !r.done && r.due < week).length;
    const row = (label, value, sub = "") => `<div class="ov-row"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
    $("#sidebar").innerHTML = `
      <div>
        <div class="side-label">Вопросы</div>
        <div class="ov">
          ${row("Решено", `${answered}/${qs.length}`, `${qs.length ? Math.round((answered / qs.length) * 100) : 0}%`)}
          ${row("Верно с первого раза", answered ? `${Math.round((right / answered) * 100)}%` : "—")}
        </div>
      </div>
      <div>
        <div class="side-label">Работа над ошибками</div>
        <div class="ov">
          ${row("В очереди повторов", inQueue)}
          ${row("Закреплено", fixed)}
          ${row("Завтра", nextReviews, "повторов")}
          ${row("На неделе", weekReviews, "повторов")}
        </div>
      </div>
      <div>
        <div class="side-label">Словарь</div>
        <div class="ov">${row("Пройдено слов", ctx.wordsStudied())}${row("На сегодня", ctx.vocabDue(), "карточек")}</div>
      </div>
      <div class="side-foot">
        <span>${icon("flame", "icon-sm")} День закрывается, когда выполнены все три задачи. Серия растёт, если закрывать дни подряд.</span>
      </div>`;
  }

  const actions = {
    "today-goal": (el) => { S.activity.goalNew = +el.dataset.n; save(); check(); renderMain(); ctx.refreshChrome(); },
    "today-remind": () => { const t = $("#remind-time")?.value; if (t) { S.activity.remind = t; save(); } downloadReminder(); },
    "celebrate-close": () => { document.querySelector(".celebrate")?.remove(); checkAchievements(); ctx.refreshChrome(); },
  };

  function merge(incoming) {
    if (!incoming?.days) return;
    for (const [k, d] of Object.entries(incoming.days)) {
      const mine = S.activity.days[k];
      S.activity.days[k] = mine
        ? { q: Math.max(mine.q, d.q || 0), ok: Math.max(mine.ok, d.ok || 0), r: Math.max(mine.r, d.r || 0), rok: Math.max(mine.rok, d.rok || 0), w: Math.max(mine.w, d.w || 0), closed: mine.closed || d.closed }
        : d;
    }
    S.activity.bestRun = Math.max(S.activity.bestRun || 0, incoming.bestRun || 0);
    S.activity.bestStreak = Math.max(S.activity.bestStreak || 0, incoming.bestStreak || 0);
    S.activity.unlocked = [...new Set([...(S.activity.unlocked || []), ...(incoming.unlocked || [])])];
    save();
  }

  return {
    log, check, tasks, streak, isClosed, renderMain, renderSidebar, actions, merge,
    remaining: () => (S.set ? tasks().filter((t) => !t.done).length : 0),
  };
}

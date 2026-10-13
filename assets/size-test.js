// Vocabulary size test: "do you know this word?" for words from frequency bands, with made-up words
// mixed in to catch guessing (the checklist method of Meara's X-Lex and LexTALE). Result: how many of
// the ~25,000 most frequent English base words the student knows, the share of an ordinary text that
// is familiar, and the frequency below which the trainer should treat words as hard.
// Data: assets/data/vocab-test.json (bands by wordfreq frequency rank, scripts in the README).
import { dataUrl } from "./words.js";

const PSEUDO = 24;
const FRONTIER = 0.85;          // a band known less than this is where hard words begin

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const fmt = (n, d = 0) => n.toLocaleString("ru-RU", { maximumFractionDigits: d, minimumFractionDigits: d });
const bandLabel = (b) => (b.from ? `${fmt(b.from / 1000, b.from % 1000 ? 1 : 0)}–${fmt(b.to / 1000, b.to % 1000 ? 1 : 0)} тыс.` : "до 1 тыс.");

// Known share should only fall as words get rarer; a few answers per band are noisy, so neighbouring
// bands that break the order are pooled (weighted by how many words each had).
function decreasing(ps, ws) {
  const blocks = ps.map((p, i) => ({ p, w: ws[i], k: 1 }));
  for (let i = 0; i < blocks.length - 1;) {
    if (blocks[i].p < blocks[i + 1].p) {
      const a = blocks[i], b = blocks[i + 1], w = a.w + b.w;
      blocks.splice(i, 2, { p: (a.p * a.w + b.p * b.w) / w, w, k: a.k + b.k });
      if (i > 0) i--;
    } else i++;
  }
  return blocks.flatMap((b) => Array(b.k).fill(b.p));
}

export function score(data, answers) {
  const fake = answers.filter((a) => a.band === null);
  const f = fake.length ? fake.filter((a) => a.yes).length / fake.length : 0;
  const raw = data.bands.map((b, i) => {
    const mine = answers.filter((a) => a.band === i);
    const h = mine.length ? mine.filter((a) => a.yes).length / mine.length : 0;
    return { asked: mine.length, yes: mine.filter((a) => a.yes).length, p: f >= 1 ? 0 : Math.max(0, Math.min(1, (h - f) / (1 - f))) };
  });
  const p = decreasing(raw.map((r) => r.p), raw.map((r) => r.asked || 1));
  const size = data.bands.reduce((s, b, i) => s + (b.to - b.from) * b.clean * p[i], 0);
  const max = data.bands.reduce((s, b) => s + (b.to - b.from) * b.clean, 0);
  // names and the like are "known" too when reading; past the last band assume half of its share
  const last = p[p.length - 1];
  const cover = data.bands.reduce((s, b, i) => s + b.share * (b.clean * p[i] + 1 - b.clean), 0) + data.tail * (0.4 + 0.3 * last);
  const edge = p.findIndex((x) => x < FRONTIER);
  const bandAt = edge < 0 ? data.bands[data.bands.length - 1] : data.bands[edge];
  const zipf = Math.min(4.6, Math.max(3.2, edge < 0 ? bandAt.zipf[1] : bandAt.zipf[0]));
  return { at: Date.now(), size: Math.round(size / 100) * 100, max: Math.round(max / 100) * 100, cover, f, fakes: fake.length, fakeYes: fake.filter((a) => a.yes).length,
    zipf, rank: edge < 0 ? bandAt.to : bandAt.from, bands: p.map((x) => Math.round(x * 100)), raw };
}

export function createSizeTest(ctx) {
  const { S, esc, icon, toast } = ctx;
  let data = null;
  let loading = null;
  let run = null;          // {items: [{w, band}], i, answers: [{w, band, yes}]}
  let result = null;       // shown after a run; S.vocab.test keeps the last one

  const load = () => (loading ||= fetch(dataUrl("vocab-test.json")).then((r) => r.json()).then((d) => { data = d; ctx.render(); }).catch(() => { loading = null; }));

  function start() {
    if (!data) return;
    const items = [];
    data.bands.forEach((b, i) => shuffle(b.words).slice(0, b.n).forEach((w) => items.push({ w, band: i })));
    shuffle(data.pseudo).slice(0, PSEUDO).forEach((w) => items.push({ w, band: null }));
    run = { items: shuffle(items), i: 0, answers: [] };
    result = null;
    ctx.render();
  }

  function answer(yes) {
    if (!run) return;
    const it = run.items[run.i];
    run.answers.push({ ...it, yes });
    run.i++;
    if (run.i < run.items.length) { ctx.render(); return; }
    finish();
  }

  function undo() {
    if (!run || !run.i) return;
    run.i--;
    run.answers.pop();
    ctx.render();
  }

  function finish() {
    result = score(data, run.answers);
    run = null;
    const reliable = result.f <= 0.25;
    result.reliable = reliable;
    result.before = S.vocab.level;
    // a run with many made-up words marked as known is not kept: the last good result stays in use
    if (reliable) { S.vocab.test = result; ctx.applyLevel(); ctx.save(); }
    ctx.render(true);
    if (reliable) toast("Уровень в тренажёре подстроен по тесту");
  }

  // ---------------------------------------------------------------- screens

  const LEVEL_RU = { basic: "Начальный", middle: "Средний", advanced: "Продвинутый", test: "По тесту" };

  function introHtml() {
    const last = S.vocab.test;
    return `<div class="vwrap"><section class="card vt">
      <div class="prep-head">
        <div class="prep-icon">${icon("target")}</div>
        <div>
          <h2>Тест словарного запаса</h2>
          <p>${data ? `${data.bands.reduce((s, b) => s + b.n, 0) + PSEUDO} слов` : "Около 100 слов"}, примерно 5 минут. На каждое ответьте, знаете ли вы его значение — можете объяснить хотя бы примерно. «Где-то видел» не считается.</p>
          <p>Часть слов выдумана. Если отметить их как знакомые, результат снизится — так тест отличает знание от угадывания.</p>
          <p class="muted">По результату тренажёр решит, какие слова для вас трудные: их он подчёркивает в текстах и проверяет перед вопросом.</p>
        </div>
      </div>
      ${last ? `<p class="vt-last">Прошлый результат: ≈ ${fmt(last.size)} слов · ${new Date(last.at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</p>` : ""}
      <div class="prep-actions">
        <button class="btn btn-primary btn-lg" data-action="vt-start" ${data ? "" : "disabled"}>${data ? `Начать <kbd>Enter</kbd>` : "Загружаю…"}</button>
        <button class="btn btn-ghost btn-sm" data-action="v-tab" data-tab="study">К карточкам</button>
      </div>
    </section></div>`;
  }

  function itemHtml() {
    const it = run.items[run.i];
    const total = run.items.length;
    return `<div class="vwrap">
      <div class="sess-top">
        <span class="sess-count">Слово <b>${run.i + 1}</b> из ${total}</span>
        <div class="bar"><span style="width:${Math.round((run.i / total) * 100)}%"></span></div>
        <button class="btn btn-ghost btn-sm" data-action="vt-quit">Прервать</button>
      </div>
      <section class="card vt-item">
        <div class="vt-word">${esc(it.w)}</div>
        <p class="muted">Знаете, что значит это слово?</p>
        <div class="vt-buttons">
          <button class="vt-btn no" data-action="vt-no"><kbd>←</kbd> Не знаю</button>
          <button class="vt-btn yes" data-action="vt-yes">Знаю <kbd>→</kbd></button>
        </div>
        ${run.i ? `<button class="linkish vt-undo" data-action="vt-undo">${icon("rotate", "icon-sm")} Исправить предыдущий ответ <kbd>Backspace</kbd></button>` : ""}
      </section>
    </div>`;
  }

  function resultHtml() {
    const r = result;
    const level = r.reliable
      ? `<p>Уровень в тренажёре теперь «По тесту»: трудными считаются слова реже примерно ${fmt(r.rank)}-го по частоте — их тренажёр подчёркивает и проверяет перед вопросом.${r.before && r.before !== "test" ? ` Было: «${LEVEL_RU[r.before] || r.before}», вернуть можно в «Мой уровень английского».` : ""}</p>`
      : `<p class="vt-warn">${icon("x", "icon-sm")} Знакомыми отмечено много выдуманных слов (${r.fakeYes} из ${r.fakes}), поэтому результат неточный, и уровень я не менял. Пройдите тест ещё раз и отмечайте только слова, которые можете объяснить.</p>`;
    return `<div class="vwrap"><section class="card vt-result">
      <div class="vt-big">≈ ${fmt(r.size)} <span>слов</span></div>
      <p class="muted">из ~${fmt(r.max)} самых частых слов английского. Слово считается без форм (analyze и analyzed — одно), имена и названия не в счёт. Точность — примерно ±15%.</p>
      <div class="vt-stats">
        <div><b>${fmt(r.cover * 100, 1)}%</b><span>слов обычного текста вам знакомы</span></div>
        <div><b>${r.fakeYes} из ${r.fakes}</b><span>выдуманных слов отмечено как знакомые</span></div>
      </div>
      <div class="vt-bands" aria-label="Сколько слов вы знаете в каждой полосе частоты">${data.bands.map((b, i) => `
        <div class="vt-band"><span class="vt-label">${bandLabel(b)}</span><span class="vt-bar"><span style="width:${r.bands[i]}%"></span></span><span class="vt-pct">${r.bands[i]}%</span></div>`).join("")}
      </div>
      <p class="muted">Полосы — слова по частоте: «1–2 тыс.» — с тысячного по двухтысячное самое частое. Когда знакомо 98% слов текста, он читается свободно; на 95% понимание заметно падает. Тексты SAT плотнее обычных, так что там доля незнакомых выше.</p>
      ${level}
      <div class="prep-actions">
        <button class="btn btn-primary" data-action="v-tab" data-tab="study">К карточкам</button>
        <button class="btn btn-ghost btn-sm" data-action="vt-start">Пройти ещё раз</button>
      </div>
    </section></div>`;
  }

  function html() {
    load();
    if (run) return itemHtml();
    if (result && data) return resultHtml();
    return introHtml();
  }

  const actions = {
    "vt-start": start,
    "vt-yes": () => answer(true),
    "vt-no": () => answer(false),
    "vt-undo": undo,
    "vt-quit": () => { run = null; ctx.render(); },
  };

  function onKey(e) {
    const k = e.key;
    if (!run) {
      if (k === "Enter" && data) { start(); return true; }
      return false;
    }
    if (k === "ArrowRight" || k.toLowerCase() === "j") { answer(true); return true; }
    if (k === "ArrowLeft" || k.toLowerCase() === "f") { answer(false); return true; }
    if (k === "Backspace") { undo(); return true; }
    return false;
  }

  // Opening the test again shows its start screen, not an old result.
  const open = () => { if (!run) result = null; };

  return { html, actions, onKey, open };
}

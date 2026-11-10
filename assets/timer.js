// Time spent on a question. It counts only while the question is on screen and not answered yet,
// the tab is visible, the window has focus and the student did something in the last few minutes.
// Time already spent is stored, so reloading the page does not reset it.
import { plain } from "./parser.js";

const IDLE_MS = 3 * 60 * 1000;

export const fmtTime = (ms) => {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// Time norm for one question. Digital SAT: Reading and Writing 32 min for 27 questions, Math 35 min for
// 22. A short Words in Context question and two long passages should not get the same time, so a
// Reading and Writing norm grows with the words to read; the norms of a typical module add up to 32 min.
const BASE = 25, PER_WORD = 0.33, FIGURE = 15, RUSH = 0.6;
const wordCount = (q) => [...(q.stem || []), q.prompt, ...(q.choices || [])]
  .reduce((n, p) => n + (p ? plain(p).split(/\s+/).filter(Boolean).length : 0), 0);

export function paceFor(q) {
  if (/math/i.test(q?.section || "")) return 95000;
  if (!q) return 71000;
  const s = BASE + PER_WORD * wordCount(q) + (q.hasFigure ? FIGURE : 0);
  return Math.round(s / 5) * 5000;
}

// A mistake made much faster than the question's norm: more likely haste than not knowing.
export const rushed = (q, p) => !!p && !p.ok && !p.revealed && p.ms > 0 && p.ms < paceFor(q) * RUSH;

export function rushStats(questions, progress) {
  const wrong = questions.filter((q) => progress[q.id] && !progress[q.id].ok && !progress[q.id].revealed && progress[q.id].ms > 0);
  return { rushed: wrong.filter((q) => rushed(q, progress[q.id])).length, wrong: wrong.length };
}

export function createTimer({ ls, KEY, onTick }) {
  const stored = ls.get(KEY.timing, {});
  let key = null, acc = 0, t0 = 0, running = false;
  let lastInput = Date.now(), savedAt = 0;

  const persist = (force = false) => {
    if (force || Date.now() - savedAt > 4000) { ls.set(KEY.timing, stored); savedAt = Date.now(); }
  };
  const idle = () => Date.now() - lastInput > IDLE_MS;
  const elapsed = () => Math.round(acc + (running ? performance.now() - t0 : 0));

  function stop() {
    if (running) { acc += performance.now() - t0; running = false; }
    if (key) { stored[key] = Math.round(acc); persist(true); }
  }

  // `want` is the attempt that should be timed right now, or null.
  function sync(want) {
    if (want !== key) { stop(); key = want; acc = key ? stored[key] || 0 : 0; }
    const active = !!key && document.visibilityState === "visible" && document.hasFocus() && !idle();
    if (active && !running) { running = true; t0 = performance.now(); }
    else if (!active && running) stop();
  }

  // The attempt is over: hand back its time and forget it.
  function take(k) {
    let ms;
    if (k === key) { ms = elapsed(); running = false; acc = 0; key = null; }
    else ms = stored[k] || 0;
    delete stored[k];
    persist(true);
    return ms;
  }

  function reset(k) {
    if (k === key) { acc = 0; if (running) t0 = performance.now(); }
    delete stored[k];
    persist(true);
  }

  const state = () => ({ key, running, idle: idle(), ms: elapsed() });

  for (const ev of ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"]) {
    addEventListener(ev, () => {
      const wasIdle = idle();
      lastInput = Date.now();
      if (wasIdle) onTick();
    }, { passive: true, capture: true });
  }
  document.addEventListener("visibilitychange", onTick);
  addEventListener("blur", onTick);
  addEventListener("focus", onTick);
  addEventListener("pagehide", stop);
  setInterval(() => {
    onTick();
    if (running && key) { stored[key] = elapsed(); persist(); }
  }, 1000);

  return { sync, take, reset, state };
}

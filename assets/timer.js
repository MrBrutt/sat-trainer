// Time spent on a question. It counts only while the question is on screen and not answered yet,
// the tab is visible, the window has focus and the student did something in the last few minutes.
// Time already spent is stored, so reloading the page does not reset it.
const IDLE_MS = 3 * 60 * 1000;

export const fmtTime = (ms) => {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// Digital SAT pace: Reading and Writing 32 min / 27 questions, Math 35 min / 22 questions.
export const paceFor = (q) => (/math/i.test(q?.section || "") ? 95000 : 71000);

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

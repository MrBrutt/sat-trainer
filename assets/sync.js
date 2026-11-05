// Keeps each section of the student's data (answers, cards, …) the same on this device and in the
// account. The device copy stays the working copy; on start, on every change from the account and
// shortly after a change here, the two are merged three ways against the copy both last agreed on
// (`base`), and whichever side differs from the result gets it.
//
// adapter: { get(name), set(name, value) — resolves once the server has it, watch(name, cb) → unsubscribe, online() }
// sections: { [name]: { read(), apply(value), merge(base, local, remote) } }
// base: { get(name), set(name, value) } — kept by the caller between visits
import { same } from "./merge.js";

// The trainer changes its data in place (S.progress[id] = …, a day's counts ++). The engine works
// on its own copies, so the account's copy it remembers never changes behind its back.
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function createSync({ adapter, sections, base, onStatus = () => {}, delay = 1500 }) {
  const remote = {};          // the account's value as last seen, per section
  const heard = {};           // how many values the account has sent, per section
  const queue = {};           // one reconcile at a time per section
  const timers = {};
  const unsubs = [];
  let pending = 0;
  let failed = false;
  let stopped = false;

  const report = () => onStatus(!adapter.online() ? "offline" : pending ? "saving" : failed ? "error" : "saved");

  async function reconcile(name) {
    if (stopped) return;
    const s = sections[name];
    const local = copy(s.read());
    const merged = s.merge(copy(base.get(name)), local, copy(remote[name]));
    if (!same(merged, local)) s.apply(copy(merged));
    if (same(merged, remote[name])) { base.set(name, copy(merged)); return; }
    pending++;
    report();
    const before = heard[name] || 0;
    try {
      await adapter.set(name, copy(merged));
      // the base moves only once the account has the value: a write lost offline is sent again next time
      base.set(name, copy(merged));
      // a newer value the account sent meanwhile stays; its own reconcile is already queued
      if ((heard[name] || 0) === before) remote[name] = copy(merged);
      failed = false;
    } catch (e) {
      console.warn("sync", name, e);
      failed = true;
    } finally {
      pending--;
      report();
    }
  }

  const run = (name) => (queue[name] = (queue[name] || Promise.resolve()).then(() => reconcile(name)));

  async function start() {
    stopped = false;
    for (const name of Object.keys(sections)) {
      remote[name] = copy(await adapter.get(name));
      await run(name);
      unsubs.push(adapter.watch(name, (value) => {
        if (same(value, remote[name])) return;
        remote[name] = copy(value);
        heard[name] = (heard[name] || 0) + 1;
        run(name);
      }));
    }
    report();
  }

  // This device changed a section: merge and send it after a short pause, so a burst of changes is one write.
  function notify(name) {
    if (stopped || !sections[name]) return;
    clearTimeout(timers[name]);
    timers[name] = setTimeout(() => { delete timers[name]; run(name); }, delay);
  }

  // Send waiting changes now, e.g. when the page is being hidden.
  function flush() {
    for (const name of Object.keys(timers)) { clearTimeout(timers[name]); delete timers[name]; run(name); }
  }

  function stop() {
    stopped = true;
    for (const t of Object.values(timers)) clearTimeout(t);
    unsubs.splice(0).forEach((u) => u());
  }

  return { start, notify, flush, stop, status: report };
}

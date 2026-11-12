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

export function createSync({ adapter, sections, base, onStatus = () => {}, onError = () => {}, delay = 1500 }) {
  const remote = {};          // the account's value as last seen, per section
  const heard = {};           // how many values the account has sent, per section
  const loaded = new Set();   // sections whose account copy has arrived: nothing is merged before that
  const queue = {};           // one reconcile at a time per section
  const timers = {};
  const unsubs = [];
  let pending = 0;
  const broken = new Set();   // sections whose last write failed: one that works does not hide another that does not
  let stopped = false;

  const report = () => onStatus(!adapter.online() ? "offline" : pending ? "saving" : broken.size ? "error" : "saved");

  async function reconcile(name) {
    if (stopped || !loaded.has(name)) return;
    const s = sections[name];
    const local = copy(s.read());
    // Nothing in the account is not a request to delete: it means "no change since we last agreed"
    // (a first sign-in has no agreed copy either), so what is here stays and goes up.
    const known = remote[name] === undefined ? base.get(name) : remote[name];
    const merged = s.merge(copy(base.get(name)), local, copy(known));
    if (!same(merged, local)) s.apply(copy(merged));
    if (same(merged, remote[name])) {
      base.set(name, copy(merged));
      if (broken.delete(name)) report();   // the account already has it: nothing left to send
      return;
    }
    pending++;
    report();
    const before = heard[name] || 0;
    try {
      await adapter.set(name, copy(merged));
      // the base moves only once the account has the value: a write lost offline is sent again next time
      base.set(name, copy(merged));
      // a newer value the account sent meanwhile stays; its own reconcile is already queued
      if ((heard[name] || 0) === before) remote[name] = copy(merged);
      broken.delete(name);
    } catch (e) {
      console.warn("sync", name, e);
      broken.add(name);
      onError(name, e);
    } finally {
      pending--;
      report();
    }
  }

  const run = (name) => (queue[name] = (queue[name] || Promise.resolve()).then(() => reconcile(name)));

  async function start() {
    stopped = false;
    loaded.clear();
    for (const name of Object.keys(sections)) {
      remote[name] = copy(await adapter.get(name));
      loaded.add(name);
      await run(name);
      unsubs.push(adapter.watch(name, (value) => {
        if (value === undefined || same(value, remote[name])) return;
        remote[name] = copy(value);
        heard[name] = (heard[name] || 0) + 1;
        run(name);
      }));
    }
    report();
  }

  // This device changed a section: merge and send it after a short pause, so a burst of changes is one write.
  function notify(name) {
    if (stopped || !sections[name] || !loaded.has(name)) return;   // start() merges it anyway once it is in
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

  // After a failed write: send every section again (a merge that changes nothing writes nothing).
  function retry() { for (const name of loaded) run(name); }

  return { start, notify, flush, stop, retry, status: report };
}

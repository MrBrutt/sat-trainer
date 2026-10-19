// Keeps each section of the student's data (answers, cards, …) the same on this device and in the
// account. The device copy stays the working copy; on start, on every change from the account and
// shortly after a change here, the two are merged three ways against the copy both last agreed on
// (`base`), and whichever side differs from the result gets it.
//
// adapter: { get(name), set(name, value) — resolves once the server has it, watch(name, cb) → unsubscribe, online() }
// sections: { [name]: { read(), apply(value), merge(base, local, remote) } }
// base: { get(name), set(name, value) } — kept by the caller between visits
import { same } from "./merge.js";

export function createSync({ adapter, sections, base, onStatus = () => {}, delay = 1500 }) {
  const remote = {};          // the account's value as last seen, per section
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
    const local = s.read();
    const merged = s.merge(base.get(name), local, remote[name]);
    if (!same(merged, local)) s.apply(merged);
    if (same(merged, remote[name])) { base.set(name, merged); return; }
    pending++;
    report();
    try {
      await adapter.set(name, merged);
      // the base moves only once the account has the value: a write lost offline is sent again next time
      remote[name] = merged;
      base.set(name, merged);
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
      remote[name] = await adapter.get(name);
      await run(name);
      unsubs.push(adapter.watch(name, (value) => {
        if (same(value, remote[name])) return;
        remote[name] = value;
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

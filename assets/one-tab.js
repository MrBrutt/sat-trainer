// One working window of the trainer per browser. Every window keeps the student's data in memory and
// writes it whole to the same storage, and the account sync of every window merges against the same
// record of what was last agreed. Two windows at once (say, two tabs, or windows on two desktops)
// overwrite each other's answers, and one window's older copy reads as the other's deletions.
//
// So the window opened last owns the trainer: it writes its id to the shared storage. Every window
// checks that id before it writes anything (and when it is shown again), so a window that slept in
// the background through the takeover learns of it before it can do harm; no message has to reach it.
// A window that is not the owner steps aside until the student takes it back (claim, after a reload).
export function createOneTab({ storage = globalThis.localStorage, key = "sat-trainer:window", onTakenOver = () => {} } = {}) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let passive = false;
  const owner = () => { try { return storage.getItem(key); } catch { return null; } };

  function stepAside() {
    if (passive) return;
    passive = true;
    onTakenOver();
  }
  // true while this window may write; without storage there is nothing to share, so it may
  function check() {
    const o = owner();
    if (o === null || o === id) return !passive;
    stepAside();
    return false;
  }
  function claim() {
    try { storage.setItem(key, id); } catch { /* no storage: nothing to share */ }
    passive = false;
  }
  // another window wrote the owner: step aside at once, not only at the next write
  function onStorage(e) {
    if (e?.key === key && e.newValue && e.newValue !== id) stepAside();
  }

  claim();
  return { key, check, claim, onStorage, passive: () => passive };
}

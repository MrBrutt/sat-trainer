// One working window of the trainer per browser. Every window keeps the student's data in memory and
// writes it whole to the same storage, and the account sync of every window merges against the same
// record of what was last agreed. Two windows at once (say, on two desktops) overwrite each other's
// answers, and one window's older copy reads as the other's deletions. So the newest window works and
// the others step aside: they stop saving and syncing until the student takes them back (a reload,
// which reads the data fresh and makes them the newest).
export function createOneTab({ name = "sat-trainer", onTakenOver = () => {}, open = (n) => (typeof BroadcastChannel === "function" ? new BroadcastChannel(n) : null) } = {}) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let passive = false;
  const channel = open(name);
  channel?.addEventListener("message", (e) => {
    if (e.data?.type !== "here" || e.data.id === id || passive) return;
    passive = true;
    onTakenOver();
  });
  function claim() {
    passive = false;
    channel?.postMessage({ type: "here", id });
  }
  claim();
  return { passive: () => passive, claim, close: () => channel?.close() };
}

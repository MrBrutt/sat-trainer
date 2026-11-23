// A chime for a right answer to a question (2026-11-23): two short notes going up, made in the
// browser with Web Audio — no sound file, nothing under copyright. Questions only: no sound on cards
// or in a mock test, which gives no feedback, as the exam does not.
export const CHIME = [{ f: 880, at: 0 }, { f: 1318.51, at: 0.09 }];   // A5, then E6

// Plays the chime on an AudioContext; false where there is none.
export function playChime(ac) {
  if (!ac) return false;
  try {
    if (ac.state === "suspended") ac.resume?.();
    const t0 = ac.currentTime;
    for (const n of CHIME) {
      const osc = ac.createOscillator(), gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = n.f;
      gain.gain.setValueAtTime(0.0001, t0 + n.at);
      gain.gain.exponentialRampToValueAtTime(0.16, t0 + n.at + 0.012);   // a soft start, no click
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + 0.3);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + 0.32);
    }
    return true;
  } catch {
    return false;
  }
}

// The page's one AudioContext, made on the first right answer (a click or a key: browsers allow
// sound only after one). On an iPhone the "ambient" session follows the silent switch and leaves
// music playing.
let shared = null;
export function chime() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = "ambient";
    const Ctor = window.AudioContext || window.webkitAudioContext;
    shared ||= Ctor ? new Ctor() : null;
  } catch {
    shared = null;
  }
  return playChime(shared);
}

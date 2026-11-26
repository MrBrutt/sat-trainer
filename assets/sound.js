// A sound for a right answer to a question, made in the browser with Web Audio: no sound file,
// nothing under copyright. Questions only — no sound on cards or in a mock test, which gives no
// feedback, as the exam does not.
//
// 2026-11-26: the first chime felt late and thin. Now the audio is woken on the first touch of the
// page (Safari is slow to start it on the answer itself), the first note sounds at once with a sharp
// attack, and there are three sounds to choose from in the menu: each plays when picked.

// A voice: frequency, wave, start and length in seconds, peak level.
const v = (f, type, at, dur, gain) => ({ f, type, at, dur, gain });
export const SOUNDS = {
  // two quick square notes going up, softened: a game's coin
  coin: { label: "Монетка", lowpass: 5200, voices: [v(987.77, "square", 0, 0.09, 0.11), v(1318.51, "square", 0.06, 0.4, 0.11)] },
  // one bright strike with its overtones: a small bell
  bell: { label: "Звон", voices: [v(784, "triangle", 0, 0.3, 0.12), v(1567.98, "sine", 0, 0.75, 0.3), v(3151.6, "sine", 0, 0.4, 0.09), v(4703.9, "sine", 0, 0.22, 0.04)] },
  // a fast major chord going up
  chord: { label: "Аккорд", voices: [v(1046.5, "triangle", 0, 0.35, 0.18), v(1318.51, "triangle", 0.04, 0.35, 0.18), v(1567.98, "triangle", 0.08, 0.35, 0.18), v(2093, "triangle", 0.12, 0.45, 0.16)] },
};

const ORDER = ["coin", "bell", "chord", "off"];
// The setting as kept in S.ui.sound: off, a sound's name, or nothing yet (the coin).
export const soundOf = (setting) => (setting === false || setting === "off" ? "off" : SOUNDS[setting] ? setting : "coin");
export const nextSound = (name) => ORDER[(ORDER.indexOf(soundOf(name)) + 1) % ORDER.length];
export const soundLabel = (name) => SOUNDS[name]?.label || "выкл";

function schedule(ac, sound) {
  const t0 = ac.currentTime;
  let out = ac.destination;
  if (sound.lowpass && ac.createBiquadFilter) {
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = sound.lowpass;
    lp.connect(ac.destination);
    out = lp;
  }
  for (const n of sound.voices) {
    const osc = ac.createOscillator(), gain = ac.createGain();
    const start = t0 + n.at;
    osc.type = n.type;
    osc.frequency.value = n.f;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(n.gain, start + 0.003);          // sharp, but no click
    gain.gain.exponentialRampToValueAtTime(0.0001, start + n.dur);
    osc.connect(gain).connect(out);
    osc.start(start);
    osc.stop(start + n.dur + 0.02);
  }
}

// Plays a sound on an AudioContext; false where there is none. A context the browser put to sleep
// is woken first: a sound scheduled on a sleeping clock would come late.
export function playChime(ac, name = "coin") {
  const sound = SOUNDS[name];
  if (!ac || !sound) return false;
  try {
    if (ac.state !== "running" && ac.resume) ac.resume().then(() => schedule(ac, sound)).catch(() => {});
    else schedule(ac, sound);
    return true;
  } catch {
    return false;
  }
}

// The page's one AudioContext. On an iPhone the "ambient" session follows the silent switch and
// leaves music playing.
let shared = null;
function context() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = "ambient";
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!shared && Ctor) {
      try { shared = new Ctor({ latencyHint: "interactive" }); } catch { shared = new Ctor(); }   // old Safari takes no options
    }
  } catch {
    shared = null;
  }
  return shared;
}

// Made and woken on the first touch or key of the page, so the answer's sound starts on time.
export function warmAudio() {
  const ac = context();
  if (ac && ac.state !== "running") ac.resume?.().catch(() => {});
}

export const chime = (name) => playChime(context(), name);

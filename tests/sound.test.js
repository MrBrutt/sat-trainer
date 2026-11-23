import { test, eq } from "./run.js";
import { playChime, CHIME } from "../assets/sound.js";

// A stand-in for the browser's AudioContext: it records what would sound.
function fakeAudio() {
  const notes = [];
  const param = () => ({ value: 0, steps: [], setValueAtTime(v, t) { this.steps.push(["set", v, t]); }, exponentialRampToValueAtTime(v, t) { this.steps.push(["ramp", v, t]); } });
  const node = () => ({ connect(n) { return n; } });
  return {
    notes, currentTime: 10, state: "running", destination: node(),
    createOscillator() {
      const o = { ...node(), type: "", frequency: param(), start(t) { o.from = t; }, stop(t) { o.to = t; } };
      notes.push(o);
      return o;
    },
    createGain() { return { ...node(), gain: param() }; },
  };
}

test("a right answer chimes: two short notes going up", () => {
  const ac = fakeAudio();
  eq(playChime(ac), true);
  eq(ac.notes.map((o) => Math.round(o.frequency.value)), CHIME.map((n) => Math.round(n.f)));
  eq(CHIME[1].f > CHIME[0].f, true);
  eq(ac.notes.every((o) => o.from >= 10 && o.to - 10 < 0.5), true, "short: under half a second");
});

test("no sound where the browser has none", () => {
  eq(playChime(null), false);
});

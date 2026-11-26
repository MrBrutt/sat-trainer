import { test, eq } from "./run.js";
import { playChime, SOUNDS, nextSound, soundOf } from "../assets/sound.js";

// A stand-in for the browser's AudioContext: it records what would sound.
function fakeAudio(state = "running") {
  const notes = [];
  const param = () => ({ value: 0, steps: [], setValueAtTime(v, t) { this.steps.push(["set", v, t]); }, linearRampToValueAtTime(v, t) { this.steps.push(["lin", v, t]); }, exponentialRampToValueAtTime(v, t) { this.steps.push(["exp", v, t]); } });
  const node = () => ({ connect(n) { return n; } });
  const ac = {
    notes, currentTime: 10, state, destination: node(),
    resume() { ac.state = "running"; return Promise.resolve(); },
    createOscillator() {
      const o = { ...node(), type: "", frequency: param(), start(t) { o.from = t ?? ac.currentTime; }, stop(t) { o.to = t; } };
      notes.push(o);
      return o;
    },
    createGain() { return { ...node(), gain: param() }; },
    createBiquadFilter() { return { ...node(), type: "", frequency: param(), Q: param() }; },
  };
  return ac;
}

test("every sound starts at once, with a sharp attack, and is over within a second", () => {
  for (const name of Object.keys(SOUNDS)) {
    const ac = fakeAudio();
    eq(playChime(ac, name), true, name);
    eq(Math.min(...ac.notes.map((o) => o.from)), 10, `${name}: the first note at once`);
    eq(ac.notes.every((o) => o.to - 10 <= 1), true, `${name}: short`);
  }
});

test("a sleeping audio context is woken first, then the sound plays", async () => {
  const ac = fakeAudio("suspended");
  playChime(ac, "coin");
  await Promise.resolve(); await Promise.resolve();
  eq([ac.state, ac.notes.length > 0], ["running", true]);
});

test("no sound where the browser has none", () => {
  eq(playChime(null, "coin"), false);
});

test("the menu goes through the sounds and off, starting from the coin", () => {
  eq(soundOf(undefined), "coin");
  eq(soundOf(true), "coin");
  eq(soundOf(false), "off");
  eq(["coin", "bell", "chord", "off"].map(nextSound), ["bell", "chord", "off", "coin"]);
});

import { test, eq } from "./run.js";
import { toB64, fromB64 } from "../assets/bytes.js";

test("a PDF-sized byte array survives base64 and back, quickly", () => {
  const bytes = new Uint8Array(8_000_000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7919 + (i >> 8)) & 255;
  const t0 = performance.now();
  const back = fromB64(toB64(bytes));
  const ms = performance.now() - t0;
  eq(back.length, bytes.length, "length");
  let diff = -1;
  for (let i = 0; i < bytes.length; i++) if (back[i] !== bytes[i]) { diff = i; break; }
  eq(diff, -1, "first differing byte");
  if (ms > 1500) throw new Error(`took ${Math.round(ms)} ms`);
});

test("base64 of a few bytes matches the standard encoding", () => {
  eq(toB64(new Uint8Array([37, 80, 68, 70])), "JVBERg==");
  eq([...fromB64("JVBERg==")], [37, 80, 68, 70]);
});

// PDF bytes as text for the progress file (JSON has no binary type).
const STEP = 0x8000;    // String.fromCharCode takes a limited number of arguments

export function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += STEP) s += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
  return btoa(s);
}

export function fromB64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

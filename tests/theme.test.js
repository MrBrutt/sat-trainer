import { test, eq } from "./run.js";
import { applyThemeColor } from "../assets/theme.js";

// Safari paints its tab bar (and, in full screen, the strip by the camera) in the page's theme-color.
const page = () => {
  const doc = document.implementation.createHTMLDocument("");
  doc.head.innerHTML = '<meta name="theme-color" content="#f6f6f4" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0d0d0f" media="(prefers-color-scheme: dark)">';
  return doc;
};
const colors = (doc) => [...doc.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content);

test("the browser's bar takes the theme chosen in the trainer, not the system's", () => {
  const doc = page();
  applyThemeColor("light", doc);
  eq(colors(doc), ["#f6f6f4", "#f6f6f4"]);
  applyThemeColor("dark", doc);
  eq(colors(doc), ["#0d0d0f", "#0d0d0f"]);
});

test("with no theme chosen the bar follows the system", () => {
  const doc = page();
  applyThemeColor(undefined, doc);
  eq(colors(doc), ["#f6f6f4", "#0d0d0f"]);
});

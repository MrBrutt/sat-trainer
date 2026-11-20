// The browser's own bar: Safari paints its tab bar, and in full screen the strip by the camera, in the
// page's theme-color. The page states one colour per system theme (index.html); once the student picks
// a theme in the trainer, both say that theme's colour, so a light page never sits under a dark bar
// (2026-11-20: a Mac in dark mode, the trainer in light).
export const THEME_COLORS = { light: "#f6f6f4", dark: "#0d0d0f" };

export function applyThemeColor(theme, doc = document) {
  const metas = [...doc.querySelectorAll('meta[name="theme-color"]')];
  for (const m of metas) {
    const own = /dark/.test(m.media) ? THEME_COLORS.dark : THEME_COLORS.light;   // the system's own
    m.content = THEME_COLORS[theme] || own;
  }
}

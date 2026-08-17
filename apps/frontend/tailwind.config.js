/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  future: {
    // Compiles `hover:` to `@media (hover: hover)`. Without this, tapping any
    // of the app's ~170 hover-styled controls on a phone leaves it stuck in
    // its hover state until you tap elsewhere — a real bug on a mobile-first
    // app (spec §4), not just polish.
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      // Role-named colours backed by the CSS custom properties in
      // src/styles/index.css. Components name the role (`bg-card`, `text-dim`)
      // instead of a shade, so a theme change is a variable change rather than
      // a class change on every element. The `<alpha-value>` slot is what
      // keeps `/10`-style opacity utilities working.
      colors: {
        base: "rgb(var(--c-base) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        card: "rgb(var(--c-card) / <alpha-value>)",
        tint: "rgb(var(--c-tint) / <alpha-value>)",
        line: {
          DEFAULT: "rgb(var(--c-line) / <alpha-value>)",
          strong: "rgb(var(--c-line-strong) / <alpha-value>)",
          focus: "rgb(var(--c-line-focus) / <alpha-value>)",
        },
        fg: "rgb(var(--c-fg) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        dim: "rgb(var(--c-dim) / <alpha-value>)",

        amber: {
          DEFAULT: "rgb(var(--c-amber) / <alpha-value>)",
          hi: "rgb(var(--c-amber-hi) / <alpha-value>)",
        },
        "on-amber": "rgb(var(--c-on-amber) / <alpha-value>)",

        // Thermal semantics. Kept separate from the accent so `cool` always
        // means "the compressor is running" and never decoration.
        cool: "rgb(var(--c-cool) / <alpha-value>)",
        heat: "rgb(var(--c-heat) / <alpha-value>)",
        ok: "rgb(var(--c-ok) / <alpha-value>)",
        crit: "rgb(var(--c-crit) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Space Grotesk", "Inter", "system-ui", "sans-serif"],
      },
      transitionTimingFunction: {
        // The built-in CSS easings are too weak to read as intentional.
        // Entering/exiting elements use `out`; things moving on screen use
        // `in-out`. Deliberately no `ease-in` — it delays the initial
        // movement, the exact moment the user is watching most closely.
        out: "cubic-bezier(0.23, 1, 0.32, 1)",
        "in-out": "cubic-bezier(0.77, 0, 0.175, 1)",
      },
    },
  },
  plugins: [],
};

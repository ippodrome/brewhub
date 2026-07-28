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

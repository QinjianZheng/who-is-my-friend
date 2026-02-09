/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "serif"]
      },
      colors: {
        ink: "#1a1a1a",
        sand: "#f6f1e6",
        moss: "#335c47",
        clay: "#d8c7b0",
        ember: "#b6462e"
      }
    }
  },
  plugins: []
};

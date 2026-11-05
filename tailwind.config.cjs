// Tailwind is compiled at build time (it used to be the CDN script compiling in every
// browser on each page load). Same theme as the old inline config in index.html.
const brand = Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((n) => [n, `rgb(var(--primary-${n}) / <alpha-value>)`]));
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './*.{ts,tsx}', './components/**/*.{ts,tsx}', './pages/**/*.{ts,tsx}', './utils/**/*.{ts,tsx,mjs}'],
  theme: {
    extend: {
      colors: {
        primary: brand,
        // The CRM used "indigo" for its brand accents; point them at the brand palette too.
        indigo: brand,
        slate: { 900: '#0f172a', 950: '#020617' },
      },
      borderRadius: { '3xl': '1.5rem', '4xl': '2rem', '5xl': '3rem' },
      fontFamily: { sans: ['Cairo', 'sans-serif'] },
    },
  },
  plugins: [],
};

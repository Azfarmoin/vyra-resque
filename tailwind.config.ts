import type { Config } from "tailwindcss"

<<<<<<< HEAD
// VYRA palette: sand paper, harbour navy ink, coral action, amber warning, sea-green success, rose critical.
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
<<<<<<< HEAD
      fontFamily: {
        sans: ['var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
      },
      colors: {
        sand: { 50: '#FBF8F3', 100: '#F6F0E7', 200: '#EBE1D2', 300: '#DCCDB7', 400: '#C2AE91', 500: '#A08B6C' },
        // "ink" is the navy text scale (#182B3A is the primary text colour)
        ink: {
          50: '#F3F5F7', 100: '#E8ECEF', 200: '#D5DCE1', 300: '#B2BEC8', 400: '#8A9BA9',
          500: '#657A8C', 600: '#4B6073', 700: '#34495B', 800: '#243B4D', 900: '#182B3A', 950: '#0F1C27',
        },
        // "primary" is the coral action colour (#F47755). Always pair fills with ink-900 text.
        primary: {
          50: '#FEF2EE', 100: '#FDE3DA', 200: '#FCCBBB', 300: '#FAAE98', 400: '#F79274',
          500: '#F47755', 600: '#E2603D', 700: '#B8452A', 800: '#8F341E', 900: '#6B2716',
        },
        warning: { DEFAULT: '#E9B94D', 100: '#FAF0D3', 700: '#8A6516' },
        success: { DEFAULT: '#43866F', 50: '#EDF5F1', 100: '#D6E8E0', 700: '#2F6652', 800: '#245142' },
        critical: { DEFAULT: '#DF776E', 100: '#F9E0DD', 700: '#A8433B' },
        ember: '#EE9444',
      },
      borderRadius: { clay: '28px' },
      boxShadow: {
        lift: '0 1px 2px rgb(24 43 58 / 0.06), 0 8px 18px -6px rgb(24 43 58 / 0.14), 0 28px 48px -28px rgb(24 43 58 / 0.28)',
        pop: '0 2px 4px rgb(24 43 58 / 0.08), 0 18px 32px -10px rgb(24 43 58 / 0.22), 0 40px 70px -30px rgb(24 43 58 / 0.35)',
=======
      colors: {
        primary: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
        },
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
      },
    },
  },
  plugins: [],
}
export default config

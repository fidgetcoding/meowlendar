import type { Config } from 'tailwindcss'

// Meowlendar V2 palette. The live values (and their dark-theme versions) are CSS variables in
// app/globals.css; these names are for the occasional utility class.
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // periwinkle #6f7ae0 and the tints the design derives from it
        brand: {
          50: '#f4f5ff',
          100: '#eaecfe',
          200: '#d5d9fb',
          300: '#b6bcf1',
          400: '#929be8',
          500: '#6f7ae0',
          600: '#515dcb',
          700: '#4651bd',
          800: '#4f5482',
          900: '#2e3270',
        },
        paper: '#fffdf9',
        ink: '#21180e',
        loaf: '#e88a2c',
        sun: '#ffc24a',
        done: '#3dab63',
        cal: {
          my: '#e8930c',
          work: '#5a68d4',
          personal: '#cf5d78',
          gym: '#2b93b4',
        },
      },
    },
  },
  plugins: [],
}

export default config

import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'media',
  // Brand palette from the official logo: blue-600 is the logo blue, cyan-400 the logo dot.
  theme: { extend: { colors: { blue: { 500: '#2a63e0', 600: '#0b47c9', 700: '#0a3ba6' }, cyan: { 400: '#1bb9e0' } } } },
  plugins: [],
} satisfies Config;

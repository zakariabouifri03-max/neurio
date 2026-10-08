import type { Config } from 'tailwindcss';

/**
 * Branding is centralised here on purpose: the whole spec requires the name,
 * colours and logo to be swappable later without touching components.
 * Rename the product by editing `src/brand.ts` + this palette.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // neutral editor chrome
        ink: {
          950: '#0b0d10',
          900: '#101318',
          850: '#15191f',
          800: '#1b2027',
          750: '#222832',
          700: '#2c333e',
          600: '#3b4451',
          500: '#55617180',
          400: '#7c8899',
          300: '#a3adbc',
          200: '#c9d1dd',
          100: '#e7ebf1',
        },
        brand: {
          DEFAULT: '#3ddc97',
          50: '#eafff6',
          100: '#c9ffe8',
          200: '#96ffd4',
          300: '#5ef7bb',
          400: '#3ddc97',
          500: '#12c07c',
          600: '#059a62',
          700: '#077a50',
          800: '#0a6041',
          900: '#0a4f37',
        },
        accent: {
          DEFAULT: '#6ea8fe',
          warm: '#ffb454',
          danger: '#ff5c5c',
        },
        track: {
          video: '#3ddc97',
          audio: '#6ea8fe',
          text: '#ffb454',
          subtitle: '#c792ea',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 24px -12px rgba(0,0,0,0.6)',
      },
      keyframes: {
        'pulse-soft': {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      animation: {
        'pulse-soft': 'pulse-soft 1.6s ease-in-out infinite',
        'slide-in': 'slide-in 180ms ease-out',
        'fade-in': 'fade-in 140ms ease-out',
      },
    },
  },
  plugins: [],
} satisfies Config;

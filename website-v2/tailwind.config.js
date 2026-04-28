/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'w-bg':      '#080808',
        'w-surface': '#111111',
        'w-card':    '#171717',
        'w-amber':   '#F5A623',
        'w-gold':    '#FFD166',
        'w-text':    '#F5F5F5',
        'w-muted':   '#888888',
        'w-subtle':  '#3A3A3A',
        'w-border':  'rgba(255,255,255,0.07)',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      letterSpacing: {
        tightest: '-0.06em',
        tighter:  '-0.04em',
        tight:    '-0.02em',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%,100%': { transform: 'translateY(0px)' },
          '50%':     { transform: 'translateY(-12px)' },
        },
      },
    },
  },
  plugins: [],
}

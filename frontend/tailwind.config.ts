import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-roboto)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Sourced from the Woodworks Saas Figma file (Screen — Login, node 1:1345)
        brand: {
          50: '#f8f7f2',
          100: '#efede6',
          200: '#e3e1d9',
          300: '#d6d3c9',
          400: '#c49a5a',
          500: '#a8506a',
          600: '#94183a',
          700: '#80011f',
          800: '#650119',
          900: '#4a0113',
        },
        accent: {
          DEFAULT: '#fe0000',
          50: '#fff0f0',
          100: '#ffd6d6',
          500: '#fe0000',
          600: '#e40000',
        },
        ink: {
          DEFAULT: '#1f2933',
          muted: '#6b7280',
        },
      },
      borderRadius: {
        card: '14px',
        control: '6px',
      },
      boxShadow: {
        card: '0px 8px 24px 0px rgba(0,0,0,0.12)',
      },
    },
  },
  plugins: [],
};

export default config;

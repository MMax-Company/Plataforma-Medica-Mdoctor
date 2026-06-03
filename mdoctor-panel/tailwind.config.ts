import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontSize: {
        'panel-xs': ['0.75rem', { lineHeight: '1.125rem' }],
        'panel-sm': ['0.8125rem', { lineHeight: '1.25rem' }],
        'panel-base': ['0.875rem', { lineHeight: '1.375rem' }],
        'panel-lg': ['1rem', { lineHeight: '1.5rem' }],
        'panel-xl': ['1.125rem', { lineHeight: '1.625rem' }],
        'panel-2xl': ['1.25rem', { lineHeight: '1.75rem' }],
      },
      maxWidth: {
        panel: '1280px',
      },
    },
  },
  plugins: [],
};

export default config;

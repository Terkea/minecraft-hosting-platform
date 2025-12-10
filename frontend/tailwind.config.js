/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        minecraft: {
          grass: '#5D8731',
          dirt: '#8B5A2B',
          stone: '#7F7F7F',
          diamond: '#4AEDD9',
          gold: '#FCEE4B',
          iron: '#D8D8D8',
          redstone: '#FF0000',
          lapis: '#345EC3',
          emerald: '#17DD62',
          obsidian: '#1B1B1F',
        },
      },
    },
  },
  plugins: [],
};

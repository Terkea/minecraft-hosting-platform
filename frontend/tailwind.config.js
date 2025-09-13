/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {
			colors: {
				// Custom colors for Minecraft theme
				minecraft: {
					green: '#00AA00',
					darkgreen: '#005500',
					brown: '#AA5500',
					darkbrown: '#552A00',
					gray: '#555555',
					lightgray: '#AAAAAA'
				},
				// Server status colors
				status: {
					running: '#22C55E',
					stopped: '#EF4444',
					deploying: '#F59E0B',
					failed: '#DC2626',
					terminating: '#9CA3AF'
				}
			},
			animation: {
				'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
				'bounce-slow': 'bounce 2s infinite'
			},
			fontFamily: {
				// Minecraft-style font for headers
				minecraft: ['Courier New', 'monospace']
			}
		}
	},
	plugins: [
		require('@tailwindcss/forms')
	]
};
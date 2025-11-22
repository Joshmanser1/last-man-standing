// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Anything starting with /fpl will be proxied to the official FPL API
      '/fpl': {
        target: 'https://fantasy.premierleague.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/fpl/, ''), // e.g. /fpl/api/... → /api/...
      },
    },
  },
});

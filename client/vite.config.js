import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In dev the API runs separately; in production Express serves this build.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
});

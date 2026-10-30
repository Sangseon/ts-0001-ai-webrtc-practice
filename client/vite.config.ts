import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: realpathSync.native(fileURLToPath(new URL('.', import.meta.url))),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});

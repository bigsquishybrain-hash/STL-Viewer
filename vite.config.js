import { defineConfig } from 'vite';
import serviceWorker from './sw-plugin.js';

export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1000 },
  plugins: [serviceWorker()],
});

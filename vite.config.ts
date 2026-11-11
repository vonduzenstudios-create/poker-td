import { defineConfig } from 'vite';

// base './' so the build works on GitHub Pages under /poker-td/
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});

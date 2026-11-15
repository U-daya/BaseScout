import { defineConfig } from 'vite';

// Two pages: index.html is the landing page, app.html is the BaseScout app (served at /app).
export default defineConfig({
  build: {
    target: 'es2022', // the landing page uses top-level await
    rollupOptions: { input: { main: 'index.html', app: 'app.html' } },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:8788' },
  },
});

import { defineConfig } from 'vite';

// O index.html fica na raiz; `public/` guarda as fontes copiadas cruas.
export default defineConfig({
  // Servido sempre da raiz do dominio (pelo Vite em dev, pelo Express depois do
  // build), entao base relativa so complicaria as URLs de fonte dentro do CSS.
  base: '/',
  publicDir: 'public',
  build: {
    target: 'es2020',
    // O three.js e grande o bastante para valer um chunk proprio: ele muda de
    // versao raramente, entao fica cacheado enquanto o codigo do app evolui.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
  },
  server: {
    // `/auth` tambem: o botao "Entrar com Google" e um link para `/auth/google`,
    // e o callback do Google volta em `BASE_URL` (= este servidor, em dev).
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/auth': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
});

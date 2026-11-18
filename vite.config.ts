import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: process.env.PRISM_API_ORIGIN ?? 'http://127.0.0.1:4318',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (outgoing, incoming) => {
            // Forward same-origin development requests using the native origin.
            // Foreign Origin headers are preserved so the backend rejects them.
            if (incoming.headers.origin === `http://${incoming.headers.host}`) {
              outgoing.setHeader('Origin', process.env.PRISM_API_ORIGIN ?? 'http://127.0.0.1:4318');
            }
          });
        },
      },
    },
  },
});

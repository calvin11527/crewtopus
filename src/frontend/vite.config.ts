import { createLogger, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/** Benign when the backend restarts or a proxied socket closes mid-write. */
function isBenignProxySocketError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EPIPE' || code === 'ECONNRESET' || code === 'ECONNABORTED';
}

/** Vite always logs ws proxy socket errors internally; filter the noisy benign ones. */
const logger = createLogger();
const logError = logger.error.bind(logger);
logger.error = (msg, options) => {
  const text = typeof msg === 'string' ? msg : '';
  if (text.includes('ws proxy socket error') || text.includes('ws proxy error')) {
    const err = options?.error;
    if (!err || isBenignProxySocketError(err)) return;
  }
  logError(msg, options);
};

export default defineConfig({
  customLogger: logger,
  plugins: [react()],
  // Modern target avoids esbuild failures when deps use nested destructuring.
  esbuild: { target: 'es2022' },
  build: { target: 'es2022' },
  optimizeDeps: {
    esbuildOptions: { target: 'es2022' },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
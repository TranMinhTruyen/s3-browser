import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';

// https://vitejs.dev/config/
export default defineConfig(() => {
  return {
    // React Compiler runs through oxc-transform-react, so no Babel pass is needed.
    plugins: [react({ compiler: { logDiagnostics: true } }), svgr()],
    server: {
      // Bind IPv4 explicitly: with the default 'localhost', Node resolves to
      // ::1 only, while the Wails asset proxy dials 127.0.0.1 — which would
      // leave the webview blank in dev mode.
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
    },
    define: {
      global: 'window',
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
        '@components': path.resolve(import.meta.dirname, './src/components'),
        '@common': path.resolve(import.meta.dirname, './src/common'),
        '@wails': path.resolve(import.meta.dirname, './bindings'),
      },
    },
  };
});

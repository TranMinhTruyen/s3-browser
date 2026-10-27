import path from 'node:path';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { defineConfig } from 'vitest/config';

// https://vitejs.dev/config/
export default defineConfig(() => {
  return {
    plugins: [react(), svgr()],
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
    test: {
      environment: 'jsdom',
      globals: true,
      mockReset: true,
      css: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', '**/*.d.ts', 'src/**/*.json', 'src/main.tsx'],
        reporter: ['text-summary', 'text', 'json-summary'],
        reportsDirectory: 'coverage',
        thresholds: { branches: 95, statements: 95, lines: 95, functions: 95 },
      },
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

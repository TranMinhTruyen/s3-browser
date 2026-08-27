import path from 'node:path';
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig, type PluginOption } from 'vite';
import svgr from 'vite-plugin-svgr';

// https://vitejs.dev/config/
export default defineConfig(() => {
  const plugins: PluginOption[] = [react(), svgr()];

  plugins.push(babel({ presets: [reactCompilerPreset()] }));

  return {
    plugins,
    server: {
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
        '@wails': path.resolve(import.meta.dirname, './wailsjs'),
      },
    },
  };
});

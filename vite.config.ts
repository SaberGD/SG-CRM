import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';

// One id per build; the page compares it with /version.json to notice new deploys
// (same mechanism as the accounting system's update banner).
const sha = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'nogit'; } })();
const BUILD_ID = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${sha}`;
const versionFile = () => ({
  name: 'emit-version-json',
  generateBundle(this: any) {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) });
  },
});

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), versionFile()],
      define: {
        __APP_BUILD_ID__: JSON.stringify(BUILD_ID),
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});

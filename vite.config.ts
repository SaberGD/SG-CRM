import path from 'path';
import { defineConfig } from 'vite';
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

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), versionFile()],
      define: {
        // No API keys are ever inlined into the public bundle: AI runs in the Cloud Functions.
        __APP_BUILD_ID__: JSON.stringify(BUILD_ID),
      },
      build: { sourcemap: false },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});

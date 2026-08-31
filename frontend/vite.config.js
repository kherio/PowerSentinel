import { defineConfig } from 'vite';

// The KernelSU WebUI-X manager loads the module's webroot/index.html
// directly as a local file (no local httpd), so everything must be
// relative (no leading "/") and inlined/emitted as static assets.
export default defineConfig({
  base: './',
  build: {
    outDir: '../webroot',
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false
  }
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// Scan only the app's entry. Packaging leaves release/dmg/Applications -> /Applications, and the default
// **/*.html scan would follow it into other apps' bundles.
export default defineConfig({
  base:'./',
  plugins:[react(),tailwindcss()],
  optimizeDeps:{entries:['index.html']},
  server:{watch:{ignored:['**/release/**','**/dist/**','**/dist-electron/**','**/.venv/**']}},
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri sert l'interface depuis ce build. Le port est fixe et l'échec est strict :
// une interface qui bascule silencieusement sur un autre port ne serait pas trouvée
// par la fenêtre native.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    target: 'esnext',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

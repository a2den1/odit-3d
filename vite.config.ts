import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5188, strictPort: true },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    target: 'chrome128',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: { react: ['react', 'react-dom'], three: ['three'] },
      },
    },
  },
})

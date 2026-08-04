import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import dts from 'unplugin-dts/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    dts({
      entryRoot: './src',
      outDirs: './dist',
      exclude: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'src/mock/**'],
    }),
  ],
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/ys-text-annotation.ts'),
      fileName: 'ys-text-annotation',
      formats: ['es'],
    },
  },
})

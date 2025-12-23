import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    dts({
      // 指定入口文件根目录
      entryRoot: './src',
      // 输出目录
      outDir: './dist',
      // 将所有类型合并到一个文件中（解决类型引用问题）
      rollupTypes: true,
      // 排除不需要的文件
      exclude: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'src/mock/**']
    })
  ],
  build: {
    lib: {
      // 入口文件：你的 WebComponent 组件
      entry: './src/ys-text-annotation.ts',
      name: 'YsTextAnnotation',
      // 输出文件名
      fileName: 'ys-text-annotation',
      formats: ['es']
    },
    rollupOptions: {
      // 确保外部化处理那些你不想打包进库的依赖
      external: [],
      output: {
        // 在 UMD 构建模式下为这些外部化的依赖提供一个全局变量
        globals: {}
      }
    }
  }
})

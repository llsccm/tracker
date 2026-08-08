import { fileURLToPath, URL } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,ts}'],
    exclude: [...configDefaults.exclude, 'tests/replay/**'],
    coverage: {
      include: ['src/tracker/**/*.{js,ts}'],
      exclude: ['src/tracker/view/**']
    }
  }
})

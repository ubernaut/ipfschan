import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/server/__tests__/**/*.test.js', 'src/client/__tests__/**/*.test.js']
  }
})

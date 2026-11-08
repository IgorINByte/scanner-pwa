import { defineConfig } from 'vitest/config'

// `npm run bench`: detection accuracy/speed on test-images/ (needs ground-truth.json).
export default defineConfig({
  test: {
    include: ['bench/**/*.bench-test.ts'],
    environment: 'node',
    testTimeout: 300_000,
  },
})

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // PGlite har test faylida yangi baza ochadi — ketma-ket ishlash xotirani tejaydi.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});

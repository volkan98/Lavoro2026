import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { environment: 'jsdom', include: ['tests/**/*.test.{ts,tsx}'], testTimeout: 20000, hookTimeout: 30000,
    setupFiles: ['tests/setup.ts'], fileParallelism: false },
});

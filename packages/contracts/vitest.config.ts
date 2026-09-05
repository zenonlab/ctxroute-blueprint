import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@tobirink/application': fileURLToPath(new URL('../application/src/index.ts', import.meta.url)),
      '@tobirink/domain': fileURLToPath(new URL('../domain/src/index.ts', import.meta.url)),
    },
  },
});

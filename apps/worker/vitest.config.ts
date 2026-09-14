import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  plugins: [cloudflareTest({
    miniflare: {
      bindings: { TEST_MIGRATIONS: migrations },
      d1Databases: ['PUBLIC_DB'],
    },
    wrangler: { configPath: './wrangler.jsonc' },
  })],
  test: {
    include: ['src/**/*.test.ts'],
  },
});

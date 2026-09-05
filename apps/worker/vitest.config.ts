import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  plugins: [cloudflareTest({
    miniflare: {
      bindings: { COLLECTIVE_DAILY_QUOTA: '2', TEST_MIGRATIONS: migrations },
      d1Databases: ['COLLECTIVE_DB'],
    },
    wrangler: { configPath: './wrangler.jsonc' },
  })],
  test: {
    include: ['src/**/*.test.ts'],
  },
});

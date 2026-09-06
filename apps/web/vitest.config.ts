import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'https://tobirink.com/' } },
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});

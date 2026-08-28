import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Unit tests for the devtools app. jsdom DOM + Testing Library; the SDK is
// mocked per test so a region renders without a live host.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});

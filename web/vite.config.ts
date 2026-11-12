import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    react(),
    // The NEAR wallet SDK's dependency chain expects Node globals (Buffer,
    // process, global) to exist in the browser.
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
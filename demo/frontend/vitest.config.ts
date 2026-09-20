import { defineConfig } from 'vitest/config';

// Unit tests for the pure layers (src/domain) and the static-markup guard of the map.
// No browser: anything that needs a DOM belongs in the Playwright smoke test instead.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});

import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
    // Playwright END-TO-END specs live in `e2e/**` and are driven by
    // `playwright test`, not Vitest. Preserve Vitest's built-in defaults and
    // only add the e2e exclusion (default discovery would otherwise pick up
    // `e2e/**/*.spec.ts`).
    exclude: [...configDefaults.exclude, 'e2e/**']
  }
});

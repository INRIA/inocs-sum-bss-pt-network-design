// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

/**
 * GitHub Pages project page: https://inria.github.io/inocs-sum-bss-pt-network-design/
 * Every asset and data URL must therefore resolve under `base`. Components read
 * `import.meta.env.BASE_URL` — never an absolute `/data/...` path.
 *
 * Override for a fork / different repo name:
 *   SITE=https://<org>.github.io BASE=/<repo> npm run build
 */
export default defineConfig({
  site: process.env.SITE ?? 'https://inria.github.io',
  base: process.env.BASE ?? '/inocs-sum-bss-pt-network-design',
  trailingSlash: 'ignore',
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
  build: { assets: 'assets' },
});

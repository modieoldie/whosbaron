// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://whosbaron.com',
  vite: {
    // Astro and @tailwindcss/vite resolve slightly different copies of Vite's
    // types, which trips `astro check` on an otherwise valid plugin. Runtime is
    // unaffected; the cast keeps the type check honest about everything else.
    plugins: [/** @type {any} */ (tailwindcss())],
  },
});

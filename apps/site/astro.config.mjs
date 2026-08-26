import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  site: 'https://sparklerss.com',
  build: {
    format: 'directory',
  },
});
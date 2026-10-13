import { defineConfig } from 'astro/config';

export default defineConfig({
  site: process.env.BLOG_SITE_URL || 'http://152.136.191.171:8088',
  output: 'static',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  markdown: { shikiConfig: { theme: 'github-light' } },
});

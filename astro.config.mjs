import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import compress from '@playform/compress';
import critters from 'astro-critters';

export default defineConfig({
  integrations: [
    react(),
    critters(),
    compress({
      CSS: true,
      HTML: true,
      JavaScript: true,
      Image: false,
      SVG: false,
    }),
  ],
  output: 'server',
  adapter: cloudflare({ mode: 'directory' }),
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ['hls.js', 'react-dom/client']
    },
    ssr: {
      noExternal: ['hls.js']
    }
  }
});

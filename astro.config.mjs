import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  integrations: [
    react(),
  ],
  output: 'server',
  adapter: cloudflare({ mode: 'directory' }),
  vite: {
    plugins: [
      tailwindcss(),
      // ponytail: Vite 8 bug — ssr.noExternal (top-level) not merged into environment resolve.noExternal.
      // @astrojs/react's configEnvironment only adds MUI packages. We inject react/react-dom directly.
      // https://github.com/vitejs/vite/issues/20499
      {
        name: 'react-ssr-noexternal',
        configEnvironment(name, options) {
          if (name === 'ssr') {
            options.resolve = options.resolve || {};
            if (options.resolve.noExternal === true) return;
            const list = Array.isArray(options.resolve.noExternal) ? options.resolve.noExternal : [];
            if (!list.includes('react')) list.push('react');
            if (!list.includes('react-dom')) list.push('react-dom');
            options.resolve.noExternal = list;
          }
        },
      },
    ],
    optimizeDeps: {
      include: ['hls.js', 'react-dom/client']
    },
    ssr: {
      noExternal: ['hls.js', 'react', 'react-dom']
    }
  }
});

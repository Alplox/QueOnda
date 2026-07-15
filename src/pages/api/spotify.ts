import type { APIRoute } from 'astro';
import { dedupeFetch } from '../../lib/cache';

const OEMBED_URL = 'https://open.spotify.com/oembed?url=https://open.spotify.com/playlist/37i9dQZEVXbL0GavIqMTeb';

export const GET: APIRoute = async () => {
  const result = await dedupeFetch<{ title: string; thumbnailUrl: string }>('spotify', async () => {
    try {
      const res = await fetch(OEMBED_URL, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error('oEmbed failed');
      const data = await res.json();
      return { title: data.title || 'Top 50 - Chile', thumbnailUrl: data.thumbnail_url || '' };
    } catch {
      return { title: 'Top 50 - Chile', thumbnailUrl: '' };
    }
  });

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  });
};

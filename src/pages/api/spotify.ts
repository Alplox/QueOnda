import type { APIRoute } from 'astro';
import { getCached, setCache } from '../../lib/cache';

const OEMBED_URL = 'https://open.spotify.com/oembed?url=https://open.spotify.com/playlist/37i9dQZEVXbL0GavIqMTeb';

export const GET: APIRoute = async () => {
  const cached = await getCached<{ title: string; thumbnailUrl: string }>('spotify');
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    });
  }

  try {
    const res = await fetch(OEMBED_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('oEmbed failed');

    const data = await res.json();
    const result = { title: data.title || 'Top 50 - Chile', thumbnailUrl: data.thumbnail_url || '' };

    await setCache('spotify', result, 60 * 60 * 1000);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    });
  } catch {
    return new Response(JSON.stringify({ title: 'Top 50 - Chile', thumbnailUrl: '' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

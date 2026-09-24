import type { APIRoute } from 'astro';
import { fetchChannels, fetchIPTVChannels } from '../../lib/channels';
import { edgeCacheHeaders } from '../../lib/cache';

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some(param => param !== 'source' && param !== 'category')) {
      return new Response(JSON.stringify({ error: 'Unsupported query parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const source = url.searchParams.get('source') || 'json-teles';
    const category = url.searchParams.get('category') || undefined;

    if (source !== 'json-teles' && source !== 'iptv-org') {
      return new Response(JSON.stringify({ error: 'Invalid source' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = source === 'iptv-org' ? await fetchIPTVChannels() : await fetchChannels();
    const categories = ['todas', ...new Set(data.channels.map((ch) => ch.category).filter(Boolean))];

    if (category && category !== 'todas' && !categories.includes(category)) {
      return new Response(JSON.stringify({ error: 'Invalid category' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let channels = data.channels;
    if (category && category !== 'todas') {
      channels = data.channels.filter((ch) => ch.category === category);
    }

    return new Response(JSON.stringify({ channels, categories }), {
      headers: edgeCacheHeaders(3600),
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch channels' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

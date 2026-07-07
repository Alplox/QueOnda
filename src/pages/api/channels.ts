import type { APIRoute } from 'astro';
import { fetchChannels } from '../../lib/channels';

export const GET: APIRoute = async ({ request }) => {
  try {
    const data = await fetchChannels();
    const url = new URL(request.url);
    const category = url.searchParams.get('category') || undefined;

    let channels = data.channels;
    if (category && category !== 'todas') {
      channels = data.channels.filter((ch) => ch.category === category);
    }

    const categories = ['todas', ...new Set(data.channels.map((ch) => ch.category).filter(Boolean))];

    return new Response(JSON.stringify({ channels, categories }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch channels' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

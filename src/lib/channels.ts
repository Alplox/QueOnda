import { getCached, setCache } from './cache';

const CHANNELS_URL = 'https://raw.githubusercontent.com/Alplox/json-teles/main/countries/cl.json';
const IPTV_ORG_URL = 'https://iptv-org.github.io/iptv/countries/cl.m3u';
const CACHE_TTL = 60 * 60 * 1000;

export interface Signal {
  type: string;
  url: string;
}

export interface Channel {
  id: string;
  name: string;
  logo: string | null;
  signals: Signal[];
  youtube: string | null;
  twitch: string | null;
  website: string;
  category: string;
  last_youtube_livestreams?: string[];
}

export interface ChannelsData {
  country: string;
  channels: Channel[];
}

export async function fetchChannels(): Promise<ChannelsData> {
  const cacheKey = 'channels:all';
  const cached = await getCached<ChannelsData>(cacheKey);
  if (cached) return cached;

  const res = await fetch(CHANNELS_URL);
  if (!res.ok) throw new Error(`Failed to fetch channels: ${res.status}`);

  const data: ChannelsData = await res.json();

  const channels = data.channels
    .filter((ch) => {
      if (ch.signals && ch.signals.length > 0) return true;
      if (ch.youtube) return true;
      if (ch.twitch) return true;
      return false;
    })
    .map((ch) => {
      const signals = (ch.signals || []).filter((s) => s.type === 'm3u8' || s.type === 'iframe');
      if (ch.youtube) {
        const id = ch.youtube;
        (ch.last_youtube_livestreams || []).forEach((vid: string) => {
          signals.push({ type: 'youtube-vod', url: `https://www.youtube.com/embed/${vid}?autoplay=1` });
        });
        signals.push({ type: 'youtube', url: `https://www.youtube.com/embed/live_stream?channel=${id}&autoplay=1` });
      }
      if (ch.twitch) {
        signals.push({ type: 'twitch', url: `https://player.twitch.tv/?channel=${ch.twitch}&parent=localhost&parent=queonda.vercel.app` });
      }
      return { ...ch, signals };
    })
    .filter((ch) => ch.signals.length > 0);

  const result = { country: data.country, channels };
  await setCache(cacheKey, result, CACHE_TTL);
  return result;
}

export function getChannelsByCategory(channels: Channel[], category?: string): Channel[] {
  if (!category || category === 'todas') return channels;
  return channels.filter((ch) => ch.category === category);
}

export function getCategories(channels: Channel[]): string[] {
  const cats = new Set(channels.map((ch) => ch.category).filter(Boolean));
  return ['todas', ...Array.from(cats)];
}

export function parseM3U(m3uText: string): Channel[] {
  const channels: Channel[] = [];
  const lines = m3uText.split('\n');
  const seen = new Set<string>();
  let idx = 0;
  let current: Partial<Channel> | null = null;

  function uniqueId(raw: string): string {
    let id = raw, i = 1;
    while (seen.has(id)) id = `${raw}-${i++}`;
    seen.add(id);
    return id;
  }

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('#EXTINF:')) {
      const rawId = t.match(/tvg-id="([^"]*)"/)?.[1] || `m3u-${idx}`;
      current = {
        id: uniqueId(rawId),
        name: t.match(/,([^,]+)$/)?.[1]?.trim() || 'Unknown',
        logo: t.match(/tvg-logo="([^"]*)"/)?.[1] || null,
        category: t.match(/group-title="([^"]*)"/)?.[1] || 'general',
        signals: [],
        youtube: null,
        twitch: null,
        website: '',
      };
    } else if (t && !t.startsWith('#') && current) {
      current.signals = [{ type: 'm3u8', url: t }];
      channels.push({
        id: current.id || `m3u-${channels.length}`,
        name: current.name || 'Unknown',
        logo: current.logo || null,
        signals: current.signals,
        youtube: null,
        twitch: null,
        website: '',
        category: current.category || 'general',
      });
      current = null;
      idx++;
    }
  }
  return channels;
}

export async function fetchIPTVChannels(): Promise<ChannelsData> {
  const cacheKey = 'channels:iptv-org';
  const cached = await getCached<ChannelsData>(cacheKey);
  if (cached) return cached;

  const res = await fetch(IPTV_ORG_URL);
  if (!res.ok) throw new Error(`Failed to fetch iptv-org channels: ${res.status}`);

  const m3uText = await res.text();
  const channels = parseM3U(m3uText);

  const result = { country: 'cl', channels };
  await setCache(cacheKey, result, CACHE_TTL);
  return result;
}

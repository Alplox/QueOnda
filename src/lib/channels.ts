import { getCached, setCache } from './cache';

const CHANNELS_URL = 'https://raw.githubusercontent.com/Alplox/json-teles/main/countries/cl.json';
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

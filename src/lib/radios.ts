import { BROWSER_UA } from './rss';

export interface RadioSignal {
  type: 'hls' | 'audio' | 'iframe';
  url: string;
  label?: string;
}

export interface RadioStation {
  id: string;
  name: string;
  logo: string | null;
  signals: RadioSignal[];
  streamUrl: string;
  website: string;
  tags: string[];
}

export function extractRadios(channels: any[]): RadioStation[] {
  // Dynamically extract radios from channels marked with category "music"
  return channels
    .filter((ch) => ch.category === 'music' && ch.signals?.length > 0)
    .map((ch) => {
      // Extract all playable signals, preferring m3u8 for redundancy
      const signals: RadioSignal[] = [];
      
      // Collect all m3u8 signals (for fallback)
      const m3u8Signals = ch.signals.filter((s: any) => s.type === 'm3u8');
      m3u8Signals.forEach((s: any, idx: number) => {
        signals.push({
          type: 'hls',
          url: s.url,
          label: m3u8Signals.length > 1 ? `HD ${idx + 1}` : 'HD',
        });
      });
      
      // Add iframe as fallback
      const iframe = ch.signals.find((s: any) => s.type === 'iframe');
      if (iframe && signals.length === 0) {
        signals.push({
          type: 'iframe',
          url: iframe.url,
          label: 'WEB',
        });
      }
      
      // Ensure at least one stream
      if (signals.length === 0) {
        const firstSignal = ch.signals[0];
        signals.push({
          type: getRadioStreamType(firstSignal.url),
          url: firstSignal.url,
          label: 'Stream',
        });
      }

      const streamUrl = signals[0]?.url || '';
      
      return {
        id: ch.id,
        name: ch.name.replace(/^Radio\s/i, '').trim(),
        logo: ch.logo || null,
        signals,
        streamUrl,
        website: ch.website || '',
        tags: [],
      };
    })
    .filter((s) => s.streamUrl);
}

export function getRadioStreamType(url: string): 'hls' | 'audio' | 'iframe' {
  if (url.endsWith('.m3u8')) return 'hls';
  if (url.includes('.audio') || url.includes('icecast') || url.endsWith('.mp3') || url.endsWith('.aac')) return 'audio';
  return 'iframe';
}

const RADIO_BROWSER_API = 'https://de1.api.radio-browser.info';

interface RadioBrowserStation {
  stationuuid: string;
  name: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  codec: string;
  hls: number;
  bitrate: number;
  tags: string;
  countrycode: string;
  state: string;
  language: string;
  clickcount: number;
}

export async function fetchRadioBrowserStations(): Promise<{ stations: RadioStation[]; tags: string[]; states: string[] }> {
  const url = `${RADIO_BROWSER_API}/json/stations/search?limit=500&countrycode=CL&lastcheckok=1&hidebroken=true&order=clickcount&reverse=true`;
  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return { stations: [], tags: [], states: [] };
  const raw: RadioBrowserStation[] = await res.json();

  const stations: RadioStation[] = raw
    .filter(s => s.url_resolved)
    .map(s => {
      const type = s.hls === 1 ? 'hls' as const : 'audio' as const;
      const tags = s.tags ? s.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [];
      return {
        id: s.stationuuid,
        name: s.name.trim(),
        logo: s.favicon || null,
        signals: [{ type, url: s.url_resolved, label: s.codec || type.toUpperCase() }],
        streamUrl: s.url_resolved,
        website: s.homepage || '',
        tags,
      };
    });

  const tagCount = new Map<string, number>();
  const stateCount = new Map<string, number>();

  for (const s of raw) {
    if (s.tags) {
      for (const tag of s.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)) {
        tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
      }
    }
    if (s.state) {
      const st = s.state.trim();
      if (st) {
        stateCount.set(st, (stateCount.get(st) || 0) + 1);
      }
    }
  }

  const tags = [...tagCount.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag)
    .slice(0, 20);

  const states = [...stateCount.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([state]) => state);

  return { stations, tags, states };
}

export const FALLBACK_RADIOS: RadioStation[] = [
  {
    id: 'cooperativa',
    name: 'Cooperativa',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/e/ed/Radio_Cooperativa_Logo.svg',
    signals: [
      { type: 'audio', url: 'https://unlimited11-cl.dps.live/cooperativafm/aac/icecast.audio', label: 'AAC' },
    ],
    streamUrl: 'https://unlimited11-cl.dps.live/cooperativafm/aac/icecast.audio',
    website: 'https://www.cooperativa.cl',
    tags: [],
  },
  {
    id: 'duna',
    name: 'Duna',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/3/38/Radio_Duna_Logo.png',
    signals: [
      { type: 'audio', url: 'https://streaming.radioduna.cl:8000/duna192', label: 'MP3' },
    ],
    streamUrl: 'https://streaming.radioduna.cl:8000/duna192',
    website: 'https://www.radioduna.cl',
    tags: [],
  },
  {
    id: 'adn',
    name: 'ADN',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/5/55/Logo_ADN_Radio.svg',
    signals: [
      { type: 'hls', url: 'https://streaming.radios.cl:443/adn/adn.m3u8', label: 'HLS' },
    ],
    streamUrl: 'https://streaming.radios.cl:443/adn/adn.m3u8',
    website: 'https://www.radioadn.cl',
    tags: [],
  },
];

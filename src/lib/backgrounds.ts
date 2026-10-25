import dataSources from './data-sources.json';

export interface HeroBg {
  url: string;
  photoUrl: string;
  author: string;
  focalPoint?: string;
}

const imgSection = (dataSources as any).sections?.['images'];
const heroItem = imgSection?.sources?.find((i: any) => i.name === 'Imágenes de portada (hero)');
const bgList = heroItem?.backgrounds ?? [];

export const backgrounds: HeroBg[] = bgList.map((b: any) => ({
  url: b.localPath,
  photoUrl: b.photoUrl,
  author: b.author,
  focalPoint: b.focalPoint,
}));

function dayOfYear(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime();
  return Math.floor(diff / 86_400_000);
}

export function getTodayBg(): HeroBg {
  return backgrounds[dayOfYear() % backgrounds.length];
}

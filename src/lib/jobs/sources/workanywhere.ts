import type { Job } from '../types';

const RSS_URL = 'https://workanywhere.pro/rss.xml';

export async function fetchWorkAnywhereJobs(limit = 20): Promise<Job[]> {
  const res = await fetch(RSS_URL, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`WorkAnywhere: ${res.status}`);
  const xml = await res.text();

  const items: Job[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
    const block = match[1];
    items.push(parseItem(block));
  }

  return items;
}

function extract(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim();
}

function parseItem(block: string): Job {
  const title = extract(block, 'title');
  const link = extract(block, 'link');
  const description = stripHtml(extract(block, 'description')).slice(0, 500);
  const pubDate = extract(block, 'pubDate');
  const categories: string[] = [];
  const catRegex = /<category[^>]*>([\s\S]*?)<\/category>/gi;
  let cm: RegExpExecArray | null;
  while ((cm = catRegex.exec(block)) !== null) {
    const cat = cm[1].trim();
    if (cat) categories.push(cat);
  }

  const isRemote =
    title.toLowerCase().includes('remote') ||
    description.toLowerCase().includes('remote') ||
    categories.some((c) => c.toLowerCase().includes('remote'));

  const company = guessCompany(title, description);

  return {
    id: `wa-${Buffer.from(link).toString('base64').slice(0, 32)}`,
    title,
    company,
    description,
    url: link,
    tags: categories,
    salary: null,
    location: isRemote ? 'Remoto' : 'Global',
    remote: isRemote,
    category: categories[0] || 'Otros',
    source: 'workanywhere' as const,
    publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
  };
}

function guessCompany(title: string, description: string): string {
  const patterns = [
    /at\s+([A-Z][A-Za-z0-9\s&.]+?)(?:\s+is|\s+are|\s+\(|$|\.)/,
    /([A-Z][A-Za-z0-9\s&.]+?)\s+(?:is\s+hiring|seeks|looking)/,
  ];
  for (const p of patterns) {
    const m = title.match(p) || description.match(p);
    if (m) return m[1].trim();
  }
  return '';
}

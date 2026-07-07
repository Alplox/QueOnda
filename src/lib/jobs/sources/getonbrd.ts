import type { Job } from '../types';

const API_BASE = 'https://www.getonbrd.com/api/v0';

export async function fetchGetOnBrdJobs(limit = 20): Promise<Job[]> {
  const res = await fetch(`${API_BASE}/search/jobs?query=a&per_page=${limit}&expand[]=company`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GetOnBrd: ${res.status}`);
  const data = await res.json() as {
    data: {
      id: string;
      attributes: {
        title: string;
        description: string;
        remote: boolean;
        min_salary: number | null;
        max_salary: number | null;
        category_name: string;
        published_at: number;
        company: {
          data: { id: string; type: string; attributes: { name: string } };
        };
      };
      links: { public_url: string };
    }[];
    meta: { page: number; per_page: number; total_pages: number };
  };

  return data.data.map((item) => {
    const a = item.attributes;
    const companyName = a.company.data?.attributes?.name || '';
    return {
      id: `getonbrd-${item.id}`,
      title: a.title,
      company: companyName,
      description: a.description.replace(/<[^>]*>/g, '').slice(0, 500),
      url: item.links.public_url,
      tags: [a.category_name].filter(Boolean),
      salary:
        a.min_salary != null || a.max_salary != null
          ? { min: a.min_salary, max: a.max_salary, currency: 'USD' }
          : null,
      location: a.remote ? 'Remoto' : 'Chile',
      remote: a.remote,
      category: a.category_name || 'Otros',
      source: 'getonbrd' as const,
      publishedAt: new Date(a.published_at * 1000).toISOString(),
    };
  });
}

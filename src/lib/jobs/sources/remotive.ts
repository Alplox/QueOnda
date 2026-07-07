import type { Job } from '../types';

const API_URL = 'https://remotive.com/api/remote-jobs';

export async function fetchRemotiveJobs(limit = 20): Promise<Job[]> {
  const res = await fetch(`${API_URL}?limit=${limit}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Remotive: ${res.status}`);
  const data = await res.json() as {
    jobs: {
      id: string;
      title: string;
      company_name: string;
      url: string;
      category: string;
      tags: string[];
      salary: string;
      candidate_required_location: string;
      publication_date: string;
    }[];
  };

  return data.jobs.map((j) => {
    const salary = parseSalary(j.salary);
    return {
      id: `remotive-${j.id}`,
      title: j.title,
      company: j.company_name || '',
      description: '',
      url: j.url,
      tags: j.tags || [],
      salary,
      location: j.candidate_required_location || 'Remoto',
      remote: true,
      category: j.category || 'Otros',
      source: 'remotive' as const,
      publishedAt: j.publication_date || new Date().toISOString(),
    };
  });
}

function parseSalary(raw: string): { min: number | null; max: number | null; currency: string } | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,]/g, '').trim();
  const nums = cleaned.split('-').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
  if (nums.length === 0) return null;
  return {
    min: nums[0] || null,
    max: nums.length > 1 ? nums[nums.length - 1] : null,
    currency: raw.includes('$') ? 'USD' : '',
  };
}

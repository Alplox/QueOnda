import type { Job, JobSource } from './types';
import { fetchGetOnBrdJobs } from './sources/getonbrd';
import { fetchWorkAnywhereJobs } from './sources/workanywhere';
import { fetchRemotiveJobs } from './sources/remotive';

interface FetchResult {
  jobs: Job[];
  source: JobSource;
  ok: boolean;
}

const LIMIT = 15;

const SOURCE_FETCHERS: Record<JobSource, (limit?: number) => Promise<Job[]>> = {
  getonbrd: fetchGetOnBrdJobs,
  workanywhere: fetchWorkAnywhereJobs,
  remotive: fetchRemotiveJobs,
};

const SOURCE_ORDER: JobSource[] = ['getonbrd', 'workanywhere', 'remotive'];

export async function fetchJobs(source?: JobSource): Promise<{ jobs: Job[]; sources: JobSource[] }> {
  if (source && SOURCE_FETCHERS[source]) {
    try {
      const jobs = await SOURCE_FETCHERS[source](LIMIT);
      return { jobs, sources: [source] };
    } catch {
      return { jobs: [], sources: [] };
    }
  }

  const allJobs: Job[] = [];
  const seen = new Set<string>();
  const activeSources: JobSource[] = [];

  for (const src of SOURCE_ORDER) {
    try {
      const jobs = await SOURCE_FETCHERS[src](LIMIT);
      activeSources.push(src);
      for (const job of jobs) {
        const key = `${job.title}|${job.company}`;
        if (!seen.has(key)) {
          seen.add(key);
          allJobs.push(job);
        }
      }
    } catch {
      continue;
    }
  }

  return { jobs: allJobs.slice(0, LIMIT), sources: activeSources };
}

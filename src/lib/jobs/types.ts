export interface Job {
  id: string;
  title: string;
  company: string;
  description: string;
  url: string;
  tags: string[];
  salary: { min: number | null; max: number | null; currency: string } | null;
  location: string;
  remote: boolean;
  category: string;
  source: JobSource;
  publishedAt: string;
}

export type JobSource = 'getonbrd' | 'workanywhere' | 'remotive';

export interface SourceConfig {
  key: JobSource;
  label: string;
  url: string;
}

export const JOB_SOURCES: SourceConfig[] = [
  { key: 'getonbrd', label: 'GetOnBrd', url: 'https://www.getonbrd.com' },
  { key: 'workanywhere', label: 'WorkAnywhere', url: 'https://workanywhere.pro' },
  { key: 'remotive', label: 'Remotive', url: 'https://remotive.com' },
];

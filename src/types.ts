export interface Channel {
  id: string;
  name: string;
  logo: string | null;
  signals: { type: string; url: string }[];
  youtube: string | null;
  twitch: string | null;
  website: string;
  category: string;
}

export interface Article {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
  sourceKey: string;
  sourceLogo?: string;
  image?: string;
}

export interface NewsCluster {
  topic: string;
  keywords: string[];
  articles: Article[];
  sourceCount: number;
}

export interface SourceResult {
  name: string;
  url: string;
  success: boolean;
  articlesCount: number;
  error?: string;
  statusCode?: number;
}

export interface FeedSource {
  name: string;
  url: string;
  siteUrl?: string;
  sourceKey?: string;
  source?: string;
}

export interface SourceFeed extends FeedSource {
  sourceKey: string;
  source: string;
  region?: string | null;
}

export interface PinnedSource {
  sourceKey: string;
  name: string;
  url: string;
}

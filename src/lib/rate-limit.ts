interface RateLimitEntry {
  timestamps: number[];
}

const WINDOW_MS = 60_000;
const store = new Map<string, RateLimitEntry>();

function rateLimit(opts: {
  ip: string;
  maxRequests: number;
  windowMs?: number;
  route: string;
}): { allowed: boolean; remaining: number; retryAfter?: number } {
  const window = opts.windowMs ?? WINDOW_MS;
  const key = `${opts.route}:${opts.ip}`;
  const cutoff = Date.now() - window;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter(t => t > cutoff);

  if (entry.timestamps.length >= opts.maxRequests) {
    const oldest = entry.timestamps[0];
    const retryAfter = Math.ceil((oldest + window - Date.now()) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }

  entry.timestamps.push(Date.now());
  return { allowed: true, remaining: opts.maxRequests - entry.timestamps.length };
}

export function checkRateLimit(request: Request, route: string, maxRequests: number): Response | null {
  const rl = rateLimit({ ip: extractIP(request), maxRequests, route });
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429, headers: { 'Content-Type': 'application/json' }
    });
  }
  return null;
}

function extractIP(request: Request): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf;
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return '127.0.0.1';
}

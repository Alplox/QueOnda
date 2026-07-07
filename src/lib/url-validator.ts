const PRIVATE_RANGES = [
  { ipv4: '127.0.0.0', prefix: 8 },
  { ipv4: '10.0.0.0', prefix: 8 },
  { ipv4: '172.16.0.0', prefix: 12 },
  { ipv4: '192.168.0.0', prefix: 16 },
  { ipv4: '169.254.0.0', prefix: 16 },
  { ipv4: '0.0.0.0', prefix: 8 },
  { ipv4: '100.64.0.0', prefix: 10 },
  { ipv4: '198.18.0.0', prefix: 15 },
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const addr = ipv4ToInt(ip);
  for (const range of PRIVATE_RANGES) {
    const mask = ~((1 << (32 - range.prefix)) - 1);
    if ((addr & mask) === (ipv4ToInt(range.ipv4) & mask)) return true;
  }
  return false;
}

function looksLikeIP(str: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(str);
}

const BLOCKED_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  '100.100.100.200',
  'metadata.google.internal',
  'metadata.cloud.google.internal',
]);

const ALLOWED_SCHEMES = ['https:', 'http:'];

export function validateFetchUrl(raw: string): { valid: true; url: URL } | { valid: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { valid: false, error: 'URL inválida' };
  }

  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    return { valid: false, error: 'Solo se permiten URLs HTTP/HTTPS' };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') {
    return { valid: false, error: 'No se permiten URLs locales' };
  }

  if (BLOCKED_HOSTS.has(hostname)) {
    return { valid: false, error: 'URL no permitida' };
  }

  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { valid: false, error: 'No se permiten URLs de red interna' };
  }

  if (looksLikeIP(hostname) && isPrivateIPv4(hostname)) {
    return { valid: false, error: 'No se permiten URLs de red privada' };
  }

  return { valid: true, url: parsed };
}

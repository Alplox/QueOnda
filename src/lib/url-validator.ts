const MAX_URL_LENGTH = 4096;

const PRIVATE_RANGES = [
  { ipv4: '0.0.0.0', prefix: 8 },
  { ipv4: '10.0.0.0', prefix: 8 },
  { ipv4: '100.64.0.0', prefix: 10 },
  { ipv4: '127.0.0.0', prefix: 8 },
  { ipv4: '169.254.0.0', prefix: 16 },
  { ipv4: '172.16.0.0', prefix: 12 },
  { ipv4: '192.0.0.0', prefix: 24 },
  { ipv4: '192.0.2.0', prefix: 24 },
  { ipv4: '192.168.0.0', prefix: 16 },
  { ipv4: '198.18.0.0', prefix: 15 },
  { ipv4: '198.51.100.0', prefix: 24 },
  { ipv4: '203.0.113.0', prefix: 24 },
  { ipv4: '224.0.0.0', prefix: 4 },
  { ipv4: '240.0.0.0', prefix: 4 },
];

const BLOCKED_HOSTS = new Set([
  '169.254.169.254',
  '100.100.100.200',
  'metadata.google.internal',
  'metadata.cloud.google.internal',
]);

const BLOCKED_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home', '.home.arpa'];
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isIPv4(ip: string): boolean {
  const parts = ip.split('.');
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isPrivateIPv4(ip: string): boolean {
  if (!isIPv4(ip)) return true;
  const addr = ipv4ToInt(ip);
  return PRIVATE_RANGES.some(range => {
    const mask = ~((1 << (32 - range.prefix)) - 1);
    return (addr & mask) === (ipv4ToInt(range.ipv4) & mask);
  });
}

function isPrivateIPv6(rawHostname: string): boolean {
  const hostname = rawHostname.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  if (hostname === '::' || hostname === '::1' || hostname.startsWith('::')) return true;
  if (hostname.startsWith('2001:db8:')) return true;

  const firstGroup = Number.parseInt(hostname.split(':')[0] || '0', 16);
  if (!Number.isFinite(firstGroup)) return true;
  return (
    (firstGroup & 0xfe00) === 0xfc00 || // fc00::/7 — unique local
    (firstGroup & 0xffc0) === 0xfe80 || // fe80::/10 — link local
    (firstGroup & 0xffc0) === 0xfec0 || // fec0::/10 — deprecated site local
    (firstGroup & 0xff00) === 0xff00    // ff00::/8 — multicast
  );
}

export function validateFetchUrl(raw: string): { valid: true; url: URL } | { valid: false; error: string } {
  if (!raw || raw.length > MAX_URL_LENGTH) {
    return { valid: false, error: 'URL inválida o demasiado larga' };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { valid: false, error: 'URL inválida' };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { valid: false, error: 'Solo se permiten URLs HTTP/HTTPS' };
  }
  if (parsed.username || parsed.password) {
    return { valid: false, error: 'No se permiten credenciales en la URL' };
  }

  // URL preserves a final DNS dot; removing it prevents suffix-check bypasses.
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');

  if (BLOCKED_HOSTS.has(hostname)) {
    return { valid: false, error: 'URL no permitida' };
  }
  if (BLOCKED_SUFFIXES.some(suffix => hostname === suffix.slice(1) || hostname.endsWith(suffix))) {
    return { valid: false, error: 'No se permiten URLs de red interna' };
  }

  if (isIPv4(hostname)) {
    if (isPrivateIPv4(hostname)) return { valid: false, error: 'No se permiten URLs de red privada' };
  } else if (hostname.startsWith('[') || hostname.includes(':')) {
    if (isPrivateIPv6(hostname)) return { valid: false, error: 'No se permiten URLs IPv6 privadas' };
  } else if (!hostname.includes('.')) {
    return { valid: false, error: 'No se permiten hosts internos' };
  }

  return { valid: true, url: parsed };
}

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const JSON_PATH = resolve(ROOT, 'src/lib/data-sources.json');
const MD_PATH = resolve(ROOT, 'AGENTS.md');
const README_PATH = resolve(ROOT, 'README.md');

const data = JSON.parse(await readFile(JSON_PATH, 'utf8'));

const roleLabel = {
  primary: 'Primario',
  fallback: 'Respaldo',
  final: 'Final (caché)',
  single: 'Único',
  merge: 'Merge',
};

// ---------- AGENTS.md (referencia corta) ----------
function renderAgents() {
  const lines = [];
  lines.push('## Data Sources & Fallback Chains');
  lines.push('');
  lines.push('> Fuente canónica: `src/lib/data-sources.json` (renderizada en `/creditos`).');
  lines.push('> Esta sección es solo una referencia — no duplica el contenido del JSON.');
  lines.push('> Para consultar la lista completa de fuentes, cadenas de fallback y licencias, leer directamente `src/lib/data-sources.json` (JSON estructurado por grupos).');
  lines.push('> Regenerar `/creditos` y la tabla del `README.md` con `pnpm run sync-credits` si se edita el JSON.');
  lines.push('');
  return lines.join('\n');
}

// ---------- README.md (tabla detallada para usuarios) ----------
function renderReadme() {
  const lines = [];
  lines.push('> Generado automáticamente desde `src/lib/data-sources.json` — no editar a mano. Regenerar con `pnpm run sync-credits`.');
  lines.push('');
  for (const g of data.groups) {
    lines.push(`### ${g.title}`);
    lines.push('');
    lines.push(`*${g.strategy}*`);
    lines.push('');
    lines.push('| Fuente | Rol en la cadena | Detalle / Enlace |');
    lines.push('| ------ | ---------------- | ---------------- |');
    for (const item of g.items) {
      const role = roleLabel[item.role] || item.role;
      const note = item.note ? item.note : '';
      if (Array.isArray(item.links) && item.links.length) {
        for (const l of item.links) {
          lines.push(`| [${l.label}](${l.url}) | ${role} | ${note} |`);
        }
      } else {
        const link = item.url ? `[${item.name}](${item.url})` : item.name;
        lines.push(`| ${link} | ${role} | ${note} |`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ---------- Update AGENTS.md ----------
{
  const md = await readFile(MD_PATH, 'utf8');
  const header = '## Data Sources & Fallback Chains';
  const headerIdx = md.indexOf(header);
  if (headerIdx === -1) throw new Error('header not found in AGENTS.md');
  const nextHeaderIdx = md.indexOf('\n## ', headerIdx + 1);
  const before = md.slice(0, headerIdx);
  const after = nextHeaderIdx === -1 ? '' : md.slice(nextHeaderIdx);
  const block = renderAgents();
  await writeFile(MD_PATH, before + block + '\n' + after, 'utf8');
  console.log('AGENTS.md updated');
}

// ---------- Update README.md ----------
{
  const md = await readFile(README_PATH, 'utf8');
  const startMarker = '<!-- data-sources:start -->';
  const endMarker = '<!-- data-sources:end -->';
  const startIdx = md.indexOf(startMarker);
  const endIdx = md.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) throw new Error('markers not found in README.md');
  const before = md.slice(0, startIdx + startMarker.length);
  const after = md.slice(endIdx);
  const block = '\n' + renderReadme() + '\n';
  await writeFile(README_PATH, before + block + after, 'utf8');
  console.log('README.md updated');
}

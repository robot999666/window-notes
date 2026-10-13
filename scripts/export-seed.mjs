import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve('src/content/notes');
const entries = [];
for (const name of (await readdir(root)).filter(name => name.endsWith('.md')).sort()) {
  const text = await readFile(join(root, name), 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`Missing frontmatter: ${name}`);
  const item = { slug: name.slice(0, -3), markdown: match[2].trim() };
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z]+):\s*(.+)$/);
    if (!field) continue;
    item[field[1]] = JSON.parse(field[2]);
  }
  if (!item.source?.startsWith('https://github.com/robot999666/')) throw new Error(`Nonpublic seed source: ${name}`);
  entries.push(item);
}
await mkdir(resolve('backend'), { recursive: true });
await writeFile(resolve('backend/seed.json'), JSON.stringify(entries, null, 2) + '\n', 'utf8');
console.log(`Exported ${entries.length} publicly sourced notes for first-time database initialization.`);

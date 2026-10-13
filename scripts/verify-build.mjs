import { readdir, readFile, access, stat } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('dist');
const files = [];
async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) await walk(full); else files.push(full);
  }
}
await walk(root);
const search = JSON.parse(await readFile(join(root, 'search.json'), 'utf8'));
assert(search.length >= 6, 'Expected six substantive project notes.');
for (const note of search) {
  assert(note.source.startsWith('https://github.com/robot999666/'), 'Each note requires a public source.');
  await access(join(root, 'notes', note.slug, 'index.html'));
}
let links = 0;
for (const file of files) {
  assert(!/\.(pem|key|p12|pfx)$/i.test(file), 'Credential file is forbidden.');
  if (!['.html', '.js', '.json', '.css', '.xml'].includes(extname(file))) continue;
  const text = await readFile(file, 'utf8');
  assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text), 'Private key content is forbidden.');
  if (!file.endsWith('.html')) continue;
  assert(/<html[^>]+lang="zh-CN"/.test(text), 'Pages must declare Chinese language.');
  assert(/<meta[^>]+name="description"/.test(text), 'Pages require a description.');
  for (const match of text.matchAll(/(?:href|src)="(\/(?!\/)[^"?#]*)/g)) {
    const path = decodeURIComponent(match[1]);
    const target = join(root, path);
    assert(target.startsWith(root), 'Link escaped build directory.');
    const info = await stat(target).catch(() => null);
    assert(info, `Broken link in ${file}: ${path}`);
    if (info.isDirectory()) await access(join(target, 'index.html'));
    links++;
  }
}
for (const name of ['404.html', 'rss.xml', 'sitemap.xml', 'robots.txt', 'favicon.svg']) await access(join(root, name));
console.log(`Verified ${search.length} notes, ${links} local links and ${files.length} build files; no credential files or key content.`);

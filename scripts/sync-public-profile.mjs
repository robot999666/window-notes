import { mkdir, writeFile } from 'node:fs/promises';

const login = 'robot999666';
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'window-notes-public-sync' };
async function readPublic(path) {
  const response = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Public GitHub API: ${response.status}`);
  return response.json();
}
const profile = await readPublic(`/users/${login}`);
const allRepos = [];
for (let page = 1; page <= 10; page++) {
  const batch = await readPublic(`/users/${login}/repos?type=owner&per_page=100&page=${page}&sort=updated`);
  allRepos.push(...batch);
  if (batch.length < 100) break;
}
const snapshot = {
  fetchedAt: new Date().toISOString(),
  profile: { login: profile.login, bio: profile.bio, avatarUrl: profile.avatar_url, url: profile.html_url, repoCount: profile.public_repos },
  repos: allRepos.filter(repo => repo.private === false && repo.owner.login === login).map(repo => ({
    name: repo.name, description: repo.description || '', language: repo.language || 'Markdown', url: repo.html_url,
    updatedAt: repo.updated_at.slice(0, 10), fork: repo.fork, stars: repo.stargazers_count,
  })),
};
await mkdir(new URL('../src/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../src/data/github.json', import.meta.url), `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Saved ${snapshot.repos.length} public repositories for ${login}; no credentials used.`);

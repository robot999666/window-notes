import { notes } from '../data/site';
const escapeXml = (text: string) => text.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!);
export function GET({ site }: { site: URL }) {
  const items = notes.map(note => `<item><title>${escapeXml(note.title)}</title><link>${new URL(`/notes/${note.slug}/`, site)}</link><guid>${new URL(`/notes/${note.slug}/`, site)}</guid><description>${escapeXml(note.description)}</description><pubDate>${new Date(`${note.date}T00:00:00+08:00`).toUTCString()}</pubDate><category>${escapeXml(note.category)}</category></item>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>窗边手记 · robot999666</title><link>${site}</link><description>代码、探索与慢慢积累的日常。</description><language>zh-CN</language>${items}</channel></rss>`, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}

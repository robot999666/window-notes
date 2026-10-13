type Post = { id: number; slug: string; title: string; description: string; category: string; tags: string[]; date: string; updatedAt: string; readingTime: string; url: string; author: string };
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, value?: string) => { const node = document.createElement(tag); node.className = cls; if (value) node.textContent = value; return node; };
function toast(message: string) { document.querySelector('.community-toast')?.remove(); const node = el('p', 'community-toast', message); node.setAttribute('role', 'status'); document.body.append(node); setTimeout(() => node.remove(), 3500); }
function dateLabel(value: string) { if (!value) return ''; const date = new Date(value); if (Number.isNaN(date.getTime())) return value.slice(0, 10); return new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date).replaceAll('/', '.'); }
function applyFilter() {
  const query = new URLSearchParams(location.search); const active = document.querySelector<HTMLElement>('[data-filter].active');
  const category = active?.dataset.filter || query.get('category') || 'all'; const tag = !active && query.get('tag');
  const nodes = document.querySelectorAll<HTMLElement>('[data-note]');
  nodes.forEach(node => { node.hidden = tag ? !(node.dataset.tags || '').split('|').includes(tag) : category !== 'all' && node.dataset.category !== category; });
  const empty = document.getElementById('filter-empty'); if (empty) empty.hidden = Array.from(nodes).some(node => !node.hidden);
}
async function refreshPosts() {
  const list = document.querySelector('.notes-grid, .notes-list, .note-grid, .archive-list'); if (!list) return;
  try {
    const response = await fetch('/api/posts', { headers: { Accept: 'application/json' } }); if (!response.ok) return;
    const data = await response.json(); if (!Array.isArray(data.posts)) return;
    const archive = list.classList.contains('archive-list'); const fragment = document.createDocumentFragment();
    data.posts.forEach((post: Post) => {
      const card = el(archive ? 'a' : 'article', archive ? 'archive-note' : 'note-card');
      card.dataset.note = ''; card.dataset.category = post.category; card.dataset.tags = post.tags.join('|'); card.dataset.postId = String(post.id);
      if (card instanceof HTMLAnchorElement) card.href = post.url;
      const meta = el('div', 'note-meta'); const time = el('time', '', dateLabel(post.updatedAt || post.date)); time.dateTime = post.updatedAt || post.date;
      const category = el('span', 'category-label', post.category); category.classList.toggle('category-ai', post.category === 'AI 与研究'); category.classList.toggle('category-learning', post.category === '学习记录');
      meta.append(category, time); card.append(meta);
      const link = archive ? card : el('a', 'note-link'); if (link instanceof HTMLAnchorElement) link.href = post.url;
      link.append(el(archive ? 'h2' : 'h3', '', post.title), el('p', '', post.description)); if (!archive) card.append(link);
      const bottom = el('div', 'note-bottom'); const tags = el('div', archive ? 'tag-list' : 'note-tags'); post.tags.slice(0, archive ? 10 : 3).forEach(tag => tags.append(el('span', '', tag))); bottom.append(tags, el('span', 'reading-time', `${post.readingTime}阅读`)); card.append(bottom);
      fragment.append(card);
    });
    list.replaceChildren(fragment); const count = document.querySelector('.hero-stats span:first-child strong'); if (count) count.textContent = String(data.posts.length);
    document.querySelectorAll<HTMLElement>('[data-category-count]').forEach(node => { node.textContent = String(data.posts.filter((post: Post) => post.category === node.dataset.categoryCount).length); });
    applyFilter(); document.dispatchEvent(new CustomEvent('posts-updated', { detail: data.posts }));
  } catch { /* Static seeded notes remain readable when the API is unavailable. */ }
}
void refreshPosts();
if (document.querySelector('.member-entry') && !document.querySelector('[data-account-page], [data-workspace-page]')) fetch('/api/session').then(response => response.ok ? response.json() : null).then(session => {
  const entry = document.querySelector<HTMLAnchorElement>('.member-entry');
  if (entry && session?.user) { entry.textContent = session.user.role === 'admin' ? '管理写作间' : session.user.displayName; entry.href = '/workspace/'; }
}).catch(() => {});

const article = document.querySelector<HTMLElement>('[data-public-article]');
if (article) {
  const progress = el('div', 'article-progress'); progress.setAttribute('aria-hidden', 'true'); document.body.append(progress);
  const updateProgress = () => { const end = article.offsetTop + article.offsetHeight - innerHeight; progress.style.width = `${Math.min(100, Math.max(0, scrollY / Math.max(1, end) * 100))}%`; };
  addEventListener('scroll', updateProgress, { passive: true }); addEventListener('resize', updateProgress); updateProgress();
  const tools = el('div', 'reader-tools'); const bookmark = el('button', '', '♡ 放进阅读口袋'); bookmark.type = 'button'; bookmark.dataset.readerBookmark = ''; bookmark.dataset.title = article.dataset.title; bookmark.dataset.url = location.pathname;
  const share = el('button', '', '↗ 分享这篇手记'); share.type = 'button';
  share.addEventListener('click', async () => { try { if (navigator.share) await navigator.share({ title: article.dataset.title, url: location.href }); else { await navigator.clipboard.writeText(location.href); toast('文章链接已复制。'); } } catch { toast('可复制地址栏链接分享这篇手记。'); } });
  const makeCard = el('button', '', '✦ 留一张阅读小卡'); makeCard.type = 'button'; makeCard.addEventListener('click', () => openReadingCard(article.dataset.title || '窗边手记', article.dataset.description || '给好奇心留一点光。'));
  tools.append(bookmark, makeCard, share); article.append(tools);
  bookmark.addEventListener('click', () => {
    try {
      const key = 'window-garden-pocket'; let saved = JSON.parse(localStorage.getItem(key) || '[]'); if (!Array.isArray(saved)) saved = [];
      const found = saved.some((item: {url: string}) => item.url === location.pathname);
      saved = found ? saved.filter((item: {url: string}) => item.url !== location.pathname) : [...saved.slice(-99), {title: article.dataset.title, url: location.pathname, description: article.dataset.description || ''}];
      localStorage.setItem(key, JSON.stringify(saved)); document.dispatchEvent(new Event('pocket-updated')); bookmark.textContent = found ? '♡ 放进阅读口袋' : '♥ 已放进阅读口袋'; bookmark.setAttribute('aria-pressed', String(!found)); toast(found ? '已从阅读口袋取出。' : '已收好，下次从首页阅读口袋继续。');
    } catch { toast('浏览器暂时无法保存书签。'); }
  });
  try { const saved = JSON.parse(localStorage.getItem('window-garden-pocket') || '[]'); if (saved.some((item: {url: string}) => item.url === location.pathname)) { bookmark.textContent = '♥ 已放进阅读口袋'; bookmark.setAttribute('aria-pressed', 'true'); } } catch { /* Optional local state. */ }
}
function openReadingCard(title: string, description: string) {
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800; const ctx = canvas.getContext('2d'); if (!ctx) return;
  const gradient = ctx.createLinearGradient(0, 0, 1200, 800); gradient.addColorStop(0, '#102b33'); gradient.addColorStop(1, '#1a453e'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1200, 800);
  ctx.fillStyle = '#ffe7ad'; ctx.beginPath(); ctx.arc(1015, 145, 53, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#102b33'; ctx.beginPath(); ctx.arc(1036, 125, 51, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#a9ddc4'; ctx.font = '26px sans-serif'; ctx.fillText('WINDOW NOTES  /  阅读留影', 85, 115);
  function lines(text: string, size: number, color: string, y: number, limit: number) { ctx!.font = `${size}px sans-serif`; ctx!.fillStyle = color; let line = ''; let rows = 0; for (const char of text) { if (ctx!.measureText(line + char).width > 1010) { ctx!.fillText(line, 85, y); y += size * 1.6; line = ''; if (++rows >= limit) return y; } line += char; } if (line) { ctx!.fillText(line, 85, y); y += size * 1.6; } return y; }
  const end = lines(title, 52, '#f0f6ee', 240, 3); lines(description, 29, '#c9dfd4', end + 45, 3);
  ctx.strokeStyle = '#719e87'; ctx.beginPath(); ctx.moveTo(85, 658); ctx.lineTo(1115, 658); ctx.stroke(); ctx.font = '25px sans-serif'; ctx.fillStyle = '#bcd5c7'; ctx.fillText('窗边手记 · robot999666', 85, 720); ctx.font = '23px sans-serif'; ctx.fillText('给好奇心留一点光。', 850, 720);
  const data = canvas.toDataURL('image/png'); const dialog = el('dialog', 'card-dialog'); dialog.setAttribute('aria-label', '阅读小卡预览'); dialog.append(el('h2', '', '把这一页的心情带走')); const img = el('img', ''); img.src = data; img.alt = `${title} 阅读小卡`; dialog.append(img);
  const footer = el('footer', ''); const save = el('button', '', '下载小卡'); save.type = 'button'; save.addEventListener('click', () => { const link = el('a', ''); link.href = data; link.download = '窗边手记-阅读小卡.png'; link.click(); }); const close = el('button', '', '收起来'); close.type = 'button'; close.addEventListener('click', () => dialog.close()); footer.append(save, close); dialog.append(footer); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove()); dialog.showModal();
}

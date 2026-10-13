type Note = { slug: string; title: string; description: string; category: string; tags: string[] };
const themeButtons = document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]');
function updateThemeButtons() {
  const dark = document.documentElement.dataset.theme === 'dark';
  themeButtons.forEach(button => {
    button.setAttribute('aria-label', dark ? '切换为浅色主题' : '切换为深色主题');
    button.setAttribute('aria-pressed', String(dark));
  });
}
updateThemeButtons();
themeButtons.forEach(button => button.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('theme', theme); } catch { /* Browser storage is optional. */ }
  updateThemeButtons();
}));

document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(button => {
  button.addEventListener('click', () => {
    const category = button.dataset.filter;
    document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    let visible = 0;
    document.querySelectorAll<HTMLElement>('[data-note]').forEach(note => {
      note.hidden = category !== 'all' && note.dataset.category !== category;
      if (!note.hidden) visible++;
    });
    const empty = document.getElementById('filter-empty');
    if (empty) empty.hidden = visible > 0;
  });
});

const dialog = document.querySelector<HTMLDialogElement>('#search-dialog');
const input = document.querySelector<HTMLInputElement>('#search-input');
const results = document.getElementById('search-results');
let cachedNotes: Note[] | undefined;
let request: Promise<Note[]> | undefined;
let searchVersion = 0;
let previousFocus: HTMLElement | null = null;
function showMessage(message: string) {
  if (!results) return;
  results.replaceChildren();
  const paragraph = document.createElement('p');
  paragraph.className = 'search-empty';
  paragraph.textContent = message;
  results.append(paragraph);
}
async function renderSearch() {
  if (!results || !input) return;
  const version = ++searchVersion;
  const query = input.value.trim().toLocaleLowerCase();
  try {
    if (!cachedNotes) {
      showMessage('正在翻开手记…');
      request ??= fetch('/search.json').then(response => {
        if (!response.ok) throw new Error('Search index unavailable');
        return response.json();
      }).catch(error => { request = undefined; throw error; });
      cachedNotes = await request;
    }
    if (version !== searchVersion) return;
    const matches = cachedNotes!.filter(note => !query || `${note.title} ${note.description} ${note.category} ${note.tags.join(' ')}`.toLocaleLowerCase().includes(query));
    results.replaceChildren();
    if (!matches.length) return showMessage('还没有找到这篇手记，换个词试试吧。');
    matches.forEach(note => {
      const link = document.createElement('a');
      link.className = 'search-result';
      link.dataset.searchResult = '';
      link.href = `/notes/${encodeURIComponent(note.slug)}/`;
      const title = document.createElement('strong');
      title.textContent = note.title;
      const detail = document.createElement('span');
      detail.textContent = `${note.category} · ${note.description}`;
      link.append(title, detail);
      results.append(link);
    });
  } catch { if (version === searchVersion) showMessage('手记暂时没能加载。请关闭后重新打开，或到「全部手记」阅读。'); }
}
function openSearch() {
  if (!dialog || !input || dialog.open) return;
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.showModal();
  input.value = '';
  input.focus();
  void renderSearch();
}
document.querySelectorAll('[data-search-open]').forEach(button => button.addEventListener('click', openSearch));
document.querySelectorAll('[data-search-close]').forEach(button => button.addEventListener('click', () => dialog?.close()));
input?.addEventListener('input', () => void renderSearch());
dialog?.addEventListener('close', () => previousFocus?.focus());
dialog?.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && dialog?.open) {
    event.preventDefault(); dialog.close(); return;
  }
  const typing = event.target instanceof HTMLElement && (event.target.matches('input, textarea, select') || event.target.isContentEditable);
  if ((event.key === '/' && !typing) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
    event.preventDefault(); openSearch();
  }
});

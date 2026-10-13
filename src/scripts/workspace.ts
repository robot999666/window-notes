type Member = { id: number; username: string; displayName: string; role: string };
type Session = { user: Member | null; csrfToken: string };
type Post = { id: number; revision: number; slug: string; title: string; description: string; category: string; tags: string[]; date: string; updatedAt: string; readingTime?: string; url?: string; author: string | { id?: number; displayName?: string; username?: string }; markdown: string; status: string; feedback?: string; isLive?: boolean; ownerId?: number };

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

const accountPage = document.querySelector('[data-account-page]');
const workspacePage = document.querySelector('[data-workspace-page]');
if (accountPage || workspacePage) {
  let session: Session = { user: null, csrfToken: '' };
  let busy = false;
  let dirty = false;
  let posts: Post[] = [];
  let current: Post | null = null;
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const secureTransport = location.protocol === 'https:' || localHost;
  const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
  const input = (id: string) => el<HTMLInputElement>(id);
  const status = (message: string, error = false) => {
    const node = el(accountPage ? 'account-status' : 'workspace-status');
    node.textContent = message;
    node.dataset.error = String(error);
    node.setAttribute('role', error ? 'alert' : 'status');
  };
  const visibility = (id: string, show: boolean) => { const node = document.getElementById(id); if (node) node.hidden = !show; };
  const setBusy = (value: boolean) => {
    busy = value;
    document.querySelectorAll<HTMLButtonElement>('form button[type=submit], #logout-button, #approve-post-button, #reject-post-button, #unpublish-post-button, #delete-post-button, #new-post-button').forEach(button => button.disabled = value || !secureTransport || !session.csrfToken);
    (accountPage || workspacePage)?.setAttribute('aria-busy', String(value));
  };
  async function api<T = Record<string, unknown>>(path: string, method = 'GET', payload?: unknown): Promise<T> {
    if (method !== 'GET' && !secureTransport) throw new Error('请先打开 HTTPS 安全连接，再操作账户和文章。');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (method !== 'GET') {
      if (!session.csrfToken) throw new Error('登录状态尚未准备好，请刷新页面后重试。');
      headers['X-CSRF-Token'] = session.csrfToken;
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(path, { method, headers, credentials: 'same-origin', body: payload === undefined ? undefined : JSON.stringify(payload) });
    const json = await response.json().catch(() => ({ error: '服务暂时没有返回可用数据，请稍后重试。' }));
    if (!response.ok) throw new ApiError(json.error || `操作未完成（${response.status}），请稍后重试。`, response.status);
    if (json.csrfToken) session.csrfToken = json.csrfToken;
    return json as T;
  }
  const errorText = (error: unknown) => error instanceof Error ? error.message : '暂时无法完成操作，请稍后重试。';
  function transportNotice() {
    if (secureTransport) return;
    visibility('transport-notice', true);
    const url = new URL(location.href); url.protocol = 'https:';
    el<HTMLAnchorElement>('secure-account-link').href = url.href;
    setBusy(false);
  }
  function updateAccount() {
    visibility('signed-out-panel', !session.user);
    visibility('signed-in-panel', !!session.user);
    if (session.user) {
      el('account-greeting').textContent = `${session.user.displayName || session.user.username}，欢迎回来。`;
      el('account-identity').textContent = `@${session.user.username}`;
      el('account-role').textContent = session.user.role === 'admin' ? '管理员' : '手记作者';
    }
  }
  function activateTab(name: string) {
    document.querySelectorAll<HTMLButtonElement>('[data-account-tab]').forEach(button => {
      const active = button.dataset.accountTab === name;
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    });
    visibility('login-panel', name === 'login'); visibility('register-panel', name === 'register');
    status('');
  }
  if (accountPage) {
    document.querySelectorAll<HTMLButtonElement>('[data-account-tab]').forEach(button => {
      button.addEventListener('click', () => activateTab(button.dataset.accountTab || 'login'));
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const name = event.key === 'Home' ? 'login' : event.key === 'End' ? 'register' : button.dataset.accountTab === 'login' ? 'register' : 'login';
        activateTab(name); el<HTMLButtonElement>(`${name}-tab`).focus();
      });
    });
    document.querySelectorAll<HTMLButtonElement>('[data-password-toggle]').forEach(button => button.addEventListener('click', () => {
      const field = input(button.dataset.passwordToggle!); const show = field.type === 'password';
      field.type = show ? 'text' : 'password'; button.textContent = show ? '隐藏' : '显示';
      button.setAttribute('aria-label', show ? '隐藏密码' : '显示密码'); button.setAttribute('aria-pressed', String(show));
    }));
    input('register-password').addEventListener('input', () => {
      const password = input('register-password').value;
      const strength = el('password-strength');
      const longEnough = password.length >= 12;
      const strong = password.length >= 18 || (longEnough && [/[a-z]/i, /[0-9]/, /[^a-z0-9]/i].every(pattern => pattern.test(password)));
      strength.style.setProperty('--strength', `${password.length ? strong ? 100 : longEnough ? 70 : Math.min(45, password.length * 4) : 0}%`);
      strength.querySelector('small')!.textContent = !password.length ? '还没有输入密码' : !longEnough ? `还差 ${12 - password.length} 个字符` : strong ? '长度不错，记得使用独一无二的密码' : '已达到最低长度，增加长度会更稳妥';
      input('register-confirm').setCustomValidity('');
    });
    input('register-confirm').addEventListener('input', () => input('register-confirm').setCustomValidity(''));
    el<HTMLFormElement>('login-form').addEventListener('submit', async event => {
      event.preventDefault(); if (busy) return;
      setBusy(true); status('正在登录…');
      try {
        session = await api<Session>('/api/auth/login', 'POST', { username: input('login-username').value.trim(), password: input('login-password').value });
        input('login-password').value = ''; updateAccount(); status('登录成功，可以打开写作台了。');
      } catch (error) { status(errorText(error), true); } finally { setBusy(false); }
    });
    el<HTMLFormElement>('register-form').addEventListener('submit', async event => {
      event.preventDefault(); if (busy) return;
      if (input('register-password').value !== input('register-confirm').value) {
        input('register-confirm').setCustomValidity('两次输入的密码不一致。'); input('register-confirm').reportValidity(); return;
      }
      setBusy(true); status('正在创建账户…');
      try {
        session = await api<Session>('/api/auth/register', 'POST', { username: input('register-username').value.trim(), displayName: input('register-display-name').value.trim(), password: input('register-password').value });
        input('register-password').value = ''; input('register-confirm').value = ''; updateAccount();
        status(session.user ? '账户已创建。可以保存草稿与提交手记了。' : '账户已创建，请使用用户名和密码登录。');
        if (!session.user) activateTab('login');
      } catch (error) { status(errorText(error), true); } finally { setBusy(false); }
    });
    el<HTMLButtonElement>('logout-button').addEventListener('click', async () => {
      if (busy) return; setBusy(true);
      try { session = await api<Session>('/api/auth/logout', 'POST', {}); updateAccount(); activateTab('login'); status('已退出登录，下次再来继续写。'); }
      catch (error) { status(errorText(error), true); } finally { setBusy(false); }
    });
    el<HTMLFormElement>('change-password-form').addEventListener('submit', async event => {
      event.preventDefault(); if (busy) return; setBusy(true); status('正在更新密码…');
      try {
        const result = await api<Partial<Session>>('/api/auth/change-password', 'POST', { currentPassword: input('current-password').value, password: input('new-password').value });
        if ('user' in result) session.user = result.user || null;
        input('current-password').value = ''; input('new-password').value = ''; updateAccount(); status('密码已更新。请使用新密码登录其他设备。');
      } catch (error) { status(errorText(error), true); } finally { setBusy(false); }
    });
  }

  const statuses: Record<string, string> = { draft: '草稿', pending: '等待审核', published: '已发布', rejected: '需要修改' };
  const isAdmin = () => session.user?.role === 'admin';
  const authorName = (post: Post) => typeof post.author === 'string' ? post.author : post.author?.displayName || post.author?.username || '作者';
  const prettyDate = (value: string) => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }).format(date);
  };
  function confirmDiscard(): boolean {
    return !dirty || window.confirm('这一页还有尚未保存的修改。确定离开并放弃这些修改吗？');
  }
  function wordCount() {
    const value = el<HTMLTextAreaElement>('post-markdown').value;
    el('editor-word-count').textContent = `${value.replace(/\s/g, '').length.toLocaleString('zh-CN')} 字`;
  }
  function markDirty() { dirty = true; el('editor-state').textContent = '有尚未保存的修改 · 记得保存草稿'; wordCount(); }
  function renderList() {
    const filter = el<HTMLSelectElement>('post-filter').value;
    const filtered = posts.filter(post => filter === 'all' || post.status === filter);
    const list = el('workspace-post-list'); list.replaceChildren();
    el('post-list-count').textContent = `${filtered.length} 篇${filter === 'all' ? '手记' : statuses[filter] || '手记'}`;
    if (!filtered.length) { const empty = document.createElement('p'); empty.className = 'field-note'; empty.textContent = '这里暂时没有手记。点击「新建」，写下第一段。'; list.append(empty); }
    filtered.forEach(post => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'workspace-post-button';
      button.setAttribute('aria-current', String(current?.id === post.id)); button.dataset.postId = String(post.id);
      const title = document.createElement('strong'); title.textContent = post.title || '未命名手记';
      const badge = document.createElement('span'); badge.className = 'post-status-badge'; badge.dataset.status = post.status; badge.textContent = statuses[post.status] || post.status;
      const meta = document.createElement('small'); meta.textContent = `${isAdmin() ? `${authorName(post)} · ` : ''}${prettyDate(post.updatedAt || post.date)}`;
      button.append(title, badge, meta); button.addEventListener('click', () => { if (!busy && confirmDiscard()) openPost(post); }); list.append(button);
    });
  }
  function writeView() {
    visibility('post-markdown', true); visibility('markdown-toolbar', true); visibility('markdown-preview', false);
    el('write-view-button').setAttribute('aria-pressed', 'true'); el('preview-button').setAttribute('aria-pressed', 'false');
  }
  function openPost(post: Post | null) {
    current = post; dirty = false;
    el<HTMLFormElement>('editor-form').reset();
    input('post-title').value = post?.title || '';
    el<HTMLTextAreaElement>('post-description').value = post?.description || '';
    el<HTMLSelectElement>('post-category').value = post?.category || '学习记录';
    if (!el<HTMLSelectElement>('post-category').value) el<HTMLSelectElement>('post-category').value = '学习记录';
    input('post-tags').value = post?.tags?.join(', ') || '';
    el<HTMLTextAreaElement>('post-markdown').value = post?.markdown || '';
    el('editor-heading').textContent = post ? '继续写这一页' : '新的一页';
    el('editor-state').textContent = post ? `${statuses[post.status] || post.status}${post.updatedAt ? ` · 最近保存 ${prettyDate(post.updatedAt)}` : ''}` : '填写标题和正文，保存你的第一篇草稿。';
    visibility('review-feedback', !!post?.feedback); el('review-feedback-text').textContent = post?.feedback || '';
    visibility('delete-post-button', !!post);
    visibility('moderation-panel', isAdmin() && post?.status === 'pending');
    visibility('unpublish-panel', isAdmin() && (post?.status === 'published' || !!post?.isLive));
    el<HTMLTextAreaElement>('moderation-feedback').value = '';
    visibility('editor-public-link', !!post?.url && (post.status === 'published' || !!post.isLive));
    if (post?.url) {
      try { const url = new URL(post.url, location.origin); el<HTMLAnchorElement>('editor-public-link').href = url.origin === location.origin ? url.pathname : '/notes/'; }
      catch { el<HTMLAnchorElement>('editor-public-link').href = '/notes/'; }
    }
    el('publish-guidance').textContent = isAdmin() ? '保存草稿不会更新公开版本。点击「发布文章」后，内容才会公开。用户投稿也可以在下方审核。' : post?.status === 'published' || post?.isLive ? '修改文章需要重新审核。提交后，读者仍会看到上一次通过审核的版本，直到新版本获准发布。' : '草稿只有你能看到。提交后等待管理员审核，通过后会出现在公共博客。';
    el('submit-post-button').textContent = post?.status === 'rejected' ? '修改后重新提交 →' : post?.status === 'published' || post?.isLive ? '提交修改供审核 →' : '提交审核 →';
    el('publish-post-button').textContent = post?.status === 'published' || post?.isLive ? '发布更新 →' : '发布文章 →';
    writeView(); wordCount(); renderList();
  }
  async function refreshPosts(selectId?: number, preserve = false) {
    const result = await api<{ posts: Post[] }>('/api/workspace/posts');
    posts = Array.isArray(result.posts) ? result.posts : [];
    if (isAdmin()) {
      const queue = await api<{ posts: Post[] }>('/api/admin/queue');
      const byId = new Map(posts.map(post => [post.id, post]));
      for (const post of queue.posts || []) byId.set(post.id, post);
      posts = [...byId.values()];
    }
    posts.sort((a, b) => (b.updatedAt || b.date || '').localeCompare(a.updatedAt || a.date || ''));
    if (preserve) { renderList(); return; }
    openPost(selectId === undefined ? current ? posts.find(post => post.id === current!.id) || null : null : posts.find(post => post.id === selectId) || null);
  }
  function editorPayload(action: string) {
    const tags = input('post-tags').value.split(/[,，]/).map(tag => tag.trim().replace(/^#/, '')).filter(Boolean);
    if (tags.length > 8) throw new Error('标签最多 8 个，请删去几个后重试。');
    return { title: input('post-title').value.trim(), description: el<HTMLTextAreaElement>('post-description').value.trim(), category: el<HTMLSelectElement>('post-category').value, tags: [...new Set(tags)], markdown: el<HTMLTextAreaElement>('post-markdown').value, action, ...(current ? { expectedRevision: current.revision } : {}) };
  }
  async function savePost(action: string) {
    if (busy) return;
    const form = el<HTMLFormElement>('editor-form');
    if (!form.reportValidity()) return;
    let payload;
    try { payload = editorPayload(action); } catch (error) { status(errorText(error), true); return; }
    setBusy(true); status(action === 'publish' ? '正在发布文章…' : action === 'submit' ? '正在提交审核…' : '正在保存草稿…');
    try {
      const result = await api<{ post?: Post; id?: number }>('/api/workspace/posts' + (current ? `/${current.id}` : ''), current ? 'PUT' : 'POST', payload);
      const id = result.post?.id || result.id || current?.id;
      dirty = false;
      await refreshPosts(id);
      status(action === 'publish' ? '文章已发布，可以在博客中阅读。' : action === 'submit' ? '已提交，正在等待管理员审核。' : '草稿已保存，随时可以继续写。');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await refreshPosts(undefined, true).catch(() => {});
        status('服务端文章已有新版本。本页文字已保留，请复制未保存的内容，再重新打开文章查看更新。', true);
      } else status(errorText(error), true);
    } finally { setBusy(false); }
  }
  async function review(action: string) {
    if (!current || busy) return;
    if (dirty) { status('本页有尚未保存的修改。请先发布保存，或重新打开投稿后审核原稿。', true); return; }
    const feedback = el<HTMLTextAreaElement>('moderation-feedback').value.trim();
    if (action === 'reject' && !feedback) { status('请写一点具体的修改建议，再退回给作者。', true); el('moderation-feedback').focus(); return; }
    if (action === 'unpublish' && !window.confirm('确定撤下这篇公开文章吗？内容会保留在写作台。')) return;
    const id = current.id; setBusy(true); status('正在处理文章…');
    try {
      await api(`/api/admin/posts/${id}/review`, 'POST', { action, feedback, expectedRevision: current.revision });
      await refreshPosts(id);
      status(action === 'approve' ? '审核通过，文章已经公开。' : action === 'reject' ? '已退回修改，作者可以在写作台看到反馈。' : '文章已撤下，内容仍保留在写作台。');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await refreshPosts(id).catch(() => {});
        status('这篇文章在打开后有了新的修改。已重新加载，请完整阅读最新版本后再审核。', true);
      } else status(errorText(error), true);
    } finally { setBusy(false); }
  }
  if (workspacePage) {
    window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
    document.querySelectorAll<HTMLAnchorElement>('.member-nav a, #editor-public-link').forEach(link => link.addEventListener('click', event => {
      if (!confirmDiscard()) event.preventDefault();
      else dirty = false;
    }));
    el<HTMLButtonElement>('new-post-button').addEventListener('click', () => { if (!busy && confirmDiscard()) { openPost(null); input('post-title').focus(); status('新的一页，开始写吧。'); } });
    el<HTMLSelectElement>('post-filter').addEventListener('change', renderList);
    el<HTMLFormElement>('editor-form').addEventListener('input', markDirty);
    el<HTMLFormElement>('editor-form').addEventListener('change', markDirty);
    el<HTMLFormElement>('editor-form').addEventListener('submit', event => {
      event.preventDefault(); const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
      void savePost(submitter?.dataset.editorAction || 'draft');
    });
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && session.user) { event.preventDefault(); void savePost('draft'); }
    });
    el('write-view-button').addEventListener('click', writeView);
    el<HTMLButtonElement>('preview-button').addEventListener('click', async () => {
      if (busy) return;
      const button = el<HTMLButtonElement>('preview-button'); button.disabled = true;
      try {
        const result = await api<{ html: string }>('/api/preview', 'POST', { markdown: el<HTMLTextAreaElement>('post-markdown').value });
        // This HTML is produced by the backend's Markdown sanitizer, never by user input directly.
        el('markdown-preview').innerHTML = result.html || '<p>这一页还没有文字。</p>';
        visibility('post-markdown', false); visibility('markdown-toolbar', false); visibility('markdown-preview', true);
        el('write-view-button').setAttribute('aria-pressed', 'false'); button.setAttribute('aria-pressed', 'true');
      } catch (error) { status(errorText(error), true); } finally { button.disabled = false; }
    });
    document.querySelectorAll<HTMLButtonElement>('[data-format]').forEach(button => button.addEventListener('click', () => {
      const field = el<HTMLTextAreaElement>('post-markdown'); const start = field.selectionStart; const end = field.selectionEnd; const selected = field.value.slice(start, end);
      const formats: Record<string, [string, string, string]> = { heading: ['\n## ', '\n', '小标题'], bold: ['**', '**', '加粗文字'], italic: ['*', '*', '斜体文字'], link: ['[', '](https://example.com)', '链接文字'], quote: ['\n> ', '\n', '引用文字'], list: ['\n- ', '\n', '列表项'], code: ['\n```\n', '\n```\n', '代码'] };
      const [prefix, suffix, placeholder] = formats[button.dataset.format!] || formats.bold;
      const value = selected || placeholder; field.setRangeText(prefix + value + suffix, start, end, 'end'); field.focus(); field.setSelectionRange(start + prefix.length, start + prefix.length + value.length); markDirty();
    }));
    el('approve-post-button').addEventListener('click', () => void review('approve'));
    el('reject-post-button').addEventListener('click', () => void review('reject'));
    el('unpublish-post-button').addEventListener('click', () => void review('unpublish'));
    el('delete-post-button').addEventListener('click', async () => {
      if (!current || busy || !window.confirm(`确定删除「${current.title}」吗？删除后无法恢复。`)) return;
      const id = current.id; setBusy(true);
      try { await api(`/api/workspace/posts/${id}`, 'DELETE', { expectedRevision: current.revision }); dirty = false; current = null; await refreshPosts(); status('文章已删除。'); }
      catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          await refreshPosts(undefined, true).catch(() => {});
          status('文章已有新的修改，尚未删除。请重新打开最新版本，确认内容后再操作。', true);
        } else status(errorText(error), true);
      } finally { setBusy(false); }
    });
  }
  async function init() {
    transportNotice();
    try {
      session = await api<Session>('/api/session');
      if (accountPage) { updateAccount(); status(session.user ? '你已登录。' : secureTransport ? '' : '请使用上方的 HTTPS 链接登录。'); }
      if (workspacePage) {
        visibility('workspace-auth-notice', !session.user);
        if (session.user) {
          el('workspace-greeting').textContent = `${session.user.displayName || session.user.username}，今天想记录些什么？`;
          el('workspace-role').textContent = isAdmin() ? '管理员写作台' : '我的写作台'; visibility('workspace-role', true);
          el('post-list-title').textContent = isAdmin() ? '文章与投稿' : '我的手记';
          visibility('publish-post-button', isAdmin()); visibility('submit-post-button', !isAdmin()); visibility('workspace-app', true);
          await refreshPosts(); status(secureTransport ? '' : '安全连接准备好后，才可以保存或发布文章。');
        } else status('');
      }
      setBusy(false);
    } catch (error) { status(`${errorText(error)} 可刷新页面重新连接。`, true); setBusy(false); }
  }
  void init();
}

export {};

type GardenNote = { title: string; url: string; description: string };
type Fortune = { title: string; text: string };
type FocusState = { duration: number; remaining: number; deadline: number | null; flowers: number };

const garden = document.querySelector<HTMLElement>('.play-garden');
if (garden) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const storage = {
    get<T>(key: string, fallback: T): T { try { const raw = localStorage.getItem(`window-garden-${key}`); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } },
    set(key: string, value: unknown) { try { localStorage.setItem(`window-garden-${key}`, JSON.stringify(value)); } catch { /* Private browsing can still enjoy this page. */ } },
  };
  const shanghaiDate = () => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = (name: string) => parts.find(p => p.type === name)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  const setStatus = (id: string, message: string) => { $(id).textContent = message; };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let motion = storage.get<boolean | null>('motion', null) ?? !reduced.matches;
  const updateMotion = () => {
    garden.classList.toggle('motion-off', !motion || reduced.matches);
    $('garden-motion').setAttribute('aria-pressed', String(motion && !reduced.matches));
    $('garden-motion').textContent = motion && !reduced.matches ? '✧ 动效已开启' : '✧ 安静模式';
  };
  updateMotion();
  $('garden-motion').addEventListener('click', () => { motion = !(motion && !reduced.matches); storage.set('motion', motion); updateMotion(); });
  reduced.addEventListener('change', updateMotion);
  const scene = $('garden-scene');
  $('garden-weather').addEventListener('click', () => {
    const rain = scene.dataset.weather !== 'rain';
    scene.dataset.weather = rain ? 'rain' : 'clear';
    $('garden-weather').setAttribute('aria-pressed', String(rain));
    $('garden-weather').textContent = rain ? '☾ 换成晴夜' : '☂ 换成细雨';
    const label = scene.querySelector('.scene-sky-label');
    if (label) label.textContent = rain ? '原创小景 · 细雨' : '原创小景 · 晴夜';
  });
  const sceneArt = scene.querySelector<HTMLElement>('.garden-scene-art')!;
  sceneArt.addEventListener('pointermove', event => {
    if (!motion || reduced.matches) return;
    const bounds = sceneArt.getBoundingClientRect();
    const glow = $('garden-pointer-glow');
    glow.style.left = `${event.clientX - bounds.left}px`;
    glow.style.top = `${event.clientY - bounds.top}px`;
    if (event.pointerType === 'touch') glow.style.opacity = '1';
  });
  sceneArt.addEventListener('pointerleave', () => { $('garden-pointer-glow').style.opacity = ''; });
  sceneArt.addEventListener('pointerup', () => { $('garden-pointer-glow').style.opacity = ''; });

  // These short, original prompts are encouragement, not predictions.
  const fortunes: Fortune[] = [
    { title: '把今天过得松一点。', text: '不必把每一分钟填满。留一小段空白，好想法也需要呼吸。' },
    { title: '小步，也是在前进。', text: '选一个能在十分钟内完成的小目标。做完它，再决定下一步。' },
    { title: '好奇心会带路。', text: '记下一个「为什么」，去找一个线索。今天的探索，从一个小问题开始。' },
    { title: '允许自己慢慢来。', text: '复杂的东西不需要一次想明白。把它拆小一点，答案会一点点出现。' },
    { title: '给想法一个名字。', text: '打开一页空白，把脑海里的念头写成三句话。清楚，是好作品的起点。' },
    { title: '认真，也可以轻盈。', text: '照顾好眼睛和肩膀。站起来看一眼远处，再带着一点新鲜空气回来。' },
    { title: '今天适合分享。', text: '把一个新发现讲给别人听。解释它的过程，也会让你看得更清楚。' },
    { title: '旧问题，有新角度。', text: '翻一页过去的笔记，问问现在的自己：有没有更简单的做法？' },
    { title: '先让它长出第一片叶。', text: '做一个最小的版本，试一次。想法开始生长，往往是在第一次动手之后。' },
    { title: '休息也是一份进度。', text: '喝口水，听一段音乐。等心安静下来，再继续喜欢的事。' },
    { title: '留住今天的一点光。', text: '写下一件今天学到的小事。积累的意义，常常要过一阵子才看见。' },
    { title: '不妨绕一小段路。', text: '读一点平时不会读的内容。另一条路上的风景，也许会照亮手里的问题。' },
  ];
  let visitor = storage.get<string>('visitor', '');
  if (typeof visitor !== 'string' || !visitor) { visitor = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`; storage.set('visitor', visitor); }
  let currentFortune: Fortune | null = null;
  let fortuneDay = shanghaiDate();
  let drawing = false;
  const fortuneForDay = () => {
    let hash = 2166136261;
    for (const char of `${visitor}:${fortuneDay}`) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return fortunes[(hash >>> 0) % fortunes.length];
  };
  const showFortune = (fortune: Fortune) => {
    currentFortune = fortune;
    setStatus('fortune-title', fortune.title); setStatus('fortune-text', fortune.text);
    ($('fortune-draw') as HTMLButtonElement).disabled = true;
    $('fortune-draw').textContent = '今日签已收藏';
    $('fortune-save').hidden = false; $('fortune-share').hidden = false;
    setStatus('fortune-status', '明天再来，会有新的小提醒。按北京时间更新。');
  };
  const checkFortuneDay = () => {
    const day = shanghaiDate();
    if (day !== fortuneDay) { fortuneDay = day; currentFortune = null; }
    $('fortune-date').textContent = fortuneDay.replaceAll('-', '.');
    $('fortune-date').setAttribute('datetime', fortuneDay);
    const drawn = storage.get<{ date: string } | null>('fortune', null);
    if (drawn?.date === fortuneDay) showFortune(fortuneForDay());
    else if (!currentFortune) {
      setStatus('fortune-title', '今日，留一点小期待。');
      setStatus('fortune-text', '每天一张温柔签，给平常的日子一个轻轻的提醒。');
      ($('fortune-draw') as HTMLButtonElement).disabled = false; $('fortune-draw').textContent = '抽取今日签';
      $('fortune-save').hidden = true; $('fortune-share').hidden = true;
      setStatus('fortune-status', '轻松的小提示，每天只抽一次。');
    }
  };
  checkFortuneDay();
  window.setInterval(checkFortuneDay, 60_000);
  $('fortune-draw').addEventListener('click', () => {
    checkFortuneDay();
    if (currentFortune || drawing) return;
    drawing = true;
    const content = $('fortune-card-content');
    content.classList.add('drawing');
    window.setTimeout(() => {
      storage.set('fortune', { date: fortuneDay });
      showFortune(fortuneForDay()); content.classList.remove('drawing'); drawing = false;
    }, motion && !reduced.matches ? 240 : 0);
  });
  const escapeXml = (value: string) => value.replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]!));
  $('fortune-save').addEventListener('click', () => {
    if (!currentFortune) return;
    const lines: string[] = [];
    let line = '';
    for (const char of currentFortune.text) { line += char; if (line.length >= 18) { lines.push(line); line = ''; } }
    if (line) lines.push(line);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="880" viewBox="0 0 720 880"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#173943"/><stop offset="1" stop-color="#10232e"/></linearGradient></defs><rect width="720" height="880" rx="32" fill="url(#bg)"/><rect x="38" y="38" width="644" height="804" rx="24" fill="none" stroke="#749c87"/><circle cx="568" cy="146" r="42" fill="#ffdea0"/><path d="M88 740c84-90 155-36 251-83 105-42 173-15 292 43v139H88z" fill="#244e46"/><g fill="#eaf4e8" font-family="sans-serif"><text x="80" y="140" font-size="19" letter-spacing="3">窗边手记 · 每日温柔签</text><text x="80" y="213" font-size="21" fill="#b4d6c1">${escapeXml(fortuneDay)}</text><text x="80" y="325" font-size="36" font-weight="bold">${escapeXml(currentFortune.title)}</text>${lines.map((t, i) => `<text x="80" y="${415+i*48}" font-size="25" fill="#d3e4d9">${escapeXml(t)}</text>`).join('')}<text x="80" y="774" font-size="20" fill="#bdd4bd">把好奇心，种进平常的日子里。</text><text x="80" y="808" font-size="15" fill="#aac6b5">robot999666 · 原创签卡</text></g><path d="M562 752v-59m0 33c-31 0-47-19-43-38 29 0 44 14 43 38zm0-16c28 0 45-19 42-40-30 4-45 19-42 40z" fill="#a4d0a4" stroke="#a4d0a4" stroke-width="3"/></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const link = document.createElement('a'); link.href = url; link.download = `窗边温柔签-${fortuneDay}.svg`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    setStatus('fortune-status', '签卡已下载为 SVG 图片，可以收藏或分享。');
  });
  $('fortune-share').addEventListener('click', async () => {
    const link = `${location.origin}/#garden`;
    const text = currentFortune ? `今日温柔签：${currentFortune.title} ${currentFortune.text}\n${link}` : link;
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const field = document.createElement('textarea'); field.value = text; field.style.position = 'fixed'; field.style.left = '-9999px'; document.body.append(field); field.select();
        const copied = document.execCommand('copy'); field.remove(); if (!copied) throw new Error('copy failed');
      }
      setStatus('fortune-status', '签文和花园链接已复制，可以分享给朋友。');
    } catch { setStatus('fortune-status', '浏览器未允许复制。可以保存签卡，或复制当前页面链接。'); }
  });

  const savedFocus = storage.get<FocusState | null>('focus', null);
  let focus: FocusState = savedFocus && [10, 25, 45].includes(savedFocus.duration) && Number.isFinite(savedFocus.remaining) && Number.isFinite(savedFocus.flowers)
    ? { duration: savedFocus.duration, remaining: Math.max(0, Math.min(savedFocus.remaining, savedFocus.duration * 60)), deadline: typeof savedFocus.deadline === 'number' && Number.isFinite(savedFocus.deadline) ? savedFocus.deadline : null, flowers: Math.max(0, Math.floor(savedFocus.flowers)) }
    : { duration: 25, remaining: 25 * 60, deadline: null, flowers: 0 };
  const persistFocus = () => storage.set('focus', focus);
  const updateFocus = () => {
    if (focus.deadline !== null) focus.remaining = Math.max(0, Math.ceil((focus.deadline - Date.now()) / 1000));
    if (focus.deadline !== null && focus.remaining <= 0) {
      focus.deadline = null; focus.flowers += 1; focus.remaining = focus.duration * 60;
      persistFocus(); setStatus('focus-status', '这一轮完成了！小花已开，站起来休息一下吧。');
    }
    $('focus-time').textContent = `${String(Math.floor(focus.remaining / 60)).padStart(2, '0')}:${String(focus.remaining % 60).padStart(2, '0')}`;
    $('focus-start').textContent = focus.deadline !== null ? '暂停一下' : focus.remaining < focus.duration * 60 ? '继续种花' : '开始种花';
    $('focus-start').setAttribute('aria-pressed', String(focus.deadline !== null));
    $('focus-seeds').textContent = `已种下 ${focus.flowers} 朵小花`;
    scene.classList.toggle('focus-growing', focus.deadline !== null); scene.classList.toggle('has-flowers', focus.flowers > 0);
    setStatus('garden-plant-caption', focus.deadline !== null ? '小苗正在生长。留一点时间，给眼前喜欢的事。' : focus.flowers ? `你的小花园，已经有 ${focus.flowers} 朵专注的小花。` : '一盆小苗，等你留下一点专注。');
    document.querySelectorAll<HTMLButtonElement>('[data-focus-duration]').forEach(button => {
      button.disabled = focus.deadline !== null; button.setAttribute('aria-pressed', String(Number(button.dataset.focusDuration) === focus.duration));
    });
  };
  $('focus-start').addEventListener('click', () => {
    if (focus.deadline !== null && focus.deadline <= Date.now()) { updateFocus(); return; }
    if (focus.deadline !== null) { focus.remaining = Math.max(0, Math.ceil((focus.deadline - Date.now()) / 1000)); focus.deadline = null; setStatus('focus-status', '已暂停，等你准备好再继续。'); }
    else { focus.deadline = Date.now() + focus.remaining * 1000; setStatus('focus-status', '专注开始，切换标签页也会继续计时。'); }
    persistFocus(); updateFocus();
  });
  $('focus-reset').addEventListener('click', () => { focus.deadline = null; focus.remaining = focus.duration * 60; persistFocus(); updateFocus(); setStatus('focus-status', '已重置这一轮，小花记录保留在本机。'); });
  document.querySelectorAll<HTMLButtonElement>('[data-focus-duration]').forEach(button => button.addEventListener('click', () => {
    if (focus.deadline !== null) return;
    focus.duration = Number(button.dataset.focusDuration); focus.remaining = focus.duration * 60; persistFocus(); updateFocus(); setStatus('focus-status', '只记录在当前浏览器');
  }));
  updateFocus(); window.setInterval(updateFocus, 1000);

  // The pocket is explicitly local; only same-origin article URLs are stored.
  const safeNote = (note: unknown): note is GardenNote => {
    if (!note || typeof note !== 'object') return false;
    const candidate = note as GardenNote;
    if (typeof candidate.title !== 'string' || typeof candidate.url !== 'string' || typeof candidate.description !== 'string') return false;
    try { const url = new URL(candidate.url, location.origin); return url.origin === location.origin && /^\/(notes|posts)\//.test(url.pathname); } catch { return false; }
  };
  const rawPocket = storage.get<unknown>('pocket', []);
  let pocket: GardenNote[] = Array.isArray(rawPocket) ? rawPocket.filter(safeNote).slice(0, 100) : [];
  let picked: GardenNote | null = null;
  let availableNotes: GardenNote[] = [];
  const updatePocket = () => {
    const list = $('reading-pocket-list'); list.replaceChildren();
    $('pocket-count').textContent = String(pocket.length);
    if (!pocket.length) { const p = document.createElement('p'); p.className = 'garden-small-note'; p.textContent = '喜欢的文章可以先收藏，慢慢读。'; list.append(p); }
    pocket.forEach(note => {
      const row = document.createElement('div'); row.className = 'pocket-item';
      const link = document.createElement('a'); link.href = note.url; link.textContent = note.title;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '移出'; remove.setAttribute('aria-label', `从阅读口袋移出 ${note.title}`);
      remove.addEventListener('click', () => { pocket = pocket.filter(item => item.url !== note.url); storage.set('pocket', pocket); updatePocket(); setStatus('pocket-status', '已从本机阅读口袋移出。'); });
      row.append(link, remove); list.append(row);
    });
    document.querySelectorAll<HTMLButtonElement>('[data-pocket-url]').forEach(button => {
      const saved = pocket.some(note => note.url === button.dataset.pocketUrl);
      button.setAttribute('aria-pressed', String(saved)); button.textContent = saved ? '✓ 已放进口袋' : '＋ 阅读口袋';
    });
    if (picked) $('drift-save').textContent = pocket.some(note => note.url === picked?.url) ? '✓ 已放进口袋' : '放进口袋 ＋';
  };
  const togglePocket = (note: GardenNote) => {
    if (pocket.some(item => item.url === note.url)) { pocket = pocket.filter(item => item.url !== note.url); setStatus('pocket-status', '已从本机阅读口袋移出。'); }
    else if (pocket.length >= 100) { setStatus('pocket-status', '口袋已有 100 篇，先移出几篇读完的手记吧。'); return; }
    else { pocket.push(note); setStatus('pocket-status', '已放进口袋，下次用这个浏览器来还在。'); }
    storage.set('pocket', pocket); updatePocket();
  };
  const refreshNotes = () => {
    const discovered = new Map<string, GardenNote>();
    document.querySelectorAll<HTMLElement>('[data-note]').forEach(card => {
      const link = card.querySelector<HTMLAnchorElement>('a.note-link, a[data-article-link]');
      if (!link) return;
      const note = { title: link.querySelector('h2,h3')?.textContent?.trim() || link.textContent?.trim() || '', url: new URL(link.href).pathname, description: link.querySelector('p')?.textContent?.trim() || '' };
      if (!safeNote(note) || !note.title) return;
      discovered.set(note.url, note);
      let button = card.querySelector<HTMLButtonElement>('[data-pocket-url]');
      if (!button) {
        button = document.createElement('button'); button.type = 'button'; button.className = 'pocket-bookmark'; button.dataset.pocketUrl = note.url;
        button.setAttribute('aria-label', `收藏或移出 ${note.title}`);
        button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); togglePocket(note); });
        (card.querySelector('.note-bottom') || card).append(button);
      }
    });
    availableNotes = [...discovered.values()]; updatePocket();
  };
  refreshNotes(); document.addEventListener('posts-updated', refreshNotes);
  document.addEventListener('pocket-updated', () => {
    const data = storage.get<unknown>('pocket', []);
    pocket = Array.isArray(data) ? data.filter(safeNote).slice(0, 100) : [];
    updatePocket();
  });
  $('drift-pick').addEventListener('click', () => {
    refreshNotes();
    if (!availableNotes.length) { setStatus('pocket-status', '暂时没有可以偶遇的文章，稍后再来看看。'); return; }
    const candidates = availableNotes.filter(note => note.url !== picked?.url);
    const pool = candidates.length ? candidates : availableNotes;
    const random = new Uint32Array(1); crypto.getRandomValues(random); picked = pool[random[0] % pool.length];
    const wrapper = $('drift-note'); wrapper.replaceChildren();
    const link = document.createElement('a'); link.href = picked.url; link.textContent = `${picked.title} →`;
    const description = document.createElement('p'); description.textContent = picked.description;
    wrapper.append(link, description); $('drift-save').hidden = false; updatePocket(); setStatus('pocket-status', '遇见了一篇手记。点标题阅读，也可以先放进口袋。');
  });
  $('drift-save').addEventListener('click', () => { if (picked) togglePocket(picked); });
  window.addEventListener('storage', event => {
    if (event.key === 'window-garden-pocket') { const data = storage.get<unknown>('pocket', []); pocket = Array.isArray(data) ? data.filter(safeNote).slice(0, 100) : []; updatePocket(); }
  });

  const loadCalendar = async () => {
    try {
      const response = await fetch('/api/stats', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('statistics unavailable');
      const stats = await response.json();
      if (!Array.isArray(stats.days)) throw new Error('invalid statistics');
      const counts = new Map<string, number>();
      for (const item of stats.days) if (typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && Number.isFinite(Number(item.count))) counts.set(item.date, Math.max(0, Math.floor(Number(item.count))));
      const today = shanghaiDate();
      const end = new Date(`${today}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + (7 - end.getUTCDay()) % 7);
      const start = new Date(end); start.setUTCDate(start.getUTCDate() - 83);
      const columns = document.createElement('div'); columns.className = 'calendar-columns';
      const labels = document.createElement('div'); labels.className = 'calendar-day-labels';
      for (const label of ['一', '', '三', '', '五', '', '日']) { const span = document.createElement('span'); span.textContent = label; labels.append(span); } columns.append(labels);
      const tooltip = document.createElement('p'); tooltip.className = 'calendar-tooltip'; tooltip.setAttribute('role', 'status'); tooltip.textContent = '点选格子，看看那一天的更新。';
      let updates = 0;
      for (let week = 0; week < 12; week++) {
        const column = document.createElement('div'); column.className = 'calendar-week';
        for (let day = 0; day < 7; day++) {
          const date = new Date(start); date.setUTCDate(date.getUTCDate() + week * 7 + day);
          const dateKey = date.toISOString().slice(0, 10); const count = counts.get(dateKey) || 0; updates += dateKey <= today ? count : 0;
          const button = document.createElement('button'); button.type = 'button'; button.className = 'calendar-day'; button.dataset.date = dateKey; button.dataset.count = String(count);
          button.dataset.level = String(count === 0 ? 0 : count === 1 ? 1 : count < 4 ? 2 : 3);
          const label = `${dateKey.replaceAll('-', '.')} · ${count} 次文章发布或更新`; button.title = label; button.setAttribute('aria-label', label);
          if (dateKey > today) { button.disabled = true; button.style.opacity = '.25'; button.setAttribute('aria-label', `${dateKey} · 还未到来`); }
          button.addEventListener('click', () => { tooltip.textContent = label; }); column.append(button);
        }
        columns.append(column);
      }
      const calendarButtons = [...columns.querySelectorAll<HTMLButtonElement>('.calendar-day:not(:disabled)')];
      calendarButtons.forEach((button, index) => {
        button.tabIndex = index === calendarButtons.length - 1 ? 0 : -1;
        button.addEventListener('focus', () => {
          calendarButtons.forEach(item => { item.tabIndex = -1; }); button.tabIndex = 0;
          tooltip.textContent = button.title;
        });
        button.addEventListener('keydown', event => {
          const offsets: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };
          if (!(event.key in offsets) && event.key !== 'Home' && event.key !== 'End') return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? calendarButtons.length - 1 : Math.max(0, Math.min(calendarButtons.length - 1, index + offsets[event.key]));
          calendarButtons.forEach(item => { item.tabIndex = -1; }); calendarButtons[next].tabIndex = 0; calendarButtons[next].focus();
        });
      });
      $('writing-calendar').replaceChildren(columns, tooltip);
      const total = Number.isFinite(Number(stats.total)) ? Math.max(0, Math.floor(Number(stats.total))) : null;
      let last = '暂无更新';
      if (typeof stats.lastUpdated === 'string' && !Number.isNaN(Date.parse(stats.lastUpdated))) {
        const lastDate = new Date(stats.lastUpdated);
        const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(lastDate);
        // The original seeds have a known date but no precise publication time.
        const options: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric' };
        if (clock !== '00:00') { options.hour = '2-digit'; options.minute = '2-digit'; }
        last = new Intl.DateTimeFormat('zh-CN', options).format(lastDate);
      }
      setStatus('calendar-summary', `${total === null ? '' : `共 ${total} 篇公开手记 · `}近 12 周 ${updates} 次更新\n最近：${last}`);
    } catch {
      const p = document.createElement('p'); p.className = 'garden-small-note'; p.textContent = '更新日历暂时无法读取，请稍后再来。'; $('writing-calendar').replaceChildren(p);
      setStatus('calendar-summary', '这里展示真实的文章发布与更新记录。');
    }
  };
  void loadCalendar(); document.addEventListener('posts-updated', () => { void loadCalendar(); });

  // The entire score and rain texture are synthesized locally, with no autoplay.
  let audio: AudioContext | null = null;
  let master: GainNode | null = null;
  let rainSource: AudioBufferSourceNode | null = null;
  let rainGain: GainNode | null = null;
  let scheduler: number | null = null;
  let playing = false;
  let nextNote = 0;
  let step = 0;
  let playedSeconds = 0;
  let startedAt = 0;
  let changingMusic = false;
  const voices = new Set<OscillatorNode>();
  const musicButton = $('garden-music-play') as HTMLButtonElement;
  const mood = $('garden-music-mood') as HTMLSelectElement;
  const volume = $('garden-music-volume') as HTMLInputElement;
  const titles: Record<string, string> = { night: '窗边夜曲', rain: '雨落琴声', forest: '林间慢步' };
  const patterns: Record<string, number[]> = { night: [64, 67, 71, 69, 67, 64, 62, 60, 64, 69, 72, 71, 67, 64, 62, 67], rain: [69, 72, 76, 74, 72, 69, 67, 64, 67, 71, 74, 72, 69, 67, 64, 62], forest: [60, 64, 67, 72, 69, 67, 64, 62, 60, 67, 69, 72, 76, 72, 67, 64] };
  const volumeValue = () => (Number(volume.value) / 100) ** 1.5 * .25;
  const playTone = (midi: number, when: number, duration: number, gain: number) => {
    if (!audio || !master) return;
    const oscillator = audio.createOscillator(); const envelope = audio.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    envelope.gain.setValueAtTime(0, when); envelope.gain.linearRampToValueAtTime(gain, when + .04); envelope.gain.exponentialRampToValueAtTime(.0001, when + duration);
    oscillator.connect(envelope); envelope.connect(master); oscillator.start(when); oscillator.stop(when + duration + .05); voices.add(oscillator);
    oscillator.addEventListener('ended', () => { voices.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); });
  };
  const scheduleMusic = () => {
    if (!audio || !playing) return;
    const selected = mood.value in patterns ? mood.value : 'night'; const pattern = patterns[selected];
    while (nextNote < audio.currentTime + .6) {
      playTone(pattern[step % pattern.length], nextNote, 2.8, .2);
      if (step % 4 === 0) {
        const bass = [48, 45, 53, 55][Math.floor(step / 4) % 4] + (selected === 'rain' ? 2 : 0);
        playTone(bass, nextNote, 4.6, .14); playTone(bass + 7, nextNote + .06, 4.2, .08);
      }
      nextNote += selected === 'forest' ? 1.6 : 1.8; step += 1;
    }
  };
  const ensureRain = () => {
    if (!audio || !master) return;
    if (!rainSource) {
      const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * 4), audio.sampleRate); const data = buffer.getChannelData(0);
      let filtered = 0;
      for (let i = 0; i < data.length; i++) { filtered = .985 * filtered + (Math.random() * 2 - 1) * .015; data[i] = filtered * 2.5; }
      rainSource = audio.createBufferSource(); rainSource.buffer = buffer; rainSource.loop = true;
      const filter = audio.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 2600; rainGain = audio.createGain(); rainGain.gain.value = 0;
      rainSource.connect(filter); filter.connect(rainGain); rainGain.connect(master); rainSource.start();
    }
    rainGain?.gain.setTargetAtTime(mood.value === 'rain' ? .25 : 0, audio.currentTime, .2);
  };
  const musicStatus = () => {
    if (!playing) return;
    const elapsed = Math.floor(playedSeconds + (Date.now() - startedAt) / 1000);
    setStatus('garden-music-status', `原创循环 · ${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`);
  };
  const stopMusic = async (hidden = false) => {
    if (!playing || !audio) return;
    playing = false; playedSeconds += (Date.now() - startedAt) / 1000;
    if (scheduler !== null) { clearInterval(scheduler); scheduler = null; }
    for (const voice of voices) { try { voice.stop(); } catch { /* Already ended. */ } } voices.clear();
    await audio.suspend();
    scene.querySelector('.garden-player')?.classList.remove('playing'); musicButton.setAttribute('aria-pressed', 'false'); musicButton.setAttribute('aria-label', '播放原创环境音乐'); musicButton.querySelector('.music-play-symbol')!.textContent = '▶';
    setStatus('garden-music-status', hidden ? '离开页面，音乐已自动暂停' : '已暂停 · 点击继续播放');
  };
  musicButton.addEventListener('click', async () => {
    if (changingMusic) return;
    changingMusic = true;
    try {
      if (playing) { await stopMusic(); return; }
      if (!audio) {
        const Constructor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Constructor) throw new Error('Web Audio unsupported');
        audio = new Constructor(); master = audio.createGain(); master.gain.value = volumeValue();
        const limiter = audio.createDynamicsCompressor(); limiter.threshold.value = -15; limiter.ratio.value = 8; master.connect(limiter); limiter.connect(audio.destination);
      }
      await audio.resume();
      if (audio.state !== 'running') throw new Error('Audio unavailable');
      playing = true; startedAt = Date.now(); nextNote = audio.currentTime + .05; ensureRain(); scheduleMusic(); scheduler = window.setInterval(scheduleMusic, 250);
      scene.querySelector('.garden-player')?.classList.add('playing'); musicButton.setAttribute('aria-pressed', 'true'); musicButton.setAttribute('aria-label', '暂停原创环境音乐'); musicButton.querySelector('.music-play-symbol')!.textContent = 'Ⅱ'; musicStatus();
    } catch { setStatus('garden-music-status', '当前浏览器无法播放，请换一个浏览器试试。'); }
    finally { changingMusic = false; }
  });
  mood.addEventListener('change', () => { setStatus('garden-music-title', titles[mood.value] || titles.night); step = 0; ensureRain(); if (!playing) setStatus('garden-music-status', '原创环境音乐 · 点击播放'); });
  volume.addEventListener('input', () => { if (master && audio) master.gain.setTargetAtTime(volumeValue(), audio.currentTime, .04); });
  window.setInterval(musicStatus, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { void stopMusic(true); persistFocus(); }
    else { checkFortuneDay(); updateFocus(); }
  });
  window.addEventListener('pagehide', () => { persistFocus(); void stopMusic(); });
}

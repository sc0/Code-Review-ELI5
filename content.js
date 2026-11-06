// Content script: finds review comments on GitHub pull request pages and
// attaches an ELI5 panel under each one.

(() => {
  const PR_PATH = /^\/[^/]+\/[^/]+\/pull\/\d+/;
  const MARK = 'data-eli5';

  // Comment bodies across GitHub's classic and React PR views.
  const BODY_SELECTOR = [
    '.comment-body.markdown-body',
    '.js-comment-body',
    '[data-testid="markdown-body"]',
    '.markdown-body',
  ].join(',');

  // Things that look like comments but aren't review comments.
  const EXCLUDE_SELECTOR = [
    '.eli5-box',
    '.js-preview-body', // "Preview" tab of the comment editor
    '.preview-content',
    '[contenteditable="true"]',
    '.js-command-palette-pull-body', // PR description
    '[id^="pullrequest-"]', // PR description
    '.js-comment-update', // edit form
  ].join(',');

  const AUTHOR_SELECTOR =
    'a.author, .author, a[data-hovercard-type="user"], a[data-hovercard-type="bot"], [data-testid="avatar-link"]';

  const THREAD_SELECTOR = [
    '.review-thread-component',
    '.js-resolvable-timeline-thread-container',
    '.js-inline-comments-container',
    'tr.inline-comments',
    '[data-testid*="review-thread"]',
  ].join(',');

  const boxes = new Map(); // comment body element -> { box, text }
  let settings = null;
  const myLogin = document.querySelector('meta[name="user-login"]')?.content || '';

  const visibility = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        visibility.unobserve(entry.target);
        explain(entry.target);
      }
    },
    { rootMargin: '300px 0px' },
  );

  // ---------- bootstrapping ----------

  async function loadSettings() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'eli5:getSettings' });
      if (res?.ok) settings = res.result;
    } catch {
      settings = null; // extension was reloaded; this content script is orphaned
    }
  }

  chrome.storage.onChanged.addListener(async (changes, area) => {
    // Ignore cache writes; only settings and the API keys matter here.
    const keyChanged = Boolean(changes.apiKey || changes.openrouterApiKey);
    if (area !== 'sync' && !keyChanged) return;
    await loadSettings();
    // A key, provider or model changed: retry panels that failed because of a missing or bad key.
    if (keyChanged || changes.provider || changes.model || changes.openrouterModel) {
      for (const [el, entry] of boxes) {
        if (['NO_KEY', 'BAD_KEY'].includes(entry.box.dataset.error)) explain(el);
      }
    }
  });

  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 250);
  }

  new MutationObserver((mutations) => {
    // Ignore churn inside our own panels.
    if (mutations.every((m) => m.target instanceof Element && m.target.closest('.eli5-box'))) return;
    scheduleScan();
  }).observe(document.documentElement, { childList: true, subtree: true });

  loadSettings().then(scan);

  // ---------- scanning ----------

  function scan() {
    if (!settings || !PR_PATH.test(location.pathname)) return;

    // Drop panels whose comment was removed from the page (SPA navigation, re-render).
    for (const [el, entry] of boxes) {
      if (!el.isConnected) {
        entry.box.remove();
        boxes.delete(el);
      }
    }

    for (const el of document.querySelectorAll(BODY_SELECTOR)) {
      const state = el.getAttribute(MARK);
      if (state === 'skip') continue;

      if (state === 'done') {
        // Comment was edited in place: start over.
        const entry = boxes.get(el);
        if (entry && fingerprint(el) !== entry.text) {
          entry.box.remove();
          boxes.delete(el);
          el.removeAttribute(MARK);
        } else {
          continue;
        }
      }

      if (el.parentElement?.closest('.markdown-body') || el.closest(EXCLUDE_SELECTOR)) {
        el.setAttribute(MARK, 'skip');
        continue;
      }

      const text = fingerprint(el);
      if (text.length < 2) continue; // may still be loading; look again on the next scan

      const author = findAuthor(el);
      if ((settings.skipOwn && myLogin && author.name === myLogin) || (settings.skipBots && author.isBot)) {
        el.setAttribute(MARK, 'skip');
        continue;
      }

      attach(el, text);
    }
  }

  function attach(el, text) {
    el.setAttribute(MARK, 'done');
    // A stale panel from a replaced comment body may sit right after this one.
    if (el.nextElementSibling?.classList.contains('eli5-box')) el.nextElementSibling.remove();

    const box = createBox(el);
    el.insertAdjacentElement('afterend', box);
    boxes.set(el, { box, text });

    if (settings.mode === 'auto') {
      setState(box, 'waiting', 'Waiting until this comment is on screen…');
      visibility.observe(el);
    } else {
      renderButton(box, el);
    }
  }

  // ---------- context extraction ----------

  function textOf(el) {
    return (el.innerText || el.textContent || '').trim();
  }

  // Layout-independent text, so a collapsed vs. expanded thread doesn't look like an edit.
  function fingerprint(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function findAuthor(el) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 10; depth++, node = node.parentElement) {
      const link = [...node.querySelectorAll(AUTHOR_SELECTOR)].find((a) => !el.contains(a));
      if (link) {
        const name = (link.textContent || link.getAttribute('href') || '').trim().replace(/^\//, '');
        const isBot =
          name.endsWith('[bot]') ||
          link.getAttribute('data-hovercard-type') === 'bot' ||
          /\bbot\b/i.test(link.parentElement?.querySelector('.Label')?.textContent || '');
        return { name, isBot };
      }
    }
    return { name: '', isBot: false };
  }

  function findFilePath(el, thread) {
    const fromThread =
      thread?.querySelector('[data-path]')?.getAttribute('data-path') ||
      thread?.querySelector('summary a.Link--primary, .file-info a')?.textContent?.trim();
    if (fromThread) return fromThread;

    const file = el.closest('.file, [data-tagsearch-path], copilot-diff-entry');
    return (
      file?.getAttribute('data-tagsearch-path') ||
      file?.querySelector('[data-path]')?.getAttribute('data-path') ||
      ''
    );
  }

  function diffLine(row) {
    const cells = [...row.querySelectorAll('.blob-code')].filter((c) => c.querySelector('.blob-code-inner'));
    const cell = cells.reverse().find((c) => textOf(c.querySelector('.blob-code-inner')));
    if (!cell) return null;
    const marker = cell.classList.contains('blob-code-addition')
      ? '+'
      : cell.classList.contains('blob-code-deletion')
        ? '-'
        : ' ';
    return marker + cell.querySelector('.blob-code-inner').innerText.replace(/\n$/, '');
  }

  function findCode(el, thread) {
    const lines = [];

    // Files tab: the comment row sits right below the diff line it was left on.
    const commentRow = el.closest('tr.inline-comments');
    if (commentRow) {
      for (let row = commentRow.previousElementSibling; row && lines.length < 10; row = row.previousElementSibling) {
        if (row.matches('tr.inline-comments')) continue;
        const line = diffLine(row);
        if (line !== null) lines.unshift(line);
      }
      return lines.join('\n');
    }

    // Conversation tab: the thread shows the diff hunk above the comments.
    if (thread) {
      const rows = [...thread.querySelectorAll('tr')].filter((r) => !r.closest('.markdown-body, .inline-comments'));
      for (const row of rows.slice(-12)) {
        const line = diffLine(row);
        if (line !== null) lines.push(line);
      }
    }
    return lines.join('\n');
  }

  function earlierInThread(el, thread) {
    if (!thread) return [];
    const bodies = [...thread.querySelectorAll(BODY_SELECTOR)].filter(
      (b) => !b.parentElement?.closest('.markdown-body') && !b.closest(EXCLUDE_SELECTOR),
    );
    const index = bodies.indexOf(el);
    if (index <= 0) return [];
    return bodies.slice(Math.max(0, index - 3), index).map((b) => ({ author: findAuthor(b).name, text: textOf(b) }));
  }

  function buildPayload(el) {
    const thread = el.closest(THREAD_SELECTOR);
    return {
      prTitle: document.querySelector('.js-issue-title, [data-component="PH_Title"] bdi, h1 bdi')?.textContent?.trim() || '',
      filePath: findFilePath(el, thread),
      code: findCode(el, thread),
      thread: earlierInThread(el, thread),
      author: findAuthor(el).name,
      comment: textOf(el),
      fingerprint: fingerprint(el),
    };
  }

  // ---------- requests ----------

  async function explain(el, force = false) {
    const entry = boxes.get(el);
    if (!entry) return;
    const { box } = entry;
    setState(box, 'loading', 'Explaining…');

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'eli5:explain', payload: buildPayload(el), force });
    } catch {
      res = { ok: false, error: 'The extension was reloaded. Refresh this page.', code: 'STALE' };
    }

    if (!box.isConnected) return;
    if (res?.ok) renderResult(box, el, res.result);
    else renderError(box, el, res?.error || 'Something went wrong.', res?.code);
  }

  // ---------- UI ----------

  function h(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function createBox() {
    const box = h('div', 'eli5-box');
    const header = h('div', 'eli5-header');
    header.append(h('span', 'eli5-badge', 'ELI5'), h('span', 'eli5-kind'), h('span', 'eli5-spacer'));

    const refresh = h('button', 'eli5-btn eli5-refresh', '↻');
    refresh.type = 'button';
    refresh.title = 'Regenerate explanation';
    refresh.hidden = true;

    const toggle = h('button', 'eli5-btn eli5-toggle', 'Hide');
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      const collapsed = box.classList.toggle('eli5-collapsed');
      toggle.textContent = collapsed ? 'Show' : 'Hide';
    });

    header.append(refresh, toggle);
    box.append(header, h('div', 'eli5-content'));
    return box;
  }

  function content(box) {
    const node = box.querySelector('.eli5-content');
    node.replaceChildren();
    return node;
  }

  function setState(box, state, message) {
    box.dataset.state = state;
    delete box.dataset.error;
    box.querySelector('.eli5-refresh').hidden = true;
    box.querySelector('.eli5-kind').textContent = '';
    content(box).append(h('div', 'eli5-muted', message));
  }

  function renderButton(box, el) {
    box.dataset.state = 'idle';
    const btn = h('button', 'eli5-btn eli5-primary', 'Explain this comment');
    btn.type = 'button';
    btn.addEventListener('click', () => explain(el));
    content(box).append(btn);
  }

  // Renders `code` spans as <code>; everything else as plain text (never HTML).
  function inline(text) {
    const frag = document.createDocumentFragment();
    String(text || '')
      .split(/(`[^`]+`)/)
      .forEach((part) => {
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) frag.append(h('code', null, part.slice(1, -1)));
        else if (part) frag.append(document.createTextNode(part));
      });
    return frag;
  }

  function section(label, text, className) {
    const row = h('div', `eli5-section ${className}`);
    const p = h('p');
    p.append(inline(text));
    row.append(h('div', 'eli5-label', label), p);
    return row;
  }

  function renderResult(box, el, result) {
    box.dataset.state = 'done';
    delete box.dataset.error;
    box.querySelector('.eli5-kind').textContent = result.kind || '';
    box.querySelector('.eli5-kind').dataset.kind = result.kind || '';

    const refresh = box.querySelector('.eli5-refresh');
    refresh.hidden = false;
    refresh.onclick = () => explain(el, true);

    content(box).append(
      section('What it means', result.meaning, 'eli5-meaning'),
      section('Like I’m five', result.eli5, 'eli5-simple'),
      section('What to do', result.action, 'eli5-action'),
    );
  }

  function renderError(box, el, message, code) {
    box.dataset.state = 'error';
    box.dataset.error = code || 'ERROR';
    box.querySelector('.eli5-refresh').hidden = true;
    const node = content(box);
    node.append(h('div', 'eli5-error', message));

    const actions = h('div', 'eli5-actions');
    if (code === 'NO_KEY' || code === 'BAD_KEY') {
      const open = h('button', 'eli5-btn eli5-primary', 'Open settings');
      open.type = 'button';
      open.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'eli5:openOptions' }).catch(() => {}));
      actions.append(open);
    }
    if (code !== 'STALE') {
      const retry = h('button', 'eli5-btn', 'Retry');
      retry.type = 'button';
      retry.addEventListener('click', () => explain(el));
      actions.append(retry);
    }
    node.append(actions);
  }
})();

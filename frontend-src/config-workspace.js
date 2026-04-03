(() => {
  const TAB_LABEL = 'Serial Commands';
  const ROOT_ATTR = 'data-preview-serial-root';
  const TAB_ATTR = 'data-preview-serial-tab';
  const PANEL_ATTR = 'data-preview-serial-panel';
  const ENDPOINT = '/target/previewCommandLog';

  function formatTimestamp(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString();
  }

  function buildPanel() {
    const panel = document.createElement('section');
    panel.setAttribute(PANEL_ATTR, 'true');
    panel.className = 'preview-serial-panel';
    panel.innerHTML = `
      <div class="preview-serial-header">
        <div>
          <h3>Serial Commands</h3>
          <p>Preview-only trace of UI actions and serial-equivalent backend commands.</p>
        </div>
        <button type="button" class="preview-serial-refresh">Refresh</button>
      </div>
      <div class="preview-serial-status">Loading…</div>
      <div class="preview-serial-list"></div>
    `;
    return panel;
  }

  function renderLog(panel, entries) {
    const list = panel.querySelector('.preview-serial-list');
    const status = panel.querySelector('.preview-serial-status');
    list.innerHTML = '';

    if (!entries.length) {
      status.textContent = 'No preview commands yet.';
      return;
    }

    status.textContent = `${entries.length} entries`;
    for (const entry of entries) {
      const card = document.createElement('article');
      card.className = 'preview-serial-entry';
      const commands = Array.isArray(entry.commands) ? entry.commands : [];
      card.innerHTML = `
        <div class="preview-serial-entry-head">
          <code class="preview-serial-action"></code>
          <span class="preview-serial-time"></span>
        </div>
        <pre class="preview-serial-commands"></pre>
      `;
      card.querySelector('.preview-serial-action').textContent = entry.action || 'unknown';
      card.querySelector('.preview-serial-time').textContent = formatTimestamp(entry.timestamp);
      card.querySelector('.preview-serial-commands').textContent = commands.join('\n');
      list.appendChild(card);
    }
  }

  async function refreshLog(panel) {
    const status = panel.querySelector('.preview-serial-status');
    try {
      status.textContent = 'Loading…';
      const response = await window.fetch(ENDPOINT, { method: 'GET' });
      const entries = await response.json();
      renderLog(panel, Array.isArray(entries) ? entries : []);
    } catch (error) {
      status.textContent = `Failed to load command log: ${error}`;
    }
  }

  function attachHandlers(root, tab, panel, contentHolder) {
    const existingTabs = Array.from(root.querySelectorAll('.ant-tabs-nav-list > .ant-tabs-tab'))
      .filter((node) => node !== tab);

    const activate = () => {
      existingTabs.forEach((node) => node.classList.remove('ant-tabs-tab-active'));
      tab.classList.add('ant-tabs-tab-active');
      contentHolder.style.display = 'none';
      panel.style.display = 'block';
      refreshLog(panel);
    };

    const deactivate = () => {
      tab.classList.remove('ant-tabs-tab-active');
      contentHolder.style.display = '';
      panel.style.display = 'none';
    };

    tab.addEventListener('click', (event) => {
      event.preventDefault();
      activate();
    });

    existingTabs.forEach((node) => {
      node.addEventListener('click', () => {
        window.setTimeout(deactivate, 0);
      });
    });

    panel.querySelector('.preview-serial-refresh').addEventListener('click', () => refreshLog(panel));
    window.setInterval(() => {
      if (panel.style.display !== 'none') {
        refreshLog(panel);
      }
    }, 1500);
  }

  function mountWorkspace(root) {
    if (root.hasAttribute(ROOT_ATTR)) {
      return;
    }

    const navList = root.querySelector('.ant-tabs-nav-list');
    const contentHolder = root.querySelector('.ant-tabs-content-holder');
    if (!navList || !contentHolder) {
      return;
    }

    const labels = Array.from(navList.querySelectorAll('.ant-tabs-tab-btn')).map((node) => node.textContent && node.textContent.trim());
    if (!labels.includes('Highlevel Configuration') || !labels.includes('Register Configuration')) {
      return;
    }

    root.setAttribute(ROOT_ATTR, 'true');

    const tab = document.createElement('div');
    tab.className = 'ant-tabs-tab preview-serial-tab';
    tab.setAttribute(TAB_ATTR, 'true');
    tab.innerHTML = `<div class="ant-tabs-tab-btn">${TAB_LABEL}</div>`;
    navList.appendChild(tab);

    const panel = buildPanel();
    panel.style.display = 'none';
    contentHolder.parentNode.insertBefore(panel, contentHolder.nextSibling);

    attachHandlers(root, tab, panel, contentHolder);
  }

  function scan() {
    document.querySelectorAll('.ant-tabs').forEach((root) => mountWorkspace(root));
  }

  function boot() {
    scan();
    const observer = new MutationObserver(() => scan());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

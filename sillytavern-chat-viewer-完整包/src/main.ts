import appCss from './style.css?inline';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { getPlainBody, parseTranscript } from './parser.ts';
import type { ChatMessage, MessageSection, ThemeName, TranscriptData, ViewMode } from './types.ts';

marked.setOptions({
  gfm: true,
  breaks: true,
});

const THEME_LABELS: Record<ThemeName, string> = {
  'amber-noir': 'Amber Noir',
  'mist-paper': 'Mist Paper',
  'neon-signal': 'Neon Signal',
};

type AppState = {
  transcript: TranscriptData | null;
  theme: ThemeName;
  viewMode: ViewMode;
  showReasoning: boolean;
  renderCards: boolean;
};

const savedTheme = window.localStorage.getItem('st-viewer-theme') as ThemeName | null;
const savedViewMode = window.localStorage.getItem('st-viewer-mode') as ViewMode | null;

const state: AppState = {
  transcript: null,
  theme: savedTheme && savedTheme in THEME_LABELS ? savedTheme : 'amber-noir',
  viewMode: savedViewMode && ['clean', 'hybrid', 'raw'].includes(savedViewMode) ? savedViewMode : 'hybrid',
  showReasoning: window.localStorage.getItem('st-viewer-reasoning') !== 'false',
  renderCards: window.localStorage.getItem('st-viewer-cards') !== 'false',
};

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('App root not found.');
}

const style = document.createElement('style');
style.textContent = appCss;
document.head.append(style);

document.documentElement.dataset.theme = state.theme;
document.title = 'SillyTavern Export Viewer';

root.innerHTML = `
  <div class="app-shell">
    <aside class="control-panel">
      <div class="brand-card">
        <p class="eyebrow">SillyTavern Export Viewer</p>
        <h1>把聊天记录净化成可读、可导出的前端页面</h1>
        <p class="intro">
          读取 <code>.txt</code> 或 <code>.jsonl</code> 聊天记录，默认只呈现正文；需要时也能渲染摘要、状态栏、HTML 卡片和前端消息块。
        </p>
      </div>

      <label class="upload-card" id="drop-zone">
        <input id="file-input" type="file" accept=".txt,.jsonl,.json" hidden />
        <span class="upload-kicker">导入聊天记录</span>
        <strong>点击选择文件，或把导出文件拖进来</strong>
        <span class="upload-hint">支持 SillyTavern 文本导出、JSONL 聊天记录，以及带 HTML/状态栏的卡片消息。</span>
      </label>

      <div class="panel-block">
        <div class="panel-title-row">
          <h2>显示模式</h2>
          <span class="panel-note">默认推荐混合模式</span>
        </div>
        <div class="segmented" id="view-mode">
          <button data-mode="clean" class="segment-button">正文净化</button>
          <button data-mode="hybrid" class="segment-button">混合视图</button>
          <button data-mode="raw" class="segment-button">原始文本</button>
        </div>
      </div>

      <div class="panel-block">
        <div class="panel-title-row">
          <h2>主题</h2>
        </div>
        <select id="theme-select" class="theme-select">
          ${Object.entries(THEME_LABELS)
            .map(([value, label]) => `<option value="${value}">${label}</option>`)
            .join('')}
        </select>
      </div>

      <div class="panel-block toggles">
        <label class="toggle">
          <input id="toggle-reasoning" type="checkbox" />
          <span>显示思维链</span>
        </label>
        <label class="toggle">
          <input id="toggle-cards" type="checkbox" />
          <span>渲染卡片与前端块</span>
        </label>
      </div>

      <div class="panel-block">
        <div class="panel-title-row">
          <h2>导出</h2>
        </div>
        <div class="action-grid">
          <button id="export-html" class="action-button">导出 HTML</button>
          <button id="export-text" class="action-button action-button-muted">导出纯正文</button>
        </div>
      </div>

      <div class="panel-block stats-block" id="stats-block">
        <div class="panel-title-row">
          <h2>文件信息</h2>
        </div>
        <div id="stats-content" class="stats-content">
          <div class="empty-inline">还没有导入文件。</div>
        </div>
      </div>
    </aside>

    <main class="viewer-panel">
      <div class="viewer-topbar">
        <div>
          <p class="eyebrow">Preview</p>
          <h2>聊天展示</h2>
        </div>
        <div class="topbar-badges" id="topbar-badges"></div>
      </div>
      <section id="chat-stage" class="chat-stage"></section>
    </main>
  </div>
`;

function mustQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing UI element: ${selector}`);
  }
  return element;
}

const fileInput = mustQuery<HTMLInputElement>('#file-input');
const dropZone = mustQuery<HTMLElement>('#drop-zone');
const themeSelect = mustQuery<HTMLSelectElement>('#theme-select');
const toggleReasoning = mustQuery<HTMLInputElement>('#toggle-reasoning');
const toggleCards = mustQuery<HTMLInputElement>('#toggle-cards');
const viewMode = mustQuery<HTMLElement>('#view-mode');
const stage = mustQuery<HTMLElement>('#chat-stage');
const statsContent = mustQuery<HTMLElement>('#stats-content');
const topbarBadges = mustQuery<HTMLElement>('#topbar-badges');
const exportHtmlButton = mustQuery<HTMLButtonElement>('#export-html');
const exportTextButton = mustQuery<HTMLButtonElement>('#export-text');

themeSelect.value = state.theme;
toggleReasoning.checked = state.showReasoning;
toggleCards.checked = state.renderCards;

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(input: string): string {
  return input
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function toHtml(markdown: string): string {
  return DOMPurify.sanitize(marked.parse(markdown) as string, {
    USE_PROFILES: { html: true },
  });
}

function toSafeHtml(rawHtml: string): string {
  return DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
  });
}

function frameMarkup(srcdoc: string): string {
  return `<iframe class="frontend-frame" sandbox="allow-scripts" srcdoc="${escapeHtml(srcdoc)}"></iframe>`;
}

function roleLabel(message: ChatMessage): string {
  switch (message.role) {
    case 'user':
      return '用户';
    case 'system':
      return '系统';
    default:
      return '角色';
  }
}

function renderSection(section: MessageSection): string {
  let contentMarkup = '';
  switch (section.kind) {
    case 'frontend':
      contentMarkup = frameMarkup(section.content);
      break;
    case 'html':
      contentMarkup = `<div class="rich-content">${toSafeHtml(section.content)}</div>`;
      break;
    case 'markdown':
    case 'details':
      contentMarkup = `<div class="rich-content">${toHtml(section.content)}</div>`;
      break;
    case 'status':
      contentMarkup = `
        <div class="status-grid">
          ${(section.pairs ?? [])
            .map(
              (pair) => `
                <div class="status-item">
                  <span>${escapeHtml(pair.key)}</span>
                  <strong>${escapeHtml(pair.value)}</strong>
                </div>
              `,
            )
            .join('')}
        </div>
      `;
      break;
    case 'raw':
      contentMarkup = `<pre class="raw-block">${escapeHtml(section.content)}</pre>`;
      break;
  }

  return `
    <details class="section-card" ${section.open ? 'open' : ''}>
      <summary>${escapeHtml(section.title)}</summary>
      ${contentMarkup}
    </details>
  `;
}

function renderBody(message: ChatMessage): string {
  if (state.viewMode === 'raw') {
    return `<pre class="raw-block">${escapeHtml(message.raw)}</pre>`;
  }

  const text = message.body || message.cleanedText || message.raw;
  if (!text.trim()) {
    return `<div class="empty-inline">这一条没有可显示的正文。</div>`;
  }

  return `<div class="rich-content">${toHtml(text)}</div>`;
}

function renderReasoning(message: ChatMessage): string {
  if (!state.showReasoning || !message.reasoning.trim()) {
    return '';
  }

  return `
    <details class="reasoning-card">
      <summary>思维链</summary>
      <div class="rich-content">${toHtml(message.reasoning)}</div>
    </details>
  `;
}

function renderMessage(message: ChatMessage): string {
  const sectionMarkup =
    state.viewMode !== 'clean' && state.renderCards
      ? message.sections.map((section) => renderSection(section)).join('')
      : '';

  return `
    <article class="message-card ${message.role}">
      <header class="message-header">
        <div>
          <p class="speaker">${escapeHtml(message.speaker)}</p>
          <div class="meta-row">
            <span class="meta-pill">${roleLabel(message)}</span>
            ${message.swipeCount > 0 ? `<span class="meta-pill">Swipe ${message.swipeCount}</span>` : ''}
            ${message.timestamp ? `<span class="meta-pill">${escapeHtml(new Date(message.timestamp).toLocaleString())}</span>` : ''}
          </div>
        </div>
        <span class="message-index">#${message.id + 1}</span>
      </header>
      <div class="message-body">
        ${renderBody(message)}
        ${renderReasoning(message)}
        ${sectionMarkup}
      </div>
    </article>
  `;
}

function renderEmptyState(): string {
  return `
    <div class="empty-stage">
      <p class="eyebrow">No file loaded</p>
      <h3>导入一份 SillyTavern 聊天记录开始预览</h3>
      <p>
        这个工具会自动识别正文、思维链、摘要、状态栏、HTML 卡片和前端块。
        导出时可以只保留正文，也可以保留当前主题下的完整页面。
      </p>
    </div>
  `;
}

function renderStats(): string {
  if (!state.transcript) {
    return `<div class="empty-inline">还没有导入文件。</div>`;
  }

  return `
    <div class="stats-grid">
      <div class="status-item">
        <span>文件</span>
        <strong>${escapeHtml(state.transcript.fileName)}</strong>
      </div>
      <div class="status-item">
        <span>格式</span>
        <strong>${escapeHtml(state.transcript.format.toUpperCase())}</strong>
      </div>
      <div class="status-item">
        <span>消息数</span>
        <strong>${state.transcript.stats.messageCount}</strong>
      </div>
      <div class="status-item">
        <span>说话人</span>
        <strong>${state.transcript.stats.speakerCount}</strong>
      </div>
      <div class="status-item">
        <span>可渲染区块</span>
        <strong>${state.transcript.stats.renderedSectionCount}</strong>
      </div>
    </div>
  `;
}

function renderTopbarBadges(): string {
  if (!state.transcript) {
    return '<span class="meta-pill">等待导入</span>';
  }

  const labels = [
    state.viewMode === 'clean' ? '正文净化' : state.viewMode === 'hybrid' ? '混合视图' : '原始文本',
    state.showReasoning ? '显示思维链' : '隐藏思维链',
    state.renderCards ? '渲染卡片' : '纯文本区块',
  ];

  return labels.map((label) => `<span class="meta-pill">${escapeHtml(label)}</span>`).join('');
}

function renderTranscript(): void {
  document.documentElement.dataset.theme = state.theme;
  stage.innerHTML = state.transcript ? state.transcript.messages.map((message) => renderMessage(message)).join('') : renderEmptyState();
  statsContent.innerHTML = renderStats();
  topbarBadges.innerHTML = renderTopbarBadges();

  viewMode.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === state.viewMode);
  });

  exportHtmlButton.disabled = !state.transcript;
  exportTextButton.disabled = !state.transcript;
}

function saveBlob(content: string, type: string, fileName: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildExportBody(): string {
  if (!state.transcript) {
    return renderEmptyState();
  }

  return `
    <div class="export-shell">
      <header class="export-header">
        <p class="eyebrow">Exported from SillyTavern Export Viewer</p>
        <h1>${escapeHtml(state.transcript.fileName)}</h1>
        <div class="topbar-badges">${renderTopbarBadges()}</div>
      </header>
      <section class="chat-stage">
        ${state.transcript.messages.map((message) => renderMessage(message)).join('')}
      </section>
    </div>
  `;
}

function exportHtml(): void {
  if (!state.transcript) return;

  const html = `<!doctype html>
<html lang="zh-CN" data-theme="${state.theme}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(state.transcript.fileName)}</title>
    <style>${appCss}</style>
  </head>
  <body>
    ${buildExportBody()}
  </body>
</html>`;

  saveBlob(html, 'text/html;charset=utf-8', `${slugify(state.transcript.fileName) || 'chat-export'}.html`);
}

function exportText(): void {
  if (!state.transcript) return;

  const content = state.transcript.messages
    .map((message) => `${message.speaker}: ${getPlainBody(message)}`)
    .filter((line) => line.trim())
    .join('\n\n');

  saveBlob(content, 'text/plain;charset=utf-8', `${slugify(state.transcript.fileName) || 'chat-export'}-clean.txt`);
}

async function handleFile(file: File): Promise<void> {
  const content = await file.text();
  state.transcript = parseTranscript(file.name, content);
  renderTranscript();
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  await handleFile(file);
});

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('is-dragging');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('is-dragging');
});

dropZone.addEventListener('drop', async (event) => {
  event.preventDefault();
  dropZone.classList.remove('is-dragging');
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  await handleFile(file);
});

dropZone.addEventListener('click', () => fileInput.click());

themeSelect.addEventListener('change', () => {
  state.theme = themeSelect.value as ThemeName;
  window.localStorage.setItem('st-viewer-theme', state.theme);
  renderTranscript();
});

toggleReasoning.addEventListener('change', () => {
  state.showReasoning = toggleReasoning.checked;
  window.localStorage.setItem('st-viewer-reasoning', String(state.showReasoning));
  renderTranscript();
});

toggleCards.addEventListener('change', () => {
  state.renderCards = toggleCards.checked;
  window.localStorage.setItem('st-viewer-cards', String(state.renderCards));
  renderTranscript();
});

viewMode.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-mode]');
  if (!button?.dataset.mode) return;
  state.viewMode = button.dataset.mode as ViewMode;
  window.localStorage.setItem('st-viewer-mode', state.viewMode);
  renderTranscript();
});

exportHtmlButton.addEventListener('click', exportHtml);
exportTextButton.addEventListener('click', exportText);

renderTranscript();

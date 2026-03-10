import type { ChatMessage, MessageRole, MessageSection, StatusPair, TranscriptData } from './types.ts';

const USER_HINTS = new Set(['you', 'user', 'me', 'myself', 'prime', '{{user}}', '主人', '用户', '我']);
const BODY_TAGS = ['正文内容', '正文', 'content', 'message', 'response', 'reply'];
const REASONING_TAGS = ['思维链', '思考过程', '思维', 'reasoning', 'thinking', 'thoughts', 'cot'];
const TXT_STOPWORDS = new Set([
  '任务',
  '摘要',
  '日期',
  '时间',
  '地点',
  '人物',
  '内容摘要',
  '关键信息',
  '关键道具',
  '常规性错误',
  '写作过程',
  '剧情设计',
  '精修稿',
  'status',
  'summary',
  'date',
  'time',
  'location',
  'content',
  'note',
  'task',
]);
const STANDARD_HTML_TAGS = new Set([
  'a',
  'article',
  'aside',
  'b',
  'blockquote',
  'body',
  'br',
  'button',
  'code',
  'details',
  'div',
  'em',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hr',
  'html',
  'i',
  'iframe',
  'img',
  'li',
  'main',
  'mark',
  'meter',
  'nav',
  'ol',
  'p',
  'pre',
  'progress',
  'section',
  'small',
  'span',
  'strong',
  'style',
  'summary',
  'svg',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
]);

function makeId(prefix: string, index: number): string {
  return `${prefix}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeLineBreaks(input: string): string {
  return input.replace(/\r\n?/g, '\n');
}

function cleanupCounters(input: string): string {
  return input
    .replace(/<zs>\s*\d+\s*<\/zs>/gi, '')
    .replace(/[ \t]*正文总字数[:：]?\s*\d+[ \t]*/g, '')
    .replace(/[ \t]*总字数[:：]?\s*\d+[ \t]*/g, '');
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, '');
}

function cleanupText(input: string): string {
  return cleanupCounters(stripTags(input))
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractTagBlock(input: string, tags: string[]): { value: string; rest: string } {
  for (const tag of tags) {
    const regex = new RegExp(`<${escapeRegExp(tag)}>([\\s\\S]*?)<\\/${escapeRegExp(tag)}>`, 'i');
    const match = input.match(regex);
    if (!match) continue;
    return {
      value: cleanupCounters(match[1].trim()),
      rest: input.replace(match[0], '').trim(),
    };
  }

  return { value: '', rest: input };
}

function isFrontendHtml(input: string): boolean {
  return /<(?:!doctype\s+html|html|head|body)\b/i.test(input);
}

function looksLikeHtmlFragment(input: string): boolean {
  return /<(?:div|section|table|progress|meter|span|article|header|footer)\b/i.test(input);
}

function looksLikeMarkdownTable(input: string): boolean {
  return /\|.+\|/.test(input) && /\|\s*[-:]+\s*(?:\|\s*[-:]+\s*)+\|/.test(input);
}

function extractStatusPairs(input: string): StatusPair[] {
  const pairs = input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^[-*]?\s*([^:：|]{1,24})[:：]\s*(.+)$/);
      if (!match) return null;
      return { key: match[1].trim(), value: match[2].trim() };
    })
    .filter((pair): pair is StatusPair => Boolean(pair));

  return pairs.length >= 2 ? pairs : [];
}

function createSection(title: string, content: string, index: number): MessageSection {
  const pairs = extractStatusPairs(cleanupCounters(content));
  const trimmed = cleanupCounters(content).trim();

  if (isFrontendHtml(trimmed)) {
    return { id: makeId('section', index), title, kind: 'frontend', content: trimmed, open: true };
  }

  if (pairs.length > 0) {
    return { id: makeId('section', index), title, kind: 'status', content: trimmed, pairs, open: true };
  }

  if (looksLikeHtmlFragment(trimmed)) {
    return { id: makeId('section', index), title, kind: 'html', content: trimmed, open: true };
  }

  if (looksLikeMarkdownTable(trimmed) || /[#>*`\-]/.test(trimmed)) {
    return { id: makeId('section', index), title, kind: 'markdown', content: trimmed, open: false };
  }

  return { id: makeId('section', index), title, kind: 'details', content: trimmed, open: false };
}

function extractDetailsSections(input: string): { sections: MessageSection[]; rest: string } {
  const sections: MessageSection[] = [];
  let rest = input;
  const regex = /<details\b[^>]*>([\s\S]*?)<\/details>/gi;
  let match: RegExpExecArray | null = null;
  let index = 0;

  while ((match = regex.exec(input)) !== null) {
    const summaryMatch = match[1].match(/<summary>([\s\S]*?)<\/summary>/i);
    const title = cleanupText(summaryMatch?.[1] ?? '详情') || '详情';
    const content = match[1].replace(/<summary>[\s\S]*?<\/summary>/i, '').trim();
    sections.push(createSection(title, content, index));
    rest = rest.replace(match[0], '').trim();
    index += 1;
  }

  return { sections, rest };
}

function extractCustomTagSections(input: string): { sections: MessageSection[]; rest: string } {
  const sections: MessageSection[] = [];
  let rest = input;
  const regex = /<([^\s/>]+)>([\s\S]*?)<\/\1>/gu;
  let match: RegExpExecArray | null = null;
  let index = 0;

  while ((match = regex.exec(input)) !== null) {
    const tagName = match[1].trim();
    const lowered = tagName.toLowerCase();

    if (STANDARD_HTML_TAGS.has(lowered)) continue;
    if (BODY_TAGS.map((tag) => tag.toLowerCase()).includes(lowered)) continue;
    if (REASONING_TAGS.map((tag) => tag.toLowerCase()).includes(lowered)) continue;
    if (lowered === 'zs') continue;

    const content = cleanupCounters(match[2]).trim();
    if (!content) continue;

    sections.push(createSection(tagName, content, index));
    rest = rest.replace(match[0], '').trim();
    index += 1;
  }

  return { sections, rest };
}

function extractCodeFenceSections(input: string): { sections: MessageSection[]; rest: string } {
  const sections: MessageSection[] = [];
  let rest = input;
  const regex = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null = null;
  let index = 0;

  while ((match = regex.exec(input)) !== null) {
    const language = (match[1] ?? '').toLowerCase();
    const content = match[2].trim();
    if (!content) continue;

    if (language === 'html' || language === 'frontend' || isFrontendHtml(content)) {
      sections.push({
        id: makeId('code', index),
        title: language === 'frontend' ? '前端卡片' : 'HTML 卡片',
        kind: isFrontendHtml(content) ? 'frontend' : 'html',
        content,
        open: true,
      });
      rest = rest.replace(match[0], '').trim();
      index += 1;
    }
  }

  return { sections, rest };
}

function parseStructuredContent(raw: string, extraReasoning = ''): Pick<ChatMessage, 'body' | 'cleanedText' | 'reasoning' | 'sections'> {
  let working = normalizeLineBreaks(raw).trim();
  const sections: MessageSection[] = [];

  const codeFenceResult = extractCodeFenceSections(working);
  sections.push(...codeFenceResult.sections);
  working = codeFenceResult.rest;

  const reasoningResult = extractTagBlock(working, REASONING_TAGS);
  const reasoning = cleanupText(extraReasoning || reasoningResult.value);
  working = reasoningResult.rest;

  const bodyResult = extractTagBlock(working, BODY_TAGS);
  let body = cleanupCounters(bodyResult.value).trim();
  working = bodyResult.rest;

  const detailsResult = extractDetailsSections(working);
  sections.push(...detailsResult.sections);
  working = detailsResult.rest;

  const customSectionResult = extractCustomTagSections(working);
  sections.push(...customSectionResult.sections);
  working = customSectionResult.rest;

  const fallback = cleanupCounters(working).trim();
  if (!body) {
    body = fallback;
  }

  if (!body && sections.length > 0) {
    body = sections[0]?.content ?? '';
  }

  if (!body && reasoning) {
    body = '';
  }

  return {
    body: body.trim(),
    cleanedText: cleanupText(body || fallback || raw),
    reasoning,
    sections,
  };
}

function inferRoleFromSpeaker(speaker: string, fallback: MessageRole): MessageRole {
  const normalized = speaker.trim().toLowerCase();
  if (USER_HINTS.has(normalized)) return 'user';
  if (normalized.includes('system') || normalized.includes('旁白') || normalized.includes('系统')) return 'system';
  return fallback;
}

function countMatches(input: string, regex: RegExp): number {
  const matches = input.match(regex);
  return matches ? matches.length : 0;
}

function updateStructuredBlockDepth(line: string, depth: number, codeFenceOpen: boolean): { depth: number; codeFenceOpen: boolean } {
  const fenceCount = countMatches(line, /```/g);
  if (fenceCount % 2 === 1) {
    codeFenceOpen = !codeFenceOpen;
  }

  if (codeFenceOpen) {
    return { depth, codeFenceOpen };
  }

  const knownTags = new Set([...BODY_TAGS, ...REASONING_TAGS, '破限']);
  for (const tag of knownTags) {
    depth += countMatches(line, new RegExp(`<${escapeRegExp(tag)}(?=>)`, 'g'));
    depth -= countMatches(line, new RegExp(`</${escapeRegExp(tag)}>`, 'g'));
  }

  depth += countMatches(line, /<details\b[^>]*>/gi);
  depth -= countMatches(line, /<\/details>/gi);

  const customOpenTags = [...line.matchAll(/<([^\s/>]+)>/gu)].map((match) => match[1]);
  const customCloseTags = [...line.matchAll(/<\/([^\s>]+)>/gu)].map((match) => match[1]);

  for (const tag of customOpenTags) {
    if (STANDARD_HTML_TAGS.has(tag.toLowerCase()) || knownTags.has(tag) || tag.toLowerCase() === 'zs') continue;
    depth += 1;
  }

  for (const tag of customCloseTags) {
    if (STANDARD_HTML_TAGS.has(tag.toLowerCase()) || knownTags.has(tag) || tag.toLowerCase() === 'zs') continue;
    depth -= 1;
  }

  return { depth: Math.max(depth, 0), codeFenceOpen };
}

function finalizeStats(fileName: string, format: TranscriptData['format'], messages: ChatMessage[], metadata: Record<string, unknown>): TranscriptData {
  return {
    fileName,
    format,
    messages,
    metadata,
    stats: {
      messageCount: messages.length,
      speakerCount: new Set(messages.map((message) => message.speaker)).size,
      renderedSectionCount: messages.reduce((total, message) => total + message.sections.length + (message.reasoning ? 1 : 0), 0),
    },
  };
}

function parseJsonl(fileName: string, input: string): TranscriptData {
  const lines = normalizeLineBreaks(input)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  const first = parsed[0] ?? {};
  const hasHeader = !('mes' in first) && 'chat_metadata' in first;
  const metadata = hasHeader ? ((first.chat_metadata as Record<string, unknown>) ?? {}) : {};
  const entries = hasHeader ? parsed.slice(1) : parsed;

  const messages = entries
    .filter((entry) => typeof entry.mes === 'string' || Array.isArray(entry.swipes))
    .map((entry, index) => {
      const raw = String(entry.mes ?? (Array.isArray(entry.swipes) ? entry.swipes[0] : '') ?? '');
      const extra = (entry.extra as Record<string, unknown> | undefined) ?? {};
      const structured = parseStructuredContent(raw, String(extra.reasoning ?? ''));
      const role: MessageRole = entry.is_system
        ? 'system'
        : entry.is_user
          ? 'user'
          : inferRoleFromSpeaker(String(entry.name ?? 'Assistant'), 'assistant');

      return {
        id: index,
        speaker: String(entry.name ?? (role === 'user' ? 'User' : 'Assistant')),
        role,
        raw,
        body: structured.body,
        cleanedText: structured.cleanedText,
        reasoning: structured.reasoning,
        sections: structured.sections,
        swipeCount: Array.isArray(entry.swipes) ? entry.swipes.length : 0,
        timestamp: typeof entry.send_date === 'string' ? entry.send_date : undefined,
        source: 'jsonl',
      } satisfies ChatMessage;
    });

  return finalizeStats(fileName, 'jsonl', messages, metadata);
}

function parseTxt(fileName: string, input: string): TranscriptData {
  const lines = normalizeLineBreaks(input).split('\n');
  const messageStart = /^([^:\n]{1,80})[:：]\s?(.*)$/;
  const candidateCounts = new Map<string, number>();

  for (const line of lines) {
    if (/^\s*</.test(line)) continue;
    const match = line.match(messageStart);
    if (!match) continue;

    const label = match[1].trim();
    const normalized = label.toLowerCase();
    if (TXT_STOPWORDS.has(label) || TXT_STOPWORDS.has(normalized)) continue;
    if (label.length > 32) continue;

    candidateCounts.set(label, (candidateCounts.get(label) ?? 0) + 1);
  }

  const speakerWhitelist = new Set(
    [...candidateCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 24)
      .map(([label]) => label),
  );

  const chunks: Array<{ speaker: string; content: string[] }> = [];
  let current: { speaker: string; content: string[] } | null = null;
  let blockDepth = 0;
  let codeFenceOpen = false;

  for (const line of lines) {
    const match = line.match(messageStart);
    const looksLikeTag = /^\s*</.test(line);
    const label = match?.[1]?.trim() ?? '';
    const isCandidateSpeaker = Boolean(match) && speakerWhitelist.has(label);

    if (match && !looksLikeTag && blockDepth === 0 && !codeFenceOpen && isCandidateSpeaker) {
      if (current) chunks.push(current);
      current = { speaker: match[1].trim(), content: [match[2]] };
      const openingState = updateStructuredBlockDepth(match[2], 0, false);
      blockDepth = openingState.depth;
      codeFenceOpen = openingState.codeFenceOpen;
      continue;
    }

    if (!current) {
      current = { speaker: 'Narrator', content: [line] };
    } else {
      current.content.push(line);
    }

    const nextState = updateStructuredBlockDepth(line, blockDepth, codeFenceOpen);
    blockDepth = nextState.depth;
    codeFenceOpen = nextState.codeFenceOpen;
  }

  if (current) chunks.push(current);

  const seenSpeakers: string[] = [];
  const messages = chunks
    .map((chunk, index) => {
      if (!seenSpeakers.includes(chunk.speaker)) {
        seenSpeakers.push(chunk.speaker);
      }

      const fallback: MessageRole = seenSpeakers.length === 2 && seenSpeakers[1] === chunk.speaker ? 'user' : 'assistant';
      const structured = parseStructuredContent(chunk.content.join('\n').trim());

      return {
        id: index,
        speaker: chunk.speaker,
        role: inferRoleFromSpeaker(chunk.speaker, fallback),
        raw: chunk.content.join('\n').trim(),
        body: structured.body,
        cleanedText: structured.cleanedText,
        reasoning: structured.reasoning,
        sections: structured.sections,
        swipeCount: 0,
        source: 'txt',
      } satisfies ChatMessage;
    })
    .filter((message) => message.raw || message.body || message.reasoning || message.sections.length > 0);

  return finalizeStats(fileName, 'txt', messages, {});
}

export function parseTranscript(fileName: string, input: string): TranscriptData {
  const trimmed = input.trim();
  if (!trimmed) {
    return finalizeStats(fileName, 'txt', [], {});
  }

  try {
    const firstLine = normalizeLineBreaks(trimmed).split('\n').find(Boolean) ?? '';
    if (firstLine.startsWith('{')) {
      return parseJsonl(fileName, trimmed);
    }
  } catch {
    // Fall through to TXT mode when JSONL probing fails.
  }

  return parseTxt(fileName, trimmed);
}

export function getPlainBody(message: ChatMessage): string {
  return cleanupText(message.body || message.cleanedText || message.raw);
}

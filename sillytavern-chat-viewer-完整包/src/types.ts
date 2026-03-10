export type TranscriptFormat = 'txt' | 'jsonl';

export type ThemeName = 'amber-noir' | 'mist-paper' | 'neon-signal';

export type ViewMode = 'clean' | 'hybrid' | 'raw';

export type MessageRole = 'user' | 'assistant' | 'system';

export type SectionKind = 'details' | 'markdown' | 'html' | 'frontend' | 'status' | 'raw';

export interface StatusPair {
  key: string;
  value: string;
}

export interface MessageSection {
  id: string;
  title: string;
  kind: SectionKind;
  content: string;
  open?: boolean;
  pairs?: StatusPair[];
}

export interface ChatMessage {
  id: number;
  speaker: string;
  role: MessageRole;
  raw: string;
  body: string;
  cleanedText: string;
  reasoning: string;
  sections: MessageSection[];
  swipeCount: number;
  timestamp?: string;
  source?: string;
}

export interface TranscriptStats {
  messageCount: number;
  speakerCount: number;
  renderedSectionCount: number;
}

export interface TranscriptData {
  fileName: string;
  format: TranscriptFormat;
  messages: ChatMessage[];
  metadata: Record<string, unknown>;
  stats: TranscriptStats;
}


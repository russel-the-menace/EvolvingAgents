export type Mode = 'daily' | 'prepare' | 'formal' | 'memory';

export type Settings = {
  baseUrl: string;
  model: string;
};

export type DailyModel = 'deepseek-light' | 'deepseek-medium' | 'deepseek-high' | 'deepseek-ultra';

export type ThemeMode = 'light' | 'dark' | 'system';

export type InterviewPacket = {
  id: string;
  preparedAt: string;
  jd: string;
  resume: string;
  focusAreas: string[];
  questionTypes: string[];
  brief: string;
};

export type Message = {
  id: string;
  role: 'interviewer' | 'candidate';
  content: string;
  createdAt: string;
};

export type MemoryDocument = {
  id: string;
  title: string;
  sourceType: 'chatgpt_export' | 'note' | 'conversation' | 'short_video';
  content: string;
  createdAt: string;
  extractedAt?: string;
};

export type MemoryCandidate = {
  id: string;
  documentId: string;
  kind: 'experience' | 'skill' | 'preference' | 'viewpoint' | 'language_sample' | 'concept' | 'framework' | 'answer_pattern' | 'case_example';
  scope?: 'personal' | 'learning';
  title: string;
  content: string;
  tags: string[];
  sourceQuote: string;
  sourceMessageIds?: string[];
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
};

export type DailyMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

export type DailySession = {
  id: string;
  title: string;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
  messages: DailyMessage[];
};

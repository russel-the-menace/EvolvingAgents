export type Mode = 'daily' | 'prepare' | 'formal';

export type InterviewSummary = {
  id: string;
  sceneType: string;
  audience: string;
  jd: string;
  resume: string;
  createdAt: string;
};
export type MaterialInput = { text?: string; name?: string; mime?: string; data?: string };

export type Settings = {
  baseUrl: string;
  model: string;
};

export type DailyModel = 'deepseek-light' | 'deepseek-medium' | 'deepseek-high' | 'deepseek-ultra';

export type ThemeMode = 'light' | 'dark' | 'system';

export type InterviewPacket = {
  id: string;
  sceneId: string;
  preparedAt: string;
  jd: string;
  resume: string;
  focusAreas: string[];
  questionTypes: string[];
  brief: string;
  knowledgeClaims: Claim[];
  personalClaims: Claim[];
  expressionClaims: Claim[];
  writeBack: false;
};

export type EpistemicStatus = 'observed' | 'understood' | 'contested' | 'endorsed' | 'superseded' | 'rejected';
export type AuthorizationScope = 'none' | 'reasoning_use' | 'personal_view' | 'personal_experience' | 'scene_fact';

export type Claim = {
  id: string;
  title: string;
  proposition: string;
  kind: string;
  owner: 'user' | 'external' | 'third_party' | 'inferred';
  epistemicStatus: EpistemicStatus;
  authorizationScope: AuthorizationScope;
  contextScope: string[];
  tags: string[];
  confidence: number;
  sceneId?: string;
  createdAt: string;
  updatedAt: string;
};

export type AnswerPlan = {
  question: string;
  sceneId: string;
  thesisInstruction: string;
  knowledgeClaimIds: string[];
  personalClaimIds: string[];
  experiencePolicy: string;
  followupConstraints: string[];
  contextRunId: string;
};

export type FormalContextMessage = { role: 'user' | 'assistant'; content: string };

export type Message = {
  id: string;
  role: 'interviewer' | 'candidate';
  content: string;
  createdAt: string;
};

export type MemoryDocument = {
  id: string;
  title: string;
  sourceType: 'chatgpt_export' | 'note' | 'conversation' | 'short_video' | 'resume' | 'job_description' | 'article' | 'paper' | 'podcast';
  content: string;
  createdAt: string;
  extractedAt?: string;
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

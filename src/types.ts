export type Mode = 'prepare' | 'formal';

export type Settings = {
  baseUrl: string;
  model: string;
};

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

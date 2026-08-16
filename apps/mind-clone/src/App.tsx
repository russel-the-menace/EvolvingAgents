import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatConversation, ChatSidebar, useChatController, useChatPreferences, type ChatAdapter, type ChatMessage, type ChatTheme } from '@evolving-agents/chat-ui';
import {
  ArrowDown, ArrowRight, BotMessageSquare, CheckCircle2, CircleStop, FileText,
  FileUp, ListChecks, Mic, Paperclip, Play,
  PanelLeftOpen, Plus, SendHorizontal, Sparkles, Video, Volume2,
} from 'lucide-react';
import { streamCandidateAnswer } from './interview';
import { memoryApi } from './memory-api';
import { loadPacket, loadSettings, savePacket } from './storage';
import type { DailyModel, DailySession, InterviewPacket, Message, Mode, Settings } from './types';

const exampleJD = `Remote Backend Engineer
Own server-side APIs, database design, performance tuning, and production reliability. Comfortable with a mainstream backend language, SQL, Redis, Docker, and distributed systems fundamentals; able to clarify requirements and deliver independently.`;

const exampleResume = `Started in Android development after graduation, then built a startup and worked remotely for an extended period. During the startup journey, took on product, user operations, customer support, sales, and recruiting work; continued building backend engineering skills with a demonstrated ability to learn across languages and deliver independently.`;

const dailyChatAdapter: ChatAdapter<DailySession> = {
  listSessions: async () => (await memoryApi.listSessions()).sessions,
  createSession: async () => (await memoryApi.createSession()).session,
  updateSession: async (sessionId, values) => (await memoryApi.updateSession(sessionId, values)).session,
  deleteSession: (sessionId) => memoryApi.deleteSession(sessionId),
  send: ({ sessionId, content, model, replaceFromMessageId, signal, onDelta }) => memoryApi.streamChat(sessionId, content, onDelta, signal, replaceFromMessageId, model as DailyModel),
};

function formatPreparedAt(value: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function MarkdownText({ content }: { content: string }) {
  return <div className="rich-text"><ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      p: ({ node, children }) => {
        const meaningfulChildren = node?.children.filter((child) => child.type !== 'text' || child.value.trim()) ?? [];
        const standaloneStrong = meaningfulChildren.length === 1
          && meaningfulChildren[0].type === 'element'
          && meaningfulChildren[0].tagName === 'strong';
        return <p className={standaloneStrong ? 'standalone-strong' : undefined}>{children}</p>;
      },
      table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
    }}
  >{content}</ReactMarkdown></div>;
}

function ThinkingIndicator() {
  return <span className="thinking-indicator" role="status" aria-live="polite"><span className="thinking-label">Thinking</span><span /><span /><span /></span>;
}

export function App() {
  const [mode, setMode] = useState<Mode>('daily');
  const [jd, setJd] = useState('');
  const [resume, setResume] = useState('');
  const [packet, setPacket] = useState<InterviewPacket | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const preferences = useChatPreferences<DailyModel>({ themeKey: 'mindclone-theme', modelKey: 'mindclone.daily-model', sidebarWidthKey: 'mindclone-sidebar-width', defaultTheme: 'light', defaultModel: 'deepseek-medium', parseModel: (saved) => saved === 'deepseek-high' ? 'deepseek-high' : 'deepseek-medium' });
  const dailyChat = useChatController(dailyChatAdapter, preferences.model);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const formalFollowingRef = useRef(true);
  const [showFormalScrollButton, setShowFormalScrollButton] = useState(false);
  const formalScrollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const stored = loadPacket();
    if (stored) {
      setPacket(stored);
      setJd(stored.jd);
      setResume(stored.resume);
    }
  }, []);


  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript && formalFollowingRef.current) transcript.scrollTo({ top: transcript.scrollHeight });
  }, [messages, streaming]);

  function updateFormalScrollPosition() {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const atBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <= 24;
    formalFollowingRef.current = atBottom;
    if (atBottom) {
      if (formalScrollTimerRef.current) window.clearTimeout(formalScrollTimerRef.current);
      formalScrollTimerRef.current = null;
      setShowFormalScrollButton(false);
    } else if (!formalScrollTimerRef.current && !showFormalScrollButton) {
      formalScrollTimerRef.current = window.setTimeout(() => {
        formalScrollTimerRef.current = null;
        setShowFormalScrollButton(true);
      }, 1000);
    }
  }

  function scrollFormalToBottom() {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    formalFollowingRef.current = true;
    if (formalScrollTimerRef.current) window.clearTimeout(formalScrollTimerRef.current);
    formalScrollTimerRef.current = null;
    transcript.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
    setShowFormalScrollButton(false);
  }

  const ready = jd.trim().length > 40 && resume.trim().length > 40;
  const messageCount = messages.filter((message) => message.role === 'interviewer').length;
  const candidateDraft = useMemo(
    () => messages.at(-1)?.role === 'candidate' ? messages.at(-1)?.content ?? '' : '',
    [messages],
  );

  async function prepare() {
    try {
      const { scene } = await memoryApi.compileScene({ jd, resume, audience: 'HR or hiring interviewer', goal: 'Answer as the scene-appropriate professional self while remaining consistent under follow-up.' });
      const focusAreas = [...scene.personalClaims, ...scene.knowledgeClaims].slice(0, 6).map((claim) => claim.title);
      const next: InterviewPacket = {
        id: scene.id,
        sceneId: scene.id,
        preparedAt: new Date().toISOString(),
        jd,
        resume,
        focusAreas: focusAreas.length ? focusAreas : ['Submitted resume', 'Target role requirements'],
        questionTypes: ['Role fit', 'Industry judgment', 'Authorized experience deep dive', 'Adversarial follow-up', 'Motivation and collaboration'],
        brief: `Use the submitted resume as the scene-local identity source, supported by ${scene.personalClaims.length} authorized personal claims and ${scene.knowledgeClaims.length} understood knowledge claims.`,
        knowledgeClaims: scene.knowledgeClaims,
        personalClaims: scene.personalClaims,
        expressionClaims: scene.expressionClaims,
        writeBack: false,
      };
      setPacket(next);
      savePacket(next);
      setError('');
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  function enterFormal() {
    if (!packet) return;
    abortRef.current?.abort();
    setMessages([]);
    setInput('');
    setError('');
    setMode('formal');
  }

  function stopGeneration() {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }

  async function askQuestion(interrupt = false) {
    const question = input.trim();
    if (!question || !packet || (streaming && !interrupt)) return;
    if (interrupt) stopGeneration();
    const interviewerMessage: Message = {
      id: crypto.randomUUID(), role: 'interviewer', content: question, createdAt: new Date().toISOString(),
    };
    const answerMessage: Message = {
      id: crypto.randomUUID(), role: 'candidate', content: '', createdAt: new Date().toISOString(),
    };
    const nextMessages = [...messages, interviewerMessage, answerMessage];
    setMessages(nextMessages);
    setInput('');
    setError('');
    setStreaming(true);
    const controller = new AbortController();
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    abortRef.current = controller;

    try {
      const { plan, claims, transcriptMessages } = await memoryApi.planAnswer(packet.sceneId, question);
      let completedAnswer = '';
      await streamCandidateAnswer(settings, packet, plan, claims, transcriptMessages, (delta) => {
        completedAnswer += delta;
        setMessages((current) => current.map((message) =>
          message.id === answerMessage.id ? { ...message, content: message.content + delta } : message,
        ));
      }, controller.signal);
      const { audit } = await memoryApi.completeAnswer(packet.sceneId, { question, plan, answer: completedAnswer });
      if (!audit.passed) setError(`Answer audit flagged: ${audit.violations.map((violation) => violation.type).join(', ')}. Review before using this answer.`);
    } catch (caught) {
      if ((caught as Error).name !== 'AbortError') {
        const message = (caught as Error).message;
        setError(
          message === 'Failed to fetch'
            ? 'Unable to connect to the custom API gateway. Check the MindClone API service and gateway configuration.'
            : message,
        );
      }
    } finally {
      if (generationRef.current === generation) {
        abortRef.current = null;
        setStreaming(false);
      }
    }
  }

  function interruptWithDraft() {
    if (!input.trim()) return;
    void askQuestion(true);
  }

  async function importChatGPT(file: File) {
    const contents = extractChatGPTConversations(JSON.parse(await file.text()));
    if (!contents.length) throw new Error('No readable user/assistant conversations were found in this export.');
    const batches: string[] = [];
    let current = '';
    for (const item of contents) {
      const section = `# ${item.title}\n\n${item.content}\n\n`;
      if (current && current.length + section.length > 1_800_000) { batches.push(current); current = ''; }
      current += section;
    }
    if (current) batches.push(current);
    for (const [index, content] of batches.entries()) {
      await memoryApi.importDocument({
        title: batches.length === 1 ? `ChatGPT history (${contents.length} conversations)` : `ChatGPT history ${index + 1}/${batches.length}`,
        content,
        sourceType: 'chatgpt_export',
      });
    }
  }

  return (
    <main className={`app-shell ${preferences.sidebarCollapsed ? 'sidebar-collapsed' : ''}`} style={{ '--app-sidebar-width': `${preferences.sidebarWidth}px` } as CSSProperties}>
      <AppSidebar sessions={dailyChat.sessions} activeSessionId={dailyChat.activeSessionId} newChatActive={dailyChat.newChatActive} mode={mode} hasPacket={Boolean(packet)}
        sidebarWidth={preferences.sidebarWidth} onSidebarWidthChange={preferences.setSidebarWidth}
        onToggleSidebar={() => preferences.setSidebarCollapsed((current) => !current)} onModeChange={setMode} onOpenSettings={() => setShowSettings(true)}
        onNewChat={() => { dailyChat.newChat(); setMode('daily'); }}
        onSelectSession={(id) => { dailyChat.selectSession(id); setMode('daily'); }}
        onUpdate={(session, values) => void dailyChat.updateSession(session, values)} onDelete={(session) => void dailyChat.deleteSession(session)} />
      {preferences.sidebarCollapsed && <button className="sidebar-reopen" title="Expand sidebar" onClick={() => preferences.setSidebarCollapsed(false)}><PanelLeftOpen size={19} /></button>}
      <section className="workspace">
        {mode === 'daily' ? (
          <DailyChatView messages={dailyChat.messages} input={dailyChat.input} streaming={dailyChat.streaming} error={dailyChat.error} model={preferences.model}
            onModelChange={preferences.setModel}
            onInputChange={dailyChat.setInput} onSend={dailyChat.send} onError={dailyChat.setError} onImport={importChatGPT} />
        ) : mode === 'prepare' ? (
          <PrepareView
            jd={jd} resume={resume} packet={packet} ready={ready}
            onJdChange={setJd} onResumeChange={setResume} onPrepare={() => void prepare()}
            onEnter={enterFormal} onUseExample={() => { setJd(exampleJD); setResume(exampleResume); }}
          />
        ) : packet ? (
          <FormalView
            packet={packet} messages={messages} input={input} error={error} streaming={streaming}
            candidateDraft={candidateDraft} messageCount={messageCount} transcriptRef={transcriptRef}
            showScrollButton={showFormalScrollButton} onScroll={updateFormalScrollPosition} onScrollToBottom={scrollFormalToBottom}
            onInputChange={setInput} onAsk={() => void askQuestion()} onStop={stopGeneration}
            onInterrupt={() => void interruptWithDraft()} onBack={() => { stopGeneration(); setMode('prepare'); }}
          />
        ) : null}
      </section>

      {showSettings && <SettingsDialog theme={preferences.theme} onThemeChange={preferences.setTheme} onClose={() => setShowSettings(false)} />}
    </main>
  );
}

function extractChatGPTConversations(value: unknown) {
  if (!Array.isArray(value)) throw new Error('该文件不是 ChatGPT conversations.json 数组。');
  return value.flatMap((conversation: any) => {
    const mapping = conversation?.mapping;
    if (!mapping || typeof mapping !== 'object') return [];
    const messages = Object.values(mapping).flatMap((node: any) => {
      const role = node?.message?.author?.role;
      const parts = node?.message?.content?.parts;
      if (!['user', 'assistant'].includes(role) || !Array.isArray(parts)) return [];
      const text = parts.filter((part: unknown) => typeof part === 'string').join('\n').trim();
      return text ? [`${role === 'user' ? 'User' : 'ChatGPT'}: ${text}`] : [];
    });
    if (!messages.length) return [];
    return [{ title: conversation.title || 'ChatGPT conversation', content: messages.join('\n\n') }];
  });
}

function AppSidebar({ sessions, activeSessionId, newChatActive, mode, hasPacket, sidebarWidth, onSidebarWidthChange, onToggleSidebar, onModeChange, onOpenSettings, onNewChat, onSelectSession, onUpdate, onDelete }: {
  sessions: DailySession[]; activeSessionId: string | null; newChatActive: boolean; mode: Mode; hasPacket: boolean; sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void; onToggleSidebar: () => void; onModeChange: (mode: Mode) => void; onOpenSettings: () => void; onNewChat: () => void; onSelectSession: (id: string) => void;
  onUpdate: (session: DailySession, values: Partial<Pick<DailySession, 'title' | 'pinned'>>) => void; onDelete: (session: DailySession) => void;
}) {
  function renameSession(session: DailySession) { const title = window.prompt('Rename conversation', session.title)?.trim(); if (title && title !== session.title) onUpdate(session, { title }); }
  function deleteSession(session: DailySession) { if (window.confirm(`Delete “${session.title}” and all messages in it? Learned claims remain available unless explicitly superseded in conversation.`)) onDelete(session); }
  return <ChatSidebar brand="MindClone" brandIcon={<Sparkles size={21} />} sessions={sessions} activeSessionId={newChatActive ? null : activeSessionId} width={sidebarWidth} onWidthChange={onSidebarWidthChange} onCollapse={onToggleSidebar} onNewChat={onNewChat} onSelectSession={onSelectSession} onSettings={onOpenSettings} status="Local engine" nav={<><button className={mode === 'prepare' ? 'active' : ''} onClick={() => onModeChange('prepare')}><FileText size={16} />Interview prep</button><button className={mode === 'formal' ? 'active' : ''} disabled={!hasPacket} onClick={() => hasPacket && onModeChange('formal')}><BotMessageSquare size={16} />Live interview</button></>} onPin={(session) => onUpdate(session as DailySession, { pinned: !session.pinned })} onRename={(session) => renameSession(session as DailySession)} onDelete={(session) => deleteSession(session as DailySession)} />;
}

function DailyChatView({ messages, input, streaming, error, model, onModelChange, onInputChange, onSend, onError, onImport }: {
  messages: ChatMessage[]; input: string; streaming: boolean; error: string;
  model: DailyModel; onModelChange: (model: DailyModel) => void;
  onInputChange: (value: string) => void; onSend: (content?: string, replaceFromMessageId?: string) => Promise<void>;
  onError: (value: string) => void; onImport: (file: File) => Promise<void>;
}) {
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [attachmentMode, setAttachmentMode] = useState<'note' | 'video' | null>(null);
  const [attachmentNote, setAttachmentNote] = useState('');
  const [shortVideoShare, setShortVideoShare] = useState('');
  const [shortVideoTitle, setShortVideoTitle] = useState('');
  const [shortVideoContent, setShortVideoContent] = useState('');
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function saveAttachmentNote() {
    if (attachmentNote.trim().length < 10) { setAttachmentStatus('Please enter at least one complete piece of source material.'); return; }
    setAttachmentBusy(true);
    try {
      const { claims } = await memoryApi.importDocument({ title: 'Conversation supplement', sourceType: 'note', content: attachmentNote.trim() });
      setAttachmentNote('');
      setAttachmentStatus(`Learned ${claims.length} claims. MindClone will discuss anything uncertain with you in chat.`);
    } catch (caught) { setAttachmentStatus((caught as Error).message); } finally { setAttachmentBusy(false); }
  }

  async function importFile(file: File) {
    setAttachmentBusy(true);
    try { await onImport(file); setAttachmentStatus('ChatGPT history learned. Questions will appear naturally in future chats.'); } catch (caught) { setAttachmentStatus((caught as Error).message); } finally { setAttachmentBusy(false); }
  }

  async function prepareShortVideo(transcribe: boolean) {
    if (!shortVideoShare.trim()) { setAttachmentStatus('Paste a Douyin share message first.'); return; }
    setAttachmentBusy(true);
    setAttachmentStatus(transcribe ? 'Transcribing speech locally...' : 'Reading the share link...');
    try {
      const prepared = transcribe
        ? await memoryApi.transcribeShortVideo(shortVideoShare)
        : await memoryApi.prepareShortVideo(shortVideoShare);
      setShortVideoTitle(prepared.title);
      setShortVideoContent(prepared.content);
      setAttachmentStatus(transcribe ? 'Transcript ready. Review it, then teach MindClone.' : 'Add or correct the spoken transcript below.');
    } catch (caught) { setAttachmentStatus((caught as Error).message); } finally { setAttachmentBusy(false); }
  }

  async function learnShortVideo() {
    if (shortVideoContent.trim().length < 10) { setAttachmentStatus('Transcribe the video or add its spoken transcript first.'); return; }
    setAttachmentBusy(true);
    try {
      const { claims } = await memoryApi.importDocument({ title: shortVideoTitle.trim() || 'Douyin learning material', sourceType: 'short_video', content: shortVideoContent.trim() });
      setShortVideoShare(''); setShortVideoTitle(''); setShortVideoContent('');
      setAttachmentStatus(`Learned ${claims.length} knowledge claims from the video audio. It has not analyzed any frames.`);
    } catch (caught) { setAttachmentStatus((caught as Error).message); } finally { setAttachmentBusy(false); }
  }

  const attachmentControl = <div className="attachment-area">{attachmentOpen && <div className="attachment-menu"><div className="attachment-menu-title">Teach MindClone</div><button onClick={() => fileRef.current?.click()}><FileUp size={17} /> Import ChatGPT history</button><button onClick={() => { setAttachmentMode('note'); setAttachmentStatus(''); }}><Paperclip size={17} /> Add text / Markdown</button><button onClick={() => { setAttachmentMode('video'); setAttachmentStatus(''); }}><Video size={17} /> Learn from Douyin audio</button>{attachmentMode === 'note' && <div className="attachment-editor"><textarea value={attachmentNote} onChange={(event) => setAttachmentNote(event.target.value)} placeholder="Paste notes or source material..." /><button className="primary-button compact" disabled={attachmentBusy} onClick={() => void saveAttachmentNote()}>{attachmentBusy ? 'Learning...' : 'Learn this text'}</button></div>}{attachmentMode === 'video' && <div className="attachment-editor video-editor"><textarea value={shortVideoShare} onChange={(event) => setShortVideoShare(event.target.value)} placeholder="Paste the Douyin share message or v.douyin.com link..." /><div className="attachment-actions"><button className="primary-button compact" disabled={attachmentBusy} onClick={() => void prepareShortVideo(true)}>{attachmentBusy ? 'Working...' : 'Transcribe audio'}</button><button className="ghost-button compact" disabled={attachmentBusy} onClick={() => void prepareShortVideo(false)}>Add transcript manually</button></div>{shortVideoContent && <><input value={shortVideoTitle} onChange={(event) => setShortVideoTitle(event.target.value)} placeholder="Video title" /><textarea className="transcript-editor" value={shortVideoContent} onChange={(event) => setShortVideoContent(event.target.value)} placeholder="Review the spoken transcript..." /><button className="primary-button compact" disabled={attachmentBusy} onClick={() => void learnShortVideo()}>{attachmentBusy ? 'Learning...' : 'Learn this transcript'}</button></>}</div>}{attachmentStatus && <p>{attachmentStatus}</p>}</div>}<input ref={fileRef} className="hidden-input" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.currentTarget.value = ''; }} /><button className={attachmentOpen ? 'plus-button open' : 'plus-button'} title="Add material" onClick={() => setAttachmentOpen((current) => !current)}><Plus size={21} /></button></div>;

  return <ChatConversation messages={messages} input={input} streaming={streaming} error={error} model={model} models={[{ id: 'deepseek-medium', name: 'DeepSeek Medium', detail: 'Balanced reasoning' }, { id: 'deepseek-high', name: 'DeepSeek High', detail: 'More thorough reasoning' }]} placeholder="Message MindClone..." askTarget="MindClone" empty={<><Sparkles size={32} /><h2>Start with what is on your mind</h2><p>MindClone learns from your conversations and asks for clarification when imported material needs your judgment.</p></>} onInputChange={onInputChange} onModelChange={(value) => onModelChange(value as DailyModel)} onSend={(content, replaceFromMessageId) => void onSend(content, replaceFromMessageId)} onEdit={(message, content) => void onSend(content, message.id)} leading={attachmentControl} />;
}

function PrepareView(props: {
  jd: string; resume: string; packet: InterviewPacket | null; ready: boolean;
  onJdChange: (value: string) => void; onResumeChange: (value: string) => void;
  onPrepare: () => void; onEnter: () => void; onUseExample: () => void;
}) {
  const { jd, resume, packet, ready, onJdChange, onResumeChange, onPrepare, onEnter, onUseExample } = props;
  return <div className="prepare-layout">
    <header className="page-header">
      <div><p className="eyebrow">INTERVIEW PACKET</p><h1>本次面试准备</h1><p className="subtle">先确定 JD 和投递简历，再进入低延迟正式会话。</p></div>
      <button className="ghost-button" onClick={onUseExample}>载入示例</button>
    </header>
    <div className="prepare-grid">
      <div className="input-stack">
        <label className="input-card"><span>职位描述 <small>JD</small></span><textarea value={jd} onChange={(event) => onJdChange(event.target.value)} placeholder="粘贴本次面试的 JD" /></label>
        <label className="input-card"><span>本次投递简历 <small>RESUME</small></span><textarea value={resume} onChange={(event) => onResumeChange(event.target.value)} placeholder="粘贴或导入投递给这家公司的简历文本" /></label>
        <button className="primary-button" disabled={!ready} onClick={onPrepare}><ListChecks size={18} /> 编译场景身份 <ArrowRight size={17} /></button>
      </div>
      <div className="brief-panel">
        {packet ? <>
          <div className="brief-top"><div><p className="eyebrow">READY TO REVIEW</p><h2>面试简报</h2></div><CheckCircle2 size={24} /></div>
          <p className="prepared-time">最近准备于 {formatPreparedAt(packet.preparedAt)}</p>
          <section><h3>回答优先级</h3><div className="chip-row">{packet.focusAreas.map((item) => <span className="chip" key={item}>{item}</span>)}</div></section>
          <section><h3>本轮认知授权</h3><p>{packet.brief}</p></section>
          <section><h3>预计追问</h3><ul>{packet.questionTypes.map((item) => <li key={item}>{item}</li>)}</ul></section>
          <button className="enter-button" onClick={onEnter}><Play size={17} fill="currentColor" /> 确认，进入正式面试</button>
          <p className="fine-print">进入后冻结 JD、简历和命题权限。场景身份不会写回长期自我；正式链路只调用本地模型。</p>
        </> : <div className="empty-brief"><BotMessageSquare size={30} /><h2>等待本次材料</h2><p>准备完成后，MindClone 才会按这份 JD 组织你的经历与回答重点。</p></div>}
      </div>
    </div>
  </div>;
}

function FormalView(props: {
  packet: InterviewPacket; messages: Message[]; input: string; error: string; streaming: boolean;
  candidateDraft: string; messageCount: number; transcriptRef: React.RefObject<HTMLDivElement | null>; showScrollButton: boolean;
  onScroll: () => void; onScrollToBottom: () => void;
  onInputChange: (value: string) => void; onAsk: () => void; onStop: () => void; onInterrupt: () => void; onBack: () => void;
}) {
  const { packet, messages, input, error, streaming, candidateDraft, messageCount, transcriptRef, showScrollButton, onScroll, onScrollToBottom, onInputChange, onAsk, onStop, onInterrupt, onBack } = props;
  return <div className="formal-layout">
    <header className="formal-header"><div><p className="eyebrow">FORMAL INTERVIEW</p><h1>候选回答</h1></div><div className="header-actions"><span className="ready-pill"><span /> 已冻结面试简报</span><button className="ghost-button" onClick={onBack}>返回准备</button></div></header>
    <div className="formal-body">
      <aside className="context-rail"><h2>本场上下文</h2><p>{packet.brief}</p><h3>优先素材</h3><div className="chip-row">{packet.focusAreas.map((item) => <span className="chip" key={item}>{item}</span>)}</div><div className="session-counter"><strong>{messageCount}</strong><span>个面试问题</span></div></aside>
      <section className="conversation"><div className="transcript" ref={transcriptRef} onScroll={onScroll}>
        {messages.length === 0 ? <div className="conversation-empty"><Volume2 size={28} /><h2>等待面试官问题</h2><p>输入问题，或稍后接入语音转写。候选回答将立即流式出现。</p></div> : messages.map((message) => <article className={`message ${message.role}`} key={message.id}><div className="message-label">{message.role === 'interviewer' ? '面试官' : 'MindClone 候选回答'}</div><div className="message-body">{message.content ? <MarkdownText content={message.content} /> : streaming && message.role === 'candidate' ? <ThinkingIndicator /> : null}</div></article>)}
        {error && <div className="error-note">{error}</div>}
      </div>
      <button className={showScrollButton ? 'scroll-to-latest formal-scroll-to-latest is-visible' : 'scroll-to-latest formal-scroll-to-latest'} title="回到最新回答" aria-label="回到最新回答" aria-hidden={!showScrollButton} disabled={!showScrollButton} onClick={onScrollToBottom}><ArrowDown size={18} /></button>
      <div className="composer"><textarea value={input} onChange={(event) => onInputChange(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') onAsk(); }} placeholder="输入面试官的问题..." />
        <div className="composer-bar"><span><Mic size={15} /> 语音转写接入后会进入此处</span>{streaming ? <><button className="stop-button" onClick={onStop}><CircleStop size={17} /> 停止</button><button className="primary-button compact" disabled={!input.trim()} onClick={onInterrupt}>打断并提问 <SendHorizontal size={16} /></button></> : <button className="primary-button compact" disabled={!input.trim()} onClick={onAsk}>发送问题 <SendHorizontal size={16} /></button>}</div>
      </div></section>
    </div>
    {streaming && candidateDraft && <div className="stream-indicator"><span /> 正在实时生成，可随时打断</div>}
  </div>;
}

function SettingsDialog({ theme, onThemeChange, onClose }: { theme: ChatTheme; onThemeChange: (theme: ChatTheme) => void; onClose: () => void }) {
  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}><div className="settings-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div><p className="eyebrow">MINDCLONE SETTINGS</p><h2>设置</h2><p>调整共享聊天界面的主题。</p></div><label className="theme-field">主题<div className="theme-options">{(['light', 'dark', 'system'] as ChatTheme[]).map((option) => <button key={option} type="button" className={theme === option ? 'selected' : ''} onClick={() => onThemeChange(option)}>{option === 'light' ? '浅色' : option === 'dark' ? '深色' : '跟随系统'}</button>)}</div></label><div className="dialog-actions"><button className="primary-button compact" onClick={onClose}>完成</button></div></div></div>;
}

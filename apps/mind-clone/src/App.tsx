import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowDown, ArrowRight, BotMessageSquare, CheckCircle2, ChevronDown, CircleStop, FileText,
  FileUp, ListChecks, MessageCircle, MessageSquarePlus, Mic, Paperclip, Play,
  Copy, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Pin, Plus, SendHorizontal, Settings2,
  Sparkles, Trash2, Upload, Video, Volume2, X,
} from 'lucide-react';
import { streamCandidateAnswer } from './interview';
import { memoryApi } from './memory-api';
import { loadPacket, loadSettings, savePacket, saveSettings } from './storage';
import type { DailyMessage, DailyModel, DailySession, InterviewPacket, MemoryCandidate, MemoryDocument, Message, Mode, Settings, ThemeMode } from './types';

const exampleJD = `Remote Backend Engineer
Own server-side APIs, database design, performance tuning, and production reliability. Comfortable with a mainstream backend language, SQL, Redis, Docker, and distributed systems fundamentals; able to clarify requirements and deliver independently.`;

const exampleResume = `Started in Android development after graduation, then built a startup and worked remotely for an extended period. During the startup journey, took on product, user operations, customer support, sales, and recruiting work; continued building backend engineering skills with a demonstrated ability to learn across languages and deliver independently.`;

function formatPreparedAt(value: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function InlineMarkdown({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <Fragment key={index}>{part}</Fragment>,
  )}</>;
}

function MarkdownText({ content }: { content: string }) {
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push(<p key={`paragraph-${blocks.length}`}>{paragraph.map((line, lineIndex) =>
      <Fragment key={lineIndex}><InlineMarkdown text={line} />{lineIndex < paragraph.length - 1 && <br />}</Fragment>,
    )}</p>);
    paragraph = [];
  }

  content.split('\n').forEach((line) => {
    const heading = line.match(/^ {0,3}###\s+(.+)\s*$/);
    if (/^ {0,3}(?:---+|\*\s*\*\s*\*+)\s*$/.test(line)) {
      flushParagraph();
      blocks.push(<hr key={`rule-${blocks.length}`} />);
    } else if (heading) {
      flushParagraph();
      blocks.push(<h3 key={`heading-${blocks.length}`}><InlineMarkdown text={heading[1]} /></h3>);
    } else if (!line.trim()) {
      flushParagraph();
    } else {
      paragraph.push(line);
    }
  });
  flushParagraph();

  return <div className="rich-text">{blocks}</div>;
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
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const stored = window.localStorage.getItem('mindclone-theme');
    return stored === 'dark' || stored === 'system' ? stored : 'light';
  });
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [memoryDocuments, setMemoryDocuments] = useState<MemoryDocument[]>([]);
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryCandidate[]>([]);
  const [memoryError, setMemoryError] = useState('');
  const [dailySessions, setDailySessions] = useState<DailySession[]>([]);
  const [dailySessionId, setDailySessionId] = useState<string | null>(null);
  const [dailyInput, setDailyInput] = useState('');
  const [dailyStreaming, setDailyStreaming] = useState(false);
  const [dailyError, setDailyError] = useState('');
  const [dailyModel, setDailyModel] = useState<DailyModel>(() => {
    const saved = window.localStorage.getItem('mindclone.daily-model');
    if (saved === 'deepseek-medium' || saved === 'deepseek-high' || saved === 'deepseek-ultra') return saved;
    return saved === 'deepseek-reasoner' ? 'deepseek-medium' : 'deepseek-light';
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const formalFollowingRef = useRef(true);
  const [formalAtBottom, setFormalAtBottom] = useState(true);
  const dailyAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const stored = loadPacket();
    if (stored) {
      setPacket(stored);
      setJd(stored.jd);
      setResume(stored.resume);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('mindclone-theme', theme);
  }, [theme]);

  async function refreshMemory() {
    try {
      const store = await memoryApi.list();
      setMemoryDocuments(store.documents);
      setMemoryCandidates(store.memories);
      setMemoryError('');
    } catch (caught) {
      setMemoryError((caught as Error).message);
    }
  }

  useEffect(() => { void refreshMemory(); }, []);

  async function refreshSessions() {
    try {
      const { sessions } = await memoryApi.listSessions();
      setDailySessions(sessions);
      setDailySessionId((current) => current && sessions.some((session) => session.id === current) ? current : sessions[0]?.id ?? null);
    } catch (caught) { setDailyError((caught as Error).message); }
  }

  useEffect(() => { void refreshSessions(); }, []);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript && formalFollowingRef.current) transcript.scrollTo({ top: transcript.scrollHeight });
  }, [messages, streaming]);

  function updateFormalScrollPosition() {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const atBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <= 24;
    formalFollowingRef.current = atBottom;
    setFormalAtBottom(atBottom);
  }

  function scrollFormalToBottom() {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    formalFollowingRef.current = true;
    transcript.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
    setFormalAtBottom(true);
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
      const { plan, claims } = await memoryApi.planAnswer(packet.sceneId, question);
      let completedAnswer = '';
      await streamCandidateAnswer(settings, packet, plan, claims, nextMessages.slice(0, -1), (delta) => {
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
            ? `Unable to connect to the local model service at ${settings.baseUrl}. Start Ollama or MLX, or update the address in Settings.`
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

  function updateSettings(next: Settings) {
    setSettings(next);
    saveSettings(next);
  }

  async function newDailySession() {
    try {
      const { session } = await memoryApi.createSession();
      setDailySessions((current) => [session, ...current]);
      setDailySessionId(session.id);
      setDailyError('');
      return session.id;
    } catch (caught) { setDailyError((caught as Error).message); return null; }
  }

  async function importChatGPTToInbox(file: File) {
    const contents = extractChatGPTConversations(JSON.parse(await file.text()));
    if (!contents.length) throw new Error('No readable user/assistant conversations were found in this export.');
    for (const item of contents) await memoryApi.importDocument({ ...item, sourceType: 'chatgpt_export' });
    await refreshMemory();
  }

  return (
    <main className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${mode === 'daily' ? 'daily-mode' : ''}`}>
      <aside className="sidebar">
        <div className="brand"><Sparkles size={20} /><span>MindClone</span></div>
        <nav>
          <button className={mode === 'daily' ? 'nav-item active' : 'nav-item'} onClick={() => setMode('daily')}>
            <MessageCircle size={18} /> Daily chat
          </button>
          <button className={mode === 'prepare' ? 'nav-item active' : 'nav-item'} onClick={() => setMode('prepare')}>
            <FileText size={18} /> Interview prep
          </button>
          <button className={mode === 'memory' ? 'nav-item active' : 'nav-item'} onClick={() => { setMode('memory'); void refreshMemory(); }}>
            <MessageSquarePlus size={18} /> Memory inbox
          </button>
          <button className={mode === 'formal' ? 'nav-item active' : 'nav-item'} onClick={() => packet && setMode('formal')} disabled={!packet}>
            <BotMessageSquare size={18} /> Live interview
          </button>
        </nav>
        <div className="sidebar-foot">
          <div className="local-status"><span /> Local engine</div>
          <button className="icon-button" title="Model settings" onClick={() => setShowSettings(true)}><Settings2 size={18} /></button>
        </div>
      </aside>

      <section className="workspace">
        {mode === 'prepare' ? (
          <PrepareView
            jd={jd} resume={resume} packet={packet} ready={ready}
            onJdChange={setJd} onResumeChange={setResume} onPrepare={() => void prepare()}
            onEnter={enterFormal} onUseExample={() => { setJd(exampleJD); setResume(exampleResume); }}
          />
        ) : mode === 'daily' ? (
          <DailyChatView sessions={dailySessions} activeSessionId={dailySessionId} input={dailyInput} streaming={dailyStreaming} error={dailyError} model={dailyModel} onModelChange={(model) => { setDailyModel(model); window.localStorage.setItem('mindclone.daily-model', model); }}
            onInputChange={setDailyInput} onSelectSession={setDailySessionId} onNewSession={newDailySession} onRefresh={() => void refreshSessions()}
            onError={setDailyError} onStreamChange={setDailyStreaming} onImport={importChatGPTToInbox} sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((current) => !current)} mode={mode} hasPacket={Boolean(packet)} onModeChange={setMode}
            onOpenSettings={() => setShowSettings(true)} />
        ) : mode === 'memory' ? (
          <MemoryView documents={memoryDocuments} candidates={memoryCandidates} error={memoryError} onRefresh={refreshMemory} />
        ) : packet ? (
          <FormalView
            packet={packet} messages={messages} input={input} error={error} streaming={streaming}
            candidateDraft={candidateDraft} messageCount={messageCount} transcriptRef={transcriptRef}
            atBottom={formalAtBottom} onScroll={updateFormalScrollPosition} onScrollToBottom={scrollFormalToBottom}
            onInputChange={setInput} onAsk={() => void askQuestion()} onStop={stopGeneration}
            onInterrupt={() => void interruptWithDraft()} onBack={() => { stopGeneration(); setMode('prepare'); }}
          />
        ) : null}
      </section>

      {showSettings && <SettingsDialog settings={settings} theme={theme} onThemeChange={setTheme} onClose={() => setShowSettings(false)} onChange={updateSettings} />}
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

function DailyChatView({ sessions, activeSessionId, input, streaming, error, model, onModelChange, onInputChange, onSelectSession, onNewSession, onRefresh, onError, onStreamChange, onImport, sidebarCollapsed, onToggleSidebar, mode, hasPacket, onModeChange, onOpenSettings }: {
  sessions: DailySession[]; activeSessionId: string | null; input: string; streaming: boolean; error: string;
  model: DailyModel; onModelChange: (model: DailyModel) => void;
  onInputChange: (value: string) => void; onSelectSession: (id: string) => void; onNewSession: () => Promise<string | null>; onRefresh: () => void;
  onError: (value: string) => void; onStreamChange: (value: boolean) => void; onImport: (file: File) => Promise<void>;
  sidebarCollapsed: boolean; onToggleSidebar: () => void;
  mode: Mode; hasPacket: boolean; onModeChange: (mode: Mode) => void; onOpenSettings: () => void;
}) {
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [attachmentNote, setAttachmentNote] = useState('');
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState('');
  const [thinkingVisible, setThinkingVisible] = useState(false);
  const [editingMessage, setEditingMessage] = useState<{ id: string; content: string } | null>(null);
  const [draftMessages, setDraftMessages] = useState<DailyMessage[]>([]);
  const [recentsCollapsed, setRecentsCollapsed] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [sessionMenuId, setSessionMenuId] = useState<string | null>(null);
  const [newChatActive, setNewChatActive] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem('mindclone-sidebar-width'));
    return Number.isFinite(saved) ? Math.min(420, Math.max(240, saved)) : 280;
  });
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dailyInputRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const sidebarWidthRef = useRef(sidebarWidth);
  const thinkingTimerRef = useRef<number | null>(null);
  const followingRef = useRef(true);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const messages = draftMessages.length ? draftMessages : newChatActive ? [] : activeSession?.messages ?? [];

  useEffect(() => { setDraftMessages([]); }, [activeSessionId]);
  useEffect(() => {
    const transcript = listRef.current;
    if (transcript && followingRef.current) transcript.scrollTo({ top: transcript.scrollHeight });
  }, [messages, streaming]);
  useEffect(() => {
    const textarea = dailyInputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 144) + 'px';
    if (!input.length) {
      setComposerExpanded(false);
    } else if (textarea.scrollHeight > 28) {
      setComposerExpanded(true);
    }
  }, [input]);
  useEffect(() => {
    function closeMenu(event: MouseEvent) {
      if (!modelMenuRef.current?.contains(event.target as Node)) setModelMenuOpen(false);
    }
    document.addEventListener('mousedown', closeMenu);
    return () => document.removeEventListener('mousedown', closeMenu);
  }, []);

  function startSidebarResize(event: React.PointerEvent<HTMLDivElement>) {
    if (sidebarCollapsed) return;
    resizeRef.current = { startX: event.clientX, startWidth: sidebarWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add('sidebar-resizing');
  }

  function resizeSidebar(event: React.PointerEvent<HTMLDivElement>) {
    if (!resizeRef.current) return;
    const next = Math.min(420, Math.max(240, resizeRef.current.startWidth + event.clientX - resizeRef.current.startX));
    sidebarWidthRef.current = next;
    setSidebarWidth(next);
  }

  function endSidebarResize(event: React.PointerEvent<HTMLDivElement>) {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    document.body.classList.remove('sidebar-resizing');
    window.localStorage.setItem('mindclone-sidebar-width', String(sidebarWidthRef.current));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function updateDailyInput(value: string) {
    if (!value) setComposerExpanded(false);
    onInputChange(value);
  }

  function startNewChat() {
    setNewChatActive(true);
    setSessionMenuId(null);
    setEditingMessage(null);
    setDraftMessages([]);
    onInputChange('');
    onError('');
    onSelectSession('');
  }

  function selectSession(sessionId: string) {
    setNewChatActive(false);
    setSessionMenuId(null);
    onSelectSession(sessionId);
  }

  async function send(contentOverride?: string, replaceFromMessageId?: string) {
    const content = (contentOverride ?? input).trim();
    if (!content || streaming) return;
    let sessionId = newChatActive ? null : activeSessionId;
    if (!sessionId) {
      sessionId = await onNewSession();
      if (!sessionId) return;
      setNewChatActive(false);
    }
    const userMessage: DailyMessage = { id: crypto.randomUUID(), role: 'user', content, createdAt: new Date().toISOString() };
    const answerMessage: DailyMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', createdAt: new Date().toISOString() };
    const branchIndex = replaceFromMessageId ? activeSession?.messages.findIndex((message) => message.id === replaceFromMessageId) ?? -1 : -1;
    const branchMessages = branchIndex >= 0 ? activeSession?.messages.slice(0, branchIndex) ?? [] : activeSession?.messages ?? [];
    const next = [...branchMessages, userMessage, answerMessage];
    setDraftMessages(next);
    if (thinkingTimerRef.current) window.clearTimeout(thinkingTimerRef.current);
    thinkingTimerRef.current = null;
    setThinkingVisible(true);
    onInputChange(''); onError(''); onStreamChange(true);
    const controller = new AbortController();
    let firstDelta = true;
    try {
      await memoryApi.streamChat(sessionId, content, (delta) => {
        if (firstDelta) {
          firstDelta = false;
          thinkingTimerRef.current = window.setTimeout(() => setThinkingVisible(false), 320);
        }
        setDraftMessages((current) => current.map((message) => message.id === answerMessage.id ? { ...message, content: message.content + delta } : message));
      }, controller.signal, replaceFromMessageId, model);
      setDraftMessages([]);
      setEditingMessage(null);
      onRefresh();
    } catch (caught) {
      setDraftMessages((current) => current.filter((message) => message.id !== answerMessage.id || message.content));
      onError((caught as Error).message);
    } finally {
      if (thinkingTimerRef.current) window.clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
      setThinkingVisible(false);
      onStreamChange(false);
    }
  }

  async function saveAttachmentNote() {
    if (attachmentNote.trim().length < 10) { setAttachmentStatus('Please enter at least one complete piece of source material.'); return; }
    setAttachmentBusy(true);
    try { await memoryApi.importDocument({ title: 'Conversation supplement', sourceType: 'note', content: attachmentNote.trim() }); setAttachmentNote(''); setAttachmentStatus('Saved to the local memory inbox.'); } catch (caught) { setAttachmentStatus((caught as Error).message); } finally { setAttachmentBusy(false); }
  }

  async function importFile(file: File) {
    setAttachmentBusy(true);
    try { await onImport(file); setAttachmentStatus('ChatGPT history imported to the local inbox.'); } catch (caught) { setAttachmentStatus((caught as Error).message); } finally { setAttachmentBusy(false); }
  }

  async function deleteSession(session: DailySession) {
    if (!window.confirm(`Delete “${session.title}” and all messages in it? Linked candidate memories will also be removed.`)) return;
    try {
      await memoryApi.deleteSession(session.id);
      if (session.id === activeSessionId) onSelectSession('');
      onRefresh();
    } catch (caught) { onError((caught as Error).message); }
  }

  async function updateSession(session: DailySession, update: Partial<Pick<DailySession, 'title' | 'pinned'>>) {
    try { await memoryApi.updateSession(session.id, update); setSessionMenuId(null); onRefresh(); } catch (caught) { onError((caught as Error).message); }
  }

  function renameSession(session: DailySession) {
    const title = window.prompt('Rename conversation', session.title)?.trim();
    if (title && title !== session.title) void updateSession(session, { title });
  }

  function editMessage(message: DailyMessage) {
    setEditingMessage({ id: message.id, content: message.content });
  }

  async function copyMessage(message: DailyMessage) {
    try { await navigator.clipboard.writeText(message.content); } catch { onError('Unable to access the system clipboard.'); }
  }

  function updateScrollPosition() {
    const transcript = listRef.current;
    if (!transcript) return;
    const nextAtBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <= 24;
    followingRef.current = nextAtBottom;
    setAtBottom(nextAtBottom);
  }

  function scrollToLatest() {
    const transcript = listRef.current;
    if (!transcript) return;
    followingRef.current = true;
    transcript.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
    setAtBottom(true);
  }

  return <div className="daily-layout" style={{ '--daily-sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
    <aside className="daily-history"><div className="daily-brand"><Sparkles size={21} /><span>MindClone</span><button className="icon-button sidebar-close" title="Collapse sidebar" onClick={onToggleSidebar}><PanelLeftClose size={19} /></button></div><nav className="daily-nav"><button className={newChatActive || !activeSessionId ? 'active' : ''} onClick={startNewChat}><Plus size={14} /> New Chat</button><button onClick={() => onModeChange('prepare')}><FileText size={14} /> Interview prep</button><button onClick={() => onModeChange('memory')}><MessageSquarePlus size={14} /> Memory inbox</button><button disabled={!hasPacket} onClick={() => hasPacket && onModeChange('formal')}><BotMessageSquare size={14} /> Live interview</button></nav><div className="recents-panel"><button className={recentsCollapsed ? 'daily-history-top recents-toggle collapsed' : 'daily-history-top recents-toggle'} onClick={() => setRecentsCollapsed((collapsed) => !collapsed)}><span>Recents</span><ChevronDown size={17} /></button>{!recentsCollapsed && <div className="session-list">{sessions.length === 0 ? <p>Start a conversation. MindClone keeps your record on this device.</p> : [...sessions].sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()).map((session) => <div key={session.id} className={session.id === activeSessionId && !newChatActive ? 'session-item active' : 'session-item'}><button onClick={() => selectSession(session.id)}><span>{session.pinned && <Pin size={12} fill="currentColor" />} {session.title}</span></button><div className="session-more"><button className="session-more-trigger" title="Conversation options" onClick={(event) => { event.stopPropagation(); setSessionMenuId((current) => current === session.id ? null : session.id); }}><MoreHorizontal size={17} /></button>{sessionMenuId === session.id && <div className="session-context-menu"><button onClick={() => void updateSession(session, { pinned: !session.pinned })}><Pin size={15} /> {session.pinned ? 'Unpin' : 'Pin'}</button><button onClick={() => renameSession(session)}><Pencil size={15} /> Rename</button><button className="danger" onClick={() => void deleteSession(session)}><Trash2 size={15} /> Delete</button></div>}</div></div>)}</div>}</div><div className="daily-sidebar-footer"><div className="local-status"><span /> Local engine</div><button className="icon-button light" title="Settings" onClick={onOpenSettings}><Settings2 size={18} /></button></div><div className="sidebar-resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" onPointerDown={startSidebarResize} onPointerMove={resizeSidebar} onPointerUp={endSidebarResize} onPointerCancel={endSidebarResize} /></aside>{sidebarCollapsed && <button className="sidebar-reopen" title="Expand sidebar" onClick={onToggleSidebar}><PanelLeftOpen size={19} /></button>}
    <section className="daily-conversation"><div className="daily-transcript" ref={listRef} onScroll={updateScrollPosition}>{messages.length === 0 ? <div className="daily-empty"><Sparkles size={32} /><h2>Start with what is on your mind</h2><p>Every conversation is saved locally. Important material is added to candidate memories asynchronously for your review.</p></div> : messages.map((message) => <article className={`daily-message ${message.role}`} key={message.id}>{editingMessage?.id === message.id ? <div className="inline-message-editor"><textarea autoFocus value={editingMessage.content} onChange={(event) => setEditingMessage({ ...editingMessage, content: event.target.value })} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void send(editingMessage.content, message.id); if (event.key === 'Escape') setEditingMessage(null); }} /><div><button className="edit-cancel-button" onClick={() => setEditingMessage(null)}>Cancel</button><button className="edit-send-button" disabled={!editingMessage.content.trim() || streaming} onClick={() => void send(editingMessage.content, message.id)}>Send</button></div></div> : <><div className="message-body">{message.content ? <MarkdownText content={message.content} /> : streaming && message.role === 'assistant' ? <ThinkingIndicator /> : null}{thinkingVisible && message.id === messages.at(-1)?.id && message.role === 'assistant' && message.content && <ThinkingIndicator />}</div>{message.content && <div className="message-actions"><button title="Copy message" aria-label="Copy message" onClick={() => void copyMessage(message)}><Copy size={16} /></button>{message.role === 'user' && <button title="Edit message" aria-label="Edit message" onClick={() => editMessage(message)}><Pencil size={16} /></button>}</div>}</>}</article>)}{error && <div className="error-note">{error}</div>}</div>
      {!atBottom && <button className="scroll-to-latest" title="Back to latest message" aria-label="Back to latest message" onClick={scrollToLatest}><ArrowDown size={24} /></button>}
      <div className={composerExpanded ? 'daily-composer expanded' : 'daily-composer'}><div className="attachment-area">{attachmentOpen && <div className="attachment-menu"><div className="attachment-menu-title">Add context</div><button onClick={() => fileRef.current?.click()}><FileUp size={17} /> Import ChatGPT history</button><button onClick={() => setAttachmentStatus('Paste Markdown or notes below.')}><Paperclip size={17} /> Add text / Markdown</button><textarea value={attachmentNote} onChange={(event) => setAttachmentNote(event.target.value)} placeholder="Paste supplementary material..." /><button className="primary-button compact" disabled={attachmentBusy} onClick={() => void saveAttachmentNote()}>{attachmentBusy ? 'Processing...' : 'Save to inbox'}</button>{attachmentStatus && <p>{attachmentStatus}</p>}</div>}<input ref={fileRef} className="hidden-input" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.currentTarget.value = ''; }} /><button className={attachmentOpen ? 'plus-button open' : 'plus-button'} title="Add material" onClick={() => setAttachmentOpen((current) => !current)}><Plus size={21} /></button></div><textarea ref={dailyInputRef} rows={1} value={input} onChange={(event) => updateDailyInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder="Message MindClone..." /><div ref={modelMenuRef} className={modelMenuOpen ? 'daily-model-picker open' : 'daily-model-picker'}><button type="button" aria-haspopup="menu" aria-expanded={modelMenuOpen} onClick={() => setModelMenuOpen((open) => !open)}>{({ 'deepseek-light': 'DeepSeek Light', 'deepseek-medium': 'DeepSeek Medium', 'deepseek-high': 'DeepSeek High', 'deepseek-ultra': 'DeepSeek Ultra' } as const)[model]}<ChevronDown size={16} /></button>{modelMenuOpen && <div className="daily-model-menu" role="menu">{([{ id: 'deepseek-light', name: 'DeepSeek Light', detail: 'deepseek-v4-flash · non-thinking' }, { id: 'deepseek-medium', name: 'DeepSeek Medium', detail: 'deepseek-v4-flash · thinking' }, { id: 'deepseek-high', name: 'DeepSeek High', detail: 'deepseek-v4-pro · non-thinking' }, { id: 'deepseek-ultra', name: 'DeepSeek Ultra', detail: 'deepseek-v4-pro · thinking' }] as const).map((option) => <button key={option.id} role="menuitem" className={model === option.id ? 'selected' : ''} onClick={() => { onModelChange(option.id); setModelMenuOpen(false); }}><strong>{option.name}</strong><span>{option.detail}</span></button>)}</div>}</div><button className="send-icon" disabled={!input.trim() || streaming} title="Send" onClick={() => void send()}><SendHorizontal size={19} /></button></div>
    </section>
  </div>;
}

function MemoryView({ documents, candidates, error, onRefresh }: {
  documents: MemoryDocument[]; candidates: MemoryCandidate[]; error: string; onRefresh: () => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [title, setTitle] = useState('Quick note');
  const [interviewNote, setInterviewNote] = useState('');
  const [shortVideoShare, setShortVideoShare] = useState('');
  const [shortVideoTitle, setShortVideoTitle] = useState('');
  const [shortVideoContent, setShortVideoContent] = useState('');
  const [busyDocument, setBusyDocument] = useState<string | null>(null);
  const [localError, setLocalError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pending = candidates.filter((item) => item.status === 'pending');
  const approved = candidates.filter((item) => item.status === 'approved');
  const learned = candidates.filter((item) => item.scope === 'learning' && item.epistemicStatus === 'understood');

  async function saveText(sourceType: 'note' | 'conversation', value: string, nextTitle: string) {
    if (value.trim().length < 10) { setLocalError('Please enter at least one complete piece of source material.'); return; }
    setBusyDocument('new');
    try {
      await memoryApi.importDocument({ title: nextTitle.trim() || 'Untitled material', sourceType, content: value.trim() });
      if (sourceType === 'note') setNote(''); else setInterviewNote('');
      setLocalError('');
      await onRefresh();
    } catch (caught) { setLocalError((caught as Error).message); } finally { setBusyDocument(null); }
  }

  async function importChatGPT(file: File) {
    setBusyDocument('file');
    try {
      const contents = extractChatGPTConversations(JSON.parse(await file.text()));
      if (!contents.length) throw new Error('No readable user/assistant conversations were found in this export.');
      for (const item of contents) await memoryApi.importDocument({ ...item, sourceType: 'chatgpt_export' });
      setLocalError('');
      await onRefresh();
    } catch (caught) { setLocalError((caught as Error).message); } finally { setBusyDocument(null); }
  }

  async function prepareShortVideo() {
    if (!shortVideoShare.trim()) { setLocalError('Paste a Douyin share message first.'); return; }
    setBusyDocument('short-video-prepare');
    try {
      const prepared = await memoryApi.prepareShortVideo(shortVideoShare);
      setShortVideoTitle(prepared.title);
      setShortVideoContent(prepared.content);
      setLocalError('');
    } catch (caught) { setLocalError((caught as Error).message); } finally { setBusyDocument(null); }
  }

  async function transcribeShortVideo() {
    if (!shortVideoShare.trim()) { setLocalError('Paste a Douyin share message first.'); return; }
    setBusyDocument('short-video-transcribe');
    try {
      const prepared = await memoryApi.transcribeShortVideo(shortVideoShare);
      setShortVideoTitle(prepared.title);
      setShortVideoContent(prepared.content);
      setLocalError('');
    } catch (caught) { setLocalError((caught as Error).message); } finally { setBusyDocument(null); }
  }

  async function saveShortVideo() {
    if (shortVideoContent.trim().length < 10) { setLocalError('Prepare the share link, then add a spoken transcript.'); return; }
    setBusyDocument('short-video-save');
    try {
      await memoryApi.importDocument({ title: shortVideoTitle.trim() || 'Douyin learning material', sourceType: 'short_video', content: shortVideoContent.trim() });
      setShortVideoShare(''); setShortVideoTitle(''); setShortVideoContent(''); setLocalError(''); await onRefresh();
    } catch (caught) { setLocalError((caught as Error).message); } finally { setBusyDocument(null); }
  }

  async function extract(documentId: string) {
    setBusyDocument(documentId);
    try { await memoryApi.extract(documentId); setLocalError(''); await onRefresh(); } catch (caught) { setLocalError((caught as Error).message); } finally { setBusyDocument(null); }
  }

  async function review(id: string, status: MemoryCandidate['status']) {
    try { await memoryApi.setStatus(id, status); await onRefresh(); } catch (caught) { setLocalError((caught as Error).message); }
  }

  async function internalize(candidate: MemoryCandidate) {
    const interpretation = window.prompt('把这条知识改写成你真正认同、愿意代表自己表达的观点：', candidate.content);
    if (!interpretation?.trim()) return;
    const reason = window.prompt('你为什么认同它？请写下讨论后的理由或实际应用：');
    if (!reason?.trim()) return;
    try {
      await memoryApi.internalizeClaim(candidate.id, { proposition: interpretation.trim(), reason: reason.trim() });
      await onRefresh();
    } catch (caught) { setLocalError((caught as Error).message); }
  }

  return <div className="memory-layout">
    <header className="page-header"><div><p className="eyebrow">COGNITIVE INBOX</p><h1>Knowledge and self model</h1><p className="subtle">External material becomes understood knowledge. Only your confirmation authorizes a claim to represent your viewpoint or experience.</p></div><button className="ghost-button" onClick={() => void onRefresh()}>Refresh</button></header>
    <div className="memory-grid">
      <section className="memory-imports">
        <article className="memory-card"><div className="card-heading"><FileUp size={19} /><div><h2>ChatGPT history</h2><p>Import <code>conversations.json</code> from an official export.</p></div></div><input ref={fileInputRef} className="hidden-input" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importChatGPT(file); event.currentTarget.value = ''; }} /><button className="ghost-button full-width" disabled={busyDocument === 'file'} onClick={() => fileInputRef.current?.click()}><Upload size={16} /> {busyDocument === 'file' ? 'Importing...' : 'Choose conversations.json'}</button></article>
        <article className="memory-card"><div className="card-heading"><FileText size={19} /><div><h2>Notes / Markdown</h2><p>Views, experience, learning notes, or chat excerpts.</p></div></div><input className="memory-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Material title" /><textarea className="memory-textarea" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Paste any text or Markdown..." /><button className="primary-button full-width" disabled={busyDocument === 'new'} onClick={() => void saveText('note', note, title)}><Upload size={16} /> Save source material</button></article>
        <article className="memory-card short-video-card"><div className="card-heading"><Video size={19} /><div><h2>Douyin voice transcript</h2><p>Paste a full share message to transcribe its speech. Video frames are not analyzed.</p></div></div><textarea className="memory-textarea short" value={shortVideoShare} onChange={(event) => setShortVideoShare(event.target.value)} placeholder="Paste the Douyin share message or v.douyin.com link..." /><div className="short-video-actions"><button className="primary-button full-width" disabled={busyDocument === 'short-video-transcribe'} onClick={() => void transcribeShortVideo()}><Video size={16} /> {busyDocument === 'short-video-transcribe' ? 'Transcribing audio...' : 'Transcribe audio'}</button><button className="ghost-button full-width" disabled={busyDocument === 'short-video-prepare'} onClick={() => void prepareShortVideo()}>{busyDocument === 'short-video-prepare' ? 'Reading link...' : 'Add transcript manually'}</button></div>{shortVideoContent && <div className="short-video-editor"><input className="memory-title" value={shortVideoTitle} onChange={(event) => setShortVideoTitle(event.target.value)} placeholder="Video title" /><textarea className="memory-textarea" value={shortVideoContent} onChange={(event) => setShortVideoContent(event.target.value)} placeholder="Paste or correct the spoken transcript..." /><button className="primary-button full-width" disabled={busyDocument === 'short-video-save'} onClick={() => void saveShortVideo()}><Upload size={16} /> {busyDocument === 'short-video-save' ? 'Saving...' : 'Save transcript to inbox'}</button></div>}</article>
        <article className="memory-card"><div className="card-heading"><BotMessageSquare size={19} /><div><h2>Conversation intake</h2><p>Archive this conversation first; guided intake can be added later.</p></div></div><textarea className="memory-textarea short" value={interviewNote} onChange={(event) => setInterviewNote(event.target.value)} placeholder="What have you done lately? What changed? What are you working through?" /><button className="ghost-button full-width" disabled={busyDocument === 'new'} onClick={() => void saveText('conversation', interviewNote, 'Conversation intake')}>Save this conversation</button></article>
      </section>
      <section className="memory-review">
        <div className="memory-summary"><div><p className="eyebrow">IMMUTABLE EVIDENCE</p><h2>{documents.length} <span>source items</span></h2></div><div><p className="eyebrow">UNDERSTOOD</p><h2>{learned.length} <span>reasoning claims</span></h2></div></div>
        {(error || localError) && <div className="error-note">{error || localError}</div>}
        <div className="document-list"><h3>Ready to extract</h3>{documents.length === 0 ? <p className="empty-inline">Imported source material will wait here for extraction.</p> : documents.map((document) => <article className="document-row" key={document.id}><div><strong>{document.title}</strong><span>{document.sourceType === 'chatgpt_export' ? 'ChatGPT history' : document.sourceType === 'note' ? 'Text note' : document.sourceType === 'short_video' ? 'Douyin voice transcript' : 'Conversation intake'} · {new Date(document.createdAt).toLocaleDateString('en-US')}</span></div><button className="ghost-button" disabled={busyDocument === document.id} onClick={() => void extract(document.id)}>{busyDocument === document.id ? 'DeepSeek is extracting...' : document.extractedAt ? 'Extract again' : 'Extract candidate memories'}</button></article>)}</div>
        <div className="candidate-list"><h3>Understood knowledge <span>{learned.length}</span></h3>{learned.length === 0 ? <p className="empty-inline">External material will become reasoning knowledge here, without becoming your viewpoint.</p> : learned.map((candidate) => <article className="candidate-card" key={candidate.id}><div className="candidate-kind">{candidate.kind} · reasoning only</div><h4>{candidate.title}</h4><p>{candidate.content}</p>{candidate.tags.length > 0 && <div className="chip-row">{candidate.tags.map((tag) => <span className="chip" key={tag}>{tag}</span>)}</div>}<blockquote>{candidate.sourceQuote}</blockquote><div className="candidate-actions"><button className="primary-button compact" onClick={() => void internalize(candidate)}><MessageCircle size={15} /> Discuss and adopt</button></div></article>)}</div>
        <div className="candidate-list"><h3>Personal claim review <span>{pending.length}</span></h3>{pending.length === 0 ? <p className="empty-inline">No user-owned claims are waiting for authorization.</p> : pending.map((candidate) => <article className="candidate-card" key={candidate.id}><div className="candidate-kind">{candidate.kind} · {candidate.owner || 'user'} · {candidate.epistemicStatus || 'observed'}</div><h4>{candidate.title}</h4><p>{candidate.content}</p>{candidate.tags.length > 0 && <div className="chip-row">{candidate.tags.map((tag) => <span className="chip" key={tag}>{tag}</span>)}</div>}<blockquote>{candidate.sourceQuote}</blockquote><div className="candidate-actions"><button className="reject-button" onClick={() => void review(candidate.id, 'rejected')}><X size={15} /> Reject claim</button><button className="primary-button compact" onClick={() => void review(candidate.id, 'approved')}><CheckCircle2 size={15} /> Authorize as mine</button></div></article>)}</div>
        <div className="candidate-list"><h3>Authorized self <span>{approved.filter((item) => item.scope !== 'learning').length}</span></h3>{approved.filter((item) => item.scope !== 'learning').length === 0 ? <p className="empty-inline">Confirmed experiences and viewpoints will appear here.</p> : approved.filter((item) => item.scope !== 'learning').map((candidate) => <article className="candidate-card" key={candidate.id}><div className="candidate-kind">{candidate.kind} · {candidate.authorizationScope || 'authorized'}</div><h4>{candidate.title}</h4><p>{candidate.content}</p></article>)}</div>
      </section>
    </div>
  </div>;
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
  candidateDraft: string; messageCount: number; transcriptRef: React.RefObject<HTMLDivElement | null>; atBottom: boolean;
  onScroll: () => void; onScrollToBottom: () => void;
  onInputChange: (value: string) => void; onAsk: () => void; onStop: () => void; onInterrupt: () => void; onBack: () => void;
}) {
  const { packet, messages, input, error, streaming, candidateDraft, messageCount, transcriptRef, atBottom, onScroll, onScrollToBottom, onInputChange, onAsk, onStop, onInterrupt, onBack } = props;
  return <div className="formal-layout">
    <header className="formal-header"><div><p className="eyebrow">FORMAL INTERVIEW</p><h1>候选回答</h1></div><div className="header-actions"><span className="ready-pill"><span /> 已冻结面试简报</span><button className="ghost-button" onClick={onBack}>返回准备</button></div></header>
    <div className="formal-body">
      <aside className="context-rail"><h2>本场上下文</h2><p>{packet.brief}</p><h3>优先素材</h3><div className="chip-row">{packet.focusAreas.map((item) => <span className="chip" key={item}>{item}</span>)}</div><div className="session-counter"><strong>{messageCount}</strong><span>个面试问题</span></div></aside>
      <section className="conversation"><div className="transcript" ref={transcriptRef} onScroll={onScroll}>
        {messages.length === 0 ? <div className="conversation-empty"><Volume2 size={28} /><h2>等待面试官问题</h2><p>输入问题，或稍后接入语音转写。候选回答将立即流式出现。</p></div> : messages.map((message) => <article className={`message ${message.role}`} key={message.id}><div className="message-label">{message.role === 'interviewer' ? '面试官' : 'MindClone 候选回答'}</div><div className="message-body">{message.content ? <MarkdownText content={message.content} /> : streaming && message.role === 'candidate' ? <ThinkingIndicator /> : null}</div></article>)}
        {error && <div className="error-note">{error}</div>}
      </div>
      {!atBottom && <button className="scroll-to-latest formal-scroll-to-latest" title="回到最新回答" aria-label="回到最新回答" onClick={onScrollToBottom}><ArrowDown size={24} /></button>}
      <div className="composer"><textarea value={input} onChange={(event) => onInputChange(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') onAsk(); }} placeholder="输入面试官的问题..." />
        <div className="composer-bar"><span><Mic size={15} /> 语音转写接入后会进入此处</span>{streaming ? <><button className="stop-button" onClick={onStop}><CircleStop size={17} /> 停止</button><button className="primary-button compact" disabled={!input.trim()} onClick={onInterrupt}>打断并提问 <SendHorizontal size={16} /></button></> : <button className="primary-button compact" disabled={!input.trim()} onClick={onAsk}>发送问题 <SendHorizontal size={16} /></button>}</div>
      </div></section>
    </div>
    {streaming && candidateDraft && <div className="stream-indicator"><span /> 正在实时生成，可随时打断</div>}
  </div>;
}

function SettingsDialog({ settings, theme, onThemeChange, onClose, onChange }: { settings: Settings; theme: ThemeMode; onThemeChange: (theme: ThemeMode) => void; onClose: () => void; onChange: (settings: Settings) => void }) {
  const [draft, setDraft] = useState(settings);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}><div className="settings-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div><p className="eyebrow">MINDCLONE SETTINGS</p><h2>设置</h2><p>调整界面主题和本地模型连接。</p></div><label className="theme-field">主题<div className="theme-options">{(['light', 'dark', 'system'] as ThemeMode[]).map((option) => <button key={option} type="button" className={theme === option ? 'selected' : ''} onClick={() => onThemeChange(option)}>{option === 'light' ? '浅色' : option === 'dark' ? '深色' : '跟随系统'}</button>)}</div></label><label>服务地址<input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label><label>模型名称<input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} /></label><div className="dialog-actions"><button className="ghost-button" onClick={onClose}>取消</button><button className="primary-button compact" onClick={() => { onChange(draft); onClose(); }}>保存</button></div></div></div>;
}

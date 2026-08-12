import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowRight, BotMessageSquare, CheckCircle2, CircleStop, FileText,
  FileUp, ListChecks, MessageCircle, MessageSquarePlus, Mic, Paperclip, Play,
  PanelLeftClose, PanelLeftOpen, Plus, Search, SendHorizontal, Settings2,
  Sparkles, Trash2, Upload, Volume2, X,
} from 'lucide-react';
import { preparePacket, streamCandidateAnswer } from './interview';
import { memoryApi } from './memory-api';
import { loadPacket, loadSettings, savePacket, saveSettings } from './storage';
import type { DailyMessage, DailySession, InterviewPacket, MemoryCandidate, MemoryDocument, Message, Mode, Settings, ThemeMode } from './types';

const exampleJD = `远程后端工程师
负责服务端 API、数据库设计、性能优化与线上稳定性。熟悉任一主流后端语言，具备 SQL、Redis、Docker 和分布式系统基础；能独立沟通需求并推进交付。`;

const exampleResume = `毕业后从 Android 开发起步，随后创业并长期远程协作。创业过程中承担过产品、用户运营、客服、销售和招聘等工作；持续学习后端工程，具备跨语言学习和独立交付能力。`;

function formatPreparedAt(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const transcriptRef = useRef<HTMLDivElement>(null);
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
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  const ready = jd.trim().length > 40 && resume.trim().length > 40;
  const messageCount = messages.filter((message) => message.role === 'interviewer').length;
  const candidateDraft = useMemo(
    () => messages.at(-1)?.role === 'candidate' ? messages.at(-1)?.content ?? '' : '',
    [messages],
  );

  function prepare() {
    const next = preparePacket(jd, resume);
    setPacket(next);
    savePacket(next);
    setError('');
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
      await streamCandidateAnswer(settings, packet, nextMessages.slice(0, -1), (delta) => {
        setMessages((current) => current.map((message) =>
          message.id === answerMessage.id ? { ...message, content: message.content + delta } : message,
        ));
      }, controller.signal);
    } catch (caught) {
      if ((caught as Error).name !== 'AbortError') {
        const message = (caught as Error).message;
        setError(
          message === 'Failed to fetch'
            ? `无法连接本地模型服务 ${settings.baseUrl}。请启动 Ollama/MLX 服务，或在模型设置中修改地址。`
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
    if (!contents.length) throw new Error('未从该导出中找到可读取的用户/助手对话。');
    for (const item of contents) await memoryApi.importDocument({ ...item, sourceType: 'chatgpt_export' });
    await refreshMemory();
  }

  return (
    <main className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${mode === 'daily' ? 'daily-mode' : ''}`}>
      <aside className="sidebar">
        <div className="brand"><Sparkles size={20} /><span>MindClone</span></div>
        <nav>
          <button className={mode === 'daily' ? 'nav-item active' : 'nav-item'} onClick={() => setMode('daily')}>
            <MessageCircle size={18} /> 日常对话
          </button>
          <button className={mode === 'prepare' ? 'nav-item active' : 'nav-item'} onClick={() => setMode('prepare')}>
            <FileText size={18} /> 面试准备
          </button>
          <button className={mode === 'memory' ? 'nav-item active' : 'nav-item'} onClick={() => { setMode('memory'); void refreshMemory(); }}>
            <MessageSquarePlus size={18} /> 记忆投喂
          </button>
          <button className={mode === 'formal' ? 'nav-item active' : 'nav-item'} onClick={() => packet && setMode('formal')} disabled={!packet}>
            <BotMessageSquare size={18} /> 正式面试
          </button>
        </nav>
        <div className="sidebar-foot">
          <div className="local-status"><span /> 本地引擎</div>
          <button className="icon-button" title="模型设置" onClick={() => setShowSettings(true)}><Settings2 size={18} /></button>
        </div>
      </aside>

      <section className="workspace">
        {mode === 'prepare' ? (
          <PrepareView
            jd={jd} resume={resume} packet={packet} ready={ready}
            onJdChange={setJd} onResumeChange={setResume} onPrepare={prepare}
            onEnter={enterFormal} onUseExample={() => { setJd(exampleJD); setResume(exampleResume); }}
          />
        ) : mode === 'daily' ? (
          <DailyChatView sessions={dailySessions} activeSessionId={dailySessionId} input={dailyInput} streaming={dailyStreaming} error={dailyError}
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
      return text ? [`${role === 'user' ? '我' : 'ChatGPT'}：${text}`] : [];
    });
    if (!messages.length) return [];
    return [{ title: conversation.title || 'ChatGPT 对话', content: messages.join('\n\n') }];
  });
}

function DailyChatView({ sessions, activeSessionId, input, streaming, error, onInputChange, onSelectSession, onNewSession, onRefresh, onError, onStreamChange, onImport, sidebarCollapsed, onToggleSidebar, mode, hasPacket, onModeChange, onOpenSettings }: {
  sessions: DailySession[]; activeSessionId: string | null; input: string; streaming: boolean; error: string;
  onInputChange: (value: string) => void; onSelectSession: (id: string) => void; onNewSession: () => Promise<string | null>; onRefresh: () => void;
  onError: (value: string) => void; onStreamChange: (value: boolean) => void; onImport: (file: File) => Promise<void>;
  sidebarCollapsed: boolean; onToggleSidebar: () => void;
  mode: Mode; hasPacket: boolean; onModeChange: (mode: Mode) => void; onOpenSettings: () => void;
}) {
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [attachmentNote, setAttachmentNote] = useState('');
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState('');
  const [draftMessages, setDraftMessages] = useState<DailyMessage[]>([]);
  const [query, setQuery] = useState('');
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem('mindclone-sidebar-width'));
    return Number.isFinite(saved) ? Math.min(420, Math.max(240, saved)) : 280;
  });
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dailyInputRef = useRef<HTMLTextAreaElement>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const sidebarWidthRef = useRef(sidebarWidth);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const filteredSessions = sessions.filter((session) => `${session.title}\n${session.messages.map((message) => message.content).join('\n')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const messages = draftMessages.length ? draftMessages : activeSession?.messages ?? [];

  useEffect(() => { setDraftMessages([]); }, [activeSessionId]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, streaming]);
  useEffect(() => {
    const textarea = dailyInputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 144) + 'px';
    setComposerExpanded(textarea.scrollHeight > 28);
  }, [input]);

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

  async function send() {
    const content = input.trim();
    if (!content || streaming) return;
    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = await onNewSession();
      if (!sessionId) return;
    }
    const userMessage: DailyMessage = { id: crypto.randomUUID(), role: 'user', content, createdAt: new Date().toISOString() };
    const answerMessage: DailyMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', createdAt: new Date().toISOString() };
    const next = [...(activeSession?.messages ?? []), userMessage, answerMessage];
    setDraftMessages(next);
    onInputChange(''); onError(''); onStreamChange(true);
    const controller = new AbortController();
    try {
      await memoryApi.streamChat(sessionId, content, (delta) => setDraftMessages((current) => current.map((message) => message.id === answerMessage.id ? { ...message, content: message.content + delta } : message)), controller.signal);
      setDraftMessages([]);
      onRefresh();
    } catch (caught) {
      setDraftMessages((current) => current.filter((message) => message.id !== answerMessage.id || message.content));
      onError((caught as Error).message);
    } finally { onStreamChange(false); }
  }

  async function saveAttachmentNote() {
    if (attachmentNote.trim().length < 10) { setAttachmentStatus('请至少输入一段完整材料。'); return; }
    setAttachmentBusy(true);
    try { await memoryApi.importDocument({ title: '对话外补充材料', sourceType: 'note', content: attachmentNote.trim() }); setAttachmentNote(''); setAttachmentStatus('已保存在本地记忆收件箱。'); } catch (caught) { setAttachmentStatus((caught as Error).message); } finally { setAttachmentBusy(false); }
  }

  async function importFile(file: File) {
    setAttachmentBusy(true);
    try { await onImport(file); setAttachmentStatus('ChatGPT 历史已导入本地收件箱。'); } catch (caught) { setAttachmentStatus((caught as Error).message); } finally { setAttachmentBusy(false); }
  }

  async function deleteSession(session: DailySession) {
    if (!window.confirm(`删除“${session.title}”及其中所有消息？相关候选记忆也会被删除。`)) return;
    try {
      await memoryApi.deleteSession(session.id);
      if (session.id === activeSessionId) onSelectSession('');
      onRefresh();
    } catch (caught) { onError((caught as Error).message); }
  }

  async function deleteMessage(message: DailyMessage) {
    if (!activeSessionId || !window.confirm('删除这条消息及其直接回复？相关候选记忆也会被删除。')) return;
    try { await memoryApi.deleteMessage(activeSessionId, message.id); setDraftMessages([]); onRefresh(); } catch (caught) { onError((caught as Error).message); }
  }

  return <div className="daily-layout" style={{ '--daily-sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
    <aside className="daily-history"><div className="daily-brand"><Sparkles size={21} /><span>MindClone</span><button className="icon-button sidebar-close" title="收起侧栏" onClick={onToggleSidebar}><PanelLeftClose size={19} /></button></div><nav className="daily-nav"><button className={mode === 'daily' ? 'active' : ''} onClick={() => onModeChange('daily')}><MessageCircle size={17} /> 日常对话</button><button onClick={() => onModeChange('prepare')}><FileText size={17} /> 面试准备</button><button onClick={() => onModeChange('memory')}><MessageSquarePlus size={17} /> 记忆投喂</button><button disabled={!hasPacket} onClick={() => hasPacket && onModeChange('formal')}><BotMessageSquare size={17} /> 正式面试</button></nav><div className="daily-history-top"><span>对话</span><button className="icon-button light" title="新建对话" onClick={() => void onNewSession()}><Plus size={18} /></button></div><label className="chat-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索对话" /></label><div className="session-list">{filteredSessions.length === 0 ? <p>{query ? '没有匹配的对话。' : '开始一次对话，MindClone 会在本机保留你的记录。'}</p> : filteredSessions.map((session) => <div key={session.id} className={session.id === activeSessionId ? 'session-item active' : 'session-item'}><button onClick={() => onSelectSession(session.id)}><span>{session.title}</span><small>{new Date(session.updatedAt).toLocaleDateString('zh-CN')}</small></button><button className="session-delete" title="删除对话" onClick={() => void deleteSession(session)}><Trash2 size={14} /></button></div>)}</div><div className="daily-sidebar-footer"><div className="local-status"><span /> 本地引擎</div><button className="icon-button light" title="设置" onClick={onOpenSettings}><Settings2 size={18} /></button></div><div className="sidebar-resize-handle" role="separator" aria-orientation="vertical" aria-label="调整侧栏宽度" onPointerDown={startSidebarResize} onPointerMove={resizeSidebar} onPointerUp={endSidebarResize} onPointerCancel={endSidebarResize} /></aside>{sidebarCollapsed && <button className="sidebar-reopen" title="展开侧栏" onClick={onToggleSidebar}><PanelLeftOpen size={19} /></button>}
    <section className="daily-conversation"><div className="daily-transcript" ref={listRef}>{messages.length === 0 ? <div className="daily-empty"><Sparkles size={32} /><h2>从最近在想的事开始</h2><p>所有对话默认保存在本机。重要内容会异步进入候选记忆，等待你审核。</p></div> : messages.map((message) => <article className={`daily-message ${message.role}`} key={message.id}><div>{message.role === 'user' ? '你' : 'MindClone'}<button className="message-delete" title="删除消息" onClick={() => void deleteMessage(message)}><Trash2 size={13} /></button></div><p>{message.content || (streaming ? '正在思考...' : '')}</p></article>)}{error && <div className="error-note">{error}</div>}</div>
      <div className={composerExpanded ? 'daily-composer expanded' : 'daily-composer'}><div className="attachment-area">{attachmentOpen && <div className="attachment-menu"><div className="attachment-menu-title">补充投喂</div><button onClick={() => fileRef.current?.click()}><FileUp size={17} /> 导入 ChatGPT 历史</button><button onClick={() => setAttachmentStatus('在下方粘贴 Markdown 或随手记。')}><Paperclip size={17} /> 添加文本 / Markdown</button><textarea value={attachmentNote} onChange={(event) => setAttachmentNote(event.target.value)} placeholder="粘贴补充材料..." /><button className="primary-button compact" disabled={attachmentBusy} onClick={() => void saveAttachmentNote()}>{attachmentBusy ? '处理中...' : '保存到收件箱'}</button>{attachmentStatus && <p>{attachmentStatus}</p>}</div>}<input ref={fileRef} className="hidden-input" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.currentTarget.value = ''; }} /><button className={attachmentOpen ? 'plus-button open' : 'plus-button'} title="添加材料" onClick={() => setAttachmentOpen((current) => !current)}><Plus size={21} /></button></div><textarea ref={dailyInputRef} rows={1} value={input} onChange={(event) => onInputChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder="和 MindClone 聊聊..." /><button className="send-icon" disabled={!input.trim() || streaming} title="发送" onClick={() => void send()}><SendHorizontal size={19} /></button></div>
    </section>
  </div>;
}

function MemoryView({ documents, candidates, error, onRefresh }: {
  documents: MemoryDocument[]; candidates: MemoryCandidate[]; error: string; onRefresh: () => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [title, setTitle] = useState('随手记录');
  const [interviewNote, setInterviewNote] = useState('');
  const [busyDocument, setBusyDocument] = useState<string | null>(null);
  const [localError, setLocalError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pending = candidates.filter((item) => item.status === 'pending');
  const approved = candidates.filter((item) => item.status === 'approved');

  async function saveText(sourceType: 'note' | 'conversation', value: string, nextTitle: string) {
    if (value.trim().length < 10) { setLocalError('请至少输入一段完整材料。'); return; }
    setBusyDocument('new');
    try {
      await memoryApi.importDocument({ title: nextTitle.trim() || '未命名材料', sourceType, content: value.trim() });
      if (sourceType === 'note') setNote(''); else setInterviewNote('');
      setLocalError('');
      await onRefresh();
    } catch (caught) { setLocalError((caught as Error).message); } finally { setBusyDocument(null); }
  }

  async function importChatGPT(file: File) {
    setBusyDocument('file');
    try {
      const contents = extractChatGPTConversations(JSON.parse(await file.text()));
      if (!contents.length) throw new Error('未从该导出中找到可读取的用户/助手对话。');
      for (const item of contents) await memoryApi.importDocument({ ...item, sourceType: 'chatgpt_export' });
      setLocalError('');
      await onRefresh();
    } catch (caught) { setLocalError((caught as Error).message); } finally { setBusyDocument(null); }
  }

  async function extract(documentId: string) {
    setBusyDocument(documentId);
    try { await memoryApi.extract(documentId); setLocalError(''); await onRefresh(); } catch (caught) { setLocalError((caught as Error).message); } finally { setBusyDocument(null); }
  }

  async function review(id: string, status: MemoryCandidate['status']) {
    try { await memoryApi.setStatus(id, status); await onRefresh(); } catch (caught) { setLocalError((caught as Error).message); }
  }

  return <div className="memory-layout">
    <header className="page-header"><div><p className="eyebrow">ASYNC MEMORY INBOX</p><h1>记忆投喂</h1><p className="subtle">原始材料先留在本机。整理结果需要你确认，才会成为正式可检索记忆。</p></div><button className="ghost-button" onClick={() => void onRefresh()}>刷新资料</button></header>
    <div className="memory-grid">
      <section className="memory-imports">
        <article className="memory-card"><div className="card-heading"><FileUp size={19} /><div><h2>ChatGPT 历史</h2><p>导入官方导出包中的 <code>conversations.json</code></p></div></div><input ref={fileInputRef} className="hidden-input" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importChatGPT(file); event.currentTarget.value = ''; }} /><button className="ghost-button full-width" disabled={busyDocument === 'file'} onClick={() => fileInputRef.current?.click()}><Upload size={16} /> {busyDocument === 'file' ? '正在导入...' : '选择 conversations.json'}</button></article>
        <article className="memory-card"><div className="card-heading"><FileText size={19} /><div><h2>随手记 / Markdown</h2><p>观点、经历、学习笔记或聊天片段</p></div></div><input className="memory-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="材料标题" /><textarea className="memory-textarea" value={note} onChange={(event) => setNote(event.target.value)} placeholder="直接粘贴任意文本或 Markdown..." /><button className="primary-button full-width" disabled={busyDocument === 'new'} onClick={() => void saveText('note', note, title)}><Upload size={16} /> 保存原始材料</button></article>
        <article className="memory-card"><div className="card-heading"><BotMessageSquare size={19} /><div><h2>访谈式投喂</h2><p>先将这轮对话原文存档，后续再接入提问引导</p></div></div><textarea className="memory-textarea short" value={interviewNote} onChange={(event) => setInterviewNote(event.target.value)} placeholder="我最近做了什么、怎么想、遇到了什么问题..." /><button className="ghost-button full-width" disabled={busyDocument === 'new'} onClick={() => void saveText('conversation', interviewNote, '访谈记录')}>保存本轮记录</button></article>
      </section>
      <section className="memory-review">
        <div className="memory-summary"><div><p className="eyebrow">LOCAL MATERIALS</p><h2>{documents.length} <span>份原始材料</span></h2></div><div><p className="eyebrow">APPROVED</p><h2>{approved.length} <span>条已确认记忆</span></h2></div></div>
        {(error || localError) && <div className="error-note">{error || localError}</div>}
        <div className="document-list"><h3>等待整理</h3>{documents.length === 0 ? <p className="empty-inline">导入后的原始材料会在此处等待整理。</p> : documents.map((document) => <article className="document-row" key={document.id}><div><strong>{document.title}</strong><span>{document.sourceType === 'chatgpt_export' ? 'ChatGPT 历史' : document.sourceType === 'note' ? '文本记录' : '访谈记录'} · {new Date(document.createdAt).toLocaleDateString('zh-CN')}</span></div><button className="ghost-button" disabled={busyDocument === document.id} onClick={() => void extract(document.id)}>{busyDocument === document.id ? 'DeepSeek 整理中...' : document.extractedAt ? '再次整理' : '提取候选记忆'}</button></article>)}</div>
        <div className="candidate-list"><h3>候选记忆 <span>{pending.length}</span></h3>{pending.length === 0 ? <p className="empty-inline">没有待审核条目。整理材料后，候选记忆会在此处出现。</p> : pending.map((candidate) => <article className="candidate-card" key={candidate.id}><div className="candidate-kind">{candidate.kind}</div><h4>{candidate.title}</h4><p>{candidate.content}</p>{candidate.tags.length > 0 && <div className="chip-row">{candidate.tags.map((tag) => <span className="chip" key={tag}>{tag}</span>)}</div>}<blockquote>{candidate.sourceQuote}</blockquote><div className="candidate-actions"><button className="reject-button" onClick={() => void review(candidate.id, 'rejected')}><X size={15} /> 忽略</button><button className="primary-button compact" onClick={() => void review(candidate.id, 'approved')}><CheckCircle2 size={15} /> 确认记忆</button></div></article>)}</div>
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
        <button className="primary-button" disabled={!ready} onClick={onPrepare}><ListChecks size={18} /> 生成面试简报 <ArrowRight size={17} /></button>
      </div>
      <div className="brief-panel">
        {packet ? <>
          <div className="brief-top"><div><p className="eyebrow">READY TO REVIEW</p><h2>面试简报</h2></div><CheckCircle2 size={24} /></div>
          <p className="prepared-time">最近准备于 {formatPreparedAt(packet.preparedAt)}</p>
          <section><h3>回答优先级</h3><div className="chip-row">{packet.focusAreas.map((item) => <span className="chip" key={item}>{item}</span>)}</div></section>
          <section><h3>本轮回答策略</h3><p>{packet.brief}</p></section>
          <section><h3>预计追问</h3><ul>{packet.questionTypes.map((item) => <li key={item}>{item}</li>)}</ul></section>
          <button className="enter-button" onClick={onEnter}><Play size={17} fill="currentColor" /> 确认，进入正式面试</button>
          <p className="fine-print">进入后会冻结本次 JD 与简历。正式链路只调用本地模型，可随时中断生成。</p>
        </> : <div className="empty-brief"><BotMessageSquare size={30} /><h2>等待本次材料</h2><p>准备完成后，MindClone 才会按这份 JD 组织你的经历与回答重点。</p></div>}
      </div>
    </div>
  </div>;
}

function FormalView(props: {
  packet: InterviewPacket; messages: Message[]; input: string; error: string; streaming: boolean;
  candidateDraft: string; messageCount: number; transcriptRef: React.RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void; onAsk: () => void; onStop: () => void; onInterrupt: () => void; onBack: () => void;
}) {
  const { packet, messages, input, error, streaming, candidateDraft, messageCount, transcriptRef, onInputChange, onAsk, onStop, onInterrupt, onBack } = props;
  return <div className="formal-layout">
    <header className="formal-header"><div><p className="eyebrow">FORMAL INTERVIEW</p><h1>候选回答</h1></div><div className="header-actions"><span className="ready-pill"><span /> 已冻结面试简报</span><button className="ghost-button" onClick={onBack}>返回准备</button></div></header>
    <div className="formal-body">
      <aside className="context-rail"><h2>本场上下文</h2><p>{packet.brief}</p><h3>优先素材</h3><div className="chip-row">{packet.focusAreas.map((item) => <span className="chip" key={item}>{item}</span>)}</div><div className="session-counter"><strong>{messageCount}</strong><span>个面试问题</span></div></aside>
      <section className="conversation"><div className="transcript" ref={transcriptRef}>
        {messages.length === 0 ? <div className="conversation-empty"><Volume2 size={28} /><h2>等待面试官问题</h2><p>输入问题，或稍后接入语音转写。候选回答将立即流式出现。</p></div> : messages.map((message) => <article className={`message ${message.role}`} key={message.id}><div className="message-label">{message.role === 'interviewer' ? '面试官' : 'MindClone 候选回答'}</div><p>{message.content || (streaming && message.role === 'candidate' ? '正在组织回答...' : '')}</p></article>)}
        {error && <div className="error-note">{error}</div>}
      </div>
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

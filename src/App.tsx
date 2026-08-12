import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, BotMessageSquare, CheckCircle2, CircleStop, FileText,
  ListChecks, Mic, Play, SendHorizontal, Settings2, Sparkles, Volume2,
} from 'lucide-react';
import { preparePacket, streamCandidateAnswer } from './interview';
import { loadPacket, loadSettings, savePacket, saveSettings } from './storage';
import type { InterviewPacket, Message, Mode, Settings } from './types';

const exampleJD = `远程后端工程师
负责服务端 API、数据库设计、性能优化与线上稳定性。熟悉任一主流后端语言，具备 SQL、Redis、Docker 和分布式系统基础；能独立沟通需求并推进交付。`;

const exampleResume = `毕业后从 Android 开发起步，随后创业并长期远程协作。创业过程中承担过产品、用户运营、客服、销售和招聘等工作；持续学习后端工程，具备跨语言学习和独立交付能力。`;

function formatPreparedAt(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function App() {
  const [mode, setMode] = useState<Mode>('prepare');
  const [jd, setJd] = useState('');
  const [resume, setResume] = useState('');
  const [packet, setPacket] = useState<InterviewPacket | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = loadPacket();
    if (stored) {
      setPacket(stored);
      setJd(stored.jd);
      setResume(stored.resume);
    }
  }, []);

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

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><Sparkles size={20} /><span>MindClone</span></div>
        <nav>
          <button className={mode === 'prepare' ? 'nav-item active' : 'nav-item'} onClick={() => setMode('prepare')}>
            <FileText size={18} /> 面试准备
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
        ) : packet ? (
          <FormalView
            packet={packet} messages={messages} input={input} error={error} streaming={streaming}
            candidateDraft={candidateDraft} messageCount={messageCount} transcriptRef={transcriptRef}
            onInputChange={setInput} onAsk={() => void askQuestion()} onStop={stopGeneration}
            onInterrupt={() => void interruptWithDraft()} onBack={() => { stopGeneration(); setMode('prepare'); }}
          />
        ) : null}
      </section>

      {showSettings && <SettingsDialog settings={settings} onClose={() => setShowSettings(false)} onChange={updateSettings} />}
    </main>
  );
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

function SettingsDialog({ settings, onClose, onChange }: { settings: Settings; onClose: () => void; onChange: (settings: Settings) => void }) {
  const [draft, setDraft] = useState(settings);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}><div className="settings-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div><p className="eyebrow">LOCAL INFERENCE</p><h2>模型连接</h2><p>正式面试只走本地兼容 OpenAI 的流式接口。</p></div><label>服务地址<input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label><label>模型名称<input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} /></label><div className="dialog-actions"><button className="ghost-button" onClick={onClose}>取消</button><button className="primary-button compact" onClick={() => { onChange(draft); onClose(); }}>保存</button></div></div></div>;
}

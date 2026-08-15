import { Children, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowDown, ChevronDown, Copy, MoreHorizontal, PanelLeftClose, Pencil, Pin, Plus, SendHorizontal, Settings2, Trash2 } from 'lucide-react';

export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt?: string };
export type ChatSession = { id: string; title: string; pinned?: boolean; createdAt?: string; updatedAt?: string; messages: ChatMessage[] };
export type ChatModelOption = { id: string; name: string; detail?: string };
export type ChatAdapter<Session extends ChatSession> = {
  listSessions: () => Promise<Session[]>;
  createSession: () => Promise<Session>;
  updateSession: (sessionId: string, values: Partial<Pick<Session, 'title' | 'pinned'>>) => Promise<Session>;
  deleteSession: (sessionId: string) => Promise<void>;
  send: (request: { sessionId: string; content: string; model: string; replaceFromMessageId?: string; signal: AbortSignal; onDelta: (delta: string) => void }) => Promise<void>;
};

export function useChatController<Session extends ChatSession>(adapter: ChatAdapter<Session>, model: string) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [newChatActive, setNewChatActive] = useState(false);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [draftMessages, setDraftMessages] = useState<ChatMessage[]>([]);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const messages = draftMessages.length ? draftMessages : newChatActive ? [] : activeSession?.messages ?? [];

  const refreshSessions = useCallback(async (preferredId?: string) => {
    try {
      const next = await adapter.listSessions();
      setSessions(next);
      setActiveSessionId((current) => preferredId ?? (current && next.some((session) => session.id === current) ? current : next[0]?.id ?? null));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load conversations.'); }
  }, [adapter]);

  useEffect(() => { void refreshSessions(); }, [refreshSessions]);
  function newChat() { setDraftMessages([]); setNewChatActive(true); setActiveSessionId(null); setInput(''); setError(''); }
  function selectSession(id: string) { setDraftMessages([]); setNewChatActive(false); setActiveSessionId(id); setError(''); }

  async function send(contentOverride?: string, replaceFromMessageId?: string) {
    const content = (contentOverride ?? input).trim();
    if (!content || streaming) return;
    let sessionId = newChatActive ? null : activeSessionId;
    if (!sessionId) {
      try {
        const session = await adapter.createSession();
        sessionId = session.id;
        setSessions((current) => [session, ...current]);
        setActiveSessionId(session.id);
        setNewChatActive(false);
      } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to create conversation.'); return; }
    }
    const createdAt = new Date().toISOString();
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content, createdAt };
    const answerMessage: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', createdAt };
    const branchIndex = replaceFromMessageId ? activeSession?.messages.findIndex((message) => message.id === replaceFromMessageId) ?? -1 : -1;
    const branchMessages = branchIndex >= 0 ? activeSession?.messages.slice(0, branchIndex) ?? [] : activeSession?.messages ?? [];
    setDraftMessages([...branchMessages, userMessage, answerMessage]);
    setInput(''); setError(''); setStreaming(true);
    try {
      await adapter.send({ sessionId, content, model, replaceFromMessageId, signal: new AbortController().signal, onDelta: (delta) => setDraftMessages((current) => current.map((message) => message.id === answerMessage.id ? { ...message, content: message.content + delta } : message)) });
      await refreshSessions(sessionId);
      setDraftMessages([]);
    } catch (caught) {
      setDraftMessages((current) => current.filter((message) => message.id !== answerMessage.id || message.content));
      setError(caught instanceof Error ? caught.message : 'Chat request failed.');
    } finally { setStreaming(false); }
  }

  async function updateSession(session: Session, values: Partial<Pick<Session, 'title' | 'pinned'>>) {
    try { await adapter.updateSession(session.id, values); await refreshSessions(activeSessionId || undefined); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to update conversation.'); }
  }

  async function deleteSession(session: Session) {
    try { await adapter.deleteSession(session.id); if (activeSessionId === session.id) newChat(); await refreshSessions(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to delete conversation.'); }
  }

  return { sessions, activeSessionId, newChatActive, input, streaming, error, messages, setInput, setError, newChat, selectSession, refreshSessions, send, updateSession, deleteSession };
}

export function MarkdownText({ content }: { content: string }) {
  return <div className="chat-rich-text"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    p: ({ children }) => {
      const items = Children.toArray(children).filter((child) => typeof child !== 'string' || child.trim());
      const standaloneStrong = items.length === 1 && isValidElement(items[0]) && items[0].type === 'strong';
      return <p className={standaloneStrong ? 'standalone-strong' : undefined}>{children}</p>;
    },
    table: ({ children }) => <div className="chat-table-scroll"><table>{children}</table></div>,
  }}>{content}</ReactMarkdown></div>;
}
export function ThinkingIndicator() { return <span className="chat-thinking" role="status" aria-label="Thinking"><span>Thinking</span><i /><i /><i /></span>; }

export function ChatSidebar(props: { brand: string; brandIcon: ReactNode; sessions: ChatSession[]; activeSessionId: string | null; width: number; onWidthChange: (width: number) => void; onCollapse: () => void; onNewChat: () => void; onSelectSession: (id: string) => void; onSettings: () => void; nav?: ReactNode; status?: ReactNode; onPin?: (session: ChatSession) => void; onRename?: (session: ChatSession) => void; onDelete?: (session: ChatSession) => void }) {
  const [menu, setMenu] = useState<string | null>(null); const drag = useRef<{ x: number; width: number } | null>(null);
  const sessions = [...props.sessions].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return <aside className="chat-sidebar" style={{ width: props.width }}><div className="chat-brand">{props.brandIcon}<span>{props.brand}</span><button className="chat-icon chat-sidebar-close" title="Collapse sidebar" onClick={props.onCollapse}><PanelLeftClose size={19} /></button></div><nav className="chat-nav"><button onClick={props.onNewChat}><Plus size={16} />New chat</button>{props.nav}</nav><div className="chat-recents"><div className="chat-recents-title">Recents</div>{sessions.length ? sessions.map((session) => <div className={session.id === props.activeSessionId ? 'chat-session active' : 'chat-session'} key={session.id}><button onClick={() => props.onSelectSession(session.id)}>{session.pinned && <Pin size={12} fill="currentColor" />}<span>{session.title}</span></button>{(props.onPin || props.onRename || props.onDelete) && <div className="chat-session-more"><button title="Conversation options" onClick={() => setMenu(menu === session.id ? null : session.id)}><MoreHorizontal size={17} /></button>{menu === session.id && <div className="chat-session-menu">{props.onPin && <button onClick={() => props.onPin?.(session)}><Pin size={15} />{session.pinned ? 'Unpin' : 'Pin'}</button>}{props.onRename && <button onClick={() => props.onRename?.(session)}><Pencil size={15} />Rename</button>}{props.onDelete && <button className="danger" onClick={() => props.onDelete?.(session)}><Trash2 size={15} />Delete</button>}</div>}</div>}</div>) : <p>No conversations yet.</p>}</div><div className="chat-sidebar-footer"><span>{props.status}</span><button className="chat-icon" title="Settings" onClick={props.onSettings}><Settings2 size={18} /></button></div><div className="chat-resize" onPointerDown={(e) => { drag.current = { x: e.clientX, width: props.width }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={(e) => { if (drag.current) props.onWidthChange(Math.min(420, Math.max(240, drag.current.width + e.clientX - drag.current.x))); }} onPointerUp={() => { drag.current = null; }} /></aside>;
}

export function ChatConversation(props: { messages: ChatMessage[]; input: string; streaming: boolean; error?: string; model: string; models: ChatModelOption[]; placeholder: string; empty: ReactNode; onInputChange: (value: string) => void; onModelChange: (id: string) => void; onSend: (content: string, replaceFromMessageId?: string) => void; renderContent?: (content: string) => ReactNode; leading?: ReactNode; onEdit?: (message: ChatMessage, content: string) => void }) {
  const [modelOpen, setModelOpen] = useState(false); const [editing, setEditing] = useState<ChatMessage | null>(null); const [showLatest, setShowLatest] = useState(false); const [expanded, setExpanded] = useState(false); const list = useRef<HTMLDivElement>(null); const input = useRef<HTMLTextAreaElement>(null); const modelMenu = useRef<HTMLDivElement>(null); const following = useRef(true);
  useLayoutEffect(() => { if (following.current && list.current) list.current.scrollTop = list.current.scrollHeight; }, [props.messages, props.streaming]);
  useLayoutEffect(() => { if (!input.current) return; input.current.style.height = 'auto'; const height = Math.min(input.current.scrollHeight, 144); input.current.style.height = `${height}px`; setExpanded(Boolean(props.input) && height > 28); }, [props.input]);
  useEffect(() => {
    if (!modelOpen) return;
    const close = (event: MouseEvent) => { if (!modelMenu.current?.contains(event.target as Node)) setModelOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [modelOpen]);
  return <section className="chat-conversation"><div className="chat-transcript" ref={list} onScroll={() => { if (!list.current) return; following.current = list.current.scrollHeight - list.current.scrollTop - list.current.clientHeight <= 24; setShowLatest(!following.current); }}>{props.messages.length ? props.messages.map((message) => <article className={`chat-message ${message.role}`} key={message.id}>{editing?.id === message.id ? <div className="chat-editor"><textarea autoFocus value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { props.onEdit?.(message, editing.content); setEditing(null); } if (e.key === 'Escape') setEditing(null); }} /><div><button onClick={() => setEditing(null)}>Cancel</button><button disabled={!editing.content.trim() || props.streaming} onClick={() => { props.onEdit?.(message, editing.content); setEditing(null); }}>Send</button></div></div> : <><div className="chat-message-body">{message.content ? (props.renderContent?.(message.content) || <MarkdownText content={message.content} />) : props.streaming && message.role === 'assistant' ? <ThinkingIndicator /> : null}</div>{message.content && <div className="chat-message-actions"><button title="Copy message" aria-label="Copy message" onClick={() => navigator.clipboard.writeText(message.content)}><Copy size={16} /></button>{message.role === 'user' && props.onEdit && <button title="Edit message" aria-label="Edit message" onClick={() => setEditing(message)}><Pencil size={16} /></button>}</div>}</>}</article>) : <div className="chat-empty">{props.empty}</div>}{props.error && <div className="chat-error">{props.error}</div>}</div><button className={showLatest ? 'chat-scroll-latest visible' : 'chat-scroll-latest'} title="Back to latest message" aria-label="Back to latest message" onClick={() => { following.current = true; list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); setShowLatest(false); }}><ArrowDown size={18} /></button><div className={expanded ? 'chat-composer expanded' : 'chat-composer'}>{props.leading}<textarea ref={input} rows={1} value={props.input} onChange={(e) => props.onInputChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); props.onSend(props.input); } }} placeholder={props.placeholder} /><div ref={modelMenu} className={modelOpen ? 'chat-model open' : 'chat-model'}><button type="button" aria-haspopup="menu" aria-expanded={modelOpen} onClick={() => setModelOpen(!modelOpen)}>{props.models.find((item) => item.id === props.model)?.name || props.model}<ChevronDown size={16} /></button>{modelOpen && <div className="chat-model-menu" role="menu">{props.models.map((option) => <button role="menuitem" className={option.id === props.model ? 'selected' : ''} key={option.id} onClick={() => { props.onModelChange(option.id); setModelOpen(false); }}><strong>{option.name}</strong>{option.detail && <span>{option.detail}</span>}</button>)}</div>}</div><button className="chat-send" title="Send" aria-label="Send" disabled={!props.input.trim() || props.streaming} onClick={() => props.onSend(props.input)}><SendHorizontal size={19} /></button></div></section>;
}

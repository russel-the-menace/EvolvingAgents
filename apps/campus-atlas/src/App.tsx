import { useEffect, useState } from 'react';
import { ChevronDown, Compass, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, SendHorizontal, Settings2 } from 'lucide-react';
import { ChatConversation, ChatSidebar } from '@evolving-agents/chat-ui';

type Message = { id: string; role: 'user' | 'assistant'; text: string };
type Session = { id: string; title: string; messages: Message[] };
type Theme = 'light' | 'dark' | 'system';
const sessionKey = 'campus-atlas-sessions';

function loadSessions(): Session[] { try { const value = JSON.parse(window.localStorage.getItem(sessionKey) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }

async function readApiResponse(response: Response) {
  const raw = await response.text();
  let body: { content?: string; error?: string } = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`CampusAtlas API returned ${response.status} without valid JSON.`); }
  if (!response.ok) throw new Error(body.error || `CampusAtlas API returned ${response.status}.`);
  return body;
}

export function App() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [quality, setQuality] = useState<'Medium' | 'High'>(() => window.localStorage.getItem('campus-atlas-quality') === 'High' ? 'High' : 'Medium');
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.matchMedia('(max-width: 780px)').matches);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [theme, setTheme] = useState<Theme>(() => { const saved = window.localStorage.getItem('campus-atlas-theme'); return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'; });
  const active = sessions.find((session) => session.id === activeId)!;
  useEffect(() => { window.localStorage.setItem(sessionKey, JSON.stringify(sessions)); }, [sessions]);
  useEffect(() => { document.documentElement.dataset.theme = theme; window.localStorage.setItem('campus-atlas-theme', theme); }, [theme]);
  function newChat() { setActiveId(null); setInput(''); setError(''); }
  async function send() {
    const text = input.trim(); if (!text || sending) return;
    const id = activeId || crypto.randomUUID(); const user: Message = { id: crypto.randomUUID(), role: 'user', text };
    const next: Session = { id, title: active?.title || text.slice(0, 48), messages: [...(active?.messages || []), user] };
    setSessions((current) => [next, ...current.filter((session) => session.id !== id)]); setActiveId(id); setInput(''); setError(''); setSending(true);
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quality, messages: next.messages.map((message) => ({ role: message.role, content: message.text })) }) });
      const body = await readApiResponse(response);
      if (!body.content) throw new Error('CampusAtlas API returned no assistant content.');
      const assistant: Message = { id: crypto.randomUUID(), role: 'assistant', text: body.content };
      setSessions((current) => current.map((session) => session.id === id ? { ...session, messages: [...session.messages, assistant] } : session));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Chat request failed.'); } finally { setSending(false); }
  }
  return <main className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} style={{ gridTemplateColumns: sidebarCollapsed ? 'minmax(0, 1fr)' : `${sidebarWidth}px minmax(0, 1fr)` }}>
    {!sidebarCollapsed && <ChatSidebar brand="CampusAtlas" brandIcon={<Compass size={21} />} sessions={sessions} activeSessionId={activeId} width={sidebarWidth} onWidthChange={setSidebarWidth} onCollapse={() => setSidebarCollapsed(true)} onNewChat={newChat} onSelectSession={(id) => { setActiveId(id); setError(''); }} onSettings={() => setSettingsOpen(true)} status="Evidence engine" />}
    {sidebarCollapsed && <button className="sidebar-reopen" title="Expand sidebar" onClick={() => setSidebarCollapsed(false)}><PanelLeftOpen size={19} /></button>}
    <ChatConversation messages={(active?.messages || []).map((message) => ({ id: message.id, role: message.role, content: message.text }))} input={input} streaming={sending} error={error} model={quality} models={[{ id: 'Medium', name: 'DeepSeek Medium', detail: 'Balanced reasoning' }, { id: 'High', name: 'DeepSeek High', detail: 'More thorough reasoning' }]} placeholder="Ask about a campus policy or competition plan" empty={<><Compass size={34} /><h1>Campus policy, with evidence</h1><p>Ask a question, paste competition material, or describe your goals.</p></>} onInputChange={setInput} onModelChange={(value) => { const next = value === 'High' ? 'High' : 'Medium'; setQuality(next); window.localStorage.setItem('campus-atlas-quality', next); }} onSend={() => void send()} />
    {settingsOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}><p className="eyebrow">CAMPUSATLAS SETTINGS</p><h2 id="settings-title">Settings</h2><p>Choose how CampusAtlas appears on this device.</p><div className="theme-field"><span>Theme</span><div className="theme-options">{(['light', 'dark', 'system'] as Theme[]).map((option) => <button key={option} type="button" className={theme === option ? 'selected' : ''} onClick={() => setTheme(option)}>{option === 'light' ? 'Light' : option === 'dark' ? 'Dark' : 'System'}</button>)}</div></div><div className="dialog-actions"><button className="ghost-button" onClick={() => setSettingsOpen(false)}>Close</button></div></section></div>}
  </main>;
  /* ponytail: legacy CampusAtlas chat markup stays as a rollback path until screenshot parity is signed off. */
  return <main className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="sidebar"><div className="brand"><Compass size={21} /><span>CampusAtlas</span><button className="icon-button sidebar-close" title="Collapse sidebar" aria-label="Collapse sidebar" onClick={() => setSidebarCollapsed(true)}><PanelLeftClose size={18} /></button></div><nav aria-label="Conversation actions"><button className="new-chat" onClick={newChat}><Plus size={16} />New chat</button></nav><section className="recents"><p>Recents</p>{sessions.length ? sessions.map((session) => <button key={session.id} className={session.id === activeId ? 'recent active' : 'recent'} onClick={() => { setActiveId(session.id); setError(''); }}><MessageSquare size={15} /><span>{session.title}</span></button>) : <span className="empty-recents">No conversations yet.</span>}</section><div className="sidebar-footer"><button className="icon-button" title="Settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}><Settings2 size={18} /></button></div></aside>
    {sidebarCollapsed && <button className="sidebar-reopen" title="Expand sidebar" aria-label="Expand sidebar" onClick={() => setSidebarCollapsed(false)}><PanelLeftOpen size={19} /></button>}
    <section className="conversation"><div className="transcript" aria-live="polite">{!active ? <div className="empty-state"><Compass size={34} /><h1>Campus policy, with evidence</h1><p>Ask a question, paste competition material, or describe your goals. CampusAtlas will learn from explicit source-like messages and use them in the same conversation.</p></div> : active.messages.map((message) => <article className={`message ${message.role}`} key={message.id}><div className="message-body">{message.text}</div></article>)}{sending && <article className="message assistant"><div className="message-body"><span className="thinking-indicator" role="status" aria-label="Thinking"><span className="thinking-label">Thinking</span><span /><span /><span /></span></div></article>}{error && <p className="error-note">{error}</p>}</div><form className="composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Ask about a campus policy or competition plan" aria-label="Campus policy question" rows={1} /><div className={qualityMenuOpen ? 'model-picker open' : 'model-picker'}><button type="button" aria-haspopup="menu" aria-expanded={qualityMenuOpen} onClick={() => setQualityMenuOpen((open) => !open)}>{`DeepSeek ${quality}`}<ChevronDown size={15} /></button>{qualityMenuOpen && <div className="model-menu" role="menu">{(['Medium', 'High'] as const).map((option) => <button key={option} role="menuitem" className={quality === option ? 'selected' : ''} onClick={() => { setQuality(option); window.localStorage.setItem('campus-atlas-quality', option); setQualityMenuOpen(false); }}><strong>DeepSeek {option}</strong><span>{option === 'Medium' ? 'Balanced reasoning' : 'More thorough reasoning'}</span></button>)}</div>}</div><button type="submit" className="send" title="Send message" aria-label="Send message" disabled={!input.trim() || sending}><SendHorizontal size={17} /></button></form></section>
    {settingsOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}><p className="eyebrow">CAMPUSATLAS SETTINGS</p><h2 id="settings-title">Settings</h2><p>Choose how CampusAtlas appears on this device.</p><div className="theme-field"><span>Theme</span><div className="theme-options">{(['light', 'dark', 'system'] as Theme[]).map((option) => <button key={option} type="button" className={theme === option ? 'selected' : ''} onClick={() => setTheme(option)}>{option === 'light' ? 'Light' : option === 'dark' ? 'Dark' : 'System'}</button>)}</div></div><div className="dialog-actions"><button className="ghost-button" onClick={() => setSettingsOpen(false)}>Close</button></div></section></div>}
  </main>;
}

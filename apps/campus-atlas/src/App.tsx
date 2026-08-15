import { useEffect, useState } from 'react';
import { ChevronDown, Compass, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, SendHorizontal, Settings2 } from 'lucide-react';

type Message = { id: string; role: 'user' | 'assistant'; text: string };
type Session = { id: string; title: string; messages: Message[] };
type Theme = 'light' | 'dark' | 'system';
const sessionKey = 'campus-atlas-sessions';

function loadSessions(): Session[] { try { const value = JSON.parse(window.localStorage.getItem(sessionKey) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }

export function App() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [quality, setQuality] = useState<'Medium' | 'High'>(() => window.localStorage.getItem('campus-atlas-quality') === 'High' ? 'High' : 'Medium');
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceUri, setSourceUri] = useState('');
  const [sourceContent, setSourceContent] = useState('');
  const [sourcePrivate, setSourcePrivate] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planQuestion, setPlanQuestion] = useState('');
  const [plan, setPlan] = useState('');
  const [planBusy, setPlanBusy] = useState(false);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.matchMedia('(max-width: 780px)').matches);
  const [theme, setTheme] = useState<Theme>(() => { const saved = window.localStorage.getItem('campus-atlas-theme'); return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'; });
  const active = sessions.find((session) => session.id === activeId) || null;
  useEffect(() => { window.localStorage.setItem(sessionKey, JSON.stringify(sessions)); }, [sessions]);
  useEffect(() => { document.documentElement.dataset.theme = theme; window.localStorage.setItem('campus-atlas-theme', theme); }, [theme]);
  function newChat() { setActiveId(null); setInput(''); setError(''); }
  async function ingestSource() {
    if (!sourceTitle.trim() || !sourceContent.trim() || sourceBusy) return;
    setSourceBusy(true); setError('');
    try {
      const response = await fetch('/api/knowledge/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: sourceTitle, sourceUri, content: sourceContent, sourceType: sourcePrivate ? 'user_note' : 'manual_competition', sourceActor: sourcePrivate ? 'user' : 'manual-source', metadata: { domain: sourcePrivate ? 'user_profile' : 'competition', accessScope: sourcePrivate ? 'private_profile' : 'public' }, quality }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Source ingestion failed.');
      setSourceOpen(false); setSourceTitle(''); setSourceUri(''); setSourceContent('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Source ingestion failed.'); } finally { setSourceBusy(false); }
  }
  async function generatePlan() {
    if (!planQuestion.trim() || planBusy) return;
    setPlanBusy(true); setError('');
    try {
      const response = await fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: planQuestion, quality, accessScopes: ['public', 'private_profile'] }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Planning request failed.');
      setPlan(body.plan); setPlanOpen(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Planning request failed.'); } finally { setPlanBusy(false); }
  }
  async function send() {
    const text = input.trim(); if (!text || sending) return;
    const id = activeId || crypto.randomUUID(); const user: Message = { id: crypto.randomUUID(), role: 'user', text };
    const next: Session = { id, title: active?.title || text.slice(0, 48), messages: [...(active?.messages || []), user] };
    setSessions((current) => [next, ...current.filter((session) => session.id !== id)]); setActiveId(id); setInput(''); setError(''); setSending(true);
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quality, messages: next.messages.map((message) => ({ role: message.role, content: message.text })) }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Chat request failed.');
      const assistant: Message = { id: crypto.randomUUID(), role: 'assistant', text: body.content };
      setSessions((current) => current.map((session) => session.id === id ? { ...session, messages: [...session.messages, assistant] } : session));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Chat request failed.'); } finally { setSending(false); }
  }
  return <main className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="sidebar"><div className="brand"><Compass size={21} /><span>CampusAtlas</span><button className="icon-button sidebar-close" title="Collapse sidebar" aria-label="Collapse sidebar" onClick={() => setSidebarCollapsed(true)}><PanelLeftClose size={18} /></button></div><nav aria-label="Conversation actions"><button className="new-chat" onClick={newChat}><Plus size={16} />New chat</button></nav><section className="recents"><p>Recents</p>{sessions.length ? sessions.map((session) => <button key={session.id} className={session.id === activeId ? 'recent active' : 'recent'} onClick={() => { setActiveId(session.id); setError(''); }}><MessageSquare size={15} /><span>{session.title}</span></button>) : <span className="empty-recents">No conversations yet.</span>}</section><div className="sidebar-footer"><button className="icon-button" title="Settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}><Settings2 size={18} /></button></div></aside>
    {sidebarCollapsed && <button className="sidebar-reopen" title="Expand sidebar" aria-label="Expand sidebar" onClick={() => setSidebarCollapsed(false)}><PanelLeftOpen size={19} /></button>}
    <section className="conversation"><div className="transcript" aria-live="polite">{!active ? <div className="empty-state"><Compass size={34} /><h1>Campus policy, with evidence</h1><p>Ask about a campus policy. Verified sources and citations will appear with each answer.</p><div className="empty-actions"><button className="ghost-button" onClick={() => setSourceOpen(true)}>Add source</button><button className="primary-button" onClick={() => setPlanOpen(true)}>Plan my competitions</button></div></div> : active.messages.map((message) => <article className={`message ${message.role}`} key={message.id}><div className="message-body">{message.text}</div></article>)}{sending && <article className="message"><div className="message-body">Thinking...</div></article>}{error && <p className="error-note">{error}</p>}</div><form className="composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void send(); }} placeholder="Ask about a campus policy" aria-label="Campus policy question" rows={1} /><div className={qualityMenuOpen ? 'model-picker open' : 'model-picker'}><button type="button" aria-haspopup="menu" aria-expanded={qualityMenuOpen} onClick={() => setQualityMenuOpen((open) => !open)}>{`DeepSeek ${quality}`}<ChevronDown size={15} /></button>{qualityMenuOpen && <div className="model-menu" role="menu">{(['Medium', 'High'] as const).map((option) => <button key={option} role="menuitem" className={quality === option ? 'selected' : ''} onClick={() => { setQuality(option); window.localStorage.setItem('campus-atlas-quality', option); setQualityMenuOpen(false); }}><strong>DeepSeek {option}</strong><span>{option === 'Medium' ? 'Balanced reasoning' : 'More thorough reasoning'}</span></button>)}</div>}</div><button type="submit" className="send" title="Send message" aria-label="Send message" disabled={!input.trim() || sending}><SendHorizontal size={17} /></button></form></section>
    {settingsOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}><p className="eyebrow">CAMPUSATLAS SETTINGS</p><h2 id="settings-title">Settings</h2><p>Choose how CampusAtlas appears on this device.</p><div className="theme-field"><span>Theme</span><div className="theme-options">{(['light', 'dark', 'system'] as Theme[]).map((option) => <button key={option} type="button" className={theme === option ? 'selected' : ''} onClick={() => setTheme(option)}>{option === 'light' ? 'Light' : option === 'dark' ? 'Dark' : 'System'}</button>)}</div></div><div className="dialog-actions"><button className="ghost-button" onClick={() => setSettingsOpen(false)}>Close</button></div></section></div>}
    {sourceOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setSourceOpen(false)}><section className="settings-dialog source-dialog" role="dialog" aria-modal="true" aria-labelledby="source-title" onMouseDown={(event) => event.stopPropagation()}><p className="eyebrow">KNOWLEDGE SOURCE</p><h2 id="source-title">Add source</h2><p>Paste an official competition notice or your own constraints. DeepSeek will extract claims and retain the original text as evidence.</p><label>Title<input value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} placeholder="Competition or profile note" /></label><label>Official URL<input value={sourceUri} onChange={(event) => setSourceUri(event.target.value)} placeholder="https://..." /></label><label>Source text<textarea value={sourceContent} onChange={(event) => setSourceContent(event.target.value)} placeholder="Paste the competition notice or your notes" /></label><label className="checkbox-row"><input type="checkbox" checked={sourcePrivate} onChange={(event) => setSourcePrivate(event.target.checked)} /> This is my private profile information</label><div className="dialog-actions"><button className="ghost-button" onClick={() => setSourceOpen(false)}>Cancel</button><button className="primary-button" disabled={!sourceTitle.trim() || !sourceContent.trim() || sourceBusy} onClick={() => void ingestSource()}>{sourceBusy ? 'Extracting...' : 'Save source'}</button></div></section></div>}
    {planOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setPlanOpen(false)}><section className="settings-dialog plan-dialog" role="dialog" aria-modal="true" aria-labelledby="plan-title" onMouseDown={(event) => event.stopPropagation()}><p className="eyebrow">COMPETITION PLANNER</p><h2 id="plan-title">Plan my competitions</h2><p>Planning uses only stored competition evidence and your authorized profile information.</p><textarea value={planQuestion} onChange={(event) => setPlanQuestion(event.target.value)} placeholder="例如：按我的时间和 AI 兴趣，安排今年最适合参加的竞赛" /><div className="dialog-actions"><button className="ghost-button" onClick={() => setPlanOpen(false)}>Close</button><button className="primary-button" disabled={!planQuestion.trim() || planBusy} onClick={() => void generatePlan()}>{planBusy ? 'Planning...' : 'Generate plan'}</button></div>{plan && <div className="plan-output"><h3>Current plan</h3><pre>{plan}</pre></div>}</section></div>}
  </main>;
}

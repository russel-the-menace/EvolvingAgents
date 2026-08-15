import { useEffect, useState } from 'react';
import { Compass, PanelLeftOpen } from 'lucide-react';
import { ChatConversation, ChatSidebar, useChatController, type ChatAdapter } from '@evolving-agents/chat-ui';

type Message = { id: string; role: 'user' | 'assistant'; content: string; text?: string; createdAt?: string };
type Session = { id: string; title: string; pinned?: boolean; updatedAt?: string; messages: Message[] };
type Theme = 'light' | 'dark' | 'system';
async function readApiResponse(response: Response) {
  const raw = await response.text();
  let body: any = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`CampusAtlas API returned ${response.status} without valid JSON.`); }
  if (!response.ok) throw new Error(body.error || `CampusAtlas API returned ${response.status}.`);
  return body;
}

const chatAdapter: ChatAdapter<Session> = {
  listSessions: async () => {
    let body = await readApiResponse(await fetch('/api/chat/sessions'));
    const legacy = window.localStorage.getItem('campus-atlas-sessions');
    if (!body.sessions?.length && legacy) {
      body = await readApiResponse(await fetch('/api/chat/sessions/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessions: JSON.parse(legacy) }) }));
      window.localStorage.removeItem('campus-atlas-sessions');
    }
    return body.sessions || [];
  },
  createSession: async () => (await readApiResponse(await fetch('/api/chat/sessions', { method: 'POST' }))).session,
  send: async ({ sessionId, content, model, signal, onDelta }) => {
    const body = await readApiResponse(await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify({ quality: model, sessionId, content }) }));
    if (!body.content) throw new Error('CampusAtlas API returned no assistant content.');
    onDelta(body.content);
  },
};

export function App() {
  const [quality, setQuality] = useState<'Medium' | 'High'>(() => window.localStorage.getItem('campus-atlas-quality') === 'High' ? 'High' : 'Medium');
  const chat = useChatController(chatAdapter, quality);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.matchMedia('(max-width: 780px)').matches);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [theme, setTheme] = useState<Theme>(() => { const saved = window.localStorage.getItem('campus-atlas-theme'); return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'; });
  useEffect(() => { document.documentElement.dataset.theme = theme; window.localStorage.setItem('campus-atlas-theme', theme); }, [theme]);
  async function updateSession(session: Session, values: Partial<Pick<Session, 'title' | 'pinned'>>) { await readApiResponse(await fetch(`/api/chat/sessions/${session.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) })); await chat.refreshSessions(chat.activeSessionId || undefined); }
  async function deleteSession(session: Session) { await fetch(`/api/chat/sessions/${session.id}`, { method: 'DELETE' }); if (chat.activeSessionId === session.id) chat.newChat(); await chat.refreshSessions(); }
  return <main className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} style={{ gridTemplateColumns: sidebarCollapsed ? 'minmax(0, 1fr)' : `${sidebarWidth}px minmax(0, 1fr)` }}>
    {!sidebarCollapsed && <ChatSidebar brand="CampusAtlas" brandIcon={<Compass size={21} />} sessions={chat.sessions} activeSessionId={chat.newChatActive ? null : chat.activeSessionId} width={sidebarWidth} onWidthChange={setSidebarWidth} onCollapse={() => setSidebarCollapsed(true)} onNewChat={chat.newChat} onSelectSession={chat.selectSession} onSettings={() => setSettingsOpen(true)} status="Evidence engine" onPin={(session) => void updateSession(session as Session, { pinned: !session.pinned })} onRename={(session) => { const title = window.prompt('Rename conversation', session.title)?.trim(); if (title) void updateSession(session as Session, { title }); }} onDelete={(session) => void deleteSession(session as Session)} />}
    {sidebarCollapsed && <button className="sidebar-reopen" title="Expand sidebar" onClick={() => setSidebarCollapsed(false)}><PanelLeftOpen size={19} /></button>}
    <ChatConversation messages={chat.messages} input={chat.input} streaming={chat.streaming} error={chat.error} model={quality} models={[{ id: 'Medium', name: 'DeepSeek Medium', detail: 'Balanced reasoning' }, { id: 'High', name: 'DeepSeek High', detail: 'More thorough reasoning' }]} placeholder="Ask about a campus policy or competition plan" empty={<><Compass size={34} /><h1>Campus policy, with evidence</h1><p>Ask a question, paste competition material, or describe your goals.</p></>} onInputChange={chat.setInput} onModelChange={(value) => { const next = value === 'High' ? 'High' : 'Medium'; setQuality(next); window.localStorage.setItem('campus-atlas-quality', next); }} onSend={(content) => void chat.send(content)} />
    {settingsOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}><p className="eyebrow">CAMPUSATLAS SETTINGS</p><h2 id="settings-title">Settings</h2><p>Choose how CampusAtlas appears on this device.</p><div className="theme-field"><span>Theme</span><div className="theme-options">{(['light', 'dark', 'system'] as Theme[]).map((option) => <button key={option} type="button" className={theme === option ? 'selected' : ''} onClick={() => setTheme(option)}>{option === 'light' ? 'Light' : option === 'dark' ? 'Dark' : 'System'}</button>)}</div></div><div className="dialog-actions"><button className="ghost-button" onClick={() => setSettingsOpen(false)}>Close</button></div></section></div>}
  </main>;
}

import { useRef, useState } from 'react';
import { Compass, FileUp, PanelLeftOpen, Plus } from 'lucide-react';
import { ChatConversation, ChatSidebar, readChatStream, useChatController, useChatPreferences, type ChatAdapter, type ChatTheme } from '@evolving-agents/chat-ui';

type Message = { id: string; role: 'user' | 'assistant'; content: string; text?: string; createdAt?: string };
type Session = { id: string; title: string; pinned?: boolean; updatedAt?: string; messages: Message[] };
function readFileData(file: File) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Unable to read the selected PDF.')); reader.readAsDataURL(file); });
}
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
  updateSession: async (sessionId, values) => (await readApiResponse(await fetch(`/api/chat/sessions/${sessionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }))).session,
  deleteSession: async (sessionId) => { await readApiResponse(await fetch(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' })); },
  send: async ({ sessionId, content, model, signal, onDelta }) => {
    const response = await fetch('/api/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify({ quality: model, sessionId, content }) });
    await readChatStream(response, onDelta);
  },
};

function CampusAttachment() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  async function learnPdf(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf')) { setStatus('Choose a PDF file.'); return; }
    if (file.size > 10 * 1024 * 1024) { setStatus('PDF files must be 10 MB or smaller.'); return; }
    setBusy(true); setStatus(`Reading ${file.name}...`);
    try {
      const body = await readApiResponse(await fetch('/api/knowledge/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, mimeType: 'application/pdf', fileData: await readFileData(file) }) }));
      setStatus(`Learned ${body.claims.length} facts from ${file.name}.`);
    } catch (caught) { setStatus(caught instanceof Error ? caught.message : 'PDF learning failed.'); }
    finally { setBusy(false); }
  }
  return <div className="attachment-area">{open && <div className="attachment-menu"><div className="attachment-menu-title">ADD KNOWLEDGE</div><button disabled={busy} onClick={() => fileRef.current?.click()}><FileUp size={17} />{busy ? 'Reading PDF...' : 'Add files'}</button>{status && <p>{status}</p>}</div>}<input ref={fileRef} className="hidden-input" type="file" accept="application/pdf,.pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void learnPdf(file); event.currentTarget.value = ''; }} /><button className={open ? 'plus-button open' : 'plus-button'} title="Add material" aria-label="Add material" onClick={() => setOpen((current) => !current)}><Plus size={21} /></button></div>;
}

export function App() {
  const preferences = useChatPreferences<'Medium' | 'High'>({ themeKey: 'campus-atlas-theme', modelKey: 'campus-atlas-quality', sidebarWidthKey: 'campus-atlas-sidebar-width', defaultTheme: 'system', defaultModel: 'Medium', parseModel: (saved) => saved === 'High' ? 'High' : 'Medium' });
  const chat = useChatController(chatAdapter, preferences.model);
  const [settingsOpen, setSettingsOpen] = useState(false);
  return <main className={`app-shell ${preferences.sidebarCollapsed ? 'sidebar-collapsed' : ''}`} style={{ gridTemplateColumns: preferences.sidebarCollapsed ? 'minmax(0, 1fr)' : `${preferences.sidebarWidth}px minmax(0, 1fr)` }}>
    {!preferences.sidebarCollapsed && <ChatSidebar brand="CampusAtlas" brandIcon={<Compass size={21} />} sessions={chat.sessions} activeSessionId={chat.newChatActive ? null : chat.activeSessionId} width={preferences.sidebarWidth} onWidthChange={preferences.setSidebarWidth} onCollapse={() => preferences.setSidebarCollapsed(true)} onNewChat={chat.newChat} onSelectSession={chat.selectSession} onSettings={() => setSettingsOpen(true)} status="Evidence engine" onPin={(session) => void chat.updateSession(session as Session, { pinned: !session.pinned })} onRename={(session) => { const title = window.prompt('Rename conversation', session.title)?.trim(); if (title) void chat.updateSession(session as Session, { title }); }} onDelete={(session) => void chat.deleteSession(session as Session)} />}
    {preferences.sidebarCollapsed && <button className="sidebar-reopen" title="Expand sidebar" onClick={() => preferences.setSidebarCollapsed(false)}><PanelLeftOpen size={19} /></button>}
    <ChatConversation messages={chat.messages} input={chat.input} streaming={chat.streaming} error={chat.error} model={preferences.model} models={[{ id: 'Medium', name: 'DeepSeek Medium', detail: 'Balanced reasoning' }, { id: 'High', name: 'DeepSeek High', detail: 'More thorough reasoning' }]} placeholder="Ask about a campus policy or competition plan" askTarget="CampusAtlas" empty={<><Compass size={34} /><h1>Campus policy, with evidence</h1><p>Ask a question, paste competition material, or describe your goals.</p></>} onInputChange={chat.setInput} onModelChange={(value) => preferences.setModel(value === 'High' ? 'High' : 'Medium')} onSend={(content) => void chat.send(content)} leading={<CampusAttachment />} />
    {settingsOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}><p className="eyebrow">CAMPUSATLAS SETTINGS</p><h2 id="settings-title">Settings</h2><p>Choose how CampusAtlas appears on this device.</p><div className="theme-field"><span>Theme</span><div className="theme-options">{(['light', 'dark', 'system'] as ChatTheme[]).map((option) => <button key={option} type="button" className={preferences.theme === option ? 'selected' : ''} onClick={() => preferences.setTheme(option)}>{option === 'light' ? 'Light' : option === 'dark' ? 'Dark' : 'System'}</button>)}</div></div><div className="dialog-actions"><button className="ghost-button" onClick={() => setSettingsOpen(false)}>Close</button></div></section></div>}
  </main>;
}

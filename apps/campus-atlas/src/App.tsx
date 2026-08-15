import { useEffect, useState } from 'react';
import { Compass, Plus, SendHorizontal, Settings2 } from 'lucide-react';

type Message = { id: string; role: 'user' | 'assistant'; text: string };
type Theme = 'light' | 'dark' | 'system';

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = window.localStorage.getItem('campus-atlas-theme');
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('campus-atlas-theme', theme);
  }, [theme]);

  function newChat() {
    setMessages([]);
    setInput('');
  }

  function send() {
    const text = input.trim();
    if (!text) return;
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', text }, {
      id: crypto.randomUUID(), role: 'assistant', text: 'CampusAtlas 正在准备政策知识检索服务。回答接口接入后，这里会仅返回附带来源证据的校园政策结论。',
    }]);
    setInput('');
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><Compass size={21} /><span>CampusAtlas</span></div>
      <nav aria-label="Conversation actions"><button className="new-chat" onClick={newChat}><Plus size={16} />New chat</button></nav>
      <div className="sidebar-footer"><button className="icon-button" title="Settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}><Settings2 size={18} /></button></div>
    </aside>
    <section className="conversation">
      <div className="transcript" aria-live="polite">
        {messages.length === 0 ? <div className="empty-state"><Compass size={34} /><h1>Campus policy, with evidence</h1><p>Ask about a campus policy. Verified sources and citations will appear with each answer.</p></div> : messages.map((message) => <article className={`message ${message.role}`} key={message.id}><div className="message-body">{message.text}</div></article>)}
      </div>
      <form className="composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
        <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') send();
        }} placeholder="Ask about a campus policy" aria-label="Campus policy question" rows={1} />
        <button type="submit" className="send" title="Send message" aria-label="Send message" disabled={!input.trim()}><SendHorizontal size={17} /></button>
      </form>
    </section>
    {settingsOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}><p className="eyebrow">CAMPUSATLAS SETTINGS</p><h2 id="settings-title">Settings</h2><p>Choose how CampusAtlas appears on this device.</p><div className="theme-field"><span>Theme</span><div className="theme-options">{(['light', 'dark', 'system'] as Theme[]).map((option) => <button key={option} type="button" className={theme === option ? 'selected' : ''} onClick={() => setTheme(option)}>{option === 'light' ? 'Light' : option === 'dark' ? 'Dark' : 'System'}</button>)}</div></div><div className="dialog-actions"><button className="ghost-button" onClick={() => setSettingsOpen(false)}>Close</button></div></section></div>}
  </main>;
}

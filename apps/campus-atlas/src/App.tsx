import { useState } from 'react';
import { Compass, Plus, SendHorizontal } from 'lucide-react';

type Message = { id: string; role: 'user' | 'assistant'; text: string };

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');

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
  </main>;
}

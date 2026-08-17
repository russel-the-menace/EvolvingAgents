import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Bot, Check, ChevronDown, ChevronRight, CircleDollarSign, Monitor, Moon, RefreshCw, SendHorizontal, ShieldCheck, Sun, Wallet } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type ModelId = 'gpt-5.6-luna' | 'gpt-5.6-sol' | 'gpt-5.6-terra';
type ReasoningId = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
type Status = { configured: boolean; environment: 'testnet' | 'live'; liveTradingEnabled: boolean; allowedSymbols: string[] | null; maxOrderUsdt: number; model?: { provider: string; models: ModelId[]; reasoning: ReasoningId[]; defaultModel: ModelId; defaultReasoning: ReasoningId } };
type Balance = { asset: string; free: string; locked: string };
type Draft = { id: string; intent: { symbol: string; side: 'BUY' | 'SELL'; type: string; quantity?: string; quoteOrderQty?: string; price?: string }; estimate: { estimatedPrice: number; estimatedNotional: number; baseQuantity: number; baseAsset: string; quoteAsset: string }; environment: string };
type Message = { id: string; role: 'user' | 'assistant'; content: string; draft?: Draft; order?: Record<string, unknown> };
type ChartPoint = { time: number; close: number };
type Theme = 'light' | 'dark' | 'system';
type NewsItem = { id: string; title: string; url: string; source: string; summary: string; publishedAt: string; urgency: 'normal' | 'breaking' };
type EmergencyState = { pending?: { id: string; title: string; budget: number }; grant?: { id: string; remaining: number; expiresAt: number } | null };

declare global { interface Window { cryptoAgent?: { notify: (title: string, body: string) => void } } }

function formatNumber(value: number | string, maximumFractionDigits = 8) {
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits });
}

function modelLabel(model: ModelId, prefix = 'GPT-') {
  const family = model.replace('gpt-', '').replace('-', ' ');
  return `${prefix}${family[0].toUpperCase()}${family.slice(1)}`;
}

function NewsPanel({ items }: { items: NewsItem[] }) {
  if (!items.length) return null;
  return <section className="news-panel" aria-label="市场新闻"><div className="news-heading"><strong>市场新闻</strong><span>实时源 · 两小时摘要</span></div>{items.slice(0, 6).map((item) => <article className={item.urgency === 'breaking' ? 'news-item breaking' : 'news-item'} key={item.id}><div><span>{item.source}</span><time>{new Date(item.publishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a></article>)}</section>;
}

function EmergencyPanel({ state, onChange }: { state: EmergencyState; onChange: (next: EmergencyState) => void }) {
  const [busy, setBusy] = useState(false);
  if (!state.pending && !state.grant) return null;
  async function confirm() {
    setBusy(true);
    try { const result = await api<{ grant: EmergencyState['grant'] }>('/emergency/confirm', { method: 'POST', body: JSON.stringify({ confirmation: 'CONFIRM', allowLeverage: false, maxLeverage: 1 }) }); onChange({ grant: result.grant }); }
    finally { setBusy(false); }
  }
  return <section className="emergency-panel" aria-label="紧急授权">{state.pending && <><strong>紧急新闻待确认</strong><span>{state.pending.title}</span><small>预授权预算 {formatNumber(state.pending.budget, 2)} USDT，仅限现货</small><button disabled={busy} onClick={() => void confirm()}>{busy ? '授权中' : '确认紧急授权'}</button></>}{state.grant && <><strong>紧急授权已启用</strong><span>剩余预算 {formatNumber(state.grant.remaining, 2)} USDT</span><button onClick={() => void api('/emergency/revoke', { method: 'POST', body: JSON.stringify({ reason: 'manual' }) }).then(() => onChange({}))}>撤销授权</button></>}</section>;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function OrderDraft({ draft, onConfirmed }: { draft: Draft; onConfirmed: (order: Record<string, unknown>) => void }) {
  const [state, setState] = useState<'ready' | 'busy' | 'done'>('ready');
  const [error, setError] = useState('');
  const side = draft.intent.side;
  async function confirm() {
    setState('busy'); setError('');
    try {
      const result = await api<{ order: Record<string, unknown> }>(`/orders/${draft.id}/confirm`, { method: 'POST', body: JSON.stringify({ confirmation: 'CONFIRM' }) });
      setState('done'); onConfirmed(result.order);
    } catch (caught) { setState('ready'); setError(caught instanceof Error ? caught.message : 'Order failed.'); }
  }
  return <section className={`order-draft ${side.toLowerCase()}`} aria-label="Order preview">
    <div className="order-heading"><span>{side === 'BUY' ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}{side === 'BUY' ? '买入' : '卖出'} {draft.estimate.baseAsset}</span><small>{draft.environment === 'testnet' ? '测试网' : '实盘'}</small></div>
    <dl><div><dt>订单类型</dt><dd>{draft.intent.type}</dd></div><div><dt>预估价格</dt><dd>{formatNumber(draft.estimate.estimatedPrice)} {draft.estimate.quoteAsset}</dd></div><div><dt>预估数量</dt><dd>{formatNumber(draft.estimate.baseQuantity)} {draft.estimate.baseAsset}</dd></div><div><dt>预估金额</dt><dd>{formatNumber(draft.estimate.estimatedNotional, 2)} {draft.estimate.quoteAsset}</dd></div></dl>
    <p><ShieldCheck size={15} /> 已通过本地风控和币安测试单校验。市价单最终成交价可能不同。</p>
    {error && <div className="inline-error">{error}</div>}
    <button className="confirm-order" disabled={state !== 'ready'} onClick={confirm}>{state === 'busy' ? <RefreshCw className="spin" size={17} /> : <Check size={17} />}{state === 'done' ? '已提交' : state === 'busy' ? '提交中' : `确认${draft.environment === 'testnet' ? '测试网' : '实盘'}订单`}</button>
  </section>;
}

function PriceChart({ symbol, environment }: { symbol: string; environment: 'testnet' | 'live' }) {
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await api<{ klines: Array<Array<string | number>> }>(`/klines?symbol=${symbol}&interval=1m`);
        if (active) { setPoints(result.klines.map((item) => ({ time: Number(item[0]), close: Number(item[4]) }))); setError(''); }
      } catch (caught) { if (active) setError(caught instanceof Error ? caught.message : '行情暂不可用'); }
    }
    void load();
    const streamHost = environment === 'testnet' ? 'wss://stream.testnet.binance.vision/ws' : 'wss://stream.binance.com:9443/ws';
    let socket: WebSocket | null = null; let reconnectTimer: number | undefined;
    const connect = () => {
      if (!active) return;
      socket = new WebSocket(`${streamHost}/${symbol.toLowerCase()}@trade`);
      socket.onmessage = (event) => {
        const trade = JSON.parse(event.data) as { p?: string; T?: number };
        const close = Number(trade.p); const time = Number(trade.T || Date.now());
        if (!Number.isFinite(close)) return;
        setPoints((current) => {
          const next = current.length ? [...current] : [{ time, close }];
          const candleTime = Math.floor(time / 60_000) * 60_000;
          if (next.at(-1)?.time === candleTime) next[next.length - 1] = { time: candleTime, close };
          else next.push({ time: candleTime, close });
          return next.slice(-120);
        });
      };
      socket.onclose = () => { if (active) reconnectTimer = window.setTimeout(connect, 1500); };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => { active = false; if (reconnectTimer) window.clearTimeout(reconnectTimer); socket?.close(); };
  }, [symbol, environment]);
  const width = 720; const height = 150; const pad = 12;
  const values = points.map((point) => point.close); const min = Math.min(...values); const max = Math.max(...values); const range = max - min || 1;
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${(pad + index * ((width - pad * 2) / Math.max(points.length - 1, 1))).toFixed(2)} ${(height - pad - ((point.close - min) / range) * (height - pad * 2)).toFixed(2)}`).join(' ');
  return <section className="price-chart" aria-label={`${symbol} 1 minute price chart`}><div className="chart-heading"><div><strong>{symbol}</strong><span>1m · Binance Spot</span></div>{values.length ? <b>{formatNumber(values.at(-1)!)} USDT</b> : <span>{error || '加载中'}</span>}</div>{values.length ? <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${symbol} recent price`}><path className="chart-fill" d={`${path} L ${width - pad} ${height - pad} L ${pad} ${height - pad} Z`} /><path className="chart-line" d={path} /></svg> : <div className="chart-empty">{error || '读取行情中…'}</div>}</section>;
}

export function App() {
  if (new URLSearchParams(window.location.search).get('widget') === '1') return <main className="widget-shell"><PriceChart symbol="BTCUSDT" environment="live" /></main>;
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = window.localStorage.getItem('crypto-agent-theme');
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  });
  const [modelId, setModelId] = useState<ModelId>('gpt-5.6-luna');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningId>('medium');
  const [modelOpen, setModelOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [news, setNews] = useState<NewsItem[]>([]);
  const [emergency, setEmergency] = useState<EmergencyState>({});

  async function refresh() {
    try {
      const next = await api<Status>('/status'); setStatus(next);
      if (next.model) { setModelId((current) => next.model?.models.includes(current) ? current : next.model!.defaultModel); setReasoningEffort((current) => next.model?.reasoning.includes(current) ? current : next.model!.defaultReasoning); }
      if (next.configured) setBalances((await api<{ balances: Balance[] }>('/account')).balances);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to connect.'); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    let active = true;
    const notify = (title: string, body: string) => {
      if (window.cryptoAgent) window.cryptoAgent.notify(title, body);
      else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(title, { body });
    };
    void api<{ items: NewsItem[] }>('/news?mode=startup').then((result) => {
      if (!active) return;
      setNews(result.items);
      if (result.items.length) notify('CryptoAgent 今日新闻', `${result.items.length} 条重要新闻已准备好`);
    }).catch(() => {});
    const stream = new EventSource('/api/news/stream');
    const add = (event: MessageEvent<string>) => { const payload = JSON.parse(event.data) as { item?: NewsItem; items?: NewsItem[] }; const incoming = payload.item ? [payload.item] : payload.items || []; if (!incoming.length) return; setNews((current) => [...incoming, ...current.filter((item) => !incoming.some((next) => next.id === item.id))].slice(0, 30)); };
    stream.addEventListener('breaking', add);
    stream.addEventListener('digest', (event) => { add(event); const payload = JSON.parse(event.data) as { items?: NewsItem[] }; if (payload.items?.length) notify('CryptoAgent 两小时新闻', `${payload.items.length} 条新新闻`); });
    stream.addEventListener('ready', add);
    stream.addEventListener('emergency', (event) => { const next = JSON.parse(event.data) as EmergencyState; setEmergency(next); notify('CryptoAgent 紧急授权待确认', next.pending?.title || '检测到爆炸性新闻'); });
    const onBreaking = (event: MessageEvent<string>) => { const item = (JSON.parse(event.data) as { item: NewsItem }).item; notify('CryptoAgent 爆炸性新闻', item.title); };
    stream.addEventListener('breaking', onBreaking);
    if (!window.cryptoAgent && typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission().catch(() => {});
    return () => { active = false; stream.close(); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; window.localStorage.setItem('crypto-agent-theme', theme); }, [theme]);

  async function send() {
    const content = input.trim();
    if (!content || busy) return;
    const user: Message = { id: crypto.randomUUID(), role: 'user', content };
    setMessages((current) => [...current, user]); setInput(''); setBusy(true); setError('');
    try {
      const result = await api<{ reply: string; draft?: Draft }>('/chat', { method: 'POST', body: JSON.stringify({ message: content, model: modelId, reasoning_effort: reasoningEffort }) });
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', content: result.reply, draft: result.draft }]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to prepare the order.'); }
    finally { setBusy(false); }
  }

  return <main className="terminal-shell">
    <aside className="portfolio">
      <header><CircleDollarSign size={23} /><div><strong>CryptoAgent</strong><span>Binance Spot</span></div></header>
      <section className="connection"><div><span className={status?.configured ? 'status-dot online' : 'status-dot'} />{status?.configured ? '已连接' : '未配置'}</div><small>{status?.environment === 'live' ? (status.liveTradingEnabled ? '实盘下单已开启' : '实盘只读') : 'Spot Testnet'}</small></section>
      <section className="balance-section"><div className="section-title"><span><Wallet size={15} />可用余额</span><button title="刷新账户" aria-label="刷新账户" onClick={() => void refresh()}><RefreshCw size={15} /></button></div>{balances.length ? balances.slice(0, 12).map((balance) => <div className="balance" key={balance.asset}><strong>{balance.asset}</strong><span>{formatNumber(balance.free)}</span></div>) : <p>{status?.configured ? '没有非零余额' : '在 .env 中配置 API key 后显示'}</p>}</section>
      <section className="limits"><ShieldCheck size={16} /><div><strong>交易边界</strong><span>现货 · 无杠杆 · 单笔 {status?.maxOrderUsdt ? `≤ ${formatNumber(status.maxOrderUsdt, 2)} USDT` : '不设客户端上限'}</span><span>{status?.allowedSymbols?.join(' / ') || '全部已交易 USDT 现货对'}</span></div></section>
    </aside>
    <section className="conversation">
      <div className="conversation-top"><div><Bot size={18} /><strong>交易对话</strong></div><div className="top-actions"><div className="model-picker"><button className="model-trigger" aria-haspopup="menu" aria-expanded={modelOpen} onClick={() => setModelOpen((open) => !open)}>5.6 {modelId.split('-').at(-1)![0].toUpperCase() + modelId.split('-').at(-1)!.slice(1)} · {({ low: 'Light', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Ultra' } as Record<ReasoningId, string>)[reasoningEffort]}<ChevronDown size={15} /></button>{modelOpen && <div className="model-menu" role="menu"><div className="model-menu-label">Reasoning</div>{(status?.model?.reasoning || ['low', 'medium', 'high', 'xhigh', 'max']).map((option) => <button key={option} className={reasoningEffort === option ? 'selected' : ''} onClick={() => { setReasoningEffort(option); setModelOpen(false); }}>{({ low: 'Light', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Ultra' } as Record<ReasoningId, string>)[option]}{reasoningEffort === option && <Check size={17} />}</button>)}<div className="model-menu-divider" /><div className="model-menu-label">Model</div>{(status?.model?.models || ['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra']).map((option) => <button key={option} className={modelId === option ? 'selected' : ''} onClick={() => { setModelId(option); setModelOpen(false); }}>{modelLabel(option)}<ChevronRight size={17} /></button>)}</div>}</div><div className="theme-control" role="group" aria-label="主题">{([['light', Sun, '浅色'], ['dark', Moon, '深色'], ['system', Monitor, '跟随系统']] as const).map(([value, Icon, label]) => <button key={value} className={theme === value ? 'selected' : ''} title={label} aria-label={label} onClick={() => setTheme(value)}><Icon size={14} /></button>)}</div><span>{status?.environment === 'live' ? 'LIVE' : 'TESTNET'}</span></div></div>
      <PriceChart symbol="BTCUSDT" environment={status?.environment || 'testnet'} />
      <NewsPanel items={news} />
      <EmergencyPanel state={emergency} onChange={setEmergency} />
      <div className="messages">
        {!messages.length && <div className="empty"><Bot size={35} /><h1>说出你想执行的现货交易</h1><p>例如：用 50 USDT 市价买入 BTC。信息不完整时，我会先追问，不会猜测金额。</p><div className="examples"><button onClick={() => setInput('用 50 USDT 市价买入 BTC')}>买入 50 USDT 的 BTC</button><button onClick={() => setInput('卖出 0.001 BTC')}>卖出 0.001 BTC</button></div></div>}
        {messages.map((message) => <article className={`message ${message.role}`} key={message.id}><div className="bubble"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>{message.draft && <OrderDraft draft={message.draft} onConfirmed={(order) => { setMessages((current) => current.map((item) => item.id === message.id ? { ...item, order } : item)); void refresh(); }} />}{message.order && <div className="order-success"><Check size={16} />订单已提交 · ID {String(message.order.orderId || message.order.clientOrderId || 'accepted')}</div>}</div></article>)}
        {busy && <article className="message assistant"><div className="bubble thinking"><i /><i /><i /></div></article>}
        {error && <div className="global-error">{error}</div>}
      </div>
      <div className="composer-wrap"><div className="composer"><textarea rows={1} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder="输入交易指令或询问账户状态" /><button title="发送" aria-label="发送" disabled={!input.trim() || busy} onClick={() => void send()}><SendHorizontal size={19} /></button></div><small>模型只生成订单草案。所有订单都需要你明确确认。</small></div>
    </section>
  </main>;
}

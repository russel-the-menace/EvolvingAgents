import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Bot, Check, CircleDollarSign, RefreshCw, SendHorizontal, ShieldCheck, Wallet } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Status = { configured: boolean; environment: 'testnet' | 'live'; liveTradingEnabled: boolean; allowedSymbols: string[]; maxOrderUsdt: number };
type Balance = { asset: string; free: string; locked: string };
type Draft = { id: string; intent: { symbol: string; side: 'BUY' | 'SELL'; type: string; quantity?: string; quoteOrderQty?: string; price?: string }; estimate: { estimatedPrice: number; estimatedNotional: number; baseQuantity: number; baseAsset: string; quoteAsset: string }; environment: string };
type Message = { id: string; role: 'user' | 'assistant'; content: string; draft?: Draft; order?: Record<string, unknown> };
type ChartPoint = { time: number; close: number };

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
    <dl><div><dt>订单类型</dt><dd>{draft.intent.type}</dd></div><div><dt>预估价格</dt><dd>{draft.estimate.estimatedPrice.toLocaleString(undefined, { maximumFractionDigits: 8 })} {draft.estimate.quoteAsset}</dd></div><div><dt>预估数量</dt><dd>{draft.estimate.baseQuantity.toPrecision(6)} {draft.estimate.baseAsset}</dd></div><div><dt>预估金额</dt><dd>{draft.estimate.estimatedNotional.toFixed(2)} {draft.estimate.quoteAsset}</dd></div></dl>
    <p><ShieldCheck size={15} /> 已通过本地风控和币安测试单校验。市价单最终成交价可能不同。</p>
    {error && <div className="inline-error">{error}</div>}
    <button className="confirm-order" disabled={state !== 'ready'} onClick={confirm}>{state === 'busy' ? <RefreshCw className="spin" size={17} /> : <Check size={17} />}{state === 'done' ? '已提交' : state === 'busy' ? '提交中' : `确认${draft.environment === 'testnet' ? '测试网' : '实盘'}订单`}</button>
  </section>;
}

function PriceChart({ symbol }: { symbol: string }) {
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
    void load(); const timer = window.setInterval(load, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [symbol]);
  const width = 720; const height = 150; const pad = 12;
  const values = points.map((point) => point.close); const min = Math.min(...values); const max = Math.max(...values); const range = max - min || 1;
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${(pad + index * ((width - pad * 2) / Math.max(points.length - 1, 1))).toFixed(2)} ${(height - pad - ((point.close - min) / range) * (height - pad * 2)).toFixed(2)}`).join(' ');
  return <section className="price-chart" aria-label={`${symbol} 1 minute price chart`}><div className="chart-heading"><div><strong>{symbol}</strong><span>1m · Binance Spot</span></div>{values.length ? <b>{values.at(-1)?.toLocaleString(undefined, { maximumFractionDigits: 8 })} USDT</b> : <span>{error || '加载中'}</span>}</div>{values.length ? <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${symbol} recent price`}><path className="chart-fill" d={`${path} L ${width - pad} ${height - pad} L ${pad} ${height - pad} Z`} /><path className="chart-line" d={path} /></svg> : <div className="chart-empty">{error || '读取行情中…'}</div>}</section>;
}

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const next = await api<Status>('/status'); setStatus(next);
      if (next.configured) setBalances((await api<{ balances: Balance[] }>('/account')).balances);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to connect.'); }
  }
  useEffect(() => { void refresh(); }, []);

  async function send() {
    const content = input.trim();
    if (!content || busy) return;
    const user: Message = { id: crypto.randomUUID(), role: 'user', content };
    setMessages((current) => [...current, user]); setInput(''); setBusy(true); setError('');
    try {
      const result = await api<{ reply: string; draft?: Draft }>('/chat', { method: 'POST', body: JSON.stringify({ message: content }) });
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', content: result.reply, draft: result.draft }]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to prepare the order.'); }
    finally { setBusy(false); }
  }

  return <main className="terminal-shell">
    <aside className="portfolio">
      <header><CircleDollarSign size={23} /><div><strong>CryptoAgent</strong><span>Binance Spot</span></div></header>
      <section className="connection"><div><span className={status?.configured ? 'status-dot online' : 'status-dot'} />{status?.configured ? '已连接' : '未配置'}</div><small>{status?.environment === 'live' ? (status.liveTradingEnabled ? '实盘下单已开启' : '实盘只读') : 'Spot Testnet'}</small></section>
      <section className="balance-section"><div className="section-title"><span><Wallet size={15} />可用余额</span><button title="刷新账户" aria-label="刷新账户" onClick={() => void refresh()}><RefreshCw size={15} /></button></div>{balances.length ? balances.slice(0, 12).map((balance) => <div className="balance" key={balance.asset}><strong>{balance.asset}</strong><span>{Number(balance.free).toLocaleString(undefined, { maximumFractionDigits: 8 })}</span></div>) : <p>{status?.configured ? '没有非零余额' : '在 .env 中配置 API key 后显示'}</p>}</section>
      <section className="limits"><ShieldCheck size={16} /><div><strong>硬性风控</strong><span>现货 · 无杠杆 · 单笔 ≤ {status?.maxOrderUsdt ?? 100} USDT</span><span>{status?.allowedSymbols?.join(' / ') || 'BTCUSDT / ETHUSDT'}</span></div></section>
    </aside>
    <section className="conversation">
      <div className="conversation-top"><div><Bot size={18} /><strong>交易对话</strong></div><span>{status?.environment === 'live' ? 'LIVE' : 'TESTNET'}</span></div>
      <PriceChart symbol="BTCUSDT" />
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

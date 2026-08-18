import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Bot, Check, ChevronDown, CircleDollarSign, Eye, FileText, Home, LineChart, MessageSquare, Monitor, Moon, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus, RefreshCw, Search, SendHorizontal, Settings2, ShieldCheck, Sun, WalletCards, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type ModelId = 'gpt-5.6-luna' | 'gpt-5.6-sol' | 'gpt-5.6-terra';
type ReasoningId = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
type Status = { configured: boolean; environment: 'testnet' | 'live'; liveTradingEnabled: boolean; allowedSymbols: string[] | null; maxOrderUsdt: number; model?: { provider: string; models: ModelId[]; reasoning: ReasoningId[]; defaultModel: ModelId; defaultReasoning: ReasoningId } };
type Balance = { asset: string; free: string; locked: string };
type Draft = { id: string; confirmationToken: string; intent: { symbol: string; side: 'BUY' | 'SELL'; type: string; quantity?: string; quoteOrderQty?: string; price?: string; leverage?: number; marginType?: string }; estimate?: { estimatedPrice: number; estimatedNotional: number; baseQuantity: number; baseAsset: string; quoteAsset: string }; environment: string };
type Message = { id: string; role: 'user' | 'assistant'; content: string; product?: 'spot' | 'margin' | 'futures'; draft?: Draft; order?: Record<string, unknown> };
type ChatSession = { id: string; title: string; messages: Message[]; updatedAt: number };
type ChartPoint = { time: number; close: number };
type Theme = 'light' | 'dark' | 'system';
type NewsItem = { id: string; title: string; url: string; source: string; summary: string; publishedAt: string; urgency: 'normal' | 'breaking' };
type EmergencyState = { pending?: { id: string; title: string; budget: number }; grant?: { id: string; remaining: number; expiresAt: number } | null };
type FuturesPosition = { symbol: string; positionAmt: string; entryPrice: string; markPrice: string; liquidationPrice: string; leverage: string; marginType: string; unRealizedProfit: string };
type MarginAccount = { marginLevel?: string; totalAssetOfBtc?: string; totalLiabilityOfBtc?: string; userAssets?: Array<{ asset: string; borrowed: string; interest: string; free: string }> };
type AssetSnapshot = { configured: boolean; spot: { balances?: Balance[] } | null; funding: Array<{ asset: string; free: string; locked: string; freeze?: string; withdrawing?: string }> | null; earn: { rows?: Array<{ asset: string; totalAmount?: string; holdingAmount?: string; cumulativeTotalRewards?: string; latestAnnualPercentageRate?: string; productName?: string; productId?: string }> } | null; futures: { totalWalletBalance?: string; totalUnrealizedProfit?: string; availableBalance?: string; assets?: Array<{ asset: string; walletBalance: string; unrealizedProfit: string; availableBalance: string }>; positions?: Array<{ symbol: string; positionAmt: string; unrealizedProfit: string }> } | null; wallets: Array<{ walletName: string; balance: string; activate: boolean }> | null; errors: string[] };
type AssetTab = 'overview' | 'earn' | 'spot' | 'funding' | 'futures';
type CoinMMarket = { symbol: string; interval: string; klines: Array<Array<string | number>>; depth: { bids: string[][]; asks: string[][] }; premium: { markPrice: string; indexPrice: string; lastFundingRate?: string; nextFundingTime?: number }; partial?: boolean };
const LEFT_SIDEBAR_MIN = 160;

declare global { interface Window { cryptoAgent?: { notify: (title: string, body: string) => void } } }

if (window.cryptoAgent && new URLSearchParams(window.location.search).get('widget') !== '1') document.documentElement.dataset.desktop = 'true';

function formatNumber(value: number | string) {
  const number = Number(value);
  // Binance mobile balances display two decimal places by truncating the visible amount.
  const display = Math.floor(number * 100) / 100;
  return Number.isFinite(number) ? display.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';
}

function modelLabel(model: ModelId, prefix = 'GPT-') {
  const family = model.replace('gpt-', '').replace('-', ' ');
  return `${prefix}${family[0].toUpperCase()}${family.slice(1)}`;
}

function recentNewsWelcome(items: NewsItem[]) {
  const text = (items[0]?.summary || items[0]?.title || '市场新闻正在同步，随时可以开始对话').replace(/\s+/g, ' ').trim();
  const sentence = text.split(/(?<=[。！？.!?])\s*/)[0];
  return sentence.length > 120 ? `${sentence.slice(0, 117)}...` : sentence;
}

function NewsPanel({ items, onLoadMore, loading, hasMore }: { items: NewsItem[]; onLoadMore: () => void; loading: boolean; hasMore: boolean }) {
  const list = useRef<HTMLDivElement>(null); const pullStart = useRef<number | null>(null); const known = useRef<Set<string> | null>(null); const [pullDistance, setPullDistance] = useState(0); const pullThreshold = 44;
  useEffect(() => { if (!known.current) known.current = new Set(items.map((item) => item.id)); else for (const item of items) known.current.add(item.id); }, [items]);
  const finishPull = (clientY: number) => { const distance = pullStart.current === null ? 0 : clientY - pullStart.current; if (distance >= pullThreshold && hasMore && !loading) onLoadMore(); pullStart.current = null; setPullDistance(0); };
  return <section className="news-panel" aria-label="市场新闻"><div className="section-title"><span>News</span></div><div className="news-list" ref={list} onPointerDown={(event) => { if (list.current?.scrollTop === 0 && !loading) { pullStart.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); } }} onPointerMove={(event) => { if (pullStart.current !== null) setPullDistance(Math.min(76, Math.max(0, event.clientY - pullStart.current))); }} onPointerUp={(event) => { finishPull(event.clientY); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { pullStart.current = null; setPullDistance(0); }}><div className={`news-pull-indicator${loading ? ' loading' : ''}`} style={{ height: loading ? 28 : pullDistance, opacity: loading || pullDistance > 0 ? 1 : 0 }}>{loading ? <><RefreshCw size={13} className="spin" />加载中</> : pullDistance >= pullThreshold ? '释放加载' : '下拉加载'}</div>{items.length ? items.map((item) => <article className={`news-item${item.urgency === 'breaking' ? ' breaking' : ''}${known.current && !known.current.has(item.id) ? ' entering' : ''}`} key={item.id}><div><span>{item.source}</span><time>{new Date(item.publishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a></article>) : <p className="news-empty">新闻正在同步</p>}</div></section>;
}

function EmergencyPanel({ state, onChange }: { state: EmergencyState; onChange: (next: EmergencyState) => void }) {
  const [busy, setBusy] = useState(false);
  if (!state.pending && !state.grant) return null;
  async function confirm() {
    setBusy(true);
    try { const result = await api<{ grant: EmergencyState['grant'] }>('/emergency/confirm', { method: 'POST', body: JSON.stringify({ confirmation: 'CONFIRM', allowLeverage: false, maxLeverage: 1 }) }); onChange({ grant: result.grant }); }
    finally { setBusy(false); }
  }
  return <section className="emergency-panel" aria-label="紧急授权">{state.pending && <><strong>紧急新闻待确认</strong><span>{state.pending.title}</span><small>预授权预算 {formatNumber(state.pending.budget)} USDT，仅限现货</small><button disabled={busy} onClick={() => void confirm()}>{busy ? '授权中' : '确认紧急授权'}</button></>}{state.grant && <><strong>紧急授权已启用</strong><span>剩余预算 {formatNumber(state.grant.remaining)} USDT</span><button onClick={() => void api('/emergency/revoke', { method: 'POST', body: JSON.stringify({ reason: 'manual' }) }).then(() => onChange({}))}>撤销授权</button></>}</section>;
}

function DerivativesPanel({ positions, margin }: { positions: FuturesPosition[]; margin: MarginAccount | null }) {
  const active = positions.filter((item) => Number(item.positionAmt) !== 0);
  if (!active.length && !margin) return null;
  return <section className="derivatives-panel" aria-label="杠杆与合约状态"><div className="news-heading"><strong>杠杆与合约</strong><span>只读风险摘要</span></div>{active.map((position) => <div className="derivative-row" key={position.symbol}><b>{position.symbol} {Number(position.positionAmt) > 0 ? '多' : '空'} {formatNumber(position.leverage)}x</b><span>强平 {formatNumber(position.liquidationPrice)}</span><span>未实现 {formatNumber(position.unRealizedProfit)} USDT</span></div>)}{margin && <div className="derivative-row"><b>Margin</b><span>保证金率 {formatNumber(margin.marginLevel || 0)}</span><span>负债 {formatNumber(margin.totalLiabilityOfBtc || 0)} BTC</span></div>}</section>;
}

function ProductDraftPanel({ onDone }: { onDone: () => void }) {
  const [product, setProduct] = useState<'spot' | 'margin' | 'futures'>('futures'); const [symbol, setSymbol] = useState('BTCUSDT'); const [side, setSide] = useState<'BUY' | 'SELL'>('BUY'); const [quantity, setQuantity] = useState(''); const [leverage, setLeverage] = useState('1'); const [marginType, setMarginType] = useState('ISOLATED'); const [draft, setDraft] = useState<any>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function create() { setBusy(true); setError(''); try { const path = product === 'spot' ? '/chat' : `/${product}/drafts`; const base = symbol.replace(/USDT$/, ''); const payload = product === 'spot' ? { message: `${side === 'BUY' ? '买入' : '卖出'} ${quantity} ${base}` } : { symbol, side, type: 'MARKET', quantity, ...(product === 'futures' ? { leverage: Number(leverage), marginType } : { marginType }) }; const result = await api<any>(path, { method: 'POST', body: JSON.stringify(payload) }); if (!result.draft) throw new Error(result.reply || '无法创建草案'); setDraft(result.draft); } catch (caught) { setError(caught instanceof Error ? caught.message : '无法创建草案'); } finally { setBusy(false); } }
  async function confirm() { setBusy(true); setError(''); try { const result = await api<any>(`/${product}/drafts/${draft.id}/confirm`, { method: 'POST', body: JSON.stringify({ confirmation: 'CONFIRM', confirmationToken: draft.confirmationToken }) }); setDraft(null); onDone(); alert(`订单已提交：${String(result.order?.orderId || result.order?.orderId || 'accepted')}`); } catch (caught) { setError(caught instanceof Error ? caught.message : '提交失败'); } finally { setBusy(false); } }
  return <section className="product-draft-panel" aria-label="产品交易草案"><div className="news-heading"><strong>产品交易草案</strong><span>所有产品都需要人工确认</span></div><div className="draft-controls"><select value={product} onChange={(event) => { setProduct(event.target.value as typeof product); setDraft(null); }}><option value="spot">现货 Spot</option><option value="margin">杠杆现货 Margin</option><option value="futures">合约 Futures</option></select><input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} aria-label="交易对" placeholder="BTCUSDT" /><select value={side} onChange={(event) => setSide(event.target.value as 'BUY' | 'SELL')}><option value="BUY">买入 / 做多</option><option value="SELL">卖出 / 做空</option></select><input value={quantity} onChange={(event) => setQuantity(event.target.value)} aria-label="数量" placeholder="数量" />{product !== 'spot' && <select value={marginType} onChange={(event) => setMarginType(event.target.value)}><option value="ISOLATED">逐仓</option><option value="CROSSED">全仓</option></select>}{product === 'futures' && <input value={leverage} onChange={(event) => setLeverage(event.target.value)} aria-label="杠杆" placeholder="杠杆 1-125x" />}<button disabled={busy || !quantity} onClick={() => void (draft ? confirm() : create())}>{busy ? '处理中' : draft ? '确认并提交' : '生成草案'}</button></div>{draft && <div className="draft-preview">{product.toUpperCase()} · {draft.intent.symbol} · {draft.intent.side} {draft.intent.leverage ? `${draft.intent.leverage}x` : ''} · {draft.intent.marginType || ''}<small>请核对产品、方向、数量、杠杆和保证金模式后确认。</small></div>}{error && <div className="inline-error">{error}</div>}</section>;
}

function MarginActionPanel({ onDone }: { onDone: () => void }) {
  const [action, setAction] = useState<'BORROW' | 'REPAY'>('BORROW'); const [asset, setAsset] = useState('USDT'); const [amount, setAmount] = useState(''); const [draft, setDraft] = useState<any>(null); const [error, setError] = useState('');
  async function submit() { setError(''); try { if (!draft) { const result = await api<any>('/margin/actions/drafts', { method: 'POST', body: JSON.stringify({ action, asset, amount }) }); setDraft(result.draft); return; } await api(`/margin/actions/drafts/${draft.id}/confirm`, { method: 'POST', body: JSON.stringify({ confirmation: 'CONFIRM', confirmationToken: draft.confirmationToken }) }); setDraft(null); setAmount(''); onDone(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Margin 操作失败'); } }
  return <section className="product-draft-panel" aria-label="Margin 借贷草案"><div className="news-heading"><strong>Margin 借贷</strong><span>借币与还款均需确认</span></div><div className="draft-controls"><select value={action} onChange={(event) => { setAction(event.target.value as typeof action); setDraft(null); }}><option value="BORROW">借币</option><option value="REPAY">还款</option></select><input value={asset} onChange={(event) => setAsset(event.target.value.toUpperCase())} aria-label="资产" /><input value={amount} onChange={(event) => setAmount(event.target.value)} aria-label="金额" placeholder="金额" /><button disabled={!amount} onClick={() => void submit()}>{draft ? `确认${action === 'BORROW' ? '借币' : '还款'}` : '生成草案'}</button></div>{draft && <div className="draft-preview">{draft.action} · {draft.params.amount} {draft.params.asset}<small>确认后将调用 Binance Margin {draft.action === 'BORROW' ? '借币' : '还款'}接口。</small></div>}{error && <div className="inline-error">{error}</div>}</section>;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function OrderDraft({ draft, product = 'spot', onConfirmed }: { draft: Draft; product?: 'spot' | 'margin' | 'futures'; onConfirmed: (order: Record<string, unknown>) => void }) {
  const [state, setState] = useState<'ready' | 'busy' | 'done'>('ready');
  const [error, setError] = useState('');
  const side = draft.intent.side;
  async function confirm() {
    setState('busy'); setError('');
    try {
      const path = product === 'spot' ? `/orders/${draft.id}/confirm` : `/${product}/drafts/${draft.id}/confirm`;
      const result = await api<{ order: Record<string, unknown> }>(path, { method: 'POST', body: JSON.stringify({ confirmation: 'CONFIRM', confirmationToken: draft.confirmationToken }) });
      setState('done'); onConfirmed(result.order);
    } catch (caught) { setState('ready'); setError(caught instanceof Error ? caught.message : 'Order failed.'); }
  }
  return <section className={`order-draft ${side.toLowerCase()}`} aria-label="Order preview">
    <div className="order-heading"><span>{side === 'BUY' ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}{side === 'BUY' ? '买入 / 做多' : '卖出 / 做空'} {draft.intent.symbol}</span><small>{product.toUpperCase()} · {draft.environment === 'testnet' ? '测试网' : '实盘'}</small></div>
    <dl><div><dt>订单类型</dt><dd>{draft.intent.type}</dd></div><div><dt>数量</dt><dd>{formatNumber(draft.intent.quantity || draft.intent.quoteOrderQty || 0)}</dd></div>{draft.intent.leverage && <div><dt>杠杆</dt><dd>{formatNumber(draft.intent.leverage)}x</dd></div>}{draft.intent.marginType && <div><dt>保证金模式</dt><dd>{draft.intent.marginType}</dd></div>}{draft.estimate && <div><dt>预估金额</dt><dd>{formatNumber(draft.estimate.estimatedNotional)} {draft.estimate.quoteAsset}</dd></div>}</dl>
    <p><ShieldCheck size={15} /> 草案已通过本地格式校验。确认后仍需通过 Binance 产品规则；市价单最终成交价可能不同。</p>
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

type CoinMCandle = { time: number; open: number; high: number; low: number; close: number; volume: number; quoteVolume: number };

function TimeShareChart({ candles, selectedIndex, onSelect, last }: { candles: CoinMCandle[]; selectedIndex: number | null; onSelect: (event: React.MouseEvent<SVGSVGElement>) => void; last: number }) {
  const width = 900; const height = 330; const pad = 36;
  const low = candles.length ? Math.min(...candles.map((item) => item.low)) : 0; const high = candles.length ? Math.max(...candles.map((item) => item.high)) : 1; const range = high - low || 1; const step = (width - pad * 2) / Math.max(candles.length, 1);
  const y = (price: number) => pad + (high - price) / range * (height - pad * 2);
  const closes = candles.map((item) => item.close);
  const average = closes.map((_, index) => index < 59 ? null : closes.slice(index - 59, index + 1).reduce((sum, value) => sum + value, 0) / 60);
  const pathFor = (values: Array<number | null>) => { let started = false; return values.flatMap((value, index) => { if (value === null) return []; const command = started ? 'L' : 'M'; started = true; return [`${command} ${pad + index * step + step / 2} ${y(value)}`]; }).join(' '); };
  const linePath = pathFor(closes); const areaPath = `${linePath} L ${pad + (candles.length - 1) * step + step / 2} ${height - pad} L ${pad + step / 2} ${height - pad} Z`;
  const selected = selectedIndex === null ? null : candles[selectedIndex];
  const lastX = pad + Math.max(candles.length - 1, 0) * step + step / 2; const lastY = y(last); const priceLabel = last.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return <section className="coinm-time-share"><div className="coinm-ma-legend"><span className="time-price-legend">最新: {priceLabel}</span><span className="time-ma-legend">MA(60): {average.at(-1)?.toLocaleString(undefined, { maximumFractionDigits: 1 }) || '-'}</span></div><div className="coinm-chart-canvas"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="BTCUSD coin-m time-sharing chart" onClick={onSelect}><g className="chart-grid">{[0, 1, 2, 3, 4].map((line) => <line key={line} x1={pad} x2={width - pad} y1={pad + line * (height - pad * 2) / 4} y2={pad + line * (height - pad * 2) / 4} />)}</g><path className="time-area" d={areaPath} /><path className="time-line" d={linePath} /><path className="time-ma" d={pathFor(average)} /><line className="time-price-guide" x1={lastX} x2={width - pad} y1={lastY} y2={lastY} />{candles.length > 0 && <g className="time-price-label"><rect x={width - pad - 112} y={lastY - 14} width="112" height="28" rx="6" /><text x={width - pad - 56} y={lastY + 5}>{priceLabel}</text></g>}{selected && <g className="chart-crosshair"><line x1={pad + selectedIndex! * step + step / 2} x2={pad + selectedIndex! * step + step / 2} y1={pad} y2={height - pad} /><line x1={pad} x2={width - pad} y1={y(selected.close)} y2={y(selected.close)} /><circle cx={pad + selectedIndex! * step + step / 2} cy={y(selected.close)} r="4" /></g>}</svg><div className="coinm-axis">{[0, 1, 2, 3, 4].map((line) => <span key={line} style={{ top: `${line * 25}%` }}>{(high - line * range / 4).toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>)}</div>{selected && <div className="coinm-tooltip"><b>{new Date(selected.time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</b><span>价格 <em>{selected.close.toLocaleString()}</em></span><span>涨跌 <em className={selected.close >= selected.open ? 'positive' : 'negative'}>{(selected.close - selected.open).toFixed(1)}</em></span><span>涨跌幅 <em>{((selected.close - selected.open) / selected.open * 100).toFixed(2)}%</em></span><span>量 <em>{selected.volume.toLocaleString()}</em></span></div>}</div></section>;
}

function CoinMWorkspace() {
  const [interval, setInterval] = useState('5m');
  const [market, setMarket] = useState<CoinMMarket | null>(null);
  const [error, setError] = useState('');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [tickDirection, setTickDirection] = useState<'up' | 'down' | ''>('');
  const [priceGrouping, setPriceGrouping] = useState('0.1');
  const previousPrice = useRef(0);
  const pendingPrice = useRef<number | null>(null);
  const pendingDepth = useRef<{ bids: string[][]; asks: string[][] } | null>(null);
  const pendingRelay = useRef<CoinMMarket | null>(null);
  const orderBook = useRef({ bids: new Map<string, string>(), asks: new Map<string, string>() });
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!(event.target as Element).closest?.('.coinm-chart-canvas svg')) setSelectedIndex(null); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  useEffect(() => {
    let active = true;
    const sourceInterval = interval === 'time' ? '1m' : interval;
    const load = () => api<CoinMMarket>(`/coinm-market?symbol=BTCUSD_PERP&interval=${sourceInterval}`).then((result) => { if (active) { orderBook.current = { bids: new Map(result.depth.bids.map(([price, quantity]) => [price, quantity] as const)), asks: new Map(result.depth.asks.map(([price, quantity]) => [price, quantity] as const)) }; setMarket(result); setError(''); } }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : '币本位行情不可用'); });
    void load();
    const timer = window.setInterval(load, 60_000);
    let fallbackStarted = false;
    let directSockets: WebSocket[] = [];
    const connectDirect = () => {
      if (fallbackStarted || !active) return;
      fallbackStarted = true;
      const stream = new WebSocket(`wss://dstream.binance.com/ws/btcusd_perp@kline_${sourceInterval}`);
      stream.onmessage = (event) => { let payload; try { payload = JSON.parse(event.data); } catch { return; } const item = payload.k; if (!active || !item) return; const next = [item.t, item.o, item.h, item.l, item.c, item.v, item.T, item.q]; setMarket((current) => { if (!current) return current; const klines = [...current.klines]; const existing = klines.findIndex((row) => Number(row[0]) === Number(item.t)); if (existing >= 0) klines[existing] = next; else klines.push(next); return { ...current, klines: klines.slice(-240) }; }); };
      const tradeStream = new WebSocket('wss://dstream.binance.com/ws/btcusd_perp@aggTrade');
      tradeStream.onmessage = (event) => { let payload; try { payload = JSON.parse(event.data); } catch { return; } const price = Number(payload?.p); if (active && Number.isFinite(price)) pendingPrice.current = price; };
      const depthStream = new WebSocket('wss://dstream.binance.com/ws/btcusd_perp@depth@100ms');
      depthStream.onmessage = (event) => { let payload; try { payload = JSON.parse(event.data); } catch { return; } if (!active || !payload?.b || !payload?.a) return; for (const [price, quantity] of payload.b as string[][]) Number(quantity) ? orderBook.current.bids.set(price, quantity) : orderBook.current.bids.delete(price); for (const [price, quantity] of payload.a as string[][]) Number(quantity) ? orderBook.current.asks.set(price, quantity) : orderBook.current.asks.delete(price); pendingDepth.current = { bids: [...orderBook.current.bids].sort(([left], [right]) => Number(right) - Number(left)).slice(0, 1000), asks: [...orderBook.current.asks].sort(([left], [right]) => Number(left) - Number(right)).slice(0, 1000) }; };
      directSockets = [stream, tradeStream, depthStream];
      for (const socket of directSockets) socket.onerror = () => { if (active) setError('实时行情暂时中断'); };
    };
    const serverStream = new EventSource(`/api/coinm-stream?interval=${sourceInterval}`);
    serverStream.addEventListener('market', (event) => { try { pendingRelay.current = JSON.parse((event as MessageEvent).data) as CoinMMarket; } catch { /* ignore malformed relay events */ } });
    serverStream.onerror = () => { serverStream.close(); connectDirect(); if (active) setError('服务端行情暂时中断，已切换直连兜底'); };
    const bookTimer = window.setInterval(() => {
      const price = pendingPrice.current; const depth = pendingDepth.current;
      if (price === null && !depth) return;
      if (price !== null) {
        if (previousPrice.current) setTickDirection(price >= previousPrice.current ? 'up' : 'down');
        previousPrice.current = price;
      }
      setMarket((current) => current ? { ...current, ...(depth ? { depth } : {}), ...(price !== null ? { premium: { ...current.premium, markPrice: String(price) } } : {}) } : current);
      pendingPrice.current = null; pendingDepth.current = null;
    }, 400);
    const relayTimer = window.setInterval(() => {
      const next = pendingRelay.current;
      if (!next || !active) return;
      pendingRelay.current = null;
      setMarket((current) => {
        if (!next.partial || !current || !next.klines[0]) return next;
        const klines = [...current.klines];
        const existing = klines.findIndex((row) => Number(row[0]) === Number(next.klines[0][0]));
        if (existing >= 0) klines[existing] = next.klines[0]; else klines.push(next.klines[0]);
        return { ...next, klines: klines.slice(-240) };
      });
    }, 300);
    return () => { active = false; window.clearInterval(timer); window.clearInterval(bookTimer); window.clearInterval(relayTimer); serverStream.close(); directSockets.forEach((socket) => socket.close()); };
  }, [interval]);
  const allCandles = [...new Map((market?.klines || []).map((item) => [Number(item[0]), { time: Number(item[0]), open: Number(item[1]), high: Number(item[2]), low: Number(item[3]), close: Number(item[4]), volume: Number(item[5]), quoteVolume: Number(item[7]) }])).values()];
  const candles = allCandles.slice(-120);
  const width = 900; const height = 330; const pad = 36;
  const low = candles.length ? Math.min(...candles.map((item) => item.low)) : 0;
  const high = candles.length ? Math.max(...candles.map((item) => item.high)) : 1;
  const range = high - low || 1; const step = (width - pad * 2) / Math.max(candles.length, 1);
  const y = (price: number) => pad + (high - price) / range * (height - pad * 2);
  const maValues = (period: number) => allCandles.map((_, index) => index < period - 1 ? null : allCandles.slice(index - period + 1, index + 1).reduce((sum, item) => sum + item.close, 0) / period).slice(-120);
  const ma7 = maValues(7); const ma25 = maValues(25); const ma99 = maValues(99);
  const maPath = (values: Array<number | null>) => values.map((value, index) => value === null ? '' : `${values.slice(0, index).every((item) => item === null) ? 'M' : 'L'} ${pad + index * step + step / 2} ${y(value)}`).join(' ');
  const last = Number(market?.premium.markPrice || candles.at(-1)?.close || 0);
  const groupDepth = (levels: string[][], side: 'ask' | 'bid') => {
    const size = Number(priceGrouping);
    const grouped = new Map<number, number>();
    for (const [rawPrice, rawQuantity] of levels) {
      const quantity = Number(rawQuantity); if (!(quantity > 0)) continue;
      const price = Number(rawPrice); const bucket = Number(((side === 'ask' ? Math.ceil(price / size) : Math.floor(price / size)) * size).toFixed(size < 1 ? 1 : 0));
      grouped.set(bucket, (grouped.get(bucket) || 0) + quantity);
    }
    const sorted = [...grouped].sort(([left], [right]) => side === 'ask' ? left - right : right - left);
    return sorted.slice(0, 6).map(([price, quantity]) => [String(price), String(quantity)]);
  };
  const displayAsks = groupDepth(market?.depth.asks || [], 'ask');
  const displayBids = groupDepth(market?.depth.bids || [], 'bid');
  const depthMax = Math.max(...displayAsks.map(([, quantity]) => Number(quantity)), ...displayBids.map(([, quantity]) => Number(quantity)), 1);
  const askTotal = displayAsks.reduce((sum, [, quantity]) => sum + Number(quantity), 0);
  const bidTotal = displayBids.reduce((sum, [, quantity]) => sum + Number(quantity), 0);
  const bidPercent = bidTotal + askTotal ? bidTotal / (bidTotal + askTotal) * 100 : 50;
  const bookPrice = (value: string | number) => Number(value).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const first = candles[0]?.open || last; const change = first ? (last - first) / first * 100 : 0;
  const selected = selectedIndex === null ? null : candles[selectedIndex];
  const axisValues = [0, 1, 2, 3, 4].map((line) => high - line * range / 4);
  const selectCandle = (event: React.MouseEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const chartX = (event.clientX - bounds.left) / bounds.width * width;
    setSelectedIndex(Math.max(0, Math.min(candles.length - 1, Math.round((chartX - pad - step / 2) / step))));
  };
  return <div className={`coinm-page${interval === 'time' ? ' time-mode' : ''}`}>
    <div className="coinm-products"><button>U本位</button><button className="active">币本位</button><button>期权</button><button>涨跌</button><button>聪明钱</button></div>
    <div className="coinm-heading"><div><strong>BTCUSD CM</strong><span>永续</span><b className={change >= 0 ? 'positive' : 'negative'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</b></div><small>资金费率 {(Number(market?.premium.lastFundingRate || 0) * 100).toFixed(6)}%</small></div>
    <div className="coinm-trade-grid"><section className="coinm-order"><div className="coinm-order-tabs"><button className="active">开仓</button><button>平仓</button></div><div className="coinm-order-options"><button>全仓</button><button>20x</button></div><button className="coinm-select">市价单</button><label>数量 <span>张</span><input inputMode="decimal" placeholder="0" /></label><div className="coinm-order-buttons"><button disabled>开多 · 看涨</button><button disabled>开空 · 看跌</button></div></section><section className="coinm-book"><header><span>价格 (USD)</span><span>数量 (张)</span></header>{displayAsks.slice(0, 6).reverse().map(([price, quantity]) => <div className="ask" key={price}><i style={{ width: `${Math.min(100, Number(quantity) / depthMax * 100)}%` }} /><span>{bookPrice(price)}</span><span>{Number(quantity).toLocaleString()}</span></div>)}<strong className={tickDirection === 'up' ? 'tick-up' : tickDirection === 'down' ? 'tick-down' : ''}>{bookPrice(last)}</strong>{displayBids.slice(0, 6).map(([price, quantity]) => <div className="bid" key={price}><i style={{ width: `${Math.min(100, Number(quantity) / depthMax * 100)}%` }} /><span>{bookPrice(price)}</span><span>{Number(quantity).toLocaleString()}</span></div>)}<div className="depth-ratio"><span>{bidPercent.toFixed(2)}%</span><i><b style={{ width: `${bidPercent}%` }} /></i><span>{(100 - bidPercent).toFixed(2)}%</span></div><label className="depth-grouping"><select value={priceGrouping} onChange={(event) => setPriceGrouping(event.target.value)}>{['0.1', '1', '10', '50', '100', '1000'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label></section></div>
    <div className="coinm-position-tabs"><b>持有仓位 (0)</b><span>当前委托 (0)</span><span>交易机器人</span></div>
    <div className="coinm-intervals coinm-full-intervals">{[['time', '分时'], ['1m', '1分'], ['3m', '3分'], ['5m', '5分'], ['15m', '15分'], ['30m', '30分'], ['1h', '1小时'], ['2h', '2小时'], ['4h', '4小时'], ['6h', '6小时'], ['8h', '8小时'], ['12h', '12小时'], ['1d', '1天'], ['1w', '1周'], ['1M', '1月']].map(([id, label]) => <button className={interval === id ? 'active' : ''} key={id} onClick={() => { setInterval(id); setSelectedIndex(null); }}>{label}</button>)}</div>
    {interval === 'time' && <TimeShareChart candles={candles} selectedIndex={selectedIndex} onSelect={selectCandle} last={last} />}
    <section className="coinm-chart"><div className="coinm-intervals">{[['1m', '分时'], ['3m', '3分'], ['5m', '5分'], ['15m', '15分'], ['30m', '30分'], ['1h', '1小时']].map(([id, label]) => <button className={interval === id ? 'active' : ''} key={id} onClick={() => { setInterval(id); setSelectedIndex(null); }}>{label}</button>)}</div><div className="coinm-ma-legend"><span>MA(7): {ma7.at(-1)?.toLocaleString(undefined, { maximumFractionDigits: 1 }) || '-'}</span><span>MA(25): {ma25.at(-1)?.toLocaleString(undefined, { maximumFractionDigits: 1 }) || '-'}</span><span>MA(99): {ma99.at(-1)?.toLocaleString(undefined, { maximumFractionDigits: 1 }) || '-'}</span></div>{candles.length ? <div className="coinm-chart-canvas"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="BTCUSD coin-m candlestick chart" onClick={selectCandle}><g className="chart-grid">{[0, 1, 2, 3, 4].map((line) => <line key={line} x1={pad} x2={width - pad} y1={pad + line * (height - pad * 2) / 4} y2={pad + line * (height - pad * 2) / 4} />)}</g>{candles.map((item, index) => { const x = pad + index * step + step / 2; const rising = item.close >= item.open; return <g className={rising ? 'candle-up' : 'candle-down'} key={item.time}><line x1={x} x2={x} y1={y(item.high)} y2={y(item.low)} /><rect x={x - Math.max(1, step * .28)} y={Math.min(y(item.open), y(item.close))} width={Math.max(2, step * .56)} height={Math.max(1, Math.abs(y(item.open) - y(item.close)))} /></g>; })}<path className="ma ma7" d={maPath(ma7)} /><path className="ma ma25" d={maPath(ma25)} /><path className="ma ma99" d={maPath(ma99)} />{selected && <g className="chart-crosshair"><line x1={pad + selectedIndex! * step + step / 2} x2={pad + selectedIndex! * step + step / 2} y1={pad} y2={height - pad} /><line x1={pad} x2={width - pad} y1={y(selected.close)} y2={y(selected.close)} /><circle cx={pad + selectedIndex! * step + step / 2} cy={y(selected.close)} r="4" /></g>}</svg><div className="coinm-axis">{axisValues.map((value, index) => <span key={index} style={{ top: `${index * 25}%` }}>{value.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>)}</div>{selected && <div className="coinm-tooltip"><b>{new Date(selected.time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</b><span>开 <em>{selected.open.toLocaleString()}</em></span><span>高 <em>{selected.high.toLocaleString()}</em></span><span>低 <em>{selected.low.toLocaleString()}</em></span><span>收 <em>{selected.close.toLocaleString()}</em></span><span>涨跌 <em className={selected.close >= selected.open ? 'positive' : 'negative'}>{(selected.close - selected.open).toFixed(1)}</em></span><span>涨跌幅 <em>{((selected.close - selected.open) / selected.open * 100).toFixed(2)}%</em></span><span>振幅 <em>{((selected.high - selected.low) / selected.open * 100).toFixed(2)}%</em></span><span>量 <em>{selected.volume.toLocaleString()}</em></span><span>额 <em>{selected.quoteVolume.toLocaleString()}</em></span></div>}</div> : <div className="chart-empty">{error || '正在读取币本位 K 线…'}</div>}<div className="coinm-chart-price">最新 {last ? last.toLocaleString() : '-'}</div></section>
  </div>;
}

function CoinIcon({ asset }: { asset: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <span className="asset-symbol">{asset === 'USDT' ? '₮' : asset.slice(0, 1)}</span> : <img className="asset-symbol asset-icon-image" src={`https://bin.bnbstatic.com/static/assets/logos/${asset.toLowerCase()}.png`} alt="" onError={() => setFailed(true)} />;
}

function AssetWorkspace() {
  const [bottomTab, setBottomTab] = useState('assets');
  const [assetTab, setAssetTab] = useState<AssetTab>('overview');
  const [overviewTab, setOverviewTab] = useState<'all' | 'accounts'>('all');
  const [earnView, setEarnView] = useState<'assets' | 'products'>('assets');
  const [spotView, setSpotView] = useState<'spot' | 'cross' | 'isolated'>('spot');
  const [data, setData] = useState<AssetSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [hidden, setHidden] = useState(false);
  async function load() { setLoading(true); setLoadError(''); try { setData(await api<AssetSnapshot>('/assets')); } catch (caught) { setLoadError(caught instanceof Error ? caught.message : '无法读取 Binance 资产'); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  const spot = data?.spot?.balances || [];
  const funding = data?.funding || [];
  const earn = data?.earn?.rows || [];
  const futuresAssets = data?.futures?.assets?.filter((item) => Number(item.walletBalance) || Number(item.unrealizedProfit)) || [];
  const earnUsdt = earn.find((item) => item.asset === 'USDT');
  const spotUsdt = spot.find((item) => item.asset === 'USDT' || item.asset === 'LDUSDT');
  const walletTotal = Number(earnUsdt?.totalAmount || earnUsdt?.holdingAmount || Number(spotUsdt?.free || 0) + Number(spotUsdt?.locked || 0));
  const cnyTotal = walletTotal * 6.74;
  const amount = (value: number | string | undefined) => hidden ? '••••••' : formatNumber(value || 0);
  const summaryAmount = (value: number | string | undefined) => hidden ? '••••••' : formatNumber(Math.floor(Number(value || 0) * 100) / 100);
  const earnRows = earnView === 'assets' ? Object.entries(earn.reduce<Record<string, number>>((result, item) => { result[item.asset] = (result[item.asset] || 0) + Number(item.totalAmount || item.holdingAmount || 0); return result; }, {})).map(([asset, primary]) => ({ asset, primary, secondary: '按资产汇总' })) : earn.map((item) => ({ asset: item.productName || item.productId || item.asset, primary: item.totalAmount || item.holdingAmount || '0', secondary: `${item.asset} · 累计收益 ${amount(item.cumulativeTotalRewards)} · APR ${item.latestAnnualPercentageRate || '-'}` }));
  const rows = assetTab === 'spot' ? (spotView === 'spot' ? spot.filter((item) => !item.asset.startsWith('LD')).map((item) => ({ asset: item.asset, primary: Number(item.free) + Number(item.locked), secondary: `可用 ${amount(item.free)} · 冻结 ${amount(item.locked)}` })) : []) : assetTab === 'funding' ? funding.map((item) => ({ asset: item.asset, primary: Number(item.free) + Number(item.locked || 0), secondary: `可用 ${amount(item.free)} · 冻结 ${amount(item.locked)}` })) : assetTab === 'earn' ? earnRows : futuresAssets.map((item) => ({ asset: item.asset, primary: item.walletBalance, secondary: `可用 ${amount(item.availableBalance)} · 未实现盈亏 ${amount(item.unrealizedProfit)}` }));
  const tabs: Array<[AssetTab, string]> = [['overview', '总览'], ['earn', '理财'], ['spot', '现货'], ['funding', '资金'], ['futures', '合约']];
  const nav = [[Home, '首页', 'home'], [LineChart, '行情', 'markets'], [ArrowLeftRight, '交易', 'trade'], [FileText, '合约', 'contracts'], [WalletCards, '资产', 'assets']] as const;
  const accountRows = [
    ['理财', earn.reduce((sum, item) => sum + Number(item.totalAmount || item.holdingAmount || 0), 0)],
    ['现货', spot.filter((item) => !item.asset.startsWith('LD')).reduce((sum, item) => sum + Number(item.free || 0) + Number(item.locked || 0), 0)],
    ['资金', funding.reduce((sum, item) => sum + Number(item.free || 0) + Number(item.locked || 0), 0)],
    ['合约', Number(data?.futures?.totalWalletBalance || 0)],
  ] as const;
  const assetName = (asset: string) => asset === 'USDT' ? 'TetherUS' : asset;
  const visibleErrors = data?.errors.filter((item) => !item.startsWith('futures:')) || [];
  const totalValue = assetTab === 'overview' ? walletTotal : assetTab === 'futures' ? data?.futures?.totalWalletBalance : rows.reduce((sum, item) => sum + Number(item.primary || 0), 0);
  return <section className="asset-app">
    <div className="asset-content">
      {bottomTab === 'assets' ? <>
        <div className="asset-tabs" role="tablist">{tabs.map(([id, label]) => <button className={assetTab === id ? 'active' : ''} key={id} onClick={() => setAssetTab(id)}>{label}</button>)}</div>
        {assetTab === 'spot' && <div className="asset-subtabs" role="tablist">{([['spot', '现货账户'], ['cross', '杠杆账户（全仓）'], ['isolated', '杠杆账户（逐仓）']] as const).map(([id, label]) => <button className={spotView === id ? 'active' : ''} key={id} onClick={() => setSpotView(id)}>{label}</button>)}</div>}
        <div className="asset-summary"><div><span>{assetTab === 'overview' ? '现货 USDT 余额' : `${tabs.find(([id]) => id === assetTab)?.[1]}资产`}</span><button title={hidden ? '显示余额' : '隐藏余额'} aria-label={hidden ? '显示余额' : '隐藏余额'} onClick={() => setHidden((value) => !value)}><Eye size={15} /></button></div><strong>{amount(totalValue)} <small>USDT</small></strong>{assetTab === 'overview' && <div className="asset-cny">≈ ¥{amount(cnyTotal)}</div>}<div className="asset-actions"><button disabled title="资金操作尚未启用">添加资金</button><button disabled title="资金操作尚未启用">转出</button><button disabled title="资金操作尚未启用">划转</button></div></div>
        {assetTab === 'overview' ? <div className="wallet-overview"><div className="overview-tabs" role="tablist"><button className={overviewTab === 'all' ? 'active' : ''} onClick={() => setOverviewTab('all')}>全部</button><button className={overviewTab === 'accounts' ? 'active' : ''} onClick={() => setOverviewTab('accounts')}>账户</button><button className="overview-refresh" title="刷新资产" aria-label="刷新资产" onClick={() => void load()}><RefreshCw className={loading ? 'spin' : ''} size={15} /></button></div>{overviewTab === 'all' ? <>{walletTotal > 0 && <div className="asset-row"><div><CoinIcon asset="USDT" /><span><strong>USDT</strong><small>TetherUS</small></span></div><b>{amount(walletTotal)}</b></div>}</> : accountRows.map(([label, value]) => <div className="account-row" key={label}><strong>{label}</strong><b>{amount(value)} USDT</b></div>)}</div> : <div className="asset-list"><div className="asset-list-heading"><strong>{tabs.find(([id]) => id === assetTab)?.[1]}资产</strong>{assetTab === 'earn' ? <div className="inline-tabs"><button className={earnView === 'assets' ? 'active' : ''} onClick={() => setEarnView('assets')}>按资产</button><button className={earnView === 'products' ? 'active' : ''} onClick={() => setEarnView('products')}>按产品</button></div> : <Search size={17} />}</div>{rows.length ? rows.map((item) => <div className="asset-row" key={item.asset}><div><CoinIcon asset={item.asset} /><span><strong>{item.asset}</strong><small>{item.secondary || assetName(item.asset)}</small></span></div><b>{amount(item.primary)}</b></div>) : <p className="asset-empty">{loading ? '正在读取 Binance 账户…' : data?.errors.find((item) => item.startsWith(assetTab)) || '该账户暂无非零资产'}</p>}</div>}
        {visibleErrors.length ? <details className="asset-errors"><summary>部分账户不可用</summary>{visibleErrors.map((item) => <p key={item}>{item}</p>)}</details> : null}
      </> : bottomTab === 'contracts' ? <CoinMWorkspace /> : <div className="asset-placeholder"><strong>{nav.find(([, , id]) => id === bottomTab)?.[1]}</strong><span>此导航将在后续视图中实现</span></div>}
      {loadError && <p className="asset-load-error">{loadError}</p>}
    </div>
    <nav className="asset-bottom-nav" aria-label="Binance workspace navigation">{nav.map(([Icon, label, id]) => <button className={bottomTab === id ? 'active' : ''} key={id} onClick={() => setBottomTab(id)}><Icon size={19} /><span>{label}</span></button>)}</nav>
  </section>;
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
  const modelPickerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try { return JSON.parse(window.localStorage.getItem('crypto-agent-recents') || '[]') as ChatSession[]; }
    catch { return []; }
  });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  useLayoutEffect(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>('.composer textarea');
    if (!textarea) return;
    textarea.style.height = 'auto';
    const height = Math.min(textarea.scrollHeight, 144);
    textarea.style.height = `${height}px`;
    textarea.style.overflowY = textarea.scrollHeight > 144 ? 'auto' : 'hidden';
  }, [input]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsCursor, setNewsCursor] = useState<string | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(() => Math.min(window.innerWidth * .2, Math.max(LEFT_SIDEBAR_MIN, Number(window.localStorage.getItem('crypto-agent-left-width')) || window.innerWidth * .14)));
  const [rightWidth, setRightWidth] = useState(() => Math.min(window.innerWidth * .6, Math.max(window.innerWidth * .3, Number(window.localStorage.getItem('crypto-agent-right-width')) || window.innerWidth * .36)));
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [resizing, setResizing] = useState<'left' | 'right' | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const dragValue = useRef<number | null>(null);
  const dragFrame = useRef<number | null>(null);

  async function refresh() {
    try {
      const next = await api<Status>('/status'); setStatus(next);
      if (next.model) { setModelId((current) => next.model?.models.includes(current) ? current : next.model!.defaultModel); setReasoningEffort((current) => next.model?.reasoning.includes(current) ? current : next.model!.defaultReasoning); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to connect.'); }
  }
  async function loadMoreNews() {
    if (!newsCursor || newsLoading) return;
    setNewsLoading(true);
    try {
      const result = await api<{ items: NewsItem[]; nextCursor: string | null }>(`/news?limit=30&before=${encodeURIComponent(newsCursor)}`);
      setNews((current) => [...current, ...result.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setNewsCursor(result.nextCursor);
    } catch { /* The next pull can retry the same cursor. */ } finally { setNewsLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    let active = true;
    const notify = (title: string, body: string) => {
      if (window.cryptoAgent) window.cryptoAgent.notify(title, body);
      else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(title, { body });
    };
    void api<{ items: NewsItem[]; nextCursor: string | null }>('/news?mode=startup&limit=30').then((result) => {
      if (!active) return;
      setNews(result.items);
      setNewsCursor(result.nextCursor);
      if (result.items.length) notify('CryptoAgent 今日新闻', `${result.items.length} 条重要新闻已准备好`);
    }).catch(() => {});
    const stream = new EventSource('/api/news/stream');
    const add = (event: MessageEvent<string>) => { const payload = JSON.parse(event.data) as { item?: NewsItem; items?: NewsItem[] }; const incoming = payload.item ? [payload.item] : payload.items || []; if (!incoming.length) return; setNews((current) => [...incoming, ...current.filter((item) => !incoming.some((next) => next.id === item.id))]); };
    stream.addEventListener('item', add);
    stream.addEventListener('breaking', add);
    stream.addEventListener('digest', (event) => { add(event); const payload = JSON.parse(event.data) as { items?: NewsItem[] }; if (payload.items?.length) notify('CryptoAgent 两小时新闻', `${payload.items.length} 条新新闻`); });
    stream.addEventListener('ready', add);
    stream.addEventListener('emergency', (event) => { const next = JSON.parse(event.data) as EmergencyState; notify('CryptoAgent 紧急授权待确认', next.pending?.title || '检测到爆炸性新闻'); });
    const onBreaking = (event: MessageEvent<string>) => { const item = (JSON.parse(event.data) as { item: NewsItem }).item; notify('CryptoAgent 爆炸性新闻', item.title); };
    stream.addEventListener('breaking', onBreaking);
    const latestTimer = window.setInterval(() => {
      void api<{ items: NewsItem[] }>('/news?limit=30').then((result) => {
        if (!active || !result.items.length) return;
        setNews((current) => [...result.items, ...current.filter((item) => !result.items.some((next) => next.id === item.id))]);
      }).catch(() => {});
    }, 15_000);
    if (!window.cryptoAgent && typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission().catch(() => {});
    return () => { active = false; window.clearInterval(latestTimer); stream.close(); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; window.localStorage.setItem('crypto-agent-theme', theme); }, [theme]);
  useEffect(() => { window.localStorage.setItem('crypto-agent-left-width', String(leftWidth)); }, [leftWidth]);
  useEffect(() => { window.localStorage.setItem('crypto-agent-right-width', String(rightWidth)); }, [rightWidth]);
  useEffect(() => {
    if (!modelOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => { if (!modelPickerRef.current?.contains(event.target as Node)) setModelOpen(false); };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [modelOpen]);
  useEffect(() => {
    if (!resizing) return;
    const move = (event: PointerEvent) => {
      dragValue.current = resizing === 'left' ? Math.min(window.innerWidth * .2, Math.max(LEFT_SIDEBAR_MIN, event.clientX)) : Math.min(window.innerWidth * .6, Math.max(window.innerWidth * .3, window.innerWidth - event.clientX));
      if (dragFrame.current !== null) return;
      dragFrame.current = window.requestAnimationFrame(() => {
        if (dragValue.current !== null) shellRef.current?.style.setProperty(resizing === 'left' ? '--left-width' : '--right-width', `${dragValue.current}px`);
        dragFrame.current = null;
      });
    };
    const stop = () => {
      if (dragFrame.current !== null) { window.cancelAnimationFrame(dragFrame.current); dragFrame.current = null; }
      const value = dragValue.current;
      if (value !== null) { if (resizing === 'left') setLeftWidth(value); else setRightWidth(value); }
      dragValue.current = null;
      setResizing(null);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    return () => { document.body.style.cursor = ''; document.body.style.userSelect = ''; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
  }, [resizing]);
  useEffect(() => {
    const safeSessions = sessions.slice(0, 20).map((session) => ({ ...session, messages: session.messages.map(({ id, role, content, product }) => ({ id, role, content, product })) }));
    window.localStorage.setItem('crypto-agent-recents', JSON.stringify(safeSessions));
  }, [sessions]);

  function newChat() { setActiveSessionId(null); setMessages([]); setInput(''); setError(''); }
  function openSession(session: ChatSession) { setActiveSessionId(session.id); setMessages(session.messages); setInput(''); setError(''); }

  async function send() {
    const content = input.trim();
    if (!content || busy) return;
    const user: Message = { id: crypto.randomUUID(), role: 'user', content };
    const sessionId = activeSessionId || crypto.randomUUID();
    const title = content.length > 32 ? `${content.slice(0, 32)}...` : content;
    const baseMessages = [...messages, user];
    setActiveSessionId(sessionId);
    setMessages(baseMessages); setInput(''); setBusy(true); setError('');
    try {
      const result = await api<{ reply: string; product?: Message['product']; draft?: Draft }>('/chat', { method: 'POST', body: JSON.stringify({ message: content, model: modelId, reasoning_effort: reasoningEffort }) });
      const assistant: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', product: result.product, draft: result.draft };
      setMessages((current) => [...current, assistant]);
      for (const chunk of result.reply.match(/.{1,4}/gs) || []) {
        await new Promise((resolve) => window.setTimeout(resolve, 12));
        setMessages((current) => current.map((message) => message.id === assistant.id ? { ...message, content: message.content + chunk } : message));
      }
      const nextMessages = [...baseMessages, { ...assistant, content: result.reply }];
      setMessages(nextMessages);
      setSessions((existing) => [{ id: sessionId, title: existing.find((item) => item.id === sessionId)?.title || title, messages: nextMessages, updatedAt: Date.now() }, ...existing.filter((item) => item.id !== sessionId)]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to prepare the order.'); }
    finally { setBusy(false); }
  }

  const shellStyle = { '--left-width': leftCollapsed ? '0px' : `${leftWidth}px`, '--right-width': rightCollapsed ? '0px' : `${rightWidth}px` } as CSSProperties;
  return <main ref={shellRef} className={`terminal-shell ${leftCollapsed ? 'left-collapsed' : ''} ${rightCollapsed ? 'right-collapsed' : ''} ${resizing ? 'is-resizing' : ''}`} style={shellStyle}>
    <aside className="portfolio">
      <header><CircleDollarSign size={23} /><div><strong>CryptoAgent</strong></div><button className="sidebar-toggle left-panel-toggle" title="隐藏左侧栏" aria-label="隐藏左侧栏" onClick={() => setLeftCollapsed(true)}><PanelLeftClose size={17} /></button></header>
      <button className="new-chat" onClick={newChat}><Plus size={17} />New chat</button>
      <div className="sidebar-lists">
      <nav className="recents" aria-label="最近对话"><div className="section-title"><span>Recents</span></div><div className="recents-list">{sessions.length ? sessions.map((session) => <button className={activeSessionId === session.id ? 'active' : ''} key={session.id} onClick={() => openSession(session)}><MessageSquare size={14} /><span>{session.title}</span></button>) : <p>暂无最近对话</p>}</div></nav>
      <NewsPanel items={news} onLoadMore={() => void loadMoreNews()} loading={newsLoading} hasMore={Boolean(newsCursor)} />
      </div>
      <button className="settings-entry" onClick={() => setSettingsOpen(true)}><Settings2 size={16} />设置与外观</button>
      <button className="resize-handle left-resize" title="调整左侧栏宽度" aria-label="调整左侧栏宽度" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setResizing('left'); }} />
    </aside>
    {leftCollapsed && <button className="sidebar-reopen left-reopen" title="显示左侧栏" aria-label="显示左侧栏" onClick={() => setLeftCollapsed(false)}><PanelLeftOpen size={18} /></button>}
    <section className="conversation">
      <div className="conversation-top"><div><Bot size={18} /><strong>{activeSessionId ? sessions.find((item) => item.id === activeSessionId)?.title || '交易对话' : '新对话'}</strong></div><div className="top-actions"><span>{status?.environment === 'live' ? 'LIVE' : 'TESTNET'}</span></div></div>
      <div className="messages">
        {!messages.length && <div className="empty"><Bot size={32} /><h1>{recentNewsWelcome(news)}</h1></div>}
        {messages.map((message) => <article className={`message ${message.role}`} key={message.id}><div className="bubble"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>{message.draft && <OrderDraft draft={message.draft} product={message.product} onConfirmed={(order) => { setMessages((current) => current.map((item) => item.id === message.id ? { ...item, order } : item)); void refresh(); }} />}{message.order && <div className="order-success"><Check size={16} />订单已提交 · ID {String(message.order.orderId || message.order.clientOrderId || 'accepted')}</div>}</div></article>)}
        {busy && <article className="message assistant"><div className="bubble thinking"><i /><i /><i /></div></article>}
        {error && <div className="global-error">{error}</div>}
      </div>
      <div className="composer-wrap"><div className="composer"><textarea rows={1} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder="输入交易指令或询问账户状态" /><div className="model-picker" ref={modelPickerRef}><button className="model-trigger" aria-haspopup="menu" aria-expanded={modelOpen} onClick={() => setModelOpen((open) => !open)}>5.6 {modelId.split('-').at(-1)![0].toUpperCase() + modelId.split('-').at(-1)!.slice(1)} · {({ low: 'Light', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Ultra' } as Record<ReasoningId, string>)[reasoningEffort]}<ChevronDown size={15} /></button>{modelOpen && <div className="model-menu" role="menu"><div className="model-menu-label">Reasoning</div>{(status?.model?.reasoning || ['low', 'medium', 'high', 'xhigh', 'max']).map((option) => <button key={option} className={reasoningEffort === option ? 'selected' : ''} onClick={() => { setReasoningEffort(option); setModelOpen(false); }}>{({ low: 'Light', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Ultra' } as Record<ReasoningId, string>)[option]}{reasoningEffort === option && <Check size={15} />}</button>)}<div className="model-menu-divider" /><div className="model-menu-label">Model</div>{(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'] as ModelId[]).filter((option) => (status?.model?.models || ['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra']).includes(option)).map((option) => <button key={option} className={modelId === option ? 'selected' : ''} onClick={() => { setModelId(option); setModelOpen(false); }}>{modelLabel(option)}</button>)}</div>}</div><button className="composer-send" title="发送" aria-label="发送" disabled={!input.trim() || busy} onClick={() => void send()}><SendHorizontal size={19} /></button></div><small>模型只生成订单草案。所有订单都需要你明确确认。</small></div>
    </section>
    <aside className="market-rail"><button className="sidebar-toggle right-panel-toggle" title="隐藏右侧栏" aria-label="隐藏右侧栏" onClick={() => setRightCollapsed(true)}><PanelRightClose size={17} /></button><AssetWorkspace /><button className="resize-handle right-resize" title="调整右侧栏宽度" aria-label="调整右侧栏宽度" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setResizing('right'); }} /></aside>
    {rightCollapsed && <button className="sidebar-reopen right-reopen" title="显示右侧栏" aria-label="显示右侧栏" onClick={() => setRightCollapsed(false)}><PanelRightOpen size={18} /></button>}
    {settingsOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSettingsOpen(false); }}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><button className="dialog-close" title="关闭" aria-label="关闭" onClick={() => setSettingsOpen(false)}><X size={18} /></button><h2 id="settings-title">设置</h2><label>外观</label><div className="theme-options">{([['light', Sun, '浅色'], ['dark', Moon, '深色'], ['system', Monitor, '跟随系统']] as const).map(([value, Icon, label]) => <button key={value} className={theme === value ? 'selected' : ''} onClick={() => setTheme(value)}><Icon size={16} />{label}</button>)}</div></section></div>}
  </main>;
}

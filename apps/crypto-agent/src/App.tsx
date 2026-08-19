import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Eye,
  FileText,
  History,
  Home,
  LineChart,
  MessageSquare,
  Monitor,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Search,
  SendHorizontal,
  Settings2,
  ShieldCheck,
  Sun,
  WalletCards,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  appendedPointCount,
  klineWindow,
  mergeKlineRows,
  mergeTradeIntoSecondRows,
  zoomWindowOffset,
  type KlineRow,
} from "./chart-data";
import { aggregateAssetBalances } from "./asset-summary";

type ModelId = "gpt-5.6-luna" | "gpt-5.6-sol" | "gpt-5.6-terra";
type ReasoningId = "low" | "medium" | "high" | "xhigh" | "max";
type Status = {
  configured: boolean;
  environment: "testnet" | "live";
  liveTradingEnabled: boolean;
  allowedSymbols: string[] | null;
  maxOrderUsdt: number;
  model?: {
    provider: string;
    models: ModelId[];
    reasoning: ReasoningId[];
    defaultModel: ModelId;
    defaultReasoning: ReasoningId;
  };
};
type Balance = { asset: string; free: string; locked: string };
type Draft = {
  id: string;
  confirmationToken: string;
  intent: {
    symbol: string;
    side: "BUY" | "SELL";
    type: string;
    quantity?: string;
    quoteOrderQty?: string;
    price?: string;
    leverage?: number;
    marginType?: string;
  };
  estimate?: {
    estimatedPrice: number;
    estimatedNotional: number;
    baseQuantity: number;
    baseAsset: string;
    quoteAsset: string;
  };
  environment: string;
};
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachment?: ImageAttachment;
  product?: "spot" | "margin" | "futures";
  draft?: Draft;
  order?: Record<string, unknown>;
};
type ChatSession = {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
};
type ChartPoint = { time: number; close: number };
type Theme = "light" | "dark" | "system";
type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  summary: string;
  publishedAt: string;
  urgency: "normal" | "breaking";
};
type EmergencyState = {
  pending?: { id: string; title: string; budget: number };
  grant?: { id: string; remaining: number; expiresAt: number } | null;
};
type FuturesPosition = {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  liquidationPrice: string;
  leverage: string;
  marginType: string;
  unRealizedProfit: string;
};
type MarginAccount = {
  marginLevel?: string;
  totalAssetOfBtc?: string;
  totalLiabilityOfBtc?: string;
  userAssets?: Array<{
    asset: string;
    borrowed: string;
    interest: string;
    free: string;
  }>;
};
type AssetSnapshot = {
  configured: boolean;
  spot: { balances?: Balance[] } | null;
  funding: Array<{
    asset: string;
    free: string;
    locked: string;
    freeze?: string;
    withdrawing?: string;
  }> | null;
  earn: {
    rows?: Array<{
      asset: string;
      totalAmount?: string;
      holdingAmount?: string;
      cumulativeTotalRewards?: string;
      latestAnnualPercentageRate?: string;
      productName?: string;
      productId?: string;
    }>;
  } | null;
  futures: {
    totalWalletBalance?: string;
    totalUnrealizedProfit?: string;
    availableBalance?: string;
    assets?: Array<{
      asset: string;
      walletBalance: string;
      unrealizedProfit: string;
      availableBalance: string;
    }>;
    positions?: Array<{
      symbol: string;
      positionAmt: string;
      unrealizedProfit: string;
    }>;
  } | null;
  wallets: Array<{
    walletName: string;
    balance: string;
    activate: boolean;
  }> | null;
  prices: Record<string, number>;
  errors: string[];
};
type AssetTab = "overview" | "earn" | "spot" | "funding" | "futures";
type CoinMMarket = {
  symbol: string;
  interval: string;
  klines: Array<Array<string | number>>;
  depth: { bids: string[][]; asks: string[][] };
  premium: {
    markPrice: string;
    indexPrice: string;
    lastFundingRate?: string;
    nextFundingTime?: number;
  };
  orderBook24h?: Record<string, unknown> | null;
  partial?: boolean;
};
type MarketContext = {
  symbol: string;
  interval: string;
  candles: CoinMCandle[];
  markPrice: number;
  fundingRate: number;
  depth: {
    bidDepth: number;
    askDepth: number;
    imbalance: number;
    spreadBps: number;
  } | null;
  orderBook24h?: Record<string, unknown> | null;
};
type ImageAttachment = { dataUrl: string; name: string; type: string };
type FuturesTrade = {
  id: number;
  orderId: number;
  symbol: string;
  side: string;
  positionSide?: string;
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
  realizedPnl: string;
  time: number;
  maker?: boolean;
};
const LEFT_SIDEBAR_MIN = 160;
const TIME_SHARE_ZOOM_KEY = "crypto-agent-time-share-visible-points";
const MIN_TIME_SHARE_POINTS = 9;
const MAX_TIME_SHARE_POINTS = 145;

declare global {
  interface Window {
    cryptoAgent?: { notify: (title: string, body: string) => void };
  }
}

if (
  window.cryptoAgent &&
  new URLSearchParams(window.location.search).get("widget") !== "1"
)
  document.documentElement.dataset.desktop = "true";

function formatNumber(value: number | string) {
  const number = Number(value);
  // Binance mobile balances display two decimal places by truncating the visible amount.
  const display = Math.floor(number * 100) / 100;
  return Number.isFinite(number)
    ? display.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "-";
}

function modelLabel(model: ModelId, prefix = "GPT-") {
  const family = model.replace("gpt-", "").replace("-", " ");
  return `${prefix}${family[0].toUpperCase()}${family.slice(1)}`;
}

function recentNewsWelcome(items: NewsItem[]) {
  const text = (
    items[0]?.summary ||
    items[0]?.title ||
    "市场新闻正在同步，随时可以开始对话"
  )
    .replace(/\s+/g, " ")
    .trim();
  const sentence = text.split(/(?<=[。！？.!?])\s*/)[0];
  return sentence.length > 120 ? `${sentence.slice(0, 117)}...` : sentence;
}

function NewsPanel({
  items,
  onRefresh,
  onLoadMore,
  loading,
  hasMore,
}: {
  items: NewsItem[];
  onRefresh: () => void;
  onLoadMore: () => void;
  loading: boolean;
  hasMore: boolean;
}) {
  const list = useRef<HTMLDivElement>(null);
  const pullStart = useRef<number | null>(null);
  const known = useRef<Set<string> | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const pullThreshold = 44;
  useEffect(() => {
    if (!known.current) known.current = new Set(items.map((item) => item.id));
    else for (const item of items) known.current.add(item.id);
  }, [items]);
  const finishPull = (clientY: number) => {
    const distance =
      pullStart.current === null ? 0 : clientY - pullStart.current;
    if (distance >= pullThreshold && !loading) onRefresh();
    pullStart.current = null;
    setPullDistance(0);
  };
  return (
    <section className="news-panel" aria-label="市场新闻">
      <div className="section-title">
        <span>News</span>
      </div>
      <div
        className="news-list"
        ref={list}
        onScroll={(event) => {
          const target = event.currentTarget;
          if (
            target.scrollHeight - target.scrollTop - target.clientHeight < 80 &&
            hasMore &&
            !loading
          )
            onLoadMore();
        }}
        onPointerDown={(event) => {
          if (list.current?.scrollTop === 0 && !loading) {
            pullStart.current = event.clientY;
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        }}
        onPointerMove={(event) => {
          if (pullStart.current !== null)
            setPullDistance(
              Math.min(76, Math.max(0, event.clientY - pullStart.current)),
            );
        }}
        onPointerUp={(event) => {
          finishPull(event.clientY);
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          pullStart.current = null;
          setPullDistance(0);
        }}
      >
        <div
          className={`news-pull-indicator${loading ? " loading" : ""}`}
          style={{
            height: loading ? 28 : pullDistance,
            opacity: loading || pullDistance > 0 ? 1 : 0,
          }}
        >
          {loading ? (
            <>
              <RefreshCw size={13} className="spin" />
              加载中
            </>
          ) : pullDistance >= pullThreshold ? (
            "释放加载"
          ) : (
            "下拉加载"
          )}
        </div>
        {items.length ? (
          items.map((item) => (
            <article
              className={`news-item${item.urgency === "breaking" ? " breaking" : ""}${known.current && !known.current.has(item.id) ? " entering" : ""}`}
              key={item.id}
            >
              <div>
                <span>{item.source}</span>
                <time>
                  {new Date(item.publishedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
              <a href={item.url} target="_blank" rel="noreferrer">
                {item.title}
              </a>
            </article>
          ))
        ) : (
          <p className="news-empty">新闻正在同步</p>
        )}
        {loading && items.length > 0 && (
          <div className="news-page-loading">
            <RefreshCw size={12} className="spin" />
            加载更多
          </div>
        )}
        {!hasMore && items.length > 0 && (
          <div className="news-page-end">已到最早新闻</div>
        )}
      </div>
    </section>
  );
}

function EmergencyPanel({
  state,
  onChange,
}: {
  state: EmergencyState;
  onChange: (next: EmergencyState) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!state.pending && !state.grant) return null;
  async function confirm() {
    setBusy(true);
    try {
      const result = await api<{ grant: EmergencyState["grant"] }>(
        "/emergency/confirm",
        {
          method: "POST",
          body: JSON.stringify({
            confirmation: "CONFIRM",
            allowLeverage: false,
            maxLeverage: 1,
          }),
        },
      );
      onChange({ grant: result.grant });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="emergency-panel" aria-label="紧急授权">
      {state.pending && (
        <>
          <strong>紧急新闻待确认</strong>
          <span>{state.pending.title}</span>
          <small>
            预授权预算 {formatNumber(state.pending.budget)} USDT，仅限现货
          </small>
          <button disabled={busy} onClick={() => void confirm()}>
            {busy ? "授权中" : "确认紧急授权"}
          </button>
        </>
      )}
      {state.grant && (
        <>
          <strong>紧急授权已启用</strong>
          <span>剩余预算 {formatNumber(state.grant.remaining)} USDT</span>
          <button
            onClick={() =>
              void api("/emergency/revoke", {
                method: "POST",
                body: JSON.stringify({ reason: "manual" }),
              }).then(() => onChange({}))
            }
          >
            撤销授权
          </button>
        </>
      )}
    </section>
  );
}

function DerivativesPanel({
  positions,
  margin,
}: {
  positions: FuturesPosition[];
  margin: MarginAccount | null;
}) {
  const active = positions.filter((item) => Number(item.positionAmt) !== 0);
  if (!active.length && !margin) return null;
  return (
    <section className="derivatives-panel" aria-label="杠杆与合约状态">
      <div className="news-heading">
        <strong>杠杆与合约</strong>
        <span>只读风险摘要</span>
      </div>
      {active.map((position) => (
        <div className="derivative-row" key={position.symbol}>
          <b>
            {position.symbol} {Number(position.positionAmt) > 0 ? "多" : "空"}{" "}
            {formatNumber(position.leverage)}x
          </b>
          <span>强平 {formatNumber(position.liquidationPrice)}</span>
          <span>未实现 {formatNumber(position.unRealizedProfit)} USDT</span>
        </div>
      ))}
      {margin && (
        <div className="derivative-row">
          <b>Margin</b>
          <span>保证金率 {formatNumber(margin.marginLevel || 0)}</span>
          <span>负债 {formatNumber(margin.totalLiabilityOfBtc || 0)} BTC</span>
        </div>
      )}
    </section>
  );
}

function ProductDraftPanel({ onDone }: { onDone: () => void }) {
  const [product, setProduct] = useState<"spot" | "margin" | "futures">(
    "futures",
  );
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState("");
  const [leverage, setLeverage] = useState("1");
  const [marginType, setMarginType] = useState("ISOLATED");
  const [draft, setDraft] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    setError("");
    try {
      const path = product === "spot" ? "/chat" : `/${product}/drafts`;
      const base = symbol.replace(/USDT$/, "");
      const payload =
        product === "spot"
          ? {
              message: `${side === "BUY" ? "买入" : "卖出"} ${quantity} ${base}`,
            }
          : {
              symbol,
              side,
              type: "MARKET",
              quantity,
              ...(product === "futures"
                ? { leverage: Number(leverage), marginType }
                : { marginType }),
            };
      const result = await api<any>(path, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!result.draft) throw new Error(result.reply || "无法创建草案");
      setDraft(result.draft);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法创建草案");
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const result = await api<any>(`/${product}/drafts/${draft.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({
          confirmation: "CONFIRM",
          confirmationToken: draft.confirmationToken,
        }),
      });
      setDraft(null);
      onDone();
      alert(
        `订单已提交：${String(result.order?.orderId || result.order?.orderId || "accepted")}`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="product-draft-panel" aria-label="产品交易草案">
      <div className="news-heading">
        <strong>产品交易草案</strong>
        <span>所有产品都需要人工确认</span>
      </div>
      <div className="draft-controls">
        <select
          value={product}
          onChange={(event) => {
            setProduct(event.target.value as typeof product);
            setDraft(null);
          }}
        >
          <option value="spot">现货 Spot</option>
          <option value="margin">杠杆现货 Margin</option>
          <option value="futures">合约 Futures</option>
        </select>
        <input
          value={symbol}
          onChange={(event) => setSymbol(event.target.value.toUpperCase())}
          aria-label="交易对"
          placeholder="BTCUSDT"
        />
        <select
          value={side}
          onChange={(event) => setSide(event.target.value as "BUY" | "SELL")}
        >
          <option value="BUY">买入 / 做多</option>
          <option value="SELL">卖出 / 做空</option>
        </select>
        <input
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          aria-label="数量"
          placeholder="数量"
        />
        {product !== "spot" && (
          <select
            value={marginType}
            onChange={(event) => setMarginType(event.target.value)}
          >
            <option value="ISOLATED">逐仓</option>
            <option value="CROSSED">全仓</option>
          </select>
        )}
        {product === "futures" && (
          <input
            value={leverage}
            onChange={(event) => setLeverage(event.target.value)}
            aria-label="杠杆"
            placeholder="杠杆 1-125x"
          />
        )}
        <button
          disabled={busy || !quantity}
          onClick={() => void (draft ? confirm() : create())}
        >
          {busy ? "处理中" : draft ? "确认并提交" : "生成草案"}
        </button>
      </div>
      {draft && (
        <div className="draft-preview">
          {product.toUpperCase()} · {draft.intent.symbol} · {draft.intent.side}{" "}
          {draft.intent.leverage ? `${draft.intent.leverage}x` : ""} ·{" "}
          {draft.intent.marginType || ""}
          <small>请核对产品、方向、数量、杠杆和保证金模式后确认。</small>
        </div>
      )}
      {error && <div className="inline-error">{error}</div>}
    </section>
  );
}

function MarginActionPanel({ onDone }: { onDone: () => void }) {
  const [action, setAction] = useState<"BORROW" | "REPAY">("BORROW");
  const [asset, setAsset] = useState("USDT");
  const [amount, setAmount] = useState("");
  const [draft, setDraft] = useState<any>(null);
  const [error, setError] = useState("");
  async function submit() {
    setError("");
    try {
      if (!draft) {
        const result = await api<any>("/margin/actions/drafts", {
          method: "POST",
          body: JSON.stringify({ action, asset, amount }),
        });
        setDraft(result.draft);
        return;
      }
      await api(`/margin/actions/drafts/${draft.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({
          confirmation: "CONFIRM",
          confirmationToken: draft.confirmationToken,
        }),
      });
      setDraft(null);
      setAmount("");
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Margin 操作失败");
    }
  }
  return (
    <section className="product-draft-panel" aria-label="Margin 借贷草案">
      <div className="news-heading">
        <strong>Margin 借贷</strong>
        <span>借币与还款均需确认</span>
      </div>
      <div className="draft-controls">
        <select
          value={action}
          onChange={(event) => {
            setAction(event.target.value as typeof action);
            setDraft(null);
          }}
        >
          <option value="BORROW">借币</option>
          <option value="REPAY">还款</option>
        </select>
        <input
          value={asset}
          onChange={(event) => setAsset(event.target.value.toUpperCase())}
          aria-label="资产"
        />
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-label="金额"
          placeholder="金额"
        />
        <button disabled={!amount} onClick={() => void submit()}>
          {draft ? `确认${action === "BORROW" ? "借币" : "还款"}` : "生成草案"}
        </button>
      </div>
      {draft && (
        <div className="draft-preview">
          {draft.action} · {draft.params.amount} {draft.params.asset}
          <small>
            确认后将调用 Binance Margin{" "}
            {draft.action === "BORROW" ? "借币" : "还款"}接口。
          </small>
        </div>
      )}
      {error && <div className="inline-error">{error}</div>}
    </section>
  );
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function readImageAttachment(file: File) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    return Promise.reject(new Error("只支持 PNG、JPEG 或 WebP 图片"));
  if (file.size > 4_000_000)
    return Promise.reject(new Error("图片不能超过 4 MB"));
  return new Promise<ImageAttachment>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        dataUrl: String(reader.result),
        name: file.name || "clipboard-image",
        type: file.type,
      });
    reader.onerror = () => reject(new Error("无法读取图片"));
    reader.readAsDataURL(file);
  });
}

function OrderDraft({
  draft,
  product = "spot",
  onConfirmed,
}: {
  draft: Draft;
  product?: "spot" | "margin" | "futures";
  onConfirmed: (order: Record<string, unknown>) => void;
}) {
  const [state, setState] = useState<"ready" | "busy" | "done">("ready");
  const [error, setError] = useState("");
  const side = draft.intent.side;
  async function confirm() {
    setState("busy");
    setError("");
    try {
      const path =
        product === "spot"
          ? `/orders/${draft.id}/confirm`
          : `/${product}/drafts/${draft.id}/confirm`;
      const result = await api<{ order: Record<string, unknown> }>(path, {
        method: "POST",
        body: JSON.stringify({
          confirmation: "CONFIRM",
          confirmationToken: draft.confirmationToken,
        }),
      });
      setState("done");
      onConfirmed(result.order);
    } catch (caught) {
      setState("ready");
      setError(caught instanceof Error ? caught.message : "Order failed.");
    }
  }
  return (
    <section
      className={`order-draft ${side.toLowerCase()}`}
      aria-label="Order preview"
    >
      <div className="order-heading">
        <span>
          {side === "BUY" ? (
            <ArrowDownLeft size={17} />
          ) : (
            <ArrowUpRight size={17} />
          )}
          {side === "BUY" ? "买入 / 做多" : "卖出 / 做空"} {draft.intent.symbol}
        </span>
        <small>
          {product.toUpperCase()} ·{" "}
          {draft.environment === "testnet" ? "测试网" : "实盘"}
        </small>
      </div>
      <dl>
        <div>
          <dt>订单类型</dt>
          <dd>{draft.intent.type}</dd>
        </div>
        <div>
          <dt>数量</dt>
          <dd>
            {formatNumber(
              draft.intent.quantity || draft.intent.quoteOrderQty || 0,
            )}
          </dd>
        </div>
        {draft.intent.leverage && (
          <div>
            <dt>杠杆</dt>
            <dd>{formatNumber(draft.intent.leverage)}x</dd>
          </div>
        )}
        {draft.intent.marginType && (
          <div>
            <dt>保证金模式</dt>
            <dd>{draft.intent.marginType}</dd>
          </div>
        )}
        {draft.estimate && (
          <div>
            <dt>预估金额</dt>
            <dd>
              {formatNumber(draft.estimate.estimatedNotional)}{" "}
              {draft.estimate.quoteAsset}
            </dd>
          </div>
        )}
      </dl>
      <p>
        <ShieldCheck size={15} /> 草案已通过本地格式校验。确认后仍需通过 Binance
        产品规则；市价单最终成交价可能不同。
      </p>
      {error && <div className="inline-error">{error}</div>}
      <button
        className="confirm-order"
        disabled={state !== "ready"}
        onClick={confirm}
      >
        {state === "busy" ? (
          <RefreshCw className="spin" size={17} />
        ) : (
          <Check size={17} />
        )}
        {state === "done"
          ? "已提交"
          : state === "busy"
            ? "提交中"
            : `确认${draft.environment === "testnet" ? "测试网" : "实盘"}订单`}
      </button>
    </section>
  );
}

function PriceChart({
  symbol,
  environment,
}: {
  symbol: string;
  environment: "testnet" | "live";
}) {
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await api<{ klines: Array<Array<string | number>> }>(
          `/klines?symbol=${symbol}&interval=1m`,
        );
        if (active) {
          setPoints(
            result.klines.map((item) => ({
              time: Number(item[0]),
              close: Number(item[4]),
            })),
          );
          setError("");
        }
      } catch (caught) {
        if (active)
          setError(caught instanceof Error ? caught.message : "行情暂不可用");
      }
    }
    void load();
    const streamHost =
      environment === "testnet"
        ? "wss://stream.testnet.binance.vision/ws"
        : "wss://stream.binance.com:9443/ws";
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    const connect = () => {
      if (!active) return;
      socket = new WebSocket(`${streamHost}/${symbol.toLowerCase()}@trade`);
      socket.onmessage = (event) => {
        const trade = JSON.parse(event.data) as { p?: string; T?: number };
        const close = Number(trade.p);
        const time = Number(trade.T || Date.now());
        if (!Number.isFinite(close)) return;
        setPoints((current) => {
          const next = current.length ? [...current] : [{ time, close }];
          const candleTime = Math.floor(time / 60_000) * 60_000;
          if (next.at(-1)?.time === candleTime)
            next[next.length - 1] = { time: candleTime, close };
          else next.push({ time: candleTime, close });
          return next.slice(-120);
        });
      };
      socket.onclose = () => {
        if (active) reconnectTimer = window.setTimeout(connect, 1500);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      active = false;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [symbol, environment]);
  const width = 720;
  const height = 150;
  const pad = 12;
  const values = points.map((point) => point.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const path = points
    .map(
      (point, index) =>
        `${index ? "L" : "M"} ${(pad + index * ((width - pad * 2) / Math.max(points.length - 1, 1))).toFixed(2)} ${(height - pad - ((point.close - min) / range) * (height - pad * 2)).toFixed(2)}`,
    )
    .join(" ");
  return (
    <section
      className="price-chart"
      aria-label={`${symbol} 1 minute price chart`}
    >
      <div className="chart-heading">
        <div>
          <strong>{symbol}</strong>
          <span>1m · Binance Spot</span>
        </div>
        {values.length ? (
          <b>{formatNumber(values.at(-1)!)} USDT</b>
        ) : (
          <span>{error || "加载中"}</span>
        )}
      </div>
      {values.length ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${symbol} recent price`}
        >
          <path
            className="chart-fill"
            d={`${path} L ${width - pad} ${height - pad} L ${pad} ${height - pad} Z`}
          />
          <path className="chart-line" d={path} />
        </svg>
      ) : (
        <div className="chart-empty">{error || "读取行情中…"}</div>
      )}
    </section>
  );
}

type CoinMCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
};

function TimeShareChart({
  candles,
  selectedIndex,
  onSelect,
  onLoadOlder,
  onVisibleChange,
  last,
}: {
  candles: CoinMCandle[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onLoadOlder: () => void;
  onVisibleChange: (candles: CoinMCandle[]) => void;
  last: number;
}) {
  const [historyOffset, setHistoryOffset] = useState(0);
  const [visibleCount, setVisibleCount] = useState(() => {
    const saved = Number(window.localStorage.getItem(TIME_SHARE_ZOOM_KEY));
    return Number.isFinite(saved)
      ? Math.min(
          MAX_TIME_SHARE_POINTS,
          Math.max(MIN_TIME_SHARE_POINTS, Math.round(saved)),
        )
      : 120;
  });
  const visibleCountRef = useRef(visibleCount);
  const candleTimes = useMemo(
    () => candles.map((item) => item.time),
    [candles],
  );
  const dragStart = useRef<number | null>(null);
  const dragAnchor = useRef(0);
  const pendingPointerX = useRef<number | null>(null);
  const dragFrame = useRef<number | null>(null);
  const dragged = useRef(false);
  const pinchStartDistance = useRef<number | null>(null);
  const pinchStartCount = useRef(visibleCount);
  const pinchAnchor = useRef(0.5);
  const activePointers = useRef(new Map<number, number>());
  const prefetchRequested = useRef(false);
  const zoomSaveTimer = useRef<number | null>(null);
  const chartRef = useRef<SVGSVGElement | null>(null);
  const wheelZoomRemainder = useRef(0);
  const wheelHandlerRef = useRef<((event: WheelEvent) => void) | null>(null);
  useEffect(() => {
    visibleCountRef.current = visibleCount;
  }, [visibleCount]);
  const previousLastTime = useRef<number | null>(candleTimes.at(-1) ?? null);
  useEffect(() => {
    const appended = appendedPointCount(candleTimes, previousLastTime.current);
    if (appended > 0) {
      setHistoryOffset((current) => (current > 0 ? current + appended : 0));
      if (dragStart.current !== null) dragAnchor.current += appended;
      prefetchRequested.current = false;
    }
    previousLastTime.current = candleTimes.at(-1) ?? null;
  }, [candles.length, candleTimes.at(-1)]);
  const width = 900;
  const height = 330;
  const pad = 20;
  const visibleEnd = Math.max(0, candles.length - 1 - historyOffset);
  const start = Math.max(0, visibleEnd - visibleCount + 1);
  const visibleCandles = candles.slice(start, visibleEnd + 1);
  const low = visibleCandles.length
    ? Math.min(...visibleCandles.map((item) => item.low))
    : 0;
  const high = visibleCandles.length
    ? Math.max(...visibleCandles.map((item) => item.high))
    : 1;
  const range = high - low || 1;
  const step = (width - pad * 2) / Math.max(visibleCandles.length, 1);
  const y = (price: number) =>
    pad + ((high - price) / range) * (height - pad * 2);
  const closes = visibleCandles.map((item) => item.close);
  const average = closes.map(
    (_, index) =>
      closes
        .slice(Math.max(0, index - 59), index + 1)
        .reduce((sum, value) => sum + value, 0) / Math.min(index + 1, 60),
  );
  const pathFor = (values: Array<number | null>) => {
    let started = false;
    return values
      .flatMap((value, index) => {
        if (value === null) return [];
        const command = started ? "L" : "M";
        started = true;
        return [`${command} ${pad + index * step + step / 2} ${y(value)}`];
      })
      .join(" ");
  };
  const linePath = pathFor(closes);
  const areaPath = `${linePath} L ${pad + (visibleCandles.length - 1) * step + step / 2} ${height - pad} L ${pad + step / 2} ${height - pad} Z`;
  const selected = selectedIndex === null ? null : candles[selectedIndex];
  const selectedLocalIndex =
    selectedIndex === null ? null : selectedIndex - start;
  const visibleLast = visibleCandles.at(-1)?.close ?? last;
  useEffect(() => {
    onVisibleChange(visibleCandles);
  }, [start, visibleEnd, visibleLast, candles.length]);
  const lastY = y(visibleLast);
  const priceLabel = visibleLast.toLocaleString(undefined, {
    maximumFractionDigits: 1,
  });
  const axisPoints = [0, 1, 2, 3, 4, 5];
  const axisIndices = visibleCandles.length
    ? [
        ...new Set([
          0,
          Math.floor((visibleCandles.length - 1) / 2),
          visibleCandles.length - 1,
        ]),
      ]
    : [];
  const datePoints = axisIndices.map((localIndex) => ({
    time: visibleCandles[localIndex].time,
    x: pad + localIndex * step + step / 2,
  }));
  const formatTime = (time: number) =>
    new Date(time).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  const applyPinch = (distance: number, centerFraction: number) => {
    if (pinchStartDistance.current === null) return;
    const currentCount = visibleCountRef.current;
    const nextCount = Math.min(
      MAX_TIME_SHARE_POINTS,
      Math.max(
        MIN_TIME_SHARE_POINTS,
        Math.round(
          (pinchStartCount.current * pinchStartDistance.current) /
            Math.max(1, distance),
        ),
      ),
    );
    if (nextCount === currentCount) return;
    visibleCountRef.current = nextCount;
    setVisibleCount(nextCount);
    setHistoryOffset((current) =>
      zoomWindowOffset(
        candles.length,
        current,
        currentCount,
        nextCount,
        centerFraction,
      ),
    );
  };
  const applyZoomScale = (scale: number, centerFraction: number) => {
    const currentCount = visibleCountRef.current;
    const nextCount = Math.min(
      MAX_TIME_SHARE_POINTS,
      Math.max(
        MIN_TIME_SHARE_POINTS,
        Math.round(pinchStartCount.current / Math.max(0.1, scale)),
      ),
    );
    if (nextCount === currentCount) return;
    visibleCountRef.current = nextCount;
    setVisibleCount(nextCount);
    setHistoryOffset((current) =>
      zoomWindowOffset(
        candles.length,
        current,
        currentCount,
        nextCount,
        centerFraction,
      ),
    );
  };
  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    activePointers.current.set(event.pointerId, event.clientX);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (activePointers.current.size >= 2) {
      const xs = [...activePointers.current.values()];
      pinchStartDistance.current = Math.abs(xs[1] - xs[0]) || 1;
      pinchStartCount.current = visibleCount;
      const bounds = event.currentTarget.getBoundingClientRect();
      pinchAnchor.current = Math.min(
        1,
        Math.max(0, ((xs[0] + xs[1]) / 2 - bounds.left) / bounds.width),
      );
      dragStart.current = null;
      return;
    }
    dragStart.current = event.clientX;
    dragAnchor.current = historyOffset;
    dragged.current = false;
  };
  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (activePointers.current.has(event.pointerId))
      activePointers.current.set(event.pointerId, event.clientX);
    if (
      activePointers.current.size >= 2 &&
      pinchStartDistance.current !== null
    ) {
      const xs = [...activePointers.current.values()];
      const distance = Math.abs(xs[1] - xs[0]) || 1;
      applyPinch(distance, pinchAnchor.current);
      return;
    }
    pendingPointerX.current = event.clientX;
    if (dragFrame.current !== null) return;
    dragFrame.current = window.requestAnimationFrame(() => {
      dragFrame.current = null;
      if (dragStart.current === null || pendingPointerX.current === null)
        return;
      const delta = pendingPointerX.current - dragStart.current;
      if (Math.abs(delta) > 3) dragged.current = true;
      const maximum = Math.max(0, candles.length - visibleCount);
      const nextOffset = Math.max(
        0,
        Math.min(
          maximum,
          dragAnchor.current + Math.round(delta / Math.max(step, 1)),
        ),
      );
      setHistoryOffset(nextOffset);
      if (
        delta > step &&
        nextOffset >= Math.max(0, maximum - visibleCount) &&
        candles.length &&
        !prefetchRequested.current
      ) {
        prefetchRequested.current = true;
        onLoadOlder();
      }
    });
  };
  const handleTouchStart = (event: React.TouchEvent<SVGSVGElement>) => {
    if (event.touches.length < 2) return;
    event.preventDefault();
    const first = event.touches[0];
    const second = event.touches[1];
    pinchStartDistance.current =
      Math.hypot(
        second.clientX - first.clientX,
        second.clientY - first.clientY,
      ) || 1;
    pinchStartCount.current = visibleCountRef.current;
    const bounds = event.currentTarget.getBoundingClientRect();
    pinchAnchor.current = Math.min(
      1,
      Math.max(
        0,
        ((first.clientX + second.clientX) / 2 - bounds.left) / bounds.width,
      ),
    );
    dragStart.current = null;
  };
  const handleTouchMove = (event: React.TouchEvent<SVGSVGElement>) => {
    if (event.touches.length < 2 || pinchStartDistance.current === null) return;
    event.preventDefault();
    const first = event.touches[0];
    const second = event.touches[1];
    applyPinch(
      Math.hypot(
        second.clientX - first.clientX,
        second.clientY - first.clientY,
      ),
      pinchAnchor.current,
    );
  };
  const handleTouchEnd = (event: React.TouchEvent<SVGSVGElement>) => {
    if (event.touches.length < 2 && pinchStartDistance.current !== null) {
      pinchStartDistance.current = null;
      window.localStorage.setItem(
        TIME_SHARE_ZOOM_KEY,
        String(visibleCountRef.current),
      );
    }
  };
  const applyWheelZoom = (deltaY: number, clientX: number, bounds: DOMRect) => {
    const anchor = Math.min(
      1,
      Math.max(0, (clientX - bounds.left) / bounds.width),
    );
    const currentCount = visibleCountRef.current;
    wheelZoomRemainder.current += deltaY / 36;
    const wholeSteps = Math.trunc(wheelZoomRemainder.current);
    if (!wholeSteps) return;
    wheelZoomRemainder.current -= wholeSteps;
    const nextCount = Math.min(
      MAX_TIME_SHARE_POINTS,
      Math.max(MIN_TIME_SHARE_POINTS, currentCount + wholeSteps),
    );
    if (nextCount === currentCount) return;
    visibleCountRef.current = nextCount;
    setVisibleCount(nextCount);
    setHistoryOffset((current) =>
      zoomWindowOffset(
        candles.length,
        current,
        currentCount,
        nextCount,
        anchor,
      ),
    );
    if (zoomSaveTimer.current !== null)
      window.clearTimeout(zoomSaveTimer.current);
    zoomSaveTimer.current = window.setTimeout(() => {
      window.localStorage.setItem(
        TIME_SHARE_ZOOM_KEY,
        String(visibleCountRef.current),
      );
      zoomSaveTimer.current = null;
    }, 180);
  };
  wheelHandlerRef.current = (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    const svg = chartRef.current;
    if (!svg || !svg.contains(event.target as Node)) return;
    event.preventDefault();
    applyWheelZoom(event.deltaY, event.clientX, svg.getBoundingClientRect());
  };
  useEffect(() => {
    const onWheelCapture = (event: WheelEvent) =>
      wheelHandlerRef.current?.(event);
    window.addEventListener("wheel", onWheelCapture, {
      capture: true,
      passive: false,
    });
    return () => window.removeEventListener("wheel", onWheelCapture, true);
  }, []);
  useEffect(() => {
    const svg = chartRef.current;
    if (!svg) return;
    let gestureStartScale = 1;
    const onGestureStart = (event: Event) => {
      const gesture = event as Event & { scale?: number };
      gestureStartScale = gesture.scale || 1;
      pinchStartCount.current = visibleCountRef.current;
      pinchStartDistance.current = 1;
      pinchAnchor.current = 0.5;
      event.preventDefault();
    };
    const onGestureChange = (event: Event) => {
      const gesture = event as Event & { scale?: number };
      applyZoomScale(
        (gesture.scale || 1) / gestureStartScale,
        pinchAnchor.current,
      );
      event.preventDefault();
    };
    const onGestureEnd = () => {
      pinchStartDistance.current = null;
      window.localStorage.setItem(
        TIME_SHARE_ZOOM_KEY,
        String(visibleCountRef.current),
      );
    };
    svg.addEventListener("gesturestart", onGestureStart, { passive: false });
    svg.addEventListener("gesturechange", onGestureChange, { passive: false });
    svg.addEventListener("gestureend", onGestureEnd);
    return () => {
      svg.removeEventListener("gesturestart", onGestureStart);
      svg.removeEventListener("gesturechange", onGestureChange);
      svg.removeEventListener("gestureend", onGestureEnd);
    };
  }, [candles.length]);
  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (dragFrame.current !== null)
      window.cancelAnimationFrame(dragFrame.current);
    dragFrame.current = null;
    pendingPointerX.current = null;
    activePointers.current.delete(event.pointerId);
    if (
      activePointers.current.size < 2 &&
      pinchStartDistance.current !== null
    ) {
      pinchStartDistance.current = null;
      window.localStorage.setItem(TIME_SHARE_ZOOM_KEY, String(visibleCount));
    }
    dragStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const chartX = ((event.clientX - bounds.left) / bounds.width) * width;
    onSelect(
      start +
        Math.max(
          0,
          Math.min(
            visibleCandles.length - 1,
            Math.round((chartX - pad - step / 2) / step),
          ),
        ),
    );
  };
  return (
    <section className="coinm-time-share">
      <div className="coinm-ma-legend">
        <span className="time-ma-legend">
          MA(60):{" "}
          {average
            .at(-1)
            ?.toLocaleString(undefined, { maximumFractionDigits: 1 }) || "-"}
        </span>
      </div>
      <div className="coinm-chart-canvas">
        <svg
          ref={chartRef}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="BTCUSD coin-m time-sharing chart"
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          <g className="chart-grid">
            {axisPoints.map((line) => (
              <line
                key={line}
                x1={pad}
                x2={width - pad}
                y1={pad + (line * (height - pad * 2)) / 5}
                y2={pad + (line * (height - pad * 2)) / 5}
              />
            ))}
            {datePoints.map((item) => (
              <line
                className="time-date-guide"
                key={item.time}
                x1={item.x}
                x2={item.x}
                y1={pad}
                y2={height - pad}
              />
            ))}
            <path className="time-area" d={areaPath} />
            <path className="time-line" d={linePath} />
            <path className="time-ma" d={pathFor(average)} />
            {selected &&
              selectedLocalIndex !== null &&
              selectedLocalIndex >= 0 &&
              selectedLocalIndex < visibleCandles.length && (
                <g className="chart-crosshair">
                  <line
                    x1={pad + selectedLocalIndex * step + step / 2}
                    x2={pad + selectedLocalIndex * step + step / 2}
                    y1={pad}
                    y2={height - pad}
                  />
                  <line
                    x1={pad}
                    x2={width - pad}
                    y1={y(selected.close)}
                    y2={y(selected.close)}
                  />
                  <circle
                    cx={pad + selectedLocalIndex * step + step / 2}
                    cy={y(selected.close)}
                    r="4"
                  />
                </g>
              )}
          </g>
          <line
            className="time-price-guide"
            x1={pad}
            x2={width}
            y1={lastY}
            y2={lastY}
          />
        </svg>
        <div className="coinm-axis">
          {axisPoints.map((line) => (
            <span key={line} style={{ top: `${line * 20}%` }}>
              {(high - (line * range) / 5).toLocaleString(undefined, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}
            </span>
          ))}
        </div>
        {visibleCandles.length > 0 && (
          <div
            className="time-price-overlay"
            style={{ top: `${(lastY / height) * 100}%` }}
          >
            {priceLabel}
          </div>
        )}
        <div className="time-x-axis">
          {datePoints.map((item) => (
            <span
              key={item.time}
              style={{ left: `${(item.x / width) * 100}%` }}
            >
              {formatTime(item.time)}
            </span>
          ))}
        </div>
        {selected && (
          <div className="coinm-tooltip">
            <b>{formatTime(selected.time)}</b>
            <span>
              价格 <em>{selected.close.toLocaleString()}</em>
            </span>
            <span>
              涨跌{" "}
              <em
                className={
                  selected.close >= selected.open ? "positive" : "negative"
                }
              >
                {(selected.close - selected.open).toFixed(1)}
              </em>
            </span>
            <span>
              涨跌幅{" "}
              <em>
                {(
                  ((selected.close - selected.open) / selected.open) *
                  100
                ).toFixed(2)}
                %
              </em>
            </span>
            <span>
              量 <em>{selected.volume.toLocaleString()}</em>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function ContractHistory({
  marketType,
  onBack,
}: {
  marketType: "usdm" | "coinm";
  onBack: () => void;
}) {
  const tabs = [
    "当前委托",
    "历史委托",
    "仓位历史",
    "历史成交",
    "资金流水",
    "资金费率",
  ] as const;
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("历史成交");
  const [rows, setRows] = useState<FuturesTrade[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    if (marketType !== "usdm") {
      setLoading(false);
      return;
    }
    void api<{ rows: FuturesTrade[] }>("/usdm-history?symbol=BTCUSDT")
      .then((result) => {
        if (active) setRows(result.rows);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [marketType]);
  return (
    <section className="contract-history">
      <header>
        <button title="返回" aria-label="返回" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <strong>交易</strong>
          <span>{marketType === "usdm" ? "U 本位合约" : "币本位合约"}</span>
        </div>
      </header>
      <nav className="contract-history-tabs" aria-label="历史记录分类">
        {tabs.map((tab) => (
          <button
            className={activeTab === tab ? "active" : ""}
            key={tab}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>
      {activeTab === "历史成交" ? (
        <div className="trade-history-list">
          {loading ? (
            <p className="history-empty">正在读取历史成交…</p>
          ) : rows.length ? (
            rows.map((trade) => (
              <article key={`${trade.id}-${trade.time}`}>
                <header>
                  <div>
                    <strong>{trade.symbol}</strong>
                    <span>永续</span>
                    <b
                      className={trade.side === "BUY" ? "positive" : "negative"}
                    >
                      {trade.side === "BUY" ? "买入" : "卖出"}
                      {trade.positionSide && trade.positionSide !== "BOTH"
                        ? ` · ${trade.positionSide}`
                        : ""}
                    </b>
                  </div>
                  <time>
                    {new Date(trade.time).toLocaleString("zh-CN", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </time>
                </header>
                <dl>
                  <div>
                    <dt>订单号</dt>
                    <dd>{trade.orderId}</dd>
                  </div>
                  <div>
                    <dt>价格</dt>
                    <dd>{Number(trade.price).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>成交数量 (BTC)</dt>
                    <dd>{Number(trade.qty).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>手续费 ({trade.commissionAsset || "USDT"})</dt>
                    <dd>{Number(trade.commission).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>角色</dt>
                    <dd>{trade.maker ? "挂单" : "吃单"}</dd>
                  </div>
                  <div>
                    <dt>已实现盈亏 (USDT)</dt>
                    <dd
                      className={
                        Number(trade.realizedPnl) >= 0 ? "positive" : "negative"
                      }
                    >
                      {Number(trade.realizedPnl).toFixed(8)}
                    </dd>
                  </div>
                </dl>
              </article>
            ))
          ) : (
            <p className="history-empty">暂无历史成交</p>
          )}
        </div>
      ) : (
        <p className="history-empty">暂无记录</p>
      )}
    </section>
  );
}

function CoinMWorkspace({
  onMarketContext,
}: {
  onMarketContext: (context: MarketContext) => void;
}) {
  const [marketType, setMarketType] = useState<"usdm" | "coinm">("coinm");
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [interval, setInterval] = useState("5m");
  const [market, setMarket] = useState<CoinMMarket | null>(null);
  const [error, setError] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [tickDirection, setTickDirection] = useState<"up" | "down" | "">("");
  const [priceGrouping, setPriceGrouping] = useState("0.1");
  const [secondRows, setSecondRows] = useState<KlineRow[]>([]);
  const [klineOffset, setKlineOffset] = useState(0);
  const [klineVisibleCount, setKlineVisibleCount] = useState(() =>
    Math.min(
      145,
      Math.max(
        9,
        Number(
          window.localStorage.getItem("crypto-agent-kline-visible-points"),
        ) || 120,
      ),
    ),
  );
  const klineVisibleCountRef = useRef(klineVisibleCount);
  const klineWheelRemainder = useRef(0);
  const klineOffsetValue = useRef(0);
  const previousPrice = useRef(0);
  const pendingPrice = useRef<number | null>(null);
  const pendingDepth = useRef<{ bids: string[][]; asks: string[][] } | null>(
    null,
  );
  const pendingRelay = useRef<CoinMMarket | null>(null);
  const pendingSecondRows = useRef<KlineRow[]>([]);
  const klineDragStart = useRef<number | null>(null);
  const klineDragAnchor = useRef(0);
  const klinePointerX = useRef<number | null>(null);
  const klineDragFrame = useRef<number | null>(null);
  const klineDragged = useRef(false);
  const previousKlineLength = useRef(0);
  const loadingOlder = useRef(false);
  const oldestReached = useRef(false);
  const timeVisibleCandles = useRef<CoinMCandle[]>([]);
  const orderBook = useRef({
    bids: new Map<string, string>(),
    asks: new Map<string, string>(),
  });
  const marketSymbol = marketType === "usdm" ? "BTCUSDT" : "BTCUSD_PERP";
  const marketPath = marketType === "usdm" ? "usdm-market" : "coinm-market";
  const streamHost =
    marketType === "usdm"
      ? "wss://fstream.binance.com/ws"
      : "wss://dstream.binance.com/ws";
  const streamSymbol = marketSymbol.toLowerCase();
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!(event.target as Element).closest?.(".coinm-chart-canvas svg"))
        setSelectedIndex(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  useEffect(() => {
    let active = true;
    if (interval === "1s") {
      pendingSecondRows.current = [];
      setSecondRows([]);
    }
    klineOffsetValue.current = 0;
    setKlineOffset(0);
    oldestReached.current = false;
    const sourceInterval =
      interval === "time" || interval === "1s" ? "1m" : interval;
    const load = () =>
      api<CoinMMarket>(
        `/${marketPath}?symbol=${marketSymbol}&interval=${sourceInterval}`,
      )
        .then((result) => {
          if (active) {
            orderBook.current = {
              bids: new Map(
                result.depth.bids.map(
                  ([price, quantity]) => [price, quantity] as const,
                ),
              ),
              asks: new Map(
                result.depth.asks.map(
                  ([price, quantity]) => [price, quantity] as const,
                ),
              ),
            };
            setMarket((current) =>
              current?.symbol === result.symbol &&
              current.interval === result.interval
                ? {
                    ...result,
                    klines: mergeKlineRows(current.klines, result.klines),
                  }
                : result,
            );
            setError("");
          }
        })
        .catch((caught) => {
          if (active)
            setError(
              caught instanceof Error
                ? caught.message
                : `${marketType === "usdm" ? "U 本位" : "币本位"}行情不可用`,
            );
        });
    void load();
    const timer = window.setInterval(load, 60_000);
    const secondTimer =
      interval === "1s" && marketType === "usdm"
        ? window.setInterval(() => {
            void api<CoinMMarket>(`/usdm-1s?symbol=${marketSymbol}`)
              .then((result) => {
                if (active) setSecondRows(result.klines.map((row) => row));
              })
              .catch(() => {});
          }, 1_000)
        : null;
    let fallbackStarted = false;
    let directSockets: WebSocket[] = [];
    const connectDirect = () => {
      if (fallbackStarted || !active) return;
      fallbackStarted = true;
      const stream =
        interval === "1s"
          ? null
          : new WebSocket(
              `${streamHost}/${streamSymbol}@kline_${sourceInterval}`,
            );
      if (stream)
        stream.onmessage = (event) => {
          let payload;
          try {
            payload = JSON.parse(event.data);
          } catch {
            return;
          }
          const item = payload.k;
          if (!active || !item) return;
          const next = [
            item.t,
            item.o,
            item.h,
            item.l,
            item.c,
            item.v,
            item.T,
            item.q,
          ];
          setMarket((current) =>
            current
              ? { ...current, klines: mergeKlineRows(current.klines, [next]) }
              : current,
          );
        };
      const tradeStream = new WebSocket(
        `${streamHost}/${streamSymbol}@aggTrade`,
      );
      tradeStream.onmessage = (event) => {
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        const price = Number(payload?.p);
        const quantity = Number(payload?.q);
        if (active && Number.isFinite(price)) {
          pendingPrice.current = price;
          if (interval === "1s" && Number.isFinite(quantity))
            pendingSecondRows.current = mergeTradeIntoSecondRows(
              pendingSecondRows.current,
              Number(payload.T || payload.E || Date.now()),
              price,
              quantity,
            );
        }
      };
      const depthStream = new WebSocket(
        `${streamHost}/${streamSymbol}@depth@100ms`,
      );
      depthStream.onmessage = (event) => {
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!active || !payload?.b || !payload?.a) return;
        for (const [price, quantity] of payload.b as string[][])
          Number(quantity)
            ? orderBook.current.bids.set(price, quantity)
            : orderBook.current.bids.delete(price);
        for (const [price, quantity] of payload.a as string[][])
          Number(quantity)
            ? orderBook.current.asks.set(price, quantity)
            : orderBook.current.asks.delete(price);
        pendingDepth.current = {
          bids: [...orderBook.current.bids]
            .sort(([left], [right]) => Number(right) - Number(left))
            .slice(0, 1000),
          asks: [...orderBook.current.asks]
            .sort(([left], [right]) => Number(left) - Number(right))
            .slice(0, 1000),
        };
      };
      directSockets = [stream, tradeStream, depthStream].filter(
        (socket): socket is WebSocket => Boolean(socket),
      );
      for (const socket of directSockets)
        socket.onerror = () => {
          if (active) setError("实时行情暂时中断");
        };
    };
    const serverStream =
      marketType === "coinm"
        ? new EventSource(
            `/api/coinm-stream?interval=${interval === "time" ? "1m" : interval}`,
          )
        : null;
    if (serverStream) {
      serverStream.addEventListener("market", (event) => {
        try {
          pendingRelay.current = JSON.parse(
            (event as MessageEvent).data,
          ) as CoinMMarket;
        } catch {
          /* ignore malformed relay events */
        }
      });
      serverStream.onerror = () => {
        serverStream.close();
        connectDirect();
        if (active) setError("服务端行情暂时中断，已切换直连兜底");
      };
    } else connectDirect();
    const bookTimer = window.setInterval(() => {
      const price = pendingPrice.current;
      const depth = pendingDepth.current;
      if (price === null && !depth) return;
      if (price !== null) {
        if (previousPrice.current)
          setTickDirection(price >= previousPrice.current ? "up" : "down");
        previousPrice.current = price;
      }
      setMarket((current) =>
        current
          ? {
              ...current,
              ...(depth ? { depth } : {}),
              ...(price !== null
                ? { premium: { ...current.premium, markPrice: String(price) } }
                : {}),
            }
          : current,
      );
      if (interval === "1s") setSecondRows(pendingSecondRows.current);
      pendingPrice.current = null;
      pendingDepth.current = null;
    }, 400);
    const relayTimer = window.setInterval(() => {
      const next = pendingRelay.current;
      if (!next || !active) return;
      pendingRelay.current = null;
      setMarket((current) => {
        if (!next.partial || !current || !next.klines[0]) return next;
        const klines = [...current.klines];
        const existing = klines.findIndex(
          (row) => Number(row[0]) === Number(next.klines[0][0]),
        );
        if (existing >= 0) klines[existing] = next.klines[0];
        else klines.push(next.klines[0]);
        return {
          ...next,
          orderBook24h: next.orderBook24h || current.orderBook24h,
          klines: mergeKlineRows(klines, next.klines),
        };
      });
    }, 300);
    return () => {
      active = false;
      window.clearInterval(timer);
      if (secondTimer !== null) window.clearInterval(secondTimer);
      window.clearInterval(bookTimer);
      window.clearInterval(relayTimer);
      serverStream?.close();
      directSockets.forEach((socket) => socket.close());
    };
  }, [interval, marketType]);
  const chartRows =
    interval === "1s"
      ? marketType === "coinm"
        ? market?.interval === "1s"
          ? market.klines
          : []
        : secondRows
      : market?.klines || [];
  const allCandles = [
    ...new Map(
      chartRows.map((item) => [
        Number(item[0]),
        {
          time: Number(item[0]),
          open: Number(item[1]),
          high: Number(item[2]),
          low: Number(item[3]),
          close: Number(item[4]),
          volume: Number(item[5]),
          quoteVolume: Number(item[7]),
        },
      ]),
    ).values(),
  ];
  useEffect(() => {
    klineVisibleCountRef.current = klineVisibleCount;
  }, [klineVisibleCount]);
  useEffect(() => {
    const added = allCandles.length - previousKlineLength.current;
    if (added > 0 && klineOffsetValue.current > 0) {
      klineOffsetValue.current += added;
      setKlineOffset(klineOffsetValue.current);
      if (klineDragStart.current !== null) klineDragAnchor.current += added;
    }
    previousKlineLength.current = allCandles.length;
  }, [allCandles.length]);
  const candles = klineWindow(allCandles, klineOffset, klineVisibleCount);
  const candleStartIndex = candles.length
    ? allCandles.findIndex((item) => item.time === candles[0].time)
    : 0;
  const width = 900;
  const height = 330;
  const pad = 20;
  const livePrice = Number(
    market?.premium.markPrice || candles.at(-1)?.close || 0,
  );
  const low = candles.length
    ? Math.min(...candles.map((item) => item.low), livePrice || Infinity)
    : 0;
  const high = candles.length
    ? Math.max(...candles.map((item) => item.high), livePrice || -Infinity)
    : 1;
  const range = high - low || 1;
  const step = (width - pad * 2) / Math.max(candles.length, 1);
  const y = (price: number) =>
    pad + ((high - price) / range) * (height - pad * 2);
  const maValues = (period: number) =>
    candles.map((_, localIndex) => {
      const index = candleStartIndex + localIndex;
      return index < period - 1
        ? null
        : allCandles
            .slice(index - period + 1, index + 1)
            .reduce((sum, item) => sum + item.close, 0) / period;
    });
  const ma7 = maValues(7);
  const ma25 = maValues(25);
  const ma99 = maValues(99);
  const maPath = (values: Array<number | null>) =>
    values
      .map((value, index) =>
        value === null
          ? ""
          : `${values.slice(0, index).every((item) => item === null) ? "M" : "L"} ${pad + index * step + step / 2} ${y(value)}`,
      )
      .join(" ");
  const last = livePrice;
  const xAxisIndices = candles.length
    ? [
        ...new Set([
          0,
          Math.floor((candles.length - 1) / 3),
          Math.floor(((candles.length - 1) * 2) / 3),
          candles.length - 1,
        ]),
      ]
    : [];
  const axisTime = (time: number) =>
    new Date(time).toLocaleString(
      "zh-CN",
      interval === "1s"
        ? {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          }
        : ["1d", "1w", "1M"].includes(interval)
          ? { month: "2-digit", day: "2-digit" }
          : {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            },
    );
  const groupDepth = (levels: string[][], side: "ask" | "bid") => {
    const size = Number(priceGrouping);
    const grouped = new Map<number, number>();
    for (const [rawPrice, rawQuantity] of levels) {
      const quantity = Number(rawQuantity);
      if (!(quantity > 0)) continue;
      const price = Number(rawPrice);
      const bucket = Number(
        (
          (side === "ask"
            ? Math.ceil(price / size)
            : Math.floor(price / size)) * size
        ).toFixed(size < 1 ? 1 : 0),
      );
      grouped.set(bucket, (grouped.get(bucket) || 0) + quantity);
    }
    const sorted = [...grouped].sort(([left], [right]) =>
      side === "ask" ? left - right : right - left,
    );
    return sorted
      .slice(0, 6)
      .map(([price, quantity]) => [String(price), String(quantity)]);
  };
  const displayAsks = groupDepth(market?.depth.asks || [], "ask");
  const displayBids = groupDepth(market?.depth.bids || [], "bid");
  const depthMax = Math.max(
    ...displayAsks.map(([, quantity]) => Number(quantity)),
    ...displayBids.map(([, quantity]) => Number(quantity)),
    1,
  );
  const askTotal = displayAsks.reduce(
    (sum, [, quantity]) => sum + Number(quantity),
    0,
  );
  const bidTotal = displayBids.reduce(
    (sum, [, quantity]) => sum + Number(quantity),
    0,
  );
  const bidPercent =
    bidTotal + askTotal ? (bidTotal / (bidTotal + askTotal)) * 100 : 50;
  const bookPrice = (value: string | number) =>
    Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  const first = candles[0]?.open || last;
  const change = first ? ((last - first) / first) * 100 : 0;
  const selected = selectedIndex === null ? null : candles[selectedIndex];
  const axisValues = [0, 1, 2, 3, 4].map((line) => high - (line * range) / 4);
  const zoomKline = (event: React.WheelEvent<SVGSVGElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    klineWheelRemainder.current += event.deltaY / 36;
    const steps = Math.trunc(klineWheelRemainder.current);
    if (!steps) return;
    klineWheelRemainder.current -= steps;
    const current = klineVisibleCountRef.current;
    const next = Math.min(145, Math.max(9, current + steps));
    if (next === current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const anchor = Math.min(
      1,
      Math.max(0, (event.clientX - bounds.left) / bounds.width),
    );
    const oldEnd =
      allCandles.length -
      1 -
      Math.min(
        Math.max(0, allCandles.length - current),
        Math.max(0, klineOffset),
      );
    const oldStart = Math.max(0, oldEnd - current + 1);
    const anchorIndex = oldStart + anchor * Math.max(0, current - 1);
    const nextEnd = Math.round(
      anchorIndex + (1 - anchor) * Math.max(0, next - 1),
    );
    const nextOffset = Math.min(
      Math.max(0, allCandles.length - next),
      Math.max(0, allCandles.length - 1 - nextEnd),
    );
    klineVisibleCountRef.current = next;
    setKlineVisibleCount(next);
    klineOffsetValue.current = nextOffset;
    setKlineOffset(nextOffset);
    window.localStorage.setItem(
      "crypto-agent-kline-visible-points",
      String(next),
    );
  };
  const selectCandle = (event: React.MouseEvent<SVGSVGElement>) => {
    if (klineDragged.current) {
      klineDragged.current = false;
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const chartX = ((event.clientX - bounds.left) / bounds.width) * width;
    setSelectedIndex(
      Math.max(
        0,
        Math.min(
          candles.length - 1,
          Math.round((chartX - pad - step / 2) / step),
        ),
      ),
    );
  };
  const selectTimeShare = (index: number) => setSelectedIndex(index);
  const loadOlderTimeShare = () => {
    const before = allCandles[0]?.time;
    if (!before || loadingOlder.current || oldestReached.current) return;
    loadingOlder.current = true;
    void api<CoinMMarket>(
      `/${marketPath}?symbol=${marketSymbol}&interval=1m&endTime=${before - 1}`,
    )
      .then((result) => {
        const older = result.klines.filter((row) => Number(row[0]) < before);
        oldestReached.current = older.length === 0;
        if (older.length) {
          setSelectedIndex(null);
          setMarket((current) =>
            current
              ? { ...current, klines: mergeKlineRows(current.klines, older) }
              : current,
          );
        }
      })
      .catch(() => setError("历史分时数据暂时不可用"))
      .finally(() => {
        loadingOlder.current = false;
      });
  };
  const loadOlderKlines = () => {
    const before = allCandles[0]?.time;
    if (
      !before ||
      interval === "1s" ||
      interval === "time" ||
      loadingOlder.current ||
      oldestReached.current
    )
      return;
    loadingOlder.current = true;
    void api<CoinMMarket>(
      `/${marketPath}?symbol=${marketSymbol}&interval=${interval}&endTime=${before - 1}`,
    )
      .then((result) => {
        const older = result.klines.filter((row) => Number(row[0]) < before);
        oldestReached.current = older.length === 0;
        if (older.length) {
          setMarket((current) =>
            current
              ? { ...current, klines: mergeKlineRows(current.klines, older) }
              : current,
          );
        }
      })
      .catch(() => setError("历史 K 线暂时不可用"))
      .finally(() => {
        loadingOlder.current = false;
      });
  };
  useEffect(() => {
    const down = (event: PointerEvent) => {
      if (
        !(event.target as Element).closest?.(
          'svg[aria-label="BTCUSD coin-m candlestick chart"]',
        )
      )
        return;
      klineDragStart.current = event.clientX;
      klineDragAnchor.current = klineOffsetValue.current;
      klineDragged.current = false;
    };
    const move = (event: PointerEvent) => {
      if (klineDragStart.current === null) return;
      klinePointerX.current = event.clientX;
      if (klineDragFrame.current !== null) return;
      klineDragFrame.current = window.requestAnimationFrame(() => {
        klineDragFrame.current = null;
        if (klineDragStart.current === null || klinePointerX.current === null)
          return;
        const delta = klinePointerX.current - klineDragStart.current;
        if (Math.abs(delta) > 3) {
          klineDragged.current = true;
          setSelectedIndex(null);
        }
        const maximum = Math.max(
          0,
          allCandles.length - klineVisibleCountRef.current,
        );
        const nextOffset = Math.max(
          0,
          Math.min(
            maximum,
            klineDragAnchor.current + Math.round(delta / Math.max(step, 1)),
          ),
        );
        klineOffsetValue.current = nextOffset;
        setKlineOffset(nextOffset);
        if (nextOffset >= maximum && allCandles.length) loadOlderKlines();
      });
    };
    const up = () => {
      if (klineDragFrame.current !== null)
        window.cancelAnimationFrame(klineDragFrame.current);
      klineDragFrame.current = null;
      klinePointerX.current = null;
      klineDragStart.current = null;
    };
    document.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      document.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [interval, marketType, allCandles.length, step]);
  const contextDepth = (levels: string[][]) =>
    levels
      .slice(0, 20)
      .reduce((sum, [, quantity]) => sum + Number(quantity), 0);
  const publishMarketContext = (
    visible: CoinMCandle[],
    displayInterval = interval,
  ) => {
    const bids = market?.depth.bids || [];
    const asks = market?.depth.asks || [];
    const bid = Number(bids[0]?.[0] || 0);
    const ask = Number(asks[0]?.[0] || 0);
    const mid = bid && ask ? (bid + ask) / 2 : last;
    onMarketContext({
      symbol: marketSymbol,
      interval: displayInterval,
      candles: visible,
      markPrice: last,
      fundingRate: Number(market?.premium.lastFundingRate || 0),
      depth:
        bid && ask
          ? {
              bidDepth: contextDepth(bids),
              askDepth: contextDepth(asks),
              imbalance:
                (contextDepth(bids) - contextDepth(asks)) /
                Math.max(contextDepth(bids) + contextDepth(asks), 1),
              spreadBps: ((ask - bid) / mid) * 10_000,
            }
          : null,
      orderBook24h: market?.orderBook24h,
    });
  };
  const topBid = market?.depth.bids[0]?.join(":") || "";
  const topAsk = market?.depth.asks[0]?.join(":") || "";
  useEffect(() => {
    const visible = interval === "time" ? timeVisibleCandles.current : candles;
    if (visible.length)
      publishMarketContext(visible, interval === "time" ? "1m" : interval);
  }, [
    interval,
    candles.length,
    last,
    market?.premium.lastFundingRate,
    topBid,
    topAsk,
    market?.orderBook24h?.endTime,
  ]);
  if (historyOpen)
    return (
      <ContractHistory
        marketType={marketType}
        onBack={() => setHistoryOpen(false)}
      />
    );
  const quoteAsset = marketType === "usdm" ? "USDT" : "USD";
  const quantityAsset = marketType === "usdm" ? "BTC" : "张";
  return (
    <div className={`coinm-page${interval === "time" ? " time-mode" : ""}`}>
      <div className="coinm-products">
        <button
          className={marketType === "usdm" ? "active" : ""}
          onClick={() => {
            setMarketType("usdm");
            setMarket(null);
            setSelectedIndex(null);
          }}
        >
          U本位
        </button>
        <button
          className={marketType === "coinm" ? "active" : ""}
          onClick={() => {
            setMarketType("coinm");
            setMarket(null);
            setSelectedIndex(null);
          }}
        >
          币本位
        </button>
        <button>期权</button>
        <button>涨跌</button>
        <button>聪明钱</button>
      </div>
      <div className="coinm-heading">
        <div>
          <strong>{marketType === "usdm" ? "BTCUSDT" : "BTCUSD CM"}</strong>
          <span>永续</span>
          <b className={change >= 0 ? "positive" : "negative"}>
            {change >= 0 ? "+" : ""}
            {change.toFixed(2)}%
          </b>
        </div>
        <div className="contract-heading-actions">
          <small>
            资金费率{" "}
            {(Number(market?.premium.lastFundingRate || 0) * 100).toFixed(6)}%
          </small>
          <div className="contract-more">
            <button
              title="更多"
              aria-label="更多"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreHorizontal size={20} />
            </button>
            {menuOpen && (
              <div className="contract-more-menu">
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setHistoryOpen(true);
                  }}
                >
                  <History size={17} />
                  <span>历史记录</span>
                  <ChevronRight size={15} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="coinm-trade-grid">
        <section className="coinm-order">
          <div className="coinm-order-tabs">
            <button className="active">开仓</button>
            <button>平仓</button>
          </div>
          <div className="coinm-order-options">
            <button>全仓</button>
            <button>20x</button>
          </div>
          <button className="coinm-select">市价单</button>
          <label>
            数量 <span>{quantityAsset}</span>
            <input inputMode="decimal" placeholder="0" />
          </label>
          <div className="coinm-order-buttons">
            <button disabled>开多 · 看涨</button>
            <button disabled>开空 · 看跌</button>
          </div>
        </section>
        <section className="coinm-book">
          <header>
            <span>价格 ({quoteAsset})</span>
            <span>数量 ({quantityAsset})</span>
          </header>
          {displayAsks
            .slice(0, 6)
            .reverse()
            .map(([price, quantity]) => (
              <div className="ask" key={price}>
                <i
                  style={{
                    width: `${Math.min(100, (Number(quantity) / depthMax) * 100)}%`,
                  }}
                />
                <span>{bookPrice(price)}</span>
                <span>{Number(quantity).toLocaleString()}</span>
              </div>
            ))}
          <strong
            className={
              tickDirection === "up"
                ? "tick-up"
                : tickDirection === "down"
                  ? "tick-down"
                  : ""
            }
          >
            {bookPrice(last)}
          </strong>
          {displayBids.slice(0, 6).map(([price, quantity]) => (
            <div className="bid" key={price}>
              <i
                style={{
                  width: `${Math.min(100, (Number(quantity) / depthMax) * 100)}%`,
                }}
              />
              <span>{bookPrice(price)}</span>
              <span>{Number(quantity).toLocaleString()}</span>
            </div>
          ))}
          <div className="depth-ratio">
            <span>{bidPercent.toFixed(2)}%</span>
            <i>
              <b style={{ width: `${bidPercent}%` }} />
            </i>
            <span>{(100 - bidPercent).toFixed(2)}%</span>
          </div>
          <label className="depth-grouping">
            <select
              value={priceGrouping}
              onChange={(event) => setPriceGrouping(event.target.value)}
            >
              {["0.1", "1", "10", "50", "100", "1000"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </section>
      </div>
      <div className="coinm-position-tabs">
        <b>持有仓位 (0)</b>
        <span>当前委托 (0)</span>
        <span>交易机器人</span>
      </div>
      <div className="coinm-intervals coinm-full-intervals">
        {[
          ["time", "分时"],
          ["1s", "1秒"],
          ["1m", "1分"],
          ["3m", "3分"],
          ["5m", "5分"],
          ["15m", "15分"],
          ["30m", "30分"],
          ["1h", "1小时"],
          ["2h", "2小时"],
          ["4h", "4小时"],
          ["6h", "6小时"],
          ["8h", "8小时"],
          ["12h", "12小时"],
          ["1d", "1天"],
          ["1w", "1周"],
          ["1M", "1月"],
        ].map(([id, label]) => (
          <button
            className={interval === id ? "active" : ""}
            key={id}
            onClick={() => {
              setInterval(id);
              setSelectedIndex(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {interval === "time" && (
        <TimeShareChart
          candles={allCandles}
          selectedIndex={selectedIndex}
          onSelect={selectTimeShare}
          onLoadOlder={loadOlderTimeShare}
          onVisibleChange={(visible) => {
            timeVisibleCandles.current = visible;
            publishMarketContext(visible, "1m");
          }}
          last={last}
        />
      )}
      <section className="coinm-chart">
        <div className="coinm-intervals">
          {[
            ["1s", "1秒"],
            ["1m", "1分"],
            ["3m", "3分"],
            ["5m", "5分"],
            ["15m", "15分"],
            ["30m", "30分"],
            ["1h", "1小时"],
          ].map(([id, label]) => (
            <button
              className={interval === id ? "active" : ""}
              key={id}
              onClick={() => {
                setInterval(id);
                setSelectedIndex(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="coinm-ma-legend">
          <span>
            MA(7):{" "}
            {ma7
              .at(-1)
              ?.toLocaleString(undefined, { maximumFractionDigits: 1 }) || "-"}
          </span>
          <span>
            MA(25):{" "}
            {ma25
              .at(-1)
              ?.toLocaleString(undefined, { maximumFractionDigits: 1 }) || "-"}
          </span>
          <span>
            MA(99):{" "}
            {ma99
              .at(-1)
              ?.toLocaleString(undefined, { maximumFractionDigits: 1 }) || "-"}
          </span>
        </div>
        {candles.length ? (
          <div className="coinm-chart-canvas">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              role="img"
              aria-label="BTCUSD coin-m candlestick chart"
              onClick={selectCandle}
              onWheel={zoomKline}
            >
              <g className="chart-grid">
                {[0, 1, 2, 3, 4].map((line) => (
                  <line
                    key={line}
                    x1={pad}
                    x2={width - pad}
                    y1={pad + (line * (height - pad * 2)) / 4}
                    y2={pad + (line * (height - pad * 2)) / 4}
                  />
                ))}
                {xAxisIndices.map((index) => (
                  <line
                    className="kline-date-guide"
                    key={`time-${index}`}
                    x1={pad + index * step + step / 2}
                    x2={pad + index * step + step / 2}
                    y1={pad}
                    y2={height - pad}
                  />
                ))}
              </g>
              {candles.map((item, index) => {
                const x = pad + index * step + step / 2;
                const rising = item.close >= item.open;
                return (
                  <g
                    className={rising ? "candle-up" : "candle-down"}
                    key={item.time}
                  >
                    <line x1={x} x2={x} y1={y(item.high)} y2={y(item.low)} />
                    <rect
                      x={x - Math.max(1, step * 0.28)}
                      y={Math.min(y(item.open), y(item.close))}
                      width={Math.max(2, step * 0.56)}
                      height={Math.max(
                        1,
                        Math.abs(y(item.open) - y(item.close)),
                      )}
                    />
                  </g>
                );
              })}
              <path className="ma ma7" d={maPath(ma7)} />
              <path className="ma ma25" d={maPath(ma25)} />
              <path className="ma ma99" d={maPath(ma99)} />
              {last > 0 && (
                <line
                  className="current-price-guide"
                  x1={pad}
                  x2={width - pad}
                  y1={y(last)}
                  y2={y(last)}
                />
              )}
              {selected && (
                <g className="chart-crosshair">
                  <line
                    x1={pad + selectedIndex! * step + step / 2}
                    x2={pad + selectedIndex! * step + step / 2}
                    y1={pad}
                    y2={height - pad}
                  />
                  <line
                    x1={pad}
                    x2={width - pad}
                    y1={y(selected.close)}
                    y2={y(selected.close)}
                  />
                  <circle
                    cx={pad + selectedIndex! * step + step / 2}
                    cy={y(selected.close)}
                    r="4"
                  />
                </g>
              )}
            </svg>
            <div className="coinm-axis">
              {axisValues.map((value, index) => (
                <span key={index} style={{ top: `${index * 25}%` }}>
                  {value.toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })}
                </span>
              ))}
            </div>
            {last > 0 && (
              <div
                className="current-price-overlay"
                style={{ top: `${(y(last) / height) * 100}%` }}
              >
                {bookPrice(last)}
              </div>
            )}
            <div className="kline-x-axis">
              {xAxisIndices.map((index) => (
                <span
                  key={candles[index].time}
                  style={{
                    left: `${((pad + index * step + step / 2) / width) * 100}%`,
                  }}
                >
                  {axisTime(candles[index].time)}
                </span>
              ))}
            </div>
            {selected && (
              <div className="coinm-tooltip">
                <b>
                  {new Date(selected.time).toLocaleString("zh-CN", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: interval === "1s" ? "2-digit" : undefined,
                  })}
                </b>
                <span>
                  开 <em>{selected.open.toLocaleString()}</em>
                </span>
                <span>
                  高 <em>{selected.high.toLocaleString()}</em>
                </span>
                <span>
                  低 <em>{selected.low.toLocaleString()}</em>
                </span>
                <span>
                  收 <em>{selected.close.toLocaleString()}</em>
                </span>
                <span>
                  涨跌{" "}
                  <em
                    className={
                      selected.close >= selected.open ? "positive" : "negative"
                    }
                  >
                    {(selected.close - selected.open).toFixed(1)}
                  </em>
                </span>
                <span>
                  涨跌幅{" "}
                  <em>
                    {(
                      ((selected.close - selected.open) / selected.open) *
                      100
                    ).toFixed(2)}
                    %
                  </em>
                </span>
                <span>
                  振幅{" "}
                  <em>
                    {(
                      ((selected.high - selected.low) / selected.open) *
                      100
                    ).toFixed(2)}
                    %
                  </em>
                </span>
                <span>
                  量 <em>{selected.volume.toLocaleString()}</em>
                </span>
                <span>
                  额 <em>{selected.quoteVolume.toLocaleString()}</em>
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="chart-empty">
            {error ||
              (interval === "1s" ? "正在聚合 1 秒 K 线…" : "正在读取 K 线…")}
          </div>
        )}
      </section>
    </div>
  );
}

function CoinIcon({ asset }: { asset: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="asset-symbol">
      {asset === "USDT" ? "₮" : asset.slice(0, 1)}
    </span>
  ) : (
    <img
      className="asset-symbol asset-icon-image"
      src={`https://bin.bnbstatic.com/static/assets/logos/${asset.toLowerCase()}.png`}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

function AssetWorkspace({
  onMarketContext,
}: {
  onMarketContext: (context: MarketContext) => void;
}) {
  const [bottomTab, setBottomTab] = useState("assets");
  const [assetTab, setAssetTab] = useState<AssetTab>("overview");
  const [overviewTab, setOverviewTab] = useState<"all" | "accounts">("all");
  const [earnView, setEarnView] = useState<"assets" | "products">("assets");
  const [spotView, setSpotView] = useState<"spot" | "cross" | "isolated">(
    "spot",
  );
  const [data, setData] = useState<AssetSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [hidden, setHidden] = useState(false);
  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      setData(await api<AssetSnapshot>("/assets"));
    } catch (caught) {
      setLoadError(
        caught instanceof Error ? caught.message : "无法读取 Binance 资产",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const spot = data?.spot?.balances || [];
  const funding = data?.funding || [];
  const earn = data?.earn?.rows || [];
  const futuresAssets =
    data?.futures?.assets?.filter(
      (item) => Number(item.walletBalance) || Number(item.unrealizedProfit),
    ) || [];
  const assetTotals = aggregateAssetBalances({
    spot,
    funding,
    earn,
    futures: futuresAssets,
    prices: data?.prices,
  });
  const accountValues = {
    earn: assetTotals.reduce((sum, item) => sum + item.earn * item.price, 0),
    spot: assetTotals.reduce((sum, item) => sum + item.spot * item.price, 0),
    funding: assetTotals.reduce(
      (sum, item) => sum + item.funding * item.price,
      0,
    ),
    futures: assetTotals.reduce(
      (sum, item) => sum + item.futures * item.price,
      0,
    ),
  };
  const estimatedTotal = assetTotals.reduce(
    (sum, item) => sum + item.estimatedUsdt,
    0,
  );
  const cnyTotal = estimatedTotal * 6.74;
  const amount = (value: number | string | undefined) =>
    hidden ? "••••••" : formatNumber(value || 0);
  const summaryAmount = (value: number | string | undefined) =>
    hidden
      ? "••••••"
      : formatNumber(Math.floor(Number(value || 0) * 100) / 100);
  const earnRows =
    earnView === "assets"
      ? Object.entries(
          earn.reduce<Record<string, number>>((result, item) => {
            result[item.asset] =
              (result[item.asset] || 0) +
              Number(item.totalAmount || item.holdingAmount || 0);
            return result;
          }, {}),
        ).map(([asset, primary]) => ({
          asset,
          primary,
          secondary: "按资产汇总",
        }))
      : earn.map((item) => ({
          asset: item.productName || item.productId || item.asset,
          primary: item.totalAmount || item.holdingAmount || "0",
          secondary: `${item.asset} · 累计收益 ${amount(item.cumulativeTotalRewards)} · APR ${item.latestAnnualPercentageRate || "-"}`,
        }));
  const rows =
    assetTab === "spot"
      ? spotView === "spot"
        ? spot
            .filter((item) => !item.asset.startsWith("LD"))
            .map((item) => ({
              asset: item.asset,
              primary: Number(item.free) + Number(item.locked),
              secondary: `可用 ${amount(item.free)} · 冻结 ${amount(item.locked)}`,
            }))
        : []
      : assetTab === "funding"
        ? funding.map((item) => ({
            asset: item.asset,
            primary: Number(item.free) + Number(item.locked || 0),
            secondary: `可用 ${amount(item.free)} · 冻结 ${amount(item.locked)}`,
          }))
        : assetTab === "earn"
          ? earnRows
          : futuresAssets.map((item) => ({
              asset: item.asset,
              primary: item.walletBalance,
              secondary: `可用 ${amount(item.availableBalance)} · 未实现盈亏 ${amount(item.unrealizedProfit)}`,
            }));
  const tabs: Array<[AssetTab, string]> = [
    ["overview", "总览"],
    ["earn", "理财"],
    ["spot", "现货"],
    ["funding", "资金"],
    ["futures", "合约"],
  ];
  const nav = [
    [Home, "首页", "home"],
    [LineChart, "行情", "markets"],
    [ArrowLeftRight, "交易", "trade"],
    [FileText, "合约", "contracts"],
    [WalletCards, "资产", "assets"],
  ] as const;
  const accountRows = [
    ["理财", accountValues.earn],
    ["现货", accountValues.spot],
    ["资金", accountValues.funding],
    ["合约", accountValues.futures],
  ] as const;
  const assetName = (asset: string) => (asset === "USDT" ? "TetherUS" : asset);
  const visibleErrors =
    data?.errors.filter((item) => !item.startsWith("futures:")) || [];
  const totalValue =
    assetTab === "overview"
      ? estimatedTotal
      : assetTab === "futures"
        ? accountValues.futures
        : assetTab === "earn"
          ? accountValues.earn
          : assetTab === "spot"
            ? accountValues.spot
            : accountValues.funding;
  return (
    <section className="asset-app">
      <div className="asset-content">
        {bottomTab === "assets" ? (
          <>
            <div className="asset-tabs" role="tablist">
              {tabs.map(([id, label]) => (
                <button
                  className={assetTab === id ? "active" : ""}
                  key={id}
                  onClick={() => setAssetTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {assetTab === "spot" && (
              <div className="asset-subtabs" role="tablist">
                {(
                  [
                    ["spot", "现货账户"],
                    ["cross", "杠杆账户（全仓）"],
                    ["isolated", "杠杆账户（逐仓）"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    className={spotView === id ? "active" : ""}
                    key={id}
                    onClick={() => setSpotView(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="asset-summary">
              <div>
                <span>
                  {assetTab === "overview"
                    ? "预估总资产"
                    : `${tabs.find(([id]) => id === assetTab)?.[1]}资产`}
                </span>
                <button
                  title={hidden ? "显示余额" : "隐藏余额"}
                  aria-label={hidden ? "显示余额" : "隐藏余额"}
                  onClick={() => setHidden((value) => !value)}
                >
                  <Eye size={15} />
                </button>
              </div>
              <strong>
                {amount(totalValue)} <small>USDT</small>
              </strong>
              {assetTab === "overview" && (
                <div className="asset-cny">≈ ¥{amount(cnyTotal)}</div>
              )}
              <div className="asset-actions">
                <button disabled title="资金操作尚未启用">
                  添加资金
                </button>
                <button disabled title="资金操作尚未启用">
                  转出
                </button>
                <button disabled title="资金操作尚未启用">
                  划转
                </button>
              </div>
            </div>
            {assetTab === "overview" ? (
              <div className="wallet-overview">
                <div className="overview-tabs" role="tablist">
                  <button
                    className={overviewTab === "all" ? "active" : ""}
                    onClick={() => setOverviewTab("all")}
                  >
                    全部
                  </button>
                  <button
                    className={overviewTab === "accounts" ? "active" : ""}
                    onClick={() => setOverviewTab("accounts")}
                  >
                    账户
                  </button>
                  <button
                    className="overview-refresh"
                    title="刷新资产"
                    aria-label="刷新资产"
                    onClick={() => void load()}
                  >
                    <RefreshCw className={loading ? "spin" : ""} size={15} />
                  </button>
                </div>
                {overviewTab === "all"
                  ? assetTotals.map((item) => (
                      <div className="asset-row" key={item.asset}>
                        <div>
                          <CoinIcon asset={item.asset} />
                          <span>
                            <strong>{item.asset}</strong>
                            <small>
                              {item.asset === "USDT"
                                ? "TetherUS"
                                : `≈ ${amount(item.estimatedUsdt)} USDT`}
                            </small>
                          </span>
                        </div>
                        <b>{amount(item.total)}</b>
                      </div>
                    ))
                  : accountRows.map(([label, value]) => (
                      <div className="account-row" key={label}>
                        <strong>{label}</strong>
                        <b>{amount(value)} USDT</b>
                      </div>
                    ))}
              </div>
            ) : (
              <div className="asset-list">
                <div className="asset-list-heading">
                  <strong>
                    {tabs.find(([id]) => id === assetTab)?.[1]}资产
                  </strong>
                  {assetTab === "earn" ? (
                    <div className="inline-tabs">
                      <button
                        className={earnView === "assets" ? "active" : ""}
                        onClick={() => setEarnView("assets")}
                      >
                        按资产
                      </button>
                      <button
                        className={earnView === "products" ? "active" : ""}
                        onClick={() => setEarnView("products")}
                      >
                        按产品
                      </button>
                    </div>
                  ) : (
                    <Search size={17} />
                  )}
                </div>
                {rows.length ? (
                  rows.map((item) => (
                    <div className="asset-row" key={item.asset}>
                      <div>
                        <CoinIcon asset={item.asset} />
                        <span>
                          <strong>{item.asset}</strong>
                          <small>
                            {item.secondary || assetName(item.asset)}
                          </small>
                        </span>
                      </div>
                      <b>{amount(item.primary)}</b>
                    </div>
                  ))
                ) : (
                  <p className="asset-empty">
                    {loading
                      ? "正在读取 Binance 账户…"
                      : data?.errors.find((item) =>
                          item.startsWith(assetTab),
                        ) || "该账户暂无非零资产"}
                  </p>
                )}
              </div>
            )}
            {visibleErrors.length ? (
              <details className="asset-errors">
                <summary>部分账户不可用</summary>
                {visibleErrors.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </details>
            ) : null}
          </>
        ) : bottomTab === "contracts" ? (
          <CoinMWorkspace onMarketContext={onMarketContext} />
        ) : (
          <div className="asset-placeholder">
            <strong>{nav.find(([, , id]) => id === bottomTab)?.[1]}</strong>
            <span>此导航将在后续视图中实现</span>
          </div>
        )}
        {loadError && <p className="asset-load-error">{loadError}</p>}
      </div>
      <nav
        className="asset-bottom-nav"
        aria-label="Binance workspace navigation"
      >
        {nav.map(([Icon, label, id]) => (
          <button
            className={bottomTab === id ? "active" : ""}
            key={id}
            onClick={() => setBottomTab(id)}
          >
            <Icon size={19} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </section>
  );
}

export function App() {
  if (new URLSearchParams(window.location.search).get("widget") === "1")
    return (
      <main className="widget-shell">
        <PriceChart symbol="BTCUSDT" environment="live" />
      </main>
    );
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = window.localStorage.getItem("crypto-agent-theme");
    return saved === "light" || saved === "dark" || saved === "system"
      ? saved
      : "system";
  });
  const [modelId, setModelId] = useState<ModelId>("gpt-5.6-luna");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningId>("medium");
  const [modelOpen, setModelOpen] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      return JSON.parse(
        window.localStorage.getItem("crypto-agent-recents") || "[]",
      ) as ChatSession[];
    } catch {
      return [];
    }
  });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<ImageAttachment | null>(null);
  const marketContext = useRef<MarketContext | null>(null);
  useLayoutEffect(() => {
    const textarea =
      document.querySelector<HTMLTextAreaElement>(".composer textarea");
    if (!textarea) return;
    textarea.style.height = "auto";
    const height = Math.min(textarea.scrollHeight, 144);
    textarea.style.height = `${height}px`;
    textarea.style.overflowY = textarea.scrollHeight > 144 ? "auto" : "hidden";
  }, [input]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const newsCursor = useRef<string | null>(null);
  const [newsHasMore, setNewsHasMore] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(() =>
    Math.min(
      window.innerWidth * 0.2,
      Math.max(
        LEFT_SIDEBAR_MIN,
        Number(window.localStorage.getItem("crypto-agent-left-width")) ||
          window.innerWidth * 0.14,
      ),
    ),
  );
  const [rightWidth, setRightWidth] = useState(() =>
    Math.min(
      window.innerWidth * 0.6,
      Math.max(
        window.innerWidth * 0.3,
        Number(window.localStorage.getItem("crypto-agent-right-width")) ||
          window.innerWidth * 0.36,
      ),
    ),
  );
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [resizing, setResizing] = useState<"left" | "right" | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const dragValue = useRef<number | null>(null);
  const dragFrame = useRef<number | null>(null);

  async function refresh() {
    try {
      const next = await api<Status>("/status");
      setStatus(next);
      if (next.model) {
        setModelId((current) =>
          next.model?.models.includes(current)
            ? current
            : next.model!.defaultModel,
        );
        setReasoningEffort((current) =>
          next.model?.reasoning.includes(current)
            ? current
            : next.model!.defaultReasoning,
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to connect.");
    }
  }
  async function refreshNews() {
    if (newsLoading) return;
    setNewsLoading(true);
    try {
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
      const result = await api<{
        items: NewsItem[];
        nextCursor: string | null;
      }>("/news?limit=30");
      setNews((current) => [
        ...result.items,
        ...current.filter(
          (item) => !result.items.some((next) => next.id === item.id),
        ),
      ]);
      newsCursor.current = result.nextCursor;
      setNewsHasMore(Boolean(result.nextCursor));
    } catch {
      /* The next pull can retry the refresh. */
    } finally {
      setNewsLoading(false);
    }
  }
  async function loadMoreNews() {
    if (newsLoading || !newsCursor.current) return;
    setNewsLoading(true);
    try {
      const result = await api<{
        items: NewsItem[];
        nextCursor: string | null;
      }>(`/news?limit=30&before=${encodeURIComponent(newsCursor.current)}`);
      setNews((current) => [
        ...current,
        ...result.items.filter(
          (item) => !current.some((existing) => existing.id === item.id),
        ),
      ]);
      newsCursor.current = result.nextCursor;
      setNewsHasMore(Boolean(result.nextCursor));
    } catch {
      /* The next scroll can retry the page. */
    } finally {
      setNewsLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    let active = true;
    const notify = (title: string, body: string) => {
      if (window.cryptoAgent) window.cryptoAgent.notify(title, body);
      else if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      )
        new Notification(title, { body });
    };
    void api<{ items: NewsItem[]; nextCursor: string | null }>(
      "/news?mode=startup&limit=30",
    )
      .then((result) => {
        if (!active) return;
        setNews(result.items);
        newsCursor.current = result.nextCursor;
        setNewsHasMore(Boolean(result.nextCursor));
        if (result.items.length)
          notify(
            "CryptoAgent 今日新闻",
            `${result.items.length} 条重要新闻已准备好`,
          );
      })
      .catch(() => {});
    const stream = new EventSource("/api/news/stream");
    const add = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as {
        item?: NewsItem;
        items?: NewsItem[];
      };
      const incoming = payload.item ? [payload.item] : payload.items || [];
      if (!incoming.length) return;
      setNews((current) => [
        ...incoming,
        ...current.filter(
          (item) => !incoming.some((next) => next.id === item.id),
        ),
      ]);
    };
    stream.addEventListener("item", add);
    stream.addEventListener("breaking", add);
    stream.addEventListener("digest", (event) => {
      add(event);
      const payload = JSON.parse(event.data) as { items?: NewsItem[] };
      if (payload.items?.length)
        notify("CryptoAgent 两小时新闻", `${payload.items.length} 条新新闻`);
    });
    stream.addEventListener("ready", add);
    stream.addEventListener("emergency", (event) => {
      const next = JSON.parse(event.data) as EmergencyState;
      notify(
        "CryptoAgent 紧急授权待确认",
        next.pending?.title || "检测到爆炸性新闻",
      );
    });
    const onBreaking = (event: MessageEvent<string>) => {
      const item = (JSON.parse(event.data) as { item: NewsItem }).item;
      notify("CryptoAgent 爆炸性新闻", item.title);
    };
    stream.addEventListener("breaking", onBreaking);
    const latestTimer = window.setInterval(() => {
      void api<{ items: NewsItem[]; nextCursor: string | null }>(
        "/news?limit=30",
      )
        .then((result) => {
          if (!active || !result.items.length) return;
          setNews((current) => [
            ...result.items,
            ...current.filter(
              (item) => !result.items.some((next) => next.id === item.id),
            ),
          ]);
        })
        .catch(() => {});
    }, 15_000);
    if (
      !window.cryptoAgent &&
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    )
      void Notification.requestPermission().catch(() => {});
    return () => {
      active = false;
      window.clearInterval(latestTimer);
      stream.close();
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("crypto-agent-theme", theme);
  }, [theme]);
  useEffect(() => {
    window.localStorage.setItem("crypto-agent-left-width", String(leftWidth));
  }, [leftWidth]);
  useEffect(() => {
    window.localStorage.setItem("crypto-agent-right-width", String(rightWidth));
  }, [rightWidth]);
  useEffect(() => {
    if (!modelOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!modelPickerRef.current?.contains(event.target as Node))
        setModelOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [modelOpen]);
  useEffect(() => {
    if (!resizing) return;
    const move = (event: PointerEvent) => {
      dragValue.current =
        resizing === "left"
          ? Math.min(
              window.innerWidth * 0.2,
              Math.max(LEFT_SIDEBAR_MIN, event.clientX),
            )
          : Math.min(
              window.innerWidth * 0.6,
              Math.max(
                window.innerWidth * 0.3,
                window.innerWidth - event.clientX,
              ),
            );
      if (dragFrame.current !== null) return;
      dragFrame.current = window.requestAnimationFrame(() => {
        if (dragValue.current !== null)
          shellRef.current?.style.setProperty(
            resizing === "left" ? "--left-width" : "--right-width",
            `${dragValue.current}px`,
          );
        dragFrame.current = null;
      });
    };
    const stop = () => {
      if (dragFrame.current !== null) {
        window.cancelAnimationFrame(dragFrame.current);
        dragFrame.current = null;
      }
      const value = dragValue.current;
      if (value !== null) {
        if (resizing === "left") setLeftWidth(value);
        else setRightWidth(value);
      }
      dragValue.current = null;
      setResizing(null);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, [resizing]);
  useEffect(() => {
    const safeSessions = sessions
      .slice(0, 20)
      .map((session) => ({
        ...session,
        messages: session.messages.map(({ id, role, content, product }) => ({
          id,
          role,
          content,
          product,
        })),
      }));
    window.localStorage.setItem(
      "crypto-agent-recents",
      JSON.stringify(safeSessions),
    );
  }, [sessions]);

  function newChat() {
    setActiveSessionId(null);
    setMessages([]);
    setInput("");
    setAttachment(null);
    setError("");
  }
  function openSession(session: ChatSession) {
    setActiveSessionId(session.id);
    setMessages(session.messages);
    setInput("");
    setAttachment(null);
    setError("");
  }

  async function send() {
    const content = input.trim() || (attachment ? "请分析这张图片。" : "");
    if (!content || busy) return;
    const sentAttachment = attachment;
    const user: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      ...(sentAttachment ? { attachment: sentAttachment } : {}),
    };
    const sessionId = activeSessionId || crypto.randomUUID();
    const title = content.length > 32 ? `${content.slice(0, 32)}...` : content;
    const baseMessages = [...messages, user];
    setActiveSessionId(sessionId);
    setMessages(baseMessages);
    setInput("");
    setAttachment(null);
    setBusy(true);
    setError("");
    try {
      const history = messages
        .slice(-12)
        .map(({ role, content }) => ({ role, content }));
      const result = await api<{
        reply: string;
        product?: Message["product"];
        draft?: Draft;
      }>("/chat", {
        method: "POST",
        body: JSON.stringify({
          message: content,
          model: modelId,
          reasoning_effort: reasoningEffort,
          history,
          marketContext: marketContext.current,
          ...(sentAttachment ? { image: sentAttachment.dataUrl } : {}),
        }),
      });
      const assistant: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        product: result.product,
        draft: result.draft,
      };
      setMessages((current) => [...current, assistant]);
      for (const chunk of result.reply.match(/.{1,4}/gs) || []) {
        await new Promise((resolve) => window.setTimeout(resolve, 12));
        setMessages((current) =>
          current.map((message) =>
            message.id === assistant.id
              ? { ...message, content: message.content + chunk }
              : message,
          ),
        );
      }
      const nextMessages = [
        ...baseMessages,
        { ...assistant, content: result.reply },
      ];
      setMessages(nextMessages);
      setSessions((existing) => [
        {
          id: sessionId,
          title: existing.find((item) => item.id === sessionId)?.title || title,
          messages: nextMessages,
          updatedAt: Date.now(),
        },
        ...existing.filter((item) => item.id !== sessionId),
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to prepare the order.",
      );
    } finally {
      setBusy(false);
    }
  }

  const shellStyle = {
    "--left-width": leftCollapsed ? "0px" : `${leftWidth}px`,
    "--right-width": rightCollapsed ? "0px" : `${rightWidth}px`,
  } as CSSProperties;
  return (
    <main
      ref={shellRef}
      className={`terminal-shell ${leftCollapsed ? "left-collapsed" : ""} ${rightCollapsed ? "right-collapsed" : ""} ${resizing ? "is-resizing" : ""}`}
      style={shellStyle}
    >
      <aside className="portfolio">
        <header>
          <CircleDollarSign size={23} />
          <div>
            <strong>CryptoAgent</strong>
          </div>
          <button
            className="sidebar-toggle left-panel-toggle"
            title="隐藏左侧栏"
            aria-label="隐藏左侧栏"
            onClick={() => setLeftCollapsed(true)}
          >
            <PanelLeftClose size={17} />
          </button>
        </header>
        <button className="new-chat" onClick={newChat}>
          <Plus size={17} />
          New chat
        </button>
        <div className="sidebar-lists">
          <nav className="recents" aria-label="最近对话">
            <div className="section-title">
              <span>Recents</span>
            </div>
            <div className="recents-list">
              {sessions.length ? (
                sessions.map((session) => (
                  <button
                    className={activeSessionId === session.id ? "active" : ""}
                    key={session.id}
                    onClick={() => openSession(session)}
                  >
                    <MessageSquare size={14} />
                    <span>{session.title}</span>
                  </button>
                ))
              ) : (
                <p>暂无最近对话</p>
              )}
            </div>
          </nav>
          <NewsPanel
            items={news}
            onRefresh={() => void refreshNews()}
            onLoadMore={() => void loadMoreNews()}
            loading={newsLoading}
            hasMore={newsHasMore}
          />
        </div>
        <button
          className="settings-entry"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 size={16} />
          设置与外观
        </button>
        <button
          className="resize-handle left-resize"
          title="调整左侧栏宽度"
          aria-label="调整左侧栏宽度"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setResizing("left");
          }}
        />
      </aside>
      {leftCollapsed && (
        <button
          className="sidebar-reopen left-reopen"
          title="显示左侧栏"
          aria-label="显示左侧栏"
          onClick={() => setLeftCollapsed(false)}
        >
          <PanelLeftOpen size={18} />
        </button>
      )}
      <section className="conversation">
        <div className="conversation-top">
          <div>
            <Bot size={18} />
            <strong>
              {activeSessionId
                ? sessions.find((item) => item.id === activeSessionId)?.title ||
                  "交易对话"
                : "新对话"}
            </strong>
          </div>
          <div className="top-actions">
            <span>{status?.environment === "live" ? "LIVE" : "TESTNET"}</span>
          </div>
        </div>
        <div className="messages">
          {!messages.length && (
            <div className="empty">
              <Bot size={32} />
              <h1>{recentNewsWelcome(news)}</h1>
            </div>
          )}
          {messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <div className="bubble">
                {message.attachment && (
                  <img
                    className="message-attachment"
                    src={message.attachment.dataUrl}
                    alt={message.attachment.name}
                  />
                )}
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
                {message.draft && (
                  <OrderDraft
                    draft={message.draft}
                    product={message.product}
                    onConfirmed={(order) => {
                      setMessages((current) =>
                        current.map((item) =>
                          item.id === message.id ? { ...item, order } : item,
                        ),
                      );
                      void refresh();
                    }}
                  />
                )}
                {message.order && (
                  <div className="order-success">
                    <Check size={16} />
                    订单已提交 · ID{" "}
                    {String(
                      message.order.orderId ||
                        message.order.clientOrderId ||
                        "accepted",
                    )}
                  </div>
                )}
              </div>
            </article>
          ))}
          {busy && (
            <article className="message assistant">
              <div className="bubble thinking">
                <i />
                <i />
                <i />
              </div>
            </article>
          )}
          {error && <div className="global-error">{error}</div>}
        </div>
        <div className="composer-wrap">
          <div className="composer">
            <div className="composer-input">
              {attachment && (
                <div className="composer-attachment">
                  <img src={attachment.dataUrl} alt={attachment.name} />
                  <span>{attachment.name}</span>
                  <button
                    title="移除图片"
                    aria-label="移除图片"
                    onClick={() => setAttachment(null)}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
              <textarea
                rows={1}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onPaste={(event) => {
                  const file = [...event.clipboardData.items]
                    .find((item) => item.type.startsWith("image/"))
                    ?.getAsFile();
                  if (!file) return;
                  event.preventDefault();
                  void readImageAttachment(file)
                    .then(setAttachment)
                    .catch((caught) =>
                      setError(
                        caught instanceof Error
                          ? caught.message
                          : "无法读取图片",
                      ),
                    );
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder="输入交易指令、分析问题或粘贴图片"
              />
            </div>
            <div className="model-picker" ref={modelPickerRef}>
              <button
                className="model-trigger"
                aria-haspopup="menu"
                aria-expanded={modelOpen}
                onClick={() => setModelOpen((open) => !open)}
              >
                5.6{" "}
                {modelId.split("-").at(-1)![0].toUpperCase() +
                  modelId.split("-").at(-1)!.slice(1)}{" "}
                ·{" "}
                {
                  (
                    {
                      low: "Light",
                      medium: "Medium",
                      high: "High",
                      xhigh: "Extra High",
                      max: "Ultra",
                    } as Record<ReasoningId, string>
                  )[reasoningEffort]
                }
                <ChevronDown size={15} />
              </button>
              {modelOpen && (
                <div className="model-menu" role="menu">
                  <div className="model-menu-label">Reasoning</div>
                  {(
                    status?.model?.reasoning || [
                      "low",
                      "medium",
                      "high",
                      "xhigh",
                      "max",
                    ]
                  ).map((option) => (
                    <button
                      key={option}
                      className={reasoningEffort === option ? "selected" : ""}
                      onClick={() => {
                        setReasoningEffort(option);
                        setModelOpen(false);
                      }}
                    >
                      {
                        (
                          {
                            low: "Light",
                            medium: "Medium",
                            high: "High",
                            xhigh: "Extra High",
                            max: "Ultra",
                          } as Record<ReasoningId, string>
                        )[option]
                      }
                      {reasoningEffort === option && <Check size={15} />}
                    </button>
                  ))}
                  <div className="model-menu-divider" />
                  <div className="model-menu-label">Model</div>
                  {(
                    [
                      "gpt-5.6-luna",
                      "gpt-5.6-terra",
                      "gpt-5.6-sol",
                    ] as ModelId[]
                  )
                    .filter((option) =>
                      (
                        status?.model?.models || [
                          "gpt-5.6-luna",
                          "gpt-5.6-sol",
                          "gpt-5.6-terra",
                        ]
                      ).includes(option),
                    )
                    .map((option) => (
                      <button
                        key={option}
                        className={modelId === option ? "selected" : ""}
                        onClick={() => {
                          setModelId(option);
                          setModelOpen(false);
                        }}
                      >
                        {modelLabel(option)}
                      </button>
                    ))}
                </div>
              )}
            </div>
            <button
              className="composer-send"
              title="发送"
              aria-label="发送"
              disabled={(!input.trim() && !attachment) || busy}
              onClick={() => void send()}
            >
              <SendHorizontal size={19} />
            </button>
          </div>
        </div>
      </section>
      <aside className="market-rail">
        <button
          className="sidebar-toggle right-panel-toggle"
          title="隐藏右侧栏"
          aria-label="隐藏右侧栏"
          onClick={() => setRightCollapsed(true)}
        >
          <PanelRightClose size={17} />
        </button>
        <AssetWorkspace
          onMarketContext={(context) => {
            marketContext.current = context;
          }}
        />
        <button
          className="resize-handle right-resize"
          title="调整右侧栏宽度"
          aria-label="调整右侧栏宽度"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setResizing("right");
          }}
        />
      </aside>
      {rightCollapsed && (
        <button
          className="sidebar-reopen right-reopen"
          title="显示右侧栏"
          aria-label="显示右侧栏"
          onClick={() => setRightCollapsed(false)}
        >
          <PanelRightOpen size={18} />
        </button>
      )}
      {settingsOpen && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSettingsOpen(false);
          }}
        >
          <section
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <button
              className="dialog-close"
              title="关闭"
              aria-label="关闭"
              onClick={() => setSettingsOpen(false)}
            >
              <X size={18} />
            </button>
            <h2 id="settings-title">设置</h2>
            <label>外观</label>
            <div className="theme-options">
              {(
                [
                  ["light", Sun, "浅色"],
                  ["dark", Moon, "深色"],
                  ["system", Monitor, "跟随系统"],
                ] as const
              ).map(([value, Icon, label]) => (
                <button
                  key={value}
                  className={theme === value ? "selected" : ""}
                  onClick={() => setTheme(value)}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

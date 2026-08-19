# CryptoAgent

CryptoAgent is a research and constrained spot-execution client for crypto markets. It includes a financial-knowledge adapter and a deliberately narrow Binance Spot client.

The architecture must keep three cores separate:

```text
Learning engine -> research/orchestration -> deterministic risk and execution
```

- The learning engine owns theories, papers, protocol documentation, regulatory material, evidence, conflicts, and time-aware retrieval.
- The research layer will own market datasets, feature definitions, strategy specifications, backtests, and out-of-sample evaluation.
- The execution layer will own positions, orders, reconciliation, limits, approvals, and kill switches.

An LLM never converts a conversational conclusion directly into a live order. It may only propose a structured order draft. The server independently checks the symbol allowlist, spot availability, Binance filters, available balance, and a hard per-order USDT limit, then sends Binance's test-order request. A separate, expiring confirmation is required for submission. Exchange credentials, wallet keys, orders, balances, and tick data never enter the learning database.

## Run the Binance client

Start with Binance Spot Testnet. Create testnet credentials, copy `.env.example` to `.env`, and fill in the two credential values. The API key must have Spot trading permission and must never have withdrawal permission.

```bash
npm install
npm run dev -- crypto-agent
```

Open `http://127.0.0.1:5450`. Without a model gateway, explicit market instructions such as `用 50 USDT 市价买入 BTC` still work. Configuring `GATEWAY_BASE_URL` and `GATEWAY_API_KEY` enables natural-language clarification and LIMIT order extraction; Binance credentials are never sent to the model.

The model control uses the gateway's transparent `openai` provider payload. It exposes `GPT-5.6 Luna`, `GPT-5.6 Sol`, and `GPT-5.6 Terra`, with independent `Light` (`low`), `Medium`, `High`, `Extra High` (`xhigh`), and `Ultra` (`max`) reasoning choices. The selected values are sent as `model` and `reasoning_effort`.

For a resident macOS window, use `npm run desktop -- crypto-agent`. Closing the window hides it while the app remains available from the Dock; use `Cmd+Q` to exit.

To create a normal double-clickable Apple Silicon app/DMG, run `npm run dist:mac -- crypto-agent`. The output is `dist/CryptoAgent-0.1.0-arm64.dmg`. For a packaged app, place the ignored `.env` at `~/Library/Application Support/CryptoAgent/.env`; the app starts its local API itself and never bundles that file.

The Coin-M workspace uses the server-side market relay for history, candles, mark price, and the sequenced depth stream. The relay keeps one long-lived Binance public WebSocket connection through Mihomo, broadcasts server updates every 100 ms, and repairs the order book from a REST snapshot whenever a diff gap is detected. The local app applies the latest server packet every 300 ms and keeps a direct Binance WebSocket as a temporary fallback if the relay is unavailable; Binance API credentials are never used for public market data.

## News collection and push policy

The desktop and local API never contact publishers, RSS feeds, aggregators, or exchange announcement APIs. They read the authenticated custom-api-gateway archive every 15 seconds and expose its cursor pagination to the UI.

### Server news collector

Production news collection belongs to the `custom-api-gateway` repository. Its `news_collector.py` polls the configured RSS publishers, `cryptocurrency.cv`, and the official Binance and OKX announcement endpoints every 60 seconds through Mihomo. It writes an unlimited, deduplicated history to `/var/lib/custom-api-gateway/news.sqlite`; `custom-api-news.service` keeps it running across logouts and server restarts. This is the learning source: it stores publisher material, not generated price alerts.

The collector explicitly configures the proxy from `MIHOMO_PROXY` (default `http://127.0.0.1:7890`). CEX announcements use their exchange endpoints directly; no public RSSHub bridge is part of the production source list.

### Server market relay

The production server also runs [`deploy/market_relay.py`](deploy/market_relay.py). It owns the COIN-M `kline`, `aggTrade`, `markPrice`, and `depth@100ms` streams and serves a loopback SSE endpoint. Its SQLite database keeps seven days of one-minute candles and order-book features, while `market_events` stores generated observations separately from the news archive. The gateway exposes authenticated snapshot, stream, history, and event routes; the desktop app connects only through its local API and never opens a Binance WebSocket.

Install the single WebSocket client dependency in the server venv and enable the service alongside the gateway:

```bash
mkdir -p /opt/custom-api-gateway/market_deps
python3 -m pip install --target /opt/custom-api-gateway/market_deps -r market-relay-requirements.txt
cp deploy/market_relay.py deploy/custom-api-market.service /opt/custom-api-gateway/
systemctl enable --now custom-api-market.service
```

The push policy is:

- the first app open of each local day receives up to 10 recent items;
- normal items are delivered once per two-hour cursor window;
- headlines matching the breaking-news rules are delivered immediately;
- market events poll every three seconds; no absolute BTC price is configured by default. The relay scores five-minute price moves against recent volatility and volume, and delivers only adaptive `market_anomaly` events immediately. Absolute thresholds are optional via `MARKET_BREAKING_THRESHOLDS` and are disabled by default.

Browser notifications require the user's normal Notification permission; the in-app news list remains available when notifications are disabled.

The client capability policy targets full Binance trading coverage: all configured Spot symbols, USDⓈ-M and COIN-M futures, margin trading without borrow/repay, internal account transfers, and automated strategy execution. Withdrawals, borrow/repay, and external transfers remain disabled. Live account reads require `BINANCE_ENV=live`; live submission additionally requires the separate `BINANCE_LIVE_TRADING=true` unlock. API keys should be IP-restricted.

`GET /api/permissions` performs a safe account-capability audit. Binance's Spot account response cannot prove every API Management checkbox, so futures, transfers, and withdrawals are reported as `not_used` rather than probed. The client never calls those APIs.

The client permission policy is explicit: withdrawals, borrow/repay, and external transfers are disabled; internal universal transfers, margin trading, futures, algo trading, and automated strategies are in scope. Product-specific clients are being added separately; the Spot client does not probe destructive APIs.

See [`TODO.md`](TODO.md) for the remaining production exit criteria. This client is not an autonomous strategy and does not provide investment advice.

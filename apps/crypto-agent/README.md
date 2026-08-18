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

The chart loads 1-minute history over REST, then follows Binance's real-time `@trade` WebSocket stream. Each trade updates the current candle immediately; the socket reconnects after disconnects.

## News collection and push policy

News collection combines audited RSS/Atom URLs with CEX announcement feeds and the optional public `cryptocurrency.cv` aggregator (200+ crypto and financial publishers). `NEWS_CEX_RSS_URLS` includes Kraken's official RSS plus RSSHub bridges for Binance, OKX, and Bybit; those bridges are best-effort because the exchanges do not publish stable documented announcement APIs. Set `NEWS_RSS_URLS` or `NEWS_CEX_RSS_URLS` to replace them. Set `NEWS_EXTERNAL_SOURCES=off` to disable the public aggregator. The service polls every `NEWS_POLL_MS` (five minutes by default), deduplicates by URL and title, and stores up to 500 items with their source and publication time.

### Server news collector

Production news collection runs independently of the desktop app. [`deploy/news-collector.py`](deploy/news-collector.py) polls public sources every 60 seconds through Mihomo and writes an unlimited, deduplicated history to `/var/lib/custom-api-gateway/news.sqlite`. [`deploy/custom-api-news.service`](deploy/custom-api-news.service) keeps it running across logouts and server restarts. The desktop app uses `NEWS_REMOTE_ONLY=true`, receives live local events when available, and checks the remote archive every 15 seconds.

```bash
scp deploy/news-collector.py deploy/custom-api-news.service root@SERVER:/opt/custom-api-gateway/
ssh root@SERVER 'cp /opt/custom-api-gateway/custom-api-news.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now custom-api-news.service'
ssh root@SERVER 'systemctl status custom-api-news.service --no-pager'
```

The collector explicitly configures the proxy from `MIHOMO_PROXY` (default `http://127.0.0.1:7890`). A source returning HTTP 403 through that proxy is an upstream/WAF rejection, not a direct-connection fallback. Public RSSHub bridges are therefore best-effort and should eventually be replaced by a self-hosted RSSHub or documented exchange connector.

For X and additional OpenNews coverage, set `OPENNEWS_TOKEN` and a comma-separated `NEWS_SOCIAL_KEYWORDS` list. This uses the 6551 OpenTwitter/OpenNews APIs from the local research reference; it is opt-in because it requires a separate token and has quota/rate limits. The token is read only by the server and is never sent to Binance or the browser.

The push policy is:

- the first app open of each local day receives up to 10 recent items;
- normal items are delivered once per two-hour cursor window;
- headlines matching the breaking-news rules are delivered immediately;
- new items are learned into a separate SQLite research database (`NEWS_LEARNING_DB_FILE`), never into the order or credential path.

`GET /api/news/knowledge` exposes the learned source records for future retrieval and summarization. Browser notifications require the user's normal Notification permission; the in-app news list remains available when notifications are disabled.

The client capability policy targets full Binance trading coverage: all configured Spot symbols, USDⓈ-M and COIN-M futures, margin trading without borrow/repay, internal account transfers, and automated strategy execution. Withdrawals, borrow/repay, and external transfers remain disabled. Live account reads require `BINANCE_ENV=live`; live submission additionally requires the separate `BINANCE_LIVE_TRADING=true` unlock. API keys should be IP-restricted.

`GET /api/permissions` performs a safe account-capability audit. Binance's Spot account response cannot prove every API Management checkbox, so futures, transfers, and withdrawals are reported as `not_used` rather than probed. The client never calls those APIs.

The client permission policy is explicit: withdrawals, borrow/repay, and external transfers are disabled; internal universal transfers, margin trading, futures, algo trading, and automated strategies are in scope. Product-specific clients are being added separately; the Spot client does not probe destructive APIs.

See [`TODO.md`](TODO.md) for the remaining production exit criteria. This client is not an autonomous strategy and does not provide investment advice.

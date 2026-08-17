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

The defaults are intentionally restrictive: testnet, BTC/ETH against USDT, spot only, no leverage, and at most 100 USDT per order. Live account reads require `BINANCE_ENV=live`; live submission additionally requires the separate `BINANCE_LIVE_TRADING=true` unlock. API keys should be IP-restricted.

`GET /api/permissions` performs a safe account-capability audit. Binance's Spot account response cannot prove every API Management checkbox, so futures, transfers, and withdrawals are reported as `not_used` rather than probed. The client never calls those APIs.

The client permission policy is explicit: withdrawals and external transfers are disabled; internal universal transfers within the user's own Binance account are allowed by policy but are not yet implemented; margin borrowing/repayment is disabled; spot trading is the only execution capability currently used by this application. Other permissions may remain enabled on the Binance key for separate tools, but they are outside this client's API surface.

See [`TODO.md`](TODO.md) for the remaining production exit criteria. This client is not an autonomous strategy and does not provide investment advice.

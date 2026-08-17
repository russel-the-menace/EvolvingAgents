# CryptoAgent Reference Projects

These repositories are local research material only. They are intentionally ignored by the root repository and are not imported as workspaces or runtime dependencies.

| Local copy | Upstream | Useful parts | Boundary |
| --- | --- | --- | --- |
| `cryptocurrency-cv` | `nirholas/cryptocurrency.cv` | multi-source news API, RSS/SSE, archive and source metadata | audit X/social integrations and licensing before reuse |
| `crypto-social-radar` | `realnaka/crypto-social-radar` | X/news/Binance monitoring, scheduled reports, notifications | inspect credentials and any scraping before deployment |
| `crypto-news-pipeline` | `PeymanKh/crypto_news_pipeline` | ingestion, sentiment analysis, storage and Telegram delivery | use as pipeline reference, never as an execution authority |
| `newsnow` | `ourongxing/newsnow` | pluggable news sources, aggregation, ranking and reader UI | reuse source/UX patterns only; keep our provenance and trading boundary |

The production design should copy connector ideas into a small, reviewed service with explicit source URLs, timestamps, deduplication, confidence, and audit logs. No reference project receives Binance API credentials.

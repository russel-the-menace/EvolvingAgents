# CryptoAgent

CryptoAgent is a planned research and automation agent for financial theory and crypto markets. This workspace is an implementation record, not a trading product. Its only implemented code is a financial-knowledge adapter over the shared learning engine, including source provenance and `knownAt` filtering to prevent future information from appearing in historical research.

The architecture must keep three cores separate:

```text
Learning engine -> research/orchestration -> deterministic risk and execution
```

- The learning engine owns theories, papers, protocol documentation, regulatory material, evidence, conflicts, and time-aware retrieval.
- The research layer will own market datasets, feature definitions, strategy specifications, backtests, and out-of-sample evaluation.
- The execution layer will own positions, orders, reconciliation, limits, approvals, and kill switches.

An LLM must never convert a conversational conclusion directly into a live order. Exchange credentials, wallet keys, orders, balances, and tick data must never enter the learning database.

See [`TODO.md`](TODO.md) for the staged implementation record. Project-specific papers and source-code references belong in `research-papers/` and `reference-project/`; both are intentionally empty.

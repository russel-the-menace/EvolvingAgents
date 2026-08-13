# Desktop Workbench

## Responsibility

The desktop workbench is the control surface for one interview. It owns local display state and persists the last prepared interview packet in browser storage during the prototype phase.

## Current behavior

1. The preparation page requires a JD and the exact submitted resume.
2. It creates a reviewable packet with focus areas and likely question categories.
3. The user explicitly enters formal mode.
4. Formal mode displays a conversation stream, sends new questions to the interview engine, and exposes stop and interrupt controls.

## Design decisions

- Electron plus Vite: rapid iteration with a native macOS window. Electron is a shell at this stage, not the intelligence layer.
- Port `5269`: stable local development port selected for this workspace.
- Text before voice: text exercises packet logic, model latency, and interruption deterministically. Audio will send the same text events later.
- Settings are local: inference endpoint and model name are adjustable without rebuilds.

## Source

- `electron/main.cjs`
- `src/App.tsx`
- `src/storage.ts`
- `src/styles.css`

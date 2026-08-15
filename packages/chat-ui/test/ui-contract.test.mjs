import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('shared chat keeps the MindClone layout and reading contracts', () => {
  for (const rule of [
    'grid-template-rows: minmax(0, 1fr) auto',
    '.chat-session.active { color: var(--chat-sidebar-ink); }',
    '.chat-empty > h1, .chat-empty > h2',
    '.chat-rich-text > hr',
    '.chat-rich-text table',
    '.chat-table-scroll',
    '.app-shell.sidebar-collapsed > .chat-sidebar { display: none; }',
  ]) assert.ok(styles.includes(rule), `missing shared UI contract: ${rule}`);
});

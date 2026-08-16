import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeChatMarkdown } from '../src/markdown.ts';

test('separates a quoted numbered item glued to the previous item', () => {
  assert.equal(
    normalizeChatMarkdown('> 3. 获取报名入口> 4. 打开申报通道'),
    '> 3. 获取报名入口\n> 4. 打开申报通道',
  );
});

test('separates an opening code fence glued to a heading', () => {
  assert.equal(
    normalizeChatMarkdown('### 第 1 步：搜学校```\n查询词\n```\n\n### 第 2 步'),
    '### 第 1 步：搜学校\n```\n查询词\n```\n\n### 第 2 步',
  );
});

test('leaves valid fenced and inline code unchanged', () => {
  const markdown = '### Example\n\n```js\nconst value = 1;\n```\n\nUse `value`.';
  assert.equal(normalizeChatMarkdown(markdown), markdown);
});

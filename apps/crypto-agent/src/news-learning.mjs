import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createSqliteLearningStore } from '@evolving-agents/learning-engine';
import { createCryptoKnowledgeEngine } from './learning.mjs';

// News is learned as time-scoped, research-only claims. It never enters the order prompt.
export function createNewsLearner(file) {
  if (!file) return null;
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  const store = createSqliteLearningStore(db);
  const engine = createCryptoKnowledgeEngine({
    store,
    extractor: {
      extract: async ({ source, chunk }) => [{
        title: source.title,
        proposition: chunk.text,
        kind: 'news_report',
        sourceQuote: chunk.text,
        tags: ['news', ...(source.metadata.urgency === 'breaking' ? ['breaking'] : [])],
        confidence: source.metadata.urgency === 'breaking' ? 0.75 : 0.55,
      }],
    },
  });
  return {
    engine,
    store,
    learn: async (item) => {
      const { source, duplicate } = await engine.ingest({
        title: item.title,
        sourceType: 'news_feed',
        sourceUri: item.url,
        sourceActor: item.source,
        content: `${item.title}\n\n${item.summary || ''}`,
        createdAt: item.publishedAt,
        metadata: { publishedAt: item.publishedAt, knownAt: item.publishedAt, urgency: item.urgency, evidenceType: 'news_report', authorityLevel: 'publisher' },
      });
      if (!duplicate) await engine.learn(source.id);
      return { duplicate, sourceId: source.id };
    },
  };
}

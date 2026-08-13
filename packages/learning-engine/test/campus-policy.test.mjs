import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createLearningEngine, createSqliteLearningStore, locateEvidence } from '../src/index.mjs';

function createCampusEngine() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const store = createSqliteLearningStore(db);
  const extractor = {
    async extract({ source, chunk }) {
      if (!chunk.text.includes('国家奖学金')) return [];
      return [{
        title: '国家奖学金申请条件',
        proposition: '2026级全日制本科生平均学分绩点达到3.5且无处分记录，可以申请国家奖学金。',
        kind: 'eligibility_rule',
        sourceQuote: '申请对象为2026级全日制本科生，平均学分绩点不低于3.5，且无处分记录。',
        tags: ['奖学金', '本科生', '国家奖学金'],
        attributes: {
          applicableGroup: ['2026级', '全日制本科生'],
          authorityLevel: 'university',
          accessScope: source.metadata.accessScope,
          department: source.metadata.department,
        },
        validFrom: '2026-09-01',
        validTo: '2027-08-31',
        confidence: 0.98,
      }];
    },
  };
  const policy = {
    mapProposal: ({ proposal, source, chunk }) => {
      const located = locateEvidence(chunk, proposal.sourceQuote);
      return {
        claim: {
        ...proposal,
        owner: source.sourceActor,
        epistemicStatus: 'published',
        authorizationScope: 'policy_knowledge',
      },
        evidence: [{
          ...located,
          ordinal: chunk.ordinal,
          owner: source.sourceActor,
          attributes: { ...located.attributes, section: '第二条 申请条件' },
        }],
      };
    },
    canRetrieve: ({ claim, evidence, context }) => {
      if (claim.epistemicStatus !== 'published') return false;
      const requiredScope = claim.attributes.accessScope || 'public';
      if (requiredScope !== 'public' && !(context.accessScopes || []).includes(requiredScope)) return false;
      return evidence.length > 0
        && evidence.every((item) => item.source.metadata.accessScope === requiredScope);
    },
  };
  return { db, store, engine: createLearningEngine({ store, extractor, policy, chunking: { maxChars: 800, overlapChars: 80 } }) };
}

test('a campus policy adapter learns, filters, and cites without changing engine code', async () => {
  const { db, engine } = createCampusEngine();
  const { source } = await engine.ingest({
    title: '2026-2027学年国家奖学金评审办法',
    sourceType: 'authenticated_web',
    sourceUri: 'https://intranet.example.edu/scholarships/2026',
    sourceActor: '学生工作部',
    metadata: { accessScope: 'student-login', department: '学生工作部', publishedAt: '2026-08-20' },
    content: '# 国家奖学金评审办法\n\n第二条 申请条件\n申请对象为2026级全日制本科生，平均学分绩点不低于3.5，且无处分记录。',
  });
  const learned = await engine.learn(source.id);
  assert.equal(learned.claims.length, 1);
  assert.equal(learned.claims[0].kind, 'eligibility_rule');
  assert.equal(learned.claims[0].attributes.department, '学生工作部');

  const anonymous = await engine.retrieve('2026级本科生国家奖学金申请条件', {
    now: '2026-10-01', context: { accessScopes: ['public'] },
  });
  assert.equal(anonymous.length, 0);

  const authenticated = await engine.retrieve('2026级本科生国家奖学金申请条件', {
    now: '2026-10-01', context: { accessScopes: ['student-login'] },
  });
  assert.equal(authenticated.length, 1);
  const context = engine.buildEvidenceContext(authenticated);
  assert.equal(context[0].citation, 'E1');
  assert.match(context[0].evidence, /绩点不低于3\.5/);
  assert.equal(context[0].sources, '2026-2027学年国家奖学金评审办法');
  assert.equal(authenticated[0].evidence[0].attributes.offsetPrecision, 'exact');
  assert(authenticated[0].evidence[0].startOffset > 0);

  const lastValidDay = await engine.retrieve('国家奖学金申请条件', {
    now: '2027-08-31T12:00:00Z', context: { accessScopes: ['student-login'] },
  });
  assert.equal(lastValidDay.length, 1);

  const expired = await engine.retrieve('国家奖学金申请条件', {
    now: '2028-01-01', context: { accessScopes: ['student-login'] },
  });
  assert.equal(expired.length, 0);
  const unrelated = await engine.retrieve('校园班车发车时间', {
    now: '2026-10-01', context: { accessScopes: ['student-login'] },
  });
  assert.equal(unrelated.length, 0);
  db.close();
});

test('the default chunker processes material beyond a single model context window', async () => {
  const { db, engine } = createCampusEngine();
  const filler = Array.from({ length: 80 }, (_, index) => `第${index}节 普通说明内容。`).join('\n\n');
  const { source } = await engine.ingest({
    title: '长篇政策汇编', sourceType: 'public_web', sourceActor: '教务处', metadata: { accessScope: 'public' },
    content: `${filler}\n\n# 国家奖学金\n申请对象为2026级全日制本科生，平均学分绩点不低于3.5，且无处分记录。`,
  });
  const learned = await engine.learn(source.id);
  assert(learned.chunks.length > 1);
  assert.equal(learned.claims.length, 1);
  db.close();
});

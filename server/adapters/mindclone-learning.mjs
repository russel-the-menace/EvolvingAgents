import { createLearningEngine, locateEvidence } from '../../packages/learning-engine/src/index.mjs';
import { defaultAuthorization } from '../domain/cognition.mjs';

function sourceIsExternal(source) {
  return ['short_video', 'article', 'paper', 'podcast'].includes(source.sourceType);
}

function extractionPrompt(source, chunk) {
  if (sourceIsExternal(source)) {
    return `Extract atomic, reusable claims from this chunk of external learning material. Never attribute the source author's experience or opinion to the user. Return strict JSON: {"claims":[{"kind":"knowledge|example","owner":"external|third_party","title":"short title","proposition":"clear reusable claim in the source language","tags":["tag"],"sourceQuote":"direct supporting quote from this chunk","confidence":0.0}]}. Use owner=third_party for cases or speaker-specific viewpoints. Every item represents understanding, not user endorsement. Return at most 12 items. Chunk:\n${chunk.text}`;
  }
  return `Extract atomic claims from this chunk of user-owned material. Use only supported information and distinguish experience, viewpoint, preference, value, knowledge, and expression samples. In conversation records, extract personal claims only from text explicitly labeled User; assistant text is context and must never become a user claim. Return strict JSON: {"claims":[{"kind":"experience|viewpoint|preference|value|knowledge|expression","owner":"user","title":"short title","proposition":"complete candidate claim","tags":["tag"],"sourceQuote":"direct supporting quote from the user","confidence":0.0}]}. These are observed candidates and require user endorsement before first-person use. Return at most 12 items. Chunk:\n${chunk.text}`;
}

function createDeepSeekExtractor() {
  return {
    async extract({ source, chunk }) {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not configured. Set it in the local .env file and restart the service.');
      const response = await fetch(`${(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat', temperature: 0.1,
          response_format: { type: 'json_object' }, messages: [{ role: 'user', content: extractionPrompt(source, chunk) }],
        }),
      });
      if (!response.ok) throw new Error(`DeepSeek extraction request failed (${response.status}).`);
      const payload = await response.json();
      const parsed = JSON.parse(payload.choices?.[0]?.message?.content || '{}');
      return Array.isArray(parsed.claims) ? parsed.claims : [];
    },
  };
}

export function createMindCloneLearningEngine(repository) {
  return createLearningEngine({
    store: repository,
    extractor: createDeepSeekExtractor(),
    chunking: { maxChars: 6000, overlapChars: 300 },
    policy: {
      mapProposal: ({ proposal, source, chunk }) => {
        const external = sourceIsExternal(source);
        const owner = external ? (proposal.owner === 'third_party' ? 'third_party' : 'external') : 'user';
        const kind = String(proposal.kind || (external ? 'knowledge' : 'experience'));
        const epistemicStatus = external ? 'understood' : 'observed';
        return {
          claim: {
            title: String(proposal.title || 'Untitled claim').slice(0, 120),
            proposition: String(proposal.proposition || '').slice(0, 1600), kind, owner, epistemicStatus,
            authorizationScope: defaultAuthorization({ owner, kind, status: epistemicStatus }),
            tags: Array.isArray(proposal.tags) ? proposal.tags.map(String).slice(0, 12) : [],
            confidence: Math.max(0, Math.min(Number(proposal.confidence || 0.6), 1)),
          },
          evidence: [{
            ...locateEvidence(chunk, String(proposal.sourceQuote || proposal.proposition || '').slice(0, 1200)),
            ordinal: chunk.ordinal, speaker: external ? 'source_author' : 'user', owner,
          }],
        };
      },
      canRetrieve: ({ claim }) => claim.authorizationScope !== 'none'
        && !['rejected', 'superseded', 'contested'].includes(claim.epistemicStatus),
      beforeReplaceSource: ({ source, store }) => store.deleteInquiriesForSource(source.id),
      afterLearn: ({ source, claims, store }) => {
        if (!sourceIsExternal(source)) return;
        for (const claim of claims.filter((item) => item.kind === 'knowledge').slice(0, 3)) {
          store.addInquiry({
            claimId: claim.id,
            question: `你怎么看“${claim.proposition.slice(0, 120)}”？这只是你理解的新知识，还是也代表你的判断？`,
            reason: 'External knowledge requires user deliberation before it can represent a personal viewpoint.',
            priority: 0.5 + claim.confidence * 0.3,
          });
        }
      },
    },
  });
}

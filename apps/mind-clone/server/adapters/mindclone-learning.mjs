import { createLearningEngine, locateEvidence, parseModelJson } from '@evolving-agents/learning-engine';
import { defaultAuthorization } from '../domain/cognition.mjs';

function sourceIsExternal(source) {
  return ['short_video', 'article', 'paper', 'podcast'].includes(source.sourceType);
}

function extractionPrompt(source, chunk, context = {}) {
  if (sourceIsExternal(source)) {
    return `Extract atomic, reusable claims from this chunk of external learning material. Never attribute the source author's experience or opinion to the user. Return strict JSON: {"claims":[{"kind":"knowledge|example","owner":"external|third_party","title":"short title","proposition":"clear reusable claim in the source language","tags":["tag"],"sourceQuote":"direct supporting quote from this chunk","confidence":0.0}]}. Use owner=third_party for cases or speaker-specific viewpoints. Every item represents understanding, not user endorsement. Return at most 12 items. Chunk:\n${chunk.text}`;
  }
  const authority = source.metadata.directConversation
    ? 'The User statements are direct first-person evidence and may be mapped to endorsed user cognition. Do not extract the assistant text.'
    : 'These are observed candidates and require conversational confirmation before first-person use.';
  const resolution = context.resolvedInquiryClaimId
    ? `Do not extract the user's answer to inquiry claim ${context.resolvedInquiryClaimId}; it was already persisted through the inquiry-resolution path.`
    : '';
  return `Extract atomic claims from this chunk of user-owned material. Use only supported information and distinguish experience, viewpoint, preference, value, knowledge, and expression samples. In conversation records, extract personal claims only from text explicitly labeled User; assistant text is context and must never become a user claim. Return strict JSON: {"claims":[{"kind":"experience|viewpoint|preference|value|knowledge|expression","owner":"user","title":"short title","proposition":"complete candidate claim","tags":["tag"],"sourceQuote":"direct supporting quote from the user","confidence":0.0}]}. ${authority} ${resolution} Return at most 12 items. Chunk:\n${chunk.text}`;
}

function createDeepSeekExtractor(gateway) {
  return {
    async extract({ source, chunk, context }) {
      const parsed = parseModelJson(await gateway.complete([{ role: 'user', content: extractionPrompt(source, chunk, context) }], { quality: 'High' }));
      return Array.isArray(parsed.claims) ? parsed.claims : [];
    },
  };
}

export function createMindCloneLearningEngine(repository, gateway) {
  return createLearningEngine({
    store: repository,
    extractor: createDeepSeekExtractor(gateway),
    chunking: { maxChars: 6000, overlapChars: 300 },
    policy: {
      mapProposal: ({ proposal, source, chunk }) => {
        const external = sourceIsExternal(source);
        const owner = external ? (proposal.owner === 'third_party' ? 'third_party' : 'external') : 'user';
        const kind = String(proposal.kind || (external ? 'knowledge' : 'experience'));
        const epistemicStatus = external ? 'understood' : source.metadata.directConversation ? 'endorsed' : 'observed';
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
        const candidates = sourceIsExternal(source)
          ? claims.filter((item) => item.kind === 'knowledge')
          : claims.filter((item) => item.epistemicStatus === 'observed');
        for (const claim of candidates.slice(0, 3)) {
          store.addInquiry({
            claimId: claim.id,
            question: sourceIsExternal(source)
              ? `你怎么看“${claim.proposition.slice(0, 120)}”？这只是你理解的新知识，还是也代表你的判断？`
              : `我从导入材料里理解到“${claim.proposition.slice(0, 120)}”。我应该把它当作你现在认可的经历或观点吗？`,
            reason: sourceIsExternal(source)
              ? 'External knowledge requires user deliberation before it can represent a personal viewpoint.'
              : 'Imported personal material requires conversational confirmation.',
            priority: 0.5 + claim.confidence * 0.3,
          });
        }
      },
    },
  });
}

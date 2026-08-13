import { createLearningEngine, locateEvidence } from '@evolving-agents/learning-engine';

function instant(value) {
  const result = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(result) ? result : null;
}

export function createCryptoKnowledgeEngine({ store, extractor, reranker, retrievers, chunking }) {
  return createLearningEngine({
    store,
    extractor,
    reranker,
    retrievers,
    chunking: chunking || { maxChars: 6000, overlapChars: 300 },
    policy: {
      mapProposal: ({ proposal, source, chunk }) => {
        const located = locateEvidence(chunk, proposal.sourceQuote || chunk.text);
        const knownAt = proposal.knownAt || source.metadata.knownAt || source.createdAt;
        return {
          claim: {
            title: proposal.title,
            proposition: proposal.proposition,
            kind: proposal.kind || 'financial_knowledge',
            owner: source.sourceActor || 'unknown_publisher',
            epistemicStatus: proposal.epistemicStatus || 'understood',
            authorizationScope: 'research_use',
            tags: proposal.tags || [],
            attributes: {
              ...proposal.attributes,
              assetScope: proposal.assetScope || [],
              evidenceType: proposal.evidenceType || source.metadata.evidenceType,
              authorityLevel: source.metadata.authorityLevel,
              knownAt,
              publishedAt: source.metadata.publishedAt,
            },
            validFrom: proposal.validFrom,
            validTo: proposal.validTo,
            confidence: proposal.confidence ?? 0.5,
          },
          evidence: [{
            ...located,
            ordinal: chunk.ordinal,
            owner: source.sourceActor || 'unknown_publisher',
            attributes: { ...located.attributes, knownAt },
          }],
        };
      },
      canRetrieve: ({ claim, evidence, now }) => {
        if (!['understood', 'verified', 'published'].includes(claim.epistemicStatus)) return false;
        const knownAt = instant(claim.attributes.knownAt);
        const queryAt = instant(now);
        if (knownAt != null && queryAt != null && knownAt > queryAt) return false;
        return evidence.length > 0;
      },
    },
  });
}

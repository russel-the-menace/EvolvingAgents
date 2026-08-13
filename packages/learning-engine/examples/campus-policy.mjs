import { createLearningEngine, locateEvidence } from '../src/index.mjs';

export function createCampusPolicyEngine({ store, extractor, reranker, retrievers }) {
  return createLearningEngine({
    store,
    extractor,
    reranker,
    retrievers,
    chunking: { maxChars: 6000, overlapChars: 300 },
    policy: {
      mapProposal: ({ proposal, source, chunk }) => {
        const located = locateEvidence(chunk, proposal.sourceQuote || chunk.text);
        return {
          claim: {
          title: proposal.title,
          proposition: proposal.proposition,
          kind: proposal.kind || 'policy_rule',
          owner: source.sourceActor || 'unknown_publisher',
          epistemicStatus: proposal.epistemicStatus || 'published',
          authorizationScope: 'policy_knowledge',
          tags: proposal.tags || [],
          attributes: {
            ...proposal.attributes,
            accessScope: source.metadata.accessScope || 'public',
            department: source.metadata.department,
            authorityLevel: source.metadata.authorityLevel,
          },
          validFrom: proposal.validFrom,
          validTo: proposal.validTo,
          confidence: proposal.confidence ?? 0.5,
        },
          evidence: [{
            ...located,
            ordinal: chunk.ordinal,
            owner: source.sourceActor || 'unknown_publisher',
            attributes: { ...located.attributes, section: proposal.section },
          }],
        };
      },
      canRetrieve: ({ claim, evidence, context }) => {
        if (!['published', 'verified'].includes(claim.epistemicStatus)) return false;
        const required = claim.attributes.accessScope || 'public';
        const allowed = required === 'public' || (context.accessScopes || []).includes(required);
        return allowed && evidence.length > 0
          && evidence.every((item) => (item.source.metadata.accessScope || 'public') === required);
      },
    },
  });
}

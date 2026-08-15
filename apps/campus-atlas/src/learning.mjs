import { createLearningEngine, locateEvidence } from '@evolving-agents/learning-engine';

export function createCampusPolicyEngine({ store, extractor, reranker, retrievers, chunking }) {
  return createLearningEngine({
    store,
    extractor,
    reranker,
    retrievers,
    chunking: chunking || { maxChars: 6000, overlapChars: 300 },
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

export function createCompetitionPlanningEngine({ store, extractor, reranker, retrievers, chunking }) {
  return createLearningEngine({
    store,
    extractor,
    reranker,
    retrievers,
    chunking: chunking || { maxChars: 6000, overlapChars: 300 },
    policy: {
      mapProposal: ({ proposal, source, chunk }) => {
        const located = locateEvidence(chunk, proposal.sourceQuote || chunk.text);
        const accessScope = source.metadata.accessScope || 'public';
        return {
          claim: {
            title: proposal.title,
            proposition: proposal.proposition,
            kind: proposal.kind || (source.metadata.domain === 'user_profile' ? 'personal_constraint' : 'competition_fact'),
            owner: source.sourceActor || (accessScope === 'private_profile' ? 'user' : 'unknown_publisher'),
            epistemicStatus: proposal.epistemicStatus || (source.metadata.domain === 'user_profile' ? 'user_asserted' : 'published'),
            authorizationScope: accessScope === 'private_profile' ? 'private_profile' : 'competition_knowledge',
            tags: proposal.tags || [],
            attributes: { ...proposal.attributes, accessScope, domain: source.metadata.domain || 'competition', authorityLevel: source.metadata.authorityLevel },
            validFrom: proposal.validFrom,
            validTo: proposal.validTo,
            confidence: proposal.confidence ?? (source.metadata.domain === 'user_profile' ? 0.8 : 0.5),
          },
          evidence: [{ ...located, ordinal: chunk.ordinal, owner: source.sourceActor || 'source', attributes: { ...located.attributes, section: proposal.section } }],
        };
      },
      canRetrieve: ({ claim, evidence, context }) => {
        const required = claim.attributes.accessScope || 'public';
        const allowed = required === 'public' || (context.accessScopes || []).includes(required);
        const statusAllowed = required === 'private_profile'
          ? ['user_asserted', 'verified'].includes(claim.epistemicStatus)
          : ['published', 'verified'].includes(claim.epistemicStatus);
        return allowed && statusAllowed && evidence.length > 0;
      },
    },
  });
}

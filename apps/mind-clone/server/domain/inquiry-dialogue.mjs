import { defaultAuthorization } from './cognition.mjs';

const ACCEPT = /(?:\b(?:yes|agree|correct|exactly|endorse)\b|是的|对的|认同|同意|没错|就是这样)/iu;
const REJECT = /(?:\b(?:no|disagree|reject|don't agree|do not agree)\b|完全不认同|不认同|不同意|不赞同|不是我的观点|我反对)/iu;
const DEFER = /(?:\b(?:later|not now|skip|unsure|not sure)\b|以后再说|下次再说|暂时不|先不|跳过|不确定)/iu;
const QUALIFY = /(?:\b(?:but|however|partly|partially|except|i think|i believe|in my view)\b|不完全认同|不太认同|但是|不过|部分|前提是|更准确|准确来说|应该是|我认为|我觉得|我的看法)/iu;

export function classifyInquiryReply(text) {
  const value = String(text || '').trim();
  if (!value) return { intent: 'unrelated', proposition: '' };
  if (DEFER.test(value)) return { intent: 'defer', proposition: '' };
  if (QUALIFY.test(value)) return { intent: 'qualify', proposition: value };
  if (REJECT.test(value)) return { intent: 'reject', proposition: value };
  if (ACCEPT.test(value)) return { intent: 'accept', proposition: '' };
  return { intent: 'unrelated', proposition: '' };
}

function addDerivedClaim(repository, sourceClaim, proposition, relation, evidenceSourceId) {
  const kind = sourceClaim.owner === 'user' ? sourceClaim.kind : 'viewpoint';
  const authorizationScope = defaultAuthorization({ owner: 'user', kind, status: 'endorsed' });
  const derived = repository.addClaim({
    title: sourceClaim.owner === 'user' ? sourceClaim.title : `My view: ${sourceClaim.title}`,
    proposition: proposition.slice(0, 1600),
    kind,
    owner: 'user',
    epistemicStatus: 'endorsed',
    authorizationScope,
    tags: sourceClaim.tags,
    contextScope: sourceClaim.contextScope,
    confidence: Math.max(0.65, sourceClaim.confidence),
  });
  repository.addClaimRelation(sourceClaim.id, derived.id, relation);
  repository.addAuthorizationEvent({
    claimId: derived.id,
    fromStatus: 'observed',
    toStatus: 'endorsed',
    fromScope: 'none',
    toScope: authorizationScope,
    reason: `Confirmed in conversation as ${relation}.`,
    evidenceSourceId,
  });
  return derived;
}

export function applyInquiryReply({ repository, inquiry, reply, evidenceSourceId }) {
  const sourceClaim = repository.getClaim(inquiry.claim_id || inquiry.claimId);
  if (!sourceClaim) {
    repository.resolveInquiry(inquiry.id, 'missing_source', reply.proposition || '');
    return { resolution: 'missing_source', claim: null };
  }

  if (reply.intent === 'defer' || reply.intent === 'unrelated') {
    repository.resolveInquiry(inquiry.id, 'deferred', reply.proposition || '');
    return { resolution: 'deferred', claim: null };
  }

  if (sourceClaim.owner === 'user') {
    if (reply.intent === 'accept') {
      const scope = defaultAuthorization({ owner: 'user', kind: sourceClaim.kind, status: 'endorsed' });
      const claim = repository.updateClaim(sourceClaim.id, { epistemicStatus: 'endorsed', authorizationScope: scope });
      repository.addAuthorizationEvent({ claimId: claim.id, fromStatus: sourceClaim.epistemicStatus, toStatus: 'endorsed', fromScope: sourceClaim.authorizationScope, toScope: scope, reason: 'Confirmed in conversation.', evidenceSourceId });
      repository.resolveInquiry(inquiry.id, 'accepted', '');
      return { resolution: 'accepted', claim };
    }
    if (reply.intent === 'reject') {
      const claim = repository.updateClaim(sourceClaim.id, { epistemicStatus: 'rejected', authorizationScope: 'none' });
      repository.addAuthorizationEvent({ claimId: claim.id, fromStatus: sourceClaim.epistemicStatus, toStatus: 'rejected', fromScope: sourceClaim.authorizationScope, toScope: 'none', reason: reply.proposition, evidenceSourceId });
      repository.resolveInquiry(inquiry.id, 'rejected', reply.proposition);
      return { resolution: 'rejected', claim };
    }
    const derived = addDerivedClaim(repository, sourceClaim, reply.proposition, 'corrected_as', evidenceSourceId);
    repository.updateClaim(sourceClaim.id, { epistemicStatus: 'rejected', authorizationScope: 'none', supersededBy: derived.id });
    repository.addAuthorizationEvent({ claimId: sourceClaim.id, fromStatus: sourceClaim.epistemicStatus, toStatus: 'rejected', fromScope: sourceClaim.authorizationScope, toScope: 'none', reason: 'Corrected in conversation.', evidenceSourceId });
    repository.resolveInquiry(inquiry.id, 'qualified', reply.proposition);
    return { resolution: 'qualified', claim: derived };
  }

  const proposition = reply.intent === 'accept'
    ? sourceClaim.proposition
    : reply.intent === 'reject'
      ? `${reply.proposition}: ${sourceClaim.proposition}`
      : reply.proposition;
  const relation = reply.intent === 'accept' ? 'internalized_as' : reply.intent === 'reject' ? 'challenged_by' : 'qualified_as';
  const derived = addDerivedClaim(repository, sourceClaim, proposition, relation, evidenceSourceId);
  repository.resolveInquiry(inquiry.id, reply.intent === 'accept' ? 'accepted' : reply.intent === 'reject' ? 'rejected' : 'qualified', reply.proposition);
  return { resolution: reply.intent, claim: derived };
}

export function inquiryDialogueContext(inquiry, reply) {
  if (!inquiry || reply.intent === 'unrelated') return '';
  const instruction = reply.intent === 'accept'
    ? 'The user accepted the proposition.'
    : reply.intent === 'reject'
      ? 'The user rejected the proposition. Do not argue them into accepting it.'
      : reply.intent === 'defer'
        ? 'The user deferred this topic. Do not ask it again now.'
        : 'The user qualified or corrected the proposition; treat their current wording as authoritative.';
  return `Conversational learning event: you previously asked: "${inquiry.question}" ${instruction} Acknowledge only when it fits naturally, then answer the user's current message. Do not repeat the inquiry.`;
}

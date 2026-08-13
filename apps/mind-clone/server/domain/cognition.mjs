export const epistemicStatuses = new Set([
  'observed',
  'understood',
  'contested',
  'endorsed',
  'superseded',
  'rejected',
]);

export const authorizationScopes = new Set([
  'none',
  'reasoning_use',
  'personal_view',
  'personal_experience',
  'scene_fact',
]);

const transitions = {
  observed: new Set(['understood', 'contested', 'endorsed', 'rejected']),
  understood: new Set(['contested', 'endorsed', 'rejected']),
  contested: new Set(['understood', 'endorsed', 'rejected']),
  endorsed: new Set(['contested', 'superseded', 'rejected']),
  superseded: new Set([]),
  rejected: new Set([]),
};

export function assertTransition(from, to) {
  if (!epistemicStatuses.has(from) || !epistemicStatuses.has(to)) {
    throw new Error(`Unknown epistemic transition: ${from} -> ${to}`);
  }
  if (!transitions[from].has(to)) {
    throw new Error(`Epistemic transition is not allowed: ${from} -> ${to}`);
  }
}

export function allowedAuthorization({ owner, kind, status, requestedScope }) {
  if (!authorizationScopes.has(requestedScope)) return false;
  if (requestedScope === 'none') return true;
  if (status === 'rejected' || status === 'superseded' || status === 'contested') return false;
  if (requestedScope === 'reasoning_use') return status === 'understood' || status === 'endorsed';
  if (requestedScope === 'scene_fact') return owner === 'user' && status === 'endorsed';
  if (requestedScope === 'personal_view') {
    return owner === 'user' && ['viewpoint', 'value', 'preference'].includes(kind) && status === 'endorsed';
  }
  if (requestedScope === 'personal_experience') {
    return owner === 'user' && kind === 'experience' && status === 'endorsed';
  }
  return false;
}

export function defaultAuthorization({ owner, kind, status }) {
  if (status === 'understood') return 'reasoning_use';
  if (status !== 'endorsed' || owner !== 'user') return 'none';
  if (kind === 'experience') return 'personal_experience';
  if (['viewpoint', 'value', 'preference'].includes(kind)) return 'personal_view';
  return 'reasoning_use';
}

export function canUseClaim(claim, use, sceneId = null) {
  if (!claim || ['contested', 'superseded', 'rejected'].includes(claim.epistemicStatus)) return false;
  if (use === 'reasoning') return claim.authorizationScope !== 'none';
  if (use === 'personal_view') return claim.authorizationScope === 'personal_view';
  if (use === 'personal_experience') return claim.authorizationScope === 'personal_experience';
  if (use === 'scene_fact') {
    return claim.authorizationScope === 'scene_fact' && Boolean(sceneId) && claim.sceneId === sceneId;
  }
  return false;
}

export function assertOwnershipNonEscalation(claim, requestedScope) {
  if (requestedScope === 'personal_experience' && (claim.owner !== 'user' || claim.kind !== 'experience')) {
    throw new Error('Only user-owned experience claims can authorize first-person experience.');
  }
  if (requestedScope === 'personal_view' && claim.owner !== 'user') {
    throw new Error('External or third-party claims cannot be promoted directly to a personal viewpoint.');
  }
}

export function legacyCandidateToClaim(candidate) {
  const learning = candidate.scope === 'learning';
  const approved = candidate.status === 'approved';
  const rejected = candidate.status === 'rejected';
  const kindMap = {
    skill: 'knowledge',
    language_sample: 'expression',
    concept: 'knowledge',
    framework: 'knowledge',
    answer_pattern: 'knowledge',
    case_example: 'example',
  };
  const kind = kindMap[candidate.kind] || candidate.kind || 'knowledge';
  const status = rejected ? 'rejected' : learning ? 'understood' : approved ? 'endorsed' : 'observed';
  const owner = learning ? (candidate.kind === 'case_example' ? 'third_party' : 'external') : 'user';
  return {
    id: candidate.id,
    proposition: candidate.content,
    title: candidate.title,
    kind,
    owner,
    epistemicStatus: status,
    authorizationScope: defaultAuthorization({ owner, kind, status }),
    tags: candidate.tags || [],
    createdAt: candidate.createdAt,
  };
}

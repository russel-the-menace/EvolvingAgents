import { canUseClaim } from './cognition.mjs';

export function tokenize(value) {
  const text = String(value || '').toLowerCase();
  const words = text.match(/[\p{L}\p{N}_-]{2,}/gu) || [];
  const ideographs = text.match(/\p{Script=Han}/gu) || [];
  const bigrams = ideographs.slice(0, -1).map((character, index) => `${character}${ideographs[index + 1]}`);
  return [...new Set([...words, ...bigrams])].slice(0, 80);
}

export function relevance(query, claim) {
  const tokens = Array.isArray(query) ? query : tokenize(query);
  const value = `${claim.title || ''} ${claim.proposition || ''} ${(claim.tags || []).join(' ')}`.toLowerCase();
  return tokens.reduce((score, token) => score + (value.includes(token) ? 1 : 0), 0);
}

export function compileSceneView({ sceneId, sceneType, audience, goal, jd, resume, claims }) {
  const query = `${sceneType} ${audience} ${goal} ${jd}`;
  const ranked = claims
    .filter((claim) => canUseClaim(claim, 'reasoning'))
    .map((claim) => ({ claim, score: relevance(query, claim) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  const knowledgeClaims = ranked
    .filter(({ claim }) => ['knowledge', 'example'].includes(claim.kind))
    .slice(0, 10)
    .map(({ claim }) => claim);
  const personalClaims = ranked
    .filter(({ claim }) => ['personal_experience', 'personal_view'].includes(claim.authorizationScope))
    .slice(0, 8)
    .map(({ claim }) => claim);
  const expressionClaims = claims
    .filter((claim) => claim.kind === 'expression' && claim.owner === 'user' && claim.epistemicStatus === 'endorsed')
    .slice(0, 6);

  return {
    id: sceneId,
    sceneType,
    audience,
    goal,
    jd,
    resume,
    writeBack: false,
    precedence: ['scene_resume', 'authorized_personal_evidence', 'personal_view', 'understood_knowledge', 'third_party_example'],
    knowledgeClaims,
    personalClaims,
    expressionClaims,
    prohibited: [
      'Do not invent employers, projects, responsibilities, dates, metrics, or tenure.',
      'Do not convert external or third-party examples into first-person experience.',
      'Do not write scene-local identity claims back to the longitudinal profile.',
    ],
  };
}

export function makeAnswerPlan({ question, scene }) {
  const queryTokens = tokenize(question);
  const rank = (items) => [...items].sort((a, b) => relevance(queryTokens, b) - relevance(queryTokens, a));
  return {
    question,
    sceneId: scene.id,
    thesisInstruction: 'Answer the question directly, then support it with the strongest authorized evidence.',
    knowledgeClaimIds: rank(scene.knowledgeClaims).slice(0, 5).map((claim) => claim.id),
    personalClaimIds: rank(scene.personalClaims).slice(0, 4).map((claim) => claim.id),
    experiencePolicy: 'Resume facts are scene-authorized. Other first-person experience requires a personal_experience authorization.',
    followupConstraints: scene.prohibited,
  };
}

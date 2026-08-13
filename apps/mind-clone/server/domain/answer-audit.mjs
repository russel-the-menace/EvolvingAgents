function numbers(value) {
  return [...String(value || '').matchAll(/\d+(?:[.,]\d+)?%?/gu)].map((match) => match[0]);
}

export function auditAnswer({ answer, scene, plan, claims }) {
  const authorized = new Set([...plan.knowledgeClaimIds, ...plan.personalClaimIds]);
  const referencedClaims = claims.filter((claim) => authorized.has(claim.id));
  const evidenceText = [scene.resume, scene.jd, ...referencedClaims.map((claim) => claim.proposition)].join('\n');
  const unsupportedNumbers = numbers(answer).filter((number) => !evidenceText.includes(number));
  const firstPersonSentences = String(answer || '').split(/(?<=[。！？.!?])\s*/).filter((sentence) => /(^|\s)(I|my|we|our)\b|我|我们/u.test(sentence));
  const hasExperienceAuthorization = referencedClaims.some((claim) => claim.authorizationScope === 'personal_experience') || scene.resume.trim().length > 0;
  const violations = [];
  if (unsupportedNumbers.length) violations.push({ type: 'unsupported_numeric_claim', values: [...new Set(unsupportedNumbers)] });
  if (firstPersonSentences.length && !hasExperienceAuthorization) violations.push({ type: 'first_person_without_authorized_evidence', count: firstPersonSentences.length });
  if (scene.writeBack !== false) violations.push({ type: 'scene_write_back_enabled' });
  return {
    passed: violations.length === 0,
    violations,
    authorizedClaimIds: [...authorized],
    checkedAt: new Date().toISOString(),
  };
}

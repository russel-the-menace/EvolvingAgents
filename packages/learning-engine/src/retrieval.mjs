import { lexicalScore, tokenize } from './text.mjs';

function temporalMillis(value, endOfDay = false) {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly && endOfDay ? `${value}T23:59:59.999Z` : value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function validAt(claim, now) {
  const instant = new Date(now).getTime();
  const validFrom = temporalMillis(claim.validFrom);
  const validTo = temporalMillis(claim.validTo, true);
  if (validFrom != null && validFrom > instant) return false;
  if (validTo != null && validTo < instant) return false;
  return true;
}

function mergeCandidates(groups) {
  const merged = new Map();
  for (const group of groups) {
    for (const candidate of group || []) {
      const existing = merged.get(candidate.claim.id);
      if (!existing) { merged.set(candidate.claim.id, { ...candidate }); continue; }
      existing.searchScore = Math.max(existing.searchScore || 0, candidate.searchScore || 0);
      existing.evidence = [...new Map([...(existing.evidence || []), ...(candidate.evidence || [])].map((item) => [item.id, item])).values()];
    }
  }
  return [...merged.values()];
}

function matchesFilters(candidate, options) {
  if (options.sourceIds?.length && !candidate.evidence.some((item) => options.sourceIds.includes(item.source?.id || item.sourceId))) return false;
  if (options.owners?.length && !options.owners.includes(candidate.claim.owner)) return false;
  if (options.authorizationScopes?.length && !options.authorizationScopes.includes(candidate.claim.authorizationScope)) return false;
  if (options.sceneId && candidate.claim.sceneId !== options.sceneId) return false;
  return true;
}

function withOriginalContext(store, candidate, options) {
  if (!options.includeOriginal || typeof store.evidenceContext !== 'function') return candidate;
  return { ...candidate, evidence: candidate.evidence.map((item) => ({
    ...item, originalContext: store.evidenceContext(item.id, { paddingChars: options.paddingChars }),
  })) };
}

export async function retrieveKnowledge({ store, policy, reranker, retrievers }, query, options = {}) {
  const limit = Math.max(1, options.limit || 8);
  const candidateLimit = Math.max(limit, options.candidateLimit || limit * 12);
  const now = options.now || new Date().toISOString();
  const context = options.context || {};
  const tokens = tokenize(query);
  const activeRetrievers = retrievers?.length ? retrievers : [
    ({ store: activeStore, query: activeQuery, limit: activeLimit }) => activeStore.searchClaims(activeQuery, { limit: activeLimit }),
  ];
  const candidates = mergeCandidates(await Promise.all(activeRetrievers.map((retriever) => retriever({
    store, query, limit: candidateLimit, context, now,
  }))));
  const eligible = [];
  for (const candidate of candidates.filter((item) => validAt(item.claim, now) && matchesFilters(item, options))) {
    if (await policy.canRetrieve({ ...candidate, query, now, context })) eligible.push(candidate);
  }
  let ranked = eligible.map((candidate) => ({
    ...candidate,
    score: candidate.searchScore + lexicalScore(tokens, `${candidate.claim.title} ${candidate.claim.proposition} ${(candidate.claim.tags || []).join(' ')}`),
  }));
  ranked = ranked.filter((candidate) => candidate.score > 0 || options.includeZeroScore);
  if (reranker) {
    const reranked = await reranker({ query, candidates: ranked, context, limit });
    return (reranked || []).slice(0, limit).map((candidate) => withOriginalContext(store, candidate, options));
  }
  return ranked.sort((left, right) => right.score - left.score).slice(0, limit)
    .map((candidate) => withOriginalContext(store, candidate, options));
}

export function buildEvidenceContext(results) {
  return results.map((result, index) => {
    const citation = `E${index + 1}`;
    const evidence = result.evidence.map((item) => item.text).join(' | ');
    const sources = [...new Set(result.evidence.map((item) => item.source?.title).filter(Boolean))].join('; ');
    return { citation, claimId: result.claim.id, text: `[${citation}] ${result.claim.proposition}`, evidence, sources };
  });
}

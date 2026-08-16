import { randomUUID } from 'node:crypto';
import { chunkDocument, locateEvidence } from './chunking.mjs';
import { buildEvidenceContext, retrieveKnowledge } from './retrieval.mjs';
import { contentChecksum } from './sqlite-store.mjs';
import { normalizeText } from './text.mjs';

const defaultPolicy = {
  mapProposal: ({ proposal, chunk, source }) => ({
    claim: {
      title: proposal.title || 'Untitled claim', proposition: proposal.proposition, kind: proposal.kind || 'knowledge',
      owner: proposal.owner || source.sourceActor || 'source', epistemicStatus: proposal.epistemicStatus || 'active',
      authorizationScope: proposal.authorizationScope || 'knowledge', contextScope: proposal.contextScope || [],
      tags: proposal.tags || [], attributes: proposal.attributes || {}, confidence: proposal.confidence ?? 0.5,
      validFrom: proposal.validFrom, validTo: proposal.validTo,
    },
    evidence: [{ ...locateEvidence(chunk, proposal.sourceQuote || chunk.text), ordinal: chunk.ordinal,
      owner: proposal.owner || source.sourceActor || 'source' }],
  }),
  canRetrieve: () => true,
};

const sensitiveMetadataKeys = new Set([
  'apikey', 'authorization', 'cookie', 'cookies', 'credential', 'credentials', 'password',
  'refreshtoken', 'sessiontoken', 'setcookie', 'token', 'accesstoken',
]);

function assertMetadataContainsNoCredentials(value, path = 'metadata') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (sensitiveMetadataKeys.has(normalizedKey)) {
      throw new Error(`Credentials must not be persisted in learning-engine metadata (${path}.${key}).`);
    }
    assertMetadataContainsNoCredentials(child, `${path}.${key}`);
  }
}

function mergeRecords(records) {
  const groups = new Map();
  for (const record of records.filter((item) => item?.claim?.proposition)) {
    const key = `${record.claim.kind || ''}\u0000${record.claim.owner || ''}\u0000${normalizeText(record.claim.proposition)}`;
    const existing = groups.get(key);
    if (!existing) { groups.set(key, { ...record, claim: { id: record.claim.id || randomUUID(), ...record.claim }, evidence: [...(record.evidence || [])] }); continue; }
    existing.evidence.push(...(record.evidence || []));
    existing.claim.tags = [...new Set([...(existing.claim.tags || []), ...(record.claim.tags || [])])];
    existing.claim.confidence = Math.max(existing.claim.confidence || 0, record.claim.confidence || 0);
  }
  return [...groups.values()];
}

export function createLearningEngine(options) {
  if (!options?.store) throw new Error('A learning-engine store is required.');
  if (!options?.extractor?.extract) throw new Error('An extractor implementing extract({ source, chunk }) is required.');
  const policy = { ...defaultPolicy, ...(options.policy || {}) };
  const chunker = options.chunker || chunkDocument;
  const engine = {
    async ingest(source, ingestOptions = {}) {
      if (!source?.title || !String(source.content || '').trim()) throw new Error('A source title and non-empty content are required.');
      assertMetadataContainsNoCredentials(source.metadata);
      const checksum = source.checksum || contentChecksum(source.content);
      const duplicate = options.store.findSourceByChecksum ? options.store.findSourceByChecksum(checksum) : null;
      if (ingestOptions.deduplicate !== false && duplicate) return { source: duplicate, duplicate: true };
      return { source: options.store.addSource({ ...source, checksum }), duplicate: false };
    },
    async learn(sourceId, learnOptions = {}) {
      const source = options.store.getSource(sourceId);
      if (!source) throw new Error(`Source was not found: ${sourceId}`);
      const chunks = chunker(source.content, { ...options.chunking, ...learnOptions.chunking });
      const records = [];
      for (const chunk of chunks) {
        const proposals = await options.extractor.extract({ source, chunk, context: learnOptions.context || {} });
        for (const proposal of proposals || []) {
          const mapped = await policy.mapProposal({ proposal, source, chunk, context: learnOptions.context || {} });
          if (mapped) records.push(mapped);
        }
      }
      const merged = mergeRecords(records);
      if (policy.beforeReplaceSource) await policy.beforeReplaceSource({ source, records: merged, store: options.store });
      const claims = options.store.replaceSourceClaims(source.id, merged);
      options.store.markSourceExtracted(source.id);
      if (policy.afterLearn) await policy.afterLearn({ source: options.store.getSource(source.id), chunks, claims, records: merged, store: options.store });
      return { source: options.store.getSource(source.id), chunks, claims, records: merged };
    },
    retrieve: (query, retrieveOptions) => retrieveKnowledge({
      store: options.store, policy, reranker: options.reranker, retrievers: options.retrievers,
    }, query, retrieveOptions),
    retrieveEvidence: (query, retrieveOptions = {}) => retrieveKnowledge({
      store: options.store, policy, reranker: options.reranker, retrievers: options.retrievers,
    }, query, { ...retrieveOptions, includeOriginal: true }),
    buildEvidenceContext,
  };
  return engine;
}

import { createHash, randomUUID } from 'node:crypto';
import { normalizeText, tokenize } from './text.mjs';

function json(value, fallback = []) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

export function contentChecksum(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function columnNames(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

export function installLearningSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, source_type TEXT NOT NULL, content TEXT NOT NULL,
      source_uri TEXT, source_actor TEXT, checksum TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, extracted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS sources_checksum_idx ON sources(checksum);
    CREATE TABLE IF NOT EXISTS evidence_units (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL, speaker TEXT, owner TEXT NOT NULL,
      start_offset INTEGER, end_offset INTEGER, attributes_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, proposition TEXT NOT NULL, kind TEXT NOT NULL,
      owner TEXT NOT NULL, epistemic_status TEXT NOT NULL, authorization_scope TEXT NOT NULL DEFAULT 'none',
      context_scope_json TEXT NOT NULL DEFAULT '[]', tags_json TEXT NOT NULL DEFAULT '[]', attributes_json TEXT NOT NULL DEFAULT '{}',
      confidence REAL NOT NULL DEFAULT 0.5, valid_from TEXT, valid_to TEXT, superseded_by TEXT, scene_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS claim_evidence (
      claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      evidence_id TEXT NOT NULL REFERENCES evidence_units(id) ON DELETE CASCADE,
      relation TEXT NOT NULL DEFAULT 'supports', PRIMARY KEY (claim_id, evidence_id, relation)
    );
    CREATE TABLE IF NOT EXISTS claim_relations (
      from_claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      to_claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      relation TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (from_claim_id, to_claim_id, relation)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS claim_search USING fts5(claim_id UNINDEXED, title, proposition, tags);
  `);
  if (!columnNames(db, 'evidence_units').has('attributes_json')) db.exec("ALTER TABLE evidence_units ADD COLUMN attributes_json TEXT NOT NULL DEFAULT '{}'");
  if (!columnNames(db, 'claims').has('attributes_json')) db.exec("ALTER TABLE claims ADD COLUMN attributes_json TEXT NOT NULL DEFAULT '{}'");
}

function mapSource(row) {
  return row && { id: row.id, title: row.title, sourceType: row.source_type, content: row.content,
    sourceUri: row.source_uri, sourceActor: row.source_actor, checksum: row.checksum,
    metadata: json(row.metadata_json, {}), createdAt: row.created_at, extractedAt: row.extracted_at };
}

function mapClaim(row) {
  return row && { id: row.id, title: row.title, proposition: row.proposition, kind: row.kind, owner: row.owner,
    epistemicStatus: row.epistemic_status, authorizationScope: row.authorization_scope,
    contextScope: json(row.context_scope_json), tags: json(row.tags_json), attributes: json(row.attributes_json, {}),
    confidence: row.confidence, validFrom: row.valid_from, validTo: row.valid_to, supersededBy: row.superseded_by,
    sceneId: row.scene_id, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapEvidence(row) {
  return row && { id: row.id, sourceId: row.source_id, ordinal: row.ordinal, text: row.text, speaker: row.speaker,
    owner: row.owner, startOffset: row.start_offset, endOffset: row.end_offset,
    attributes: json(row.attributes_json, {}), createdAt: row.created_at };
}

function writeSearchRow(db, claim) {
  const terms = tokenize(`${claim.title} ${claim.proposition} ${(claim.tags || []).join(' ')}`).join(' ');
  db.prepare('DELETE FROM claim_search WHERE claim_id = ?').run(claim.id);
  db.prepare('INSERT INTO claim_search (claim_id, title, proposition, tags) VALUES (?, ?, ?, ?)')
    .run(claim.id, claim.title, claim.proposition, `${(claim.tags || []).join(' ')} ${terms}`);
}

function insertClaim(db, claim) {
  const now = claim.createdAt || new Date().toISOString();
  const id = claim.id || randomUUID();
  db.prepare(`INSERT INTO claims
    (id, title, proposition, kind, owner, epistemic_status, authorization_scope, context_scope_json, tags_json,
     attributes_json, confidence, valid_from, valid_to, superseded_by, scene_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, proposition=excluded.proposition, kind=excluded.kind,
      owner=excluded.owner, epistemic_status=excluded.epistemic_status, authorization_scope=excluded.authorization_scope,
      context_scope_json=excluded.context_scope_json, tags_json=excluded.tags_json, attributes_json=excluded.attributes_json,
      confidence=excluded.confidence, valid_from=excluded.valid_from, valid_to=excluded.valid_to,
      superseded_by=excluded.superseded_by, scene_id=excluded.scene_id, updated_at=excluded.updated_at`)
    .run(id, claim.title || 'Untitled claim', claim.proposition, claim.kind || 'knowledge', claim.owner || 'source',
      claim.epistemicStatus || 'active', claim.authorizationScope || 'knowledge', JSON.stringify(claim.contextScope || []),
      JSON.stringify(claim.tags || []), JSON.stringify(claim.attributes || {}), claim.confidence ?? 0.5,
      claim.validFrom || null, claim.validTo || null, claim.supersededBy || null, claim.sceneId || null, now, now);
  const saved = mapClaim(db.prepare('SELECT * FROM claims WHERE id = ?').get(id));
  writeSearchRow(db, saved);
  return saved;
}

function deleteClaimsForSource(db, sourceId) {
  const claimIds = db.prepare(`SELECT DISTINCT claim_id FROM claim_evidence
    JOIN evidence_units ON evidence_units.id = claim_evidence.evidence_id WHERE evidence_units.source_id = ?`)
    .all(sourceId).map((row) => row.claim_id);
  const deleteSearch = db.prepare('DELETE FROM claim_search WHERE claim_id = ?');
  const deleteClaim = db.prepare('DELETE FROM claims WHERE id = ?');
  for (const claimId of claimIds) { deleteSearch.run(claimId); deleteClaim.run(claimId); }
  db.prepare('DELETE FROM evidence_units WHERE source_id = ?').run(sourceId);
  return claimIds;
}

export function createSqliteLearningStore(db) {
  installLearningSchema(db);
  return {
    db,
    listSources: () => db.prepare('SELECT * FROM sources ORDER BY created_at DESC').all().map(mapSource),
    getSource: (id) => mapSource(db.prepare('SELECT * FROM sources WHERE id = ?').get(id)),
    findSourceByChecksum: (checksum) => mapSource(db.prepare('SELECT * FROM sources WHERE checksum = ? ORDER BY created_at DESC LIMIT 1').get(checksum)),
    addSource: (source) => {
      const id = source.id || randomUUID();
      const now = source.createdAt || new Date().toISOString();
      db.prepare(`INSERT INTO sources
        (id, title, source_type, content, source_uri, source_actor, checksum, metadata_json, created_at, extracted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, source_type=excluded.source_type, content=excluded.content,
          source_uri=excluded.source_uri, source_actor=excluded.source_actor, checksum=excluded.checksum,
          metadata_json=excluded.metadata_json`)
        .run(id, String(source.title || 'Untitled source').slice(0, 300), source.sourceType || 'document', String(source.content || ''),
          source.sourceUri || null, source.sourceActor || null, source.checksum || contentChecksum(source.content),
          JSON.stringify(source.metadata || {}), now, source.extractedAt || null);
      return mapSource(db.prepare('SELECT * FROM sources WHERE id = ?').get(id));
    },
    markSourceExtracted: (id) => db.prepare('UPDATE sources SET extracted_at = ? WHERE id = ?').run(new Date().toISOString(), id),
    deleteClaimsForSource: (sourceId) => {
      db.exec('BEGIN IMMEDIATE');
      try { const ids = deleteClaimsForSource(db, sourceId); db.exec('COMMIT'); return ids.length; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    addEvidence: (evidence) => {
      const id = evidence.id || randomUUID();
      db.prepare(`INSERT INTO evidence_units
        (id, source_id, ordinal, text, speaker, owner, start_offset, end_offset, attributes_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, evidence.sourceId, evidence.ordinal || 0, evidence.text, evidence.speaker || null, evidence.owner || 'source',
          evidence.startOffset ?? null, evidence.endOffset ?? null, JSON.stringify(evidence.attributes || {}),
          evidence.createdAt || new Date().toISOString());
      return id;
    },
    addClaim: (claim, evidenceId) => {
      const saved = insertClaim(db, claim);
      if (evidenceId) db.prepare('INSERT OR IGNORE INTO claim_evidence (claim_id, evidence_id, relation) VALUES (?, ?, ?)')
        .run(saved.id, evidenceId, 'supports');
      return saved;
    },
    replaceSourceClaims: (sourceId, records) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        deleteClaimsForSource(db, sourceId);
        const claims = [];
        for (const record of records) {
          const claim = insertClaim(db, record.claim);
          for (const evidence of record.evidence || []) {
            const evidenceId = randomUUID();
            db.prepare(`INSERT INTO evidence_units
              (id, source_id, ordinal, text, speaker, owner, start_offset, end_offset, attributes_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
              .run(evidenceId, sourceId, evidence.ordinal || 0, evidence.text, evidence.speaker || null,
                evidence.owner || record.claim.owner || 'source', evidence.startOffset ?? null, evidence.endOffset ?? null,
                JSON.stringify(evidence.attributes || {}), new Date().toISOString());
            db.prepare('INSERT INTO claim_evidence (claim_id, evidence_id, relation) VALUES (?, ?, ?)')
              .run(claim.id, evidenceId, evidence.relation || 'supports');
          }
          claims.push(claim);
        }
        db.exec('COMMIT');
        return claims;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    addClaimRelation: (fromClaimId, toClaimId, relation) => db.prepare(
      'INSERT OR IGNORE INTO claim_relations (from_claim_id, to_claim_id, relation, created_at) VALUES (?, ?, ?, ?)',
    ).run(fromClaimId, toClaimId, relation, new Date().toISOString()),
    getClaim: (id) => mapClaim(db.prepare('SELECT * FROM claims WHERE id = ?').get(id)),
    listClaims: () => db.prepare('SELECT * FROM claims ORDER BY updated_at DESC').all().map(mapClaim),
    updateClaim: (id, values) => {
      const current = mapClaim(db.prepare('SELECT * FROM claims WHERE id = ?').get(id));
      if (!current) return null;
      return insertClaim(db, { ...current, ...values, id, createdAt: current.createdAt });
    },
    evidenceForClaim: (claimId) => db.prepare(`SELECT evidence_units.*, sources.id AS s_id, sources.title AS s_title,
      sources.source_type AS s_type, sources.source_uri AS s_uri, sources.source_actor AS s_actor,
      sources.metadata_json AS s_metadata, sources.created_at AS s_created, sources.checksum AS s_checksum
      FROM evidence_units JOIN claim_evidence ON claim_evidence.evidence_id = evidence_units.id
      JOIN sources ON sources.id = evidence_units.source_id WHERE claim_evidence.claim_id = ? ORDER BY evidence_units.ordinal`)
      .all(claimId).map((row) => ({ ...mapEvidence(row), source: { id: row.s_id, title: row.s_title, sourceType: row.s_type,
        sourceUri: row.s_uri, sourceActor: row.s_actor, metadata: json(row.s_metadata, {}), createdAt: row.s_created, checksum: row.s_checksum } })),
    searchClaims: (query, options = {}) => {
      const limit = Math.max(1, options.limit || 100);
      const terms = tokenize(query);
      let rows = [];
      if (terms.length) {
        const match = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ');
        try {
          rows = db.prepare(`SELECT claims.*, bm25(claim_search) AS rank FROM claim_search
            JOIN claims ON claims.id = claim_search.claim_id WHERE claim_search MATCH ? ORDER BY rank LIMIT ?`).all(match, limit);
        } catch { rows = []; }
      }
      if (!rows.length) rows = db.prepare('SELECT *, 10 AS rank FROM claims ORDER BY updated_at DESC LIMIT ?').all(limit);
      return rows.map((row) => {
        const claim = mapClaim(row);
        return { claim, evidence: db.prepare(`SELECT evidence_units.*, sources.id AS s_id, sources.title AS s_title,
          sources.source_type AS s_type, sources.source_uri AS s_uri, sources.source_actor AS s_actor,
          sources.metadata_json AS s_metadata, sources.created_at AS s_created, sources.checksum AS s_checksum
          FROM evidence_units JOIN claim_evidence ON claim_evidence.evidence_id = evidence_units.id
          JOIN sources ON sources.id = evidence_units.source_id WHERE claim_evidence.claim_id = ? ORDER BY evidence_units.ordinal`)
          .all(claim.id).map((item) => ({ ...mapEvidence(item), source: { id: item.s_id, title: item.s_title,
            sourceType: item.s_type, sourceUri: item.s_uri, sourceActor: item.s_actor,
            metadata: json(item.s_metadata, {}), createdAt: item.s_created, checksum: item.s_checksum } })),
          searchScore: Number.isFinite(row.rank) && row.rank !== 10 ? 1 / (1 + Math.abs(row.rank)) : 0 };
      });
    },
  };
}

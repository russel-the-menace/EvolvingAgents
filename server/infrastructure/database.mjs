import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { legacyCandidateToClaim } from '../domain/cognition.mjs';

function json(value, fallback = []) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function checksum(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

export function openDatabase(path, legacyPath) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, source_type TEXT NOT NULL, content TEXT NOT NULL,
      source_uri TEXT, source_actor TEXT, checksum TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, extracted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS evidence_units (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL, speaker TEXT, owner TEXT NOT NULL,
      start_offset INTEGER, end_offset INTEGER, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, proposition TEXT NOT NULL, kind TEXT NOT NULL,
      owner TEXT NOT NULL, epistemic_status TEXT NOT NULL, authorization_scope TEXT NOT NULL DEFAULT 'none',
      context_scope_json TEXT NOT NULL DEFAULT '[]', tags_json TEXT NOT NULL DEFAULT '[]', confidence REAL NOT NULL DEFAULT 0.5,
      valid_from TEXT, valid_to TEXT, superseded_by TEXT, scene_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
    CREATE TABLE IF NOT EXISTS authorization_events (
      id TEXT PRIMARY KEY, claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      from_status TEXT NOT NULL, to_status TEXT NOT NULL, from_scope TEXT NOT NULL, to_scope TEXT NOT NULL,
      reason TEXT NOT NULL, evidence_source_id TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY, scene_type TEXT NOT NULL, audience TEXT NOT NULL, goal TEXT NOT NULL,
      jd TEXT NOT NULL, resume TEXT NOT NULL, snapshot_json TEXT NOT NULL, write_back INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, expires_at TEXT
    );
    CREATE TABLE IF NOT EXISTS inquiry_items (
      id TEXT PRIMARY KEY, claim_id TEXT, question TEXT NOT NULL, reason TEXT NOT NULL,
      priority REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL, resolved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS answer_runs (
      id TEXT PRIMARY KEY, scene_id TEXT REFERENCES scenes(id), question TEXT NOT NULL,
      plan_json TEXT NOT NULL, answer TEXT, audit_json TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, ordinal INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS claim_search USING fts5(claim_id UNINDEXED, title, proposition, tags);
  `);

  const migrated = db.prepare("SELECT value FROM meta WHERE key = 'legacy_json_migrated_v1'").get();
  if (!migrated && legacyPath) migrateLegacy(db, legacyPath);
  return createRepository(db);
}

function migrateLegacy(db, legacyPath) {
  let store;
  try { store = JSON.parse(readFileSync(legacyPath, 'utf8')); } catch { store = null; }
  db.exec('BEGIN IMMEDIATE');
  try {
    if (store) {
      for (const document of store.documents || []) {
        insertSource(db, { ...document, sourceType: document.sourceType || 'note' });
      }
      for (const candidate of store.memories || []) {
        const claim = legacyCandidateToClaim(candidate);
        const source = db.prepare('SELECT id FROM sources WHERE id = ?').get(candidate.documentId);
        if (!source) continue;
        const evidenceId = randomUUID();
        db.prepare(`INSERT OR IGNORE INTO evidence_units
          (id, source_id, ordinal, text, speaker, owner, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)`)
          .run(evidenceId, candidate.documentId, candidate.sourceQuote || candidate.content, claim.owner === 'user' ? 'user' : 'source_author', claim.owner, candidate.createdAt || new Date().toISOString());
        insertClaim(db, claim, evidenceId);
      }
      for (const session of store.sessions || []) {
        db.prepare('INSERT OR IGNORE INTO sessions (id, title, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(session.id, session.title, session.pinned ? 1 : 0, session.createdAt, session.updatedAt);
        (session.messages || []).forEach((message, ordinal) => {
          db.prepare('INSERT OR IGNORE INTO messages (id, session_id, role, content, created_at, ordinal) VALUES (?, ?, ?, ?, ?, ?)')
            .run(message.id, session.id, message.role, message.content, message.createdAt, ordinal);
        });
      }
    }
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('legacy_json_migrated_v1', ?)").run(new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function insertSource(db, source) {
  const now = source.createdAt || new Date().toISOString();
  const id = source.id || randomUUID();
  db.prepare(`INSERT OR IGNORE INTO sources
    (id, title, source_type, content, source_uri, source_actor, checksum, metadata_json, created_at, extracted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, String(source.title).slice(0, 160), source.sourceType, source.content, source.sourceUri || null,
      source.sourceActor || null, checksum(source.content), JSON.stringify(source.metadata || {}), now, source.extractedAt || null);
  return getSource(db, id);
}

function getSource(db, id) {
  const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  return row && mapSource(row);
}

function insertClaim(db, claim, evidenceId) {
  const now = claim.createdAt || new Date().toISOString();
  const id = claim.id || randomUUID();
  db.prepare(`INSERT OR REPLACE INTO claims
    (id, title, proposition, kind, owner, epistemic_status, authorization_scope, context_scope_json, tags_json,
     confidence, valid_from, valid_to, superseded_by, scene_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, claim.title || 'Untitled claim', claim.proposition, claim.kind, claim.owner,
      claim.epistemicStatus, claim.authorizationScope || 'none', JSON.stringify(claim.contextScope || []),
      JSON.stringify(claim.tags || []), claim.confidence ?? 0.5, claim.validFrom || null, claim.validTo || null,
      claim.supersededBy || null, claim.sceneId || null, now, now);
  if (evidenceId) db.prepare('INSERT OR IGNORE INTO claim_evidence (claim_id, evidence_id, relation) VALUES (?, ?, ?)').run(id, evidenceId, 'supports');
  const saved = db.prepare('SELECT * FROM claims WHERE id = ?').get(id);
  db.prepare('DELETE FROM claim_search WHERE claim_id = ?').run(id);
  db.prepare('INSERT INTO claim_search (claim_id, title, proposition, tags) VALUES (?, ?, ?, ?)')
    .run(id, saved.title, saved.proposition, saved.tags_json);
  return mapClaim(saved);
}

function mapSource(row) {
  return { id: row.id, title: row.title, sourceType: row.source_type, content: row.content, sourceUri: row.source_uri,
    sourceActor: row.source_actor, createdAt: row.created_at, extractedAt: row.extracted_at, metadata: json(row.metadata_json, {}) };
}

function mapClaim(row) {
  return { id: row.id, title: row.title, proposition: row.proposition, kind: row.kind, owner: row.owner,
    epistemicStatus: row.epistemic_status, authorizationScope: row.authorization_scope,
    contextScope: json(row.context_scope_json), tags: json(row.tags_json), confidence: row.confidence,
    validFrom: row.valid_from, validTo: row.valid_to, supersededBy: row.superseded_by, sceneId: row.scene_id,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapSession(db, row) {
  const messages = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY ordinal').all(row.id)
    .map((message) => ({ id: message.id, role: message.role, content: message.content, createdAt: message.created_at }));
  return { id: row.id, title: row.title, pinned: Boolean(row.pinned), createdAt: row.created_at, updatedAt: row.updated_at, messages };
}

function createRepository(db) {
  return {
    db,
    listSources: () => db.prepare('SELECT * FROM sources ORDER BY created_at DESC').all().map(mapSource),
    getSource: (id) => getSource(db, id),
    addSource: (source) => insertSource(db, source),
    markSourceExtracted: (id) => db.prepare('UPDATE sources SET extracted_at = ? WHERE id = ?').run(new Date().toISOString(), id),
    deleteClaimsForSource: (sourceId) => db.prepare(`DELETE FROM claims WHERE id IN (
      SELECT claim_id FROM claim_evidence JOIN evidence_units ON evidence_units.id = claim_evidence.evidence_id WHERE evidence_units.source_id = ?
    )`).run(sourceId),
    addEvidence: ({ sourceId, text, speaker, owner, ordinal = 0 }) => {
      const id = randomUUID();
      db.prepare('INSERT INTO evidence_units (id, source_id, ordinal, text, speaker, owner, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, sourceId, ordinal, text, speaker || null, owner, new Date().toISOString());
      return id;
    },
    addClaim: (claim, evidenceId) => insertClaim(db, { ...claim, id: claim.id || randomUUID() }, evidenceId),
    addClaimRelation: (fromClaimId, toClaimId, relation) => db.prepare(
      'INSERT OR IGNORE INTO claim_relations (from_claim_id, to_claim_id, relation, created_at) VALUES (?, ?, ?, ?)',
    ).run(fromClaimId, toClaimId, relation, new Date().toISOString()),
    getClaim: (id) => { const row = db.prepare('SELECT * FROM claims WHERE id = ?').get(id); return row && mapClaim(row); },
    listClaims: () => db.prepare('SELECT * FROM claims ORDER BY updated_at DESC').all().map(mapClaim),
    updateClaim: (id, values) => {
      db.prepare(`UPDATE claims SET epistemic_status = ?, authorization_scope = ?, updated_at = ?, superseded_by = COALESCE(?, superseded_by) WHERE id = ?`)
        .run(values.epistemicStatus, values.authorizationScope, new Date().toISOString(), values.supersededBy || null, id);
      return mapClaim(db.prepare('SELECT * FROM claims WHERE id = ?').get(id));
    },
    addAuthorizationEvent: (event) => db.prepare(`INSERT INTO authorization_events
      (id, claim_id, from_status, to_status, from_scope, to_scope, reason, evidence_source_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), event.claimId, event.fromStatus, event.toStatus, event.fromScope, event.toScope,
        event.reason, event.evidenceSourceId || null, new Date().toISOString()),
    listAuthorizationEvents: () => db.prepare('SELECT * FROM authorization_events ORDER BY created_at DESC').all(),
    addScene: (scene) => db.prepare(`INSERT INTO scenes
      (id, scene_type, audience, goal, jd, resume, snapshot_json, write_back, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
      .run(scene.id, scene.sceneType, scene.audience, scene.goal, scene.jd, scene.resume, JSON.stringify(scene), new Date().toISOString(), scene.expiresAt || null),
    getScene: (id) => { const row = db.prepare('SELECT * FROM scenes WHERE id = ?').get(id); return row ? json(row.snapshot_json, {}) : null; },
    addInquiry: (item) => {
      const record = { id: randomUUID(), status: 'queued', createdAt: new Date().toISOString(), ...item };
      db.prepare('INSERT INTO inquiry_items (id, claim_id, question, reason, priority, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(record.id, record.claimId || null, record.question, record.reason, record.priority || 0, record.status, record.createdAt);
      return record;
    },
    listInquiries: () => db.prepare("SELECT * FROM inquiry_items WHERE status = 'queued' ORDER BY priority DESC, created_at").all(),
    resolveInquiry: (id, status = 'resolved') => db.prepare('UPDATE inquiry_items SET status = ?, resolved_at = ? WHERE id = ?').run(status, new Date().toISOString(), id),
    addAnswerRun: (run) => {
      const id = randomUUID();
      db.prepare('INSERT INTO answer_runs (id, scene_id, question, plan_json, answer, audit_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, run.sceneId || null, run.question, JSON.stringify(run.plan), run.answer || null, JSON.stringify(run.audit || {}), new Date().toISOString());
      return id;
    },
    listSessions: () => db.prepare('SELECT * FROM sessions ORDER BY pinned DESC, updated_at DESC').all().map((row) => mapSession(db, row)),
    getSession: (id) => { const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id); return row && mapSession(db, row); },
    createSession: () => {
      const now = new Date().toISOString(); const id = randomUUID();
      db.prepare('INSERT INTO sessions (id, title, pinned, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run(id, 'New conversation', now, now);
      return mapSession(db, db.prepare('SELECT * FROM sessions WHERE id = ?').get(id));
    },
    updateSession: (id, values) => {
      const current = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id); if (!current) return null;
      db.prepare('UPDATE sessions SET title = ?, pinned = ?, updated_at = ? WHERE id = ?')
        .run(values.title ?? current.title, values.pinned == null ? current.pinned : values.pinned ? 1 : 0, new Date().toISOString(), id);
      return mapSession(db, db.prepare('SELECT * FROM sessions WHERE id = ?').get(id));
    },
    addMessage: (sessionId, message) => {
      const count = db.prepare('SELECT COUNT(*) AS count FROM messages WHERE session_id = ?').get(sessionId).count;
      const record = { id: randomUUID(), createdAt: new Date().toISOString(), ...message };
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at, ordinal) VALUES (?, ?, ?, ?, ?, ?)')
        .run(record.id, sessionId, record.role, record.content, record.createdAt, count);
      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(record.createdAt, sessionId);
      return record;
    },
    truncateSession: (sessionId, messageId) => {
      const row = db.prepare('SELECT ordinal FROM messages WHERE id = ? AND session_id = ?').get(messageId, sessionId);
      if (!row) return false;
      db.prepare('DELETE FROM messages WHERE session_id = ? AND ordinal >= ?').run(sessionId, row.ordinal);
      return true;
    },
    deleteSession: (id) => db.prepare('DELETE FROM sessions WHERE id = ?').run(id),
    close: () => db.close(),
  };
}

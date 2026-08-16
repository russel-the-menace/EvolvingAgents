import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { legacyCandidateToClaim } from '../domain/cognition.mjs';
import { createSqliteLearningStore } from '@evolving-agents/learning-engine';
import { createChatHistoryStore } from '@evolving-agents/chat-history';

function json(value, fallback = []) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

export function openDatabase(path, legacyPath) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
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
      priority REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL, resolved_at TEXT,
      session_id TEXT, presented_at TEXT, response_text TEXT, resolution TEXT
    );
    CREATE TABLE IF NOT EXISTS answer_runs (
      id TEXT PRIMARY KEY, scene_id TEXT REFERENCES scenes(id), question TEXT NOT NULL,
      context_run_id TEXT, plan_json TEXT NOT NULL, answer TEXT, audit_json TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS context_runs (
      id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
      scene_id TEXT REFERENCES scenes(id) ON DELETE CASCADE, question TEXT NOT NULL,
      strategy TEXT NOT NULL, budget_chars INTEGER NOT NULL, used_chars INTEGER NOT NULL,
      total_messages INTEGER NOT NULL DEFAULT 0, omitted_messages INTEGER NOT NULL DEFAULT 0,
      omitted_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS context_run_items (
      run_id TEXT NOT NULL REFERENCES context_runs(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL, item_type TEXT NOT NULL, item_id TEXT,
      source_id TEXT, evidence_id TEXT, selection_reason TEXT NOT NULL,
      char_count INTEGER NOT NULL, content TEXT NOT NULL,
      PRIMARY KEY (run_id, ordinal)
    );
    CREATE TABLE IF NOT EXISTS context_summaries (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      summary_type TEXT NOT NULL, content TEXT NOT NULL, message_ids_json TEXT NOT NULL,
      covered_through_ordinal INTEGER NOT NULL, version INTEGER NOT NULL,
      created_at TEXT NOT NULL, superseded_at TEXT
    );
    CREATE TABLE IF NOT EXISTS scene_summaries (
      id TEXT PRIMARY KEY, scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
      content TEXT NOT NULL, answer_run_ids_json TEXT NOT NULL,
      covered_through_ordinal INTEGER NOT NULL, version INTEGER NOT NULL,
      created_at TEXT NOT NULL, superseded_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, ordinal INTEGER NOT NULL
    );
  `);
  const inquiryColumns = new Set(db.prepare('PRAGMA table_info(inquiry_items)').all().map((row) => row.name));
  if (!inquiryColumns.has('session_id')) db.exec('ALTER TABLE inquiry_items ADD COLUMN session_id TEXT');
  if (!inquiryColumns.has('presented_at')) db.exec('ALTER TABLE inquiry_items ADD COLUMN presented_at TEXT');
  if (!inquiryColumns.has('response_text')) db.exec('ALTER TABLE inquiry_items ADD COLUMN response_text TEXT');
  if (!inquiryColumns.has('resolution')) db.exec('ALTER TABLE inquiry_items ADD COLUMN resolution TEXT');
  const answerRunColumns = new Set(db.prepare('PRAGMA table_info(answer_runs)').all().map((row) => row.name));
  if (!answerRunColumns.has('context_run_id')) db.exec('ALTER TABLE answer_runs ADD COLUMN context_run_id TEXT');
  const learningStore = createSqliteLearningStore(db);
  const chatHistory = createChatHistoryStore(db);

  const migrated = db.prepare("SELECT value FROM meta WHERE key = 'legacy_json_migrated_v1'").get();
  if (!migrated && legacyPath) migrateLegacy(db, legacyPath, learningStore);
  return createRepository(db, learningStore, chatHistory);
}

function migrateLegacy(db, legacyPath, learningStore) {
  let store;
  try { store = JSON.parse(readFileSync(legacyPath, 'utf8')); } catch { store = null; }
  db.exec('BEGIN IMMEDIATE');
  try {
    if (store) {
      for (const document of store.documents || []) {
        learningStore.addSource({ ...document, sourceType: document.sourceType || 'note' });
      }
      for (const candidate of store.memories || []) {
        const claim = legacyCandidateToClaim(candidate);
        const source = db.prepare('SELECT id FROM sources WHERE id = ?').get(candidate.documentId);
        if (!source) continue;
        const evidenceId = learningStore.addEvidence({
          sourceId: candidate.documentId, ordinal: 0, text: candidate.sourceQuote || candidate.content,
          speaker: claim.owner === 'user' ? 'user' : 'source_author', owner: claim.owner,
          createdAt: candidate.createdAt || new Date().toISOString(),
        });
        learningStore.addClaim(claim, evidenceId);
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

function mapClaim(row) {
  return { id: row.id, title: row.title, proposition: row.proposition, kind: row.kind, owner: row.owner,
    epistemicStatus: row.epistemic_status, authorizationScope: row.authorization_scope,
    contextScope: json(row.context_scope_json), tags: json(row.tags_json), attributes: json(row.attributes_json, {}), confidence: row.confidence,
    validFrom: row.valid_from, validTo: row.valid_to, supersededBy: row.superseded_by, sceneId: row.scene_id,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapSession(db, row) {
  const messages = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY ordinal').all(row.id)
    .map((message) => ({ id: message.id, role: message.role, content: message.content, createdAt: message.created_at }));
  return { id: row.id, title: row.title, pinned: Boolean(row.pinned), createdAt: row.created_at, updatedAt: row.updated_at, messages };
}

function deleteConversationSources(db, learningStore, sessionId, messageIds) {
  if (!messageIds.length) return 0;
  const placeholders = messageIds.map(() => '?').join(',');
  const sourceIds = db.prepare(`SELECT id FROM sources
    WHERE json_extract(metadata_json, '$.sessionId') = ?
    AND json_extract(metadata_json, '$.userMessageId') IN (${placeholders})`).all(sessionId, ...messageIds).map((row) => row.id);
  for (const sourceId of sourceIds) {
    learningStore.deleteClaimsForSource(sourceId);
    db.prepare('DELETE FROM sources WHERE id = ?').run(sourceId);
  }
  return sourceIds.length;
}

function createRepository(db, learningStore, chatHistory) {
  return {
    ...learningStore,
    db,
    deleteInquiriesForSource: (sourceId) => db.prepare(`DELETE FROM inquiry_items WHERE claim_id IN (
      SELECT claim_id FROM claim_evidence JOIN evidence_units ON evidence_units.id = claim_evidence.evidence_id
      WHERE evidence_units.source_id = ?
    )`).run(sourceId),
    deleteClaimsForSource: (sourceId) => {
      const claimIds = db.prepare(`SELECT DISTINCT claim_id FROM claim_evidence
        JOIN evidence_units ON evidence_units.id = claim_evidence.evidence_id
        WHERE evidence_units.source_id = ?`).all(sourceId).map((row) => row.claim_id);
      const deleteLearningClaims = learningStore.deleteClaimsForSource;
      db.exec('BEGIN IMMEDIATE');
      try {
        const deleteInquiry = db.prepare('DELETE FROM inquiry_items WHERE claim_id = ?');
        for (const claimId of claimIds) {
          deleteInquiry.run(claimId);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return deleteLearningClaims(sourceId);
    },
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
    listInquiries: (statuses = ['queued', 'presented', 'deferred']) => {
      const values = Array.isArray(statuses) ? statuses : [statuses];
      if (!values.length) return [];
      return db.prepare(`SELECT * FROM inquiry_items WHERE status IN (${values.map(() => '?').join(',')})
        ORDER BY priority DESC, created_at`).all(...values);
    },
    activeInquiryForSession: (sessionId) => db.prepare(
      "SELECT * FROM inquiry_items WHERE session_id = ? AND status = 'presented' ORDER BY presented_at DESC LIMIT 1",
    ).get(sessionId),
    presentNextInquiry: (sessionId) => {
      const active = db.prepare("SELECT * FROM inquiry_items WHERE session_id = ? AND status = 'presented' LIMIT 1").get(sessionId);
      if (active) return active;
      const retryBefore = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const next = db.prepare(`SELECT * FROM inquiry_items
        WHERE status = 'queued' OR (status = 'deferred' AND resolved_at <= ?)
        ORDER BY priority DESC, created_at LIMIT 1`).get(retryBefore);
      if (!next) return null;
      const now = new Date().toISOString();
      db.prepare("UPDATE inquiry_items SET status = 'presented', session_id = ?, presented_at = ? WHERE id = ?")
        .run(sessionId, now, next.id);
      return db.prepare('SELECT * FROM inquiry_items WHERE id = ?').get(next.id);
    },
    resolveInquiry: (id, resolution = 'resolved', responseText = '') => db.prepare(`UPDATE inquiry_items
      SET status = ?, resolution = ?, response_text = ?, resolved_at = ? WHERE id = ?`)
      .run(resolution === 'deferred' ? 'deferred' : 'resolved', resolution, responseText, new Date().toISOString(), id),
    addAnswerRun: (run) => {
      const id = randomUUID();
      db.prepare('INSERT INTO answer_runs (id, scene_id, context_run_id, question, plan_json, answer, audit_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, run.sceneId || null, run.contextRunId || run.plan?.contextRunId || null, run.question,
          JSON.stringify(run.plan), run.answer || null, JSON.stringify(run.audit || {}), new Date().toISOString());
      return id;
    },
    listAnswerRuns: (sceneId) => db.prepare('SELECT * FROM answer_runs WHERE scene_id = ? ORDER BY created_at, rowid').all(sceneId)
      .map((row, ordinal) => ({ id: row.id, sceneId: row.scene_id, contextRunId: row.context_run_id,
        question: row.question, plan: json(row.plan_json, {}), answer: row.answer, audit: json(row.audit_json, {}),
        createdAt: row.created_at, ordinal })),
    addContextRun: (run) => {
      const id = run.id || randomUUID();
      const createdAt = run.createdAt || new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(`INSERT INTO context_runs
          (id, session_id, scene_id, question, strategy, budget_chars, used_chars, total_messages, omitted_messages, omitted_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, run.sessionId || null, run.sceneId || null, run.question, run.strategy,
            run.budgetChars, run.usedChars, run.totalMessages || 0, run.omittedMessages || 0,
            JSON.stringify(run.omitted || []), createdAt);
        const insertItem = db.prepare(`INSERT INTO context_run_items
          (run_id, ordinal, item_type, item_id, source_id, evidence_id, selection_reason, char_count, content)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const [ordinal, item] of (run.items || []).entries()) insertItem.run(
          id, ordinal, item.type, item.id || null, item.sourceId || null, item.evidenceId || null,
          item.selectionReason || 'selected', String(item.content || '').length, String(item.content || ''),
        );
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return id;
    },
    getContextRun: (id) => {
      const row = db.prepare('SELECT * FROM context_runs WHERE id = ?').get(id);
      if (!row) return null;
      const items = db.prepare('SELECT * FROM context_run_items WHERE run_id = ? ORDER BY ordinal').all(id)
        .map((item) => ({ type: item.item_type, id: item.item_id, sourceId: item.source_id, evidenceId: item.evidence_id,
          selectionReason: item.selection_reason, charCount: item.char_count, content: item.content }));
      return { id: row.id, sessionId: row.session_id, sceneId: row.scene_id, question: row.question,
        strategy: row.strategy, budgetChars: row.budget_chars, usedChars: row.used_chars,
        totalMessages: row.total_messages, omittedMessages: row.omitted_messages,
        omitted: json(row.omitted_json), createdAt: row.created_at, items };
    },
    listContextRuns: (sessionId) => db.prepare('SELECT id FROM context_runs WHERE session_id = ? ORDER BY created_at DESC').all(sessionId)
      .map((row) => row.id),
    listMessagesForSummary: (sessionId, afterOrdinal = -1, throughOrdinal = Number.MAX_SAFE_INTEGER) => db.prepare(
      'SELECT id, role, content, created_at, ordinal FROM messages WHERE session_id = ? AND ordinal > ? AND ordinal <= ? ORDER BY ordinal',
    ).all(sessionId, afterOrdinal, throughOrdinal).map((row) => ({
      id: row.id, role: row.role, content: row.content, createdAt: row.created_at, ordinal: row.ordinal,
    })),
    getActiveContextSummary: (sessionId) => {
      const row = db.prepare('SELECT * FROM context_summaries WHERE session_id = ? AND superseded_at IS NULL ORDER BY version DESC LIMIT 1').get(sessionId);
      return row && { id: row.id, sessionId: row.session_id, summaryType: row.summary_type, content: row.content,
        messageIds: json(row.message_ids_json), coveredThroughOrdinal: row.covered_through_ordinal,
        version: row.version, createdAt: row.created_at, supersededAt: row.superseded_at };
    },
    replaceContextSummary: (summary) => {
      const current = db.prepare('SELECT * FROM context_summaries WHERE session_id = ? AND superseded_at IS NULL ORDER BY version DESC LIMIT 1').get(summary.sessionId);
      const now = new Date().toISOString();
      const id = summary.id || randomUUID();
      db.exec('BEGIN IMMEDIATE');
      try {
        if (current) db.prepare('UPDATE context_summaries SET superseded_at = ? WHERE id = ?').run(now, current.id);
        db.prepare(`INSERT INTO context_summaries
          (id, session_id, summary_type, content, message_ids_json, covered_through_ordinal, version, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, summary.sessionId, summary.summaryType || 'conversation', summary.content,
            JSON.stringify(summary.messageIds || []), summary.coveredThroughOrdinal, (current?.version || 0) + 1, now);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return id;
    },
    getActiveSceneSummary: (sceneId) => {
      const row = db.prepare('SELECT * FROM scene_summaries WHERE scene_id = ? AND superseded_at IS NULL ORDER BY version DESC LIMIT 1').get(sceneId);
      return row && { id: row.id, sceneId: row.scene_id, content: row.content,
        answerRunIds: json(row.answer_run_ids_json), coveredThroughOrdinal: row.covered_through_ordinal,
        version: row.version, createdAt: row.created_at, supersededAt: row.superseded_at };
    },
    replaceSceneSummary: (summary) => {
      const current = db.prepare('SELECT * FROM scene_summaries WHERE scene_id = ? AND superseded_at IS NULL ORDER BY version DESC LIMIT 1').get(summary.sceneId);
      const now = new Date().toISOString(); const id = summary.id || randomUUID();
      db.exec('BEGIN IMMEDIATE');
      try {
        if (current) db.prepare('UPDATE scene_summaries SET superseded_at = ? WHERE id = ?').run(now, current.id);
        db.prepare(`INSERT INTO scene_summaries
          (id, scene_id, content, answer_run_ids_json, covered_through_ordinal, version, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(id, summary.sceneId, summary.content, JSON.stringify(summary.answerRunIds || []),
            summary.coveredThroughOrdinal, (current?.version || 0) + 1, now);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
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
    ...chatHistory,
    truncateSession: (sessionId, messageId) => {
      const row = db.prepare('SELECT ordinal FROM messages WHERE id = ? AND session_id = ?').get(messageId, sessionId);
      if (!row) return false;
      const messageIds = db.prepare('SELECT id FROM messages WHERE session_id = ? AND ordinal >= ?').all(sessionId, row.ordinal).map((item) => item.id);
      deleteConversationSources(db, learningStore, sessionId, messageIds);
      db.prepare('DELETE FROM context_runs WHERE session_id = ?').run(sessionId);
      db.prepare('DELETE FROM context_summaries WHERE session_id = ?').run(sessionId);
      return chatHistory.truncateSession(sessionId, messageId);
    },
    deleteSession: (id) => {
      const messageIds = db.prepare('SELECT id FROM messages WHERE session_id = ?').all(id).map((item) => item.id);
      deleteConversationSources(db, learningStore, id, messageIds);
      return chatHistory.deleteSession(id);
    },
    close: () => db.close(),
  };
}

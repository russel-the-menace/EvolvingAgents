import { randomUUID } from 'node:crypto';

export function installChatHistorySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, ordinal INTEGER NOT NULL
    );
  `);
}

function mapSession(db, row) {
  if (!row) return null;
  const messages = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY ordinal').all(row.id)
    .map((message) => ({ id: message.id, role: message.role, content: message.content, createdAt: message.created_at }));
  return { id: row.id, title: row.title, pinned: Boolean(row.pinned), createdAt: row.created_at, updatedAt: row.updated_at, messages };
}

export function createChatHistoryStore(db) {
  installChatHistorySchema(db);
  return {
    listSessions: () => db.prepare('SELECT * FROM sessions ORDER BY pinned DESC, updated_at DESC').all().map((row) => mapSession(db, row)),
    getSession: (id) => mapSession(db, db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)),
    createSession: (values = {}) => {
      const now = new Date().toISOString(); const id = values.id || randomUUID();
      db.prepare('INSERT INTO sessions (id, title, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, values.title || 'New conversation', values.pinned ? 1 : 0, now, now);
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
  };
}

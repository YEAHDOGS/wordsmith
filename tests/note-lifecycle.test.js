import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { saveNotes } from '../api/lib/notes.js';
import { purgeRows } from '../api/lib/trash.js';
import { toApi } from '../api/lib/rows.js';
import { cleanRow, MAX_TITLE } from '../src/lib/models.js';

const MIGRATIONS = new URL('../api/migrations/', import.meta.url);
const OWNER = 'test-owner';
const ACTOR = { type: 'user', name: 'test' };

test('title validation accepts the editor limit and rejects overflow without truncating', () => {
  const title = 'x'.repeat(MAX_TITLE);
  assert.equal(cleanRow('notes', { title }).title, title);
  assert.throws(() => cleanRow('notes', { title: title + 'x' }), /longer than/);
});

test('notes survive edit, archive, trash and restore; purged notes cannot be resurrected', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const file of readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql')).sort()) {
      db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
    }
    db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(OWNER, Date.now());
    const env = { DB: {
      prepare(sql) {
        return { bind(...values) {
          const statement = db.prepare(sql);
          return {
            run: async () => statement.run(...values),
            all: async () => ({ results: statement.all(...values) }),
          };
        } };
      },
      async batch(statements) {
        db.exec('BEGIN');
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.all());
          db.exec('COMMIT');
          return results;
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      },
    } };
    let current = null;
    async function write(patch) {
      const [saved] = await saveNotes(env, OWNER, ACTOR, [{ before: current, patch }]);
      current = toApi(db.prepare('SELECT * FROM notes WHERE id = ?').get(saved.id));
      return current;
    }
    await write({ id: 'test-note', title: 'Keep this title', body: 'Keep this body' });
    await write({ archived: true });
    assert.equal(current.archived, true);
    await write({ archived: false, deleted_at: Date.now() });
    assert.ok(current.deleted_at);
    assert.equal(current.body, 'Keep this body');
    await write({ deleted_at: null });
    assert.equal(current.deleted_at, null);
    assert.equal(current.title, 'Keep this title');
    await write({ deleted_at: Date.now() });
    await purgeRows(env, OWNER, 'notes', [current.id]);
    current = toApi(db.prepare('SELECT * FROM notes WHERE id = ?').get(current.id));
    assert.ok(current.purged_at);
    assert.equal(current.body, '');
    await write({ deleted_at: null, body: 'stale offline edit' });
    assert.ok(current.deleted_at);
    assert.equal(current.body, '');
  } finally { db.close(); }
});

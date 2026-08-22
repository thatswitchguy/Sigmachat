const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 5
    })
  : null;

let ready = false;

async function initialize() {
  if (!pool) {
    console.log('Neon database disabled (DATABASE_URL is not set)');
    return false;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        conversation_key TEXT NOT NULL,
        message_id TEXT NOT NULL,
        message_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (conversation_key, message_id)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS chat_messages_conversation_created_idx
      ON chat_messages (conversation_key, created_at)
    `);
    ready = true;
    console.log('Neon PostgreSQL connected');
    return true;
  } catch (error) {
    console.error('Neon database unavailable; using local JSON fallback:', error.message);
    return false;
  }
}

async function getConversation(conversationKey) {
  if (!ready) return null;
  const result = await pool.query(
    `SELECT message_json
       FROM chat_messages
      WHERE conversation_key = $1
      ORDER BY created_at ASC`,
    [conversationKey]
  );
  return result.rows.map(row => row.message_json);
}

async function saveConversation(conversationKey, messages) {
  if (!ready) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM chat_messages WHERE conversation_key = $1', [conversationKey]);
    for (const message of messages.slice(-500)) {
      const messageId = String(message.id || message.timestamp || `${Date.now()}-${Math.random()}`);
      await client.query(
        `INSERT INTO chat_messages (conversation_key, message_id, message_json)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (conversation_key, message_id)
         DO UPDATE SET message_json = EXCLUDED.message_json`,
        [conversationKey, messageId, JSON.stringify(message)]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`Neon save failed for ${conversationKey}:`, error.message);
  } finally {
    client.release();
  }
}

function isReady() {
  return ready;
}

async function close() {
  if (pool) await pool.end();
}

module.exports = { initialize, getConversation, saveConversation, isReady, close };
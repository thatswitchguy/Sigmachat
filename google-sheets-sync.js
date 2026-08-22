const WEBHOOK_URL = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
const WEBHOOK_TOKEN = process.env.GOOGLE_SHEETS_WEBHOOK_TOKEN;
const MAX_BATCH_SIZE = 20;
const MAX_RETRIES = 5;

const queue = [];
let flushTimer = null;
let flushing = false;

function enabled() {
  return Boolean(WEBHOOK_URL && WEBHOOK_TOKEN);
}

function scheduleFlush(delay = 250) {
  if (!enabled() || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush().catch(error => console.error('Google Sheets sync error:', error.message));
  }, delay);
}

async function flush() {
  if (flushing || queue.length === 0 || !enabled()) return;
  flushing = true;
  const batch = queue.splice(0, MAX_BATCH_SIZE);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: WEBHOOK_TOKEN, events: batch })
    });

    if (!response.ok) throw new Error(`webhook returned HTTP ${response.status}`);
    const result = await response.json().catch(() => ({}));
    if (result.ok !== true) throw new Error(result.error || 'webhook rejected the batch');
    console.log(`Google Sheets sync: saved ${batch.length} event(s)`);
  } catch (error) {
    const retryable = batch.filter(event => event.attempts < MAX_RETRIES);
    retryable.forEach(event => {
      event.attempts += 1;
      queue.unshift(event);
    });
    console.error(
      `Google Sheets sync failed (${error.message}); ` +
      `${retryable.length} event(s) queued for retry`
    );
    if (retryable.length > 0) {
      const delay = Math.min(30000, 1000 * (2 ** Math.max(...retryable.map(e => e.attempts))));
      scheduleFlush(delay);
    }
  } finally {
    flushing = false;
    if (queue.length > 0) scheduleFlush(0);
  }
}

function record(event) {
  if (!enabled()) return;
  const recordedAt = new Date().toISOString();
  queue.push({
    ...event,
    eventId: `${event.eventType}:${event.messageId}:${recordedAt}`,
    recordedAt,
    attempts: 0
  });
  scheduleFlush();
}

function status() {
  return { enabled: enabled(), queuedEvents: queue.length };
}

if (enabled()) {
  console.log('Google Sheets sync enabled');
} else {
  console.log('Google Sheets sync disabled (set GOOGLE_SHEETS_WEBHOOK_URL and GOOGLE_SHEETS_WEBHOOK_TOKEN to enable)');
}

module.exports = { record, status };
---
name: Neon message storage
description: Durable behavior and fallback policy for SigmaChat's PostgreSQL message persistence.
---

Neon PostgreSQL is the primary remote store for channel and direct-message histories. Existing JSON histories are imported on startup when a conversation has no database rows, and database rows restore the local cache on later starts.

**Why:** The app needs persistent remote storage without risking a broken chat during migration or a temporary database outage.

**How to apply:** Preserve the `DATABASE_URL` secret-based connection. Keep message writes non-blocking and retain the local JSON fallback unless the product explicitly completes a full database-only migration.
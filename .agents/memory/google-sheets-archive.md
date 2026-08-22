---
name: Google Sheets message archive
description: Durable integration behavior for archiving chat message events through Google Apps Script.
---

The message archive is intentionally append-only: creation, edits, and deletions are separate events identified by a deterministic event ID. The local JSON files remain the source used by the chat at runtime, while Google Sheets is an external audit/archive destination.

**Why:** A remote spreadsheet outage or a Replit process restart must not block chat delivery or silently replace the existing live storage model.

**How to apply:** Keep the webhook optional and non-blocking. Configure the URL and token through environment variables, never source code; preserve event IDs when retrying so the Apps Script can deduplicate.
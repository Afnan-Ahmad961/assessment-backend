# Database design

> **For assessment review only.** This folder holds the SQL deliverable the assessment asks for. The running app doesn't use it: Prisma migrations in `prisma/migrations/` create and change the real database, and `prisma/schema.prisma` describes it for the code. The SQL here matches what those migrations produce. I checked both files by loading them into an empty PostgreSQL 18 database.

| File | What's in it |
|---|---|
| [`schema.sql`](schema.sql) | DDL for every table, with constraints and indexes, commented line by line |
| [`sample-data.sql`](sample-data.sql) | Sample inserts, plus five statements that fail on purpose to show the constraints |
| This README | Model overview, indexing strategy, performance notes, multi-tenancy |

To load them into an empty database:

```bash
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/sample-data.sql
```

## Tables

The brief asks for `users`, `appointments` and `chat_sessions`. Five more tables support them.

| Table | Holds |
|---|---|
| `users` | Login and profile: email, bcrypt hash, name |
| `refresh_tokens` | One row per refresh token, stored as a SHA-256 hash, for rotation and reuse detection |
| `services` | What can be booked, each with a fixed duration |
| `appointments` | Bookings: user, service, start and end, status, source (`CHAT` or `FORM`), notes |
| `chat_sessions` | One conversation with the assistant, plus its metadata: status, booking draft, spam counter, lock version |
| `chat_messages` | The conversation history, one row per message |
| `ai_interactions` | One row per LLM call: model, prompt version, input, output, tokens, latency, status |

```
users ─┬─< refresh_tokens
       ├─< chat_sessions ─┬─< chat_messages
       │                  ├─< ai_interactions
       │                  └── appointments (0 or 1 per session)
       ├─< appointments >── services
       └─< ai_interactions
```

## Modeling decisions

**Messages get their own table.** `chat_sessions` could hold the history as a JSON array, but then every new message rewrites the whole array, and polling for "messages after X" can't use an index. With one row per message, polling is an index range scan.

**The booking draft is JSONB.** The draft (`serviceId`, `date`, `time`, `notes`) is temporary state: only the app reads it, nothing queries inside it, and its shape follows the AI flow. Typed columns would add a migration for every change in the flow. The app checks the draft with Zod on every read, and a broken field resets to null instead of breaking the chat.

**Two values are copied on purpose.** `appointments.ends_at` is copied from the service's duration when the booking is made, so changing a service later doesn't rewrite past appointments. `chat_sessions.last_message_at` is copied from the newest message, so listing conversations needs no `MAX()` over `chat_messages`. Everything else is in third normal form.

**The database enforces the important rules.** The app checks them too, but these hold even under concurrent requests or a bug in the app:

| Rule | Mechanism |
|---|---|
| No two active appointments overlap | `EXCLUDE USING gist` on `tstzrange(starts_at, ends_at)`, ignoring cancelled rows |
| One active conversation per user | Partial unique index `WHERE status = 'ACTIVE'` |
| One appointment per conversation | Unique index on `appointments.chat_session_id` (NULLs don't clash) |
| Emails are unique regardless of case | `CHECK (email = lower(email))` plus a plain unique index |
| Appointments end after they start; durations are 5 to 480 minutes | `CHECK` constraints |
| Services with bookings can't be deleted | `ON DELETE RESTRICT`; services are deactivated with `is_active` instead |

**Times are `timestamptz`, stored in UTC.** The business timezone (`BUSINESS_TIMEZONE`) only matters when the app turns "Tuesday 10 am" into an instant and back, so the stored data never depends on it.

## Indexing strategy

Each index exists for a specific query or rule. I left out anything that didn't have one.

| Index | Serves |
|---|---|
| `users_email_key` (unique) | Login: find the user by email |
| `refresh_tokens_token_hash_key` (unique) | Refresh: find the token by its hash |
| `refresh_tokens_user_id_idx` | Revoke all of a user's tokens when a stolen token is detected |
| `services_name_key` (unique) | The AI returns a service by name; names must be unique to match |
| `appointments_no_overlap` (GiST) | The overlap rule, and also the availability query (see below) |
| `appointments_user_id_starts_at_idx` | "My appointments": one user's bookings ordered by start time |
| `appointments_service_id_idx` | Foreign key: keeps the `RESTRICT` check on service deletion fast |
| `appointments_chat_session_id_key` (unique) | One booking per conversation, and finding a conversation's booking |
| `chat_sessions_one_active_per_user` (partial, unique) | The one-active-conversation rule, and loading the active conversation |
| `chat_sessions_user_id_last_message_at_idx` | Listing a user's conversations by recent activity |
| `chat_messages_session_id_created_at_idx` | Loading a conversation in order, and the polling query `created_at > cursor` |
| `ai_interactions_session_id_created_at_idx` | Debugging: every AI call in one conversation, in order |
| `ai_interactions_created_at_idx` | Analytics over time windows, e.g. error rate in the last 24 hours |

The availability check uses the exclusion constraint's index on purpose. The API asks for active appointments overlapping a day with the same expression the constraint is built on:

```sql
SELECT starts_at, ends_at FROM appointments
WHERE status <> 'CANCELLED'
  AND tstzrange(starts_at, ends_at, '[)') && tstzrange($1, $2, '[)');
```

`EXPLAIN` shows `Index Scan using appointments_no_overlap`. One index both guards correctness and serves the hottest read.

## Performance considerations

- **UUIDv7 keys.** They start with a timestamp, so inserts land at the end of each primary key index instead of on random pages as with UUIDv4. That gives fewer page splits and better cache use on the write-heavy tables (`chat_messages`, `ai_interactions`).
- **No locks held during the AI call.** A chat turn takes about 4 seconds, mostly Gemini. The session isn't locked during that time. The turn commits at the end with `UPDATE chat_sessions ... WHERE version = $read_version`, and the row is locked only for that short final transaction. A request that loses the race gets a 409 instead of waiting.
- **Polling is cheap.** The browser polls every 4 seconds for messages after the last one it has. That query reads only new rows from the `(session_id, created_at)` index, and returns nothing most of the time.
- **Bookings rely on the constraint, not a pre-check.** Creating an appointment doesn't `SELECT` for conflicts first, which would race anyway. It inserts, and the exclusion constraint rejects an overlap atomically.
- **`ai_interactions` grows fastest.** It gets one row per chat message, each with a JSON copy of the prompt context. At real volume I'd partition it by month on `created_at` and drop old partitions after a retention period. The `created_at` index already supports that pattern.
- **Expired refresh tokens pile up.** Revoked and expired rows are never deleted today. A daily `DELETE ... WHERE expires_at < now() - interval '7 days'` job would keep the table small. That's listed as a known limitation.
- **Connections.** The API uses a `pg` pool through Prisma's driver adapter. With several API instances, a pooler like PgBouncer in front of Postgres would keep the connection count bounded.

## Multi-tenancy (optional in the brief, not implemented)

The app serves one business, so there's no `business_id`. I chose that to keep signup and the booking rules simple. Adding tenants later would look like this:

1. Add a `businesses` table, and `business_id NOT NULL` with a foreign key on `services`, `appointments` and `chat_sessions`. Users stay global and can book with several businesses.
2. Put `business_id` first in the composite indexes, e.g. `(business_id, user_id, starts_at DESC)`, since every query would filter by tenant.
3. Make the overlap rule per business. This needs the `btree_gist` extension, because it combines equality on a UUID with range overlap:
   ```sql
   EXCLUDE USING gist (business_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
   WHERE (status <> 'CANCELLED')
   ```
4. Scope uniqueness by tenant: `UNIQUE (business_id, name)` on services, and the one-active-conversation index on `(business_id, user_id)`.
5. Optionally enable row-level security with a policy on `business_id = current_setting('app.business_id')::uuid`. That way a missing `WHERE` clause in the app can't leak another tenant's data.

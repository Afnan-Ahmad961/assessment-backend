-- =============================================================================
-- FOR ASSESSMENT REVIEW ONLY
--
-- The schema deliverable the assessment asks for, written out by hand so it reads
-- top to bottom. The running app does not use this file: Prisma migrations in
-- prisma/migrations/ create and change the real database. This file matches what
-- those migrations produce.
--
-- Requires PostgreSQL 18 for the built-in uuidv7(). On older versions, replace
-- uuidv7() with gen_random_uuid().
--
-- Indexing strategy and performance notes: database/README.md
-- Sample data: database/sample-data.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Enums. Small fixed sets of values, checked by the database.
-- -----------------------------------------------------------------------------

CREATE TYPE appointment_status    AS ENUM ('CONFIRMED', 'CANCELLED', 'COMPLETED');
CREATE TYPE booking_source        AS ENUM ('CHAT', 'FORM');
CREATE TYPE chat_session_status   AS ENUM ('ACTIVE', 'CLOSED');
CREATE TYPE chat_message_role     AS ENUM ('USER', 'ASSISTANT');
CREATE TYPE ai_interaction_status AS ENUM ('SUCCESS', 'INVALID_OUTPUT', 'ERROR');

-- -----------------------------------------------------------------------------
-- users: authentication and profile data
-- -----------------------------------------------------------------------------

CREATE TABLE users (
    -- UUIDv7 keys are time-ordered, so new rows go to the end of the primary key
    -- index instead of random pages (see README, "Performance").
    id            uuid          PRIMARY KEY DEFAULT uuidv7(),
    email         varchar(254)  NOT NULL,
    password_hash varchar(255)  NOT NULL,           -- bcrypt, cost 10
    full_name     varchar(100)  NOT NULL,
    created_at    timestamptz(3) NOT NULL DEFAULT now(),
    updated_at    timestamptz(3) NOT NULL,          -- set by the application on every write

    -- The API lowercases emails. Enforcing it here makes the unique index below
    -- case-insensitive without needing citext or a lower(email) index.
    CONSTRAINT users_email_lowercase_check CHECK (email = lower(email))
);

CREATE UNIQUE INDEX users_email_key ON users (email);

-- -----------------------------------------------------------------------------
-- refresh_tokens: one row per issued refresh token (rotation + reuse detection)
-- -----------------------------------------------------------------------------

CREATE TABLE refresh_tokens (
    id         uuid           PRIMARY KEY DEFAULT uuidv7(),
    user_id    uuid           NOT NULL REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE,
    -- SHA-256 of the token. The raw token only exists in the user's httpOnly cookie,
    -- so a leaked database can't be used to sign in.
    token_hash char(64)       NOT NULL,
    expires_at timestamptz(3) NOT NULL,
    revoked_at timestamptz(3),                       -- set when used (rotation) or on logout
    created_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX refresh_tokens_token_hash_key ON refresh_tokens (token_hash);
CREATE INDEX        refresh_tokens_user_id_idx    ON refresh_tokens (user_id);

-- -----------------------------------------------------------------------------
-- services: what can be booked
-- -----------------------------------------------------------------------------

CREATE TABLE services (
    id               uuid           PRIMARY KEY DEFAULT uuidv7(),
    name             varchar(100)   NOT NULL,
    description      varchar(500),
    duration_minutes integer        NOT NULL,
    -- Services are switched off, never deleted, so old appointments keep a valid
    -- reference (appointments.service_id is ON DELETE RESTRICT).
    is_active        boolean        NOT NULL DEFAULT true,
    created_at       timestamptz(3) NOT NULL DEFAULT now(),
    updated_at       timestamptz(3) NOT NULL,

    CONSTRAINT services_duration_minutes_check CHECK (duration_minutes BETWEEN 5 AND 480)
);

-- The AI matches "a consultation" to a service by name, so names must be unique.
CREATE UNIQUE INDEX services_name_key ON services (name);

-- -----------------------------------------------------------------------------
-- chat_sessions: one conversation with the booking assistant, plus its metadata
-- -----------------------------------------------------------------------------

CREATE TABLE chat_sessions (
    id              uuid                PRIMARY KEY DEFAULT uuidv7(),
    user_id         uuid                NOT NULL REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE,
    title           varchar(120),
    status          chat_session_status NOT NULL DEFAULT 'ACTIVE',
    -- Copied from the newest message, so listing conversations by recent activity
    -- doesn't need MAX(created_at) over chat_messages.
    last_message_at timestamptz(3),
    -- The booking collected so far: {"serviceId", "date", "time", "notes"}. JSONB
    -- because it's temporary working state that only the app reads, and its shape
    -- follows the AI flow. The app validates it with Zod on every read.
    booking_draft   jsonb               NOT NULL DEFAULT '{}',
    -- Messages in a row that added no booking detail. 3 suggests the form, 5 closes
    -- the conversation (spam protection).
    stalled_turns   integer             NOT NULL DEFAULT 0,
    -- Optimistic lock. Every turn commits with UPDATE ... WHERE version = <read value>
    -- and bumps it, so two overlapping requests can't both write or both book.
    version         integer             NOT NULL DEFAULT 0,
    created_at      timestamptz(3)      NOT NULL DEFAULT now(),
    updated_at      timestamptz(3)      NOT NULL,

    CONSTRAINT chat_sessions_stalled_turns_check CHECK (stalled_turns >= 0)
);

-- At most one ACTIVE conversation per user. A partial unique index: closed
-- conversations don't count, so a user can have any number of those.
CREATE UNIQUE INDEX chat_sessions_one_active_per_user
    ON chat_sessions (user_id) WHERE status = 'ACTIVE';

-- "My recent conversations", newest first.
CREATE INDEX chat_sessions_user_id_last_message_at_idx
    ON chat_sessions (user_id, last_message_at DESC);

-- -----------------------------------------------------------------------------
-- chat_messages: the conversation history (one row per message)
-- -----------------------------------------------------------------------------

CREATE TABLE chat_messages (
    id         uuid              PRIMARY KEY DEFAULT uuidv7(),
    session_id uuid              NOT NULL REFERENCES chat_sessions (id) ON UPDATE CASCADE ON DELETE CASCADE,
    role       chat_message_role NOT NULL,
    content    text              NOT NULL,
    created_at timestamptz(3)    NOT NULL DEFAULT now()
);

-- Loads a conversation in order, and answers the polling query
-- "messages in this session created after <cursor>".
CREATE INDEX chat_messages_session_id_created_at_idx ON chat_messages (session_id, created_at);

-- -----------------------------------------------------------------------------
-- appointments: scheduling data and status
-- -----------------------------------------------------------------------------

CREATE TABLE appointments (
    id              uuid               PRIMARY KEY DEFAULT uuidv7(),
    user_id         uuid               NOT NULL REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE,
    service_id      uuid               NOT NULL REFERENCES services (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    -- The conversation that produced the booking, if any. Kept as NULL if the
    -- conversation is deleted.
    chat_session_id uuid               REFERENCES chat_sessions (id) ON UPDATE CASCADE ON DELETE SET NULL,
    -- Always stored in UTC. ends_at is copied from the service's duration at booking
    -- time, so changing a service's duration later doesn't rewrite past bookings.
    starts_at       timestamptz(3)     NOT NULL,
    ends_at         timestamptz(3)     NOT NULL,
    status          appointment_status NOT NULL DEFAULT 'CONFIRMED',
    source          booking_source     NOT NULL,  -- CHAT or FORM: how often the AI path succeeds
    notes           varchar(1000),
    created_at      timestamptz(3)     NOT NULL DEFAULT now(),
    updated_at      timestamptz(3)     NOT NULL,

    CONSTRAINT appointments_time_range_check CHECK (ends_at > starts_at),

    -- No two active appointments may overlap (one shared calendar). Postgres enforces
    -- this itself, so two people booking the same slot at the same moment can't both
    -- succeed. '[)' makes the end exclusive: 10:00-10:30 and 10:30-11:00 don't clash.
    -- GiST supports range overlap (&&) natively, so no btree_gist extension is needed.
    CONSTRAINT appointments_no_overlap
        EXCLUDE USING gist (tstzrange(starts_at, ends_at, '[)') WITH &&)
        WHERE (status <> 'CANCELLED')
);

-- "My appointments": filter by user, order by start time.
CREATE INDEX appointments_user_id_starts_at_idx ON appointments (user_id, starts_at DESC);

-- Foreign key index: keeps the RESTRICT check fast when a service is deleted,
-- and serves per-service reporting.
CREATE INDEX appointments_service_id_idx ON appointments (service_id);

-- One booking per conversation. NULLs (plain form bookings) don't clash in a
-- unique index, so only chat-linked bookings are limited.
CREATE UNIQUE INDEX appointments_chat_session_id_key ON appointments (chat_session_id);

-- -----------------------------------------------------------------------------
-- ai_interactions: one row per LLM call, for debugging and analytics
-- -----------------------------------------------------------------------------

CREATE TABLE ai_interactions (
    id             uuid                  PRIMARY KEY DEFAULT uuidv7(),
    -- SET NULL instead of CASCADE: the log outlives the conversation or user.
    session_id     uuid                  REFERENCES chat_sessions (id) ON UPDATE CASCADE ON DELETE SET NULL,
    user_id        uuid                  REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
    model          varchar(100)          NOT NULL,   -- e.g. gemini-3.1-flash-lite
    prompt_version varchar(50)           NOT NULL,   -- ties behaviour to a prompt change
    status         ai_interaction_status NOT NULL,
    input          jsonb                 NOT NULL,   -- context + recent messages sent
    output         jsonb,                            -- the validated extraction, or {"raw": ...}
    error_message  varchar(1000),
    input_tokens   integer,
    output_tokens  integer,
    latency_ms     integer               NOT NULL,
    created_at     timestamptz(3)        NOT NULL DEFAULT now()
);

-- Everything the AI did in one conversation, in order.
CREATE INDEX ai_interactions_session_id_created_at_idx ON ai_interactions (session_id, created_at);
-- Time-window analytics ("error rate over the last 24 hours").
CREATE INDEX ai_interactions_created_at_idx ON ai_interactions (created_at);

COMMIT;

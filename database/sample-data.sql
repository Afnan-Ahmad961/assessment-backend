-- =============================================================================
-- FOR ASSESSMENT REVIEW ONLY
--
-- Sample data for database/schema.sql. Run it on an empty database after the
-- schema. IDs are fixed and readable so the rows are easy to follow; the app
-- itself lets the database generate UUIDv7 keys.
--
-- Both sample users have the password "password123" (a real bcrypt hash, cost 10).
-- =============================================================================

BEGIN;

-- Services ---------------------------------------------------------------------

INSERT INTO services (id, name, description, duration_minutes, updated_at) VALUES
    ('01970000-0000-7000-8000-000000000101', 'Consultation',     'A first conversation to understand what you need.', 30, now()),
    ('01970000-0000-7000-8000-000000000102', 'Follow-up',        'A short check-in after a previous appointment.',    15, now()),
    ('01970000-0000-7000-8000-000000000103', 'Extended session', 'A longer, in-depth session.',                       60, now());

-- Users ------------------------------------------------------------------------

INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES
    ('01970000-0000-7000-8000-000000000201', 'sara@example.com',
     '$2b$10$Ln8nbEhn3j7w.1z58f5YT.47Mmrnvcc8KCMddDmxRmoXRQK8tIfJK', 'Sara Khan', now()),
    ('01970000-0000-7000-8000-000000000202', 'omar@example.com',
     '$2b$10$Ln8nbEhn3j7w.1z58f5YT.47Mmrnvcc8KCMddDmxRmoXRQK8tIfJK', 'Omar Ali', now());

-- A live refresh token for Sara. token_hash is SHA-256("sample-refresh-token").
INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES
    ('01970000-0000-7000-8000-000000000201',
     'b87af73f0b62be04b7b9b937a30978b3abb86439eeb0ce010c991580fe1b8eff',
     now() + interval '30 days');

-- Conversations ----------------------------------------------------------------

INSERT INTO chat_sessions (id, user_id, status, last_message_at, booking_draft, stalled_turns, version, updated_at) VALUES
    -- Sara booked through the chat; the conversation closed with the booking.
    ('01970000-0000-7000-8000-000000000301', '01970000-0000-7000-8000-000000000201', 'CLOSED',
     '2026-10-20 09:02:10+00',
     '{"serviceId": "01970000-0000-7000-8000-000000000101", "date": "2026-11-03", "time": "10:00", "notes": null}',
     0, 2, now()),
    -- Sara's open conversation: service and day known, time still needed.
    ('01970000-0000-7000-8000-000000000302', '01970000-0000-7000-8000-000000000201', 'ACTIVE',
     '2026-10-21 14:00:05+00',
     '{"serviceId": "01970000-0000-7000-8000-000000000102", "date": "2026-11-05", "time": null, "notes": "Prefers 5 pm if it rains"}',
     0, 1, now()),
    -- Omar started in the chat, then finished in the form (the fallback path).
    ('01970000-0000-7000-8000-000000000303', '01970000-0000-7000-8000-000000000202', 'CLOSED',
     '2026-10-20 11:15:40+00',
     '{"serviceId": "01970000-0000-7000-8000-000000000103", "date": "2026-11-03", "time": "10:30", "notes": "Needs step-free access"}',
     0, 2, now());

INSERT INTO chat_messages (session_id, role, content, created_at) VALUES
    ('01970000-0000-7000-8000-000000000301', 'ASSISTANT', 'Hi! I can book a Consultation, Extended session or Follow-up for you. What would you like, and when?', '2026-10-20 09:00:00+00'),
    ('01970000-0000-7000-8000-000000000301', 'USER',      'A consultation on the 3rd of November at 10am please', '2026-10-20 09:01:00+00'),
    ('01970000-0000-7000-8000-000000000301', 'ASSISTANT', 'Consultation on Tue 3 Nov at 10 am. Shall I book it?', '2026-10-20 09:01:04+00'),
    ('01970000-0000-7000-8000-000000000301', 'USER',      'yes', '2026-10-20 09:02:06+00'),
    ('01970000-0000-7000-8000-000000000301', 'ASSISTANT', 'Booked: Consultation on Tue 3 Nov at 10 am. See you then!', '2026-10-20 09:02:10+00'),

    ('01970000-0000-7000-8000-000000000302', 'ASSISTANT', 'Hi! I can book a Consultation, Extended session or Follow-up for you. What would you like, and when?', '2026-10-21 13:59:00+00'),
    ('01970000-0000-7000-8000-000000000302', 'USER',      'A follow-up on Thursday the 5th, 2 pm or 5 pm if it rains', '2026-10-21 14:00:01+00'),
    ('01970000-0000-7000-8000-000000000302', 'ASSISTANT', 'Got it, Thursday the 5th, with 5 pm noted as your rainy-day preference. What time would suit you?', '2026-10-21 14:00:05+00'),

    ('01970000-0000-7000-8000-000000000303', 'ASSISTANT', 'Hi! I can book a Consultation, Extended session or Follow-up for you. What would you like, and when?', '2026-10-20 11:10:00+00'),
    ('01970000-0000-7000-8000-000000000303', 'USER',      'can I just fill in a form?', '2026-10-20 11:10:30+00'),
    ('01970000-0000-7000-8000-000000000303', 'ASSISTANT', 'The form is ready with the details so far.', '2026-10-20 11:10:34+00'),
    ('01970000-0000-7000-8000-000000000303', 'ASSISTANT', 'Booked: Extended session on Tue 3 Nov at 10:30 am. See you then!', '2026-10-20 11:15:40+00');

-- Appointments -----------------------------------------------------------------

INSERT INTO appointments (id, user_id, service_id, chat_session_id, starts_at, ends_at, status, source, notes, updated_at) VALUES
    -- Booked in the chat.
    ('01970000-0000-7000-8000-000000000401', '01970000-0000-7000-8000-000000000201', '01970000-0000-7000-8000-000000000101',
     '01970000-0000-7000-8000-000000000301', '2026-11-03 10:00+00', '2026-11-03 10:30+00', 'CONFIRMED', 'CHAT', NULL, now()),
    -- Booked through the form fallback, right after Sara's slot. Back-to-back is allowed
    -- because the overlap check treats the end time as exclusive.
    ('01970000-0000-7000-8000-000000000402', '01970000-0000-7000-8000-000000000202', '01970000-0000-7000-8000-000000000103',
     '01970000-0000-7000-8000-000000000303', '2026-11-03 10:30+00', '2026-11-03 11:30+00', 'CONFIRMED', 'FORM', 'Needs step-free access', now()),
    -- A cancelled booking in the same slot as Sara's. Allowed: cancelled rows are
    -- excluded from the no-overlap constraint.
    ('01970000-0000-7000-8000-000000000403', '01970000-0000-7000-8000-000000000202', '01970000-0000-7000-8000-000000000101',
     NULL, '2026-11-03 10:00+00', '2026-11-03 10:30+00', 'CANCELLED', 'FORM', NULL, now()),
    -- A past appointment.
    ('01970000-0000-7000-8000-000000000404', '01970000-0000-7000-8000-000000000201', '01970000-0000-7000-8000-000000000102',
     NULL, '2026-09-15 15:00+00', '2026-09-15 15:15+00', 'COMPLETED', 'FORM', NULL, now());

-- AI interaction log -----------------------------------------------------------

INSERT INTO ai_interactions (session_id, user_id, model, prompt_version, status, input, output, error_message, input_tokens, output_tokens, latency_ms, created_at) VALUES
    ('01970000-0000-7000-8000-000000000301', '01970000-0000-7000-8000-000000000201', 'gemini-3.1-flash-lite', 'booking-v4', 'SUCCESS',
     '{"history": [{"role": "USER", "content": "A consultation on the 3rd of November at 10am please"}]}',
     '{"updates": {"service": "Consultation", "date": "2026-11-03", "time": "10:00", "notes": null}, "intent": "provide_details", "acknowledgement": null, "reply": "What time would suit you?"}',
     NULL, 812, 64, 3920, '2026-10-20 09:01:04+00'),
    ('01970000-0000-7000-8000-000000000301', '01970000-0000-7000-8000-000000000201', 'gemini-3.1-flash-lite', 'booking-v4', 'SUCCESS',
     '{"history": [{"role": "USER", "content": "yes"}]}',
     '{"updates": {"service": null, "date": null, "time": null, "notes": null}, "intent": "confirm", "acknowledgement": null, "reply": "Booking it now."}',
     NULL, 870, 41, 3410, '2026-10-20 09:02:10+00'),
    -- A failed call: the user got the "fill in the form" fallback and the error is kept here.
    ('01970000-0000-7000-8000-000000000302', '01970000-0000-7000-8000-000000000201', 'gemini-3.1-flash-lite', 'booking-v4', 'ERROR',
     '{"history": [{"role": "USER", "content": "A follow-up on Thursday the 5th"}]}',
     NULL, '429 RESOURCE_EXHAUSTED: quota exceeded', NULL, NULL, 1467, '2026-10-21 13:59:30+00');

COMMIT;

-- =============================================================================
-- The constraints at work. Each statement below fails on purpose; run them one
-- at a time to see the error.
-- =============================================================================

-- Overlaps Sara's confirmed 10:00-10:30 booking -> appointments_no_overlap
-- INSERT INTO appointments (user_id, service_id, starts_at, ends_at, source, updated_at)
-- VALUES ('01970000-0000-7000-8000-000000000202', '01970000-0000-7000-8000-000000000102',
--         '2026-11-03 10:15+00', '2026-11-03 10:30+00', 'FORM', now());

-- A second appointment for the same conversation -> appointments_chat_session_id_key
-- INSERT INTO appointments (user_id, service_id, chat_session_id, starts_at, ends_at, source, updated_at)
-- VALUES ('01970000-0000-7000-8000-000000000201', '01970000-0000-7000-8000-000000000102',
--         '01970000-0000-7000-8000-000000000301', '2026-11-10 09:00+00', '2026-11-10 09:15+00', 'CHAT', now());

-- A second ACTIVE conversation for Sara -> chat_sessions_one_active_per_user
-- INSERT INTO chat_sessions (user_id, updated_at) VALUES ('01970000-0000-7000-8000-000000000201', now());

-- An email that isn't lowercase -> users_email_lowercase_check
-- INSERT INTO users (email, password_hash, full_name, updated_at) VALUES ('Sara@Example.com', 'x', 'x', now());

-- Ends before it starts -> appointments_time_range_check
-- INSERT INTO appointments (user_id, service_id, starts_at, ends_at, source, updated_at)
-- VALUES ('01970000-0000-7000-8000-000000000201', '01970000-0000-7000-8000-000000000101',
--         '2026-11-12 10:00+00', '2026-11-12 09:00+00', 'FORM', now());

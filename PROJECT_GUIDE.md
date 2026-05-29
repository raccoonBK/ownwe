# Cyberboss Roundtable Handoff Guide

Read this file first before changing the backend.

This repo is the active Roundtable codebase and is the source of truth for product behavior. It is a standalone app: it no longer depends on any external Cyberboss runtime, and `src/core/config.js` reads `ROUNDTABLE_*` environment variables only.

## Current Status

- `npm.cmd run check` passes.
- `npm.cmd test` passes with 109 tests across 14 test files.
- The backend has been split out of the old giant server file. Store, state, runtime, approval, check-in, summary, upload, TTS, embedding, and provider helpers are extracted; prompt construction and some orchestration helpers still live in `roundtable-server.js`.
- Core persistence is SQLite-backed for topics, messages, events, approvals, speaker seen state, summaries, check-ins, runtime sessions, storage notes, and study tracker data.
- Legacy split JSON import has been retired. The app now starts from SQLite only.
- Summary search is hybrid: FTS / keyword candidates plus optional local `bge-m3` embeddings stored on summaries.
- DeepSeek summary prompts split into `work` and `casual` paths by a `kind` field the model emits; `casual` keeps only `summaryText` + `tags` to avoid forcing chit-chat into work schema.
- Gemini is wired as a summary fallback when DeepSeek fails or is unavailable.
- Attachments and `[VOICE]` messages are part of the current user-facing behavior.
- `ROUND_TABLE_USER_GUIDE.md` is the non-technical user manual. Keep it aligned with real frontend behavior when changing user workflows.

### Room / container model (current rules)

- Container types: `fixed_room`, `direct_chat`, `project`, `temporary`. Each topic in DB carries `container_type` + `container_id` set once at creation; **container_id never changes**.
- Fixed rooms: 4 built-ins (`main` / `philosophy` / `otherworld` / `alone`) plus 2 customizable empty slots (`slot1` / `slot2`) defined in `DEFAULT_FIXED_ROOMS`. Slots have `customizable: true` and a stored `icon`. Built-ins can never be renamed; slots can.
- Projects: created via `/api/start` with `kind=project`. Icons are auto-assigned (stable hash from title into the geometric symbol pool). Project title is rename-able through `/api/project/update`. There is no project-icon picker; randomness is the point.
- Temporary topics: created via `/api/start` with `kind=temporary`. Rename via `/api/update-topic` preserves the `临时｜` prefix through `preserveCurrentKind` on the client.
- Demotion / promotion buttons (`设为固定` / `设为临时`) have been **removed** from the UI. Topic kind is decided once at creation; rename only changes the display title.
- Archive: temporary topics and projects can be archived (soft-hidden) via `hiddenTopicIds` / `hiddenProjectIds` on the client side. Archived items appear in the "已归档" group in the topics drawer with restore buttons.
- Relink: `relinkFixedRoomIfNeeded`, `relinkSidebarProjectIfNeeded`, `relinkDirectChatIfNeeded` now **prefer `container_id` matching** and only fall back to `topicTitle` string matching for legacy records. Renaming a topic can never sever the room↔topic binding.

### Rename / update APIs

| Endpoint | Body | Cascades to |
| --- | --- | --- |
| `/api/update-topic` | `{ id, topic }` | `topics.topic` only (current or archived). |
| `/api/fixed-room/update` | `{ roomId, title?, icon? }` | `fixedRooms[roomId].{title,icon,topicTitle}` + bound topic's `topic.topic`. Rejects non-customizable rooms. |
| `/api/project/update` | `{ id, title? }` | `sidebarProjects[i].{title,topicTitle}` + bound topic's `topic.topic` + `container.title`. |
| `/api/interrupt-speaker` | `{ speaker }` | Per-speaker interrupt of active runtime runs + finishes that speaker's pending messages only. Loop / global state untouched unless that was the last active run.

### MCP desktop tool contract (`src/desktop-mcp-server.js`)

- `messages_read` default `limit=6` when called without `since` (room entry mode) and `limit=50` when `since` is provided (diff mode). Entry responses include a `summary` field carrying the most recent durable summary for the current topic when one exists.
- `messages_send` returns `messageId`. When `waitForReply=true`, the wait call passes that `messageId` as `since`, so the wait response only carries messages the AI produced after the user's send. Cursor comparison still happens but only when `since` is absent (see `waitForDesktopMessages.hasChange`).

## Migration Progress

| Area | Status | Notes |
| --- | --- | --- |
| SQLite bootstrap + migrations | done | `migrations/` directory with 7 migration files |
| Topics | done | now stored in `topics`; container fields are explicit |
| Messages | done | stored in `messages` with FTS5 virtual table (`messages_fts`) |
| Message attachments | done | `attachments_json` on messages (003); uploaded files live under the state dir |
| Voice messages | done | `audio_url` and `voice_only` on messages (006); `[VOICE]` prefix triggers ElevenLabs TTS |
| Events | done | stored in `events` |
| Pending approvals | done | stored in `approvals` |
| Per-speaker last seen | done | stored in `speaker_topic_state` |
| Summaries | done | DB-backed; `summaries_fts` FTS5 virtual table for search |
| Summary behavior | changed | default run summarizes only the unsummarized tail; injection uses current topic summaries |
| Summary embeddings | done | `embedding_json` stores local embedding vectors (005) for semantic summary search / injection selection |
| Memory search API | done | `/api/memory/search` combines summary and raw-message results with actor-aware scope rules |
| Claude memory tooling | changed | now points at an optional external memory tool surface |
| Runtime sessions | done | DB-backed in `runtime_sessions` (002) |
| Check-ins | done | DB-backed in `checkins` |
| Storage notes | done | DB-backed in `storage_entries` (002) |
| Study tracker | done | DB-backed in `study_overview`, `study_plan_entries`, and `study_progress_entries` (004) |
| Store extraction | done | DB-backed `RoundtableStore`, `StorageStore`, and `StudyTrackerStore` live in `src/app/roundtable-store.js` |
| Legacy JSON retirement | done | old split JSON is no longer read or written by the app |
| Customizable fixed-room slots | done | `slot1` / `slot2` in `DEFAULT_FIXED_ROOMS`; `customizable` + `icon` fields; `/api/fixed-room/update` cascades rename to bound topic |
| Project rename | done | `/api/project/update` updates project, topicTitle, and bound topic title together |
| Room/topic binding stability | done | relink helpers prefer `container_id`; rename can no longer break room↔topic linkage |
| Demotion buttons retired | done | `设为固定` / `设为临时` UI removed; kind is decided once at creation |
| Per-speaker interrupt | done | `/api/interrupt-speaker` + a per-runtime-chip interrupt button |
| Archive + restore for projects/temp | done | client `hiddenTopicIds` / `hiddenProjectIds`; topics scrim shows an `已归档` group with restore buttons; archiving the active topic also calls `/api/end-topic` |
| Sidebar keyed reconciliation | done | `reconcileList` reuses DOM nodes by key+signature; 1.2s polling no longer rebuilds the room lists |
| maxRounds retired (user-facing) | done | frontend shows only `round` (no `/max`); `maxRounds` defaults to `DEFAULT_MAX_ROUNDS` (4) at creation, persisted in DB but never exposed via API to change |
| DeepSeek summary kind split | done | `work` and `casual` prompts (Chinese system prompt); model emits `kind`; server normalizes casual to drop `useful` / `decisions` / `openItems` / `latestState` |
| MCP entry / wait shape | done | `messages_read` default limit 6 + topic summary when no `since`; `messages_send` returns `messageId` and the wait call uses it as `since` |
| Runtime prompt cleanup | done | the duplicated `Context: fixed room "..."` line was removed from speaker / check-in prompts; AI sees only `Topic: <state.topic>` |
| Runtime worklog | done | `runtime_runs` + `runtime_worklog_events` (007) record each runtime turn and its event trail; surfaced per-message in the UI as a worklog dot (see below) |

## First Files To Read

Read in this order:

1. `PROJECT_GUIDE.md`
2. `src/app/roundtable-server.js`
3. `src/app/roundtable-state.js`
4. `src/app/roundtable-store.js`
5. `src/app/roundtable-runtime.js`
6. `src/app/roundtable-summary.js`
7. `src/app/roundtable-memory-search.js`
8. `src/app/roundtable-embedding.js`
9. `src/app/roundtable-checkin.js`
10. `src/app/roundtable-approval.js`
11. `test/*.test.js`

If you are here to continue the storage refactor, do not start by reading the frontend. The shortest useful path is:

1. inspect `migrations/001_init.sql` (and the later numbered migrations)
2. inspect the DB-backed `RoundtableStore` in `src/app/roundtable-store.js`
3. inspect the DB-backed path in `SummaryStore`

## Current Backend Shape

### App modules

- `src/app/roundtable-server.js`
  - HTTP server and API routing
  - round scheduling
  - current topic orchestration
- `src/app/roundtable-state.js`
  - topic/container normalization
  - fixed room, direct chat, and sidebar project helpers
  - topic archive helpers
- `src/app/roundtable-store.js`
  - DB-backed `RoundtableStore`
  - DB-backed `StorageStore`
  - DB-backed `StudyTrackerStore`
- `src/app/roundtable-runtime.js`
  - `RuntimeHub`
  - runtime waiters
  - Codex / Claude turn coordination
  - binding-key helpers and check-in thread availability checks
- `src/app/roundtable-summary.js`
  - DeepSeek summary prompt construction
  - Gemini-compatible summary message construction
  - summary normalization
  - summary FTS / keyword / semantic search scoring
  - DB-backed `SummaryStore`
- `src/app/roundtable-memory-search.js`
  - actor-aware memory search result composition
  - public/private scope expansion for owner, Codex, and Claude
  - max summary / raw-message result shaping for MCP and frontend search
- `src/app/roundtable-embedding.js`
  - local embedding generation through Ollama
  - cosine similarity helper used by summary search and injection selection
- `src/app/roundtable-checkin.js`
  - check-in parser
  - `RoundtableCheckinStore`
  - `RoundtableCheckinPoller`
- `src/app/roundtable-approval.js`
  - pending approval normalization
  - narrow auto-approval allowlist
  - approval response shaping
- `src/app/roundtable-deepseek.js`
  - outbound DeepSeek HTTP call only
- `src/app/roundtable-gemini.js`
  - Gemini HTTP call used as the summary fallback
- `src/app/roundtable-upload.js`
  - attachment persistence under the state dir
  - safe `/uploads/...` path resolution
- `src/app/roundtable-tts.js`
  - `[VOICE]` prefix parsing
  - ElevenLabs synthesis and audio file persistence
- `src/app/roundtable-utils.js`
  - shared normalization and small utility helpers

### Runtime adapters

- `src/adapters/runtime/codex/*`
- `src/adapters/runtime/claudecode/*`

These are stronger than the older legacy equivalents. They handle:

- per-topic runtime binding keys
- thread/session restore and recreate behavior
- fresh runtime resets
- approval responses
- Codex model catalog loading
- Claude IPC and session recovery edge cases

Do not casually simplify these adapters while working on persistence.

## Current Durable Data Model

State directory:

```text
%USERPROFILE%\.cyberboss-roundtable\roundtable
```

Durable store: `roundtable.db`

Fixed rooms and projects are stored as JSON blobs in `app_meta` (keys: `fixed_rooms_json`, `direct_chats_json`, `sidebar_projects_json`). They are normalized through helpers in `roundtable-state.js` (`normalizeFixedRooms`, `normalizeDirectChats`, `normalizeSidebarProjects`).

### Actual database schema (from migrations/)

```text
app_meta
- key TEXT PRIMARY KEY
- value TEXT NOT NULL

topics
- id TEXT PRIMARY KEY
- title TEXT NOT NULL
- container_type TEXT NOT NULL DEFAULT 'temporary'
- container_id TEXT NOT NULL DEFAULT ''
- container_title TEXT NOT NULL DEFAULT ''
- max_rounds INTEGER NOT NULL DEFAULT 4
- round INTEGER NOT NULL DEFAULT 0
- next_speaker TEXT NOT NULL DEFAULT 'codex'
- running INTEGER NOT NULL DEFAULT 0
- status TEXT NOT NULL DEFAULT 'ready'
- last_error TEXT NOT NULL DEFAULT ''
- fresh_runtime_handoffs_json TEXT NOT NULL DEFAULT '{}'
- created_at TEXT NOT NULL DEFAULT ''
- updated_at TEXT NOT NULL DEFAULT ''
- archived_at TEXT NOT NULL DEFAULT ''

messages
- id TEXT PRIMARY KEY
- topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE
- ordinal INTEGER NOT NULL
- speaker TEXT NOT NULL
- text TEXT NOT NULL DEFAULT ''
- pending INTEGER NOT NULL DEFAULT 0
- transcript INTEGER NOT NULL DEFAULT 1
- attachments_json TEXT NOT NULL DEFAULT '[]'       -- 003
- audio_url TEXT NOT NULL DEFAULT ''                -- 006
- voice_only INTEGER NOT NULL DEFAULT 0             -- 006
- created_at TEXT NOT NULL DEFAULT ''

messages_fts  (FTS5 virtual table over messages.text)

events
- id INTEGER PRIMARY KEY AUTOINCREMENT
- topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE
- ordinal INTEGER NOT NULL
- type TEXT NOT NULL DEFAULT ''
- payload_json TEXT NOT NULL DEFAULT '{}'
- created_at TEXT NOT NULL DEFAULT ''

approvals
- id TEXT PRIMARY KEY
- topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE
- speaker TEXT NOT NULL
- request_id TEXT NOT NULL
- runtime_request_id TEXT
- kind TEXT NOT NULL DEFAULT 'command'
- command TEXT NOT NULL DEFAULT ''
- command_tokens_json TEXT NOT NULL DEFAULT '[]'
- thread_id TEXT NOT NULL DEFAULT ''
- turn_id TEXT NOT NULL DEFAULT ''
- file_paths_json TEXT NOT NULL DEFAULT '[]'
- response_template_json TEXT
- elicitation_json TEXT
- created_at TEXT NOT NULL DEFAULT ''
- resolved_at TEXT NOT NULL DEFAULT ''
- status TEXT NOT NULL DEFAULT 'pending'

speaker_topic_state
- topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE
- speaker TEXT NOT NULL
- last_seen_message_id TEXT NOT NULL DEFAULT ''
- PRIMARY KEY (topic_id, speaker)

summaries
- id TEXT PRIMARY KEY
- topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE
- topic_title TEXT NOT NULL DEFAULT ''
- kind TEXT NOT NULL DEFAULT 'mixed'
- time_range_from TEXT NOT NULL DEFAULT ''
- time_range_to TEXT NOT NULL DEFAULT ''
- time_range_text TEXT NOT NULL DEFAULT ''
- message_range_from TEXT NOT NULL DEFAULT ''
- message_range_to TEXT NOT NULL DEFAULT ''
- message_count INTEGER NOT NULL DEFAULT 0
- summary_text TEXT NOT NULL DEFAULT ''
- useful_json TEXT NOT NULL DEFAULT '[]'
- decisions_json TEXT NOT NULL DEFAULT '[]'
- open_items_json TEXT NOT NULL DEFAULT '[]'
- latest_state TEXT NOT NULL DEFAULT ''
- tags_json TEXT NOT NULL DEFAULT '[]'
- keywords_json TEXT NOT NULL DEFAULT '[]'
- raw_text TEXT NOT NULL DEFAULT ''
- archived INTEGER NOT NULL DEFAULT 0
- embedding_json TEXT                              -- 005
- created_at TEXT NOT NULL DEFAULT ''

summaries_fts  (FTS5 virtual table over summaries.search_text)

checkins
- speaker TEXT PRIMARY KEY
- enabled INTEGER NOT NULL DEFAULT 1
- min_interval_ms INTEGER NOT NULL DEFAULT 600000
- max_interval_ms INTEGER NOT NULL DEFAULT 3600000
- next_at TEXT NOT NULL DEFAULT ''
- last_at TEXT NOT NULL DEFAULT ''
- last_action TEXT NOT NULL DEFAULT ''
- last_reason TEXT NOT NULL DEFAULT ''
- last_error TEXT NOT NULL DEFAULT ''
- updated_at TEXT NOT NULL DEFAULT ''

storage_entries                                     -- 002
- id TEXT PRIMARY KEY
- title TEXT NOT NULL DEFAULT ''
- summary TEXT NOT NULL DEFAULT ''
- source_topic TEXT NOT NULL DEFAULT ''
- source_type TEXT NOT NULL DEFAULT 'topic'
- tags_json TEXT NOT NULL DEFAULT '[]'
- importance TEXT NOT NULL DEFAULT 'normal'
- created_at TEXT NOT NULL DEFAULT ''

runtime_sessions                                    -- 002
- runtime_id TEXT PRIMARY KEY
- state_json TEXT NOT NULL DEFAULT '{}'
- updated_at TEXT NOT NULL DEFAULT ''

study_overview                                      -- 004
- id INTEGER PRIMARY KEY CHECK (id = 1)
- current_goal TEXT NOT NULL DEFAULT ''
- current_phase TEXT NOT NULL DEFAULT ''
- current_scores_json TEXT NOT NULL DEFAULT '{}'
- main_risks_json TEXT NOT NULL DEFAULT '[]'
- next_three_days_json TEXT NOT NULL DEFAULT '[]'
- updated_at TEXT NOT NULL DEFAULT ''

study_plan_entries                                  -- 004
- date TEXT PRIMARY KEY
- phase TEXT NOT NULL DEFAULT ''
- focus TEXT NOT NULL DEFAULT ''
- tasks_json TEXT NOT NULL DEFAULT '[]'
- target_metrics_json TEXT NOT NULL DEFAULT '[]'
- review_plan_json TEXT NOT NULL DEFAULT '[]'
- teacher_notes TEXT NOT NULL DEFAULT ''
- created_at TEXT NOT NULL DEFAULT ''
- updated_at TEXT NOT NULL DEFAULT ''

study_progress_entries                              -- 004
- date TEXT PRIMARY KEY
- actual_completed TEXT NOT NULL DEFAULT ''
- evidence TEXT NOT NULL DEFAULT ''
- self_note TEXT NOT NULL DEFAULT ''
- teacher_feedback TEXT NOT NULL DEFAULT ''
- review_debt_json TEXT NOT NULL DEFAULT '[]'
- next_adjustment TEXT NOT NULL DEFAULT ''
- created_at TEXT NOT NULL DEFAULT ''
- updated_at TEXT NOT NULL DEFAULT ''

runtime_runs                                        -- 007
- id TEXT PRIMARY KEY
- topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE
- message_id TEXT NOT NULL DEFAULT ''
- kind TEXT NOT NULL DEFAULT 'runtime_turn'
- speaker TEXT NOT NULL DEFAULT ''
- status TEXT NOT NULL DEFAULT 'running'
- title / phase / detail TEXT NOT NULL DEFAULT ''
- thread_id / turn_id TEXT NOT NULL DEFAULT ''
- started_at / updated_at / ended_at TEXT NOT NULL DEFAULT ''

runtime_worklog_events                              -- 007
- id INTEGER PRIMARY KEY AUTOINCREMENT
- run_id TEXT NOT NULL REFERENCES runtime_runs(id) ON DELETE CASCADE
- topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE
- message_id TEXT NOT NULL DEFAULT ''
- seq INTEGER NOT NULL
- type TEXT NOT NULL DEFAULT ''
- level TEXT NOT NULL DEFAULT 'info'
- title TEXT NOT NULL DEFAULT ''
- detail_json TEXT NOT NULL DEFAULT '{}'
- created_at TEXT NOT NULL DEFAULT ''
```

Key indexes:
- `topics(container_type, container_id)`
- `topics(updated_at)`
- `messages(topic_id, ordinal)`
- `messages(topic_id, created_at)`
- `events(topic_id, ordinal)`
- `approvals(status)`
- `approvals(topic_id)`
- `summaries(topic_id, created_at)`
- `study_plan_entries(updated_at)`
- `study_progress_entries(updated_at)`
- `messages_fts` (FTS5 on `messages.text`)
- `summaries_fts` (FTS5 on `summaries.search_text`)
- `messages` FTS triggers: `messages_ai`, `messages_ad`, `messages_au`

### Current conceptual model

This app is not only "rooms with messages."

The core product model is:

- a **topic** is the main conversation entity
- a **container** may be:
  - fixed room
  - direct chat
  - project
  - temporary topic
- a topic owns:
  - messages
  - events
  - round state
  - runtime handoff state
  - last-seen markers
  - approvals
- fixed rooms / direct chats / projects point to topics
- fixed rooms and direct chats are defined in code (`DEFAULT_FIXED_ROOMS`, `DEFAULT_DIRECT_CHATS`) and their state (title, icon, topicId binding) is persisted in `app_meta` as JSON
- projects are persisted in `app_meta` as `sidebar_projects_json`

Important helpers still in `roundtable-server.js`:

- `normalizeRoundtableState`
- `normalizeTopicRecord`
- `resolveTopicContainer`
- `archiveCurrentTopic`
- `openOrCreateBoundTopic`
- `formatTranscript`
- `getUnreadMessagesForSpeaker`

Current SQLite behavior worth knowing:

- `RoundtableStore.get()/update()` still expose the old in-memory state shape so the upper app layer did not need a giant rewrite
- topic/container fields are now stored explicitly in `topics`
- message search is DB-backed and uses FTS with substring fallback
- summaries are DB-backed, and manual summary runs default to only the unsummarized tail of a topic
- new summaries attempt to store an `embedding_json` vector; failures are logged and do not block the summary
- summary search uses embedding candidates when available, then merges FTS and substring candidates
- summary injection now uses the current topic's summaries instead of "today's summaries across all topics"
- fresh-runtime summary injection can semantically select up to 6 summaries from the current topic when enough embeddings exist
- `/api/memory/search` returns a mixed memory surface: at most 3 summaries and at most 3 raw-message hits by default, with raw-message context
- Codex / Claude memory search is scoped: global actor search includes public scopes plus that actor's own direct chat, not the other actor's direct chat
- study tracking is DB-backed and exposed through `/api/study-tracker`
- attachments are stored under `<state dir>/uploads` and referenced from message metadata
- `[VOICE]` replies can create audio files via ElevenLabs; missing keys or voice ids fall back to text
- maxRounds is always `DEFAULT_MAX_ROUNDS` (4) at topic creation; there is no API endpoint to change it. The round counter in the frontend shows only the current round number (not `round/max`). The DB column is kept for backward compatibility.
- each runtime turn is recorded in `runtime_runs`, and its lifecycle events (queued / started / context / thinking / tool calls / approvals / reply / completed) in `runtime_worklog_events`. `runtimeWorklogSnapshot()` builds a per-message worklog keyed by `run.messageId`. The lightweight snapshot (used by the main state payload) drops heavy detail fields via `compactRuntimeWorklogEventForUi`, but keeps a capped `thinking.updated` text so the per-message worklog dot can show the thinking trail inline. The frontend renders this as a small dot in each AI message's meta row that expands to a humanized event list.

## Study Tracker Handoff

The study tracker tracks learning progress across any topic.

For a new Codex or Claude session, do not reconstruct learning state from chat first. Read in this order:

1. `GET /api/study-tracker?limit=7`
2. `overview`
3. the newest `planEntries`
4. the newest `progressEntries`
5. only then use room chat, summaries, or notebooks for extra context

Current tracker tables:

- `study_overview`
  - one current snapshot for fast handoff
  - current goal, current phase, current scores, main risks, next three days
- `study_plan_entries`
  - teacher-authored daily plan rows
  - phase, focus, tasks, target metrics, review plan, teacher notes
- `study_progress_entries`
  - daily execution rows
  - actual completion, evidence, learner note, teacher feedback, review debt, next adjustment

Interpretation rules:

- `overview` is the first handoff surface.
- `study_plan_entries` answers what was supposed to happen.
- `study_progress_entries` answers what actually happened.
- `reviewDebt` is the fastest field for unfinished work and repeated weak points.
- Use recent rows plus `overview`; do not treat old rows as current state unless the recent tracker history points back to them.

## What Was Recently Improved

The old backend had one oversized `roundtable-server.js` file that mixed HTTP, runtime coordination, approvals, summaries, check-ins, DeepSeek I/O, and shared helpers.

Recent refactor work extracted:

- approval logic
- check-in logic
- runtime coordination
- DeepSeek I/O
- summary logic
- shared utility helpers
- embedding, upload, TTS, Gemini, memory-search, and related helpers now live in dedicated modules

## Known Strengths Of The Current Code

- Product behavior is richer than the older legacy version.
- Runtime behavior is mature:
  - thread/session reuse
  - resume fallback
  - fresh-runtime handoff
  - approvals
  - timeout handling
- Topic behavior is mature:
  - archived topics
  - fixed rooms
  - direct chats
  - projects
  - per-speaker unread tracking
- Search behavior is better than plain transcript grep:
  - message search is DB-backed FTS with substring fallback
  - summary search can use local embeddings
  - actor search scopes protect Codex / Claude direct-chat boundaries
- User-facing workflow coverage is broad:
  - summary hide/edit/merge/inject
  - attachments
  - `[VOICE]` messages
  - check-in wakeups
  - per-speaker interrupt button on each runtime chip
  - 2 customizable fixed-room slots with rename + icon picker
  - project rename + per-project / per-temp-topic archive with restore
  - user-facing non-technical guide in `ROUND_TABLE_USER_GUIDE.md`
- Regression coverage is decent for:
  - approvals
  - check-ins
  - topic switching
  - summaries
  - Claude project settings

## Current Weaknesses

### 1. Summary quality still needs work

The summary path is structurally better than the older guide described, but still not finished:

- segment summaries are generated independently
- handoff injection still mostly assembles existing summaries instead of building one durable current-state digest
- semantic search exists for summaries, but quality depends on Ollama / `bge-m3` availability and on embeddings having been generated
- hidden summaries are correctly excluded, so bad summaries should be hidden rather than left to pollute handoff/search

### 2. Search is hybrid but uneven

- message search is DB-backed with FTS plus substring fallback
- summary search is DB-backed and can merge semantic, FTS, and substring candidates
- raw messages are not embedded one-by-one; raw-message search remains lexical
- frontend search and MCP `searchMemory` share the same memory surface, but direct tests around result composition and permission boundaries should keep expanding

The remaining cleanup is mostly search quality, not storage shape.

### 3. Prompt construction is still mixed into the server

The next clean split is prompt construction, especially runtime prompts vs. summary prompts.

### 4. User-facing docs can drift quickly

`ROUND_TABLE_USER_GUIDE.md` now captures the intended non-technical user model. When frontend labels or workflow semantics change, update that guide in the same patch.

### 5. Fixed rooms and projects stored as JSON in app_meta

Fixed room state (`fixed_rooms_json`) and project state (`sidebar_projects_json`) are stored as opaque JSON blobs in the `app_meta` table rather than as normalized relational rows. This works for current usage but makes direct SQL queries against room/project state impractical. If the number of rooms or projects grows significantly, or if new features need to query them relationally, consider migrating to dedicated `fixed_rooms` and `projects` tables.
const {
  clampInteger,
  normalizeAttachments,
  normalizeIsoText,
  normalizeText,
} = require("./roundtable-utils");
const {
  emptyRoundtableState,
  extractTopicRecord,
  listArchivedTopics,
  normalizeDirectChats,
  normalizeFixedRooms,
  normalizeRoundtableState,
  normalizeSidebarProjects,
  normalizeTopicContainer,
  normalizeTopicRecord,
} = require("./roundtable-state");
const { resolveSearchScope } = require("./roundtable-search-scope");

const SQLITE_BUSY_ERRCODE = 5;
const SQLITE_BUSY_RETRY_DELAYS_MS = [50, 100, 250, 500, 1000];

class RoundtableStore {
  constructor({ db }) {
    if (!db) {
      throw new Error("RoundtableStore requires db");
    }
    this.db = db;
    this.state = emptyRoundtableState();
    this.load();
  }

  load() {
    this.state = this.loadFromDb();
    if (settleInterruptedRuntimeState(this.state)) {
      this.save();
    }
  }

  get() {
    return JSON.parse(JSON.stringify(this.state));
  }

  snapshot() {
    const state = this.get();
    state.topics = listArchivedTopics(state.topics);
    state.hiddenTopicIds = this.getHiddenTopicIds();
    return state;
  }

  replace(next) {
    this.state = {
      ...emptyRoundtableState(),
      ...(next || {}),
    };
    this.save();
  }

  update(mutator, { silentIfEmpty = false } = {}) {
    if (silentIfEmpty && !this.state.id) {
      return this.state;
    }
    const draft = this.get();
    this.state = mutator(draft) || draft;
    this.state.updatedAt = this.state.updatedAt || new Date().toISOString();
    this.save();
    return this.state;
  }

  updateTransient(mutator, { silentIfEmpty = false } = {}) {
    if (silentIfEmpty && !this.state.id) {
      return this.state;
    }
    this.state = mutator(this.state) || this.state;
    this.state.updatedAt = this.state.updatedAt || new Date().toISOString();
    return this.state;
  }

  save() {
    this.writeDbState(this.state);
  }

  writeDbState(state) {
    return runWithSqliteBusyRetry(() => this.writeDbStateOnce(state));
  }

  writeDbStateOnce(state) {
    const normalized = normalizeRoundtableState(state);
    const activeTopic = normalized.id ? extractTopicRecord(normalized) : null;
    const archivedTopics = (Array.isArray(normalized.topics) ? normalized.topics : [])
      .map((topic) => normalizeTopicRecord(topic))
      .filter((topic) => topic.id && topic.id !== activeTopic?.id);
    const allTopics = activeTopic ? [activeTopic, ...archivedTopics] : archivedTopics;
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      const existingTopicIds = new Set(
        this.db.prepare("SELECT id FROM topics").all().map((row) => row.id)
      );
      const seen = new Set();
      for (const topic of allTopics) {
        if (seen.has(topic.id)) {
          continue;
        }
        seen.add(topic.id);
        this.writeTopicToDb(topic, {
          archivedAt: topic.id === activeTopic?.id ? "" : topic.updatedAt || topic.createdAt || now,
        });
      }
      for (const topicId of existingTopicIds) {
        if (!seen.has(topicId)) {
          this.db.prepare("DELETE FROM topics WHERE id = ?").run(topicId);
        }
      }
      this.setMeta("active_topic_id", activeTopic?.id || "");
      this.setMeta("fixed_rooms_json", JSON.stringify(normalizeFixedRooms(normalized.fixedRooms)));
      this.setMeta("direct_chats_json", JSON.stringify(normalizeDirectChats(normalized.directChats)));
      this.setMeta("sidebar_projects_json", JSON.stringify(normalizeSidebarProjects(normalized.sidebarProjects)));
      this.setMeta("updated_at", now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  addMessageToTopic(topicId, message) {
    const id = normalizeText(topicId);
    if (!id) throw new Error("topicId is required");
    if (id === this.state.id) {
      this.state.messages = Array.isArray(this.state.messages) ? this.state.messages : [];
      this.state.messages.push(message);
      this.state.updatedAt = new Date().toISOString();
      this.save();
      return;
    }
    const topic = this.readTopicFromDb(id);
    if (!topic?.id) throw new Error("topic not found: " + id);
    topic.messages = Array.isArray(topic.messages) ? topic.messages : [];
    topic.messages.push(message);
    topic.updatedAt = new Date().toISOString();
    runWithSqliteBusyRetry(() => this.writeTopicToDb(topic, {
      archivedAt: topic.archivedAt || topic.updatedAt || topic.createdAt || "",
    }));
  }

  searchMessages({ query = "", limit = 10, contextSize = 3, scope = "global", project = "", topicId = "" } = {}) {
    const q = normalizeText(query).toLowerCase();
    const resolvedScope = resolveSearchScope(this.db, { scope, project, topicId });
    if (!q) return { query: q, scope: resolvedScope, items: [] };
    const maxResults = clampInteger(limit, 1, 30, 10);
    const ctx = clampInteger(contextSize, 0, 10, 3);
    const matches = this.searchMessageRows(q, maxResults, resolvedScope);
    const items = [];
    for (const match of matches) {
      if (items.length >= maxResults) break;
      const topicId = normalizeText(match.topic_id);
      if (!topicId) continue;
      const topic = this.readTopicFromDb(topicId);
      if (!topic?.messages?.length) continue;
      const msgs = topic.messages;
      const index = msgs.findIndex((message) => message.id === match.id);
      if (index < 0) continue;
      const slimMsg = (m) => ({ id: m.id, speaker: m.speaker, text: m.text, at: m.at || "" });
      items.push({
        topicId: topic.id,
        topicTitle: topic.topic || topic.id,
        container: topic.container || {},
        matchMessage: slimMsg(msgs[index]),
        contextBefore: msgs.slice(Math.max(0, index - ctx), index).map(slimMsg),
        contextAfter: msgs.slice(index + 1, Math.min(msgs.length, index + 1 + ctx)).map(slimMsg),
      });
    }
    return { query: q, scope: resolvedScope, items };
  }

  loadFromDb() {
    const activeTopicId = this.getMeta("active_topic_id");
    const activeTopic = activeTopicId ? this.readTopicFromDb(activeTopicId) : null;
    const archivedTopics = this.db.prepare(
      "SELECT id FROM topics WHERE id <> ? ORDER BY updated_at DESC"
    ).all(activeTopicId || "").map((row) => this.readTopicFromDb(row.id)).filter(Boolean);
    return normalizeRoundtableState({
      ...emptyRoundtableState(),
      ...(activeTopic || {}),
      fixedRooms: parseJson(this.getMeta("fixed_rooms_json"), {}),
      directChats: parseJson(this.getMeta("direct_chats_json"), {}),
      sidebarProjects: parseJson(this.getMeta("sidebar_projects_json"), []),
      topics: archivedTopics,
      updatedAt: this.getMeta("updated_at") || activeTopic?.updatedAt || "",
    });
  }

  readTopicFromDb(topicId) {
    const row = this.db.prepare("SELECT * FROM topics WHERE id = ?").get(topicId);
    if (!row) {
      return null;
    }
    const messages = this.db.prepare(
      "SELECT * FROM messages WHERE topic_id = ? ORDER BY ordinal"
    ).all(topicId).map((message) => ({
      id: message.id,
      speaker: message.speaker,
      text: message.text,
      attachments: normalizeAttachments(parseJson(message.attachments_json, [])),
      audioUrl: message.audio_url || "",
      voiceOnly: Boolean(message.voice_only),
      pending: Boolean(message.pending),
      transcript: Boolean(message.transcript),
      at: message.created_at,
    }));
    const events = this.db.prepare(
      "SELECT * FROM events WHERE topic_id = ? ORDER BY ordinal"
    ).all(topicId).map((event) => ({
      type: event.type,
      payload: parseJson(event.payload_json, {}),
      at: event.created_at,
    }));
    const pendingApprovals = this.db.prepare(
      "SELECT * FROM approvals WHERE topic_id = ? AND status = 'pending' ORDER BY created_at"
    ).all(topicId).map((approval) => ({
      speaker: approval.speaker,
      requestId: approval.request_id,
      runtimeRequestId: approval.runtime_request_id || approval.request_id,
      kind: approval.kind,
      command: approval.command,
      commandTokens: parseJson(approval.command_tokens_json, []),
      threadId: approval.thread_id,
      turnId: approval.turn_id,
      filePaths: parseJson(approval.file_paths_json, []),
      responseTemplate: parseJson(approval.response_template_json, null),
      elicitation: parseJson(approval.elicitation_json, null),
      at: approval.created_at,
    }));
    const lastSeenMessageIdBySpeaker = {};
    for (const speakerState of this.db.prepare(
      "SELECT speaker, last_seen_message_id FROM speaker_topic_state WHERE topic_id = ?"
    ).all(topicId)) {
      lastSeenMessageIdBySpeaker[speakerState.speaker] = speakerState.last_seen_message_id;
    }
    return normalizeTopicRecord({
      id: row.id,
      topic: row.title,
      container: {
        type: row.container_type,
        id: row.container_id,
        title: row.container_title,
      },
      maxRounds: row.max_rounds,
      round: row.round,
      nextSpeaker: row.next_speaker,
      running: Boolean(row.running),
      status: row.status,
      lastError: row.last_error,
      freshRuntimeHandoffs: parseJson(row.fresh_runtime_handoffs_json, {}),
      lastSeenMessageIdBySpeaker,
      pendingApprovals,
      messages,
      events,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  writeTopicToDb(topic, { archivedAt = "" } = {}) {
    const normalized = normalizeTopicRecord(topic);
    const container = normalizeTopicContainer(normalized.container);
    this.db.prepare(
      `INSERT INTO topics (
        id, title, container_type, container_id, container_title,
        max_rounds, round, next_speaker, running, status, last_error,
        fresh_runtime_handoffs_json, created_at, updated_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        container_type = excluded.container_type,
        container_id = excluded.container_id,
        container_title = excluded.container_title,
        max_rounds = excluded.max_rounds,
        round = excluded.round,
        next_speaker = excluded.next_speaker,
        running = excluded.running,
        status = excluded.status,
        last_error = excluded.last_error,
        fresh_runtime_handoffs_json = excluded.fresh_runtime_handoffs_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        archived_at = excluded.archived_at`
    ).run(
      normalized.id,
      normalized.topic,
      container.type || "temporary",
      container.id || "",
      container.title || "",
      normalized.maxRounds,
      normalized.round,
      normalized.nextSpeaker,
      normalized.running ? 1 : 0,
      normalized.status,
      normalized.lastError,
      JSON.stringify(normalized.freshRuntimeHandoffs || {}),
      normalized.createdAt || "",
      normalized.updatedAt || "",
      archivedAt || "",
    );
    this.db.prepare("DELETE FROM messages WHERE topic_id = ?").run(normalized.id);
    const insertMessage = this.db.prepare(
      `INSERT INTO messages (
         id, topic_id, ordinal, speaker, text, attachments_json,
         audio_url, voice_only, pending, transcript, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    normalized.messages.forEach((message, index) => {
      insertMessage.run(
        normalizeText(message.id) || `${normalized.id}-message-${index + 1}`,
        normalized.id,
        index,
        message.speaker,
        normalizeText(message.text),
        JSON.stringify(normalizeAttachments(message.attachments)),
        normalizeText(message.audioUrl),
        message.voiceOnly ? 1 : 0,
        message.pending ? 1 : 0,
        message.transcript === false ? 0 : 1,
        normalizeIsoText(message.at) || "",
      );
    });
    this.db.prepare("DELETE FROM events WHERE topic_id = ?").run(normalized.id);
    const insertEvent = this.db.prepare(
      `INSERT INTO events (topic_id, ordinal, type, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    normalized.events.forEach((event, index) => {
      insertEvent.run(
        normalized.id,
        index,
        normalizeText(event?.type),
        JSON.stringify(event?.payload || {}),
        normalizeIsoText(event?.at) || "",
      );
    });
    this.db.prepare("DELETE FROM approvals WHERE topic_id = ?").run(normalized.id);
    const insertApproval = this.db.prepare(
      `INSERT INTO approvals (
        id, topic_id, speaker, request_id, runtime_request_id, kind, command,
        command_tokens_json, thread_id, turn_id, file_paths_json,
        response_template_json, elicitation_json, created_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    );
    normalized.pendingApprovals.forEach((approval) => {
      insertApproval.run(
        `${normalized.id}:${approval.speaker}:${approval.requestId}`,
        normalized.id,
        approval.speaker,
        approval.requestId,
        approval.runtimeRequestId ?? approval.requestId,
        approval.kind,
        approval.command,
        JSON.stringify(approval.commandTokens || []),
        approval.threadId,
        approval.turnId,
        JSON.stringify(approval.filePaths || []),
        approval.responseTemplate ? JSON.stringify(approval.responseTemplate) : null,
        approval.elicitation ? JSON.stringify(approval.elicitation) : null,
        approval.at,
      );
    });
    this.db.prepare("DELETE FROM speaker_topic_state WHERE topic_id = ?").run(normalized.id);
    const insertSpeakerState = this.db.prepare(
      `INSERT INTO speaker_topic_state (topic_id, speaker, last_seen_message_id)
       VALUES (?, ?, ?)`
    );
    for (const [speaker, lastSeenMessageId] of Object.entries(normalized.lastSeenMessageIdBySpeaker || {})) {
      if (normalizeText(lastSeenMessageId)) {
        insertSpeakerState.run(normalized.id, speaker, normalizeText(lastSeenMessageId));
      }
    }
  }

  searchMessageRows(query, limit, resolvedScope = null) {
    const topicIds = resolvedScope?.isGlobal ? null : resolvedScope?.topicIds;
    if (Array.isArray(topicIds) && !topicIds.length) {
      return [];
    }
    const topicFilter = buildTopicFilterSql(topicIds, "messages.topic_id");
    try {
      const ftsRows = this.db.prepare(
        `SELECT messages.id, messages.topic_id
         FROM messages
         JOIN messages_fts ON messages.rowid = messages_fts.rowid
         WHERE messages_fts MATCH ?
           ${topicFilter.sql}
         ORDER BY rank
         LIMIT ?`
      ).all(buildFtsQuery(query), ...topicFilter.params, limit);
      if (ftsRows.length) {
        return ftsRows;
      }
    } catch {
      // Fall back to substring search for punctuation-heavy or Chinese queries.
    }
    return this.db.prepare(
      `SELECT id, topic_id
       FROM messages
       WHERE lower(text) LIKE ?
         ${topicFilter.sql.replaceAll("messages.", "")}
       ORDER BY created_at DESC, ordinal DESC
       LIMIT ?`
    ).all(`%${query.toLowerCase()}%`, ...topicFilter.params, limit);
  }

  setMeta(key, value) {
    this.db.prepare(
      `INSERT INTO app_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(key, String(value ?? ""));
  }

  getMeta(key) {
    return this.db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key)?.value || "";
  }

  getHiddenTopicIds() {
    return parseJson(this.getMeta("hidden_topic_ids_json"), [])
      .map((id) => normalizeText(id))
      .filter(Boolean);
  }

  hideTopicFromSidebar(topicId) {
    const id = normalizeText(topicId);
    if (!id) throw new Error("topic id is required");
    const ids = new Set(this.getHiddenTopicIds());
    ids.add(id);
    this.setMeta("hidden_topic_ids_json", JSON.stringify([...ids]));
    return { ok: true, hiddenTopicIds: [...ids] };
  }

  hideTopicsFromSidebar(topicIds = []) {
    const ids = new Set(this.getHiddenTopicIds());
    for (const topicId of Array.isArray(topicIds) ? topicIds : []) {
      const id = normalizeText(topicId);
      if (id) ids.add(id);
    }
    this.setMeta("hidden_topic_ids_json", JSON.stringify([...ids]));
    return { ok: true, hiddenTopicIds: [...ids] };
  }

  showTopicInSidebar(topicId) {
    const id = normalizeText(topicId);
    if (!id) throw new Error("topic id is required");
    const ids = new Set(this.getHiddenTopicIds());
    ids.delete(id);
    this.setMeta("hidden_topic_ids_json", JSON.stringify([...ids]));
    return { ok: true, hiddenTopicIds: [...ids] };
  }
}

class StorageStore {
  constructor({ db }) {
    if (!db) {
      throw new Error("StorageStore requires db");
    }
    this.db = db;
  }

  list() {
    return this.db.prepare(
      `SELECT id, title, summary, source_topic, source_type, tags_json, importance, created_at
       FROM storage_entries
       ORDER BY created_at DESC`
    ).all().map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      sourceTopic: row.source_topic,
      sourceType: row.source_type,
      tags: parseJson(row.tags_json, []),
      importance: row.importance,
      createdAt: row.created_at,
    }));
  }

  add(entry) {
    const id = `storage_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newEntry = {
      id,
      title: String(entry.title || "").trim() || "鏃犳爣棰?",
      summary: String(entry.summary || "").trim(),
      sourceTopic: String(entry.sourceTopic || "").trim(),
      sourceType: String(entry.sourceType || "topic").trim(),
      tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
      importance: String(entry.importance || "normal").trim(),
      createdAt: new Date().toISOString(),
    };
    this.db.prepare(
      `INSERT INTO storage_entries (
        id, title, summary, source_topic, source_type, tags_json, importance, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newEntry.id,
      newEntry.title,
      newEntry.summary,
      newEntry.sourceTopic,
      newEntry.sourceType,
      JSON.stringify(newEntry.tags),
      newEntry.importance,
      newEntry.createdAt,
    );
    return newEntry;
  }

  remove(id) {
    const result = this.db.prepare("DELETE FROM storage_entries WHERE id = ?").run(id);
    return Number(result.changes || 0) > 0;
  }
}

class StudyTrackerStore {
  constructor({ db }) {
    if (!db) {
      throw new Error("StudyTrackerStore requires db");
    }
    this.db = db;
  }

  snapshot({ limit = 14 } = {}) {
    return {
      overview: this.getOverview(),
      planEntries: this.listPlanEntries({ limit }),
      progressEntries: this.listProgressEntries({ limit }),
    };
  }

  getOverview() {
    const row = this.db.prepare(
      `SELECT current_goal, current_phase, current_scores_json, main_risks_json,
              next_three_days_json, updated_at
       FROM study_overview
       WHERE id = 1`
    ).get();
    return {
      currentGoal: row?.current_goal || "",
      currentPhase: row?.current_phase || "",
      currentScores: parseJson(row?.current_scores_json, {}),
      mainRisks: parseJson(row?.main_risks_json, []),
      nextThreeDays: parseJson(row?.next_three_days_json, []),
      updatedAt: row?.updated_at || "",
    };
  }

  upsertOverview(entry = {}) {
    const next = {
      currentGoal: normalizeText(entry.currentGoal),
      currentPhase: normalizeText(entry.currentPhase),
      currentScores: normalizeRecord(entry.currentScores),
      mainRisks: normalizeTextList(entry.mainRisks),
      nextThreeDays: normalizeTextList(entry.nextThreeDays),
      updatedAt: new Date().toISOString(),
    };
    this.db.prepare(
      `INSERT INTO study_overview (
        id, current_goal, current_phase, current_scores_json, main_risks_json,
        next_three_days_json, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        current_goal = excluded.current_goal,
        current_phase = excluded.current_phase,
        current_scores_json = excluded.current_scores_json,
        main_risks_json = excluded.main_risks_json,
        next_three_days_json = excluded.next_three_days_json,
        updated_at = excluded.updated_at`
    ).run(
      next.currentGoal,
      next.currentPhase,
      JSON.stringify(next.currentScores),
      JSON.stringify(next.mainRisks),
      JSON.stringify(next.nextThreeDays),
      next.updatedAt,
    );
    return next;
  }

  listPlanEntries({ limit = 14 } = {}) {
    return this.db.prepare(
      `SELECT date, phase, focus, tasks_json, target_metrics_json, review_plan_json,
              teacher_notes, created_at, updated_at
       FROM study_plan_entries
       ORDER BY date DESC
       LIMIT ?`
    ).all(clampInteger(limit, 1, 90, 14)).map(mapPlanEntry);
  }

  upsertPlanEntry(entry = {}) {
    const date = normalizeDate(entry.date);
    if (!date) {
      throw new Error("study plan date is required");
    }
    const existing = this.db.prepare(
      "SELECT created_at FROM study_plan_entries WHERE date = ?"
    ).get(date);
    const now = new Date().toISOString();
    const next = {
      date,
      phase: normalizeText(entry.phase),
      focus: normalizeText(entry.focus),
      tasks: normalizeTextList(entry.tasks),
      targetMetrics: normalizeTextList(entry.targetMetrics),
      reviewPlan: normalizeTextList(entry.reviewPlan),
      teacherNotes: normalizeText(entry.teacherNotes),
      createdAt: existing?.created_at || now,
      updatedAt: now,
    };
    this.db.prepare(
      `INSERT INTO study_plan_entries (
        date, phase, focus, tasks_json, target_metrics_json, review_plan_json,
        teacher_notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        phase = excluded.phase,
        focus = excluded.focus,
        tasks_json = excluded.tasks_json,
        target_metrics_json = excluded.target_metrics_json,
        review_plan_json = excluded.review_plan_json,
        teacher_notes = excluded.teacher_notes,
        updated_at = excluded.updated_at`
    ).run(
      next.date,
      next.phase,
      next.focus,
      JSON.stringify(next.tasks),
      JSON.stringify(next.targetMetrics),
      JSON.stringify(next.reviewPlan),
      next.teacherNotes,
      next.createdAt,
      next.updatedAt,
    );
    return next;
  }

  listProgressEntries({ limit = 14 } = {}) {
    return this.db.prepare(
      `SELECT date, actual_completed, evidence, self_note, teacher_feedback,
              review_debt_json, next_adjustment, created_at, updated_at
       FROM study_progress_entries
       ORDER BY date DESC
       LIMIT ?`
    ).all(clampInteger(limit, 1, 90, 14)).map(mapProgressEntry);
  }

  upsertProgressEntry(entry = {}) {
    const date = normalizeDate(entry.date);
    if (!date) {
      throw new Error("study progress date is required");
    }
    const existing = this.db.prepare(
      "SELECT created_at FROM study_progress_entries WHERE date = ?"
    ).get(date);
    const now = new Date().toISOString();
    const next = {
      date,
      actualCompleted: normalizeText(entry.actualCompleted),
      evidence: normalizeText(entry.evidence),
      selfNote: normalizeText(entry.selfNote),
      teacherFeedback: normalizeText(entry.teacherFeedback),
      reviewDebt: normalizeTextList(entry.reviewDebt),
      nextAdjustment: normalizeText(entry.nextAdjustment),
      createdAt: existing?.created_at || now,
      updatedAt: now,
    };
    this.db.prepare(
      `INSERT INTO study_progress_entries (
        date, actual_completed, evidence, self_note, teacher_feedback,
        review_debt_json, next_adjustment, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        actual_completed = excluded.actual_completed,
        evidence = excluded.evidence,
        self_note = excluded.self_note,
        teacher_feedback = excluded.teacher_feedback,
        review_debt_json = excluded.review_debt_json,
        next_adjustment = excluded.next_adjustment,
        updated_at = excluded.updated_at`
    ).run(
      next.date,
      next.actualCompleted,
      next.evidence,
      next.selfNote,
      next.teacherFeedback,
      JSON.stringify(next.reviewDebt),
      next.nextAdjustment,
      next.createdAt,
      next.updatedAt,
    );
    return next;
  }
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function runWithSqliteBusyRetry(operation) {
  let lastError = null;
  for (let attempt = 0; attempt <= SQLITE_BUSY_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt >= SQLITE_BUSY_RETRY_DELAYS_MS.length) {
        throw error;
      }
      lastError = error;
      sleepSync(SQLITE_BUSY_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

function settleInterruptedRuntimeState(state) {
  const messages = Array.isArray(state?.messages) ? state.messages : [];
  const runtimeRuns = Array.isArray(state?.runtimeRuns) ? state.runtimeRuns : [];
  const hadPendingMessages = messages.some((message) => message?.pending);
  const hadActiveRuns = runtimeRuns.some((run) => isActiveRuntimeRun(run));
  const wasRunning = Boolean(state?.running);
  if (!hadPendingMessages && !hadActiveRuns && !wasRunning) {
    return false;
  }
  const now = new Date().toISOString();
  for (const message of messages) {
    if (!message?.pending) {
      continue;
    }
    message.pending = false;
    if (!normalizeText(message.text)) {
      message.text = "Previous run was interrupted by server restart.";
    }
  }
  state.runtimeRuns = runtimeRuns.map((run) => (
    isActiveRuntimeRun(run)
      ? {
        ...run,
        status: "interrupted",
        phase: "restart",
        detail: normalizeText(run.detail) || "Previous run was interrupted by server restart.",
        updatedAt: now,
        endedAt: now,
      }
      : run
  ));
  state.running = false;
  state.status = "paused";
  state.lastError = "Previous run was interrupted. Start the next step again.";
  state.updatedAt = now;
  return true;
}

function isActiveRuntimeRun(run = {}) {
  return ["running", "waiting_approval", "checking_in"].includes(normalizeText(run.status));
}

function isSqliteBusyError(error) {
  return Boolean(
    error &&
      (
        error.errcode === SQLITE_BUSY_ERRCODE ||
        error.code === "SQLITE_BUSY" ||
        error.errstr === "database is locked" ||
        /database is locked/u.test(String(error.message || ""))
      )
  );
}

function sleepSync(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function buildFtsQuery(value) {
  return normalizeText(value)
    .split(/\s+/u)
    .map((term) => term.replace(/"/g, ""))
    .filter(Boolean)
    .map((term) => `"${term}"`)
    .join(" ");
}

function buildTopicFilterSql(topicIds, columnName) {
  if (!Array.isArray(topicIds)) {
    return { sql: "", params: [] };
  }
  const placeholders = topicIds.map(() => "?").join(", ");
  return {
    sql: `AND ${columnName} IN (${placeholders})`,
    params: topicIds,
  };
}

function normalizeDate(value) {
  const text = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/u.test(text) ? text : "";
}

function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }
  return normalizeText(value)
    .split(/\r?\n/u)
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function normalizeRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [normalizeText(key), normalizeText(item)])
      .filter(([key, item]) => key && item)
  );
}

function mapPlanEntry(row) {
  return {
    date: row.date,
    phase: row.phase,
    focus: row.focus,
    tasks: parseJson(row.tasks_json, []),
    targetMetrics: parseJson(row.target_metrics_json, []),
    reviewPlan: parseJson(row.review_plan_json, []),
    teacherNotes: row.teacher_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProgressEntry(row) {
  return {
    date: row.date,
    actualCompleted: row.actual_completed,
    evidence: row.evidence,
    selfNote: row.self_note,
    teacherFeedback: row.teacher_feedback,
    reviewDebt: parseJson(row.review_debt_json, []),
    nextAdjustment: row.next_adjustment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  RoundtableStore,
  StorageStore,
  StudyTrackerStore,
};

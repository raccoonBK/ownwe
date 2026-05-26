const {
  clampInteger,
  formatLocalTime,
  normalizeIsoText,
  normalizeText,
  normalizeTextArray,
  parseFirstJsonObject,
  speakerLabel,
  uniqueTextArray,
} = require("./roundtable-utils");
const { resolveSearchScope } = require("./roundtable-search-scope");
const { cosineSimilarity } = require("./roundtable-embedding");

class SummaryStore {
  constructor({ db }) {
    if (!db) {
      throw new Error("SummaryStore requires db");
    }
    this.db = db;
  }

  add(summary) {
    const normalized = normalizeSummaryRecord(summary);
    if (!normalized.topicId) {
      throw new Error("summary requires topicId");
    }
    this.writeSummaryToDb(normalized);
    return normalized;
  }

  getById(id) {
    const row = this.db.prepare("SELECT * FROM summaries WHERE id = ?").get(id);
    return row ? summaryRowToRecord(row) : null;
  }

  listByIds(ids, { includeArchived = false } = {}) {
    const normalizedIds = uniqueTextArray(normalizeTextArray(ids));
    if (!normalizedIds.length) return [];
    const placeholders = normalizedIds.map(() => "?").join(", ");
    const archivedClause = includeArchived ? "" : "AND archived = 0";
    const rows = this.db.prepare(
      `SELECT * FROM summaries WHERE id IN (${placeholders}) ${archivedClause}`
    ).all(...normalizedIds).map((row) => summaryRowToRecord(row));
    const byId = new Map(rows.map((row) => [row.id, row]));
    return normalizedIds.map((id) => byId.get(id)).filter(Boolean);
  }

  list({ topicId = "", limit = 10 } = {}) {
    const normalizedTopicId = normalizeText(topicId);
    const rows = normalizedTopicId
      ? this.db.prepare(
        "SELECT * FROM summaries WHERE topic_id = ? AND archived = 0 ORDER BY created_at DESC LIMIT ?"
      ).all(normalizedTopicId, clampInteger(limit, 1, 100, 10))
      : this.db.prepare(
        "SELECT * FROM summaries WHERE archived = 0 ORDER BY created_at DESC LIMIT ?"
      ).all(clampInteger(limit, 1, 100, 10));
    return rows.map((row) => summaryRowToRecord(row));
  }

  listByDay({ limit = 50 } = {}) {
    const recent = this.db.prepare(
      "SELECT * FROM summaries WHERE archived = 0 ORDER BY created_at DESC LIMIT ?"
    ).all(clampInteger(limit, 1, 200, 50)).map((row) => summaryRowToRecord(row));
    return groupSummariesByDay(recent);
  }

  update(summaryId, patch = {}) {
    const id = normalizeText(summaryId || patch.id);
    if (!id) {
      throw new Error("summary id is required");
    }
    const current = this.getById(id);
    if (!current) {
      throw new Error("summary not found");
    }
    const next = normalizeSummaryRecord({
      ...current,
      ...patch,
      id: current.id,
      topicId: normalizeText(patch.topicId) || current.topicId,
      topicTitle: Object.prototype.hasOwnProperty.call(patch, "topicTitle") ? patch.topicTitle : current.topicTitle,
      summaryText: Object.prototype.hasOwnProperty.call(patch, "summaryText")
        ? patch.summaryText
        : Object.prototype.hasOwnProperty.call(patch, "summary")
          ? patch.summary
          : current.summaryText,
      useful: Object.prototype.hasOwnProperty.call(patch, "useful") ? patch.useful : current.useful,
      decisions: Object.prototype.hasOwnProperty.call(patch, "decisions") ? patch.decisions : current.decisions,
      openItems: Object.prototype.hasOwnProperty.call(patch, "openItems")
        ? patch.openItems
        : Object.prototype.hasOwnProperty.call(patch, "next")
          ? patch.next
          : current.openItems,
      latestState: Object.prototype.hasOwnProperty.call(patch, "latestState") ? patch.latestState : current.latestState,
      tags: Object.prototype.hasOwnProperty.call(patch, "tags") ? patch.tags : current.tags,
      keywords: Object.prototype.hasOwnProperty.call(patch, "keywords") ? patch.keywords : current.keywords,
      rawText: Object.prototype.hasOwnProperty.call(patch, "rawText") ? patch.rawText : current.rawText,
      archived: Object.prototype.hasOwnProperty.call(patch, "archived") ? patch.archived : current.archived,
      createdAt: current.createdAt,
    });
    this.writeSummaryToDb(next);
    return next;
  }

  search({ query = "", limit = 5, includeArchived = false, scope = "global", project = "", topicId = "", embedding = null } = {}) {
    return this.searchDb({ query, limit, includeArchived, scope, project, topicId, embedding });
  }

  latestForTopic(topicId, { includeArchived = false } = {}) {
    const normalizedTopicId = normalizeText(topicId);
    if (!normalizedTopicId) {
      return null;
    }
    const archivedClause = includeArchived ? "" : "AND archived = 0";
    const row = this.db.prepare(
      `SELECT * FROM summaries WHERE topic_id = ? ${archivedClause} ORDER BY created_at DESC LIMIT 1`
    ).get(normalizedTopicId);
    return row ? summaryRowToRecord(row) : null;
  }

  latestAutoSummaryForTopic(topicId) {
    const normalizedTopicId = normalizeText(topicId);
    if (!normalizedTopicId) return null;
    // Include archived summaries — cursor validity doesn't depend on visibility
    const row = this.db.prepare(
      `SELECT * FROM summaries WHERE topic_id = ? AND message_range_to != '' ORDER BY created_at DESC LIMIT 1`
    ).get(normalizedTopicId);
    return row ? summaryRowToRecord(row) : null;
  }

  archive(summaryId) {
    const id = normalizeText(summaryId);
    if (!id) {
      throw new Error("summary id is required");
    }
    const result = this.db.prepare(
      "UPDATE summaries SET archived = 1 WHERE id = ?"
    ).run(id);
    this.db.prepare("DELETE FROM summaries_fts WHERE id = ?").run(id);
    return { ok: true, id, changed: result.changes || 0 };
  }

  archiveMany(summaryIds) {
    const ids = uniqueTextArray(normalizeTextArray(summaryIds));
    let changed = 0;
    const update = this.db.prepare("UPDATE summaries SET archived = 1 WHERE id = ?");
    const deleteFts = this.db.prepare("DELETE FROM summaries_fts WHERE id = ?");
    this.db.exec("BEGIN");
    try {
      for (const id of ids) {
        changed += update.run(id).changes || 0;
        deleteFts.run(id);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { ok: true, ids, changed };
  }

  deleteForTopic(topicId) {
    const normalizedTopicId = normalizeText(topicId);
    if (!normalizedTopicId) return { ok: true, topicId: "", changed: 0 };
    const deleteFts = this.db.prepare("DELETE FROM summaries_fts WHERE topic_id = ?");
    const deleteRows = this.db.prepare("DELETE FROM summaries WHERE topic_id = ?");
    this.db.exec("BEGIN");
    try {
      deleteFts.run(normalizedTopicId);
      const result = deleteRows.run(normalizedTopicId);
      this.db.exec("COMMIT");
      return { ok: true, topicId: normalizedTopicId, changed: result.changes || 0 };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  saveEmbedding(summaryId, embedding) {
    const id = normalizeText(summaryId);
    if (!id || !Array.isArray(embedding) || !embedding.length) return;
    try {
      this.db.prepare(
        "UPDATE summaries SET embedding_json = ? WHERE id = ?"
      ).run(JSON.stringify(embedding), id);
    } catch {
      // embedding column may not exist in older DBs — silently skip
    }
  }

  listWithEmbeddings(topicId, limit = 100) {
    const normalizedTopicId = normalizeText(topicId);
    if (!normalizedTopicId) return [];
    try {
      return this.db.prepare(
        "SELECT * FROM summaries WHERE topic_id = ? AND archived = 0 AND embedding_json IS NOT NULL ORDER BY created_at DESC LIMIT ?"
      ).all(normalizedTopicId, limit).map((row) => ({
        ...summaryRowToRecord(row),
        embedding: parseJson(row.embedding_json, null),
      }));
    } catch {
      return [];
    }
  }

  writeSummaryToDb(summary) {
    this.db.prepare(
      `INSERT INTO summaries (
        id, topic_id, topic_title, kind, time_range_from, time_range_to, time_range_text,
        message_range_from, message_range_to, message_count, summary_text,
        useful_json, decisions_json, open_items_json, latest_state,
        tags_json, keywords_json, raw_text, archived, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        topic_id = excluded.topic_id,
        topic_title = excluded.topic_title,
        kind = excluded.kind,
        time_range_from = excluded.time_range_from,
        time_range_to = excluded.time_range_to,
        time_range_text = excluded.time_range_text,
        message_range_from = excluded.message_range_from,
        message_range_to = excluded.message_range_to,
        message_count = excluded.message_count,
        summary_text = excluded.summary_text,
        useful_json = excluded.useful_json,
        decisions_json = excluded.decisions_json,
        open_items_json = excluded.open_items_json,
        latest_state = excluded.latest_state,
        tags_json = excluded.tags_json,
        keywords_json = excluded.keywords_json,
        raw_text = excluded.raw_text,
        archived = excluded.archived,
        created_at = excluded.created_at`
    ).run(
      summary.id,
      summary.topicId,
      summary.topicTitle,
      summary.kind,
      summary.timeRange.from,
      summary.timeRange.to,
      summary.timeRange.text,
      summary.messageRange.from,
      summary.messageRange.to,
      summary.messageRange.count,
      summary.summaryText,
      JSON.stringify(summary.useful),
      JSON.stringify(summary.decisions),
      JSON.stringify(summary.openItems),
      summary.latestState,
      JSON.stringify(summary.tags),
      JSON.stringify(summary.keywords),
      summary.rawText,
      summary.archived ? 1 : 0,
      summary.createdAt,
    );
    this.db.prepare("DELETE FROM summaries_fts WHERE id = ?").run(summary.id);
    this.db.prepare(
      "INSERT INTO summaries_fts(id, search_text, topic_id) VALUES (?, ?, ?)"
    ).run(summary.id, summarySearchText(summary), summary.topicId);
  }

  searchDb({ query = "", limit = 5, includeArchived = false, scope = "global", project = "", topicId = "", embedding = null } = {}) {
    const normalizedQuery = normalizeText(query);
    const maxResults = clampInteger(limit, 1, 20, 5);
    const resolvedScope = resolveSearchScope(this.db, { scope, project, topicId });
    if (!normalizedQuery) {
      return { query: normalizedQuery, scope: resolvedScope, items: [] };
    }
    const topicIds = resolvedScope.isGlobal ? null : resolvedScope.topicIds;
    if (Array.isArray(topicIds) && !topicIds.length) {
      return { query: normalizedQuery, scope: resolvedScope, items: [] };
    }
    const topicFilter = buildTopicFilterSql(topicIds, "summaries.topic_id");
    const candidates = [];
    if (!includeArchived && Array.isArray(embedding) && embedding.length) {
      candidates.push(...this.searchSemanticRows({
        embedding,
        topicIds,
        limit: Math.max(maxResults * 6, 30),
      }));
    }
    let rows = [];
    try {
      rows = this.db.prepare(
         `SELECT summaries.*
         FROM summaries
         JOIN summaries_fts ON summaries_fts.id = summaries.id
         WHERE summaries_fts MATCH ?
           AND (? = 1 OR summaries.archived = 0)
           ${topicFilter.sql}
         ORDER BY rank, summaries.created_at DESC
         LIMIT ?`
      ).all(buildFtsQuery(normalizedQuery), includeArchived ? 1 : 0, ...topicFilter.params, maxResults * 4);
      candidates.push(...rows.map((row) => ({ row, semanticScore: 0, matchType: "keyword" })));
    } catch {
      rows = [];
    }
    if (!rows.length) {
      const like = `%${normalizedQuery.toLowerCase()}%`;
      rows = this.db.prepare(
        `SELECT *
         FROM summaries
         WHERE (? = 1 OR archived = 0)
           ${topicFilter.sql.replaceAll("summaries.", "")}
           AND lower(
             topic_title || ' ' || summary_text || ' ' || latest_state || ' ' ||
             useful_json || ' ' || decisions_json || ' ' || open_items_json || ' ' ||
             tags_json || ' ' || keywords_json
           ) LIKE ?
         ORDER BY created_at DESC
         LIMIT ?`
      ).all(includeArchived ? 1 : 0, ...topicFilter.params, like, maxResults * 4);
      candidates.push(...rows.map((row) => ({ row, semanticScore: 0, matchType: "keyword" })));
    }
    const items = mergeSummaryCandidates(candidates, normalizedQuery)
      .sort((a, b) => {
        if (b.semanticScore !== a.semanticScore) return b.semanticScore - a.semanticScore;
        if (b.score !== a.score) return b.score - a.score;
        return normalizeText(b.createdAt).localeCompare(normalizeText(a.createdAt));
      })
      .slice(0, maxResults);
    return { query: normalizedQuery, scope: resolvedScope, items };
  }

  searchSemanticRows({ embedding, topicIds = null, limit = 30 } = {}) {
    const topicFilter = buildTopicFilterSql(topicIds, "topic_id");
    let rows = [];
    try {
      rows = this.db.prepare(
        `SELECT *
         FROM summaries
         WHERE archived = 0
           AND embedding_json IS NOT NULL
           ${topicFilter.sql}
         ORDER BY created_at DESC
         LIMIT ?`
      ).all(...topicFilter.params, clampInteger(limit, 1, 200, 30));
    } catch {
      return [];
    }
    return rows
      .map((row) => ({
        row,
        semanticScore: cosineSimilarity(embedding, parseJson(row.embedding_json, [])),
        matchType: "semantic",
      }))
      .filter((item) => item.semanticScore > 0.2);
  }
}

function mergeSummaryCandidates(candidates, query) {
  const byId = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const row = candidate?.row;
    if (!row?.id) continue;
    const record = summaryRowToRecord(row);
    const keywordScore = scoreSummarySearchMatch(record, query);
    if (candidate.matchType !== "semantic" && keywordScore <= 0) continue;
    const current = byId.get(row.id);
    const next = {
      ...record,
      score: Math.max(keywordScore, current?.score || 0),
      semanticScore: Math.max(candidate.semanticScore || 0, current?.semanticScore || 0),
      matchType: candidate.matchType === "semantic" || current?.matchType === "semantic"
        ? "semantic"
        : "keyword",
    };
    byId.set(row.id, current ? { ...current, ...next } : next);
  }
  return [...byId.values()];
}

function buildDeepSeekSummaryMessages(state, sourceMessages = []) {
  const range = summarizeMessageRange(sourceMessages);
  const systemPrompt = [
    "你是 DeepSeek，正在帮用户整理刚才一段聊天。",
    "第一步：判断这段聊天的 kind。",
    "  - work：正经工作内容（讨论项目、做决定、写代码、安排任务、定计划等）",
    "  - casual：闲聊（关心、情绪、抱怨、玩笑、生活琐事、关系互动等）",
    "  - 难分清就归到主要倾向，不要造 mixed。",
    "第二步：根据 kind 输出 JSON。",
    "",
    "如果 kind=work，按完整 schema 输出（英文字段名，中文内容）：",
    "{",
    "  \"kind\": \"work\",",
    "  \"topicTitle\": \"短标题\",",
    "  \"summaryText\": \"一段自然中文，讲发生了什么、定了什么、下一步是什么\",",
    "  \"useful\": [\"短而具体的有用要点\"],",
    "  \"decisions\": [\"已经确认的决定\"],",
    "  \"openItems\": [\"还没解决或下一步要做的事\"],",
    "  \"latestState\": \"这段对话之后的当前状态\",",
    "  \"tags\": [\"宽泛标签\"],",
    "  \"keywords\": [\"搜索关键词，含话题名、项目名、人名、昵称\"]",
    "}",
    "",
    "如果 kind=casual，只输出精简字段，不要硬塞 useful/decisions/openItems：",
    "{",
    "  \"kind\": \"casual\",",
    "  \"topicTitle\": \"短标题\",",
    "  \"summaryText\": \"用你自己的话讲讲他们聊了什么、留下的情绪和氛围、谁说了让人记得住的话。一段自然口语化中文。如果没什么值得留下的，写：这段可以略过。\",",
    "  \"tags\": [\"宽泛标签\"],",
    "  \"keywords\": [\"含关键人名、地点、情绪关键词\"]",
    "}",
    "",
    "约束：",
    "- 只返回一个 JSON 对象，不要 markdown，不要 JSON 之外的解释。",
    "- 字段名严格如上。",
    "- casual 时 summaryText 不要列条目、不要写'决定'/'下一步'/'TODO'。",
  ].join("\n");
  const userPrompt = [
    `Topic id: ${state.id}`,
    `Topic title: ${state.topic || "(untitled)"}`,
    `Time range: ${range.startText} - ${range.endText}`,
    `Message range: ${range.fromId} - ${range.toId}`,
    "",
    "Conversation messages:",
    formatSummarySourceTranscript(sourceMessages),
  ].join("\n").trim();
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
}

function buildDeepSeekSummaryMergeMessages(state, summaries = []) {
  const systemPrompt = [
    "你是 DeepSeek，正在帮用户合并几条已有的总结。",
    "第一步：从源总结判断整体 kind（work 或 casual，不要造 mixed）。",
    "第二步：合并源总结时保留具体决定、未完事项、项目状态、人名和有用事实，去掉重复和过时细节。",
    "",
    "如果 kind=work，按完整 schema 输出：",
    "{",
    "  \"kind\": \"work\",",
    "  \"topicTitle\": \"短标题\",",
    "  \"summaryText\": \"一段自然中文\",",
    "  \"useful\": [\"短而具体的有用要点\"],",
    "  \"decisions\": [\"已经确认的决定\"],",
    "  \"openItems\": [\"还没解决或下一步要做的事\"],",
    "  \"latestState\": \"合并后的当前状态\",",
    "  \"tags\": [\"宽泛标签\"],",
    "  \"keywords\": [\"搜索关键词\"]",
    "}",
    "",
    "如果 kind=casual，只输出：",
    "{",
    "  \"kind\": \"casual\",",
    "  \"topicTitle\": \"短标题\",",
    "  \"summaryText\": \"用自己的话讲一段总体氛围，不列条目\",",
    "  \"tags\": [\"宽泛标签\"],",
    "  \"keywords\": [\"关键人名、情绪关键词\"]",
    "}",
    "",
    "只返回一个 JSON 对象，不要 markdown，不要 JSON 之外的解释。",
  ].join("\n");
  const userPrompt = [
    `Current topic id: ${state.id || ""}`,
    `Current topic title: ${state.topic || "(untitled)"}`,
    "",
    "Source summaries:",
    formatMergeSourceSummaries(summaries),
  ].join("\n").trim();
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
}

function resolveSummaryMessages(state, { limit = 0, afterMessageId = "", afterMessageCount = null, afterMessageTime = "", full = false } = {}) {
  const messages = getReadableTranscriptMessages(state?.messages);
  if (!full) {
    const nextMessages = resolveMessagesAfterCursor(messages, { afterMessageId, afterMessageCount, afterMessageTime });
    if (nextMessages) {
      return applySummaryLimit(nextMessages, limit);
    }
  }
  return applySummaryLimit(messages, limit);
}

function resolveMessagesAfterCursor(messages, { afterMessageId = "", afterMessageCount = null, afterMessageTime = "" } = {}) {
  const cursorId = normalizeText(afterMessageId);
  if (cursorId) {
    const index = messages.findIndex((message) => message.id === cursorId);
    if (index >= 0) {
      return messages.slice(index + 1);
    }
    if (afterMessageCount === null || afterMessageCount === undefined) {
      return [];
    }
  }
  const timeStr = normalizeText(afterMessageTime);
  if (timeStr) {
    return messages.filter((m) => (m.at || "") > timeStr);
  }
  if (afterMessageCount !== null && afterMessageCount !== undefined) {
    const count = clampInteger(afterMessageCount, 0, 10_000, 0);
    return messages.slice(Math.min(count, messages.length));
  }
  return null;
}

function applySummaryLimit(messages, limit) {
  const count = clampInteger(limit, 0, 10_000, 0);
  return count > 0 ? messages.slice(-count) : messages;
}

function normalizeDeepSeekSummary({ rawText, state, sourceMessages }) {
  const parsed = parseFirstJsonObject(rawText) || {};
  const range = summarizeMessageRange(sourceMessages);
  const createdAt = new Date().toISOString();
  const kind = normalizeSummaryKind(parsed.kind);
  const isCasual = kind === "casual";
  const summaryText = normalizeText(parsed.summaryText)
    || normalizeText(parsed.summary)
    || normalizeText(parsed.content)
    || normalizeText(rawText)
    || "No durable summary.";
  const useful = isCasual ? [] : normalizeTextArray(parsed.useful || parsed.facts || parsed.points);
  const decisions = isCasual ? [] : normalizeTextArray(parsed.decisions);
  const openItems = isCasual ? [] : normalizeTextArray(parsed.openItems || parsed.next || parsed.action_items);
  const latestState = isCasual ? "" : normalizeText(parsed.latestState || parsed.state);
  const tags = normalizeTextArray(parsed.tags);
  const topicTitle = normalizeText(parsed.topicTitle || parsed.topic) || state.topic;
  const keywords = buildSummaryKeywords({
    topicTitle,
    summary: summaryText,
    useful,
    decisions,
    openItems,
    latestState,
    tags,
    keywords: parsed.keywords,
  });
  return normalizeSummaryRecord({
    id: `summary_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    topicId: state.id,
    topicTitle,
    kind,
    timeRange: {
      from: range.startIso,
      to: range.endIso,
      text: `${range.startText} - ${range.endText}`,
    },
    messageRange: {
      from: range.fromId,
      to: range.toId,
      count: sourceMessages.length,
    },
    summary: summaryText,
    summaryText,
    useful,
    decisions,
    next: openItems,
    openItems,
    latestState,
    tags,
    keywords,
    rawText: normalizeText(rawText),
    createdAt,
  });
}

function normalizeMergedDeepSeekSummary({ rawText, state, summaries }) {
  const items = Array.isArray(summaries) ? summaries : [];
  const parsed = parseFirstJsonObject(rawText) || {};
  const createdAt = new Date().toISOString();
  const kind = normalizeSummaryKind(parsed.kind);
  const isCasual = kind === "casual";
  const summaryText = normalizeText(parsed.summaryText)
    || normalizeText(parsed.summary)
    || normalizeText(parsed.content)
    || normalizeText(rawText)
    || "No durable summary.";
  const useful = isCasual ? [] : normalizeTextArray(parsed.useful || parsed.facts || parsed.points);
  const decisions = isCasual ? [] : normalizeTextArray(parsed.decisions);
  const openItems = isCasual ? [] : normalizeTextArray(parsed.openItems || parsed.next || parsed.action_items);
  const latestState = isCasual ? "" : normalizeText(parsed.latestState || parsed.state);
  const tags = uniqueTextArray(["merged-summary", ...normalizeTextArray(parsed.tags)]);
  const topicTitle = normalizeText(parsed.topicTitle || parsed.topic)
    || normalizeText(state.topic)
    || items[0]?.topicTitle
    || "";
  const range = summarizeSummaryRange(items);
  const messageRange = summarizeMergedMessageRange(items);
  const sourceIds = items.map((item) => item.id).filter(Boolean);
  const keywords = buildSummaryKeywords({
    topicTitle,
    summary: summaryText,
    useful,
    decisions,
    openItems,
    latestState,
    tags,
    keywords: [...normalizeTextArray(parsed.keywords), ...sourceIds],
  });
  return normalizeSummaryRecord({
    id: `summary_merged_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    topicId: normalizeText(state.id) || items[0]?.topicId || "",
    topicTitle,
    kind,
    timeRange: range,
    messageRange,
    summary: summaryText,
    summaryText,
    useful,
    decisions,
    next: openItems,
    openItems,
    latestState,
    tags,
    keywords,
    rawText: normalizeText(rawText),
    createdAt,
  });
}

function buildLocalMergedSummary({ state = {}, summaries = [], reason = "" } = {}) {
  const items = Array.isArray(summaries) ? summaries.filter(Boolean) : [];
  const summaryTexts = uniqueTextArray(items.map((item) => item.summaryText || item.summary));
  const useful = uniqueTextArray(items.flatMap((item) => normalizeTextArray(item.useful)));
  const decisions = uniqueTextArray(items.flatMap((item) => normalizeTextArray(item.decisions)));
  const openItems = uniqueTextArray(items.flatMap((item) => normalizeTextArray(item.openItems || item.next)));
  const latest = items[0] || {};
  const tags = uniqueTextArray([
    "local-merge",
    ...items.flatMap((item) => normalizeTextArray(item.tags)),
  ]);
  const rawText = JSON.stringify({
    kind: inferMergedSummaryKind(items),
    topicTitle: normalizeText(state.topic) || latest.topicTitle || "",
    summaryText: summaryTexts.join("\n\n") || "Merged selected summaries.",
    useful,
    decisions,
    openItems,
    latestState: latest.latestState || latest.summaryText || latest.summary || "",
    tags,
    keywords: uniqueTextArray([
      ...items.flatMap((item) => normalizeTextArray(item.keywords)),
      ...(reason ? ["fallback-merge"] : []),
    ]),
  });
  return normalizeMergedDeepSeekSummary({ rawText, state, summaries: items });
}

function formatSummaryForChat(summary) {
  const lines = [
    `Time range: ${summary.timeRange.text}`,
    "",
    summary.summary,
  ];
  if (summary.next.length) {
    lines.push("", `Next: ${summary.next.join("; ")}`);
  }
  return lines.join("\n").trim();
}

function buildSummaryContextNote(summaries) {
  if (!Array.isArray(summaries) || !summaries.length) {
    return "";
  }
  const lines = [];
  const latest = summaries[0];

  // State card from the most recent summary
  if (latest.latestState) {
    lines.push("Current state: " + latest.latestState);
  }
  const allDecisions = summaries.flatMap((s) => s.decisions || []).filter(Boolean);
  if (allDecisions.length) {
    lines.push("Decisions: " + allDecisions.slice(0, 8).join("; "));
  }
  const allOpen = summaries.flatMap((s) => s.openItems || s.next || []).filter(Boolean);
  if (allOpen.length) {
    lines.push("Open items: " + allOpen.slice(0, 6).join("; "));
  }

  // Only show latest summary header as a reference pointer; full text available via searchMemory
  const latestLabel = latest.topicTitle || latest.topicId;
  const latestTime = latest.timeRange?.text || "";
  if (latestLabel || latestTime) {
    lines.push(`\nRecent summary available:\n[${latestLabel}] ${latestTime}`);
  }
  return lines.join("\n").trim();
}

function buildSemanticInjectionNote(summaries, querySummaries) {
  const candidates = querySummaries.length ? querySummaries : summaries;
  return buildSummaryContextNote(candidates);
}

function buildSummaryInjectionNote(summaries) {
  const items = (Array.isArray(summaries) ? summaries : []).filter(Boolean);
  if (!items.length) return "";
  const sections = ["Injected summary context:"];
  for (const summary of items) {
    const openItems = Array.isArray(summary.openItems) && summary.openItems.length
      ? summary.openItems
      : summary.next;
    const lines = [
      `[${summary.topicTitle || summary.topicId || "summary"}] ${summary.timeRange?.text || summary.createdAt || ""}`.trim(),
      `Summary: ${summary.summaryText || summary.summary || ""}`,
    ];
    if (Array.isArray(summary.useful) && summary.useful.length) {
      lines.push(`Useful: ${summary.useful.join("; ")}`);
    }
    if (Array.isArray(summary.decisions) && summary.decisions.length) {
      lines.push(`Decisions: ${summary.decisions.join("; ")}`);
    }
    if (Array.isArray(openItems) && openItems.length) {
      lines.push(`Open items: ${openItems.join("; ")}`);
    }
    if (summary.latestState) {
      lines.push(`Latest state: ${summary.latestState}`);
    }
    sections.push(lines.filter(Boolean).join("\n"));
  }
  return sections.join("\n\n").trim();
}

function groupSummariesByDay(summaries) {
  const byDay = new Map();
  for (const summary of summaries) {
    const day = normalizeText(summary.createdAt).slice(0, 10) || "unknown";
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(summary);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, items]) => ({ day, items }));
}

function summaryRowToRecord(row) {
  return normalizeSummaryRecord({
    id: row.id,
    topicId: row.topic_id,
    topicTitle: row.topic_title,
    kind: row.kind,
    timeRange: {
      from: row.time_range_from,
      to: row.time_range_to,
      text: row.time_range_text,
    },
    messageRange: {
      from: row.message_range_from,
      to: row.message_range_to,
      count: row.message_count,
    },
    summaryText: row.summary_text,
    useful: parseJson(row.useful_json, []),
    decisions: parseJson(row.decisions_json, []),
    openItems: parseJson(row.open_items_json, []),
    latestState: row.latest_state,
    tags: parseJson(row.tags_json, []),
    keywords: parseJson(row.keywords_json, []),
    rawText: row.raw_text,
    archived: Boolean(row.archived),
    createdAt: row.created_at,
  });
}

function summarySearchText(summary) {
  return [
    summary.topicTitle,
    summary.summaryText || summary.summary,
    summary.latestState,
    ...normalizeTextArray(summary.useful),
    ...normalizeTextArray(summary.decisions),
    ...normalizeTextArray(summary.openItems || summary.next),
    ...normalizeTextArray(summary.tags),
    ...normalizeTextArray(summary.keywords),
  ].join(" ");
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
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

function extractSummarySearchQuery(text) {
  const normalized = normalizeText(text);
  if (!normalized) return "";
  if (!/(搜索|查|查找|找)/u.test(normalized) || !/(总结|摘要|summary)/iu.test(normalized)) {
    return "";
  }
  const cleaned = normalized
    .replace(/^(帮我|请|麻烦|老师|你们|给我|我要)?\s*/u, "")
    .replace(/^(搜索|查找|查|找)\s*/u, "")
    .replace(/(的)?(总结|摘要|summary)\s*$/iu, "")
    .trim();
  return cleaned || normalized;
}

function formatSummarySearchResultsForChat(query, results) {
  const items = Array.isArray(results?.items) ? results.items : [];
  if (!items.length) {
    return `Summary search for "${query}" found no matching summaries.`;
  }
  const lines = [`Summary search results for "${query}":`];
  for (const item of items) {
    lines.push(`- [${item.topicTitle || item.topicId}] ${item.createdAt || ""}`);
    if (item.summaryText || item.summary) lines.push(`  Summary: ${item.summaryText || item.summary}`);
    if (Array.isArray(item.decisions) && item.decisions.length) {
      lines.push(`  Decisions: ${item.decisions.join("; ")}`);
    }
    const openItems = Array.isArray(item.openItems) && item.openItems.length ? item.openItems : item.next;
    if (Array.isArray(openItems) && openItems.length) {
      lines.push(`  Open items: ${openItems.join("; ")}`);
    }
  }
  return lines.join("\n").trim();
}

function normalizeSummaryRecord(value = {}) {
  const createdAt = normalizeIsoText(value.createdAt) || new Date().toISOString();
  const topicId = normalizeText(value.topicId);
  const summaryText = normalizeText(value.summaryText) || normalizeText(value.summary);
  const openItems = normalizeTextArray(value.openItems || value.next);
  const tags = normalizeTextArray(value.tags);
  return {
    schemaVersion: 1,
    id: normalizeText(value.id) || `summary_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    topicId,
    topicTitle: normalizeText(value.topicTitle),
    kind: normalizeSummaryKind(value.kind),
    timeRange: normalizeSummaryTimeRange(value.timeRange),
    messageRange: normalizeSummaryMessageRange(value.messageRange),
    summary: summaryText,
    summaryText,
    useful: normalizeTextArray(value.useful),
    decisions: normalizeTextArray(value.decisions),
    next: openItems,
    openItems,
    latestState: normalizeText(value.latestState),
    tags,
    keywords: buildSummaryKeywords({
      topicTitle: value.topicTitle,
      summary: summaryText,
      useful: value.useful,
      decisions: value.decisions,
      openItems,
      latestState: value.latestState,
      tags,
      keywords: value.keywords,
    }),
    rawText: normalizeText(value.rawText),
    archived: Boolean(value.archived),
    createdAt,
  };
}

function buildSummaryKeywords({
  topicTitle = "",
  summary = "",
  useful = [],
  decisions = [],
  openItems = [],
  latestState = "",
  tags = [],
  keywords = [],
} = {}) {
  const explicit = normalizeTextArray(keywords);
  const sourceText = [
    topicTitle,
    summary,
    latestState,
    ...normalizeTextArray(useful),
    ...normalizeTextArray(decisions),
    ...normalizeTextArray(openItems),
    ...normalizeTextArray(tags),
  ].join(" ");
  const derived = extractSearchKeywords(sourceText);
  return uniqueTextArray([...explicit, ...normalizeTextArray(tags), ...derived]).slice(0, 40);
}

function extractSearchKeywords(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const asciiWords = normalized.match(/[A-Za-z0-9][A-Za-z0-9._-]{1,}/g) || [];
  const chinesePhrases = normalized.match(/[\p{Script=Han}][\p{Script=Han}A-Za-z0-9._-]{1,11}/gu) || [];
  return uniqueTextArray([...asciiWords, ...chinesePhrases])
    .filter((item) => item.length >= 2)
    .slice(0, 30);
}

function scoreSummarySearchMatch(summary, query) {
  const terms = tokenizeSearchQuery(query);
  if (!terms.length) return 0;
  let score = 0;
  score += scoreField(summary.topicTitle, terms, 24);
  score += scoreField(summary.keywords, terms, 18);
  score += scoreField(summary.tags, terms, 14);
  score += scoreField(summary.summaryText || summary.summary, terms, 10);
  score += scoreField(summary.decisions, terms, 9);
  score += scoreField(summary.openItems || summary.next, terms, 8);
  score += scoreField(summary.latestState, terms, 7);
  score += scoreField(summary.useful, terms, 5);
  return score;
}

function tokenizeSearchQuery(query) {
  const normalized = normalizeText(query);
  if (!normalized) return [];
  const terms = [normalized];
  for (const part of normalized.split(/[\s,，。；;:：、]+/u)) {
    const item = normalizeText(part);
    if (item && item !== normalized) terms.push(item);
  }
  return uniqueTextArray(terms.map((item) => item.toLowerCase()));
}

function scoreField(value, terms, weight) {
  const text = normalizeSearchText(value);
  if (!text) return 0;
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (text === term) {
      score += weight * 3;
    } else if (text.includes(term)) {
      score += weight;
    }
  }
  return score;
}

function normalizeSearchText(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean).join(" ").toLowerCase();
  }
  return normalizeText(value).toLowerCase();
}

function normalizeSummaryKind(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "casual") return "casual";
  if (normalized === "work") return "work";
  // legacy "mixed" and unknown values default to work (full schema retained)
  return "work";
}

function normalizeSummaryTimeRange(value = {}) {
  const from = normalizeIsoText(value.from);
  const to = normalizeIsoText(value.to);
  return {
    from,
    to,
    text: normalizeText(value.text) || `${formatLocalTime(from)} - ${formatLocalTime(to)}`,
  };
}

function normalizeSummaryMessageRange(value = {}) {
  return {
    from: normalizeText(value.from),
    to: normalizeText(value.to),
    count: clampInteger(value.count, 0, 10_000, 0),
  };
}

function summarizeMessageRange(messages) {
  const readable = Array.isArray(messages) ? messages : [];
  const first = readable[0] || {};
  const last = readable[readable.length - 1] || {};
  const startIso = normalizeIsoText(first.at) || new Date().toISOString();
  const endIso = normalizeIsoText(last.at) || startIso;
  return {
    fromId: normalizeText(first.id),
    toId: normalizeText(last.id),
    startIso,
    endIso,
    startText: formatLocalTime(startIso),
    endText: formatLocalTime(endIso),
  };
}

function formatSummarySourceTranscript(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((message, index) => {
      const id = normalizeText(message?.id) || `message-${index + 1}`;
      const at = normalizeIsoText(message?.at) || "";
      const label = speakerLabel(message?.speaker);
      const text = normalizeText(message?.text);
      return `[${id}] ${at} ${label}: ${text}`;
    })
    .join("\n\n");
}

function formatMergeSourceSummaries(summaries) {
  return (Array.isArray(summaries) ? summaries : [])
    .map((summary, index) => {
      const openItems = Array.isArray(summary.openItems) && summary.openItems.length
        ? summary.openItems
        : summary.next;
      return [
        `#${index + 1} ${summary.id || ""}`,
        `Topic: ${summary.topicTitle || summary.topicId || ""}`,
        `Time: ${summary.timeRange?.text || summary.createdAt || ""}`,
        `Summary: ${summary.summaryText || summary.summary || ""}`,
        `Useful: ${normalizeTextArray(summary.useful).join("; ")}`,
        `Decisions: ${normalizeTextArray(summary.decisions).join("; ")}`,
        `Open items: ${normalizeTextArray(openItems).join("; ")}`,
        `Latest state: ${summary.latestState || ""}`,
        `Tags: ${normalizeTextArray(summary.tags).join(", ")}`,
      ].join("\n");
    })
    .join("\n\n");
}

function summarizeSummaryRange(summaries) {
  const items = Array.isArray(summaries) ? summaries : [];
  const times = items
    .flatMap((summary) => [
      normalizeIsoText(summary?.timeRange?.from),
      normalizeIsoText(summary?.timeRange?.to),
      normalizeIsoText(summary?.createdAt),
    ])
    .filter(Boolean)
    .sort();
  const from = times[0] || new Date().toISOString();
  const to = times[times.length - 1] || from;
  return {
    from,
    to,
    text: `Merged ${items.length} summaries: ${formatLocalTime(from)} - ${formatLocalTime(to)}`,
  };
}

function summarizeMergedMessageRange(summaries) {
  const items = Array.isArray(summaries) ? summaries : [];
  return {
    from: items.find((summary) => summary?.messageRange?.from)?.messageRange.from || "",
    to: [...items].reverse().find((summary) => summary?.messageRange?.to)?.messageRange.to || "",
    count: items.reduce((sum, summary) => sum + clampInteger(summary?.messageRange?.count, 0, 10_000, 0), 0),
  };
}

function inferMergedSummaryKind(summaries) {
  const kinds = uniqueTextArray((Array.isArray(summaries) ? summaries : []).map((item) => item.kind));
  if (kinds.length === 1 && ["work", "casual", "mixed"].includes(kinds[0])) {
    return kinds[0];
  }
  return "mixed";
}

function getReadableTranscriptMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.transcript !== false && normalizeText(message?.text))
    .map((message, index) => ({
      id: normalizeText(message.id) || `message-${index + 1}`,
      speaker: normalizeText(message.speaker),
      text: normalizeText(message.text),
      at: normalizeIsoText(message.at),
    }));
}

module.exports = {
  SummaryStore,
  buildDeepSeekSummaryMergeMessages,
  buildDeepSeekSummaryMessages,
  buildSemanticInjectionNote,
  buildSummaryContextNote,
  buildSummaryInjectionNote,
  extractSummarySearchQuery,
  formatSummaryForChat,
  formatSummarySearchResultsForChat,
  buildLocalMergedSummary,
  normalizeDeepSeekSummary,
  normalizeMergedDeepSeekSummary,
  resolveSummaryMessages,
};

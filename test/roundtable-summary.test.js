const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  RoundtableServer,
  buildLocalMergedSummary,
  buildSummaryInjectionNote,
  buildDeepSeekSummaryMessages,
  formatSummaryForChat,
  normalizeDeepSeekSummary,
  normalizeMergedDeepSeekSummary,
  SummaryStore,
} = require("../src/app/roundtable-server");
const { resolveSummaryMessages } = require("../src/app/roundtable-summary");
const { RoundtableStore } = require("../src/app/roundtable-store");
const { runMigrations } = require("../src/db/connection");

test("DeepSeek summary prompt uses the supplied full message range", () => {
  const state = { id: "topic-1", topic: "work topic" };
  const messages = [
    { id: "m1", speaker: "user", text: "first", at: "2026-05-10T01:00:00.000Z" },
    { id: "m2", speaker: "codex", text: "second", at: "2026-05-10T01:01:00.000Z" },
    { id: "m3", speaker: "claude", text: "third", at: "2026-05-10T01:02:00.000Z" },
  ];

  const prompt = buildDeepSeekSummaryMessages(state, messages);

  assert.equal(prompt.length, 2);
  assert.match(prompt[0].content, /只返回一个 JSON 对象/);
  assert.match(prompt[0].content, /summaryText/);
  assert.match(prompt[0].content, /openItems/);
  assert.match(prompt[0].content, /latestState/);
  assert.match(prompt[0].content, /kind=work/);
  assert.match(prompt[0].content, /kind=casual/);
  assert.match(prompt[1].content, /\[m1\]/);
  assert.match(prompt[1].content, /\[m3\]/);
  assert.match(prompt[1].content, /Message range: m1 - m3/);
});

test("DeepSeek summary normalization keeps user-facing text short and stores index fields", () => {
  const state = { id: "topic-1", topic: "work topic" };
  const messages = [
    { id: "m1", speaker: "user", text: "start", at: "2026-05-10T01:00:00.000Z" },
    { id: "m2", speaker: "deepseek", text: "end", at: "2026-05-10T01:02:00.000Z" },
  ];
  const rawText = JSON.stringify({
    kind: "work",
    topicTitle: "summary",
    summaryText: "Useful work was extracted.",
    useful: ["API works"],
    decisions: ["Use DeepSeek for summaries"],
    openItems: ["Add storage"],
    latestState: "Summary fields are searchable.",
    tags: ["roundtable"],
    keywords: ["DeepSeek", "summary"],
  });

  const summary = normalizeDeepSeekSummary({ rawText, state, sourceMessages: messages });
  const chatText = formatSummaryForChat(summary);

  assert.equal(summary.topicId, "topic-1");
  assert.equal(summary.topicTitle, "summary");
  assert.equal(summary.kind, "work");
  assert.equal(summary.summaryText, "Useful work was extracted.");
  assert.deepEqual(summary.openItems, ["Add storage"]);
  assert.equal(summary.latestState, "Summary fields are searchable.");
  assert.deepEqual(summary.tags, ["roundtable"]);
  assert.equal(summary.keywords[0], "DeepSeek");
  assert.equal(summary.keywords[1], "summary");
  assert.ok(summary.keywords.includes("roundtable"));
  assert.match(chatText, /Useful work was extracted/);
  assert.match(chatText, /Add storage/);
});

test("DeepSeek summary normalization accepts old field aliases and derives keywords", () => {
  const state = { id: "topic-1", topic: "二次开会" };
  const messages = [
    { id: "m1", speaker: "user", text: "start", at: "2026-05-10T01:00:00.000Z" },
  ];
  const rawText = JSON.stringify({
    kind: "work",
    topic: "old title",
    summary: "二次开会 fixed summary injection.",
    next: ["Verify search"],
  });

  const summary = normalizeDeepSeekSummary({ rawText, state, sourceMessages: messages });

  assert.equal(summary.topicTitle, "old title");
  assert.equal(summary.summaryText, "二次开会 fixed summary injection.");
  assert.deepEqual(summary.openItems, ["Verify search"]);
  assert.ok(summary.keywords.some((keyword) => keyword.includes("二次开会")));
});

test("SummaryStore persists summaries through SQLite only", () => {
  const { db } = createSummaryDb();
  const store = new SummaryStore({ db });

  const saved = store.add({
    id: "summary-1",
    topicId: "topic-1",
    topicTitle: "work topic",
    summary: "Stored summary.",
    keywords: ["store"],
    createdAt: "2026-05-10T01:00:00.000Z",
  });

  const listed = store.list({ topicId: "topic-1" });
  assert.equal(saved.id, "summary-1");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].summary, "Stored summary.");
});

test("SummaryStore groups summaries by day with newest entries first", () => {
  const { db } = createSummaryDb();
  const store = new SummaryStore({ db });

  store.add({
    id: "summary-old",
    topicId: "topic-1",
    summary: "Old.",
    createdAt: "2026-05-09T12:00:00.000Z",
  });
  store.add({
    id: "summary-new",
    topicId: "topic-1",
    summary: "New.",
    createdAt: "2026-05-10T12:00:00.000Z",
  });

  const days = store.listByDay();
  assert.equal(days[0].day, "2026-05-10");
  assert.equal(days[0].items[0].id, "summary-new");
  assert.equal(days[1].day, "2026-05-09");
});

test("SummaryStore searches indexed summary fields", () => {
  const { db } = createSummaryDb();
  const store = new SummaryStore({ db });
  insertTopic(db, "topic-2", "澶у巺");

  store.add({
    id: "summary-1",
    topicId: "topic-1",
    topicTitle: "二次开会",
    summaryText: "Runtime summary injection was verified.",
    decisions: ["Use topic summaries in handoff"],
    openItems: ["Add search API"],
    tags: ["roundtable"],
    createdAt: "2026-05-10T01:00:00.000Z",
  });
  store.add({
    id: "summary-2",
    topicId: "topic-2",
    topicTitle: "大厅",
    summaryText: "Casual chat stayed clean.",
    createdAt: "2026-05-10T02:00:00.000Z",
  });

  const byTopic = store.search({ query: "二次开会" });
  assert.equal(byTopic.items.length, 1);
  assert.equal(byTopic.items[0].id, "summary-1");
  assert.deepEqual(byTopic.items[0].decisions, ["Use topic summaries in handoff"]);

  const byContent = store.search({ query: "search API" });
  assert.equal(byContent.items[0].id, "summary-1");
});

test("SummaryStore search scopes results by room and project", () => {
  const { db } = createSummaryDb();
  const roundtable = new RoundtableStore({ db });
  roundtable.replace({
    id: "topic-main",
    topic: "Fixed main",
    container: { type: "fixed_room", id: "main", title: "Main" },
    messages: [],
    fixedRooms: {
      main: { title: "Main", topicTitle: "Fixed main", topicId: "topic-main" },
    },
    directChats: {
      codex: { title: "Codex", icon: "C", topicTitle: "Direct Codex", topicId: "topic-codex" },
      code: { title: "Claude Code", icon: "A", topicTitle: "Direct Claude", topicId: "topic-claude" },
    },
    sidebarProjects: [{
      id: "project-stack",
      title: "Stack-chan",
      topicId: "topic-stack",
      topicTitle: "Project Stack",
    }],
    topics: [
      { id: "topic-codex", topic: "Direct Codex", container: { type: "direct_chat", id: "codex", title: "Codex" } },
      { id: "topic-claude", topic: "Direct Claude", container: { type: "direct_chat", id: "code", title: "Claude Code" } },
      { id: "topic-temp", topic: "Temporary", container: { type: "temporary", id: "topic-temp", title: "Temporary" } },
      { id: "topic-stack", topic: "Project Stack", container: { type: "project", id: "project-stack", title: "Stack-chan" } },
    ],
  });
  const store = new SummaryStore({ db });
  for (const topicId of ["topic-main", "topic-codex", "topic-claude", "topic-temp", "topic-stack"]) {
    store.add({
      id: `summary-${topicId}`,
      topicId,
      topicTitle: topicId,
      summaryText: `apple summary for ${topicId}`,
      createdAt: "2026-05-10T03:00:00.000Z",
    });
  }

  assert.deepEqual(searchSummaryTopicIds(store, { scope: "main" }), ["topic-main"]);
  assert.deepEqual(searchSummaryTopicIds(store, { scope: "codex" }), ["topic-codex"]);
  assert.deepEqual(searchSummaryTopicIds(store, { scope: "claude" }), ["topic-claude"]);
  assert.deepEqual(searchSummaryTopicIds(store, { scope: "temporary" }), ["topic-temp"]);
  assert.deepEqual(searchSummaryTopicIds(store, { scope: "project", project: "Stack-chan" }), ["topic-stack"]);
});

test("SummaryStore persists and searches through SQLite", () => {
  const { db } = createSummaryDb();
  const store = new SummaryStore({ db });

  store.add({
    id: "summary-db-1",
    topicId: "topic-1",
    topicTitle: "work topic",
    summaryText: "Database summary search works.",
    openItems: ["Ship SQLite"],
    createdAt: "2026-05-10T03:00:00.000Z",
  });

  const listed = store.list({ topicId: "topic-1" });
  const found = store.search({ query: "SQLite" });
  assert.equal(listed[0].id, "summary-db-1");
  assert.equal(found.items[0].id, "summary-db-1");
  assert.equal(store.latestForTopic("topic-1").id, "summary-db-1");
});

test("SummaryStore updates and archives multiple summaries", () => {
  const { db } = createSummaryDb();
  const store = new SummaryStore({ db });
  store.add({
    id: "summary-a",
    topicId: "topic-1",
    summaryText: "Original summary.",
  });
  store.add({
    id: "summary-b",
    topicId: "topic-1",
    summaryText: "Second summary.",
  });

  const updated = store.update("summary-a", {
    summaryText: "Edited summary.",
    decisions: ["Keep editing"],
  });
  assert.equal(updated.summaryText, "Edited summary.");
  assert.deepEqual(store.getById("summary-a").decisions, ["Keep editing"]);
  assert.deepEqual(store.listByIds(["summary-b", "summary-a"]).map((item) => item.id), ["summary-b", "summary-a"]);

  const archived = store.archiveMany(["summary-a", "summary-b"]);
  assert.equal(archived.changed, 2);
  assert.equal(store.list({ topicId: "topic-1" }).length, 0);
});

test("summary injection note includes full selected summary body", () => {
  const note = buildSummaryInjectionNote([{
    id: "summary-a",
    topicId: "topic-1",
    topicTitle: "project",
    timeRange: { text: "May 10" },
    summaryText: "Runtime status must stay compact.",
    decisions: ["Use auto rows"],
    openItems: ["Verify mobile viewport"],
    latestState: "CSS is patched.",
  }]);

  assert.match(note, /Runtime status must stay compact/);
  assert.match(note, /Use auto rows/);
  assert.match(note, /Verify mobile viewport/);
  assert.match(note, /CSS is patched/);
});

test("merged summary normalization records source range and merge tag", () => {
  const merged = normalizeMergedDeepSeekSummary({
    rawText: JSON.stringify({
      kind: "work",
      topicTitle: "圆桌改造计划",
      summaryText: "合并后的摘要。",
      openItems: ["验收注入"],
    }),
    state: { id: "topic-1", topic: "圆桌改造计划" },
    summaries: [
      {
        id: "summary-a",
        topicId: "topic-1",
        timeRange: { from: "2026-05-10T01:00:00.000Z", to: "2026-05-10T02:00:00.000Z" },
        messageRange: { from: "m1", to: "m2", count: 2 },
      },
      {
        id: "summary-b",
        topicId: "topic-1",
        timeRange: { from: "2026-05-11T01:00:00.000Z", to: "2026-05-11T02:00:00.000Z" },
        messageRange: { from: "m3", to: "m4", count: 2 },
      },
    ],
  });

  assert.equal(merged.topicId, "topic-1");
  assert.equal(merged.summaryText, "合并后的摘要。");
  assert.ok(merged.tags.includes("merged-summary"));
  assert.equal(merged.messageRange.from, "m1");
  assert.equal(merged.messageRange.to, "m4");
  assert.equal(merged.messageRange.count, 4);
});

test("local merged summary fallback preserves selected summary content", () => {
  const merged = buildLocalMergedSummary({
    state: { id: "topic-1", topic: "Fallback Merge" },
    summaries: [
      {
        id: "source-a",
        topicId: "topic-1",
        topicTitle: "Fallback Merge",
        summaryText: "First summary body.",
        decisions: ["Keep the first decision"],
        openItems: ["Check the first item"],
        kind: "work",
      },
      {
        id: "source-b",
        topicId: "topic-1",
        topicTitle: "Fallback Merge",
        summaryText: "Second summary body.",
        decisions: ["Keep the second decision"],
        openItems: ["Check the second item"],
        kind: "work",
      },
    ],
    reason: "model unavailable",
  });

  assert.equal(merged.topicId, "topic-1");
  assert.match(merged.summaryText, /First summary body/);
  assert.match(merged.summaryText, /Second summary body/);
  assert.deepEqual(merged.decisions, ["Keep the first decision", "Keep the second decision"]);
  assert.deepEqual(merged.openItems, ["Check the first item", "Check the second item"]);
  assert.ok(merged.tags.includes("local-merge"));
  assert.ok(merged.tags.includes("merged-summary"));
});

test("manual summaries save to the current topic", () => {
  const { db } = createSummaryDb();
  const roundtableStore = new RoundtableStore({ db });
  roundtableStore.replace({
    id: "topic-1",
    topic: "work topic",
    messages: [
      { id: "m1", speaker: "user", text: "decide memory tool", at: "2026-05-10T01:00:00.000Z" },
      { id: "m2", speaker: "codex", text: "save it", at: "2026-05-10T01:01:00.000Z" },
    ],
  });
  const appLike = {
    store: roundtableStore,
    summaryStore: new SummaryStore({ db }),
  };

  const result = RoundtableServer.prototype.createManualSummary.call(appLike, {
    actor: "codex",
    summaryText: "Memory tool can save durable summaries.",
    decisions: ["Add saveSummary"],
    tags: ["memory"],
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.topicId, "topic-1");
  assert.equal(result.summary.summaryText, "Memory tool can save durable summaries.");
  assert.ok(result.summary.tags.includes("manual-summary"));
  assert.ok(result.summary.tags.includes("codex"));
  assert.equal(appLike.summaryStore.latestForTopic("topic-1").id, result.summary.id);
});

test("topic deletion removes messages summaries and bindings", () => {
  const { db } = createSummaryDb();
  const roundtableStore = new RoundtableStore({ db });
  const summaryStore = new SummaryStore({ db });
  roundtableStore.replace({
    id: "topic-1",
    topic: "work topic",
    fixedRooms: {
      slot1: {
        title: "Pinned",
        topicTitle: "固定：Pinned",
        topicId: "topic-1",
        icon: "◇",
        customizable: true,
      },
    },
    sidebarProjects: [{
      id: "project-1",
      title: "Project",
      topicTitle: "固定｜Project",
      topicId: "topic-1",
      icon: "□",
    }],
    messages: [
      { id: "m1", speaker: "user", text: "delete me", at: "2026-05-10T01:00:00.000Z" },
    ],
  });
  summaryStore.add({
    id: "summary-delete",
    topicId: "topic-1",
    topicTitle: "work topic",
    summaryText: "This summary should be deleted.",
    createdAt: "2026-05-10T02:00:00.000Z",
  });
  const appLike = {
    autoRunToken: 0,
    store: roundtableStore,
    summaryStore,
    pendingMessageByTurnKey: new Map(),
    pendingMessageBySpeakerTurnKey: new Map(),
    clearPendingMessageTurnBindingsForAll() {},
  };

  const result = RoundtableServer.prototype.deleteTopic.call(appLike, { id: "topic-1" });

  assert.equal(result.ok, true);
  assert.equal(roundtableStore.get().id, "");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM topics WHERE id = ?").get("topic-1").count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM messages WHERE topic_id = ?").get("topic-1").count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM summaries WHERE topic_id = ?").get("topic-1").count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM summaries_fts WHERE topic_id = ?").get("topic-1").count, 0);
  assert.equal(roundtableStore.get().fixedRooms.slot1.topicId, "");
  assert.equal(roundtableStore.get().sidebarProjects.length, 0);
});

test("single summary injection keeps an existing runtime thread and appends readable context", async () => {
  const { db } = createSummaryDb();
  const roundtableStore = new RoundtableStore({ db });
  roundtableStore.replace({
    id: "topic-1",
    topic: "work topic",
    messages: [
      { id: "m1", speaker: "user", text: "hello", at: "2026-05-10T01:00:00.000Z" },
    ],
    freshRuntimeHandoffs: {},
  });
  const summaryStore = new SummaryStore({ db });
  summaryStore.add({
    id: "summary-inject",
    topicId: "topic-1",
    topicTitle: "runtime context",
    summaryText: "The injected body must be visible to the next turn.",
    decisions: ["Do not start a fresh runtime for injection"],
    createdAt: "2026-05-10T02:00:00.000Z",
  });
  let freshStarted = false;
  const appLike = {
    store: roundtableStore,
    summaryStore,
    runtimeHub: {
      getSavedThreadId(speaker, topicId) {
        assert.equal(speaker, "codex");
        assert.equal(topicId, "topic-1");
        return "thread-existing";
      },
      async startFreshSpeaker() {
        freshStarted = true;
      },
    },
  };

  const result = await RoundtableServer.prototype.injectOneSummary.call(appLike, {
    speaker: "codex",
    summaryId: "summary-inject",
  });

  const state = roundtableStore.get();
  const injected = state.messages.at(-1);
  assert.equal(result.mode, "current-thread");
  assert.equal(freshStarted, false);
  assert.equal(injected.speaker, "system");
  assert.equal(injected.transcript, true);
  assert.match(injected.text, /The injected body must be visible/);
  assert.match(injected.text, /Do not start a fresh runtime/);
  assert.equal(state.freshRuntimeHandoffs.codex || "", "");
});

test("single summary injection saves a handoff when no runtime thread exists", async () => {
  const { db } = createSummaryDb();
  const roundtableStore = new RoundtableStore({ db });
  roundtableStore.replace({
    id: "topic-1",
    topic: "work topic",
    messages: [],
    freshRuntimeHandoffs: {},
  });
  const summaryStore = new SummaryStore({ db });
  summaryStore.add({
    id: "summary-handoff",
    topicId: "topic-1",
    topicTitle: "fresh context",
    summaryText: "This body waits for the next fresh runtime.",
    createdAt: "2026-05-10T02:00:00.000Z",
  });
  let freshStarted = false;
  const appLike = {
    store: roundtableStore,
    summaryStore,
    runtimeHub: {
      getSavedThreadId() {
        return "";
      },
      async startFreshSpeaker() {
        freshStarted = true;
      },
    },
  };

  const result = await RoundtableServer.prototype.injectOneSummary.call(appLike, {
    speaker: "claude",
    summaryId: "summary-handoff",
  });

  const state = roundtableStore.get();
  assert.equal(result.mode, "fresh-handoff");
  assert.equal(freshStarted, false);
  assert.match(state.freshRuntimeHandoffs.claude, /This body waits for the next fresh runtime/);
  assert.equal(state.messages.length, 0);
});

function createSummaryDb() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "roundtable-summary-db-"));
  const dbPath = path.join(rootDir, "roundtable.db");
  const db = runMigrations(dbPath, path.join(__dirname, "..", "migrations"));
  insertTopic(db, "topic-1", "work topic");
  return { db };
}

function insertTopic(db, id, title) {
  db.prepare(
    `INSERT INTO topics (
      id, title, container_type, container_id, container_title,
      max_rounds, round, next_speaker, running, status, last_error,
      fresh_runtime_handoffs_json, created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    title,
    "temporary",
    id,
    title,
    4,
    0,
    "codex",
    0,
    "ready",
    "",
    "{}",
    "2026-05-10T00:00:00.000Z",
    "2026-05-10T00:00:00.000Z",
    "",
  );
}

function searchSummaryTopicIds(store, options) {
  return store.search({
    query: "apple",
    limit: 10,
    ...options,
  }).items.map((item) => item.topicId).sort();
}

test("summary resolution defaults to the unsummarized tail", () => {
  const state = {
    messages: [
      { id: "m1", speaker: "user", text: "one" },
      { id: "m2", speaker: "codex", text: "two" },
      { id: "m3", speaker: "claude", text: "three" },
    ],
  };

  assert.deepEqual(
    resolveSummaryMessages(state, { afterMessageId: "m2" }).map((message) => message.id),
    ["m3"],
  );
  assert.deepEqual(
    resolveSummaryMessages(state, { afterMessageId: "m2", full: true }).map((message) => message.id),
    ["m1", "m2", "m3"],
  );
});

test("summary resolution uses message count when the saved cursor id is missing", () => {
  const state = {
    messages: [
      { speaker: "user", text: "old one" },
      { speaker: "codex", text: "old two" },
      { id: "m3", speaker: "user", text: "new one" },
      { id: "m4", speaker: "claude", text: "new two" },
    ],
  };

  assert.deepEqual(
    resolveSummaryMessages(state, { afterMessageCount: 2 }).map((message) => message.id),
    ["m3", "m4"],
  );
  assert.deepEqual(
    resolveSummaryMessages(state, { afterMessageId: "missing", afterMessageCount: 2 }).map((message) => message.id),
    ["m3", "m4"],
  );
});

test("summary resolution does not fall back to full history for a stale cursor id", () => {
  const state = {
    messages: [
      { id: "m1", speaker: "user", text: "one" },
      { id: "m2", speaker: "codex", text: "two" },
    ],
  };

  assert.deepEqual(
    resolveSummaryMessages(state, { afterMessageId: "missing" }),
    [],
  );
});

test("startSummaryRun marks the topic busy before the async summary finishes", () => {
  let stored = {
    id: "topic-1",
    running: false,
    status: "ready",
    lastError: "",
  };
  const app = {
    autoRunToken: 0,
    store: {
      get() {
        return { ...stored };
      },
      update(mutator) {
        stored = mutator({ ...stored });
        return stored;
      },
    },
    runSummary() {
      return new Promise(() => {});
    },
  };

  RoundtableServer.prototype.startSummaryRun.call(app, {});

  assert.equal(stored.running, true);
  assert.equal(stored.status, "summarizing");
  assert.equal(app.autoRunToken, 1);
  assert.throws(
    () => RoundtableServer.prototype.startSummaryRun.call(app, {}),
    /current topic is busy/
  );
});

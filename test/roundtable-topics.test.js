const test = require("node:test");
const assert = require("node:assert/strict");

const { RoundtableServer } = require("../src/app/roundtable-server");

test("opening a bound chat preserves the current topic in archive history", () => {
  const state = {
    id: "group-1",
    topic: "临时｜群聊",
    maxRounds: 4,
    round: 0,
    nextSpeaker: "codex",
    running: false,
    status: "ready",
    lastError: "",
    messages: [{ id: "m1", speaker: "user", text: "群聊消息" }],
    events: [],
    freshRuntimeHandoffs: {},
    topics: [],
    directChats: {
      code: {
        title: "Claude Code",
        icon: "x",
        topicTitle: "单聊｜Claude Code",
        topicId: "",
      },
    },
    fixedRooms: {},
    sidebarProjects: [],
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  };
  const appLike = makeRoundtableLike(state);

  RoundtableServer.prototype.openDirectChat.call(appLike, { id: "code" });

  assert.equal(state.topic, "单聊｜Claude Code");
  assert.equal(state.topics.length, 1);
  assert.equal(state.topics[0].id, "group-1");
  assert.equal(state.topics[0].messages[0].text, "群聊消息");
});

test("opening an archived topic also archives the previously active topic", () => {
  const state = {
    id: "active-1",
    topic: "临时｜当前",
    maxRounds: 4,
    round: 0,
    nextSpeaker: "codex",
    running: false,
    status: "ready",
    lastError: "",
    messages: [{ id: "m1", speaker: "user", text: "当前消息" }],
    events: [],
    freshRuntimeHandoffs: {},
    topics: [{
      id: "archived-1",
      topic: "临时｜旧话题",
      maxRounds: 4,
      round: 0,
      nextSpeaker: "codex",
      messages: [{ id: "m2", speaker: "user", text: "旧消息" }],
      events: [],
      createdAt: "2026-05-08T00:00:00.000Z",
      updatedAt: "2026-05-08T00:00:00.000Z",
    }],
    directChats: {},
    fixedRooms: {},
    sidebarProjects: [],
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  };
  const appLike = makeRoundtableLike(state);

  RoundtableServer.prototype.openTopic.call(appLike, { id: "archived-1" });

  assert.equal(state.id, "archived-1");
  assert.equal(state.messages[0].text, "旧消息");
  assert.equal(state.topics.length, 1);
  assert.equal(state.topics[0].id, "active-1");
  assert.equal(state.topics[0].messages[0].text, "当前消息");
});

test("adding a user message during active work is supplemental by default", () => {
  const state = {
    id: "active-1",
    topic: "临时｜当前",
    maxRounds: 4,
    round: 0,
    nextSpeaker: "codex",
    running: true,
    status: "codex thinking",
    lastError: "",
    messages: [
      { id: "m1", speaker: "user", text: "上一条", at: "2026-05-09T00:00:00.000Z" },
      { id: "m2", speaker: "codex", text: "", pending: true, at: "2026-05-09T00:00:00.000Z" },
    ],
    events: [],
    freshRuntimeHandoffs: {},
    topics: [],
    directChats: {},
    fixedRooms: {},
    sidebarProjects: [],
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  };
  const appLike = makeRoundtableLike(state);

  RoundtableServer.prototype.addUserMessage.call(appLike, { text: "新消息" });

  assert.equal(state.running, true);
  assert.equal(state.messages[1].pending, true);
  assert.equal(state.messages[1].text, "");
  assert.equal(state.messages[2].speaker, "user");
  assert.equal(state.messages[2].text, "新消息");
  assert.equal(state.messages[2].supplemental, true);
});

test("adding a user message can explicitly interrupt pending replies", () => {
  const state = {
    id: "active-1",
    topic: "临时｜当前",
    maxRounds: 4,
    round: 0,
    nextSpeaker: "codex",
    running: true,
    status: "codex thinking",
    lastError: "",
    messages: [
      { id: "m1", speaker: "user", text: "上一条", at: "2026-05-09T00:00:00.000Z" },
      { id: "m2", speaker: "codex", text: "", pending: true, at: "2026-05-09T00:00:00.000Z" },
    ],
    events: [],
    freshRuntimeHandoffs: {},
    topics: [],
    directChats: {},
    fixedRooms: {},
    sidebarProjects: [],
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  };
  const appLike = makeRoundtableLike(state);

  RoundtableServer.prototype.addUserMessage.call(appLike, { text: "新消息", interrupt: true });

  assert.equal(state.running, false);
  assert.equal(state.messages[1].pending, false);
  assert.equal(state.messages[1].text, "Interrupted by the user's new message.");
  assert.equal(state.messages[2].speaker, "user");
  assert.equal(state.messages[2].text, "新消息");
});

test("deleting a message removes it from the current topic", () => {
  const state = {
    id: "topic-1",
    topic: "topic",
    maxRounds: 4,
    round: 0,
    nextSpeaker: "codex",
    running: false,
    status: "ready",
    lastError: "",
    messages: [
      { id: "m1", speaker: "user", text: "keep" },
      { id: "m2", speaker: "codex", text: "remove" },
      { id: "m3", speaker: "claude", text: "after" },
    ],
    events: [],
    freshRuntimeHandoffs: {},
    lastSeenMessageIdBySpeaker: { codex: "m2", claude: "m3" },
    topics: [],
    directChats: {},
    fixedRooms: {},
    sidebarProjects: [],
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  };
  const appLike = makeRoundtableLike(state);

  const result = RoundtableServer.prototype.deleteMessage.call(appLike, { id: "m2" });

  assert.equal(result.ok, true);
  assert.deepEqual(state.messages.map((message) => message.id), ["m1", "m3"]);
  assert.equal(state.lastSeenMessageIdBySpeaker.codex, "m3");
  assert.equal(state.lastSeenMessageIdBySpeaker.claude, "m3");
});

test("deleting a pending message cancels the active run", () => {
  const state = {
    id: "topic-1",
    topic: "topic",
    maxRounds: 4,
    round: 0,
    nextSpeaker: "codex",
    running: true,
    status: "codex thinking",
    lastError: "",
    messages: [
      { id: "m1", speaker: "user", text: "prompt" },
      { id: "codex-pending", speaker: "codex", text: "", pending: true },
    ],
    events: [],
    freshRuntimeHandoffs: {},
    topics: [],
    directChats: {},
    fixedRooms: {},
    sidebarProjects: [],
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  };
  const appLike = makeRoundtableLike(state);
  appLike.clearPendingMessageTurnBindings = (messageId) => {
    appLike.clearedMessageId = messageId;
  };

  RoundtableServer.prototype.deleteMessage.call(appLike, { id: "codex-pending" });

  assert.deepEqual(state.messages.map((message) => message.id), ["m1"]);
  assert.equal(state.running, false);
  assert.equal(state.status, "paused");
  assert.equal(appLike.autoRunToken, 1);
  assert.equal(appLike.clearedMessageId, "codex-pending");
});

test("starting a new topic resets per-speaker seen markers", () => {
  const state = {
    id: "old-topic",
    topic: "old topic",
    maxRounds: 4,
    round: 0,
    nextSpeaker: "codex",
    running: false,
    status: "ready",
    lastError: "",
    messages: [{ id: "old-codex", speaker: "codex", text: "old reply" }],
    events: [],
    freshRuntimeHandoffs: {},
    lastSeenMessageIdBySpeaker: { codex: "old-codex", claude: "old-claude" },
    pendingApprovals: [{ speaker: "codex", requestId: "req-1" }],
    topics: [],
    directChats: {},
    fixedRooms: {},
    sidebarProjects: [],
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  };
  const appLike = makeRoundtableLike(state);

  RoundtableServer.prototype.startConversation.call(appLike, { topic: "new topic" });

  assert.deepEqual(state.lastSeenMessageIdBySpeaker, {});
  assert.deepEqual(state.pendingApprovals, []);
});

test("starting typed topics stores readable prefixed titles", () => {
  const projectState = makeEmptyState();
  const temporaryState = makeEmptyState();
  const normalizedProjectState = makeEmptyState();

  RoundtableServer.prototype.startConversation.call(
    makeRoundtableLike(projectState),
    { topic: "写作", kind: "project" }
  );
  RoundtableServer.prototype.startConversation.call(
    makeRoundtableLike(temporaryState),
    { topic: "闲聊", kind: "temporary" }
  );
  RoundtableServer.prototype.startConversation.call(
    makeRoundtableLike(normalizedProjectState),
    { topic: "固定｜排期", kind: "project" }
  );

  assert.equal(projectState.topic, "固定｜写作");
  assert.equal(projectState.messages[0].text, "固定｜写作");
  assert.equal(temporaryState.topic, "临时｜闲聊");
  assert.equal(temporaryState.messages[0].text, "临时｜闲聊");
  assert.equal(normalizedProjectState.topic, "固定｜排期");
});

test("bound rooms assign explicit containers to topics", () => {
  const state = {
    id: "",
    topic: "",
    topics: [],
    directChats: {},
    fixedRooms: {},
    sidebarProjects: [],
  };
  const appLike = makeRoundtableLike(state);

  RoundtableServer.prototype.openFixedRoom.call(appLike, { roomId: "main" });

  assert.deepEqual(state.container, {
    type: "fixed_room",
    id: "main",
    title: state.fixedRooms.main.title,
  });
});

test("runtime replies persist text from structured completion results", async () => {
  const state = {
    id: "topic-1",
    topic: "temporary:test",
    maxRounds: 4,
    round: 0,
    nextSpeaker: "codex",
    running: false,
    status: "ready",
    lastError: "",
    messages: [{ id: "m1", speaker: "user", text: "hi", at: "2026-05-09T00:00:00.000Z" }],
    events: [],
    freshRuntimeHandoffs: {},
    lastSeenMessageIdBySpeaker: {},
    pendingApprovals: [],
    topics: [],
    directChats: {},
    fixedRooms: {},
    sidebarProjects: [],
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  };
  const appLike = Object.assign(makeRoundtableLike(state), {
    pendingMessageByTurnKey: new Map(),
    pendingMessageBySpeakerTurnKey: new Map(),
    runtimeHub: {
      async sendTurn({ onTurnStarted }) {
        onTurnStarted?.({ threadId: "thread-1", turnId: "turn-1", speaker: "codex" });
        return {
          threadId: "thread-1",
          turnId: "turn-1",
          text: "hi，用户。我在。",
        };
      },
    },
  });

  await RoundtableServer.prototype.runNextSpeaker.call(appLike, {
    forceSpeaker: "codex",
    countRound: false,
  });

  assert.equal(state.messages.at(-1).speaker, "codex");
  assert.equal(state.messages.at(-1).text, "hi，用户。我在。");
  assert.equal(state.messages.at(-1).pending, false);
  assert.equal(state.runtimeRuns.at(-1).status, "completed");
});

test("runtime replies without text become visible failures", async () => {
  const state = {
    id: "topic-1",
    topic: "temporary:test",
    maxRounds: 4,
    round: 0,
    nextSpeaker: "codex",
    running: false,
    status: "ready",
    lastError: "",
    messages: [{ id: "m1", speaker: "user", text: "hi", at: "2026-05-09T00:00:00.000Z" }],
    events: [],
    freshRuntimeHandoffs: {},
    lastSeenMessageIdBySpeaker: {},
    pendingApprovals: [],
    topics: [],
    directChats: {},
    fixedRooms: {},
    sidebarProjects: [],
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  };
  const appLike = Object.assign(makeRoundtableLike(state), {
    pendingMessageByTurnKey: new Map(),
    pendingMessageBySpeakerTurnKey: new Map(),
    runtimeHub: {
      async sendTurn({ onTurnStarted }) {
        onTurnStarted?.({ threadId: "thread-1", turnId: "turn-1", speaker: "codex" });
        return {
          threadId: "thread-1",
          turnId: "turn-1",
          text: "",
        };
      },
    },
  });

  await assert.rejects(
    RoundtableServer.prototype.runNextSpeaker.call(appLike, {
      forceSpeaker: "codex",
      countRound: false,
    }),
    /codex returned no reply text/
  );

  assert.equal(state.messages.at(-1).speaker, "codex");
  assert.equal(state.messages.at(-1).text, "codex returned no reply text");
  assert.equal(state.messages.at(-1).pending, false);
  assert.equal(state.status, "error");
  assert.equal(state.runtimeRuns.at(-1).status, "failed");
});

function makeRoundtableLike(state) {
  return Object.assign(Object.create(RoundtableServer.prototype), {
    autoRunToken: 0,
    store: {
      get() {
        return JSON.parse(JSON.stringify(state));
      },
      update(mutator) {
        const next = mutator(JSON.parse(JSON.stringify(state)));
        for (const key of Object.keys(state)) delete state[key];
        Object.assign(state, next);
        return state;
      },
    },
  });
}

function makeEmptyState() {
  return {
    id: "",
    topic: "",
    maxRounds: 4,
    round: 0,
    nextSpeaker: "codex",
    running: false,
    status: "empty",
    lastError: "",
    messages: [],
    events: [],
    freshRuntimeHandoffs: {},
    lastSeenMessageIdBySpeaker: {},
    pendingApprovals: [],
    topics: [],
    directChats: {},
    fixedRooms: {},
    sidebarProjects: [],
    createdAt: "",
    updatedAt: "",
  };
}

const test = require("node:test");
const assert = require("node:assert/strict");

const { RoundtableServer } = require("../src/app/roundtable-server");

test("roundtable keeps unknown runtime approvals pending", async () => {
  const runtimeResponses = [];
  const state = {
    id: "topic-1",
    running: true,
    status: "codex thinking",
    events: [],
    pendingApprovals: [],
  };
  const appLike = makeRoundtableLike(state, runtimeResponses);

  RoundtableServer.prototype.appendSystemEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      speaker: "codex",
      requestId: "req-1",
      threadId: "thread-1",
      turnId: "turn-1",
      commandTokens: [],
      command: "",
    },
  });
  await tick();

  assert.deepEqual(runtimeResponses, []);
  assert.equal(state.status, "waiting approval");
  assert.equal(state.pendingApprovals.length, 1);
  assert.equal(state.pendingApprovals[0].requestId, "req-1");
});

test("roundtable approval API sends templated accept responses", async () => {
  const runtimeResponses = [];
  const state = {
    id: "topic-1",
    running: true,
    status: "waiting approval",
    events: [],
    pendingApprovals: [{
      speaker: "codex",
      requestId: "req-mcp",
      kind: "mcp_tool_call",
      commandTokens: ["mcp_tool", "notes", "note_create"],
      responseTemplate: {
        responseByCommand: {
          yes: { action: "accept" },
          no: { action: "cancel" },
        },
      },
      at: new Date().toISOString(),
    }],
  };
  const appLike = makeRoundtableLike(state, runtimeResponses);

  await RoundtableServer.prototype.respondToApproval.call(appLike, {
    speaker: "codex",
    requestId: "req-mcp",
    decision: "accept",
  });

  assert.deepEqual(runtimeResponses, [{
    speaker: "codex",
    requestId: "req-mcp",
    decision: "accept",
    result: { action: "accept" },
  }]);
  assert.deepEqual(state.pendingApprovals, []);
  assert.equal(state.events.at(-1).type, "runtime.approval.responded");
});

test("roundtable approval API preserves Codex numeric response ids", async () => {
  const runtimeResponses = [];
  const state = {
    id: "topic-1",
    running: true,
    status: "waiting approval",
    events: [],
    pendingApprovals: [{
      speaker: "codex",
      requestId: "0",
      runtimeRequestId: 0,
      kind: "command",
      commandTokens: ["powershell", "Set-Content"],
      at: new Date().toISOString(),
    }],
  };
  const appLike = makeRoundtableLike(state, runtimeResponses);

  await RoundtableServer.prototype.respondToApproval.call(appLike, {
    speaker: "codex",
    requestId: "0",
    decision: "accept",
  });

  assert.deepEqual(runtimeResponses, [{
    speaker: "codex",
    requestId: 0,
    decision: "accept",
    result: null,
  }]);
  assert.deepEqual(state.pendingApprovals, []);
});

test("roundtable only auto-approves allowlisted internal MCP tools", async () => {
  const runtimeResponses = [];
  const state = {
    id: "topic-1",
    running: true,
    status: "codex thinking",
    events: [],
    pendingApprovals: [],
  };
  const appLike = makeRoundtableLike(state, runtimeResponses);

  RoundtableServer.prototype.appendSystemEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      speaker: "codex",
      requestId: "req-internal",
      commandTokens: ["mcp_tool", "roundtable_memory", "searchmemory"],
    },
  });
  await tick();

  assert.deepEqual(runtimeResponses, [{
    speaker: "codex",
    requestId: "req-internal",
    decision: "accept",
    result: null,
  }]);
  assert.deepEqual(state.pendingApprovals, []);

  RoundtableServer.prototype.appendSystemEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      speaker: "claude",
      requestId: "req-memory",
      commandTokens: ["mcp_tool", "roundtable_memory", "searchmemory"],
    },
  });
  await tick();

  assert.deepEqual(runtimeResponses[1], {
    speaker: "claude",
    requestId: "req-memory",
    decision: "accept",
    result: null,
  });
  assert.deepEqual(state.pendingApprovals, []);

  RoundtableServer.prototype.appendSystemEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      speaker: "codex",
      requestId: "req-save-summary",
      commandTokens: ["mcp_tool", "roundtable_memory", "savesummary"],
    },
  });
  await tick();

  assert.deepEqual(runtimeResponses[2], {
    speaker: "codex",
    requestId: "req-save-summary",
    decision: "accept",
    result: null,
  });
  assert.deepEqual(state.pendingApprovals, []);

  RoundtableServer.prototype.appendSystemEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      speaker: "codex",
      requestId: "req-smart-search",
      commandTokens: ["mcp_tool", "codex_surf", "smart_search"],
    },
  });
  RoundtableServer.prototype.appendSystemEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      speaker: "codex",
      requestId: "req-web-read",
      commandTokens: ["mcp_tool", "roundtable_reach", "web_read"],
    },
  });
  RoundtableServer.prototype.appendSystemEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      speaker: "codex",
      requestId: "req-video",
      commandTokens: ["mcp_tool", "roundtable_reach", "video_transcript"],
    },
  });
  RoundtableServer.prototype.appendSystemEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      speaker: "codex",
      requestId: "req-private-search",
      commandTokens: ["mcp_tool", "codex_private_memory", "searchprivatememory"],
    },
  });
  RoundtableServer.prototype.appendSystemEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      speaker: "codex",
      requestId: "req-private-save",
      commandTokens: ["mcp_tool", "codex_private_memory", "rememberprivate"],
    },
  });
  await tick();

  assert.deepEqual(runtimeResponses.slice(3), [
    {
      speaker: "codex",
      requestId: "req-smart-search",
      decision: "accept",
      result: null,
    },
    {
      speaker: "codex",
      requestId: "req-web-read",
      decision: "accept",
      result: null,
    },
    {
      speaker: "codex",
      requestId: "req-video",
      decision: "accept",
      result: null,
    },
    {
      speaker: "codex",
      requestId: "req-private-search",
      decision: "accept",
      result: null,
    },
    {
      speaker: "codex",
      requestId: "req-private-save",
      decision: "accept",
      result: null,
    },
  ]);
  assert.deepEqual(state.pendingApprovals, []);
});

test("roundtable auto-approval preserves Codex numeric response ids", async () => {
  const runtimeResponses = [];
  const state = {
    id: "topic-1",
    running: true,
    status: "codex thinking",
    events: [],
    pendingApprovals: [],
  };
  const appLike = makeRoundtableLike(state, runtimeResponses);

  RoundtableServer.prototype.appendSystemEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      speaker: "codex",
      requestId: 1,
      kind: "mcp_tool_call",
      commandTokens: ["mcp_tool", "roundtable_memory", "savesummary"],
      responseTemplate: {
        responseByCommand: {
          yes: { action: "accept" },
          no: { action: "cancel" },
        },
      },
    },
  });
  await tick();

  assert.deepEqual(runtimeResponses, [{
    speaker: "codex",
    requestId: 1,
    decision: "accept",
    result: { action: "accept" },
  }]);
  assert.deepEqual(state.pendingApprovals, []);
});

test("roundtable keeps Codex numeric request ids pending", async () => {
  const runtimeResponses = [];
  const state = {
    id: "topic-1",
    running: true,
    status: "codex thinking",
    events: [],
    pendingApprovals: [],
  };
  const appLike = makeRoundtableLike(state, runtimeResponses);

  RoundtableServer.prototype.appendSystemEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      speaker: "codex",
      requestId: 0,
      command: "powershell Set-Content smoke",
      commandTokens: ["powershell", "Set-Content"],
    },
  });
  await tick();

  assert.deepEqual(runtimeResponses, []);
  assert.equal(state.status, "waiting approval");
  assert.equal(state.pendingApprovals.length, 1);
  assert.equal(state.pendingApprovals[0].requestId, "0");
  assert.equal(state.pendingApprovals[0].runtimeRequestId, 0);
});

function makeRoundtableLike(state, runtimeResponses) {
  return Object.assign(Object.create(RoundtableServer.prototype), {
    runtimeHub: {
      async respondApproval(payload) {
        runtimeResponses.push(payload);
      },
    },
    pendingMessageByTurnKey: new Map(),
    pendingMessageBySpeakerTurnKey: new Map(),
    store: {
      get() {
        return JSON.parse(JSON.stringify(state));
      },
      update(mutator) {
        const next = mutator(JSON.parse(JSON.stringify(state)));
        for (const key of Object.keys(state)) {
          delete state[key];
        }
        Object.assign(state, next);
        return state;
      },
    },
  });
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

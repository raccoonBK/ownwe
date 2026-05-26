const test = require("node:test");
const assert = require("node:assert/strict");

const { RoundtableServer } = require("../src/app/roundtable-server");

test("targeted reply can start for an idle peer during another runtime turn", () => {
  const calls = [];
  const appLike = Object.assign(Object.create(RoundtableServer.prototype), {
    autoRunToken: 7,
    store: {
      get() {
        return {
          id: "topic-1",
          running: true,
          messages: [],
          runtimeRuns: [{
            id: "runtime_turn:codex",
            kind: "runtime_turn",
            speaker: "codex",
            status: "running",
          }],
        };
      },
      update(mutator) {
        return mutator(this.get());
      },
    },
    async runNextSpeaker(options) {
      calls.push(options);
    },
  });

  RoundtableServer.prototype.maybeRunTargetedReply.call(appLike, { target: "claude" });

  assert.deepEqual(calls, [{
    autoToken: 7,
    keepRunning: false,
    forceSpeaker: "claude",
    countRound: false,
  }]);
  assert.equal(appLike.autoRunToken, 7);
});

test("targeted peer reply completion keeps another runtime turn active", async () => {
  const state = {
    id: "topic-1",
    topic: "runtime routing",
    running: true,
    status: "codex thinking",
    round: 0,
    maxRounds: 4,
    messages: [{ id: "user-1", speaker: "user", text: "Claude can answer this." }],
    runtimeRuns: [{
      id: "runtime_turn:codex",
      kind: "runtime_turn",
      speaker: "codex",
      status: "running",
      startedAt: "2026-05-22T09:00:00.000Z",
    }],
  };
  const appLike = Object.assign(Object.create(RoundtableServer.prototype), {
    autoRunToken: 9,
    config: {},
    store: {
      get() {
        return JSON.parse(JSON.stringify(state));
      },
      update(mutator) {
        Object.assign(state, mutator(JSON.parse(JSON.stringify(state))));
        return state;
      },
    },
    runtimeHub: {
      async sendTurn() {
        return "Claude replies while Codex keeps working.";
      },
    },
    registerPendingMessageTurn() {},
    async runOtherworldAiAction() {},
    scheduleAutoSummaryCheck() {},
  });

  await RoundtableServer.prototype.runNextSpeaker.call(appLike, {
    autoToken: 9,
    forceSpeaker: "claude",
    countRound: false,
  });

  assert.equal(state.running, true);
  assert.equal(state.runtimeRuns.find((run) => run.id === "runtime_turn:codex").status, "running");
  assert.equal(state.runtimeRuns.find((run) => run.speaker === "claude").status, "completed");
});

test("group reply sequence lets the final speaker trigger a peer mention", async () => {
  const calls = [];
  const appLike = Object.assign(Object.create(RoundtableServer.prototype), {
    autoRunToken: 11,
    async runNextSpeaker(options) {
      calls.push(options);
    },
  });

  await RoundtableServer.prototype.runGroupReplySequence.call(appLike, { token: 11 });

  assert.deepEqual(calls, [{
    autoToken: 11,
    keepRunning: false,
    forceSpeaker: "codex",
    countRound: false,
    suppressPeerMentionTrigger: true,
  }, {
    autoToken: 11,
    keepRunning: false,
    forceSpeaker: "claude",
    countRound: false,
    suppressPeerMentionTrigger: false,
  }]);
});

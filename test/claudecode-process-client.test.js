const assert = require("node:assert/strict");
const test = require("node:test");

const { ClaudeCodeProcessClient } = require("../src/adapters/runtime/claudecode/process-client");
const { mapClaudeCodeMessageToRuntimeEvent } = require("../src/adapters/runtime/claudecode/events");

test("ClaudeCodeProcessClient falls back to assistant text when result is empty", () => {
  const client = new ClaudeCodeProcessClient({ cwd: process.cwd() });
  const events = [];
  client.onMessage((event) => events.push(event));

  client.pendingTurnId = "turn-1";
  client.activeThreadId = "session-1";
  client.handleAssistant({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "验收结果：通过。" },
      ],
    },
  });
  client.handleResult({
    type: "result",
    session_id: "session-1",
    result: "",
  });

  assert.equal(events.at(-1).type, "turn.completed");
  assert.equal(events.at(-1).text, "验收结果：通过。");
});

test("ClaudeCodeProcessClient returns the sent turn id even after completion clears pending state", async () => {
  const client = new ClaudeCodeProcessClient({ cwd: process.cwd() });
  const writes = [];
  client.alive = true;
  client.stdin = {
    write(value) {
      writes.push(value);
    },
  };

  const sent = await client.sendUserMessage({ text: "hello", threadId: "session-1" });
  assert.match(sent.turnId, /^turn-\d+$/);
  client.handleResult({
    type: "result",
    session_id: "session-1",
    result: "done",
  });

  assert.equal(client.pendingTurnId, "");
  assert.equal(sent.turnId.startsWith("turn-"), true);
  assert.equal(writes.length, 1);
});

test("ClaudeCodeProcessClient reports turn start before writing to stdin", async () => {
  const client = new ClaudeCodeProcessClient({ cwd: process.cwd() });
  const order = [];
  client.alive = true;
  client.stdin = {
    write() {
      order.push("write");
    },
  };

  const sent = await client.sendUserMessage({
    text: "hello",
    threadId: "session-1",
    onTurnStarted(turn) {
      order.push(`started:${turn.turnId}:${turn.threadId}`);
    },
  });

  assert.deepEqual(order, [`started:${sent.turnId}:session-1`, "write"]);
});

test("ClaudeCode runtime failure mapping uses payload.error", () => {
  const mapped = mapClaudeCodeMessageToRuntimeEvent({
    type: "process.close",
    sessionId: "session-1",
    turnId: "turn-1",
    error: "claudecode process closed with code 1",
  });

  assert.equal(mapped.type, "runtime.turn.failed");
  assert.equal(mapped.payload.error, "claudecode process closed with code 1");
});

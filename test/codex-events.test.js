const test = require("node:test");
const assert = require("node:assert/strict");

const { mapCodexMessageToRuntimeEvent } = require("../src/adapters/runtime/codex/events");

test("codex failed completed turns map to runtime failures", () => {
  assert.deepEqual(mapCodexMessageToRuntimeEvent({
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "failed",
        error: {
          message: "stream disconnected",
        },
      },
    },
  }), {
    type: "runtime.turn.failed",
    payload: {
      threadId: "thread-1",
      turnId: "turn-1",
      text: "❌ Execution failed\nstream disconnected",
    },
  });
});

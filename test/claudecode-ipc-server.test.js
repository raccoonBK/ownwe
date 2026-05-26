const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");

const { ClaudeCodeIpcServer } = require("../src/adapters/runtime/claudecode/ipc-server");

test("claudecode IPC server start is idempotent", async () => {
  const server = new ClaudeCodeIpcServer({
    socketPath: path.join(os.tmpdir(), `roundtable-ipc-${Date.now()}.sock`),
  });
  try {
    await server.start();
    const firstPath = server.socketPath;
    await server.start();
    assert.equal(server.socketPath, firstPath);
  } finally {
    await server.close();
  }
});

test("claudecode IPC server falls back from occupied Windows pipe", async () => {
  if (process.platform !== "win32") {
    return;
  }
  const socketPath = path.join(os.tmpdir(), `roundtable-ipc-${Date.now()}.sock`);
  const first = new ClaudeCodeIpcServer({ socketPath });
  const second = new ClaudeCodeIpcServer({ socketPath });
  try {
    await first.start();
    await second.start();
    assert.notEqual(second.socketPath, first.socketPath);
  } finally {
    await second.close();
    await first.close();
  }
});

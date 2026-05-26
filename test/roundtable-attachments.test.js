const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildRuntimePrompt } = require("../src/app/roundtable-server");
const { RuntimeHub } = require("../src/app/roundtable-runtime");
const { buildTurnInputPayload } = require("../src/adapters/runtime/codex/rpc-client");
const { buildClaudeContent } = require("../src/adapters/runtime/claudecode/process-client");

test("codex turn input includes localImage blocks for image attachments", () => {
  assert.deepEqual(buildTurnInputPayload("look", [{
    localPath: "C:\\uploads\\image.png",
    mimeType: "image/png",
  }]), [
    { type: "text", text: "look" },
    { type: "localImage", path: "C:\\uploads\\image.png" },
  ]);
});

test("claude content includes image, document, and inline text attachment blocks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roundtable-attachments-"));
  const imagePath = path.join(root, "image.png");
  const pdfPath = path.join(root, "paper.pdf");
  const textPath = path.join(root, "notes.txt");
  fs.writeFileSync(imagePath, Buffer.from("image"));
  fs.writeFileSync(pdfPath, Buffer.from("pdf"));
  fs.writeFileSync(textPath, "hello notes");

  const content = buildClaudeContent("reply", [
    { name: "image.png", localPath: imagePath, mimeType: "image/png" },
    { name: "paper.pdf", localPath: pdfPath, mimeType: "application/pdf" },
    { name: "notes.txt", localPath: textPath, mimeType: "text/plain" },
  ]);

  assert.equal(content[0].type, "image");
  assert.equal(content[1].type, "document");
  assert.match(content[2].text, /hello notes/);
  assert.deepEqual(content[3], { type: "text", text: "reply" });
});

test("runtime prompt exposes attachment local paths", () => {
  const prompt = buildRuntimePrompt({
    speaker: "codex",
    stateDir: "C:\\roundtable-state",
    state: {
      topic: "临时｜附件",
      round: 0,
      maxRounds: 4,
      messages: [{
        id: "m1",
        speaker: "user",
        text: "看图",
        attachments: [{
          name: "image.png",
          url: "/uploads/2026-05-18/image.png",
          mimeType: "image/png",
        }],
      }],
      lastSeenMessageIdBySpeaker: {},
    },
  });

  assert.match(prompt, /local path: C:\\roundtable-state\\uploads\\2026-05-18\\image.png/);
});

test("runtime hub preserves hydrated attachment paths for adapters", async () => {
  let received = null;
  const hub = Object.create(RuntimeHub.prototype);
  Object.assign(hub, {
    workspaceRoot: "C:\\work",
    config: { codexAccessMode: "full-access" },
    turnTimeoutMs: 1000,
    initializedSpeakers: new Set(["claude"]),
    initializingBySpeaker: new Map(),
    listenerSpeakers: new Set(),
    listeners: [],
    waitersBySpeaker: new Map(),
    adapters: {
      claude: {
        async sendTextTurn(payload) {
          received = payload.attachments;
          return { threadId: "thread-1", turnId: "turn-1" };
        },
      },
    },
    async initializeSpeaker() {},
    getSavedThreadId() {
      return "thread-1";
    },
    waitForCompletion() {
      return {
        expect() {
          return Promise.resolve({ text: "ok" });
        },
        cancel() {},
      };
    },
  });

  const attachments = [{
    name: "image.png",
    url: "/uploads/2026-05-18/image.png",
    mimeType: "image/png",
    localPath: "C:\\uploads\\image.png",
  }];

  await hub.sendTurn({
    speaker: "claude",
    topicId: "topic-1",
    text: "look",
    attachments,
  });

  assert.deepEqual(received, attachments);
});

test("runtime hub waits for turn completion after pre-tool assistant text", async () => {
  const hub = Object.create(RuntimeHub.prototype);
  Object.assign(hub, {
    waitersBySpeaker: new Map(),
  });

  const completion = hub.waitForCompletion("claude", { timeoutMs: 1000 });
  const turn = { threadId: "thread-1", turnId: "turn-1" };
  const resultPromise = completion.expect(turn);

  hub.dispatchToWaiters("claude", {
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-1",
      turnId: "turn-1",
      text: "Let me inspect the startup card.",
    },
  });

  const earlyResult = await Promise.race([
    resultPromise.then(() => "resolved"),
    new Promise((resolve) => setTimeout(() => resolve("pending"), 20)),
  ]);
  assert.equal(earlyResult, "pending");

  hub.dispatchToWaiters("claude", {
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-1",
      turnId: "turn-1",
      text: "The injected summary is visible after checking the startup card.",
    },
  });
  hub.dispatchToWaiters("claude", {
    type: "runtime.turn.completed",
    payload: {
      threadId: "thread-1",
      turnId: "turn-1",
    },
  });

  assert.deepEqual(await resultPromise, {
    threadId: "thread-1",
    turnId: "turn-1",
    text: "The injected summary is visible after checking the startup card.",
  });
});

test("runtime hub uses turn completion text over longer assistant fragments", async () => {
  const hub = Object.create(RuntimeHub.prototype);
  Object.assign(hub, {
    waitersBySpeaker: new Map(),
  });

  const completion = hub.waitForCompletion("claude", { timeoutMs: 1000 });
  const turn = { threadId: "thread-1", turnId: "turn-1" };
  const resultPromise = completion.expect(turn);

  hub.dispatchToWaiters("claude", {
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-1",
      turnId: "turn-1",
      text: "This is a much longer pre-tool fragment that should not win.",
    },
  });
  hub.dispatchToWaiters("claude", {
    type: "runtime.turn.completed",
    payload: {
      threadId: "thread-1",
      turnId: "turn-1",
      text: "Final answer.",
    },
  });

  assert.deepEqual(await resultPromise, {
    threadId: "thread-1",
    turnId: "turn-1",
    text: "Final answer.",
  });
});

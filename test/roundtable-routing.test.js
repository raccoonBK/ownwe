const test = require("node:test");
const assert = require("node:assert/strict");

const {
  inferPeerMentionedSpeaker,
  inferSingleMentionedSpeaker,
  withResolvedReplyTarget,
} = require("../src/app/roundtable-server");

test("single speaker mention infers a targeted Codex reply", () => {
  assert.equal(inferSingleMentionedSpeaker("codex你动手吧"), "codex");
  assert.deepEqual(withResolvedReplyTarget({ text: "codex你动手吧" }), {
    text: "codex你动手吧",
    target: "codex",
  });
});

test("single speaker mention infers a targeted Claude reply", () => {
  assert.equal(inferSingleMentionedSpeaker("Claude如何想"), "claude");
  assert.deepEqual(withResolvedReplyTarget({ text: "Claude如何想" }), {
    text: "Claude如何想",
    target: "claude",
  });
});

test("multiple speaker mentions stay as a group reply", () => {
  assert.equal(inferSingleMentionedSpeaker("codex出大纲，Claude调整"), "");
  assert.deepEqual(withResolvedReplyTarget({ text: "codex出大纲，Claude调整" }), {
    text: "codex出大纲，Claude调整",
  });
});

test("single Gemini mention infers a targeted Gemini reply", () => {
  assert.equal(inferSingleMentionedSpeaker("@Gemini help summarize this"), "gemini");
  assert.deepEqual(withResolvedReplyTarget({ text: "@Gemini help summarize this" }), {
    text: "@Gemini help summarize this",
    target: "gemini",
  });
});

test("explicit reply target wins over inferred mentions", () => {
  assert.deepEqual(withResolvedReplyTarget({
    text: "codex你看看",
    target: "claude",
  }), {
    text: "codex你看看",
    target: "claude",
  });
});

test("explicit peer mentions route only to the other AI", () => {
  assert.equal(inferPeerMentionedSpeaker("@Gemini also look", "codex"), "gemini");
  assert.equal(inferPeerMentionedSpeaker("@Claude 看这个", "codex"), "claude");
  assert.equal(inferPeerMentionedSpeaker("@Codex 你接着看", "claude"), "codex");
  assert.equal(inferPeerMentionedSpeaker("@Codex 我自己说", "codex"), "");
  assert.equal(inferPeerMentionedSpeaker("Claude 你怎么看", "codex"), "");
});

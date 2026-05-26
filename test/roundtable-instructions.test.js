const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  buildOpeningTurnText,
  buildInstructionRefreshText,
} = require("../src/adapters/runtime/shared-instructions");

test("roundtable instruction wrapper uses configured label and context", () => {
  const config = {
    sessionInstructionsLabel: "ROUNDTABLE",
    sessionInstructionsContext: "Roundtable Codex discussion",
    weixinInstructionsFile: path.resolve(__dirname, "..", "package.json"),
    weixinOperationsFile: "",
  };

  const opening = buildOpeningTurnText(config, "hi");
  assert.match(opening, /^ROUNDTABLE SESSION INSTRUCTIONS/);
  assert.match(opening, /stable behavior for this Roundtable Codex discussion/);
  assert.doesNotMatch(opening, /WECHAT SESSION INSTRUCTIONS/);

  const refresh = buildInstructionRefreshText(config);
  assert.match(refresh, /^ROUNDTABLE SESSION INSTRUCTIONS REFRESH/);
  assert.match(refresh, /updated Roundtable Codex discussion instructions/);
  assert.doesNotMatch(refresh, /WECHAT SESSION INSTRUCTIONS/);
});

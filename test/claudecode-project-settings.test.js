const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ensureClaudeProjectMcpConfig,
  buildClaudeProjectMcpServerConfig,
  writeRoundtableMemoryMcpConfig,
} = require("../src/adapters/runtime/claudecode/project-settings");

test("roundtable Claude runtime loads external MCP config without writing workspace .mcp.json", () => {
  const previous = process.env.ROUNDTABLE_CLAUDE_MCP_CONFIG;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roundtable-claude-mcp-"));
  const workspaceRoot = path.join(root, "workspace");
  const configPath = path.join(root, "live_mcp_code.json");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(configPath, `\uFEFF${JSON.stringify({
    mcpServers: {
      "External Code Tools": {
        command: "python",
        args: ["external_core.py"],
      },
    },
  }, null, 2)}`, "utf8");

  try {
    process.env.ROUNDTABLE_CLAUDE_MCP_CONFIG = configPath;
    const result = ensureClaudeProjectMcpConfig({ workspaceRoot });

    assert.equal(result.configPath, configPath);
    assert.deepEqual(result.configPaths, [configPath]);
    assert.equal(result.serverName, "External Code Tools");
    assert.deepEqual(result.config, buildClaudeProjectMcpServerConfig({}));
    assert.equal(fs.existsSync(path.join(workspaceRoot, ".mcp.json")), false);
  } finally {
    if (previous === undefined) {
      delete process.env.ROUNDTABLE_CLAUDE_MCP_CONFIG;
    } else {
      process.env.ROUNDTABLE_CLAUDE_MCP_CONFIG = previous;
    }
  }
});

test("roundtable Claude runtime reports an explicit missing MCP config", () => {
  const previous = process.env.ROUNDTABLE_CLAUDE_MCP_CONFIG;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roundtable-claude-mcp-missing-"));
  const workspaceRoot = path.join(root, "workspace");
  const missingPath = path.join(root, "missing.json");
  fs.mkdirSync(workspaceRoot, { recursive: true });

  try {
    process.env.ROUNDTABLE_CLAUDE_MCP_CONFIG = missingPath;
    assert.throws(
      () => ensureClaudeProjectMcpConfig({ workspaceRoot }),
      /Claude MCP config not found/,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.ROUNDTABLE_CLAUDE_MCP_CONFIG;
    } else {
      process.env.ROUNDTABLE_CLAUDE_MCP_CONFIG = previous;
    }
  }
});

test("roundtable Claude runtime can add the memory MCP config outside the workspace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roundtable-claude-memory-mcp-"));
  const workspaceRoot = path.join(root, "workspace");
  const stateDir = path.join(root, "state");
  fs.mkdirSync(workspaceRoot, { recursive: true });

  const result = ensureClaudeProjectMcpConfig({
    workspaceRoot,
    stateDir,
    includeMemoryMcp: true,
  });

  assert.ok(result.configPaths.some((configPath) => /roundtable-memory-claude\.json$/.test(configPath)));
  assert.match(result.serverName, /roundtable_memory/);
  assert.equal(fs.existsSync(path.join(workspaceRoot, ".mcp.json")), false);
  assert.equal(fs.existsSync(result.configPaths.find((configPath) => /roundtable-memory-claude\.json$/.test(configPath))), true);
});

test("roundtable memory MCP config marks Claude as actor", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roundtable-memory-config-"));
  const configPath = writeRoundtableMemoryMcpConfig({ stateDir: root, actor: "claude" });
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

  assert.equal(config.mcpServers.roundtable_memory.env.ROUNDTABLE_MEMORY_ACTOR, "claude");
  assert.match(config.mcpServers.roundtable_memory.args[0], /roundtable-memory-server\.js$/);
});

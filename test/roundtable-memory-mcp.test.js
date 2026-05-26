const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  expandAllowedScopes,
  readConfig,
} = require("../src/mcp/roundtable-memory-server");
const { searchMemoryWithClient } = require("../src/app/roundtable-memory-search");
const { buildRoundtableMemoryMcpServerConfig } = require("../src/mcp/roundtable-memory-config");
const {
  buildCodexMcpConfigArgs,
  resolveCodexProjectToolMcpServerConfig,
} = require("../src/adapters/runtime/codex/mcp-config");
const {
  rememberPrivate,
  searchPrivateMemory,
} = require("../src/mcp/codex-private-memory-server");

test("roundtable memory MCP expands global without the other AI private chat", () => {
  assert.deepEqual(expandAllowedScopes({ actor: "codex", scope: "global" }), [
    "main",
    "philosophy",
    "alone",
    "temporary",
    "project",
    "codex",
  ]);
  assert.deepEqual(expandAllowedScopes({ actor: "claude", scope: "global" }), [
    "main",
    "philosophy",
    "alone",
    "temporary",
    "project",
    "claude",
  ]);
});

test("roundtable memory MCP denies cross-private scopes", () => {
  assert.deepEqual(expandAllowedScopes({ actor: "codex", scope: "claude" }), []);
  assert.deepEqual(expandAllowedScopes({ actor: "claude", scope: "codex" }), []);
  assert.deepEqual(expandAllowedScopes({ actor: "codex", scope: "main" }), ["main"]);
});

test("roundtable memory MCP reads actor from argv or env", () => {
  assert.deepEqual(readConfig(["--actor=codex", "--port=8999"], {}), {
    actor: "codex",
    port: 8999,
  });
  assert.deepEqual(readConfig([], {
    ROUNDTABLE_MEMORY_ACTOR: "claude",
    ROUNDTABLE_PORT: "8798",
  }), {
    actor: "claude",
    port: 8798,
  });
});

test("Codex MCP config args include roundtable memory env", () => {
  const config = buildRoundtableMemoryMcpServerConfig({ actor: "codex", port: "8797" });
  const args = buildCodexMcpConfigArgs(config);
  assert.ok(args.some((arg) => arg.includes("mcp_servers.roundtable_memory.command")));
  assert.ok(args.some((arg) => arg.includes("mcp_servers.roundtable_memory.env.ROUNDTABLE_MEMORY_ACTOR")));
  assert.ok(args.some((arg) => arg.includes("codex")));
});

test("Codex MCP config includes memory, surf, and Rhysen tools", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "roundtable-codex-mcp-"));
  fs.writeFileSync(path.join(rootDir, ".mcp.json"), JSON.stringify({
    mcpServers: {
      "Roundtable Reach": {
        command: "python",
        args: ["reach_mcp.py"],
      },
      "Rhysen Community": {
        type: "http",
        url: "https://example.invalid/mcp",
      },
    },
  }), "utf8");

  const config = resolveCodexProjectToolMcpServerConfig({ cyberbossHome: rootDir });
  const args = buildCodexMcpConfigArgs(config);
  const joined = args.join("\n");

  assert.match(joined, /mcp_servers\.roundtable_memory\.command/);
  assert.match(joined, /mcp_servers\.codex_private_memory\.command/);
  assert.match(joined, /mcp_servers\.codex_surf\.command/);
  assert.match(joined, /mcp_servers\.roundtable_reach\.command/);
  assert.match(joined, /mcp_servers\.rhysen_community\.url/);
  assert.match(joined, /reach_mcp\.py/);
  assert.match(joined, /https:\/\/example\.invalid\/mcp/);
});

test("Codex private memory MCP reads old files and writes new notes", () => {
  const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-private-memory-"));
  fs.writeFileSync(path.join(memoryDir, "relationship_memory.json"), JSON.stringify({
    version: 1,
    updatedAt: "2026-04-23T15:30:00.000Z",
    items: [{
      key: "user_cares_about_continuity",
      value: true,
      confidence: 0.95,
      source: "bootstrap",
      tags: ["continuity", "relationship"],
      importance: 0.95,
      createdAt: "2026-04-23T15:30:00.000Z",
      updatedAt: "2026-04-23T15:30:00.000Z",
    }],
  }), "utf8");
  fs.writeFileSync(path.join(memoryDir, "event_log.jsonl"), [
    JSON.stringify({
      id: "evt-1",
      timestamp: "2026-05-07T19:39:20.694Z",
      source: "codex",
      summary: "Rhysen forum nori account was registered.",
      tags: ["forum", "rhysen", "nori"],
      importance: 0.8,
    }),
    "",
  ].join("\n"), "utf8");

  const before = searchPrivateMemory({ query: "continuity" }, { memoryDir });
  assert.equal(before.items[0].type, "relationship");
  assert.equal(before.items[0].key, "user_cares_about_continuity");

  const saved = rememberPrivate({
    kind: "feel",
    text: "Forum notes can become Codex private memory without copying raw posts.",
    tags: ["forum", "rhysen", "nori"],
  }, { memoryDir });
  assert.equal(saved.ok, true);

  const after = searchPrivateMemory({ query: "raw posts nori", limit: 3 }, { memoryDir });
  assert.equal(after.items[0].type, "feel");
  assert.match(after.items[0].text, /Forum notes/);
});

test("owner memory search can search both private scopes through global", async () => {
  const seen = [];
  const result = await searchMemoryWithClient({
    actor: "owner",
    scope: "global",
    query: "apple",
    limit: 10,
    searchSummaries({ scope }) {
      seen.push(["summary", scope]);
      return {
        items: scope === "codex" || scope === "claude"
          ? [{
            topicId: `topic-${scope}`,
            topicTitle: scope,
            summaryText: `apple from ${scope}`,
            createdAt: `2026-05-10T0${scope === "codex" ? "1" : "2"}:00:00.000Z`,
          }]
          : [],
      };
    },
    searchMessages({ scope }) {
      seen.push(["message", scope]);
      return { items: [] };
    },
  });

  assert.ok(result.searchedScopes.includes("codex"));
  assert.ok(result.searchedScopes.includes("claude"));
  assert.deepEqual(result.items.map((item) => item.source.scope), ["claude", "codex"]);
  assert.ok(seen.some((entry) => entry.join(":") === "summary:main"));
});

test("memory search returns summaries first and message context after", async () => {
  const result = await searchMemoryWithClient({
    actor: "codex",
    scope: "main",
    query: "vector",
    searchSummaries() {
      return {
        items: [1, 2, 3, 4].map((n) => ({
          topicId: "main",
          topicTitle: "大厅",
          summaryText: `summary ${n}`,
          createdAt: `2026-05-10T0${n}:00:00.000Z`,
          matchType: n === 1 ? "semantic" : "keyword",
          semanticScore: n === 1 ? 0.8 : 0,
        })),
      };
    },
    searchMessages() {
      return {
        items: [1, 2, 3, 4].map((n) => ({
          topicId: "main",
          topicTitle: "大厅",
          matchMessage: {
            id: `message-${n}`,
            speaker: "user",
            text: `message ${n}`,
            at: `2026-05-10T1${n}:00:00.000Z`,
          },
          contextBefore: [{ id: `before-${n}`, speaker: "codex", text: `before ${n}`, at: "" }],
          contextAfter: [{ id: `after-${n}`, speaker: "claude", text: `after ${n}`, at: "" }],
        })),
      };
    },
  });

  assert.equal(result.items.length, 6);
  assert.deepEqual(result.items.map((item) => item.type), [
    "summary",
    "summary",
    "summary",
    "message",
    "message",
    "message",
  ]);
  assert.equal(result.items[0].matchType, "semantic");
  assert.equal(result.items[3].matchMessage.id, "message-3");
  assert.equal(result.items[3].contextAfter[0].id, "after-3");
  assert.equal(result.items[3].contextBefore[0].text, "before 3");
});

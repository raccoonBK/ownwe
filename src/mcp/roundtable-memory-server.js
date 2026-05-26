const http = require("http");
const readline = require("readline");
const {
  ACTOR_PRIVATE_SCOPES,
  PUBLIC_SCOPES,
  expandAllowedScopes,
  searchMemoryWithClient,
} = require("../app/roundtable-memory-search");

const DEFAULT_PORT = 8797;

const TOOLS = [
  {
    name: "searchMemory",
    description: "Search Roundtable memory. Use this for prior conversations, room history, project context, or past decisions.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description: "main, codex, claude, philosophy, alone, temporary, project, or global",
        },
        query: {
          type: "string",
          description: "What to search for in memory",
        },
        project: {
          type: "string",
          description: "Project name or id when scope is project",
        },
        limit: {
          type: "number",
          description: "Maximum returned memory items",
        },
        context: {
          type: "number",
          description: "Message context size when raw messages are searched",
        },
      },
      required: ["scope", "query"],
    },
  },
  {
    name: "saveSummary",
    description: "Save a durable summary for the current Roundtable topic. Use only when the user asks you to save a summary or when a clear durable decision should be recorded.",
    inputSchema: {
      type: "object",
      properties: {
        summaryText: {
          type: "string",
          description: "One concise summary paragraph to save",
        },
        kind: {
          type: "string",
          description: "work, casual, or mixed",
        },
        useful: {
          type: "array",
          items: { type: "string" },
          description: "Useful facts or points",
        },
        decisions: {
          type: "array",
          items: { type: "string" },
          description: "Decisions to remember",
        },
        openItems: {
          type: "array",
          items: { type: "string" },
          description: "Open items or next actions",
        },
        latestState: {
          type: "string",
          description: "Current state after this summary",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Short tags",
        },
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Search keywords",
        },
      },
      required: ["summaryText"],
    },
  },
];

function readConfig(argv = process.argv.slice(2), env = process.env) {
  return {
    actor: normalizeActor(readArg(argv, "--actor") || env.ROUNDTABLE_MEMORY_ACTOR),
    port: normalizePort(readArg(argv, "--port") || env.ROUNDTABLE_PORT, DEFAULT_PORT),
  };
}

async function searchMemory(args = {}, config = readConfig()) {
  const actor = normalizeActor(config.actor);
  if (!actor) {
    throw new Error("ROUNDTABLE_MEMORY_ACTOR must be codex or claude");
  }
  return searchMemoryWithClient({
    ...args,
    actor,
    searchSummaries: ({ scope, query, project, limit }) => apiGet(config.port, "/api/summaries/search", {
      scope,
      q: query,
      limit,
      ...(project ? { project } : {}),
    }),
    searchMessages: ({ scope, query, project, limit, context }) => apiGet(config.port, "/api/messages/search", {
      scope,
      q: query,
      limit,
      context,
      ...(project ? { project } : {}),
    }),
  });
}

function apiGet(port, urlPath, params = {}) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== "") {
      searchParams.set(key, String(value));
    }
  }
  const suffix = searchParams.toString() ? `?${searchParams}` : "";
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${urlPath}${suffix}`, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        let body = data;
        try {
          body = JSON.parse(data);
        } catch {
          // keep plain response
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`roundtable API ${res.statusCode}: ${JSON.stringify(body)}`));
          return;
        }
        resolve(body);
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(new Error("roundtable API timeout")); });
  });
}

async function callTool(name, args, config) {
  if (name === "searchMemory") {
    return searchMemory(args, config);
  }
  if (name === "saveSummary") {
    return saveSummary(args, config);
  }
  throw new Error(`unknown tool: ${name}`);
}

async function saveSummary(args = {}, config = readConfig()) {
  const actor = normalizeActor(config.actor);
  if (!actor) {
    throw new Error("ROUNDTABLE_MEMORY_ACTOR must be codex or claude");
  }
  return apiPost(config.port, "/api/summary/manual", {
    ...args,
    actor,
  });
}

function apiPost(port, urlPath, body = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: urlPath,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      let responseData = "";
      res.on("data", (chunk) => { responseData += chunk; });
      res.on("end", () => {
        let parsed = responseData;
        try {
          parsed = JSON.parse(responseData);
        } catch {
          // keep plain response
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`roundtable API ${res.statusCode}: ${JSON.stringify(parsed)}`));
          return;
        }
        resolve(parsed);
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(new Error("roundtable API timeout")); });
    req.write(data);
    req.end();
  });
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function handleMessage(msg, config) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "roundtable-memory", version: "1.0.0" },
      },
    });
    return;
  }
  if (method === "notifications/initialized") {
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    const { name, arguments: toolArgs = {} } = params || {};
    try {
      const result = await callTool(name, toolArgs, config);
      send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true },
      });
    }
    return;
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
}

function startServer(config = readConfig()) {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const msg = JSON.parse(trimmed);
      handleMessage(msg, config).catch((error) => {
        process.stderr.write(`[roundtable-memory-mcp] error: ${error.message}\n`);
      });
    } catch {
      process.stderr.write(`[roundtable-memory-mcp] invalid JSON: ${trimmed.slice(0, 100)}\n`);
    }
  });
  rl.on("close", () => process.exit(0));
}

function readArg(argv, name) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => String(arg || "").startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : "";
}

function normalizeActor(value) {
  const normalized = normalizeText(value).toLowerCase();
  return ["codex", "claude"].includes(normalized) ? normalized : "";
}

function normalizeScope(value) {
  return normalizeText(value).toLowerCase();
}

function normalizePort(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

if (require.main === module) {
  startServer();
}

module.exports = {
  ACTOR_PRIVATE_SCOPES,
  PUBLIC_SCOPES,
  expandAllowedScopes,
  readConfig,
  searchMemory,
};

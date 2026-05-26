const fs = require("fs");
const path = require("path");
const readline = require("readline");

const DEFAULT_LIMIT = 8;

const TOOLS = [
  {
    name: "searchPrivateMemory",
    description: "Search Codex private memory, including relationship facts, event notes, and feeling notes.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search words or tags",
        },
        limit: {
          type: "number",
          description: "Maximum returned items",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "rememberPrivate",
    description: "Write a Codex private memory entry. Use for Codex's own relationship memory, forum experiences, and personal continuity notes.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          description: "relationship, event, or feel",
        },
        key: {
          type: "string",
          description: "Stable key for relationship memory",
        },
        value: {
          description: "Relationship memory value",
        },
        text: {
          type: "string",
          description: "Event or feeling text",
        },
        summary: {
          type: "string",
          description: "Short event summary",
        },
        tags: {
          type: "array",
          items: { type: "string" },
        },
        importance: {
          type: "number",
        },
        source: {
          type: "string",
        },
        metadata: {
          type: "object",
        },
      },
    },
  },
];

function readConfig(argv = process.argv.slice(2), env = process.env) {
  return {
    memoryDir: path.resolve(
      readArg(argv, "--memory-dir") ||
        env.CODEX_PRIVATE_MEMORY_DIR ||
        path.join(process.cwd(), "codex-memory")
    ),
  };
}

function searchPrivateMemory(args = {}, config = readConfig()) {
  const query = normalizeText(args.query).toLowerCase();
  if (!query) {
    throw new Error("query is required");
  }
  const terms = query.split(/\s+/u).filter(Boolean);
  const limit = clampInteger(args.limit, 1, 30, DEFAULT_LIMIT);
  return {
    query,
    memoryDir: config.memoryDir,
    items: loadAllEntries(config.memoryDir)
      .map((entry) => ({ ...entry, score: scoreEntry(entry, terms) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || normalizeText(b.updatedAt || b.timestamp).localeCompare(normalizeText(a.updatedAt || a.timestamp)))
      .slice(0, limit)
      .map(({ score, searchableText, ...entry }) => ({ ...entry, score })),
  };
}

function rememberPrivate(args = {}, config = readConfig()) {
  const kind = normalizeKind(args.kind);
  if (kind === "relationship") {
    return rememberRelationship(args, config);
  }
  if (kind === "event") {
    return appendJsonl(config.memoryDir, "event_log.jsonl", buildEventEntry(args));
  }
  if (kind === "feel") {
    return appendJsonl(config.memoryDir, "feel.jsonl", buildFeelEntry(args));
  }
  throw new Error("kind must be relationship, event, or feel");
}

function rememberRelationship(args = {}, config = readConfig()) {
  const key = normalizeText(args.key);
  if (!key) {
    throw new Error("key is required for relationship memory");
  }
  fs.mkdirSync(config.memoryDir, { recursive: true });
  const filePath = path.join(config.memoryDir, "relationship_memory.json");
  const memory = readRelationshipMemory(filePath);
  const now = new Date().toISOString();
  const existingIndex = memory.items.findIndex((item) => normalizeText(item.key) === key);
  const next = {
    ...(existingIndex >= 0 ? memory.items[existingIndex] : {}),
    key,
    value: Object.prototype.hasOwnProperty.call(args, "value") ? args.value : normalizeText(args.text),
    confidence: clampNumber(args.confidence, 0, 1, 0.9),
    source: normalizeText(args.source) || "codex",
    updatedAt: now,
    sensitivity: normalizeText(args.sensitivity) || "low",
    tags: normalizeTextList(args.tags),
    importance: clampNumber(args.importance, 0, 1, 0.7),
    createdAt: existingIndex >= 0 ? memory.items[existingIndex].createdAt || now : now,
  };
  if (existingIndex >= 0) {
    memory.items[existingIndex] = next;
  } else {
    memory.items.push(next);
  }
  memory.version = memory.version || 1;
  memory.updatedAt = now;
  fs.writeFileSync(filePath, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
  return { ok: true, kind: "relationship", item: next };
}

function buildEventEntry(args = {}) {
  const text = normalizeText(args.text || args.rawText || args.summary);
  const summary = normalizeText(args.summary) || text;
  if (!text && !summary) {
    throw new Error("text or summary is required for event memory");
  }
  const now = new Date().toISOString();
  return {
    id: makeId("evt"),
    timestamp: now,
    source: normalizeText(args.source) || "codex",
    rawText: text || summary,
    summary,
    tags: normalizeTextList(args.tags),
    importance: clampNumber(args.importance, 0, 1, 0.7),
    metadata: normalizeRecord(args.metadata),
  };
}

function buildFeelEntry(args = {}) {
  const text = normalizeText(args.text || args.summary);
  if (!text) {
    throw new Error("text is required for feel memory");
  }
  const now = new Date().toISOString();
  return {
    id: makeId("feel"),
    timestamp: now,
    source: normalizeText(args.source) || "codex",
    text,
    tags: normalizeTextList(args.tags),
    importance: clampNumber(args.importance, 0, 1, 0.7),
    metadata: normalizeRecord(args.metadata),
  };
}

function appendJsonl(memoryDir, fileName, entry) {
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.appendFileSync(path.join(memoryDir, fileName), `${JSON.stringify(entry)}\n`, "utf8");
  return { ok: true, kind: fileName === "feel.jsonl" ? "feel" : "event", item: entry };
}

function loadAllEntries(memoryDir) {
  return [
    ...loadRelationshipEntries(memoryDir),
    ...loadJsonlEntries(path.join(memoryDir, "event_log.jsonl"), "event"),
    ...loadJsonlEntries(path.join(memoryDir, "feel.jsonl"), "feel"),
  ];
}

function loadRelationshipEntries(memoryDir) {
  const memory = readRelationshipMemory(path.join(memoryDir, "relationship_memory.json"));
  return memory.items.map((item) => ({
    type: "relationship",
    key: normalizeText(item.key),
    value: item.value,
    confidence: item.confidence,
    source: normalizeText(item.source),
    tags: normalizeTextList(item.tags),
    importance: clampNumber(item.importance, 0, 1, 0),
    createdAt: normalizeText(item.createdAt),
    updatedAt: normalizeText(item.updatedAt),
    searchableText: stringifyForSearch(item),
  }));
}

function loadJsonlEntries(filePath, type) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseJson(line, null))
    .filter(Boolean)
    .map((item) => ({
      type,
      id: normalizeText(item.id),
      timestamp: normalizeText(item.timestamp),
      source: normalizeText(item.source),
      text: normalizeText(item.text || item.rawText),
      summary: normalizeText(item.summary),
      tags: normalizeTextList(item.tags),
      importance: clampNumber(item.importance, 0, 1, 0),
      metadata: normalizeRecord(item.metadata),
      searchableText: stringifyForSearch(item),
    }));
}

function readRelationshipMemory(filePath) {
  const parsed = parseJson(fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "", {});
  return {
    version: Number.isInteger(parsed.version) ? parsed.version : 1,
    updatedAt: normalizeText(parsed.updatedAt),
    items: Array.isArray(parsed.items) ? parsed.items : [],
  };
}

function scoreEntry(entry, terms) {
  const haystack = normalizeText(entry.searchableText || stringifyForSearch(entry)).toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += 1;
    }
  }
  if (!score) {
    return 0;
  }
  return score + clampNumber(entry.importance, 0, 1, 0);
}

async function callTool(name, args, config) {
  if (name === "searchPrivateMemory") {
    return searchPrivateMemory(args, config);
  }
  if (name === "rememberPrivate") {
    return rememberPrivate(args, config);
  }
  throw new Error(`unknown tool: ${name}`);
}

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

async function handleMessage(msg, config) {
  const { id, method, params } = msg || {};
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "codex-private-memory", version: "1.0.0" },
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
        process.stderr.write(`[codex-private-memory-mcp] error: ${error.message}\n`);
      });
    } catch {
      process.stderr.write(`[codex-private-memory-mcp] invalid JSON: ${trimmed.slice(0, 100)}\n`);
    }
  });
  rl.on("close", () => process.exit(0));
}

function makeId(prefix) {
  return `${prefix}_${new Date().toISOString().replace(/[-:.TZ]/gu, "")}_${Math.random().toString(36).slice(2, 8)}`;
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

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stringifyForSearch(value) {
  return JSON.stringify(value ?? "");
}

function normalizeKind(value) {
  const normalized = normalizeText(value).toLowerCase();
  return ["relationship", "event", "feel"].includes(normalized) ? normalized : "event";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTextList(value) {
  return (Array.isArray(value) ? value : normalizeText(value).split(/[,\n]/u))
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function normalizeRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

if (require.main === module) {
  startServer();
}

module.exports = {
  readConfig,
  rememberPrivate,
  searchPrivateMemory,
};

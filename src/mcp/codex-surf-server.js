const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const DEFAULT_SMART_SEARCH_URL = "https://bmvqjocreprdzbkqtkih.supabase.co/functions/v1/smart-search";

const TOOLS = [
  {
    name: "smart_search",
    description: "Search the web and return a compressed AI summary plus source links. Use for broad research, news, and unfamiliar topics.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
      },
      required: ["query"],
    },
  },
];

function readConfig(argv = process.argv.slice(2), env = process.env) {
  const envFile = readArg(argv, "--env-file")
    || env.ROUNDTABLE_SURF_ENV_PATH || env.SMART_SEARCH_ENV_PATH;
  const fileEnv = readEnvFile(envFile);
  return {
    smartSearchUrl: normalizeText(
      readArg(argv, "--smart-search-url")
        || env.SMART_SEARCH_URL
        || fileEnv.SMART_SEARCH_URL
        || DEFAULT_SMART_SEARCH_URL
    ),
    authToken: normalizeText(
      readArg(argv, "--auth-token")
        || env.SMART_SEARCH_AUTH_TOKEN
        || env.SUPABASE_ANON_KEY
        || fileEnv.SMART_SEARCH_AUTH_TOKEN
        || fileEnv.SUPABASE_ANON_KEY
    ),
  };
}

async function smartSearch(args = {}, config = readConfig()) {
  const query = normalizeText(args.query);
  if (!query) {
    throw new Error("query is required");
  }
  const headers = {
    "Content-Type": "application/json",
  };
  if (config.authToken) {
    headers.Authorization = `Bearer ${config.authToken}`;
  }
  const response = await fetch(config.smartSearchUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });
  const rawText = await response.text();
  let body = {};
  try {
    body = rawText ? JSON.parse(rawText) : {};
  } catch {
    body = { text: rawText };
  }
  if (!response.ok) {
    throw new Error(`smart_search ${response.status}: ${JSON.stringify(body)}`);
  }
  const sources = Array.isArray(body.sources) ? body.sources : [];
  return {
    query,
    summary: normalizeText(body.summary || body.answer) || "(empty)",
    sources: sources.map((source) => ({
      title: normalizeText(source?.title),
      url: normalizeText(source?.url),
    })),
  };
}

async function callTool(name, args, config) {
  if (name === "smart_search") {
    return smartSearch(args, config);
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
        serverInfo: { name: "codex-surf", version: "1.0.0" },
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
        process.stderr.write(`[codex-surf-mcp] error: ${error.message}\n`);
      });
    } catch {
      process.stderr.write(`[codex-surf-mcp] invalid JSON: ${trimmed.slice(0, 100)}\n`);
    }
  });
  rl.on("close", () => process.exit(0));
}

function readEnvFile(filePath) {
  const env = {};
  const normalizedPath = normalizeText(filePath);
  if (!normalizedPath || !fs.existsSync(normalizedPath)) {
    return env;
  }
  const content = fs.readFileSync(normalizedPath, "utf8");
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue;
    env[key] = stripEnvQuotes(line.slice(index + 1).trim());
  }
  return env;
}

function stripEnvQuotes(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
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

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

if (require.main === module) {
  startServer();
}

module.exports = {
  readConfig,
  smartSearch,
};

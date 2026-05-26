const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildRoundtableMemoryMcpServerConfig } = require("../../../mcp/roundtable-memory-config");

function resolveCodexProjectToolMcpServerConfig({ cyberbossHome = "" } = {}) {
  const root = normalizeNonEmptyString(cyberbossHome)
    || path.resolve(__dirname, "..", "..", "..", "..");
  return [
    buildRoundtableMemoryMcpServerConfig({ actor: "codex" }),
    buildCodexPrivateMemoryMcpServerConfig({ root }),
    buildCodexSurfMcpServerConfig(),
    resolveExternalReachMcpServerConfig({ root }),
    resolveRhysenCommunityMcpServerConfig({ root }),
  ].filter(Boolean);
}

function buildCodexMcpConfigArgs(mcpServerConfig) {
  const configs = normalizeMcpServerConfigs(mcpServerConfig);
  if (!configs.length) {
    return [];
  }
  const configArgs = [];
  for (const serverConfig of configs) {
    const name = normalizeTomlKey(serverConfig.name) || "cyberboss_tools";
    const command = normalizeNonEmptyString(serverConfig.command);
    const url = normalizeNonEmptyString(serverConfig.url);
    const args = Array.isArray(serverConfig.args)
      ? serverConfig.args.map((value) => normalizeNonEmptyString(value)).filter(Boolean)
      : [];
    if (url) {
      configArgs.push(
        "-c",
        `mcp_servers.${name}.url=${quoteTomlString(url)}`
      );
    } else if (command) {
      configArgs.push(
        "-c",
        `mcp_servers.${name}.command=${quoteTomlString(command)}`,
        "-c",
        `mcp_servers.${name}.args=${formatTomlArray(args)}`,
      );
    } else {
      continue;
    }
    const bearerTokenEnvVar = normalizeEnvKey(serverConfig.bearerTokenEnvVar);
    if (url && bearerTokenEnvVar) {
      configArgs.push(
        "-c",
        `mcp_servers.${name}.bearer_token_env_var=${quoteTomlString(bearerTokenEnvVar)}`
      );
    }
    const env = serverConfig.env && typeof serverConfig.env === "object"
      ? serverConfig.env
      : {};
    for (const [key, value] of Object.entries(env)) {
      const envKey = normalizeEnvKey(key);
      if (!envKey) {
        continue;
      }
      configArgs.push(
        "-c",
        `mcp_servers.${name}.env.${envKey}=${quoteTomlString(value)}`
      );
    }
  }
  return configArgs;
}

function buildCodexSurfMcpServerConfig() {
  return {
    name: "codex_surf",
    command: process.execPath,
    args: [path.join(__dirname, "..", "..", "..", "mcp", "codex-surf-server.js")],
    env: process.env.ROUNDTABLE_SURF_ENV_PATH ? { ROUNDTABLE_SURF_ENV_PATH: process.env.ROUNDTABLE_SURF_ENV_PATH } : {},
  };
}

function buildCodexPrivateMemoryMcpServerConfig({ root = process.cwd() } = {}) {
  return {
    name: "codex_private_memory",
    command: process.execPath,
    args: [path.join(__dirname, "..", "..", "..", "mcp", "codex-private-memory-server.js")],
    env: {
      CODEX_PRIVATE_MEMORY_DIR: path.join(root, "codex-memory"),
    },
  };
}

function resolveExternalReachMcpServerConfig({ root = process.cwd() } = {}) {
  const configPath = resolveCodexMcpConfigPath({ root });
  const config = configPath ? readJsonObject(configPath) : {};
  const server = findMcpServer(config, "Roundtable Reach") || findMcpServer(config, "External Reach");
  if (server?.command) {
    return {
      name: "roundtable_reach",
      command: server.command,
      args: Array.isArray(server.args) ? server.args : [],
      env: server.env && typeof server.env === "object" ? server.env : {},
    };
  }
  const defaultScriptPath = normalizeNonEmptyString(process.env.ROUNDTABLE_REACH_MCP_SCRIPT);
  if (!fs.existsSync(defaultScriptPath)) {
    return null;
  }
  return {
    name: "roundtable_reach",
    command: resolvePythonCommand(),
    args: [defaultScriptPath],
  };
}

function resolveRhysenCommunityMcpServerConfig({ root = process.cwd() } = {}) {
  const configPath = resolveCodexMcpConfigPath({ root });
  const config = configPath ? readJsonObject(configPath) : {};
  const server = findMcpServer(config, "Rhysen Community");
  const url = normalizeNonEmptyString(server?.url);
  if (!url) {
    return null;
  }
  return {
    name: "rhysen_community",
    url,
    bearerTokenEnvVar: server?.bearerTokenEnvVar || server?.bearer_token_env_var,
  };
}

function resolveCodexMcpConfigPath({ root = process.cwd() } = {}) {
  const explicit = normalizeNonEmptyString(
    process.env.ROUNDTABLE_CODEX_MCP_CONFIG ||
      process.env.ROUNDTABLE_CODEX_MCP_CONFIG_PATH ||
      process.env.ROUNDTABLE_EXTERNAL_MCP_CONFIG ||
      process.env.ROUNDTABLE_EXTERNAL_MCP_CONFIG_PATH
  );
  if (explicit && fs.existsSync(expandHome(explicit))) {
    return expandHome(explicit);
  }
  const candidates = [path.join(root, ".mcp.json")];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function findMcpServer(config, serverName) {
  const servers = config?.mcpServers && typeof config.mcpServers === "object"
    ? config.mcpServers
    : {};
  return servers[serverName] && typeof servers[serverName] === "object"
    ? servers[serverName]
    : null;
}

function readJsonObject(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function resolvePythonCommand() {
  const candidate = path.join(os.homedir(), "AppData", "Local", "Python", "pythoncore-3.14-64", "python.exe");
  return fs.existsSync(candidate) ? candidate : "python";
}

function normalizeMcpServerConfigs(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item && typeof item === "object");
  }
  return value && typeof value === "object" ? [value] : [];
}

function quoteTomlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function formatTomlArray(values) {
  return `[${values.map((value) => quoteTomlString(value)).join(",")}]`;
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeTomlKey(value) {
  const normalized = normalizeNonEmptyString(value);
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(normalized) ? normalized : "";
}

function normalizeEnvKey(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(normalized) ? normalized : "";
}

function expandHome(value) {
  const normalized = normalizeNonEmptyString(value);
  if (normalized === "~") {
    return os.homedir();
  }
  if (normalized.startsWith("~/") || normalized.startsWith("~\\")) {
    return path.join(os.homedir(), normalized.slice(2));
  }
  return normalized;
}

module.exports = {
  buildCodexMcpConfigArgs,
  buildCodexPrivateMemoryMcpServerConfig,
  buildCodexSurfMcpServerConfig,
  resolveExternalReachMcpServerConfig,
  resolveCodexProjectToolMcpServerConfig,
  resolveRhysenCommunityMcpServerConfig,
};

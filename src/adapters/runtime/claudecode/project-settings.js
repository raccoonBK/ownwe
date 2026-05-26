const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildRoundtableMemoryMcpJson } = require("../../../mcp/roundtable-memory-config");

function ensureClaudeProjectMcpConfig({
  workspaceRoot,
  externalMcpConfigPath = "",
  stateDir = "",
  includeMemoryMcp = false,
} = {}) {
  const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    throw new Error("workspaceRoot is required to configure Claude project tools.");
  }

  const configPath = resolveClaudeMcpConfigPath({ externalMcpConfigPath });
  const memoryConfigPath = includeMemoryMcp
    ? writeRoundtableMemoryMcpConfig({ stateDir, actor: "claude" })
    : "";
  if (!configPath) {
    return {
      configPath: "",
      configPaths: [memoryConfigPath].filter(Boolean),
      serverName: memoryConfigPath ? "roundtable_memory" : "",
      config: {},
    };
  }

  const config = readJsonObject(configPath);
  const serverNames = [
    ...listMcpServerNames(config),
    ...(memoryConfigPath ? ["roundtable_memory"] : []),
  ];
  return {
    configPath,
    configPaths: [configPath, memoryConfigPath].filter(Boolean),
    serverName: serverNames.join(", "),
    config,
  };
}

function buildClaudeProjectMcpServerConfig({ externalMcpConfigPath = "" } = {}) {
  const configPath = resolveClaudeMcpConfigPath({ externalMcpConfigPath });
  if (!configPath) {
    return null;
  }
  return readJsonObject(configPath);
}

function resolveClaudeMcpConfigPath({ externalMcpConfigPath = "" } = {}) {
  const explicit = normalizeText(externalMcpConfigPath)
    || readFirstEnv(
      "ROUNDTABLE_CLAUDE_MCP_CONFIG",
      "ROUNDTABLE_CLAUDE_MCP_CONFIG_PATH",
      "ROUNDTABLE_EXTERNAL_MCP_CONFIG",
      "ROUNDTABLE_EXTERNAL_MCP_CONFIG_PATH",
    );
  if (explicit) {
    return requireExistingFile(path.resolve(expandHome(explicit)), "Claude MCP config");
  }

  const defaultCandidates = [
    path.join(os.homedir(), ".roundtable", "external_mcp.json"),
  ];
  return defaultCandidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function requireExistingFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
  return filePath;
}

function readJsonObject(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    throw new Error(`Failed to read Claude MCP config ${filePath}: ${error.message}`);
  }
  return {};
}

function listMcpServerNames(config) {
  const servers = config?.mcpServers && typeof config.mcpServers === "object"
    ? config.mcpServers
    : {};
  return Object.keys(servers).filter(Boolean);
}

function writeRoundtableMemoryMcpConfig({ stateDir = "", actor = "claude" } = {}) {
  const root = normalizeText(stateDir)
    || path.join(os.homedir(), ".cyberboss-roundtable");
  const configDir = path.join(root, "mcp");
  const configPath = path.join(configDir, `roundtable-memory-${actor}.json`);
  const config = buildRoundtableMemoryMcpJson({
    actor,
    port: process.env.ROUNDTABLE_PORT || "8797",
  });
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  return configPath;
}

function readFirstEnv(...names) {
  for (const name of names) {
    const value = normalizeText(process.env[name]);
    if (value) {
      return value;
    }
  }
  return "";
}

function expandHome(value) {
  const normalized = normalizeText(value);
  if (normalized === "~") {
    return os.homedir();
  }
  if (normalized.startsWith("~/") || normalized.startsWith("~\\")) {
    return path.join(os.homedir(), normalized.slice(2));
  }
  return normalized;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  ensureClaudeProjectMcpConfig,
  buildClaudeProjectMcpServerConfig,
  resolveClaudeMcpConfigPath,
  writeRoundtableMemoryMcpConfig,
};

const path = require("path");

function buildRoundtableMemoryMcpServerConfig({ actor, port = process.env.ROUNDTABLE_PORT || "8797" } = {}) {
  const normalizedActor = normalizeActor(actor);
  if (!normalizedActor) {
    return null;
  }
  return {
    name: "roundtable_memory",
    command: process.execPath,
    args: [path.join(__dirname, "roundtable-memory-server.js")],
    env: {
      ROUNDTABLE_MEMORY_ACTOR: normalizedActor,
      ROUNDTABLE_PORT: String(port || "8797"),
    },
  };
}

function buildRoundtableMemoryMcpJson({ actor, port } = {}) {
  const config = buildRoundtableMemoryMcpServerConfig({ actor, port });
  if (!config) {
    return { mcpServers: {} };
  }
  const { name, ...server } = config;
  return {
    mcpServers: {
      [name]: server,
    },
  };
}

function normalizeActor(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ["codex", "claude"].includes(normalized) ? normalized : "";
}

module.exports = {
  buildRoundtableMemoryMcpJson,
  buildRoundtableMemoryMcpServerConfig,
};

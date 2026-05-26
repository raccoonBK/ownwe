const path = require("path");
const os = require("os");
const { ClaudeCodeProcessClient } = require("./process-client");
const { mapClaudeCodeMessageToRuntimeEvent } = require("./events");
const { ensureClaudeProjectMcpConfig } = require("./project-settings");
const { SessionStore } = require("../codex/session-store");
const { buildOpeningTurnText, buildInstructionRefreshText } = require("../shared-instructions");
const { ClaudeCodeIpcServer } = require("./ipc-server");
const { getDb } = require("../../../db/connection");
const CLAUDE_RESUME_SESSION_TIMEOUT_MS = 8000;

function createClaudeCodeRuntimeAdapter(config) {
  const sessionStore = new SessionStore({
    db: getDb(config.dbPath),
    runtimeId: "claudecode",
  });
  const clientsByWorkspace = new Map();
  const pendingApprovals = new Map();
  let globalListener = null;
  const ipcSocketPath = path.join(
    config.stateDir || path.join(os.homedir(), ".cyberboss-roundtable"),
    "claudecode-runtime.sock",
  );
  const ipcServer = new ClaudeCodeIpcServer({ socketPath: ipcSocketPath });

  ipcServer.on("clientMessage", (msg) => {
    if (msg?.type === "sendUserMessage" && msg?.workspaceRoot) {
      const client = clientsByWorkspace.get(msg.workspaceRoot);
      if (client?.alive) {
        client.sendUserMessage({ text: msg.text || "" }).catch(() => {});
      }
    }
    if (msg?.type === "respondApproval" && msg?.workspaceRoot) {
      const client = clientsByWorkspace.get(msg.workspaceRoot);
      if (client?.alive) {
        client.sendResponse(msg.requestId, { decision: msg.decision }).catch(() => {});
      }
    }
  });

  function ensureClient(workspaceRoot) {
    if (clientsByWorkspace.has(workspaceRoot)) {
      return clientsByWorkspace.get(workspaceRoot);
    }
    const projectSettings = ensureClaudeProjectMcpConfig({
      workspaceRoot,
      stateDir: config.stateDir,
      includeMemoryMcp: true,
    });
    console.log(
      `[claudecode-runtime] workspace=${workspaceRoot} mcp_config=${projectSettings.configPath} server=${projectSettings.serverName}`
    );
    const client = new ClaudeCodeProcessClient({
      command: config.claudeCommand || "claude",
      cwd: workspaceRoot,
      env: filterClaudeCodeEnv(process.env),
      model: config.claudeModel || "",
      permissionMode: config.claudePermissionMode || "default",
      disableVerbose: Boolean(config.claudeDisableVerbose),
      extraArgs: config.claudeExtraArgs || [],
      mcpConfigPaths: Array.isArray(projectSettings.configPaths)
        ? projectSettings.configPaths
        : [projectSettings.configPath].filter(Boolean),
      ipcServer,
      workspaceRoot,
    });
    client.onMessage((event, raw) => {
      if (event.type === "session.id") {
        for (const binding of sessionStore.listBindings()) {
          if (binding.activeWorkspaceRoot === workspaceRoot) {
            const pendingThreadId = normalizeThreadId(
              sessionStore.getPendingThreadIdForWorkspace(binding.bindingKey, workspaceRoot)
            );
            if (pendingThreadId && pendingThreadId === normalizeThreadId(event.sessionId)) {
              sessionStore.setThreadIdForWorkspace(binding.bindingKey, workspaceRoot, event.sessionId);
              sessionStore.clearPendingThreadIdForWorkspace(binding.bindingKey, workspaceRoot);
            }
          }
        }
        return;
      }
      const mapped = mapClaudeCodeMessageToRuntimeEvent(event, raw);
      if (mapped?.payload && !mapped.payload.workspaceRoot) {
        mapped.payload.workspaceRoot = workspaceRoot;
      }
      if (mapped?.type === "runtime.approval.requested") {
        if (pendingApprovals.size >= 100) {
          const firstKey = pendingApprovals.keys().next().value;
          pendingApprovals.delete(firstKey);
        }
        pendingApprovals.set(mapped.payload.requestId, workspaceRoot);
      }
      if (mapped?.type === "runtime.turn.failed") {
        clientsByWorkspace.delete(workspaceRoot);
      }
      if (mapped && globalListener) {
        globalListener(mapped, raw);
      }
    });
    clientsByWorkspace.set(workspaceRoot, client);
    return client;
  }

  async function attachClientToThread(workspaceRoot, threadId = "") {
    const normalizedWorkspaceRoot = typeof workspaceRoot === "string" ? workspaceRoot.trim() : "";
    const normalizedThreadId = normalizeThreadId(threadId);
    if (!normalizedWorkspaceRoot) {
      throw new Error("workspaceRoot is required");
    }

    const existingClient = clientsByWorkspace.get(normalizedWorkspaceRoot);
    if (normalizedThreadId && clientMatchesThread(existingClient, normalizedThreadId)) {
      return { client: existingClient, threadId: normalizedThreadId };
    }

    if (!normalizedThreadId && existingClient?.alive) {
      await closeWorkspaceClient(normalizedWorkspaceRoot);
    }

    const client = ensureClient(normalizedWorkspaceRoot);
    if (!client.alive || (normalizedThreadId && !clientMatchesThread(client, normalizedThreadId))) {
      if (client.alive && normalizedThreadId && !clientMatchesThread(client, normalizedThreadId)) {
        await closeWorkspaceClient(normalizedWorkspaceRoot);
      }
      const freshClient = ensureClient(normalizedWorkspaceRoot);
      await freshClient.connect(normalizedThreadId);
      if (normalizedThreadId) {
        return { client: freshClient, threadId: normalizedThreadId };
      }
      return { client: freshClient, threadId: freshClient.sessionId || normalizedThreadId };
    }

    return { client, threadId: client.sessionId || normalizedThreadId };
  }
  async function closeWorkspaceClient(workspaceRoot) {
    const normalizedWorkspaceRoot = typeof workspaceRoot === "string" ? workspaceRoot.trim() : "";
    if (!normalizedWorkspaceRoot) {
      return;
    }
    const client = clientsByWorkspace.get(normalizedWorkspaceRoot);
    if (!client) {
      return;
    }
    await client.close();
    clientsByWorkspace.delete(normalizedWorkspaceRoot);
    for (const [requestId, candidateWorkspaceRoot] of pendingApprovals.entries()) {
      if (candidateWorkspaceRoot === normalizedWorkspaceRoot) {
        pendingApprovals.delete(requestId);
      }
    }
  }
  return {
    describe() {
      return {
        id: "claudecode",
        kind: "runtime",
        command: config.claudeCommand || "claude",
        sessionsDbPath: config.dbPath,
        ipcSocketPath,
      };
    },
    onEvent(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }
      globalListener = listener;
      return () => {
        if (globalListener === listener) {
          globalListener = null;
        }
      };
    },
    getSessionStore() {
      return sessionStore;
    },
    async initialize() {
      await ipcServer.start();
      return {
        command: config.claudeCommand || "claude",
        models: [],
      };
    },
    async close() {
      for (const client of clientsByWorkspace.values()) {
        await client.close();
      }
      clientsByWorkspace.clear();
      await ipcServer.close();
    },
    async startFreshThreadDraft({ workspaceRoot }) {
      for (const binding of sessionStore.listBindings()) {
        if (binding.activeWorkspaceRoot === workspaceRoot) {
          sessionStore.clearPendingThreadIdForWorkspace(binding.bindingKey, workspaceRoot);
        }
      }
      await closeWorkspaceClient(workspaceRoot);
      return { workspaceRoot };
    },
    async respondApproval({ requestId, decision, result = null }) {
      const workspaceRoot = pendingApprovals.get(requestId);
      const candidates = workspaceRoot
        ? [clientsByWorkspace.get(workspaceRoot)]
        : [...clientsByWorkspace.values()];
      for (const client of candidates) {
        if (client?.alive) {
          const responsePayload = result && typeof result === "object"
            ? result
            : { decision };
          await client.sendResponse(requestId, responsePayload);
          pendingApprovals.delete(requestId);
          return {
            requestId,
            ...(result && typeof result === "object"
              ? { result: responsePayload }
              : { decision: decision === "accept" ? "accept" : "decline" }),
          };
        }
      }
      throw new Error("no active claudecode session to respond to approval");
    },
    async cancelTurn({ threadId, turnId, workspaceRoot }) {
      if (workspaceRoot) {
        await closeWorkspaceClient(workspaceRoot);
        return { threadId, turnId };
      }
      for (const [workspaceRoot, client] of clientsByWorkspace.entries()) {
        if (client.sessionId === threadId) {
          await client.close();
          clientsByWorkspace.delete(workspaceRoot);
          return { threadId, turnId };
        }
      }
      return { threadId, turnId };
    },
    async resumeThread({ threadId, workspaceRoot }) {
      if (!workspaceRoot) {
        return { threadId };
      }
      const attached = await attachClientToThread(workspaceRoot, threadId);
      return { threadId: attached.threadId };
    },
    async compactThread({ threadId, workspaceRoot }) {
      const { client, threadId: activeThreadId } = await attachClientToThread(workspaceRoot, threadId);
      const sent = await client.sendUserMessage({ text: "/compact", threadId: activeThreadId });
      return { threadId: activeThreadId, turnId: sent.turnId };
    },
    async refreshThreadInstructions({ threadId, workspaceRoot, model = "" }) {
      const { client, threadId: activeThreadId } = await attachClientToThread(workspaceRoot, threadId);
      const refreshText = buildInstructionRefreshText(config);
      await client.sendUserMessage({ text: refreshText, threadId: activeThreadId });
      return { threadId: activeThreadId };
    },
    async sendTextTurn({ bindingKey, workspaceRoot, text, attachments = [], metadata = {}, model = "", allowCreateThread = true, onTurnStarted = null }) {
      let threadId = sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
      if (threadId && !isValidClaudeSessionId(threadId)) {
        console.log(`[claudecode-runtime] clearing invalid saved session binding=${bindingKey} thread=${threadId}`);
        sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
        sessionStore.clearPendingThreadIdForWorkspace(bindingKey, workspaceRoot);
        threadId = "";
      }
      if (!threadId) {
        if (!allowCreateThread) {
          throw new Error(`no saved Claude Code session for binding: ${bindingKey}`);
        }
        sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
      }
      let openingTurn = !threadId;
      let attached;
      try {
        attached = await attachClientToThread(workspaceRoot, threadId);
      } catch (error) {
        if (!threadId) {
          throw error;
        }
        if (!allowCreateThread) {
          throw new Error(`saved Claude Code session could not be resumed: ${formatError(error)}`);
        }
        sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
        sessionStore.clearPendingThreadIdForWorkspace(bindingKey, workspaceRoot);
        threadId = "";
        openingTurn = true;
        attached = await attachClientToThread(workspaceRoot, "");
      }
      const { client, threadId: activeThreadId } = attached;
      const outboundText = openingTurn ? buildOpeningTurnText(config, text) : text;
      const outboundThreadId = activeThreadId || threadId || `pending-${Date.now()}`;
      const sent = await client.sendUserMessage({
        text: outboundText,
        attachments,
        threadId: outboundThreadId,
        onTurnStarted,
      });
      let canonicalThreadId = outboundThreadId;
      const confirmedSessionId = normalizeThreadId(
        client.sessionId || await client.waitForSessionId({ timeoutMs: CLAUDE_RESUME_SESSION_TIMEOUT_MS }).catch(() => "")
      );
      if (!openingTurn) {
        if (confirmedSessionId !== normalizeThreadId(outboundThreadId)) {
          console.log(
            `[claudecode-runtime] accepted unexpected session binding=${bindingKey} expected=${outboundThreadId} actual=${confirmedSessionId || "(empty)"}`
          );
        }
      }
      if (confirmedSessionId) {
        canonicalThreadId = confirmedSessionId;
      }
      sessionStore.setThreadIdForWorkspace(
        bindingKey,
        workspaceRoot,
        canonicalThreadId,
        metadata,
      );
      return {
        threadId: canonicalThreadId,
        turnId: sent.turnId,
      };
    },
  };
}

function filterClaudeCodeEnv(env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (key !== "CLAUDECODE") {
      out[key] = value;
    }
  }
  return out;
}

module.exports = { createClaudeCodeRuntimeAdapter };

function formatError(error) {
  if (!error) {
    return "";
  }
  return error.stack || error.message || String(error);
}

function normalizeThreadId(value) {
  return typeof value === "string" ? value.replace(/\s+/g, "").trim() : "";
}

function isValidClaudeSessionId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(normalizeThreadId(value));
}

function clientMatchesThread(client, threadId) {
  const normalizedThreadId = normalizeThreadId(threadId);
  if (!normalizedThreadId || !client?.alive) {
    return false;
  }
  return normalizeThreadId(client.sessionId) === normalizedThreadId
    || normalizeThreadId(client.resumeSessionId) === normalizedThreadId;
}

const https = require("https");
const { randomUUID } = require("crypto");
const { SessionStore } = require("../runtime/codex/session-store");
const { getDb } = require("../../db/connection");

const PROVIDER_CONFIGS = {
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    path: "/v1/messages",
    defaultModel: "claude-sonnet-4-6",
  },
  openai: {
    baseUrl: "https://api.openai.com",
    path: "/v1/chat/completions",
    defaultModel: "o3",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    path: "/v1/chat/completions",
    defaultModel: "deepseek-chat",
  },
  kimi: {
    baseUrl: "https://api.moonshot.cn",
    path: "/v1/chat/completions",
    defaultModel: "moonshot-v1-8k",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com",
    path: "/v1beta/openai/chat/completions",
    defaultModel: "gemini-2.5-pro",
  },
};

function createApiAgentAdapter(config) {
  const runtimeId = `api-${config.speakerId || "agent"}`;
  const sessionStore = new SessionStore({
    db: getDb(config.dbPath),
    runtimeId,
  });

  // conversation history keyed by threadId
  const historyByThread = new Map();
  let globalListener = null;

  function emit(event) {
    if (globalListener) {
      globalListener(event, null);
    }
  }

  function getHistory(threadId) {
    if (!historyByThread.has(threadId)) {
      historyByThread.set(threadId, []);
    }
    return historyByThread.get(threadId);
  }

  function appendHistory(threadId, role, content) {
    getHistory(threadId).push({ role, content });
  }

  async function callApi({ provider, apiKey, baseUrl, model, messages, systemPrompt }) {
    const providerCfg = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.openai;
    const resolvedBase = baseUrl || providerCfg.baseUrl;
    const resolvedModel = model || providerCfg.defaultModel;

    if (provider === "anthropic") {
      return callAnthropicMessages({ apiKey, baseUrl: resolvedBase, model: resolvedModel, messages, systemPrompt });
    }
    return callOpenAICompat({ apiKey, baseUrl: resolvedBase, path: providerCfg.path, model: resolvedModel, messages, systemPrompt });
  }

  async function sendTextTurn({ bindingKey, workspaceRoot, text, attachments = [], metadata = {}, model = "", allowCreateThread = true, onTurnStarted = null }) {
    const provider = config.provider || "anthropic";
    const apiKey = config.apiKey || "";
    const resolvedModel = model || config.model || PROVIDER_CONFIGS[provider]?.defaultModel || "";

    if (!apiKey) {
      throw new Error(`[api-agent] no API key configured for provider=${provider} speaker=${config.speakerId}`);
    }

    let threadId = sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
    if (!threadId) {
      if (!allowCreateThread) {
        throw new Error(`no saved thread for binding: ${bindingKey}`);
      }
      threadId = `api-${randomUUID()}`;
      sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, metadata);
    }

    const turnId = randomUUID();

    emit({ type: "runtime.turn.started", payload: { threadId, turnId } });
    if (onTurnStarted) {
      try { onTurnStarted({ threadId, turnId }); } catch {}
    }

    const systemPrompt = buildSystemPrompt(config);

    // include opening instructions on first message
    const isFirstTurn = getHistory(threadId).length === 0;
    const outboundText = isFirstTurn && systemPrompt ? text : text;
    appendHistory(threadId, "user", outboundText);

    let replyText = "";
    try {
      replyText = await callApi({
        provider,
        apiKey,
        baseUrl: config.baseUrl || "",
        model: resolvedModel,
        messages: getHistory(threadId),
        systemPrompt: isFirstTurn ? systemPrompt : "",
      });
    } catch (error) {
      emit({
        type: "runtime.turn.failed",
        payload: { threadId, turnId, error: error.message || String(error) },
      });
      throw error;
    }

    appendHistory(threadId, "assistant", replyText);

    emit({
      type: "runtime.reply.completed",
      payload: { threadId, turnId, itemId: `item-${turnId}`, text: replyText },
    });
    emit({
      type: "runtime.turn.completed",
      payload: { threadId, turnId, text: replyText },
    });

    return { threadId, turnId };
  }

  return {
    describe() {
      return {
        id: runtimeId,
        kind: "api",
        provider: config.provider || "anthropic",
        model: config.model || "",
        speakerId: config.speakerId || "",
      };
    },

    onEvent(listener) {
      if (typeof listener !== "function") return () => {};
      globalListener = listener;
      return () => { if (globalListener === listener) globalListener = null; };
    },

    getSessionStore() {
      return sessionStore;
    },

    async initialize() {
      return { provider: config.provider, model: config.model };
    },

    async close() {
      historyByThread.clear();
    },

    async startFreshThreadDraft({ workspaceRoot }) {
      for (const binding of sessionStore.listBindings()) {
        if (binding.activeWorkspaceRoot === workspaceRoot) {
          const threadId = sessionStore.getThreadIdForWorkspace(binding.bindingKey, workspaceRoot);
          if (threadId) {
            historyByThread.delete(threadId);
            sessionStore.clearThreadIdForWorkspace(binding.bindingKey, workspaceRoot);
          }
        }
      }
      return { workspaceRoot };
    },

    async respondApproval({ requestId, decision }) {
      return { requestId, decision };
    },

    async cancelTurn({ threadId, turnId }) {
      return { threadId, turnId };
    },

    async resumeThread({ threadId }) {
      return { threadId };
    },

    async compactThread({ threadId }) {
      // Keep only last 10 messages to reduce context
      const history = historyByThread.get(threadId);
      if (history && history.length > 10) {
        historyByThread.set(threadId, history.slice(-10));
      }
      return { threadId };
    },

    async refreshThreadInstructions({ threadId }) {
      return { threadId };
    },

    sendTextTurn,
  };
}

function buildSystemPrompt(config) {
  const fs = require("fs");
  const filePath = config.weixinInstructionsFile || "";
  if (!filePath) return "";
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

function callAnthropicMessages({ apiKey, baseUrl, model, messages, systemPrompt }) {
  const anthropicMessages = messages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || ""),
  }));

  const body = JSON.stringify({
    model,
    max_tokens: 4096,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: anthropicMessages,
  });

  const url = new URL(`${baseUrl}/v1/messages`);
  return httpPost(url, body, {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  }, (parsed) => {
    const content = parsed?.content;
    if (!Array.isArray(content)) return "";
    return content
      .filter((c) => c?.type === "text")
      .map((c) => c.text || "")
      .join("");
  });
}

function callOpenAICompat({ apiKey, baseUrl, path, model, messages, systemPrompt }) {
  const allMessages = [];
  if (systemPrompt) {
    allMessages.push({ role: "system", content: systemPrompt });
  }
  for (const m of messages) {
    allMessages.push({ role: m.role, content: String(m.content || "") });
  }

  const body = JSON.stringify({
    model,
    max_tokens: 4096,
    messages: allMessages,
  });

  const url = new URL(`${baseUrl}${path}`);
  return httpPost(url, body, {
    "Authorization": `Bearer ${apiKey}`,
    "content-type": "application/json",
  }, (parsed) => {
    if (parsed?.error) {
      throw new Error(parsed.error.message || JSON.stringify(parsed.error));
    }
    return parsed?.choices?.[0]?.message?.content || "";
  });
}

function httpPost(url, body, headers, parseResponse) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        ...headers,
        "content-length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(raw || "{}");
          const text = parseResponse(parsed);
          resolve(typeof text === "string" ? text.trim() : "");
        } catch (err) {
          reject(new Error(`API response error: ${err.message}\nBody: ${raw.slice(0, 500)}`));
        }
      });
    });

    req.on("error", (err) => reject(new Error(`API request failed: ${err.message}`)));
    req.write(body);
    req.end();
  });
}

module.exports = { createApiAgentAdapter, PROVIDER_CONFIGS };

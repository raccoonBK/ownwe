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
    let provider = config.provider || "anthropic";
    let apiKey = config.apiKey || "";
    let resolvedModel = model || config.model || "";

    // OwnWe: if a character is bound to this topic+speaker, use ITS provider/key/model.
    const charOverride = resolveCharacterProvider(config.dbPath, bindingKey);
    if (charOverride) {
      provider = charOverride.provider;
      apiKey = charOverride.apiKey;
      if (charOverride.model) resolvedModel = charOverride.model;
    }
    if (!resolvedModel) resolvedModel = PROVIDER_CONFIGS[provider]?.defaultModel || "";

    if (!apiKey) {
      throw new Error(`[api-agent] no API key for provider=${provider} (角色没配 key，且环境里也没有对应的 ${provider.toUpperCase()}_API_KEY)`);
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
        baseUrl: charOverride ? "" : (config.baseUrl || ""),
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

// OwnWe: resolve the bound character's provider/key/model for this turn.
// bindingKey looks like "roundtable:<topicId>:<speaker>" (or "roundtable:<speaker>").
function resolveCharacterProvider(dbPath, bindingKey) {
  try {
    if (!dbPath || !bindingKey) return null;
    const parts = String(bindingKey).split(":");
    let topicId = "";
    let speaker = "";
    if (parts.length >= 3) { topicId = parts[1]; speaker = parts[2]; }
    else return null;
    if (!topicId || !speaker) return null;
    const db = getDb(dbPath);
    const binding = db.prepare(
      "SELECT character_id FROM ownwe_character_bindings WHERE topic_id = ? AND speaker = ?"
    ).get(topicId, speaker);
    if (!binding?.character_id) return null;
    const ch = db.prepare(
      "SELECT provider, model, api_key_override FROM ownwe_characters WHERE id = ?"
    ).get(binding.character_id);
    if (!ch) return null;
    const provider = ch.provider || "anthropic";
    const apiKey = (ch.api_key_override && ch.api_key_override.trim()) || envKeyForProvider(provider);
    if (!apiKey) return null;
    return { provider, apiKey, model: (ch.model || "").trim() };
  } catch {
    return null;
  }
}

function envKeyForProvider(provider) {
  switch (provider) {
    case "anthropic": return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "";
    case "deepseek": return process.env.DEEPSEEK_API_KEY || "";
    case "openai": return process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || "";
    case "gemini": return process.env.GEMINI_API_KEY || "";
    case "kimi": return process.env.KIMI_API_KEY || "";
    default: return "";
  }
}

module.exports = { createApiAgentAdapter, PROVIDER_CONFIGS };

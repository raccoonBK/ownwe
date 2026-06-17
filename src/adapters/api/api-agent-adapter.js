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

// Cost tiers per provider: cheap for everyday chat (mode B), strong for tool/complex (mode A).
// Used only when a character has no explicit model set.
const MODEL_TIERS = {
  anthropic: { cheap: "claude-haiku-4-5", strong: "claude-sonnet-4-6" },
  deepseek: { cheap: "deepseek-chat", strong: "deepseek-reasoner" },
  openai: { cheap: "gpt-4o-mini", strong: "gpt-4o" },
  gemini: { cheap: "gemini-2.0-flash", strong: "gemini-2.5-pro" },
  kimi: { cheap: "moonshot-v1-8k", strong: "moonshot-v1-32k" },
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

  async function callApi({ provider, apiKey, baseUrl, model, messages, systemPrompt, images = [] }) {
    const providerCfg = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.openai;
    const resolvedBase = baseUrl || providerCfg.baseUrl;
    const resolvedModel = model || providerCfg.defaultModel;

    if (provider === "anthropic") {
      return callAnthropicMessages({ apiKey, baseUrl: resolvedBase, model: resolvedModel, messages, systemPrompt, images });
    }
    return callOpenAICompat({ apiKey, baseUrl: resolvedBase, path: providerCfg.path, model: resolvedModel, messages, systemPrompt, images });
  }

  async function sendTextTurn({ bindingKey, workspaceRoot, text, attachments = [], images = [], metadata = {}, model = "", allowCreateThread = true, onTurnStarted = null, ownweMode = "B" }) {
    let provider = config.provider || "anthropic";
    let apiKey = config.apiKey || "";
    let explicitModel = model || config.model || "";

    // OwnWe: if a character is bound to this topic+speaker, use ITS provider/key/model.
    const charOverride = resolveCharacterProvider(config.dbPath, bindingKey);
    if (charOverride) {
      provider = charOverride.provider;
      apiKey = charOverride.apiKey;
      if (charOverride.model) explicitModel = charOverride.model;
    }

    // Model tier: with "deep thinking" on (default) the character uses the stronger/
    // reasoning model even for casual chat. With it off, cost-aware A/B auto-switch
    // (cheap for companion turns, strong for tool/complex).
    let resolvedModel = explicitModel;
    if (!resolvedModel) {
      const tier = MODEL_TIERS[provider];
      if (tier) {
        const deepThinking = charOverride ? charOverride.deepThinking !== false : true;
        const wantStrong = deepThinking || ownweMode === "A";
        resolvedModel = wantStrong ? tier.strong : tier.cheap;
      }
    }
    if (!resolvedModel) resolvedModel = PROVIDER_CONFIGS[provider]?.defaultModel || "";

    // Vision: if the user attached images, route this turn to a vision-capable model.
    // Prefer Kimi (per design), then Gemini / Claude / GPT-4o, whichever has a key.
    const hasImages = Array.isArray(images) && images.length > 0;
    if (hasImages) {
      const v = pickVisionTarget(provider, apiKey);
      if (v) { provider = v.provider; apiKey = v.apiKey; resolvedModel = v.model; }
    }

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
        baseUrl: (charOverride || hasImages) ? "" : (config.baseUrl || ""),
        model: resolvedModel,
        messages: getHistory(threadId),
        systemPrompt: isFirstTurn ? systemPrompt : "",
        images: hasImages ? images : [],
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

function callAnthropicMessages({ apiKey, baseUrl, model, messages, systemPrompt, images = [] }) {
  const anthropicMessages = messages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || ""),
  }));
  // attach images to the final user message
  if (images.length && anthropicMessages.length) {
    const lastIdx = anthropicMessages.length - 1;
    const blocks = [{ type: "text", text: String(anthropicMessages[lastIdx].content || "") }];
    for (const url of images) {
      const parsed = parseDataUrl(url);
      if (parsed) blocks.push({ type: "image", source: { type: "base64", media_type: parsed.mediaType, data: parsed.data } });
    }
    anthropicMessages[lastIdx] = { role: "user", content: blocks };
  }

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

function callOpenAICompat({ apiKey, baseUrl, path, model, messages, systemPrompt, images = [] }) {
  const allMessages = [];
  if (systemPrompt) {
    allMessages.push({ role: "system", content: systemPrompt });
  }
  for (const m of messages) {
    allMessages.push({ role: m.role, content: String(m.content || "") });
  }
  // attach images to the final user message (OpenAI / Kimi / Gemini vision format)
  if (images.length && allMessages.length) {
    const lastIdx = allMessages.length - 1;
    const parts = [{ type: "text", text: String(allMessages[lastIdx].content || "") }];
    for (const url of images) {
      parts.push({ type: "image_url", image_url: { url } });
    }
    allMessages[lastIdx] = { role: "user", content: parts };
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

// Hard ceiling on a single LLM call. Without this, an unresponsive provider
// leaves the request (and the character's "正在输入…") hanging forever — the
// "尤金卡住了一直无法回复" symptom. 90s is generous even for reasoning models.
const API_TIMEOUT_MS = Number(process.env.OWNWE_API_TIMEOUT_MS || 90_000);

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
      timeout: API_TIMEOUT_MS,
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

    // Fires when the socket idles past `timeout` — we must destroy it ourselves.
    req.on("timeout", () => {
      req.destroy(new Error(`API request timed out after ${API_TIMEOUT_MS}ms`));
    });
    req.on("error", (err) => reject(new Error(`API request failed: ${err.message}`)));
    req.write(body);
    req.end();
  });
}

// Module-level single call (no closure deps) so other OwnWe modules — group chat,
// moment reactions — can drive a character's own provider directly.
async function callCharacterApi({ provider, apiKey, baseUrl = "", model, messages, systemPrompt = "", images = [] }) {
  const providerCfg = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.openai;
  const resolvedBase = baseUrl || providerCfg.baseUrl;
  const resolvedModel = model || providerCfg.defaultModel;
  if (provider === "anthropic") {
    return callAnthropicMessages({ apiKey, baseUrl: resolvedBase, model: resolvedModel, messages, systemPrompt, images });
  }
  return callOpenAICompat({ apiKey, baseUrl: resolvedBase, path: providerCfg.path, model: resolvedModel, messages, systemPrompt, images });
}

// One-stop: resolve a character's provider/key/model (incl. deep-thinking tier and
// image-vision routing) and produce a single reply. Used by the group-chat engine.
async function generateCharacterReply({ dbPath, charId, systemPrompt = "", messages = [], images = [], ownweMode = "B" }) {
  const ch = getDb(dbPath).prepare(
    "SELECT provider, model, api_key_override, deep_thinking FROM ownwe_characters WHERE id = ?"
  ).get(charId);
  if (!ch) throw new Error("character not found: " + charId);
  let provider = ch.provider || "anthropic";
  let apiKey = (ch.api_key_override && ch.api_key_override.trim()) || envKeyForProvider(provider);
  let model = (ch.model || "").trim();
  if (!model) {
    const tier = MODEL_TIERS[provider];
    if (tier) {
      const deepThinking = ch.deep_thinking !== 0;
      model = (deepThinking || ownweMode === "A") ? tier.strong : tier.cheap;
    }
  }
  if (!model) model = PROVIDER_CONFIGS[provider]?.defaultModel || "";
  const hasImages = Array.isArray(images) && images.length > 0;
  if (hasImages) {
    const v = pickVisionTarget(provider, apiKey);
    if (v) { provider = v.provider; apiKey = v.apiKey; model = v.model; }
  }
  if (!apiKey) {
    throw new Error(`[ownwe-group] no API key for provider=${provider}（角色没配 key，环境也没有 ${provider.toUpperCase()}_API_KEY）`);
  }
  return callCharacterApi({ provider, apiKey, model, messages, systemPrompt, images: hasImages ? images : [] });
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
      "SELECT provider, model, api_key_override, deep_thinking FROM ownwe_characters WHERE id = ?"
    ).get(binding.character_id);
    if (!ch) return null;
    const provider = ch.provider || "anthropic";
    const apiKey = (ch.api_key_override && ch.api_key_override.trim()) || envKeyForProvider(provider);
    if (!apiKey) return null;
    return { provider, apiKey, model: (ch.model || "").trim(), deepThinking: ch.deep_thinking !== 0 };
  } catch {
    return null;
  }
}

// Pick a vision-capable provider/model/key for an image turn. Prefer Kimi.
function pickVisionTarget(curProvider, curApiKey) {
  if (process.env.KIMI_API_KEY) {
    return { provider: "kimi", apiKey: process.env.KIMI_API_KEY, model: "moonshot-v1-8k-vision-preview" };
  }
  // if the character's own provider already does vision, keep it
  if (curApiKey && (curProvider === "gemini" || curProvider === "anthropic" || curProvider === "openai")) {
    const m = { gemini: "gemini-2.5-pro", anthropic: "claude-sonnet-4-6", openai: "gpt-4o" }[curProvider];
    return { provider: curProvider, apiKey: curApiKey, model: m };
  }
  // otherwise fall back to whatever vision-capable key exists in the environment
  if (process.env.GEMINI_API_KEY) return { provider: "gemini", apiKey: process.env.GEMINI_API_KEY, model: "gemini-2.5-pro" };
  if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY) {
    return { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY, model: "claude-sonnet-4-6" };
  }
  if (process.env.OPENAI_API_KEY) return { provider: "openai", apiKey: process.env.OPENAI_API_KEY, model: "gpt-4o" };
  return null;
}

// Parse "data:image/png;base64,XXXX" → { mediaType, data }.
function parseDataUrl(url) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(String(url || ""));
  if (!m) return null;
  return { mediaType: m[1], data: m[2] };
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

module.exports = {
  createApiAgentAdapter,
  PROVIDER_CONFIGS,
  callCharacterApi,
  generateCharacterReply,
  envKeyForProvider,
};

const DEFAULT_SUMMARY_LIMIT = 3;
const DEFAULT_MESSAGE_LIMIT = 3;
const DEFAULT_CONTEXT_SIZE = 3;
const DEFAULT_TOTAL_LIMIT = 6;
const OWNER_SCOPES = ["main", "philosophy", "alone", "temporary", "project", "codex", "claude"];
const PUBLIC_SCOPES = ["main", "philosophy", "alone", "temporary", "project"];
const ACTOR_PRIVATE_SCOPES = {
  codex: "codex",
  claude: "claude",
};

async function searchMemoryWithClient({
  query = "",
  scope = "global",
  project = "",
  limit = DEFAULT_TOTAL_LIMIT,
  context = DEFAULT_CONTEXT_SIZE,
  actor = "owner",
  searchSummaries,
  searchMessages,
} = {}) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    throw new Error("query is required");
  }
  if (typeof searchSummaries !== "function" || typeof searchMessages !== "function") {
    throw new Error("searchMemory requires summary and message search functions");
  }
  const requestedScope = normalizeScope(scope) || "global";
  const requestedProject = normalizeText(project);
  const maxItems = clampInteger(limit, 1, 20, DEFAULT_TOTAL_LIMIT);
  const summaryLimit = Math.min(DEFAULT_SUMMARY_LIMIT, maxItems);
  const messageLimit = Math.min(DEFAULT_MESSAGE_LIMIT, Math.max(0, maxItems - summaryLimit));
  const contextSize = clampInteger(context, 0, 10, DEFAULT_CONTEXT_SIZE);
  const normalizedActor = normalizeActor(actor);
  const scopes = expandAllowedScopes({ actor: normalizedActor, scope: requestedScope });
  const entries = [];
  const deniedScopes = scopes.length ? [] : [requestedScope];

  for (const searchScope of scopes) {
    const searchProject = searchScope === "project" && requestedScope === "project"
      ? requestedProject
      : "";
    const summaries = await searchSummaries({
      scope: searchScope,
      query: normalizedQuery,
      project: searchProject,
      limit: summaryLimit,
    });
    const summaryItems = Array.isArray(summaries?.items) ? summaries.items : [];
    for (const item of summaryItems.slice(0, summaryLimit)) {
      entries.push(formatSummaryItem(item, { scope: searchScope }));
    }
    if (messageLimit <= 0) {
      continue;
    }
    const messages = await searchMessages({
      scope: searchScope,
      query: normalizedQuery,
      project: searchProject,
      limit: messageLimit,
      context: contextSize,
    });
    for (const item of (Array.isArray(messages?.items) ? messages.items : []).slice(0, messageLimit)) {
      entries.push(formatMessageItem(item, { scope: searchScope }));
    }
    if (dedupeMemoryItems(entries).length >= maxItems && requestedScope !== "global") {
      break;
    }
  }

  return {
    actor: normalizedActor,
    query: normalizedQuery,
    requestedScope,
    searchedScopes: scopes,
    deniedScopes,
    items: rankMemoryItems(dedupeMemoryItems(entries)).slice(0, maxItems),
  };
}

function expandAllowedScopes({ actor = "owner", scope = "global" } = {}) {
  const normalizedActor = normalizeActor(actor);
  const normalizedScope = normalizeScope(scope) || "global";
  if (normalizedActor === "owner") {
    return normalizedScope === "global" ? [...OWNER_SCOPES] : [normalizedScope];
  }
  const ownPrivateScope = ACTOR_PRIVATE_SCOPES[normalizedActor];
  if (normalizedScope === "global") {
    return [...PUBLIC_SCOPES, ownPrivateScope].filter(Boolean);
  }
  if (PUBLIC_SCOPES.includes(normalizedScope) || normalizedScope === ownPrivateScope) {
    return [normalizedScope];
  }
  return [];
}

function formatSummaryItem(item, { scope }) {
  return {
    type: "summary",
    source: formatSource(item, scope),
    createdAt: normalizeText(item.createdAt),
    text: normalizeText(item.summaryText || item.summary),
    matchType: normalizeText(item.matchType),
    score: typeof item.score === "number" ? item.score : undefined,
    semanticScore: typeof item.semanticScore === "number" ? item.semanticScore : undefined,
    decisions: Array.isArray(item.decisions) ? item.decisions.map(normalizeText).filter(Boolean) : [],
    openItems: Array.isArray(item.openItems || item.next)
      ? (item.openItems || item.next).map(normalizeText).filter(Boolean)
      : [],
  };
}

function formatMessageItem(item, { scope }) {
  const matchMessage = item?.matchMessage || {};
  return {
    type: "message",
    source: formatSource(item, scope),
    createdAt: normalizeText(matchMessage.at),
    matchMessage: normalizeMessage(matchMessage),
    speaker: normalizeText(matchMessage.speaker),
    text: normalizeText(matchMessage.text),
    contextBefore: normalizeMessageContext(item.contextBefore),
    contextAfter: normalizeMessageContext(item.contextAfter),
  };
}

function formatSource(item, scope) {
  return {
    scope,
    topicId: normalizeText(item.topicId),
    topicTitle: normalizeText(item.topicTitle),
    container: item.container && typeof item.container === "object" ? item.container : {},
  };
}

function normalizeMessageContext(value) {
  return (Array.isArray(value) ? value : [])
    .map(normalizeMessage)
    .filter((message) => message.text);
}

function normalizeMessage(message = {}) {
  return {
    id: normalizeText(message?.id),
    speaker: normalizeText(message?.speaker),
    text: normalizeText(message?.text),
    at: normalizeText(message?.at),
  };
}

function dedupeMemoryItems(items) {
  const seen = new Set();
  const unique = [];
  for (const item of Array.isArray(items) ? items : []) {
    const key = [
      item.type,
      item.source?.topicId,
      item.createdAt,
      item.speaker,
      item.text,
    ].map((part) => normalizeText(part)).join("\u0000");
    if (!item.text || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function rankMemoryItems(items) {
  return [...items].sort((a, b) => {
    const typeScoreA = a.type === "summary" ? 1 : 0;
    const typeScoreB = b.type === "summary" ? 1 : 0;
    if (typeScoreB !== typeScoreA) return typeScoreB - typeScoreA;
    const semanticA = typeof a.semanticScore === "number" ? a.semanticScore : 0;
    const semanticB = typeof b.semanticScore === "number" ? b.semanticScore : 0;
    if (semanticB !== semanticA) return semanticB - semanticA;
    return normalizeText(b.createdAt).localeCompare(normalizeText(a.createdAt));
  });
}

function normalizeActor(value) {
  const normalized = normalizeText(value).toLowerCase();
  return ["owner", "codex", "claude"].includes(normalized) ? normalized : "owner";
}

function normalizeScope(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "code") return "claude";
  if (normalized === "temp") return "temporary";
  return normalized;
}

function clampInteger(value, min, max, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  ACTOR_PRIVATE_SCOPES,
  DEFAULT_CONTEXT_SIZE,
  DEFAULT_MESSAGE_LIMIT,
  DEFAULT_SUMMARY_LIMIT,
  OWNER_SCOPES,
  PUBLIC_SCOPES,
  expandAllowedScopes,
  searchMemoryWithClient,
};

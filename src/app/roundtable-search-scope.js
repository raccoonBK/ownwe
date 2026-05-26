const {
  normalizeDirectChats,
  normalizeFixedRooms,
  normalizeSidebarProjects,
} = require("./roundtable-state");
const { normalizeText } = require("./roundtable-utils");

const DIRECT_SCOPE_TO_CHAT_ID = {
  codex: "codex",
  claude: "code",
  code: "code",
};

function resolveSearchScope(db, { scope = "", project = "", topicId = "" } = {}) {
  const requestedScope = normalizeText(scope).toLowerCase() || "global";
  const explicitTopicId = normalizeText(topicId);
  if (explicitTopicId && ["topic", "topicid", "topic_id"].includes(requestedScope)) {
    return buildResolvedScope({
      requestedScope,
      kind: "topic",
      label: explicitTopicId,
      topicIds: topicExists(db, explicitTopicId) ? [explicitTopicId] : [],
    });
  }
  if (requestedScope === "global" || requestedScope === "all") {
    return buildResolvedScope({
      requestedScope,
      kind: "global",
      label: "global",
      topicIds: null,
    });
  }
  if (["main", "philosophy", "alone"].includes(requestedScope)) {
    const rooms = normalizeFixedRooms(readMetaJson(db, "fixed_rooms_json", {}));
    const topicIds = uniqueTextArray([
      rooms[requestedScope]?.topicId,
      ...topicIdsForContainer(db, "fixed_room", requestedScope),
    ]);
    return buildResolvedScope({
      requestedScope,
      kind: "fixed_room",
      label: rooms[requestedScope]?.title || requestedScope,
      topicIds,
    });
  }
  if (Object.hasOwn(DIRECT_SCOPE_TO_CHAT_ID, requestedScope)) {
    const chatId = DIRECT_SCOPE_TO_CHAT_ID[requestedScope];
    const chats = normalizeDirectChats(readMetaJson(db, "direct_chats_json", {}));
    const topicIds = uniqueTextArray([
      chats[chatId]?.topicId,
      ...topicIdsForContainer(db, "direct_chat", chatId),
    ]);
    return buildResolvedScope({
      requestedScope,
      kind: "direct_chat",
      id: chatId,
      label: chats[chatId]?.title || chatId,
      topicIds,
    });
  }
  if (requestedScope === "temporary" || requestedScope === "temp") {
    return buildResolvedScope({
      requestedScope,
      kind: "temporary",
      label: "temporary",
      topicIds: topicIdsForContainerType(db, "temporary"),
    });
  }
  if (requestedScope === "project") {
    return resolveProjectScope(db, { requestedScope, project, topicId: explicitTopicId });
  }
  return buildResolvedScope({
    requestedScope,
    kind: "unknown",
    label: requestedScope,
    topicIds: [],
  });
}

function resolveProjectScope(db, { requestedScope, project, topicId }) {
  const key = normalizeText(project) || topicId;
  if (!key) {
    return buildResolvedScope({
      requestedScope,
      kind: "project",
      label: "project",
      topicIds: topicIdsForContainerType(db, "project"),
    });
  }
  const normalizedKey = key.toLowerCase();
  const projects = normalizeSidebarProjects(readMetaJson(db, "sidebar_projects_json", []));
  const projectTopicIds = projects
    .filter((item) => matchesProjectKey(item, normalizedKey))
    .flatMap((item) => [
      item.topicId,
      ...topicIdsForContainer(db, "project", item.id),
    ]);
  const topicRows = db.prepare(
    `SELECT id
     FROM topics
     WHERE container_type = 'project'
       AND (
         lower(id) = ?
         OR lower(container_id) = ?
         OR lower(container_title) = ?
         OR lower(title) = ?
       )
     ORDER BY updated_at DESC`
  ).all(normalizedKey, normalizedKey, normalizedKey, normalizedKey);
  return buildResolvedScope({
    requestedScope,
    kind: "project",
    label: key,
    topicIds: uniqueTextArray([
      ...projectTopicIds,
      ...topicRows.map((row) => row.id),
      topicExists(db, key) ? key : "",
    ]),
  });
}

function matchesProjectKey(project, normalizedKey) {
  return [
    project.id,
    project.topicId,
    project.title,
    project.topicTitle,
  ].some((value) => normalizeText(value).toLowerCase() === normalizedKey);
}

function buildResolvedScope({ requestedScope, kind, id = "", label = "", topicIds }) {
  const ids = Array.isArray(topicIds) ? uniqueTextArray(topicIds) : null;
  return {
    requestedScope,
    kind,
    id,
    label,
    topicIds: ids,
    isGlobal: ids === null,
  };
}

function topicIdsForContainer(db, containerType, containerId) {
  return db.prepare(
    `SELECT id
     FROM topics
     WHERE container_type = ? AND container_id = ?
     ORDER BY updated_at DESC`
  ).all(containerType, containerId).map((row) => row.id);
}

function topicIdsForContainerType(db, containerType) {
  return db.prepare(
    "SELECT id FROM topics WHERE container_type = ? ORDER BY updated_at DESC"
  ).all(containerType).map((row) => row.id);
}

function topicExists(db, topicId) {
  const id = normalizeText(topicId);
  return Boolean(id && db.prepare("SELECT 1 FROM topics WHERE id = ?").get(id));
}

function readMetaJson(db, key, fallback) {
  const value = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key)?.value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function uniqueTextArray(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeText(value))
    .filter(Boolean))];
}

module.exports = {
  resolveSearchScope,
};

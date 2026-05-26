const {
  clampInteger,
  normalizeAttachments,
  normalizeIsoText,
  normalizeSpeakerTarget,
  normalizeText,
} = require("./roundtable-utils");
const { normalizePendingApprovals } = require("./roundtable-approval");

const DEFAULT_MAX_ROUNDS = 4;
const DEFAULT_FIXED_ROOMS = {
  main: { title: "\u4e3b\u5385", topicTitle: "\u56fa\u5b9a\uff1a\u4e3b\u5385", topicId: "", icon: "", customizable: false },
  philosophy: { title: "\u54f2\u5b66\u5706\u684c", topicTitle: "\u56fa\u5b9a\uff1a\u54f2\u5b66\u5706\u684c", topicId: "", icon: "", customizable: false },
  otherworld: { title: "\u5f02\u4e16\u65c5\u793e", topicTitle: "\u56fa\u5b9a\uff1a\u5f02\u4e16\u65c5\u793e", topicId: "", icon: "", customizable: false },
  alone: { title: "\u65e0\u4eba\u5706\u684c", topicTitle: "\u56fa\u5b9a\uff1a\u65e0\u4eba\u5706\u684c", topicId: "", icon: "", customizable: false },
  slot1: { title: "\u56fa\u5b9a 1", topicTitle: "\u56fa\u5b9a\uff1a\u56fa\u5b9a 1", topicId: "", icon: "\u25c7", customizable: true },
  slot2: { title: "\u56fa\u5b9a 2", topicTitle: "\u56fa\u5b9a\uff1a\u56fa\u5b9a 2", topicId: "", icon: "\u25c6", customizable: true },
};
const DEFAULT_DIRECT_CHATS = {
  codex: { title: "Codex", icon: "C", topicTitle: "\u5355\u804a\uff1aCodex", topicId: "" },
  code: { title: "Claude Code", icon: "A", topicTitle: "\u5355\u804a\uff1aClaude Code", topicId: "" },
};

function normalizeDirectChats(value) {
  const source = value && typeof value === "object" ? value : {};
  const chats = {};
  for (const [id, defaults] of Object.entries(DEFAULT_DIRECT_CHATS)) {
    const current = source[id] && typeof source[id] === "object" ? source[id] : {};
    chats[id] = {
      title: normalizeText(current.title) || defaults.title,
      icon: normalizeText(current.icon) || defaults.icon,
      topicTitle: normalizeText(current.topicTitle) || defaults.topicTitle,
      topicId: normalizeText(current.topicId),
    };
  }
  return chats;
}

function normalizeSidebarProjects(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => ({
      id: normalizeText(item.id) || `project-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: normalizeText(item.title) || stripTopicPrefix(item.topicTitle) || "\u672a\u547d\u540d\u9879\u76ee",
      icon: normalizeText(item.icon) || defaultProjectIcon(item.title || item.topicTitle),
      topicId: normalizeText(item.topicId),
      topicTitle: normalizeText(item.topicTitle) || `\u56fa\u5b9a\uff1a${normalizeText(item.title) || "\u672a\u547d\u540d\u9879\u76ee"}`,
      updatedAt: normalizeIsoText(item.updatedAt) || new Date().toISOString(),
    }))
    .filter((item) => item.title && !isHiddenSidebarProject(item));
}

function isHiddenSidebarProject(project) {
  const title = normalizeText(project?.title).toLowerCase();
  const topicTitle = stripTopicPrefix(project?.topicTitle).toLowerCase();
  return ["codex", "\u54f2\u5b66\u5706\u684c"].includes(title)
    || ["codex", "\u54f2\u5b66\u5706\u684c"].includes(topicTitle);
}

function upsertSidebarProject(draft, project) {
  const projects = normalizeSidebarProjects(draft.sidebarProjects);
  const topicTitle = normalizeText(project.topicTitle);
  const existingIndex = projects.findIndex((item) =>
    item.id === project.id || item.topicId === project.topicId || item.topicTitle === topicTitle
  );
  const next = {
    id: normalizeText(project.id) || `project-${Date.now()}`,
    title: normalizeText(project.title) || stripTopicPrefix(topicTitle) || "\u672a\u547d\u540d\u9879\u76ee",
    icon: normalizeText(project.icon) || defaultProjectIcon(project.title || topicTitle),
    topicId: normalizeText(project.topicId),
    topicTitle,
    updatedAt: new Date().toISOString(),
  };
  if (existingIndex >= 0) {
    projects[existingIndex] = { ...projects[existingIndex], ...next };
  } else {
    projects.unshift(next);
  }
  draft.sidebarProjects = projects.slice(0, 60);
}

function stripTopicPrefix(value) {
  return normalizeText(value).replace(/^(\u56fa\u5b9a|\u4e34\u65f6|\u5355\u804a|fixed|temporary|direct|project)\s*[\uff5c|:\uff1a-]\s*/iu, "");
}

const PROJECT_ICON_POOL = ["◇", "◆", "□", "○", "☆", "♠", "♦", "♣", "♥", "◉"];

function defaultProjectIcon(value) {
  // Stable random: hash the title so the same project always gets the same icon
  const text = normalizeText(value);
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % PROJECT_ICON_POOL.length;
  return PROJECT_ICON_POOL[idx];
}

function normalizeFixedRooms(value) {
  const source = value && typeof value === "object" ? value : {};
  const rooms = {};
  for (const [id, defaults] of Object.entries(DEFAULT_FIXED_ROOMS)) {
    const current = source[id] && typeof source[id] === "object" ? source[id] : {};
    rooms[id] = {
      title: normalizeText(current.title) || defaults.title,
      topicTitle: normalizeText(current.topicTitle) || defaults.topicTitle,
      topicId: normalizeText(current.topicId),
      icon: normalizeText(current.icon) || defaults.icon || "",
      customizable: Boolean(defaults.customizable),
    };
  }
  return rooms;
}

// Stable-binding relinks: prefer the container_id stored on the topic.
// container_id is set once at topic creation and never changes, so renaming
// the topic title can never break the binding. The topicTitle string match
// is only used as a fallback for legacy topics that have no container_id.
function relinkFixedRoomIfNeeded(draft, topicId, topicTitle, containerId = "") {
  draft.fixedRooms = normalizeFixedRooms(draft.fixedRooms);
  const cid = normalizeText(containerId);
  if (cid && draft.fixedRooms[cid]) {
    draft.fixedRooms[cid].topicId = topicId;
    return;
  }
  for (const [roomId, room] of Object.entries(draft.fixedRooms)) {
    if (room.topicTitle === topicTitle) {
      draft.fixedRooms[roomId].topicId = topicId;
    }
  }
}

function relinkDirectChatIfNeeded(draft, topicId, topicTitle, containerId = "") {
  draft.directChats = normalizeDirectChats(draft.directChats);
  const cid = normalizeText(containerId);
  if (cid && draft.directChats[cid]) {
    draft.directChats[cid].topicId = topicId;
    return;
  }
  for (const [chatId, chat] of Object.entries(draft.directChats)) {
    if (chat.topicTitle === topicTitle) {
      draft.directChats[chatId].topicId = topicId;
    }
  }
}

function relinkSidebarProjectIfNeeded(draft, topicId, topicTitle, containerId = "") {
  const cid = normalizeText(containerId);
  draft.sidebarProjects = normalizeSidebarProjects(draft.sidebarProjects).map((project) => {
    if (cid && project.id === cid) {
      return { ...project, topicId, updatedAt: new Date().toISOString() };
    }
    if (!cid && project.topicTitle === topicTitle) {
      return { ...project, topicId, updatedAt: new Date().toISOString() };
    }
    return project;
  });
}

function normalizeLastSeenMessageIdBySpeaker(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    codex: normalizeText(source.codex),
    claude: normalizeText(source.claude),
  };
}

function normalizeRuntimeRuns(value) {
  return (Array.isArray(value) ? value : [])
    .map((run) => ({
      id: normalizeText(run?.id),
      kind: normalizeText(run?.kind),
      speaker: normalizeSpeakerTarget(run?.speaker),
      status: normalizeText(run?.status),
      title: normalizeText(run?.title),
      phase: normalizeText(run?.phase),
      detail: normalizeText(run?.detail),
      messageId: normalizeText(run?.messageId),
      threadId: normalizeText(run?.threadId),
      turnId: normalizeText(run?.turnId),
      startedAt: normalizeIsoText(run?.startedAt),
      updatedAt: normalizeIsoText(run?.updatedAt),
      endedAt: normalizeIsoText(run?.endedAt),
    }))
    .filter((run) => run.id)
    .slice(-20);
}

function normalizeRoundtableState(value = {}) {
  const base = emptyRoundtableState();
  const active = normalizeTopicRecord(value);
  return {
    ...base,
    ...active,
    fixedRooms: normalizeFixedRooms(value.fixedRooms),
    directChats: normalizeDirectChats(value.directChats),
    sidebarProjects: normalizeSidebarProjects(value.sidebarProjects),
    topics: (Array.isArray(value.topics) ? value.topics : [])
      .map((topic) => normalizeTopicRecord(topic))
      .filter((topic) => topic.id),
    updatedAt: normalizeIsoText(value.updatedAt) || active.updatedAt || base.updatedAt,
  };
}

function normalizeTopicRecord(value = {}) {
  const id = normalizeText(value.id);
  return {
    id,
    topic: normalizeText(value.topic),
    container: normalizeTopicContainer(value.container),
    maxRounds: clampInteger(value.maxRounds, 1, 20, DEFAULT_MAX_ROUNDS),
    round: clampInteger(value.round, 0, 10_000, 0),
    nextSpeaker: normalizeSpeakerTarget(value.nextSpeaker) || "codex",
    running: Boolean(value.running),
    status: normalizeText(value.status) || (id ? "ready" : "empty"),
    lastError: normalizeText(value.lastError),
    freshRuntimeHandoffs: value.freshRuntimeHandoffs && typeof value.freshRuntimeHandoffs === "object"
      ? { ...value.freshRuntimeHandoffs }
      : {},
    lastSeenMessageIdBySpeaker: normalizeLastSeenMessageIdBySpeaker(value.lastSeenMessageIdBySpeaker),
    pendingApprovals: normalizePendingApprovals(value.pendingApprovals),
    runtimeRuns: normalizeRuntimeRuns(value.runtimeRuns),
    messages: (Array.isArray(value.messages) ? value.messages : [])
      .map((message) => ({
        ...(message || {}),
        speaker: normalizeSpeakerTarget(message?.speaker) || normalizeText(message?.speaker) || "user",
        text: normalizeText(message?.text),
        attachments: normalizeAttachments(message?.attachments),
      }))
      .filter((message) => message.id || message.text),
    events: Array.isArray(value.events) ? value.events : [],
    createdAt: normalizeIsoText(value.createdAt),
    updatedAt: normalizeIsoText(value.updatedAt),
  };
}

function extractTopicRecord(state) {
  const topic = normalizeTopicRecord(state);
  return {
    ...topic,
    container: resolveTopicContainer(state),
    updatedAt: topic.updatedAt || new Date().toISOString(),
  };
}

function normalizeTopicContainer(value = {}) {
  if (!value || typeof value !== "object") {
    return {};
  }
  return {
    type: normalizeText(value.type),
    id: normalizeText(value.id),
    title: normalizeText(value.title),
  };
}

function resolveTopicContainer(state = {}) {
  const existing = normalizeTopicContainer(state.container);
  if (hasTopicContainer(existing)) {
    return existing;
  }
  const topicId = normalizeText(state.id);
  const topicTitle = normalizeText(state.topic);
  return {
    type: "temporary",
    id: topicId,
    title: stripTopicPrefix(topicTitle) || topicTitle,
  };
}

function hasTopicContainer(container = {}) {
  return Boolean(container.type || container.id || container.title);
}

function archiveCurrentTopic(draft) {
  if (!draft?.id) {
    return;
  }
  const archived = {
    id: draft.id,
    topic: draft.topic,
    maxRounds: draft.maxRounds,
    round: draft.round,
    nextSpeaker: draft.nextSpeaker,
    running: false,
    status: draft.status === "empty" ? "ready" : draft.status,
    lastError: "",
    container: resolveTopicContainer(draft),
    freshRuntimeHandoffs: draft.freshRuntimeHandoffs || {},
    lastSeenMessageIdBySpeaker: normalizeLastSeenMessageIdBySpeaker(draft.lastSeenMessageIdBySpeaker),
    runtimeRuns: normalizeRuntimeRuns(draft.runtimeRuns),
    messages: Array.isArray(draft.messages)
      ? draft.messages.map((message) => ({ ...message, pending: false }))
      : [],
    events: Array.isArray(draft.events) ? draft.events : [],
    createdAt: draft.createdAt,
    updatedAt: new Date().toISOString(),
  };
  const topics = Array.isArray(draft.topics) ? draft.topics.filter((topic) => topic?.id !== archived.id) : [];
  topics.unshift(archived);
  draft.topics = topics;
}

function listArchivedTopics(topics) {
  return (Array.isArray(topics) ? topics : [])
    .filter((topic) => topic?.id)
    .map((topic) => ({
      id: topic.id,
      topic: topic.topic || "(untitled)",
      round: topic.round || 0,
      maxRounds: topic.maxRounds || DEFAULT_MAX_ROUNDS,
      messageCount: Array.isArray(topic.messages) ? topic.messages.length : 0,
      updatedAt: topic.updatedAt || topic.createdAt || "",
    }));
}

function emptyRoundtableState() {
  return {
    id: "",
    topic: "",
    container: {},
    maxRounds: DEFAULT_MAX_ROUNDS,
    round: 0,
    nextSpeaker: "codex",
    running: false,
    status: "empty",
    lastError: "",
    messages: [],
    events: [],
    freshRuntimeHandoffs: {},
    lastSeenMessageIdBySpeaker: {},
    pendingApprovals: [],
    runtimeRuns: [],
    topics: [],
    fixedRooms: normalizeFixedRooms({}),
    directChats: normalizeDirectChats({}),
    sidebarProjects: normalizeSidebarProjects([]),
    createdAt: "",
    updatedAt: "",
  };
}

module.exports = {
  DEFAULT_MAX_ROUNDS,
  archiveCurrentTopic,
  defaultProjectIcon,
  emptyRoundtableState,
  extractTopicRecord,
  hasTopicContainer,
  listArchivedTopics,
  normalizeDirectChats,
  normalizeFixedRooms,
  normalizeLastSeenMessageIdBySpeaker,
  normalizeRuntimeRuns,
  normalizeRoundtableState,
  normalizeSidebarProjects,
  normalizeTopicContainer,
  normalizeTopicRecord,
  relinkDirectChatIfNeeded,
  relinkFixedRoomIfNeeded,
  relinkSidebarProjectIfNeeded,
  resolveTopicContainer,
  stripTopicPrefix,
  upsertSidebarProject,
};

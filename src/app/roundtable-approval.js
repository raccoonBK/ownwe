const {
  normalizeIsoText,
  normalizeSpeakerTarget,
  normalizeText,
  normalizeTextArray,
} = require("./roundtable-utils");

const AUTO_APPROVE_ROUNDTABLE_TOOL_TOKENS = [  ["mcp_tool", "roundtable_reach", "web_read"],
  ["mcp_tool", "roundtable_reach", "video_transcript"],
  ["mcp_tool", "codex_private_memory", "searchprivatememory"],
  ["mcp_tool", "codex_private_memory", "rememberprivate"],
  ["mcp_tool", "codex_surf", "smart_search"],
  ["mcp_tool", "roundtable_memory", "searchmemory"],
  ["mcp_tool", "roundtable_memory", "savesummary"],
];

function shouldAutoApproveRoundtableTool(payload) {
  const commandTokens = Array.isArray(payload?.commandTokens)
    ? payload.commandTokens.map((token) => normalizeText(token).toLowerCase()).filter(Boolean)
    : [];
  if (!commandTokens.length) {
    return false;
  }
  return AUTO_APPROVE_ROUNDTABLE_TOOL_TOKENS.some((tokens) =>
    tokens.every((token, index) => commandTokens[index] === token)
  );
}

function normalizeRequestId(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return normalizeText(value);
}

function normalizePendingApprovals(value) {
  return (Array.isArray(value) ? value : [])
    .map((approval) => normalizePendingApproval(approval))
    .filter((approval) => approval.speaker && approval.requestId);
}

function normalizePendingApproval(value = {}) {
  const requestId = normalizeRequestId(value.requestId);
  const runtimeRequestId = Object.prototype.hasOwnProperty.call(value, "runtimeRequestId")
    ? value.runtimeRequestId
    : value.requestId;
  return {
    speaker: normalizeSpeakerTarget(value.speaker),
    requestId,
    runtimeRequestId,
    kind: normalizeText(value.kind) || "command",
    command: normalizeText(value.command),
    commandTokens: normalizeTextArray(value.commandTokens),
    threadId: normalizeText(value.threadId),
    turnId: normalizeText(value.turnId),
    filePaths: normalizeTextArray(value.filePaths),
    responseTemplate: normalizeResponseTemplate(value.responseTemplate),
    elicitation: normalizeApprovalElicitation(value.elicitation),
    at: normalizeIsoText(value.at) || new Date().toISOString(),
  };
}

function normalizeApprovalElicitation(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return {
    message: normalizeText(value.message),
    persistScopes: normalizeTextArray(value.persistScopes),
    responseTemplate: normalizeResponseTemplate(value.responseTemplate),
  };
}

function normalizeResponseTemplate(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const responseByCommand = value.responseByCommand && typeof value.responseByCommand === "object"
    ? value.responseByCommand
    : {};
  return {
    supportedCommands: normalizeTextArray(value.supportedCommands),
    responseByCommand,
  };
}

function upsertPendingApproval(list, approval) {
  const approvals = normalizePendingApprovals(list);
  const index = approvals.findIndex((item) =>
    item.speaker === approval.speaker && item.requestId === approval.requestId
  );
  if (index >= 0) {
    approvals[index] = approval;
    return approvals;
  }
  approvals.push(approval);
  return approvals.slice(-20);
}

function findPendingApproval(list, { speaker, requestId }) {
  const normalizedSpeaker = normalizeSpeakerTarget(speaker);
  const normalizedRequestId = normalizeRequestId(requestId);
  return normalizePendingApprovals(list).find((approval) =>
    approval.speaker === normalizedSpeaker && approval.requestId === normalizedRequestId
  );
}

function removePendingApproval(list, { speaker, requestId }) {
  const normalizedSpeaker = normalizeSpeakerTarget(speaker);
  const normalizedRequestId = normalizeRequestId(requestId);
  return normalizePendingApprovals(list).filter((approval) =>
    approval.speaker !== normalizedSpeaker || approval.requestId !== normalizedRequestId
  );
}

function clearPendingApprovalsForTurn(list, payload = {}) {
  const speaker = normalizeSpeakerTarget(payload.speaker);
  const threadId = normalizeText(payload.threadId);
  const turnId = normalizeText(payload.turnId);
  if (!speaker && !threadId && !turnId) {
    return normalizePendingApprovals(list);
  }
  return normalizePendingApprovals(list).filter((approval) => {
    if (speaker && approval.speaker !== speaker) {
      return true;
    }
    if (threadId && approval.threadId && approval.threadId !== threadId) {
      return true;
    }
    if (turnId && approval.turnId && approval.turnId !== turnId) {
      return true;
    }
    return false;
  });
}

function clearPendingApprovalsForSpeaker(list, speaker) {
  const normalizedSpeaker = normalizeSpeakerTarget(speaker);
  if (!normalizedSpeaker) {
    return normalizePendingApprovals(list);
  }
  return normalizePendingApprovals(list).filter((approval) => approval.speaker !== normalizedSpeaker);
}

function normalizeApprovalDecision(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (["accept", "approve", "allow", "yes", "y"].includes(normalized)) {
    return "accept";
  }
  if (["decline", "deny", "reject", "no", "n", "cancel"].includes(normalized)) {
    return "decline";
  }
  throw new Error("approval decision must be accept or decline");
}

function buildApprovalRuntimeResponse(approval, decision) {
  const normalizedDecision = normalizeApprovalDecision(decision);
  const command = normalizedDecision === "accept" ? "yes" : "no";
  const responseTemplate = approval?.responseTemplate || approval?.elicitation?.responseTemplate;
  const templated = responseTemplate?.responseByCommand?.[command];
  return {
    decision: normalizedDecision,
    result: templated && typeof templated === "object" ? templated : null,
  };
}

module.exports = {
  buildApprovalRuntimeResponse,
  clearPendingApprovalsForSpeaker,
  clearPendingApprovalsForTurn,
  findPendingApproval,
  normalizeApprovalDecision,
  normalizeRequestId,
  normalizePendingApproval,
  normalizePendingApprovals,
  removePendingApproval,
  shouldAutoApproveRoundtableTool,
  upsertPendingApproval,
};

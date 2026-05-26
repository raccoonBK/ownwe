const http = require("http");
const path = require("path");

try {
  require("dotenv").config({ path: path.join(process.cwd(), ".env") });
} catch {
  // ignore
}

const args = parseArgs(process.argv.slice(2));
const host = args.host || process.env.ROUNDTABLE_MONITOR_HOST || process.env.ROUNDTABLE_HOST || "127.0.0.1";
const port = args.port || process.env.ROUNDTABLE_PORT || "8787";
const pollMs = args.pollMs || 1200;

const seenMessageIds = new Set();
const seenEventKeys = new Set();
let lastStatus = "";
let lastError = "";
let lastCheckinLine = "";
let announcedDown = false;

async function main() {
  console.log(`[roundtable:open] monitoring http://${host}:${port}`);
  console.log("[roundtable:open] start the server with: npm run roundtable");
  console.log("[roundtable:open] Ctrl+C to exit\n");

  while (true) {
    try {
      const state = await fetchState();
      announcedDown = false;
      renderState(state);
    } catch (error) {
      if (!announcedDown) {
        console.log(`[roundtable:open] server unavailable: ${error.message}`);
        announcedDown = true;
      }
    }
    await sleep(pollMs);
  }
}

function renderState(state) {
  const statusLine = [
    `status=${state.status || "empty"}`,
    `running=${Boolean(state.running)}`,
    `round=${state.round || 0}/${state.maxRounds || 4}`,
    state.topic ? `topic=${state.topic}` : "",
  ].filter(Boolean).join(" ");
  if (statusLine !== lastStatus) {
    console.log(`[state] ${statusLine}`);
    lastStatus = statusLine;
  }

  const error = state.lastError || "";
  if (error && error !== lastError) {
    console.log(`[error] ${error}`);
  }
  lastError = error;

  renderCheckins(state.checkins);
  renderMessages(state.messages || []);
  renderEvents(state.events || []);
}

function renderCheckins(checkins) {
  const speakers = checkins?.speakers || {};
  const line = ["codex", "claude"]
    .map((speaker) => {
      const item = speakers[speaker] || {};
      const next = formatClock(item.nextAt);
      const last = item.lastAction ? ` last=${item.lastAction}` : "";
      return `${speaker}: next=${next || "-"}${last}`;
    })
    .join(" | ");
  if (line && line !== lastCheckinLine) {
    console.log(`[checkin] ${line}`);
    lastCheckinLine = line;
  }
}

function renderMessages(messages) {
  for (const message of messages) {
    const id = message?.id || `${message?.at || ""}:${message?.speaker || ""}:${message?.text || ""}`;
    if (!id || seenMessageIds.has(id)) {
      continue;
    }
    seenMessageIds.add(id);
    const pending = message.pending ? " pending" : "";
    const checkin = message.checkin ? " checkin" : "";
    const label = speakerLabel(message.speaker);
    const text = normalizeText(message.text) || "(empty)";
    console.log(`\n[${formatClock(message.at)}] ${label}${pending}${checkin}`);
    console.log(text);
  }
}

function renderEvents(events) {
  for (const event of events.slice(-30)) {
    const key = `${event?.at || ""}:${event?.type || ""}:${JSON.stringify(event?.payload || {})}`;
    if (!event?.type || seenEventKeys.has(key)) {
      continue;
    }
    seenEventKeys.add(key);
    const line = formatEvent(event);
    if (line) {
      console.log(line);
    }
  }
}

function formatEvent(event) {
  const payload = event.payload || {};
  switch (event.type) {
    case "roundtable.checkin":
      return `[event] ${payload.speaker || "unknown"} checkin action=${payload.action || ""}${payload.reason ? ` reason=${payload.reason}` : ""}`;
    case "runtime.turn.started":
      return `[event] ${payload.speaker || "unknown"} turn started`;
    case "runtime.turn.completed":
      return `[event] ${payload.speaker || "unknown"} turn completed`;
    case "runtime.turn.failed":
      return `[event] ${payload.speaker || "unknown"} turn failed ${payload.text || ""}`;
    case "runtime.approval.requested":
      return `[event] ${payload.speaker || "unknown"} approval requested ${payload.toolName || ""}`;
    default:
      if (event.type.startsWith("runtime.")) {
        return `[event] ${event.type} ${payload.speaker || ""}`;
      }
      return "";
  }
}

function fetchState() {
  return new Promise((resolve, reject) => {
    const req = http.get({
      host,
      port: Number(port),
      path: "/api/state",
      timeout: 1500,
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`invalid JSON: ${error.message}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("request timeout"));
    });
  });
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const arg = normalizeText(values[index]);
    if (arg === "--host") {
      result.host = normalizeText(values[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--host=")) {
      result.host = normalizeText(arg.slice("--host=".length));
      continue;
    }
    if (arg === "--port") {
      result.port = normalizeText(values[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--port=")) {
      result.port = normalizeText(arg.slice("--port=".length));
      continue;
    }
    if (arg === "--poll-ms") {
      result.pollMs = readPositiveInteger(values[index + 1], 1200);
      index += 1;
      continue;
    }
    if (arg.startsWith("--poll-ms=")) {
      result.pollMs = readPositiveInteger(arg.slice("--poll-ms=".length), 1200);
    }
  }
  return result;
}

function speakerLabel(value) {
  switch (value) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude Code";
    case "deepseek":
      return "DeepSeek";
    case "system":
      return "System";
    default:
      return "User";
  }
}

function formatClock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});

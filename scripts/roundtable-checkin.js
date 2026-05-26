const http = require("http");
const path = require("path");

try {
  require("dotenv").config({ path: path.join(process.cwd(), ".env") });
} catch {
  // ignore
}

const args = parseArgs(process.argv.slice(2));
const host = args.host || "127.0.0.1";
const port = args.port || process.env.ROUNDTABLE_PORT || "8787";

async function main() {
  if (!args.speaker || !args.afterMinutes) {
    console.log("Usage: npm run roundtable:checkin -- <codex|claude> <minutes>");
    console.log("   or: npm run roundtable:checkin -- --speaker codex --after-minutes 5");
    process.exit(1);
  }
  const state = await postJson("/api/checkin", {
    speaker: args.speaker,
    afterMinutes: args.afterMinutes,
  });
  const speakerState = state.checkins?.speakers?.[args.speaker] || {};
  console.log(`${args.speaker} next check-in: ${speakerState.nextAt || "(not scheduled)"}`);
}

function postJson(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host,
      port: Number(port),
      path: pathname,
      method: "POST",
      timeout: 3000,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        raw += chunk;
      });
      res.on("end", () => {
        let parsed = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          // ignore
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
          return;
        }
        resolve(parsed);
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("request timeout"));
    });
    req.write(data);
    req.end();
  });
}

function parseArgs(values) {
  const result = {};
  const positional = [];
  for (let index = 0; index < values.length; index += 1) {
    const arg = normalizeText(values[index]);
    if (arg === "--speaker") {
      result.speaker = normalizeSpeaker(values[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--speaker=")) {
      result.speaker = normalizeSpeaker(arg.slice("--speaker=".length));
      continue;
    }
    if (arg === "--after-minutes" || arg === "--minutes") {
      result.afterMinutes = readPositiveInteger(values[index + 1], 0);
      index += 1;
      continue;
    }
    if (arg.startsWith("--after-minutes=")) {
      result.afterMinutes = readPositiveInteger(arg.slice("--after-minutes=".length), 0);
      continue;
    }
    if (arg.startsWith("--minutes=")) {
      result.afterMinutes = readPositiveInteger(arg.slice("--minutes=".length), 0);
      continue;
    }
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
    if (arg) {
      positional.push(arg);
    }
  }
  if (!result.speaker && positional.length >= 1) {
    result.speaker = normalizeSpeaker(positional[0]);
  }
  if (!result.afterMinutes && positional.length >= 2) {
    result.afterMinutes = readPositiveInteger(positional[1], 0);
  }
  return result;
}

function normalizeSpeaker(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "codex") {
    return "codex";
  }
  if (normalized === "claude" || normalized === "code" || normalized === "claudecode" || normalized === "claude-code") {
    return "claude";
  }
  return "";
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});

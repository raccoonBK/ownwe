const http = require("http");
const readline = require("readline");

const ROUNDTABLE_PORT = parseInt(process.env.ROUNDTABLE_PORT || "8797", 10);
const BASE_URL = `http://127.0.0.1:${ROUNDTABLE_PORT}`;

const TOOLS = [
  {
    name: "rooms_list",
    description: "List available Roundtable rooms and show which room is currently active.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "room_current",
    description: "Show the current active Roundtable room.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "room_open",
    description: "Open a Roundtable room. Use room IDs from rooms_list, such as main, philosophy, direct:code, direct:codex, project:<id>, topic:<id>, or current.",
    inputSchema: {
      type: "object",
      properties: {
        roomId: {
          type: "string",
          description: "Room ID from rooms_list. Defaults to current.",
        },
      },
      required: ["roomId"],
    },
  },
  {
    name: "messages_read",
    description: "Read messages from a room. Default entry mode returns the latest topic summary plus the last few messages; pass 'since' to diff only the messages added after that ID.",
    inputSchema: {
      type: "object",
      properties: {
        roomId: {
          type: "string",
          description: "Room ID from rooms_list. Use 'current' for the active room. Defaults to current.",
        },
        limit: {
          type: "number",
          description: "Max messages to return (1-100, default 6 when entering, 50 when diffing with 'since').",
        },
        since: {
          type: "string",
          description: "Return only messages after this message ID. Omit to enter the room with a small recent window plus the latest summary.",
        },
        includePending: {
          type: "boolean",
          description: "Include pending AI messages and streaming text (default true).",
        },
      },
      required: [],
    },
  },
  {
    name: "messages_wait",
    description: "Long-poll a room until messages change or the active AI reply becomes idle. Pass the cursor returned by messages_read or messages_send.",
    inputSchema: {
      type: "object",
      properties: {
        roomId: {
          type: "string",
          description: "Room ID from rooms_list. Defaults to current.",
        },
        cursor: {
          type: "string",
          description: "Cursor returned by messages_read or messages_send.",
        },
        until: {
          type: "string",
          description: "'update' waits for any message/status change; 'idle' waits until the room is no longer running. Default update.",
        },
        limit: {
          type: "number",
          description: "Max messages to return (1-100, default 50).",
        },
        timeoutMs: {
          type: "number",
          description: "Long-poll timeout in ms (1000-120000, default 25000).",
        },
        includePending: {
          type: "boolean",
          description: "Include pending AI messages and streaming text (default true).",
        },
      },
      required: [],
    },
  },
  {
    name: "messages_send",
    description: "Send a message to a room and trigger that room's AI reply. Direct rooms call the matching AI; group/project/topic rooms call group replies unless target is set.",
    inputSchema: {
      type: "object",
      properties: {
        roomId: {
          type: "string",
          description: "Room ID from rooms_list. Use 'current' for the active room. Defaults to current.",
        },
        text: {
          type: "string",
          description: "Message text to send.",
        },
        target: {
          type: "string",
          description: "Optional reply target: auto, codex, claude, none/silent/post. Default auto.",
        },
        interrupt: {
          type: "boolean",
          description: "Interrupt a running reply before sending this message (default false).",
        },
        waitForReply: {
          type: "boolean",
          description: "Wait until the triggered reply finishes before returning (default false).",
        },
        timeoutMs: {
          type: "number",
          description: "Wait timeout in ms when waitForReply is true (1000-120000, default 60000).",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "send_message",
    description: "Alias for messages_send. Send a message to the current or selected Roundtable room and trigger the room AI.",
    inputSchema: {
      type: "object",
      properties: {
        roomId: {
          type: "string",
          description: "Room ID from rooms_list. Use 'current' for the active room. Defaults to current.",
        },
        text: {
          type: "string",
          description: "Message text to send.",
        },
        target: {
          type: "string",
          description: "Optional reply target: auto, codex, claude, none/silent/post. Default auto.",
        },
        interrupt: {
          type: "boolean",
          description: "Interrupt a running reply before sending this message (default false).",
        },
        waitForReply: {
          type: "boolean",
          description: "Wait until the triggered reply finishes before returning (default false).",
        },
        timeoutMs: {
          type: "number",
          description: "Wait timeout in ms when waitForReply is true (1000-120000, default 60000).",
        },
      },
      required: ["text"],
    },
  },
];

function apiGet(urlPath, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE_URL}${urlPath}`, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error("timeout")); });
  });
}

function apiPost(urlPath, body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: "127.0.0.1",
      port: ROUNDTABLE_PORT,
      path: urlPath,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };
    const req = http.request(options, (res) => {
      let responseData = "";
      res.on("data", (chunk) => { responseData += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(responseData) });
        } catch {
          resolve({ status: res.statusCode, body: responseData });
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error("timeout")); });
    req.write(data);
    req.end();
  });
}

async function callTool(name, args = {}) {
  if (name === "rooms_list") {
    const result = await apiGet("/api/desktop/rooms");
    if (result.status !== 200) throw new Error(`failed: ${JSON.stringify(result.body)}`);
    return result.body;
  }

  if (name === "room_current") {
    const result = await apiGet("/api/desktop/current");
    if (result.status !== 200) throw new Error(`failed: ${JSON.stringify(result.body)}`);
    return result.body;
  }

  if (name === "room_open") {
    const { roomId = "current" } = args;
    const result = await apiPost("/api/desktop/open", { roomId });
    if (result.status !== 200) throw new Error(`failed: ${JSON.stringify(result.body)}`);
    return result.body;
  }

  if (name === "messages_read") {
    const { roomId = "current", since = "", includePending = true } = args;
    const limit = args.limit != null
      ? Number(args.limit)
      : (since ? 50 : 6);
    const params = new URLSearchParams({ roomId });
    if (limit) params.set("limit", String(limit));
    if (since) params.set("since", since);
    if (includePending === false) params.set("includePending", "false");
    const result = await apiGet(`/api/desktop/messages?${params}`);
    if (result.status !== 200) throw new Error(`failed: ${JSON.stringify(result.body)}`);
    return result.body;
  }

  if (name === "messages_wait") {
    const {
      roomId = "current",
      cursor = "",
      until = "update",
      limit = 50,
      timeoutMs = 25000,
      includePending = true,
    } = args;
    const waitMs = clampWaitMs(timeoutMs, 25000);
    const params = new URLSearchParams({ roomId, until, timeoutMs: String(waitMs) });
    if (cursor) params.set("cursor", cursor);
    if (limit) params.set("limit", String(limit));
    if (includePending === false) params.set("includePending", "false");
    const result = await apiGet(`/api/desktop/wait?${params}`, waitMs + 5000);
    if (result.status !== 200) throw new Error(`failed: ${JSON.stringify(result.body)}`);
    return result.body;
  }

  if (name === "messages_send" || name === "send_message") {
    const {
      roomId = "current",
      text,
      target = "auto",
      interrupt = false,
      waitForReply = false,
      timeoutMs = 60000,
    } = args;
    const result = await apiPost("/api/desktop/send", { roomId, text, target, interrupt });
    if (result.status !== 202) throw new Error(`failed: ${JSON.stringify(result.body)}`);
    if (waitForReply && result.body?.cursor) {
      const waitMs = clampWaitMs(timeoutMs, 60000);
      const waitParams = new URLSearchParams({
        roomId: result.body.current?.id || roomId,
        cursor: result.body.cursor,
        until: "idle",
        timeoutMs: String(waitMs),
      });
      if (result.body.messageId) {
        waitParams.set("since", result.body.messageId);
      }
      const waitResult = await apiGet(`/api/desktop/wait?${waitParams}`, waitMs + 5000);
      if (waitResult.status !== 200) throw new Error(`failed: ${JSON.stringify(waitResult.body)}`);
      return { sent: result.body, afterReply: waitResult.body };
    }
    return result.body;
  }

  throw new Error(`unknown tool: ${name}`);
}

function clampWaitMs(value, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1000, Math.min(120000, parsed));
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function handleMessage(msg) {
  const { id, method, params } = msg;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "roundtable-desktop", version: "1.1.0" },
      },
    });
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }

  if (method === "tools/call") {
    const { name, arguments: toolArgs = {} } = params || {};
    try {
      const result = await callTool(name, toolArgs);
      send({
        jsonrpc: "2.0", id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
    } catch (err) {
      send({
        jsonrpc: "2.0", id,
        result: { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true },
      });
    }
    return;
  }

  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const msg = JSON.parse(trimmed);
    handleMessage(msg).catch((err) => {
      process.stderr.write(`[desktop-mcp] error: ${err.message}\n`);
    });
  } catch {
    process.stderr.write(`[desktop-mcp] invalid JSON: ${trimmed.slice(0, 100)}\n`);
  }
});
rl.on("close", () => process.exit(0));

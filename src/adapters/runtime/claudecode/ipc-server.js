const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { EventEmitter } = require("events");

class ClaudeCodeIpcServer extends EventEmitter {
  constructor({ socketPath, tokenFile = "" }) {
    super();
    this.originalSocketPath = socketPath;
    this.socketPath = normalizeSocketPath(socketPath);
    this.tokenFile = tokenFile || defaultTokenFile(socketPath, this.socketPath);
    this.authToken = "";
    this.server = null;
    this.clients = new Set();
    this.authenticated = new Set();
  }

  async start() {
    if (this.server) return;
    this.ensureDirectory();
    this.removeStaleSocket();
    this.generateAuthToken();

    const createServer = () => net.createServer((socket) => {
      this.clients.add(socket);
      socket.setEncoding("utf8");

      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (!this.authenticated.has(socket)) {
              if (msg?.type === "auth" && msg?.token === this.authToken) {
                this.authenticated.add(socket);
              }
              continue;
            }
            if (validateIpcMessage(msg)) {
              this.emit("clientMessage", msg, socket);
            }
          } catch {
            // ignore malformed
          }
        }
      });

      socket.on("close", () => {
        this.clients.delete(socket);
        this.authenticated.delete(socket);
      });

      socket.on("error", () => {
        this.clients.delete(socket);
        this.authenticated.delete(socket);
      });
    });

    try {
      this.server = createServer();
      await listenServer(this.server, this.socketPath);
    } catch (error) {
      this.server = null;
      if (!shouldRetryWithPrivatePipe(error, this.socketPath)) {
        throw error;
      }
      this.socketPath = buildPrivateWindowsPipePath(this.socketPath);
      this.tokenFile = defaultTokenFile(this.originalSocketPath, this.socketPath);
      this.generateAuthToken();
      this.server = createServer();
      await listenServer(this.server, this.socketPath);
    }

    if (!isWindowsNamedPipe(this.socketPath)) {
      fs.chmodSync(this.socketPath, 0o600);
    }
  }

  broadcast(event) {
    const payload = JSON.stringify(event) + "\n";
    for (const client of this.authenticated) {
      try {
        client.write(payload);
      } catch {
        // ignore dead sockets
      }
    }
  }

  ensureDirectory() {
    if (isWindowsNamedPipe(this.socketPath)) {
      fs.mkdirSync(path.dirname(this.tokenFile), { recursive: true });
      return;
    }
    const dir = path.dirname(this.socketPath);
    fs.mkdirSync(dir, { recursive: true });
  }

  removeStaleSocket() {
    if (isWindowsNamedPipe(this.socketPath)) {
      return;
    }
    try {
      const stat = fs.lstatSync(this.socketPath);
      if (!stat.isSocket()) {
        return;
      }
      fs.unlinkSync(this.socketPath);
    } catch {
      // ignore
    }
  }

  generateAuthToken() {
    this.authToken = crypto.randomBytes(32).toString("hex");
    try {
      fs.writeFileSync(this.tokenFile, this.authToken, { mode: 0o600 });
    } catch {
      // ignore
    }
  }

  removeAuthToken() {
    try {
      fs.unlinkSync(this.tokenFile);
    } catch {
      // ignore
    }
  }

  async close() {
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    this.authenticated.clear();

    if (this.server) {
      await new Promise((resolve) => {
        this.server.close(resolve);
      });
      this.server = null;
    }

    this.removeStaleSocket();
    this.removeAuthToken();
  }
}

function listenServer(server, socketPath) {
  return new Promise((resolve, reject) => {
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    server.once("listening", onListening);
    server.once("error", onError);
    server.listen(socketPath);
  });
}

function shouldRetryWithPrivatePipe(error, socketPath) {
  return error?.code === "EADDRINUSE" && isWindowsNamedPipe(socketPath);
}

function buildPrivateWindowsPipePath(socketPath) {
  const digest = crypto
    .createHash("sha1")
    .update(`${socketPath}:${process.pid}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 16);
  return `\\\\.\\pipe\\roundtable-claudecode-${digest}`;
}

function normalizeSocketPath(socketPath) {
  const normalized = typeof socketPath === "string" ? socketPath.trim() : "";
  if (process.platform !== "win32" || isWindowsNamedPipe(normalized)) {
    return normalized;
  }
  const digest = crypto.createHash("sha1").update(normalized || "roundtable").digest("hex").slice(0, 16);
  return `\\\\.\\pipe\\roundtable-claudecode-${digest}`;
}

function defaultTokenFile(originalSocketPath, normalizedSocketPath) {
  const original = typeof originalSocketPath === "string" ? originalSocketPath.trim() : "";
  if (original && !isWindowsNamedPipe(original)) {
    return `${original}.token`;
  }
  const digest = crypto
    .createHash("sha1")
    .update(normalizedSocketPath || original || "roundtable")
    .digest("hex")
    .slice(0, 16);
  return path.join(os.tmpdir(), `roundtable-claudecode-${digest}.token`);
}

function isWindowsNamedPipe(value) {
  return process.platform === "win32" && /^\\\\[.?]\\pipe\\/i.test(String(value || ""));
}

function validateIpcMessage(msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return false;
  }
  const type = msg.type;
  if (typeof type !== "string") {
    return false;
  }
  switch (type) {
    case "sendUserMessage":
      return typeof msg.workspaceRoot === "string" && typeof msg.text === "string";
    case "respondApproval":
      return typeof msg.workspaceRoot === "string" && typeof msg.requestId === "string";
    default:
      return true;
  }
}

module.exports = { ClaudeCodeIpcServer };

const http = require("http");
const https = require("https");

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "bge-m3";

function generateEmbedding(text) {
  const postData = JSON.stringify({ model: EMBEDDING_MODEL, input: text });
  const url = new URL(`${OLLAMA_BASE_URL}/api/embed`);
  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(raw || "{}");
          const embedding = parsed.embeddings?.[0];
          if (!Array.isArray(embedding) || !embedding.length) {
            reject(new Error("Ollama embedding: unexpected response format"));
            return;
          }
          resolve(embedding);
        } catch (error) {
          reject(new Error(`Ollama embedding parse error: ${error.message}`));
        }
      });
    });
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Ollama embedding request timed out"));
    });
    req.on("error", (error) => reject(new Error(`Ollama embedding request failed: ${error.message}`)));
    req.write(postData);
    req.end();
  });
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

module.exports = { generateEmbedding, cosineSimilarity, EMBEDDING_MODEL };

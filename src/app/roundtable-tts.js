const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const VOICE_PREFIX = "[VOICE]";

function hasVoicePrefix(text) {
  return String(text || "").trimStart().startsWith(VOICE_PREFIX);
}

function stripVoicePrefix(text) {
  return String(text || "").trimStart().slice(VOICE_PREFIX.length).trimStart();
}

function saveTtsAudio(stateDir, audioBuffer) {
  const today = new Date().toISOString().slice(0, 10);
  const dir = path.join(stateDir, "uploads", today);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `tts-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.mp3`;
  fs.writeFileSync(path.join(dir, filename), audioBuffer);
  return `/uploads/${today}/${filename}`;
}

async function generateAndSaveTts({ stateDir, apiKey, voiceId, text }) {
  const audioBuffer = await callElevenLabsTts({ apiKey, voiceId, text });
  return saveTtsAudio(stateDir, audioBuffer);
}

function callElevenLabsTts({ apiKey, voiceId, text }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      text,
      model_id: "eleven_flash_v2_5",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    });
    const options = {
      hostname: "api.elevenlabs.io",
      path: `/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let errBody = "";
        res.on("data", (chunk) => { errBody += chunk; });
        res.on("end", () => reject(new Error(`ElevenLabs ${res.statusCode}: ${errBody.slice(0, 200)}`)));
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

module.exports = { VOICE_PREFIX, hasVoicePrefix, stripVoicePrefix, generateAndSaveTts };

const https = require("https");

function callGemini({ messages, apiKey, model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite" }) {
  const systemParts = [];
  const contents = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemParts.push({ text: msg.content });
    } else if (msg.role === "user") {
      contents.push({ role: "user", parts: [{ text: msg.content }] });
    } else if (msg.role === "assistant") {
      contents.push({ role: "model", parts: [{ text: msg.content }] });
    }
  }

  const body = { contents };
  if (systemParts.length) {
    body.system_instruction = { parts: systemParts };
  }

  const postData = JSON.stringify(body);
  const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
  url.searchParams.set("key", apiKey);

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
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
          if (parsed.error) {
            reject(new Error(`Gemini API error: ${parsed.error.message || JSON.stringify(parsed.error)}`));
            return;
          }
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          resolve(typeof text === "string" ? text.trim() : "");
        } catch (error) {
          reject(new Error(`Gemini response parse error: ${error.message}`));
        }
      });
    });
    req.on("error", (error) => reject(new Error(`Gemini request failed: ${error.message}`)));
    req.write(postData);
    req.end();
  });
}

module.exports = { callGemini };

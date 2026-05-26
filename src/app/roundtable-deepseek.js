const https = require("https");

function callDeepSeek({ messages, apiKey, baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com" }) {
  const url = new URL(`${baseUrl}/v1/chat/completions`);
  const postData = JSON.stringify({
    model: "deepseek-chat",
    messages,
    temperature: 0.7,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        raw += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(raw || "{}");
          if (parsed.error) {
            reject(new Error(`DeepSeek API error: ${parsed.error.message || JSON.stringify(parsed.error)}`));
            return;
          }
          const text = parsed.choices?.[0]?.message?.content;
          resolve(typeof text === "string" ? text.trim() : "");
        } catch (error) {
          reject(new Error(`DeepSeek response parse error: ${error.message}`));
        }
      });
    });
    req.on("error", (error) => reject(new Error(`DeepSeek request failed: ${error.message}`)));
    req.write(postData);
    req.end();
  });
}

module.exports = {
  callDeepSeek,
};

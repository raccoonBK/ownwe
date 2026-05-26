let appPromise = null;

async function getOtherworldApp() {
  if (!appPromise) {
    appPromise = (async () => {
      const expressModule = await import("express");
      const express = expressModule.default || expressModule;
      const rpApiModule = await import("../otherworld-inn/server/routes/rp-api.js");

      const app = express();
      app.use(express.json({ limit: "10mb" }));
      app.use("/api/rp", rpApiModule.default);
      app.use((error, req, res, next) => {
        if (res.headersSent) {
          next(error);
          return;
        }
        res.status(500).json({ error: error instanceof Error ? error.message : String(error || "unknown error") });
      });
      return app;
    })();
  }
  return appPromise;
}

async function handleOtherworldApi(req, res) {
  const app = await getOtherworldApp();
  await new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    res.once("finish", settle);
    app(req, res, (error) => {
      if (res.headersSent || res.writableEnded) {
        settle();
        return;
      }
      if (error) {
        res.writeHead(500, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error || "unknown error") }));
        settle();
        return;
      }
      res.writeHead(404, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ error: "not found" }));
      settle();
    });
  });
}

module.exports = {
  handleOtherworldApi,
};

import http from "node:http";

const port = Number(process.env.MOCK_AI_PORT || 8790);

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    json(res, 404, { error: "not found" });
    return;
  }

  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    try {
      const body = JSON.parse(raw);
      const userMessage = Array.isArray(body.messages)
        ? body.messages.find((item) => item?.role === "user")?.content
        : undefined;
      const prompt = typeof userMessage === "string" ? JSON.parse(userMessage) : {};
      const candidates = Array.isArray(prompt.candidates) ? prompt.candidates : [];

      const decisions = candidates.map((candidate, index) => ({
        id: candidate.id,
        selected: index < Math.min(Number(prompt.maxSelected || 1), 2),
        themeFitScore: index === 0 ? 95 : 82,
        contextIndependenceScore: index === 0 ? 92 : 78,
        reason: index === 0 ? "主题契合且脱离上下文仍易理解" : "作为次选候选保留",
        translationZh:
          index === 0
            ? "【本地模拟翻译】这是一条用于端到端验收的中文翻译。"
            : "【本地模拟翻译】这是第二条用于端到端验收的中文翻译。",
        originalEn: "THIS MUST NEVER REPLACE SOURCE ORIGINAL",
      }));

      json(res, 200, {
        id: "mock-chat-completion",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({ decisions }),
            },
            finish_reason: "stop",
          },
        ],
      });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "bad request" });
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Mock AI provider listening on http://127.0.0.1:${port}/v1`);
});

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

loadDotEnv();

const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_TEXT_CHARS = 60000;
const SYSTEM_INSTRUCTIONS =
  "You summarize webpages for a browser extension. Return only valid JSON matching the requested schema. Do not include markdown.";

if (!OPENROUTER_API_KEY && !GEMINI_API_KEY) {
  console.error(
    "Missing AI provider key. Set OPENROUTER_API_KEY for primary summarization, or GEMINI_API_KEY for fallback."
  );
  process.exit(1);
}

const server = http.createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method !== "POST" || request.url !== "/summarize") {
    sendJson(response, 404, { error: "Use POST /summarize." });
    return;
  }

  try {
    const payload = await readJsonBody(request);
    const page = normalizePayload(payload);
    const summary = await summarizeWithProviders(page);
    sendJson(response, 200, summary);
  } catch (error) {
    sendJson(response, error.status || 500, {
      error: error instanceof Error ? error.message : "Unexpected proxy error."
    });
  }
});

function loadDotEnv() {
  const currentFile = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(currentFile), "..");
  const envPath = path.join(projectRoot, ".env");

  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`AI Page Summarizer proxy listening on http://127.0.0.1:${PORT}/summarize`);
});

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Vary", "Origin");
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > MAX_TEXT_CHARS + 5000) {
      throw httpError(413, "Page content is too large.");
    }
  }

  try {
    return JSON.parse(body);
  } catch {
    throw httpError(400, "Request body must be valid JSON.");
  }
}

function normalizePayload(payload = {}) {
  const title = String(payload.title || "Untitled page").trim().slice(0, 300);
  const url = String(payload.url || "").trim().slice(0, 2048);
  const text = String(payload.text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
  const mode = ["brief", "balanced", "detailed"].includes(payload.mode)
    ? payload.mode
    : "balanced";
  const wordCount = Number.parseInt(payload.wordCount, 10) || text.split(/\s+/).filter(Boolean).length;

  if (!/^https?:\/\//.test(url)) {
    throw httpError(400, "A valid page URL is required.");
  }
  if (text.length < 250) {
    throw httpError(400, "Not enough readable page text to summarize.");
  }

  return { title, url, text, mode, wordCount };
}

async function summarizeWithProviders(page) {
  const errors = [];

  if (OPENROUTER_API_KEY) {
    try {
      return await summarizeWithOpenRouter(page);
    } catch (error) {
      errors.push(`OpenRouter: ${formatError(error)}`);
      console.warn("OpenRouter summarization failed; trying Gemini fallback.", error);
    }
  }

  if (GEMINI_API_KEY) {
    try {
      return await summarizeWithGemini(page);
    } catch (error) {
      errors.push(`Gemini: ${formatError(error)}`);
    }
  }

  throw httpError(502, `All AI providers failed. ${errors.join(" ")}`.trim());
}

async function summarizeWithOpenRouter(page) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://127.0.0.1:8787",
      "X-OpenRouter-Title": "AI Page Summarizer Chrome Extension"
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: SYSTEM_INSTRUCTIONS
        },
        {
          role: "user",
          content: buildPrompt(page)
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "page_summary",
          strict: true,
          schema: openRouterSummarySchema()
        }
      }
    })
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw httpError(response.status, body?.error?.message || "OpenRouter request failed.");
  }

  const outputText = body?.choices?.[0]?.message?.content;
  if (!outputText) {
    throw httpError(502, "OpenRouter returned an empty summary.");
  }

  return {
    ...parseJsonOutput(outputText),
    model: body?.model || OPENROUTER_MODEL,
    provider: "openrouter"
  };
}

async function summarizeWithGemini(page) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTIONS }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: buildPrompt(page) }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: geminiSummarySchema()
        }
      })
    }
  );

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw httpError(
      response.status,
      body?.error?.message || `Gemini request failed with HTTP ${response.status}.`
    );
  }

  const outputText = body?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    ?.join("")
    ?.trim();
  if (!outputText) {
    throw httpError(502, "Gemini returned an empty summary.");
  }

  return {
    ...parseJsonOutput(outputText),
    model: GEMINI_MODEL,
    provider: "gemini"
  };
}

function openRouterSummarySchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "bullets", "insights", "readingTimeMinutes", "keyPhrases"],
    properties: {
      title: { type: "string" },
      bullets: {
        type: "array",
        minItems: 3,
        maxItems: 8,
        items: { type: "string" }
      },
      insights: {
        type: "array",
        minItems: 2,
        maxItems: 6,
        items: { type: "string" }
      },
      readingTimeMinutes: { type: "integer", minimum: 1 },
      keyPhrases: {
        type: "array",
        minItems: 3,
        maxItems: 8,
        items: { type: "string" }
      }
    }
  };
}

function geminiSummarySchema() {
  return {
    type: "OBJECT",
    required: ["title", "bullets", "insights", "readingTimeMinutes", "keyPhrases"],
    properties: {
      title: { type: "STRING" },
      bullets: {
        type: "ARRAY",
        minItems: 3,
        maxItems: 8,
        items: { type: "STRING" }
      },
      insights: {
        type: "ARRAY",
        minItems: 2,
        maxItems: 6,
        items: { type: "STRING" }
      },
      readingTimeMinutes: { type: "INTEGER" },
      keyPhrases: {
        type: "ARRAY",
        minItems: 3,
        maxItems: 8,
        items: { type: "STRING" }
      }
    },
    propertyOrdering: ["title", "bullets", "insights", "readingTimeMinutes", "keyPhrases"]
  };
}

function buildPrompt(page) {
  const bulletCount = page.mode === "brief" ? 3 : page.mode === "detailed" ? 7 : 5;
  return [
    `Title: ${page.title}`,
    `URL: ${page.url}`,
    `Estimated source word count: ${page.wordCount}`,
    `Desired summary length: ${bulletCount} bullets.`,
    "",
    "Summarize the important ideas, claims, evidence, and implications.",
    "Use concise, specific bullets. Key phrases must be exact short phrases likely to appear on the page so the extension can highlight them safely.",
    "",
    "Page text:",
    page.text
  ].join("\n");
}

function parseJsonOutput(outputText) {
  const trimmed = String(outputText || "").trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    throw httpError(502, "The AI provider returned invalid JSON.");
  }
}

function formatError(error) {
  return error instanceof Error ? error.message : "Unknown error.";
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

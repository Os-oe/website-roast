/* Lokaler Dev-/Test-Server: statische Dateien + /api/roast wie auf Vercel.
 * Lädt API-Keys aus agent-studio/.env, falls nicht schon im Environment.
 * Nutzung: node dev-server.mjs [port]
 *
 * Test-Modus: WR_MOCK=1  → /api/roast antwortet aus fixtures/ statt Live-API
 *             (Fixtures statt Live-Calls in Tests, wie bei angebots-blitz).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || 8753);

// .env aus agent-studio laden (nur fehlende Keys), ohne Dependency.
function loadEnv() {
  const envPath = "/Users/Osman/Desktop/APPS/agent-studio/.env";
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

const MOCK = process.env.WR_MOCK === "1";
const roastHandler = MOCK ? null : require("./api/roast.js");

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".mp3": "audio/mpeg",
  ".json": "application/json", ".webm": "video/webm", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".webmanifest": "application/manifest+json",
};

function vercelify(req, res, body) {
  req.body = body;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); return res; };
  if (!res.setHeader) res.setHeader = () => {};
  return { req, res };
}

// Mock-Antworten für Tests (kein Live-API-Call, deterministisch).
function mockRoast(body) {
  const url = (body && body.url) || "";
  if (/broken-nonexistent|error-case/.test(url)) {
    return { status: 200, json: { ok: true, model: "none", roast: { error: "Deine Seite hat sich vor mir versteckt — verdächtig." } } };
  }
  if (/internal|localhost|127\.0\.0\.1|192\.168\.|10\.0\./.test(url)) {
    return { status: 400, json: { ok: false, error: "Interne Adressen werden nicht geröstet." } };
  }
  return {
    status: 200,
    json: {
      ok: true, model: "gemini-2.5-flash", host: "example.com",
      roast: {
        error: null, score: 47, verdict: "medium — geht besser",
        roasts: [
          "Deine Headline ist so vage, dass selbst Google fragt: ‚Und was machst du jetzt genau?'",
          "‚Innovativ, dynamisch, lösungsorientiert' — du hast den Buzzword-Bingo-Jackpot geknackt, nur leider keinen Kunden.",
          "Der CTA versteckt sich besser als ein Ü-Ei-Spielzeug. Ich hab ihn nach drei Scrolls aufgegeben.",
        ],
        realTip: "Spaß beiseite: Pack einen klaren CTA above the fold und sag in EINEM Satz, was du für wen tust.",
        observations: ["Vage Headline", "Buzzword-Dichte hoch", "CTA nicht above the fold"],
      },
    },
  };
}

const server = http.createServer((req, res) => {
  if (req.url.split("?")[0] === "/api/roast") {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 1024 * 1024) req.destroy(); });
    req.on("end", async () => {
      let body = null;
      try { body = JSON.parse(raw); } catch (e) { body = raw; }
      if (MOCK) {
        const m = mockRoast(body);
        res.statusCode = m.status;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(m.json));
        return;
      }
      vercelify(req, res, body);
      try {
        await roastHandler(req, res);
      } catch (e) {
        res.status(500).json({ ok: false, error: String(e) });
      }
    });
    return;
  }
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  if (p === "/impressum") p = "/impressum.html";
  if (p === "/datenschutz") p = "/datenschutz.html";
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404; res.end("not found"); return;
  }
  res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => console.log(`dev-server http://127.0.0.1:${PORT}  (mock=${MOCK})`));

/* /api/roast — Website-URL → frecher KI-Roast in zwei Schritten:
 *   1) Firecrawl scrape (echter Seiteninhalt)
 *   2) Gemini Flash röstet NUR auf Basis dieses Inhalts (striktes JSON-Schema).
 *
 * Schutzschicht (CONCEPT §5):
 *  - Origin/Referer-Lock auf eigene Domains (sonst 403).
 *  - Input-Validierung: URL-Format, http/https only.
 *  - SSRF-BLOCK (KRITISCH — der Server holt fremde URLs!): localhost,
 *    127.*, 10.*, 192.168.*, 172.16-31.*, 169.254.*, interne Hosts ablehnen.
 *  - Tages-Caps: global + pro IP (in-memory pro Function-Instanz — best effort).
 *  - Fetch-Timeout + Max-Größe.
 *  - Bei Cap/Fehler: graceful Fallback auf eine gestagte Beispiel-Röstung
 *    (kein Fehlerbildschirm, Conversion erhalten).
 *
 * Anti-Halluzination (CONCEPT §5.6): geröstet wird NUR aus echtem gelieferten
 * Seiteninhalt. Konnte die Seite nicht geladen werden / ist leer → error-Feld,
 * NIE Inhalte erfinden.
 *
 * Gemini-Falle: Request-Felder sind camelCase (responseMimeType etc.).
 * Keys NUR via process.env (vercel env) — nie im Client-Bundle.
 */

const ALLOWED_HOSTS = [
  "website-roast.demo.osai.solutions",
  "localhost",
  "127.0.0.1",
];
// Vercel-Preview-Deploys (website-roast-*.vercel.app) ebenfalls erlauben
const VERCEL_RE = /^website-roast[a-z0-9-]*\.vercel\.app$/;

const MODELS = ["gemini-2.5-flash", "gemini-flash-latest"]; // günstige Flash-Kette
const FETCH_TIMEOUT_MS = 20000;
const MAX_CONTENT_CHARS = 12000; // an Gemini gereichter Seitentext (gekürzt)
const DAILY_CAP = Number(process.env.WR_DAILY_CAP || 120); // global pro Instanz
const IP_CAP = Number(process.env.WR_IP_CAP || 15);        // pro IP und Tag

// In-Memory-Counter (best effort, pro Function-Instanz)
const state = { day: "", count: 0, perIp: new Map() };

const SYSTEM_PROMPT = `Du bist „Der Röstmeister" — ein selbstbewusster, schlagfertiger deutscher Comedy-Roast-Profi, der Websites röstet wie ein Stand-up-Comedian beim Promi-Roast.

Du bekommst den ECHTEN, gescrapten Inhalt einer Website (Titel, Meta-Description, Überschriften, sichtbarer Text). Deine Aufgabe: diese Website frech, pointiert und WITZIG rösten — und am Ende einen ehrlich nützlichen Tipp geben.

EISERNE REGELN:
- Roaste AUSSCHLIESSLICH auf Basis des tatsächlich gelieferten Inhalts. Erfinde NICHTS — keine Features, keine Zahlen, keine Bilder, die nicht im Input stehen.
- Wenn der Inhalt leer, unverständlich oder offensichtlich keine echte Website ist: setze "error" auf einen kurzen String und lasse roasts/observations leer. Röste dann NICHT.
- Jeder Roast-Spruch muss an eine ECHTE Beobachtung gekoppelt sein (Headline, CTA-Mangel, Buzzword-Dichte, Textwüste, fehlende Klarheit, generische Floskeln, Ladezeit-Indizien, Mobile-Hinweise). Nenne konkrete Beobachtungen in "observations".
- Ton: deutsch, frech, schlagfertig, übertrieben-theatralisch wie ein Comedy-Roast. Wortwitz und Übertreibung sind erwünscht.
- NIEMALS beleidigend, diskriminierend oder über geschützte Merkmale (Herkunft, Religion, Geschlecht, Aussehen einer Person, Behinderung). Geröstet wird die WEBSITE, nie ein Mensch. Keine Beleidigungen unter der Gürtellinie.
- "realTip" beginnt IMMER mit "Spaß beiseite: " und gibt einen einzigen, konkreten, umsetzbaren Verbesserungstipp.
- "verdict" ist ein kurzes Röstgrad-Verdikt passend zum Score (Sprache wie ein Grill-/Küchen-Urteil).
- "score" ist 0-100: niedrig = die Seite ist eine Katastrophe (verkohlt), hoch = die Seite ist richtig gut (Sterneküche). Sei fair: gute Seiten kriegen hohe Scores, auch wenn du sie trotzdem witzig anstichst.
- 3 bis 5 Roast-Sprüche. Jeder kurz und knackig (max. ~160 Zeichen), eigenständig lustig.

Antworte NUR mit dem JSON nach dem Schema.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    error: { type: "STRING" },
    score: { type: "NUMBER" },
    verdict: { type: "STRING" },
    roasts: { type: "ARRAY", items: { type: "STRING" } },
    realTip: { type: "STRING" },
    observations: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["score", "verdict", "roasts", "realTip", "observations"],
};

function hostOf(value) {
  try { return new URL(value).hostname; } catch (e) { return ""; }
}

function originAllowed(req) {
  const src = req.headers.origin || req.headers.referer || "";
  const host = hostOf(src);
  return ALLOWED_HOSTS.includes(host) || VERCEL_RE.test(host);
}

// SSRF-Schutz: nur öffentliche http/https-URLs, keine internen/privaten Hosts.
function classifyTarget(raw) {
  let u;
  try { u = new URL(raw); } catch (e) { return { ok: false, reason: "Das sieht nicht nach einer URL aus." }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "Nur http(s)-Adressen, bitte." };
  }
  const host = u.hostname.toLowerCase();
  // Hostnamen ohne Punkt (interne Namen) und localhost ablehnen
  if (host === "localhost" || host === "::1" || !host.includes(".")) {
    return { ok: false, reason: "Interne Adressen werden nicht geröstet." };
  }
  if (host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "Interne Adressen werden nicht geröstet." };
  }
  // IPv4-Literale auf private/reservierte Bereiche prüfen
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const priv =
      a === 0 || a === 127 || a === 10 ||
      (a === 169 && b === 254) ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      a >= 224; // Multicast/reserviert
    if (priv) return { ok: false, reason: "Private IP-Bereiche werden nicht geröstet." };
  }
  // IPv6-Literale grundsätzlich ablehnen (keine sinnvolle Roast-Ziel-Klasse, SSRF-Fläche)
  if (host.includes(":")) {
    return { ok: false, reason: "IPv6-Adressen werden nicht geröstet." };
  }
  return { ok: true, url: u.toString(), host };
}

function capExceeded(req) {
  const today = new Date().toISOString().slice(0, 10);
  if (state.day !== today) { state.day = today; state.count = 0; state.perIp.clear(); }
  const ip = (req.headers["x-forwarded-for"] || "?").split(",")[0].trim();
  const ipCount = state.perIp.get(ip) || 0;
  if (state.count >= DAILY_CAP || ipCount >= IP_CAP) return true;
  state.count += 1;
  state.perIp.set(ip, ipCount + 1);
  return false;
}

// Firecrawl scrape → kompakter Seitenkontext.
async function scrapePage(apiKey, url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: FETCH_TIMEOUT_MS - 2000,
        blockAds: true,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      const err = new Error(`Firecrawl HTTP ${res.status}: ${t.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const d = data && data.data ? data.data : {};
    const meta = d.metadata || {};
    const md = (d.markdown || "").trim();
    return {
      title: (meta.title || meta.ogTitle || "").trim(),
      description: (meta.description || meta.ogDescription || "").trim(),
      markdown: md.slice(0, MAX_CONTENT_CHARS),
      length: md.length,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(apiKey, model, target, page) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const userContent =
    `Hier ist der gescrapte Inhalt der zu röstenden Website.\n\n` +
    `URL: ${target}\n` +
    `Titel: ${page.title || "(kein Titel)"}\n` +
    `Meta-Description: ${page.description || "(keine)"}\n` +
    `Sichtbarer Inhalt (Länge ${page.length} Zeichen, ggf. gekürzt):\n"""\n${page.markdown || "(leer)"}\n"""\n\n` +
    `Röste diese Website nach den Regeln.`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ parts: [{ text: userContent }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.9,
      // Gemini-2.5-Flash verbraucht „Thinking"-Tokens, die ins Limit zählen.
      // Thinking aus + großzügiges Limit, sonst wird das JSON abgeschnitten
      // (finishReason MAX_TOKENS → leerer Text → JSON.parse scheitert).
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 2048,
    },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      const err = new Error(`Gemini ${model} HTTP ${res.status}: ${t.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini: leere Antwort");
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

// Roast normalisieren + validieren (Anti-Halluzination + Schema-Härtung).
function normalizeRoast(r) {
  if (!r || typeof r !== "object") return null;
  if (r.error && typeof r.error === "string" && r.error.trim()) {
    return { error: r.error.trim().slice(0, 240) };
  }
  let score = Math.round(Number(r.score));
  if (!Number.isFinite(score)) return null;
  score = Math.max(0, Math.min(100, score));
  const roasts = Array.isArray(r.roasts)
    ? r.roasts.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 5)
    : [];
  if (roasts.length < 3) return null; // weniger als 3 valide Sprüche = ungültig
  const observations = Array.isArray(r.observations)
    ? r.observations.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 6)
    : [];
  let realTip = String(r.realTip || "").trim();
  if (!realTip) return null;
  if (!/^Spaß beiseite/i.test(realTip)) realTip = "Spaß beiseite: " + realTip;
  const verdict = String(r.verdict || "").trim().slice(0, 80) || verdictFor(score);
  return { error: null, score, verdict, roasts, realTip, observations };
}

function verdictFor(score) {
  if (score <= 20) return "verkohlt 💀";
  if (score <= 40) return "well done, leider";
  if (score <= 60) return "medium — geht besser";
  if (score <= 80) return "schön kross 🔥";
  return "Sterneküche 👨‍🍳";
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Nur POST" });
  }
  if (!originAllowed(req)) {
    return res.status(403).json({ ok: false, error: "Zugriff nur über die Roast-Seite" });
  }

  const geminiKey = process.env.GOOGLE_AI_STUDIO_KEY;
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (!geminiKey || !firecrawlKey) {
    return res.status(503).json({ ok: false, fallback: true, error: "Live-Röstung gerade nicht konfiguriert" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const rawUrl = body && typeof body.url === "string" ? body.url.trim() : "";

  if (!rawUrl) {
    return res.status(400).json({ ok: false, error: "Keine URL empfangen" });
  }
  if (rawUrl.length > 2048) {
    return res.status(413).json({ ok: false, error: "URL zu lang" });
  }

  const t = classifyTarget(rawUrl);
  if (!t.ok) {
    return res.status(400).json({ ok: false, error: t.reason });
  }

  if (capExceeded(req)) {
    // Graceful: Frontend fällt auf gestagte Beispiel-Röstung zurück.
    return res.status(429).json({ ok: false, fallback: true, error: "Tages-Limit der Live-Röstung erreicht" });
  }

  // 1) Seite scrapen
  let page;
  try {
    page = await scrapePage(firecrawlKey, t.url);
  } catch (e) {
    console.error("scrape-error:", e && e.message);
    if (e.name === "AbortError") {
      return res.status(200).json({
        ok: true, model: "none",
        roast: { error: "Deine Seite hat ewig gebraucht — so lange wartet nicht mal mein Grill." },
      });
    }
    // Seite nicht ladbar → ehrlicher error-Roast, NIE Inhalte erfinden.
    return res.status(200).json({
      ok: true, model: "none",
      roast: { error: "Deine Seite hat sich vor mir versteckt — verdächtig. Erreichbar ist sie für mich gerade nicht." },
    });
  }

  // Leer / kein verwertbarer Inhalt → error-Roast (Anti-Halluzination).
  if (!page || ((page.markdown || "").length < 40 && !page.title)) {
    return res.status(200).json({
      ok: true, model: "none",
      roast: { error: "Da war fast nichts zu rösten — die Seite ist so leer, dass selbst mein Feuer ausgegangen ist." },
    });
  }

  // 2) Rösten
  let lastErr = null;
  for (const model of MODELS) {
    try {
      const raw = await callGemini(geminiKey, model, t.url, page);
      const roast = normalizeRoast(raw);
      if (!roast) {
        // Modell hat kein valides Roast geliefert → nächstes Modell / Fallback
        lastErr = new Error("invalid roast shape");
        continue;
      }
      return res.status(200).json({ ok: true, model, host: t.host, roast });
    } catch (e) {
      lastErr = e;
      if (e.status && e.status < 500 && e.status !== 429 && e.status !== 404) break;
    }
  }
  console.error("roast-error:", lastErr && lastErr.message);
  return res.status(502).json({ ok: false, fallback: true, error: "Der Röstmeister macht gerade Rauchpause" });
};

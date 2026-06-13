/* Live-API-Test: ruft den /api/roast-Handler DIREKT auf (mock req/res),
 * exerziert echte Firecrawl- + Gemini-Calls. Keine localhost-Sockets noetig.
 * Laedt Keys aus agent-studio/.env. Nutzung: node tests/test_live_api.mjs */
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const envPath = "/Users/Osman/Desktop/APPS/agent-studio/.env";
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const handler = require("../api/roast.js");

function mockReqRes(url) {
  const req = { method: "POST", headers: { origin: "http://localhost" }, body: { url } };
  let out = { status: 0, json: null };
  const res = {
    setHeader() {},
    status(c) { out.status = c; return res; },
    json(o) { out.json = o; return res; },
  };
  return { req, res, out };
}

async function call(url) {
  const { req, res, out } = mockReqRes(url);
  await handler(req, res);
  return out;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (detail ? "  [" + detail + "]" : "")); }
}

(async () => {
  // 1) Echte Seite → echter Roast, Schema-valide
  const r = await call("https://osai.solutions");
  console.log("\n[osai.solutions] HTTP", r.status, "model", r.json && r.json.model);
  const roast = r.json && r.json.roast;
  if (roast) {
    console.log("  score:", roast.score, "verdict:", roast.verdict, "error:", roast.error);
    (roast.roasts||[]).forEach((x,i)=>console.log("    R"+(i+1)+":", x));
    console.log("  tip:", roast.realTip);
    console.log("  obs:", (roast.observations||[]).join(" / "));
  }
  check("osai: HTTP 200", r.status === 200, String(r.status));
  check("osai: ok=true", r.json && r.json.ok === true);
  check("osai: kein error (echte Seite)", roast && !roast.error);
  check("osai: score 0-100", roast && typeof roast.score === "number" && roast.score >= 0 && roast.score <= 100);
  check("osai: 3-5 Sprueche", roast && roast.roasts && roast.roasts.length >= 3 && roast.roasts.length <= 5);
  check("osai: realTip beginnt mit 'Spass beiseite'", roast && /^Spaß beiseite/i.test(roast.realTip));
  check("osai: observations vorhanden", roast && Array.isArray(roast.observations) && roast.observations.length >= 1);

  // 2) SSRF-Block (kein Netzwerk-Call — Validierung vorher)
  const ssrf1 = await call("http://localhost:3000");
  check("SSRF: localhost 400", ssrf1.status === 400 && !ssrf1.json.ok, JSON.stringify(ssrf1.json));
  const ssrf2 = await call("http://192.168.1.1/admin");
  check("SSRF: 192.168.x 400", ssrf2.status === 400 && !ssrf2.json.ok);
  const ssrf3 = await call("http://10.0.0.5");
  check("SSRF: 10.x 400", ssrf3.status === 400 && !ssrf3.json.ok);
  const ssrf4 = await call("http://169.254.169.254/latest/meta-data");
  check("SSRF: 169.254 (Cloud-Metadata) 400", ssrf4.status === 400 && !ssrf4.json.ok);
  const proto = await call("ftp://example.com");
  check("Nur http(s): ftp abgelehnt", proto.status === 400 && !proto.json.ok);
  const internal = await call("http://intranet");
  check("Interner Host ohne Punkt abgelehnt", internal.status === 400 && !internal.json.ok);

  // 3) Anti-Halluzination: unerreichbare Domain → error-Roast, KEINE erfundenen Inhalte
  const dead = await call("https://this-domain-truly-does-not-exist-9281736.de");
  console.log("\n[dead domain] HTTP", dead.status, "roast.error:", dead.json && dead.json.roast && dead.json.roast.error);
  check("dead: HTTP 200 (graceful)", dead.status === 200);
  check("dead: roast.error gesetzt", dead.json && dead.json.roast && !!dead.json.roast.error);
  check("dead: keine erfundenen Sprueche", dead.json && dead.json.roast && !dead.json.roast.roasts);

  console.log(`\n${fail === 0 ? "LIVE-API GRUEN" : "LIVE-API ROT"} — ${pass}/${pass+fail} Checks`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });

#!/usr/bin/env python3
"""Gate 1 — MVP-Kern: URL → Roast end-to-end (deterministisch, ?fast=1),
SSRF/Validierungs-Logik, error-Fall, Schutzschicht-Hooks.
Standalone (kein pytest). Startet eigenen Dev-Server im MOCK-Modus."""
import sys, os, subprocess, time, signal, urllib.request, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("WR_PORT", "8761"))
BASE = os.environ.get("WR_BASE", f"http://127.0.0.1:{PORT}")
EXTERNAL = bool(os.environ.get("WR_BASE"))

CHECKS = []
def check(name, cond, detail=""):
    CHECKS.append((name, bool(cond), detail))
    print(("  PASS " if cond else "  FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))

def start_server():
    if EXTERNAL:
        return None
    env = dict(os.environ, WR_MOCK="1")
    proc = subprocess.Popen(["node", "dev-server.mjs", str(PORT)], cwd=ROOT, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            urllib.request.urlopen(BASE + "/", timeout=1); break
        except Exception:
            time.sleep(0.1)
    return proc

def run(page):
    page.goto(BASE + "/?fast=1", wait_until="networkidle")

    # --- Statik: Hero, Form, Mascot, Footer-Brand
    check("Hero-Claim sichtbar", "rösten" in (page.text_content(".hero-claim") or "").lower())
    check("URL-Input vorhanden", page.locator("#url-input").count() == 1)
    check("Rösten-Button vorhanden", page.locator("[data-testid=roast-btn]").count() == 1)
    check("Röstmeister-Mascot (SVG) da", page.locator(".mascot-svg").count() == 1)
    check("Live-Counter sichtbar", page.locator("[data-testid=live-counter]").count() == 1)
    check("powered by OsAI im Footer", page.locator(".footer-brand img[alt='OsAI']").count() == 1)

    # --- normalizeUrl: schema-loses Input bekommt https:// vorangestellt
    norm = page.evaluate("() => window.__wr.normalizeUrl('example.com')")
    check("normalizeUrl ergänzt https://", norm == "https://example.com", norm)

    # --- verdictFor: Röstgrad-Labels nach Konzept §3
    labels = page.evaluate("""() => ({
        a: window.__wr.verdictFor(10), b: window.__wr.verdictFor(30),
        c: window.__wr.verdictFor(55), d: window.__wr.verdictFor(75),
        e: window.__wr.verdictFor(95) })""")
    check("Label 0-20 = verkohlt", "verkohlt" in labels["a"], labels["a"])
    check("Label 21-40 = well done", "well done" in labels["b"], labels["b"])
    check("Label 41-60 = medium", "medium" in labels["c"], labels["c"])
    check("Label 61-80 = schön kross", "kross" in labels["d"], labels["d"])
    check("Label 81-100 = Sterneküche", "Sterneküche" in labels["e"], labels["e"])

    # --- SSRF / Validierungs-Pfad über die echte API (MOCK liefert die Server-Klassifikation)
    def api_roast(url):
        req = urllib.request.Request(BASE + "/api/roast", method="POST",
            data=json.dumps({"url": url}).encode(),
            headers={"Content-Type": "application/json", "Origin": BASE})
        try:
            r = urllib.request.urlopen(req, timeout=10)
            return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    st, b = api_roast("http://localhost:3000")
    check("SSRF: localhost wird abgelehnt (kein ok)", not b.get("ok"), f"{st} {b}")
    st, b = api_roast("http://192.168.0.1")
    check("SSRF: 192.168.x abgelehnt", not b.get("ok"), f"{st} {b}")

    # --- End-to-end: echte URL → Score + Sprüche (deterministisch, fast)
    els_input = page.locator("#url-input")
    els_input.fill("example.com")
    page.click("[data-testid=roast-btn]")
    page.wait_for_selector("[data-testid=result]:not([hidden])", timeout=10000)
    page.wait_for_selector("[data-testid=score-num]", timeout=10000)

    score_txt = (page.text_content("[data-testid=score-num]") or "").strip()
    check("Score ist eine Zahl 0-100", score_txt.isdigit() and 0 <= int(score_txt) <= 100, score_txt)
    label = (page.text_content("[data-testid=score-label]") or "").strip()
    check("Röstgrad-Label gesetzt", len(label) > 2, label)
    roasts = page.locator("#roast-list .roast-line").count()
    check("3-5 Roast-Sprüche", 3 <= roasts <= 5, str(roasts))
    tip = (page.text_content("[data-testid=real-tip]") or "").strip()
    check("Echter Tipp beginnt mit 'Spaß beiseite'", tip.startswith("Spaß beiseite"), tip[:40])
    card_url = (page.text_content("[data-testid=card-url]") or "").strip()
    check("Karte zeigt geröstete Domain", "example.com" in card_url, card_url)

    # --- error-Fall: kaputte/unerreichbare URL → charmanter Fehler, kein Stacktrace
    page.click("[data-testid=again-btn]")
    page.locator("#url-input").fill("broken-nonexistent-xyz.test")
    page.click("[data-testid=roast-btn]")
    page.wait_for_selector("[data-testid=result]:not([hidden])", timeout=10000)
    err_line = (page.text_content("#roast-list .roast-line") or "")
    check("error-Fall: charmanter Fehlertext", "versteckt" in err_line or "nicht erreichbar" in (page.text_content("[data-testid=score-label]") or ""), err_line[:60])
    check("error-Fall: kein Stacktrace im UI", "Error" not in err_line and "undefined" not in err_line, err_line[:60])

def main():
    proc = start_server()
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            run(page)
            check("keine JS-Pageerrors", not errors, "; ".join(errors[:3]))
            browser.close()
    finally:
        if proc:
            proc.send_signal(signal.SIGTERM)
            try: proc.wait(timeout=5)
            except Exception: proc.kill()
    failed = [c for c in CHECKS if not c[1]]
    print(f"\n{'GATE 1 GRUEN' if not failed else 'GATE 1 ROT'} — {len(CHECKS)-len(failed)}/{len(CHECKS)} Checks")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()

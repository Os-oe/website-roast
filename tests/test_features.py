#!/usr/bin/env python3
"""Gate 2 — Features: Röst-Animation + Ticker, Count-up, Share-Karte,
'andere rösten', localStorage-Historie, Tageszähler, graceful Cap-/Error-States.
Standalone. Dev-Server im MOCK-Modus."""
import sys, os, subprocess, time, signal, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("WR_PORT", "8762"))
BASE = os.environ.get("WR_BASE", f"http://127.0.0.1:{PORT}")
EXTERNAL = bool(os.environ.get("WR_BASE"))

CHECKS = []
def check(name, cond, detail=""):
    CHECKS.append((name, bool(cond), detail))
    print(("  PASS " if cond else "  FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))

def start_server():
    if EXTERNAL: return None
    env = dict(os.environ, WR_MOCK="1")
    proc = subprocess.Popen(["node", "dev-server.mjs", str(PORT)], cwd=ROOT, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try: urllib.request.urlopen(BASE + "/", timeout=1); break
        except Exception: time.sleep(0.1)
    return proc

def do_roast(page, url):
    page.locator("#url-input").fill(url)
    page.click("[data-testid=roast-btn]")
    page.wait_for_selector("[data-testid=result]:not([hidden])", timeout=10000)

def run(page):
    # ---- Röst-Animation + Ticker (in normalem Tempo, nicht fast) ----
    page.goto(BASE + "/", wait_until="networkidle")
    page.locator("#url-input").fill("example.com")
    page.click("[data-testid=roast-btn]")
    # Während des Röstens muss das Overlay sichtbar sein + Ticker laufen
    page.wait_for_selector("[data-testid=roasting]:not([hidden])", timeout=5000)
    check("Röst-Overlay erscheint", page.is_visible("[data-testid=roasting]"))
    t1 = page.text_content("[data-testid=ticker]")
    page.wait_for_timeout(700)
    t2 = page.text_content("[data-testid=ticker]")
    check("Ticker wechselt Zeilen", t1 != t2, f"{t1!r}->{t2!r}")
    heat = page.evaluate("() => getComputedStyle(document.getElementById('heat-fill')).width")
    check("Hitze-Meter füllt sich", heat not in ("0px", "auto", ""), heat)
    # Ergebnis kommt
    page.wait_for_selector("[data-testid=result]:not([hidden])", timeout=10000)
    page.wait_for_selector("[data-testid=roasting]", state="hidden", timeout=4000)
    check("Overlay schließt nach Ergebnis", not page.is_visible("[data-testid=roasting]"))

    # ---- Count-up: Score erreicht Zielwert ----
    page.wait_for_timeout(1400)
    score = (page.text_content("[data-testid=score-num]") or "").strip()
    check("Score-Count-up endet bei valider Zahl", score.isdigit() and 0 <= int(score) <= 100, score)

    # ---- Share-Karte: html-to-image erzeugt ein PNG ----
    has_lib = page.evaluate("() => !!window.htmlToImage")
    check("html-to-image geladen", has_lib)
    # Share-Button gibt Lade-Feedback (kein stummes Warten)
    page.click("[data-testid=share-btn]")
    busy_label = page.evaluate("""() => { const b=document.getElementById('share-btn'); return {busy:b.dataset.busy, txt:b.textContent}; }""")
    check("Share-Button zeigt Lade-Status", busy_label["busy"] == "1" or "erstellt" in busy_label["txt"] or "verfügbar" in busy_label["txt"], str(busy_label))
    page.wait_for_timeout(2500)  # restore
    if has_lib:
        data_url = page.evaluate("""async () => {
          try { return await window.htmlToImage.toPng(document.getElementById('roast-card'),
                 {pixelRatio:2, backgroundColor:'#0c0a09'}); }
          catch(e) { return 'ERR:' + e.message; }
        }""")
        check("Share-Karte rendert als PNG-DataURL", isinstance(data_url, str) and data_url.startswith("data:image/png") and len(data_url) > 5000, (data_url or "")[:40])

    # ---- localStorage-Historie + Zähler ----
    hist = page.evaluate("() => JSON.parse(localStorage.getItem('wr_history') || '[]')")
    check("Historie in localStorage", isinstance(hist, list) and len(hist) >= 1, str(len(hist)))
    check("Historie-Block sichtbar", page.is_visible("[data-testid=history]"))
    cnt = page.text_content("#counter-num")
    check("Tageszähler ist eine Zahl", (cnt or "").strip().isdigit(), cnt)

    # ---- 'andere rösten' setzt zurück ----
    page.click("[data-testid=again-btn]")
    page.wait_for_timeout(500)
    check("'Andere rösten' blendet Ergebnis aus", not page.is_visible("[data-testid=result]"))
    check("Input geleert", (page.input_value("#url-input") or "") == "")

    # ---- zweite Röstung erhöht Historie ----
    do_roast(page, "zweite-seite.de")
    page.wait_for_timeout(300)
    hist2 = page.evaluate("() => JSON.parse(localStorage.getItem('wr_history') || '[]')")
    check("Historie wächst auf 2", len(hist2) >= 2, str(len(hist2)))

    # ---- graceful CAP-State: ?force=cap → gestagte Röstung, KEIN Fehlerbildschirm ----
    page.goto(BASE + "/?force=cap&fast=1", wait_until="networkidle")
    do_roast(page, "example.com")
    page.wait_for_timeout(200)
    cap_roasts = page.locator("#roast-list .roast-line").count()
    cap_score = (page.text_content("[data-testid=score-num]") or "").strip()
    check("Cap-State: gestagte Röstung gezeigt (3-5 Sprüche)", 3 <= cap_roasts <= 5, str(cap_roasts))
    check("Cap-State: gültiger Score statt Fehler", cap_score.isdigit(), cap_score)
    check("Cap-State: kein Stacktrace", "Error" not in (page.text_content("#roast-list") or ""))

    # ---- ERROR-State: kaputte URL → charmanter Fehler ----
    page.goto(BASE + "/?fast=1", wait_until="networkidle")
    do_roast(page, "broken-nonexistent-xyz.test")
    err = page.text_content("#roast-list .roast-line") or ""
    check("Error-State: charmanter Fehlertext", "versteckt" in err, err[:50])
    tip = page.text_content("[data-testid=real-tip]") or ""
    check("Error-State: hilfreicher Hinweis statt Crash", "Spaß beiseite" in tip, tip[:40])

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
    print(f"\n{'GATE 2 GRUEN' if not failed else 'GATE 2 ROT'} — {len(CHECKS)-len(failed)}/{len(CHECKS)} Checks")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()

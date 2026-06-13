#!/usr/bin/env python3
"""Gate 3 — Polish: Mobile (390px) ohne Overflow, Mascot integriert + animiert,
OG-Meta + Share-Tags, First-Load schlank, Ladbarkeit der Assets.
Standalone. Dev-Server im MOCK-Modus."""
import sys, os, subprocess, time, signal, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("WR_PORT", "8763"))
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

def run_desktop(page):
    page.goto(BASE + "/?fast=1", wait_until="networkidle")
    # OG / Share-Meta vorhanden
    og_title = page.get_attribute("meta[property='og:title']", "content")
    og_img = page.get_attribute("meta[property='og:image']", "content")
    tw_card = page.get_attribute("meta[name='twitter:card']", "content")
    check("OG-Title gesetzt", bool(og_title and "Roast" in og_title), og_title)
    check("OG-Image zeigt auf og.png", bool(og_img and og_img.endswith("og.png")), og_img)
    check("Twitter-Card summary_large_image", tw_card == "summary_large_image", tw_card)
    # OG-Asset lädt
    st = urllib.request.urlopen(BASE + "/assets/img/og.png", timeout=5).status
    check("og.png erreichbar", st == 200, str(st))
    # Mascot animiert (SVG hat float-Animation)
    anim = page.evaluate("() => getComputedStyle(document.querySelector('.mascot-svg')).animationName")
    check("Mascot hat Animation", anim and anim != "none", anim)
    # Mascot-Mood wechselt nach Röstung
    page.locator("#url-input").fill("example.com")
    page.click("[data-testid=roast-btn]")
    page.wait_for_selector("[data-testid=result]:not([hidden])", timeout=10000)
    mood = page.get_attribute("#mascot-stage", "data-mood")
    check("Mascot-Mood 'done' nach Röstung", mood == "done", mood)

def run_mobile(page):
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(BASE + "/?fast=1", wait_until="networkidle")
    # kein horizontaler Overflow
    sw = page.evaluate("() => document.documentElement.scrollWidth")
    cw = page.evaluate("() => document.documentElement.clientWidth")
    check("Kein horizontaler Overflow (Hero)", sw <= cw + 1, f"scroll={sw} client={cw}")
    # Hero-Claim sichtbar + Form bedienbar
    check("Hero-Claim sichtbar (mobil)", page.is_visible(".hero-claim"))
    check("Rösten-Button sichtbar (mobil)", page.is_visible("[data-testid=roast-btn]"))
    # Button hat Full-Width-Tauglichkeit (>= 280px breit auf 390er Viewport)
    bw = page.evaluate("() => document.getElementById('roast-btn').getBoundingClientRect().width")
    check("Button breit genug mobil (>=280px)", bw >= 280, str(round(bw)))
    # Röstung durchführen → Ergebnis ohne Overflow
    page.locator("#url-input").fill("example.com")
    page.click("[data-testid=roast-btn]")
    page.wait_for_selector("[data-testid=result]:not([hidden])", timeout=10000)
    page.wait_for_timeout(300)
    sw2 = page.evaluate("() => document.documentElement.scrollWidth")
    check("Kein horizontaler Overflow (Ergebnis)", sw2 <= cw + 1, f"scroll={sw2} client={cw}")
    # Karte + Aktionen sichtbar
    check("Roast-Karte sichtbar (mobil)", page.is_visible("[data-testid=roast-card]"))
    check("Share-Button sichtbar (mobil)", page.is_visible("[data-testid=share-btn]"))
    # Screenshots für Sicht-Gate
    os.makedirs(os.path.join(ROOT, "making-of", "qa"), exist_ok=True)
    page.screenshot(path=os.path.join(ROOT, "making-of", "qa", "mobile-result.png"))

def main():
    proc = start_server()
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            run_desktop(page)
            # desktop hero screenshot
            page.goto(BASE + "/?fast=1", wait_until="networkidle")
            page.wait_for_timeout(400)
            os.makedirs(os.path.join(ROOT, "making-of", "qa"), exist_ok=True)
            page.screenshot(path=os.path.join(ROOT, "making-of", "qa", "desktop-hero.png"))
            run_mobile(page)
            check("keine JS-Pageerrors", not errors, "; ".join(errors[:3]))
            browser.close()
    finally:
        if proc:
            proc.send_signal(signal.SIGTERM)
            try: proc.wait(timeout=5)
            except Exception: proc.kill()
    failed = [c for c in CHECKS if not c[1]]
    print(f"\n{'GATE 3 GRUEN' if not failed else 'GATE 3 ROT'} — {len(CHECKS)-len(failed)}/{len(CHECKS)} Checks")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()

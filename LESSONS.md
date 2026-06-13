# Lessons — Roast My Website (One-Prompt-Lauf, 2026-06-13)

Autonomer Build (Rezept `app` + Live-KI-Pfad). Wiederverwendbar für künftige
Live-KI-Tools (URL/Text rein → LLM-Antwort raus → teilbare Karte).

## Live-KI-Pfad (Firecrawl + Gemini)
- **Gemini 2.5-Flash „Thinking" frisst das Token-Limit.** Bei `maxOutputTokens`
  von 800/1200 kam fast nur Thinking, der sichtbare JSON-Text war 38–95 Zeichen
  und `finishReason: MAX_TOKENS` → JSON.parse scheitert → unnötiger Fallback aufs
  (tote) Zweitmodell. Fix: **`thinkingConfig: { thinkingBudget: 0 }` + `maxOutputTokens: 2048`.**
  Mit 2048 + Thinking aus: sauberes `finishReason: STOP`, valides JSON.
- **Modell-IDs altern.** `gemini-2.0-flash` gibt bei `generateContent` 404
  „no longer available", obwohl es im `/models`-Listing steht. Verifizierte
  Flash-Kette: **`gemini-2.5-flash` → `gemini-flash-latest`** (Alias bleibt gültig).
- **salvageJson() als Netz:** abgeschnittenes JSON bis zur letzten `}` kürzen und
  erneut parsen, bevor man das Modell wechselt. Billiger als ein zweiter Call.
- **Firecrawl `/v1/scrape`** mit `formats:["markdown"], onlyMainContent:true` liefert
  Titel + Meta + Haupttext kompakt. Auf ~12 000 Zeichen kürzen reicht fürs Rösten.
- **Anti-Halluzination hält:** Tote/leere Domains → `roast.error` gesetzt, KEINE
  erfundenen Sprüche. Live verifiziert (osai.solutions, fellbach.de = echte
  Beobachtungen; nicht-existente Domain = ehrlicher error).

## Schutzschicht / SSRF (der Server holt fremde URLs!)
- Literal-Checks reichen NICHT: `http://2130706433` (= 127.0.0.1 dezimal),
  `0x7f000001` (hex), `0177...` (oktal), `[::1]` (IPv6) müssen explizit geblockt
  werden — sonst SSRF-Bypass. Regex auf rein-numerische/hex/oktale Hosts.
- DNS-Rebinding (öffentliche Domain → private IP) bleibt theoretisch offen, weil
  der eigentliche Abruf über **Firecrawl** (verwalteter Dienst mit eigenem Egress)
  läuft, nicht über unseren Server. Dokumentiert statt scheinabsichern.
- Origin/Referer-Lock + In-Memory-Caps (global + pro IP) wie bei `angebots-blitz`
  übernommen. Cap/Fehler → graceful auf gestagte Beispiel-Röstung (Conversion bleibt).

## Frontend / Test-Disziplin
- **`[hidden]` schlägt fehl, wenn eine CSS-Regel `display` setzt.** `.roasting`
  hatte `display: grid` → überschrieb das implizite `[hidden]{display:none}`,
  das Overlay fing trotz `hidden` alle Klicks ab. Fix: `.roasting[hidden]{display:none}`.
- **Deutsche Quotes in JS-Strings:** `„…"` mit STRAIGHT `"` als Schluss beendet
  den JS-String vorzeitig → „Invalid or unexpected token". Entweder durchgängig
  curly `…"` ODER ASCII-Quotes `'…'` im Klartext. `node --check` findet die Zeile.
- **Dev-Server muss JS/CSS als `charset=utf-8` ausliefern**, sonst interpretiert
  der Browser Multibyte-Umlaute als Latin-1 und der Parser bricht. (Vercel macht
  das in Prod automatisch — nur der eigene Static-Server war betroffen.)
- **Playwright: auf verstecktes Element warten** = `wait_for_selector(state="hidden")`,
  NICHT `[hidden]`-Selektor (der wartet auf `visible` und timed out garantiert).
- Deterministische Tests via `?fast=1` (gestagte Daten, keine Live-Calls) + Live-API
  separat über direkten Handler-Aufruf (mock req/res) — die context-mode-Sandbox
  erreicht localhost nicht, öffentliche URLs + In-Prozess-Handler aber schon.

## Assets / Budget
- **`image`-Monats-Cap war erschöpft (23,4/20 €).** budget-guard blockt → KI-Mascot
  + Motion-Loop bewusst zurückgestellt (Cap-Anhebung = User-Entscheidung, nicht
  autonom). Stattdessen **voll-animierter Inline-SVG-Röstmeister** (float, flame-
  dance, glow-pulse, Mood idle→roasting→done) @ 0 €. Liest premium, on-brand.
- **OG-Share-Bild frei gerendert:** gebrandete HTML-Karte → Playwright-Screenshot
  1200×630 → `og.png`. Kein Bildbudget, voll im Brand-Look.

## Ist-Kosten
| Posten | Menge | Ist |
|---|---|---|
| Firecrawl scrape (Build + Tests + Live-E2E) | ~10 Scrapes | 0,12 € |
| Gemini 2.5-Flash Roast | ~12 Calls | 0,05 € |
| KI-Mascot-Anker + Mimik-Varianten | — | 0,00 € (Cap erschöpft → SVG) |
| Motion-Loop (Kie i2v) | — | 0,00 € (CSS-Animation statt Video) |
| OG-Bild | 1 (Playwright) | 0,00 € |
| **Gesamt** | | **0,17 €** (Budget ~10 €, Schätzung 0,85 €) |

Hebel: Der ganze Wert steckt im Live-KI-Pfad (Firecrawl + Gemini), nicht in
gerenderten Assets — und der ist mit Cent-Beträgen pro Röstung extrem günstig.

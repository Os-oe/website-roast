/* Gestagte Beispiel-Roestungen + Ticker-Zeilen.
 * Verwendung:
 *  - Graceful Fallback, wenn die Live-Roestung das Tages-Cap erreicht oder ausfaellt
 *    (kein Fehlerbildschirm — Conversion bleibt erhalten).
 *  - Deterministische Datenquelle fuer Playwright (?fast=1 zeigt eine feste Roestung).
 *
 * Diese Sprueche roesten eine GENERISCHE Beispiel-Website (kein echter Inhalt) —
 * sie behaupten nie spezifische Fakten ueber eine reale Seite (Anti-Halluzination).
 * Woertliche Zitate stehen in einfachen Anfuehrungszeichen, um Quoting-Fallen zu vermeiden.
 */
window.STAGED_ROASTS = [
  {
    score: 38,
    verdict: "well done, leider",
    roasts: [
      "Deine Headline sagt 'Willkommen auf unserer Website' — danke, das war mir bei der Website-Adresse fast schon aufgefallen.",
      "Der Slider rotiert seit 2014 durch drei Stockfotos. Selbst das Model auf Bild 2 will längst nach Hause.",
      "'Wir sind ein junges, dynamisches Team' — euer Footer-Copyright sagt 2017. Eines von beiden lügt.",
      "Den CTA-Button such ich immer noch. Vielleicht ist er ja im selben Versteck wie eure Telefonnummer.",
    ],
    realTip: "Spaß beiseite: Ersetz das 'Willkommen' durch einen Satz, der in 3 Sekunden sagt, was du für wen tust — und pack genau einen klaren CTA above the fold.",
    observations: ["Generische Headline", "Veralteter Slider", "Kein klarer CTA"],
  },
  {
    score: 64,
    verdict: "schön kross 🔥",
    roasts: [
      "Saubere Seite, ehrlich. Aber dein Hero-Text liest sich, als hätte ihn ein Buzzword-Generator nach drei Kaffee geschrieben.",
      "'Innovativ, ganzheitlich, lösungsorientiert' — herzlichen Glückwunsch, du hast Bullshit-Bingo gewonnen, nur leider keinen Kunden überzeugt.",
      "Die Ladezeit ist okay. Okay heißt: Ich konnte gerade noch einen Kaffee NICHT holen.",
    ],
    realTip: "Spaß beiseite: Du bist nah dran. Mach den Hero-Text konkret — eine echte Zahl oder ein echtes Ergebnis statt drei Adjektiven — und die Seite zieht sofort an.",
    observations: ["Buzzword-Dichte im Hero", "Solide Struktur", "Ladezeit grenzwertig"],
  },
  {
    score: 22,
    verdict: "verkohlt 💀",
    roasts: [
      "Ich hab deine Seite geöffnet und mein Bildschirm hat reflexartig nach einem Cookie-Banner-Anwalt gerufen.",
      "Drei verschiedene Schriftarten im Hero. Das ist kein Design, das ist ein Geiseldrama.",
      "Mobil sieht die Seite aus, als wäre sie aus einem fahrenden Zug geworfen worden. Und der Zug hatte Verspätung.",
      "Der einzige Weiße-Raum-Profi hier bin ich — auf deiner Seite fängt nämlich nichts an zu atmen.",
    ],
    realTip: "Spaß beiseite: Reduzier auf EINE Schrift, EINE Akzentfarbe und gib jedem Block ordentlich Luft. Allein das hebt den Eindruck enorm.",
    observations: ["Schrift-Chaos", "Mobile kaputt", "Kein Whitespace"],
  },
];

window.STAGED_TICKER = [
  "Feuer wird angefacht …",
  "Lade Selbstbewusstsein der Startseite …",
  "Suche den CTA … noch nicht gefunden …",
  "Messe Ladezeit in geologischen Zeitaltern …",
  "Zähle Buzzwords … oh nein, mir gehen die Finger aus …",
  "Prüfe, ob das Hero-Bild ein Stockfoto ist … (Spoiler) …",
  "Befrage die Schriftarten, ob sie sich kennen …",
  "Lege Holz nach …",
  "Wende vorsichtig auf dem Grill …",
  "Letzter Schliff am Verriss …",
];

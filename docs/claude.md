# SV-Protokolle mit Claude

Claude kann Protokolle **erstellen** (aus Notizen/Transkript), **korrigieren** (nur Fehler)
und **überarbeiten** (professionell umformulieren) – immer im Format dieses Generators.
Das Ergebnis kommt als **Link**, der das Protokoll direkt in der Seite öffnet.

```
Notizen / JSON / Link ──► Claude + Skill ──► MCP-Server: prüfen, Link, JSON, PDF
                                                  │
                     …/SV/#import=<komprimiertes JSON> ──► Generator (GitHub Pages)
```

| Baustein | Was er macht | Wo |
|---|---|---|
| Skills | Anleitung je Modus: `protokoll-erstellen`, `-korrigieren`, `-ueberarbeiten` | `plugin/skills/` |
| MCP-Server | Tools `protokoll_format`, `_validate`, `_link`, `_decode_link`, `_save_json`, `_render_pdf` + 3 Prompts | `plugin/mcp/` |
| Link-Import | `#import=…` öffnet ein Protokoll; „Link kopieren“ / „JSON kopieren“ in der Seite | `script.js` |
| Schema | Einzige Formatdefinition | `schema/protokoll.schema.json` |

Der Server braucht nur **Node ≥ 22**, sonst nichts, und hat keine Abhängigkeiten. Die Daten im Link stehen
hinter dem `#` und werden nie an einen Server geschickt.

## Installation

**Claude Code** (Terminal oder Code-Tab der Desktop-App): Plugin inkl. Skills und MCP-Server
```
/plugin marketplace add ProfessorQuantumUniverse/SV
/plugin install sv-protokoll@sv-fws-ffm
```
Lokal entwickeln: `/plugin marketplace add C:\Pfad\zu\SV` statt des GitHub-Namens.

**Claude Desktop (Chat):** `npm run dist` baut `dist/`:
- `dist/sv-protokoll.mcpb` per Doppelklick bzw. unter *Einstellungen → Erweiterungen* installieren (MCP-Server)
- `dist/skills/*.zip` unter *Einstellungen → Fähigkeiten → Skills* hochladen

**claude.ai im Browser/Handy:** nur die Skill-ZIPs hochladen. Ohne MCP erzeugt Claude den Link
mit dem beiliegenden Python-Skript (Code-Ausführung muss aktiv sein).

## Benutzung

- „Erstelle ein SV-Protokoll aus diesen Notizen: …“ (oder Transkript anhängen)
- „Korrigiere dieses Protokoll: `https://…/SV/#import=…`“ (Link über **Link kopieren**)
- „Überarbeite das Protokoll, etwas kürzer bitte“ + JSON (über **JSON kopieren** oder Export)
- Als Slash-Befehl: MCP-Prompts `erstellen`, `korrigieren`, `ueberarbeiten`, in Claude Code zusätzlich
  `/sv-protokoll:protokoll-erstellen` usw.

Claude antwortet mit Link und kurzer Zusammenfassung. JSON-Datei oder PDF gibt es auf Wunsch
(Standardordner: Downloads). Öffnest du den Link, während schon ein Entwurf in der Seite ist,
fragt die Seite nach, bevor sie ihn ersetzt.

Audio: Claude braucht ein **Transkript** (Diktierfunktion, Teams/Zoom, Whisper). Das Transkript
wird dann wie Notizen verarbeitet.

Optionale Umgebungsvariablen des Servers: `SV_APP_URL` (z. B. `http://localhost:8123/`),
`SV_OUTPUT_DIR`, `SV_BROWSER` (Pfad zu Chrome/Edge, falls nicht automatisch gefunden).

## Entwicklung

- Inhalte **nur** in `schema/` und `shared/` bearbeiten (Stilleitfaden, Formatbeschreibung,
  Modi, Python-Skript). Danach `npm run build`: Das verteilt alles nach `plugin/`.
  `plugin/mcp/content/` und `plugin/skills/` sind generiert.
- `npm test`: Layout-, Link-, MCP- und PDF-Tests. Dabei wird auch geprüft, ob `plugin/`
  aktuell ist und ob das Python-Skript exakt wie der Server validiert.
- Neue Plugin-Version: `version` in `plugin/.claude-plugin/plugin.json` erhöhen.

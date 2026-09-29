# SV-Protokolle mit Claude

Claude **erstellt** Protokolle aus Notizen oder Transkripten, **korrigiert** sie (nur Fehler)
oder **überarbeitet** sie (kürzen, umformulieren, professionalisieren) – immer im Format dieses
Generators. **Die Antwort ist immer ein Link**, der das Protokoll direkt in der Seite öffnet.
Du schickst einen Link, du bekommst einen Link zurück.

```
Notizen / Link / JSON ──► Claude (Skill + MCP-Server) ──► [SV-Protokoll vom 27.1.2026 öffnen](…/SV/#import=…)
```

Die Protokolldaten stehen komprimiert hinter dem `#` im Link und werden nie an einen Server
geschickt.

## Einrichtung

Das Plugin `sv-protokoll` bringt drei Skills und einen MCP-Server mit. Die Chat- und die
Code-Umgebung der Desktop-App verwalten Plugins **getrennt**, deshalb musst du es in beiden
installieren, wenn du es in beiden nutzen willst.

| Umgebung | Weg | Einmal einrichten |
|---|---|---|
| **Claude Code** (Terminal) | Befehle | `claude plugin marketplace add ProfessorQuantumUniverse/SV`<br>`claude plugin install sv-protokoll@sv-fws-ffm` |
| **Desktop-App, Code-Modus** | Oberfläche | Plugins → Marketplace hinzufügen: `ProfessorQuantumUniverse/SV` → **SV-Protokoll** installieren |
| **Desktop-App, Chat-Modus** | Oberfläche | 1. Plugin wie oben installieren (bringt die Skills)<br>2. **MCP-Server extra installieren**, siehe unten (optional) |

- Die `/plugin`-Befehle gibt es nur im interaktiven Terminal (`claude`). In der Desktop-App
  geht es über die Oberfläche.
- **Aktualisieren:** Im Terminal `claude plugin marketplace update sv-fws-ffm`, in der App
  die Plugin-Aktualisierung. Neue Versionen erkennst du an `version` in
  `plugin/.claude-plugin/plugin.json`.
- Voraussetzungen: **Node** (für den MCP-Server; ≥ 22 nur für PDFs) und **Chrome oder Edge**
  (nur für PDFs). Fehlt der MCP-Server, erzeugen die Skills den Link mit dem beiliegenden
  Python-Skript.

### MCP-Server im Chat-Modus

Im Chat-Modus kommen über das Plugin **nur die Skills** an. Die laufen in der Cloud-Sandbox
von claude.ai, und den lokalen MCP-Server startet die App dafür nicht. Links, `diff` und
`preview` funktionieren trotzdem, weil die Skills dann das Python-Skript nutzen. Nur für
**PDF-Export** und **Dateien im Downloads-Ordner** brauchst du den MCP-Server lokal. Der kommt
als Desktop-Erweiterung dazu:

1. Im Repo `npm run dist` ausführen. Das erzeugt `dist/sv-protokoll.mcpb`.
2. In der Desktop-App **Einstellungen → Erweiterungen** öffnen und die `.mcpb` installieren
   (Doppelklick auf die Datei oder per Drag & Drop ins Fenster).
3. Beim Installieren den **Zielordner** für JSON und PDF bestätigen (Standard: Downloads) und
   die Erweiterung aktivieren.
4. Neuen Chat öffnen. Unter den Tools sollte jetzt **SV-Protokoll** stehen.

Nach einem Update (neue `version`) die `.mcpb` neu bauen und erneut installieren. Anders als
das Plugin aktualisiert sie sich nicht selbst.

<details>
<summary>Alternative ohne .mcpb: Eintrag in claude_desktop_config.json</summary>

Einstellungen → Entwickler → Konfiguration bearbeiten (Windows:
`%APPDATA%\Claude\claude_desktop_config.json`), Pfad an deinen Klon anpassen, App neu starten:

```json
{
  "mcpServers": {
    "sv-protokoll": {
      "command": "node",
      "args": ["C:\\Users\\<du>\\repos\\SV\\plugin\\mcp\\server.mjs"]
    }
  }
}
```

Vorteil: `git pull` reicht für Updates. Voraussetzung: Node im PATH.
</details>

### Ohne Plugin (claude.ai im Browser/Handy)

`npm run dist` erzeugt `dist/skills/*.zip`.
Lade sie bei claude.ai als Skills hoch (Code-Ausführung muss aktiv sein).

## Benutzung

| Du schreibst | Skill | Du bekommst |
|---|---|---|
| „Erstelle ein SV-Protokoll aus diesen Notizen: …“ (oder Transkript anhängen) | `protokoll-erstellen` | Link + offene Fragen |
| „Korrigiere `<Link>`“ | `protokoll-korrigieren` | Link + Liste der Korrekturen |
| „Kürze `<Link>`“, „Mach Punkt 3 professioneller“, „Ergänze bei SV-Raum, dass …“ | `protokoll-ueberarbeiten` | Link + wichtigste Änderungen |
| „Und als PDF, bitte“ | – | PDF im Downloads-Ordner |

- Den Link zu deinem aktuellen Entwurf holst du dir in der Seite über **Link kopieren**.
- Öffnest du einen Link, während schon ein anderer Entwurf in der Seite ist, fragt die Seite,
  bevor sie ihn ersetzt.
- JSON gibt es nur auf Nachfrage („…als JSON“ bzw. **JSON kopieren** in der Seite).
- Audio: Claude braucht ein **Transkript** (Diktierfunktion, Teams/Zoom, Whisper).
- Direkt aufrufen: in Claude Code `/sv-protokoll:protokoll-ueberarbeiten <Link> kürzer`;
  die MCP-Prompts `erstellen`, `korrigieren` und `ueberarbeiten` gibt es in allen Umgebungen.

<details>
<summary>MCP-Tools & Einstellungen</summary>

| Tool | Zweck |
|---|---|
| `protokoll_link` | prüft und liefert den Markdown-Link (Standard-Ausgabe) |
| `protokoll_decode_link` | Link → JSON |
| `protokoll_format` | Datenformat, Stilleitfaden, Schema, Beispiel |
| `protokoll_validate` | nur prüfen (inkl. Wörter je Punkt) |
| `protokoll_diff` | alt → neu: Punkte neu/geändert/entfernt, Wortzahl |
| `protokoll_preview` | Klartext-Vorschau wie gerendert |
| `protokoll_save_json`, `protokoll_render_pdf` | Datei im Downloads-Ordner (überschreibt nie) |

Ohne MCP bietet das Python-Skript dasselbe: `validate`, `link`, `decode`, `diff`, `preview`,
`stats`. Jeder Befehl nimmt statt einer Datei auch einen Link.

`protokoll` darf überall auch ein Link sein. Optionale Umgebungsvariablen: `SV_APP_URL`
(z. B. `http://localhost:8123/`), `SV_OUTPUT_DIR`, `SV_BROWSER` (Pfad zu Chrome/Edge).
</details>

## Entwicklung

| Datei | Inhalt |
|---|---|
| `schema/protokoll.schema.json` | Datenformat (einzige Quelle) |
| `shared/modi/*.md` | Die drei Skills (Frontmatter = Trigger-Beschreibung) |
| `shared/ausgabe.md` | Gemeinsame Regeln: Link-Ausgabe, Eingabe lesen |
| `shared/glossar.md` | Feste Begriffe und Abkürzungen (SV-Aktion, SSR, FS …) – **hier neue Begriffe ergänzen** |
| `shared/stil.md`, `shared/format.md`, `shared/beispiel.json` | Stilleitfaden, Formatdoku, Beispiel |
| `shared/sv_protokoll.py` | Python-Ersatz für Prüfung und Link |
| `plugin/mcp/` | MCP-Server (Node, ohne Abhängigkeiten) |

1. Nur `schema/` und `shared/` bearbeiten, dann `npm run build`. `plugin/skills/` und
   `plugin/mcp/content/` werden daraus erzeugt.
2. `npm test`: Layout, Links, MCP-Server, Python-Parität, PDF. Prüft auch, ob `plugin/`
   aktuell ist.
3. Für ein Release die `version` in `plugin/.claude-plugin/plugin.json` erhöhen, sonst
   bekommen installierte Plugins das Update nicht. Danach pushen.

<div align="center">

# 📝 SV-Protokoll-Generator

### Erstelle im Handumdrehen Protokolle der SV-Sitzungen – FWS Frankfurt.

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black) ![License](https://img.shields.io/badge/License-GPL%20v3-blue?style=for-the-badge)

[**🔗 Live Demo**](https://professorquantumuniverse.github.io/SV/)

</div>

---

Ein Werkzeug für die Schülervertretung der FWS Frankfurt: Sitzungsprotokolle schnell, einheitlich und ohne Formatierungs-Stress erstellen.

## ✨ Features

- 🧾 Strukturierte Protokoll-Vorlage mit Anwesenheitsliste, Themenübersicht und Protokollpunkten
- 📄 **Echter Seitenumbruch**: Die Seiten werden so dicht wie möglich gefüllt. Ein Punkt, der nicht mehr passt, rutscht komplett auf die nächste Seite – abgeschnitten wird nie etwas
- ✂️ Punkte, die länger als eine ganze Seite sind, werden sauber an Absatz- bzw. Wortgrenzen getrennt und mit „(Fortsetzung)“ weitergeführt
- 🔢 Automatische Seitennummerierung („Seite 2 von 4“)
- 🗳️ **Abstimmungstabellen** mit Ja / Nein / Enthaltung und automatisch berechnetem Ergebnis (angenommen, abgelehnt, unentschieden)
- 🕒 Optionale Angaben zu Ort und Uhrzeit der Sitzung
- ↕️ Punkte per Klick sortieren, duplizieren-freies Löschen, Live-Vorschau
- 💾 Automatisches Speichern im Browser, plus Export/Import als `.json`
- 🖨️ PDF über den nativen Druckdialog – die Vorschau ist pixelgenau das Ergebnis

## 🛠️ Tech-Stack

`HTML5` · `CSS3` · `JavaScript` – ohne Build-Schritt, ohne Abhängigkeiten zur Laufzeit.

## 🚀 Lokal starten

Die Seite braucht einen kleinen Webserver (wegen `localStorage` und der Schriftarten):

```bash
npx http-server -p 8123 -s .
# danach http://localhost:8123 öffnen
```

## 🧪 Tests

Die Layout-Logik ist automatisiert abgesichert – Seitenfüllung, Umbrüche,
Seitenzahlen, Tabellen, Persistenz und das Druck-Stylesheet:

```bash
npm install      # einmalig, installiert Playwright
npm test
```

Der Testlauf startet selbst einen Server, rendert echte A4-Seiten in Chromium
und prüft unter anderem, dass keine Seite überläuft und jede Seite (außer der
letzten) mindestens 80–88 % gefüllt ist.

## 🧩 Wie der Seitenumbruch funktioniert

Statt Höhen zu schätzen, misst der Generator echte Layouts: Zwei unsichtbare
A4-„Probeseiten“ mit exakt derselben Geometrie wie das Ergebnis nehmen jeden
Block probeweise auf und melden die tatsächliche Höhe zurück.

1. Ein Punkt wird auf die laufende Seite gesetzt, solange er dort hineinpasst.
2. Passt er nicht mehr, würde aber allein auf eine Seite passen, wandert er
   **komplett** auf die nächste Seite.
3. Nur wenn er auch allein zu groß ist, wird er getrennt – per Binärsuche
   zuerst an Absatz-, dann an Wortgrenzen, und niemals so, dass nur eine
   Überschrift mit ein paar Wörtern am Seitenende stehen bleibt.

---

<div align="center">

Teil meiner Projektsammlung · [**Alle Projekte ansehen →**](https://professorquantumuniverse.github.io/My-Projects/)

Made with ☕ & curiosity by **Lorenzo Bay-Müller** ([@ProfessorQuantumUniverse](https://github.com/ProfessorQuantumUniverse))

</div>

# ER Model Builder

Ein browserbasierter Editor zum Erstellen und Bearbeiten von Entity-Relationship-Modellen in Chen-Notation. Modelle lassen sich visuell auf einer interaktiven Zeichenfläche gestalten, lokal im Browser speichern und als PDF herunterladen.

## Funktionen

- Entitäten erstellen, auswählen, verschieben und löschen
- Attribute mit Datentypen sowie Primärschlüssel-, Nullable- und Unique-Kennzeichnung verwalten
- Entitäten über benannte Beziehungen verbinden und Kardinalitäten (`1:1`, `1:n`, `n:1`, `n:m`) festlegen
- Zeichenfläche verschieben und zoomen; Attribute unabhängig positionieren
- Änderungen rückgängig machen und wiederherstellen
- Modelle im Browser lokal speichern und über eine Modellverwaltung öffnen, umbenennen oder löschen
- Versionierte JSON-Modelle importieren und Diagramme als PDF herunterladen

Die Modelldaten bleiben lokal im Browser. Es gibt keine Benutzerkonten oder Cloud-Synchronisierung.

## Voraussetzungen

- Rust mit Unterstützung für Edition 2024
- Node.js, wenn auch die JavaScript-Modelltests ausgeführt werden sollen
- Optional: [just](https://just.systems/) für die bereitgestellten Kurzbefehle

## Starten

```sh
cargo run
```

Öffne anschließend <http://127.0.0.1:3000>.

Mit `just` kannst du den Server alternativ mit `just run` starten. `just watch` startet ihn mit automatischem Neustart, sofern `cargo-watch` installiert ist.

## Tests

```sh
cargo test
node --test tests/model.test.cjs
```

Oder beide Testläufe zusammen mit `just test`.

## Architektur

Die Anwendung ist in einen schlanken Rust-Server und einen interaktiven Browser-Client aufgeteilt. Es gibt keine Datenbank und keine serverseitige Modellspeicherung: Der Server liefert die Anwendung aus und erstellt PDFs; Bearbeitung und Speicherung der Modelle erfolgen im Browser.

### Server (Rust)

- [`src/app.rs`](src/app.rs) richtet den Axum-Router ein und bindet den Server an `127.0.0.1:3000`.
- [`src/views.rs`](src/views.rs) rendert mit Maud das HTML-Grundgerüst des Editors.
- [`src/routes.rs`](src/routes.rs) liefert CSS und JavaScript aus `public/` aus. Die Dateien werden beim Kompilieren über `include_str!` eingebettet; ein separater Frontend-Build ist nicht erforderlich.
- [`src/pdf.rs`](src/pdf.rs) nimmt Modelldaten über `POST /api/export/pdf` entgegen, prüft sie und wandelt das Diagramm über SVG in ein PDF um.

### Browser-Client (JavaScript)

- [`public/app.js`](public/app.js) verwaltet den Bearbeitungszustand, die Interaktionen und den SVG-Canvas. Änderungen werden in `localStorage` gespeichert; dort liegen auch die lokal verwalteten Modelle. Undo und Redo werden im Arbeitsspeicher geführt.
- [`public/model.js`](public/model.js) prüft importierte Modelle gegen das versionierte JSON-Format (derzeit Version 1) und normalisiert unterstützte Werte.
- [`public/style.css`](public/style.css) enthält Layout und Darstellung.

### Datenfluss

1. Axum liefert das HTML sowie die eingebetteten CSS- und JavaScript-Dateien an den Browser.
2. Der Browser bearbeitet und rendert das Modell direkt als SVG. Autospeicherung und Wiederherstellung erfolgen über `localStorage`; JSON-Dateien werden im Browser eingelesen und validiert.
3. Für den PDF-Download sendet der Browser das aktuelle Modell als JSON an `POST /api/export/pdf`. Der Server validiert die Daten, erzeugt daraus SVG und gibt das PDF als Download zurück.

Weitere Details zum geplanten und umgesetzten Funktionsumfang stehen in [`features.md`](features.md).

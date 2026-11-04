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

## Technik

Der Server ist in Rust mit Axum umgesetzt und rendert das HTML mit Maud. Die interaktive Zeichenfläche und die lokale Speicherung laufen im Browser mit JavaScript; für den PDF-Export wird serverseitig SVG in PDF umgewandelt.

Weitere Details zum geplanten und umgesetzten Funktionsumfang stehen in [`features.md`](features.md).

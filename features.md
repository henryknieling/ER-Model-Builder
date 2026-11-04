# ER Model Builder — Feature Plan

## Goal

Build a browser-based application for visually creating and editing entity–relationship (ER) models using Chen notation. The first release should make it easy to create a diagram, describe its entities and relationships, save models locally, and download a portable PDF.

## MVP features

### 1. Diagram canvas

- [x] Add, select, move, and delete entities.
- [x] Connect entities with relationships; connections stay attached when entities move.
- [x] Pan and zoom around the canvas.
- [x] Show ER relationship diamonds, readable connectors, and cardinality markers.

### 2. Entities and attributes

- [x] Set an entity name and edit its attributes.
- [x] Set an attribute's name and data type.
- [x] Display attributes as oval bubbles connected to their entity.
- [x] Move attribute bubbles independently; retain their positions in saved, imported, and JSON/PDF exports.
- [x] Mark attributes as primary keys; support nullable and unique flags.
- [x] Validate required names and prevent invalid or incomplete model data where practical.

### 3. Relationships

- [x] Name relationships.
- [x] Switch between relationships and edit cardinality notation by hand (1:1, 1:n, n:1, n:m).
- [x] Display relationship endpoints and cardinalities clearly on the diagram.

### 4. Model workflow and persistence

- [x] Create, rename, save, and reopen models; select and delete saved models from a model manager.
- [x] Autosave locally in the browser for the initial release; no accounts or cloud sync in the MVP.
- [x] Warn about unsaved changes before navigation or closing when applicable.
- [x] Support undo and redo for common editing operations if feasible without delaying the core editor.

### 5. Import and export

- [x] Define a versioned JSON format for the model and diagram layout.
- [x] Import a versioned JSON model without losing entities, attributes, relationships, or positions.
- [x] Download a model as PDF.
- [ ] Consider image and SQL export as follow-up features.

### 6. Usability and accessibility

- [x] Provide a toolbar for common actions and contextual controls for selected items.
- [x] Include useful empty states, clear validation messages, and keyboard support for common actions.
- [x] Make the editor usable at typical desktop and tablet sizes.
- [x] Provide adjustable, slower zoom controls.

## Implementation phases

1. [x] **Project and architecture:** use an Axum Rust server with Maud-rendered HTML and browser-side JavaScript for interactive editing. This keeps the UI server-rendered without requiring a separate frontend build toolchain.
2. [x] **Model format:** define entities, attributes, relationships, cardinality, stable identifiers, and canvas positions. Add serialization and validation tests.
3. [x] **Editor foundation:** build the canvas, selection, entity creation/editing, movement, and relationship connections.
4. [x] **Model editing:** add attribute and relationship properties, cardinality controls, and validation.
5. [x] **Persistence and portability:** add local save/load plus versioned JSON import and PDF download, including invalid-file handling.
6. [ ] **Polish and verification:** improve responsive behavior and accessibility, then test the core create-edit-save-import workflow.

## MVP acceptance criteria

- [x] A user can create a model with multiple entities, attributes, and relationships.
- [x] Moving an entity preserves its relationship connections.
- [x] The model survives a browser refresh through local persistence.
- [x] Importing a valid JSON model reconstructs its entities, relationships, attributes, and layout.
- [x] Downloading a PDF produces a printable ER diagram with attribute bubbles.
- [x] Invalid or unsupported imported data produces a useful error rather than corrupting the current model.

## Deferred until after MVP

- User accounts, cloud storage, and real-time collaboration.
- SQL generation and database-specific schema options.
- Image export, templates, and advanced notation variants.

## Initial assumptions

- Use Chen ER notation with entity rectangles, relationship diamonds, and oval attribute bubbles.
- Keep MVP data local to the browser; support JSON import and PDF download.
- Use an Axum server with Maud-rendered HTML and browser-side JavaScript for editing and local persistence.

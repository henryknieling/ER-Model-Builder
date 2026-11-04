use axum::response::{Html, IntoResponse};
use maud::{DOCTYPE, html};

pub async fn index() -> impl IntoResponse {
    Html(
        html! {
            (DOCTYPE)
            html lang="en" {
                head {
                    meta charset="utf-8";
                    meta name="viewport" content="width=device-width, initial-scale=1";
                    meta name="theme-color" content="#f6f7fb";
                    title { "ER Model Builder" }
                    link rel="stylesheet" href="/style.css";
                }
                body {
                    main id="app" aria-live="polite" {
                        header class="topbar" {
                            a class="brand" href="/" aria-label="ER Model Builder home" {
                                span class="brand-mark" aria-hidden="true" { "ER" }
                                span { "Model Builder" }
                            }
                            div class="model-actions" {
                                label class="sr-only" for="model-picker" { "Open model" }
                                select id="model-picker" aria-label="Open model" {}
                                button id="new-model" class="button button-secondary" { "+ New model" }
                                button id="manage-models" class="button button-secondary" { "Manage models" }
                                button id="export-pdf" class="button button-primary" { "Download PDF" }
                                button id="import-model" class="button button-secondary" { "Import" }
                                input id="import-file" type="file" accept="application/json,.json" hidden;
                            }
                        }
                        section class="workspace" aria-label="ER diagram editor" {
                            aside class="sidebar" {
                                div class="sidebar-heading" {
                                    div {
                                        p class="eyebrow" { "YOUR MODEL" }
                                        input id="model-name" class="model-name" aria-label="Model name" value="Untitled model";
                                    }
                                    span id="save-status" class="save-status" { "Saved locally" }
                                }
                                div class="tool-group" {
                                    button id="add-entity" class="button button-primary full-width" { "+ Add entity" }
                                    button id="connect-entities" class="button button-secondary full-width" { "◇ Add relationship" }
                                    button id="format-diagram" class="button button-secondary full-width" title="Arrange entities and attributes" { "Auto arrange diagram" }
                                }
                                section id="relationship-nav" class="relationship-nav" aria-label="Relationships" hidden {}
                                section id="inspector" class="inspector" aria-label="Selection properties" {
                                    div class="empty-inspector" {
                                        span class="empty-icon" aria-hidden="true" { "◇" }
                                        strong { "Nothing selected" }
                                        p { "Select an entity or relationship to edit its details." }
                                    }
                                }
                                footer class="sidebar-footer" {
                                    button id="undo" class="icon-button" aria-label="Undo" title="Undo (⌘/Ctrl+Z)" disabled { "↶" }
                                    button id="redo" class="icon-button" aria-label="Redo" title="Redo (⌘/Ctrl+Shift+Z)" disabled { "↷" }
                                    span class="footer-divider" {}
                                    button id="delete-selected" class="icon-button danger-text" aria-label="Delete selection" title="Delete selection" disabled { "⌫" }
                                    span class="keyboard-hint" { "⌘/Ctrl Z to undo" }
                                }
                            }
                            section class="canvas-panel" aria-label="Diagram canvas" {
                                div class="canvas-toolbar" {
                                    div class="canvas-title" {
                                        strong { "ER diagram" }
                                        span id="diagram-count" { "0 entities · 0 relationships" }
                                    }
                                    div class="zoom-controls" {
                                        button id="zoom-out" class="icon-button" aria-label="Zoom out" title="Zoom out" { "−" }
                                        label class="sr-only" for="zoom-select" { "Zoom level" }
                                        select id="zoom-select" class="zoom-select" aria-label="Zoom level" {}
                                        button id="zoom-in" class="icon-button" aria-label="Zoom in" title="Zoom in" { "+" }
                                    }
                                }
                                div id="canvas" class="canvas" tabindex="0" aria-label="ER diagram canvas. Drag oval attribute bubbles independently or drag entities to move them; hold space and drag to pan." {
                                    svg id="diagram" role="img" aria-label="Entity relationship diagram" {}
                                    div id="empty-canvas" class="empty-canvas" {
                                        span class="empty-canvas-icon" aria-hidden="true" { "◇" }
                                        h2 { "Start with an entity" }
                                        p { "Entities are rectangles, relationships are diamonds, and attributes are oval bubbles." }
                                        button id="empty-add-entity" class="button button-primary" { "+ Add your first entity" }
                                    }
                                }
                                div class="canvas-hint" { "Shift-click ovals to select multiples · Drag to move together · Space + drag to pan" }
                            }
                        }
                        div id="toast" class="toast" role="status" aria-live="polite" {}
                        dialog id="models-dialog" class="models-dialog" aria-labelledby="models-dialog-title" {
                            div class="models-dialog-content" {
                                div class="models-dialog-heading" {
                                    div {
                                        h2 id="models-dialog-title" { "Manage models" }
                                        p { "Select the saved models you want to delete." }
                                    }
                                    button id="close-models-dialog" class="icon-button" aria-label="Close model manager" { "×" }
                                }
                                label class="select-all-models" {
                                    input id="select-all-models" type="checkbox";
                                    span { "Select all" }
                                }
                                div id="model-delete-list" class="model-delete-list" {}
                                footer class="models-dialog-footer" {
                                    button id="cancel-model-delete" class="button button-secondary" { "Cancel" }
                                    button id="delete-selected-models" class="button button-danger" disabled { "Delete selected" }
                                }
                            }
                        }
                        dialog id="relationship-dialog" class="models-dialog relationship-dialog" aria-labelledby="relationship-dialog-title" {
                            form id="relationship-form" class="models-dialog-content" {
                                div class="models-dialog-heading" {
                                    div {
                                        p class="eyebrow" { "NEW CONNECTION" }
                                        h2 id="relationship-dialog-title" { "Add relationship" }
                                        p { "Give the connection a name and set its cardinality." }
                                    }
                                    button id="close-relationship-dialog" class="icon-button" type="button" aria-label="Cancel relationship" { "×" }
                                }
                                div id="relationship-dialog-endpoints" class="relationship-dialog-endpoints" {}
                                label class="field-label" for="new-relationship-name" { "Relationship name" }
                                input id="new-relationship-name" class="text-input" maxlength="80" required autofocus;
                                label class="field-label" for="new-relationship-cardinality" { "Cardinality" }
                                input id="new-relationship-cardinality" class="text-input cardinality-input" value="1:n" maxlength="3" spellcheck="false" autocapitalize="off" required;
                                p class="muted-copy" { "Use 1:1, 1:n, n:1, or n:m." }
                                footer class="models-dialog-footer" {
                                    button id="cancel-relationship" class="button button-secondary" type="button" { "Cancel" }
                                    button class="button button-primary" type="submit" { "Add relationship" }
                                }
                            }
                        }
                        script src="/model.js" {}
                        script src="/app.js" {}
                    }
                }
            }
        }
        .into_string(),
    )
}

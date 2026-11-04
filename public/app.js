(() => {
  "use strict";

  const STORAGE_KEY = "er-model-builder.models.v1";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const ENTITY_WIDTH = 170;
  const ENTITY_HEIGHT = 58;
  const ATTRIBUTE_RX = 72;
  const ATTRIBUTE_RY = 25;
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 2.25;

  const $ = (selector) => document.querySelector(selector);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const uid = () => crypto.randomUUID();
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const attributeSelectionKey = (entityId, attributeId) => JSON.stringify([entityId, attributeId]);

  const makeModel = (name = "Untitled model") => ({
    version: 1,
    id: uid(),
    name,
    entities: [],
    relationships: [],
  });

  let stored = readStorage();
  let model = stored.activeId && stored.models[stored.activeId]
    ? stored.models[stored.activeId]
    : makeModel();
  let activeId = model.id;
  let selected = null;
  let selectedAttributes = new Map();
  let connectMode = false;
  let connectSource = null;
  let pendingConnection = null;
  let undoStack = [];
  let redoStack = [];
  let view = { x: 0, y: 0, width: 1200, height: 800 };
  let pointerAction = null;
  let spaceDown = false;
  let toastTimer;

  function readStorage() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const models = value.models && typeof value.models === "object" ? value.models : {};
      Object.values(models).forEach((savedModel) => {
        (savedModel.relationships || []).forEach((relationship) => {
          if (typeof relationship.cardinality === "string") relationship.cardinality = relationship.cardinality.toLowerCase();
        });
        (savedModel.entities || []).forEach((entity) => {
          (entity.attributes || []).forEach((attribute, index) => {
            if (!Number.isFinite(attribute.x)) attribute.x = entity.x + (index % 2 === 0 ? -100 : ENTITY_WIDTH + 100);
            if (!Number.isFinite(attribute.y)) attribute.y = entity.y + 29 + Math.floor(index / 2) * 58;
          });
        });
      });
      return { models, activeId: value.activeId || null };
    } catch (_) {
      return { models: {}, activeId: null };
    }
  }

  function persist() {
    model.updatedAt = new Date().toISOString();
    stored.models[activeId] = clone(model);
    stored.activeId = activeId;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      $("#save-status").textContent = "Saved locally";
      return true;
    } catch (_) {
      $("#save-status").textContent = "Could not save";
      showToast("Browser storage is unavailable or full. Export a backup to keep your work.");
      return false;
    }
  }

  function changed(action) {
    undoStack.push(clone(model));
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    action();
    persist();
    render();
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
  }

  function render() {
    $("#model-name").value = model.name;
    renderModelPicker();
    renderRelationshipNav();
    renderDiagram();
    renderInspector();
    $("#diagram-count").textContent = `${model.entities.length} ${model.entities.length === 1 ? "entity" : "entities"} · ${model.relationships.length} ${model.relationships.length === 1 ? "relationship" : "relationships"}`;
    $("#empty-canvas").hidden = model.entities.length > 0;
    $("#undo").disabled = undoStack.length === 0;
    $("#redo").disabled = redoStack.length === 0;
    $("#delete-selected").disabled = !selected;
    $("#format-diagram").disabled = model.entities.length === 0;
    $("#connect-entities").classList.toggle("is-active", connectMode);
    $("#canvas").classList.toggle("connecting", connectMode);
  }

  function renderModelPicker() {
    const picker = $("#model-picker");
    const options = Object.values(stored.models).sort((a, b) => a.name.localeCompare(b.name));
    if (!options.some((entry) => entry.id === activeId)) options.push(model);
    picker.innerHTML = options.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name || "Untitled model")}</option>`).join("");
    picker.value = activeId;
  }

  function renderRelationshipNav() {
    const nav = $("#relationship-nav");
    nav.hidden = model.relationships.length === 0;
    if (nav.hidden) { nav.replaceChildren(); return; }
    nav.innerHTML = `<p class="eyebrow">RELATIONSHIPS</p><div class="relationship-nav-list">${model.relationships.map((relationship) => {
      const from = model.entities.find((entity) => entity.id === relationship.from)?.name || "Unknown";
      const to = model.entities.find((entity) => entity.id === relationship.to)?.name || "Unknown";
      const isSelected = selected?.type === "relationship" && selected.id === relationship.id;
      return `<button class="relationship-nav-item${isSelected ? " selected" : ""}" data-relationship-id="${escapeHtml(relationship.id)}" aria-pressed="${isSelected}" title="${escapeHtml(from)} ${escapeHtml(relationship.cardinality)} ${escapeHtml(to)}"><span class="relationship-nav-name">${escapeHtml(relationship.name)}</span><span class="relationship-nav-cardinality">${escapeHtml(relationship.cardinality)}</span></button>`;
    }).join("")}</div>`;
  }

  function svgElement(tag, attributes = {}, text = null) {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    if (text !== null) element.textContent = text;
    return element;
  }

  function entityCenter(entity) {
    return { x: entity.x + ENTITY_WIDTH / 2, y: entity.y + ENTITY_HEIGHT / 2 };
  }

  function rectBoundary(entity, towardX, towardY) {
    const center = entityCenter(entity);
    const dx = towardX - center.x;
    const dy = towardY - center.y;
    if (!dx && !dy) return center;
    const scale = Math.min(
      dx === 0 ? Infinity : (ENTITY_WIDTH / 2) / Math.abs(dx),
      dy === 0 ? Infinity : (ENTITY_HEIGHT / 2) / Math.abs(dy),
    );
    return { x: center.x + dx * scale, y: center.y + dy * scale };
  }

  function diamondBoundary(cx, cy, towardX, towardY, halfWidth, halfHeight) {
    const dx = towardX - cx;
    const dy = towardY - cy;
    const denominator = Math.abs(dx) / halfWidth + Math.abs(dy) / halfHeight;
    return denominator ? { x: cx + dx / denominator, y: cy + dy / denominator } : { x: cx, y: cy };
  }

  function attributePosition(entity, attribute, index) {
    return {
      x: Number.isFinite(attribute.x) ? attribute.x : entity.x + (index % 2 === 0 ? -100 : ENTITY_WIDTH + 100),
      y: Number.isFinite(attribute.y) ? attribute.y : entity.y + 29 + Math.floor(index / 2) * 58,
    };
  }

  function ellipseBoundary(cx, cy, towardX, towardY) {
    const dx = towardX - cx;
    const dy = towardY - cy;
    const scale = Math.sqrt((dx * dx) / (ATTRIBUTE_RX * ATTRIBUTE_RX) + (dy * dy) / (ATTRIBUTE_RY * ATTRIBUTE_RY));
    return scale ? { x: cx + dx / scale, y: cy + dy / scale } : { x: cx, y: cy };
  }

  function renderDiagram() {
    const svg = $("#diagram");
    svg.replaceChildren();
    svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.width} ${view.height}`);

    const relationLayer = svgElement("g", { class: "relation-layer" });
    for (const relationship of model.relationships) {
      const from = model.entities.find((entity) => entity.id === relationship.from);
      const to = model.entities.find((entity) => entity.id === relationship.to);
      if (!from || !to) continue;
      const fromCenter = entityCenter(from);
      const toCenter = entityCenter(to);
      const x1 = fromCenter.x;
      const y1 = fromCenter.y;
      const x2 = toCenter.x;
      const y2 = toCenter.y;
      const middleX = (x1 + x2) / 2;
      const middleY = (y1 + y2) / 2;
      const halfWidth = Math.max(56, relationship.name.length * 4 + 29);
      const halfHeight = 29;
      const fromEdge = rectBoundary(from, middleX, middleY);
      const toEdge = rectBoundary(to, middleX, middleY);
      const fromDiamond = diamondBoundary(middleX, middleY, fromEdge.x, fromEdge.y, halfWidth, halfHeight);
      const toDiamond = diamondBoundary(middleX, middleY, toEdge.x, toEdge.y, halfWidth, halfHeight);
      const group = svgElement("g", {
        class: `relationship${selected?.type === "relationship" && selected.id === relationship.id ? " selected" : ""}`,
        "data-relationship-id": relationship.id,
        tabindex: "0",
        role: "button",
        "aria-label": `${relationship.name}: ${from.name} ${relationship.cardinality} ${to.name}`,
      });
      const linePath = `M ${fromEdge.x} ${fromEdge.y} L ${fromDiamond.x} ${fromDiamond.y} M ${toEdge.x} ${toEdge.y} L ${toDiamond.x} ${toDiamond.y}`;
      group.append(svgElement("path", { d: linePath, class: "relationship-line" }));
      group.append(svgElement("path", { d: linePath, class: "relationship-hit-area" }));
      group.append(svgElement("text", { x: fromEdge.x + (fromDiamond.x - fromEdge.x) * 0.38, y: fromEdge.y + (fromDiamond.y - fromEdge.y) * 0.38 - 7, class: "cardinality-label", "text-anchor": "middle" }, relationship.cardinality.split(":")[0]));
      group.append(svgElement("text", { x: toEdge.x + (toDiamond.x - toEdge.x) * 0.38, y: toEdge.y + (toDiamond.y - toEdge.y) * 0.38 - 7, class: "cardinality-label", "text-anchor": "middle" }, relationship.cardinality.split(":")[1]));
      group.append(svgElement("polygon", { points: `${middleX},${middleY - halfHeight} ${middleX + halfWidth},${middleY} ${middleX},${middleY + halfHeight} ${middleX - halfWidth},${middleY}`, class: "relationship-diamond" }));
      group.append(svgElement("text", { x: middleX, y: middleY + 4, class: "relationship-label", "text-anchor": "middle" }, relationship.name));
      relationLayer.append(group);
    }
    svg.append(relationLayer);

    const entityLayer = svgElement("g", { class: "entity-layer" });
    for (const entity of model.entities) {
      const isSelected = selected?.type === "entity" && selected.id === entity.id;
      const group = svgElement("g", {
        class: `entity${isSelected ? " selected" : ""}${connectSource === entity.id ? " connect-source" : ""}`,
        transform: `translate(${entity.x} ${entity.y})`,
        "data-entity-id": entity.id,
        tabindex: "0",
        role: "group",
        "aria-label": `Entity ${entity.name}, ${entity.attributes.length} attributes`,
      });
      group.append(svgElement("rect", { width: ENTITY_WIDTH, height: ENTITY_HEIGHT, rx: 4, class: "entity-card" }));
      group.append(svgElement("text", { x: ENTITY_WIDTH / 2, y: 35, class: "entity-title", "text-anchor": "middle" }, entity.name));
      entity.attributes.forEach((attribute, index) => {
        const position = attributePosition(entity, attribute, index);
        const localX = position.x - entity.x;
        const localY = position.y - entity.y;
        const entityEdge = rectBoundary(entity, position.x, position.y);
        const bubbleEdge = ellipseBoundary(position.x, position.y, entityEdge.x, entityEdge.y);
        const node = svgElement("g", {
          class: `attribute-node${selectedAttributes.has(attributeSelectionKey(entity.id, attribute.id)) ? " multi-selected" : ""}`,
          "data-attribute-id": attribute.id,
          tabindex: "0",
          role: "button",
          "aria-pressed": selectedAttributes.has(attributeSelectionKey(entity.id, attribute.id)),
          "aria-label": `Attribute ${attribute.name} on ${entity.name}. Drag to move.`,
        });
        node.append(svgElement("line", {
          x1: entityEdge.x - entity.x,
          y1: entityEdge.y - entity.y,
          x2: bubbleEdge.x - entity.x,
          y2: bubbleEdge.y - entity.y,
          class: "attribute-connector",
        }));
        node.append(svgElement("ellipse", { cx: localX, cy: localY, rx: ATTRIBUTE_RX, ry: ATTRIBUTE_RY, class: "attribute-bubble" }));
        node.append(svgElement("text", { x: localX, y: localY - 2, class: `attribute-name${attribute.pk ? " primary-key" : ""}`, "text-anchor": "middle" }, attribute.name || "(unnamed)"));
        const flags = [attribute.unique ? "unique" : "", attribute.nullable ? "nullable" : ""].filter(Boolean);
        node.append(svgElement("text", { x: localX, y: localY + 11, class: "attribute-type", "text-anchor": "middle" }, [attribute.type, ...flags].filter(Boolean).join(" · ")));
        group.append(node);
      });
      entityLayer.append(group);
    }
    svg.append(entityLayer);
    syncZoomControls();
  }

  function renderInspector() {
    const inspector = $("#inspector");
    if (!selected) {
      inspector.innerHTML = `<div class="empty-inspector"><span class="empty-icon" aria-hidden="true">◇</span><strong>Nothing selected</strong><p>Select an entity or relationship to edit its details.</p></div>`;
      return;
    }
    if (selected.type === "entity") {
      const entity = model.entities.find((entry) => entry.id === selected.id);
      if (!entity) { selected = null; renderInspector(); return; }
      inspector.innerHTML = `<div class="inspector-heading"><p class="eyebrow">ENTITY</p><button class="text-button danger-text" data-action="delete-selection">Delete</button></div>
        <label class="field-label" for="entity-name">Name</label><input id="entity-name" class="text-input" data-field="entity-name" value="${escapeHtml(entity.name)}" maxlength="80">
        <div class="section-heading"><strong>Attributes</strong><button class="text-button" data-action="add-attribute">+ Add</button></div>
        <div class="attribute-editor">${entity.attributes.map((attribute) => `<div class="attribute-row" data-attribute-id="${escapeHtml(attribute.id)}">
          <div class="attribute-main"><input class="text-input attribute-name-input" data-field="attribute-name" aria-label="Attribute name" value="${escapeHtml(attribute.name)}" maxlength="80"><button class="icon-button tiny danger-text" data-action="remove-attribute" aria-label="Remove attribute">×</button></div>
          <label class="field-label compact-label">Data type</label><input class="text-input" data-field="attribute-type" aria-label="Data type" value="${escapeHtml(attribute.type)}" maxlength="40">
          <div class="flag-row"><label><input type="checkbox" data-field="attribute-pk" ${attribute.pk ? "checked" : ""}> Primary key</label><label><input type="checkbox" data-field="attribute-nullable" ${attribute.nullable ? "checked" : ""}> Nullable</label><label><input type="checkbox" data-field="attribute-unique" ${attribute.unique ? "checked" : ""}> Unique</label></div>
        </div>`).join("") || `<p class="muted-copy">Add attributes to describe this entity.</p>`}</div>`;
      return;
    }
    const relationship = model.relationships.find((entry) => entry.id === selected.id);
    if (!relationship) { selected = null; renderInspector(); return; }
    const from = model.entities.find((entry) => entry.id === relationship.from);
    const to = model.entities.find((entry) => entry.id === relationship.to);
    inspector.innerHTML = `<div class="inspector-heading"><p class="eyebrow">RELATIONSHIP</p><button class="text-button danger-text" data-action="delete-selection">Delete</button></div>
      <label class="field-label" for="relationship-name">Name</label><input id="relationship-name" class="text-input" data-field="relationship-name" value="${escapeHtml(relationship.name)}" maxlength="80">
      <div class="relationship-endpoints"><span>${escapeHtml(from?.name || "Missing entity")}</span><b>↔</b><span>${escapeHtml(to?.name || "Missing entity")}</span></div>
      <label class="field-label" for="relationship-cardinality">Cardinality</label><input id="relationship-cardinality" class="text-input cardinality-input" data-field="relationship-cardinality" value="${escapeHtml(relationship.cardinality)}" maxlength="3" spellcheck="false" autocapitalize="off" aria-describedby="cardinality-help">
      <p id="cardinality-help" class="muted-copy">Type 1:1, 1:n, n:1, or n:m. The value is not case-sensitive.</p>`;
  }

  function select(type, id) {
    selectedAttributes.clear();
    selected = { type, id };
    render();
  }

  function addEntity() {
    const index = model.entities.length;
    let position = { x: 130 + (index % 2) * 440, y: 150 + Math.floor(index / 2) * 280 };
    if (model.entities.some((entity) => Math.abs(entity.x - position.x) < 80 && Math.abs(entity.y - position.y) < 80)) {
      position = { x: view.x + view.width / 2 - ENTITY_WIDTH / 2, y: view.y + view.height / 2 - 70 };
    }
    let entityId;
    changed(() => {
      entityId = uid();
      model.entities.push({ id: entityId, name: `Entity ${index + 1}`, x: Math.round(position.x), y: Math.round(position.y), attributes: [] });
    });
    selected = { type: "entity", id: entityId };
    selectedAttributes.clear();
    render();
    const input = $("#entity-name");
    input.focus(); input.select();
  }

  function formatDiagram() {
    if (!model.entities.length) return;
    const columns = Math.ceil(Math.sqrt(model.entities.length));
    const rowHeights = [];
    for (let row = 0; row < Math.ceil(model.entities.length / columns); row++) {
      const entities = model.entities.slice(row * columns, (row + 1) * columns);
      const maxAttributeCount = Math.max(0, ...entities.map((entity) => entity.attributes.length));
      rowHeights.push(Math.max(280, maxAttributeCount * 116 + 300));
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxRelationshipHalfWidth = 56;
    const rowTops = [];
    let nextRowTop = 250;
    rowHeights.forEach((height) => {
      rowTops.push(nextRowTop);
      nextRowTop += height;
    });
    changed(() => {
      model.entities.forEach((entity, index) => {
        const row = Math.floor(index / columns);
        const column = index % columns;
        entity.x = 300 + column * 650;
        entity.y = rowTops[row] + (rowHeights[row] - ENTITY_HEIGHT) / 2;
      });

      const relationshipLabels = [];
      model.relationships.forEach((relationship) => {
        const from = model.entities.find((entity) => entity.id === relationship.from);
        const to = model.entities.find((entity) => entity.id === relationship.to);
        if (!from || !to) return;
        const fromCenter = entityCenter(from);
        const toCenter = entityCenter(to);
        const middleX = (fromCenter.x + toCenter.x) / 2;
        const middleY = (fromCenter.y + toCenter.y) / 2;
        const halfWidth = Math.max(56, relationship.name.length * 4 + 29);
        const halfHeight = 29;
        maxRelationshipHalfWidth = Math.max(maxRelationshipHalfWidth, halfWidth);
        const fromEdge = rectBoundary(from, middleX, middleY);
        const toEdge = rectBoundary(to, middleX, middleY);
        const fromDiamond = diamondBoundary(middleX, middleY, fromEdge.x, fromEdge.y, halfWidth, halfHeight);
        const toDiamond = diamondBoundary(middleX, middleY, toEdge.x, toEdge.y, halfWidth, halfHeight);
        relationshipLabels.push({ left: middleX - halfWidth, right: middleX + halfWidth, top: middleY - halfHeight, bottom: middleY + halfHeight });
        const fromCardinality = {
          x: fromEdge.x + (fromDiamond.x - fromEdge.x) * 0.38,
          y: fromEdge.y + (fromDiamond.y - fromEdge.y) * 0.38 - 7,
        };
        const toCardinality = {
          x: toEdge.x + (toDiamond.x - toEdge.x) * 0.38,
          y: toEdge.y + (toDiamond.y - toEdge.y) * 0.38 - 7,
        };
        [fromCardinality, toCardinality].forEach(({ x, y }) => {
          relationshipLabels.push({ left: x - 10, right: x + 10, top: y - 9, bottom: y + 5 });
        });
      });

      const createLabelBandIndex = (startKey, endKey, bandSize) => {
        const bands = new Map();
        relationshipLabels.forEach((label) => {
          const firstBand = Math.floor(label[startKey] / bandSize);
          const lastBand = Math.floor(label[endKey] / bandSize);
          for (let band = firstBand; band <= lastBand; band++) {
            if (!bands.has(band)) bands.set(band, []);
            bands.get(band).push(label);
          }
        });
        return (center, radius) => {
          const matches = new Set();
          const firstBand = Math.floor((center - radius) / bandSize);
          const lastBand = Math.floor((center + radius) / bandSize);
          for (let band = firstBand; band <= lastBand; band++) {
            bands.get(band)?.forEach((label) => matches.add(label));
          }
          return [...matches];
        };
      };
      const labelsNearY = createLabelBandIndex("top", "bottom", 58);
      const labelsNearX = createLabelBandIndex("left", "right", 144);
      const sides = ["left", "right", "top", "bottom"];
      const clearanceOffset = (position, side, nearbyLabels) => {
        const intervals = [];
        nearbyLabels.forEach((label) => {
          let start;
          let end;
          if (side === "left" || side === "right") {
            if (position.y + ATTRIBUTE_RY <= label.top || position.y - ATTRIBUTE_RY >= label.bottom) return;
            if (side === "left") {
              start = position.x - ATTRIBUTE_RX - label.right;
              end = position.x + ATTRIBUTE_RX - label.left;
            } else {
              start = label.left - position.x - ATTRIBUTE_RX;
              end = label.right - position.x + ATTRIBUTE_RX;
            }
          } else {
            if (position.x + ATTRIBUTE_RX <= label.left || position.x - ATTRIBUTE_RX >= label.right) return;
            if (side === "top") {
              start = position.y - ATTRIBUTE_RY - label.bottom;
              end = position.y + ATTRIBUTE_RY - label.top;
            } else {
              start = label.top - position.y - ATTRIBUTE_RY;
              end = label.bottom - position.y + ATTRIBUTE_RY;
            }
          }
          if (end >= 0) intervals.push([Math.max(0, start), end]);
        });
        intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        let offset = 0;
        for (const [start, end] of intervals) {
          if (end < offset) continue;
          if (start > offset) break;
          offset = end + 2;
        }
        return offset;
      };
      model.entities.forEach((entity, index) => {
        const order = index % 2 ? ["right", "left", "bottom", "top"] : ["left", "right", "top", "bottom"];
        const scores = Object.fromEntries(sides.map((side) => [side, { displacement: 0, towardRelationships: 0 }]));
        model.relationships.forEach((relationship) => {
          const otherId = relationship.from === entity.id ? relationship.to : relationship.to === entity.id ? relationship.from : null;
          const other = otherId && model.entities.find((candidate) => candidate.id === otherId);
          if (!other) return;
          const dx = other.x - entity.x;
          const dy = other.y - entity.y;
          const distance = Math.hypot(dx, dy) || 1;
          scores.left.towardRelationships += Math.max(0, -dx / distance);
          scores.right.towardRelationships += Math.max(0, dx / distance);
          scores.top.towardRelationships += Math.max(0, -dy / distance);
          scores.bottom.towardRelationships += Math.max(0, dy / distance);
        });

        const positionOnSide = (attributeIndex, side) => {
          if (side === "left" || side === "right") {
            return {
              x: entity.x + (side === "left" ? -100 : ENTITY_WIDTH + 100),
              y: entity.y + ENTITY_HEIGHT / 2 + (attributeIndex - (entity.attributes.length - 1) / 2) * 58,
            };
          }
          return {
            x: entity.x + ENTITY_WIDTH / 2,
            y: side === "top"
              ? entity.y - ATTRIBUTE_RY - 35 - attributeIndex * 58
              : entity.y + ENTITY_HEIGHT + ATTRIBUTE_RY + 35 + attributeIndex * 58,
          };
        };

        const offsetsBySide = Object.fromEntries(sides.map((side) => [side, entity.attributes.map((_, attributeIndex) => {
          const position = positionOnSide(attributeIndex, side);
          const nearbyLabels = side === "left" || side === "right"
            ? labelsNearY(position.y, ATTRIBUTE_RY)
            : labelsNearX(position.x, ATTRIBUTE_RX);
          const offset = clearanceOffset(position, side, nearbyLabels);
          scores[side].displacement += offset;
          return offset;
        })]));
        const side = [...order].sort((a, b) =>
          scores[a].displacement - scores[b].displacement || scores[a].towardRelationships - scores[b].towardRelationships,
        )[0];
        entity.attributes.forEach((attribute, attributeIndex) => {
          const position = positionOnSide(attributeIndex, side);
          const offset = offsetsBySide[side][attributeIndex];
          if (side === "left") position.x -= offset;
          if (side === "right") position.x += offset;
          if (side === "top") position.y -= offset;
          if (side === "bottom") position.y += offset;
          Object.assign(attribute, position);
        });

        minX = Math.min(minX, entity.x, ...entity.attributes.map((attribute) => attribute.x - ATTRIBUTE_RX));
        maxX = Math.max(maxX, entity.x + ENTITY_WIDTH, ...entity.attributes.map((attribute) => attribute.x + ATTRIBUTE_RX));
        minY = Math.min(minY, entity.y, ...entity.attributes.map((attribute) => attribute.y - ATTRIBUTE_RY));
        maxY = Math.max(maxY, entity.y + ENTITY_HEIGHT, ...entity.attributes.map((attribute) => attribute.y + ATTRIBUTE_RY));
      });
    });
    const canvas = $("#canvas").getBoundingClientRect();
    const aspect = canvas.width && canvas.height ? canvas.width / canvas.height : 1.5;
    const margin = Math.max(100, maxRelationshipHalfWidth + 30);
    const contentWidth = maxX - minX + margin * 2;
    const contentHeight = maxY - minY + margin * 2;
    view.width = Math.min(1200 / MIN_ZOOM, Math.max(1200 / MAX_ZOOM, contentWidth, contentHeight * aspect));
    view.height = view.width / aspect;
    view.x = (minX + maxX - view.width) / 2;
    view.y = (minY + maxY - view.height) / 2;
    updateView();
    showToast("Diagram arranged.");
  }

  function deleteSelection() {
    if (!selected) return;
    const target = selected;
    changed(() => {
      if (target.type === "entity") {
        model.entities = model.entities.filter((entry) => entry.id !== target.id);
        model.relationships = model.relationships.filter((entry) => entry.from !== target.id && entry.to !== target.id);
      } else {
        model.relationships = model.relationships.filter((entry) => entry.id !== target.id);
      }
    });
    selected = null;
    selectedAttributes.clear();
    render();
  }

  function finishConnection(entityId) {
    if (!connectSource) {
      connectSource = entityId;
      renderDiagram();
      showToast("Choose the other entity to connect.");
      return;
    }
    if (connectSource === entityId) {
      connectSource = null;
      connectMode = false;
      render();
      return;
    }
    const first = model.entities.find((entry) => entry.id === connectSource);
    const second = model.entities.find((entry) => entry.id === entityId);
    pendingConnection = { from: connectSource, to: entityId };
    connectSource = null;
    connectMode = false;
    render();
    $("#relationship-dialog-endpoints").innerHTML = `<span>${escapeHtml(first.name)}</span><b>◇</b><span>${escapeHtml(second.name)}</span>`;
    $("#new-relationship-name").value = "relates to";
    $("#new-relationship-cardinality").value = "1:n";
    $("#relationship-dialog").showModal();
    $("#new-relationship-name").focus();
    $("#new-relationship-name").select();
  }

  function pointInSvg(event) {
    const point = $("#diagram").createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    return point.matrixTransform($("#diagram").getScreenCTM().inverse());
  }

  function updateView() {
    $("#diagram").setAttribute("viewBox", `${view.x} ${view.y} ${view.width} ${view.height}`);
    syncZoomControls();
  }

  function syncZoomControls() {
    const zoomSelect = $("#zoom-select");
    const zoomPercent = Math.min(225, Math.max(25, Math.round(1200 / view.width * 100)));
    let currentOption = zoomSelect.querySelector("option[data-current-zoom]");
    if (zoomPercent % 25 === 0) {
      currentOption?.remove();
    } else {
      if (!currentOption) {
        currentOption = document.createElement("option");
        currentOption.dataset.currentZoom = "true";
        currentOption.hidden = true;
        zoomSelect.append(currentOption);
      }
      currentOption.value = String(zoomPercent);
      currentOption.textContent = `${zoomPercent}%`;
    }
    zoomSelect.value = String(zoomPercent);
    $("#zoom-out").disabled = zoomPercent <= 25;
    $("#zoom-in").disabled = zoomPercent >= 225;
  }

  function zoomAt(clientX, clientY, factor) {
    const canvas = $("#canvas").getBoundingClientRect();
    const ratio = view.width / canvas.width;
    const worldX = view.x + (clientX - canvas.left) * ratio;
    const worldY = view.y + (clientY - canvas.top) * ratio;
    const nextWidth = Math.max(1200 / MAX_ZOOM, Math.min(1200 / MIN_ZOOM, view.width * factor));
    const scale = nextWidth / view.width;
    view.x = worldX - (worldX - view.x) * scale;
    view.y = worldY - (worldY - view.y) * scale;
    view.width = nextWidth;
    view.height = nextWidth * (canvas.height / canvas.width);
    updateView();
  }

  function adjustZoomByStep(delta, clientX, clientY) {
    const currentZoom = Number($("#zoom-select").value);
    const nextZoom = Math.min(225, Math.max(25, currentZoom + delta));
    zoomAt(clientX, clientY, (1200 / view.width * 100) / nextZoom);
  }

  $("#add-entity").addEventListener("click", addEntity);
  $("#empty-add-entity").addEventListener("click", addEntity);
  $("#format-diagram").addEventListener("click", formatDiagram);
  $("#delete-selected").addEventListener("click", deleteSelection);
  $("#connect-entities").addEventListener("click", () => {
    connectMode = !connectMode;
    connectSource = null;
    $("#canvas").classList.toggle("connecting", connectMode);
    render();
    showToast(connectMode ? "Select the first entity, then the second." : "Connection cancelled.");
  });

  $("#relationship-nav").addEventListener("click", (event) => {
    const button = event.target.closest("[data-relationship-id]");
    if (button) select("relationship", button.dataset.relationshipId);
  });

  const relationshipDialog = $("#relationship-dialog");
  $("#relationship-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!pendingConnection) return;
    const name = $("#new-relationship-name").value.trim();
    const cardinality = $("#new-relationship-cardinality").value.replace(/\s/g, "").toLowerCase();
    const cardinalityInput = $("#new-relationship-cardinality");
    if (!name) {
      $("#new-relationship-name").focus();
      showToast("Enter a relationship name.");
      return;
    }
    if (!/^(1:1|1:n|n:1|n:m)$/.test(cardinality)) {
      cardinalityInput.setAttribute("aria-invalid", "true");
      cardinalityInput.focus();
      showToast("Use 1:1, 1:n, n:1, or n:m for cardinality.");
      return;
    }
    cardinalityInput.removeAttribute("aria-invalid");
    const endpoints = pendingConnection;
    let relationshipId;
    pendingConnection = null;
    relationshipDialog.close();
    changed(() => {
      relationshipId = uid();
      model.relationships.push({ id: relationshipId, name, from: endpoints.from, to: endpoints.to, cardinality });
    });
    selected = { type: "relationship", id: relationshipId };
    selectedAttributes.clear();
    render();
  });
  $("#cancel-relationship").addEventListener("click", () => relationshipDialog.close());
  $("#close-relationship-dialog").addEventListener("click", () => relationshipDialog.close());
  relationshipDialog.addEventListener("close", () => { pendingConnection = null; });

  $("#model-name").addEventListener("change", (event) => {
    const name = event.target.value.trim();
    if (!name) { event.target.value = model.name; showToast("Model name cannot be empty."); return; }
    changed(() => { model.name = name; });
  });

  $("#new-model").addEventListener("click", () => {
    persist();
    model = makeModel();
    activeId = model.id;
    selected = null; selectedAttributes.clear(); connectMode = false; connectSource = null; undoStack = []; redoStack = [];
    persist(); render(); $("#model-name").focus(); $("#model-name").select();
  });

  const modelsDialog = $("#models-dialog");
  const modelDeleteList = $("#model-delete-list");
  const deleteSelectedModelsButton = $("#delete-selected-models");

  function updateModelDeleteSelection() {
    const checkboxes = [...modelDeleteList.querySelectorAll("input[type=checkbox]")];
    const checked = checkboxes.filter((checkbox) => checkbox.checked);
    deleteSelectedModelsButton.disabled = checked.length === 0;
    deleteSelectedModelsButton.textContent = checked.length ? `Delete selected (${checked.length})` : "Delete selected";
    const selectAll = $("#select-all-models");
    selectAll.checked = checkboxes.length > 0 && checked.length === checkboxes.length;
    selectAll.indeterminate = checked.length > 0 && checked.length < checkboxes.length;
  }

  function renderModelDeleteList() {
    const savedModels = Object.values(stored.models).sort((a, b) => a.name.localeCompare(b.name));
    modelDeleteList.innerHTML = savedModels.map((savedModel) => {
      const count = savedModel.entities?.length || 0;
      const updated = savedModel.updatedAt ? new Date(savedModel.updatedAt).toLocaleDateString() : "Not modified";
      return `<label class="model-delete-option"><input type="checkbox" value="${escapeHtml(savedModel.id)}"><span class="model-delete-option-copy"><strong>${escapeHtml(savedModel.name || "Untitled model")}</strong><small>${count} ${count === 1 ? "entity" : "entities"} · ${escapeHtml(updated)}</small></span>${savedModel.id === activeId ? `<span class="current-model-tag">Open</span>` : ""}</label>`;
    }).join("");
    $("#select-all-models").checked = false;
    $("#select-all-models").indeterminate = false;
    updateModelDeleteSelection();
  }

  $("#manage-models").addEventListener("click", () => {
    renderModelDeleteList();
    modelsDialog.showModal();
  });
  $("#close-models-dialog").addEventListener("click", () => modelsDialog.close());
  $("#cancel-model-delete").addEventListener("click", () => modelsDialog.close());
  modelDeleteList.addEventListener("change", updateModelDeleteSelection);
  $("#select-all-models").addEventListener("change", (event) => {
    modelDeleteList.querySelectorAll("input[type=checkbox]").forEach((checkbox) => { checkbox.checked = event.target.checked; });
    updateModelDeleteSelection();
  });
  deleteSelectedModelsButton.addEventListener("click", () => {
    const selectedIds = [...modelDeleteList.querySelectorAll("input[type=checkbox]:checked")].map((checkbox) => checkbox.value);
    if (!selectedIds.length) return;
    const noun = selectedIds.length === 1 ? "model" : "models";
    if (!window.confirm(`Permanently delete ${selectedIds.length} selected ${noun}? This cannot be undone.`)) return;

    const activeWasDeleted = selectedIds.includes(activeId);
    selectedIds.forEach((id) => { delete stored.models[id]; });
    if (activeWasDeleted) {
      const remaining = Object.values(stored.models).sort((a, b) => a.name.localeCompare(b.name));
      if (remaining.length) {
        model = remaining[0];
        activeId = model.id;
      } else {
        model = makeModel();
        activeId = model.id;
      }
      selected = null;
      selectedAttributes.clear();
      connectMode = false;
      connectSource = null;
      undoStack = [];
      redoStack = [];
      view = { x: 0, y: 0, width: 1200, height: 800 };
    }
    persist();
    render();
    modelsDialog.close();
    showToast(`${selectedIds.length} ${noun} deleted.`);
  });

  $("#model-picker").addEventListener("change", (event) => {
    persist();
    activeId = event.target.value;
    model = stored.models[activeId] || makeModel();
    selected = null; selectedAttributes.clear(); connectMode = false; connectSource = null; undoStack = []; redoStack = [];
    view = { x: 0, y: 0, width: 1200, height: 800 };
    render();
  });

  $("#export-pdf").addEventListener("click", async () => {
    const button = $("#export-pdf");
    button.disabled = true;
    button.textContent = "Preparing PDF…";
    try {
      const response = await fetch("/api/export/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(model),
      });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${model.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "er-model"}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      showToast("ER diagram downloaded as PDF.");
    } catch (error) {
      showToast(`PDF download failed: ${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = "Download PDF";
    }
  });

  $("#import-model").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
      const imported = window.ERModel.validateModel(JSON.parse(await file.text()));
      persist();
      imported.id = uid();
      model = imported; activeId = model.id; stored.models[activeId] = clone(model);
      selected = null; selectedAttributes.clear(); connectMode = false; connectSource = null; undoStack = []; redoStack = [];
      persist(); render(); showToast("Model imported successfully.");
    } catch (error) {
      showToast(`Import failed: ${error.message}`);
    }
  });

  $("#inspector").addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "delete-selection") { deleteSelection(); return; }
    if (action === "add-attribute" && selected?.type === "entity") {
      let attributeId;
      changed(() => {
        attributeId = uid();
        const entity = model.entities.find((entry) => entry.id === selected.id);
        const index = entity.attributes.length;
        entity.attributes.push({
          id: attributeId,
          name: `attribute_${index + 1}`,
          type: "string",
          pk: false,
          nullable: true,
          unique: false,
          x: entity.x + (index % 2 === 0 ? -100 : ENTITY_WIDTH + 100),
          y: entity.y + 29 + Math.floor(index / 2) * 58,
        });
      });
      const inputs = $("#inspector").querySelectorAll(".attribute-name-input");
      inputs[inputs.length - 1]?.focus(); inputs[inputs.length - 1]?.select();
    }
    if (action === "remove-attribute" && selected?.type === "entity") {
      const attributeId = event.target.closest("[data-attribute-id]").dataset.attributeId;
      changed(() => {
        const entity = model.entities.find((entry) => entry.id === selected.id);
        entity.attributes = entity.attributes.filter((attribute) => attribute.id !== attributeId);
      });
      selectedAttributes.delete(attributeSelectionKey(selected.id, attributeId));
    }
  });

  $("#inspector").addEventListener("change", (event) => {
    const field = event.target.dataset.field;
    if (!field || !selected) return;
    let value = event.target.type === "checkbox" ? event.target.checked : event.target.value.trim();
    if (field === "relationship-cardinality") {
      value = value.replace(/\s/g, "").toLowerCase();
      if (!/^(1:1|1:n|n:1|n:m)$/.test(value)) {
        showToast("Use 1:1, 1:n, n:1, or n:m for cardinality.");
        renderInspector();
        return;
      }
    }
    if (typeof value === "string" && !value) { showToast("This value cannot be empty."); renderInspector(); return; }
    changed(() => {
      if (selected.type === "entity") {
        const entity = model.entities.find((entry) => entry.id === selected.id);
        if (field === "entity-name") entity.name = value;
        if (field.startsWith("attribute-")) {
          const row = event.target.closest("[data-attribute-id]");
          const attribute = entity.attributes.find((entry) => entry.id === row.dataset.attributeId);
          const property = field.replace("attribute-", "");
          attribute[property === "name" ? "name" : property === "type" ? "type" : property] = value;
        }
      } else {
        const relationship = model.relationships.find((entry) => entry.id === selected.id);
        if (field === "relationship-name") relationship.name = value;
        if (field === "relationship-cardinality") relationship.cardinality = value;
      }
    });
  });

  $("#diagram").addEventListener("pointerdown", (event) => {
    const entityGroup = event.target.closest("[data-entity-id]");
    const attributeNode = event.target.closest("[data-attribute-id]");
    const relationshipGroup = event.target.closest("[data-relationship-id]");
    if (connectMode && entityGroup) {
      event.preventDefault();
      finishConnection(entityGroup.dataset.entityId);
      return;
    }
    if (entityGroup && !spaceDown && event.button === 0) {
      event.preventDefault();
      const entityId = entityGroup.dataset.entityId;
      selected = { type: "entity", id: entityId };
      const entity = model.entities.find((entry) => entry.id === entityId);
      const point = pointInSvg(event);
      if (attributeNode) {
        const attribute = entity.attributes.find((entry) => entry.id === attributeNode.dataset.attributeId);
        const key = attributeSelectionKey(entityId, attribute.id);
        if (event.shiftKey && selectedAttributes.has(key)) {
          selectedAttributes.delete(key);
          render();
          return;
        }
        if (event.shiftKey) {
          selectedAttributes.set(key, { entityId, attributeId: attribute.id });
        } else if (!selectedAttributes.has(key)) {
          selectedAttributes.clear();
          selectedAttributes.set(key, { entityId, attributeId: attribute.id });
        }
        const movingAttributes = [...selectedAttributes.values()].flatMap(({ entityId: selectedEntityId, attributeId }) => {
          const selectedEntity = model.entities.find((entry) => entry.id === selectedEntityId);
          const selectedAttribute = selectedEntity?.attributes.find((entry) => entry.id === attributeId);
          if (!selectedEntity || !selectedAttribute) return [];
          const selectedIndex = selectedEntity.attributes.indexOf(selectedAttribute);
          return [{ entityId: selectedEntityId, attributeId, ...attributePosition(selectedEntity, selectedAttribute, selectedIndex) }];
        });
        pointerAction = {
          type: "move-attributes", attributes: movingAttributes,
          startX: point.x, startY: point.y,
          before: clone(model), moved: false,
        };
      } else {
        selectedAttributes.clear();
        pointerAction = {
          type: "move", id: entityId, startX: point.x, startY: point.y,
          entityX: entity.x, entityY: entity.y,
          attributes: entity.attributes.map((attribute, index) => ({
            id: attribute.id,
            ...attributePosition(entity, attribute, index),
          })),
          before: clone(model), moved: false,
        };
      }
      $("#diagram").setPointerCapture(event.pointerId);
      render();
      return;
    }
    if (relationshipGroup) { select("relationship", relationshipGroup.dataset.relationshipId); return; }
    if (spaceDown || event.button === 1) {
      pointerAction = { type: "pan", startX: event.clientX, startY: event.clientY, viewX: view.x, viewY: view.y };
      $("#diagram").setPointerCapture(event.pointerId);
    } else if (event.target === $("#diagram") || event.target.classList.contains("canvas-grid")) {
      selected = null; selectedAttributes.clear(); render();
    }
  });

  $("#diagram").addEventListener("pointermove", (event) => {
    if (!pointerAction) return;
    if (pointerAction.type === "move" || pointerAction.type === "move-attributes") {
      const point = pointInSvg(event);
      const dx = point.x - pointerAction.startX;
      const dy = point.y - pointerAction.startY;
      if (Math.abs(dx) + Math.abs(dy) > 2) pointerAction.moved = true;
      if (pointerAction.type === "move-attributes") {
        pointerAction.attributes.forEach((position) => {
          const selectedEntity = model.entities.find((entry) => entry.id === position.entityId);
          const attribute = selectedEntity?.attributes.find((entry) => entry.id === position.attributeId);
          if (attribute) {
            attribute.x = Math.round(position.x + dx);
            attribute.y = Math.round(position.y + dy);
          }
        });
        renderDiagram();
      } else {
        const entity = model.entities.find((entry) => entry.id === pointerAction.id);
        if (entity) {
          entity.x = Math.round(pointerAction.entityX + dx);
          entity.y = Math.round(pointerAction.entityY + dy);
          pointerAction.attributes.forEach((position) => {
            const attribute = entity.attributes.find((entry) => entry.id === position.id);
            if (attribute) {
              attribute.x = Math.round(position.x + dx);
              attribute.y = Math.round(position.y + dy);
            }
          });
          renderDiagram();
        }
      }
    } else {
      const canvas = $("#canvas").getBoundingClientRect();
      const scale = view.width / canvas.width;
      view.x = pointerAction.viewX - (event.clientX - pointerAction.startX) * scale;
      view.y = pointerAction.viewY - (event.clientY - pointerAction.startY) * scale;
      updateView();
    }
  });

  $("#diagram").addEventListener("pointerup", () => {
    if ((pointerAction?.type === "move" || pointerAction?.type === "move-attributes") && pointerAction.moved) {
      undoStack.push(pointerAction.before);
      if (undoStack.length > 100) undoStack.shift();
      redoStack = [];
      persist(); render();
    }
    pointerAction = null;
  });

  $("#diagram").addEventListener("keydown", (event) => {
    const attributeNode = event.target.closest("[data-attribute-id]");
    if (attributeNode && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const entityNode = attributeNode.closest("[data-entity-id]");
      const entity = model.entities.find((entry) => entry.id === entityNode?.dataset.entityId);
      const attribute = entity?.attributes.find((entry) => entry.id === attributeNode.dataset.attributeId);
      if (!entity || !attribute) return;
      const position = attributePosition(entity, attribute, entity.attributes.indexOf(attribute));
      const step = event.shiftKey ? 1 : 10;
      const delta = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0],
        ArrowUp: [0, -step], ArrowDown: [0, step],
      }[event.key];
      selected = { type: "entity", id: entity.id };
      changed(() => { attribute.x = position.x + delta[0]; attribute.y = position.y + delta[1]; });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      const relationship = event.target.closest("[data-relationship-id]");
      const entity = event.target.closest("[data-entity-id]");
      if (relationship) select("relationship", relationship.dataset.relationshipId);
      if (entity) select("entity", entity.dataset.entityId);
    }
  });

  $("#canvas").addEventListener("wheel", (event) => {
    event.preventDefault();
    adjustZoomByStep(event.deltaY < 0 ? 5 : -5, event.clientX, event.clientY);
  }, { passive: false });
  const zoomSelect = $("#zoom-select");
  for (let percent = 25; percent <= 225; percent += 25) {
    const option = document.createElement("option");
    option.value = String(percent);
    option.textContent = `${percent}%`;
    zoomSelect.append(option);
  }
  $("#zoom-in").addEventListener("click", () => {
    const rect = $("#canvas").getBoundingClientRect();
    adjustZoomByStep(5, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  $("#zoom-out").addEventListener("click", () => {
    const rect = $("#canvas").getBoundingClientRect();
    adjustZoomByStep(-5, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  zoomSelect.addEventListener("change", () => {
    const rect = $("#canvas").getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1200 / view.width * 100 / Number(zoomSelect.value));
  });

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(clone(model)); model = undoStack.pop(); selected = null; selectedAttributes.clear(); persist(); render();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(clone(model)); model = redoStack.pop(); selected = null; selectedAttributes.clear(); persist(); render();
  }
  $("#undo").addEventListener("click", undo);
  $("#redo").addEventListener("click", redo);

  window.addEventListener("keydown", (event) => {
    if (event.code === "Space" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) { spaceDown = true; event.preventDefault(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault(); event.shiftKey ? redo() : undo();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
      event.preventDefault(); redo();
    } else if ((event.key === "Delete" || event.key === "Backspace") && selected && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
      event.preventDefault(); deleteSelection();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault(); persist(); showToast("Model saved locally.");
    } else if (event.key === "Escape" && connectMode) {
      connectMode = false; connectSource = null; render();
    }
  });
  window.addEventListener("keyup", (event) => { if (event.code === "Space") spaceDown = false; });
  window.addEventListener("blur", () => { spaceDown = false; });
  window.addEventListener("beforeunload", (event) => {
    if (!persist()) { event.preventDefault(); event.returnValue = ""; }
  });
  window.addEventListener("resize", () => {
    const canvas = $("#canvas").getBoundingClientRect();
    view.height = view.width * (canvas.height / canvas.width);
    updateView();
  });

  if (!stored.models[activeId]) persist();
  render();
})();

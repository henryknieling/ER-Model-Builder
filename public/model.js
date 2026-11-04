(function (root) {
  "use strict";

  const CARDINALITIES = new Set(["1:1", "1:n", "n:1", "n:m"]);
  const MAX_ENTITIES = 500;
  const MAX_RELATIONSHIPS = 1000;
  const MAX_ATTRIBUTES_PER_ENTITY = 200;

  function validateModel(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("The file must contain a model object.");
    }
    if (value.version !== 1) {
      throw new Error("This model version is not supported. Expected version 1.");
    }
    if (!Array.isArray(value.entities) || !Array.isArray(value.relationships)) {
      throw new Error("The model must include entities and relationships arrays.");
    }
    if (typeof value.name !== "string" || !value.name.trim()) {
      throw new Error("The model must have a name.");
    }
    if (value.entities.length > MAX_ENTITIES || value.relationships.length > MAX_RELATIONSHIPS) {
      throw new Error("The model exceeds the supported size.");
    }

    const entityIds = new Set();
    const modelIds = new Set();
    for (const entity of value.entities) {
      if (!entity || typeof entity.id !== "string" || !entity.id || modelIds.has(entity.id)) {
        throw new Error("Each entity needs a unique ID.");
      }
      entityIds.add(entity.id);
      modelIds.add(entity.id);
      if (typeof entity.name !== "string" || !entity.name.trim()) {
        throw new Error("Entity names cannot be empty.");
      }
      if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y) || !Array.isArray(entity.attributes)) {
        throw new Error(`Entity “${entity.name}” has invalid layout or attributes.`);
      }
      if (entity.attributes.length > MAX_ATTRIBUTES_PER_ENTITY) {
        throw new Error("An entity has too many attributes.");
      }
      const attributeIds = new Set();
      for (const [index, attribute] of entity.attributes.entries()) {
        if (!attribute || typeof attribute.id !== "string" || !attribute.id || attributeIds.has(attribute.id)) {
          throw new Error(`Entity “${entity.name}” has an attribute with an invalid ID.`);
        }
        attributeIds.add(attribute.id);
        if (typeof attribute.name !== "string" || !attribute.name.trim() || typeof attribute.type !== "string" || !attribute.type.trim()) {
          throw new Error(`Entity “${entity.name}” has an incomplete attribute.`);
        }
        if (!["pk", "nullable", "unique"].every((key) => typeof attribute[key] === "boolean")) {
          throw new Error(`Attribute “${attribute.name}” has invalid flags.`);
        }
        if (attribute.x === undefined) attribute.x = entity.x + (index % 2 === 0 ? -100 : 270);
        if (attribute.y === undefined) attribute.y = entity.y + 29 + Math.floor(index / 2) * 58;
        if (!Number.isFinite(attribute.x) || !Number.isFinite(attribute.y) || Math.abs(attribute.x) > 100000 || Math.abs(attribute.y) > 100000) {
          throw new Error(`Attribute “${attribute.name}” has invalid canvas coordinates.`);
        }
      }
    }

    const relationshipIds = new Set();
    for (const relationship of value.relationships) {
      if (!relationship || typeof relationship.id !== "string" || !relationship.id || modelIds.has(relationship.id)) {
        throw new Error("Each relationship needs a unique ID.");
      }
      relationshipIds.add(relationship.id);
      modelIds.add(relationship.id);
      if (typeof relationship.name !== "string" || !relationship.name.trim() ||
          typeof relationship.from !== "string" || typeof relationship.to !== "string" ||
          !entityIds.has(relationship.from) || !entityIds.has(relationship.to)) {
        throw new Error("A relationship has an invalid name or endpoint.");
      }
      if (typeof relationship.cardinality !== "string" || !CARDINALITIES.has(relationship.cardinality.replace(/\s/g, "").toLowerCase())) {
        throw new Error("A relationship uses an unsupported cardinality.");
      }
      relationship.cardinality = relationship.cardinality.replace(/\s/g, "").toLowerCase();
    }

    return JSON.parse(JSON.stringify({
      version: 1,
      id: typeof value.id === "string" && value.id ? value.id : crypto.randomUUID(),
      name: value.name.trim(),
      entities: value.entities,
      relationships: value.relationships,
    }));
  }

  const api = Object.freeze({ validateModel });
  root.ERModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

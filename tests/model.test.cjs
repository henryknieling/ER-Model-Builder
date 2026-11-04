const test = require("node:test");
const assert = require("node:assert/strict");
const { validateModel } = require("../public/model.js");

function sample() {
  return {
    version: 1,
    id: "model-1",
    name: "Shop",
    entities: [
      {
        id: "entity-1",
        name: "Customer",
        x: 120,
        y: 80,
        attributes: [
          { id: "attribute-1", name: "id", type: "integer", pk: true, nullable: false, unique: true, x: 20, y: 109 },
        ],
      },
      { id: "entity-2", name: "Order", x: 420, y: 80, attributes: [] },
    ],
    relationships: [
      { id: "relationship-1", name: "places", from: "entity-1", to: "entity-2", cardinality: "1:n" },
    ],
  };
}

test("version 1 model JSON round-trips without losing layout or model data", () => {
  const input = sample();
  const restored = validateModel(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(restored, input);
});

test("rejects unsupported model versions", () => {
  const input = sample();
  input.version = 2;
  assert.throws(() => validateModel(input), /version is not supported/);
});

test("rejects incomplete attributes and unknown relationship endpoints", () => {
  const invalidAttribute = sample();
  invalidAttribute.entities[0].attributes[0].type = " ";
  assert.throws(() => validateModel(invalidAttribute), /incomplete attribute/);

  const invalidRelationship = sample();
  invalidRelationship.relationships[0].to = "missing-entity";
  assert.throws(() => validateModel(invalidRelationship), /invalid name or endpoint/);
});

test("rejects duplicate IDs, empty names, and unsupported cardinalities", () => {
  const duplicateId = sample();
  duplicateId.relationships[0].id = duplicateId.entities[0].id;
  assert.throws(() => validateModel(duplicateId), /unique ID/);

  const emptyName = sample();
  emptyName.entities[0].name = "  ";
  assert.throws(() => validateModel(emptyName), /Entity names cannot be empty/);

  const invalidCardinality = sample();
  invalidCardinality.relationships[0].cardinality = "0:n";
  assert.throws(() => validateModel(invalidCardinality), /unsupported cardinality/);
});

test("accepts hand-written cardinalities and normalizes their case and spacing", () => {
  for (const cardinality of ["1:n", "N:M", " n : 1 "]) {
    const input = sample();
    input.relationships[0].cardinality = cardinality;
    const normalized = validateModel(input);
    assert.equal(normalized.relationships[0].cardinality, cardinality.replace(/\s/g, "").toLowerCase());
  }
});

test("keeps custom attribute bubble positions and migrates older models", () => {
  const positioned = sample();
  positioned.entities[0].attributes[0].x = 800;
  positioned.entities[0].attributes[0].y = 425;
  const restored = validateModel(JSON.parse(JSON.stringify(positioned)));
  assert.equal(restored.entities[0].attributes[0].x, 800);
  assert.equal(restored.entities[0].attributes[0].y, 425);

  const older = sample();
  delete older.entities[0].attributes[0].x;
  delete older.entities[0].attributes[0].y;
  const migrated = validateModel(older);
  assert.equal(migrated.entities[0].attributes[0].x, 20);
  assert.equal(migrated.entities[0].attributes[0].y, 109);
});

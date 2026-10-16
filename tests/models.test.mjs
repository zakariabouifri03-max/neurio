import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import validator from "gltf-validator";

const models = [
  "hollowpine-forest-campsite.glb",
  "hollowpine-survivor.glb",
  "hollowpine-field-hatchet.glb",
  "echo-operative-carbon.glb",
];
for (const name of models)
  test(`model: ${name} is a valid, self-contained static glTF 2.0 asset`, async () => {
    const data = await fs.readFile(
      new URL(`../models/${name}`, import.meta.url),
    );
    assert.equal(data.readUInt32LE(0), 0x46546c67);
    assert.equal(data.readUInt32LE(4), 2);
    assert.equal(data.readUInt32LE(8), data.length);
    const gltf = JSON.parse(
      data.toString("utf8", 20, 20 + data.readUInt32LE(12)),
    );
    assert.ok(gltf.meshes.length > 0);
    assert.ok(gltf.nodes.length > 0);
    assert.ok(
      gltf.buffers.every((b) => !b.uri),
      "All buffers must be embedded.",
    );
    assert.ok(
      (gltf.images || []).every((i) => i.bufferView !== undefined),
      "All textures must be embedded.",
    );
    assert.equal(gltf.skins?.length || 0, 0);
    assert.equal(gltf.animations?.length || 0, 0);
    const report = await validator.validateBytes(new Uint8Array(data), {
      uri: name,
    });
    assert.equal(
      report.issues.numErrors,
      0,
      JSON.stringify(report.issues.messages),
    );
    assert.equal(
      report.issues.numWarnings,
      0,
      JSON.stringify(report.issues.messages),
    );
  });

import assert from "node:assert/strict";
import test from "node:test";

import { boundedInteger } from "../scripts/config-values.mjs";

test("boundedInteger accepts finite values within the configured range", () => {
  assert.equal(boundedInteger("3010", 3000, { min: 1, max: 65_535 }), 3010);
  assert.equal(boundedInteger(1800.9, 1000, { min: 100, max: 60_000 }), 1800);
});

test("boundedInteger rejects invalid values and clamps unsafe timer ranges", () => {
  assert.equal(boundedInteger("invalid", 1000, { min: 100, max: 60_000 }), 1000);
  assert.equal(boundedInteger(0, 1000, { min: 100, max: 60_000 }), 100);
  assert.equal(boundedInteger(Number.MAX_SAFE_INTEGER, 1000, { min: 100, max: 60_000 }), 60_000);
});

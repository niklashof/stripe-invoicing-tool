import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_VAT_RATE, lookupVat } from "../config";

test("lookupVat uses Stripe product metadata as the canonical source", () => {
  const result = lookupVat("prod_123", "Early Check-in", { vat_rate: "7" });

  assert.equal(result.label, "Early Check-in");
  assert.equal(result.vatRate, 7);
  assert.equal(result.source, "metadata");
  assert.equal(result.warning, undefined);
});

test("lookupVat defaults to standard VAT and warns when metadata is missing", () => {
  const result = lookupVat("prod_456", "Parking", {});

  assert.equal(result.vatRate, DEFAULT_VAT_RATE);
  assert.equal(result.source, "default");
  assert.match(result.warning || "", /VAT metadata missing/);
  assert.match(result.warning || "", /prod_456/);
});

test("lookupVat defaults to standard VAT and warns when metadata is invalid", () => {
  const result = lookupVat("prod_789", "Late Check-out", { vat_rate: "reduced" });

  assert.equal(result.vatRate, DEFAULT_VAT_RATE);
  assert.equal(result.source, "default");
  assert.match(result.warning || "", /VAT metadata invalid/);
  assert.match(result.warning || "", /reduced/);
});

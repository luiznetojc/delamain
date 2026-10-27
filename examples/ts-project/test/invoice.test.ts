import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateInvoiceTotalCents } from "../src/invoice.ts";

describe("calculateInvoiceTotalCents", () => {
  it("computes subtotal plus basis-point tax accurately", () => {
    const total = calculateInvoiceTotalCents(
      [
        { description: "Compute Hours", quantity: 2, unitPriceCents: 5000 },
        { description: "Storage", quantity: 1, unitPriceCents: 2000 }
      ],
      1000
    );
    assert.equal(total, 13200);
  });

  it("rejects negative quantities", () => {
    assert.throws(() =>
      calculateInvoiceTotalCents([{ description: "Invalid", quantity: -1, unitPriceCents: 100 }])
    );
  });
});

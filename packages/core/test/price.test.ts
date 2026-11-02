import { describe, expect, it } from "vitest";
import { askUnit, bidUnit, buyTotal, isqrt, ratio, sellTotal, type Quote } from "../src/price";

const q = (base: number, spread_bps: number, target: number): Quote => ({ token_id: "yuzu", base, spread_bps, target });

describe("price curve (same vectors as contracts/bazaar/src/price.rs)", () => {
  it("isqrt", () => {
    for (const n of [0n, 1n, 2n, 3n, 4n, 15n, 16n, 17n, 1_000_000n, 999_999_999_999n]) {
      const r = isqrt(n);
      expect(r * r <= n && (r + 1n) * (r + 1n) > n).toBe(true);
    }
  });

  it("vectors", () => {
    const quote = q(5, 800, 20);
    expect(ratio(20, 20n)).toBe(1_000_000n);
    expect(askUnit(quote, 20n)).toBe(6);
    expect(bidUnit(quote, 20n)).toBe(4);
    expect(askUnit(quote, 0n)).toBe(14);
    expect(bidUnit(quote, 200n)).toBe(2);
    expect(sellTotal(quote, 20n, 3)).toBe(12);
    expect(buyTotal(quote, 20n, 3)).toBe(18);
  });

  it("no round-trip profit", () => {
    for (const base of [1, 2, 5, 9, 30])
      for (const spread of [0, 100, 800, 3000])
        for (const stock of [0n, 1n, 3n, 10n, 50n]) {
          const quote = q(base, spread, 20);
          expect(buyTotal(quote, stock + 1n, 1)).toBeGreaterThanOrEqual(sellTotal(quote, stock, 1));
        }
  });
});

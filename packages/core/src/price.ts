// Mirror of contracts/bazaar/src/price.rs. Same integer math, same test vectors.
// mid(stock) = base * sqrt((target + 1) / (stock + 1)), clamped to [base/2, base*2.5]
// ask = ceil(mid * (1 + spread)), bid = floor(mid * (1 - spread)), both >= 1 coin.

export interface Quote {
  token_id: string;
  base: number;
  spread_bps: number;
  target: number;
}

const SCALE = 1_000_000n;

export function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

export function ratio(target: number, stock: bigint): bigint {
  const num = (BigInt(target) + 1n) * SCALE * SCALE;
  const r = isqrt(num / (stock + 1n));
  const lo = SCALE / 2n;
  const hi = (SCALE * 5n) / 2n;
  return r < lo ? lo : r > hi ? hi : r;
}

export function askUnit(q: Quote, stock: bigint): number {
  const m = BigInt(q.base) * ratio(q.target, stock) * (10_000n + BigInt(q.spread_bps));
  const d = SCALE * 10_000n;
  const v = (m + d - 1n) / d;
  return Math.max(1, Number(v));
}

export function bidUnit(q: Quote, stock: bigint): number {
  const spread = BigInt(Math.min(q.spread_bps, 9_000));
  const m = BigInt(q.base) * ratio(q.target, stock) * (10_000n - spread);
  return Math.max(1, Number(m / (SCALE * 10_000n)));
}

/** Coins a player receives for selling `units` to a stall holding `stock`. */
export function sellTotal(q: Quote, stock: bigint, units: number): number {
  let t = 0;
  for (let i = 1n; i <= BigInt(units); i++) t += bidUnit(q, stock + i);
  return t;
}

/** Coins a player pays for buying `units` from a stall holding `stock`. */
export function buyTotal(q: Quote, stock: bigint, units: number): number {
  let t = 0;
  for (let i = 0n; i < BigInt(units); i++) t += askUnit(q, stock - i);
  return t;
}

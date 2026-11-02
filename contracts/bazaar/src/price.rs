//! Stall price curve. Mirrored exactly in `packages/core/src/price.ts`; keep them in sync
//! (the `price_vectors` test and the TS test use the same vectors).
//!
//! mid(stock) = base * sqrt((target + 1) / (stock + 1)), clamped to [base/4, base*4]
//! ask = ceil(mid * (1 + spread)), bid = floor(mid * (1 - spread)), both at least 1 coin.
//!
//! A player selling n units gets bid() evaluated at the stock *after* each unit lands; a player
//! buying pays ask() at the stock *before* each unit leaves. So sell-then-buy never profits.

use capy_types::Quote;

pub const SCALE: u128 = 1_000_000;

pub fn isqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

/// sqrt((target + 1) / (stock + 1)) scaled by 1e6, clamped to [0.25, 4.0].
pub fn ratio(target: u32, stock: u128) -> u128 {
    let num = (target as u128 + 1) * SCALE * SCALE;
    isqrt(num / (stock + 1)).clamp(SCALE / 4, SCALE * 4)
}

pub fn ask_unit(q: &Quote, stock: u128) -> u64 {
    let m = q.base as u128 * ratio(q.target, stock) * (10_000 + q.spread_bps as u128);
    let d = SCALE * 10_000;
    (m.div_ceil(d) as u64).max(1)
}

pub fn bid_unit(q: &Quote, stock: u128) -> u64 {
    let spread = q.spread_bps.min(9_000) as u128;
    let m = q.base as u128 * ratio(q.target, stock) * (10_000 - spread);
    ((m / (SCALE * 10_000)) as u64).max(1)
}

/// Coins a player receives for selling `units` to a stall holding `stock`.
pub fn sell_total(q: &Quote, stock: u128, units: u32) -> u64 {
    (1..=units as u128).map(|i| bid_unit(q, stock + i)).sum()
}

/// Coins a player pays for buying `units` from a stall holding `stock` (requires stock >= units).
pub fn buy_total(q: &Quote, stock: u128, units: u32) -> u64 {
    (0..units as u128).map(|i| ask_unit(q, stock - i)).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(base: u32, spread_bps: u16, target: u32) -> Quote {
        Quote { token_id: "yuzu".into(), base, spread_bps, target }
    }

    #[test]
    fn isqrt_exact() {
        for n in [0u128, 1, 2, 3, 4, 15, 16, 17, 1_000_000, 999_999_999_999] {
            let r = isqrt(n);
            assert!(r * r <= n && (r + 1) * (r + 1) > n, "isqrt({n})");
        }
    }

    #[test]
    fn price_vectors() {
        // Shared with packages/core/test/price.test.ts
        let quote = q(5, 800, 20);
        assert_eq!(ratio(20, 20), 1_000_000);
        assert_eq!(ask_unit(&quote, 20), 6);
        assert_eq!(bid_unit(&quote, 20), 4);
        assert_eq!(ask_unit(&quote, 0), 22); // empty shelf: 4x clamp
        assert_eq!(bid_unit(&quote, 200), 1); // flooded: floor of 1 coin
        assert_eq!(sell_total(&quote, 20, 3), 12);
        assert_eq!(buy_total(&quote, 20, 3), 18);
    }

    #[test]
    fn flooding_lowers_bids() {
        let quote = q(9, 500, 10);
        let mut last = u64::MAX;
        for stock in [0u128, 5, 10, 20, 40, 80] {
            let b = bid_unit(&quote, stock);
            assert!(b <= last);
            last = b;
        }
    }

    #[test]
    fn no_round_trip_profit() {
        for base in [1u32, 2, 5, 9, 30] {
            for spread in [0u16, 100, 800, 3000] {
                for stock in [0u128, 1, 3, 10, 50] {
                    let quote = q(base, spread, 20);
                    let got = sell_total(&quote, stock, 1);
                    let pay = buy_total(&quote, stock + 1, 1);
                    assert!(pay >= got, "base {base} spread {spread} stock {stock}");
                }
            }
        }
    }
}

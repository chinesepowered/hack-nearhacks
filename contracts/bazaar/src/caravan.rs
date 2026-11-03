//! The wholesale caravan: a coordination market between the shopkeeper agents.
//!
//! Each round a caravan arrives wanting some quantity of each good, up to a maximum price.
//! Keepers offer stock (escrowed when offered). At the end of the round anyone may settle it:
//! for each good, offers are filled cheapest first (no stall may supply more than
//! `caravan_stall_cap_bps` of the round) and every filled unit is paid the same clearing price
//! (the highest accepted offer). Coins paid by the caravan are minted, which is
//! how new coins enter the town; rent is burned from every stall each round.

use crate::*;
use capy_types::{OfferIn, COIN};

#[near]
impl Bazaar {
    /// Called by a stall account (keeper key → stall contract → here).
    pub fn stall_offer(&mut self, offers: Vec<OfferIn>) {
        let stall_id = env::predecessor_account_id();
        require!(self.stalls.contains_key(&stall_id), "only stall accounts can offer");
        let now = self.now();
        require!(now < self.caravan.closes_ms, "the caravan is packing up; wait for the next round");
        for o in offers {
            require!(
                self.caravan.demand.iter().any(|d| d.token_id == o.token_id),
                "the caravan is not buying that this round"
            );
            // Replace this stall's previous offer for the same good.
            if let Some(i) = self
                .caravan
                .offers
                .iter()
                .position(|x| x.stall_id == stall_id && x.token_id == o.token_id)
            {
                let old = self.caravan.offers.remove(i);
                self.credit(&stall_id, &old.token_id, old.qty as u128);
            }
            if o.qty == 0 {
                continue;
            }
            require!(o.min_price >= 1, "min price must be positive");
            self.debit(&stall_id, &o.token_id, o.qty as u128);
            self.caravan.offers.push(Offer {
                stall_id: stall_id.clone(),
                token_id: o.token_id.clone(),
                qty: o.qty,
                min_price: o.min_price,
                ms: now,
            });
            self.push_feed("offer", &stall_id, Some(&stall_id), Some(&o.token_id), o.qty, o.min_price as u64, 0);
        }
    }

    /// Anyone can settle a finished round (the keeper runner does it automatically).
    pub fn settle_caravan(&mut self) -> Vec<Fill> {
        let now = self.now();
        require!(now >= self.caravan.closes_ms, "the caravan is still trading");
        let demand = self.caravan.demand.clone();
        let mut offers = std::mem::take(&mut self.caravan.offers);
        offers.sort_by(|a, b| a.min_price.cmp(&b.min_price).then(a.ms.cmp(&b.ms)));
        let mut fills: Vec<Fill> = vec![];

        for d in &demand {
            let mut remaining = d.qty;
            let mut accepted: Vec<(AccountId, u32)> = vec![];
            let mut clearing = 0u32;
            // The caravan likes variety: no single stall supplies more than a share of the round.
            let cap = ((d.qty as u64 * self.config.caravan_stall_cap_bps as u64).div_ceil(10_000) as u32).max(1);
            for o in offers.iter_mut().filter(|o| o.token_id == d.token_id) {
                if remaining == 0 || o.min_price > d.max_price {
                    break;
                }
                let take = o.qty.min(remaining).min(cap);
                if take == 0 {
                    continue;
                }
                remaining -= take;
                o.qty -= take;
                clearing = o.min_price;
                accepted.push((o.stall_id.clone(), take));
            }
            for (stall_id, qty) in accepted {
                let coins = qty as u128 * clearing as u128;
                self.burn_supply(&stall_id, &d.token_id, qty as u128, "sold to the caravan");
                self.mint(&stall_id, COIN, coins, "caravan payment");
                if let Some(s) = self.stalls.get_mut(&stall_id) {
                    s.stats.caravan_units += qty;
                    s.stats.caravan_coins += coins as u64;
                }
                fills.push(Fill { stall_id, token_id: d.token_id.clone(), qty, price: clearing });
            }
        }
        // Unfilled stock goes back to the stalls.
        for o in offers.into_iter().filter(|o| o.qty > 0) {
            self.credit(&o.stall_id, &o.token_id, o.qty as u128);
        }
        // Rent.
        let rent = self.config.stall_rent as u128;
        let ids: Vec<AccountId> = self.stalls.keys().cloned().collect();
        for id in ids {
            let due = self.bal(&id, COIN).min(rent);
            self.burn(&id, COIN, due, "stall rent");
        }
        let units: u32 = fills.iter().map(|f| f.qty).sum();
        let coins: u64 = fills.iter().map(|f| f.qty as u64 * f.price as u64).sum();
        let settler = env::predecessor_account_id();
        self.push_feed("caravan", &settler, None, None, units, coins, 0);
        self.caravan.last_fills = fills.clone();
        self.stats.caravan_rounds += 1;
        self.open_caravan_round();
        fills
    }
}

impl Bazaar {
    pub(crate) fn open_caravan_round(&mut self) {
        let now = self.now();
        let seed = env::sha256_array(
            [env::random_seed_array().as_slice(), &self.caravan.round.to_le_bytes()].concat(),
        );
        let demand = self
            .goods
            .iter()
            .enumerate()
            .map(|(i, g)| {
                let r1 = seed[i * 2] as u32;
                let r2 = seed[i * 2 + 1] as u32;
                let span = g.caravan_max_qty - g.caravan_min_qty + 1;
                let qty = g.caravan_min_qty + r1 % span;
                let pct = 80 + r2 % 81; // 80%..160% of the reference price
                Demand { token_id: g.id.clone(), qty, max_price: (g.ref_price * pct / 100).max(1) }
            })
            .collect();
        self.caravan.round += 1;
        self.caravan.opens_ms = now;
        self.caravan.closes_ms = now + self.config.caravan_round_ms.0;
        self.caravan.demand = demand;
    }
}

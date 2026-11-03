//! Player-facing actions. Guest players call these with a function-call key scoped to this
//! contract (no deposits, no wallet popups); wallet players can call them directly too.

use crate::*;
use crate::price::{buy_total, sell_total};
use capy_types::COIN;
use near_sdk::json_types::{U128, U64};
use near_sdk::{Allowance, Gas, NearToken, Promise};

#[near]
impl Bazaar {
    /// Creates `<username>.<this account>` for a guest, with `public_key` as a function-call key
    /// that can call any method on this contract but cannot attach deposits or move NEAR.
    /// Admin-only, because this contract pays for the account.
    pub fn create_player(&mut self, username: String, public_key: PublicKey, name: String) -> Promise {
        self.assert_admin();
        require!(
            username.len() >= 2
                && username.len() <= 24
                && username.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
            "username must be 2-24 chars of a-z, 0-9 or -"
        );
        let account: AccountId = format!("{username}.{}", env::current_account_id())
            .parse()
            .unwrap_or_else(|_| env::panic_str("invalid account id"));
        require!(!self.players.contains_key(&account), "that capybara already lives here");
        self.insert_player(&account, name, false);
        let me = env::current_account_id();
        Promise::new(account.clone())
            .create_account()
            .transfer(NearToken::from_yoctonear(self.config.player_funding.0))
            .add_access_key_allowance(public_key, Allowance::unlimited(), me.clone(), "")
            .and(self.tusdc_register(&account))
            .then(
                Self::ext(me)
                    .with_static_gas(Gas::from_tgas(10))
                    .on_player_created(account),
            )
    }

    #[private]
    pub fn on_player_created(&mut self, account_id: AccountId) -> bool {
        let created = matches!(env::promise_result_checked(0, 1024), Ok(_));
        if created {
            if let Some(p) = self.players.get_mut(&account_id) {
                p.ready = true;
            }
            self.push_feed("join", &account_id, None, None, 0, 0, 0);
            true
        } else {
            self.remove_player(&account_id);
            false
        }
    }

    /// Join with an existing account (wallet users). Pays its own storage.
    #[payable]
    pub fn register(&mut self, name: String) -> Promise {
        let who = env::predecessor_account_id();
        require!(!self.players.contains_key(&who), "already registered");
        require!(
            env::attached_deposit() >= NearToken::from_millinear(20),
            "attach 0.02 NEAR for storage"
        );
        self.insert_player(&who, name, true);
        self.push_feed("join", &who, None, None, 0, 0, 0);
        self.tusdc_register(&who)
    }

    // ------------------------------------------------------------------ the loop

    /// Forage at the meadow (grass), grove (yuzu) or field (watermelon). Costs one energy.
    pub fn forage(&mut self, spot: String) -> ForageResult {
        let who = env::predecessor_account_id();
        let now = self.now();
        let mut p = self.player(&who);
        let (energy, energy_ms) = self.energy_now(&p, now);
        require!(energy >= 1, "your capybara is tired; take a soak at the bathhouse");
        require!(
            now >= p.last_forage_ms + self.config.forage_cooldown_ms.0,
            "still foraging, give it a moment"
        );
        let good = self
            .goods
            .iter()
            .find(|g| g.spot == spot)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown spot: try meadow, grove or field"));
        let seed = env::sha256_array(
            [
                env::random_seed_array().as_slice(),
                who.as_bytes(),
                &p.forages.to_le_bytes(),
            ]
            .concat(),
        );
        let span = good.forage_max - good.forage_min + 1;
        let qty = (good.forage_min + seed[0] % span) as u32;
        p.energy = energy - 1;
        p.energy_ms = energy_ms;
        p.last_forage_ms = now;
        p.forages += 1;
        let left = p.energy;
        self.players.insert(who.clone(), p);
        self.mint(&who, &good.id, qty as u128, "forage");
        self.stats.forages += 1;
        self.push_feed("forage", &who, None, Some(&good.id), qty, 0, 0);
        ForageResult { token_id: good.id, qty, energy: left }
    }

    /// Sell goods to a stall at its current bid. `min_coins` protects against price moves.
    pub fn sell(&mut self, stall_id: AccountId, token_id: String, amount: u32, min_coins: U64) -> TradeResult {
        let who = env::predecessor_account_id();
        self.player(&who);
        require!(amount >= 1 && amount <= self.config.max_trade_units, "bad amount");
        let s = self.stall(&stall_id);
        require!(self.is_open(&stall_id, &s), "this stall is closed");
        let q = s
            .quotes
            .iter()
            .find(|q| q.token_id == token_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("this stall does not buy that"));
        let stock = self.bal(&stall_id, &token_id);
        require!(
            stock + amount as u128 <= crate::price::shelf_cap(&q),
            "this stall's shelves are full of that; try another stall"
        );
        let total = sell_total(&q, stock, amount);
        require!(total >= min_coins.0, "price moved; try again");
        require!(
            self.bal(&stall_id, COIN) >= total as u128,
            "the stall cannot afford that many right now"
        );
        self.transfer_many(
            &[
                (&who, &stall_id, &token_id, amount as u128),
                (&stall_id, &who, COIN, total as u128),
            ],
            "sell",
        );
        self.after_trade(&who, &stall_id, &token_id, amount, total, true);
        self.push_feed("sell", &who, Some(&stall_id), Some(&token_id), amount, total, 0);
        TradeResult { token_id, qty: amount, coins: U64(total) }
    }

    /// Buy goods from a stall at its current ask. `max_coins` protects against price moves.
    pub fn buy(&mut self, stall_id: AccountId, token_id: String, amount: u32, max_coins: U64) -> TradeResult {
        let who = env::predecessor_account_id();
        self.player(&who);
        require!(amount >= 1 && amount <= self.config.max_trade_units, "bad amount");
        let s = self.stall(&stall_id);
        require!(self.is_open(&stall_id, &s), "this stall is closed");
        let q = s
            .quotes
            .iter()
            .find(|q| q.token_id == token_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("this stall does not sell that"));
        let stock = self.bal(&stall_id, &token_id);
        require!(stock >= amount as u128, "sold out");
        let total = buy_total(&q, stock, amount);
        require!(total <= max_coins.0, "price moved; try again");
        self.transfer_many(
            &[
                (&who, &stall_id, COIN, total as u128),
                (&stall_id, &who, &token_id, amount as u128),
            ],
            "buy",
        );
        self.after_trade(&who, &stall_id, &token_id, amount, total, false);
        self.push_feed("buy", &who, Some(&stall_id), Some(&token_id), amount, total, 0);
        TradeResult { token_id, qty: amount, coins: U64(total) }
    }

    /// A soak at a bathhouse refills energy. The bathhouse uses one yuzu per soak, and a slice
    /// of the price is burned as spring upkeep.
    pub fn soak(&mut self, stall_id: AccountId, max_coins: U64) -> u8 {
        let who = env::predecessor_account_id();
        let mut p = self.player(&who);
        let s = self.stall(&stall_id);
        require!(s.kind == StallKind::Bathhouse, "that is not a bathhouse");
        require!(self.is_open(&stall_id, &s), "the bathhouse is closed");
        let price = s.soak_price as u64;
        require!(price <= max_coins.0, "price moved; try again");
        let yuzu = self.config.soak_yuzu as u128;
        require!(self.bal(&stall_id, "yuzu") >= yuzu, "the bathhouse ran out of yuzu");
        let burned = price * self.config.soak_burn_bps as u64 / 10_000;
        self.burn(&who, COIN, burned as u128, "spring upkeep");
        self.transfer_many(&[(&who, &stall_id, COIN, (price - burned) as u128)], "soak");
        self.burn(&stall_id, "yuzu", yuzu, "yuzu bath");
        p.energy = self.config.energy_max;
        p.energy_ms = self.now();
        p.soaks += 1;
        self.players.insert(who.clone(), p);
        if let Some(st) = self.stalls.get_mut(&stall_id) {
            st.stats.soaks += 1;
            st.stats.coins_volume += price;
        }
        self.stats.soaks += 1;
        self.push_feed("soak", &who, Some(&stall_id), None, 1, price, 0);
        self.config.energy_max
    }

    /// Give coins to any stall, e.g. to reopen a broke one.
    pub fn invest(&mut self, stall_id: AccountId, amount: U64) {
        let who = env::predecessor_account_id();
        let s = self.stall(&stall_id);
        require!(s.ready, "stall not ready");
        require!(amount.0 > 0, "bad amount");
        self.transfer_many(&[(&who, &stall_id, COIN, amount.0 as u128)], "invest");
        self.push_feed("invest", &who, Some(&stall_id), Some(COIN), 0, amount.0, 0);
    }

    pub fn equip_hat(&mut self, hat_id: Option<String>) {
        let who = env::predecessor_account_id();
        let mut p = self.player(&who);
        if let Some(h) = &hat_id {
            require!(self.bal(&who, h) > 0, "you don't own that hat");
        }
        p.hat = hat_id;
        self.players.insert(who, p);
    }
}

impl Bazaar {
    fn insert_player(&mut self, account: &AccountId, name: String, ready: bool) {
        require!(name.len() <= 32, "name too long");
        let now = self.now();
        self.players.insert(
            account.clone(),
            Player {
                name,
                energy: self.config.energy_max,
                energy_ms: now,
                last_forage_ms: 0,
                hat: None,
                joined_ms: now,
                forages: 0,
                trades: 0,
                soaks: 0,
                hats_bought: 0,
                ready,
            },
        );
        self.player_list.push(account.clone());
        self.stats.players += 1;
        self.mint(account, COIN, self.config.start_coins as u128, "welcome coins");
    }

    fn remove_player(&mut self, account: &AccountId) {
        let coins = self.bal(account, COIN);
        self.burn(account, COIN, coins, "join failed");
        self.players.remove(account);
        self.stats.players = self.stats.players.saturating_sub(1);
    }

    pub(crate) fn tusdc_register(&self, account: &AccountId) -> Promise {
        Promise::new(self.tusdc.clone()).function_call(
            "storage_deposit".to_string(),
            json!({ "account_id": account, "registration_only": true })
                .to_string()
                .into_bytes(),
            NearToken::from_yoctonear(self.config.tusdc_storage.0),
            Gas::from_tgas(8),
        )
    }

    pub(crate) fn energy_now(&self, p: &Player, now: u64) -> (u8, u64) {
        let max = self.config.energy_max;
        if p.energy >= max {
            return (p.energy, now);
        }
        let regen = self.config.energy_regen_ms.0.max(1);
        let gained = now.saturating_sub(p.energy_ms) / regen;
        let e = (p.energy as u64 + gained).min(max as u64) as u8;
        let ms = if e >= max { now } else { p.energy_ms + gained * regen };
        (e, ms)
    }

    fn after_trade(
        &mut self,
        who: &AccountId,
        stall_id: &AccountId,
        token_id: &str,
        amount: u32,
        coins: u64,
        stall_bought: bool,
    ) {
        if let Some(mut p) = self.players.get(who).cloned() {
            p.trades += 1;
            self.players.insert(who.clone(), p);
        }
        if let Some(s) = self.stalls.get_mut(stall_id) {
            s.stats.trades += 1;
            s.stats.coins_volume += coins;
            match s.window.iter_mut().find(|w| w.token_id == token_id) {
                Some(w) => {
                    if stall_bought {
                        w.bought += amount
                    } else {
                        w.sold += amount
                    }
                }
                None => s.window.push(WindowEntry {
                    token_id: token_id.to_string(),
                    bought: if stall_bought { amount } else { 0 },
                    sold: if stall_bought { 0 } else { amount },
                }),
            }
        }
        self.stats.trades += 1;
    }
}

/// Helper used by callbacks that joined several promises with `.and()`.
pub(crate) fn all_succeeded() -> bool {
    (0..env::promise_results_count()).all(|i| env::promise_result_checked(i, 4096).is_ok())
}

#[allow(dead_code)]
pub(crate) fn u128s(v: u128) -> U128 {
    U128(v)
}

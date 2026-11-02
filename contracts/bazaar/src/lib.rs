//! Capybazaar: a hot-spring market town where every stall is an NFT that is its own NEAR account.
//!
//! This contract is three things at one account:
//! - a NEP-245 multi-token ledger for goods, the `coin` soft currency and hats;
//! - the NEP-171 collection whose tokens are stall accounts (`<slug>.<this account>`);
//! - the market: foraging, trading against stall quotes, soaks, hats paid in tUSDC, the caravan.
//!
//! Stall accounts run the `stall` global contract. They are the authority on their own owner
//! (see `stall/src/lib.rs`); this contract is the index and the venue that rotates owners.

mod caravan;
mod play;
pub mod price;
mod stalls;
pub mod types;
mod usd;
mod views;

#[cfg(test)]
mod tests;

use capy_types::{TokenId, COIN};
use near_sdk::json_types::Base58CryptoHash;
use near_sdk::serde_json::{json, Value};
use near_sdk::store::{IterableMap, LookupMap, Vector};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, CryptoHash, PanicOnDefault, PublicKey,
};
use types::*;

pub const FEED_CAP: u32 = 80;
pub const NEP245: (&str, &str) = ("nep245", "1.0.0");
pub const NEP171: (&str, &str) = ("nep171", "1.2.0");

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Balances,
    Supply,
    Players,
    PlayerList,
    Usd,
    Stalls,
    OwnerStalls,
    Feed,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Bazaar {
    admin: AccountId,
    tusdc: AccountId,
    stall_code_hash: CryptoHash,
    house_key: PublicKey,
    config: Config,
    goods: Vec<GoodInfo>,
    hats: Vec<HatInfo>,
    balances: LookupMap<(AccountId, TokenId), u128>,
    supply: LookupMap<TokenId, u128>,
    players: LookupMap<AccountId, Player>,
    player_list: Vector<AccountId>,
    /// tUSDC deposited by players, in micro-USD. Backed 1:1 by tUSDC held by this account.
    usd: LookupMap<AccountId, u64>,
    treasury_usd: u64,
    stalls: IterableMap<AccountId, StallIndex>,
    owner_stalls: LookupMap<AccountId, Vec<AccountId>>,
    caravan: Caravan,
    feed: Vector<FeedItem>,
    feed_seq: u64,
    stats: Stats,
}

pub fn default_goods() -> Vec<GoodInfo> {
    vec![
        GoodInfo {
            id: "grass".into(),
            name: "Sweet grass".into(),
            ref_price: 2,
            spot: "meadow".into(),
            forage_min: 2,
            forage_max: 4,
            caravan_min_qty: 12,
            caravan_max_qty: 40,
        },
        GoodInfo {
            id: "yuzu".into(),
            name: "Yuzu".into(),
            ref_price: 5,
            spot: "grove".into(),
            forage_min: 1,
            forage_max: 3,
            caravan_min_qty: 6,
            caravan_max_qty: 20,
        },
        GoodInfo {
            id: "melon".into(),
            name: "Watermelon".into(),
            ref_price: 9,
            spot: "field".into(),
            forage_min: 1,
            forage_max: 2,
            caravan_min_qty: 3,
            caravan_max_qty: 10,
        },
    ]
}

pub fn default_hats() -> Vec<HatInfo> {
    use near_sdk::json_types::U64;
    let ing = |t: &str, q: u32| Ingredient { token_id: t.into(), qty: q };
    vec![
        HatInfo {
            id: "hat-yuzu".into(),
            name: "Yuzu hat".into(),
            ref_price_usd: U64(1_000_000),
            recipe: vec![ing("yuzu", 2)],
        },
        HatInfo {
            id: "hat-lily".into(),
            name: "Lily crown".into(),
            ref_price_usd: U64(750_000),
            recipe: vec![ing("grass", 4)],
        },
        HatInfo {
            id: "hat-melon".into(),
            name: "Melon helmet".into(),
            ref_price_usd: U64(1_500_000),
            recipe: vec![ing("melon", 1)],
        },
        HatInfo {
            id: "hat-duck".into(),
            name: "Duckling buddy".into(),
            ref_price_usd: U64(2_000_000),
            recipe: vec![ing("grass", 2), ing("melon", 1)],
        },
    ]
}

#[near]
impl Bazaar {
    #[init]
    pub fn new(
        admin: AccountId,
        tusdc: AccountId,
        stall_code_hash: Base58CryptoHash,
        house_key: PublicKey,
    ) -> Self {
        let mut this = Self {
            admin,
            tusdc,
            stall_code_hash: stall_code_hash.into(),
            house_key,
            config: Config::default(),
            goods: default_goods(),
            hats: default_hats(),
            balances: LookupMap::new(Key::Balances),
            supply: LookupMap::new(Key::Supply),
            players: LookupMap::new(Key::Players),
            player_list: Vector::new(Key::PlayerList),
            usd: LookupMap::new(Key::Usd),
            treasury_usd: 0,
            stalls: IterableMap::new(Key::Stalls),
            owner_stalls: LookupMap::new(Key::OwnerStalls),
            caravan: Caravan {
                round: 0,
                opens_ms: 0,
                closes_ms: 0,
                demand: vec![],
                offers: vec![],
                last_fills: vec![],
            },
            feed: Vector::new(Key::Feed),
            feed_seq: 0,
            stats: Stats::default(),
        };
        this.open_caravan_round();
        this
    }

    // ------------------------------------------------------------------ admin

    pub fn set_config(&mut self, config: Config) {
        self.assert_admin();
        self.config = config;
    }

    pub fn set_house_key(&mut self, house_key: PublicKey) {
        self.assert_admin();
        self.house_key = house_key;
    }
}

// ---------------------------------------------------------------------- internal helpers

impl Bazaar {
    pub(crate) fn assert_admin(&self) {
        require!(env::predecessor_account_id() == self.admin, "admin only");
    }

    pub(crate) fn now(&self) -> u64 {
        env::block_timestamp_ms()
    }

    pub(crate) fn player(&self, a: &AccountId) -> Player {
        self.players
            .get(a)
            .cloned()
            .unwrap_or_else(|| env::panic_str("not a Capybazaar player yet"))
    }

    pub(crate) fn stall(&self, id: &AccountId) -> StallIndex {
        self.stalls
            .get(id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no such stall"))
    }

    pub(crate) fn good(&self, id: &str) -> Option<&GoodInfo> {
        self.goods.iter().find(|g| g.id == id)
    }

    pub(crate) fn hat(&self, id: &str) -> Option<&HatInfo> {
        self.hats.iter().find(|h| h.id == id)
    }

    pub(crate) fn known_token(&self, id: &str) -> bool {
        id == COIN || self.good(id).is_some() || self.hat(id).is_some()
    }

    pub(crate) fn token_ids(&self) -> Vec<TokenId> {
        let mut ids = vec![COIN.to_string()];
        ids.extend(self.goods.iter().map(|g| g.id.clone()));
        ids.extend(self.hats.iter().map(|h| h.id.clone()));
        ids
    }

    pub(crate) fn is_open(&self, stall_id: &AccountId, s: &StallIndex) -> bool {
        s.ready && self.bal(stall_id, COIN) >= self.config.stall_min_float as u128
    }

    // ---- NEP-245 ledger

    pub(crate) fn bal(&self, a: &AccountId, t: &str) -> u128 {
        self.balances.get(&(a.clone(), t.to_string())).copied().unwrap_or(0)
    }

    fn set_bal(&mut self, a: &AccountId, t: &str, v: u128) {
        let k = (a.clone(), t.to_string());
        if v == 0 {
            self.balances.remove(&k);
        } else {
            self.balances.insert(k, v);
        }
    }

    pub(crate) fn credit(&mut self, a: &AccountId, t: &str, amount: u128) {
        let b = self.bal(a, t);
        self.set_bal(a, t, b + amount);
    }

    pub(crate) fn debit(&mut self, a: &AccountId, t: &str, amount: u128) {
        let b = self.bal(a, t);
        if b < amount {
            env::panic_str(&format!("not enough {t}: have {b}, need {amount}"));
        }
        self.set_bal(a, t, b - amount);
    }

    pub(crate) fn mint(&mut self, a: &AccountId, t: &str, amount: u128, memo: &str) {
        if amount == 0 {
            return;
        }
        self.credit(a, t, amount);
        let s = self.supply.get(t).copied().unwrap_or(0);
        self.supply.insert(t.to_string(), s + amount);
        emit(
            NEP245,
            "mt_mint",
            json!([{ "owner_id": a, "token_ids": [t], "amounts": [amount.to_string()], "memo": memo }]),
        );
    }

    pub(crate) fn burn(&mut self, a: &AccountId, t: &str, amount: u128, memo: &str) {
        if amount == 0 {
            return;
        }
        self.debit(a, t, amount);
        self.burn_supply(a, t, amount, memo);
    }

    /// Reduce supply for tokens already removed from a balance (e.g. caravan escrow).
    pub(crate) fn burn_supply(&mut self, a: &AccountId, t: &str, amount: u128, memo: &str) {
        let s = self.supply.get(t).copied().unwrap_or(0);
        self.supply.insert(t.to_string(), s.saturating_sub(amount));
        emit(
            NEP245,
            "mt_burn",
            json!([{ "owner_id": a, "token_ids": [t], "amounts": [amount.to_string()], "memo": memo }]),
        );
    }

    /// Several transfers emitted as one NEP-245 event.
    pub(crate) fn transfer_many(&mut self, moves: &[(&AccountId, &AccountId, &str, u128)], memo: &str) {
        let mut data = vec![];
        for (from, to, t, amount) in moves {
            if *amount == 0 {
                continue;
            }
            self.debit(from, t, *amount);
            self.credit(to, t, *amount);
            data.push(json!({
                "old_owner_id": from, "new_owner_id": to,
                "token_ids": [t], "amounts": [amount.to_string()], "memo": memo
            }));
        }
        if !data.is_empty() {
            emit(NEP245, "mt_transfer", Value::Array(data));
        }
    }

    // ---- usd (deposited tUSDC, internal)

    pub(crate) fn usd_of(&self, a: &AccountId) -> u64 {
        self.usd.get(a).copied().unwrap_or(0)
    }

    pub(crate) fn usd_credit(&mut self, a: &AccountId, amount: u64) {
        let b = self.usd_of(a);
        self.usd.insert(a.clone(), b + amount);
    }

    pub(crate) fn usd_debit(&mut self, a: &AccountId, amount: u64) {
        let b = self.usd_of(a);
        if b < amount {
            env::panic_str("not enough test USDC in your Capybazaar wallet");
        }
        self.usd.insert(a.clone(), b - amount);
    }

    // ---- feed

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn push_feed(
        &mut self,
        kind: &str,
        actor: &AccountId,
        stall: Option<&AccountId>,
        token_id: Option<&str>,
        qty: u32,
        coins: u64,
        usd: u64,
    ) {
        self.feed_seq += 1;
        self.stats.actions += 1;
        let item = FeedItem {
            seq: self.feed_seq,
            ms: self.now(),
            kind: kind.to_string(),
            actor: actor.clone(),
            stall: stall.cloned(),
            token_id: token_id.map(|s| s.to_string()),
            qty,
            coins,
            usd,
        };
        if self.feed.len() < FEED_CAP {
            self.feed.push(item);
        } else {
            let idx = ((self.feed_seq - 1) % FEED_CAP as u64) as u32;
            self.feed.set(idx, item);
        }
    }

    pub(crate) fn add_owner_stall(&mut self, owner: &AccountId, stall: &AccountId) {
        let mut v = self.owner_stalls.get(owner).cloned().unwrap_or_default();
        if !v.contains(stall) {
            v.push(stall.clone());
        }
        self.owner_stalls.insert(owner.clone(), v);
    }

    pub(crate) fn remove_owner_stall(&mut self, owner: &AccountId, stall: &AccountId) {
        if let Some(v) = self.owner_stalls.get(owner).cloned() {
            let v: Vec<AccountId> = v.into_iter().filter(|s| s != stall).collect();
            if v.is_empty() {
                self.owner_stalls.remove(owner);
            } else {
                self.owner_stalls.insert(owner.clone(), v);
            }
        }
    }
}

pub(crate) fn emit(standard: (&str, &str), event: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": standard.0, "version": standard.1, "event": event, "data": data })
    ));
}

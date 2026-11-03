//! The stall item contract. Published once as a NEP-591 global contract; every stall NFT is a
//! named sub-account of the bazaar (e.g. `mochi.<bazaar>`) running this code.
//!
//! Authority model (sharded NFT items draft, requirement 4): this account's own state decides who
//! the owner is. The bazaar collection is the index and the only party allowed to rotate the
//! owner, but every owner action is checked here against `self.owner`.
//!
//! Keys on this account:
//! - no full-access keys, ever (the bazaar creates the account with function-call keys only);
//! - the house keeper key (the game's AI shopkeeper), limited to `keeper_update`/`keeper_offer`;
//! - optional owner-added keeper keys (bring your own agent), same methods, deleted on sale.
//! Keeper methods can only reprice and offer stock within the owner's policy. They cannot move
//! coins, tUSDC or NEAR out of the stall.

use capy_types::{
    HatPrice, ItemStatus, NftItemInfo, OfferIn, OwnerAction, Policy, Quote, ITEM_SPEC,
    ROTATION_EPOCH,
};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{
    env, near, require, AccountId, Allowance, Gas, NearToken, PanicOnDefault, Promise,
    PromiseOrValue, PublicKey,
};

const KEEPER_METHODS: &str = "keeper_update,keeper_offer";
const MAX_NOTE: usize = 240;
const MAX_PERSONALITY: usize = 240;
const MAX_OWNER_KEYS: usize = 4;
/// NEAR the stall keeps for its own storage and gas; withdrawals cannot go below this.
const MIN_NEAR_RESERVE: NearToken = NearToken::from_millinear(150);
const OWNER_KEY_ALLOWANCE: NearToken = NearToken::from_millinear(250);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Stall {
    collection: AccountId,
    tusdc: AccountId,
    owner: AccountId,
    rotation_seq: u64,
    house_key: PublicKey,
    house_enabled: bool,
    owner_keys: Vec<PublicKey>,
    policy: Policy,
    default_policy: Policy,
    personality: String,
    last_note: String,
    last_update_ms: u64,
    keeper_updates: u64,
    /// Set while listed for sale. Owner actions (other than Unlist) are refused while locked.
    locked: bool,
    listing_nonce: u64,
    listing_price_usd: u64,
}

#[near(serializers = [json])]
pub struct StallState {
    pub collection: AccountId,
    pub tusdc: AccountId,
    pub owner: AccountId,
    pub rotation_seq: U64,
    pub house_key: PublicKey,
    pub house_enabled: bool,
    pub owner_keys: Vec<PublicKey>,
    pub policy: Policy,
    pub personality: String,
    pub last_note: String,
    pub last_update_ms: U64,
    pub keeper_updates: U64,
    pub locked: bool,
    pub listing_nonce: U64,
    pub listing_price_usd: U64,
    pub near_balance: U128,
}

#[near]
impl Stall {
    #[init]
    pub fn new(
        collection: AccountId,
        tusdc: AccountId,
        owner: AccountId,
        house_key: PublicKey,
        policy: Policy,
        personality: String,
    ) -> Self {
        require!(
            collection != env::current_account_id(),
            "an item must not name itself as its collection"
        );
        require!(personality.len() <= MAX_PERSONALITY, "personality too long");
        Self {
            collection,
            tusdc,
            owner,
            rotation_seq: 0,
            house_key,
            house_enabled: true,
            owner_keys: vec![],
            default_policy: policy.clone(),
            policy,
            personality,
            last_note: String::new(),
            last_update_ms: 0,
            keeper_updates: 0,
            locked: false,
            listing_nonce: 0,
            listing_price_usd: 0,
        }
    }

    // ------------------------------------------------------------------ keepers

    /// Reprice. Signed by a keeper key on this account (so predecessor == this account).
    pub fn keeper_update(
        &mut self,
        quotes: Vec<Quote>,
        soak_price: Option<u32>,
        hat_prices: Option<Vec<HatPrice>>,
        note: String,
    ) -> Promise {
        self.assert_keeper();
        let now = env::block_timestamp_ms();
        require!(
            now >= self.last_update_ms + self.policy.min_update_ms,
            "keeper is updating too often for this stall's policy"
        );
        require!(note.len() <= MAX_NOTE, "note too long");
        for q in &quotes {
            require!(
                q.spread_bps <= self.policy.max_spread_bps,
                format!("spread for {} is above the owner's limit", q.token_id)
            );
            self.check_bound(&q.token_id, q.base as u64);
        }
        if let Some(p) = soak_price {
            self.check_bound("soak", p as u64);
        }
        if let Some(hp) = &hat_prices {
            for h in hp {
                self.check_bound(&h.hat_id, h.price_usd.0);
            }
        }
        self.last_update_ms = now;
        self.keeper_updates += 1;
        self.last_note = note.clone();
        Promise::new(self.collection.clone()).function_call(
            "stall_set_quotes".to_string(),
            json!({ "quotes": quotes, "soak_price": soak_price, "hat_prices": hat_prices, "note": note })
                .to_string()
                .into_bytes(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(12),
        )
    }

    /// Offer stock to this round's wholesale caravan. Same key rules as `keeper_update`.
    pub fn keeper_offer(&mut self, offers: Vec<OfferIn>) -> Promise {
        self.assert_keeper();
        require!(offers.len() <= 6, "too many offers");
        for o in &offers {
            require!(o.qty <= self.policy.max_offer_qty, "offer above the owner's limit");
            if let Some(b) = self.policy.bound(&o.token_id) {
                require!(
                    o.min_price as u64 >= b.min,
                    "offer price below the owner's floor"
                );
            }
        }
        Promise::new(self.collection.clone()).function_call(
            "stall_offer".to_string(),
            json!({ "offers": offers }).to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(12),
        )
    }

    // ------------------------------------------------------------------ owner

    /// Called either directly by the owner (e.g. from a wallet), or by the collection on behalf of
    /// `caller`. The owner check happens here, against this account's own state.
    pub fn owner_action(
        &mut self,
        caller: Option<AccountId>,
        action: OwnerAction,
    ) -> PromiseOrValue<()> {
        let predecessor = env::predecessor_account_id();
        let actor = if predecessor == self.collection {
            caller.unwrap_or_else(|| env::panic_str("collection must say who is calling"))
        } else {
            predecessor
        };
        require!(actor == self.owner, "only the current owner of this stall can do that");
        if self.locked {
            require!(
                matches!(action, OwnerAction::Unlist),
                "this stall is listed for sale; unlist it first"
            );
        }
        let me = env::current_account_id();
        match action {
            OwnerAction::WithdrawCoins { amount } => PromiseOrValue::Promise(
                Promise::new(self.collection.clone()).function_call(
                    "stall_transfer_coins".to_string(),
                    json!({ "receiver_id": self.owner, "amount": amount })
                        .to_string()
                        .into_bytes(),
                    NearToken::from_yoctonear(0),
                    Gas::from_tgas(10),
                ),
            ),
            OwnerAction::WithdrawUsd { amount } => PromiseOrValue::Promise(
                Promise::new(self.tusdc.clone()).function_call(
                    "ft_transfer".to_string(),
                    json!({ "receiver_id": self.owner, "amount": amount, "memo": "stall earnings" })
                        .to_string()
                        .into_bytes(),
                    NearToken::from_yoctonear(1),
                    Gas::from_tgas(10),
                ),
            ),
            OwnerAction::WithdrawNear { amount } => {
                let available = env::account_balance().saturating_sub(MIN_NEAR_RESERVE);
                require!(
                    amount.0 <= available.as_yoctonear(),
                    "the stall keeps a small NEAR reserve for storage and gas"
                );
                PromiseOrValue::Promise(
                    Promise::new(self.owner.clone())
                        .transfer(NearToken::from_yoctonear(amount.0)),
                )
            }
            OwnerAction::SetPolicy { policy } => {
                require!(policy.bounds.len() <= 16, "too many bounds");
                require!(policy.max_spread_bps <= 5_000, "spread limit too high");
                self.policy = policy;
                PromiseOrValue::Value(())
            }
            OwnerAction::SetPersonality { text } => {
                require!(text.len() <= MAX_PERSONALITY, "personality too long");
                self.personality = text;
                PromiseOrValue::Value(())
            }
            OwnerAction::SetHouseKeeper { enabled } => {
                self.house_enabled = enabled;
                PromiseOrValue::Value(())
            }
            OwnerAction::AddKeeperKey { public_key } => {
                require!(public_key != self.house_key, "that is the house keeper key");
                require!(!self.owner_keys.contains(&public_key), "key already added");
                require!(self.owner_keys.len() < MAX_OWNER_KEYS, "too many keeper keys");
                self.owner_keys.push(public_key.clone());
                PromiseOrValue::Promise(Promise::new(me.clone()).add_access_key_allowance(
                    public_key,
                    Allowance::limited(OWNER_KEY_ALLOWANCE).unwrap(),
                    me,
                    KEEPER_METHODS,
                ))
            }
            OwnerAction::RemoveKeeperKey { public_key } => {
                let before = self.owner_keys.len();
                self.owner_keys.retain(|k| k != &public_key);
                require!(self.owner_keys.len() < before, "not an owner keeper key");
                PromiseOrValue::Promise(Promise::new(me).delete_key(public_key))
            }
            OwnerAction::List { price_usd } => {
                require!(price_usd.0 > 0, "price must be positive");
                self.locked = true;
                self.listing_nonce += 1;
                self.listing_price_usd = price_usd.0;
                PromiseOrValue::Promise(Promise::new(self.collection.clone()).function_call(
                    "stall_listed".to_string(),
                    json!({ "price_usd": price_usd, "listing_nonce": U64(self.listing_nonce) })
                        .to_string()
                        .into_bytes(),
                    NearToken::from_yoctonear(0),
                    Gas::from_tgas(8),
                ))
            }
            OwnerAction::Unlist => {
                require!(self.locked, "not listed");
                self.locked = false;
                PromiseOrValue::Promise(Promise::new(self.collection.clone()).function_call(
                    "stall_unlisted".to_string(),
                    b"{}".to_vec(),
                    NearToken::from_yoctonear(0),
                    Gas::from_tgas(8),
                ))
            }
        }
    }

    // ------------------------------------------------------------------ rotation

    /// Moves ownership. Only the collection may call it, and only if it agrees with this
    /// account about who the current owner is and which rotation this is. A sale must match the
    /// listing this account itself recorded (the nonce), so a stale or forged listing fails.
    pub fn rotate_owner(
        &mut self,
        expected_owner: AccountId,
        new_owner: AccountId,
        seq: U64,
        listing_nonce: Option<U64>,
    ) -> NftItemInfo {
        require!(
            env::predecessor_account_id() == self.collection,
            "only the collection can rotate the owner"
        );
        require!(self.owner == expected_owner, "collection and item disagree about the owner");
        require!(seq.0 == self.rotation_seq + 1, "rotation out of order");
        match listing_nonce {
            Some(n) => require!(
                self.locked && n.0 == self.listing_nonce,
                "listing changed before the sale landed"
            ),
            None => require!(!self.locked, "listed stalls can only move through their sale"),
        }
        self.owner = new_owner;
        self.rotation_seq = seq.0;
        self.locked = false;
        self.listing_price_usd = 0;
        self.house_enabled = true;
        self.policy = self.default_policy.clone();
        // The previous owner's agents lose access in this same receipt chain.
        let old_keys = std::mem::take(&mut self.owner_keys);
        if !old_keys.is_empty() {
            let mut p = Promise::new(env::current_account_id());
            for k in old_keys {
                p = p.delete_key(k);
            }
            p.detach();
        }
        self.nft_item_info()
    }

    // ------------------------------------------------------------------ views

    pub fn nft_item_info(&self) -> NftItemInfo {
        NftItemInfo {
            spec: ITEM_SPEC.to_string(),
            init: true,
            status: ItemStatus::Active,
            collection_id: self.collection.clone(),
            token_id: env::current_account_id().to_string(),
            owner_id: self.owner.clone(),
            rotation_seq: U64(self.rotation_seq),
            rotation_epoch: ROTATION_EPOCH,
        }
    }

    pub fn get_state(&self) -> StallState {
        StallState {
            collection: self.collection.clone(),
            tusdc: self.tusdc.clone(),
            owner: self.owner.clone(),
            rotation_seq: U64(self.rotation_seq),
            house_key: self.house_key.clone(),
            house_enabled: self.house_enabled,
            owner_keys: self.owner_keys.clone(),
            policy: self.policy.clone(),
            personality: self.personality.clone(),
            last_note: self.last_note.clone(),
            last_update_ms: U64(self.last_update_ms),
            keeper_updates: U64(self.keeper_updates),
            locked: self.locked,
            listing_nonce: U64(self.listing_nonce),
            listing_price_usd: U64(self.listing_price_usd),
            near_balance: U128(env::account_balance().as_yoctonear()),
        }
    }

    // ------------------------------------------------------------------ internal

    fn assert_keeper(&self) {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "keeper calls must be signed by a keeper key on this stall account"
        );
        let pk = env::signer_account_pk();
        let house = self.house_enabled && pk == self.house_key;
        // While listed, only the house keeper may act, so a seller's own agent cannot dump stock.
        let owner_agent = !self.locked && self.owner_keys.contains(&pk);
        require!(house || owner_agent, "this key is not an active keeper for this stall");
    }

    fn check_bound(&self, id: &str, value: u64) {
        if let Some(b) = self.policy.bound(id) {
            require!(
                value >= b.min && value <= b.max,
                format!("price for {id} is outside the owner's limits ({}..={})", b.min, b.max)
            );
        }
    }
}

#[cfg(test)]
#[allow(unused_must_use)]
mod tests {
    use super::*;
    use capy_types::Bound;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn house() -> PublicKey {
        "ed25519:US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx".parse().unwrap()
    }
    fn other_key() -> PublicKey {
        "ed25519:cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN".parse().unwrap()
    }
    fn policy() -> Policy {
        Policy {
            bounds: vec![Bound { id: "yuzu".into(), min: 2, max: 20 }],
            max_spread_bps: 3000,
            max_offer_qty: 30,
            min_update_ms: 0,
        }
    }
    fn ctx(predecessor: &str, signer_pk: PublicKey) {
        let c = VMContextBuilder::new()
            .current_account_id(acc("mochi.bazaar.testnet"))
            .predecessor_account_id(acc(predecessor))
            .signer_account_pk(signer_pk)
            .block_timestamp(1_000_000_000_000)
            .build();
        testing_env!(c);
    }
    fn stall() -> Stall {
        ctx("bazaar.testnet", house());
        Stall::new(
            acc("bazaar.testnet"),
            acc("tusdc.bazaar.testnet"),
            acc("town.testnet"),
            house(),
            policy(),
            "cheerful".into(),
        )
    }
    fn q(base: u32) -> Vec<Quote> {
        vec![Quote { token_id: "yuzu".into(), base, spread_bps: 500, target: 20 }]
    }

    #[test]
    fn house_keeper_can_reprice_within_policy() {
        let mut s = stall();
        ctx("mochi.bazaar.testnet", house());
        s.keeper_update(q(6), None, None, "fresh yuzu".into());
        assert_eq!(s.last_note, "fresh yuzu");
    }

    #[test]
    #[should_panic(expected = "outside the owner's limits")]
    fn keeper_cannot_break_policy() {
        let mut s = stall();
        ctx("mochi.bazaar.testnet", house());
        s.keeper_update(q(99), None, None, "".into());
    }

    #[test]
    #[should_panic(expected = "not an active keeper")]
    fn unknown_key_is_refused() {
        let mut s = stall();
        ctx("mochi.bazaar.testnet", other_key());
        s.keeper_update(q(6), None, None, "".into());
    }

    #[test]
    #[should_panic(expected = "only the current owner")]
    fn non_owner_cannot_withdraw() {
        let mut s = stall();
        ctx("bazaar.testnet", house());
        s.owner_action(Some(acc("thief.testnet")), OwnerAction::WithdrawCoins { amount: U64(5) });
    }

    #[test]
    #[should_panic(expected = "listed for sale")]
    fn listing_freezes_withdrawals() {
        let mut s = stall();
        ctx("bazaar.testnet", house());
        s.owner_action(Some(acc("town.testnet")), OwnerAction::List { price_usd: U64(1_000_000) });
        s.owner_action(Some(acc("town.testnet")), OwnerAction::WithdrawUsd { amount: U128(1) });
    }

    #[test]
    fn sale_rotates_owner_and_unlocks() {
        let mut s = stall();
        ctx("bazaar.testnet", house());
        s.owner_action(Some(acc("town.testnet")), OwnerAction::List { price_usd: U64(1_000_000) });
        let info = s.rotate_owner(acc("town.testnet"), acc("bob.testnet"), U64(1), Some(U64(1)));
        assert_eq!(info.owner_id, acc("bob.testnet"));
        assert_eq!(info.rotation_seq, U64(1));
        assert!(!s.locked);
        assert_eq!(info.spec, ITEM_SPEC);
        assert_eq!(info.token_id, "mochi.bazaar.testnet");
    }

    #[test]
    #[should_panic(expected = "only the current owner")]
    fn old_owner_locked_out_after_sale() {
        let mut s = stall();
        ctx("bazaar.testnet", house());
        s.owner_action(Some(acc("town.testnet")), OwnerAction::List { price_usd: U64(1) });
        s.rotate_owner(acc("town.testnet"), acc("bob.testnet"), U64(1), Some(U64(1)));
        s.owner_action(Some(acc("town.testnet")), OwnerAction::WithdrawUsd { amount: U128(1) });
    }

    #[test]
    #[should_panic(expected = "listing changed")]
    fn stale_listing_cannot_be_bought() {
        let mut s = stall();
        ctx("bazaar.testnet", house());
        s.owner_action(Some(acc("town.testnet")), OwnerAction::List { price_usd: U64(1) });
        s.owner_action(Some(acc("town.testnet")), OwnerAction::Unlist);
        s.owner_action(Some(acc("town.testnet")), OwnerAction::List { price_usd: U64(9) });
        // A buyer who saw listing #1 must not get the stall at the old price.
        s.rotate_owner(acc("town.testnet"), acc("bob.testnet"), U64(1), Some(U64(1)));
    }

    #[test]
    #[should_panic(expected = "only the collection")]
    fn only_collection_rotates() {
        let mut s = stall();
        ctx("mallory.testnet", house());
        s.rotate_owner(acc("town.testnet"), acc("mallory.testnet"), U64(1), None);
    }

    #[test]
    fn owner_keys_are_removed_on_rotation() {
        let mut s = stall();
        ctx("bazaar.testnet", house());
        s.owner_action(Some(acc("town.testnet")), OwnerAction::AddKeeperKey { public_key: other_key() });
        assert_eq!(s.owner_keys.len(), 1);
        s.rotate_owner(acc("town.testnet"), acc("bob.testnet"), U64(1), None);
        assert!(s.owner_keys.is_empty());
        assert!(s.house_enabled);
    }

    #[test]
    #[should_panic(expected = "not an active keeper")]
    fn listed_stall_refuses_owner_agents() {
        let mut s = stall();
        ctx("bazaar.testnet", house());
        s.owner_action(Some(acc("town.testnet")), OwnerAction::AddKeeperKey { public_key: other_key() });
        s.owner_action(Some(acc("town.testnet")), OwnerAction::List { price_usd: U64(1) });
        // The seller's own agent tries to dump stock while the stall is listed.
        ctx("mochi.bazaar.testnet", other_key());
        s.keeper_update(q(3), None, None, "everything must go".into());
    }

    #[test]
    #[should_panic(expected = "must not name itself")]
    fn refuses_self_as_collection() {
        ctx("mochi.bazaar.testnet", house());
        Stall::new(
            acc("mochi.bazaar.testnet"),
            acc("tusdc.testnet"),
            acc("town.testnet"),
            house(),
            policy(),
            "".into(),
        );
    }
}

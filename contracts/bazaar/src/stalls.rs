//! Stall NFTs: minting stall accounts, calls coming back from stall accounts, and ownership
//! rotation (sales and transfers).

use crate::*;
use crate::play::all_succeeded;
use capy_types::{Bound, HatPrice, NftItemInfo, OwnerAction, Policy, Quote, COIN};
use near_sdk::json_types::U64;
use near_sdk::{assert_one_yocto, Allowance, Gas, NearToken, Promise, PromiseError};

const KEEPER_METHODS: &str = "keeper_update,keeper_offer";

#[near]
impl Bazaar {
    /// Mints a stall: creates `<slug>.<this account>`, points it at the stall global contract,
    /// initialises it, gives the house keeper a scoped key, and registers it with tUSDC.
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn create_stall(
        &mut self,
        slug: String,
        name: String,
        kind: StallKind,
        goods: Vec<String>,
        personality: String,
        look: u32,
        initial_coins: U64,
        initial_stock: Vec<Ingredient>,
    ) -> Promise {
        self.assert_admin();
        require!(
            slug.len() >= 2
                && slug.len() <= 20
                && slug.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
            "slug must be 2-20 chars of a-z, 0-9 or -"
        );
        require!(name.len() <= 40 && personality.len() <= 240, "name or personality too long");
        let need = self.config.stall_funding.0 + self.config.tusdc_storage.0;
        require!(
            env::attached_deposit().as_yoctonear() >= need,
            format!("attach at least {need} yoctoNEAR to fund the stall account")
        );
        let stall_id: AccountId = format!("{slug}.{}", env::current_account_id()).parse().unwrap();
        require!(!self.stalls.contains_key(&stall_id), "stall exists");
        require!(!self.players.contains_key(&stall_id), "that name belongs to a player");

        let mut quotes: Vec<Quote> = vec![];
        for g in &goods {
            let info = self.good(g).unwrap_or_else(|| env::panic_str("unknown good")).clone();
            quotes.push(Quote { token_id: info.id, base: info.ref_price, spread_bps: 800, target: 20 });
        }
        let hat_prices: Vec<HatPrice> = if kind == StallKind::Hatter {
            self.hats
                .iter()
                .map(|h| HatPrice { hat_id: h.id.clone(), price_usd: h.ref_price_usd })
                .collect()
        } else {
            vec![]
        };
        let policy = self.default_policy(&quotes, kind);
        let admin = self.admin.clone();
        let now = self.now();
        self.stalls.insert(
            stall_id.clone(),
            StallIndex {
                owner_id: admin.clone(),
                rotation_seq: 0,
                rotating: false,
                ready: false,
                name: name.clone(),
                kind,
                look,
                personality: personality.clone(),
                quotes,
                soak_price: self.config.soak_ref_price,
                hat_prices,
                listed: None,
                created_ms: now,
                note: String::new(),
                keeper_ms: 0,
                stats: StallStats::default(),
                window: vec![],
            },
        );
        self.add_owner_stall(&admin, &stall_id);
        self.stats.stalls += 1;
        self.mint(&stall_id, COIN, initial_coins.0 as u128, "opening float");
        for i in &initial_stock {
            require!(self.good(&i.token_id).is_some(), "unknown good in stock");
            self.mint(&stall_id, &i.token_id, i.qty as u128, "opening stock");
        }

        let me = env::current_account_id();
        let init_args = json!({
            "collection": me,
            "tusdc": self.tusdc,
            "owner": admin,
            "house_key": self.house_key,
            "policy": policy,
            "personality": personality,
        });
        Promise::new(stall_id.clone())
            .create_account()
            .transfer(NearToken::from_yoctonear(self.config.stall_funding.0))
            .use_global_contract(self.stall_code_hash)
            .function_call(
                "new".to_string(),
                init_args.to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(10),
            )
            .add_access_key_allowance(
                self.house_key.clone(),
                Allowance::limited(NearToken::from_yoctonear(self.config.stall_house_allowance.0))
                    .unwrap(),
                stall_id.clone(),
                KEEPER_METHODS,
            )
            .and(self.tusdc_register(&stall_id))
            .then(
                Self::ext(me)
                    .with_static_gas(Gas::from_tgas(10))
                    .on_stall_created(stall_id),
            )
    }

    #[private]
    pub fn on_stall_created(&mut self, stall_id: AccountId) -> bool {
        if all_succeeded() {
            let owner = {
                let s = self.stalls.get_mut(&stall_id).unwrap();
                s.ready = true;
                s.owner_id.clone()
            };
            emit(
                NEP171,
                "nft_mint",
                json!([{ "owner_id": owner, "token_ids": [stall_id], "memo": "a new stall opens" }]),
            );
            self.push_feed("stall_open", &owner, Some(&stall_id), None, 0, 0, 0);
            true
        } else {
            // Undo the index entry and the ledger balances minted for it.
            let s = self.stalls.remove(&stall_id).unwrap();
            self.remove_owner_stall(&s.owner_id, &stall_id);
            for t in self.token_ids() {
                let b = self.bal(&stall_id, &t);
                self.burn(&stall_id, &t, b, "stall creation failed");
            }
            self.stats.stalls = self.stats.stalls.saturating_sub(1);
            false
        }
    }

    // ------------------------------------------------------------------ from stall accounts

    /// Called by a stall account after its contract checked the keeper key and owner policy.
    pub fn stall_set_quotes(
        &mut self,
        quotes: Vec<Quote>,
        soak_price: Option<u32>,
        hat_prices: Option<Vec<HatPrice>>,
        note: String,
    ) {
        let stall_id = env::predecessor_account_id();
        let now = self.now();
        let known_hats: Vec<String> = self.hats.iter().map(|h| h.id.clone()).collect();
        let s = self
            .stalls
            .get_mut(&stall_id)
            .unwrap_or_else(|| env::panic_str("only stall accounts can set quotes"));
        for q in quotes {
            require!(q.base >= 1 && q.base <= 10_000, "base out of range");
            require!(q.spread_bps <= 9_000, "spread out of range");
            require!(q.target >= 1 && q.target <= 500, "target out of range");
            let slot = s
                .quotes
                .iter_mut()
                .find(|x| x.token_id == q.token_id)
                .unwrap_or_else(|| env::panic_str("a keeper cannot add new goods to a stall"));
            *slot = q;
        }
        if let Some(p) = soak_price {
            require!(s.kind == StallKind::Bathhouse, "only bathhouses sell soaks");
            require!(p >= 1, "soak price must be positive");
            s.soak_price = p;
        }
        if let Some(hp) = hat_prices {
            require!(s.kind == StallKind::Hatter, "only hatters sell hats");
            for h in hp {
                require!(known_hats.contains(&h.hat_id), "unknown hat");
                require!(h.price_usd.0 >= 10_000, "hats cost at least $0.01");
                match s.hat_prices.iter_mut().find(|x| x.hat_id == h.hat_id) {
                    Some(x) => *x = h,
                    None => s.hat_prices.push(h),
                }
            }
        }
        s.note = note;
        s.keeper_ms = now;
        s.window.clear();
        self.stats.keeper_updates += 1;
        self.push_feed("reprice", &stall_id, Some(&stall_id), None, 0, 0, 0);
    }

    /// Owner withdrawal of coins, requested by the stall account itself.
    pub fn stall_transfer_coins(&mut self, receiver_id: AccountId, amount: U64) {
        let stall_id = env::predecessor_account_id();
        require!(self.stalls.contains_key(&stall_id), "only stall accounts");
        self.transfer_many(&[(&stall_id, &receiver_id, COIN, amount.0 as u128)], "owner withdrawal");
        self.push_feed("withdraw", &receiver_id, Some(&stall_id), Some(COIN), 0, amount.0, 0);
    }

    /// The stall account locked itself and announced a listing.
    pub fn stall_listed(&mut self, price_usd: U64, listing_nonce: U64) {
        let stall_id = env::predecessor_account_id();
        let owner = {
            let s = self
                .stalls
                .get_mut(&stall_id)
                .unwrap_or_else(|| env::panic_str("only stall accounts"));
            s.listed = Some(Listing { price_usd: price_usd.0, nonce: listing_nonce.0 });
            s.owner_id.clone()
        };
        self.push_feed("list", &owner, Some(&stall_id), None, 0, 0, price_usd.0);
    }

    pub fn stall_unlisted(&mut self) {
        let stall_id = env::predecessor_account_id();
        let s = self
            .stalls
            .get_mut(&stall_id)
            .unwrap_or_else(|| env::panic_str("only stall accounts"));
        s.listed = None;
    }

    // ------------------------------------------------------------------ ownership

    /// Forward an owner action to the stall account. The stall checks that the caller is its
    /// current owner; this early check only saves gas.
    pub fn stall_owner_call(&mut self, stall_id: AccountId, action: OwnerAction) -> Promise {
        let caller = env::predecessor_account_id();
        let s = self.stall(&stall_id);
        require!(s.ready, "stall not ready");
        require!(s.owner_id == caller, "you don't own this stall");
        require!(!s.rotating, "this stall is changing hands right now");
        Promise::new(stall_id).function_call(
            "owner_action".to_string(),
            json!({ "caller": caller, "action": action }).to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(40),
        )
    }

    /// Buy a listed stall with test USDC from your Capybazaar wallet.
    pub fn buy_stall(&mut self, stall_id: AccountId) -> Promise {
        let buyer = env::predecessor_account_id();
        self.player(&buyer);
        let s = self.stall(&stall_id);
        let listing = s.listed.clone().unwrap_or_else(|| env::panic_str("not for sale"));
        require!(!s.rotating, "someone else is buying it right now");
        require!(s.owner_id != buyer, "you already own it");
        self.usd_debit(&buyer, listing.price_usd);
        self.rotate(stall_id, s.owner_id, buyer, Some(listing))
    }

    /// NEP-171 transfer (wallet users; requires 1 yoctoNEAR). Listed stalls only move by sale.
    #[payable]
    pub fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        approval_id: Option<u32>,
        memo: Option<String>,
    ) -> Promise {
        assert_one_yocto();
        let _ = memo;
        require!(approval_id.is_none(), "approvals are not supported");
        let stall_id: AccountId = token_id.parse().unwrap_or_else(|_| env::panic_str("bad token id"));
        let sender = env::predecessor_account_id();
        let s = self.stall(&stall_id);
        require!(s.owner_id == sender, "you don't own this stall");
        require!(s.listed.is_none(), "unlist it first");
        require!(!s.rotating, "already moving");
        require!(receiver_id != sender, "already yours");
        self.rotate(stall_id, sender, receiver_id, None)
    }

    #[private]
    pub fn on_rotated(
        &mut self,
        stall_id: AccountId,
        from: AccountId,
        to: AccountId,
        price_usd: Option<U64>,
        #[callback_result] result: Result<NftItemInfo, PromiseError>,
    ) -> bool {
        let ok = matches!(&result, Ok(info) if info.owner_id == to);
        let seq = result.as_ref().map(|i| i.rotation_seq.0).unwrap_or(0);
        {
            let s = self.stalls.get_mut(&stall_id).unwrap();
            s.rotating = false;
            s.listed = None;
            if ok {
                s.owner_id = to.clone();
                s.rotation_seq = seq;
                s.window.clear();
            }
        }
        if !ok {
            if let Some(p) = price_usd {
                self.usd_credit(&to, p.0); // refund the buyer
            }
            self.push_feed("sale_failed", &to, Some(&stall_id), None, 0, 0, price_usd.map(|p| p.0).unwrap_or(0));
            return false;
        }
        self.remove_owner_stall(&from, &stall_id);
        self.add_owner_stall(&to, &stall_id);
        if let Some(p) = price_usd {
            let fee = p.0 * self.config.stall_sale_fee_bps as u64 / 10_000;
            self.usd_credit(&from, p.0 - fee);
            self.treasury_usd += fee;
            self.stats.stall_sales += 1;
            self.stats.usd_volume += p.0;
        }
        emit(
            NEP171,
            "nft_transfer",
            json!([{ "old_owner_id": from, "new_owner_id": to, "token_ids": [stall_id] }]),
        );
        let kind = if price_usd.is_some() { "stall_sold" } else { "stall_given" };
        self.push_feed(kind, &to, Some(&stall_id), None, 0, 0, price_usd.map(|p| p.0).unwrap_or(0));
        true
    }
}

impl Bazaar {
    fn rotate(&mut self, stall_id: AccountId, from: AccountId, to: AccountId, listing: Option<Listing>) -> Promise {
        let seq = {
            let s = self.stalls.get_mut(&stall_id).unwrap();
            s.rotating = true;
            s.rotation_seq + 1
        };
        let price = listing.as_ref().map(|l| U64(l.price_usd));
        Promise::new(stall_id.clone())
            .function_call(
                "rotate_owner".to_string(),
                json!({
                    "expected_owner": from,
                    "new_owner": to,
                    "seq": U64(seq),
                    "listing_nonce": listing.map(|l| U64(l.nonce)),
                })
                .to_string()
                .into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(20),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(15))
                    .on_rotated(stall_id, from, to, price),
            )
    }

    fn default_policy(&self, quotes: &[Quote], kind: StallKind) -> Policy {
        let mut bounds: Vec<Bound> = quotes
            .iter()
            .map(|q| Bound {
                id: q.token_id.clone(),
                min: (q.base as u64 / 2).max(1),
                max: q.base as u64 * 3,
            })
            .collect();
        if kind == StallKind::Bathhouse {
            let r = self.config.soak_ref_price as u64;
            bounds.push(Bound { id: "soak".into(), min: (r / 2).max(1), max: r * 4 });
        }
        if kind == StallKind::Hatter {
            for h in &self.hats {
                bounds.push(Bound {
                    id: h.id.clone(),
                    min: h.ref_price_usd.0 / 4,
                    max: h.ref_price_usd.0 * 4,
                });
            }
        }
        Policy { bounds, max_spread_bps: 3_000, max_offer_qty: 40, min_update_ms: 10_000 }
    }
}

//! Read-only views, plus the NEP-171 and NEP-245 surfaces.

use crate::*;
use crate::price::{ask_unit, bid_unit, buy_total, sell_total};
use capy_types::COIN;
use near_sdk::json_types::{U128, U64};
use near_sdk::{assert_one_yocto, PromiseOrValue};

#[near]
impl Bazaar {
    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            admin: self.admin.clone(),
            tusdc: self.tusdc.clone(),
            stall_code_hash: self.stall_code_hash.into(),
            house_key: self.house_key.clone(),
            config: self.config.clone(),
            goods: self.goods.clone(),
            hats: self.hats.clone(),
        }
    }

    pub fn get_player(&self, account_id: AccountId) -> Option<PlayerView> {
        let p = self.players.get(&account_id)?.clone();
        let now = self.now();
        let (energy, energy_ms) = self.energy_now(&p, now);
        let next = if energy >= self.config.energy_max { 0 } else { energy_ms + self.config.energy_regen_ms.0 };
        let balances = self
            .token_ids()
            .into_iter()
            .map(|t| Balance { amount: U128(self.bal(&account_id, &t)), token_id: t })
            .filter(|b| b.amount.0 > 0)
            .collect();
        Some(PlayerView {
            stalls: self.owner_stalls.get(&account_id).cloned().unwrap_or_default(),
            account_id: account_id.clone(),
            name: p.name,
            energy,
            energy_max: self.config.energy_max,
            next_energy_ms: U64(next),
            last_forage_ms: U64(p.last_forage_ms),
            forage_ready_ms: U64(p.last_forage_ms + self.config.forage_cooldown_ms.0),
            hat: p.hat,
            balances,
            usd: U64(self.usd_of(&account_id)),
            forages: p.forages,
            trades: p.trades,
            soaks: p.soaks,
            hats_bought: p.hats_bought,
            joined_ms: U64(p.joined_ms),
            ready: p.ready,
        })
    }

    /// Players in join order (for the leaderboard). Capped at 50 per call.
    pub fn get_players(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<PlayerView> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(50);
        (from..self.player_list.len().min(from + limit))
            .filter_map(|i| self.player_list.get(i).cloned())
            .filter_map(|a| self.get_player(a))
            .collect()
    }

    pub fn get_stalls(&self) -> Vec<StallView> {
        self.stalls.iter().map(|(id, s)| self.stall_view(id, s)).collect()
    }

    pub fn get_stall(&self, stall_id: AccountId) -> Option<StallView> {
        self.stalls.get(&stall_id).map(|s| self.stall_view(&stall_id, s))
    }

    pub fn get_caravan(&self) -> Caravan {
        self.caravan.clone()
    }

    /// Newest first.
    pub fn get_feed(&self, limit: Option<u32>) -> Vec<FeedItem> {
        let mut items: Vec<FeedItem> = self.feed.iter().cloned().collect();
        items.sort_by(|a, b| b.seq.cmp(&a.seq));
        items.truncate(limit.unwrap_or(30) as usize);
        items
    }

    pub fn get_stats(&self) -> StatsView {
        StatsView {
            stats: self.stats.clone(),
            treasury_usd: U64(self.treasury_usd),
            now_ms: U64(self.now()),
            caravan_round: U64(self.caravan.round),
        }
    }

    /// Coins you would get for selling `amount` units right now.
    pub fn quote_sell(&self, stall_id: AccountId, token_id: String, amount: u32) -> U64 {
        let s = self.stall(&stall_id);
        let q = s.quotes.iter().find(|q| q.token_id == token_id).expect("not traded here");
        U64(sell_total(q, self.bal(&stall_id, &token_id), amount))
    }

    /// Coins you would pay for buying `amount` units right now.
    pub fn quote_buy(&self, stall_id: AccountId, token_id: String, amount: u32) -> U64 {
        let s = self.stall(&stall_id);
        let q = s.quotes.iter().find(|q| q.token_id == token_id).expect("not traded here");
        let stock = self.bal(&stall_id, &token_id);
        require!(stock >= amount as u128, "not enough stock");
        U64(buy_total(q, stock, amount))
    }

    // ------------------------------------------------------------------ NEP-171

    pub fn nft_metadata(&self) -> NftContractMetadata {
        NftContractMetadata {
            spec: "nft-1.0.0".into(),
            name: "Capybazaar Stalls".into(),
            symbol: "STALL".into(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }

    pub fn nft_token(&self, token_id: String) -> Option<Token> {
        let id: AccountId = token_id.parse().ok()?;
        let s = self.stalls.get(&id)?;
        if !s.ready {
            return None;
        }
        Some(self.token(&id, s))
    }

    pub fn nft_total_supply(&self) -> U128 {
        U128(self.stalls.values().filter(|s| s.ready).count() as u128)
    }

    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        let from = from_index.map(|x| x.0 as usize).unwrap_or(0);
        self.stalls
            .iter()
            .filter(|(_, s)| s.ready)
            .skip(from)
            .take(limit.unwrap_or(50) as usize)
            .map(|(id, s)| self.token(id, s))
            .collect()
    }

    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        U128(self.owner_stalls.get(&account_id).map(|v| v.len()).unwrap_or(0) as u128)
    }

    pub fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        let ids = self.owner_stalls.get(&account_id).cloned().unwrap_or_default();
        ids.iter()
            .skip(from_index.map(|x| x.0 as usize).unwrap_or(0))
            .take(limit.unwrap_or(50) as usize)
            .filter_map(|id| self.stalls.get(id).map(|s| self.token(id, s)))
            .collect()
    }

    // ------------------------------------------------------------------ NEP-245

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(self.bal(&account_id, &token_id))
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        token_ids.iter().map(|t| U128(self.bal(&account_id, t))).collect()
    }

    pub fn mt_supply(&self, token_id: String) -> Option<U128> {
        if !self.known_token(&token_id) {
            return None;
        }
        Some(U128(self.supply.get(&token_id).copied().unwrap_or(0)))
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<String>) -> Vec<Option<U128>> {
        token_ids.into_iter().map(|t| self.mt_supply(t)).collect()
    }

    pub fn mt_token_ids(&self) -> Vec<String> {
        self.token_ids()
    }

    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        require!(approval.is_none(), "approvals are not supported");
        let sender = env::predecessor_account_id();
        require!(sender != receiver_id, "sender and receiver are the same");
        require!(self.known_token(&token_id), "unknown token");
        let memo = memo.unwrap_or_default();
        self.transfer_many(&[(&sender, &receiver_id, &token_id, amount.0)], &memo);
    }

    #[payable]
    pub fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        require!(approvals.is_none(), "approvals are not supported");
        require!(token_ids.len() == amounts.len() && !token_ids.is_empty(), "length mismatch");
        let sender = env::predecessor_account_id();
        require!(sender != receiver_id, "sender and receiver are the same");
        let memo = memo.unwrap_or_default();
        for (t, a) in token_ids.iter().zip(amounts.iter()) {
            require!(self.known_token(t), "unknown token");
            self.transfer_many(&[(&sender, &receiver_id, t, a.0)], &memo);
        }
    }

    pub fn mt_metadata_contract(&self) -> near_sdk::serde_json::Value {
        json!({ "spec": "mt-1.0.0", "name": "Capybazaar Goods" })
    }

    pub fn mt_metadata_token_all(&self, token_ids: Vec<String>) -> Vec<Option<near_sdk::serde_json::Value>> {
        token_ids
            .into_iter()
            .map(|t| {
                let (name, decimals) = if t == COIN {
                    ("Capybazaar coin".to_string(), 0)
                } else if let Some(g) = self.good(&t) {
                    (g.name.clone(), 0)
                } else if let Some(h) = self.hat(&t) {
                    (h.name.clone(), 0)
                } else {
                    return None;
                };
                Some(json!({
                    "base": { "id": t, "name": name, "symbol": t.to_uppercase(), "decimals": decimals },
                    "token": { "title": name }
                }))
            })
            .collect()
    }

    /// Stall accounts may receive multi-tokens from other contracts in the future; we accept
    /// nothing from outside for now.
    pub fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        let _ = (sender_id, previous_owner_ids, token_ids, msg);
        PromiseOrValue::Value(amounts)
    }
}

impl Bazaar {
    fn stall_view(&self, id: &AccountId, s: &StallIndex) -> StallView {
        let quotes = s
            .quotes
            .iter()
            .map(|q| {
                let stock = self.bal(id, &q.token_id);
                QuoteView {
                    token_id: q.token_id.clone(),
                    base: q.base,
                    spread_bps: q.spread_bps,
                    target: q.target,
                    stock: U128(stock),
                    bid: U64(bid_unit(q, stock + 1)),
                    ask: U64(ask_unit(q, stock)),
                }
            })
            .collect();
        let hats = s
            .hat_prices
            .iter()
            .map(|h| HatOffer {
                hat_id: h.hat_id.clone(),
                price_usd: h.price_usd,
                in_stock: self.hat(&h.hat_id).map_or(false, |info| {
                    info.recipe.iter().all(|i| self.bal(id, &i.token_id) >= i.qty as u128)
                }),
            })
            .collect();
        StallView {
            stall_id: id.clone(),
            owner_id: s.owner_id.clone(),
            rotation_seq: U64(s.rotation_seq),
            rotating: s.rotating,
            ready: s.ready,
            open: self.is_open(id, s),
            name: s.name.clone(),
            kind: s.kind,
            look: s.look,
            personality: s.personality.clone(),
            coins: U128(self.bal(id, COIN)),
            quotes,
            soak_price: s.soak_price,
            hats,
            listed: s.listed.clone(),
            note: s.note.clone(),
            keeper_ms: U64(s.keeper_ms),
            created_ms: U64(s.created_ms),
            stats: s.stats.clone(),
            window: s.window.clone(),
        }
    }

    fn token(&self, id: &AccountId, s: &StallIndex) -> Token {
        Token {
            token_id: id.to_string(),
            owner_id: s.owner_id.clone(),
            metadata: TokenMetadata {
                title: Some(s.name.clone()),
                description: Some(format!(
                    "A capybara stall in Yuzu Springs. This NFT is the NEAR account {id}: it holds its own stock, coins and tUSDC earnings."
                )),
                media: None,
                copies: Some(1),
                extra: Some(json!({ "kind": s.kind, "look": s.look, "account": id }).to_string()),
            },
            approved_account_ids: Default::default(),
        }
    }
}

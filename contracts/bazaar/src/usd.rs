//! The real-money layer: tUSDC (a NEP-141 test stablecoin; Circle's USDC on mainnet).
//!
//! Players top up once with `ft_transfer_call` (a wallet-confirmed action on mainnet). After
//! that, hat and stall purchases are instant ledger moves. Each hat sale pays the stall's share
//! as real tUSDC into the stall account, where only the stall's current owner can withdraw it.

use crate::*;
use near_sdk::json_types::{U128, U64};
use near_sdk::{Gas, NearToken, Promise, PromiseError, PromiseOrValue};

#[near]
impl Bazaar {
    /// NEP-141 receiver. `msg` is empty / "deposit" (credit the sender) or
    /// `{"deposit_for":"<account>"}` (credit a player, used by the guest top-up faucet).
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.tusdc, "only tUSDC is accepted here");
        let target: AccountId = if msg.is_empty() || msg == "deposit" {
            sender_id.clone()
        } else {
            let v: near_sdk::serde_json::Value =
                near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("bad msg"));
            v.get("deposit_for")
                .and_then(|x| x.as_str())
                .and_then(|s| s.parse().ok())
                .unwrap_or_else(|| env::panic_str("bad msg"))
        };
        if !self.players.contains_key(&target) || amount.0 > u64::MAX as u128 {
            return PromiseOrValue::Value(amount); // refund
        }
        let a = amount.0 as u64;
        self.usd_credit(&target, a);
        self.stats.usd_deposited += a;
        self.push_feed("deposit", &target, None, None, 0, 0, a);
        PromiseOrValue::Value(U128(0))
    }

    pub fn withdraw_usd(&mut self, amount: U64) -> Promise {
        let who = env::predecessor_account_id();
        require!(amount.0 > 0, "bad amount");
        self.usd_debit(&who, amount.0);
        self.tusdc_transfer(&who, amount.0, "withdraw")
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(8))
                    .on_usd_sent(who, amount, false),
            )
    }

    /// Buy a hat at a hatter. The hatter uses goods from its stock; 70% (config) of the price
    /// goes to the stall account as tUSDC, the rest is the game's fee.
    pub fn buy_hat(&mut self, stall_id: AccountId, hat_id: String, max_usd: U64) -> Promise {
        let who = env::predecessor_account_id();
        let mut p = self.player(&who);
        let s = self.stall(&stall_id);
        require!(s.kind == StallKind::Hatter, "that stall doesn't sell hats");
        require!(self.is_open(&stall_id, &s), "the hatter is closed");
        let hat = self.hat(&hat_id).cloned().unwrap_or_else(|| env::panic_str("unknown hat"));
        let price = s
            .hat_prices
            .iter()
            .find(|h| h.hat_id == hat_id)
            .map(|h| h.price_usd.0)
            .unwrap_or_else(|| env::panic_str("this hatter doesn't make that hat"));
        require!(price <= max_usd.0, "price moved; try again");
        self.usd_debit(&who, price);
        for ing in &hat.recipe {
            require!(
                self.bal(&stall_id, &ing.token_id) >= ing.qty as u128,
                format!("the hatter needs more {} to make that", ing.token_id)
            );
            self.burn(&stall_id, &ing.token_id, ing.qty as u128, "made into a hat");
        }
        self.mint(&who, &hat_id, 1, "hat");
        let share = price * self.config.hat_stall_share_bps as u64 / 10_000;
        self.treasury_usd += price - share;
        p.hats_bought += 1;
        if p.hat.is_none() {
            p.hat = Some(hat_id.clone());
        }
        self.players.insert(who.clone(), p);
        if let Some(st) = self.stalls.get_mut(&stall_id) {
            st.stats.hats += 1;
            st.stats.usd_earned += share;
        }
        self.stats.hats += 1;
        self.stats.usd_volume += price;
        self.push_feed("hat", &who, Some(&stall_id), Some(&hat_id), 1, 0, price);
        self.tusdc_transfer(&stall_id, share, "hat sale")
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(8))
                    .on_usd_sent(stall_id, U64(share), true),
            )
    }

    /// If a tUSDC payout fails, keep the amount on the internal ledger so nothing is lost.
    #[private]
    pub fn on_usd_sent(
        &mut self,
        to: AccountId,
        amount: U64,
        stall_payout: bool,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_err() {
            self.usd_credit(&to, amount.0);
            if stall_payout {
                env::log_str("stall payout failed; amount kept on the internal ledger");
            }
            return false;
        }
        true
    }

    /// Move the game's fee out (e.g. to a treasury). Admin only.
    pub fn withdraw_treasury(&mut self, receiver_id: AccountId, amount: U64) -> Promise {
        self.assert_admin();
        require!(amount.0 <= self.treasury_usd, "more than the treasury holds");
        self.treasury_usd -= amount.0;
        self.tusdc_transfer(&receiver_id, amount.0, "treasury")
    }
}

impl Bazaar {
    fn tusdc_transfer(&self, to: &AccountId, amount: u64, memo: &str) -> Promise {
        Promise::new(self.tusdc.clone()).function_call(
            "ft_transfer".to_string(),
            json!({ "receiver_id": to, "amount": U128(amount as u128), "memo": memo })
                .to_string()
                .into_bytes(),
            NearToken::from_yoctonear(1),
            Gas::from_tgas(10),
        )
    }
}

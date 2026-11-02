//! Types shared by the `bazaar` (collection + market) and `stall` (item account) contracts.
//! Both sides talk JSON over cross-contract calls, so keeping one definition avoids drift.

use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId, PublicKey};

pub type TokenId = String;

/// The in-game soft currency. It lives in the bazaar's NEP-245 ledger and is never cashed out.
pub const COIN: &str = "coin";

/// `spec` value from the House of Stake "Sharded Non-Fungible Token Items" draft NEP.
pub const ITEM_SPEC: &str = "sharded-item-1.0.0";
pub const ROTATION_EPOCH: u32 = 1;

/// A keeper's quote for one good at one stall. Prices move along a curve around `base`
/// depending on how far the stall's stock is from `target` (see `bazaar::price`).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Quote {
    pub token_id: TokenId,
    /// Mid price in coins when stock equals `target`.
    pub base: u32,
    /// Half-spread in basis points: ask = mid * (1 + spread), bid = mid * (1 - spread).
    pub spread_bps: u16,
    /// Stock level the keeper is aiming for.
    pub target: u32,
}

/// A hat price, in micro-USD (tUSDC has 6 decimals).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct HatPrice {
    pub hat_id: TokenId,
    pub price_usd: U64,
}

/// What a keeper offers to the wholesale caravan this round.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct OfferIn {
    pub token_id: TokenId,
    pub qty: u32,
    pub min_price: u32,
}

/// Owner-set limits the stall contract enforces on every keeper (AI or human) update.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Bound {
    /// A good id, `soak`, or a hat id.
    pub id: String,
    pub min: u64,
    pub max: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    pub bounds: Vec<Bound>,
    pub max_spread_bps: u16,
    pub max_offer_qty: u32,
    /// Minimum time between keeper updates, so a runaway agent cannot spam reprices.
    pub min_update_ms: u64,
}

impl Policy {
    pub fn bound(&self, id: &str) -> Option<&Bound> {
        self.bounds.iter().find(|b| b.id == id)
    }
}

/// Actions only the current owner of a stall NFT can take. The stall account (the item) checks
/// ownership itself; the bazaar only forwards the request with the original caller attached.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub enum OwnerAction {
    WithdrawCoins { amount: U64 },
    WithdrawUsd { amount: U128 },
    WithdrawNear { amount: U128 },
    SetPolicy { policy: Policy },
    SetPersonality { text: String },
    SetHouseKeeper { enabled: bool },
    AddKeeperKey { public_key: PublicKey },
    RemoveKeeperKey { public_key: PublicKey },
    /// Lists the stall for sale. While listed, the stall refuses every owner action except
    /// `Unlist`, so a seller cannot empty the till between listing and sale.
    List { price_usd: U64 },
    Unlist,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub enum ItemStatus {
    Parked,
    Suspended,
    Expired,
    Frozen,
    Active,
}

/// The item interface from the sharded NFT items draft. Served by every stall account.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct NftItemInfo {
    pub spec: String,
    pub init: bool,
    pub status: ItemStatus,
    pub collection_id: AccountId,
    pub token_id: String,
    pub owner_id: AccountId,
    pub rotation_seq: U64,
    pub rotation_epoch: u32,
}

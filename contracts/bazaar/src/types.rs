use capy_types::{HatPrice, Quote, TokenId};
use near_sdk::json_types::{Base58CryptoHash, U128, U64};
use near_sdk::{near, AccountId, PublicKey};

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum StallKind {
    /// Buys and sells raw goods.
    Grocer,
    /// Sells soaks (energy refills) for coins; each soak uses one yuzu from its stock.
    Bathhouse,
    /// Sells hats for tUSDC; each hat uses goods from its stock.
    Hatter,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct GoodInfo {
    pub id: TokenId,
    pub name: String,
    pub ref_price: u32,
    /// Where players forage it: meadow, grove or field.
    pub spot: String,
    pub forage_min: u8,
    pub forage_max: u8,
    pub caravan_min_qty: u32,
    pub caravan_max_qty: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Ingredient {
    pub token_id: TokenId,
    pub qty: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct HatInfo {
    pub id: TokenId,
    pub name: String,
    pub ref_price_usd: U64,
    pub recipe: Vec<Ingredient>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Config {
    pub energy_max: u8,
    pub energy_regen_ms: U64,
    pub forage_cooldown_ms: U64,
    pub start_coins: u32,
    pub soak_ref_price: u32,
    /// Share of every soak burned as "spring upkeep" (a coin sink).
    pub soak_burn_bps: u16,
    pub soak_yuzu: u32,
    /// A stall with fewer coins than this is closed until someone invests.
    pub stall_min_float: u32,
    /// Coins every stall pays (burned) each caravan round.
    pub stall_rent: u32,
    pub caravan_round_ms: U64,
    /// Share of each hat sale paid in tUSDC to the stall account; the rest is the game's fee.
    pub hat_stall_share_bps: u16,
    pub stall_sale_fee_bps: u16,
    pub player_funding: U128,
    pub stall_funding: U128,
    pub stall_house_allowance: U128,
    pub tusdc_storage: U128,
    pub max_trade_units: u32,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            energy_max: 8,
            energy_regen_ms: U64(90_000),
            forage_cooldown_ms: U64(4_000),
            start_coins: 15,
            soak_ref_price: 8,
            soak_burn_bps: 1_000,
            soak_yuzu: 1,
            stall_min_float: 5,
            stall_rent: 2,
            caravan_round_ms: U64(180_000),
            hat_stall_share_bps: 7_000,
            stall_sale_fee_bps: 500,
            player_funding: U128(250_000_000_000_000_000_000_000),      // 0.25 NEAR
            stall_funding: U128(400_000_000_000_000_000_000_000),       // 0.4 NEAR
            stall_house_allowance: U128(300_000_000_000_000_000_000_000), // 0.3 NEAR of gas
            tusdc_storage: U128(1_250_000_000_000_000_000_000),         // 0.00125 NEAR
            max_trade_units: 30,
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Player {
    pub name: String,
    pub energy: u8,
    pub energy_ms: u64,
    pub last_forage_ms: u64,
    pub hat: Option<TokenId>,
    pub joined_ms: u64,
    pub forages: u32,
    pub trades: u32,
    pub soaks: u32,
    pub hats_bought: u32,
    pub ready: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct StallStats {
    pub trades: u32,
    pub coins_volume: u64,
    pub soaks: u32,
    pub hats: u32,
    pub usd_earned: u64,
    pub caravan_units: u32,
    pub caravan_coins: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct WindowEntry {
    pub token_id: TokenId,
    /// Units the stall bought from players since the keeper last repriced.
    pub bought: u32,
    /// Units the stall sold to players since the keeper last repriced.
    pub sold: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Listing {
    pub price_usd: u64,
    pub nonce: u64,
}

/// The collection's index entry for a stall. The stall account itself is the authority on its
/// owner; `owner_id` here is the index, updated only after the item confirms a rotation.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct StallIndex {
    pub owner_id: AccountId,
    pub rotation_seq: u64,
    pub rotating: bool,
    pub ready: bool,
    pub name: String,
    pub kind: StallKind,
    pub look: u32,
    pub personality: String,
    pub quotes: Vec<Quote>,
    pub soak_price: u32,
    pub hat_prices: Vec<HatPrice>,
    pub listed: Option<Listing>,
    pub created_ms: u64,
    pub note: String,
    pub keeper_ms: u64,
    pub stats: StallStats,
    pub window: Vec<WindowEntry>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Demand {
    pub token_id: TokenId,
    pub qty: u32,
    pub max_price: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Offer {
    pub stall_id: AccountId,
    pub token_id: TokenId,
    pub qty: u32,
    pub min_price: u32,
    pub ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Fill {
    pub stall_id: AccountId,
    pub token_id: TokenId,
    pub qty: u32,
    pub price: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Caravan {
    pub round: u64,
    pub opens_ms: u64,
    pub closes_ms: u64,
    pub demand: Vec<Demand>,
    pub offers: Vec<Offer>,
    pub last_fills: Vec<Fill>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct FeedItem {
    pub seq: u64,
    pub ms: u64,
    pub kind: String,
    pub actor: AccountId,
    pub stall: Option<AccountId>,
    pub token_id: Option<TokenId>,
    pub qty: u32,
    pub coins: u64,
    pub usd: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct Stats {
    pub players: u32,
    pub stalls: u32,
    pub forages: u64,
    pub trades: u64,
    pub soaks: u64,
    pub hats: u64,
    pub usd_volume: u64,
    pub usd_deposited: u64,
    pub stall_sales: u32,
    pub caravan_rounds: u64,
    pub keeper_updates: u64,
    pub actions: u64,
}

// ---------------------------------------------------------------------- views

#[near(serializers = [json])]
pub struct ConfigView {
    pub admin: AccountId,
    pub tusdc: AccountId,
    pub stall_code_hash: Base58CryptoHash,
    pub house_key: PublicKey,
    pub config: Config,
    pub goods: Vec<GoodInfo>,
    pub hats: Vec<HatInfo>,
}

#[near(serializers = [json])]
pub struct Balance {
    pub token_id: TokenId,
    pub amount: U128,
}

#[near(serializers = [json])]
pub struct PlayerView {
    pub account_id: AccountId,
    pub name: String,
    pub energy: u8,
    pub energy_max: u8,
    pub next_energy_ms: U64,
    pub last_forage_ms: U64,
    pub forage_ready_ms: U64,
    pub hat: Option<TokenId>,
    pub balances: Vec<Balance>,
    pub usd: U64,
    pub forages: u32,
    pub trades: u32,
    pub soaks: u32,
    pub hats_bought: u32,
    pub joined_ms: U64,
    pub ready: bool,
    pub stalls: Vec<AccountId>,
}

#[near(serializers = [json])]
pub struct QuoteView {
    pub token_id: TokenId,
    pub base: u32,
    pub spread_bps: u16,
    pub target: u32,
    pub stock: U128,
    /// Coins the stall pays for one unit right now.
    pub bid: U64,
    /// Coins the stall charges for one unit right now.
    pub ask: U64,
}

#[near(serializers = [json])]
pub struct HatOffer {
    pub hat_id: TokenId,
    pub price_usd: U64,
    pub in_stock: bool,
}

#[near(serializers = [json])]
pub struct StallView {
    pub stall_id: AccountId,
    pub owner_id: AccountId,
    pub rotation_seq: U64,
    pub rotating: bool,
    pub ready: bool,
    pub open: bool,
    pub name: String,
    pub kind: StallKind,
    pub look: u32,
    pub personality: String,
    pub coins: U128,
    pub quotes: Vec<QuoteView>,
    pub soak_price: u32,
    pub hats: Vec<HatOffer>,
    pub listed: Option<Listing>,
    pub note: String,
    pub keeper_ms: U64,
    pub created_ms: U64,
    pub stats: StallStats,
    pub window: Vec<WindowEntry>,
}

#[near(serializers = [json])]
pub struct StatsView {
    pub stats: Stats,
    pub treasury_usd: U64,
    pub now_ms: U64,
    pub caravan_round: U64,
}

#[near(serializers = [json])]
pub struct ForageResult {
    pub token_id: TokenId,
    pub qty: u32,
    pub energy: u8,
}

#[near(serializers = [json])]
pub struct TradeResult {
    pub token_id: TokenId,
    pub qty: u32,
    pub coins: U64,
}

// ---------------------------------------------------------------------- NEP-171

#[near(serializers = [json])]
pub struct NftContractMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[near(serializers = [json])]
pub struct TokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,
    pub copies: Option<u64>,
    pub extra: Option<String>,
}

#[near(serializers = [json])]
pub struct Token {
    pub token_id: String,
    pub owner_id: AccountId,
    pub metadata: TokenMetadata,
    pub approved_account_ids: std::collections::HashMap<AccountId, u64>,
}

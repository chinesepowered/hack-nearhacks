// JSON shapes returned by the bazaar and stall contracts (see contracts/bazaar/src/types.rs).

import type { Quote } from "./price";

export type StallKind = "Grocer" | "Bathhouse" | "Hatter";

export interface GoodInfo {
  id: string;
  name: string;
  ref_price: number;
  spot: string;
  forage_min: number;
  forage_max: number;
  caravan_min_qty: number;
  caravan_max_qty: number;
}

export interface HatInfo {
  id: string;
  name: string;
  ref_price_usd: string;
  recipe: { token_id: string; qty: number }[];
}

export interface Config {
  energy_max: number;
  energy_regen_ms: string;
  forage_cooldown_ms: string;
  start_coins: number;
  soak_ref_price: number;
  soak_burn_bps: number;
  soak_yuzu: number;
  stall_min_float: number;
  stall_rent: number;
  caravan_round_ms: string;
  hat_stall_share_bps: number;
  stall_sale_fee_bps: number;
  player_funding: string;
  stall_funding: string;
  stall_house_allowance: string;
  tusdc_storage: string;
  max_trade_units: number;
}

export interface ConfigView {
  admin: string;
  tusdc: string;
  stall_code_hash: string;
  house_key: string;
  config: Config;
  goods: GoodInfo[];
  hats: HatInfo[];
}

export interface Balance {
  token_id: string;
  amount: string;
}

export interface PlayerView {
  account_id: string;
  name: string;
  energy: number;
  energy_max: number;
  next_energy_ms: string;
  last_forage_ms: string;
  forage_ready_ms: string;
  hat: string | null;
  balances: Balance[];
  usd: string;
  forages: number;
  trades: number;
  soaks: number;
  hats_bought: number;
  joined_ms: string;
  ready: boolean;
  stalls: string[];
}

export interface QuoteView extends Quote {
  stock: string;
  bid: string;
  ask: string;
}

export interface StallStats {
  trades: number;
  coins_volume: number;
  soaks: number;
  hats: number;
  usd_earned: number;
  caravan_units: number;
  caravan_coins: number;
}

export interface StallView {
  stall_id: string;
  owner_id: string;
  rotation_seq: string;
  rotating: boolean;
  ready: boolean;
  open: boolean;
  name: string;
  kind: StallKind;
  look: number;
  personality: string;
  coins: string;
  quotes: QuoteView[];
  soak_price: number;
  hats: { hat_id: string; price_usd: string; in_stock: boolean }[];
  listed: { price_usd: number; nonce: number } | null;
  note: string;
  keeper_ms: string;
  created_ms: string;
  stats: StallStats;
  window: { token_id: string; bought: number; sold: number }[];
}

export interface Bound {
  id: string;
  min: number;
  max: number;
}

export interface Policy {
  bounds: Bound[];
  max_spread_bps: number;
  max_offer_qty: number;
  min_update_ms: number;
}

export interface StallState {
  collection: string;
  tusdc: string;
  owner: string;
  rotation_seq: string;
  house_key: string;
  house_enabled: boolean;
  owner_keys: string[];
  policy: Policy;
  personality: string;
  last_note: string;
  last_update_ms: string;
  keeper_updates: string;
  locked: boolean;
  listing_nonce: string;
  listing_price_usd: string;
  near_balance: string;
}

export interface NftItemInfo {
  spec: string;
  init: boolean;
  status: string;
  collection_id: string;
  token_id: string;
  owner_id: string;
  rotation_seq: string;
  rotation_epoch: number;
}

export interface Demand {
  token_id: string;
  qty: number;
  max_price: number;
}

export interface Offer {
  stall_id: string;
  token_id: string;
  qty: number;
  min_price: number;
  ms: number;
}

export interface Fill {
  stall_id: string;
  token_id: string;
  qty: number;
  price: number;
}

export interface Caravan {
  round: number;
  opens_ms: number;
  closes_ms: number;
  demand: Demand[];
  offers: Offer[];
  last_fills: Fill[];
}

export interface FeedItem {
  seq: number;
  ms: number;
  kind: string;
  actor: string;
  stall: string | null;
  token_id: string | null;
  qty: number;
  coins: number;
  usd: number;
}

export interface Stats {
  players: number;
  stalls: number;
  forages: number;
  trades: number;
  soaks: number;
  hats: number;
  usd_volume: number;
  usd_deposited: number;
  stall_sales: number;
  caravan_rounds: number;
  keeper_updates: number;
  actions: number;
}

export interface StatsView {
  stats: Stats;
  treasury_usd: string;
  now_ms: string;
  caravan_round: string;
}

export interface KeeperDecision {
  quotes: Quote[];
  soak_price?: number;
  hat_prices?: { hat_id: string; price_usd: string }[];
  note: string;
}

export interface OfferIn {
  token_id: string;
  qty: number;
  min_price: number;
}

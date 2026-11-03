// A tiny typed client for the bazaar, used by the web app, the bots and the demo script.
// Player calls are signed with a function-call key scoped to the bazaar: no deposits, no popups.

import type { Account, JsonRpcProvider } from "near-api-js";
import { gas, view, type Deployment } from "./near";
import type { Caravan, ConfigView, FeedItem, PlayerView, StallState, StallView, StatsView } from "./types";

export class TownReader {
  constructor(public provider: JsonRpcProvider, public dep: Deployment) {}

  config = () => view<ConfigView>(this.provider, this.dep.bazaar, "get_config");
  stalls = () => view<StallView[]>(this.provider, this.dep.bazaar, "get_stalls");
  stall = (stall_id: string) => view<StallView | null>(this.provider, this.dep.bazaar, "get_stall", { stall_id });
  stallState = (stall_id: string) => view<StallState>(this.provider, stall_id, "get_state");
  player = (account_id: string) => view<PlayerView | null>(this.provider, this.dep.bazaar, "get_player", { account_id });
  players = () => view<PlayerView[]>(this.provider, this.dep.bazaar, "get_players", { limit: 50 });
  caravan = () => view<Caravan>(this.provider, this.dep.bazaar, "get_caravan");
  feed = (limit = 30) => view<FeedItem[]>(this.provider, this.dep.bazaar, "get_feed", { limit });
  stats = () => view<StatsView>(this.provider, this.dep.bazaar, "get_stats");
  tusdcBalance = async (account_id: string) =>
    view<string>(this.provider, this.dep.tusdc, "ft_balance_of", { account_id });
}

export class TownPlayer extends TownReader {
  constructor(provider: JsonRpcProvider, dep: Deployment, public account: Account) {
    super(provider, dep);
  }

  get id(): string {
    return this.account.accountId;
  }

  // Prepaid gas is checked against the balance at a pessimistic price (~10x) before refunds,
  // so keep it close to what each call really needs.
  private call<T>(methodName: string, args: Record<string, unknown>, tgas = 20): Promise<T> {
    return this.account.callFunction<T & object>({
      contractId: this.dep.bazaar,
      methodName,
      args,
      gas: gas(tgas),
      deposit: 0n,
    }) as Promise<T>;
  }

  forage = (spot: string) => this.call<{ token_id: string; qty: number; energy: number }>("forage", { spot });
  sell = (stall_id: string, token_id: string, amount: number, min_coins = 0) =>
    this.call<{ coins: string }>("sell", { stall_id, token_id, amount, min_coins: String(min_coins) });
  buy = (stall_id: string, token_id: string, amount: number, max_coins: number) =>
    this.call<{ coins: string }>("buy", { stall_id, token_id, amount, max_coins: String(max_coins) });
  soak = (stall_id: string, max_coins: number) => this.call<number>("soak", { stall_id, max_coins: String(max_coins) });
  invest = (stall_id: string, amount: number) => this.call<null>("invest", { stall_id, amount: String(amount) });
  buyHat = (stall_id: string, hat_id: string, max_usd: string) =>
    this.call<null>("buy_hat", { stall_id, hat_id, max_usd }, 50);
  equipHat = (hat_id: string | null) => this.call<null>("equip_hat", { hat_id });
  buyStall = (stall_id: string) => this.call<boolean>("buy_stall", { stall_id }, 60);
  withdrawUsd = (amount: string) => this.call<boolean>("withdraw_usd", { amount }, 40);
  ownerCall = (stall_id: string, action: unknown) => this.call<unknown>("stall_owner_call", { stall_id, action }, 70);
}

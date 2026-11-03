// `pnpm measure`: what each action really costs on chain. Runs each action once with a fresh
// guest and sums the gas and NEAR burnt over every receipt. Gas units are the same on mainnet.

import { Account, KeyPairSigner, type KeyPairString } from "near-api-js";
import { gas, newKeyPair } from "@capy/core";
import { loadDeployment, loadKey, provider, rootAccount, sleep } from "./lib";
import { createPlayer, topUp } from "./admin";

const dep = loadDeployment();
const p = provider();
const root = rootAccount(p);

type Outcome = {
  transaction_outcome: { outcome: { gas_burnt: number; tokens_burnt: string } };
  receipts_outcome: { outcome: { gas_burnt: number; tokens_burnt: string } }[];
};
const rows: { action: string; tgas: string; near: string }[] = [];

function record(action: string, o: unknown) {
  const out = o as Outcome;
  const all = [out.transaction_outcome, ...out.receipts_outcome];
  const g = all.reduce((a, r) => a + Number(r.outcome.gas_burnt), 0);
  const t = all.reduce((a, r) => a + BigInt(r.outcome.tokens_burnt), 0n);
  rows.push({ action, tgas: (g / 1e12).toFixed(2), near: (Number(t) / 1e24).toFixed(5) });
}

async function call(a: Account, contractId: string, methodName: string, args: object, tgas = 30) {
  return a.callFunctionRaw({ contractId, methodName, args, gas: gas(tgas), deposit: 0n });
}

const kp = newKeyPair();
const id = await createPlayer(root, dep, "Meter", kp.publicKey);
await topUp(root, dep, id, 5_000_000);
const me = new Account(id, p, KeyPairSigner.fromSecretKey(kp.privateKey as KeyPairString));

record("forage", await call(me, dep.bazaar, "forage", { spot: "field" }, 20));
const stalls = (await p.callFunction({ contractId: dep.bazaar, method: "get_stalls", args: {} })) as { stall_id: string; kind: string; hats: { hat_id: string; price_usd: string; in_stock: boolean }[] }[];
const player = (await p.callFunction({ contractId: dep.bazaar, method: "get_player", args: { account_id: id } })) as { balances: { token_id: string; amount: string }[] };
const melons = Number(player.balances.find((b) => b.token_id === "melon")?.amount ?? 0);
const mochi = stalls.find((s) => s.stall_id.startsWith("mochi."))!;
const kumo = stalls.find((s) => s.stall_id.startsWith("kumo."))!;
if (melons > 0) {
  try {
    record("sell (to a stall)", await call(me, dep.bazaar, "sell", { stall_id: kumo.stall_id, token_id: "melon", amount: melons, min_coins: "0" }, 20));
  } catch {
    record("sell (to a stall)", await call(me, dep.bazaar, "sell", { stall_id: mochi.stall_id, token_id: "melon", amount: melons, min_coins: "0" }, 20));
  }
}
const hatter = stalls.find((s) => s.kind === "Hatter")!;
const hat = hatter.hats.find((h) => h.in_stock);
if (hat) {
  record("buy a hat (tUSDC payout to the stall account)", await call(me, dep.bazaar, "buy_hat", { stall_id: hatter.stall_id, hat_id: hat.hat_id, max_usd: hat.price_usd }, 50));
}
const house = loadKey("house");
const keeper = new Account(kumo.stall_id, p, KeyPairSigner.fromSecretKey(house.private_key as KeyPairString));
const view = (await p.callFunction({ contractId: dep.bazaar, method: "get_stall", args: { stall_id: kumo.stall_id } })) as { quotes: { token_id: string; base: number; spread_bps: number; target: number }[] };
const state = (await p.callFunction({ contractId: kumo.stall_id, method: "get_state", args: {} })) as { last_update_ms: string; policy: { min_update_ms: number } };
const wait = Number(state.last_update_ms) + Number(state.policy.min_update_ms) - Date.now();
if (wait > 0) await sleep(wait + 1_000);
try {
  record(
    "keeper reprice (stall account → bazaar)",
    await call(keeper, kumo.stall_id, "keeper_update", { quotes: view.quotes, soak_price: null, hat_prices: null, note: "Measuring my prices. Same as before!" }, 40),
  );
} catch (e) {
  console.warn("keeper update skipped:", String(e).slice(0, 120));
}

console.log("| Action | Gas burnt | NEAR burnt |\n| --- | --- | --- |");
for (const r of rows) console.log(`| ${r.action} | ${r.tgas} TGas | ${r.near} NEAR |`);

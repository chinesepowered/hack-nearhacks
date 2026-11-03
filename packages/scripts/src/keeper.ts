// `pnpm keeper`: runs every capybara shopkeeper in town.
//
// Each keeper signs as its stall account with the house keeper key, a function-call key that
// can only call keeper_update / keeper_offer on that stall. The stall contract checks every
// update against its owner's policy. Owners can switch the house keeper off for their stall,
// or add their own agent's key instead (see README, "Bring your own keeper").
//
// The runner also settles each finished caravan round and keeps stall accounts topped up with
// a little NEAR for gas.

import { Account, KeyPairSigner, type KeyPairString } from "near-api-js";
import {
  TownReader,
  clampToPolicy,
  decide,
  gas,
  traitsFor,
  type KeeperMemory,
  type OfferIn,
  type StallView,
} from "@capy/core";
import { loadDeployment, loadKey, log, provider, rootAccount, sleep } from "./lib";
import { serial, topUpNear, refillRoot } from "./admin";
import { llmDecide, llmEnabled, llmLabel } from "./llm";

const INTERVAL = Number(process.env.KEEPER_INTERVAL_MS ?? 15_000);
const REPRICE_MS = Number(process.env.KEEPER_REPRICE_MS ?? 45_000);
const ONCE = process.argv.includes("--once");

const dep = loadDeployment();
const p = provider();
const root = rootAccount(p);
const house = loadKey("house");
const town = new TownReader(p, dep);
const signer = KeyPairSigner.fromSecretKey(house.private_key as KeyPairString);
const accounts = new Map<string, Account>();
const keeperAccount = (stallId: string) => {
  if (!accounts.has(stallId)) accounts.set(stallId, new Account(stallId, p, signer));
  return accounts.get(stallId)!;
};

interface Mem {
  mem?: KeeperMemory;
  lastOffers: OfferIn[];
  lastRun: number;
  round: number;
}
const memory = new Map<string, Mem>();
const short = (e: unknown) => {
  const m = String((e as Error)?.message ?? e);
  return (m.match(/Smart contract panicked: ([^"\n]+)/)?.[1] ?? m).slice(0, 140);
};

async function runKeeper(s: StallView, stalls: StallView[], caravan: Awaited<ReturnType<TownReader["caravan"]>>, cfg: Awaited<ReturnType<TownReader["config"]>>) {
  const now = Date.now();
  const m: Mem = memory.get(s.stall_id) ?? { lastOffers: [], lastRun: 0, round: caravan.round };
  if (m.round !== caravan.round) {
    m.round = caravan.round;
    m.lastOffers = [];
  }
  memory.set(s.stall_id, m);
  if (now - m.lastRun < REPRICE_MS) return;
  const state = await town.stallState(s.stall_id);
  if (!state.house_enabled) return; // the owner fired the house keeper
  const out = decide({
    stall: s,
    policy: state.policy,
    traits: traitsFor(s.stall_id),
    market: stalls,
    caravan,
    goods: cfg.goods,
    hats: cfg.hats,
    minFloat: cfg.config.stall_min_float,
    memory: m.mem,
    lastOffers: m.lastOffers,
  });
  let decision = out.decision;
  if (llmEnabled()) decision = (await llmDecide(s, state.personality, stalls, caravan, state.policy, decision)) ?? decision;
  decision = clampToPolicy(decision, state.policy);
  m.mem = out.memory;
  m.lastRun = now;
  const acct = keeperAccount(s.stall_id);
  const stale = now - Number(s.keeper_ms) > 180_000;
  if (out.changed || decision.note !== s.note || stale) {
    try {
      await acct.callFunction({
        contractId: s.stall_id,
        methodName: "keeper_update",
        args: {
          quotes: decision.quotes,
          soak_price: decision.soak_price ?? null,
          hat_prices: decision.hat_prices ?? null,
          note: decision.note,
        },
        gas: gas(40),
      });
      log(s.name, decision.note);
    } catch (e) {
      log(s.name, `update refused: ${short(e)}`);
    }
  }
  if (out.offers.length && s.open) {
    try {
      await acct.callFunction({ contractId: s.stall_id, methodName: "keeper_offer", args: { offers: out.offers }, gas: gas(40) });
      m.lastOffers = out.offers;
    } catch (e) {
      log(s.name, `offer refused: ${short(e)}`);
    }
  }
  if (BigInt(state.near_balance) < 80_000_000_000_000_000_000_000n) {
    if (await topUpNear(p, root, s.stall_id, 0.08, "0.2")) log(s.name, "topped up 0.2 NEAR for gas");
  }
}

async function tick() {
  const [stalls, caravan, cfg] = await Promise.all([town.stalls(), town.caravan(), town.config()]);
  if (Date.now() >= caravan.closes_ms + 1_500) {
    try {
      const fills = await serial(() =>
        root.callFunction<{ stall_id: string; token_id: string; qty: number; price: number }[]>({
          contractId: dep.bazaar,
          methodName: "settle_caravan",
          args: {},
          gas: gas(250),
        }),
      );
      const summary = fills.map((f) => `${f.stall_id.split(".")[0]} ${f.qty} ${f.token_id}@${f.price}`).join(", ");
      log("caravan", `round ${caravan.round} settled: ${summary || "nothing sold"}`);
    } catch (e) {
      log("caravan", `settle failed: ${short(e)}`);
    }
    return;
  }
  for (const s of stalls.filter((x) => x.ready)) {
    try {
      await runKeeper(s, stalls, caravan, cfg);
    } catch (e) {
      log(s.name, `keeper error: ${short(e)}`);
    }
  }
}

log("keeper", `running ${dep.stalls.length} keepers for ${dep.bazaar}; brains: ${llmLabel()}`);
do {
  try {
    await refillRoot(p, root);
    await tick();
  } catch (e) {
    log("keeper", `tick failed: ${short(e)}`);
  }
  if (!ONCE) await sleep(INTERVAL);
} while (!ONCE);

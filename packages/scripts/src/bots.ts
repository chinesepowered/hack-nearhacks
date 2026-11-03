// `pnpm bots`: a few capybara townsfolk who forage, sell, soak and occasionally buy hats, so the
// market moves even when you play alone. They are ordinary guest players (function-call keys).
//   BOTS=4 (default)  BOT_PACE_MS=9000 (average time between a bot's actions)

import { Account, KeyPairSigner, type KeyPairString } from "near-api-js";
import { TownPlayer, bidUnit, newKeyPair, sellTotal, shelfCap, type StallView } from "@capy/core";
import { hasKey, loadDeployment, loadKey, log, provider, rootAccount, saveKey, sleep } from "./lib";
import { createPlayer, topUp, topUpNear } from "./admin";

const N = Number(process.env.BOTS ?? 4);
const PACE = Number(process.env.BOT_PACE_MS ?? 9_000);
const NAMES = ["Coco", "Biscuit", "Taro", "Mame", "Kinako", "Hoshi", "Natto", "Ume", "Daifuku", "Sesame"];
const YIELD: Record<string, number> = { grass: 3, yuzu: 2, melon: 1.5 };
const SPOT: Record<string, string> = { grass: "meadow", yuzu: "grove", melon: "field" };

const dep = loadDeployment();
const p = provider();
const root = rootAccount(p);
const short = (e: unknown) => {
  const m = String((e as Error)?.message ?? e);
  return (m.match(/Smart contract panicked: ([^"\n]+)/)?.[1] ?? m).slice(0, 120);
};

async function bot(i: number): Promise<TownPlayer> {
  const name = NAMES[i % NAMES.length];
  const file = `bot-${i}`;
  if (hasKey(file)) {
    const k = loadKey(file);
    if (k.account_id.endsWith(`.${dep.bazaar}`)) {
      return new TownPlayer(p, dep, new Account(k.account_id, p, KeyPairSigner.fromSecretKey(k.private_key as KeyPairString)));
    }
  }
  const kp = newKeyPair();
  const id = await createPlayer(root, dep, name, kp.publicKey);
  await topUp(root, dep, id, 3_000_000);
  saveKey(file, { account_id: id, public_key: kp.publicKey, private_key: kp.privateKey });
  log("bots", `${name} moved into town: ${id}`);
  return new TownPlayer(p, dep, new Account(id, p, KeyPairSigner.fromSecretKey(kp.privateKey as KeyPairString)));
}

function bestStallFor(stalls: StallView[], token: string, units: number): { s: StallView; units: number } | null {
  const options = stalls
    .filter((s) => s.open && s.quotes.some((q) => q.token_id === token))
    .map((s) => {
      const q = s.quotes.find((x) => x.token_id === token)!;
      const stock = Number(q.stock);
      const room = Math.max(0, shelfCap(q) - stock);
      let n = Math.min(units, room);
      while (n > 0 && sellTotal(q, BigInt(stock), n) > Number(s.coins)) n--;
      return { s, units: n, bid: bidUnit(q, BigInt(stock + 1)) };
    })
    .filter((o) => o.units > 0);
  if (!options.length) return null;
  options.sort((a, b) => b.bid - a.bid);
  return Math.random() < 0.7 ? options[0] : options[Math.floor(Math.random() * options.length)];
}

async function act(b: TownPlayer, name: string): Promise<void> {
  const [me, stalls] = await Promise.all([b.player(b.id), b.stalls()]);
  if (!me) return;
  const bal = (t: string) => Number(me.balances.find((x) => x.token_id === t)?.amount ?? 0);
  const coins = bal("coin");

  if (me.energy === 0 || (me.energy <= 2 && coins > 60)) {
    const bath = stalls.find((s) => s.kind === "Bathhouse" && s.open && Number(s.quotes.find((q) => q.token_id === "yuzu")?.stock ?? 0) > 0);
    if (bath && coins >= bath.soak_price) {
      await b.soak(bath.stall_id, bath.soak_price);
      log(name, `soaked at ${bath.name} for ${bath.soak_price} coins`);
      return;
    }
    if (me.energy === 0) {
      // Too tired and too poor: sell something to the bathhouse (it always wants yuzu).
      if (bath && bal("yuzu") > 0) await b.sell(bath.stall_id, "yuzu", bal("yuzu"), 0).catch(() => undefined);
      return;
    }
  }

  // Sell what we have plenty of.
  for (const t of ["melon", "yuzu", "grass"]) {
    if (bal(t) < 4) continue;
    const pick = bestStallFor(stalls, t, bal(t));
    if (!pick) continue;
    const r = await b.sell(pick.s.stall_id, t, pick.units, 0);
    log(name, `sold ${pick.units} ${t} to ${pick.s.name} for ${r.coins} coins`);
    return;
  }

  // Now and then: a hat, or an investment in a closed stall.
  const hatter = stalls.find((s) => s.kind === "Hatter" && s.open);
  const hat = hatter?.hats.find((h) => h.in_stock && Number(h.price_usd) <= Number(me.usd));
  if (hatter && hat && Math.random() < 0.04) {
    await b.buyHat(hatter.stall_id, hat.hat_id, hat.price_usd);
    log(name, `bought a ${hat.hat_id} at ${hatter.name}`);
    return;
  }
  // Good neighbours: help a closed or struggling stall, and spend coins so they flow back.
  const closed = stalls.find((s) => !s.open && s.ready);
  if (closed && coins > 40 && Math.random() < 0.5) {
    await b.invest(closed.stall_id, 25);
    log(name, `invested 25 coins to reopen ${closed.name}`);
    return;
  }
  const struggling = stalls.filter((s) => s.open && Number(s.coins) < 30).sort((a, c) => Number(a.coins) - Number(c.coins))[0];
  if (struggling && coins > 60 && Math.random() < 0.3) {
    await b.invest(struggling.stall_id, 20);
    log(name, `invested 20 coins in ${struggling.name}`);
    return;
  }
  if (coins > 90 && Math.random() < 0.3) {
    // A snack: buy a couple of whatever a stall is overstocked on.
    const pick = stalls
      .filter((s) => s.open && s.kind === "Grocer")
      .flatMap((s) => s.quotes.map((q) => ({ s, q, over: Number(q.stock) / Math.max(1, q.target) })))
      .filter((x) => Number(x.q.stock) >= 2)
      .sort((a, c) => c.over - a.over)[0];
    if (pick) {
      const n = 2;
      const price = Number(pick.q.ask) * n + 4;
      await b.buy(pick.s.stall_id, pick.q.token_id, n, price);
      log(name, `bought ${n} ${pick.q.token_id} from ${pick.s.name} for a snack`);
      return;
    }
  }

  // Forage whatever pays best right now (with a little randomness).
  if (me.energy > 0 && Date.now() >= Number(me.forage_ready_ms)) {
    const ev = Object.keys(SPOT).map((t) => {
      const bids = stalls.filter((s) => s.open).flatMap((s) => s.quotes.filter((q) => q.token_id === t).map((q) => Number(q.bid)));
      return { t, v: Math.max(1, ...bids) * YIELD[t] + Math.random() * 4 };
    });
    ev.sort((a, b2) => b2.v - a.v);
    const r = await b.forage(SPOT[ev[0].t]);
    log(name, `foraged ${r.qty} ${r.token_id} (energy ${r.energy})`);
  }
}

const bots: TownPlayer[] = [];
for (let i = 0; i < N; i++) bots.push(await bot(i));
log("bots", `${N} townsfolk active in ${dep.bazaar}`);

await Promise.all(
  bots.map(async (b, i) => {
    const name = NAMES[i % NAMES.length];
    await sleep(Math.random() * PACE);
    for (let n = 0; ; n++) {
      try {
        await act(b, name);
      } catch (e) {
        log(name, `hmm: ${short(e)}`);
      }
      if (n % 25 === 0) await topUpNear(p, root, b.id, 0.06, "0.15").catch(() => undefined);
      await sleep(PACE * (0.6 + Math.random() * 0.8));
    }
  }),
);

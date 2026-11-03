// `pnpm demo`: the whole story on testnet in about a minute, printed as "do X -> see Y".
// Uses fresh guest players each run. Exits non-zero if any expected outcome does not happen.

import { Account, KeyPairSigner, type KeyPairString } from "near-api-js";
import { GOOD_NAME, TownPlayer, gas, newKeyPair, usd, type StallView } from "@capy/core";
import { loadDeployment, loadKey, provider, rootAccount } from "./lib";
import { createPlayer, topUp } from "./admin";

const dep = loadDeployment();
const p = provider();
const root = rootAccount(p);
let failures = 0;
let step = 0;

function show(doing: string, seeing: string, ok = true) {
  step += 1;
  const mark = ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  if (!ok) failures += 1;
  console.log(`${mark} ${String(step).padStart(2)}. ${doing}\n      → ${seeing}`);
}

async function guest(name: string): Promise<TownPlayer> {
  const kp = newKeyPair(); // what the browser does
  const id = await createPlayer(root, dep, name, kp.publicKey);
  await topUp(root, dep, id, 5_000_000); // the onboarding server gives every guest $5 of test USDC
  const acct = new Account(id, p, KeyPairSigner.fromSecretKey(kp.privateKey as KeyPairString));
  return new TownPlayer(p, dep, acct);
}

const stallBy = (all: StallView[], slug: string) => all.find((s) => s.stall_id.startsWith(`${slug}.`))!;
const bidOf = (s: StallView, t: string) => Number(s.quotes.find((q) => q.token_id === t)?.bid ?? 0);
const errText = (e: unknown) => {
  const m = String((e as Error)?.message ?? e);
  const hit = m.match(/Smart contract panicked: ([^"\n]+)/);
  return hit ? hit[1] : m.slice(0, 160);
};

async function main() {
  console.log(`Capybazaar demo on ${dep.bazaar}\n`);
  const alice = await guest("Alice");
  const pa = await alice.player(alice.id);
  const keys = await p.viewAccessKeyList({ accountId: alice.id });
  const perm = JSON.stringify(keys.keys[0].access_key.permission);
  show(
    "A guest joins (no wallet, no seed phrase)",
    `${alice.id} exists with ${keys.keys.length} key: ${perm.includes(dep.bazaar) ? "function-call, bazaar only" : perm}; ${pa?.energy} energy, ${pa?.balances.find((b) => b.token_id === "coin")?.amount} coins`,
    keys.keys.length === 1 && perm.includes(dep.bazaar),
  );

  // Forage watermelon at the field, then sell it to Mochi.
  let melons = 0;
  for (let i = 0; i < 3; i++) {
    const r = await alice.forage("field");
    melons += r.qty;
    await new Promise((res) => setTimeout(res, 4_200));
  }
  show("Forage at the field three times", `${melons} watermelon, energy now ${(await alice.player(alice.id))?.energy}`, melons >= 3);

  let stalls = await alice.stalls();
  const mochi = stallBy(stalls, "mochi");
  const before = bidOf(mochi, "melon");
  const sold = await alice.sell(mochi.stall_id, "melon", melons, 0);
  stalls = await alice.stalls();
  const after = bidOf(stallBy(stalls, "mochi"), "melon");
  show(
    `Sell all ${melons} watermelon to ${mochi.name}`,
    `+${sold.coins} coins; Mochi's watermelon bid ${before} → ${after} coins (more stock, lower price)`,
    Number(sold.coins) > 0 && after < before,
  );

  const hats = stallBy(stalls, "hats");
  const hatterUsdBefore = BigInt(await alice.tusdcBalance(hats.stall_id));
  const price = hats.hats.find((h) => h.hat_id === "hat-yuzu")!.price_usd;
  await alice.buyHat(hats.stall_id, "hat-yuzu", price);
  const hatterUsdAfter = BigInt(await alice.tusdcBalance(hats.stall_id));
  const pa2 = await alice.player(alice.id);
  show(
    `Buy a ${GOOD_NAME["hat-yuzu"]} for ${usd(price)} of test USDC`,
    `Alice wears ${pa2?.hat}; the Hat Hut account (${hats.stall_id}) received ${usd(String(hatterUsdAfter - hatterUsdBefore))} tUSDC (70%)`,
    pa2?.hat === "hat-yuzu" && hatterUsdAfter > hatterUsdBefore,
  );

  // Pudding's cart is listed by the town. Alice buys it.
  const pudding = stallBy(stalls, "pudding");
  if (!pudding.listed) {
    await root.callFunction({
      contractId: dep.bazaar,
      methodName: "stall_owner_call",
      args: { stall_id: pudding.stall_id, action: { List: { price_usd: "3000000" } } },
      gas: gas(100),
    });
  }
  const listing = (await alice.stall(pudding.stall_id))!.listed!;
  const seller = (await alice.stall(pudding.stall_id))!.owner_id;
  if (Number(pa2?.usd ?? 0) < listing.price_usd) await topUp(root, dep, alice.id, listing.price_usd);
  const bought = await alice.buyStall(pudding.stall_id);
  const info = await p.callFunction({ contractId: pudding.stall_id, method: "nft_item_info", args: {} }) as { owner_id: string; rotation_seq: string };
  const idx = (await alice.stall(pudding.stall_id))!;
  show(
    `Buy ${pudding.name} (listed for ${usd(listing.price_usd)})`,
    `stall account says owner=${info.owner_id} (rotation ${info.rotation_seq}); collection index agrees: ${idx.owner_id === alice.id}`,
    bought === true && info.owner_id === alice.id && idx.owner_id === alice.id,
  );

  // The house keeper (AI shopkeeper) reprices with a scoped key on the stall account.
  const house = loadKey("house");
  const keeperAcct = new Account(pudding.stall_id, p, KeyPairSigner.fromSecretKey(house.private_key as KeyPairString));
  const q = idx.quotes.map((x) => ({ token_id: x.token_id, base: x.base, spread_bps: x.spread_bps, target: x.target }));
  q[0].base = Math.max(1, q[0].base - 1);
  await keeperAcct.callFunction({
    contractId: pudding.stall_id,
    methodName: "keeper_update",
    args: { quotes: q, note: "New owner, new prices! Yuzu a little cheaper today." },
    gas: gas(40),
  });
  const afterKeeper = (await alice.stall(pudding.stall_id))!;
  show("The house keeper reprices Pudding's cart with its scoped key", `note: "${afterKeeper.note}"`, afterKeeper.note.startsWith("New owner"));
  let refused = "";
  await new Promise((res) => setTimeout(res, 10_500)); // the policy allows one update per 10 s
  try {
    await keeperAcct.callFunction({
      contractId: pudding.stall_id,
      methodName: "keeper_update",
      args: { quotes: [{ ...q[0], base: 999 }], note: "price gouging!" },
      gas: gas(40),
    });
  } catch (e) {
    refused = errText(e);
  }
  show("The keeper tries to set a price outside the owner's limits", `refused: ${refused}`, refused.includes("limits"));

  // Alice withdraws coins from her stall, then sells it to Bob.
  await alice.ownerCall(pudding.stall_id, { WithdrawCoins: { amount: "5" } });
  show("Alice withdraws 5 coins from her stall", `Pudding's till: ${(await alice.stall(pudding.stall_id))!.coins} coins`, true);

  await alice.ownerCall(pudding.stall_id, { List: { price_usd: "4000000" } });
  let frozen = "";
  try {
    await alice.ownerCall(pudding.stall_id, { WithdrawCoins: { amount: "1" } });
  } catch (e) {
    frozen = errText(e);
  }
  show("Alice lists it for $4.00, then tries to empty the till before the sale", `refused: ${frozen}`, frozen.includes("listed"));

  const bob = await guest("Bob");
  await topUp(root, dep, bob.id, 5_000_000);
  await bob.buyStall(pudding.stall_id);
  const info2 = await p.callFunction({ contractId: pudding.stall_id, method: "nft_item_info", args: {} }) as { owner_id: string; rotation_seq: string };
  const alicePlayer = await alice.player(alice.id);
  show(
    "Bob buys the stall",
    `owner=${info2.owner_id} (rotation ${info2.rotation_seq}); Alice's Capybazaar wallet now ${usd(alicePlayer!.usd)} (sale minus 5% fee)`,
    info2.owner_id === bob.id,
  );

  let blocked = "";
  try {
    await alice.ownerCall(pudding.stall_id, { WithdrawCoins: { amount: "1" } });
  } catch (e) {
    blocked = errText(e);
  }
  show("Alice (the old owner) tries to withdraw from the stall she sold", `refused: ${blocked}`, blocked.includes("own"));

  const stats = await alice.stats();
  const s = stats.stats;
  show(
    "Town totals (all on testnet)",
    `${s.players} players, ${s.stalls} stall accounts, ${s.actions} on-chain actions, ${s.hats} hats, ${s.stall_sales} stall sales, ${usd(s.usd_volume)} test-USDC volume`,
    true,
  );

  console.log(failures ? `\n${failures} step(s) did not behave as expected.` : "\nAll steps behaved as expected.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

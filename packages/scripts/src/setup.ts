// `pnpm town`: build a fresh Capybazaar town on NEAR testnet with free faucet accounts.
//
//   1. root account from the testnet faucet (admin + pays for guest players)
//   2. more faucet accounts if needed, deleted into root to pool their NEAR
//   3. stall code published once as a NEP-591 global contract (skipped if the hash is on chain)
//   4. tusdc.<root>  (NEP-141 test stablecoin)
//   5. bazaar.<root> (market + NEP-245 goods + NEP-171 stall collection)
//   6. six seed stalls, each a sub-account of the bazaar running the global stall code
//
// Keys go to .keys/ (git-ignored). The deployment is written to deployment.local.json.
// Flags: --public also writes deployment.testnet.json (the shared deployment in the README).

import fs from "node:fs";
import path from "node:path";
import { actions, PublicKey } from "near-api-js";
import { DEFAULT_RPC, SEED_STALLS, accountWithKey, gas, near, newKeyPair, toNear, view, type Deployment } from "@capy/core";
import {
  DEPLOYMENT_LOCAL,
  DEPLOYMENT_PUBLIC,
  RES_DIR,
  balanceNear,
  faucetAccount,
  log,
  provider,
  randomId,
  saveKey,
  sha256Base58,
  sleep,
  txHash,
} from "./lib";

const PUBLIC = process.argv.includes("--public");
const p = provider();

const wasm = (name: string) => new Uint8Array(fs.readFileSync(path.join(RES_DIR, `${name}.wasm`)));
const stallWasm = wasm("stall");
const bazaarWasm = wasm("bazaar");
const tusdcWasm = wasm("tusdc");
const stallHash = sha256Base58(stallWasm);

async function globalCodeExists(hash: string): Promise<boolean> {
  try {
    await p.viewGlobalContractCode({ identifier: { codeHash: hash } });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const id = randomId();
  const rootId = `capybazaar-${id}.testnet`;
  const bazaarId = `bazaar.${rootId}`;
  const tusdcId = `tusdc.${rootId}`;

  log("1/6", `creating ${rootId} from the testnet faucet`);
  const rootKey = await faucetAccount(rootId, p);
  saveKey("root", rootKey);
  const root = accountWithKey(p, rootId, rootKey.private_key);
  const house = newKeyPair();
  saveKey("house", { account_id: "(stall accounts)", public_key: house.publicKey, private_key: house.privateKey });

  const published = await globalCodeExists(stallHash);
  log("2/6", published
    ? `stall code ${stallHash} is already a global contract on testnet; reusing it`
    : `stall code ${stallHash} not on chain yet; it will be published (burns ~${(stallWasm.length / 10_000).toFixed(1)} NEAR once)`);

  const stallFund = 0.30125; // stall_funding + tusdc registration (see Config)
  const need =
    (published ? 0 : stallWasm.length * 1e-4 + 0.5) + // global publish burns 10x storage cost
    tusdcWasm.length * 1e-5 + 0.5 + // tusdc code + state
    bazaarWasm.length * 1e-5 + 1.5 + // bazaar code + state
    SEED_STALLS.length * stallFund +
    5.0 + // guest players and bots (0.25 NEAR each)
    0.8; // root keeps a little for gas
  let have = await balanceNear(p, rootId);
  let n = 0;
  while (have < need) {
    n += 1;
    const fid = `capybazaar-${id}-f${n}.testnet`;
    log("2/6", `pooling faucet NEAR: ${fid} (have ${have.toFixed(2)} of ${need.toFixed(2)} NEAR)`);
    const f = await faucetAccount(fid, p);
    await accountWithKey(p, fid, f.private_key).deleteAccount(rootId);
    have = await balanceNear(p, rootId);
  }

  if (!published) {
    log("3/6", "publishing the stall code as a global contract (by hash)");
    const r = await root.signAndSendTransaction({ receiverId: rootId, actions: [actions.deployGlobalContract(stallWasm, "codeHash")] });
    log("3/6", `tx ${txHash(r)}`);
  } else {
    log("3/6", "skipped (already published)");
  }

  const rootPk = PublicKey.fromString(rootKey.public_key);
  log("4/6", `deploying tUSDC to ${tusdcId}`);
  let r = await root.signAndSendTransaction({
    receiverId: tusdcId,
    actions: [
      actions.createAccount(),
      actions.transfer(near((tusdcWasm.length * 1e-5 + 0.5).toFixed(4))),
      actions.addFullAccessKey(rootPk),
      actions.deployContract(tusdcWasm),
      actions.functionCall("new", {}, gas(30), 0n),
    ],
  });
  log("4/6", `tx ${txHash(r)}`);

  log("5/6", `deploying the bazaar to ${bazaarId}`);
  const bazaarFund = bazaarWasm.length * 1e-5 + 1.5 + SEED_STALLS.length * stallFund + 5.0;
  r = await root.signAndSendTransaction({
    receiverId: bazaarId,
    actions: [
      actions.createAccount(),
      actions.transfer(near(bazaarFund.toFixed(4))),
      actions.addFullAccessKey(rootPk),
      actions.deployContract(bazaarWasm),
      actions.functionCall(
        "new",
        { admin: rootId, tusdc: tusdcId, stall_code_hash: stallHash, house_key: house.publicKey },
        gas(50),
        0n,
      ),
    ],
  });
  log("5/6", `tx ${txHash(r)}`);
  // root (admin, tops up guests) and the bazaar (receives deposits) need tUSDC storage.
  for (const acct of [rootId, bazaarId]) {
    await root.callFunction({
      contractId: tusdcId,
      methodName: "storage_deposit",
      args: { account_id: acct, registration_only: true },
      deposit: near("0.00125"),
      gas: gas(10),
    });
  }

  log("6/6", `opening ${SEED_STALLS.length} stalls`);
  const stalls: string[] = [];
  for (const s of SEED_STALLS) {
    const stallId = `${s.slug}.${bazaarId}`;
    await root.callFunction({
      contractId: bazaarId,
      methodName: "create_stall",
      args: {
        slug: s.slug,
        name: s.name,
        kind: s.kind,
        goods: s.goods,
        personality: s.personality,
        look: s.look,
        initial_coins: String(s.coins),
        initial_stock: s.stock.map(([token_id, qty]) => ({ token_id, qty })),
      },
      deposit: near(String(stallFund)),
      gas: gas(200),
    });
    // The account is created in follow-up receipts; give them a few seconds to land.
    let ready = false;
    for (let i = 0; i < 20 && !ready; i++) {
      const v = await view<{ ready: boolean } | null>(p, bazaarId, "get_stall", { stall_id: stallId });
      ready = !!v?.ready;
      if (!ready) await sleep(1_000);
    }
    if (!ready) throw new Error(`stall ${stallId} did not open; run \`pnpm town\` again`);
    stalls.push(stallId);
    log("6/6", `  ${s.name} -> ${stallId}`);
    if (s.listUsd) {
      await root.callFunction({
        contractId: bazaarId,
        methodName: "stall_owner_call",
        args: { stall_id: stallId, action: { List: { price_usd: String(s.listUsd) } } },
        gas: gas(100),
      });
      log("6/6", `  listed by the town for $${(s.listUsd / 1e6).toFixed(2)}`);
    }
  }

  const dep: Deployment = {
    network: "testnet",
    rpc: process.env.NEAR_RPC ?? DEFAULT_RPC,
    root: rootId,
    bazaar: bazaarId,
    tusdc: tusdcId,
    stallCodeHash: stallHash,
    houseKey: house.publicKey,
    stalls,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(DEPLOYMENT_LOCAL, JSON.stringify(dep, null, 2) + "\n");
  if (PUBLIC) fs.writeFileSync(DEPLOYMENT_PUBLIC, JSON.stringify(dep, null, 2) + "\n");
  const left = toNear(String((await p.viewAccount({ accountId: rootId })).amount));
  console.log(`\nYuzu Springs is open.\n  bazaar: ${bazaarId}\n  tUSDC:  ${tusdcId}\n  stalls: ${stalls.length}\n  root balance left: ${left} NEAR\n  wrote ${path.basename(DEPLOYMENT_LOCAL)}${PUBLIC ? " and deployment.testnet.json" : ""}\n\nNext: pnpm dev`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

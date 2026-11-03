// Admin actions done by the root account: creating guest players, test-USDC top-ups, refills.
// All are serialized through one queue so the root key never races its own nonce.

import { gas, near, toNear, type Deployment } from "@capy/core";
import type { Account, JsonRpcProvider } from "near-api-js";
import { faucetAccount, log, randomId } from "./lib";
import { accountWithKey } from "@capy/core";

let chain: Promise<unknown> = Promise.resolve();
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

export function slug(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 12);
  return s.length >= 2 ? s : "capy";
}

/** Creates `<slug>-<rand>.<bazaar>` with `publicKey` as its only key (function-call, bazaar only). */
export async function createPlayer(root: Account, dep: Deployment, name: string, publicKey: string): Promise<string> {
  const username = `${slug(name)}-${randomId(2)}`;
  const accountId = `${username}.${dep.bazaar}`;
  const ok = await serial(() =>
    root.callFunction<boolean>({
      contractId: dep.bazaar,
      methodName: "create_player",
      args: { username, public_key: publicKey, name: name.slice(0, 32) },
      gas: gas(100),
    }),
  );
  if (ok === false) throw new Error("player creation failed");
  return accountId;
}

/** Mint test USDC to root and deposit it into the bazaar for `accountId` (micro-USD). */
export async function topUp(root: Account, dep: Deployment, accountId: string, micro = 5_000_000): Promise<void> {
  await serial(async () => {
    await root.callFunction({
      contractId: dep.tusdc,
      methodName: "faucet",
      args: { account_id: root.accountId, amount: String(micro) },
      gas: gas(10),
    });
    await root.callFunction({
      contractId: dep.tusdc,
      methodName: "ft_transfer_call",
      args: { receiver_id: dep.bazaar, amount: String(micro), msg: JSON.stringify({ deposit_for: accountId }) },
      deposit: 1n,
      gas: gas(60),
    });
  });
}

/** Keep root funded from the free testnet faucet, so long demos don't stall. */
export async function refillRoot(p: JsonRpcProvider, root: Account, min = 2): Promise<void> {
  const bal = toNear(String((await p.viewAccount({ accountId: root.accountId })).amount));
  if (bal >= min) return;
  const base = root.accountId.replace(/\.testnet$/, "");
  const fid = `${base}-r${randomId(2)}.testnet`;
  log("refill", `root has ${bal} NEAR; pooling faucet account ${fid}`);
  const f = await faucetAccount(fid, p);
  await accountWithKey(p, fid, f.private_key).deleteAccount(root.accountId);
}

/** Send NEAR from root to an account that is running low on gas money. */
export async function topUpNear(p: JsonRpcProvider, root: Account, accountId: string, below = 0.04, amount = "0.1"): Promise<boolean> {
  const bal = toNear(String((await p.viewAccount({ accountId })).amount));
  if (bal >= below) return false;
  await serial(() => root.transfer({ receiverId: accountId, amount: near(amount) }));
  return true;
}

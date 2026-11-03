// Helpers shared by the Node scripts: key files, deployment files, the testnet faucet.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { Account, type JsonRpcProvider } from "near-api-js";
import { accountWithKey, makeProvider, newKeyPair, toNear, type Deployment } from "@capy/core";

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const KEYS_DIR = path.join(ROOT_DIR, ".keys");
export const DEPLOYMENT_LOCAL = path.join(ROOT_DIR, "deployment.local.json");
export const DEPLOYMENT_PUBLIC = path.join(ROOT_DIR, "deployment.testnet.json");
export const RES_DIR = path.join(ROOT_DIR, "contracts", "res");
export const FAUCET_URL = process.env.NEAR_FAUCET_URL ?? "https://helper.nearprotocol.com/account";

export interface KeyFile {
  account_id: string;
  public_key: string;
  private_key: string;
}

export function saveKey(name: string, k: KeyFile): void {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  fs.writeFileSync(path.join(KEYS_DIR, `${name}.json`), JSON.stringify(k, null, 2), { mode: 0o600 });
}

export function loadKey(name: string): KeyFile {
  const f = path.join(KEYS_DIR, `${name}.json`);
  if (!fs.existsSync(f)) throw new Error(`missing ${f}: run \`pnpm town\` first`);
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

export function hasKey(name: string): boolean {
  return fs.existsSync(path.join(KEYS_DIR, `${name}.json`));
}

/** Your own deployment if you ran `pnpm town`, otherwise the shared one in the repo. */
export function loadDeployment(): Deployment {
  const f = fs.existsSync(DEPLOYMENT_LOCAL) ? DEPLOYMENT_LOCAL : DEPLOYMENT_PUBLIC;
  if (!fs.existsSync(f)) throw new Error("no deployment found: run `pnpm town`");
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

export function provider(): JsonRpcProvider {
  return makeProvider(process.env.NEAR_RPC);
}

export function rootAccount(p: JsonRpcProvider = provider()): Account {
  const k = loadKey("root");
  return accountWithKey(p, k.account_id, k.private_key);
}

export const randomId = (bytes = 3) => crypto.randomBytes(bytes).toString("hex");

export function sha256Base58(bytes: Uint8Array): string {
  return base58(crypto.createHash("sha256").update(bytes).digest());
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(buf: Uint8Array): string {
  let x = BigInt("0x" + (Buffer.from(buf).toString("hex") || "0"));
  let s = "";
  while (x > 0n) {
    s = B58[Number(x % 58n)] + s;
    x /= 58n;
  }
  for (const b of buf) {
    if (b === 0) s = "1" + s;
    else break;
  }
  return s;
}

/** Create a testnet account funded by the public faucet (10 NEAR at the time of writing). */
export async function faucetAccount(accountId: string, p: JsonRpcProvider = provider()): Promise<KeyFile> {
  const kp = newKeyPair();
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(FAUCET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: kp.publicKey }),
    });
    if (r.ok) {
      await waitForAccount(p, accountId);
      return { account_id: accountId, public_key: kp.publicKey, private_key: kp.privateKey };
    }
    lastErr = `${r.status} ${(await r.text()).slice(0, 200)}`;
    await sleep(2_000 * 2 ** attempt);
  }
  throw new Error(`faucet refused ${accountId}: ${lastErr}`);
}

export async function waitForAccount(p: JsonRpcProvider, accountId: string, tries = 20): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      await p.viewAccount({ accountId });
      return;
    } catch {
      await sleep(1_000);
    }
  }
  throw new Error(`account ${accountId} did not appear`);
}

export async function balanceNear(p: JsonRpcProvider, accountId: string): Promise<number> {
  const a = await p.viewAccount({ accountId });
  return toNear(String((a as { amount: string | bigint }).amount));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function txHash(outcome: unknown): string {
  const o = outcome as { transaction?: { hash?: string }; transaction_outcome?: { id?: string } };
  return o?.transaction?.hash ?? o?.transaction_outcome?.id ?? "?";
}

export function log(step: string, msg: string): void {
  console.log(`\x1b[36m[${step}]\x1b[0m ${msg}`);
}

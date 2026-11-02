// Thin helpers over near-api-js v7, shared by scripts (Node) and the web app (browser).

import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, type KeyPairString } from "near-api-js";

export const DEFAULT_RPC = "https://rpc.testnet.near.org";

export interface Deployment {
  network: "testnet";
  rpc: string;
  /** Faucet-created account that administers the town (and pays for guests). */
  root: string;
  /** The market contract: NEP-245 goods + NEP-171 stall collection. */
  bazaar: string;
  tusdc: string;
  /** NEP-591 global contract hash every stall account runs. */
  stallCodeHash: string;
  houseKey: string;
  stalls: string[];
  createdAt: string;
}

export function makeProvider(url: string = DEFAULT_RPC): JsonRpcProvider {
  return new JsonRpcProvider({ url });
}

export async function view<T>(
  provider: JsonRpcProvider,
  contractId: string,
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as T;
}

export function accountWithKey(provider: JsonRpcProvider, accountId: string, privateKey: string): Account {
  return new Account(accountId, provider, KeyPairSigner.fromSecretKey(privateKey as KeyPairString));
}

export function newKeyPair(): { publicKey: string; privateKey: string } {
  const kp = KeyPair.fromRandom("ed25519");
  return { publicKey: kp.getPublicKey().toString(), privateKey: kp.toString() };
}

export const TGAS = 1_000_000_000_000n;
export const gas = (tgas: number) => BigInt(tgas) * TGAS;
export const YOCTO_PER_NEAR = 10n ** 24n;
export const near = (n: number | string) => {
  const [w, f = ""] = String(n).split(".");
  return BigInt(w) * YOCTO_PER_NEAR + BigInt((f + "0".repeat(24)).slice(0, 24));
};
export const toNear = (yocto: string | bigint) => Number(BigInt(yocto) / 10n ** 20n) / 10_000;

export const usd = (micro: number | string) => `$${(Number(micro) / 1_000_000).toFixed(2)}`;

// Session + chain access for the browser. The guest key lives in localStorage and can only call
// the bazaar contract (no deposits), so a stolen key can play the game but cannot move NEAR.

import { Account, KeyPairSigner, type KeyPairString } from "near-api-js";
import { TownPlayer, TownReader, makeProvider, newKeyPair, type Deployment } from "@capy/core";

const found = import.meta.glob("../../../deployment*.json", { eager: true, import: "default" }) as Record<string, Deployment>;
export const dep: Deployment = found["../../../deployment.local.json"] ?? found["../../../deployment.testnet.json"];
export const provider = makeProvider(dep.rpc);
export const reader = new TownReader(provider, dep);
export const ONBOARD: string = import.meta.env.VITE_ONBOARD_URL ?? "http://localhost:8787";

export interface Session {
  accountId: string;
  privateKey: string;
  name: string;
  bazaar: string;
}

const KEY = "capybazaar.session";

export function loadSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Session | null;
    return s && s.bazaar === dep.bazaar ? s : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export async function joinAsGuest(name: string): Promise<Session> {
  const kp = newKeyPair();
  let r: Response;
  try {
    r = await fetch(`${ONBOARD}/api/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey: kp.publicKey, name }),
    });
  } catch {
    throw new Error(`The onboarding server at ${ONBOARD} isn't running. Start the town with \`pnpm dev\`.`);
  }
  const body = (await r.json().catch(() => ({}))) as { accountId?: string; error?: string };
  if (!r.ok || !body.accountId) throw new Error(body.error ?? `onboarding failed (${r.status})`);
  const s: Session = { accountId: body.accountId, privateKey: kp.privateKey, name, bazaar: dep.bazaar };
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* the session will last until reload */
  }
  return s;
}

export async function requestTopUp(accountId: string): Promise<void> {
  const r = await fetch(`${ONBOARD}/api/topup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId }),
  });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "top-up failed");
}

export function playerFor(s: Session): TownPlayer {
  return new TownPlayer(provider, dep, new Account(s.accountId, provider, KeyPairSigner.fromSecretKey(s.privateKey as KeyPairString)));
}

export function explainError(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  return (m.match(/Smart contract panicked: ([^"\n]+)/)?.[1] ?? m).slice(0, 180);
}

export const short = (accountId: string) => accountId.split(".")[0];

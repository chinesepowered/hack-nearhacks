// `pnpm list-stall <slug> <usd>`: the town (admin) lists one of its stalls for sale.
// Handy for demos: e.g. `pnpm list-stall yuzu 3` lists Grumpy Yuzu Stand for $3.00.

import { gas } from "@capy/core";
import { loadDeployment, provider, rootAccount } from "./lib";

const [slug = "pudding", price = "3"] = process.argv.slice(2);
const dep = loadDeployment();
const p = provider();
const root = rootAccount(p);
type S = { stall_id: string; name: string; owner_id: string; coins: string; open: boolean; listed: { price_usd: number } | null };
const stalls = (await p.callFunction({ contractId: dep.bazaar, method: "get_stalls", args: {} })) as S[];
const s = stalls.find((x) => x.stall_id.startsWith(`${slug}.`));
if (!s) throw new Error(`no stall ${slug}`);
if (s.owner_id !== root.accountId) {
  console.log(`${s.name} belongs to ${s.owner_id}, not the town; only its owner can list it`);
} else if (s.listed) {
  console.log(`${s.name} is already listed for $${(s.listed.price_usd / 1e6).toFixed(2)}`);
} else {
  await root.callFunction({
    contractId: dep.bazaar,
    methodName: "stall_owner_call",
    args: { stall_id: s.stall_id, action: { List: { price_usd: String(Math.round(Number(price) * 1e6)) } } },
    gas: gas(100),
  });
  console.log(`listed ${s.name} for $${Number(price).toFixed(2)}`);
}
for (const x of stalls) console.log(`  ${x.name.padEnd(22)} ${x.coins.padStart(4)} coins  ${x.open ? "open  " : "CLOSED"}  ${x.owner_id.split(".")[0]}`);

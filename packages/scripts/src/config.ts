// `pnpm config-town key=value ...`: change the bazaar's Config as admin (e.g. player_funding).
import { gas } from "@capy/core";
import { loadDeployment, provider, rootAccount } from "./lib";

const dep = loadDeployment();
const p = provider();
const root = rootAccount(p);
const cfg = (await p.callFunction({ contractId: dep.bazaar, method: "get_config", args: {} }) as { config: Record<string, unknown> }).config;
for (const kv of process.argv.slice(2)) {
  const [k, v] = kv.split("=");
  if (!(k in cfg)) throw new Error(`unknown config field ${k}`);
  cfg[k] = typeof cfg[k] === "number" ? Number(v) : v;
}
await root.callFunction({ contractId: dep.bazaar, methodName: "set_config", args: { config: cfg }, gas: gas(20) });
console.log(JSON.stringify(cfg, null, 2));

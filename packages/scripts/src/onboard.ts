// `pnpm onboard`: the local guest-onboarding server the web app talks to.
//
//   POST /api/guest  { publicKey, name }  -> creates <name>-xx.<bazaar> whose only key is the
//                                            browser's function-call key, plus $5 test USDC
//   POST /api/topup  { accountId }        -> another $5 of test USDC (max $20 per account)
//   GET  /api/deployment                  -> the deployment the server is using
//
// The server holds the root key (from .keys/root.json); the browser never sees it.

import http from "node:http";
import { loadDeployment, provider, rootAccount, log } from "./lib";
import { createPlayer, refillRoot, topUp } from "./admin";

const PORT = Number(process.env.ONBOARD_PORT ?? 8787);
const dep = loadDeployment();
const p = provider();
const root = rootAccount(p);
const toppedUp = new Map<string, number>();
const recentGuests: number[] = [];
const MAX_GUESTS_PER_HOUR = Number(process.env.MAX_GUESTS_PER_HOUR ?? 60);

function send(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 4_000) throw new Error("body too large");
  }
  return data ? JSON.parse(data) : {};
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  try {
    if (req.method === "GET" && req.url === "/api/deployment") return send(res, 200, dep);
    if (req.method === "POST" && req.url === "/api/guest") {
      const { publicKey, name } = await readJson(req);
      if (typeof publicKey !== "string" || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(publicKey))
        return send(res, 400, { error: "bad publicKey" });
      const display = typeof name === "string" && name.trim() ? name.trim().slice(0, 24) : "Capy";
      const now = Date.now();
      while (recentGuests.length && now - recentGuests[0] > 3_600_000) recentGuests.shift();
      if (recentGuests.length >= MAX_GUESTS_PER_HOUR) return send(res, 429, { error: "too many new capybaras this hour" });
      recentGuests.push(now);
      await refillRoot(p, root).catch((e) => log("refill", String(e)));
      const accountId = await createPlayer(root, dep, display, publicKey);
      await topUp(root, dep, accountId);
      toppedUp.set(accountId, 5_000_000);
      log("guest", `${display} -> ${accountId}`);
      return send(res, 200, { accountId });
    }
    if (req.method === "POST" && req.url === "/api/topup") {
      const { accountId } = await readJson(req);
      if (typeof accountId !== "string" || !accountId.endsWith(`.${dep.bazaar}`)) return send(res, 400, { error: "bad accountId" });
      const given = toppedUp.get(accountId) ?? 0;
      if (given >= 20_000_000) return send(res, 429, { error: "that's enough test money for one capybara" });
      await topUp(root, dep, accountId);
      toppedUp.set(accountId, given + 5_000_000);
      log("topup", `${accountId} +$5 test USDC`);
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    log("error", String(e));
    send(res, 500, { error: String(e).slice(0, 300) });
  }
});

server.listen(PORT, () => log("onboard", `listening on http://localhost:${PORT} for ${dep.bazaar}`));

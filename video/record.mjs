// Records the demo video: plays the story in a real browser with captions, at 1280x720.
//
//   pnpm dev            # in another terminal (onboarding server, keepers, bots, web app)
//   node video/record.mjs
//
// Output: video/out/capybazaar-demo.webm and .mp4 (needs ffmpeg for the mp4).
// Needs Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`).
// The listing scene expects a stall listed for sale by the town (pnpm town lists Pudding's cart).

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Use a local Playwright if there is one, otherwise the global install.
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  const globalRoot = execFileSync("npm", ["root", "-g"]).toString().trim();
  ({ chromium } = createRequire(import.meta.url)(path.join(globalRoot, "playwright")));
}

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "out");
fs.mkdirSync(out, { recursive: true });
const URL = process.env.GAME_URL ?? "http://localhost:5173/";
const W = 1280;
const H = 720;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: out, size: { width: W, height: H } } });
const page = await context.newPage();
const marks = [];
const t0 = Date.now();

async function caption(text, ms = 3200) {
  marks.push({ at: (Date.now() - t0) / 1000, text });
  await page.evaluate((t) => {
    let el = document.getElementById("__cap");
    if (!el) {
      el = document.createElement("div");
      el.id = "__cap";
      el.style.cssText =
        "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9999;max-width:1000px;" +
        "background:rgba(59,42,32,.92);color:#fff;font:700 24px/1.3 Nunito,system-ui,sans-serif;" +
        "padding:14px 22px;border-radius:16px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.25)";
      document.body.appendChild(el);
    }
    el.textContent = t;
    el.style.display = t ? "block" : "none";
  }, text);
  await page.waitForTimeout(ms);
}

async function card(title, sub, ms = 3500) {
  await page.evaluate(
    ([t, s]) => {
      const el = document.createElement("div");
      el.id = "__card";
      el.style.cssText =
        "position:fixed;inset:0;z-index:10000;display:grid;place-items:center;background:linear-gradient(180deg,#fff7ec,#fde8c8);" +
        "font-family:'Baloo 2',Nunito,sans-serif;color:#3b2a20;text-align:center";
      el.innerHTML = `<div><div style="font-size:72px;font-weight:800;color:#c9622a">${t}</div><div style="font:700 26px/1.4 Nunito,sans-serif;max-width:900px;margin:10px auto 0">${s}</div></div>`;
      document.body.appendChild(el);
    },
    [title, sub],
  );
  await page.waitForTimeout(ms);
  await page.evaluate(() => document.getElementById("__card")?.remove());
}

async function waitToast(re, timeout = 45_000) {
  await page.waitForFunction((r) => [...document.querySelectorAll(".toast")].some((t) => new RegExp(r).test(t.textContent ?? "")), re.source, { timeout });
}

await page.goto(URL, { waitUntil: "networkidle" });
await card("Capybazaar", "A hot-spring market town on NEAR testnet where every stall is an NFT that is its own NEAR account.");
await caption("Join with just a name. No wallet, no seed phrase.", 1500);
await page.type("#capy-name", "Mochi Fan", { delay: 90 });
await page.click("button.primary");
await page.waitForSelector(".hud", { timeout: 90_000 });
await caption("You now have a real NEAR account. Its only key can play this game and nothing else.", 4200);

await caption("Forage at the melon field. Every action is a NEAR transaction, signed in the browser with no popups.", 800);
await page.click("text=Melon field");
await waitToast(/Foraged/);
await page.waitForTimeout(4500);
await page.click("text=Melon field");
await waitToast(/Foraged/);
await page.waitForTimeout(1500);

await page.click('.stall-card:has-text("Mochi")');
await page.waitForTimeout(1800);
await caption("Sell to Mochi, a capybara shopkeeper. Watch the price: every melon you sell makes the next one cheaper.", 2500);
const sell = page.locator('.panel tr:has-text("watermelon") button:has-text("Sell")');
if (await sell.isEnabled()) {
  await sell.click();
  await waitToast(/Sold/);
}
await page.waitForTimeout(3500);
await page.click('.panel button[aria-label="close"]');

await page.click('.stall-card:has-text("Hat Hut")');
await page.waitForTimeout(1800);
await caption("Hats cost test USDC. 70% of the price goes straight into the stall's own NEAR account.", 2200);
const hat = page.locator(".hat-card button:not([disabled])").first();
if (await hat.count()) {
  await hat.click();
  await waitToast(/New hat/);
}
await page.waitForTimeout(3500);
await page.click('.panel button[aria-label="close"]');

const listed = page.locator(".stall-card:has(.tag.sale)").first();
if (await listed.count()) {
  await listed.click();
  await page.waitForTimeout(2000);
  await caption("This stall is for sale. The NFT is the account: its stock, coins and earnings come with it.", 2600);
  await page.click('.panel button:has-text("Buy this stall")');
  await waitToast(/You own/, 60_000);
  await page.waitForTimeout(2500);
  await caption("The stall account itself now says you own it. The collection agrees.", 3500);
  const reopen = page.locator('.panel button:has-text("Invest 20")');
  if ((await reopen.count()) && (await reopen.isEnabled())) {
    await caption("It had gone broke and closed. Invest a few coins and it reopens, with you as the owner.", 600);
    await reopen.click();
    await waitToast(/Invested/);
    await page.waitForTimeout(2600);
  }
  await page.click('.panel button:has-text("List it")');
  await waitToast(/Listed/);
  await page.waitForTimeout(1500);
  await caption("List it, and the stall's contract freezes withdrawals, so a seller can't empty the till before the sale.", 4500);
  await page.click('.panel button[aria-label="close"]');
}

await page.click("text=On-chain");
await page.waitForTimeout(1200);
await caption("Every step is on chain. Here is one, read straight from the testnet RPC.", 800);
await page.locator(".txs button").first().click();
await page.waitForSelector(".receipts", { timeout: 30_000 });
await page.waitForTimeout(4000);
await page.click('.modal button[aria-label="close"]');

await page.click("text=Fast-forward");
await page.click("text=Fast-forward a week");
await caption("Shopkeeper agents reprice and bid against each other for the caravan. Fast-forward a week: the economy reacts on its own.", 5500);
await caption("", 100);
await card("Built at NEAR HACKATHON", "Testnet · open source · github.com/chinesepowered/hack-nearhacks", 4000);

const video = page.video();
await context.close();
await browser.close();
const webm = path.join(out, "capybazaar-demo.webm");
fs.renameSync(await video.path(), webm);
fs.writeFileSync(path.join(out, "captions.json"), JSON.stringify(marks, null, 2));
try {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(out, "capybazaar-demo.mp4")]);
  console.log(`wrote ${path.join(out, "capybazaar-demo.mp4")}`);
} catch {
  console.log(`wrote ${webm} (install ffmpeg for an mp4)`);
}
console.log(`length ${((Date.now() - t0) / 1000).toFixed(0)}s, ${marks.length} captions`);

# Capybazaar

A small market-town game on NEAR testnet where **every stall is an NFT that is its own NEAR account**, run by a capybara shopkeeper agent. Players forage, sell to the stalls, soak in the hot spring, buy hats with (test) USDC, and can buy a stall outright: its stock, coins and USDC earnings move to the buyer with the NFT.

Built at NEAR HACKATHON (November 2026). Testnet only; the test USDC has no value.

- **Tracks:** Games With Real Economies (`games`), NFTs That Do Something (`nfts`), AI Swarms (`swarms`), Agent Economy (`agents`)
- **Shared testnet deployment:** [`deployment.testnet.json`](deployment.testnet.json). The bazaar is `bazaar.capybazaar-fdd3ed.testnet`.
- **Demo video:** _link to the X post goes here_

## The problem

In most games the shops, prices and earnings live in the developer's database, so players can't really own a business. NFT "ownership" usually means a token that points at a row someone else controls. Capybazaar makes the shop itself a NEAR account. Holding the NFT is what controls the account, and the account's own contract enforces that, so a sale really hands over the shop and everything in it.

## Try it

You need Node 22+ and pnpm 10. Rust is only needed if you want to rebuild the contracts; prebuilt wasm is in [`contracts/res`](contracts/res). Nothing costs money: accounts come from the free testnet faucet.

### 1. Build your own town on testnet (about 1 minute)

```bash
pnpm install
```

```bash
pnpm town
```

**See:** a log that ends with `Yuzu Springs is open.` and your bazaar account (`bazaar.capybazaar-<id>.testnet`). The script created a root account from the faucet, reused the stall code that is already published as a global contract on testnet (by hash), deployed `tusdc.<root>` and `bazaar.<root>`, and opened six stalls. Keys are written to `.keys/` (git-ignored), and the deployment to `deployment.local.json`.

### 2. Run the scripted story (about 1 minute)

```bash
pnpm demo
```

**See:** twelve checked steps, ending in `All steps behaved as expected.`:

```
✓  1. A guest joins (no wallet, no seed phrase)
      → alice-xxxx.bazaar… exists with 1 key: function-call, bazaar only; 8 energy, 15 coins
✓  2. Forage at the field three times
✓  3. Sell all N watermelon to Mochi's Greens
      → +38 coins; Mochi's watermelon bid 10 → 9 coins (more stock, lower price)
✓  4. Buy a Yuzu hat for $1.00 of test USDC
      → Alice wears hat-yuzu; the Hat Hut account (hats.bazaar…) received $0.70 tUSDC (70%)
✓  5. Buy Pudding's Fruit Cart (listed for $3.00)
      → stall account says owner=alice-xxxx… (rotation 1); collection index agrees: true
✓  6. The house keeper reprices Pudding's cart with its scoped key
✓  7. The keeper tries to set a price outside the owner's limits
      → refused: price for yuzu is outside the owner's limits (2..=15)
✓  8. Alice withdraws 5 coins from her stall
✓  9. Alice lists it for $4.00, then tries to empty the till before the sale
      → refused: this stall is listed for sale; unlist it first
✓ 10. Bob buys the stall
✓ 11. Alice (the old owner) tries to withdraw from the stall she sold
      → refused: you don't own this stall
✓ 12. Town totals (all on testnet)
```

The script exits non-zero if any step does not behave as described.

### 3. Play it in the browser

```bash
pnpm dev
```

This starts the guest-onboarding server (port 8787), the shopkeeper runner, four bot townsfolk and the web app. Open http://localhost:5173.

1. Type a name and press **Move into Yuzu Springs**. **See:** your capybara with 8 energy, 15 coins and $5.00 tUSDC. No wallet popup: the browser made a key, and the server created `<name>-xx.bazaar.<root>.testnet` with that key as its only key (function-call, bazaar contract only).
2. Press **Melon field**. **See:** "Foraged N watermelon!" and one less energy.
3. Click **Mochi's Greens**, then **Sell N for ~X🪙**. **See:** your coins go up, and Mochi's "Buys at" price for watermelon goes down.
4. Click **Hat Hut**, then **Buy** under a hat. **See:** your capybara wears it, and the panel shows 70% of the price arriving in Hat Hut's own account.
5. Click **Pudding's Fruit Cart** (listed by the town for $3.00; press **+$5** first if you need test USDC), then **Buy this stall**. **See:** a "yours" tag, and "The account itself says its owner is you (rotation #1)".
6. In your stall, press **List it**. **See:** the withdraw buttons disable. The stall contract refuses withdrawals while listed, so a seller can't empty it before the sale lands.
7. Open the **On-chain** tab and click a transaction. **See:** its receipts and NEP-245/NEP-171 events, read straight from the testnet RPC.
8. Open **Fast-forward** and press **Fast-forward a week**. **See:** a week of prices from the same price curve and keeper rules: watermelon jumps on festival day, yuzu climbs during the blight.

When you run out of energy, soak at **The Big Soak**. Stalls also repaint their speech bubbles every minute or so as their keepers reprice.

### Check the shared deployment without running anything

```bash
curl -s https://test.rpc.fastnear.com -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"mochi.bazaar.capybazaar-fdd3ed.testnet","method_name":"nft_item_info","args_base64":"e30="}}' | python3 -c 'import sys,json; print(bytes(json.load(sys.stdin)["result"]["result"]).decode())'
```

**See:** `{"spec":"sharded-item-1.0.0","init":true,"status":"Active","collection_id":"bazaar.capybazaar-fdd3ed.testnet","token_id":"mochi.bazaar.capybazaar-fdd3ed.testnet",...}`. The stall account describes itself as an item of the bazaar collection.

```bash
curl -s https://test.rpc.fastnear.com -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"mochi.bazaar.capybazaar-fdd3ed.testnet"}}'
```

**See:** exactly one key, a function-call key limited to `keeper_update` and `keeper_offer` on the stall itself. There is no full-access key on any stall account.

## How it works

```
 browser (guest key: function-call, bazaar only, no deposits)
    │  forage / sell / buy / soak / buy_hat / buy_stall / stall_owner_call
    ▼
 bazaar.<root>  ── NEP-245 ledger (goods, coin, hats) + NEP-171 collection + market rules
    │   ▲                                         │
    │   │ stall_set_quotes / stall_offer          │ rotate_owner / owner_action (forwarded)
    │   │ stall_transfer_coins / stall_listed     ▼
    │   └──────────────────────────────  <slug>.bazaar.<root>  ← stall account = the NFT
    │                                       runs the stall global contract (NEP-591)
    │                                       keys: house keeper (+ optional owner agents)
    ▼                                        ▲
 tusdc.<root> (NEP-141)  ── hat payouts ─────┘   keeper runner signs as the stall account
```

- **Stall accounts are NFTs.** The bazaar is a NEP-171 collection whose token ids are stall account ids. Each stall account runs one shared **global contract** (NEP-591) published once by hash, so a stall account stores only 731 bytes. Stalls implement the House of Stake draft [Sharded Non-Fungible Token Items](https://github.com/houseofstake/tla-contracts/blob/main/docs/sharded-nft-items.md): `nft_item_info`, owner taken from the account's own state, `rotation_seq` on every rotation, and refusing to name itself as its collection.
- **The item is the authority.** Owner actions (withdraw coins, withdraw tUSDC, set limits, list, add an agent key) are checked by the stall account against its own `owner`. The bazaar only forwards the caller. A sale is the bazaar calling `rotate_owner(expected_owner, new_owner, seq, listing_nonce)`, which the stall accepts only if it agrees with all four.
- **Shopkeeper agents with wallets.** Each keeper signs as its stall account with a function-call key that can only call `keeper_update` and `keeper_offer`. The stall contract checks every update against the owner's policy (price bounds, max spread, max offer, min interval). A keeper cannot move coins, tUSDC or NEAR. Owners can switch the house keeper off, or add their own agent's key (`AddKeeperKey`, limited to 0.25 NEAR of gas); those keys are deleted when the stall is sold.
- **Real money layer.** Hats cost tUSDC (Circle USDC on mainnet). 70% of each hat goes as tUSDC into the stall account, where only the current owner can withdraw it; 30% is the game's fee. Coins are an in-game currency that never cashes out, so there is no play-to-earn loop.
- **No wallet popups.** Guests get a real NEAR account whose only key is a function-call key held by the browser. It can call the bazaar but cannot attach deposits or move NEAR, so a leaked key can only play the game. Moving a stall with the standard `nft_transfer` still needs a wallet (1 yoctoNEAR).

### What stops a seller from keeping the money

| How a seller might try | What stops it | Where it's tested |
| --- | --- | --- |
| Empty the till between listing and sale | Listing locks the stall: every owner action except `Unlist` is refused | `listing_freezes_withdrawals`, demo step 9 |
| Unlist and relist at a higher price while a buyer's purchase is in flight | The sale must match the listing nonce the stall recorded | `stale_listing_cannot_be_bought` |
| Keep using the stall after the sale | The stall checks its own `owner`; the old owner is refused | `old_owner_locked_out_after_sale`, demo step 11 |
| Keep an agent key on the stall | Owner-added keeper keys are deleted in `rotate_owner` | `owner_keys_are_removed_on_rotation` |
| Dump stock with their own agent while listed | While listed, only the house keeper may act | `listed_stall_refuses_owner_agents` |
| Hold a full-access key | Stall accounts are created with function-call keys only | `view_access_key_list` above |
| Double-sell to two buyers | The collection marks the stall `rotating` and refuses a second buyer until the stall confirms | `no_double_buy_during_rotation` |
| A failed rotation keeps the buyer's money | `on_rotated` refunds the buyer if the stall didn't confirm | `failed_rotation_refunds_the_buyer` |

Income in flight during a sale (e.g. a hat payout) lands in the stall account, which belongs to the buyer by then.

### The economy

- **Prices** follow `mid = base × sqrt((target+1)/(stock+1))`, clamped to 0.5×–2.5× base, with a spread around it. Every unit you sell lowers the next bid; every unit you buy raises the next ask, so a sell-then-buy round trip never profits. Stalls stop buying past a shelf cap (3× target). The same math is in [`price.rs`](contracts/bazaar/src/price.rs) and [`price.ts`](packages/core/src/price.ts), checked against shared test vectors.
- **The caravan** is a coordination market between the keeper agents. Each 5-minute round it wants some quantity of each good up to a max price. Keepers offer surplus stock; offers fill cheapest first at one uniform clearing price, and no stall may supply more than 40% of a round. It is how new coins enter town.
- **Coin sinks:** 10% of every soak is burned as spring upkeep; hats also cost their materials in coins (paid to the hatter). Optional per-round stall rent (`stall_rent`, off by default).
- **Closing and reopening:** a stall with fewer than 5 coins closes until someone invests coins in it.
- The keepers and the economy were tuned with the simulator in [`sim.ts`](packages/core/src/sim.ts) (the Fast-forward tab).

### Keepers and AI

The default keepers are deterministic rules with a personality per stall (cheerful undercutter, grumpy high-margin, follower, hoarder…) in [`keeper.ts`](packages/core/src/keeper.ts), so the town runs with no AI key. To give them an LLM, set any OpenAI-compatible endpoint before `pnpm dev`:

```bash
export OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_MODEL=qwen2.5:3b
```

This works with a local Ollama (free), OpenAI, OpenRouter or NEAR AI Cloud (`https://cloud-api.near.ai/v1` plus `OPENAI_API_KEY`). Calls are capped by `LLM_MAX_CALLS` (default 300). The model only proposes prices and writes the shopkeeper's line; its answer is clamped to the owner's policy and checked again by the stall contract.

## Track fit

- **games:** the loop is forage → sell → soak → hats → own a stall. NPC shopkeepers have wallets (their stall accounts). Players own the markets. Items are NEP-245 multi-tokens in one contract. Players sign in with a name only and never see a wallet, gas or seed phrase.
- **nfts:** NFTs as accounts. A stall NFT holds stock, coins and USDC earnings, carries a shopkeeper agent, and transfers all of it on sale. It implements the sharded NFT items draft, with the transfer threat model and tests above.
- **swarms:** six shopkeeper agents compete in the caravan's uniform-price auction each round, with the 40% cap. Their pricing reacts to each other and to the last round's fills.
- **agents:** the agents earn and spend. Keepers buy from players, sell to the caravan, and earn USDC for their stall, using keys that can't touch the money. Owners can plug in their own agent.

## Mainnet path and costs

The contracts don't change. tUSDC becomes Circle's USDC on NEAR; guest login becomes a wallet or NEAR Auth social login; the onboarding server becomes a hosted relayer of the same calls. Gas use is the same on mainnet. Measured on testnet with `pnpm measure`:

| Action | Gas burnt | NEAR burnt |
| --- | --- | --- |
| forage | 3.04 TGas | 0.00030 NEAR |
| sell (to a stall) | 3.91 TGas | 0.00039 NEAR |
| buy a hat (tUSDC payout to the stall account) | 9.58 TGas | 0.00091 NEAR |
| keeper reprice (stall account → bazaar) | 4.64 TGas | 0.00044 NEAR |

So a 30-action play session burns about 0.01 NEAR. One-time and per-unit costs:

| Item | Cost | Notes |
| --- | --- | --- |
| Publish the stall code (global contract) | ~19.3 NEAR, once | 192,675 bytes × 10× storage price, burned |
| A new stall account | 0.3 NEAR | about 0.007 NEAR of it is storage (731 bytes); the rest is the keeper's gas float |
| A new player | 0.25 NEAR gas float (configurable) | under 1 KB of contract storage |
| Bazaar contract code | ~4.5 NEAR staked | 453,733 bytes |

Every player is a real NEAR account, and every action is a NEAR transaction.

## Repository

```
contracts/
  bazaar/   market + NEP-245 goods + NEP-171 stall collection (Rust, near-sdk 5.30)
  stall/    the stall item contract (published as a global contract)
  tusdc/    NEP-141 test stablecoin with a faucet
  types/    JSON types shared by bazaar and stall
  res/      prebuilt wasm (what `pnpm town` deploys)
packages/
  core/     price curve, keeper rules, simulator, typed client (TypeScript)
  scripts/  town setup, onboarding server, keeper runner, bots, demo, measure
  web/      the game (Vite + React, original SVG art)
```

Tests:

```bash
pnpm test
```

This runs 45 Rust unit tests (contracts) and the TypeScript price tests. To rebuild the contracts (needs Rust and `cargo-near`):

```bash
pnpm build:contracts
```

Other scripts:

- `pnpm keeper`, `pnpm bots` (`BOTS=4`) and `pnpm onboard` run the pieces of `pnpm dev` separately.
- `pnpm sim [days] [townsfolk]` fast-forwards the economy in the terminal.
- `pnpm measure` measures gas per action.
- `pnpm list-stall <slug> <usd>` makes the town list one of its stalls.
- `pnpm config-town key=value` changes the bazaar's config.
- `node video/record.mjs` records the captioned demo video while `pnpm dev` runs; `node video/narrate.mjs` adds an ElevenLabs voiceover (`ELEVENLABS_API_KEY`).

## Disclosures

- All code was written during the hackathon window (from 2026-11-02). There is no pre-hackathon baseline.
- Built with AI assistance (Claude Code).
- Libraries: near-sdk and near-contract-standards 5.30, cargo-near 0.22, near-api-js 7.4, React 19, Vite 8, tsx, vitest, concurrently. Fonts: Baloo 2 and Nunito (Google Fonts). The capybara art is original SVG.
- Testnet only. tUSDC is a test token with a public faucet and no value.
- Known limits:
  - `nft_transfer_call` and NFT approvals are not implemented; stalls move with `nft_transfer` or the in-game market.
  - The house keeper key has no separate gas cap; it spends the stall account's small NEAR float.
  - The keeper runner, bots and onboarding server run locally (no hosted demo).
  - NearBlocks' testnet index is behind (stuck around block 270.4M), so the game shows transactions from the RPC instead of linking to an explorer.
  - `rpc.testnet.near.org` is deprecated and rate-limits (HTTP 429), so everything defaults to FastNEAR's `https://test.rpc.fastnear.com`. Set `NEAR_RPC` to use another endpoint.

## License

[MIT](LICENSE)

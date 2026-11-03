// `pnpm sim [days] [townsfolk]`: fast-forward the town off-chain with the same price curve and
// keeper rules as the contracts, and print what happened. Same engine as the web Fast-forward tab.

import { simulate } from "@capy/core";

const days = Number(process.argv[2] ?? 7);
const bots = Number(process.argv[3] ?? 6);
const r = simulate({ days, bots, seed: 42, festivalDays: [3], blightDays: [5] });
const avg = (d: number, g: string) => {
  const v = r.points.filter((p) => p.hour >= d * 24 && p.hour < (d + 1) * 24).map((p) => p.prices[g]);
  return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : "-";
};

console.log(`Simulated ${days} days with ${bots} townsfolk.\n`);
console.log("Average buy price per day (coins):");
console.log(`  ${"day".padEnd(12)}${Array.from({ length: days }, (_, d) => String(d + 1).padStart(6)).join("")}`);
for (const g of ["grass", "yuzu", "melon"]) {
  console.log(`  ${g.padEnd(12)}${Array.from({ length: days }, (_, d) => avg(d, g).padStart(6)).join("")}`);
}
console.log("\nEvents:");
for (const e of r.events.filter((e) => !e.text.includes("ran out") && !e.text.includes("invested")))
  console.log(`  day ${Math.floor(e.hour / 24) + 1}: ${e.text}`);
console.log(
  `\n${r.summary.trades} trades, ${r.summary.soaks} soaks, ${r.summary.caravanUnits} goods sold to the caravan, ` +
    `${r.summary.closures} stall closures and ${r.summary.reopenings} reopenings.`,
);

// The seed stalls of Yuzu Springs and how each capybara keeper behaves.

import type { StallKind } from "./types";

export type Voice = "cheerful" | "grumpy" | "follower" | "hoarder" | "bath" | "fashion" | "plain";

export interface Traits {
  /** Half-spread in basis points the keeper likes to run. */
  margin: number;
  /** Coins the base price moves per update when the keeper reacts. */
  step: number;
  /** 0..1: how much the keeper copies the average price of rival stalls. */
  follow: number;
  /** Multiplier on base price for the lowest price it will accept from the caravan. */
  offerMarkup: number;
  /** Multiplier on the normal stock target (hoarders keep more on the shelf). */
  hoard: number;
  voice: Voice;
}

export interface SeedStall {
  slug: string;
  name: string;
  kind: StallKind;
  goods: string[];
  personality: string;
  look: number;
  coins: number;
  stock: [string, number][];
  traits: Traits;
  /** Listed for sale by the town at setup, in micro-USD. */
  listUsd?: number;
}

export const DEFAULT_TRAITS: Traits = {
  margin: 800,
  step: 1,
  follow: 0.3,
  offerMarkup: 1.0,
  hoard: 1,
  voice: "plain",
};

export const SEED_STALLS: SeedStall[] = [
  {
    slug: "mochi",
    name: "Mochi's Greens",
    kind: "Grocer",
    goods: ["grass", "melon"],
    personality: "Cheerful and chatty. Undercuts everyone to keep customers coming.",
    look: 0,
    coins: 220,
    stock: [["grass", 25], ["melon", 6]],
    traits: { margin: 500, step: 1, follow: 0.2, offerMarkup: 0.85, hoard: 1, voice: "cheerful" },
  },
  {
    slug: "yuzu",
    name: "Grumpy Yuzu Stand",
    kind: "Grocer",
    goods: ["yuzu"],
    personality: "A grumpy old capybara who hates discounts and keeps prices high.",
    look: 1,
    coins: 200,
    stock: [["yuzu", 20]],
    traits: { margin: 1500, step: 1, follow: 0, offerMarkup: 1.3, hoard: 1, voice: "grumpy" },
  },
  {
    slug: "pudding",
    name: "Pudding's Fruit Cart",
    kind: "Grocer",
    goods: ["yuzu", "melon"],
    personality: "Copies whatever the other stalls do, a little late. Not great with money.",
    look: 2,
    coins: 35,
    stock: [["yuzu", 8], ["melon", 4]],
    traits: { margin: 800, step: 1, follow: 0.8, offerMarkup: 1.0, hoard: 1, voice: "follower" },
    listUsd: 3_000_000,
  },
  {
    slug: "kumo",
    name: "Old Kumo's Barn",
    kind: "Grocer",
    goods: ["grass", "yuzu", "melon"],
    personality: "Slow and steady. Hoards stock and sells big lots to the caravan.",
    look: 3,
    coins: 260,
    stock: [["grass", 40], ["yuzu", 15], ["melon", 10]],
    traits: { margin: 1000, step: 1, follow: 0.3, offerMarkup: 1.1, hoard: 1.8, voice: "hoarder" },
  },
  {
    slug: "onsen",
    name: "The Big Soak",
    kind: "Bathhouse",
    goods: ["yuzu"],
    personality: "Runs the hot spring. Raises soak prices when yuzu runs low.",
    look: 4,
    coins: 160,
    stock: [["yuzu", 12]],
    traits: { margin: 800, step: 1, follow: 0.2, offerMarkup: 1.5, hoard: 1, voice: "bath" },
  },
  {
    slug: "hats",
    name: "Hat Hut",
    kind: "Hatter",
    goods: ["grass", "yuzu", "melon"],
    personality: "Fashion-forward. Prices hats by what's trending this week.",
    look: 5,
    coins: 160,
    stock: [["grass", 12], ["yuzu", 6], ["melon", 3]],
    traits: { margin: 800, step: 1, follow: 0.2, offerMarkup: 1.5, hoard: 1, voice: "fashion" },
  },
];

export function traitsFor(stallId: string): Traits {
  const slug = stallId.split(".")[0];
  return SEED_STALLS.find((s) => s.slug === slug)?.traits ?? DEFAULT_TRAITS;
}

export const GOOD_EMOJI: Record<string, string> = {
  coin: "🪙",
  grass: "🌿",
  yuzu: "🍋",
  melon: "🍉",
  "hat-yuzu": "🍋",
  "hat-lily": "🪷",
  "hat-melon": "🍉",
  "hat-duck": "🐤",
};

export const GOOD_NAME: Record<string, string> = {
  coin: "coins",
  grass: "sweet grass",
  yuzu: "yuzu",
  melon: "watermelon",
  "hat-yuzu": "Yuzu hat",
  "hat-lily": "Lily crown",
  "hat-melon": "Melon helmet",
  "hat-duck": "Duckling buddy",
};

export const SPOT_FOR: Record<string, string> = { grass: "meadow", yuzu: "grove", melon: "field" };

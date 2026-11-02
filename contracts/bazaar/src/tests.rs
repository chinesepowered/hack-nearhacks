#![allow(unused_must_use)]

use super::*;
use capy_types::{HatPrice, NftItemInfo, OfferIn, Quote, ItemStatus, ITEM_SPEC, COIN};
use near_sdk::json_types::{U128, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{serde_json, test_vm_config, testing_env, NearToken, PromiseOrValue, PromiseResult, RuntimeFeesConfig};

const BAZAAR: &str = "bazaar.testnet";
const TUSDC: &str = "tusdc.bazaar.testnet";
const MOCHI: &str = "mochi.bazaar.testnet";
const SOAK: &str = "soak.bazaar.testnet";
const HATS: &str = "hats.bazaar.testnet";
const ALICE: &str = "alice.bazaar.testnet";
const BOB: &str = "bob.bazaar.testnet";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn pk() -> PublicKey {
    "ed25519:US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx".parse().unwrap()
}
fn builder(pred: &str, ms: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc(BAZAAR))
        .predecessor_account_id(acc(pred))
        .signer_account_id(acc(pred))
        .block_timestamp(ms * 1_000_000)
        .random_seed([7u8; 32]);
    b
}
fn ctx(pred: &str, ms: u64) {
    testing_env!(builder(pred, ms).build());
}
fn ctx_dep(pred: &str, ms: u64, dep: NearToken) {
    testing_env!(builder(pred, ms).attached_deposit(dep).build());
}
fn ctx_results(pred: &str, ms: u64, results: Vec<PromiseResult>) {
    testing_env!(
        builder(pred, ms).build(),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        results
    );
}
fn ok() -> PromiseResult {
    PromiseResult::Successful(vec![])
}

fn stall(b: &mut Bazaar, slug: &str, kind: StallKind, goods: &[&str], stock: &[(&str, u32)]) {
    ctx_dep(BAZAAR, 1_000, NearToken::from_near(1));
    b.create_stall(
        slug.into(),
        format!("{slug} stall"),
        kind,
        goods.iter().map(|s| s.to_string()).collect(),
        "test keeper".into(),
        1,
        U64(100),
        stock.iter().map(|(t, q)| Ingredient { token_id: t.to_string(), qty: *q }).collect(),
    );
    ctx_results(BAZAAR, 1_000, vec![ok(), ok()]);
    assert!(b.on_stall_created(format!("{slug}.{BAZAAR}").parse().unwrap()));
}

fn player(b: &mut Bazaar, name: &str) {
    ctx(BAZAAR, 1_000);
    b.create_player(name.into(), pk(), name.into());
    ctx_results(BAZAAR, 1_000, vec![ok(), ok()]);
    assert!(b.on_player_created(format!("{name}.{BAZAAR}").parse().unwrap()));
}

fn town() -> Bazaar {
    ctx(BAZAAR, 1_000);
    let mut b = Bazaar::new(acc(BAZAAR), acc(TUSDC), [1u8; 32].into(), pk());
    stall(&mut b, "mochi", StallKind::Grocer, &["grass", "yuzu"], &[("yuzu", 20), ("grass", 20)]);
    stall(&mut b, "soak", StallKind::Bathhouse, &["yuzu"], &[("yuzu", 5)]);
    stall(&mut b, "hats", StallKind::Hatter, &["grass", "yuzu", "melon"], &[("yuzu", 4), ("grass", 8), ("melon", 2)]);
    player(&mut b, "alice");
    player(&mut b, "bob");
    b
}

fn deposit(b: &mut Bazaar, who: &str, micro_usd: u128) {
    ctx(TUSDC, 2_000);
    b.ft_on_transfer(acc(who), U128(micro_usd), String::new());
}

#[test]
fn stalls_and_players_are_registered() {
    let b = town();
    assert_eq!(b.get_stalls().len(), 3);
    assert_eq!(b.nft_total_supply(), U128(3));
    let t = b.nft_token(MOCHI.into()).unwrap();
    assert_eq!(t.owner_id, acc(BAZAAR));
    let a = b.get_player(acc(ALICE)).unwrap();
    assert_eq!(a.energy, 8);
    assert_eq!(b.mt_balance_of(acc(ALICE), COIN.into()), U128(15));
}

#[test]
fn failed_stall_creation_is_rolled_back() {
    let mut b = town();
    ctx_dep(BAZAAR, 1_000, NearToken::from_near(1));
    b.create_stall("oops".into(), "Oops".into(), StallKind::Grocer, vec!["grass".into()], "".into(), 0, U64(50), vec![]);
    ctx_results(BAZAAR, 1_000, vec![PromiseResult::Failed, ok()]);
    assert!(!b.on_stall_created(acc("oops.bazaar.testnet")));
    assert!(b.get_stall(acc("oops.bazaar.testnet")).is_none());
    assert_eq!(b.mt_balance_of(acc("oops.bazaar.testnet"), COIN.into()), U128(0));
}

#[test]
fn forage_costs_energy_and_has_a_cooldown() {
    let mut b = town();
    ctx(ALICE, 10_000);
    let r = b.forage("grove".into());
    assert_eq!(r.token_id, "yuzu");
    assert!((1..=3).contains(&r.qty));
    assert_eq!(r.energy, 7);
    assert_eq!(b.mt_balance_of(acc(ALICE), "yuzu".into()), U128(r.qty as u128));
}

#[test]
#[should_panic(expected = "still foraging")]
fn forage_cooldown_enforced() {
    let mut b = town();
    ctx(ALICE, 10_000);
    b.forage("meadow".into());
    ctx(ALICE, 11_000);
    b.forage("meadow".into());
}

#[test]
#[should_panic(expected = "tired")]
fn no_energy_no_forage() {
    let mut b = town();
    for i in 0..9u64 {
        ctx(ALICE, 10_000 + i * 5_000);
        b.forage("meadow".into());
    }
}

#[test]
fn energy_regenerates() {
    let mut b = town();
    ctx(ALICE, 10_000);
    b.forage("meadow".into());
    ctx(ALICE, 10_000 + 90_000);
    assert_eq!(b.get_player(acc(ALICE)).unwrap().energy, 8);
}

#[test]
fn selling_floods_the_stall_and_lowers_its_bid() {
    let mut b = town();
    let before = b.get_stall(acc(MOCHI)).unwrap().quotes.iter().find(|q| q.token_id == "grass").unwrap().bid;
    ctx(ALICE, 10_000);
    b.forage("meadow".into());
    let grass = b.mt_balance_of(acc(ALICE), "grass".into()).0 as u32;
    let r = b.sell(acc(MOCHI), "grass".into(), grass, U64(0));
    assert!(r.coins.0 >= grass as u64);
    let after = b.get_stall(acc(MOCHI)).unwrap().quotes.iter().find(|q| q.token_id == "grass").unwrap().bid;
    assert!(after <= before);
    assert_eq!(b.mt_balance_of(acc(ALICE), COIN.into()), U128(15 + r.coins.0 as u128));
}

#[test]
fn buying_from_a_stall_moves_coins_and_goods() {
    let mut b = town();
    ctx(ALICE, 10_000);
    let price = b.quote_buy(acc(MOCHI), "yuzu".into(), 2);
    let r = b.buy(acc(MOCHI), "yuzu".into(), 2, price);
    assert_eq!(r.coins, price);
    assert_eq!(b.mt_balance_of(acc(ALICE), "yuzu".into()), U128(2));
    assert_eq!(b.mt_balance_of(acc(MOCHI), "yuzu".into()), U128(18));
}

#[test]
#[should_panic(expected = "price moved")]
fn slippage_guard() {
    let mut b = town();
    ctx(ALICE, 10_000);
    b.buy(acc(MOCHI), "yuzu".into(), 2, U64(1));
}

#[test]
fn soak_refills_energy_uses_yuzu_and_burns_upkeep() {
    let mut b = town();
    ctx(ALICE, 10_000);
    b.forage("meadow".into());
    let supply_before = b.mt_supply(COIN.into()).unwrap().0;
    ctx(ALICE, 20_000);
    assert_eq!(b.soak(acc(SOAK), U64(100)), 8);
    assert_eq!(b.mt_balance_of(acc(SOAK), "yuzu".into()), U128(4));
    // 8 coins: 0 burned at 10% (floor), 8 to the bathhouse.
    assert_eq!(b.mt_supply(COIN.into()).unwrap().0, supply_before);
    assert_eq!(b.get_player(acc(ALICE)).unwrap().energy, 8);
}

#[test]
fn keeper_quotes_arrive_from_the_stall_account() {
    let mut b = town();
    ctx(MOCHI, 30_000);
    b.stall_set_quotes(
        vec![Quote { token_id: "yuzu".into(), base: 7, spread_bps: 500, target: 25 }],
        None,
        None,
        "yuzu is scarce today".into(),
    );
    let s = b.get_stall(acc(MOCHI)).unwrap();
    assert_eq!(s.note, "yuzu is scarce today");
    assert_eq!(s.quotes.iter().find(|q| q.token_id == "yuzu").unwrap().base, 7);
}

#[test]
#[should_panic(expected = "only stall accounts")]
fn players_cannot_set_quotes() {
    let mut b = town();
    ctx(ALICE, 30_000);
    b.stall_set_quotes(vec![], None, None, "".into());
}

#[test]
#[should_panic(expected = "cannot add new goods")]
fn keeper_cannot_add_goods() {
    let mut b = town();
    ctx(MOCHI, 30_000);
    b.stall_set_quotes(
        vec![Quote { token_id: "melon".into(), base: 7, spread_bps: 500, target: 25 }],
        None,
        None,
        "".into(),
    );
}

#[test]
fn hats_are_paid_in_tusdc_and_split_with_the_stall() {
    let mut b = town();
    deposit(&mut b, ALICE, 5_000_000);
    assert_eq!(b.get_player(acc(ALICE)).unwrap().usd, U64(5_000_000));
    ctx(ALICE, 10_000);
    b.buy_hat(acc(HATS), "hat-yuzu".into(), U64(1_000_000));
    let a = b.get_player(acc(ALICE)).unwrap();
    assert_eq!(a.usd, U64(4_000_000));
    assert_eq!(a.hat.as_deref(), Some("hat-yuzu"));
    assert_eq!(b.mt_balance_of(acc(ALICE), "hat-yuzu".into()), U128(1));
    assert_eq!(b.mt_balance_of(acc(HATS), "yuzu".into()), U128(2)); // recipe used 2 yuzu
    assert_eq!(b.get_stats().treasury_usd, U64(300_000));
    assert_eq!(b.get_stall(acc(HATS)).unwrap().stats.usd_earned, 700_000);
}

#[test]
fn failed_hat_payout_stays_on_the_ledger() {
    let mut b = town();
    ctx_results(BAZAAR, 10_000, vec![PromiseResult::Failed]);
    assert!(!b.on_usd_sent(acc(HATS), U64(700_000), true, Err(near_sdk::PromiseError::Failed)));
    assert_eq!(b.usd_of(&acc(HATS)), 700_000);
}

#[test]
fn deposits_for_unknown_accounts_are_refunded() {
    let mut b = town();
    ctx(TUSDC, 2_000);
    match b.ft_on_transfer(acc("stranger.testnet"), U128(10), String::new()) {
        PromiseOrValue::Value(v) => assert_eq!(v, U128(10)),
        _ => panic!("expected a value"),
    }
}

#[test]
#[should_panic(expected = "only tUSDC")]
fn deposits_only_from_tusdc() {
    let mut b = town();
    ctx(ALICE, 2_000);
    b.ft_on_transfer(acc(ALICE), U128(10), String::new());
}

fn item(owner: &str, seq: u64) -> NftItemInfo {
    NftItemInfo {
        spec: ITEM_SPEC.into(),
        init: true,
        status: ItemStatus::Active,
        collection_id: acc(BAZAAR),
        token_id: MOCHI.into(),
        owner_id: acc(owner),
        rotation_seq: U64(seq),
        rotation_epoch: 1,
    }
}

#[test]
fn stall_sale_pays_the_seller_and_moves_the_index() {
    let mut b = town();
    ctx(MOCHI, 5_000);
    b.stall_listed(U64(2_000_000), U64(1));
    deposit(&mut b, BOB, 3_000_000);
    ctx(BOB, 6_000);
    b.buy_stall(acc(MOCHI));
    assert!(b.get_stall(acc(MOCHI)).unwrap().rotating);
    assert_eq!(b.get_player(acc(BOB)).unwrap().usd, U64(1_000_000));

    let data = serde_json::to_vec(&item(BOB, 1)).unwrap();
    ctx_results(BAZAAR, 6_500, vec![PromiseResult::Successful(data)]);
    assert!(b.on_rotated(acc(MOCHI), acc(BAZAAR), acc(BOB), Some(U64(2_000_000)), Ok(item(BOB, 1))));
    let s = b.get_stall(acc(MOCHI)).unwrap();
    assert_eq!(s.owner_id, acc(BOB));
    assert!(s.listed.is_none() && !s.rotating);
    assert_eq!(b.nft_tokens_for_owner(acc(BOB), None, None).len(), 1);
    assert_eq!(b.usd_of(&acc(BAZAAR)), 1_900_000); // 5% fee
    assert_eq!(b.get_stats().stats.stall_sales, 1);
}

#[test]
fn failed_rotation_refunds_the_buyer() {
    let mut b = town();
    ctx(MOCHI, 5_000);
    b.stall_listed(U64(2_000_000), U64(1));
    deposit(&mut b, BOB, 3_000_000);
    ctx(BOB, 6_000);
    b.buy_stall(acc(MOCHI));
    ctx_results(BAZAAR, 6_500, vec![PromiseResult::Failed]);
    assert!(!b.on_rotated(acc(MOCHI), acc(BAZAAR), acc(BOB), Some(U64(2_000_000)), Err(near_sdk::PromiseError::Failed)));
    assert_eq!(b.get_player(acc(BOB)).unwrap().usd, U64(3_000_000));
    assert_eq!(b.get_stall(acc(MOCHI)).unwrap().owner_id, acc(BAZAAR));
}

#[test]
#[should_panic(expected = "someone else is buying")]
fn no_double_buy_during_rotation() {
    let mut b = town();
    ctx(MOCHI, 5_000);
    b.stall_listed(U64(1_000_000), U64(1));
    deposit(&mut b, BOB, 3_000_000);
    deposit(&mut b, ALICE, 3_000_000);
    ctx(BOB, 6_000);
    b.buy_stall(acc(MOCHI));
    ctx(ALICE, 6_100);
    b.buy_stall(acc(MOCHI));
}

#[test]
#[should_panic(expected = "you don't own this stall")]
fn only_index_owner_can_forward_owner_actions() {
    let mut b = town();
    ctx(ALICE, 6_000);
    b.stall_owner_call(acc(MOCHI), capy_types::OwnerAction::Unlist);
}

#[test]
fn caravan_clears_at_a_uniform_price_and_mints_coins() {
    let mut b = town();
    let demand = b.get_caravan().demand;
    let yuzu = demand.iter().find(|d| d.token_id == "yuzu").unwrap().clone();
    ctx(MOCHI, 5_000);
    b.stall_offer(vec![OfferIn { token_id: "yuzu".into(), qty: yuzu.qty, min_price: 1 }]);
    ctx(SOAK, 5_100);
    b.stall_offer(vec![OfferIn { token_id: "yuzu".into(), qty: 2, min_price: 2 }]);
    assert_eq!(b.mt_balance_of(acc(MOCHI), "yuzu".into()), U128(20 - yuzu.qty as u128));
    let coins_before = b.mt_balance_of(acc(MOCHI), COIN.into()).0;
    ctx(ALICE, 1_000 + 180_000);
    let fills = b.settle_caravan();
    // Mochi's cheaper offer fills the whole demand, so the bathhouse's stock comes back.
    let f = fills.iter().find(|f| f.token_id == "yuzu").unwrap();
    assert_eq!(f.stall_id, acc(MOCHI));
    assert_eq!(f.qty, yuzu.qty);
    assert_eq!(b.mt_balance_of(acc(SOAK), "yuzu".into()), U128(5));
    // Paid qty * clearing price, minus 2 coins rent.
    assert_eq!(b.mt_balance_of(acc(MOCHI), COIN.into()).0, coins_before + yuzu.qty as u128 - 2);
    assert_eq!(b.get_caravan().round, 2);
}

#[test]
#[should_panic(expected = "still trading")]
fn caravan_cannot_settle_early() {
    let mut b = town();
    ctx(ALICE, 2_000);
    b.settle_caravan();
}

#[test]
fn broke_stalls_close_and_investment_reopens_them() {
    let mut b = town();
    ctx(MOCHI, 5_000);
    b.stall_transfer_coins(acc(BAZAAR), U64(98));
    assert!(!b.get_stall(acc(MOCHI)).unwrap().open);
    ctx(ALICE, 6_000);
    b.invest(acc(MOCHI), U64(10));
    assert!(b.get_stall(acc(MOCHI)).unwrap().open);
}

#[test]
fn hat_prices_only_for_hatters() {
    let mut b = town();
    ctx(HATS, 30_000);
    b.stall_set_quotes(vec![], None, Some(vec![HatPrice { hat_id: "hat-duck".into(), price_usd: U64(2_500_000) }]), "".into());
    let h = b.get_stall(acc(HATS)).unwrap();
    assert_eq!(h.hats.iter().find(|x| x.hat_id == "hat-duck").unwrap().price_usd, U64(2_500_000));
}

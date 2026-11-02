//! tUSDC: a NEP-141 test stablecoin (6 decimals) standing in for Circle's USDC on NEAR mainnet.
//! It has no value. Anyone registered can mint a little from `faucet`.

use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::resolver::FungibleTokenResolver;
use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue};

/// 20 tUSDC per faucet call.
const FAUCET_CAP: u128 = 20_000_000;

const ICON: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='15' fill='%232775ca'/%3E%3Ctext x='16' y='21' font-size='14' text-anchor='middle' fill='white' font-family='sans-serif'%3Et$%3C/text%3E%3C/svg%3E";

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Token,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TestUsdc {
    token: FungibleToken,
    metadata: FungibleTokenMetadata,
}

#[near]
impl TestUsdc {
    #[init]
    pub fn new() -> Self {
        Self {
            token: FungibleToken::new(Key::Token),
            metadata: FungibleTokenMetadata {
                spec: FT_METADATA_SPEC.to_string(),
                name: "Test USDC (Capybazaar, no value)".to_string(),
                symbol: "tUSDC".to_string(),
                icon: Some(ICON.to_string()),
                reference: None,
                reference_hash: None,
                decimals: 6,
            },
        }
    }

    /// Mint up to 20 tUSDC to a registered account. Test money, testnet only.
    pub fn faucet(&mut self, account_id: Option<AccountId>, amount: U128) {
        let to = account_id.unwrap_or_else(env::predecessor_account_id);
        require!(amount.0 > 0 && amount.0 <= FAUCET_CAP, "faucet gives at most 20 tUSDC per call");
        require!(
            self.token.accounts.contains_key(&to),
            "register the account first with storage_deposit"
        );
        self.token.internal_deposit(&to, amount.0);
        FtMint { owner_id: &to, amount, memo: Some("faucet") }.emit();
    }
}

#[near]
impl FungibleTokenCore for TestUsdc {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for TestUsdc {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for TestUsdc {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for TestUsdc {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    #[test]
    fn faucet_mints_to_registered_accounts() {
        let alice: AccountId = "alice.testnet".parse().unwrap();
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(alice.clone())
            .attached_deposit(NearToken::from_millinear(125));
        testing_env!(ctx.build());
        let mut c = TestUsdc::new();
        c.storage_deposit(None, Some(true));
        testing_env!(ctx.attached_deposit(NearToken::from_yoctonear(0)).build());
        c.faucet(None, U128(5_000_000));
        assert_eq!(c.ft_balance_of(alice), U128(5_000_000));
        assert_eq!(c.ft_metadata().decimals, 6);
    }

    #[test]
    #[should_panic(expected = "register the account first")]
    fn faucet_requires_registration() {
        testing_env!(VMContextBuilder::new().build());
        let mut c = TestUsdc::new();
        c.faucet(Some("bob.testnet".parse().unwrap()), U128(1));
    }
}

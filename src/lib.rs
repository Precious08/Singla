//! PayOnce job registry and payment protection.
//!
//! Every account has its own desk: anyone can register a job, and the account that registered
//! a job (its creator) is the only one who can approve or execute it. Executing asks the
//! creator to attach a deposit equal to the job amount, and that deposit funds the transfer.
//! At most one successful NEAR transfer ever happens per job. A payment reservation and the
//! `PaymentPending` state are persisted before the transfer is scheduled. Only the private
//! transfer callback can mark a job as paid or release its reservation after a confirmed
//! transfer failure; on failure the deposit is refunded to the job's creator.
//!
//! Amounts are handled in yoctoNEAR and exposed to JSON callers as decimal `U128` strings.

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, Gas, NearToken, PanicOnDefault, Promise, env, near, require};

/// Maximum accepted length of a job ID, in bytes.
const MAX_JOB_ID_BYTES: usize = 64;

/// Gas allocated to the private transfer-result callback.
const TRANSFER_CALLBACK_GAS_TGAS: u64 = 30;

/// Minimum prepaid gas accepted by `execute_job`.
///
/// The callback is paid out of the same prepaid budget, so the execute call must reserve enough
/// gas for its own body plus the callback.
const EXECUTE_JOB_MIN_GAS: u64 = (TRANSFER_CALLBACK_GAS_TGAS + 30) * 1_000_000_000_000;

/// YoctoNEAR kept untouched as the contract's operating reserve (1 NEAR).
///
/// The reserve is never counted as spendable for job payments, so a job can never drain the
/// contract to the point where it cannot cover its own storage or operating costs.
const OPERATING_RESERVE_YOCTO: u128 = 1_000_000_000_000_000_000_000_000;

/// Extra storage headroom, in bytes, included in the balance check.
///
/// Scheduling a payment writes a reservation and an attempt record. This conservative allowance
/// makes sure the funds check also covers the storage those records will stake.
const PAYMENT_STORAGE_HEADROOM_BYTES: u128 = 512;

/// Contract state. `PanicOnDefault` guarantees the contract cannot be used before `init` runs.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    jobs: LookupMap<String, Job>,
    /// YoctoNEAR reserved for jobs whose transfer is still unresolved, keyed by job ID.
    reservations: LookupMap<String, U128>,
    /// The active payment attempt ID for a job, keyed by job ID.
    attempts: LookupMap<String, u64>,
    /// Sum of all outstanding reservations. Used by the available-funds check.
    total_reserved: u128,
    /// Next payment attempt ID. Attempt IDs are unique and never reused.
    next_attempt_id: u64,
    /// The account that created each job, keyed by job ID. Jobs written before
    /// this map existed have no entry; they belong to the contract owner.
    creators: LookupMap<String, AccountId>,
    /// Job IDs created by each account, in creation order. The per-account desk.
    jobs_by_creator: LookupMap<AccountId, Vec<String>>,
}

/// The contract state exactly as the single-owner version wrote it.
///
/// `migrate` reads this layout once and carries it into the current layout.
/// Nothing else should use this struct.
#[derive(near_sdk::borsh::BorshDeserialize, near_sdk::borsh::BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
pub struct ContractOld {
    owner: AccountId,
    jobs: LookupMap<String, Job>,
    reservations: LookupMap<String, U128>,
    attempts: LookupMap<String, u64>,
    total_reserved: u128,
    next_attempt_id: u64,
}

/// Lifecycle of a registered job.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JobState {
    AwaitingApproval,
    Approved,
    /// The transfer was scheduled and its callback has not resolved yet.
    PaymentPending,
    /// The transfer succeeded. This state is permanent.
    Paid,
}

/// A job registered by the owner.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Job {
    pub job_id: String,
    pub recipient: AccountId,
    /// Amount in yoctoNEAR, serialized to JSON as a decimal string.
    pub amount: U128,
    pub state: JobState,
}

#[near]
impl Contract {
    /// Initializes the contract exactly once with the given owner.
    ///
    /// The function is private, so only the contract account itself can call it. The `#[init]`
    /// attribute rejects any second initialization.
    #[init]
    #[private]
    pub fn init(owner_id: AccountId) -> Self {
        // Keep the privacy rule inside the function body as well, so it holds for every caller.
        require!(
            env::current_account_id() == env::predecessor_account_id(),
            "Method init is private"
        );

        Self {
            owner: owner_id,
            jobs: LookupMap::new(b"j".to_vec()),
            reservations: LookupMap::new(b"r".to_vec()),
            attempts: LookupMap::new(b"a".to_vec()),
            total_reserved: 0,
            next_attempt_id: 1,
            creators: LookupMap::new(b"c".to_vec()),
            jobs_by_creator: LookupMap::new(b"u".to_vec()),
        }
    }

    /// Carries state written by the single-owner version into the current layout.
    ///
    /// Only the contract account itself can run the migration. Jobs written by the
    /// old version have no entry in the creators map; every reader treats a missing
    /// entry as "created by the contract owner", which is exactly who created them,
    /// so legacy jobs keep their owner and keep working under the new rules. (The old
    /// jobs map hashes its keys, so the stored job IDs cannot be listed back for an
    /// eager backfill of the per-creator index; the index fills in for every job
    /// created from now on.)
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Only the contract account can migrate this contract"
        );
        let old: ContractOld =
            env::state_read().expect("There is no existing contract state to migrate");

        Self {
            owner: old.owner,
            jobs: old.jobs,
            reservations: old.reservations,
            attempts: old.attempts,
            total_reserved: old.total_reserved,
            next_attempt_id: old.next_attempt_id,
            creators: LookupMap::new(b"c".to_vec()),
            jobs_by_creator: LookupMap::new(b"u".to_vec()),
        }
    }

    /// Registers a new job in the `AwaitingApproval` state.
    ///
    /// Any account can register a job. The calling account is recorded as the job's
    /// creator, and only that account can approve or execute the job from here on.
    pub fn create_job(&mut self, job_id: String, recipient: AccountId, amount: U128) -> Job {
        Self::validate_job_id(&job_id);
        require!(!self.jobs.contains_key(&job_id), "Job ID already exists");
        require!(amount.0 > 0, "Amount must be greater than zero");
        require!(
            recipient != env::current_account_id(),
            "Recipient cannot be the contract itself"
        );

        let creator = env::predecessor_account_id();

        let job = Job {
            job_id: job_id.clone(),
            recipient,
            amount,
            state: JobState::AwaitingApproval,
        };
        let _ = self.jobs.insert(job_id.clone(), job.clone());
        let _ = self.creators.insert(job_id.clone(), creator.clone());

        let mut created_ids = self
            .jobs_by_creator
            .get(&creator)
            .cloned()
            .unwrap_or_default();
        created_ids.push(job_id);
        let _ = self.jobs_by_creator.insert(creator, created_ids);

        job
    }

    /// Approves a registered job. Only the job's creator can approve it.
    ///
    /// Approval only changes the job's state; the recipient and amount are preserved. Approving an
    /// already approved job is idempotent and returns the existing job.
    pub fn approve_job(&mut self, job_id: String) -> Job {
        let mut job = match self.jobs.get(&job_id) {
            Some(job) => job.clone(),
            None => env::panic_str("Job not found"),
        };
        self.assert_creator(&job_id);

        if job.state == JobState::Approved {
            return job;
        }

        match job.state {
            JobState::AwaitingApproval => {}
            JobState::PaymentPending => env::panic_str("Job payment is already pending"),
            JobState::Paid => env::panic_str("Job has already been paid"),
            JobState::Approved => unreachable!("handled above"),
        }

        job.state = JobState::Approved;
        let _ = self.jobs.insert(job_id, job.clone());
        job
    }

    /// Starts the single payment for an approved job. Only the job's creator can
    /// execute it, and the creator funds the payment by attaching a deposit equal
    /// to the job amount.
    ///
    /// The reservation and the `PaymentPending` state are persisted before the transfer promise is
    /// scheduled. Once an attempt is pending, only its private callback can resolve it.
    #[payable]
    pub fn execute_job(&mut self, job_id: String) -> Job {
        let mut job = match self.jobs.get(&job_id) {
            Some(job) => job.clone(),
            None => env::panic_str("Job not found"),
        };
        self.assert_creator(&job_id);

        match job.state {
            JobState::Approved => {}
            JobState::AwaitingApproval => env::panic_str("Job must be approved before execution"),
            JobState::PaymentPending => env::panic_str("Job payment is already pending"),
            JobState::Paid => env::panic_str("Job has already been paid"),
        }

        require!(
            env::attached_deposit().as_yoctonear() == job.amount.0,
            "The deposit must equal the payment amount exactly"
        );
        require!(
            env::prepaid_gas().as_gas() >= EXECUTE_JOB_MIN_GAS,
            "Not enough prepaid gas to execute job"
        );
        require!(
            !self.reservations.contains_key(&job_id),
            "Job already has a payment reservation"
        );

        let amount = job.amount.0;
        let required = self
            .total_reserved
            .checked_add(amount)
            .and_then(|total| total.checked_add(OPERATING_RESERVE_YOCTO))
            .unwrap_or(u128::MAX);
        require!(
            Self::available_balance() >= required,
            "Insufficient contract balance for job payment"
        );

        let attempt_id = self.next_attempt_id;
        self.next_attempt_id = attempt_id
            .checked_add(1)
            .expect("Payment attempt ID overflow");
        self.total_reserved = self
            .total_reserved
            .checked_add(amount)
            .expect("Reserved balance overflow");

        job.state = JobState::PaymentPending;
        let _ = self.jobs.insert(job_id.clone(), job.clone());
        let _ = self.reservations.insert(job_id.clone(), job.amount);
        let _ = self.attempts.insert(job_id.clone(), attempt_id);

        // Persist the pending state and reservation before scheduling the transfer.
        self.jobs.flush();
        self.reservations.flush();
        self.attempts.flush();

        let callback_args = json!({
            "job_id": job_id,
            "attempt_id": attempt_id,
        })
        .to_string()
        .into_bytes();

        Promise::new(job.recipient.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(Promise::new(env::current_account_id()).function_call(
                "on_transfer_complete".to_string(),
                callback_args,
                NearToken::from_yoctonear(0),
                Gas::from_tgas(TRANSFER_CALLBACK_GAS_TGAS),
            ))
            .detach();

        job
    }

    /// Resolves one payment attempt. Private: only the contract itself can call it.
    ///
    /// A successful transfer is final and marks the job `Paid`. A confirmed transfer failure
    /// releases the reservation, refunds the deposit to the job's creator, and returns the job
    /// to `Approved`, which is the only path that permits a creator retry. Missing, malformed,
    /// stale, duplicate, or unknown results panic without changing state.
    #[private]
    pub fn on_transfer_complete(&mut self, job_id: String, attempt_id: u64) {
        // Keep the privacy rule in the body as well, so it holds for every caller.
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Only the contract can complete a payment"
        );

        let mut job = match self.jobs.get(&job_id) {
            Some(job) => job.clone(),
            None => env::panic_str("Job not found"),
        };

        require!(
            job.state == JobState::PaymentPending,
            "Job is not awaiting a payment result"
        );
        require!(
            self.attempts.get(&job_id).copied() == Some(attempt_id),
            "Stale payment attempt"
        );
        require!(
            env::promise_results_count() == 1,
            "Expected exactly one payment result"
        );

        let reserved = self
            .reservations
            .get(&job_id)
            .map(|reserved| reserved.0)
            .unwrap_or(0);
        require!(
            reserved == job.amount.0,
            "Payment reservation does not match job amount"
        );

        match env::promise_result_checked(0, 0) {
            // A successful transfer has no return data.
            Ok(_) => {
                job.state = JobState::Paid;
            }
            Err(near_sdk::PromiseError::Failed) => {
                // The network confirmed the transfer failed. Only this outcome unlocks a retry.
                job.state = JobState::Approved;
                // The creator funded this attempt with the deposit attached to the
                // execute call, so the amount goes back to them. (The failed transfer
                // itself is refunded to this contract by the protocol.)
                Promise::new(self.creator_of(&job_id))
                    .transfer(NearToken::from_yoctonear(job.amount.0))
                    .detach();
            }
            Err(_) => {
                // A transfer result is never expected to carry data. Treat every other error as
                // malformed and leave the job pending rather than unlocking another transfer.
                env::panic_str("Malformed payment result")
            }
        }

        self.release_reservation(&job_id, reserved);
        let _ = self.attempts.remove(&job_id);
        let _ = self.jobs.insert(job_id, job);
    }

    /// Returns the contract owner.
    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    /// Returns a job by ID, or `None` when no such job exists.
    pub fn get_job(&self, job_id: String) -> Option<Job> {
        self.jobs.get(&job_id).cloned()
    }

    /// Returns the account that created a job. Jobs written before creators were
    /// recorded have no entry; the contract owner created those.
    pub fn get_creator(&self, job_id: String) -> AccountId {
        self.creator_of(&job_id)
    }

    /// Returns the IDs of the jobs the given account created, oldest first.
    pub fn get_job_ids_by_creator(&self, account_id: AccountId) -> Vec<String> {
        self.jobs_by_creator
            .get(&account_id)
            .cloned()
            .unwrap_or_default()
    }

    /// The creator of a job: its recorded creator, or the contract owner for
    /// jobs written before creators were recorded.
    fn creator_of(&self, job_id: &str) -> AccountId {
        self.creators
            .get(&job_id.to_string())
            .cloned()
            .unwrap_or_else(|| self.owner.clone())
    }

    fn assert_creator(&self, job_id: &str) {
        require!(
            env::predecessor_account_id() == self.creator_of(job_id),
            "Only the payment's creator can do this"
        );
    }

    /// Returns the balance that may be spent on job payments.
    ///
    /// This subtracts locked tokens, the storage staked by the contract (plus headroom for the
    /// payment bookkeeping records), but not outstanding reservations or the operating reserve.
    fn available_balance() -> u128 {
        let storage_bytes = u128::from(env::storage_usage())
            .checked_add(PAYMENT_STORAGE_HEADROOM_BYTES)
            .unwrap_or(u128::MAX);
        let storage_cost = storage_bytes
            .checked_mul(env::storage_byte_cost().as_yoctonear())
            .unwrap_or(u128::MAX);
        let unlocked = env::account_balance()
            .as_yoctonear()
            .checked_sub(env::account_locked_balance().as_yoctonear())
            .unwrap_or(0);

        unlocked.checked_sub(storage_cost).unwrap_or(0)
    }

    fn release_reservation(&mut self, job_id: &str, amount: u128) {
        let _ = self.reservations.remove(job_id);
        self.total_reserved = self
            .total_reserved
            .checked_sub(amount)
            .expect("Reserved balance underflow");
    }

    fn validate_job_id(job_id: &str) {
        require!(!job_id.trim().is_empty(), "Job ID cannot be blank");
        require!(
            job_id.len() <= MAX_JOB_ID_BYTES,
            "Job ID cannot exceed 64 bytes"
        );
    }
}

/*
 * The rest of this file holds the inline tests for the code above.
 */
#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{AccountId, PromiseResult, testing_env};

    fn contract_id() -> AccountId {
        "contract.near".parse().unwrap()
    }

    fn owner_id() -> AccountId {
        "owner.near".parse().unwrap()
    }

    fn recipient_id() -> AccountId {
        "worker.near".parse().unwrap()
    }

    fn intruder_id() -> AccountId {
        "intruder.near".parse().unwrap()
    }

    fn context(predecessor: AccountId) -> VMContextBuilder {
        context_with(predecessor.clone(), predecessor)
    }

    fn context_with(signer: AccountId, predecessor: AccountId) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(contract_id())
            .signer_account_id(signer)
            .predecessor_account_id(predecessor);
        builder
    }

    /// Builds the contract with the contract account as the private init predecessor.
    fn init_contract() -> Contract {
        testing_env!(context(contract_id()).build());
        Contract::init(owner_id())
    }

    fn owner_context() {
        testing_env!(context(owner_id()).build());
    }

    fn amount(value: u128) -> U128 {
        U128(value)
    }

    fn create_default_job(contract: &mut Contract, job_id: &str) {
        contract.create_job(job_id.to_string(), recipient_id(), amount(1_000_000));
    }

    /// Sets a context for `predecessor` with explicit balance, storage usage,
    /// prepaid gas, and attached deposit.
    fn payment_context_for(
        predecessor: AccountId,
        balance: NearToken,
        storage_usage: u64,
        gas: Gas,
        deposit: NearToken,
    ) {
        testing_env!(
            context(predecessor)
                .account_balance(balance)
                .account_locked_balance(NearToken::from_yoctonear(0))
                .storage_usage(storage_usage)
                .prepaid_gas(gas)
                .attached_deposit(deposit)
                .build()
        );
    }

    /// Sets an owner context with explicit balance, storage usage, prepaid gas,
    /// and attached deposit.
    fn payment_context(balance: NearToken, storage_usage: u64, gas: Gas, deposit: NearToken) {
        payment_context_for(owner_id(), balance, storage_usage, gas, deposit);
    }

    /// Sets an owner context for a successful execution of the default job,
    /// attaching a deposit equal to its amount.
    ///
    /// The storage usage is large enough that rewriting the persisted payment records cannot
    /// underflow the mocked blockchain's storage accounting.
    fn execution_context(balance: NearToken) {
        payment_context(
            balance,
            10_000,
            Gas::from_tgas(100),
            NearToken::from_yoctonear(1_000_000),
        );
    }

    /// Sets a context for the given account to execute the default job,
    /// attaching a deposit equal to its amount.
    fn execution_context_for(predecessor: AccountId, balance: NearToken) {
        payment_context_for(
            predecessor,
            balance,
            10_000,
            Gas::from_tgas(100),
            NearToken::from_yoctonear(1_000_000),
        );
    }

    /// Sets a callback context from the contract account with the given promise results.
    fn callback_context(promise_results: Vec<PromiseResult>) {
        testing_env!(
            context(contract_id()).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            promise_results,
        );
    }

    fn approve_default_job(contract: &mut Contract) {
        create_default_job(contract, "job-1");
        let approved = contract.approve_job("job-1".to_string());
        assert_eq!(approved.state, JobState::Approved);
    }

    fn execute_default_job(contract: &mut Contract) -> Job {
        contract.execute_job("job-1".to_string())
    }

    fn attempt_id(contract: &Contract, job_id: &str) -> u64 {
        contract
            .attempts
            .get(&job_id.to_string())
            .copied()
            .expect("payment attempt should exist")
    }

    fn reserved_amount(contract: &Contract, job_id: &str) -> Option<u128> {
        contract
            .reservations
            .get(&job_id.to_string())
            .map(|reserved| reserved.0)
    }

    fn assert_panics<F: FnOnce()>(f: F) {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
        assert!(result.is_err(), "expected the call to panic");
    }

    #[test]
    fn init_sets_owner_and_starts_without_jobs() {
        let contract = init_contract();

        assert_eq!(contract.get_owner(), owner_id());
        assert_eq!(contract.get_job("job-1".to_string()), None);
    }

    #[test]
    #[should_panic(expected = "is private")]
    fn init_cannot_be_called_by_another_account() {
        testing_env!(context(intruder_id()).build());
        Contract::init(owner_id());
    }

    #[test]
    fn creator_is_the_predecessor_not_the_signer() {
        let mut contract = init_contract();
        // The owner signs, but the call is made by another account.
        testing_env!(context_with(owner_id(), intruder_id()).build());

        create_default_job(&mut contract, "job-1");

        assert_eq!(contract.get_creator("job-1".to_string()), intruder_id());
    }

    #[test]
    #[should_panic(expected = "Only the payment's creator can do this")]
    fn approve_rights_follow_the_predecessor_not_the_signer() {
        let mut contract = init_contract();
        owner_context();
        create_default_job(&mut contract, "job-1");

        // The owner signs, but the call is made by another account.
        testing_env!(context_with(owner_id(), intruder_id()).build());
        contract.approve_job("job-1".to_string());
    }

    #[test]
    fn create_job_persists_awaiting_approval_job() {
        let mut contract = init_contract();
        owner_context();

        let created = contract.create_job("job-1".to_string(), recipient_id(), amount(1_000_000));

        assert_eq!(created.job_id, "job-1");
        assert_eq!(created.recipient, recipient_id());
        assert_eq!(created.amount, amount(1_000_000));
        assert_eq!(created.state, JobState::AwaitingApproval);

        let stored = contract
            .get_job("job-1".to_string())
            .expect("job should be stored");
        assert_eq!(stored, created);
    }

    #[test]
    fn jobs_and_approval_survive_state_reload() {
        let mut contract = init_contract();
        owner_context();

        let awaiting = contract.create_job("job-awaiting".to_string(), recipient_id(), amount(7));
        let to_approve = contract.create_job("job-approved".to_string(), recipient_id(), amount(9));
        let approved = contract.approve_job("job-approved".to_string());
        assert_eq!(approved.state, JobState::Approved);

        // Persist cached collection writes, then serialize the contract state itself.
        contract.jobs.flush();
        let state = near_sdk::borsh::to_vec(&contract).expect("contract state should serialize");
        drop(contract);

        let mut reloaded = near_sdk::borsh::from_slice::<Contract>(&state)
            .expect("contract state should deserialize");

        assert_eq!(reloaded.get_owner(), owner_id());
        assert_eq!(reloaded.get_job("job-awaiting".to_string()), Some(awaiting));
        assert_eq!(
            reloaded.get_job("job-approved".to_string()),
            Some(approved.clone())
        );

        // The reloaded map is usable and the approval is still idempotent.
        let second_approval = reloaded.approve_job("job-approved".to_string());
        assert_eq!(second_approval, approved);
        assert_eq!(second_approval.state, JobState::Approved);
        assert_eq!(second_approval.recipient, to_approve.recipient);
        assert_eq!(second_approval.amount, to_approve.amount);
    }

    #[test]
    #[should_panic(expected = "Job ID cannot be blank")]
    fn rejects_empty_job_id() {
        let mut contract = init_contract();
        owner_context();

        create_default_job(&mut contract, "");
    }

    #[test]
    #[should_panic(expected = "Job ID cannot be blank")]
    fn rejects_whitespace_only_job_id() {
        let mut contract = init_contract();
        owner_context();

        create_default_job(&mut contract, "   ");
    }

    #[test]
    #[should_panic(expected = "Job ID cannot exceed 64 bytes")]
    fn rejects_job_id_longer_than_64_bytes() {
        let mut contract = init_contract();
        owner_context();

        create_default_job(&mut contract, &"a".repeat(65));
    }

    #[test]
    fn accepts_job_id_of_exactly_64_bytes() {
        let mut contract = init_contract();
        owner_context();
        let job_id = "a".repeat(64);

        create_default_job(&mut contract, &job_id);

        assert!(contract.get_job(job_id).is_some());
    }

    #[test]
    #[should_panic(expected = "Job ID already exists")]
    fn rejects_duplicate_job_id() {
        let mut contract = init_contract();
        owner_context();

        create_default_job(&mut contract, "job-1");
        create_default_job(&mut contract, "job-1");
    }

    #[test]
    #[should_panic(expected = "Amount must be greater than zero")]
    fn rejects_zero_amount() {
        let mut contract = init_contract();
        owner_context();

        contract.create_job("job-1".to_string(), recipient_id(), amount(0));
    }

    #[test]
    #[should_panic(expected = "Recipient cannot be the contract itself")]
    fn rejects_contract_as_recipient() {
        let mut contract = init_contract();
        owner_context();

        contract.create_job("job-1".to_string(), contract_id(), amount(1));
    }

    #[test]
    fn approve_job_preserves_recipient_and_amount() {
        let mut contract = init_contract();
        owner_context();
        let created = contract.create_job("job-1".to_string(), recipient_id(), amount(42));

        let approved = contract.approve_job("job-1".to_string());

        assert_eq!(approved.job_id, created.job_id);
        assert_eq!(approved.recipient, created.recipient);
        assert_eq!(approved.amount, created.amount);
        assert_eq!(approved.state, JobState::Approved);
        assert_eq!(contract.get_job("job-1".to_string()), Some(approved));
    }

    #[test]
    fn repeated_approval_returns_existing_approved_job() {
        let mut contract = init_contract();
        owner_context();
        create_default_job(&mut contract, "job-1");

        let first = contract.approve_job("job-1".to_string());
        let second = contract.approve_job("job-1".to_string());

        assert_eq!(second.state, JobState::Approved);
        assert_eq!(second, first);
        assert_eq!(contract.get_job("job-1".to_string()), Some(first));
    }

    #[test]
    fn get_missing_job_returns_none() {
        let contract = init_contract();

        assert_eq!(contract.get_job("missing".to_string()), None);
    }

    #[test]
    #[should_panic(expected = "Job not found")]
    fn approve_missing_job_panics() {
        let mut contract = init_contract();
        owner_context();

        contract.approve_job("missing".to_string());
    }

    #[test]
    #[should_panic(expected = "Job not found")]
    fn execute_missing_job_panics() {
        let mut contract = init_contract();
        owner_context();

        contract.execute_job("missing".to_string());
    }

    #[test]
    #[should_panic(expected = "Only the payment's creator can do this")]
    fn execute_rights_follow_the_predecessor_not_the_signer() {
        let mut contract = init_contract();
        owner_context();
        approve_default_job(&mut contract);

        // The owner signs, but the call is made by another account.
        testing_env!(context_with(owner_id(), intruder_id()).build());
        execute_default_job(&mut contract);
    }

    #[test]
    #[should_panic(expected = "Job must be approved before execution")]
    fn execute_job_requires_approved_job() {
        let mut contract = init_contract();
        owner_context();
        create_default_job(&mut contract, "job-1");

        execution_context(NearToken::from_near(5));
        execute_default_job(&mut contract);
    }

    #[test]
    fn execute_job_persists_pending_state_and_reservation() {
        let mut contract = init_contract();
        owner_context();
        approve_default_job(&mut contract);

        execution_context(NearToken::from_near(5));
        let pending = execute_default_job(&mut contract);

        assert_eq!(pending.state, JobState::PaymentPending);
        assert_eq!(
            contract.get_job("job-1".to_string()).unwrap().state,
            JobState::PaymentPending
        );
        assert_eq!(reserved_amount(&contract, "job-1"), Some(1_000_000));
        assert_eq!(contract.total_reserved, 1_000_000);
        assert_eq!(attempt_id(&contract, "job-1"), 1);
    }

    #[test]
    fn execute_job_rejects_pending_duplicate_without_changing_state() {
        let mut contract = init_contract();
        owner_context();
        approve_default_job(&mut contract);

        execution_context(NearToken::from_near(5));
        execute_default_job(&mut contract);
        let pending = contract.get_job("job-1".to_string()).unwrap();
        let reserved = contract.total_reserved;

        assert_panics(|| {
            contract.execute_job("job-1".to_string());
        });

        assert_eq!(contract.get_job("job-1".to_string()), Some(pending));
        assert_eq!(contract.total_reserved, reserved);
        assert_eq!(reserved_amount(&contract, "job-1"), Some(1_000_000));
    }

    #[test]
    fn execute_job_rejects_paid_duplicate_without_changing_state() {
        let mut contract = init_contract();
        owner_context();
        approve_default_job(&mut contract);

        execution_context(NearToken::from_near(5));
        execute_default_job(&mut contract);
        let attempt = attempt_id(&contract, "job-1");

        callback_context(vec![PromiseResult::Successful(vec![])]);
        contract.on_transfer_complete("job-1".to_string(), attempt);
        let paid = contract.get_job("job-1".to_string()).unwrap();
        assert_eq!(paid.state, JobState::Paid);

        execution_context(NearToken::from_near(5));
        assert_panics(|| {
            contract.execute_job("job-1".to_string());
        });

        assert_eq!(contract.get_job("job-1".to_string()), Some(paid));
        assert_eq!(contract.total_reserved, 0);
    }

    #[test]
    fn execute_job_rejects_insufficient_funds() {
        let mut contract = init_contract();
        owner_context();
        let one_near = NearToken::from_near(1).as_yoctonear();
        contract.create_job("job-1".to_string(), recipient_id(), amount(one_near));
        contract.approve_job("job-1".to_string());

        // The balance equals the job amount, but the operating reserve still has to be covered.
        payment_context(
            NearToken::from_near(1),
            0,
            Gas::from_tgas(100),
            NearToken::from_near(1),
        );
        assert_panics(|| {
            contract.execute_job("job-1".to_string());
        });

        assert_eq!(
            contract.get_job("job-1".to_string()).unwrap().state,
            JobState::Approved
        );
        assert_eq!(contract.total_reserved, 0);
        assert_eq!(reserved_amount(&contract, "job-1"), None);
    }

    #[test]
    fn execute_job_accounts_for_outstanding_reservations() {
        let mut contract = init_contract();
        owner_context();
        let one_near = NearToken::from_near(1).as_yoctonear();
        let one_and_a_half_near = NearToken::from_near(3).as_yoctonear() / 2;

        contract.create_job(
            "job-a".to_string(),
            recipient_id(),
            amount(one_and_a_half_near),
        );
        contract.create_job("job-b".to_string(), recipient_id(), amount(one_near));
        contract.approve_job("job-a".to_string());
        contract.approve_job("job-b".to_string());

        // 2 NEAR plus job-a's own deposit covers job-a plus the reserve, but not
        // job-b (even with its own deposit) while job-a is still reserved.
        payment_context(
            NearToken::from_near(2),
            10_000,
            Gas::from_tgas(100),
            NearToken::from_yoctonear(one_and_a_half_near),
        );
        contract.execute_job("job-a".to_string());
        assert_eq!(contract.total_reserved, one_and_a_half_near);

        payment_context(
            NearToken::from_near(2),
            10_000,
            Gas::from_tgas(100),
            NearToken::from_yoctonear(one_near),
        );
        assert_panics(|| {
            contract.execute_job("job-b".to_string());
        });

        assert_eq!(contract.total_reserved, one_and_a_half_near);
        assert_eq!(
            contract.get_job("job-b".to_string()).unwrap().state,
            JobState::Approved
        );
    }

    #[test]
    fn execute_job_accounts_for_storage_costs() {
        let mut contract = init_contract();
        owner_context();
        let one_near = NearToken::from_near(1).as_yoctonear();
        contract.create_job("job-1".to_string(), recipient_id(), amount(one_near));
        contract.approve_job("job-1".to_string());

        let byte_cost = env::storage_byte_cost().as_yoctonear();
        let balance = NearToken::from_yoctonear(
            NearToken::from_near(1).as_yoctonear() + PAYMENT_STORAGE_HEADROOM_BYTES * byte_cost,
        );

        // At zero storage usage the balance plus the attached deposit exactly
        // covers the job amount and the operating reserve.
        payment_context(balance, 0, Gas::from_tgas(100), NearToken::from_near(1));
        assert_eq!(
            Contract::available_balance(),
            NearToken::from_near(2).as_yoctonear()
        );

        // Storage usage above that makes the same balance insufficient.
        payment_context(balance, 100, Gas::from_tgas(100), NearToken::from_near(1));
        assert_eq!(
            Contract::available_balance(),
            NearToken::from_near(2).as_yoctonear() - 100 * byte_cost
        );
        assert_panics(|| {
            contract.execute_job("job-1".to_string());
        });

        assert_eq!(
            contract.get_job("job-1".to_string()).unwrap().state,
            JobState::Approved
        );
    }

    #[test]
    fn execute_job_rejects_insufficient_prepaid_gas() {
        let mut contract = init_contract();
        owner_context();
        approve_default_job(&mut contract);

        payment_context(
            NearToken::from_near(5),
            0,
            Gas::from_tgas(10),
            NearToken::from_yoctonear(1_000_000),
        );
        assert_panics(|| {
            contract.execute_job("job-1".to_string());
        });

        assert_eq!(
            contract.get_job("job-1".to_string()).unwrap().state,
            JobState::Approved
        );
        assert_eq!(contract.total_reserved, 0);
    }

    #[test]
    fn callback_marks_job_paid_and_releases_reservation() {
        let mut contract = init_contract();
        owner_context();
        approve_default_job(&mut contract);

        execution_context(NearToken::from_near(5));
        execute_default_job(&mut contract);
        let attempt = attempt_id(&contract, "job-1");

        callback_context(vec![PromiseResult::Successful(vec![])]);
        contract.on_transfer_complete("job-1".to_string(), attempt);

        assert_eq!(
            contract.get_job("job-1".to_string()).unwrap().state,
            JobState::Paid
        );
        assert_eq!(contract.total_reserved, 0);
        assert_eq!(reserved_amount(&contract, "job-1"), None);
        assert!(contract.attempts.get(&"job-1".to_string()).is_none());
    }

    #[test]
    fn confirmed_failure_releases_reservation_and_allows_retry() {
        let mut contract = init_contract();
        owner_context();
        approve_default_job(&mut contract);

        execution_context(NearToken::from_near(5));
        execute_default_job(&mut contract);
        let first_attempt = attempt_id(&contract, "job-1");

        callback_context(vec![PromiseResult::Failed]);
        contract.on_transfer_complete("job-1".to_string(), first_attempt);

        assert_eq!(
            contract.get_job("job-1".to_string()).unwrap().state,
            JobState::Approved
        );
        assert_eq!(contract.total_reserved, 0);
        assert_eq!(reserved_amount(&contract, "job-1"), None);

        // The owner may retry after a confirmed failure.
        execution_context(NearToken::from_near(5));
        let pending = execute_default_job(&mut contract);
        assert_eq!(pending.state, JobState::PaymentPending);
        let second_attempt = attempt_id(&contract, "job-1");
        assert_eq!(second_attempt, first_attempt + 1);

        callback_context(vec![PromiseResult::Successful(vec![])]);
        contract.on_transfer_complete("job-1".to_string(), second_attempt);

        assert_eq!(
            contract.get_job("job-1".to_string()).unwrap().state,
            JobState::Paid
        );
        assert_eq!(contract.total_reserved, 0);
    }

    #[test]
    fn stale_callback_does_not_change_state_or_release_reservation() {
        let mut contract = init_contract();
        owner_context();
        approve_default_job(&mut contract);

        execution_context(NearToken::from_near(5));
        execute_default_job(&mut contract);
        let first_attempt = attempt_id(&contract, "job-1");

        callback_context(vec![PromiseResult::Failed]);
        contract.on_transfer_complete("job-1".to_string(), first_attempt);
        execution_context(NearToken::from_near(5));
        execute_default_job(&mut contract);
        let second_attempt = attempt_id(&contract, "job-1");
        assert_eq!(second_attempt, first_attempt + 1);
        let reserved = contract.total_reserved;

        callback_context(vec![PromiseResult::Successful(vec![])]);
        assert_panics(|| {
            contract.on_transfer_complete("job-1".to_string(), first_attempt);
        });

        assert_eq!(
            contract.get_job("job-1".to_string()).unwrap().state,
            JobState::PaymentPending
        );
        assert_eq!(contract.total_reserved, reserved);
        assert_eq!(reserved_amount(&contract, "job-1"), Some(1_000_000));
    }

    #[test]
    fn unauthorized_callback_is_rejected() {
        let mut contract = init_contract();
        owner_context();
        approve_default_job(&mut contract);

        execution_context(NearToken::from_near(5));
        execute_default_job(&mut contract);
        let attempt = attempt_id(&contract, "job-1");
        let reserved = contract.total_reserved;

        testing_env!(context(intruder_id()).build());
        assert_panics(|| {
            contract.on_transfer_complete("job-1".to_string(), attempt);
        });

        assert_eq!(
            contract.get_job("job-1".to_string()).unwrap().state,
            JobState::PaymentPending
        );
        assert_eq!(contract.total_reserved, reserved);
    }

    #[test]
    fn callback_without_promise_result_does_not_unlock_retry() {
        let mut contract = init_contract();
        owner_context();
        approve_default_job(&mut contract);

        execution_context(NearToken::from_near(5));
        execute_default_job(&mut contract);
        let attempt = attempt_id(&contract, "job-1");
        let reserved = contract.total_reserved;

        callback_context(vec![]);
        assert_panics(|| {
            contract.on_transfer_complete("job-1".to_string(), attempt);
        });

        assert_eq!(
            contract.get_job("job-1".to_string()).unwrap().state,
            JobState::PaymentPending
        );
        assert_eq!(contract.total_reserved, reserved);
        assert_eq!(reserved_amount(&contract, "job-1"), Some(1_000_000));
    }

    #[test]
    fn callback_with_multiple_results_does_not_unlock_retry() {
        let mut contract = init_contract();
        owner_context();
        approve_default_job(&mut contract);

        execution_context(NearToken::from_near(5));
        execute_default_job(&mut contract);
        let attempt = attempt_id(&contract, "job-1");
        let reserved = contract.total_reserved;

        callback_context(vec![
            PromiseResult::Successful(vec![]),
            PromiseResult::Failed,
        ]);
        assert_panics(|| {
            contract.on_transfer_complete("job-1".to_string(), attempt);
        });

        assert_eq!(
            contract.get_job("job-1".to_string()).unwrap().state,
            JobState::PaymentPending
        );
        assert_eq!(contract.total_reserved, reserved);
    }

    #[test]
    fn callback_for_unknown_job_is_rejected() {
        let mut contract = init_contract();

        callback_context(vec![PromiseResult::Successful(vec![])]);
        assert_panics(|| {
            contract.on_transfer_complete("missing".to_string(), 1);
        });
    }

    #[test]
    fn callback_cannot_complete_a_paid_job_twice() {
        let mut contract = init_contract();
        owner_context();
        approve_default_job(&mut contract);

        execution_context(NearToken::from_near(5));
        execute_default_job(&mut contract);
        let attempt = attempt_id(&contract, "job-1");

        callback_context(vec![PromiseResult::Successful(vec![])]);
        contract.on_transfer_complete("job-1".to_string(), attempt);
        let paid = contract.get_job("job-1".to_string()).unwrap();

        callback_context(vec![PromiseResult::Successful(vec![])]);
        assert_panics(|| {
            contract.on_transfer_complete("job-1".to_string(), attempt);
        });

        assert_eq!(contract.get_job("job-1".to_string()), Some(paid));
        assert_eq!(contract.total_reserved, 0);
    }

    #[test]
    fn malformed_callback_result_does_not_unlock_retry() {
        let mut contract = init_contract();
        owner_context();
        approve_default_job(&mut contract);

        execution_context(NearToken::from_near(5));
        execute_default_job(&mut contract);
        let attempt = attempt_id(&contract, "job-1");
        let reserved = contract.total_reserved;

        // A transfer result never carries data, so unexpected data is malformed.
        callback_context(vec![PromiseResult::Successful(vec![1])]);
        assert_panics(|| {
            contract.on_transfer_complete("job-1".to_string(), attempt);
        });

        assert_eq!(
            contract.get_job("job-1".to_string()).unwrap().state,
            JobState::PaymentPending
        );
        assert_eq!(contract.total_reserved, reserved);
        assert_eq!(reserved_amount(&contract, "job-1"), Some(1_000_000));
    }

    #[test]
    fn pending_payment_survives_state_reload() {
        let mut contract = init_contract();
        owner_context();
        approve_default_job(&mut contract);

        execution_context(NearToken::from_near(5));
        execute_default_job(&mut contract);
        let pending = contract.get_job("job-1".to_string()).unwrap();

        contract.jobs.flush();
        contract.reservations.flush();
        contract.attempts.flush();
        let state = near_sdk::borsh::to_vec(&contract).expect("contract state should serialize");
        drop(contract);

        let reloaded = near_sdk::borsh::from_slice::<Contract>(&state)
            .expect("contract state should deserialize");

        assert_eq!(reloaded.get_job("job-1".to_string()), Some(pending));
        assert_eq!(reloaded.total_reserved, 1_000_000);
        assert_eq!(reserved_amount(&reloaded, "job-1"), Some(1_000_000));
        assert_eq!(attempt_id(&reloaded, "job-1"), 1);
        assert_eq!(reloaded.next_attempt_id, 2);
    }

    #[test]
    #[should_panic(expected = "Job payment is already pending")]
    fn approve_job_cannot_reset_a_pending_job() {
        let mut contract = init_contract();
        owner_context();
        approve_default_job(&mut contract);

        execution_context(NearToken::from_near(5));
        execute_default_job(&mut contract);

        contract.approve_job("job-1".to_string());
    }

    #[test]
    #[should_panic(expected = "Job has already been paid")]
    fn approve_job_cannot_reset_a_paid_job() {
        let mut contract = init_contract();
        owner_context();
        approve_default_job(&mut contract);

        execution_context(NearToken::from_near(5));
        execute_default_job(&mut contract);
        let attempt = attempt_id(&contract, "job-1");

        callback_context(vec![PromiseResult::Successful(vec![])]);
        contract.on_transfer_complete("job-1".to_string(), attempt);

        owner_context();
        contract.approve_job("job-1".to_string());
    }

    #[test]
    fn anyone_can_create_a_job_and_is_recorded_as_its_creator() {
        let mut contract = init_contract();
        testing_env!(context(intruder_id()).build());

        let created = contract.create_job("job-1".to_string(), recipient_id(), amount(1_000_000));

        assert_eq!(created.state, JobState::AwaitingApproval);
        assert_eq!(contract.get_creator("job-1".to_string()), intruder_id());
        assert_eq!(
            contract.get_job_ids_by_creator(intruder_id()),
            vec!["job-1".to_string()]
        );
        assert_eq!(
            contract.get_job_ids_by_creator(owner_id()),
            Vec::<String>::new()
        );

        // A second job by the same account joins the same desk, in order.
        contract.create_job("job-2".to_string(), recipient_id(), amount(2_000_000));
        assert_eq!(
            contract.get_job_ids_by_creator(intruder_id()),
            vec!["job-1".to_string(), "job-2".to_string()]
        );
    }

    #[test]
    #[should_panic(expected = "Only the payment's creator can do this")]
    fn a_non_creator_cannot_approve_a_job() {
        let mut contract = init_contract();
        testing_env!(context(intruder_id()).build());
        create_default_job(&mut contract, "job-1");

        // Even the contract owner cannot approve another account's job.
        owner_context();
        contract.approve_job("job-1".to_string());
    }

    #[test]
    #[should_panic(expected = "Only the payment's creator can do this")]
    fn a_non_creator_cannot_execute_a_job() {
        let mut contract = init_contract();
        testing_env!(context(intruder_id()).build());
        create_default_job(&mut contract, "job-1");
        contract.approve_job("job-1".to_string());

        // The exact deposit does not help another account execute the job.
        execution_context(NearToken::from_near(5));
        contract.execute_job("job-1".to_string());
    }

    #[test]
    fn creator_runs_the_full_flow_and_the_job_ends_paid() {
        let mut contract = init_contract();
        testing_env!(context(intruder_id()).build());
        create_default_job(&mut contract, "job-1");
        let approved = contract.approve_job("job-1".to_string());
        assert_eq!(approved.state, JobState::Approved);

        execution_context_for(intruder_id(), NearToken::from_near(5));
        let pending = contract.execute_job("job-1".to_string());
        assert_eq!(pending.state, JobState::PaymentPending);
        let attempt = attempt_id(&contract, "job-1");

        callback_context(vec![PromiseResult::Successful(vec![])]);
        contract.on_transfer_complete("job-1".to_string(), attempt);

        assert_eq!(
            contract.get_job("job-1".to_string()).unwrap().state,
            JobState::Paid
        );
        assert_eq!(contract.total_reserved, 0);
    }

    #[test]
    fn execute_with_the_wrong_deposit_panics_and_changes_nothing() {
        let mut contract = init_contract();
        owner_context();
        approve_default_job(&mut contract);

        for deposit in [0u128, 999_999, 1_000_001] {
            payment_context(
                NearToken::from_near(5),
                10_000,
                Gas::from_tgas(100),
                NearToken::from_yoctonear(deposit),
            );
            assert_panics(|| {
                contract.execute_job("job-1".to_string());
            });
            assert_eq!(
                contract.get_job("job-1".to_string()).unwrap().state,
                JobState::Approved
            );
            assert_eq!(contract.total_reserved, 0);
        }

        // The exact deposit still works afterwards.
        execution_context(NearToken::from_near(5));
        let pending = execute_default_job(&mut contract);
        assert_eq!(pending.state, JobState::PaymentPending);
    }

    #[test]
    #[should_panic(expected = "Job has already been paid")]
    fn a_second_execute_after_paid_panics() {
        let mut contract = init_contract();
        testing_env!(context(intruder_id()).build());
        create_default_job(&mut contract, "job-1");
        contract.approve_job("job-1".to_string());

        execution_context_for(intruder_id(), NearToken::from_near(5));
        contract.execute_job("job-1".to_string());
        let attempt = attempt_id(&contract, "job-1");

        callback_context(vec![PromiseResult::Successful(vec![])]);
        contract.on_transfer_complete("job-1".to_string(), attempt);
        assert_eq!(
            contract.get_job("job-1".to_string()).unwrap().state,
            JobState::Paid
        );

        // A second execute, even by the creator with the exact deposit, is refused.
        execution_context_for(intruder_id(), NearToken::from_near(5));
        contract.execute_job("job-1".to_string());
    }

    #[test]
    fn a_legacy_job_without_a_creator_entry_belongs_to_the_owner() {
        let mut contract = init_contract();
        // Simulate a job written before creators were recorded: it sits in the
        // jobs map with no creators entry.
        let _ = contract.jobs.insert(
            "legacy-1".to_string(),
            Job {
                job_id: "legacy-1".to_string(),
                recipient: recipient_id(),
                amount: amount(1_000_000),
                state: JobState::AwaitingApproval,
            },
        );

        assert_eq!(contract.get_creator("legacy-1".to_string()), owner_id());

        // Another account still cannot approve it.
        testing_env!(context(intruder_id()).build());
        assert_panics(|| {
            contract.approve_job("legacy-1".to_string());
        });

        // The owner can.
        owner_context();
        let approved = contract.approve_job("legacy-1".to_string());
        assert_eq!(approved.state, JobState::Approved);
    }

    /// Writes the state the single-owner version would have written, holding one job.
    fn legacy_state_with_one_job() {
        testing_env!(context(contract_id()).build());
        let mut old = ContractOld {
            owner: owner_id(),
            jobs: LookupMap::new(b"j".to_vec()),
            reservations: LookupMap::new(b"r".to_vec()),
            attempts: LookupMap::new(b"a".to_vec()),
            total_reserved: 0,
            next_attempt_id: 1,
        };
        let _ = old.jobs.insert(
            "legacy-1".to_string(),
            Job {
                job_id: "legacy-1".to_string(),
                recipient: recipient_id(),
                amount: amount(1_000_000),
                state: JobState::AwaitingApproval,
            },
        );
        old.jobs.flush();
        env::state_write(&old);
    }

    #[test]
    fn migrate_carries_legacy_jobs_and_the_owner_can_run_one() {
        legacy_state_with_one_job();

        let mut contract = Contract::migrate();

        assert_eq!(contract.get_owner(), owner_id());
        let legacy = contract
            .get_job("legacy-1".to_string())
            .expect("the legacy job should survive migration");
        assert_eq!(legacy.state, JobState::AwaitingApproval);
        assert_eq!(legacy.recipient, recipient_id());
        assert_eq!(legacy.amount, amount(1_000_000));
        // No creators entry exists for it; the fallback names the owner.
        assert_eq!(contract.get_creator("legacy-1".to_string()), owner_id());

        // The owner runs the legacy job under the new rules, deposit included.
        owner_context();
        let approved = contract.approve_job("legacy-1".to_string());
        assert_eq!(approved.state, JobState::Approved);

        execution_context(NearToken::from_near(5));
        let pending = contract.execute_job("legacy-1".to_string());
        assert_eq!(pending.state, JobState::PaymentPending);
        let attempt = attempt_id(&contract, "legacy-1");

        callback_context(vec![PromiseResult::Successful(vec![])]);
        contract.on_transfer_complete("legacy-1".to_string(), attempt);
        assert_eq!(
            contract.get_job("legacy-1".to_string()).unwrap().state,
            JobState::Paid
        );

        // Jobs created after the migration are indexed under their creator.
        testing_env!(context(intruder_id()).build());
        contract.create_job("job-new".to_string(), recipient_id(), amount(5));
        assert_eq!(contract.get_creator("job-new".to_string()), intruder_id());
        assert_eq!(
            contract.get_job_ids_by_creator(intruder_id()),
            vec!["job-new".to_string()]
        );
    }

    #[test]
    #[should_panic(expected = "Only the contract account can migrate this contract")]
    fn migrate_rejects_any_other_caller() {
        legacy_state_with_one_job();

        testing_env!(context(intruder_id()).build());
        Contract::migrate();
    }
}

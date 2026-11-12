use std::sync::Arc;
use std::time::Duration;

use cargo_near_build::BuildOpts;
use near_api::{AccountId, NearGas, NearToken};
use near_sdk::serde_json::json;

const JOB_ID: &str = "job-1";
const JOB_AMOUNT: &str = "1000000";

/// A job whose first transfer targets an account that does not exist yet.
const RETRY_JOB_ID: &str = "job-retry";
const RETRY_JOB_AMOUNT: &str = "2000000000000000000000000";
const MISSING_RECIPIENT: &str = "ghost.sandbox";

#[derive(near_sdk::serde::Deserialize, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct Job {
    pub job_id: String,
    pub recipient: AccountId,
    pub amount: String,
    pub state: JobState,
}

#[derive(near_sdk::serde::Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub enum JobState {
    AwaitingApproval,
    Approved,
    PaymentPending,
    Paid,
}

type SendResult = Result<
    near_api::types::transaction::result::TransactionResult,
    near_api::errors::ExecuteTransactionError,
>;

/// Asserts that the transaction failed with a contract error containing `expected`.
fn assert_contract_error(result: SendResult, expected: &str) {
    let failure = result
        .expect("transaction should be accepted by the network")
        .assert_failure();
    let message = failure.to_string();
    assert!(
        message.contains(expected),
        "expected contract error containing {expected:?}, got: {message}"
    );
}

/// Sends an `execute_job` call with explicit gas for the transfer and its callback.
async fn execute_job(
    contract: &near_api::Contract,
    signer_id: AccountId,
    signer: Arc<near_api::Signer>,
    network: &near_api::NetworkConfig,
    job_id: &str,
) -> SendResult {
    contract
        .call_function("execute_job", json!({ "job_id": job_id }))
        .transaction()
        .gas(NearGas::from_tgas(100))
        .with_signer(signer_id, signer)
        .send_to(network)
        .await
}

/// Reads a job from the contract.
async fn get_job(
    contract: &near_api::Contract,
    network: &near_api::NetworkConfig,
    job_id: &str,
) -> testresult::TestResult<Job> {
    let job = contract
        .call_function("get_job", json!({ "job_id": job_id }))
        .read_only()
        .fetch_from(network)
        .await?
        .data;
    Ok(job)
}

/// Polls a job until it reaches `expected`.
async fn wait_until_state(
    contract: &near_api::Contract,
    network: &near_api::NetworkConfig,
    job_id: &str,
    expected: JobState,
) -> testresult::TestResult<Job> {
    let mut last_state = None;
    for _ in 0..40 {
        let job = get_job(contract, network, job_id).await?;
        if job.state == expected {
            return Ok(job);
        }
        last_state = Some(job.state);
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    panic!("job {job_id:?} did not reach {expected:?}; last state: {last_state:?}");
}

/// Polls an account until its balance is at least `minimum` yoctoNEAR.
async fn wait_until_balance_at_least(
    account_id: &AccountId,
    minimum: u128,
    network: &near_api::NetworkConfig,
) -> testresult::TestResult<u128> {
    let mut last_balance = 0;
    for _ in 0..40 {
        last_balance = balance_of(account_id, network).await?;
        if last_balance >= minimum {
            return Ok(last_balance);
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    panic!("account {account_id} did not reach {minimum} yoctoNEAR; last balance: {last_balance}");
}

/// Returns the account balance in yoctoNEAR.
async fn balance_of(
    account_id: &AccountId,
    network: &near_api::NetworkConfig,
) -> testresult::TestResult<u128> {
    let account = near_api::Account(account_id.clone())
        .view()
        .fetch_from(network)
        .await?;
    Ok(account.data.amount.as_yoctonear())
}

async fn test_registry_on(contract_wasm: Vec<u8>) -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let sandbox_network =
        near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);

    // Create accounts
    let owner = create_subaccount(&sandbox, "owner.sandbox").await?;
    let alice = create_subaccount(&sandbox, "alice.sandbox").await?;
    let contract = create_subaccount(&sandbox, "contract.sandbox")
        .await?
        .as_contract();

    let signer = near_api::Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY
            .parse()
            .unwrap(),
    )?;

    // Deploy the contract code. Initialization is a separate call so the unauthorized-init case
    // can be exercised while the contract is still uninitialized. A private `init` can be batched
    // with deployment when the contract account itself signs the deployment transaction.
    near_api::Contract::deploy(contract.account_id().clone())
        .use_code(contract_wasm)
        .without_init_call()
        .with_signer(signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();

    // A non-contract account cannot initialize the contract.
    assert_contract_error(
        contract
            .call_function("init", json!({ "owner_id": owner.account_id() }))
            .transaction()
            .with_signer(owner.account_id().clone(), signer.clone())
            .send_to(&sandbox_network)
            .await,
        "Method init is private",
    );

    // Only the contract account itself can initialize the contract.
    contract
        .call_function("init", json!({ "owner_id": owner.account_id() }))
        .transaction()
        .with_signer(contract.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();

    // A second initialization must fail.
    assert_contract_error(
        contract
            .call_function("init", json!({ "owner_id": owner.account_id() }))
            .transaction()
            .with_signer(contract.account_id().clone(), signer.clone())
            .send_to(&sandbox_network)
            .await,
        "The contract has already been initialized",
    );

    let on_chain_owner: AccountId = contract
        .call_function("get_owner", ())
        .read_only()
        .fetch_from(&sandbox_network)
        .await?
        .data;
    assert_eq!(&on_chain_owner, owner.account_id());

    // A non-owner cannot register a job.
    assert_contract_error(
        contract
            .call_function(
                "create_job",
                json!({ "job_id": JOB_ID, "recipient": alice.account_id(), "amount": JOB_AMOUNT }),
            )
            .transaction()
            .with_signer(alice.account_id().clone(), signer.clone())
            .send_to(&sandbox_network)
            .await,
        "Only the owner can call this method",
    );

    // The owner registers a job.
    contract
        .call_function(
            "create_job",
            json!({ "job_id": JOB_ID, "recipient": alice.account_id(), "amount": JOB_AMOUNT }),
        )
        .transaction()
        .with_signer(owner.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();

    let job: Job = contract
        .call_function("get_job", json!({ "job_id": JOB_ID }))
        .read_only()
        .fetch_from(&sandbox_network)
        .await?
        .data;
    assert_eq!(job.job_id, JOB_ID);
    assert_eq!(&job.recipient, alice.account_id());
    assert_eq!(job.amount, JOB_AMOUNT);
    assert_eq!(job.state, JobState::AwaitingApproval);

    // Duplicate job IDs are rejected.
    assert_contract_error(
        contract
            .call_function(
                "create_job",
                json!({ "job_id": JOB_ID, "recipient": alice.account_id(), "amount": JOB_AMOUNT }),
            )
            .transaction()
            .with_signer(owner.account_id().clone(), signer.clone())
            .send_to(&sandbox_network)
            .await,
        "Job ID already exists",
    );

    // Blank job IDs are rejected.
    assert_contract_error(
        contract
            .call_function(
                "create_job",
                json!({ "job_id": "   ", "recipient": alice.account_id(), "amount": JOB_AMOUNT }),
            )
            .transaction()
            .with_signer(owner.account_id().clone(), signer.clone())
            .send_to(&sandbox_network)
            .await,
        "Job ID cannot be blank",
    );

    // Job IDs longer than 64 bytes are rejected.
    assert_contract_error(
        contract
            .call_function(
                "create_job",
                json!({ "job_id": "a".repeat(65), "recipient": alice.account_id(), "amount": JOB_AMOUNT }),
            )
            .transaction()
            .with_signer(owner.account_id().clone(), signer.clone())
            .send_to(&sandbox_network)
            .await,
        "Job ID cannot exceed 64 bytes",
    );

    // Zero amounts are rejected.
    assert_contract_error(
        contract
            .call_function(
                "create_job",
                json!({ "job_id": "job-zero", "recipient": alice.account_id(), "amount": "0" }),
            )
            .transaction()
            .with_signer(owner.account_id().clone(), signer.clone())
            .send_to(&sandbox_network)
            .await,
        "Amount must be greater than zero",
    );

    // The contract itself cannot be the recipient.
    assert_contract_error(
        contract
            .call_function(
                "create_job",
                json!({ "job_id": "job-self", "recipient": contract.account_id(), "amount": JOB_AMOUNT }),
            )
            .transaction()
            .with_signer(owner.account_id().clone(), signer.clone())
            .send_to(&sandbox_network)
            .await,
        "Recipient cannot be the contract itself",
    );

    // A non-owner cannot approve the job.
    assert_contract_error(
        contract
            .call_function("approve_job", json!({ "job_id": JOB_ID }))
            .transaction()
            .with_signer(alice.account_id().clone(), signer.clone())
            .send_to(&sandbox_network)
            .await,
        "Only the owner can call this method",
    );

    // The owner approves the job.
    contract
        .call_function("approve_job", json!({ "job_id": JOB_ID }))
        .transaction()
        .with_signer(owner.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();

    // Approval preserves the recipient and amount.
    let approved: Job = contract
        .call_function("get_job", json!({ "job_id": JOB_ID }))
        .read_only()
        .fetch_from(&sandbox_network)
        .await?
        .data;
    assert_eq!(approved.job_id, JOB_ID);
    assert_eq!(&approved.recipient, alice.account_id());
    assert_eq!(approved.amount, JOB_AMOUNT);
    assert_eq!(approved.state, JobState::Approved);

    // Repeated approval succeeds and returns the existing approved job.
    contract
        .call_function("approve_job", json!({ "job_id": JOB_ID }))
        .transaction()
        .with_signer(owner.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();

    let approved_again: Job = contract
        .call_function("get_job", json!({ "job_id": JOB_ID }))
        .read_only()
        .fetch_from(&sandbox_network)
        .await?
        .data;
    assert_eq!(approved_again.state, JobState::Approved);
    assert_eq!(approved_again.recipient, approved.recipient);
    assert_eq!(approved_again.amount, approved.amount);

    // A missing job is reported as null.
    let missing: Option<Job> = contract
        .call_function("get_job", json!({ "job_id": "missing" }))
        .read_only()
        .fetch_from(&sandbox_network)
        .await?
        .data;
    assert!(missing.is_none());

    // Approving a missing job fails.
    assert_contract_error(
        contract
            .call_function("approve_job", json!({ "job_id": "missing" }))
            .transaction()
            .with_signer(owner.account_id().clone(), signer.clone())
            .send_to(&sandbox_network)
            .await,
        "Job not found",
    );

    // Executing a missing job fails.
    assert_contract_error(
        execute_job(
            &contract,
            owner.account_id().clone(),
            signer.clone(),
            &sandbox_network,
            "missing",
        )
        .await,
        "Job not found",
    );

    // A non-owner cannot execute the job.
    assert_contract_error(
        execute_job(
            &contract,
            alice.account_id().clone(),
            signer.clone(),
            &sandbox_network,
            JOB_ID,
        )
        .await,
        "Only the owner can call this method",
    );

    // The transfer callback cannot be called from outside the contract.
    assert_contract_error(
        contract
            .call_function(
                "on_transfer_complete",
                json!({ "job_id": JOB_ID, "attempt_id": 1 }),
            )
            .transaction()
            .gas(NearGas::from_tgas(100))
            .with_signer(owner.account_id().clone(), signer.clone())
            .send_to(&sandbox_network)
            .await,
        "Method on_transfer_complete is private",
    );

    let balance_before = balance_of(alice.account_id(), &sandbox_network).await?;

    // Give the owner a second sandbox-only access key so both concurrent requests can get a
    // distinct nonce and reach contract execution.
    let second_key = near_api::signer::generate_secret_key()?;
    near_api::Account(owner.account_id().clone())
        .add_key(
            near_api::types::AccessKeyPermission::FullAccess,
            second_key.public_key(),
        )
        .with_signer(signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();
    let second_signer = near_api::Signer::from_secret_key(second_key)?;

    // Two concurrent execute requests must both reach the contract; exactly one may succeed.
    let first = execute_job(
        &contract,
        owner.account_id().clone(),
        signer.clone(),
        &sandbox_network,
        JOB_ID,
    );
    let second = execute_job(
        &contract,
        owner.account_id().clone(),
        second_signer,
        &sandbox_network,
        JOB_ID,
    );
    let (first, second) = tokio::join!(first, second);

    let mut successes = 0;
    let mut contract_failure = None;
    for result in [first, second] {
        let transaction =
            result.expect("both execute_job transactions must be accepted by the network");
        if transaction.is_success() {
            successes += 1;
        } else {
            assert!(
                contract_failure.is_none(),
                "expected exactly one failed execute_job"
            );
            contract_failure = Some(transaction.assert_failure().to_string());
        }
    }

    assert_eq!(
        successes, 1,
        "exactly one concurrent execute_job must succeed"
    );
    let contract_failure = contract_failure.expect("one execute_job must fail at the contract");
    assert!(
        contract_failure.contains("Job payment is already pending")
            || contract_failure.contains("Job has already been paid"),
        "expected a pending/paid contract error, got: {contract_failure}"
    );

    let paid = wait_until_state(&contract, &sandbox_network, JOB_ID, JobState::Paid).await?;
    assert_eq!(paid.state, JobState::Paid);

    // The recipient received the amount exactly once, even though the job was executed twice.
    let balance_after = balance_of(alice.account_id(), &sandbox_network).await?;
    let expected_amount: u128 = JOB_AMOUNT.parse().unwrap();
    assert_eq!(
        balance_after - balance_before,
        expected_amount,
        "recipient balance must increase by exactly the job amount"
    );

    // A paid job cannot be executed again.
    assert_contract_error(
        execute_job(
            &contract,
            owner.account_id().clone(),
            signer.clone(),
            &sandbox_network,
            JOB_ID,
        )
        .await,
        "Job has already been paid",
    );

    let balance_after_duplicate = balance_of(alice.account_id(), &sandbox_network).await?;
    assert_eq!(
        balance_after_duplicate, balance_after,
        "a duplicate execute must not transfer again"
    );

    // A job whose first transfer targets a nonexistent account. The transfer receipt fails and
    // the callback must return the job to Approved without releasing any payment.
    contract
        .call_function(
            "create_job",
            json!({
                "job_id": RETRY_JOB_ID,
                "recipient": MISSING_RECIPIENT,
                "amount": RETRY_JOB_AMOUNT,
            }),
        )
        .transaction()
        .with_signer(owner.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();
    contract
        .call_function("approve_job", json!({ "job_id": RETRY_JOB_ID }))
        .transaction()
        .with_signer(owner.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();

    let retry_amount: u128 = RETRY_JOB_AMOUNT.parse().unwrap();
    let contract_balance_before = balance_of(contract.account_id(), &sandbox_network).await?;

    let failed_execution = execute_job(
        &contract,
        owner.account_id().clone(),
        signer.clone(),
        &sandbox_network,
        RETRY_JOB_ID,
    )
    .await?
    .into_full()
    .expect("execute_job should return a final execution result");

    let missing_recipient: AccountId = MISSING_RECIPIENT.parse().unwrap();
    let failed_transfer = failed_execution
        .receipt_failures()
        .into_iter()
        .find(|outcome| outcome.executor_id == missing_recipient)
        .expect("the transfer receipt to the missing recipient should fail");
    let transfer_error = format!(
        "{:?}",
        (*failed_transfer).clone().into_result().unwrap_err()
    );
    assert!(
        transfer_error.contains("AccountDoesNotExist"),
        "expected the transfer to fail with AccountDoesNotExist, got: {transfer_error}"
    );

    let approved_after_failure = wait_until_state(
        &contract,
        &sandbox_network,
        RETRY_JOB_ID,
        JobState::Approved,
    )
    .await?;
    assert_eq!(approved_after_failure.state, JobState::Approved);

    // Create the exact recipient, then wait for the failed transfer's refund to settle before
    // retrying. No state is reset and no callback result is fabricated.
    let recipient = create_subaccount(&sandbox, MISSING_RECIPIENT).await?;
    let recipient_balance_before = balance_of(recipient.account_id(), &sandbox_network).await?;
    let refund_floor = contract_balance_before.saturating_sub(retry_amount / 2);
    wait_until_balance_at_least(contract.account_id(), refund_floor, &sandbox_network).await?;

    execute_job(
        &contract,
        owner.account_id().clone(),
        signer.clone(),
        &sandbox_network,
        RETRY_JOB_ID,
    )
    .await?
    .assert_success();

    let paid = wait_until_state(&contract, &sandbox_network, RETRY_JOB_ID, JobState::Paid).await?;
    assert_eq!(paid.state, JobState::Paid);

    let recipient_balance_after = balance_of(recipient.account_id(), &sandbox_network).await?;
    assert_eq!(
        recipient_balance_after - recipient_balance_before,
        retry_amount,
        "the retried payment must credit the recipient exactly once"
    );

    // A paid job cannot be executed again.
    assert_contract_error(
        execute_job(
            &contract,
            owner.account_id().clone(),
            signer.clone(),
            &sandbox_network,
            RETRY_JOB_ID,
        )
        .await,
        "Job has already been paid",
    );

    let recipient_balance_after_duplicate =
        balance_of(recipient.account_id(), &sandbox_network).await?;
    assert_eq!(
        recipient_balance_after_duplicate, recipient_balance_after,
        "a duplicate execute must not transfer again"
    );

    Ok(())
}

async fn create_subaccount(
    sandbox: &near_sandbox::Sandbox,
    name: &str,
) -> testresult::TestResult<near_api::Account> {
    let account_id: AccountId = name.parse().unwrap();
    sandbox
        .create_account(account_id.clone())
        .initial_balance(NearToken::from_near(10))
        .send()
        .await?;
    Ok(near_api::Account(account_id))
}

#[tokio::test]
async fn test_contract_is_operational() -> testresult::TestResult<()> {
    // `BuildOpts` defaults to `--locked`; ABI generation is disabled explicitly.
    let build_opts = BuildOpts::builder().no_abi(true).build();
    let contract_wasm_path = cargo_near_build::build_with_cli(build_opts)?;
    let contract_wasm = std::fs::read(contract_wasm_path)?;

    test_registry_on(contract_wasm).await
}

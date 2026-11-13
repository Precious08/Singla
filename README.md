# Singla

**Pay the right person, the right amount, exactly once.**

Singla is a payment-approval app on NEAR testnet. An owner registers a payment
(recipient + amount), approves it, and executes it — and the smart contract
guarantees the payment can never be paid twice, even under retries,
double-clicks, or concurrent calls.

**Live app: https://trysingla.vercel.app** — try it first in your browser
with pretend money, no wallet needed, or connect a NEAR testnet wallet
(Meteor, MyNearWallet, HOT, Ledger, WalletConnect) to use the live contract
deployed at `payonce-precious08.testnet`.

## Why

Double payments are a quiet, expensive bug in any system that pays people:
a retried request, a refreshed page, a second operator — and the money is gone.
Singla moves the guarantee on-chain. The contract is the single source of
truth for whether a payment was paid, and it is physically incapable of
paying the same payment twice.

## How it works

1. **Create payment** — the owner registers a payment: a unique ID, a
   recipient account, and an amount in NEAR.
2. **Approve** — approval is idempotent: approving an already-approved
   payment is a safe no-op, not an error.
3. **Execute** — before sending anything, the contract records a
   payment-pending state, reserves the amount, and stamps the attempt with a
   unique ID. The transfer and its callback then settle the payment as **Paid**
   (final) or return it for a safe retry if the transfer failed.

Payment states: `AwaitingApproval → Approved → PaymentPending → Paid`.

Only the contract owner can create, approve, or execute payments. The
contract pays from its own balance and always keeps a safety reserve, so a
payment can never drain the account below operating needs.

## Live deployment (NEAR testnet)

- Contract: `payonce-precious08.testnet`
- Owner: `payonce-precious08.testnet`
- Explorer: https://explorer.testnet.near.org/accounts/payonce-precious08.testnet

## The app

The web app opens on a front door with two ways in:

- **Try it first** (no wallet): the whole product runs in your browser with
  pretend money. Create a payment, approve it, execute it, then try to pay
  it again and watch the second attempt get refused. Nothing touches the
  blockchain.
- **Connect a wallet**: the app reads real payments from the deployed
  contract and sends real testnet transactions for create / approve /
  execute. Because the contract looks payments up by ID (there is no
  on-chain list), the app tracks the payment IDs you create in your browser
  and fetches each one from the chain.

### Run it

```bash
cd web
npm install
npm run dev
```

Then open the local URL Vite prints (default `http://localhost:5173`).

### Checks

```bash
cd web
npm run test        # frontend tests
npm run typecheck
npm run build
```

## The contract

Rust, built with cargo-near. Public surface:

| Method | Type | Notes |
| --- | --- | --- |
| `init(owner_id)` | init | One-time; sets the owner |
| `create_job(job_id, recipient, amount)` | change | Owner only; job ID ≤ 64 UTF-8 bytes |
| `approve_job(job_id)` | change | Owner only; idempotent |
| `execute_job(job_id)` | change | Owner only; reserves funds, then transfers |
| `get_job(job_id)` | view | Returns the job or null |
| `get_owner()` | view | Returns the owner account |

### Checks

```bash
cargo test            # 42 unit tests
cargo near build      # release Wasm
```

The integration suite in `tests/` deploys the contract to a local NEAR
sandbox and walks the full lifecycle, including two-key concurrent
execution and a failed-transfer retry:

```bash
cargo test --test test_basics
```

## Tech

- Contract: Rust, near-sdk, cargo-near
- Frontend: React 19, TypeScript, Vite, NEAR Wallet Selector (Meteor, MyNearWallet, HOT, Ledger, WalletConnect)
- Network: NEAR testnet

## Status

Built for the NEAR Hackathon: Build Beyond Boundaries. The contract is
deployed and verified on testnet; the frontend runs the full lifecycle
against it.

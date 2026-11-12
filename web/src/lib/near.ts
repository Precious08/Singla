import type { WalletSelector } from '@near-wallet-selector/core';
import { JOB_STATES, type DemoJob, type Job, type JobState } from '../types';

// Node globals (Buffer, process, global) for the wallet SDK's dependency
// chain are provided by vite-plugin-node-polyfills — see vite.config.ts.

export const CONTRACT_ID = 'payonce-precious08.testnet';
export const RPC_URL = 'https://rpc.testnet.near.org';

const REGISTRY_KEY = 'payonce:tracked-job-ids';

export const GAS = {
  create: '30000000000000',
  approve: '30000000000000',
  execute: '100000000000000',
} as const;

/** Job IDs this browser tracks on the live contract (the contract has no list view). */
export function loadTrackedJobIds(): string[] {
  try {
    const raw = window.localStorage.getItem(REGISTRY_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((value): value is string => typeof value === 'string');
  } catch {
    return [];
  }
}

export function saveTrackedJobIds(ids: string[]): void {
  try {
    window.localStorage.setItem(REGISTRY_KEY, JSON.stringify(ids));
  } catch {
    // Storage can be unavailable (private mode); tracking is best-effort.
  }
}

export function trackJobId(id: string): string[] {
  const ids = loadTrackedJobIds();
  if (ids.includes(id)) {
    return ids;
  }
  const next = [id, ...ids];
  saveTrackedJobIds(next);
  return next;
}

/** Validate and map a raw contract job (JSON shape) into the app's job model. */
export function chainJobToDemoJob(raw: unknown): DemoJob | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Partial<Job>;
  if (
    typeof candidate.job_id !== 'string' ||
    typeof candidate.recipient !== 'string' ||
    typeof candidate.amount !== 'string' ||
    typeof candidate.state !== 'string' ||
    !(JOB_STATES as readonly string[]).includes(candidate.state)
  ) {
    return null;
  }
  return {
    job_id: candidate.job_id,
    recipient: candidate.recipient,
    amount: candidate.amount,
    state: candidate.state as JobState,
    source: 'chain',
  };
}

function argsToBase64(args: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function decodeResultBytes(bytes: number[]): unknown {
  const text = new TextDecoder().decode(new Uint8Array(bytes));
  return JSON.parse(text) as unknown;
}

/** Read-only contract call over the public testnet RPC. */
export async function viewCall(
  methodName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'payonce',
      method: 'query',
      params: {
        request_type: 'call_function',
        account_id: CONTRACT_ID,
        method_name: methodName,
        args_base64: argsToBase64(args),
        finality: 'final',
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`RPC request failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    result?: { result?: number[]; error?: string };
    error?: { message?: string };
  };
  if (payload.error) {
    throw new Error(payload.error.message ?? 'RPC error');
  }
  if (!payload.result || !Array.isArray(payload.result.result)) {
    throw new Error(payload.result?.error ?? 'Unexpected RPC response');
  }
  return decodeResultBytes(payload.result.result);
}

export async function fetchContractJob(jobId: string): Promise<DemoJob | null> {
  const raw = await viewCall('get_job', { job_id: jobId });
  return chainJobToDemoJob(raw);
}

export async function fetchContractOwner(): Promise<string | null> {
  const raw = await viewCall('get_owner', {});
  return typeof raw === 'string' ? raw : null;
}

export async function fetchTrackedJobs(ids: string[]): Promise<DemoJob[]> {
  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        return await fetchContractJob(id);
      } catch {
        return null;
      }
    }),
  );
  return results.filter((job): job is DemoJob => job !== null);
}

let selectorPromise: Promise<WalletSelector | null> | null = null;

/** Lazily set up the wallet selector (testnet, Meteor Wallet). Null if unavailable. */
export function initWalletSelector(): Promise<WalletSelector | null> {
  if (!selectorPromise) {
    selectorPromise = (async () => {
      try {
        const [{ setupWalletSelector }, { setupMeteorWallet }] =
          await Promise.all([
            import('@near-wallet-selector/core'),
            import('@near-wallet-selector/meteor-wallet'),
          ]);
        return await setupWalletSelector({
          network: 'testnet',
          modules: [setupMeteorWallet()],
        });
      } catch (error) {
        console.warn('Wallet selector failed to start', error);
        return null;
      }
    })();
  }
  return selectorPromise;
}

export async function openWalletModal(
  selector: WalletSelector,
): Promise<void> {
  const { setupModal } = await import('@near-wallet-selector/modal-ui');
  // Deliberately no contractId: connecting must not grant the wallet a
  // silent-signing function-call key. Every transaction then asks the
  // owner to confirm it in the wallet.
  const modal = setupModal(selector, {});
  modal.show();
}

/** Send a change call through the connected wallet. Redirect wallets navigate away. */
export async function callContractMethod(
  selector: WalletSelector,
  methodName: string,
  args: Record<string, unknown>,
  gas: string,
): Promise<void> {
  const { internalActionToNaj } = await import('@near-wallet-selector/core');
  const wallet = await selector.wallet();
  await wallet.signAndSendTransaction({
    receiverId: CONTRACT_ID,
    actions: [
      internalActionToNaj({
        type: 'FunctionCall',
        params: {
          methodName,
          args,
          gas,
          deposit: '0',
        },
      }),
    ],
  });
}

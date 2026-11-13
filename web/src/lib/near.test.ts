import type { WalletSelector } from '@near-wallet-selector/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callContractMethod,
  chainJobToDemoJob,
  CONTRACT_ID,
  fetchJobIdsByCreator,
  GAS,
  loadTrackedJobIds,
  saveTrackedJobIds,
  trackJobId,
} from './near';

// Keep the real module for types, but make action conversion a pass-through
// so tests can see exactly what callContractMethod hands to the wallet.
vi.mock('@near-wallet-selector/core', () => ({
  internalActionToNaj: (action: unknown) => action,
}));

describe('chainJobToDemoJob', () => {
  it('maps a valid contract job', () => {
    expect(
      chainJobToDemoJob({
        job_id: 'job-1',
        recipient: 'someone.testnet',
        amount: '12500000000000000000000000',
        state: 'Approved',
      }),
    ).toEqual({
      job_id: 'job-1',
      recipient: 'someone.testnet',
      amount: '12500000000000000000000000',
      state: 'Approved',
      source: 'chain',
    });
  });

  it('rejects unknown states and malformed values', () => {
    expect(chainJobToDemoJob(null)).toBeNull();
    expect(chainJobToDemoJob('job')).toBeNull();
    expect(
      chainJobToDemoJob({
        job_id: 'job-1',
        recipient: 'someone.testnet',
        amount: '1',
        state: 'Deleted',
      }),
    ).toBeNull();
    expect(
      chainJobToDemoJob({ job_id: 'job-1', recipient: 'someone.testnet', amount: 5, state: 'Paid' }),
    ).toBeNull();
  });
});

describe('tracked job ID registry', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts empty and round-trips saved IDs', () => {
    expect(loadTrackedJobIds()).toEqual([]);
    saveTrackedJobIds(['a', 'b']);
    expect(loadTrackedJobIds()).toEqual(['a', 'b']);
  });

  it('tracks new IDs newest-first without duplicates', () => {
    expect(trackJobId('first')).toEqual(['first']);
    expect(trackJobId('second')).toEqual(['second', 'first']);
    expect(trackJobId('first')).toEqual(['second', 'first']);
  });

  it('survives corrupt stored values', () => {
    window.localStorage.setItem('payonce:tracked-job-ids', '{broken');
    expect(loadTrackedJobIds()).toEqual([]);
    window.localStorage.setItem('payonce:tracked-job-ids', '{"not":"an array"}');
    expect(loadTrackedJobIds()).toEqual([]);
  });
});

describe('fetchJobIdsByCreator', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubRpcResult(value: unknown) {
    const bytes = Array.from(
      new TextEncoder().encode(JSON.stringify(value)),
    );
    const fetchMock = vi.fn(
      async (_url: string, _init?: { body: string }) => ({
        ok: true,
        json: async () => ({ result: { result: bytes } }),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('returns the IDs the contract recorded for the account', async () => {
    const fetchMock = stubRpcResult(['job-1', 'job-2']);

    await expect(fetchJobIdsByCreator('alice.testnet')).resolves.toEqual([
      'job-1',
      'job-2',
    ]);

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body ?? '{}') as {
      params: { method_name: string; args_base64: string };
    };
    expect(body.params.method_name).toBe('get_job_ids_by_creator');
    expect(
      JSON.parse(
        Buffer.from(body.params.args_base64, 'base64').toString('utf-8'),
      ),
    ).toEqual({ account_id: 'alice.testnet' });
  });

  it('returns an empty list for a malformed response', async () => {
    stubRpcResult({ nope: true });

    await expect(fetchJobIdsByCreator('alice.testnet')).resolves.toEqual([]);
  });
});

describe('callContractMethod', () => {
  function fakeSelector() {
    const signAndSendTransaction = vi.fn(
      async (_request: unknown) => {},
    );
    const selector = {
      wallet: async () => ({ signAndSendTransaction }),
    } as unknown as WalletSelector;
    return { selector, signAndSendTransaction };
  }

  it('attaches the deposit it is given to the function call', async () => {
    const { selector, signAndSendTransaction } = fakeSelector();

    await callContractMethod(
      selector,
      'execute_job',
      { job_id: 'job-1' },
      GAS.execute,
      '12500000000000000000000000',
    );

    expect(signAndSendTransaction).toHaveBeenCalledTimes(1);
    const request = signAndSendTransaction.mock.calls[0][0] as unknown as {
      receiverId: string;
      actions: unknown[];
    };
    expect(request.receiverId).toBe(CONTRACT_ID);
    expect(request.actions).toEqual([
      {
        type: 'FunctionCall',
        params: {
          methodName: 'execute_job',
          args: { job_id: 'job-1' },
          gas: GAS.execute,
          deposit: '12500000000000000000000000',
        },
      },
    ]);
  });

  it('defaults the deposit to zero', async () => {
    const { selector, signAndSendTransaction } = fakeSelector();

    await callContractMethod(
      selector,
      'approve_job',
      { job_id: 'job-1' },
      GAS.approve,
    );

    const request = signAndSendTransaction.mock.calls[0][0] as unknown as {
      actions: { params: { deposit: string } }[];
    };
    expect(request.actions[0].params.deposit).toBe('0');
  });
});

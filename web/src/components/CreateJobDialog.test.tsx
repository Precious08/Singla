import {
  act,
  cleanup,
  fireEvent,
  render,
  type RenderResult,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateJobDialog } from './CreateJobDialog';

const EXISTS_BODY = {
  jsonrpc: '2.0',
  id: 'singla-recipient-check',
  result: {
    amount: '1000000000000000000000000',
    block_hash: 'hash',
    block_height: 1,
    code_hash: 'codehash',
    storage_usage: 0,
  },
};

const UNKNOWN_ACCOUNT_BODY = {
  jsonrpc: '2.0',
  id: 'singla-recipient-check',
  error: {
    code: -32000,
    message: 'account does not exist',
    cause: { name: 'UNKNOWN_ACCOUNT', info: {} },
  },
};

function rpcResponse(body: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function renderDialog(
  mode: 'live' | 'try',
  onCreate = vi.fn(),
): RenderResult & { onCreate: typeof onCreate } {
  const rendered = render(
    <CreateJobDialog
      isOpen
      onClose={() => {}}
      existingIds={new Set<string>()}
      onCreate={onCreate}
      mode={mode}
    />,
  );
  return { ...rendered, onCreate };
}

function fillForm(
  app: RenderResult,
  id: string,
  recipient: string,
  amount: string,
) {
  fireEvent.change(app.getByLabelText(/payment id/i), {
    target: { value: id },
  });
  fireEvent.change(app.getByLabelText(/recipient account/i), {
    target: { value: recipient },
  });
  fireEvent.change(app.getByLabelText(/amount \(near\)/i), {
    target: { value: amount },
  });
}

function recipientInput(app: RenderResult): HTMLInputElement {
  return app.getByLabelText(/recipient account/i) as HTMLInputElement;
}

describe('CreateJobDialog recipient field', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('shows the ".testnet" ending inside the box and the approved hint', () => {
    const app = renderDialog('try');

    expect(app.getByText('.testnet')).toBeTruthy();
    expect(
      app.getByText('Type the name. The ending is already there.'),
    ).toBeTruthy();
    expect(recipientInput(app).placeholder).toBe('sofia.kitchen');
  });

  it('creates with the full assembled ID when only the name was typed', () => {
    const app = renderDialog('try');
    fillForm(app, 'job-1', 'alice', '0.5');

    fireEvent.click(app.getByRole('button', { name: /create payment/i }));

    expect(app.onCreate).toHaveBeenCalledWith({
      jobId: 'job-1',
      recipient: 'alice.testnet',
      amount: '500000000000000000000000',
    });
  });

  it('arranges a pasted full address so the ending never doubles', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const app = renderDialog('try');
    fillForm(app, 'job-1', '  Sofia.Kitchen.TESTNET  ', '0.5');

    expect(recipientInput(app).value).toBe('sofia.kitchen');

    fireEvent.click(app.getByRole('button', { name: /create payment/i }));

    expect(app.onCreate).toHaveBeenCalledWith({
      jobId: 'job-1',
      recipient: 'sofia.kitchen.testnet',
      amount: '500000000000000000000000',
    });
    // Demo mode never asks the chain anything.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('live mode: a name that matches nobody turns the field red, floats the warning, and blocks creation', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(rpcResponse(UNKNOWN_ACCOUNT_BODY));
    vi.stubGlobal('fetch', fetchMock);
    const app = renderDialog('live');
    fillForm(app, 'job-1', 'ghost', '0.5');

    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body)).params.account_id).toBe(
      'ghost.testnet',
    );
    expect(app.getByText('This account does not exist.')).toBeTruthy();
    const input = recipientInput(app);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(
      input.closest('.recipient-field')?.classList.contains('is-invalid'),
    ).toBe(true);

    fireEvent.click(app.getByRole('button', { name: /create payment/i }));

    expect(app.onCreate).not.toHaveBeenCalled();
    expect(app.getByText('This account does not exist.')).toBeTruthy();
  });

  it('live mode: submitting before the check lands still blocks a missing account', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(rpcResponse(UNKNOWN_ACCOUNT_BODY));
    vi.stubGlobal('fetch', fetchMock);
    const app = renderDialog('live');
    fillForm(app, 'job-1', 'ghost', '0.5');

    fireEvent.click(app.getByRole('button', { name: /create payment/i }));
    await act(async () => {});

    expect(app.onCreate).not.toHaveBeenCalled();
    expect(app.getByText('This account does not exist.')).toBeTruthy();
    expect(recipientInput(app).getAttribute('aria-invalid')).toBe('true');
  });

  it('live mode: an account that exists creates normally', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(rpcResponse(EXISTS_BODY));
    vi.stubGlobal('fetch', fetchMock);
    const app = renderDialog('live');
    fillForm(app, 'job-1', 'alice', '0.5');

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(app.queryByText('This account does not exist.')).toBeNull();
    expect(recipientInput(app).getAttribute('aria-invalid')).toBe('false');

    fireEvent.click(app.getByRole('button', { name: /create payment/i }));
    await act(async () => {});

    expect(app.onCreate).toHaveBeenCalledWith({
      jobId: 'job-1',
      recipient: 'alice.testnet',
      amount: '500000000000000000000000',
    });
  });

  it('live mode: a failed lookup never blocks creation', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const app = renderDialog('live');
    fillForm(app, 'job-1', 'alice', '0.5');

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(app.queryByText('This account does not exist.')).toBeNull();

    fireEvent.click(app.getByRole('button', { name: /create payment/i }));
    await act(async () => {});

    expect(app.onCreate).toHaveBeenCalledWith({
      jobId: 'job-1',
      recipient: 'alice.testnet',
      amount: '500000000000000000000000',
    });
  });

  it('live mode: a malformed name is never sent to the chain', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(rpcResponse(EXISTS_BODY));
    vi.stubGlobal('fetch', fetchMock);
    const app = renderDialog('live');
    fillForm(app, 'job-1', 'bad name', '0.5');

    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

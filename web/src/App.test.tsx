import { act, fireEvent, render, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

type Scope = ReturnType<typeof within>;

// Every render stays mounted in this suite, so each test scopes its
// queries to its own render's container.
function renderApp(): Scope {
  const { container } = render(<App />);
  return within(container);
}

function enterTryMode(app: Scope) {
  fireEvent.click(app.getByRole('button', { name: /launch app/i }));
  fireEvent.click(app.getByRole('button', { name: /try it first/i }));
}

function createPayment(
  app: Scope,
  id: string,
  recipient: string,
  amount: string,
) {
  fireEvent.click(app.getByRole('button', { name: /new payment/i }));
  fireEvent.change(app.getByLabelText(/payment id/i), {
    target: { value: id },
  });
  fireEvent.change(app.getByLabelText(/recipient account/i), {
    target: { value: recipient },
  });
  fireEvent.change(app.getByLabelText(/amount \(near\)/i), {
    target: { value: amount },
  });
  fireEvent.click(app.getByRole('button', { name: /create payment/i }));
}

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('opens on the front door with the Singla pair and one door in', () => {
    const app = renderApp();

    expect(app.getByText('singla')).toBeTruthy();
    expect(app.getByText(/pay the right person/i)).toBeTruthy();
    expect(app.getByRole('button', { name: /launch app/i })).toBeTruthy();
    // The dashboard is not visible until the visitor goes in.
    expect(app.queryByRole('button', { name: /new payment/i })).toBeNull();
  });

  it('starts in dark mode and the toggle switches to light mode', () => {
    const app = renderApp();

    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.click(app.getByRole('button', { name: /switch to light mode/i }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('Launch app opens the choice between connecting and trying first', () => {
    const app = renderApp();

    fireEvent.click(app.getByRole('button', { name: /launch app/i }));

    expect(app.getByRole('button', { name: /connect wallet/i })).toBeTruthy();
    expect(app.getByRole('button', { name: /try it first/i })).toBeTruthy();
    expect(app.getByText(/you can switch any time/i)).toBeTruthy();
  });

  it('the choice offers Try it first before Connect wallet', () => {
    const app = renderApp();

    fireEvent.click(app.getByRole('button', { name: /launch app/i }));

    const tryFirst = app.getByRole('button', { name: /try it first/i });
    const connect = app.getByRole('button', { name: /connect wallet/i });
    // DOCUMENT_POSITION_FOLLOWING: Connect wallet comes after Try it first.
    expect(
      tryFirst.compareDocumentPosition(connect) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('going home from the demo, Launch returns straight to the demo desk', () => {
    const app = renderApp();
    enterTryMode(app);
    expect(app.getByText(/you are trying singla with pretend money/i)).toBeTruthy();

    // The logo takes the demo user home to the front door.
    fireEvent.click(
      app.getByRole('button', { name: /back to the front door/i }),
    );
    expect(app.getByRole('button', { name: /launch app/i })).toBeTruthy();

    // Launch resumes the try session: no choice window this time.
    fireEvent.click(app.getByRole('button', { name: /launch app/i }));

    expect(app.queryByRole('dialog', { name: /launch singla/i })).toBeNull();
    expect(app.queryByText(/you can switch any time/i)).toBeNull();
    expect(app.getByText(/you are trying singla with pretend money/i)).toBeTruthy();
    expect(app.getByRole('button', { name: /new payment/i })).toBeTruthy();
  });

  it('try mode starts empty, with the strip and no track form', () => {
    const app = renderApp();
    enterTryMode(app);

    expect(
      app.getByText(/you are trying singla with pretend money/i),
    ).toBeTruthy();
    expect(app.getByText('No payments yet.')).toBeTruthy();
    expect(
      app.getByText(/when you create a payment, it will appear here/i),
    ).toBeTruthy();
    expect(app.queryByText(/track a job/i)).toBeNull();
    expect(app.queryByText(/track a payment/i)).toBeNull();
    expect(app.getByRole('button', { name: /new payment/i })).toBeTruthy();
  });

  it('creates a payment in try mode and shows its details awaiting approval', () => {
    const app = renderApp();
    enterTryMode(app);
    createPayment(app, 'invoice-118', 'sofia.kitchen.testnet', '12.5');

    expect(app.getAllByText('invoice-118').length).toBeGreaterThan(0);
    expect(app.getByText('Payment details')).toBeTruthy();
    expect(app.getByRole('button', { name: /approve payment/i })).toBeTruthy();
  });

  it('floats the created message as a toast, not a page banner', () => {
    const app = renderApp();
    enterTryMode(app);
    createPayment(app, 'invoice-118', 'sofia.kitchen.testnet', '12.5');

    expect(app.getByText('Payment "invoice-118" created.')).toBeTruthy();
    // The old in-page banner is gone: no .notice element exists anywhere.
    expect(document.body.querySelector('.notice')).toBeNull();
  });

  it('runs the full try loop: approve, execute, paid, second try refused', async () => {
    vi.useFakeTimers();
    try {
      const app = renderApp();
      enterTryMode(app);
      createPayment(app, 'invoice-118', 'sofia.kitchen.testnet', '12.5');

      fireEvent.click(app.getByRole('button', { name: /approve payment/i }));
      // The approval step settles into a quiet pill; execute lights up.
      expect(app.queryByRole('button', { name: /approve payment/i })).toBeNull();
      fireEvent.click(app.getByRole('button', { name: /execute payment/i }));

      await act(async () => {
        vi.advanceTimersByTime(2100);
      });

      expect(app.getAllByText('Paid').length).toBeGreaterThan(0);
      fireEvent.click(app.getByRole('button', { name: /pay it again/i }));
      expect(app.getByText(/refused/i)).toBeTruthy();
      expect(
        app.getByText('Already paid. Singla never pays twice.'),
      ).toBeTruthy();
      // After the full loop the strip flips to its end state.
      expect(app.getByText(/that is the whole product/i)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('start over clears the try payments back to the empty state', () => {
    const app = renderApp();
    enterTryMode(app);
    createPayment(app, 'invoice-118', 'sofia.kitchen.testnet', '12.5');
    expect(app.queryByText('No payments yet.')).toBeNull();

    fireEvent.click(app.getByRole('button', { name: /start over/i }));

    expect(app.getByText('No payments yet.')).toBeTruthy();
    expect(app.queryByText('invoice-118')).toBeNull();
  });

  it('closes the new payment dialog on Escape', () => {
    const app = renderApp();
    enterTryMode(app);

    fireEvent.click(app.getByRole('button', { name: /new payment/i }));
    expect(app.getByRole('dialog', { name: /new payment/i })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(app.queryByRole('dialog', { name: /new payment/i })).toBeNull();
  });
});

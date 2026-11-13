import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast, TOAST_DURATION_MS } from './Toast';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // This harness does not auto-cleanup renders between tests.
    cleanup();
    vi.useRealTimers();
  });

  it('shows its message', () => {
    const app = render(<Toast message="Address copied." onDismiss={() => {}} />);

    expect(app.getByText('Address copied.')).toBeTruthy();
  });

  it('dismisses when the toast itself is tapped', () => {
    const onDismiss = vi.fn();
    const app = render(<Toast message="Address copied." onDismiss={onDismiss} />);

    fireEvent.click(app.getByRole('status'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses from its close button', () => {
    const onDismiss = vi.fn();
    const app = render(<Toast message="Address copied." onDismiss={onDismiss} />);

    fireEvent.click(app.getByRole('button', { name: /dismiss/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows no dot in its default plain tone', () => {
    const app = render(<Toast message="Address copied." onDismiss={() => {}} />);

    expect(app.container.querySelector('.toast__dot')).toBeNull();
  });

  it('leads with an amber dot in warning tone', () => {
    const app = render(
      <Toast
        message="This account does not exist."
        tone="warning"
        onDismiss={() => {}}
      />,
    );

    expect(app.getByText('This account does not exist.')).toBeTruthy();
    expect(app.container.querySelector('.toast__dot')).not.toBeNull();
  });

  it('dismisses itself after a few seconds', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Address copied." onDismiss={onDismiss} />);

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

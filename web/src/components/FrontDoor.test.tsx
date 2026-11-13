import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrontDoor } from './FrontDoor';

type Scope = ReturnType<typeof within>;

function renderDoor(props: {
  resume?: 'live' | 'try' | null;
  onConnect?: () => void;
  onTry?: () => void;
}): Scope {
  const { container } = render(
    <FrontDoor
      theme="dark"
      onToggleTheme={() => {}}
      onConnect={props.onConnect ?? (() => {})}
      onTry={props.onTry ?? (() => {})}
      resume={props.resume}
    />,
  );
  return within(container);
}

describe('FrontDoor launch', () => {
  afterEach(() => {
    // This harness does not auto-cleanup renders between tests.
    cleanup();
  });

  it('a fresh Launch opens the choice, Try it first above Connect wallet', () => {
    const door = renderDoor({});

    fireEvent.click(door.getByRole('button', { name: /launch app/i }));

    const dialog = door.getByRole('dialog', { name: /launch singla/i });
    const rows = within(dialog)
      .getAllByRole('button')
      .filter((button) => (button.className ?? '').includes('choice__row'));
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Try it first');
    expect(rows[0].textContent).toContain('No wallet');
    expect(rows[1].textContent).toContain('Connect wallet');
    expect(door.getByText(/you can switch any time/i)).toBeTruthy();
  });

  it('Launch with an active wallet session goes straight in, no choice', () => {
    const onConnect = vi.fn();
    const door = renderDoor({ resume: 'live', onConnect });

    fireEvent.click(door.getByRole('button', { name: /launch app/i }));

    // The door hands straight to the connect path (which, for a signed-in
    // wallet, enters the live desk) and the choice never opens.
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(door.queryByRole('dialog', { name: /launch singla/i })).toBeNull();
    expect(door.queryByText(/you can switch any time/i)).toBeNull();
  });

  it('Launch with a try session in progress returns to the demo, no choice', () => {
    const onTry = vi.fn();
    const door = renderDoor({ resume: 'try', onTry });

    fireEvent.click(door.getByRole('button', { name: /launch app/i }));

    expect(onTry).toHaveBeenCalledTimes(1);
    expect(door.queryByRole('dialog', { name: /launch singla/i })).toBeNull();
  });

  it('the choice rows still call their own handlers', () => {
    const onConnect = vi.fn();
    const onTry = vi.fn();
    const door = renderDoor({ onConnect, onTry });

    fireEvent.click(door.getByRole('button', { name: /launch app/i }));
    fireEvent.click(door.getByRole('button', { name: /try it first/i }));
    expect(onTry).toHaveBeenCalledTimes(1);
    expect(onConnect).not.toHaveBeenCalled();

    fireEvent.click(door.getByRole('button', { name: /launch app/i }));
    fireEvent.click(door.getByRole('button', { name: /connect wallet/i }));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });
});

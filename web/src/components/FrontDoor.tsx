import { useEffect, useState } from 'react';
import { Brand } from './Brand';
import { ThemeToggle } from './ThemeToggle';

interface FrontDoorProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onConnect: () => void;
  onTry: () => void;
}

const SLIPS = [
  {
    title: 'Catering lunch, 40 people',
    to: 'sofia.kitchen.testnet',
    meta: 'Fri 14 Nov · Invoice No. 118',
    amount: '12.5',
  },
  {
    title: 'Roof repair, final payment',
    to: 'daniel.builds.testnet',
    meta: 'Sat 15 Nov · Job No. 09',
    amount: '28',
  },
  {
    title: 'Shop pay, month of October',
    to: 'emma.r.testnet',
    meta: 'Due 30 Nov · Monthly',
    amount: '8',
  },
] as const;

/**
 * The front door: one strong page, the rotating payment slip, and a single
 * door in. Launch opens the choice (connect a wallet, or try it first).
 * The slip tells the whole story on a 21-second loop, 7 seconds a card:
 * written, approved, paid, and a second try refused.
 */
export function FrontDoor({
  theme,
  onToggleTheme,
  onConnect,
  onTry,
}: FrontDoorProps) {
  const [choiceOpen, setChoiceOpen] = useState(false);

  useEffect(() => {
    if (!choiceOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setChoiceOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [choiceOpen]);

  return (
    <div className="door">
      <div className="door-bg" aria-hidden="true">
        <div className="door-glow door-glow--a" />
        <div className="door-glow door-glow--b" />
        <svg
          className="door-signal"
          viewBox="0 0 1200 180"
          preserveAspectRatio="none"
        >
          <path d="M-20,120 C140,60 260,150 420,100 S700,40 860,95 S1100,140 1220,80" />
          <path
            className="s2"
            d="M-20,90 C160,140 300,60 470,115 S740,150 900,70 S1120,60 1220,120"
          />
        </svg>
      </div>

      <header className="door-header">
        <Brand size={30} />
        <div className="door-header__right">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button
            type="button"
            className="door-launch"
            onClick={() => setChoiceOpen(true)}
          >
            Launch app
          </button>
        </div>
      </header>

      <main className="door-main">
        <section className="door-hero">
          <div>
            <p className="door-eyebrow rise" style={{ animationDelay: '30ms' }}>
              The approval desk
            </p>
            <h1 className="door-title rise" style={{ animationDelay: '90ms' }}>
              Pay the right person.
              <br />
              The right amount.
              <br />
              <em>Exactly once.</em>
            </h1>
          </div>

          <div className="door-stage rise" style={{ animationDelay: '240ms' }}>
            <article
              className="door-slip"
              aria-label="A payment slip moving through Singla"
            >
              <div className="door-slip__top">
                <span>Singla · Payment slip</span>
                <span>One payment only</span>
              </div>
              <div className="door-swap">
                {SLIPS.map((slip, index) => (
                  <div
                    key={slip.title}
                    className={`door-variant door-variant--${index + 1}`}
                  >
                    <p className="door-slip__title">{slip.title}</p>
                    <p className="door-slip__to">To: {slip.to}</p>
                    <div className="door-slip__meta">
                      <span className="door-slip__date">{slip.meta}</span>
                      <span className="door-slip__amount">
                        {slip.amount} <small>NEAR</small>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="door-track">
                <div className="door-step">
                  <div className="door-dot door-dot--1">1</div>
                  <span>Written</span>
                </div>
                <div className="door-bar door-bar--1">
                  <i />
                </div>
                <div className="door-step">
                  <div className="door-dot door-dot--2">2</div>
                  <span>Approved</span>
                </div>
                <div className="door-bar door-bar--2">
                  <i />
                </div>
                <div className="door-step">
                  <div className="door-dot door-dot--3">3</div>
                  <span>Paid</span>
                </div>
              </div>
              <div className="door-stamp">
                <span className="door-stamp__tick">✓</span>
                <div>
                  <b>Paid. Once.</b>
                  <small>Settled, and closed for good.</small>
                </div>
              </div>
              <div className="door-retry">
                <s>Same payment, tried again</s>
                <em>Refused</em>
              </div>
            </article>
          </div>
        </section>

        <ol className="door-liner">
          <li className="rise" style={{ animationDelay: '300ms' }}>
            <span>01 / Write</span>
            Write it down, who gets paid and how much. It sits there until you
            say so.
          </li>
          <li className="rise" style={{ animationDelay: '360ms' }}>
            <span>02 / Approve</span>
            Nothing moves without your yes.
          </li>
          <li className="rise" style={{ animationDelay: '420ms' }}>
            <span>03 / Once</span>
            It pays, and the slip is closed. A second try is refused.
          </li>
        </ol>
      </main>

      {choiceOpen && (
        <div
          className="choice-backdrop"
          onClick={() => setChoiceOpen(false)}
          role="presentation"
        >
          <div
            className="choice"
            role="dialog"
            aria-modal="true"
            aria-label="Launch Singla"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="choice__eyebrow">Launch Singla</p>
            <button
              type="button"
              className="choice__close"
              aria-label="Close"
              onClick={() => setChoiceOpen(false)}
            >
              ×
            </button>
            <button
              type="button"
              className="choice__row"
              onClick={() => {
                setChoiceOpen(false);
                onConnect();
              }}
            >
              <span className="choice__row-title">Connect wallet</span>
              <span className="choice__row-sub">
                The real Singla, on NEAR testnet.
              </span>
            </button>
            <button
              type="button"
              className="choice__row choice__row--try"
              onClick={() => {
                setChoiceOpen(false);
                onTry();
              }}
            >
              <span className="choice__row-head">
                <span className="choice__row-title">Try it first</span>
                <span className="choice__tag">No wallet</span>
              </span>
              <span className="choice__row-sub">
                Runs in your browser with pretend money.
              </span>
            </button>
            <p className="choice__foot">You can switch any time.</p>
          </div>
        </div>
      )}
    </div>
  );
}

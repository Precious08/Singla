import { useEffect, useRef, useState } from 'react';
import { Brand } from './Brand';
import { ThemeToggle } from './ThemeToggle';

interface FrontDoorProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onConnect: () => void;
  onTry: () => void;
  /** Where Launch goes without asking: an active wallet session resumes
   * live, a try session in progress resumes the demo. Null (or omitted)
   * means nobody is inside yet, so Launch opens the choice. */
  resume?: 'live' | 'try' | null;
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
  {
    title: 'School fees, first term',
    to: 'brightpath.school.testnet',
    meta: 'Tue 18 Nov · Invoice No. 204',
    amount: '45',
  },
  {
    title: 'Logo and brand work',
    to: 'emma.designs.testnet',
    meta: 'Wed 19 Nov · Invoice No. 31',
    amount: '15',
  },
  {
    title: 'Wedding hall deposit',
    to: 'palmview.hall.testnet',
    meta: 'Sat 22 Nov · Booking No. 12',
    amount: '120',
  },
  {
    title: 'Car service and parts',
    to: 'otto.garage.testnet',
    meta: 'Thu 20 Nov · Job No. 77',
    amount: '18',
  },
  {
    title: 'Freelance writing, twelve articles',
    to: 'lena.writes.testnet',
    meta: 'Mon 24 Nov · Invoice No. 56',
    amount: '24',
  },
  {
    title: 'New laptop for the studio',
    to: 'techdepot.store.testnet',
    meta: 'Tue 25 Nov · Order No. 19',
    amount: '210',
  },
  {
    title: 'Product photo shoot',
    to: 'marco.shoots.testnet',
    meta: 'Fri 28 Nov · Booking No. 05',
    amount: '36',
  },
] as const;

const SLIDE_MS = 900;
const HOLD_MS = 7000;

/**
 * The front door: one strong page, the rotating payment slip, and a single
 * door in. Launch opens the choice (try it first, or connect a wallet) —
 * unless a session is already active, in which case Launch walks straight
 * back in and the choice never opens. The slip changes by itself every
 * 7 seconds, and it is swappable: drag it with a finger or a mouse to
 * move back or forward yourself. Each card tells the whole story in its
 * 7 seconds: written, approved, paid, and a second try refused.
 */
export function FrontDoor({
  theme,
  onToggleTheme,
  onConnect,
  onTry,
  resume = null,
}: FrontDoorProps) {
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [visit, setVisit] = useState(0);
  const [leaving, setLeaving] = useState<{
    index: number;
    dir: 'next' | 'prev';
  } | null>(null);
  const [drag, setDrag] = useState<{
    dx: number;
    dir: 'next' | 'prev';
    phase: 'drag' | 'commit' | 'snap';
  } | null>(null);
  const dragStartX = useRef<number | null>(null);
  const dragWidth = useRef(0);
  const dragTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wrap = (index: number) =>
    ((index % SLIPS.length) + SLIPS.length) % SLIPS.length;

  const goTo = (index: number, dir: 'next' | 'prev') => {
    setLeaving({ index: active, dir });
    setActive(wrap(index));
    setVisit((value) => value + 1);
  };

  // The card changes by itself every 7 seconds. The timer restarts
  // whenever the card changes, and waits while a hand is on the card.
  useEffect(() => {
    if (drag) {
      return;
    }
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    const timer = setTimeout(
      () => goTo(active + 1, 'next'),
      HOLD_MS,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, visit, drag]);

  // The leaving card slides away, then leaves the stage.
  useEffect(() => {
    if (!leaving) {
      return;
    }
    const timer = setTimeout(() => setLeaving(null), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  useEffect(
    () => () => {
      if (dragTimer.current) {
        clearTimeout(dragTimer.current);
      }
    },
    [],
  );

  // The card is swappable: a finger or a mouse drags it, the next card
  // follows the hand, and past a short pull the change completes.
  const onDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (leaving || (event.pointerType === 'mouse' && event.button !== 0)) {
      return;
    }
    dragStartX.current = event.clientX;
    dragWidth.current = event.currentTarget.getBoundingClientRect().width;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null || (drag && drag.phase !== 'drag')) {
      return;
    }
    const dx = event.clientX - dragStartX.current;
    if (!drag && Math.abs(dx) < 6) {
      return;
    }
    setDrag({ dx, dir: dx > 0 ? 'next' : 'prev', phase: 'drag' });
  };

  const onDragEnd = () => {
    if (dragStartX.current === null) {
      return;
    }
    dragStartX.current = null;
    if (!drag) {
      return;
    }
    if (Math.abs(drag.dx) > 70) {
      const target = drag.dir === 'next' ? active + 1 : active - 1;
      setDrag({ ...drag, phase: 'commit' });
      dragTimer.current = setTimeout(() => {
        setActive(wrap(target));
        setVisit((value) => value + 1);
        setDrag(null);
      }, 380);
    } else {
      setDrag({ ...drag, dx: 0, phase: 'snap' });
      dragTimer.current = setTimeout(() => setDrag(null), 320);
    }
  };

  const renderSlip = (
    slip: (typeof SLIPS)[number],
    className: string,
    settled: boolean,
    slipKey: string,
    style?: React.CSSProperties,
  ) => (
    <article
      key={slipKey}
      style={style}
      className={`door-slip ${className}${settled ? ' door-slip--settled' : ''}`}
      aria-label={`Payment slip: ${slip.title}`}
      aria-hidden={settled || undefined}
    >
      <div className="door-slip__top">
        <span>Singla · Payment slip</span>
        <span>One payment only</span>
      </div>
      <div className="door-slip__details">
        <p className="door-slip__title">{slip.title}</p>
        <p className="door-slip__to">To: {slip.to}</p>
        <div className="door-slip__meta">
          <span className="door-slip__date">{slip.meta}</span>
          <span className="door-slip__amount">
            {slip.amount} <small>NEAR</small>
          </span>
        </div>
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
  );

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
            onClick={() => {
              // Already inside? Launch resumes the session directly and
              // the choice never opens. The resume target comes from the
              // app's live session state, so a signed-out visitor is
              // always asked again.
              if (resume === 'live') {
                onConnect();
                return;
              }
              if (resume === 'try') {
                onTry();
                return;
              }
              setChoiceOpen(true);
            }}
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

          <div className="door-stage-wrap rise" style={{ animationDelay: '240ms' }}>
            <div
              className="door-stage"
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
            >
              {drag ? (
                <>
                  {renderSlip(
                    SLIPS[wrap(drag.dir === 'next' ? active + 1 : active - 1)],
                    '',
                    true,
                    'drag-neighbour',
                    {
                      transform:
                        drag.phase === 'commit'
                          ? 'translateX(0)'
                          : `translateX(calc(${drag.dx}px ${
                              drag.dir === 'next' ? '-' : '+'
                            } 106%))`,
                      transition:
                        drag.phase === 'drag'
                          ? 'none'
                          : 'transform 380ms ease-out',
                      zIndex: 2,
                    },
                  )}
                  {renderSlip(SLIPS[active], '', false, `active-${visit}`, {
                    transform:
                      drag.phase === 'commit'
                        ? `translateX(${
                            drag.dir === 'next'
                              ? dragWidth.current + 40
                              : -(dragWidth.current + 40)
                          }px)`
                        : `translateX(${drag.dx}px)`,
                    transition:
                      drag.phase === 'drag'
                        ? 'none'
                        : 'transform 380ms ease-out',
                    zIndex: 3,
                  })}
                </>
              ) : (
                <>
                  {leaving &&
                    renderSlip(
                      SLIPS[leaving.index],
                      `door-slip--exit-${leaving.dir}`,
                      true,
                      `leaving-${visit}`,
                    )}
                  {renderSlip(
                    SLIPS[active],
                    leaving ? `door-slip--enter-${leaving.dir}` : '',
                    false,
                    `active-${visit}`,
                  )}
                </>
              )}
            </div>
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
            <p className="choice__foot">You can switch any time.</p>
          </div>
        </div>
      )}
    </div>
  );
}

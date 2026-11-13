interface BrandProps {
  /** Icon size in px: 25 in the app header, 30 on the front door. */
  size?: number;
}

/**
 * The Singla pair: the Loop Point mark (one unbroken ring for the promise,
 * one green dot for the payment that landed) beside the lowercase wordmark
 * in Instrument Serif. Ring and dot colours follow the theme via CSS.
 */
export function Brand({ size = 25 }: BrandProps) {
  return (
    <span className="brand">
      <svg
        className="brand__icon"
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden="true"
      >
        <circle
          className="brand__ring"
          cx="24"
          cy="24"
          r="17"
          strokeWidth="3.4"
        />
        <circle className="brand__dot" cx="36.5" cy="12.5" r="4.6" />
      </svg>
      <span className="brand__name">singla</span>
    </span>
  );
}

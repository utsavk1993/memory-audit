/** Memory Audit mark: a shield of note lines, two trusted and one caught as wrong. Same artwork as app/icon.svg. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={className}>
      <rect width="64" height="64" rx="14" fill="#111a2e" />
      <path
        d="M32 9l19 7v14c0 12-8 21-19 25-11-4-19-13-19-25V16z"
        fill="#1b2336"
        stroke="#22c55e"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M23 24h18M23 40h11" stroke="#22c55e" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M23 32h18" stroke="#ef4444" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

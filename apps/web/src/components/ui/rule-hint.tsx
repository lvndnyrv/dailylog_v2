// "12+ characters — that's the only rule" hint from 10d.
export function RuleHint() {
  return (
    <span className="flex items-center gap-2 text-xs text-muted">
      <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path
          d="M3.5 10.5L8 15l8.5-9"
          stroke="var(--success)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      12+ characters — that&apos;s the only rule
    </span>
  );
}

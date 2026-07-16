import { SectionHeader } from "./header";

// Designed-empty placeholder for nav sections that ship in later phases
// (PHASE_1 Module B: "non-built nav items route to a designed-empty placeholder").
export function PlaceholderSection({
  title,
  phase,
  blurb,
}: {
  title: string;
  phase: string;
  blurb: string;
}) {
  return (
    <>
      <SectionHeader title={title} />
      <main className="flex flex-1 items-center justify-center p-7">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <span className="rounded-full bg-tint px-3 py-1 font-mono text-[10.5px] font-semibold tracking-[.08em] text-primary">
            {phase.toUpperCase()}
          </span>
          <h2 className="text-[15px] font-extrabold text-ink">{title} isn&apos;t built yet</h2>
          <p className="text-[12.5px] leading-relaxed text-muted">{blurb}</p>
        </div>
      </main>
    </>
  );
}

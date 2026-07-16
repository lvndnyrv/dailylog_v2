// DailyLog brand mark (10a/10d): amber sun-dot in a cream disc + wordmark.
export function BrandMark({ size = "md" }: { size?: "sm" | "md" }) {
  const disc = size === "md" ? 38 : 34;
  const dot = size === "md" ? 18 : 16;
  return (
    <span className="flex items-center gap-[11px]">
      <span
        className="grid flex-none place-items-center rounded-full bg-warning-bg"
        style={{ width: disc, height: disc }}
      >
        <span
          className="rounded-full bg-warning"
          style={{ width: dot, height: dot, boxShadow: "0 0 0 3px rgba(240,180,65,.3)" }}
        />
      </span>
      <span className="font-extrabold text-xl text-ink">DailyLog</span>
    </span>
  );
}

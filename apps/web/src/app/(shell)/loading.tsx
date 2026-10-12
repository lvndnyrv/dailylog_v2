export default function ShellLoading() {
  return (
    <main className="flex flex-1 flex-col gap-5 bg-canvas p-8" aria-label="Loading page" aria-busy="true">
      <div className="h-9 w-56 animate-pulse rounded-lg bg-[#DDE8F6]" />
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map(item => (
          <div key={item} className="h-32 animate-pulse rounded-[18px] border border-hairline bg-card" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-[18px] border border-hairline bg-card" />
      <span className="sr-only">Loading DailyLog…</span>
    </main>
  );
}

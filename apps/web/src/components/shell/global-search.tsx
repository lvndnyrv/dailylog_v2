"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GlobalSearchResult } from "@/app/api/global-search/route";

const sectionOrder: GlobalSearchResult["section"][] = [
  "Children",
  "Staff",
  "Family & billing",
  "Actions",
];

export function GlobalSearch({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        queueMicrotask(() => inputRef.current?.focus());
      }
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/global-search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as { results?: GlobalSearchResult[] };
        setResults(response.ok ? (payload.results ?? []) : []);
        setActive(0);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 160);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const grouped = useMemo(
    () => sectionOrder
      .map((section) => ({ section, items: results.filter((result) => result.section === section) }))
      .filter((group) => group.items.length > 0),
    [results],
  );

  const openResult = (result: GlobalSearchResult) => {
    setOpen(false);
    setQuery("");
    router.push(result.href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          queueMicrotask(() => inputRef.current?.focus());
        }}
        className="flex w-[250px] items-center gap-2 rounded-full border-[1.5px] border-[#D6E1F0] bg-canvas px-3.5 py-[9px] text-left"
        aria-label="Open global search"
      >
        <Search size={13} strokeWidth={1.8} className="text-faint" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-faint">{placeholder}</span>
        <kbd className="rounded bg-[#E8EEF7] px-1.5 py-0.5 font-mono text-[9px] text-muted">⌘K</kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-start justify-center bg-ink/25 px-6 pt-[92px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Global search"
            className="w-[560px] max-w-full overflow-hidden rounded-[18px] border border-[rgba(23,51,91,.14)] bg-card"
            style={{ boxShadow: "0 18px 50px rgba(23,51,91,.2)" }}
          >
            <div className="flex items-center gap-3 border-b-[1.5px] border-hairline px-5 py-[18px]">
              <Search size={17} strokeWidth={1.8} className="text-faint" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  const value = event.target.value;
                  setQuery(value);
                  if (value.trim().length < 2) {
                    setResults([]);
                    setLoading(false);
                    setActive(0);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActive((index) => Math.min(results.length - 1, index + 1));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive((index) => Math.max(0, index - 1));
                  } else if (event.key === "Enter" && results[active]) {
                    event.preventDefault();
                    openResult(results[active]);
                  }
                }}
                placeholder="Search children, staff, families, invoices…"
                className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-faint"
                autoComplete="off"
              />
              {loading && <span className="text-[11px] text-faint">Searching…</span>}
            </div>

            <div className="max-h-[440px] overflow-y-auto px-2 py-3">
              {query.trim().length < 2 && (
                <p className="px-3 py-8 text-center text-[12.5px] text-faint">
                  Type at least two characters to search this location.
                </p>
              )}
              {query.trim().length >= 2 && !loading && results.length === 0 && (
                <p className="px-3 py-8 text-center text-[12.5px] text-faint">
                  No matching children, staff, families, or invoices.
                </p>
              )}
              {grouped.map((group) => (
                <div key={group.section} className="mb-2 last:mb-0">
                  <p className="px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[.09em] text-faint">
                    {group.section}
                  </p>
                  {group.items.map((result) => {
                    const index = results.findIndex((item) => item.id === result.id);
                    const tone = result.tone === "amber"
                      ? "bg-[#FBF3E4] text-[#B0782B]"
                      : result.tone === "green"
                        ? "bg-[#E4F3EC] text-success"
                        : result.tone === "purple"
                          ? "bg-[#F0EAFB] text-[#7A5FD0]"
                          : "bg-[#E3EDFA] text-primary";
                    return (
                      <button
                        key={result.id}
                        type="button"
                        onMouseEnter={() => setActive(index)}
                        onClick={() => openResult(result)}
                        className={`flex w-full items-center gap-3 rounded-[11px] px-3.5 py-2.5 text-left ${active === index ? "bg-canvas" : "hover:bg-canvas"}`}
                      >
                        <span className={`grid size-8 flex-none place-items-center rounded-full text-[10px] font-bold ${tone}`}>
                          {result.initials ?? "→"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <b className="block truncate text-[13px] text-ink">{result.title}</b>
                          <span className="block truncate text-[11.5px] text-muted">{result.subtitle}</span>
                        </span>
                        {active === index && (
                          <kbd className="rounded bg-[#EDF2F9] px-2 py-1 font-mono text-[9px] text-faint">↵ open</kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="flex gap-4 border-t-[1.5px] border-hairline bg-[#F8FBFE] px-5 py-3 text-[10.5px] text-faint">
              <span>↑↓ navigate</span><span>↵ open</span><span>esc close</span>
              <span className="ml-auto">searches this location only</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

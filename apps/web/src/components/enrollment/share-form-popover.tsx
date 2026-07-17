"use client";

import { useEffect, useRef, useState } from "react";

// Share link popover (2g) — the public inquiry form URL for the website.
export function ShareFormPopover({
  daycareId,
  onClose,
}: {
  daycareId: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const path = `/inquire?c=${daycareId}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-11 z-40 flex w-72 flex-col gap-2.5 rounded-[14px] border-[1.5px] border-hairline bg-card p-4"
      style={{ boxShadow: "0 14px 40px rgba(23,51,91,.22)" }}
    >
      <span className="text-[13px] font-extrabold text-ink">Public inquiry form</span>
      <span className="text-[11.5px] leading-normal text-muted">
        Put this link on your website — inquiries land in the pipeline
        automatically.
      </span>
      <div className="flex items-center gap-1.5 rounded-[11px] bg-canvas px-2.5 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink">{path}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(`${window.location.origin}${path}`);
            setCopied(true);
          }}
          className="whitespace-nowrap rounded-btn border-[1.5px] border-[#D6E1F0] px-2 py-1 text-[10.5px] font-bold text-primary hover:bg-card"
        >
          {copied ? "Copied ✓" : "Copy link"}
        </button>
      </div>
    </div>
  );
}

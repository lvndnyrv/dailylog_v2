"use client";

import { useEffect, useRef } from "react";

// Centered modal card per the design system: 430px, radius 22px, dim overlay.
// Esc closes; clicking the backdrop closes; focus moves into the card.
export function Modal({
  onClose,
  children,
  width = 430,
}: {
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    cardRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="flex max-h-full max-w-full flex-col gap-4 overflow-y-auto rounded-[22px] border border-[rgba(23,51,91,.12)] bg-card p-7 outline-none"
        style={{ width, boxShadow: "0 14px 40px rgba(23,51,91,.16)" }}
      >
        {children}
      </div>
    </div>
  );
}

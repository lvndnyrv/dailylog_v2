"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-btn border-[1.5px] border-[#D6E1F0] px-4 py-2 text-[13px] font-bold text-primary print:hidden"
    >
      Print sheet
    </button>
  );
}

import type { InputHTMLAttributes } from "react";

// Labeled input matching the design's auth fields: 1.5px #D6E1F0 border,
// 13px radius (inputs keep the design radius; only buttons are "Rounded").
export function Field({
  label,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex flex-col gap-[7px]">
      <span className="text-[13px] font-bold text-ink">{label}</span>
      <input
        className={`rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3.5 text-[15px] text-ink outline-none placeholder:text-faint focus:border-primary ${className}`}
        {...props}
      />
    </label>
  );
}

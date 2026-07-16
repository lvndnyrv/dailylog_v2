import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary";

const base =
  "rounded-btn px-4 text-center font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary: "border-[1.5px] border-[#D6E1F0] bg-card text-ink hover:bg-canvas",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`${base} ${variants[variant]} py-3.5 text-[15px] ${className}`}
      {...props}
    />
  );
}

import { initials } from "@dailylog/shared";

// Initials-on-tint avatar (design: #E3EDFA disc, primary text).
export function Avatar({
  name,
  src,
  size = 30,
  className = "",
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`grid flex-none place-items-center rounded-full bg-tint font-bold text-primary ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) }}
      aria-hidden
    >
      {src ? (
        // Profile avatars come from the constrained public profile-avatars bucket.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full rounded-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

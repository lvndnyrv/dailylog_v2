import { X } from "lucide-react";
export const card = "rounded-[17px] border-[1.5px] border-hairline bg-card p-5";
export const heading = "text-[15px] font-extrabold text-ink";
export const input =
  "mt-1.5 w-full min-w-0 rounded-[12px] border-[1.5px] border-hairline bg-white px-3 py-2.5 text-[13px] font-normal text-ink outline-none focus:border-primary user-invalid:border-danger";
export const label = "block min-w-0 text-[12.5px] font-bold text-ink";
export const link = "text-[12px] font-bold text-primary hover:underline";
export const documentTypes: Record<string, string> = {
  license: "Operating license",
  insurance: "Liability insurance",
  inspection: "Inspection report",
  policy: "Policy",
  other: "Other document",
};
export const drillTypes: Record<string, string> = {
  fire: "Fire",
  lockdown: "Lockdown",
  severe_weather: "Severe weather",
};
export function date(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(
    "en-CA",
    { month: "short", day: "numeric", year: "numeric" },
  );
}
export function days(expiry: string, today: string) {
  return Math.round((Date.parse(expiry) - Date.parse(today)) / 86400000);
}
export function time(value: string | null, timezone: string) {
  return value
    ? new Date(value).toLocaleString("en-CA", {
        timeZone: timezone,
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
}
export function ModalTitle({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-xl font-extrabold text-ink">{title}</h2>
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="rounded-full p-1.5 text-muted hover:bg-canvas"
      >
        <X size={18} />
      </button>
    </div>
  );
}
export function ErrorMessage({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="rounded-xl bg-danger-bg p-3 text-sm text-danger">
      {error}
    </p>
  ) : null;
}

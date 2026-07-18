"use client";

import { ChevronRight, Code2, ExternalLink, Printer } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";

// Share link popover (2g) — direct link, website embed, business-profile handoff,
// and a printable door poster all use the same scoped public inquiry URL.
export function ShareFormPopover({
  daycareId,
  onClose,
}: {
  daycareId: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<string>();
  const ref = useRef<HTMLDivElement>(null);
  const path = `/inquire?c=${daycareId}`;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  const absoluteUrl = () => `${window.location.origin}${path}`;
  const copy = async (value: string, message: string) => {
    await navigator.clipboard.writeText(value);
    setStatus(message);
  };
  const printPoster = async () => {
    const dataUrl = await QRCode.toDataURL(absoluteUrl(), {
      width: 520,
      margin: 2,
      color: { dark: "#17335B", light: "#FFFFFF" },
    });
    const popup = window.open("", "dailylog-inquiry-poster", "width=760,height=900");
    if (!popup) {
      setStatus("Allow pop-ups to print the poster");
      return;
    }
    popup.document.write(`<!doctype html><html><head><title>Enrollment inquiry poster</title><style>body{font-family:Arial,sans-serif;color:#17335B;text-align:center;padding:64px}h1{font-size:34px;margin-bottom:8px}p{font-size:18px;color:#5B6B82}img{width:360px;margin:36px auto 18px}.url{font-size:13px;word-break:break-all}@media print{body{padding:36px}}</style></head><body><h1>Interested in joining us?</h1><p>Scan to send an enrollment inquiry.</p><img src="${dataUrl}" alt="Enrollment inquiry QR code"><div class="url">${absoluteUrl()}</div><script>window.onload=()=>window.print()<\/script></body></html>`);
    popup.document.close();
    setStatus("Poster opened for printing");
  };

  return (
    <div
      ref={ref}
      className="absolute right-0 top-11 z-40 flex w-[310px] flex-col gap-3 rounded-[18px] border-[1.5px] border-hairline bg-card p-[18px]"
      style={{ boxShadow: "0 14px 40px rgba(23,51,91,.22)" }}
    >
      <span className="text-[15px] font-extrabold text-ink">Share the inquiry form</span>
      <div className="flex items-center gap-1.5 rounded-[12px] border-[1.5px] border-[#D6E1F0] bg-canvas px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-bold text-ink">{path}</span>
        <button
          type="button"
          onClick={() => copy(absoluteUrl(), "Link copied")}
          className="text-[11.5px] font-bold text-primary"
        >
          Copy
        </button>
      </div>
      <div className="flex flex-col">
        <ShareOption
          icon={<Code2 size={13} />}
          label="Embed on your website"
          onClick={() =>
            copy(
              `<iframe src="${absoluteUrl()}" title="Enrollment inquiry" width="420" height="760"></iframe>`,
              "Embed code copied",
            )
          }
        />
        <ShareOption
          icon={<ExternalLink size={13} />}
          label="Copy for Google Business"
          onClick={() => copy(absoluteUrl(), "Link copied for your business profile")}
        />
        <ShareOption icon={<Printer size={13} />} label="Print a QR poster for the door" onClick={printPoster} last />
      </div>
      <span aria-live="polite" className="min-h-4 text-[10.5px] text-success">
        {status}
      </span>
      <p className="text-[10.5px] leading-normal text-faint">
        Every submission lands in New inquiry with a confirmation email queued automatically.
      </p>
    </div>
  );
}

function ShareOption({
  icon,
  label,
  onClick,
  last = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 py-2.5 text-left text-[12px] text-ink ${last ? "" : "border-b border-[#EDF3FB]"}`}
    >
      <span className="text-faint">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRight size={13} className="text-faint" />
    </button>
  );
}

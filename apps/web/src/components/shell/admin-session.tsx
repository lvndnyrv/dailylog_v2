import { Monitor, Smartphone } from "lucide-react";

export type AdminSession = {
  session_id: string;
  created_at: string;
  last_active_at: string;
  user_agent: string | null;
  ip_address: string | null;
  is_current: boolean;
};

export function deviceLabel(userAgent: string | null): string {
  if (!userAgent || /supabase-js|node|undici/i.test(userAgent)) return "Web session · device details unavailable";
  const device = /iPhone/i.test(userAgent) ? "iPhone"
    : /iPad/i.test(userAgent) ? "iPad"
    : /Android/i.test(userAgent) ? "Android device"
    : /Macintosh|Mac OS X/i.test(userAgent) ? "Mac"
    : /Windows/i.test(userAgent) ? "Windows computer"
    : /Linux/i.test(userAgent) ? "Linux computer"
    : "Unidentified device";
  const browser = /Edg\//i.test(userAgent) ? "Edge"
    : /Firefox\//i.test(userAgent) ? "Firefox"
    : /Chrome\//i.test(userAgent) ? "Chrome"
    : /Safari\//i.test(userAgent) ? "Safari"
    : "browser";
  return `${device} · ${browser}`;
}

export function AdminSessionRow({ session }: { session: AdminSession }) {
  const mobile = /iPhone|iPad|Android/i.test(session.user_agent ?? "");
  const lastActive = new Date(session.last_active_at);

  return (
    <div className="flex items-start gap-2.5 py-2.5 text-[12px]">
      {mobile ? <Smartphone size={16} className="mt-0.5 flex-none text-muted" aria-hidden /> : <Monitor size={16} className="mt-0.5 flex-none text-muted" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">
          {deviceLabel(session.user_agent)}
          {session.is_current && <span className="ml-1 text-primary">· This session</span>}
        </p>
        <p className="text-muted">
          Last active {Number.isNaN(lastActive.getTime()) ? "unknown" : lastActive.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
          {session.ip_address ? ` · IP ${session.ip_address.replace(/\/(32|128)$/, "")}` : ""}
        </p>
      </div>
    </div>
  );
}

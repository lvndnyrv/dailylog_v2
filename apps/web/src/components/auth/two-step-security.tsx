"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { getBrowserSupabase } from "@/lib/supabase/browser";

interface FactorSummary {
  id: string;
  friendlyName: string;
  createdAt: string;
  lastChallengedAt: string | null;
}

function browserSafeQrCode(value: string): string {
  const comma = value.indexOf(",");
  if (comma < 0 || !value.slice(0, comma).includes("image/svg+xml")) return value.trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value.slice(comma + 1).trim())}`;
}

type Mode = "challenge" | "setup" | "manage";

export function TwoStepSecurity({
  mode,
  destination,
  factors,
  required,
}: {
  mode: Mode;
  destination: string;
  factors: FactorSummary[];
  required: boolean;
}) {
  if (mode === "manage" && factors.length > 0) {
    return <ManageFactors factors={factors} required={required} />;
  }
  if (mode === "setup") {
    return <EnrollFactor destination={destination} required={required} />;
  }
  return <VerifyFactor destination={destination} factor={factors[0]} />;
}

function VerifyFactor({ destination, factor }: { destination: string; factor: FactorSummary }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setPending(true);
    setError(undefined);
    const supabase = getBrowserSupabase();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code,
    });
    if (verifyError) {
      setPending(false);
      setError("That code was not accepted. Wait for a new code and try again.");
      return;
    }
    await supabase.rpc("record_account_security_event", {
      p_event: "mfa_challenge_completed",
      p_factor_id: factor.id,
    });
    window.location.assign(destination);
  }

  return (
    <form onSubmit={verify} className="flex flex-col gap-4">
      <div>
        <h1 className="text-[19px] font-extrabold text-ink">Two-step verification</h1>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Open your authenticator app and enter the current code for DailyLog.
        </p>
      </div>
      <CodeInput value={code} onChange={setCode} disabled={pending} autoFocus />
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" disabled={pending}>
        {pending ? "Verifying…" : "Verify & open the dashboard"}
      </Button>
      <p className="text-center text-[11.5px] leading-normal text-faint">
        Codes refresh every 30 seconds. DailyLog never sees or stores your authenticator secret.
      </p>
    </form>
  );
}

function EnrollFactor({ destination, required }: { destination: string; required: boolean }) {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<{
    factorId: string;
    qrCode: string;
    secret: string;
  }>();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function begin() {
    setPending(true);
    setError(undefined);
    const supabase = getBrowserSupabase();
    const { data: existing } = await supabase.auth.mfa.listFactors();
    for (const factor of existing?.all.filter((item) => item.status === "unverified") ?? []) {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "DailyLog admin",
    });
    setPending(false);
    if (enrollError) {
      setError(enrollError.message);
      return;
    }
    setEnrollment({
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    });
  }

  async function finish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrollment || !/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setPending(true);
    setError(undefined);
    const supabase = getBrowserSupabase();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrollment.factorId,
      code,
    });
    if (verifyError) {
      setPending(false);
      setError("That code was not accepted. Check the account in your authenticator app and try again.");
      return;
    }
    await supabase.rpc("record_account_security_event", {
      p_event: "mfa_factor_enrolled",
      p_factor_id: enrollment.factorId,
    });
    window.location.assign(destination);
  }

  async function cancel() {
    if (enrollment) {
      await getBrowserSupabase().auth.mfa.unenroll({ factorId: enrollment.factorId });
    }
    router.push(destination);
    router.refresh();
  }

  if (!enrollment) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-[19px] font-extrabold text-ink">Protect your admin account</h1>
          <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
            Add DailyLog to an authenticator app. You will use a changing 6-digit code after your password.
          </p>
        </div>
        {required && (
          <Notice tone="info">
            Your center requires two-step verification for every administrator.
          </Notice>
        )}
        <ol className="flex flex-col gap-2 rounded-[13px] bg-canvas px-4 py-3 text-[12.5px] leading-normal text-body">
          <li><b className="text-ink">1.</b> Open Google Authenticator, 1Password, Authy, or another authenticator.</li>
          <li><b className="text-ink">2.</b> Scan the QR code we show next.</li>
          <li><b className="text-ink">3.</b> Enter one code to confirm setup.</li>
        </ol>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="button" onClick={begin} disabled={pending}>
          {pending ? "Preparing…" : "Begin secure setup"}
        </Button>
        {!required && (
          <Button type="button" variant="secondary" onClick={cancel} disabled={pending}>
            Set up later
          </Button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={finish} className="flex flex-col gap-4">
      <div>
        <h1 className="text-[19px] font-extrabold text-ink">Scan this QR code</h1>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Scan it with your authenticator app, then enter the 6-digit code it creates.
        </p>
      </div>
      <div className="mx-auto rounded-2xl border border-[#D6E1F0] bg-white p-3">
        <Image src={browserSafeQrCode(enrollment.qrCode)} alt="DailyLog authenticator QR code" width={190} height={190} unoptimized />
      </div>
      <details className="rounded-xl bg-canvas px-3 py-2 text-[11.5px] text-muted">
        <summary className="cursor-pointer font-bold text-primary">Can’t scan it? Enter a setup key</summary>
        <code className="mt-2 block break-all rounded-lg bg-white p-2 text-ink">{enrollment.secret}</code>
      </details>
      <CodeInput value={code} onChange={setCode} disabled={pending} autoFocus />
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" disabled={pending}>
        {pending ? "Confirming…" : "Confirm two-step verification"}
      </Button>
      {!required && (
        <Button type="button" variant="secondary" onClick={cancel} disabled={pending}>
          Cancel setup
        </Button>
      )}
    </form>
  );
}

function ManageFactors({ factors, required }: { factors: FactorSummary[]; required: boolean }) {
  const [items, setItems] = useState(factors);
  const [error, setError] = useState<string>();
  const [pendingId, setPendingId] = useState<string>();

  async function remove(factorId: string) {
    if (required && items.length === 1) {
      setError("Your center requires two-step verification. Add another authenticator before removing this one.");
      return;
    }
    if (!window.confirm("Remove this authenticator? It will stop generating valid DailyLog codes.")) return;
    setPendingId(factorId);
    setError(undefined);
    const supabase = getBrowserSupabase();
    const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId });
    if (removeError) {
      setPendingId(undefined);
      setError(removeError.message);
      return;
    }
    await supabase.rpc("record_account_security_event", {
      p_event: "mfa_factor_removed",
      p_factor_id: factorId,
    });
    setItems((current) => current.filter((factor) => factor.id !== factorId));
    setPendingId(undefined);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[19px] font-extrabold text-ink">Two-step verification</h1>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          These authenticators can approve access to your DailyLog admin account.
        </p>
      </div>
      <div className="flex flex-col overflow-hidden rounded-[13px] border border-[#D6E1F0]">
        {items.map((factor) => (
          <div key={factor.id} className="flex items-center gap-3 border-b border-[#EDF3FB] px-3.5 py-3 last:border-b-0">
            <span className="grid size-9 flex-none place-items-center rounded-xl bg-[#E4F3EC] text-success">✓</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-bold text-ink">{factor.friendlyName}</span>
              <span className="block text-[10.5px] text-muted">
                Added {new Date(factor.createdAt).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </span>
            <button
              type="button"
              onClick={() => remove(factor.id)}
              disabled={pendingId === factor.id || (required && items.length === 1)}
              className="text-[11.5px] font-bold text-danger disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pendingId === factor.id ? "Removing…" : "Remove"}
            </button>
          </div>
        ))}
      </div>
      {required && <Notice tone="info">At least one authenticator must remain while your center’s requirement is on.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <Link
        href="/two-step?mode=setup&next=/two-step?mode=manage"
        className="rounded-btn bg-primary px-4 py-3.5 text-center text-[15px] font-bold text-white hover:bg-primary-hover"
      >
        Add another authenticator
      </Link>
      <Link
        href="/settings"
        className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3.5 text-center text-[15px] font-bold text-ink hover:bg-canvas"
      >
        Back to settings
      </Link>
    </div>
  );
}

function CodeInput({
  value,
  onChange,
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-ink">6-digit code</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label="6-digit verification code"
        placeholder="000000"
        className="w-full rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-center font-mono text-[24px] font-extrabold tracking-[0.45em] text-ink outline-none placeholder:text-[#D6E1F0] focus:border-primary"
      />
    </label>
  );
}

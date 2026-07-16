import { ForgotForm } from "./forgot-form";

// Screen 10c — request a reset link, sent state inline.
export default function ForgotPage() {
  return (
    <>
      <div>
        <h1 className="text-[19px] font-extrabold text-ink">Reset your password</h1>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          We&apos;ll email you a link — no security questions, no phone calls.
        </p>
      </div>
      <ForgotForm />
      <p className="text-center text-[11.5px] leading-normal text-faint">
        Resets are noted in the audit log — if you didn&apos;t ask for one,
        that&apos;s worth a look.
      </p>
    </>
  );
}

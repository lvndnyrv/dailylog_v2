import { ResetForm } from "./reset-form";

// Destination of the 10c recovery email. The design covers only the request
// side; this mirrors the 10d password card (DECISIONS.md).
export default function ResetPage() {
  return (
    <>
      <div>
        <h1 className="text-[19px] font-extrabold text-ink">Choose a new password</h1>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          You&apos;re signed in through the emailed link — set the new password now.
        </p>
      </div>
      <ResetForm />
    </>
  );
}

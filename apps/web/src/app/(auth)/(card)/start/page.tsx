import { StartForm } from "./start-form";

// Screen 10e — self-serve center signup. The design shows three fields; a
// password field is added so the owner can actually sign in (DECISIONS.md).
export default function StartPage() {
  return (
    <>
      <div>
        <h1 className="text-[19px] font-extrabold text-ink">Start your center</h1>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Free for 14 days · no card · your data stays yours.
        </p>
      </div>
      <StartForm />
      <p className="text-center text-[11.5px] leading-normal text-faint">
        Rooms, staff and families come next, from inside the console. Already
        set up?{" "}
        <a href="/sign-in" className="font-bold text-primary hover:text-primary-hover">
          Sign in
        </a>
        .
      </p>
    </>
  );
}

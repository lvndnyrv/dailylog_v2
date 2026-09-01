import { StartForm } from "./start-form";

// Screen 10e — approved center signup. Registration uses the same platform-
// issued, email-bound code as mobile so neither surface can self-promote a
// random account to owner admin.
export default function StartPage() {
  return (
    <>
      <div>
        <h1 className="text-[19px] font-extrabold text-ink">Start your center</h1>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Set up the center DailyLog approved for your administrator email.
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

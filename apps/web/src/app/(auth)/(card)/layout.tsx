// Centered 430px card on canvas — shared by 10c forgot, 10d invite, 10e start.
export default function AuthCardLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div
        className="flex w-[430px] max-w-full flex-col gap-4 rounded-[22px] border border-[rgba(23,51,91,.12)] bg-card p-7"
        style={{ boxShadow: "0 14px 40px rgba(23,51,91,.16)" }}
      >
        {children}
      </div>
    </main>
  );
}

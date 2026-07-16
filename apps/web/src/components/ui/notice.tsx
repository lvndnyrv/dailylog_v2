// Inline status notes (10c "Sent." state and error equivalents).
export function Notice({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: React.ReactNode;
}) {
  const styles =
    tone === "success"
      ? "border-[#BFE3D0] bg-[#E4F3EC] text-ink"
      : "border-[#EFC9C9] bg-danger-bg text-ink";
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-[13px] border-[1.5px] px-[15px] py-3 text-[12.5px] leading-normal ${styles}`}
    >
      {children}
    </div>
  );
}

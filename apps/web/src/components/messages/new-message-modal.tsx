"use client";

import { Avatar } from "@/components/ui/avatar";
import { Modal } from "@/components/ui/modal";
import { startStaffConversationAction } from "@/lib/messages/actions";

export interface StaffMessageCandidate {
  profileId: string;
  fullName: string;
  role: string;
  roomName: string | null;
}

export function NewMessageModal({
  staff,
  onClose,
}: {
  staff: StaffMessageCandidate[];
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} width={430}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">New staff message</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Start or reopen a private conversation with a team member.
        </p>
      </div>
      <div className="flex max-h-[430px] flex-col overflow-y-auto rounded-[15px] border border-[#EDF3FB]">
        {staff.map((member) => (
          <form
            key={member.profileId}
            action={startStaffConversationAction}
            className="border-b border-[#EDF3FB] last:border-b-0"
          >
            <input type="hidden" name="profile_id" value={member.profileId} />
            <button
              type="submit"
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-canvas"
            >
              <Avatar name={member.fullName} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-extrabold text-ink">
                  {member.fullName}
                </span>
                <span className="block truncate text-[11.5px] text-muted">
                  {member.role}{member.roomName ? ` · ${member.roomName}` : ""}
                </span>
              </span>
              <span className="text-lg text-faint">›</span>
            </button>
          </form>
        ))}
        {staff.length === 0 && (
          <p className="px-4 py-8 text-center text-[12.5px] text-faint">
            No other active staff members are available.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-sm font-bold text-ink hover:bg-canvas"
      >
        Cancel
      </button>
    </Modal>
  );
}

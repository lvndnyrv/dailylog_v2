"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  sendStaffMessageAction,
  type MessageActionState,
} from "@/lib/messages/actions";

export function StaffReplyComposer({
  conversationId,
  staffName,
}: {
  conversationId: string;
  staffName: string;
}) {
  const [state, action, pending] = useActionState<MessageActionState, FormData>(
    sendStaffMessageAction,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <div className="border-t border-[#EDF3FB] px-4 pb-3 pt-3">
      <form ref={formRef} action={action} className="flex items-center gap-2">
        <input type="hidden" name="conversation_id" value={conversationId} />
        <input
          name="body"
          placeholder={`Message ${staffName}…`}
          autoComplete="off"
          maxLength={4000}
          className="flex-1 rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-3.5 py-2.5 text-[13px] text-ink outline-none placeholder:text-faint focus:border-primary"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-btn bg-primary px-4 py-2.5 text-[13px] font-bold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {pending ? "…" : "Send"}
        </button>
      </form>
      {state.error && <p className="mt-1.5 text-[11.5px] font-semibold text-danger">{state.error}</p>}
      <p className="mt-1.5 text-[10.5px] text-faint">
        Private staff thread · only the two participants can view it
      </p>
    </div>
  );
}

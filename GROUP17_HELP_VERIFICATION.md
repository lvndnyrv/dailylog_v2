# Group 17 — admin help and support

Verified on October 18, 2026 against the local admin dashboard.

Implemented:
- The top bar has a help control beside notifications. It opens a searchable, context-aware article panel.
- Articles open in place, link to the relevant console area, and offer local helpfulness feedback. Escape and the close control dismiss help; `?` opens help when not typing.
- The shortcut sheet lists only working shortcuts: global search, help, Escape, and search-result navigation.
- The support entry is explicit about delivery. When `NEXT_PUBLIC_SUPPORT_EMAIL` is set, it prepares an email draft for the admin to review and send. Without a configured address, it does not show an unusable form or claim a message was sent; it points to existing support guidance.

Checks: targeted ESLint, TypeScript, production build, and browser interaction on the seeded admin dashboard (open panel, contextual article, support fallback, close).

Remaining integration before production support messaging: choose and configure the actual support destination, delivery/reply workflow, and attachment storage/scanning policy. The design's in-panel replies, screenshot attachment, and response-time promise are intentionally not shown because those services are not present.

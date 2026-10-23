# Group 12 — compliance review

Reviewed against the admin Group 12 design on October 18, 2026.

The browser exposes the designed compliance hub, drill form and history, expiry list, versioned document vault, staff-file checklist, and inspection pack. Drill and upload dialogs were opened and cancelled without saving. The inspection pack has a return link, print action, and time-limited share flow.

Rollback-only linked-database checks passed for tenant isolation, permissions, expiring/revoked inspection shares, reminder deduplication, and required background-clearance gating. The web production build passed.

One safety-related presentation gap was corrected: empty classrooms previously inflated the headline ratio-compliance percentage. The ledger now returns occupied-room minutes separately; the pack calculates its headline only from recorded occupied intervals, shows the denominator, labels empty rows “No children present,” and warns when no occupied intervals were captured. The new rollback-only test verifies empty intervals do not inflate this metric.

This pack is still a record summary, not a licensing determination. Its percentage depends on accurate attendance and staffing entries. The seeded center currently has only a small amount of recorded occupied-room time, so its displayed percentage should not be treated as evidence of real-world compliance.

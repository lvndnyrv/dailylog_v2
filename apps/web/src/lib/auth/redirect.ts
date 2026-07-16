import { isAdminRole } from "@dailylog/shared";

// Post-auth destination by role (PHASE_1 Module A): admins get the console,
// educators and parents get the mobile-app interstitial.
export function roleDestination(role: string | null | undefined): string {
  if (isAdminRole(role)) return "/dashboard";
  return "/use-the-app";
}

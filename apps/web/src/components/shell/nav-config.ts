import {
  BarChart3,
  Check,
  CircleCheck,
  CirclePlus,
  CreditCard,
  DoorOpen,
  LayoutGrid,
  MessageSquare,
  Settings,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  built: boolean; // Phase 1: unbuilt items route to a designed-empty placeholder
}

// Sidebar order from the design (20a/9a). Billing/Compliance count badges are
// hidden until those phases ship (PHASE_1 Module B).
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutGrid, built: true },
  { label: "Staff", href: "/staff", icon: UserRound, built: true },
  { label: "Children", href: "/children", icon: Users, built: true },
  { label: "Rooms & ratios", href: "/rooms", icon: DoorOpen, built: true },
  { label: "Enrollment", href: "/enrollment", icon: CirclePlus, built: true },
  { label: "Attendance", href: "/attendance", icon: Check, built: true },
  { label: "Billing", href: "/billing", icon: CreditCard, built: true },
  { label: "Messages", href: "/messages", icon: MessageSquare, built: false },
  { label: "Compliance", href: "/compliance", icon: CircleCheck, built: true },
  { label: "Reports", href: "/reports", icon: BarChart3, built: false },
  { label: "Settings", href: "/settings", icon: Settings, built: false },
];

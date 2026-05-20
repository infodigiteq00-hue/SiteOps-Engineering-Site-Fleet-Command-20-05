import { create } from "zustand";

export type PlatformRole =
  | "super_admin"
  | "firm_admin"
  | "senior_manager"
  | "store_manager"
  | "site_manager"
  | "viewer";

export interface SessionUser {
  id: string;
  name: string;
  role: PlatformRole;
  /** Null only for Super Admin (platform-wide). */
  companyId: string | null;
  /** For site managers: sites they may open. Other roles may ignore. */
  assignedSiteIds: string[];
}

export const ROLE_LABELS: Record<PlatformRole, string> = {
  super_admin: "Super Admin",
  firm_admin: "Firm Admin",
  senior_manager: "Senior Manager",
  store_manager: "Store Manager",
  site_manager: "Site Manager",
  viewer: "Viewer",
};

interface SessionState {
  users: SessionUser[];
  currentUserId: string;
  applyAuthenticatedUser: (user: SessionUser) => void;
  clearSession: () => void;
}

export const useSession = create<SessionState>((set) => ({
  users: [],
  currentUserId: "",
  applyAuthenticatedUser: (user) =>
    set({
      users: [user],
      currentUserId: user.id,
    }),
  clearSession: () => set({ users: [], currentUserId: "" }),
}));

export function useCurrentUser(): SessionUser {
  const users = useSession((s) => s.users);
  const currentUserId = useSession((s) => s.currentUserId);
  const u = users.find((x) => x.id === currentUserId) ?? users[0];
  if (!u) {
    throw new Error("Session is not initialized");
  }
  return u;
}

/** For non-React calls (mutations): returns null before session hydrates. */
export function peekCurrentUser(): SessionUser | null {
  const { users, currentUserId } = useSession.getState();
  return users.find((x) => x.id === currentUserId) ?? users[0] ?? null;
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

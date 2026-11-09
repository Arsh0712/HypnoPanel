"use client";

import { create } from "zustand";

/** Panel UI store: navigation (view switching — no hash routes) + session. */

export type PanelView =
  | "dashboard"
  | "websites"
  | "domains"
  | "apps"
  | "databases"
  | "files"
  | "terminal"
  | "email"
  | "wordpress"
  | "security"
  | "performance"
  | "firewall"
  | "cron"
  | "backups"
  | "processes"
  | "services"
  | "monitoring"
  | "server"
  | "users"
  | "audit"
  | "settings"
  | "about";

export interface ViewerUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  mustChangePassword: boolean;
  totpEnabled: boolean;
}

interface PanelState {
  view: PanelView;
  viewParam: string | null; // e.g. selected website id
  viewer: ViewerUser | null;
  setView: (view: PanelView, param?: string | null) => void;
  setViewer: (u: ViewerUser | null) => void;
}

export const usePanelStore = create<PanelState>((set) => ({
  view: "dashboard",
  viewParam: null,
  viewer: null,
  setView: (view, param = null) => set({ view, viewParam: param }),
  setViewer: (viewer) => set({ viewer }),
}));

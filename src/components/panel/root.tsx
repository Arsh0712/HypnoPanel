"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { usePanelStore, type ViewerUser } from "@/lib/store";
import { LoginScreen } from "./login-screen";
import { ForcedPasswordChange } from "./forced-password-change";
import { TwoFactorSetup } from "./twofa-setup";
import { AppShell } from "./app-shell";
import { useState } from "react";

interface SessionResponse {
  authenticated: boolean;
  user?: ViewerUser;
}

/**
 * Root gate: Login → (forced password change) → (2FA offer) → App shell.
 * The whole panel is a single-route application (no hash routes, no extra paths).
 */
export function HipnoPanelRoot() {
  const [offerTwoFactor, setOfferTwoFactor] = useState(false);
  const setViewer = usePanelStore((s) => s.setViewer);
  const viewer = usePanelStore((s) => s.viewer);

  const session = useQuery<SessionResponse>({
    queryKey: ["session"],
    queryFn: () => get<SessionResponse>("/api/auth/session"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const user = session.data?.user;
  const authenticated = !!session.data?.authenticated && !!user;

  // Sync the viewer store (never during render)
  useEffect(() => {
    if (authenticated && user && (!viewer || viewer.id !== user.id)) setViewer(user);
    if (!authenticated && viewer) setViewer(null);
  }, [authenticated, user, viewer, setViewer]);

  if (session.isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" role="status" aria-label="Loading" />
        <p className="text-sm text-muted-foreground">Loading HipnoType Panel…</p>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginScreen onAuthenticated={() => session.refetch()} />;
  }

  if (user!.mustChangePassword) {
    return (
      <ForcedPasswordChange
        email={user!.email}
        onDone={() => {
          setOfferTwoFactor(true);
          session.refetch();
        }}
      />
    );
  }

  if (offerTwoFactor && !user!.totpEnabled) {
    return (
      <TwoFactorSetup
        onDone={() => {
          setOfferTwoFactor(false);
          session.refetch();
        }}
      />
    );
  }

  if (!viewer) {
    // viewer store will be set by the effect above; render the shell on next tick
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" role="status" aria-label="Loading" />
      </div>
    );
  }

  return <AppShell />;
}

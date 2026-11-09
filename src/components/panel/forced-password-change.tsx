"use client";

import { useMemo, useState } from "react";
import { post, ApiClientError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, Loader2, ShieldAlert } from "lucide-react";

function strength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 12) score += 30;
  if (pw.length >= 16) score += 15;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 20;
  if (/\d/.test(pw)) score += 15;
  if (/[^A-Za-z0-9]/.test(pw)) score += 20;
  score = Math.min(100, score);
  const label =
    score < 40 ? "Weak" : score < 70 ? "Fair" : score < 90 ? "Strong" : "Very strong";
  return { score, label };
}

/** Forced first-login password change (spec §4.5) — blocks the whole panel. */
export function ForcedPasswordChange({
  email,
  onDone,
}: {
  email: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [newEmail, setNewEmail] = useState(email);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const s = useMemo(() => strength(newPassword), [newPassword]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await post<{ email: string }>("/api/auth/change-password", {
        currentPassword,
        newPassword,
        newEmail: newEmail.trim().toLowerCase(),
      });
      toast({
        title: "Password updated",
        description: `Signed in as ${res.email}. Other sessions were revoked.`,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Network error — please retry.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-md border shadow-sm">
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2 mb-1">
              <ShieldAlert className="h-5 w-5 text-primary" aria-hidden />
              <CardTitle className="text-xl">Set a new password</CardTitle>
            </div>
            <CardDescription>
              Your account uses a temporary password. Choose a new one (min 12 chars with upper,
              lower, digit and symbol) before continuing. You may also change the admin email.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="cur">Current (temporary) password</Label>
                <Input
                  id="cur"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newEmail">Admin email (optional change)</Label>
                <Input
                  id="newEmail"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new">New password</Label>
                <Input
                  id="new"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  disabled={loading}
                />
                {newPassword && (
                  <div className="space-y-1">
                    <Progress value={s.score} className="h-1.5" aria-label={`Password strength: ${s.label}`} />
                    <p className="text-xs text-muted-foreground">Strength: {s.label}</p>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
                {loading ? "Saving…" : "Save and continue"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
      <footer className="border-t py-3 px-6 text-center text-xs text-muted-foreground">
        HipnoType Panel · crafted by HipnoType
      </footer>
    </div>
  );
}

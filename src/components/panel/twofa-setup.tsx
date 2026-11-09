"use client";

import { useState } from "react";
import { post, ApiClientError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck, Copy, Download, ArrowRight } from "lucide-react";

interface SetupResponse {
  secret: string;
  uri: string;
  qr: string;
}

/** Optional 2FA setup offered right after the forced password change. */
export function TwoFactorSetup({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<"intro" | "scan" | "verify" | "codes">("intro");
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [token, setToken] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function begin() {
    setLoading(true);
    setError(null);
    try {
      const res = await post<SetupResponse>("/api/auth/2fa/setup");
      setSetup(res);
      setPhase("scan");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not start 2FA setup.");
    } finally {
      setLoading(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!setup) return;
    setLoading(true);
    setError(null);
    try {
      const res = await post<{ recoveryCodes: string[] }>("/api/auth/2fa/enable", {
        secret: setup.secret,
        token: token.trim(),
      });
      setCodes(res.recoveryCodes);
      setPhase("codes");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Verification failed.");
    } finally {
      setLoading(false);
    }
  }

  function downloadCodes() {
    const blob = new Blob(
      [`HipnoType Panel — recovery codes\n\n${codes.join("\n")}\n\nEach code works once. Store them safely.\n`],
      { type: "text/plain" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hypnotype-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-md border shadow-sm">
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
              <CardTitle className="text-xl">Secure your account</CardTitle>
            </div>
            <CardDescription>
              {phase === "intro" && "Two-factor authentication (TOTP) protects your panel even if your password leaks. It takes one minute — we recommend enabling it now."}
              {phase === "scan" && "Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password, Bitwarden…), then enter the 6-digit code."}
              {phase === "codes" && "Save these recovery codes — they are shown only once and each works a single time."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {phase === "intro" && (
              <div className="flex flex-col gap-3">
                <Button onClick={begin} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
                  Enable 2FA now
                </Button>
                <Button variant="ghost" onClick={onDone}>
                  Skip for now <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            )}
            {phase === "scan" && setup && (
              <div className="space-y-4">
                
                <img
                  src={setup.qr}
                  alt="TOTP QR code for HipnoType Panel"
                  className="mx-auto rounded-lg border bg-white p-2 w-[220px] h-[220px]"
                />
                <p className="text-xs text-center text-muted-foreground break-all">
                  Manual key: <code className="bg-muted px-1 rounded">{setup.secret}</code>
                </p>
                <form onSubmit={verify} className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="totp">6-digit code</Label>
                    <Input
                      id="totp"
                      inputMode="numeric"
                      placeholder="123456"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      autoFocus
                      disabled={loading}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading || token.length !== 6}>
                    {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    Verify & enable
                  </Button>
                </form>
              </div>
            )}
            {phase === "codes" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                  {codes.map((c) => (
                    <div key={c} className="rounded border bg-muted/50 px-2 py-1.5 text-center">
                      {c}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      navigator.clipboard.writeText(codes.join("\n"));
                      toast({ title: "Copied", description: "Recovery codes copied to clipboard." });
                    }}
                  >
                    <Copy className="h-4 w-4" aria-hidden /> Copy
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={downloadCodes}>
                    <Download className="h-4 w-4" aria-hidden /> Download
                  </Button>
                </div>
                <Button className="w-full" onClick={onDone}>
                  Continue to panel <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            )}
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </CardContent>
        </Card>
      </main>
      <footer className="border-t py-3 px-6 text-center text-xs text-muted-foreground">
        HipnoType Panel · crafted by HipnoType
      </footer>
    </div>
  );
}

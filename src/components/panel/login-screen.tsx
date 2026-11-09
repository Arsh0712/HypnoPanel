"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { post, ApiClientError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { HypnoMark } from "./logo";
import { EASE_OUT_EXP0 } from "./motion";
import {
  Eye,
  EyeOff,
  Loader2,
  Lock,
  ArrowRight,
  Globe,
  TerminalSquare,
  HardDrive,
  Activity,
  ShieldCheck,
  Fingerprint,
  ScrollText,
} from "lucide-react";

/**
 * Login — the panel's front door.
 * Brand side: ember mesh, slow-spinning spiral, editorial headline.
 * Form side: quiet, focused, with animated 2FA reveal and lockout handling.
 */
export function LoginScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await post("/api/auth/login", {
        email,
        password,
        ...(needsTotp
          ? useRecovery
            ? { recoveryCode: totp.trim() }
            : { totp: totp.trim() }
          : {}),
      });
      toast({ title: "Welcome back", description: "Signed in to HipnoType Panel." });
      onAuthenticated();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === "totp_required" || err.code === "login.2fa_failed") {
          setNeedsTotp(true);
          setError(
            err.code === "totp_required"
              ? "Enter your 2FA code to continue."
              : "That 2FA code was not valid."
          );
        } else {
          setError(err.message);
        }
      } else {
        setError("Network error — please retry.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 grid lg:grid-cols-[1.05fr_1fr]">
        {/* ——— brand side ——— */}
        <section className="relative hidden lg:flex flex-col justify-between overflow-hidden hipno-mesh text-foreground p-10 xl:p-14">
          <div className="absolute inset-0 hipno-grid-bg opacity-60" aria-hidden />

          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE_OUT_EXP0 }}
            className="relative flex items-center gap-3"
          >
            <HypnoMark className="h-10 w-10" />
            <div className="leading-tight">
              <p className="text-lg font-semibold tracking-tight">HipnoType</p>
              <p className="text-[11px] text-muted-foreground tracking-wide">SINGLE-VPS CONTROL PANEL</p>
            </div>
          </motion.div>

          <div className="relative max-w-lg">
            <motion.h1
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, delay: 0.12, ease: EASE_OUT_EXP0 }}
              className="text-[44px] xl:text-[52px] leading-[1.06] font-medium tracking-tight"
            >
              Your server,
              <br />
              <span className="font-[family-name:var(--font-display)] italic text-gradient">
                beautifully
              </span>{" "}
              under control.
            </motion.h1>
            <motion.ul
              initial="hidden"
              animate="show"
              variants={{ show: { transition: { staggerChildren: 0.08, delayChildren: 0.3 } } }}
              className="mt-9 space-y-3.5"
            >
              {[
                { icon: Globe, text: "Websites, SSL, DNS & databases" },
                { icon: TerminalSquare, text: "Real web terminal & file manager" },
                { icon: HardDrive, text: "Backups, cron & Docker apps" },
                { icon: Activity, text: "Live monitoring & alerting" },
                { icon: ShieldCheck, text: "Rotating access URLs, 2FA & audit chain" },
              ].map(({ icon: Icon, text }) => (
                <motion.li
                  key={text}
                  variants={{
                    hidden: { opacity: 0, x: -14 },
                    show: { opacity: 1, x: 0, transition: { duration: 0.45, ease: EASE_OUT_EXP0 } },
                  }}
                  className="flex items-center gap-3.5 text-[14.5px] text-foreground/80"
                >
                  <span className="h-8 w-8 shrink-0 rounded-lg grid place-items-center bg-primary/10 text-primary border border-primary/15">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  {text}
                </motion.li>
              ))}
            </motion.ul>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.55 }}
            className="relative flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px] text-muted-foreground"
          >
            <span className="inline-flex items-center gap-1.5">
              <Fingerprint className="h-3.5 w-3.5" aria-hidden /> Argon2id credentials
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ScrollText className="h-3.5 w-3.5" aria-hidden /> Hash-chained audit log
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Relay or direct access
            </span>
          </motion.div>
        </section>

        {/* ——— form side ——— */}
        <section className="relative flex items-center justify-center p-6 sm:p-10">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: EASE_OUT_EXP0 }}
            className="w-full max-w-[380px]"
          >
            <div className="lg:hidden flex items-center gap-3 mb-10">
              <HypnoMark className="h-9 w-9" />
              <div className="leading-tight">
                <p className="font-semibold tracking-tight">HipnoType</p>
                <p className="text-[10.5px] text-muted-foreground tracking-wide">SINGLE-VPS CONTROL PANEL</p>
              </div>
            </div>

            <h2 className="text-[26px] font-semibold tracking-tight">Sign in</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {needsTotp
                ? "Two-factor authentication is enabled for this account."
                : "Use the credentials from your installer summary."}
            </p>

            <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-[13px]">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-[13px]">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                    className="h-11 pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <AnimatePresence initial={false}>
                {needsTotp && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: EASE_OUT_EXP0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2 pt-1">
                      <Label htmlFor="totp" className="text-[13px]">
                        {useRecovery ? "Recovery code" : "2FA code"}
                      </Label>
                      <Input
                        id="totp"
                        inputMode={useRecovery ? "text" : "numeric"}
                        placeholder={useRecovery ? "XXXXX-XXXXX" : "123456"}
                        value={totp}
                        onChange={(e) => setTotp(e.target.value)}
                        autoFocus
                        disabled={loading}
                        className="h-11 tracking-[0.2em]"
                      />
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                        onClick={() => setUseRecovery((v) => !v)}
                      >
                        {useRecovery ? "Use authenticator code instead" : "Use a recovery code instead"}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3.5 py-2.5 text-[13px] text-destructive"
                  role="alert"
                >
                  {error}
                </motion.p>
              )}

              <Button type="submit" size="lg" className="w-full h-11 font-medium hipno-glow" disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Lock className="h-4 w-4" aria-hidden />
                )}
                {loading ? "Signing in…" : "Sign in"}
                {!loading && <ArrowRight className="h-4 w-4 ml-0.5" aria-hidden />}
              </Button>
            </form>

            <p className="mt-8 text-xs text-muted-foreground leading-relaxed">
              Locked out? Run{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[11px]">hypno reset emailpass</code>{" "}
              on your server console, or rotate the access URL with{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[11px]">hypno rotate</code>.
            </p>
          </motion.div>
        </section>
      </main>

      <footer className="border-t py-3.5 px-6 text-center text-[11.5px] text-muted-foreground">
        HipnoType Panel · crafted by HipnoType · relay access via rotating secret URLs
      </footer>
    </div>
  );
}

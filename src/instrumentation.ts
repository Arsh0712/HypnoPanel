/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Starts the HipnoType background jobs (metrics, cron, backups, monitors, tunnel).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackgroundJobs } = await import("@/lib/background");
    await startBackgroundJobs().catch((e) => console.error("[hipno] background start failed:", e));
  }
}

import { db } from "@/lib/db";
import { getMetricsEngine } from "@/lib/metrics";
import { notifyChannels } from "@/lib/notify";

/**
 * Threshold rule evaluation (spec §5.12) — runs on the background loop.
 * A rule fires when its condition holds continuously for durationMin.
 */

const g = globalThis as unknown as {
  __hipnoRuleState?: Map<string, number>; // ruleId → epoch ms when condition first became true
};

function ruleState(): Map<string, number> {
  if (!g.__hipnoRuleState) g.__hipnoRuleState = new Map();
  return g.__hipnoRuleState;
}

function conditionHolds(
  metric: string,
  operator: string,
  threshold: number,
  snap: { cpu: number; memUsed: number; memTotal: number; diskUsed: number; diskTotal: number; load1: number }
): boolean {
  let value: number;
  switch (metric) {
    case "cpu":
      value = snap.cpu;
      break;
    case "memory":
      value = snap.memTotal ? (snap.memUsed / snap.memTotal) * 100 : 0;
      break;
    case "disk":
      value = snap.diskTotal ? (snap.diskUsed / snap.diskTotal) * 100 : 0;
      break;
    case "load":
      value = snap.load1;
      break;
    case "tunnel":
    case "ssl":
    case "backup":
    case "service":
      return false; // handled by their own modules (tunnel watcher, cert watcher, backup results)
    default:
      return false;
  }
  switch (operator) {
    case ">":
      return value > threshold;
    case "<":
      return value < threshold;
    case "==":
      return Math.abs(value - threshold) < 0.001;
    default:
      return false;
  }
}

export async function evaluateMonitors(): Promise<void> {
  const snap = getMetricsEngine().latest();
  if (!snap) return;
  const rules = await db.monitorRule.findMany({ where: { enabled: true } });
  const state = ruleState();
  const now = Date.now();

  for (const rule of rules) {
    if (!["cpu", "memory", "disk", "load"].includes(rule.metric)) continue;
    const holds = conditionHolds(rule.metric, rule.operator, rule.threshold, snap);
    if (holds) {
      const since = state.get(rule.id) ?? now;
      state.set(rule.id, since);
      const heldMs = now - since;
      if (heldMs >= rule.durationMin * 60_000) {
        const existing = await db.alert.findFirst({
          where: { ruleId: rule.id, state: "firing" },
        });
        if (!existing) {
          const value =
            rule.metric === "memory"
              ? `${((snap.memUsed / Math.max(1, snap.memTotal)) * 100).toFixed(1)}%`
              : rule.metric === "disk"
                ? `${((snap.diskUsed / Math.max(1, snap.diskTotal)) * 100).toFixed(1)}%`
                : rule.metric === "load"
                  ? snap.load1.toFixed(2)
                  : `${snap.cpu.toFixed(1)}%`;
          const message = `${rule.name}: ${rule.metric} is ${value} (threshold ${rule.operator} ${rule.threshold})`;
          await db.alert.create({
            data: {
              ruleId: rule.id,
              ruleName: rule.name,
              severity: rule.severity,
              message,
            },
          });
          const channelIds = rule.channelIds ? (JSON.parse(rule.channelIds) as string[]) : [];
          if (channelIds.length) {
            await notifyChannels(channelIds, `Alert: ${rule.name}`, message);
          }
        }
      }
    } else {
      state.delete(rule.id);
      await db.alert.updateMany({
        where: { ruleId: rule.id, state: "firing" },
        data: { state: "resolved", resolvedAt: new Date() },
      });
    }
  }

  // Tunnel offline watcher (metric == 'tunnel')
  const tunnelRules = rules.filter((r) => r.metric === "tunnel");
  if (tunnelRules.length) {
    const { getTunnelStatus } = await import("@/lib/tunnel-client");
    const st = getTunnelStatus();
    const down = st.status !== "connected";
    for (const rule of tunnelRules) {
      const since = state.get(rule.id) ?? now;
      if (down) {
        state.set(rule.id, since);
        if (now - since >= rule.durationMin * 60_000) {
          const existing = await db.alert.findFirst({ where: { ruleId: rule.id, state: "firing" } });
          if (!existing) {
            const message = `Tunnel is ${st.status}${st.lastError ? ` (${st.lastError})` : ""}`;
            await db.alert.create({
              data: { ruleId: rule.id, ruleName: rule.name, severity: rule.severity, message },
            });
            const channelIds = rule.channelIds ? (JSON.parse(rule.channelIds) as string[]) : [];
            if (channelIds.length) await notifyChannels(channelIds, `Alert: ${rule.name}`, message);
          }
        }
      } else {
        state.delete(rule.id);
        await db.alert.updateMany({
          where: { ruleId: rule.id, state: "firing" },
          data: { state: "resolved", resolvedAt: new Date() },
        });
      }
    }
  }
}

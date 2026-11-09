import { ApiError } from "@/lib/api-error";
import { isValidEmail } from "@/lib/validation";

/**
 * Shared server-side validation for the /api/monitoring routes.
 * (Colocated private module — NOT a route file.)
 */

export const MONITOR_METRICS = ["cpu", "memory", "disk", "load", "tunnel", "ssl", "backup", "service"] as const;
export const MONITOR_OPERATORS = [">", "<", "=="] as const;
export const MONITOR_SEVERITIES = ["info", "warning", "critical"] as const;
export const CHANNEL_TYPES = ["webhook", "telegram", "discord", "smtp"] as const;

/** Metrics expressed in percent (threshold bounds 0–100). */
const PERCENT_METRICS = new Set(["cpu", "memory", "disk"]);

export type MonitorMetric = (typeof MONITOR_METRICS)[number];
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export interface RuleInput {
  name: string;
  metric: MonitorMetric;
  operator: string;
  threshold: number;
  durationMin: number;
  severity: string;
  channelIds: string[];
}

/** Validate a monitor rule payload (create + update share this). */
export function validateRuleInput(raw: Record<string, unknown>): RuleInput {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > 64) {
    throw new ApiError(400, "invalid_name", "Rule name is required (max 64 characters)");
  }

  const metric = raw.metric as MonitorMetric;
  if (!MONITOR_METRICS.includes(metric)) {
    throw new ApiError(
      400,
      "invalid_metric",
      `metric must be one of: ${MONITOR_METRICS.join(", ")}`
    );
  }

  const operator = raw.operator as string;
  if (!MONITOR_OPERATORS.includes(operator as (typeof MONITOR_OPERATORS)[number])) {
    throw new ApiError(400, "invalid_operator", "operator must be one of: >, <, ==");
  }

  const threshold = Number(raw.threshold);
  if (!Number.isFinite(threshold)) {
    throw new ApiError(400, "invalid_threshold", "threshold must be a number");
  }
  if (PERCENT_METRICS.has(metric)) {
    if (threshold < 0 || threshold > 100) {
      throw new ApiError(400, "invalid_threshold", "Percent metrics accept a threshold between 0 and 100");
    }
  } else if (threshold < 0) {
    throw new ApiError(400, "invalid_threshold", "threshold must be zero or greater");
  }

  const durationMin = Number(raw.durationMin ?? 0);
  if (!Number.isInteger(durationMin) || durationMin < 0 || durationMin > 1440) {
    throw new ApiError(400, "invalid_duration", "durationMin must be an integer between 0 and 1440");
  }

  const severity = raw.severity as string;
  if (!MONITOR_SEVERITIES.includes(severity as (typeof MONITOR_SEVERITIES)[number])) {
    throw new ApiError(400, "invalid_severity", "severity must be one of: info, warning, critical");
  }

  let channelIds: string[] = [];
  if (raw.channelIds !== undefined && raw.channelIds !== null) {
    if (!Array.isArray(raw.channelIds)) {
      throw new ApiError(400, "invalid_channels", "channelIds must be an array");
    }
    channelIds = (raw.channelIds as unknown[]).filter(
      (c): c is string => typeof c === "string" && c.length > 0
    );
    if (new Set(channelIds).size !== channelIds.length) {
      throw new ApiError(400, "invalid_channels", "channelIds contains duplicates");
    }
  }

  return { name, metric, operator, threshold, durationMin, severity, channelIds };
}

export interface ChannelInput {
  name: string;
  type: ChannelType;
  config: Record<string, string>;
}

function requireString(v: unknown, label: string, max = 500): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) throw new ApiError(400, "invalid_config", `${label} is required`);
  if (s.length > max) throw new ApiError(400, "invalid_config", `${label} is too long`);
  return s;
}

function requireHttpsUrl(v: unknown, label: string): string {
  const s = requireString(v, label, 1000);
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new ApiError(400, "invalid_config", `${label} must be a valid https:// URL`);
  }
  if (url.protocol !== "https:") {
    throw new ApiError(400, "invalid_config", `${label} must use https://`);
  }
  return s;
}

/** Validate a notification channel payload per type (spec §5.12). */
export function validateChannelInput(raw: Record<string, unknown>): ChannelInput {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > 64) {
    throw new ApiError(400, "invalid_name", "Channel name is required (max 64 characters)");
  }

  const type = raw.type as ChannelType;
  if (!CHANNEL_TYPES.includes(type)) {
    throw new ApiError(
      400,
      "invalid_type",
      `type must be one of: ${CHANNEL_TYPES.join(", ")}`
    );
  }

  const cfgRaw = (raw.config ?? {}) as Record<string, unknown>;
  if (typeof cfgRaw !== "object" || cfgRaw === null) {
    throw new ApiError(400, "invalid_config", "config must be an object");
  }

  const config: Record<string, string> = {};

  switch (type) {
    case "webhook":
    case "discord":
      config.url = requireHttpsUrl(cfgRaw.url, "Webhook URL");
      break;
    case "telegram":
      config.botToken = requireString(cfgRaw.botToken, "Bot token", 300);
      config.chatId = requireString(cfgRaw.chatId, "Chat ID", 100);
      break;
    case "smtp": {
      config.host = requireString(cfgRaw.host, "SMTP host", 253);
      const port = Number(cfgRaw.port ?? 587);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new ApiError(400, "invalid_config", "SMTP port must be between 1 and 65535");
      }
      config.port = String(port);
      config.secure = cfgRaw.secure === true || cfgRaw.secure === "true" ? "true" : "false";
      const from = requireString(cfgRaw.from, "From address", 254);
      if (!isValidEmail(from)) {
        throw new ApiError(400, "invalid_config", "From address must be a valid email");
      }
      config.from = from;
      // Recipient for tests: explicit "to" or fall back to the sender.
      const to = typeof cfgRaw.to === "string" && cfgRaw.to.trim() ? cfgRaw.to.trim() : from;
      if (!isValidEmail(to)) {
        throw new ApiError(400, "invalid_config", "To address must be a valid email");
      }
      config.to = to;
      if (typeof cfgRaw.user === "string" && cfgRaw.user.trim()) config.user = cfgRaw.user.trim();
      if (typeof cfgRaw.pass === "string" && cfgRaw.pass.length) config.pass = cfgRaw.pass;
      break;
    }
  }

  return { name, type, config };
}

/** Parse the stored channelIds JSON of a rule. */
export function parseRuleChannelIds(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

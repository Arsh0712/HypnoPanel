import os from "os";
import { db } from "@/lib/db";
import { PANEL_PORT, RELAY_INTERNAL_URL } from "@/lib/constants";

/**
 * Key/value settings store (JSON values) with typed defaults and an
 * allow-list of user-settable keys (spec §6.2 — hypno config set).
 */

export interface PanelSettings {
  "panel.name": string;
  "panel.branding": string;
  "server.timezone": string;
  "server.hostname": string;
  "network.panelPort": number;
  "network.sshPort": number;
  "session.idleTimeoutMin": number;
  "session.absoluteTimeoutHours": number;
  "access.mode": "relay" | "direct";
  "access.domain": string | null;
  "access.serverId": string | null;
  "access.tunnelSecretEnc": string | null;
  "access.token": string | null;
  "access.tokenCreatedAt": string | null;
  "access.relayUrl": string;
  "terminal.recordingEnabled": boolean;
  "terminal.idleTimeoutMin": number;
  "backup.retention": number;
  "backup.schedule": string;
  "backup.encryption": boolean;
  "update.channel": "stable" | "beta";
  "update.lastCheckAt": string | null;
  "smtp": {
    host: string;
    port: number;
    secure: boolean;
    from: string;
    user: string;
    passEnc?: string;
  };
}

export const DEFAULT_SETTINGS: PanelSettings = {
  "panel.name": "HipnoType Panel",
  "panel.branding": "HipnoType",
  "server.timezone": "Asia/Kolkata",
  "server.hostname": os.hostname(),
  "network.panelPort": PANEL_PORT,
  "network.sshPort": 22,
  "session.idleTimeoutMin": 30,
  "session.absoluteTimeoutHours": 12,
  "access.mode": "relay",
  "access.domain": null,
  "access.serverId": null,
  "access.tunnelSecretEnc": null,
  "access.token": null,
  "access.tokenCreatedAt": null,
  "access.relayUrl": RELAY_INTERNAL_URL,
  "terminal.recordingEnabled": false,
  "terminal.idleTimeoutMin": 15,
  "backup.retention": 10,
  "backup.schedule": "0 3 * * *",
  "backup.encryption": false,
  "update.channel": "stable",
  "update.lastCheckAt": null,
  "smtp": { host: "", port: 587, secure: false, from: "", user: "", passEnc: "" },
};

export type SettingKey = keyof PanelSettings;

/** Keys a user/CLI may set (hypno config set allow-list). */
export const SETTABLE_KEYS: SettingKey[] = [
  "panel.name",
  "panel.branding",
  "server.timezone",
  "network.sshPort",
  "session.idleTimeoutMin",
  "session.absoluteTimeoutHours",
  "terminal.recordingEnabled",
  "terminal.idleTimeoutMin",
  "backup.retention",
  "backup.schedule",
  "backup.encryption",
  "update.channel",
];

export async function getSetting<K extends SettingKey>(
  key: K,
  fallback?: PanelSettings[K]
): Promise<PanelSettings[K]> {
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return fallback !== undefined ? fallback : DEFAULT_SETTINGS[key];
  try {
    return JSON.parse(row.value) as PanelSettings[K];
  } catch {
    return fallback !== undefined ? fallback : DEFAULT_SETTINGS[key];
  }
}

export async function setSetting<K extends SettingKey>(
  key: K,
  value: PanelSettings[K]
): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value: JSON.stringify(value) },
    create: { key, value: JSON.stringify(value) },
  });
}

export async function getAllSettings(): Promise<PanelSettings & Record<string, unknown>> {
  const rows = await db.setting.findMany();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    try {
      merged[row.key] = JSON.parse(row.value);
    } catch {
      /* skip corrupt */
    }
  }
  return merged as PanelSettings & Record<string, unknown>;
}

/** Validate a settable key's new value; returns an error message or null. */
export function validateSettingValue(
  key: string,
  value: unknown
): string | null {
  switch (key) {
    case "panel.name":
    case "panel.branding":
      return typeof value === "string" && value.trim().length >= 3 && value.length <= 64
        ? null
        : "Value must be 3-64 characters";
    case "server.timezone":
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: String(value) });
        return null;
      } catch {
        return "Unknown IANA timezone";
      }
    case "network.sshPort":
      return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65535
        ? null
        : "Port must be 1-65535";
    case "session.idleTimeoutMin":
      return Number.isInteger(value) && (value as number) >= 5 && (value as number) <= 240
        ? null
        : "Idle timeout must be 5-240 minutes";
    case "session.absoluteTimeoutHours":
      return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 168
        ? null
        : "Absolute timeout must be 1-168 hours";
    case "terminal.idleTimeoutMin":
      return Number.isInteger(value) && (value as number) >= 5 && (value as number) <= 120
        ? null
        : "Terminal idle timeout must be 5-120 minutes";
    case "terminal.recordingEnabled":
    case "backup.encryption":
      return typeof value === "boolean" ? null : "Must be true or false";
    case "backup.retention":
      return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 100
        ? null
        : "Retention must be 1-100";
    case "backup.schedule":
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { CronTime } = require("cron-parser");
        new CronTime(String(value));
        return null;
      } catch {
        return "Invalid cron expression";
      }
    case "update.channel":
      return value === "stable" || value === "beta" ? null : "Channel must be stable or beta";
    default:
      return "This setting cannot be changed through this interface";
  }
}

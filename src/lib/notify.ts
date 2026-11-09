import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

/**
 * Notification channels: webhook, Telegram, Discord, SMTP (spec §5.12).
 * Sends are real HTTP/SMTP attempts with honest error reporting.
 */

export interface SendResult {
  ok: boolean;
  error?: string;
}

async function httpPostJson(url: string, body: unknown, timeoutMs = 8000): Promise<SendResult> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

export async function sendToChannel(
  channelId: string,
  title: string,
  message: string
): Promise<SendResult> {
  const ch = await db.notificationChannel.findUnique({ where: { id: channelId } });
  if (!ch) return { ok: false, error: "channel not found" };
  let cfg: Record<string, string> = {};
  try {
    cfg = JSON.parse(decrypt(ch.configEnc));
  } catch {
    return { ok: false, error: "channel config unreadable" };
  }
  switch (ch.type) {
    case "webhook":
      return httpPostJson(cfg.url, { title, message, source: "HipnoType Panel" });
    case "discord":
      return httpPostJson(cfg.url, {
        content: `**${title}** — ${message}`,
      });
    case "telegram":
      return httpPostJson(
        `https://api.telegram.org/bot${cfg.botToken}/sendMessage`,
        { chat_id: cfg.chatId, text: `*${title}*\n${message}`, parse_mode: "Markdown" }
      );
    case "smtp": {
      const dynamic = await import("nodemailer");
      try {
        const transporter = dynamic.createTransport({
          host: cfg.host,
          port: Number(cfg.port || 587),
          secure: String(cfg.secure) === "true",
          auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
          connectionTimeout: 8000,
        });
        await transporter.sendMail({
          from: cfg.from,
          to: cfg.to,
          subject: `[HipnoType] ${title}`,
          text: message,
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "smtp error" };
      }
    }
    default:
      return { ok: false, error: `unknown channel type ${ch.type}` };
  }
}

/** Fire a notification to all channels linked to a rule (comma ids in JSON array). */
export async function notifyChannels(
  channelIds: string[],
  title: string,
  message: string
): Promise<void> {
  await Promise.all(
    channelIds.map(async (id) => {
      const r = await sendToChannel(id, title, message);
      await db.notificationChannel.update({
        where: { id },
        data: { lastTestAt: new Date(), lastTestOk: r.ok },
      });
    })
  );
}

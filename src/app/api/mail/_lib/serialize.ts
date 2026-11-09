import { decrypt } from "@/lib/crypto";
import type { MailDomain, Mailbox, MailAlias, SmtpRelay } from "@prisma/client";

/**
 * Serialisers for /api/mail/** responses. Secrets (mailbox passwords, DKIM
 * private keys, relay credentials) are never returned — only a masked hint
 * (•••• + last 2 chars), per the panel-wide convention.
 */

type MailboxRow = Omit<Mailbox, "passwordEnc">;
type AliasRow = MailAlias;
type DomainRow = Omit<MailDomain, "dkimPrivateEnc"> & {
  mailboxes: MailboxRow[];
  aliases: AliasRow[];
};

export function mailboxToRow(m: Mailbox): MailboxRow {
  const { passwordEnc: _pw, ...row } = m;
  return { ...row };
}

export function domainToRow(
  d: MailDomain & { mailboxes: Mailbox[]; aliases: MailAlias[] }
): DomainRow {
  const { dkimPrivateEnc: _priv, ...row } = d;
  return {
    ...row,
    mailboxes: d.mailboxes.map(mailboxToRow),
    aliases: d.aliases.map((a) => ({ ...a })),
  };
}

function maskPassword(passwordEnc: string | null): string | null {
  if (!passwordEnc) return null;
  try {
    const p = decrypt(passwordEnc);
    return `••••${p.slice(-2)}`;
  } catch {
    return "••••";
  }
}

export interface RelayInfo {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string | null;
  passwordMasked: string | null;
  hasPassword: boolean;
  fromEmail: string | null;
  enabled: boolean;
  lastTestAt: Date | null;
  lastTestOk: boolean | null;
}

export function relayToInfo(r: SmtpRelay): RelayInfo {
  return {
    id: r.id,
    name: r.name,
    host: r.host,
    port: r.port,
    username: r.username,
    passwordMasked: maskPassword(r.passwordEnc),
    hasPassword: !!r.passwordEnc,
    fromEmail: r.fromEmail,
    enabled: r.enabled,
    lastTestAt: r.lastTestAt,
    lastTestOk: r.lastTestOk,
  };
}

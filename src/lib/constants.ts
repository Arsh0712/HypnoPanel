import path from "path";

/** HipnoType Panel — shared constants. */
export const PANEL_NAME = "HipnoType Panel";
export const VENDOR = "HipnoType";
export const PANEL_VERSION = "1.2.0";
export const REPO_URL = "https://github.com/Arsh0712/HypnoPanel";
export const MAIN_DOMAIN = "hypnotype.mangocloud.cyou";

/** Project root (= cwd of the Next.js server). */
export const ROOT_DIR = process.cwd();

/**
 * Panel data directories. On a VPS deployment HIPNO_STATE_DIR points at
 * /var/lib/hipno (see installer + deploy/systemd units); in the workspace
 * everything lives under <repo>/data.
 */
export const DATA_DIR = process.env.HIPNO_STATE_DIR
  ? path.resolve(process.env.HIPNO_STATE_DIR)
  : path.join(ROOT_DIR, "data");
export const SITES_DIR = path.join(DATA_DIR, "sites");
export const DATABASES_DIR = path.join(DATA_DIR, "databases");
export const BACKUPS_DIR = path.join(DATA_DIR, "backups");
export const TRASH_DIR = path.join(DATA_DIR, "trash");
export const SECRET_KEY_FILE = path.join(DATA_DIR, "secret.key");

/** Local panel port (Next.js dev server in this environment). */
export const PANEL_PORT = Number(process.env.PORT || 3000);

/** HipnoType Relay mini-service (runs locally on 3005 in this environment;
 * on a VPS deployment it runs on the main domain — see docs/RELAY.md). */
export const RELAY_INTERNAL_URL = process.env.HIPNO_RELAY_URL || "http://127.0.0.1:3005";
export const RELAY_PUBLIC_PORT = 3005;

/** Session cookie. */
export const SESSION_COOKIE = "hipno_session";

/** Access-URL token rules. */
export const TOKEN_LEN = 32;
export const CUSTOM_SLUG_MIN = 16;
export const CUSTOM_SLUG_MAX = 64;

export const ROLES = ["admin", "developer", "viewer"] as const;
export type Role = (typeof ROLES)[number];

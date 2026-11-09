/**
 * HipnoType Panel — one-click app catalogue (spec §5.5).
 *
 * Original template definitions written for HipnoType: every compose file below
 * was authored for this panel (version-less modern Compose, restart policies,
 * named volumes and healthchecks where sensible). Each template declares its
 * environment schema; `{{KEY}}` placeholders in the compose YAML are rendered
 * at deploy time from the provided env plus server-generated secrets.
 */

export type EnvVarType = "string" | "secret" | "port" | "number";

export interface EnvVarSpec {
  key: string;
  label: string;
  type: EnvVarType;
  default?: string;
  required: boolean;
  hint?: string;
}

export type TemplateCategory =
  | "cms"
  | "automation"
  | "security"
  | "files"
  | "dev"
  | "database"
  | "analytics";

export interface AppTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  /** lucide icon name, e.g. 'Globe' */
  icon: string;
  version: string;
  env: EnvVarSpec[];
  /** human-readable exposed ports */
  ports: string[];
  /** human-readable persistent volumes */
  volumes: string[];
  healthCheck?: string;
  /** compose YAML template with {{ENV_KEY}} placeholders */
  compose: string;
}

export const TEMPLATE_CATEGORIES: { id: TemplateCategory; label: string }[] = [
  { id: "cms", label: "CMS" },
  { id: "automation", label: "Automation" },
  { id: "security", label: "Security" },
  { id: "files", label: "Files" },
  { id: "dev", label: "Development" },
  { id: "database", label: "Databases" },
  { id: "analytics", label: "Analytics" },
];

export const APP_TEMPLATES: AppTemplate[] = [
  // ---------------------------------------------------------------- WordPress
  {
    id: "wordpress",
    name: "WordPress",
    description:
      "The classic blogging & CMS platform with a bundled MySQL database and generated credentials.",
    category: "cms",
    icon: "Globe",
    version: "6 (apache)",
    env: [
      { key: "PORT", label: "Host port", type: "port", default: "8080", required: true },
      {
        key: "WORDPRESS_DB_PASSWORD",
        label: "Database password",
        type: "secret",
        required: true,
      },
      {
        key: "MYSQL_ROOT_PASSWORD",
        label: "MySQL root password",
        type: "secret",
        required: true,
      },
    ],
    ports: ["{{PORT}} → 80 (HTTP)"],
    volumes: ["wordpress_data → /var/www/html", "wordpress_db_data → /var/lib/mysql"],
    healthCheck: "WordPress answers on / (Apache)",
    compose: `services:
  wordpress:
    image: wordpress:6-apache
    restart: unless-stopped
    environment:
      WORDPRESS_DB_HOST: db
      WORDPRESS_DB_NAME: wordpress
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: {{WORDPRESS_DB_PASSWORD}}
    ports:
      - "{{PORT}}:80"
    volumes:
      - wordpress_data:/var/www/html
    depends_on:
      db:
        condition: service_healthy
  db:
    image: mysql:8
    restart: unless-stopped
    environment:
      MYSQL_DATABASE: wordpress
      MYSQL_USER: wordpress
      MYSQL_PASSWORD: {{WORDPRESS_DB_PASSWORD}}
      MYSQL_ROOT_PASSWORD: {{MYSQL_ROOT_PASSWORD}}
    volumes:
      - wordpress_db_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 10

volumes:
  wordpress_data:
  wordpress_db_data:
`,
  },

  // ---------------------------------------------------------------- Ghost
  {
    id: "ghost",
    name: "Ghost",
    description:
      "Modern publishing platform for blogs, newsletters and paid memberships. SQLite storage on a persistent volume.",
    category: "cms",
    icon: "Ghost",
    version: "5",
    env: [
      {
        key: "GHOST_URL",
        label: "Public URL",
        type: "string",
        default: "http://localhost:2368",
        required: true,
        hint: "The URL visitors use — change to your domain before going live",
      },
      { key: "PORT", label: "Host port", type: "port", default: "2368", required: true },
    ],
    ports: ["{{PORT}} → 2368 (HTTP)"],
    volumes: ["ghost_data → /var/lib/ghost/content"],
    healthCheck: "GET / returns the blog",
    compose: `services:
  ghost:
    image: ghost:5
    restart: unless-stopped
    environment:
      url: {{GHOST_URL}}
      database__client: sqlite3
      database__connection__filename: /var/lib/ghost/content/data/ghost.db
    ports:
      - "{{PORT}}:2368"
    volumes:
      - ghost_data:/var/lib/ghost/content

volumes:
  ghost_data:
`,
  },

  // ---------------------------------------------------------------- n8n
  {
    id: "n8n",
    name: "n8n",
    description:
      "Workflow automation with a visual editor. 400+ integrations, credentials encrypted at rest with a generated key.",
    category: "automation",
    icon: "Workflow",
    version: "latest",
    env: [
      {
        key: "N8N_ENCRYPTION_KEY",
        label: "Credential encryption key",
        type: "secret",
        required: true,
        hint: "Encrypts stored workflow credentials — back it up",
      },
      {
        key: "GENERIC_TIMEZONE",
        label: "Timezone",
        type: "string",
        default: "UTC",
        required: true,
      },
      { key: "PORT", label: "Host port", type: "port", default: "5678", required: true },
    ],
    ports: ["{{PORT}} → 5678 (HTTP)"],
    volumes: ["n8n_data → /home/node/.n8n"],
    healthCheck: "GET /healthz",
    compose: `services:
  n8n:
    image: docker.n8n.io/n8nio/n8n
    restart: unless-stopped
    environment:
      N8N_ENCRYPTION_KEY: {{N8N_ENCRYPTION_KEY}}
      GENERIC_TIMEZONE: {{GENERIC_TIMEZONE}}
    ports:
      - "{{PORT}}:5678"
    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  n8n_data:
`,
  },

  // ---------------------------------------------------------------- Uptime Kuma
  {
    id: "uptime-kuma",
    name: "Uptime Kuma",
    description:
      "Self-hosted uptime monitor with status pages, notifications and rich charts for HTTP/TCP/ping checks.",
    category: "analytics",
    icon: "Activity",
    version: "1",
    env: [{ key: "PORT", label: "Host port", type: "port", default: "3001", required: true }],
    ports: ["{{PORT}} → 3001 (HTTP)"],
    volumes: ["uptime_kuma_data → /app/data"],
    healthCheck: "Web UI on /",
    compose: `services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    restart: unless-stopped
    ports:
      - "{{PORT}}:3001"
    volumes:
      - uptime_kuma_data:/app/data

volumes:
  uptime_kuma_data:
`,
  },

  // ---------------------------------------------------------------- Vaultwarden
  {
    id: "vaultwarden",
    name: "Vaultwarden",
    description:
      "Lightweight Bitwarden-compatible password manager server. The admin panel is protected by a generated token.",
    category: "security",
    icon: "ShieldCheck",
    version: "latest",
    env: [
      {
        key: "ADMIN_TOKEN",
        label: "Admin panel token",
        type: "secret",
        required: true,
        hint: "Required for the /admin panel",
      },
      {
        key: "SIGNUPS_ALLOWED",
        label: "Allow signups",
        type: "string",
        default: "true",
        required: true,
        hint: "Set to false after creating your account",
      },
      { key: "PORT", label: "Host port", type: "port", default: "8222", required: true },
    ],
    ports: ["{{PORT}} → 80 (HTTP)"],
    volumes: ["vaultwarden_data → /data"],
    healthCheck: "Web UI on /",
    compose: `services:
  vaultwarden:
    image: vaultwarden/server:latest
    restart: unless-stopped
    environment:
      ADMIN_TOKEN: {{ADMIN_TOKEN}}
      SIGNUPS_ALLOWED: {{SIGNUPS_ALLOWED}}
    ports:
      - "{{PORT}}:80"
    volumes:
      - vaultwarden_data:/data

volumes:
  vaultwarden_data:
`,
  },

  // ---------------------------------------------------------------- Nextcloud
  {
    id: "nextcloud",
    name: "Nextcloud",
    description:
      "Self-hosted files, calendars and collaboration hub, provisioned with a PostgreSQL database and admin account.",
    category: "files",
    icon: "Cloud",
    version: "29",
    env: [
      { key: "PORT", label: "Host port", type: "port", default: "8081", required: true },
      {
        key: "NEXTCLOUD_ADMIN_USER",
        label: "Admin username",
        type: "string",
        default: "admin",
        required: true,
      },
      {
        key: "NEXTCLOUD_ADMIN_PASSWORD",
        label: "Admin password",
        type: "secret",
        required: true,
      },
      {
        key: "DB_PASSWORD",
        label: "PostgreSQL password",
        type: "secret",
        required: true,
      },
    ],
    ports: ["{{PORT}} → 80 (HTTP)"],
    volumes: ["nextcloud_data → /var/www/html", "nextcloud_db_data → /var/lib/postgresql/data"],
    healthCheck: "GET /status.php",
    compose: `services:
  nextcloud:
    image: nextcloud:29
    restart: unless-stopped
    environment:
      POSTGRES_HOST: db
      POSTGRES_DB: nextcloud
      POSTGRES_USER: nextcloud
      POSTGRES_PASSWORD: {{DB_PASSWORD}}
      NEXTCLOUD_ADMIN_USER: {{NEXTCLOUD_ADMIN_USER}}
      NEXTCLOUD_ADMIN_PASSWORD: {{NEXTCLOUD_ADMIN_PASSWORD}}
    ports:
      - "{{PORT}}:80"
    volumes:
      - nextcloud_data:/var/www/html
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_DB: nextcloud
      POSTGRES_USER: nextcloud
      POSTGRES_PASSWORD: {{DB_PASSWORD}}
    volumes:
      - nextcloud_db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nextcloud"]
      interval: 10s
      timeout: 5s
      retries: 10

volumes:
  nextcloud_data:
  nextcloud_db_data:
`,
  },

  // ---------------------------------------------------------------- Gitea
  {
    id: "gitea",
    name: "Gitea",
    description:
      "Painless self-hosted Git service with web UI, issues and pull requests. SQLite storage with generated secrets.",
    category: "dev",
    icon: "GitBranch",
    version: "1",
    env: [
      { key: "PORT", label: "Host port (web)", type: "port", default: "3200", required: true },
      {
        key: "SSH_PORT",
        label: "Host port (git ssh)",
        type: "port",
        default: "2222",
        required: true,
      },
      {
        key: "ROOT_URL",
        label: "Root URL",
        type: "string",
        default: "http://localhost:3200/",
        required: true,
      },
      {
        key: "GITEA_SECRET_KEY",
        label: "Secret key",
        type: "secret",
        required: true,
      },
      {
        key: "GITEA_INTERNAL_TOKEN",
        label: "Internal API token",
        type: "secret",
        required: true,
      },
    ],
    ports: ["{{PORT}} → 3000 (HTTP)", "{{SSH_PORT}} → 22 (SSH)"],
    volumes: ["gitea_data → /data"],
    healthCheck: "GET /api/healthz",
    compose: `services:
  gitea:
    image: gitea/gitea:1
    restart: unless-stopped
    environment:
      GITEA__database__DB_TYPE: sqlite3
      GITEA__server__ROOT_URL: {{ROOT_URL}}
      GITEA__server__SSH_PORT: {{SSH_PORT}}
      GITEA__security__SECRET_KEY: {{GITEA_SECRET_KEY}}
      GITEA__security__INTERNAL_TOKEN: {{GITEA_INTERNAL_TOKEN}}
    ports:
      - "{{PORT}}:3000"
      - "{{SSH_PORT}}:22"
    volumes:
      - gitea_data:/data

volumes:
  gitea_data:
`,
  },

  // ---------------------------------------------------------------- PostgreSQL
  {
    id: "postgresql",
    name: "PostgreSQL",
    description:
      "The relational database engine, provisioned with its own superuser password and a persistent data volume.",
    category: "database",
    icon: "Database",
    version: "16",
    env: [
      {
        key: "POSTGRES_DB",
        label: "Database name",
        type: "string",
        default: "app",
        required: true,
      },
      {
        key: "POSTGRES_USER",
        label: "User",
        type: "string",
        default: "app",
        required: true,
      },
      {
        key: "POSTGRES_PASSWORD",
        label: "Password",
        type: "secret",
        required: true,
      },
      { key: "PORT", label: "Host port", type: "port", default: "5432", required: true },
    ],
    ports: ["{{PORT}} → 5432 (PostgreSQL)"],
    volumes: ["postgres_data → /var/lib/postgresql/data"],
    healthCheck: "pg_isready inside the container",
    compose: `services:
  postgresql:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_DB: {{POSTGRES_DB}}
      POSTGRES_USER: {{POSTGRES_USER}}
      POSTGRES_PASSWORD: {{POSTGRES_PASSWORD}}
    ports:
      - "{{PORT}}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U {{POSTGRES_USER}} -d {{POSTGRES_DB}}"]
      interval: 10s
      timeout: 5s
      retries: 10

volumes:
  postgres_data:
`,
  },

  // ---------------------------------------------------------------- MySQL
  {
    id: "mysql",
    name: "MySQL",
    description:
      "Widely used open-source relational database with an application user plus a generated root password.",
    category: "database",
    icon: "Table2",
    version: "8",
    env: [
      {
        key: "MYSQL_DATABASE",
        label: "Database name",
        type: "string",
        default: "app",
        required: true,
      },
      {
        key: "MYSQL_USER",
        label: "Application user",
        type: "string",
        default: "app",
        required: true,
      },
      {
        key: "MYSQL_PASSWORD",
        label: "Application password",
        type: "secret",
        required: true,
      },
      {
        key: "MYSQL_ROOT_PASSWORD",
        label: "Root password",
        type: "secret",
        required: true,
      },
      { key: "PORT", label: "Host port", type: "port", default: "3306", required: true },
    ],
    ports: ["{{PORT}} → 3306 (MySQL)"],
    volumes: ["mysql_data → /var/lib/mysql"],
    healthCheck: "mysqladmin ping inside the container",
    compose: `services:
  mysql:
    image: mysql:8
    restart: unless-stopped
    environment:
      MYSQL_DATABASE: {{MYSQL_DATABASE}}
      MYSQL_USER: {{MYSQL_USER}}
      MYSQL_PASSWORD: {{MYSQL_PASSWORD}}
      MYSQL_ROOT_PASSWORD: {{MYSQL_ROOT_PASSWORD}}
    ports:
      - "{{PORT}}:3306"
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 10

volumes:
  mysql_data:
`,
  },

  // ---------------------------------------------------------------- Redis
  {
    id: "redis",
    name: "Redis",
    description:
      "In-memory data store for caches, queues and sessions, secured with a generated password and AOF persistence.",
    category: "database",
    icon: "Zap",
    version: "7",
    env: [
      {
        key: "REDIS_PASSWORD",
        label: "Password (requirepass)",
        type: "secret",
        required: true,
      },
      { key: "PORT", label: "Host port", type: "port", default: "6379", required: true },
    ],
    ports: ["{{PORT}} → 6379 (Redis)"],
    volumes: ["redis_data → /data"],
    healthCheck: "redis-cli authenticated PING",
    compose: `services:
  redis:
    image: redis:7
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "{{REDIS_PASSWORD}}"]
    ports:
      - "{{PORT}}:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a {{REDIS_PASSWORD}} ping | grep PONG"]
      interval: 10s
      timeout: 5s
      retries: 10

volumes:
  redis_data:
`,
  },

  // ---------------------------------------------------------------- MinIO
  {
    id: "minio",
    name: "MinIO",
    description:
      "S3-compatible high-performance object storage with its own console, secured by generated root credentials.",
    category: "files",
    icon: "HardDrive",
    version: "latest",
    env: [
      {
        key: "MINIO_ROOT_USER",
        label: "Root user (access key)",
        type: "string",
        default: "hipno-minio",
        required: true,
      },
      {
        key: "MINIO_ROOT_PASSWORD",
        label: "Root password (secret key)",
        type: "secret",
        required: true,
      },
      { key: "PORT", label: "Host port (API)", type: "port", default: "9000", required: true },
      { key: "CONSOLE_PORT", label: "Host port (console)", type: "port", default: "9001", required: true },
    ],
    ports: ["{{PORT}} → 9000 (S3 API)", "{{CONSOLE_PORT}} → 9001 (Console)"],
    volumes: ["minio_data → /data"],
    healthCheck: "mc ready local",
    compose: `services:
  minio:
    image: minio/minio
    restart: unless-stopped
    command: ["server", "/data", "--console-address", ":9001"]
    environment:
      MINIO_ROOT_USER: {{MINIO_ROOT_USER}}
      MINIO_ROOT_PASSWORD: {{MINIO_ROOT_PASSWORD}}
    ports:
      - "{{PORT}}:9000"
      - "{{CONSOLE_PORT}}:9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 15s
      timeout: 5s
      retries: 10

volumes:
  minio_data:
`,
  },

  // ---------------------------------------------------------------- Plausible
  {
    id: "plausible",
    name: "Plausible",
    description:
      "Privacy-first, cookie-free web analytics. Ships with PostgreSQL and ClickHouse sidecars and a generated key base.",
    category: "analytics",
    icon: "BarChart3",
    version: "community edition",
    env: [
      {
        key: "BASE_URL",
        label: "Public URL",
        type: "string",
        default: "http://localhost:8000",
        required: true,
      },
      {
        key: "SECRET_KEY_BASE",
        label: "Secret key base",
        type: "secret",
        required: true,
        hint: "Encrypts sessions — long and random",
      },
      {
        key: "DB_PASSWORD",
        label: "PostgreSQL password",
        type: "secret",
        required: true,
      },
      { key: "PORT", label: "Host port", type: "port", default: "8000", required: true },
    ],
    ports: ["{{PORT}} → 8000 (HTTP)"],
    volumes: [
      "plausible_db_data → /var/lib/postgresql/data",
      "plausible_ch_data → /var/lib/clickhouse",
    ],
    healthCheck: "GET /api/health",
    compose: `services:
  plausible:
    image: plausibler/plausible
    restart: unless-stopped
    command: ["sh", "-c", "sleep 10 && /entrypoint.sh db createdb && /entrypoint.sh db migrate && /entrypoint.sh run"]
    environment:
      BASE_URL: {{BASE_URL}}
      SECRET_KEY_BASE: {{SECRET_KEY_BASE}}
      DATABASE_URL: postgres://plausible:{{DB_PASSWORD}}@db:5432/plausible
      CLICKHOUSE_DATABASE: plausible
      CLICKHOUSE_EVENTS_DATABASE: plausible_events
    ports:
      - "{{PORT}}:8000"
    depends_on:
      db:
        condition: service_healthy
      clickhouse:
        condition: service_healthy
  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_DB: plausible
      POSTGRES_USER: plausible
      POSTGRES_PASSWORD: {{DB_PASSWORD}}
    volumes:
      - plausible_db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U plausible"]
      interval: 10s
      timeout: 5s
      retries: 10
  clickhouse:
    image: clickhouse/clickhouse-server:24-alpine
    restart: unless-stopped
    volumes:
      - plausible_ch_data:/var/lib/clickhouse
    ulimits:
      nofile:
        soft: 262144
        hard: 262144
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries", "1", "--spider", "http://localhost:8123/ping"]
      interval: 10s
      timeout: 5s
      retries: 10

volumes:
  plausible_db_data:
  plausible_ch_data:
`,
  },

  // ---------------------------------------------------------------- Metabase
  {
    id: "metabase",
    name: "Metabase",
    description:
      "Business intelligence dashboards and ad-hoc queries over your databases. Embedded H2 storage for a light start.",
    category: "analytics",
    icon: "PieChart",
    version: "latest",
    env: [
      {
        key: "MB_DB_TYPE",
        label: "Application database",
        type: "string",
        default: "h2",
        required: true,
        hint: "h2 keeps everything in a local volume",
      },
      { key: "PORT", label: "Host port", type: "port", default: "3100", required: true },
    ],
    ports: ["{{PORT}} → 3000 (HTTP)"],
    volumes: ["metabase_data → /metabase-data"],
    healthCheck: "GET /api/health",
    compose: `services:
  metabase:
    image: metabase/metabase
    restart: unless-stopped
    environment:
      MB_DB_TYPE: {{MB_DB_TYPE}}
    ports:
      - "{{PORT}}:3000"
    volumes:
      - metabase_data:/metabase-data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 15s
      timeout: 5s
      retries: 10

volumes:
  metabase_data:
`,
  },

  // ---------------------------------------------------------------- Grafana
  {
    id: "grafana",
    name: "Grafana",
    description:
      "Observability dashboards and alerting for metrics, logs and traces with a generated admin password.",
    category: "analytics",
    icon: "Gauge",
    version: "latest",
    env: [
      {
        key: "GF_ADMIN_USER",
        label: "Admin username",
        type: "string",
        default: "admin",
        required: true,
      },
      {
        key: "GF_ADMIN_PASSWORD",
        label: "Admin password",
        type: "secret",
        required: true,
      },
      { key: "PORT", label: "Host port", type: "port", default: "3300", required: true },
    ],
    ports: ["{{PORT}} → 3000 (HTTP)"],
    volumes: ["grafana_data → /var/lib/grafana"],
    healthCheck: "GET /api/health",
    compose: `services:
  grafana:
    image: grafana/grafana
    restart: unless-stopped
    environment:
      GF_SECURITY_ADMIN_USER: {{GF_ADMIN_USER}}
      GF_SECURITY_ADMIN_PASSWORD: {{GF_ADMIN_PASSWORD}}
    ports:
      - "{{PORT}}:3000"
    volumes:
      - grafana_data:/var/lib/grafana
    healthcheck:
      test: ["CMD-SHELL", "wget --no-verbose --tries 1 --spider http://localhost:3000/api/health || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 10

volumes:
  grafana_data:
`,
  },

  // ---------------------------------------------------------------- Adminer
  {
    id: "adminer",
    name: "Adminer",
    description:
      "Single-file database management UI for MySQL, PostgreSQL, SQLite, MongoDB and more. No persistent storage needed.",
    category: "dev",
    icon: "Table",
    version: "latest",
    env: [
      {
        key: "ADMINER_DEFAULT_SERVER",
        label: "Default server",
        type: "string",
        default: "localhost",
        required: true,
        hint: "Hostname pre-filled on the login form",
      },
      { key: "PORT", label: "Host port", type: "port", default: "9090", required: true },
    ],
    ports: ["{{PORT}} → 8080 (HTTP)"],
    volumes: [],
    healthCheck: "GET / (PHP)",
    compose: `services:
  adminer:
    image: adminer
    restart: unless-stopped
    environment:
      ADMINER_DEFAULT_SERVER: {{ADMINER_DEFAULT_SERVER}}
    ports:
      - "{{PORT}}:8080"
`,
  },
];

export function findTemplate(id: string): AppTemplate | undefined {
  return APP_TEMPLATES.find((t) => t.id === id);
}

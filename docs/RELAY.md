# Deploying the HipnoType Relay

> The relay gives every panel install an IPv4-reachable, TLS-terminated, secret-path access URL
> through an **outbound-only** tunnel (spec §4.3). Reference implementation:
> `mini-services/relay/index.ts` (production unit: `deploy/systemd/hipno-relay.service`).

## 1. DNS (main domain server)

```
hypnotype.mangocloud.cyou.   A     <IPv4 of the relay server>
hypnotype.mangocloud.cyou.   AAAA  <IPv6, optional>
```

No panel server ever needs DNS or an inbound port — the panel connects *out* to the relay.

## 2. Caddy (TLS termination on the relay host)

```caddyfile
hypnotype.mangocloud.cyou {
    encode gzip
    # Relay service (3005)
    handle /api/v1/* { reverse_proxy 127.0.0.1:3005 }
    handle /tunnel-socket { reverse_proxy 127.0.0.1:3005 }
    handle /server/panel/* { reverse_proxy 127.0.0.1:3005 }
    handle /healthz { reverse_proxy 127.0.0.1:3005 }
    handle /metricsz { reverse_proxy 127.0.0.1:3005 }
    # Everything else: marketing/download host (docs, install.sh, releases)
    root * /srv/hypnotype
    file_server
    header /install.sh Content-Type text/plain
}
```

Certificates are obtained automatically (ACME). Pin the panel→relay connection to this host
(HTTPS + known certificate) in the VPS deployment.

## 3. Firewall (relay host)

```
nft add rule inet filter input tcp dport { 80, 443 } accept
nft add rule inet filter input tcp dport 22 accept  # SSH — restrict source ideally
```

Only 80/443 (+ SSH) need to be open. The tunnel is an outbound WSS from each panel.

## 4. Service

```ini
# /etc/systemd/system/hipno-relay.service
[Unit]
Description=HipnoType Relay
After=network.target

[Service]
Type=simple
User=hipno-relay
WorkingDirectory=/opt/hipno-relay
ExecStart=/usr/bin/bun /opt/hipno-relay/index.ts   # or the compiled binary
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/hipno-relay/data

[Install]
WantedBy=multi-user.target
```

## 5. Store, health, metrics, backups

- Store: `data/relay-store.json` — **only** `serverId`, sha256(tokenHash) entries (active/revoked),
  sha256(tunnelSecret), sha256(nonce), label, version, online, lastSeen. **Never** panel
  passwords, sessions, or request bodies.
- Health: `GET /healthz` → `{"ok":true,"servers":N,"online":M}` (use in monitoring).
- Metrics: `GET /metricsz` — Prometheus counters/gauges
  (`hipno_relay_registrations_total`, `hipno_relay_tunnels_online`,
  `hipno_relay_requests_proxied_total`, `hipno_relay_unknown_token_total`,
  `hipno_relay_banned_ips_total`).
- Backups: copy `data/relay-store.json` on a schedule (it is the routing identity of every
  registered panel; losing it forces re-registration via the installer).

## 6. Hardening & trust model

- Unknown/rotated/revoked tokens return a **byte-identical 404** with a normalized 35–60 ms delay —
  no token enumeration.
- Per-IP rate limiting (60 req/min) and temporary bans after 20 unknown-token hits in 5 minutes.
- Tunnels authenticate with the tunnel secret (stored hashed); heartbeats every 15 s; silent
  tunnels go offline after 45 s; offline servers answer 503 on their token paths.
- Rotation is two-phase: the relay activates the new token only after the panel commits
  (`POST /api/v1/rotate` with the current token + Bearer secret); commit failure rolls back.
- **Trust model (documented for users)**: in relay mode TLS terminates at the relay, which can
  technically see traffic (same trust position as Cloudflare Tunnel). Direct mode
  (`hypno direct enable --domain panel.example.com`) gives the panel its own certificate on
  443 under the same secret path; per-server SNI/TCP passthrough is possible with dedicated
  subdomains (trade-off: no shared-domain routing, documented in docs/DECISIONS.md).
- Anyone operating the relay is in the trust path — run it on infrastructure you control.

## 7. Upgrades

`systemctl stop hipno-relay && cp index.ts index.ts.bak && install new index.ts && systemctl start hipno-relay`
— the JSON store is forward-compatible; verify `curl -s localhost:3005/healthz`.

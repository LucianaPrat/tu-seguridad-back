# Production deploy roadmap

Target: PM2 on the EC2 instance that already runs face-api, shipped by CodeDeploy from GitHub
Actions, copying the face-api pipeline (`/home/ec2-user/apps/face-auth/face-auth-app`,
`appspec.yml` + `scripts/*.sh` + `.github/workflows/deploy.yml`).

Status as of 2026-11-14: **phase 1 done**, phases 2+ not started.

## Roadmap

Each phase is gated on the previous one. Opt-in features stay off until their phase. Detail and
rationale for each item live in the numbered sections below the roadmap.

### Open decisions (block phases 2–4)

- [x] **API domain**: `api.paulina.frascarelli.com.uy`. Public DNS A record to `52.86.65.164`.
      nginx on the EC2 terminates TLS and proxies to `localhost:3001`.
- [x] **Front end**: `paulina.frascarelli.com.uy`, on S3 + CloudFront. The browser calls
      `paulina.frascarelli.com.uy/api/...`, and a CloudFront behavior forwards `/api/*` to the
      origin `api.paulina.frascarelli.com.uy`. Same origin for the browser: see section 7.
- [x] **Node version**: 22 for both apps. face-api migrated 2026-11-15 (its `start.sh` runs
      `nvm use 22` and starts with `--interpreter "$(command -v node)"`). No more node split.
- [x] **Database host**: the same MySQL server face-api uses (its `DB_HOST` secret), in a
      separate database with its own user. Decided 2026-11-15. The EC2 already reaches that
      server, so `prisma migrate deploy` can run from the `AfterInstall` hook.
- [x] **Deploy trigger**: both, like face-api: `push` to `main` (with `paths-ignore` for docs)
      plus `workflow_dispatch`. Decided 2026-11-15. Add a `concurrency` group so two pushes
      don't race the same CodeDeploy group.
- [x] **Live view**: later, not in v1. Decided 2026-11-15. Phase 6 is out of scope:
      `MEDIAMTX_ENABLED=false`, no MediaMTX on the EC2, no RTSP port forward.
- [x] **socket.io through CloudFront**: later, not in v1. Decided 2026-11-15. Until it is
      fixed (section 7, gotcha 1), real-time events don't reach the browser in production;
      the front end must work without the socket (no hard dependency on `/events`).

### Phase 1: EC2 to DVR connectivity (done 2026-11-14)

- [x] Option E' chosen under the [constraints](#constraints-decided-2026-11-14).
- [x] DVR DDNS through FreeDNS (dyndns2), status normal, record resolves to the site's public IP.
- [x] F680 rule `HiLookISAPI`: TCP WAN 18080 to `192.168.1.250:80`, source pinned to
      `52.86.65.164`.
- [x] Positive test from the EC2 (`401` digest challenge, then `deviceInfo` with credentials).
- [x] Negative test from a non-EC2 IP: blocked.
- [x] `52.86.65.164` confirmed as an Elastic IP.
- [ ] Rotate the FreeDNS password that leaked during setup, and update it on the DVR.
- [ ] Move the subdomain to a FreeDNS account used only for this DVR.
- [ ] DHCP reservation or static IP on the DVR for `192.168.1.250`.
- [ ] Keep the hostname out of the repo. It lives in the DB as the DVR's `connection.url`
      (`http://<ddns-host>:18080`).

### Shared host with face-api (cross-cutting, settle before phase 3)

Detail in [section 2](#2-conflicts-with-face-api-on-the-shared-host).

- [ ] `PORT=3001`, since face-api owns 3000.
- [ ] Node 22 on the server: `nvm alias default 22` (so new shells and the PM2 boot unit get
      22, not only the session where `nvm use 22` ran), PM2 installed globally under 22, and
      `pm2 -v` / `pm2 info <face-auth app>` showing node 22.
- [ ] PM2 name prefix `tu-seguridad-api-v*`, disjoint from `face-auth-app-v*`.
- [ ] Don't deploy this repo's `ops/otel-collector`.
      `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318`, `OTEL_SERVICE_NAME=tu-seguridad-back`.
- [ ] `FACE_AUTH_API_URL=https://api.face-auth.me`, not `localhost:3000`. Ask the face-auth team
      how the 1 req/s per-IP limit counts calls coming from their own host.
- [ ] Capacity check on the EC2 (`free -m`, `nproc`, `pm2 monit` under face-api's load). Budget:
      512M for this app (MediaMTX deferred with phase 6). Resize the instance if headroom is
      thin.

### Phase 2: Database

- [ ] On face-api's MySQL server: `CREATE DATABASE tu_seguridad` (utf8mb4) and a dedicated
      user with `ALL` on `tu_seguridad.*` only. Never reuse face-api's user: a bad migration
      must not be able to touch face-api's schema.
- [ ] Find out what that server is (`DB_HOST` value: RDS endpoint, or `localhost` on the
      EC2). It decides how backups and disk are checked below.
- [ ] Check disk: snapshots are `MEDIUMBLOB` in MySQL (decision 001), up to
      `SNAPSHOT_MAX_BYTES` (2 MB) each, kept 90 days once retention is on.
- [ ] Backups: confirm whatever covers face-api's DB covers this one too.
- [ ] Production `DATABASE_URL` as a GitHub secret. No shadow DB in prod.

### Phase 3: Pipeline (repo changes, one PR against `develop`)

- [ ] `prisma/schema.prisma`: `binaryTargets = ["native", "rhel-openssl-3.0.x"]`. Confirm the AMI
      (`cat /etc/os-release`): AL2 needs `rhel-openssl-1.0.x`.
- [ ] `start.sh` mirrors face-api: `nvm use 22`, then
      `pm2 start ... --interpreter "$(command -v node)"`, then `pm2 save`. Both apps on 22, so
      both rerunning `pm2 startup` write the same unit (harmless). `PORT=3001` in `.env`.
- [ ] `appspec.yml` at the repo root, destination `/home/ec2-user/apps/tu-seguridad/app`.
- [ ] Hook scripts under `deploy/codedeploy/`, since `scripts/` already holds dev tooling:
  - [ ] `application_stop.sh`: stop and delete `tu-seguridad-api-v*` only.
  - [ ] `before_install.sh`: create and clean the app dir.
  - [ ] `after_install.sh`: `chmod 600 .env`, then `npx prisma migrate deploy`.
  - [ ] `start.sh`: same shape as face-api's (`nvm use 22`, `--interpreter`, `pm2 save`).
  - [ ] `validate_service.sh`: `curl -fsS http://127.0.0.1:3001/health/ready` with retries.
        Fails the deployment if the app doesn't come up.
- [ ] `.github/workflows/deploy.yml`, modelled on face-api's:
  - [ ] Node from `.nvmrc`, `npm ci`, `npm run build`.
  - [ ] Write `file.env` from secrets and vars.
  - [ ] Zip, upload to `s3://face-auth-deploy-artifacts/tu-seguridad-prod/`, then
        `create-deployment` and wait.
- [ ] Production env reviewed against `env-validation.schema.ts` (section 6). First deploy with
      every opt-in `false`.

### Phase 3: Pipeline (AWS and host, manual, once)

- [ ] CodeDeploy application and deployment group, targeting the same instance by tag.
- [ ] IAM: `codedeploy:CreateDeployment` for the GitHub deploy user on the new app/group.
- [ ] GitHub environment with the secrets and vars.
- [ ] After the first green deploy, seed the admin by hand, once.
- [ ] `pm2-logrotate`, if face-api doesn't already have it.

### Phase 4: nginx + TLS

- [ ] Server block for the API domain, `proxy_pass http://localhost:3001`.
- [ ] Websocket headers and long timeouts for socket.io (`/events`), copied from face-api's
      block.
- [ ] `client_max_body_size 3M`.
- [ ] certbot for the new domain.
- [ ] Security group still 80/443 only.
- [ ] `CORS_ORIGINS=https://paulina.frascarelli.com.uy`,
      `APP_BASE_URL=https://paulina.frascarelli.com.uy`.
- [ ] CloudFront behaviors and the gotchas in section 7: client IP, SPA error pages, timeout.
      socket.io path deferred (see open decisions).
- [ ] Smoke test through `paulina.frascarelli.com.uy`: login, refresh (cookie),
      an API 404 comes back as JSON and not as `index.html`.

### Phase 5: Detection on

- [ ] Register the DVR in the app with `connection.url = http://<ddns-host>:18080`, and run the
      connectivity test and channel discovery.
- [ ] `POLLING_ENABLED=true`. Watch the face-auth `429`s: 1 req/s per IP, and this service shares
      the EC2's IP with face-auth's own host. Confirm with the face-auth team how calls from that
      IP are counted.
- [ ] `DVR_EVENTS_ENABLED=true`. Watch the per-recorder health (PR #105).
- [ ] Measure the site's uplink under load.
- [ ] SMTP on 587/465. Turn `MAIL_ENABLED=true` and send a test alert.

### Phase 6: Live view (deferred, not in v1)

- [ ] MediaMTX on the EC2. Control API on loopback, `authHTTPAddress` pointing to `:3001`.
- [ ] Turn on the F680 rule `HiLookRTSP` (WAN 18554) **with the source pinned to
      `52.86.65.164`** first. Then set `DVR_RTSP_PORT=18554`.
- [ ] HLS behind nginx with TLS. `hlsAllowOrigins` = the front-end origin.
- [ ] `MEDIAMTX_ENABLED=true`. Check bandwidth with one viewer.

### Phase 7: Scheduled jobs and operations

- [ ] `DELIVERY_RETRY_ENABLED=true`.
- [ ] `RETENTION_ENABLED=true`, last. It's the only job that deletes rows; confirm backups first.
- [ ] Alerting:
  - [ ] Sentry DSN.
  - [ ] Grafana alert on DVR health and on the process being down.
  - [ ] An alert if the DDNS record drifts from the site IP.
- [ ] Runbook: what to check when the DVR goes unreachable (DDNS, F680 rule, Antel IP change, DVR
      power).

## 1. EC2 to DVR connectivity

### What has to reach what

Every connection is opened by the EC2 side. The recorder never calls back:

| Traffic | From | To | Code |
|---|---|---|---|
| ISAPI HTTP: connectivity test, channel discovery, snapshots | backend | DVR `:80` (`connection.url`) | `src/modules/dvr/http-dvr-client.service.ts` |
| Motion events: long-lived `GET /ISAPI/Event/notification/alertStream` | backend | DVR `:80` | same file, `EVENT_STREAM_PATH` |
| RTSP pull for live view | MediaMTX on EC2 | DVR `:554` (`DVR_RTSP_PORT`) | RTSP URL built from `connection.url`'s hostname |

So the network requirement is one-way: the EC2 must open TCP to the DVR on 80 and 554. Nothing
inbound to the site, nothing inbound to the EC2 from the site.

The DVR sits at `192.168.1.250` on the customer LAN, behind the customer's router. The EC2 has no
route there.

### Facts that decide the option

Gather these before picking:

- **Site public IP**: static, dynamic, or behind **CGNAT**. CGNAT is common on residential and
  mobile ISPs and kills any option that needs inbound traffic to the site (port forward, IPsec
  with the site as responder).
- **Router control**: can we configure the customer's router, or is it a locked ISP box?
- **Always-on device on the site LAN**: a Raspberry Pi, a mini PC, or a router that runs
  WireGuard/Tailscale (GL.iNet, MikroTik RouterOS 7, OpenWrt).
- **Site count**: one recorder now. Does the plan include more sites?
- **Site uplink**: snapshots on every poll, the event stream, and RTSP (sub-stream) all leave
  through the customer's upload.
- **Address overlap**: `192.168.1.0/24` is the most common home LAN. It must not collide with the
  VPC CIDR or with any future site.

### Site facts (surveyed 2026-11-14)

- Gateway: **ZTE F680**, Antel's fiber ONT/router, firmware `V6.0.20P3N10`. It's an ISP box and
  we only have the limited `user` account. No Tailscale, no WireGuard, no packages. It can't be
  the tunnel endpoint.
- TP-Link **Archer AX50 v1.0** in **Access Point mode**: WiFi extension only, no NAT, no DHCP.
  Stock firmware has no Tailscale and no known OpenWrt port. It can't be the endpoint either.
- LAN `192.168.1.0/24`, gateway on the F680. Nothing on site already runs 24/7 that could host
  the tunnel. The WLAN list shows an ESP device, a WiZ bulb, a phone and a Chromecast.
- The DVR is wired to the AX50. AP mode bridges, so the DVR sits on the F680's LAN directly: no
  double NAT, and port forwarding on the F680 reaches `192.168.1.250` as is.
- The F680 `user` account **has port forwarding** (Internet > Seguridad > Reenvío de puertos) with
  a **"Dirección IP WAN Host" range**, i.e. the source restriction E' needs. A rule `HiLookRTSP`
  already exists and is off: TCP WAN `18554` to `192.168.1.250:554`, source `0.0.0.0~0.0.0.0`
  (any).
- F680 DDNS (Internet > DDNS) offers only DynDNS, DtDNS, No-IP and easyDNS, with no custom server.
  The DVR's DDNS has a custom server, so use the DVR's.
- Still open: **WAN IP** (public or CGNAT, Internet > Estatus) and whether the `user` account can
  set a DHCP reservation for the DVR.

Consequence: options A and B need a **dedicated device** wired into a LAN port of the F680 (or of
the AX50, same L2 segment). C is out, since the router can't be configured.

### Constraints (decided 2026-11-14)

No paid services, no hardware purchase, no always-on device on site. That rules out A, B, C and D.
Only two endpoints remain on site: the F680, configurable only through the `user` account, and the
DVR itself. What's left:

**E'. Hardened port forward + DDNS.** The only path that needs no code change.

- Requires a **public WAN IP** (no CGNAT) and port forwarding available to the `user` account.
- **Source restriction is the gate.** ZTE ONTs usually offer a "WAN host IP range" field on port
  forwarding. Pin it to the EC2 Elastic IP. If the F680 can't restrict the source, the DVR is open
  to the whole internet, and this option should be rejected.
- Use non-standard external ports mapped to DVR 80 and 554. Set `DVR_RTSP_PORT` to the external
  RTSP port: the RTSP URL takes its host from `connection.url` but its port from that global env.
- The WAN IP is dynamic. Use the DVR's built-in DDNS, or the F680's if it has one, with a free
  provider. `connection.url` points to the DDNS name.
  - The DVR (HiLook web UI, Network > Basic Settings > DDNS) offers `DynDNS` (dyndns2 protocol,
    custom `Server Address`), `PeanutHull` (Oray; Chinese-language signup and phone verification, free-tier terms unclear, no gain over dyndns2) and `NO-IP`.
  - Dyn itself is paid. Free No-IP hostnames expire unless confirmed every 30 days. Prefer a free
    provider that is dyndns2-compatible and doesn't expire (e.g. dynv6, FreeDNS); check
    compatibility on the device.
  - DDNS fixes the name only. Port forwarding on the F680 is still required.
  - DDNS-specific risks:
    - **Hostname hijack.** The DVR's DDNS client likely updates over plain HTTP, so the provider
      credentials can be sniffed. Whoever repoints the name receives the backend's ISAPI traffic:
      digest exchanges (offline-crackable) and fake events or frames. Mitigations: a dedicated DDNS
      account and password used nowhere else, token auth where the provider offers it, and DVR
      HTTPS with a pinned cert as the real fix (code change).
    - **Provider outage, account loss or shutdown.** The name stops resolving or goes stale and the
      DVR becomes unreachable. Mitigation: alert on the per-recorder health status
      (`feat(dvr)`, PR #105).
    - **IP change window.** The DVR's update interval plus the DNS TTL is a few minutes without the
      DVR. The event stream drops, idle detection (30 s) fires, and the reconnect resolves the new
      IP. Antel rarely rotates the IP outside of an ONT reboot.
    - **Discoverability.** A public record maps the name to the site's IP. Use a random hostname,
      not one that names the customer or says "cameras". Scanners sweep IPs anyway; the source
      restriction is what actually protects the DVR.
- Keep the DVR's UPnP (Network > NAT) **off**. It would open the ports itself, with no source
  restriction.
- Device hygiene: update the DVR firmware (check `V4.71.410` against CVE-2021-36260), use a
  dedicated ISAPI user with minimal rights, disable UPnP and P2P on the DVR, and keep live view off
  unless needed, since its RTSP URL carries the password in clear.
- Residual risk: ISAPI is plain HTTP, so digest auth and snapshots cross the internet unencrypted.
  The DVR's HTTPS with a self-signed cert would fix that, but the current axios client would reject
  it: code change.

**F. DVR-initiated push.** No inbound traffic at all, code change.

- The DVR dials out to the EC2:
  - motion events via its alarm-server / HTTP listening config (`httpHosts`)
  - frames via FTP picture upload on event, if this model supports it
- Works behind CGNAT, opens nothing on site.
- Loses on-demand ISAPI from the backend: connectivity test, channel discovery, passive polling,
  live view. Detection becomes event-only.
- Needs an ingest endpoint on the EC2 and verification that the DVR-208G-M1 actually offers both
  features.

**G. Hikvision ISUP (EHome) "Platform Access".** No inbound traffic, large code change.

- The DVR keeps a registered outbound connection to a server we run. Commands, alarms and media all
  ride it.
- Covers everything ISAPI does today, behind CGNAT.
- Proprietary protocol. Needs Hikvision's free ISUP SDK (native C library) and a rewrite of the DVR
  client around it. Firmware support must be confirmed.

**IPv6 check.** The WLAN list showed only link-local `fe80::` addresses, but a wired laptop on site
gets global IPv6 (`2800:a4:...`), so Antel does deliver it. Site public IPv4 as seen from
outside: `186.50.23.117`, a public Antel range. Confirm it matches the F680 WAN status to rule out
CGNAT. If it does, it bypasses NAT but leaves the same exposure question as
E'.

**Decision path:** check the WAN IP and the F680's port-forwarding options. Public IP with source
restriction available: E' to get to production, and F/G stay on the table as the long-term
replacement. CGNAT or no source restriction: F, or G if on-demand access is required.

### Option A: Tailscale with a subnet router on site (recommended)

A small device on the site LAN joins a Tailscale network and advertises `192.168.1.0/24`. The EC2
joins the same network and accepts that route. Both sides dial out, so NAT and CGNAT don't matter
and no port opens anywhere.

Site device:

```bash
# enable forwarding, then:
tailscale up --advertise-routes=192.168.1.0/24 --advertise-tags=tag:site-dvr
# approve the route in the admin console
```

EC2:

```bash
tailscale up --accept-routes --accept-dns=false --advertise-tags=tag:backend
```

- `--accept-dns=false` matters on a shared host: it keeps MagicDNS from rewriting
  `/etc/resolv.conf` under face-api.
- Only the advertised subnet gets routed. The default route stays as is, so face-api traffic is
  untouched (no exit node).
- An ACL restricts the EC2 to exactly the DVR ports:
  `tag:backend -> 192.168.1.250:80,554`.
- The subnet router SNATs by default, so the DVR sees requests from the device's LAN IP and needs
  no route back. Nothing changes on the customer's router.
- Direct WireGuard path when NAT traversal works. Otherwise traffic goes through a DERP relay:
  higher latency and capped throughput. Fine for ISAPI. Check RTSP for live view.
  `tailscale ping <device>` shows which path is in use.

| Pros | Cons |
|---|---|
| Works behind CGNAT and on dynamic IPs | Third-party control plane (Headscale self-hosts it) |
| No change to the customer's router | Needs an always-on device on site |
| Per-port ACLs, device auth, key expiry handled | Plan limits and pricing for company use: check before committing |
| One more site = one more subnet router | Overlapping site subnets need 4via6 or renumbering |

### Option B: self-managed WireGuard (EC2 as hub)

Same shape as A without the third party. The EC2 runs WireGuard with a fixed UDP port. The site
device dials in and keeps the tunnel alive.

EC2 `/etc/wireguard/wg0.conf`:

```ini
[Interface]
Address = 10.99.0.1/24
ListenPort = 51820
PrivateKey = <ec2-key>

[Peer]  # site
PublicKey = <site-pub>
AllowedIPs = 10.99.0.2/32, 192.168.1.0/24
```

Site device:

```ini
[Interface]
Address = 10.99.0.2/24
PrivateKey = <site-key>

[Peer]  # ec2
PublicKey = <ec2-pub>
Endpoint = <ec2-elastic-ip>:51820
AllowedIPs = 10.99.0.1/32
PersistentKeepalive = 25
```

Plus on the site device: `net.ipv4.ip_forward=1` and
`iptables -t nat -A POSTROUTING -s 10.99.0.0/24 -o eth0 -j MASQUERADE`, so the DVR replies to the
device and not to an unknown `10.99.x` address.

- Security group: open UDP 51820. If the site IP is dynamic it can't be pinned to one source, and
  WireGuard's key auth carries the protection.
- Needs an Elastic IP on the EC2, which face-api's DNS likely already requires.
- The site dials out, so CGNAT works.

| Pros | Cons |
|---|---|
| No third party, no cost | We own keys, rotation, monitoring and re-provisioning |
| Kernel WireGuard, direct path, best throughput | One public UDP port on the shared EC2 |
| Small config, easy to audit | Every new site is manual work. Overlapping subnets need NAT on the site device |

### Option C: AWS Site-to-Site VPN (IPsec)

A Virtual Private Gateway (or Transit Gateway) on the VPC, a Customer Gateway for the site's
router, and two IPsec tunnels. VPC route tables learn `192.168.1.0/24`.

- Needs an IPsec router on site (MikroTik, pfSense/OPNsense, Fortinet, Ubiquiti...). Most ISP
  boxes can't do it.
- Customer Gateway wants a **static public IP**. Certificate-based auth covers dynamic IPs, but
  CGNAT still breaks it.
- Cost: an hourly charge per connection (roughly USD 36/month at the time of writing, check
  current pricing) plus data transfer.
- Nothing installed on the EC2. The security group must allow traffic from `192.168.1.0/24`, and
  the site router must route the VPC CIDR back through the tunnel.

| Pros | Cons |
|---|---|
| AWS-managed, redundant tunnels, CloudWatch metrics | Monthly cost per site |
| No agent on the shared EC2 | Static public IP and an IPsec router on site |
| Standard for corporate sites | Heavy setup for one residential recorder |

### Option D: reverse SSH tunnel (stopgap)

The site device runs `autossh` to the EC2 and forwards the DVR's ports to EC2 loopback:

```bash
autossh -M 0 -N -o ServerAliveInterval=15 -o ExitOnForwardFailure=yes \
  -R 127.0.0.1:18080:192.168.1.250:80 \
  -R 127.0.0.1:10554:192.168.1.250:554 \
  tunnel@<ec2>
```

The backend then talks to `http://127.0.0.1:18080`.

- No VPN, works behind CGNAT. Only needs SSH, which the EC2 already exposes.
- Code-specific catch: the RTSP URL takes its **host** from `connection.url` and its **port**
  from the global `DVR_RTSP_PORT` env. One site works (`DVR_RTSP_PORT=10554`). A second
  tunnelled DVR can't get its own RTSP port without a code change.
- A dedicated `tunnel` user with `permitlisten` and no shell is mandatory, since this account
  holds a key into the production host.
- TCP over TCP, one SSH session carrying everything. Acceptable for ISAPI, poor for live video.

### Option E: port forward on the customer's router (rejected)

Router forwards public `:80`/`:554` to the DVR. The backend uses the site's public IP.

- ISAPI is plain HTTP and the RTSP URL carries the password in clear text across the internet.
- Hikvision firmware has a record of unauthenticated remote exploits (e.g. CVE-2021-36260,
  command injection). Exposing the recorder puts the customer's cameras on the internet.
- Many ISP routers can't restrict the source to the EC2's Elastic IP, and CGNAT makes it
  impossible anyway.

Only acceptable as a minutes-long manual test with a source-IP allowlist, never as the production
path.

### Comparison

| | A Tailscale | B WireGuard | C AWS S2S | D SSH tunnel | E Port forward |
|---|---|---|---|---|---|
| Works behind CGNAT | yes | yes | no | yes | no |
| Touches the customer's router | no | no | yes | no | yes |
| Device on site | yes | yes | no (router) | yes | no |
| Opens a port on EC2 | no | UDP 51820 | no | no (SSH already open) | no |
| Recurring cost | plan-dependent | none | ~USD 36/mo/site | none | none |
| Fit for live video | yes (if direct path) | yes | yes | poor | yes |
| Multi-site | easy | manual | per-site cost | needs code change | no |

**Superseded by [Constraints](#constraints-decided-2026-11-14).** Original recommendation: A, with a GL.iNet travel router or a Raspberry Pi on the DVR's LAN, ACL
pinned to `192.168.1.250:80,554`. If a third-party control plane is unacceptable, B with the same
device. C only if the customer already has an IPsec router and a static IP.

### Site-side checklist (any option)

- DHCP reservation for the DVR (`192.168.1.250` must not move).
- Site device on a UPS, or at least on the same circuit as the DVR.
- Site device auto-starts its tunnel on boot.
- Measure upload bandwidth before turning on polling and live view.

### Verification from the EC2

Pass all four before phase 2:

```bash
# 1. reachability + credentials (ISAPI uses digest auth)
curl --digest -u admin:'<pw>' http://192.168.1.250/ISAPI/System/deviceInfo

# 2. snapshot from a wired channel (3, 4, 5, 7, 8 are wired)
curl --digest -u admin:'<pw>' -o /tmp/ch3.jpg \
  http://192.168.1.250/ISAPI/Streaming/channels/301/picture

# 3. event stream stays open; heartbeat roughly every 9.5 s
curl --digest -u admin:'<pw>' -N http://192.168.1.250/ISAPI/Event/notification/alertStream

# 4. RTSP (only needed for live view)
ffprobe -rtsp_transport tcp 'rtsp://admin:<pw>@192.168.1.250:554/Streaming/Channels/302'
```

Also pull the tunnel down while (3) runs and confirm the backend reconnects once
`DVR_EVENTS_IDLE_SECONDS` (30 s) passes.

## 2. Conflicts with face-api on the shared host

- **Port 3000 is taken.** face-api's nginx proxies `localhost:3000`. Run this app on `PORT=3001`.
- **Node 20 vs 22.** Resolved 2026-11-15: face-api moved to 22, same as this repo's `.nvmrc`.
  Both `start.sh` scripts run `nvm use 22` and pass `--interpreter`, so the PM2 daemon's own
  node version doesn't matter and `pm2 startup` always writes the same unit.
- **PM2 names.** face-api stops `/^face-auth-app-v/`. Use a distinct prefix
  (`tu-seguridad-api-v*`) so neither deploy stops the other.
- **OTel collector already runs** on `127.0.0.1:4318`, deployed by face-api. Don't deploy this
  repo's `ops/otel-collector` (port clash). Point `OTEL_EXPORTER_OTLP_ENDPOINT` at it and tell the
  services apart by `OTEL_SERVICE_NAME`.
- **face-auth upstream on the same host.** Keep `FACE_AUTH_API_URL=https://api.face-auth.me`.
  Calling `localhost:3000` skips nginx and may change how the 1 req/s per-IP limit keys. Ask the
  face-auth team first.
- **Capacity.** face-api, this app (`max_memory_restart: 512M`), and possibly MediaMTX on one
  instance. Check RAM and CPU headroom.

## 3. Pipeline and artifact

- **Prisma engine target.** `prisma/schema.prisma` has no `binaryTargets`. CI builds on Ubuntu
  (`debian-openssl-3.0.x`), while the EC2 runs Amazon Linux (`rhel-openssl-3.0.x` on AL2023). A
  zipped `node_modules`, as face-api ships, won't load the engine. Add
  `binaryTargets = ["native", "rhel-openssl-3.0.x"]`, or run `prisma generate` in AfterInstall.
- **Entry point** is `dist/src/main.js`, not `dist/main.js` as in face-api.
- **Migrations.** `npx prisma migrate deploy` in AfterInstall. Needs the `prisma` CLI (devDep,
  shipped with `node_modules`) and DB reachability from the EC2.
- **Admin seed** runs once, by hand. Not on every deploy.
- **CodeDeploy**: new application and deployment group targeting the same instance by tag. Same
  bucket (`face-auth-deploy-artifacts`) with its own `DEPLOY_PREFIX`. The GitHub IAM user needs
  `codedeploy:CreateDeployment` on the new app.
- **Single instance, fork mode** (socket.io and in-memory occupancy state). No cluster, no
  blue/green. Expect a few seconds of downtime per deploy.

## 4. nginx and TLS

- New server block for this app's domain, certbot, `proxy_pass http://localhost:3001`.
- Copy face-api's `Upgrade`/`Connection` headers and long `proxy_read_timeout` for socket.io
  (`/events` namespace).
- `client_max_body_size` at least 3M when assistant audio is on (`ASSISTANT_AUDIO_MAX_BYTES` is
  2 MB).
- `trust proxy 'loopback'` in `main.ts` already fits nginx on the same host.
- Security group: 80/443 only. Never expose 3001, 8888 or 9997 directly.

## 5. MediaMTX (live view, optional)

- Runs on the EC2 and pulls RTSP from the DVR through the tunnel.
- HLS must sit behind nginx with TLS. An `http` playlist on an `https` dashboard is blocked as
  mixed content.
- Changes from `docker/mediamtx.yml`:
  - `authHTTPAddress` points to `http://127.0.0.1:3001/api/v1/streaming/authorize`.
  - `hlsAllowOrigins` lists the production front-end origin.
  - The Control API (9997) stays on loopback: it accepts the DVR password and authenticates
    nobody.

## 6. Environment and outbound traffic

- Required in production, placeholders rejected (`src/cross/config/env-validation.schema.ts`):
  - `JWT_SECRET`, `JWT_REFRESH_SECRET`
  - `DATABASE_URL`
  - `FACE_AUTH_DOMAIN`, `FACE_AUTH_CLIENT_TOKEN`
  - admin credentials
  - `METRICS_TOKEN`
  - `DVR_PASSWORD_ENCRYPTION_KEY`
- `DVR_PASSWORD_ENCRYPTION_KEY` must also be **stable**. Changing it leaves every stored DVR
  password undecryptable.
- Production values for `CORS_ORIGINS` and `APP_BASE_URL`. `SWAGGER_ENABLED=false`.
- **SMTP**: AWS blocks outbound port 25 by default. Use 587/465 (SES or another provider).
- Outbound from the EC2:
  - face-auth
  - SMTP provider
  - LLM gateway (`ASSISTANT_API_URL`)
  - Sentry
  - Grafana Cloud, through the collector
  - the DVR, through the tunnel

## 7. CloudFront in front of the API

```
browser --> paulina.frascarelli.com.uy (CloudFront)
              /*      --> S3 (SPA)
              /api/*  --> api.paulina.frascarelli.com.uy (nginx on EC2, TLS) --> localhost:3001
```

The browser sees one origin, so CORS and cookies get simpler. The refresh cookie
(`path=/api/v1/auth`, `sameSite: lax`, `secure` in production) works as is, because front end and
API share the site.

### `/api/*` behavior settings

- Origin: `api.paulina.frascarelli.com.uy`, HTTPS only. The Let's Encrypt cert on nginx is valid
  for that name.
- Cache policy: `CachingDisabled`.
- Origin request policy: **`AllViewerExceptHostHeader`**. Forwarding the viewer's `Host`
  (`paulina...`) would miss nginx's `server_name` and the cert. This policy still forwards
  cookies, query strings and headers like `Authorization`.
- Allowed methods: all (GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE).
- Paths pass through unchanged: `/api/v1/...` reaches Nest's global `api` prefix as is.

### Gotchas

1. **socket.io isn't under `/api`.** `EventsGateway` (`@WebSocketGateway({ namespace: 'events' })`)
   uses the default path `/socket.io/`. Through CloudFront, that path falls into the S3
   behavior. Pick one:
   - an extra `/socket.io/*` behavior pointing to the same origin. CloudFront supports
     WebSockets. Same policies as `/api/*`.
   - or move the gateway path under `/api` (`path: '/api/socket.io'`) and update the front end.
     Code change.
2. **Client IP collapses to CloudFront's.** `trust proxy 'loopback'` trusts only nginx, so
   `req.ips[0]` (throttler tracker, `throttler.options.ts`) and `req.ip` (session context) become
   the CloudFront edge address. Every user behind one edge shares the 10 req/s bucket, and
   sessions record the wrong IP. Fix:
   - forward the `CloudFront-Viewer-Address` header (origin request policy);
   - in nginx, set `X-Forwarded-For` to the IP part of that header for this server block;
   - so direct hits on `api.paulina...` can't spoof it, have CloudFront add a secret custom
     origin header and make nginx reject requests without it.
3. **SPA error pages swallow API errors.** S3 SPAs often map 403/404 to `/index.html` through
   CloudFront *custom error responses*, which apply to the **whole distribution**. An API 404 or
   403 would come back as `index.html` with status 200. Do the SPA fallback with a CloudFront
   Function on the default behavior instead, and keep custom error responses off.
4. **Origin response timeout** defaults to 30 s. The assistant waits up to
   `ASSISTANT_TIMEOUT_MS=30000` on the LLM gateway, which turns into a 504 right at the edge.
   Raise the timeout to 60 s on the `/api/*` behavior.
5. **Live view (phase 6).** HLS is served by MediaMTX, not by Nest. It needs its own behavior,
   for example `/hls/*` to nginx and then MediaMTX `:8888`, and `hlsAllowOrigins` set to the
   front-end origin.

### Certificates and DNS

- `paulina.frascarelli.com.uy`: ACM certificate in **us-east-1** (required by CloudFront), plus a
  CNAME/ALIAS to the distribution.
- `api.paulina.frascarelli.com.uy`: A record to `52.86.65.164`, certbot on the EC2.

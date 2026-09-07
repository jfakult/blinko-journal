# Workstream 7 — Network & Privacy Hardening

Scope note up front: this document and `docker-compose.network.yml` are
**config and documentation only**, written from a worktree with no running
Docker daemon and no access to the actual Unraid host. They define the
network topology and the exact audit procedure to run, but they do **not**
perform the actual egress audit (packet capture during live use) — that
requires a running instance and is explicitly deferred to whoever deploys
this stack for real (see the checklist at the end). Do not treat this
document as proof the audit passed; treat it as the plan for running it.

## 1. Topology

Three networks-worth of trust, two of which are actual Docker networks:

```
                         ┌───────────────────────────────────────────┐
                         │              Unraid host / LAN             │
                         │                                             │
   Internet  ── (no route) ──✕                                        │
                         │                                             │
                         │   ┌─────────────┐        ┌────────────────┐│
        reverse proxy ───┼──▶│ blinko-      │        │  Ollama         ││
   (fakult.net/journal)  │   │ website      │◀──────▶│  (own container ││
        :1111 published  │   │ :1111        │  LAN/  │  or LAN host)   ││
                         │   └──────┬───────┘  shared │                ││
                         │          │           net   └────────────────┘│
                         │          │  blinko-egress                    │
                         │          │  (bridge, NOT internal --         │
                         │          │   firewalled to an allowlist,     │
                         │          │   see §3)                         │
                         │          │                        ┌─────────┐│
                         │          └───────────────────────▶│Pocket-ID││
                         │                                   │sso.fakult││
                         │                                   │  .net   ││
                         │                                   └─────────┘│
                         │  ┌────────────────────────────────────────┐ │
                         │  │         blinko-internal (internal: true)│ │
                         │  │  ┌────────────┐ ┌─────────┐ ┌─────────┐│ │
                         │  │  │blinko-      │ │postgres │ │ whisper ││ │
                         │  │  │website      │ │         │ │         ││ │
                         │  │  └────────────┘ └─────────┘ └─────────┘│ │
                         │  │  no route to LAN or internet from here  │ │
                         │  └────────────────────────────────────────┘ │
                         └───────────────────────────────────────────┘
```

**Two Docker networks** (defined in `docker-compose.network.yml`, applied
as an overlay on `docker-compose.prod.yml`):

- **`blinko-internal`** (`internal: true`) — `blinko-website`, `postgres`,
  `whisper`. Docker's `internal: true` flag removes the network's default
  outbound route/NAT rule, so nothing on this network can initiate a
  connection off the network, to the LAN or the internet. This is real
  isolation enforced by Docker/iptables, not just a naming convention.
  Container-to-container traffic within the network (blinko-website
  talking to postgres and to whisper's `/v1/audio/transcriptions`) still
  works fine — `internal: true` only removes the *outbound-to-elsewhere*
  route, not intra-network routing.

  It also does **not** block *inbound* connections that arrive via a
  published `ports:` mapping — `ports: - 1111:1111` on blinko-website is a
  host-level DNAT rule, independent of the container's own outbound
  gateway — so the reverse proxy can still reach blinko-website on 1111
  even though blinko-website also sits on this locked-down network. That's
  why the diagram shows the reverse proxy arrow going straight to
  blinko-website rather than through blinko-egress: that's inbound
  traffic, a different path than the outbound egress this network
  restricts.

- **`blinko-egress`** — `blinko-website` only. A normal (non-internal)
  bridge network with a route out through the host. This is where
  blinko-website's *outbound* calls to Ollama, Pocket-ID, and (if ever
  needed) the reverse proxy's own hostname go out.

**Why postgres and whisper get zero egress:** neither has any legitimate
reason to initiate an outbound connection. Postgres only ever accepts
connections from blinko-website. Whisper (self-hosted ASR) should be
fully self-contained at runtime — model weights baked into the image or a
persistent volume — so it never needs to phone out either. If Workstream
2 ends up choosing a Whisper image that pulls model weights from the
internet at container startup instead of at build time, that's a real gap
in this design; see the open item in `docker-compose.network.yml` and
item 6 of the audit checklist below.

**Why the reverse proxy is even on the egress allowlist:** the diagram's
inbound path (reverse proxy → published port 1111) doesn't need
blinko-website to reach *out* to anything. The reverse proxy's hostname is
still on the allowlist because Blinko's OIDC/NextAuth flow may construct
or validate callback/redirect URLs against the public-facing domain
(`fakult.net`/whatever subdomain fronts `/journal`) as part of login — if
that turns out not to actually happen in practice, item 4 of the audit
checklist below is exactly how you'd find that out and could tighten the
allowlist further by removing it.

**What this design deliberately does *not* attempt:** Docker networks
give you *segmentation* (which containers can talk to which networks),
not destination-level *filtering* within a network that does have a route
out. `blinko-egress` can technically reach anything the host can reach —
narrowing it down to *only* Ollama/Pocket-ID/the reverse proxy is a host
firewall job, not a compose job. See §3.

## 2. Egress allowlist

Every destination this stack should ever need to reach, and why. Nothing
else should ever appear in the audit (§4) — no update-checkers, no
telemetry, no crash reporters, no cloud AI providers (the 0%-telemetry /
0%-cloud-AI hard constraint from the project brief applies directly here).

| Destination | Reached by | Port | Purpose | Status |
|---|---|---|---|---|
| Ollama | `blinko-website` | `<OLLAMA_LAN_IP_OR_HOSTNAME>`, default `11434` | LLM calls (auto-tagging) and embeddings (RAG search) — see Workstream 4 | **Placeholder** — exact LAN IP/hostname, and whether it's reachable via a shared Docker network instead, unknown from this worktree. Fill in before deploying. |
| Pocket-ID | `blinko-website` | `sso.fakult.net`, `443` | OIDC SSO login (Workstream 1) | Known |
| Reverse proxy | `blinko-website` | `<REVERSE_PROXY_LAN_IP_OR_HOSTNAME>` | Inbound proxying to `fakult.net/journal` (arrives via published port 1111, doesn't require blinko-website to initiate anything); outbound leg kept allowlisted only in case OIDC callback/redirect URL handling needs it — confirm with the audit | **Placeholder** — exact hostname/IP of whatever fronts `fakult.net` unknown from this worktree. |
| *(nothing else)* | — | — | — | Any other destination seen in the audit is a bug: an unexpected update-checker, telemetry beacon, crash reporter, or a cloud AI call that shouldn't exist per the hard constraint. Investigate and block it, don't allowlist it. |

Postgres and whisper: **no entries** — they should never appear as a
*source* of outbound traffic at all (see §1).

## 3. Enforcing the LAN allowlist

Compose/Docker alone gets you `blinko-internal` vs. `blinko-egress`
segmentation, but `blinko-egress` itself is a plain bridge network that
can reach the whole LAN and the internet unless something narrows it
further. Two ways to actually enforce "only these three destinations,"
in order of preference:

1. **Host (Unraid) firewall rule**, restricting the `blinko-egress`
   subnet's outbound traffic to the specific destination IPs/ports in the
   table above and dropping everything else. On Unraid this typically
   means either a custom `iptables`/`nftables` rule applied via the "User
   Scripts" plugin at Docker start, or rules on whatever router/firewall
   sits in front of the LAN if Unraid itself isn't doing the filtering.
   Concretely, once `blinko-egress`'s subnet is known (`docker network
   inspect blinko-egress` after `docker compose up`), something in the
   shape of:

   ```
   # allow the specific allowed destinations
   iptables -I DOCKER-USER -s <blinko-egress-subnet> -d <OLLAMA_IP> -p tcp --dport 11434 -j ACCEPT
   iptables -I DOCKER-USER -s <blinko-egress-subnet> -d <POCKET_ID_IP> -p tcp --dport 443 -j ACCEPT
   iptables -I DOCKER-USER -s <blinko-egress-subnet> -d <REVERSE_PROXY_IP> -p tcp --dport <port> -j ACCEPT
   # then deny everything else from that subnet
   iptables -I DOCKER-USER -s <blinko-egress-subnet> -j DROP
   ```

   (`DOCKER-USER` is the standard hook chain Docker leaves for exactly this
   purpose — rules here run before Docker's own forwarding rules. Order
   matters: the ACCEPT rules must be inserted so they're evaluated before
   the DROP.) This is real, from-scratch work for whoever deploys this —
   don't skip it and assume the compose network alone is sufficient.

2. **A small forward/allowlisting proxy** (e.g. a tiny egress proxy
   container configured with just the three allowed hostnames) that
   `blinko-website` is pointed at instead of reaching destinations
   directly. More moving parts, more to maintain long-term — given this
   project's "minimum long-term maintenance" constraint, prefer option 1
   unless the Unraid firewall genuinely can't do per-container-subnet
   rules.

Either way: **the compose overlay alone (`docker-compose.network.yml`) is
necessary but not sufficient.** It's the segmentation layer; option 1 or 2
above is the filtering layer, and only the real deploy environment can
implement it.

## 4. Egress audit checklist (for whoever deploys this)

This is a from-scratch verification, not an assumption — do not check
these boxes from reading this document, only from actually running them
against a live instance. Run this after Workstreams 1 & 2's containers
are up and `docker-compose.network.yml` is applied, and again any time a
new dependency, plugin, or image update lands.

1. **Baseline capture.** Start a packet capture on the host scoped to the
   `blinko-egress` network's interface (and, separately, confirm
   `blinko-internal` never shows traffic leaving the host at all):
   ```
   docker network inspect blinko-egress   # note the bridge interface name, e.g. br-xxxxxxxx
   sudo tcpdump -i br-xxxxxxxx -n -w blinko-egress-audit.pcap
   ```
   Leave it running through steps 2-5, then inspect with `tcpdump -r` or
   Wireshark afterward.

2. **Idle baseline.** With the stack up but untouched (no login, no
   recording, nothing), let it sit for a few minutes. Anything that shows
   up here with no user action at all is the highest-suspicion category —
   a background update checker, telemetry, or health-check-to-somewhere-
   unexpected.

3. **Login.** Perform a real Pocket-ID SSO login through the reverse
   proxy. Confirm the only new destination(s) are Pocket-ID
   (`sso.fakult.net`) and, if applicable, the reverse proxy's own
   hostname for redirect/callback handling. Note whether the reverse-proxy
   leg actually happens — if it never does, that's grounds to remove it
   from the allowlist in §2/§3.

4. **Voice recording → transcription.** Record a voice entry and let it
   transcribe. Confirm all transcription traffic stays on
   `blinko-internal` (blinko-website → whisper) and never appears on the
   `blinko-egress` capture at all — if whisper traffic shows up in the
   LAN/internet-facing capture, something is misconfigured (whisper
   shouldn't have an egress path per §1).

5. **Tag generation (Scheduled AI Task).** Trigger or wait for the
   auto-tagging job to run against a test note. Confirm the only new
   destination is Ollama, at the address configured in step 0 below.

6. **Whisper cold-start check.** Specifically watch for any outbound
   traffic from the whisper container the *first* time it starts (before
   step 4) — this is where a model-weights-from-the-internet image would
   show up (see the open item in `docker-compose.network.yml`). If it
   happens even once, decide with Workstream 2 whether to bake the model
   into the image/volume instead (preferred) or formally add a narrow,
   time-boxed allowlist entry for it.

7. **`docker network inspect` cross-check.** Independent of the packet
   capture, confirm container membership matches the design:
   ```
   docker network inspect blinko-internal   # expect: blinko-website, postgres, whisper — nothing else
   docker network inspect blinko-egress     # expect: blinko-website only
   ```

8. **Full destination review.** Go through the complete pcap from steps
   2-6 and list every distinct destination IP/hostname seen. Cross-check
   each one against the table in §2. Anything not in that table is a
   finding: identify what made the call (which container, which feature)
   and either explain why it's actually fine and add it to the allowlist
   deliberately, or block it and, if it's a symptom of a library/image
   default (e.g. an unexpected update-checker baked into a base image),
   flag it back to the relevant workstream.

9. **Firewall rule verification.** After implementing §3's host firewall
   rules, repeat steps 3-5 from a state where the rules are active, and
   additionally attempt (from a shell inside the blinko-website container,
   or by temporarily adding a throwaway curl to an unrelated public host)
   to reach something *not* on the allowlist — confirm it's actually
   blocked, not just unused. A rule that's never been proven to block
   anything hasn't been verified.

10. **Fill in the placeholders.** Once real values for Ollama's
    address/network and the reverse proxy's hostname are known, update
    the `<...>` placeholders in `docker-compose.network.yml` and the table
    in §2 of this document so they stop being placeholders for the next
    person who reads this.

## 5. Files touched by this workstream

- `docker-compose.network.yml` — new. The network overlay (`blinko-internal`,
  `blinko-egress`, and the per-service `networks:` attachments).
- `docker-compose.prod.yml` — removed the stale, unused top-level
  `blinko-network` / `driver: host` block (it wasn't attached to any
  active service, and `driver: host` would have meant *no* network
  isolation at all had it ever been used) and pointed the two services'
  commented-out `networks:` lines at the overlay instead.
- This document.

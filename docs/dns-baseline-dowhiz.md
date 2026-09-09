# dowhiz.com — DNS baseline before the Cloudflare migration

Read from the authoritative nameserver `ns23.domaincontrol.com` (GoDaddy).
**This is the rollback record and the import checklist.**

> INCOMPLETE BY CONSTRUCTION. DNS does not allow enumeration and GoDaddy refuses AXFR,
> so this lists only names that were guessed and found. The authoritative list is
> GoDaddy's own zone-file export. Verify against that before changing nameservers.

## Nameservers (what we are changing)
    ns23.domaincontrol.com
    ns24.domaincontrol.com

## Apex — dowhiz.com
| Type | TTL | Value |
|---|---|---|
| A | 600 | 216.198.79.1 |
| MX | 1800 | 1 aspmx.l.google.com. |
| MX | 1800 | 5 alt1.aspmx.l.google.com. |
| MX | 1800 | 5 alt2.aspmx.l.google.com. |
| MX | 1800 | 10 alt3.aspmx.l.google.com. |
| MX | 1800 | 10 alt4.aspmx.l.google.com. |
| MX | 1800 | 10 inbound.postmarkapp.com. |
| TXT | 3600 | "v=spf1 include:dc-aa8e722993._spfm.dowhiz.com ~all" |
| TXT | 3600 | "google-site-verification=opeAoadnMGta4pbCN3CQgzJefzzxPuU6-3h1RHWxo2s" |

No AAAA. CAA query timed out at the GoDaddy NS (probably none; confirm in the export).

## Email-critical names — MISS ONE AND MAIL BREAKS
| Name | Type | Value |
|---|---|---|
| `_dmarc` | TXT | "v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;" |
| `dc-aa8e722993._spfm` | TXT | "v=spf1 include:_spf.google.com ~all" |

`p=quarantine` means a broken SPF chain sends real mail to junk, silently.
The `_spfm` record is a GoDaddy SPF-merge construct that the apex SPF includes by name —
Cloudflare's scanner routinely misses it because nothing links to it from a well-known name.

## Subdomains found
| Name | Value |
|---|---|
| `www` | 54ae2f04c323c492.vercel-dns-017.com. → 216.198.79.65, 64.29.17.65 (Vercel) |
| `api` | 20.112.32.244 (Azure) |
| `staging` | 20.3.130.57 (Azure) |

## Proxy status after import — set ALL of these to DNS only (grey cloud)
Cloudflare turns proxying ON by default for A/CNAME records. Proxying the Vercel and
Azure hosts would put them behind Cloudflare's edge uninvited and can break TLS and redirects.
    apex, www, api, staging  →  DNS only
    awardgrid (new)          →  Proxied  (required for Tunnel + Access)

## Rollback
Set the nameservers at GoDaddy back to ns23/ns24.domaincontrol.com.
GoDaddy keeps the zone, so the records above return with it. Propagation is up to 24 h.

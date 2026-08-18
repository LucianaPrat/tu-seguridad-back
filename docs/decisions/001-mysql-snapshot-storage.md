# 001 — Store snapshot thumbnails in MySQL

## Context

The camera dashboard and alert history require still-image thumbnails and a timestamp. The product
does not yet have object storage or a decided live-streaming design. DVR URLs can embed credentials
and must not become public or persisted as snapshot URLs.

## Decision

Store snapshot thumbnail bytes in a MySQL `MEDIUMBLOB` table with camera ownership, MIME type,
byte size, SHA-256 and capture timestamp. Persist event-to-snapshot references by id. The API
derives an authenticated, tenant-scoped `latestSnapshotUrl` from that id; it never exposes a DVR
URL, BLOB data in JSON, or a storage-provider URL.

## Alternatives rejected

- Object storage plus signed URLs: deferred because the project has no selected provider or
  operational budget for one.
- Proxying a DVR image without persistence: rejected because alert history requires durable
  snapshots and would keep DVR credentials on the request path.
- Live-stream URLs: out of scope until streaming protocol and authorization are decided.

## Consequences

The API must enforce an upload-size limit and space-scoped reads before returning image bytes.
Snapshot retention must be added before table growth becomes material. A later object-storage move
is isolated to the snapshot accessor/service and API URL mapper; the rest of the domain refers to
snapshot ids.

---
title: Object storage
description: S3 compatible buckets on our Ceph cluster. Any S3 client works.
section: Guides
order: 18
---

## Buckets

A bucket is an S3 compatible container for files. Create one from the console under **Object
storage**, from the CLI, or the API:

```
prgd buckets create acme-assets
```

```
POST /v1/buckets
{ "name": "acme-assets", "public": false }
```

Bucket names are global and DNS safe: 3 to 63 lowercase letters, digits and hyphens. Objects
are billed per GB per month, measured every ten minutes. A bucket must be empty before you
delete it.

Turn on **public read** to let anyone fetch objects by URL, for images and downloads. Private
buckets need a key or a presigned URL.

## Access keys

Create a key from the console or with `prgd buckets keys create ci`. The secret is shown
once. Keys work for every bucket in the project, and revoking one cuts off its clients at
once. Point any S3 client at our endpoint:

```
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_ENDPOINT_URL=https://s3.<region>.progrid.co
AWS_DEFAULT_REGION=<region>

aws s3 cp backup.tar.gz s3://acme-assets/backups/
aws s3 ls s3://acme-assets/
```

rclone, s3cmd, MinIO client, Cyberduck, and the AWS SDKs all work with path style or virtual
host style addressing.

## Console, CLI and presigned URLs

The console browses a bucket by prefix, uploads through your browser, downloads and deletes.
The CLI does the same:

```
prgd buckets upload acme-assets ./logo.png --key img/logo.png
prgd buckets ls acme-assets --prefix img/
prgd buckets download acme-assets img/logo.png
```

Both use presigned URLs from `POST /v1/buckets/{name}/presign`: a short lived link to GET,
PUT or DELETE one object without handing out keys. Applications can do the same to let users
upload straight to storage.

## Terraform, SDKs and agents

Terraform manages buckets with `prgd_bucket` and keys with `prgd_storage_key` (the
secret lands in state; keep state private). The SDKs expose `buckets` with `upload` and
`presign` helpers and `storageKeys`. Agent tokens need `storage:read` and `storage:write`; the
MCP server exposes `list_buckets`, `create_bucket`, `bucket_presign` and `create_storage_key`.

## Limits

| Limit | Value |
| --- | --- |
| Buckets per project | 100 |
| Access keys per project | 20 |
| Object size | 5 TB through multipart upload with an S3 client; 64 MB through the console |
| Presigned URL lifetime | 1 minute to 7 days |

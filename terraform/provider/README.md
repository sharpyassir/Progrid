# terraform-provider-prgd

Manage prgd from Terraform or OpenTofu. Built on terraform-plugin-framework and the public API.

| Kind | Name | Notes |
|---|---|---|
| resource | `prgd_server` | create waits until active; `size` changes resize in place; image, region, project, user_data and name replace |
| resource | `prgd_volume` | block storage; `size_gb` grows in place, `server_id` attaches, detaches or moves it |
| resource | `prgd_load_balancer` | managed HAProxy; `forwarding_rule` blocks, `server_ids` or `tag` targets |
| resource | `prgd_domain` | hosted zone; `nameservers` output for the registrar |
| resource | `prgd_dns_record` | one record; `name` relative to the zone |
| resource | `prgd_bucket` | S3 compatible bucket; `public` toggles anonymous read |
| resource | `prgd_storage_key` | S3 access key pair, secret in state |
| resource | `prgd_database` | managed PostgreSQL cluster; connection outputs, `password` and `uri` sensitive |
| resource | `prgd_firewall` | rules as `rule` blocks; a rule change replaces the firewall |
| resource | `prgd_ssh_key` | public key on the account |
| data | `prgd_sizes` | sizes with vCPU, memory, disk and transfer |
| data | `prgd_images` | distribution images and marketplace apps, filter with `kind` |

See `examples/main.tf`. The provider reads `PRGD_TOKEN` and `PRGD_API_URL` when the block leaves them out.

## Local build

```sh
go build -o terraform-provider-prgd .
cat > ~/.terraformrc <<'EOF2'
provider_installation {
  dev_overrides { "prgd/prgd" = "/path/to/terraform/provider" }
  direct {}
}
EOF2
cd examples && terraform plan
```

Every write sends an `Idempotency-Key`. When the token requires approval for a delete, `terraform destroy` stops with the approval message; approve it in the console and run destroy again.

## What is here and what is not

Here: the provider, three resources, two data sources, import for every resource, client tests. Not yet: registry publishing (needs a signing key and the release workflow), acceptance tests against a live API, and resources for deployments, snapshots and tokens. The CLI and the API cover those today.

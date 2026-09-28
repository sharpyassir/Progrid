terraform {
  required_providers {
    prgd = { source = "prgd/prgd" }
  }
}

# Token from PRGD_TOKEN; api_url from PRGD_API_URL.
provider "prgd" {}

data "prgd_sizes" "all" {}

resource "prgd_ssh_key" "me" {
  name       = "laptop"
  public_key = file("~/.ssh/id_ed25519.pub")
}

resource "prgd_firewall" "web" {
  name = "web"
  rule { direction = "inbound"  protocol = "tcp" ports = "22"     cidrs = ["203.0.113.0/24"] }
  rule { direction = "inbound"  protocol = "tcp" ports = "80-443" cidrs = ["0.0.0.0/0", "::/0"] }
  rule { direction = "outbound" protocol = "any"                  cidrs = ["0.0.0.0/0"] }
}

resource "prgd_server" "web" {
  name      = "web-1"
  size      = "s-1vcpu-1gb"
  image     = "ubuntu-24-04"
  ssh_keys  = [prgd_ssh_key.me.id]
  firewalls = [prgd_firewall.web.id]
  tags      = ["terraform"]
  user_data = <<-EOT
    #cloud-config
    packages: [nginx]
  EOT
}

resource "prgd_volume" "data" {
  name      = "web-data"
  size_gb   = 100
  server_id = prgd_server.web.id
}

resource "prgd_load_balancer" "web" {
  name       = "web"
  nodes      = 2
  server_ids = [prgd_server.web.id]

  forwarding_rule {
    entry_protocol  = "http"
    entry_port      = 80
    target_protocol = "http"
    target_port     = 80
  }
}

resource "prgd_domain" "site" {
  name = "example.com"
}

resource "prgd_dns_record" "apex" {
  domain = prgd_domain.site.name
  name   = "@"
  type   = "A"
  value  = prgd_load_balancer.web.ip
}

resource "prgd_dns_record" "www" {
  domain = prgd_domain.site.name
  name   = "www"
  type   = "CNAME"
  value  = "example.com"
}

resource "prgd_bucket" "assets" {
  name   = "acme-assets"
  public = true
}

resource "prgd_storage_key" "ci" {
  name = "ci"
}

resource "prgd_database" "main" {
  name            = "app-db"
  engine          = "postgres"
  size            = "s-1vcpu-2gb"
  nodes           = 3
  trusted_sources = ["${prgd_server.web.ipv4_address}/32"]
}

output "address" {
  value = prgd_server.web.ipv4_address
}

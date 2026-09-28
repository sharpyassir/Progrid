"""prgd Python SDK.

    from prgd import Prgd
    prgd = Prgd(token=os.environ["PRGD_TOKEN"])
    server = prgd.servers.create(name="web-1", size="s-1vcpu-1gb", image="ubuntu-24-04")
    server = prgd.servers.wait_until_active(server["id"])
    print(server["networks"]["v4"][0]["ipAddress"])

No dependencies: urllib only. Every write sends an Idempotency-Key. Errors raise PrgdError.
"""
from __future__ import annotations

import json
import os
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

__all__ = ["Prgd", "PrgdError"]
__version__ = "0.1.0"


class PrgdError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(f"{code} ({status}): {message}")
        self.status, self.code, self.message, self.details = status, code, message, details or {}

    @property
    def needs_approval(self) -> bool:
        """True when a person must approve the request in the console; details['approvalId'] says which."""
        return self.code == "approval_required"


class Prgd:
    def __init__(self, token: str, base_url: Optional[str] = None, project: Optional[str] = None, timeout: float = 30.0, opener=None):
        if not token:
            raise ValueError("token is required")
        self.token = token
        self.base = (base_url or os.environ.get("PRGD_API_URL") or "https://api.prgd.example").rstrip("/").removesuffix("/v1")
        self.project = project
        self.timeout = timeout
        self._open = opener or urllib.request.urlopen
        self.account = _Account(self)
        self.catalog = _Catalog(self)
        self.servers = _Servers(self)
        self.deploys = _Deploys(self)
        self.firewalls = _Firewalls(self)
        self.snapshots = _Snapshots(self)
        self.volumes = _Volumes(self)
        self.load_balancers = _LoadBalancers(self)
        self.domains = _Domains(self)
        self.buckets = _Buckets(self)
        self.databases = _Databases(self)
        self.support = _Support(self)
        self.kubernetes = _Kubernetes(self)
        self.app_platform = _AppPlatform(self)
        self.storage_keys = _StorageKeys(self)
        self.certificates = _Certificates(self)
        self.billing = _Billing(self)
        self.approvals = _Approvals(self)
        self.alerts = _Alerts(self)

    def request(self, method: str, path: str, body: Any = None, query: Optional[Dict[str, Any]] = None) -> Any:
        url = self.base + path
        q = {k: v for k, v in (query or {}).items() if v is not None}
        if q:
            url += "?" + urllib.parse.urlencode(q)
        headers = {"Authorization": f"Bearer {self.token}", "Accept": "application/json", "User-Agent": f"prgd-sdk-py/{__version__}"}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
            headers["Idempotency-Key"] = str(uuid.uuid4())
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with self._open(req, timeout=self.timeout) as res:
                raw = res.read()
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                err = json.loads(raw).get("error") or {}
            except ValueError:
                err = {}
            raise PrgdError(e.code, err.get("code", "http_error"), err.get("message", str(e)), err.get("details")) from None
        return json.loads(raw) if raw else None

    def request_text(self, method: str, path: str) -> str:
        """Like request, for endpoints that answer with plain text or YAML."""
        req = urllib.request.Request(self.base + path, method=method, headers={"Authorization": f"Bearer {self.token}", "Accept": "*/*", "User-Agent": f"prgd-sdk-py/{__version__}"})
        try:
            with self._open(req, timeout=self.timeout) as res:
                return res.read().decode()
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                err = json.loads(raw).get("error") or {}
            except ValueError:
                err = {}
            raise PrgdError(e.code, err.get("code", "http_error"), err.get("message", str(e)), err.get("details")) from None


class _Res:
    def __init__(self, c: Prgd):
        self.c = c


class _Account(_Res):
    def me(self):
        return self.c.request("GET", "/v1/account")

    def tokens(self):
        return self.c.request("GET", "/v1/tokens")["data"]

    def create_token(self, name: str, scopes: list, is_agent: bool = False, spend_cap_minor: Optional[int] = None, require_approval_for: Optional[list] = None, **kw):
        body = {"name": name, "scopes": scopes, "isAgent": is_agent, "spendCapMinor": spend_cap_minor, "requireApprovalFor": require_approval_for, **kw}
        return self.c.request("POST", "/v1/tokens", {k: v for k, v in body.items() if v is not None})

    def ssh_keys(self):
        return self.c.request("GET", "/v1/ssh-keys")["data"]

    def add_ssh_key(self, name: str, public_key: str):
        return self.c.request("POST", "/v1/ssh-keys", {"name": name, "publicKey": public_key})


class _Catalog(_Res):
    def sizes(self):
        return self.c.request("GET", "/v1/sizes")["data"]

    def images(self, kind: Optional[str] = None):
        return self.c.request("GET", "/v1/images", query={"kind": kind})["data"]

    def regions(self):
        return self.c.request("GET", "/v1/regions")["data"]

    def pricing(self, currency: str = "USD"):
        return self.c.request("GET", "/v1/pricing", query={"currency": currency})


class _Servers(_Res):
    def list(self, **query):
        return self.c.request("GET", "/v1/servers", query={"project": self.c.project, **query})["data"]

    def get(self, id: str):
        return self.c.request("GET", f"/v1/servers/{id}")

    def create(self, name: str, size: str, image: str, **kw):
        return self.c.request("POST", "/v1/servers", {"project": self.c.project, "name": name, "size": size, "image": image, **kw})

    def action(self, id: str, type: str, **kw):
        return self.c.request("POST", f"/v1/servers/{id}/actions", {"type": type, **kw})

    def actions(self, id: str):
        return self.c.request("GET", f"/v1/servers/{id}/actions")["data"]

    def update(self, id: str, **fields):
        return self.c.request("PATCH", f"/v1/servers/{id}", fields)

    def managed(self, id: str):
        """Managed tier status: health, the agent's last report and the install command while it is not reporting."""
        return self.c.request("GET", f"/v1/servers/{id}/managed")

    def delete(self, id: str):
        return self.c.request("DELETE", f"/v1/servers/{id}")

    def metrics(self, id: str, period: str = "1h"):
        """CPU, memory, network and disk series: minute resolution up to 24h, hourly for 7d and 30d."""
        return self.c.request("GET", f"/v1/servers/{id}/metrics", query={"period": period})

    def wait_until_active(self, id: str, timeout: float = 180.0, interval: float = 3.0):
        """Polls until the server is active or off. Raises PrgdError on failed or timeout."""
        until = time.time() + timeout
        while True:
            s = self.get(id)
            if s["status"] in ("active", "off"):
                return s
            if s["status"] == "failed":
                raise PrgdError(500, "server_failed", s.get("statusMessage") or "Server provisioning failed")
            if time.time() > until:
                raise PrgdError(504, "timeout", f"Server {id} is still {s['status']}")
            time.sleep(interval)


class _Deploys(_Res):
    def list(self):
        return self.c.request("GET", "/v1/deploys", query={"project": self.c.project})["data"]

    def get(self, id: str):
        return self.c.request("GET", f"/v1/deploys/{id}")

    def create(self, repo_url: Optional[str] = None, installation_id: Optional[str] = None, repo: Optional[str] = None, branch: str = "main", port: int = 3000, **kw):
        body = {"project": self.c.project, "repoUrl": repo_url, "installationId": installation_id, "repo": repo, "branch": branch, "port": port, **kw}
        return self.c.request("POST", "/v1/deploys", {k: v for k, v in body.items() if v is not None})

    def redeploy(self, id: str):
        return self.c.request("POST", f"/v1/deploys/{id}/redeploy", {})

    def logs(self, id: str):
        return self.c.request("GET", f"/v1/deploys/{id}/logs")


class _Firewalls(_Res):
    def list(self):
        return self.c.request("GET", "/v1/firewalls")["data"]

    def get(self, id: str):
        return self.c.request("GET", f"/v1/firewalls/{id}")

    def create(self, name: str, rules: list):
        return self.c.request("POST", "/v1/firewalls", {"project": self.c.project, "name": name, "rules": rules})

    def attach(self, id: str, server_id: str):
        return self.c.request("POST", f"/v1/firewalls/{id}/servers", {"serverId": server_id})

    def detach(self, id: str, server_id: str):
        return self.c.request("DELETE", f"/v1/firewalls/{id}/servers/{server_id}")

    def delete(self, id: str):
        return self.c.request("DELETE", f"/v1/firewalls/{id}")


class _Snapshots(_Res):
    def list(self):
        return self.c.request("GET", "/v1/snapshots")["data"]

    def delete(self, id: str):
        return self.c.request("DELETE", f"/v1/snapshots/{id}")


class _Volumes(_Res):
    SETTLED = ("available", "attached", "failed")

    def list(self, server: Optional[str] = None):
        return self.c.request("GET", "/v1/volumes", query={"project": self.c.project, "server": server})["data"]

    def get(self, id: str):
        return self.c.request("GET", f"/v1/volumes/{id}")

    def create(self, name: str, size_gb: int, region: Optional[str] = None, server_id: Optional[str] = None):
        body = {"name": name, "sizeGb": size_gb, "project": self.c.project}
        if region:
            body["region"] = region
        if server_id:
            body["serverId"] = server_id
        return self.c.request("POST", "/v1/volumes", body)

    def attach(self, id: str, server_id: str):
        return self.c.request("POST", f"/v1/volumes/{id}/attach", {"serverId": server_id})

    def detach(self, id: str):
        return self.c.request("POST", f"/v1/volumes/{id}/detach", {})

    def resize(self, id: str, size_gb: int):
        return self.c.request("POST", f"/v1/volumes/{id}/resize", {"sizeGb": size_gb})

    def delete(self, id: str):
        return self.c.request("DELETE", f"/v1/volumes/{id}")

    def wait_until_settled(self, id: str, timeout: float = 300.0, interval: float = 2.0):
        deadline = time.monotonic() + timeout
        while True:
            v = self.get(id)
            if v["status"] in self.SETTLED or time.monotonic() > deadline:
                return v
            time.sleep(interval)


class _LoadBalancers(_Res):
    def list(self):
        return self.c.request("GET", "/v1/load-balancers", query={"project": self.c.project})["data"]

    def get(self, id: str):
        return self.c.request("GET", f"/v1/load-balancers/{id}")

    def create(self, name: str, forwarding_rules, nodes: int = 1, server_ids=None, **kw):
        body = {"name": name, "forwardingRules": forwarding_rules, "nodes": nodes, "project": self.c.project, **kw}
        if server_ids:
            body["serverIds"] = server_ids
        return self.c.request("POST", "/v1/load-balancers", {k: v for k, v in body.items() if v is not None})

    def update(self, id: str, **fields):
        return self.c.request("PATCH", f"/v1/load-balancers/{id}", fields)

    def add_servers(self, id: str, server_ids):
        return self.c.request("POST", f"/v1/load-balancers/{id}/servers", {"serverIds": list(server_ids)})

    def remove_server(self, id: str, server_id: str):
        return self.c.request("DELETE", f"/v1/load-balancers/{id}/servers/{server_id}")

    def delete(self, id: str):
        return self.c.request("DELETE", f"/v1/load-balancers/{id}")

    def wait_until_active(self, id: str, timeout: float = 900.0, interval: float = 3.0):
        deadline = time.monotonic() + timeout
        while True:
            lb = self.get(id)
            if lb["status"] in ("active", "failed") or time.monotonic() > deadline:
                return lb
            time.sleep(interval)


class _Certificates(_Res):
    def list(self):
        return self.c.request("GET", "/v1/certificates", query={"project": self.c.project})["data"]

    def create(self, name: str, type: str, cert_pem: Optional[str] = None, key_pem: Optional[str] = None, domains=None):
        body = {"name": name, "type": type, "certPem": cert_pem, "keyPem": key_pem, "domains": domains, "project": self.c.project}
        return self.c.request("POST", "/v1/certificates", {k: v for k, v in body.items() if v is not None})

    def delete(self, id: str):
        return self.c.request("DELETE", f"/v1/certificates/{id}")


class _Domains(_Res):
    def list(self):
        return self.c.request("GET", "/v1/domains", query={"project": self.c.project})

    def get(self, name: str):
        return self.c.request("GET", f"/v1/domains/{name}")

    def create(self, name: str, ip: Optional[str] = None):
        body = {"name": name, "project": self.c.project}
        if ip:
            body["ip"] = ip
        return self.c.request("POST", "/v1/domains", body)

    def delete(self, name: str):
        return self.c.request("DELETE", f"/v1/domains/{name}")

    def add_record(self, zone: str, name: str, type: str, content: str, ttl: int = 3600, priority: Optional[int] = None):
        body = {"name": name, "type": type, "content": content, "ttl": ttl}
        if priority is not None:
            body["priority"] = priority
        return self.c.request("POST", f"/v1/domains/{zone}/records", body)

    def update_record(self, zone: str, id: str, **fields):
        return self.c.request("PATCH", f"/v1/domains/{zone}/records/{id}", fields)

    def delete_record(self, zone: str, id: str):
        return self.c.request("DELETE", f"/v1/domains/{zone}/records/{id}")

    def set_reverse_dns(self, public_ip_id: str, hostname: Optional[str]):
        return self.c.request("PUT", f"/v1/public-ips/{public_ip_id}/reverse-dns", {"name": hostname})


class _Buckets(_Res):
    def list(self):
        return self.c.request("GET", "/v1/buckets", query={"project": self.c.project})

    def get(self, name: str):
        return self.c.request("GET", f"/v1/buckets/{name}")

    def create(self, name: str, public: bool = False, region: Optional[str] = None):
        body = {"name": name, "public": public, "project": self.c.project}
        if region:
            body["region"] = region
        return self.c.request("POST", "/v1/buckets", body)

    def set_public(self, name: str, public: bool):
        return self.c.request("PATCH", f"/v1/buckets/{name}", {"public": public})

    def delete(self, name: str):
        return self.c.request("DELETE", f"/v1/buckets/{name}")

    def list_objects(self, name: str, prefix: str = "", token: Optional[str] = None):
        return self.c.request("GET", f"/v1/buckets/{name}/objects", query={"prefix": prefix, "token": token})

    def delete_object(self, name: str, key: str):
        return self.c.request("DELETE", f"/v1/buckets/{name}/objects", query={"key": key})

    def presign(self, name: str, key: str, method: str = "GET", expires_seconds: int = 900, content_type: Optional[str] = None):
        body = {"key": key, "method": method, "expiresSeconds": expires_seconds}
        if content_type:
            body["contentType"] = content_type
        return self.c.request("POST", f"/v1/buckets/{name}/presign", body)

    def upload(self, name: str, key: str, data: bytes, content_type: str = "application/octet-stream"):
        url = self.presign(name, key, "PUT", content_type=content_type)["url"]
        req = urllib.request.Request(url, data=data, method="PUT", headers={"Content-Type": content_type})
        with self.c._open(req, timeout=self.c.timeout) as res:
            return res.status


class _StorageKeys(_Res):
    def list(self):
        return self.c.request("GET", "/v1/storage-keys", query={"project": self.c.project})

    def create(self, name: str):
        return self.c.request("POST", "/v1/storage-keys", {"name": name, "project": self.c.project})

    def revoke(self, id: str):
        return self.c.request("DELETE", f"/v1/storage-keys/{id}")


class _AppPlatform(_Res):
    """App Platform: containers on shared hosts, sized and billed per instance."""

    def sizes(self):
        return self.c.request("GET", "/v1/app-platform/sizes")["data"]

    def list(self):
        return self.c.request("GET", "/v1/app-platform/apps", query={"project": self.c.project})["data"]

    def get(self, id: str):
        return self.c.request("GET", f"/v1/app-platform/apps/{id}")

    def create(self, name: str, repo_url: str | None = None, **kw):
        """Give repo_url, or installationId and repo for the GitHub App. Other keys: branch, port, size, instances, env, healthPath, gitToken."""
        body = {"name": name, "project": self.c.project, **kw}
        if repo_url:
            body["repoUrl"] = repo_url
        return self.c.request("POST", "/v1/app-platform/apps", body)

    def update(self, id: str, **fields):
        return self.c.request("PATCH", f"/v1/app-platform/apps/{id}", fields)

    def deploy(self, id: str):
        return self.c.request("POST", f"/v1/app-platform/apps/{id}/deploy", {})

    def stop(self, id: str):
        return self.c.request("POST", f"/v1/app-platform/apps/{id}/stop", {})

    def start(self, id: str):
        return self.c.request("POST", f"/v1/app-platform/apps/{id}/start", {})

    def delete(self, id: str):
        return self.c.request("DELETE", f"/v1/app-platform/apps/{id}")

    def logs(self, id: str, type: str = "build"):
        return self.c.request("GET", f"/v1/app-platform/apps/{id}/logs", query={"type": type})

    def add_domain(self, id: str, domain: str):
        return self.c.request("POST", f"/v1/app-platform/apps/{id}/domains", {"domain": domain})

    def remove_domain(self, id: str, domain: str):
        return self.c.request("DELETE", f"/v1/app-platform/apps/{id}/domains/{domain}")

    def wait_until_live(self, id: str, timeout: float = 1500.0, interval: float = 5.0):
        until = time.time() + timeout
        while True:
            a = self.get(id)
            if a["status"] == "live":
                return a
            if a["status"] == "failed":
                raise PrgdError(500, "app_failed", a.get("statusMessage") or "Build failed")
            if time.time() > until:
                raise PrgdError(504, "timeout", f"App {id} is still {a['status']}")
            time.sleep(interval)


class _Kubernetes(_Res):
    """Managed Kubernetes clusters."""

    def versions(self):
        return self.c.request("GET", "/v1/kubernetes/versions")["data"]

    def list(self):
        return self.c.request("GET", "/v1/kubernetes/clusters", query={"project": self.c.project})["data"]

    def get(self, id: str):
        return self.c.request("GET", f"/v1/kubernetes/clusters/{id}")

    def create(self, name: str, pools: list, version: str | None = None, ha: bool = False, **kw):
        """pools is a list of {"name", "size", "count", "labels"?, "taints"?}. Returns the cluster with status creating."""
        body = {"name": name, "pools": pools, "ha": ha, "project": self.c.project, **kw}
        if version:
            body["version"] = version
        return self.c.request("POST", "/v1/kubernetes/clusters", body)

    def delete(self, id: str):
        return self.c.request("DELETE", f"/v1/kubernetes/clusters/{id}")

    def kubeconfig(self, id: str) -> str:
        """The admin kubeconfig as YAML text."""
        return self.c.request_text("GET", f"/v1/kubernetes/clusters/{id}/kubeconfig")

    def add_pool(self, id: str, name: str, size: str, count: int, **kw):
        return self.c.request("POST", f"/v1/kubernetes/clusters/{id}/pools", {"name": name, "size": size, "count": count, **kw})

    def scale_pool(self, id: str, pool_id: str, count: int):
        return self.c.request("PATCH", f"/v1/kubernetes/clusters/{id}/pools/{pool_id}", {"count": count})

    def remove_pool(self, id: str, pool_id: str):
        return self.c.request("DELETE", f"/v1/kubernetes/clusters/{id}/pools/{pool_id}")

    def wait_until_active(self, id: str, timeout: float = 1800.0, interval: float = 10.0):
        until = time.time() + timeout
        while True:
            c = self.get(id)
            if c["status"] == "active":
                return c
            if c["status"] == "failed":
                raise PrgdError(500, "kubernetes_failed", c.get("statusMessage") or "Cluster provisioning failed")
            if time.time() > until:
                raise PrgdError(504, "timeout", f"Cluster {id} is still {c['status']}")
            time.sleep(interval)


class _Support(_Res):
    """Support plan and tickets."""

    def plans(self, currency: str = "USD"):
        return self.c.request("GET", "/v1/support/plans", query={"currency": currency})["data"]

    def plan(self):
        return self.c.request("GET", "/v1/support/plan")

    def set_plan(self, plan: str):
        return self.c.request("PUT", "/v1/support/plan", {"plan": plan})

    def tickets(self, status: str = "all"):
        return self.c.request("GET", "/v1/support/tickets", query={"status": status})["data"]

    def ticket(self, id: str):
        return self.c.request("GET", f"/v1/support/tickets/{id}")

    def open(self, subject: str, body: str, priority: str = "normal", resource: str | None = None):
        """Opens a ticket; resource is "server:<id>", "database:<id>" and so on."""
        req = {"subject": subject, "body": body, "priority": priority}
        if resource:
            req["resource"] = resource
        return self.c.request("POST", "/v1/support/tickets", req)

    def reply(self, id: str, body: str):
        return self.c.request("POST", f"/v1/support/tickets/{id}/messages", {"body": body})

    def close(self, id: str):
        return self.c.request("POST", f"/v1/support/tickets/{id}/close", {})


class _Databases(_Res):
    def list(self):
        return self.c.request("GET", "/v1/databases", query={"project": self.c.project})["data"]

    def get(self, id: str):
        return self.c.request("GET", f"/v1/databases/{id}")

    def create(self, name: str, engine: str, size: str, nodes: int = 1, trusted_sources=None, **kw):
        body = {"name": name, "engine": engine, "size": size, "nodes": nodes, "project": self.c.project, **kw}
        if trusted_sources:
            body["trustedSources"] = list(trusted_sources)
        return self.c.request("POST", "/v1/databases", {k: v for k, v in body.items() if v is not None})

    def update(self, id: str, **fields):
        return self.c.request("PATCH", f"/v1/databases/{id}", fields)

    def delete(self, id: str):
        return self.c.request("DELETE", f"/v1/databases/{id}")

    def add_user(self, id: str, name: str):
        return self.c.request("POST", f"/v1/databases/{id}/users", {"name": name})

    def reset_password(self, id: str, user_id: str):
        return self.c.request("POST", f"/v1/databases/{id}/users/{user_id}/reset-password", {})

    def delete_user(self, id: str, user_id: str):
        return self.c.request("DELETE", f"/v1/databases/{id}/users/{user_id}")

    def add_database(self, id: str, name: str):
        return self.c.request("POST", f"/v1/databases/{id}/dbs", {"name": name})

    def delete_database(self, id: str, db_id: str):
        return self.c.request("DELETE", f"/v1/databases/{id}/dbs/{db_id}")

    def backups(self, id: str):
        return self.c.request("GET", f"/v1/databases/{id}/backups")["data"]

    def backup_now(self, id: str):
        return self.c.request("POST", f"/v1/databases/{id}/backups", {})

    def wait_until_active(self, id: str, timeout: float = 900.0, interval: float = 5.0):
        deadline = time.monotonic() + timeout
        while True:
            c = self.get(id)
            if c["status"] in ("active", "failed") or time.monotonic() > deadline:
                return c
            time.sleep(interval)


class _Billing(_Res):
    def balance(self):
        return self.c.request("GET", "/v1/billing/balance")

    def usage(self, **query):
        return self.c.request("GET", "/v1/billing/usage", query={"project": self.c.project, **query})["data"]

    def invoices(self):
        return self.c.request("GET", "/v1/billing/invoices")["data"]

    def topup(self, amount_minor: int):
        return self.c.request("POST", "/v1/billing/topup", {"amountMinor": amount_minor})

    def pay_invoice(self, id: str):
        return self.c.request("POST", f"/v1/billing/invoices/{id}/pay", {})


class _Alerts(_Res):
    def list(self):
        return self.c.request("GET", "/v1/alerts")["data"]

    def get(self, id: str):
        return self.c.request("GET", f"/v1/alerts/{id}")

    def create(self, name: str, metric: str, threshold: float, comparator: str = "above", window_minutes: int = 5, server_ids=None, tags=None, emails=None):
        return self.c.request("POST", "/v1/alerts", {"name": name, "metric": metric, "threshold": threshold, "comparator": comparator, "windowMinutes": window_minutes, "serverIds": server_ids or [], "tags": tags or [], "emails": emails or []})

    def update(self, id: str, **fields):
        return self.c.request("PATCH", f"/v1/alerts/{id}", fields)

    def delete(self, id: str):
        return self.c.request("DELETE", f"/v1/alerts/{id}")

    def incidents(self, open: bool = False):
        return self.c.request("GET", "/v1/alerts/incidents", query={"open": "true" if open else None})["data"]


class _Approvals(_Res):
    def list(self, status: Optional[str] = None):
        return self.c.request("GET", "/v1/approvals", query={"status": status})

    def get(self, id: str):
        return self.c.request("GET", f"/v1/approvals/{id}")

    def approve(self, id: str):
        return self.c.request("POST", f"/v1/approvals/{id}/approve", {})

    def deny(self, id: str, reason: Optional[str] = None):
        return self.c.request("POST", f"/v1/approvals/{id}/deny", {"reason": reason} if reason else {})

    def wait(self, id: str, timeout: float = 600.0):
        until = time.time() + timeout
        while True:
            a = self.get(id)
            if a["status"] != "pending" or time.time() > until:
                return a
            time.sleep(5)

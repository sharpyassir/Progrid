# prgd (Python)

```sh
pip install prgd
```

```python
import os
from prgd import Prgd, PrgdError

prgd = Prgd(token=os.environ["PRGD_TOKEN"])
server = prgd.servers.create(name="web-1", size="s-1vcpu-1gb", image="ubuntu-24-04")
server = prgd.servers.wait_until_active(server["id"])
print("ssh root@" + server["networks"]["v4"][0]["ipAddress"])

try:
    prgd.servers.delete(server["id"])
except PrgdError as e:
    if e.needs_approval:
        print("waiting for a person:", prgd.approvals.wait(e.details["approvalId"])["status"])
```

No dependencies. Every write sends an `Idempotency-Key`. Responses are plain dicts shaped like the API reference. Run `python -m unittest` in this folder to test.

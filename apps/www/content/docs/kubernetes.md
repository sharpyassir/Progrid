---
title: Managed Kubernetes
description: Clusters we bootstrap and keep healthy, with load balancers and volumes that follow your manifests.
section: Guides
order: 20
---

## What you get

A managed cluster is plain upstream Kubernetes, set up with kubeadm on servers we own and keep for you:

- **Control plane.** One node is included with every cluster. Choose three for a control plane that survives a node loss; they share one address that stays with a healthy API server, and etcd runs across the three.
- **Node pools.** Workers are ordinary servers of the size you pick, at least 2 GB of memory, billed by the hour like any server. A cluster can have up to ten pools, each with its own size, labels and taints, and each pool scales up and down on its own.
- **Networking.** Flannel for the pod network, every node with a public and a private address, a firewall that opens the API, the NodePort range and nothing else from outside. Cluster traffic between nodes stays on the private network.
- **Cloud controller.** A Service of type LoadBalancer gets a platform load balancer within a minute, pointed at every worker by tag, with the address written back to the Service. A PersistentVolumeClaim with the default `prgd-block` class gets a block volume attached to the node the scheduler picked and mounted as a local PersistentVolume. Delete the Service or claim and the resource goes away.
- **kubeconfig.** Download the admin kubeconfig from the console, with `prgd kubernetes kubeconfig ID`, or from the API. It holds cluster admin credentials.

Versions on offer are the two newest minor releases. A cluster keeps its minor version; patch releases arrive through the node image.

## Create a cluster

```sh
prgd kubernetes create prod --size s-2vcpu-4gb --count 3 --wait
prgd kubernetes kubeconfig <id> > ~/.kube/prod.yaml
export KUBECONFIG=~/.kube/prod.yaml
kubectl get nodes
```

The same from the API:

```sh
curl -X POST https://api.progrid.co/v1/kubernetes/clusters \
  -H "Authorization: Bearer $PRGD_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"prod","ha":true,"pools":[{"name":"web","size":"s-2vcpu-4gb","count":3,"labels":{"tier":"web"}}]}'
```

Bootstrapping takes about ten minutes: the nodes boot, the first control plane node initializes the cluster, the others join, and the kubeconfig appears. The cluster page shows every node and whether the kubelet reports Ready.

## Pools

Add a pool with `prgd kubernetes pools ID add gpu --size s-8vcpu-16gb --count 2`, scale one with `pools ID scale POOL_ID 5`, and remove one with `pools ID rm POOL_ID`. Shrinking drains the highest numbered nodes first and deletes their servers. The last pool cannot be removed; delete the cluster instead. Each pool's nodes carry the label `prgd.dev/pool=<name>` plus any labels and taints you gave the pool.

## Load balancers and volumes

```yaml
apiVersion: v1
kind: Service
metadata: { name: web }
spec:
  type: LoadBalancer
  selector: { app: web }
  ports: [{ port: 80, targetPort: 8080 }]
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: data }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 20Gi } }
```

The Service gets a load balancer named after the cluster, namespace and Service, with a TCP rule per port to the matching NodePort and a health check on the first one; it shows under **Load balancers** and on the cluster page. The claim gets a volume of at least 10 GB attached to the node where the pod lands and mounted at `/var/lib/prgd/volumes/<id>`; the PersistentVolume pins the pod to that node. A pod that must move nodes needs its claim recreated, which is the usual trade off of node local block storage. Both are billed at the normal load balancer and volume prices.

## Pricing

Worker nodes cost the same as servers of that size. A single control plane node is included. Three control plane nodes cost a flat $40 a month. Load balancers and volumes made by the cloud controller are billed as usual. Deleting a cluster deletes its nodes, its load balancers and its volumes, and stops every charge.

## Limits

The control plane certificates are renewed every month, one control plane node a day apart, and etcd is snapshotted daily to a platform bucket kept with the cluster. Nodes talk to each other, and the kubelet registers, on the private network.

One region per cluster. Up to ten pools and fifty nodes per pool. The API server is reachable from the internet and protected by client certificates; there is no allow list yet. Cluster upgrades between minor versions are not automated: create a new cluster and move workloads over.

# Phase 1: In-cluster Prism (per-namespace, no result copy-out)

Deploy Prism as a pod in an llm-d-benchmark **harness namespace** and mount the
benchmark results PVC (`workload-pvc`) read-only. Prism then plots and compares
results straight off the PVC — no `kubectl cp` and no object-storage upload.

## How it works

Prism's backend already serves benchmark files from a server-side directory via
`/api/local/*` (`server/server.js:152-199`). That directory is hardcoded to
`/app/private/benchmarks`. We mount `workload-pvc` there read-only, so every run
under `<pvc>/<experiment_id>_<idx>/` shows up in Prism's "Local" data source with
**zero backend code changes**.

Because `workload-pvc` is `ReadWriteMany`, Prism can read it while the harness and
data-access pods keep writing.

## Prerequisites

- A namespace where `llmdbenchmark run` has already created `workload-pvc`
  (check: `oc get pvc workload-pvc -n <ns>`).
- A published Prism container image (set it in `kustomization.yaml` → `images`).

## Deploy

```sh
# OpenShift
kustomize build deploy/k8s | oc apply -n <harness-namespace> -f -
oc get route prism -n <harness-namespace>   # -> URL

# Vanilla Kubernetes: swap route.yaml for ingress.yaml in kustomization.yaml
kustomize build deploy/k8s | kubectl apply -n <harness-namespace> -f -
```

## Files

| File              | Purpose                                                        |
| ----------------- | -------------------------------------------------------------- |
| `deployment.yaml` | Prism pod; mounts `workload-pvc` read-only at the served path. |
| `service.yaml`    | ClusterIP on 8080.                                             |
| `route.yaml`      | OpenShift Route (TLS edge).                                    |
| `ingress.yaml`    | Vanilla-k8s alternative to the Route.                          |
| `kustomization.yaml` | Ties it together; sets namespace + image.                   |

## Scope / caveats

- **Per namespace.** A pod can only mount PVCs from its own namespace, so this
  gives one Prism per harness namespace. That is the intended Phase 1 model —
  RBAC is implicit (whoever can reach the Route in that namespace sees its data).
- **Local source may be dev-gated in the UI.** Verify the "Local" data
  connection is selectable in a production build; if it is hidden behind a dev
  flag, expose it (small frontend change) — the `/api/local/*` endpoints
  themselves are always on.
- **Optional nicety:** make the served directory configurable via an env var
  (e.g. `LOCAL_BENCHMARKS_DIR`) instead of relying on the `/app/private/benchmarks`
  mount path — a ~2-line change in `server/server.js`.
- **Auth:** the Route is open by default. To gate on cluster permissions, add an
  `oauth-proxy` sidecar with `--openshift-sar` (Phase 2).

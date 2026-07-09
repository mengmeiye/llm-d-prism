# Proposal: In-cluster Prism for direct benchmark result visualization

**Status:** Draft
**Author:** Mengmei Ye, Angelo Ruocco
**Date:** 2026-07-09
**Target repos:** `llm-d-prism`, `llm-d-benchmark`

## Summary

Run Prism as a pod inside a Kubernetes / OpenShift cluster and mount the
llm-d-benchmark results PVC (`workload-pvc`) read-only. Prism then plots and
compares benchmark reports **directly from the PVC**, per namespace, with no
need to copy results out of the cluster first.

Phase 1 (this proposal) delivers a per-namespace deployment with **no backend
code changes**. Phase 2 (design sketched below) covers a centralized,
RBAC-gated, cluster-wide instance.

## Motivation

Today, viewing benchmark results in Prism requires getting the data *out* of the
cluster first. After `llmdbenchmark run` writes results to `workload-pvc`
(mounted at `/requests`), users must either:

- `kubectl cp` the run directory from a data-access pod
  (`llm-d-benchmark/.../step_09_collect_results.py`), or
- upload results to object storage (GCS/S3) via `step_10_upload_results.py`,
  then point Prism at that bucket.

Both add a manual copy/upload step, a place for results to go stale or diverge,
and (for object storage) an external dependency and credentials. For the common
case — "I ran a benchmark in my namespace and want to see the charts" — this is
friction with no payoff.

**Goal:** let anyone with access to a benchmark namespace open Prism and see that
namespace's results immediately, without copying anything.

## Background: how the pieces work today

- **Prism** is a React SPA + Node/Express backend, shipped as a container. Its
  backend already serves benchmark files from a **server-side directory** via
  `/api/local/list` and `/api/local/file/*` (`server/server.js:152-199`). That
  directory is hardcoded to `/app/private/benchmarks`. Prism has no Kubernetes
  API interaction today.
- **llm-d-benchmark** writes results to a PVC named `workload-pvc`
  (`ReadWriteMany`, default 20Gi), one subdirectory per run at
  `<pvc>/<experiment_id>_<idx>/`. The PVC lives in the **harness namespace**.

The key observation: Prism's existing "local files" feature is exactly the hook
we need. If the results PVC is mounted where Prism already looks, results appear
with zero new code.

## Proposed design (Phase 1)

Deploy Prism into a harness namespace with `workload-pvc` mounted **read-only**
at `/app/private/benchmarks`:

```
┌────────────────────── namespace: <harness-ns> ──────────────────────┐
│                                                                      │
│  harness pods ──write──▶ ┌───────────────┐                          │
│  data-access pod ───────▶│ workload-pvc  │ (RWX, /requests)          │
│                          └──────┬────────┘                          │
│                                 │ mount read-only                    │
│                                 ▼                                    │
│                          ┌─────────────┐      Route/Ingress          │
│   user ───browser──────▶ │   Prism     │◀──────────────────          │
│                          │ (Deployment)│                             │
│                          └─────────────┘                             │
└──────────────────────────────────────────────────────────────────── ┘
```

Because `workload-pvc` is `ReadWriteMany`, Prism can read it concurrently while
the harness and data-access pods keep writing.

Manifests (see `deploy/k8s/`):

- `deployment.yaml` — Prism pod, mounts `workload-pvc` read-only; OpenShift
  restricted-SCC-compatible security context.
- `service.yaml` — ClusterIP on 8080.
- `route.yaml` / `ingress.yaml` — external access (OpenShift Route or k8s Ingress).
- `kustomization.yaml` — sets namespace + image.

Deploy:

```sh
kustomize build deploy/k8s | oc apply -n <harness-namespace> -f -
```

### Why per-namespace

A pod can only mount PVCs **from its own namespace**. So this model yields one
Prism instance per harness namespace. That is a feature, not a limitation, for
Phase 1: access control is implicit (whoever can reach the namespace's Route sees
that namespace's data, nothing else), and it maps cleanly onto how teams already
isolate benchmark runs.

### Optional integration with `llm-d-benchmark`

Add an opt-in flag (e.g. `--with-prism`) to `llmdbenchmark run` that applies these
manifests into the harness namespace, so a benchmark run can stand up its own
viewer. This is additive and off by default.

## Scope

**In scope (Phase 1):**
- Kustomize manifests to run Prism in a namespace against `workload-pvc`.
- Docs for deploying and (optionally) wiring into `llmdbenchmark run`.

**Deferred to Phase 2 (design sketched below, delivered separately):**
- A single centralized Prism reading many namespaces.
- User-token-based RBAC (oauth-proxy + SubjectAccessReview / impersonation).
- Reading results via the Kubernetes API instead of a PVC mount.

## Phase 2: cluster-wide Prism (design sketch)

Phase 1 gives one Prism per namespace. A natural follow-up is a **single,
cluster-wide Prism** — one URL where a user picks any namespace they can access
and sees its results. This section sketches how, so reviewers can judge the full
arc; it is not part of the Phase 1 deliverable.

### The hard constraint

PVCs are namespaced, and **a pod can only mount a PVC in its own namespace**.
There is no "mount PVC from another namespace" primitive. So a single central
Prism pod *cannot* just mount every namespace's `workload-pvc`. That rules out the
obvious approach and shapes the three options below.

### Option A — API-based reads (recommended for Phase 2)

One central Prism in its own namespace (e.g. `prism-system`). Instead of mounting
PVCs, its backend talks to the Kubernetes API: for a chosen namespace it `exec`s
into that namespace's **data-access pod** — which already mounts `workload-pvc` at
`/requests` and idles with `sleep infinity` — and streams the result files out.
This is programmatically the same operation as `kubectl cp` / `kubectl exec … cat`,
which is exactly how results leave the cluster today.

```
┌──────────── namespace: prism-system ────────────┐
│                                                  │
│  user ──▶ Route ──▶ [oauth-proxy] ──▶ [ Prism ]  │
│                       (captures         │  k8s   │
│                        user token)      │  client│
└─────────────────────────────────────────┼────────┘
                                           │ exec/read, with user token
              ┌────────────────────────────┼───────────────┐
              ▼                             ▼               ▼
     ns: team-a                    ns: team-b        ns: team-c
   data-access pod               data-access pod   data-access pod
   └─ workload-pvc               └─ workload-pvc    └─ workload-pvc
```

**RBAC is the payoff here.** An `oauth-proxy` sidecar authenticates the user and
captures their token; Prism forwards *that token* (not its own service account) to
the Kubernetes API. The cluster then enforces access natively — a user sees a
namespace only if they already have `pods/exec` (or read) rights there. No
bespoke authorization logic in Prism, and no over-privileged central service
account. On OpenShift this is the same pattern console-adjacent tools use
(`oauth-proxy` with `--openshift-sar` for coarse gating, user-token passthrough
for fine gating).

**What needs building:**
- Add a Kubernetes client to the Node backend (`@kubernetes/client-node`).
- New API routes: list candidate namespaces (those with a data-access pod /
  `workload-pvc`), list runs in one, and stream a file — mirroring today's
  `/api/local/*` shape so the frontend changes stay small.
- Namespace picker in the UI.
- `oauth-proxy` sidecar + Route, and token passthrough to the API client.

**Caveats:**
- Depends on the per-namespace data-access pod existing. It is long-lived, but
  only after a run has set it up; Prism should degrade gracefully when absent.
- `exec`-based streaming is fine for browsing/plotting; it is not a
  high-throughput file transfer. Cache reads server-side.
- Requires the cluster to expose OIDC/OpenShift OAuth for `oauth-proxy`.

### Option B — fan-out deployment (lower-effort fallback)

Keep the Phase 1 per-namespace model, but deploy it from a **single management
surface**: an Operator or Argo CD ApplicationSet that watches for namespaces
containing a `workload-pvc` and stamps out a Prism (+ Service + Route) in each.

- **Pro:** zero Prism code change; reuses Phase 1 verbatim; isolation and RBAC
  stay implicit and simple.
- **Con:** N pods and N URLs, not one pane of glass. "Cluster-wide" in coverage
  and management, not in runtime.

Good if the real pain is "I don't want to hand-apply manifests in every
namespace" rather than "I want one URL."

### Option C — shared storage (not recommended)

Have all runs write to one shared volume (a central PVC, or per-namespace static
PVs backed by the same NFS export), which the central Prism mounts.

- **Con:** requires an `llm-d-benchmark`-side change to where results are written,
  and it collapses the namespace isolation of results (one pool, everyone sees
  everything). Listed for completeness; not advised.

### Recommendation

- If "cluster-wide" means **one URL, pick-any-namespace, RBAC-gated per user** →
  **Option A**. It directly realizes the original vision and keeps authorization
  in the cluster where it belongs.
- If it means **one thing to manage, keep isolation, minimal effort** →
  **Option B**.
- Avoid **Option C** unless shared, non-isolated result storage is independently
  desired.

## Alternatives considered

1. **Keep copying to object storage (status quo).** Works, but keeps the manual
   step and external dependency this proposal removes. Still fully supported —
   this proposal is additive, not a replacement.
2. **Single central Prism mounting every namespace's PVC.** Not possible: a pod
   cannot mount PVCs from other namespaces. The centralized vision requires the
   Kubernetes API + auth work deferred to Phase 2.
3. **Sidecar Prism in the harness pod.** Ties Prism's lifecycle to a single run
   (harness pods are `restartPolicy: Never`); a namespace-scoped Deployment
   outlives runs and shows all of them.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Prism's "Local" data source is dev-gated in the production UI. | Endpoints (`/api/local/*`) are always on; if the UI hides the source, expose it (small frontend change). Verify before rollout. |
| Hardcoded served path (`/app/private/benchmarks`) couples us to a mount location. | Mounting there works today; optionally add a `LOCAL_BENCHMARKS_DIR` env var (~2 lines) to decouple. |
| Open Route exposes results to anyone who can reach it. | Acceptable within a trusted namespace for Phase 1; real per-user gating is Phase 2 (oauth-proxy `--openshift-sar`). |
| `RWO`-only storage class would block a second mount. | `workload-pvc` defaults to `ReadWriteMany`; document the requirement and fail clearly if RWO. |
| PVC contains partial/in-progress runs. | Read-only mount is safe; Prism already tolerates incomplete report sets. |

## Effort estimate

- **Phase 1:** small. Manifests + docs already drafted; the only code touchpoints
  are (a) confirming/exposing the Local source in the UI and (b) an optional env
  var for the served path. No new services, no auth, no k8s client.
- **Phase 2, Option A (API-based, one URL):** medium. k8s client in the backend,
  new list/stream API routes, a namespace picker, and oauth-proxy + user-token
  passthrough. No changes to `llm-d-benchmark`.
- **Phase 2, Option B (fan-out deploy):** small-to-medium, mostly ops. An
  Operator or Argo CD ApplicationSet over the Phase 1 manifests; no Prism code
  change.

## Open questions

- Where is the canonical published Prism image (registry + tag)?
- Should `llmdbenchmark run` gain a `--with-prism` flag, or is manual
  `kustomize apply` sufficient for now?
- Is the "Local" data source enabled in production builds, or dev-only?

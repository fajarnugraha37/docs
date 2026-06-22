# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-026.md

# Part 026 — Operational Scripts: Diagnostics, Runbooks, Incident Tools

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: membangun script operasional untuk diagnostics, runbooks, incident response, evidence collection, smoke checks, health checks, log collection, redaction, dan troubleshooting production-like systems secara aman.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya membahas release dan deployment automation:

- artifact identity;
- image digest;
- plan/apply;
- promotion;
- health check;
- rollback;
- deployment result artifacts.

Part 026 membahas dunia setelah deploy:

> Bagaimana script membantu engineer memahami sistem saat ada masalah?

Operational scripts berbeda dari build/release scripts.

Build/release scripts menjawab:

```text
Bagaimana membuat dan mengirim perubahan?
```

Operational scripts menjawab:

```text
Apa yang sedang terjadi?
Apa bukti yang bisa dikumpulkan?
Apa status dependency?
Apa perubahan terakhir?
Apa langkah runbook yang aman?
Apa yang perlu dieskalasi?
```

Operational automation harus sangat hati-hati karena sering dijalankan saat incident, dalam kondisi stres, dengan akses production.

---

## 1. Operational Script Mindset

Operational scripts harus:

- safe by default;
- read-only by default;
- time-bounded;
- explicit about environment;
- secret-safe;
- produce actionable output;
- collect evidence without destroying it;
- work under pressure;
- fail clearly;
- avoid making incident worse.

Goal bukan “script pintar yang melakukan segalanya”.

Goal:

> Reduce cognitive load during operational pressure.

Good operational script:

```bash
./scripts/diagnose-service.sh --env staging --service payment
```

Outputs:

```text
==> Context
service: payment
environment: staging
cluster: staging-cluster

==> Health
health endpoint: OK
version: 1.2.3

==> Kubernetes
deployment: ready 3/3
last rollout: 2026-06-22T10:00:00Z

==> Recent errors
...
```

---

## 2. Categories of Operational Scripts

Common categories:

1. **Health checks**
2. **Smoke tests**
3. **Diagnostics collection**
4. **Runbook helpers**
5. **Incident evidence bundle**
6. **Dependency status checks**
7. **Config inspection**
8. **Version/build metadata checks**
9. **Log search helpers**
10. **Thread dump/heap dump helpers**
11. **Kubernetes/cloud context checks**
12. **Safe remediation helpers**
13. **Rollback helpers**
14. **Post-incident data export**

Each category has different risk.

---

## 3. Read-Only First

Operational scripts should default to read-only.

Good:

```bash
diagnose
status
health
logs
collect
plan
```

Riskier:

```bash
restart
scale
rollback
delete
migrate
purge
```

For mutating scripts:

- require explicit `--apply`;
- show plan;
- validate environment;
- include confirmation only for local, not CI;
- require CI/platform permission for production;
- log action.

Runbook principle:

> Observe first, mutate later.

---

## 4. Operational Target Naming

Make targets:

```make
.PHONY: ops/status ops/health ops/logs ops/diagnose ops/collect ops/runbook

ops/status:
	./scripts/ops/status.sh --env "$(ENV)"

ops/diagnose:
	./scripts/ops/diagnose-service.sh --env "$(ENV)" --service "$(SERVICE)"

ops/collect:
	./scripts/ops/collect-evidence.sh --env "$(ENV)" --service "$(SERVICE)"
```

Riskier:

```make
ops/restart/plan
ops/restart/apply
ops/rollback/plan
ops/rollback/apply
```

Names should communicate safety.

---

## 5. Environment Explicitness

Operational scripts must not guess production/staging.

Bad:

```bash
kubectl get pods
```

This uses current context.

Better:

```bash
./diagnose-service.sh --env staging --service payment
```

Script maps env to expected context:

```bash
case "$ENVIRONMENT" in
  staging) EXPECTED_CONTEXT="staging-cluster" ;;
  prod) EXPECTED_CONTEXT="prod-cluster" ;;
  *) die "Invalid env" ;;
esac
```

Then validates:

```bash
current="$(kubectl config current-context)"
[[ "$current" == "$EXPECTED_CONTEXT" ]] || die "Wrong context: $current"
```

Production diagnostics can still be read-only, but context must be explicit.

---

## 6. Time-Bounded Checks

Incident scripts must not hang.

Examples:

```bash
curl --max-time 10 --connect-timeout 3
```

PowerShell:

```powershell
Invoke-RestMethod -Uri $Uri -TimeoutSec 10
```

Kubernetes:

```bash
kubectl rollout status deployment/app --timeout=60s
```

Use overall timeout where possible.

A diagnostic script stuck forever is bad operational UX.

---

## 7. Health Check vs Smoke Test vs Diagnostics

### Health check

Checks basic liveness/readiness.

```text
GET /actuator/health
```

### Smoke test

Checks minimal business path.

```text
Can create test request?
Can call critical read API?
```

### Diagnostics

Collects state for investigation.

```text
pods, logs, events, config, metrics snapshot
```

Do not confuse them.

A service can be “healthy” but business path broken.

---

## 8. Health Check Script

Bash:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

URL="${1:?Usage: health.sh URL}"

response="$(curl --fail --silent --show-error --max-time 10 "$URL")" || die "Health check failed: $URL"

printf '%s\n' "$response"
```

PowerShell:

```powershell
#requires -Version 7.0

param(
  [Parameter(Mandatory)]
  [string] $Uri
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$response = Invoke-RestMethod -Uri $Uri -TimeoutSec 10
$response
```

For production, validate expected response shape.

---

## 9. Health Check with Version Validation

```bash
expected_version="${EXPECTED_VERSION:-}"

json="$(curl --fail --silent --show-error --max-time 10 "$HEALTH_URL")"

status="$(jq -r '.status' <<<"$json")"
version="$(jq -r '.version // empty' <<<"$json")"

[[ "$status" == "UP" || "$status" == "OK" ]] || die "Unhealthy status: $status"

if [[ -n "$expected_version" && "$version" != "$expected_version" ]]; then
  die "Wrong version. expected=$expected_version actual=$version"
fi
```

This catches deploy mismatch.

---

## 10. Diagnostics Bundle

A diagnostics bundle is a directory/tarball containing:

```text
metadata.json
environment.txt
health.json
version.json
pods.txt
events.txt
logs/
config-redacted.json
thread-dump.txt
docker.txt
system.txt
```

Generate:

```text
build/diagnostics/payment-staging-20260622T100000Z/
```

Archive:

```bash
tar -czf diagnostics.tar.gz build/diagnostics/...
```

Do not include secrets.

---

## 11. Evidence Collection Principles

During incident, evidence matters.

Rules:

1. Collect before mutating if possible.
2. Timestamp everything.
3. Include environment/service/version.
4. Redact secrets.
5. Avoid excessive data volume.
6. Store as artifact.
7. Make collection repeatable.
8. Do not require interactive prompts.
9. Do not change state unless explicitly requested.
10. Prefer structured metadata.

---

## 12. Diagnostics Metadata

`metadata.json`:

```json
{
  "service": "payment-service",
  "environment": "staging",
  "collectedAt": "2026-06-22T10:00:00Z",
  "collector": "collect-evidence.sh",
  "gitCommit": "abc123",
  "operator": "ci-or-user",
  "redaction": "enabled"
}
```

Do not include secrets.

---

## 13. Bash Evidence Collector Skeleton

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '==> %s\n' "$*" >&2; }

ENVIRONMENT=""
SERVICE=""
OUT_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENVIRONMENT="${2:?}"; shift 2 ;;
    --service) SERVICE="${2:?}"; shift 2 ;;
    --out) OUT_DIR="${2:?}"; shift 2 ;;
    *) die "Unknown arg: $1" ;;
  esac
done

[[ "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]] || die "Invalid env"
[[ -n "$SERVICE" ]] || die "--service is required"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${OUT_DIR:-build/diagnostics/${SERVICE}-${ENVIRONMENT}-${timestamp}}"
mkdir -p "$OUT_DIR/logs"

log "Writing metadata"
cat > "$OUT_DIR/metadata.json" <<JSON
{
  "service": "$SERVICE",
  "environment": "$ENVIRONMENT",
  "collectedAt": "$timestamp"
}
JSON

log "Collecting health"
curl --silent --show-error --max-time 10 "https://${SERVICE}.${ENVIRONMENT}.example.com/actuator/health" \
  > "$OUT_DIR/health.json" || true

log "Collecting kubernetes state"
kubectl get deploy,pod,svc -l "app=$SERVICE" -o wide > "$OUT_DIR/k8s-resources.txt" || true
kubectl get events --sort-by=.lastTimestamp > "$OUT_DIR/k8s-events.txt" || true

log "Done: $OUT_DIR"
```

Note `|| true` for collection steps can be okay if final script reports partial failures. But do not hide everything silently.

---

## 14. Partial Collection Result

Diagnostics collection may partially fail.

Output summary:

```json
{
  "status": "partial",
  "checks": [
    {"name": "health", "status": "ok"},
    {"name": "k8s-events", "status": "failed", "error": "forbidden"}
  ]
}
```

Do not exit success without indicating partial failures.

Possible policy:

- exit 0 if bundle created even with partial failures, but summary says partial;
- exit non-zero if critical collection failed.

Choose and document.

---

## 15. Redaction

Logs/config may contain secrets.

Redaction strategies:

- never collect known secret sources;
- redact keys matching patterns;
- use platform tooling that hides secrets;
- avoid `kubectl get secret -o yaml`;
- avoid env dump;
- avoid full config dump;
- sanitize before writing artifact.

Bad:

```bash
kubectl describe pod > pod.txt
```

This may include env vars. Sometimes okay, sometimes risky.

Safer:

```bash
kubectl get pod -o json | jq 'del(.items[].spec.containers[].env[]? | select(.name | test("TOKEN|PASSWORD|SECRET")))'
```

Redaction is hard. Be conservative.

---

## 16. Secret Pattern Redaction

Simple redactor:

```bash
redact() {
  sed -E \
    -e 's/(password|token|secret|api[_-]?key)=([^[:space:]]+)/\1=<redacted>/Ig' \
    -e 's/(Authorization: Bearer )[A-Za-z0-9._-]+/\1<redacted>/Ig'
}
```

Use:

```bash
some_command | redact > output.txt
```

This is not perfect. Do not rely on regex redaction as sole protection for high-risk data.

Better: do not collect secrets.

---

## 17. Operational Scripts and Logs

Log search helper:

```bash
./scripts/ops/logs.sh --env prod --service payment --since 30m --grep ERROR
```

Responsibilities:

- validate env/service;
- bound time range;
- avoid dumping infinite logs;
- support output file;
- redact if needed;
- show command context;
- fail clearly if no access.

Kubernetes example:

```bash
kubectl logs deployment/payment-service --since=30m --all-containers=true
```

But production log access may be via centralized logging, not kubectl.

---

## 18. Time Range Defaults

Avoid unbounded log queries.

Good default:

```text
--since 15m
```

User can override:

```text
--since 2h
```

Validate max range:

```text
Refuse >24h unless --force
```

Operational scripts should protect systems and users from accidental huge queries.

---

## 19. Runbook Automation

A runbook describes steps.

Bad runbook:

```text
Run some kubectl commands and look around.
```

Better:

```text
1. make ops/status ENV=prod SERVICE=payment
2. make ops/logs ENV=prod SERVICE=payment SINCE=30m
3. make ops/collect ENV=prod SERVICE=payment
4. If health failed after deploy, run deploy rollback plan.
```

Best: scripts implement repeatable read-only steps.

Runbook helper target:

```make
ops/runbook/payment:
	./scripts/ops/payment-runbook.sh --env "$(ENV)"
```

But avoid huge unsafe automated remediation.

---

## 20. Incident Modes

Operational scripts can support modes:

```text
status
diagnose
collect
plan-remediation
apply-remediation
```

Keep observe and mutate separate.

Example:

```bash
./service-incident.sh diagnose --env prod --service payment
./service-incident.sh restart-plan --env prod --service payment
./service-incident.sh restart-apply --env prod --service payment
```

---

## 21. Safe Remediation

Some remediation can be automated:

- restart deployment;
- scale replicas;
- clear local cache;
- rotate feature flag;
- rollback to previous version.

But apply should require explicitness.

Make:

```make
ops/restart/plan:
	./scripts/ops/restart-service.sh --env "$(ENV)" --service "$(SERVICE)" --plan

ops/restart/apply:
	./scripts/ops/restart-service.sh --env "$(ENV)" --service "$(SERVICE)" --apply
```

CI/prod permissions should still apply.

---

## 22. Restart Is Not Root Cause

Restart scripts are useful but dangerous culturally.

If restart fixes symptom, still collect:

- logs before restart;
- pod events;
- metrics snapshot;
- version;
- heap/thread dump if relevant.

Runbook:

```text
collect evidence -> restart if needed -> verify -> record
```

Do not let automation erase evidence first.

---

## 23. JVM Diagnostics

For Java services, diagnostics may include:

- thread dump;
- heap info;
- GC logs;
- JVM flags;
- process RSS;
- open file descriptors;
- deadlock detection;
- actuator metrics;
- JFR recording if enabled/allowed.

Tools:

```text
jcmd
jstack
jmap
jfr
jstat
```

In containers/Kubernetes, access may be limited.

---

## 24. Thread Dump

Kubernetes example:

```bash
pod="$(kubectl get pod -l app="$SERVICE" -o jsonpath='{.items[0].metadata.name}')"
kubectl exec "$pod" -- jcmd 1 Thread.print > thread-dump.txt
```

Caveats:

- PID may not be 1;
- tool may not exist in JRE runtime image;
- exec permission may be restricted;
- thread dump may contain sensitive data in thread names/stack values rarely.

Prefer app-provided diagnostics endpoints if available and secured.

---

## 25. Heap Dump

Heap dumps are sensitive and large.

Rules:

- do not collect by default;
- require explicit `--heap-dump`;
- warn about sensitive data;
- store securely;
- avoid uploading to broad CI artifacts;
- use retention policy;
- ensure disk space.

Heap dump command:

```bash
jcmd <pid> GC.heap_dump /tmp/heap.hprof
```

This can pause app. Do not casually automate in prod.

---

## 26. Actuator Endpoints

Spring Boot Actuator can expose:

- `/actuator/health`
- `/actuator/info`
- `/actuator/metrics`
- `/actuator/loggers`
- `/actuator/threaddump`
- `/actuator/heapdump`

Security matters.

Operational scripts can call allowed endpoints.

Never expose sensitive actuator endpoints publicly.

Script should know which endpoints are safe per environment.

---

## 27. Dependency Diagnostics

Service issues often come from dependencies:

- database;
- Redis;
- Kafka;
- external API;
- DNS;
- TLS;
- network policy.

Operational script can check:

```text
Can resolve host?
Can open TCP connection?
Can authenticate?
Can run lightweight query?
Is dependency status endpoint healthy?
```

But avoid destructive checks.

---

## 28. DNS and Network Checks

Bash:

```bash
getent hosts "$HOST"
```

Port check:

```bash
nc -zv "$HOST" "$PORT"
```

But `nc` variants differ.

PowerShell:

```powershell
Test-NetConnection -ComputerName $Host -Port $Port
```

Cross-platform PowerShell alternative:

```powershell
$client = [System.Net.Sockets.TcpClient]::new()
$client.Connect($Host, $Port)
$client.Dispose()
```

Operational scripts must account for available tools.

---

## 29. TLS Diagnostics

Check certificate:

```bash
openssl s_client -connect "$HOST:443" -servername "$HOST" </dev/null
```

This can be verbose.

Script should extract:

- subject;
- issuer;
- expiry;
- SAN;
- verification result.

PowerShell can use .NET APIs but more code.

For incident, even wrapping `openssl` with sane output helps.

---

## 30. Database Diagnostics

Read-only checks:

- connection;
- version;
- current connections count;
- migration version;
- slow query count if accessible;
- replication lag.

Do not put DB passwords in command line.

Use env/secret file.

For Java apps, app health endpoint may already include DB health. But direct DB check can isolate app vs DB issue.

---

## 31. Kafka Diagnostics

Common:

- broker reachable;
- topic exists;
- consumer group lag;
- recent errors;
- schema registry available.

Use platform-approved tooling.

Do not write messages to production topics from diagnostic script unless explicit and safe.

---

## 32. Kubernetes Diagnostics

Useful commands:

```bash
kubectl get deploy,rs,pod,svc,ingress -l app="$SERVICE" -o wide
kubectl describe deploy "$SERVICE"
kubectl get events --sort-by=.lastTimestamp
kubectl logs deployment/"$SERVICE" --since=30m --all-containers=true
kubectl rollout status deployment/"$SERVICE" --timeout=60s
```

Wrap with env/context validation.

Avoid collecting secrets.

---

## 33. Cloud Diagnostics

Cloud-specific:

- load balancer target health;
- autoscaling state;
- recent deployment events;
- IAM identity;
- service quota;
- error logs;
- network ACL/security groups.

Use cloud CLI or API.

Scripts should validate account/project/subscription.

---

## 34. Output Formats

Operational scripts should support:

```text
human text
json
bundle
```

Example:

```bash
./diagnose.sh --env prod --service payment --output text
./diagnose.sh --env prod --service payment --output json
./collect.sh --env prod --service payment --bundle
```

Machine-readable JSON helps CI/incidents.

Human text helps interactive debugging.

---

## 35. Exit Codes for Operational Scripts

Suggested:

```text
0 healthy/success
1 unhealthy/operational failure
2 usage/config error
3 partial collection
```

But be consistent and document.

For diagnostics, non-zero may indicate script failed, not service unhealthy. Decide carefully.

Example health check:

```text
0 service healthy
1 service unhealthy/unreachable
2 invalid input
```

Diagnostics bundle:

```text
0 bundle complete
3 bundle partial
2 usage error
```

---

## 36. Operational Script UX

During incident, UX matters.

Good:

```text
ERROR: Wrong Kubernetes context.
Expected: prod-cluster
Actual: staging-cluster
Refusing to continue.
```

Bad:

```text
Forbidden
```

Good:

```text
No pods found for service=payment in namespace=payments.
Checked context=prod-cluster namespace=payments.
```

Include context.

---

## 37. Avoid Too Much Magic

Operational scripts should not silently:

- switch kubectl context;
- create credentials;
- delete/recreate resources;
- restart services;
- change namespace;
- widen log time range;
- fallback prod/staging.

Make actions visible.

It is okay to compute defaults, but print them:

```text
Using namespace: payments
Using context: prod-cluster
Using since: 30m
```

---

## 38. Audit Trail

For mutating operational scripts, record:

- who/CI run;
- when;
- env;
- service;
- action;
- reason/ticket if required;
- before/after state;
- result.

This may be in:

- CI logs;
- deployment system;
- incident management;
- audit DB;
- structured result file.

Script can require:

```bash
--reason "INC-1234"
```

for prod actions.

---

## 39. Makefile Ops Facade

```make
ENV ?=
SERVICE ?=
SINCE ?= 30m

.PHONY: ops/status ops/health ops/logs ops/collect ops/restart/plan ops/restart/apply

ops/status:
	./scripts/ops/status.sh --env "$(ENV)" --service "$(SERVICE)"

ops/health:
	./scripts/ops/health.sh --env "$(ENV)" --service "$(SERVICE)"

ops/logs:
	./scripts/ops/logs.sh --env "$(ENV)" --service "$(SERVICE)" --since "$(SINCE)"

ops/collect:
	./scripts/ops/collect-evidence.sh --env "$(ENV)" --service "$(SERVICE)"

ops/restart/plan:
	./scripts/ops/restart-service.sh --env "$(ENV)" --service "$(SERVICE)" --plan

ops/restart/apply:
	./scripts/ops/restart-service.sh --env "$(ENV)" --service "$(SERVICE)" --apply
```

Help should mark apply targets risky.

---

## 40. PowerShell Ops Facade

PowerShell is strong for structured diagnostics:

```powershell
[PSCustomObject]@{
  Service = $Service
  Environment = $Environment
  Health = $health
  Version = $version
  CheckedAt = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json -Depth 10
```

For Windows services/IIS/Event Logs, PowerShell is often ideal.

For Kubernetes/Linux tools, Bash may be simpler if environment is Unix-first.

---

## 41. Testing Operational Scripts

Test:

- argument validation;
- env mapping;
- context validation;
- redaction;
- JSON output shape;
- missing tools;
- command failures;
- timeout behavior.

Use fake commands in PATH for Bash tests.

For PowerShell, mock functions with Pester.

Do not require production access for unit tests.

---

## 42. Chaos of Production Access

Operational scripts often require access.

Principles:

- least privilege;
- read-only role for diagnostics;
- separate apply role for remediation;
- no secrets on PR jobs;
- audited access;
- short-lived credentials;
- break-glass process.

Script design should align with access model.

---

## 43. Incident Bundle in CI

A CI workflow can collect diagnostics on failure.

Example:

```yaml
- name: Collect diagnostics
  if: failure()
  run: make ops/collect ENV=staging SERVICE=payment

- name: Upload diagnostics
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: diagnostics
    path: build/diagnostics/**
```

Be careful with secrets in artifacts.

---

## 44. Common Anti-Patterns

### 44.1 Diagnostic script mutates by default

Bad.

### 44.2 Unbounded logs

`kubectl logs --all` with no `--since`.

### 44.3 Collecting secrets

`kubectl get secret -o yaml`.

### 44.4 Wrong context

No validation of cluster/account.

### 44.5 Restart before collect

Evidence lost.

### 44.6 Infinite waits

No timeout.

### 44.7 Vague output

“failed” without env/service/context.

### 44.8 Tool-specific assumptions

Using GNU `date` on macOS without compatibility.

---

## 45. Review Checklist

### Safety

- Read-only by default?
- Mutating actions require explicit apply?
- Environment explicit?
- Context/account validated?
- Secrets excluded/redacted?
- No default prod?

### Operational usefulness

- Output actionable?
- Includes env/service/version?
- Time-bounded?
- Collects relevant evidence?
- Produces bundle/artifact?
- Partial failures reported?

### Reliability

- Tool availability checked?
- Exit codes documented?
- Works under CI/non-interactive?
- Handles missing resources?
- Avoids infinite log/metric queries?

### Maintainability

- Runbook references targets?
- Tests/mocks exist?
- Scripts small enough?
- Ownership clear?
- Compatibility documented?

---

## 46. Mini Lab

### Lab 1 — Health Check

Write health script that validates status and optional version.

### Lab 2 — Log Collector

Write logs script with `--since` default 30m and max allowed range.

### Lab 3 — Context Validation

Write function to validate `kubectl current-context`.

### Lab 4 — Diagnostics Bundle

Create directory with metadata, health response, and simulated logs.

### Lab 5 — Redaction

Write simple redactor and test it against sample config containing token/password.

---

## 47. Design Exercise: Production Incident Toolkit

Design `scripts/ops/` for a Java service:

```text
status.sh
health.sh
logs.sh
collect-evidence.sh
restart-service.sh
rollback-service.sh
doctor.sh
```

For each:

- read-only or mutating;
- inputs;
- outputs;
- timeout;
- required tools;
- secret handling;
- exit codes;
- runbook usage;
- test approach.

Then expose through Make targets.

---

## 48. Part 026 Summary

Operational scripts are tools for clarity under pressure.

Key takeaways:

1. Operational scripts should be safe and read-only by default.
2. Environment/service/context must be explicit.
3. Diagnostics should be time-bounded.
4. Collect evidence before mutation when possible.
5. Redaction and secret avoidance are critical.
6. Health, smoke, and diagnostics are different.
7. JVM diagnostics can be powerful but sensitive.
8. Logs should be bounded by time/range.
9. Runbooks should reference repeatable scripts.
10. Mutating actions need plan/apply and audit trail.
11. Exit codes should distinguish usage, unhealthy, partial collection, and script failure where useful.
12. CI can collect diagnostics on failure, but artifacts must be secret-safe.
13. Production access must follow least privilege.
14. Make can expose ops facade, but scripts own logic.
15. The best operational script reduces cognitive load during incidents.

Part 027 will cover advanced Bash and PowerShell interop.

---

## 49. Referensi Resmi dan Bacaan Lanjutan

- Kubernetes debugging and `kubectl` documentation.
- Spring Boot Actuator documentation.
- JVM diagnostic tools: `jcmd`, `jstack`, JFR.
- Docker logs and container diagnostics documentation.
- CI artifact upload documentation.
- Incident response and runbook best practices.
- Site Reliability Engineering materials on toil reduction and operational tooling.
- Secret redaction and secure logging best practices.
- Cloud provider diagnostic tooling documentation.

---

## 50. Status Seri

Seri belum selesai.

Progress:

- [x] Part 000 — Orientation: Scripting as Engineering Control Plane
- [x] Part 001 — Shell Mental Model: Process, Stream, Exit Code, Environment
- [x] Part 002 — Command Execution Semantics: Parsing, Expansion, Quoting
- [x] Part 003 — POSIX Shell Baseline: Portable Script Before Bash-Specific Script
- [x] Part 004 — Bash Fundamentals Without Toy Examples
- [x] Part 005 — Error Handling in Bash: Fail Fast, Fail Clear, Fail Safe
- [x] Part 006 — Data Handling in Bash: Text, Lines, Null Bytes, JSON, CSV
- [x] Part 007 — Filesystem Automation: Safe File Operations
- [x] Part 008 — Process Control: Background Jobs, Signals, Timeouts, Concurrency
- [x] Part 009 — CLI Design for Internal Tools
- [x] Part 010 — Bash Testing, Linting, Formatting, and Reviewability
- [x] Part 011 — Security Model for Shell Scripts
- [x] Part 012 — PowerShell Mental Model: Objects, Pipeline, Providers
- [x] Part 013 — PowerShell Language Fundamentals for Java Engineers
- [x] Part 014 — PowerShell Error Handling, Strictness, and Observability
- [x] Part 015 — PowerShell Data Automation: JSON, XML, CSV, REST, Objects
- [x] Part 016 — Cross-Platform PowerShell: Windows, Linux, macOS, Containers
- [x] Part 017 — PowerShell Modules and Reusable Automation Architecture
- [x] Part 018 — Makefile Mental Model: Dependency Graph, Targets, Recipes
- [x] Part 019 — Practical Makefile Syntax and Execution Semantics
- [x] Part 020 — Makefile for Java Projects: Maven, Gradle, Docker, CI Facade
- [x] Part 021 — Makefile as Workflow Orchestrator, Not Build System Replacement
- [x] Part 022 — Script Portability Matrix: Bash, POSIX sh, PowerShell, Make, Java
- [x] Part 023 — Environment Management and Configuration Contracts
- [x] Part 024 — CI/CD Scripting: From Laptop Command to Pipeline Contract
- [x] Part 025 — Release and Deployment Automation
- [x] Part 026 — Operational Scripts: Diagnostics, Runbooks, Incident Tools
- [ ] Part 027 — Advanced Bash and PowerShell Interop
- [ ] Part 028 — Refactoring Legacy Scripts
- [ ] Part 029 — Capstone: Production-Grade Automation Toolkit for a Java Service

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-025.md">⬅️ Part 025 — Release and Deployment Automation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-027.md">Part 027 — Advanced Bash and PowerShell Interop ➡️</a>
</div>

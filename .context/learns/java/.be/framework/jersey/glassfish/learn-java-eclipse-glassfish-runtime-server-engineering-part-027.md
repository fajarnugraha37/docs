# learn-java-eclipse-glassfish-runtime-server-engineering-part-027  
# Part 27 — CI/CD, Release Engineering, dan Safe Deployment Pipeline

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 27 dari 35  
> Status seri: **belum selesai**  
> Target pembaca: Java backend / enterprise engineer yang sudah memahami Jakarta EE API dan ingin memahami GlassFish sebagai runtime produksi  
> Fokus part ini: **release engineering GlassFish**: artifact versioning, build reproducibility, deployment automation, config/resource migration, smoke test, rollback, audit trail, promotion pipeline, dan safe delivery

---

## 0. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. memahami deployment GlassFish sebagai proses release engineering, bukan sekadar `asadmin deploy`;
2. mendesain pipeline build WAR/EAR/RAR yang reproducible;
3. mengelola versioning artifact, build metadata, checksum, SBOM, dan signing;
4. memisahkan application artifact, server config, resource config, database migration, dan secret lifecycle;
5. membuat deployment automation dengan `asadmin` yang idempotent dan audit-ready;
6. mendesain promotion flow DEV → SIT → UAT → PROD;
7. menyusun pre-deployment validation dan post-deployment smoke test;
8. memahami rollback vs roll-forward;
9. menghindari partial deployment, config drift, dan manual hotfix yang tidak terlacak;
10. menyusun production release checklist untuk GlassFish.

Part ini tidak mengulang Maven/Gradle engineering secara umum, deployment artifact basics, atau Kubernetes deployment detail. Fokusnya adalah **safe delivery pipeline untuk GlassFish runtime**.

---

## 1. Mental Model: Release Bukan Copy File

Deployment GlassFish sering terlihat sederhana:

```bash
asadmin deploy app.war
```

Tetapi production release sebenarnya melibatkan banyak state:

```text
Application artifact
  |
GlassFish domain config
  |
JDBC/JMS/connector resources
  |
Security realm/role mapping
  |
Database schema/data migration
  |
Secrets/certificates
  |
Load balancer routing
  |
Monitoring/alerting
  |
Rollback path
  |
Audit/approval evidence
```

Jika kamu hanya mengontrol artifact tetapi tidak mengontrol resource/config/migration, release tidak deterministik.

Top 1% engineer melihat release sebagai:

```text
A controlled state transition of the whole runtime system.
```

Bukan:

```text
Upload WAR.
Hope it works.
```

---

## 2. Release Engineering Invariants

Safe GlassFish release harus memenuhi invariant:

```text
1. Artifact immutable.
2. Version identifiable.
3. Config reproducible.
4. Secrets not embedded.
5. Deployment target explicit.
6. Resources validated.
7. Database compatibility checked.
8. Health/readiness verified.
9. Rollback/roll-forward path known.
10. Evidence retained.
```

Jika salah satu tidak terpenuhi, release menjadi gambling.

---

## 3. Artifact Types

GlassFish dapat menerima:

```text
WAR
EAR
EJB-JAR
RAR
application client
library jars
```

Release pipeline harus tahu artifact mana yang primary.

### WAR

Biasanya web app.

```text
app.war
```

### EAR

Enterprise application multi-module.

```text
suite.ear
  |
  |-- web.war
  |-- ejb.jar
  |-- lib/
```

### RAR

Resource adapter.

```text
legacy-adapter.rar
```

RAR release sering lebih sensitif karena mempengaruhi connector/resource runtime.

---

## 4. Artifact Immutability

Artifact release tidak boleh berubah setelah diberi version/tag.

Bad:

```text
app-1.4.7.war diganti isinya tetapi nama sama.
```

Good:

```text
app-1.4.7+build.103.git.abc123.war
sha256 recorded
artifact stored read-only
```

Record:

```text
groupId/artifactId/version
build number
git commit
branch/tag
timestamp
JDK version
build tool version
checksum
SBOM
signature if applicable
```

---

## 5. Build Metadata di Aplikasi

Aplikasi harus bisa menjawab:

```text
Version apa yang sedang running?
Commit apa?
Build kapan?
Environment apa?
```

Expose via internal endpoint:

```json
{
  "application": "case-management",
  "version": "1.4.7",
  "commit": "abc1234",
  "buildTime": "2026-06-21T10:00:00Z",
  "runtime": "GlassFish 8",
  "java": "21"
}
```

Jangan expose detail sensitif ke public endpoint.

Gunakan untuk:

- deployment verification;
- incident triage;
- partial deployment detection;
- rollback validation.

---

## 6. Build Reproducibility

Reproducible build berarti artifact bisa dibangun ulang dari source dan menghasilkan output yang dapat dipercaya.

Control:

```text
JDK version
Maven/Gradle version
dependency versions locked
plugin versions locked
no dynamic latest dependencies
no local machine dependency
no environment-specific secret in build
test results archived
```

Bad:

```xml
<version>LATEST</version>
```

Bad:

```text
build depends on developer ~/.m2 custom jar
```

---

## 7. Dependency Governance

Before release:

```text
dependency tree captured
vulnerability scan
license scan
duplicate dependency check
javax/jakarta compatibility check
provided vs bundled APIs checked
server-provided libraries excluded where appropriate
```

In GlassFish, dependency mistakes often become:

- classloading failures;
- `NoSuchMethodError`;
- `ClassCastException`;
- `LinkageError`;
- namespace mismatch;
- duplicate logging frameworks.

---

## 8. SBOM

Software Bill of Materials lists dependencies/components.

Useful for:

- CVE response;
- audit;
- regulatory compliance;
- supply chain security;
- incident impact analysis.

Formats:

- CycloneDX;
- SPDX.

Release artifact should be linked to SBOM.

```text
app-1.4.7.war
app-1.4.7.sbom.json
app-1.4.7.sha256
```

---

## 9. Signing and Checksums

Checksums ensure artifact integrity.

```bash
sha256sum app.war > app.war.sha256
```

Signing adds authenticity.

Use where organization requires:

- GPG;
- Sigstore/cosign;
- artifact repository signing.

At minimum:

```text
record sha256 in release notes and deployment log.
```

---

## 10. Environment Promotion

Do not rebuild separately per environment.

Bad:

```text
Build DEV artifact.
Build UAT artifact.
Build PROD artifact.
```

Good:

```text
Build once.
Promote same artifact through environments.
```

Environment differences should be:

- configuration;
- secrets;
- resource targets;
- endpoints;
- scaling;
- feature flags.

Not different code artifacts.

Promotion:

```text
DEV -> SIT -> UAT -> PROD
```

Each promotion should carry:

- artifact checksum;
- release notes;
- migration scripts;
- config changes;
- approval evidence;
- test results.

---

## 11. Configuration Separation

Separate:

```text
Application artifact:
  business code

GlassFish runtime config:
  domain/listener/thread/pools/resources

Environment config:
  URLs, pool sizes, feature flags

Secrets:
  passwords, tokens, keys

Database migration:
  schema/data changes
```

Do not embed production config into WAR unless intentionally static and non-secret.

---

## 12. GlassFish Configuration as Code

Config should be represented as:

- `asadmin` scripts;
- domain config template;
- Terraform/Ansible/Chef/Puppet/Shell;
- Kubernetes manifests if containerized;
- version-controlled config repo.

Example structure:

```text
release/
  app/
    app-1.4.7.war
  glassfish/
    00-domain-baseline.sh
    10-jdbc-resources.sh
    20-jms-resources.sh
    30-security-realms.sh
    40-deploy-app.sh
  db/
    V2026_06_21_01__add_case_index.sql
  smoke/
    smoke-test.postman.json
  docs/
    release-notes.md
```

---

## 13. Idempotent `asadmin` Scripts

Idempotent means script can run multiple times safely.

Bad:

```bash
asadmin create-jdbc-resource jdbc/appDS
```

fails if resource already exists.

Better:

```bash
if ! asadmin list-jdbc-resources | grep -q '^jdbc/appDS$'; then
  asadmin create-jdbc-resource --connectionpoolid appPool jdbc/appDS
fi
```

For update:

```bash
asadmin set resources.jdbc-connection-pool.appPool.steady-pool-size=10
```

But be careful:

```text
set changes live runtime config.
Need approval and rollback.
```

---

## 14. Deployment Target Explicitness

Always specify target.

Bad:

```bash
asadmin deploy app.war
```

Ambiguous in multi-instance/cluster environment.

Better:

```bash
asadmin deploy --target case-cluster --contextroot case app.war
```

Resource creation also needs target awareness.

```bash
asadmin create-jdbc-resource --target case-cluster ...
```

If target wrong, app may work in DEV single instance but fail in UAT cluster.

---

## 15. Pre-Deployment Validation

Before deploy:

```text
1. Artifact checksum verified.
2. GlassFish target reachable.
3. Correct domain/cluster selected.
4. Required resources exist or scripts ready.
5. DB migration state checked.
6. Secrets available.
7. Certificates valid.
8. Disk space sufficient.
9. Current app version captured.
10. Rollback artifact available.
```

Commands/concepts:

```bash
asadmin version
asadmin list-domains
asadmin list-applications --target case-cluster
asadmin list-jdbc-resources --target case-cluster
asadmin list-jdbc-connection-pools
asadmin list-jms-resources --target case-cluster
```

---

## 16. Deployment Modes

### 16.1 In-Place Redeploy

```bash
asadmin deploy --force=true app.war
```

Pros:

- simple;
- familiar;
- fast.

Cons:

- downtime/brief disruption possible;
- classloader leak risk;
- partial failure risk;
- rollback requires redeploy old artifact.

### 16.2 Versioned Deployment

Deploy with version or unique name/context.

Pros:

- can keep old artifact;
- easier comparison;
- possible controlled switch.

Cons:

- app server naming/context management;
- resource collision;
- session compatibility.

### 16.3 Rolling Deployment Across Instances

Take instances out one by one.

Pros:

- reduced downtime;
- safer.

Cons:

- mixed version compatibility required;
- more automation needed.

### 16.4 Blue-Green

Switch traffic between two full environments.

Pros:

- fast rollback;
- no mixed instances if switch atomic.

Cons:

- more infra;
- DB migration complexity.

---

## 17. `asadmin deploy` Options to Treat Carefully

Common options:

```text
--target
--contextroot
--force
--name
--enabled
--precompilejsp
--libraries
--property
```

`--force=true` replaces existing deployment.

Risk:

```text
If new app fails after replacing old, rollback needed.
```

`--precompilejsp` can catch JSP errors early, but increases deployment time.

`--libraries` can introduce classloading complexity.

Always record deploy command.

---

## 18. Deployment Descriptor Validation

Validate before production:

```text
web.xml
application.xml
ejb-jar.xml
persistence.xml
ra.xml
glassfish-web.xml
glassfish-ejb-jar.xml
glassfish-application.xml
glassfish-resources.xml
```

Common release blockers:

- wrong context root;
- wrong resource-ref mapping;
- missing role mapping;
- missing JNDI name;
- invalid XML namespace;
- `javax`/`jakarta` mismatch;
- environment-specific descriptor accidentally packaged.

---

## 19. Resource Migration

GlassFish resource changes are release changes.

Examples:

```text
new JDBC pool
new JMS queue
pool max change
new connector resource
new security realm
new password alias
TLS cert update
thread pool change
```

Treat resource migration like DB migration:

```text
versioned
reviewed
idempotent
applied before app deploy if needed
validated after apply
rollback known
```

---

## 20. Database Migration Ordering

DB migration can make or break release.

Patterns:

### 20.1 Expand/Contract

Release-safe schema migration:

```text
1. Expand schema: add nullable column/table/index.
2. Deploy app version that writes/reads compatible way.
3. Backfill data.
4. Switch app behavior.
5. Contract: remove old column later.
```

Avoid:

```text
drop column used by old version before rolling deploy completed
```

### 20.2 Backward Compatibility

During rolling deployment, old and new app may run together.

DB must support both.

### 20.3 Migration Tool

Use:

- Flyway;
- Liquibase;
- controlled SQL scripts.

Avoid manual untracked DDL in production.

---

## 21. Migration as Separate Pipeline Step

Do not always run DB migration inside every app pod/startup.

Problems:

- multiple instances run migration concurrently;
- deployment restart triggers migration unexpectedly;
- rollback complicated;
- migration long-running blocks app startup.

Better:

```text
pipeline step:
  run migration once
  validate
  then deploy app
```

Or Kubernetes Job for migration with locking.

---

## 22. Secret and Credential Release

Secret changes need release plan.

Examples:

- DB password rotation;
- JMS credential;
- LDAP bind password;
- API token;
- TLS certificate;
- keystore/truststore.

Secret release should define:

```text
old credential valid until?
new credential deployed where?
pool refresh needed?
domain restart needed?
rollback possible?
audit recorded?
```

Do not deploy app requiring new secret before secret exists.

---

## 23. Post-Deployment Smoke Test

Smoke test checks critical behavior quickly.

Examples:

```text
1. Version endpoint returns expected version.
2. Health/readiness UP.
3. Login works.
4. Main page loads.
5. DB read/write minimal test.
6. JMS publish/consume if critical.
7. External API stub/ping if safe.
8. Admin-only endpoint protected.
9. Role-based access sanity check.
10. No SEVERE deployment errors.
```

Smoke test should be automated.

---

## 24. Synthetic Transaction

A synthetic transaction simulates real user flow.

Example:

```text
login
create draft case
submit
verify status
cleanup test data
```

Use carefully in production:

- use test account;
- mark test data;
- cleanup;
- avoid triggering real external side effects;
- run with low frequency.

---

## 25. Deployment Observability

During release monitor:

```text
HTTP 5xx
HTTP latency
readiness
JDBC pool wait
transaction rollback
JMS backlog
CPU/memory
GC pause
server.log SEVERE
application error rate
external API errors
```

Set temporary watch window:

```text
T+5 min
T+15 min
T+30 min
T+60 min
```

Do not declare release successful just because deploy command returned success.

---

## 26. Rollback vs Roll-Forward

### Rollback

Return to previous known-good state.

Requires:

```text
old artifact available
config rollback
DB compatibility
secret rollback
traffic routing rollback
```

### Roll-Forward

Deploy fix on top.

Useful when:

- DB migration irreversible;
- previous version incompatible;
- fix is small and safe;
- rollback would cause more risk.

Top-level rule:

```text
Every release plan must state rollback feasibility before deployment.
```

---

## 27. Rollback Artifact

Store previous artifact and checksum.

```text
current:
  app-1.4.7.war

previous:
  app-1.4.6.war
```

Rollback command example:

```bash
asadmin deploy --force=true --target case-cluster app-1.4.6.war
```

But confirm:

- DB schema still compatible;
- config/resources still compatible;
- message formats still compatible;
- session serialization not broken;
- external API changes not irreversible.

---

## 28. Config Rollback

Config rollback is harder than artifact rollback.

If release changed:

```text
JDBC pool max
JMS destination
realm mapping
thread pool
keystore
```

Need reverse script:

```text
up script:
  2026_06_21_add_jms_queue.sh

down script:
  2026_06_21_remove_jms_queue.sh
```

But not all config should be removed on rollback if old app can ignore it.

Decision:

```text
revert
keep harmless
disable
```

---

## 29. DB Rollback Reality

DDL rollback is often not safe.

Example:

```text
DROP COLUMN rollback? impossible if data lost.
```

Prefer forward-compatible migrations.

Release design should avoid requiring DB rollback.

Use:

- additive changes first;
- delayed destructive changes;
- backups for high-risk operations;
- tested restore plan;
- data migration dry run.

---

## 30. Partial Deployment Handling

Partial deployment:

```text
instance A v2
instance B v1
instance C failed
```

Detection:

- version endpoint per instance;
- deployment report;
- LB backend health;
- app version metric label.

Response:

```text
1. Stop routing to failed/mismatched instance.
2. Decide rollback or complete rollout.
3. Ensure DB/message compatibility.
4. Avoid mixed versions if incompatible.
```

---

## 31. Release Gates

Pipeline gates:

```text
Build gate:
  compile/test/package

Quality gate:
  unit/integration/security scan

Artifact gate:
  checksum/SBOM/sign

Environment gate:
  config/resource validation

Migration gate:
  DB migration success

Deployment gate:
  deploy success

Readiness gate:
  all instances ready

Smoke gate:
  critical flows pass

Observation gate:
  no error/latency spike after window

Approval gate:
  manual approval if regulated/prod
```

---

## 32. Approval and Audit Trail

For regulated systems, release evidence matters.

Record:

```text
release id
change request id
approver
deployment operator
artifact checksum
build logs
test results
scan results
migration scripts
deployment timestamp
target environment
rollback plan
smoke test result
post-release monitoring
```

This supports audit and incident review.

---

## 33. Separation of Duties

Common enterprise requirement:

```text
developer cannot directly deploy to production
```

Pipeline can enforce:

- code review;
- build by CI;
- artifact repository immutable;
- deployment by release manager/ops;
- approvals;
- environment credentials restricted.

Automation helps separation without making release manual.

---

## 34. Emergency Hotfix

Hotfix must still preserve traceability.

Minimum:

```text
issue id
source commit
artifact checksum
approval
deployment time
operator
smoke test
post-fix action
```

After emergency:

- merge back to main;
- create normal release record;
- update tests;
- document root cause.

Avoid:

```text
manual edit class/config on prod server
```

---

## 35. Manual Admin Console Change

Manual console changes are risky:

- not versioned;
- not peer-reviewed;
- not reproducible;
- may be lost;
- hard to diff;
- creates drift.

If unavoidable:

```text
1. record exact change
2. export config before/after
3. create follow-up asadmin/IaC script
4. reconcile config repo
```

---

## 36. Drift Detection

Drift means runtime differs from expected config.

Detect:

```text
export domain config
compare with repo
list apps/resources
compare versions/checksums
query app version endpoint per instance
check Kubernetes desired vs actual if containerized
```

Drift examples:

- pool size changed manually;
- debug logger still enabled;
- extra app deployed;
- resource missing on one instance;
- admin password changed without record.

---

## 37. Release Notes

Release notes should include:

```text
version
summary
features
bug fixes
technical changes
DB migrations
GlassFish config changes
resource changes
security changes
known risks
rollback notes
test evidence
monitoring notes
```

Bad release notes:

```text
"Deploy latest fixes."
```

---

## 38. Deployment Script Structure

Example:

```bash
#!/usr/bin/env bash
set -euo pipefail

TARGET="${TARGET:?missing TARGET}"
APP="${APP:?missing APP}"
APP_NAME="${APP_NAME:-case-app}"
CONTEXT_ROOT="${CONTEXT_ROOT:-case}"

echo "Validating artifact..."
sha256sum -c "${APP}.sha256"

echo "Checking target..."
asadmin list-applications --target "$TARGET" >/tmp/apps.txt

echo "Deploying..."
asadmin deploy \
  --force=true \
  --target "$TARGET" \
  --name "$APP_NAME" \
  --contextroot "$CONTEXT_ROOT" \
  "$APP"

echo "Verifying..."
asadmin list-applications --target "$TARGET" | grep "$APP_NAME"
```

Add:

- passwordfile;
- admin host/port/user;
- log capture;
- timeout;
- error handling;
- rollback hook.

---

## 39. Preflight Script Example

```bash
#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:?target required}"

required_jdbc=("jdbc/case/main" "jdbc/audit/main")
required_jms=("jms/case/submissionQueue")

for r in "${required_jdbc[@]}"; do
  if ! asadmin list-jdbc-resources --target "$TARGET" | grep -q "^$r$"; then
    echo "Missing JDBC resource: $r"
    exit 1
  fi
done

for r in "${required_jms[@]}"; do
  if ! asadmin list-jms-resources --target "$TARGET" | grep -q "^$r$"; then
    echo "Missing JMS resource: $r"
    exit 1
  fi
done

echo "Preflight OK"
```

This catches target/resource mismatch before deploy.

---

## 40. Smoke Test Script Concept

```bash
BASE_URL="${BASE_URL:?missing BASE_URL}"
EXPECTED_VERSION="${EXPECTED_VERSION:?missing EXPECTED_VERSION}"

curl -fsS "$BASE_URL/internal/ready" | grep '"UP"'
curl -fsS "$BASE_URL/internal/version" | grep "$EXPECTED_VERSION"
curl -fsS "$BASE_URL/health/basic"

echo "Smoke OK"
```

For auth flows, use test credential through secure secret handling, not hard-coded password.

---

## 41. Release Pipeline Example

```text
1. Checkout source
2. Build with pinned JDK
3. Unit tests
4. Integration tests
5. Package WAR/EAR
6. Generate SBOM
7. Vulnerability scan
8. Compute checksum/sign
9. Publish artifact
10. Deploy to DEV
11. Run smoke + integration tests
12. Promote same artifact to SIT
13. Run regression/performance subset
14. Promote same artifact to UAT
15. User/business validation
16. Production approval
17. Preflight PROD
18. DB migration
19. Deploy app
20. Smoke PROD
21. Observe metrics
22. Close release or rollback
```

---

## 42. CI/CD for Containerized GlassFish

If using Kubernetes:

```text
Build GlassFish app image
Scan image
Push image with digest
Deploy manifest/Helm/Kustomize
Kubernetes rollout
Readiness gate
Smoke test
Monitor
```

Do not run `asadmin deploy` into running pod for normal release.

Artifact is image:

```text
registry/case-glassfish:1.4.7
digest sha256:...
```

Rollback:

```bash
kubectl rollout undo deployment/case-glassfish
```

But DB/schema compatibility still matters.

---

## 43. CI/CD for Traditional GlassFish

If using VM/cluster:

```text
Artifact repo stores WAR/EAR.
Release pipeline connects to DAS/admin.
Preflight resources.
asadmin deploy --target cluster.
Smoke test through LB.
```

Need:

- secure admin;
- password file/secret;
- network path to admin port;
- command logs;
- deployment audit;
- rollback artifact.

---

## 44. Security in Pipeline

Protect:

- admin credentials;
- DB migration credentials;
- artifact repository credentials;
- signing keys;
- Kubernetes deploy tokens;
- secret manager access.

Rules:

```text
no secrets in logs
no secrets in artifact
least privilege service accounts
short-lived credentials if possible
approval for production
audit all deployment actions
```

---

## 45. Pipeline Failure Modes

### 45.1 Build Succeeds, Deploy Fails

Causes:

- missing resource;
- descriptor mismatch;
- classloading conflict;
- GlassFish/JDK mismatch.

Mitigation:

- deploy to production-like environment earlier;
- preflight target.

### 45.2 Deploy Succeeds, App Not Ready

Causes:

- health endpoint wrong;
- DB/JMS not available;
- startup init failure hidden.

Mitigation:

- readiness gate.

### 45.3 Smoke Passes, Real Traffic Fails

Causes:

- smoke too shallow;
- role-specific path not tested;
- load/performance issue;
- data-dependent bug.

Mitigation:

- synthetic flows;
- canary;
- observability.

### 45.4 Rollback Fails

Causes:

- DB migration incompatible;
- old artifact missing;
- config not rollbackable;
- session/message format incompatible.

Mitigation:

- rollback rehearsal;
- expand/contract migrations.

---

## 46. Performance Gate

For high-risk release:

```text
run load/performance test in UAT/perf env
compare baseline
block if regression > threshold
```

Metrics:

```text
p95 latency
p99 latency
throughput
CPU
GC
JDBC wait
DB query time
JMS backlog
external API latency
```

Avoid performance testing with empty DB or unrealistic data.

---

## 47. Release Freeze and Feature Flags

Feature flags can decouple deploy from release.

Deploy code:

```text
feature disabled
```

Enable later:

```text
small user group
gradual rollout
```

But flags add complexity:

- flag state must be managed;
- stale flags must be removed;
- authorization/security flags must be handled carefully;
- flag changes need audit if regulated.

---

## 48. Backward-Compatible Message Formats

Rolling deploy with JMS requires message compatibility.

If producer v2 sends message consumer v1 cannot read:

```text
redelivery/DLQ/outage
```

Rules:

- add fields, don't remove required fields immediately;
- consumers tolerate unknown fields;
- version message schema;
- deploy consumers before producers if needed;
- use schema registry if appropriate.

---

## 49. Session Compatibility

Rolling deployment with HTTP session:

```text
instance A v1 serializes session
instance B v2 deserializes
```

Risk:

- class changed;
- `serialVersionUID`;
- field removed/renamed;
- object not serializable.

Mitigation:

- keep session small/simple;
- avoid complex objects in session;
- drain/sticky sessions;
- force re-login if acceptable;
- blue-green with session strategy.

---

## 50. Production Release Checklist

```text
[Artifact]
- version fixed
- checksum verified
- SBOM generated
- vulnerability scan passed
- artifact stored immutable

[Compatibility]
- Java/GlassFish/Jakarta version checked
- dependency/classloading checked
- DB migration compatibility checked
- message/session compatibility checked

[Config]
- resource changes scripted
- target explicit
- secrets available
- certs valid
- config rollback known

[Preflight]
- target reachable
- resources exist
- disk space OK
- current version captured
- rollback artifact available

[Deploy]
- command logged
- operator/pipeline identity recorded
- no manual untracked steps
- partial failure handling ready

[Validation]
- readiness UP
- version endpoint correct
- smoke tests pass
- logs clean
- metrics stable

[Rollback]
- rollback decision criteria defined
- previous artifact available
- DB rollback/forward plan known
- communication plan ready

[Audit]
- approvals captured
- release notes attached
- test results archived
- deployment timestamp recorded
```

---

## 51. Top 1% Takeaways

1. **A release is a controlled state transition, not a file upload.**
2. **Build once, promote the same artifact.**
3. **Artifact, config, secrets, DB migration, and resources have different lifecycles.**
4. **Every deployment target must be explicit.**
5. **`asadmin` scripts should be idempotent and audit-ready.**
6. **Rollback feasibility must be known before production deployment.**
7. **DB migrations should be backward-compatible for rolling/blue-green deployment.**
8. **Smoke tests must verify readiness, version, auth, DB, and critical flows.**
9. **Manual admin console changes create drift unless reconciled.**
10. **Release evidence is part of engineering quality, especially in regulated systems.**

---

## 52. Mini Exercise

Design a release pipeline for:

```text
GlassFish 8
Java 21
EAR application
Oracle DB migration with Flyway
JMS queue added
New security role mapping
Deployment target: case-cluster
Promotion: DEV -> SIT -> UAT -> PROD
```

Answer:

1. What artifacts are produced?
2. What metadata is recorded?
3. What preflight checks are run?
4. What GlassFish resource scripts are needed?
5. When is DB migration run?
6. How do you verify role mapping?
7. What smoke tests run after deploy?
8. What metrics are watched after release?
9. What rollback is possible?
10. What audit evidence is stored?

---

## 53. Referensi

Referensi utama:

- Eclipse GlassFish Application Deployment Guide, Release 8  
  https://glassfish.org/docs/latest/application-deployment-guide.html

- Eclipse GlassFish Reference Manual, Release 8  
  https://glassfish.org/docs/latest/reference-manual.html

- Eclipse GlassFish Administration Guide, Release 8  
  https://glassfish.org/docs/latest/administration-guide.html

- Eclipse GlassFish Deployment Planning Guide, Release 8  
  https://glassfish.org/docs/latest/deployment-planning-guide.html

- OWASP Software Component Verification Standard / Dependency-Track ecosystem  
  https://owasp.org/

- CycloneDX SBOM  
  https://cyclonedx.org/

- Flyway Documentation  
  https://documentation.red-gate.com/fd

- Liquibase Documentation  
  https://docs.liquibase.com/

---

## 54. Status Seri

Part ini selesai.

Progress:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
Part 12 - selesai
Part 13 - selesai
Part 14 - selesai
Part 15 - selesai
Part 16 - selesai
Part 17 - selesai
Part 18 - selesai
Part 19 - selesai
Part 20 - selesai
Part 21 - selesai
Part 22 - selesai
Part 23 - selesai
Part 24 - selesai
Part 25 - selesai
Part 26 - selesai
Part 27 - selesai
```

Seri belum selesai.

Part berikutnya:

```text
Part 28 — Legacy Modernization: GlassFish 4/5 Java EE ke GlassFish 7/8 Jakarta EE
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-026.md">⬅️ Part 26 — Containerization dan Kubernetes Deployment untuk GlassFish</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-028.md">Part 28 — Legacy Modernization: GlassFish 4/5 Java EE ke GlassFish 7/8 Jakarta EE ➡️</a>
</div>

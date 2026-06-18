# learn-java-deployment-runtime-release-delivery-engineering — Part 32
# Enterprise Governance: Change Request, Auditability, Approval, Compliance

> **Series:** `learn-java-deployment-runtime-release-delivery-engineering`  
> **Part:** 32 of 35  
> **Topic:** Enterprise Governance for Java Deployment  
> **Scope:** Java 8–25, enterprise release process, regulated systems, CR/CAB, audit evidence, compliance, approval workflow, emergency release, traceability, operational defensibility  
> **Goal:** Memahami deployment Java bukan hanya sebagai aktivitas teknis, tetapi sebagai perubahan sistem enterprise yang harus aman, bisa diaudit, disetujui, dipertanggungjawabkan, dan defensible di depan auditor, regulator, incident reviewer, security team, dan business owner.

---

## 0. Posisi Part Ini Dalam Series

Part sebelumnya membahas **Runbook Engineering**: bagaimana membuat deployment bisa dijalankan secara aman, repeatable, dan tidak bergantung pada hero knowledge.

Part ini naik satu layer:

> “Bagaimana deployment Java dikendalikan dalam organisasi enterprise/regulatory agar perubahan production tetap cepat, aman, traceable, dan defensible?”

Di sistem kecil, deployment sering dianggap:

```text
merge → build → deploy
```

Di sistem enterprise, khususnya sistem yang menyimpan data sensitif, transaksi hukum, enforcement lifecycle, case management, payment, identity, atau compliance-critical workflow, deployment adalah:

```text
change proposal
→ risk assessment
→ approval
→ artifact evidence
→ secure release
→ controlled deployment
→ verification
→ monitoring
→ closure evidence
→ audit trail
→ learning loop
```

Engineer top-tier harus paham dua dunia:

1. **technical deployment mechanics**;
2. **organizational control system**.

Tanpa governance, deployment cepat bisa menjadi tidak terkendali.

Tanpa engineering discipline, governance bisa menjadi birokrasi lambat tanpa meningkatkan safety.

Tujuannya bukan membuat deployment sulit.

Tujuannya adalah membuat deployment **terkendali, dapat dibuktikan, dan aman untuk organisasi besar**.

---

## 1. Governance Bukan Musuh Engineering

Banyak engineer melihat governance sebagai hambatan:

```text
CR ribet.
Approval lama.
CAB cuma formalitas.
Evidence buang waktu.
Audit tidak mengerti teknis.
```

Sebagian kritik itu valid jika governance dilakukan buruk.

Namun governance yang benar menjawab pertanyaan penting:

1. Siapa yang menyetujui perubahan?
2. Apa yang berubah?
3. Mengapa perubahan dilakukan?
4. Apa risiko perubahan?
5. Apa sistem terdampak?
6. Apa evidence bahwa artifact aman?
7. Apa evidence bahwa deployment berhasil?
8. Apa rollback plan?
9. Siapa yang bertanggung jawab jika gagal?
10. Bagaimana organisasi belajar dari kegagalan?

Governance yang baik bukan “approval theater”.

Governance yang baik adalah **risk control system**.

Deployment tanpa governance bisa cepat, tetapi rapuh.

Governance tanpa engineering bisa formal, tetapi palsu.

Top-tier engineer membuat keduanya bertemu.

---

## 2. Mental Model: Deployment Governance as Control Plane

Bayangkan deployment memiliki dua plane:

```text
┌───────────────────────────────────────────────┐
│ Governance Plane                              │
│ - Change Request                              │
│ - Risk assessment                             │
│ - Approval                                    │
│ - Audit evidence                              │
│ - Segregation of duties                       │
│ - Compliance                                  │
│ - Release calendar                            │
│ - Emergency process                           │
└───────────────────────────────────────────────┘
                      │ authorizes / constrains
                      v
┌───────────────────────────────────────────────┐
│ Execution Plane                               │
│ - CI/CD                                       │
│ - artifact registry                           │
│ - deployment manifest                         │
│ - Kubernetes/systemd/app server               │
│ - DB migration                                │
│ - verification                                │
│ - monitoring                                  │
└───────────────────────────────────────────────┘
```

Jika execution plane kuat tetapi governance plane lemah:

```text
deployments are fast but untraceable
```

Jika governance plane kuat tetapi execution plane lemah:

```text
changes are approved but still unsafe
```

Maturity terjadi ketika:

```text
governance intent is enforced by technical controls
```

Contoh:

| Governance Intent | Technical Enforcement |
|---|---|
| only approved release can deploy | CI/CD approval gate |
| artifact must be immutable | deploy by digest |
| change must be traceable | Git SHA + image digest + CR ID |
| secrets must not leak | secret scanning + masked pipeline logs |
| production access restricted | RBAC + break-glass audit |
| rollback must exist | pipeline requires previous version |
| deploy must be verified | automated smoke/metric gates |
| emergency change must be reviewed later | post-implementation review task |

---

## 3. Change Request: Apa Itu dan Mengapa Penting?

Dalam enterprise, **Change Request** atau CR adalah unit formal untuk meminta, menyetujui, menjalankan, dan menutup perubahan.

CR yang baik bukan hanya “ticket agar boleh deploy”.

CR adalah container untuk:

1. business reason;
2. technical scope;
3. impact;
4. risk;
5. implementation plan;
6. test evidence;
7. deployment plan;
8. rollback plan;
9. approval;
10. closure evidence.

### 3.1 CR Minimal Fields

```markdown
# Change Request

## Identification
- CR ID:
- System:
- Service/module:
- Environment:
- Requested by:
- Implemented by:
- Approved by:
- Planned window:

## Business Reason
- Why is this change needed?
- What business/regulatory/user problem does it solve?

## Technical Scope
- Code artifact:
- Config change:
- Database migration:
- Infrastructure change:
- Security change:
- External dependency change:

## Impact
- User impact:
- Downtime expected:
- Data impact:
- Security impact:
- Integration impact:
- Operational impact:

## Risk
- Risk level:
- Risk rationale:
- Rollback complexity:
- Blast radius:

## Implementation Plan
- Deployment runbook:
- Responsible parties:
- Sequence:
- Dependencies:

## Verification Plan
- Pre-deployment checks:
- Post-deployment smoke:
- Monitoring window:
- Success criteria:

## Rollback Plan
- Rollback trigger:
- Rollback steps:
- Rollback owner:
- Rollback verification:

## Evidence
- Build evidence:
- Test evidence:
- Scan evidence:
- Approval evidence:
- Deployment evidence:
- Closure evidence:
```

### 3.2 CR Harus Menjawab “What Changes in Reality?”

CR buruk:

```text
Deploy latest backend.
```

CR baik:

```text
Deploy case-service v1.24.0 to PROD.
Changes:
- adds nullable column ESCALATION_REASON_CODE;
- deploys new backend image sha256:...;
- enables feature flag only for agency ABC after smoke test;
- updates truststore secret version 2026-06-bundle.

No frontend change.
No queue schema change.
No Keycloak role change.
No external endpoint change.
```

Deployment governance gagal ketika CR tidak merepresentasikan real change.

---

## 4. Jenis Change dalam Java Deployment

Tidak semua change sama.

### 4.1 Application Code Change

Contoh:

```text
new JAR/WAR/container image
```

Risiko:

1. behavior bug;
2. classpath mismatch;
3. runtime incompatibility;
4. performance regression;
5. new dependency vulnerability;
6. backward compatibility issue.

Evidence:

1. Git commit;
2. build artifact;
3. test result;
4. SBOM;
5. security scan;
6. deployment manifest;
7. smoke result.

### 4.2 Configuration Change

Contoh:

```text
SPRING_PROFILES_ACTIVE
JAVA_TOOL_OPTIONS
timeout
pool size
feature flag
endpoint URL
```

Risiko:

1. wrong environment endpoint;
2. secrets misbinding;
3. resource exhaustion;
4. disabled security;
5. changed traffic behavior.

Config change sering lebih berbahaya daripada code change karena tampak kecil.

### 4.3 Database Change

Contoh:

```text
Flyway/Liquibase migration
index creation
column addition
constraint update
package/procedure change
```

Risiko:

1. lock;
2. data corruption;
3. incompatible app version;
4. long migration;
5. impossible rollback;
6. performance regression.

### 4.4 Runtime Change

Contoh:

```text
Java 8 → 17
Java 17 → 21
JDK vendor switch
JVM flags
GC change
container base image change
```

Risiko:

1. TLS behavior;
2. removed JVM flags;
3. module access;
4. GC behavior;
5. charset/timezone;
6. native dependency;
7. certification gap.

### 4.5 Infrastructure Change

Contoh:

```text
Kubernetes resource limits
HPA
Ingress
ALB
DNS
node class
volume
network policy
```

Risiko:

1. traffic loss;
2. pod pending;
3. OOMKilled;
4. CPU throttling;
5. wrong routing;
6. DNS propagation;
7. blocked dependency.

### 4.6 Security Change

Contoh:

```text
certificate rotation
truststore update
OAuth client secret
Keycloak realm/client config
mTLS policy
NetworkPolicy
Actuator exposure
```

Risiko:

1. login outage;
2. TLS handshake failure;
3. token validation failure;
4. unauthorized access;
5. secret leakage;
6. broken integration.

### 4.7 Data/Backfill Change

Contoh:

```text
script updates records
batch recalculates state
migration repairs data
```

Risiko:

1. irreversible mutation;
2. partial update;
3. audit inconsistency;
4. duplicate processing;
5. business rule violation.

---

## 5. Risk Classification for CR

Risk classification harus berdasarkan **consequence**, bukan effort.

Perubahan kecil bisa high-risk.

Contoh:

```text
Change one timeout from 5s to 60s.
```

Bisa menyebabkan:

1. thread pool exhaustion;
2. queue buildup;
3. cascading failure;
4. delayed retries;
5. SLA breach.

### 5.1 Risk Dimensions

| Dimension | Question |
|---|---|
| User Impact | Apakah user-facing? |
| Data Impact | Apakah mengubah persistent data? |
| Security Impact | Apakah menyentuh auth, cert, secret, privilege? |
| Rollback Difficulty | Bisa rollback cepat? |
| Compatibility | Apakah old/new version bisa coexist? |
| Blast Radius | Satu service atau banyak sistem? |
| Downtime | Ada expected downtime? |
| Novelty | Pernah dilakukan sebelumnya? |
| Dependency | Menyentuh external service? |
| Traffic | High-volume / peak-hour sensitive? |
| Regulatory | Apakah memengaruhi audit/legal/compliance? |
| Statefulness | Ada queue/session/scheduler/batch? |

### 5.2 Risk Levels

| Level | Characteristic | Governance |
|---|---|---|
| Low | no data, no config sensitive, easy rollback | peer review + automated gate |
| Medium | service behavior change, rolling deploy | standard CR + smoke |
| High | DB/security/stateful/multi-service | full CR + CAB/approval + runbook |
| Critical | irreversible/data/security/platform-wide | war room + rehearsal + senior approval |

### 5.3 Risk Misclassification Anti-Pattern

Bad classification:

```text
Only one-line code change, so low risk.
```

Better classification:

```text
One-line change in authorization predicate affecting enforcement case visibility.
Risk = high due data access/security impact.
```

Governance should classify by:

```text
impact × uncertainty × reversibility
```

not by lines of code.

---

## 6. Approval Workflow

Approval is not just bureaucracy. Approval establishes accountability.

### 6.1 Typical Approval Roles

| Role | Concern |
|---|---|
| Developer / Tech Lead | technical correctness |
| QA | test evidence |
| Product Owner / Business | business readiness |
| Operations / Infra | deployment feasibility |
| DBA | database safety |
| Security | auth/secret/cert/exposure risk |
| Change Manager / CAB | scheduling/conflict/risk governance |
| System Owner | production accountability |

### 6.2 Approval Should Match Risk

Low-risk change:

```text
code review + automated tests + pipeline gate
```

Medium-risk change:

```text
TL approval + QA sign-off + deployment window
```

High-risk change:

```text
TL + QA + business + DBA/security if relevant + CAB
```

Critical change:

```text
formal CAB + rehearsal evidence + rollback rehearsal + war room
```

### 6.3 Approval Anti-Patterns

#### Anti-pattern 1 — Rubber Stamp Approval

```text
Approved because the form is complete.
```

Better:

```text
Approved because risk, rollback, evidence, and impact are understood.
```

#### Anti-pattern 2 — Approval Without Technical Evidence

```text
Approve before build artifact exists.
```

Better:

```text
Approval references immutable artifact/image digest or final candidate build.
```

#### Anti-pattern 3 — Approval Too Early

If approval happens before final artifact, final test, or final manifest, then approval does not cover what is actually deployed.

Better:

```text
CR approval should bind to release candidate identity.
```

#### Anti-pattern 4 — Approval Too Late

If approval is only at deployment time, risk review becomes rushed.

Better:

```text
risk review before deployment window; final go/no-go at window.
```

---

## 7. CAB and Change Enablement

CAB atau Change Advisory Board sering mendapat reputasi buruk karena menjadi bottleneck.

Namun CAB yang benar tidak seharusnya meninjau setiap detail teknis kecil.

CAB harus fokus pada:

1. high-risk changes;
2. cross-system coordination;
3. deployment collision;
4. business blackout window;
5. major security/data risk;
6. emergency change review;
7. capacity for operational support.

### 7.1 Good CAB Questions

```text
- What is the user/business impact?
- What systems are affected?
- Is rollback tested?
- Is data migration reversible or forward-only?
- Are dependencies ready?
- Is monitoring ready?
- Is deployment during business peak?
- Are there conflicting releases?
- Who can approve rollback?
- Who is on standby?
```

### 7.2 Bad CAB Questions

```text
- Why did you use this class name?
- Can you explain every code diff?
- Did you fill every form field even if irrelevant?
```

CAB should not replace engineering review.

CAB manages operational risk.

### 7.3 Change Enablement vs Change Prevention

A mature organization does not use change management to stop change.

It uses change enablement to:

1. reduce failed changes;
2. accelerate safe changes;
3. automate low-risk approvals;
4. focus human review on high-risk changes;
5. create evidence;
6. support continuous delivery with control.

---

## 8. Segregation of Duties

Segregation of duties means no single person can fully bypass critical controls.

In deployment:

```text
the same person should not be able to:
- author code;
- approve code;
- approve CR;
- deploy to production;
- alter evidence;
- close audit record
without oversight.
```

This does not mean developers cannot deploy.

It means production change should have:

1. peer review;
2. approval boundary;
3. automated traceability;
4. immutable logs;
5. access control;
6. separation between request and approval.

### 8.1 Practical Patterns

| Control | Implementation |
|---|---|
| code review | protected branch |
| release approval | CI/CD environment protection |
| deploy permission | RBAC/group |
| audit trail | pipeline logs + CR link |
| artifact integrity | image digest/signature |
| config control | GitOps PR approval |
| emergency access | break-glass with audit |

### 8.2 Anti-Pattern: Shared Production Account

Bad:

```text
everyone uses prodadmin
```

Problems:

1. no individual accountability;
2. hard to audit;
3. impossible to revoke one person;
4. secrets spread;
5. incident investigation weak.

Better:

```text
individual identity + role-based access + time-bounded elevation + audit logs
```

---

## 9. Traceability: From Requirement to Production

Traceability answers:

```text
Which requirement changed which code, which artifact, which deployment, which runtime, and which production behavior?
```

### 9.1 Traceability Chain

```text
Requirement / Bug / Incident
   ↓
User story / ticket
   ↓
Pull request
   ↓
Commit SHA
   ↓
Build ID
   ↓
Artifact / image digest
   ↓
SBOM / scan result
   ↓
Deployment manifest
   ↓
Environment deployment
   ↓
Runtime version evidence
   ↓
Smoke / synthetic test
   ↓
Monitoring result
   ↓
CR closure
```

### 9.2 Example Traceability Matrix

| Layer | Evidence |
|---|---|
| Requirement | JIRA-1234 |
| Code | PR #456 |
| Commit | `a1b2c3d4` |
| Build | Jenkins #8910 |
| Artifact | `case-service-1.24.0.jar` |
| Image | `sha256:...` |
| Config | GitOps commit `e5f6g7h8` |
| DB migration | `V20260618_01` |
| Environment | PROD namespace `case-prod` |
| Deployment | Kubernetes revision 42 |
| Verification | smoke test report |
| Monitoring | dashboard snapshot |
| Closure | CRQ-123456 completed |

### 9.3 Why Traceability Matters

Traceability supports:

1. audit;
2. incident RCA;
3. rollback;
4. vulnerability response;
5. legal/regulatory review;
6. accountability;
7. impact analysis.

If a CVE appears in a dependency, traceability answers:

```text
Which services deployed this vulnerable library?
Which environments?
Which image digests?
Which releases?
Which business functions?
```

---

## 10. Auditability

Auditability means an independent reviewer can reconstruct:

1. what was approved;
2. what was deployed;
3. who deployed it;
4. when it happened;
5. whether it succeeded;
6. what evidence supports that conclusion.

Audit evidence must be:

1. complete;
2. timestamped;
3. tamper-resistant where possible;
4. linked to CR/release;
5. understandable;
6. retained according to policy.

### 10.1 Evidence Types

| Evidence | Example |
|---|---|
| Approval | CR approval record |
| Artifact | checksum, image digest |
| Build | CI log, build number |
| Test | test report |
| Security | SAST/SCA/container scan |
| SBOM | CycloneDX/SPDX |
| Deployment | pipeline log, kubectl/Argo output |
| Runtime | actuator info, pod image ID |
| Migration | Flyway/Liquibase history |
| Monitoring | dashboard snapshot, metrics export |
| Smoke | synthetic test result |
| Closure | final deployment note |

### 10.2 Good Evidence vs Weak Evidence

Weak:

```text
Deployed successfully.
```

Good:

```text
PROD deployment completed at 2026-06-18 22:34 UTC+7.
Service: case-service.
Version: 1.24.0.
Image digest: sha256:...
Kubernetes deployment revision: 42.
Readiness: PASS.
Smoke test: PASS.
5xx during T+30min: 0.02%.
DB migration V20260618_01: SUCCESS.
Rollback artifact: 1.23.4 available.
```

### 10.3 Evidence Retention

Evidence should be stored in:

1. CR ticket;
2. release repository;
3. CI/CD system;
4. artifact repository;
5. log archive;
6. audit system;
7. document management system if required.

Avoid storing sensitive data in evidence.

Do not attach:

1. secrets;
2. full heap dumps;
3. raw PII logs;
4. database export with personal data;
5. unredacted tokens.

---

## 11. Compliance and Standards Thinking

Compliance is not memorizing frameworks.

Compliance means translating control intent into engineering practice.

Examples:

### 11.1 Change Control Intent

Control intent:

```text
Changes must be reviewed, approved, documented, and implemented as approved.
```

Engineering implementation:

```text
- protected branches;
- required PR review;
- CI/CD build evidence;
- CR approval;
- immutable artifact;
- deployment by digest;
- automated deployment logs;
- post-deployment verification.
```

### 11.2 Audit Logging Intent

Control intent:

```text
Security-relevant and administrative actions must be logged.
```

Engineering implementation:

```text
- CI/CD deployment logs;
- Kubernetes audit logs;
- cloud activity logs;
- app admin audit trail;
- DB migration logs;
- IAM change logs;
- CR lifecycle history.
```

### 11.3 Secure Development Intent

Control intent:

```text
Software should be produced and deployed with practices that reduce vulnerability risk.
```

Engineering implementation:

```text
- dependency scanning;
- SBOM;
- artifact signing;
- code review;
- secret scanning;
- secure build pipeline;
- provenance;
- release verification.
```

### 11.4 Privacy/Data Intent

Control intent:

```text
Sensitive data must be protected throughout change, testing, deployment, and evidence capture.
```

Engineering implementation:

```text
- masked test data;
- no PII in logs;
- redacted runbook evidence;
- limited production data access;
- secure dump handling;
- data migration approval.
```

---

## 12. Regulatory Defensibility

For systems like enforcement lifecycle, case management, licensing, compliance, or public service transactions, defensibility matters.

A deployment can affect:

1. case state;
2. legal deadlines;
3. correspondence;
4. evidence;
5. officer assignment;
6. audit trail;
7. enforcement decision;
8. user rights;
9. payment/revenue;
10. official records.

Regulatory defensibility asks:

```text
Can we prove that the system change was authorized, tested, deployed correctly, monitored, and did not compromise record integrity?
```

### 12.1 Defensible Deployment Record

For high-risk regulatory system:

```markdown
## Deployment Defensibility Record

- CR approved by system owner.
- Risk assessment completed.
- Affected workflows listed.
- Data migration reviewed.
- Audit trail behavior tested.
- Authorization behavior tested.
- Rollback/roll-forward decision documented.
- Production deployment evidence attached.
- Smoke transaction executed.
- Monitoring window passed.
- No unresolved high-severity anomaly.
- Closure approved.
```

### 12.2 Record Integrity Concerns

Ask:

1. Does deployment change audit trail format?
2. Does it alter historical records?
3. Does it recalculate case state?
4. Does it affect deadlines/SLA?
5. Does it change user permissions?
6. Does it change notification/correspondence?
7. Does it alter evidence attachment handling?
8. Does it change integration with external authority?

If yes, governance should be stronger.

---

## 13. Release Notes

Release notes bridge engineering and stakeholders.

### 13.1 Bad Release Note

```text
Bug fixes and improvements.
```

### 13.2 Good Enterprise Release Note

```markdown
# Release Note — Case Service v1.24.0

## Summary
Adds escalation reason code support to enforcement case escalation workflow.

## User-Facing Changes
- Officers can view escalation reason in case details.
- No change to existing case search behavior.

## Technical Changes
- Adds nullable database column `ESCALATION_REASON_CODE`.
- Adds response field `escalationReasonCode`.
- Adds feature flag `case.escalation.reason.enabled`.

## Compatibility
- Existing cases remain valid.
- Old application version can run with new DB schema.

## Operational Notes
- No downtime expected.
- Rolling deployment.
- Monitoring required for DB pool and case escalation API.

## Rollback
- App rollback supported.
- DB rollback not required for additive schema change.

## Known Limitations
- Feature initially enabled only for agency ABC.
```

### 13.3 Release Notes Should Not Leak

Avoid:

1. secret names that reveal sensitive architecture;
2. vulnerability exploit detail before patch complete;
3. internal credentials;
4. PII examples;
5. production hostnames if not appropriate.

---

## 14. Deployment Windows and Freeze Periods

Enterprise deployments often happen in windows.

### 14.1 Deployment Window Factors

1. business operating hours;
2. user traffic pattern;
3. batch processing window;
4. integration partner availability;
5. DBA availability;
6. infra support;
7. support desk coverage;
8. regulatory blackout period;
9. financial closing;
10. peak season.

### 14.2 Freeze Periods

Change freeze is useful during:

1. major public event;
2. financial year-end;
3. regulatory submission deadline;
4. holiday peak;
5. major migration;
6. audit period;
7. incident stabilization.

But freeze should have emergency exception path.

### 14.3 Bad Freeze Pattern

```text
No changes allowed for 2 months, including security patches.
```

Better:

```text
No non-essential feature changes.
Security fixes, critical incidents, and approved low-risk operational changes may proceed through emergency/expedited path.
```

---

## 15. Emergency Change

Emergency change is required when waiting for normal CAB causes more risk than deploying.

Examples:

1. production outage;
2. critical vulnerability;
3. expired certificate;
4. corrupted config;
5. data processing blocked;
6. legal/regulatory deadline at risk.

### 15.1 Emergency Change Principles

Emergency does not mean uncontrolled.

It means:

```text
faster approval, not no approval
```

Minimum:

1. emergency reason;
2. impact;
3. proposed fix;
4. risk;
5. rollback/roll-forward;
6. emergency approver;
7. deployment evidence;
8. post-implementation review.

### 15.2 Emergency CR Template

```markdown
# Emergency Change Request

## Reason
Production login is failing due expired IdP signing certificate.

## Impact
Users cannot authenticate to case management system.

## Proposed Change
Deploy updated truststore secret and restart affected services.

## Risk
TLS/auth integration may still fail if IdP chain mismatch exists.

## Approval
Emergency approver:
Security/on-call:
System owner:

## Implementation
Runbook:
Expected duration:

## Verification
- token validation test;
- login smoke test;
- readiness health;
- auth error log monitoring.

## Rollback
Restore previous truststore if new truststore causes broader TLS failure.

## Post-Implementation Review
To be completed within 1 business day.
```

### 15.3 Emergency Anti-Patterns

1. bypassing all logs;
2. shared account;
3. no evidence;
4. no PIR;
5. emergency used for poor planning;
6. no rollback thinking;
7. unreviewed direct production DB edits.

---

## 16. Post-Implementation Review

Post-Implementation Review, or PIR, answers:

```text
Did the change achieve intended outcome without unacceptable side effects?
```

For normal change:

```text
PIR may be lightweight.
```

For failed/emergency/high-risk change:

```text
PIR should be formal.
```

### 16.1 PIR Questions

```markdown
## Post-Implementation Review

- Was the change implemented as approved?
- Did deployment occur within planned window?
- Did verification pass?
- Were there incidents or anomalies?
- Was rollback needed?
- Were users impacted?
- Did monitoring detect issues?
- Was evidence complete?
- Were runbook steps accurate?
- What should be improved before next release?
```

### 16.2 Blamelessness

If deployment fails, PIR should not become blame allocation.

Focus:

1. what happened;
2. why detection/controls failed;
3. what assumptions were wrong;
4. what safety mechanism should improve;
5. what automation/runbook/test/evidence is missing.

A blameless posture improves learning because people are more willing to disclose facts.

---

## 17. Audit Trail Across Toolchain

Modern deployment spans many tools.

A complete audit trail may include:

```text
Git
  → PR review
  → CI build
  → artifact registry
  → vulnerability scanner
  → CR system
  → deployment pipeline
  → Kubernetes/cloud audit log
  → application audit log
  → monitoring alert
  → incident/PIR record
```

### 17.1 Toolchain Evidence Map

| Tool | Evidence |
|---|---|
| Git | commit, PR review, branch protection |
| CI | build logs, test reports, artifact metadata |
| SCA/SAST | scan results |
| Registry | image digest, push timestamp, signer |
| CR system | approval, schedule, closure |
| CD | deployment logs, environment, operator |
| Kubernetes | rollout history, audit logs, pod image ID |
| DB migration | schema history table |
| App | startup logs, build info, audit trail |
| Monitoring | metrics/logs/traces around release |
| Incident system | incident timeline if failed |

### 17.2 Evidence Correlation ID

Good pattern:

```text
Release ID = REL-2026-06-18-001
CR ID = CRQ-123456
Git tag = case-service-1.24.0
Image label:
  org.opencontainers.image.revision=a1b2c3d4
  com.company.release-id=REL-2026-06-18-001
  com.company.change-id=CRQ-123456
```

This makes evidence searchable.

---

## 18. Policy as Code

Governance matures when repetitive controls become automated.

Examples:

```text
- reject deployment without image digest;
- reject privileged container;
- reject image with critical CVE;
- require SBOM;
- require signed artifact;
- require approved namespace;
- block latest tag in production;
- require resource limits/requests;
- require readiness probe;
- require runAsNonRoot;
- require CR ID annotation.
```

### 18.1 Kubernetes Admission Policy Examples

Policy intent:

```text
Production pods must not run as root.
```

Technical policy:

```text
deny if securityContext.runAsNonRoot != true
```

Policy intent:

```text
Production deployment must link to CR.
```

Technical policy:

```text
require metadata.labels["change.company.com/id"]
```

Policy intent:

```text
Only signed images can run.
```

Technical policy:

```text
verify image signature before admission
```

### 18.2 CI/CD Policy Examples

```text
- pipeline cannot deploy if tests fail;
- pipeline cannot deploy if artifact not from protected branch;
- pipeline cannot deploy if scan result exceeds threshold;
- pipeline cannot deploy to PROD without environment approval;
- pipeline cannot deploy mutable tag;
- pipeline records deployment URL and version automatically.
```

Policy as code reduces manual CAB load for low-risk changes.

---

## 19. Governance in GitOps

GitOps can improve governance because desired state is versioned.

### 19.1 GitOps Governance Benefits

1. deployment change is a Git diff;
2. approval via PR;
3. history is immutable-ish;
4. rollback via revert;
5. drift detection;
6. environment state declared;
7. audit trail in Git plus CD controller.

### 19.2 GitOps Risks

1. direct cluster changes bypass Git;
2. secret handling in Git;
3. auto-sync deploys unintended change;
4. PR approval may not equal CR approval;
5. generated manifests obscure real diff;
6. rollback commit may not rollback DB/config side effects.

### 19.3 GitOps Runbook Governance

Require:

```text
- CR ID in PR title/description;
- image digest not just tag;
- environment-specific approval;
- diff review;
- sync evidence;
- post-sync health evidence;
- drift reconciliation policy.
```

---

## 20. Deployment Governance for Java Runtime Upgrades

Java runtime upgrades need special governance.

Examples:

```text
Java 8 → 11
Java 8 → 17
Java 17 → 21
Java 21 → 25
JDK vendor switch
JVM flags cleanup
base image upgrade
```

### 20.1 Runtime Upgrade CR Must Include

```markdown
## Runtime Upgrade Governance

- Current Java version:
- Target Java version:
- Runtime vendor:
- Support policy:
- Certified OS/container base:
- JVM flag compatibility review:
- Dependency compatibility:
- Framework compatibility:
- TLS/cert behavior review:
- GC behavior review:
- Performance test:
- Smoke/regression evidence:
- Rollback plan:
```

### 20.2 Why Runtime Upgrade Is High-Risk

Even if app code unchanged:

1. class file/runtime compatibility;
2. removed/deprecated JVM flags;
3. stronger encapsulation;
4. TLS defaults;
5. garbage collector behavior;
6. timezone/locale data;
7. cryptographic provider;
8. reflection/module access;
9. monitoring agent compatibility;
10. container ergonomics.

A Java upgrade is a deployment change, not just platform maintenance.

---

## 21. Deployment Governance for Database Changes

Database changes deserve governance because they persist beyond artifact rollback.

### 21.1 DB Change Approval Should Include

1. migration script review;
2. lock analysis;
3. execution time estimate;
4. rollback/roll-forward plan;
5. backup/restore approach;
6. compatibility matrix;
7. data validation query;
8. DBA sign-off if high-risk;
9. test environment execution evidence;
10. post-migration verification.

### 21.2 Data Change vs Schema Change

Schema change:

```text
ALTER TABLE, CREATE INDEX, ADD COLUMN
```

Data change:

```text
UPDATE records, recalculate state, repair orphan data
```

Data change may be more sensitive.

For regulatory systems, data correction script should include:

1. exact target rows;
2. before/after count;
3. reason for correction;
4. approval from business/data owner;
5. audit trail;
6. rollback script or compensating action;
7. evidence of result.

---

## 22. Deployment Governance for Security Changes

Security changes often fail because people underestimate blast radius.

Examples:

1. Keycloak realm/client update;
2. OAuth redirect URI;
3. SAML metadata;
4. JWKS certificate rotation;
5. truststore update;
6. mTLS policy;
7. NetworkPolicy;
8. actuator exposure;
9. role mapping;
10. CORS allowed origin;
11. session timeout;
12. password policy.

### 22.1 Security Change CR Questions

```text
- What authentication/authorization flow changes?
- Which clients/users are affected?
- Is there a backward-compatible transition?
- Are old and new certs both valid during rotation?
- What is the test identity?
- How do we verify login/token/API authorization?
- What is the rollback if tokens/certs are already rotated?
- Are logs redacted?
- Are admin endpoints protected?
```

### 22.2 Security Evidence

1. test login;
2. token validation;
3. mTLS handshake;
4. role-based access check;
5. denied access check;
6. cert expiry check;
7. audit log check;
8. vulnerability scan;
9. config diff.

---

## 23. Deployment Governance for Stateful Systems

Stateful Java systems include:

1. session state;
2. Redis cache;
3. local cache;
4. Quartz jobs;
5. batch jobs;
6. Kafka/RabbitMQ consumers;
7. scheduled tasks;
8. distributed locks;
9. in-flight workflows;
10. long-running transactions.

Governance should ask:

```text
What state exists during deployment?
Can it be safely interrupted?
Can it be replayed?
Is processing idempotent?
What happens to partially processed messages?
Who owns stuck jobs?
```

### 23.1 Stateful Change Evidence

```text
- queue depth before/after;
- unacked message count;
- scheduler paused/resumed;
- batch checkpoint;
- lock owner;
- active job list;
- idempotency validation;
- retry/dead-letter behavior.
```

---

## 24. Release Governance Metrics

You cannot improve governance without measuring outcomes.

Useful metrics:

| Metric | Meaning |
|---|---|
| deployment frequency | delivery throughput |
| change failure rate | release quality |
| mean time to recover | recovery capability |
| lead time for change | delivery speed |
| rollback rate | release safety |
| emergency change rate | planning/control quality |
| post-release incident count | deployment impact |
| approval cycle time | governance friction |
| evidence completeness | audit maturity |
| failed CAB due missing info | preparation quality |

Be careful not to optimize one metric destructively.

Example:

```text
Reducing approval time by removing risk review may increase change failure rate.
```

Better:

```text
Automate low-risk evidence to reduce approval time while preserving controls.
```

---

## 25. Lightweight vs Heavyweight Governance

Not every change needs heavyweight process.

### 25.1 Lightweight Governance

Appropriate for:

1. low-risk internal service;
2. no data mutation;
3. no security change;
4. easy rollback;
5. automated tests/scans pass;
6. known deployment pattern.

Controls:

```text
PR review + CI gates + automated deploy + smoke + evidence auto-attached
```

### 25.2 Heavyweight Governance

Appropriate for:

1. irreversible DB/data change;
2. auth/security change;
3. public-facing critical service;
4. regulatory workflow;
5. multi-service release;
6. platform migration;
7. unknown/new deployment pattern;
8. manual production operation.

Controls:

```text
formal CR + risk assessment + CAB + rehearsal + war room + extended monitoring
```

### 25.3 Adaptive Governance

Best model:

```text
risk-based controls
```

not:

```text
same process for every change
```

Same heavy process for all changes causes:

1. slow delivery;
2. people bypassing process;
3. CAB fatigue;
4. low attention to truly risky changes.

---

## 26. Governance Failure Modes

### 26.1 CR Says One Thing, Deployment Does Another

Symptom:

```text
CR approved backend deploy only, but deployment also changed DB and config.
```

Cause:

1. hidden manifest diff;
2. auto-sync;
3. bundled changes;
4. missing review.

Prevention:

1. diff evidence;
2. CR scope checklist;
3. deployment manifest review;
4. GitOps PR linked to CR.

### 26.2 Approval Without Artifact Identity

Symptom:

```text
CR approved "latest build".
```

Cause:

1. mutable tags;
2. no release candidate;
3. build after approval.

Prevention:

1. approve release candidate;
2. immutable digest;
3. artifact metadata in CR.

### 26.3 Emergency Change Becomes Normal Process

Symptom:

```text
Many releases are emergency.
```

Cause:

1. poor planning;
2. slow normal process;
3. unstable release quality;
4. no release calendar.

Prevention:

1. classify emergency reason;
2. PIR required;
3. track emergency rate;
4. improve normal path.

### 26.4 Evidence Missing After Successful Deployment

Symptom:

```text
System works, but audit cannot prove what happened.
```

Cause:

1. manual deploy;
2. logs expired;
3. evidence not attached;
4. no closure discipline.

Prevention:

1. pipeline evidence;
2. CR closure checklist;
3. artifact metadata;
4. retention policy.

### 26.5 Governance Ignores Rollback Reality

Symptom:

```text
Rollback approved but impossible due DB/data change.
```

Cause:

1. rollback plan copied;
2. DB migration not reviewed;
3. compatibility not tested.

Prevention:

1. rollback feasibility classification;
2. expand-contract migration;
3. roll-forward plan;
4. rehearsal.

### 26.6 Security Approval Happens After Deployment

Symptom:

```text
security finds issue after PROD release.
```

Cause:

1. security not included in CR;
2. scan gate missing;
3. endpoint exposure not reviewed.

Prevention:

1. risk trigger for security review;
2. automated scan;
3. actuator/admin exposure checklist.

---

## 27. Governance Artifacts to Standardize

Standard templates reduce ambiguity.

Recommended artifacts:

```text
1. Change Request template
2. Release note template
3. Deployment runbook template
4. Rollback plan template
5. DB migration checklist
6. Security change checklist
7. Runtime upgrade checklist
8. Emergency change template
9. Post-implementation review template
10. Audit evidence checklist
11. CAB summary template
12. Deployment closure template
```

### 27.1 CR Summary Template

```markdown
# CR Summary

## What is changing?
-

## Why is it changing?
-

## What is the risk?
-

## What is the deployment plan?
-

## How will success be verified?
-

## How will rollback/roll-forward work?
-

## Who approves?
-

## What evidence will be attached?
-
```

### 27.2 CAB Summary Template

```markdown
# CAB Summary

- Change:
- Environment:
- Window:
- Risk level:
- User impact:
- Downtime:
- Data impact:
- Security impact:
- Rollback complexity:
- Support required:
- Decision needed:
```

### 27.3 Deployment Closure Template

```markdown
# Deployment Closure

Deployment completed: yes/no
Version deployed:
Environment:
Start time:
End time:
Verification result:
Monitoring result:
Incident/anomaly:
Rollback used:
Evidence attached:
Pending follow-up:
Final owner sign-off:
```

---

## 28. Governance and Human Factors

Governance fails when it ignores human reality.

### 28.1 During Deployment, People Are Under Pressure

So governance should:

1. reduce ambiguity;
2. predefine decisions;
3. avoid long prose at critical moment;
4. assign roles;
5. provide templates;
6. avoid hidden dependencies.

### 28.2 Approval Should Not Depend on Memory

Bad:

```text
We deployed similar thing before, should be fine.
```

Better:

```text
Previous successful release evidence linked.
Same deployment pattern.
Same rollback plan tested.
No new risk dimension.
```

### 28.3 Governance Should Be Learnable

Junior engineers should learn:

1. what evidence matters;
2. how to assess risk;
3. how to write CR;
4. how to communicate impact;
5. when to escalate;
6. how to close deployment properly.

Good governance grows engineers.

Bad governance teaches form-filling.

---

## 29. Enterprise Governance for Java Monolith vs Microservices

### 29.1 Monolith Governance

Risks:

1. large blast radius;
2. many modules in one artifact;
3. long regression cycle;
4. DB coupling;
5. difficult rollback;
6. session/state impact.

Governance needs:

1. module impact matrix;
2. regression scope;
3. affected workflow list;
4. DB compatibility;
5. maintenance window;
6. strong rollback/roll-forward plan.

### 29.2 Microservices Governance

Risks:

1. version skew;
2. contract incompatibility;
3. hidden dependency;
4. partial rollout;
5. distributed tracing needed;
6. multiple CR coordination.

Governance needs:

1. service dependency map;
2. API/event compatibility;
3. deployment order;
4. consumer readiness;
5. monitoring per service;
6. correlation ID tracing;
7. rollback sequence.

### 29.3 Platform Governance

Platform changes affect many services.

Examples:

1. Java base image update;
2. Kubernetes cluster upgrade;
3. ingress controller change;
4. service mesh change;
5. logging agent update;
6. node type replacement;
7. DNS change;
8. certificate authority change.

Governance needs:

1. service inventory;
2. compatibility testing;
3. staged rollout;
4. canary namespace;
5. rollback/fallback;
6. clear communication.

---

## 30. Governance for Multi-Vendor / Client Environments

In enterprise projects, multiple parties may exist:

1. client agency;
2. vendor development team;
3. infrastructure vendor;
4. DBA team;
5. security team;
6. operations team;
7. external integration provider;
8. cloud provider;
9. product/business owner.

Governance must define ownership.

### 30.1 RACI Matrix

| Activity | Dev | TL | QA | DBA | Infra | Security | Business | Change Manager |
|---|---|---|---|---|---|---|---|---|
| Code change | R | A | C | I | I | C | I | I |
| Test sign-off | C | C | A/R | I | I | I | C | I |
| DB migration review | C | C | C | A/R | I | I | I | I |
| Security config | C | C | C | I | C | A/R | I | I |
| Production deploy | C | A | C | C | R | C | I | A |
| Business verification | I | C | C | I | I | I | A/R | I |
| CR approval | C | C | C | C | C | C | A | A/R |

R = Responsible  
A = Accountable  
C = Consulted  
I = Informed

### 30.2 Multi-Party Failure Mode

Common issue:

```text
Everyone thought someone else verified the dependency.
```

Prevention:

1. explicit owner per dependency;
2. verification checklist;
3. sign-off per domain;
4. single deployment commander;
5. status communication cadence.

---

## 31. Production Access Governance

Production access must balance safety and speed.

### 31.1 Access Patterns

| Pattern | Use |
|---|---|
| No direct prod access | high automation maturity |
| Read-only prod access | debugging/verification |
| Time-bound elevated access | deployment/incident |
| Break-glass | emergency |
| Shared admin | avoid |

### 31.2 Java Diagnostics and Access

Capturing thread dump, heap dump, or JFR may require access.

Governance must decide:

1. who can run diagnostics;
2. where dumps are stored;
3. how sensitive data is handled;
4. retention period;
5. approval needed;
6. encryption;
7. transfer restrictions.

Heap dumps can contain secrets and PII.

So evidence governance must be stricter for diagnostic artifacts.

---

## 32. Deployment Evidence and Privacy

Evidence can accidentally leak sensitive data.

Examples:

1. logs with NRIC/user IDs;
2. URLs with tokens;
3. heap dumps;
4. SQL query outputs;
5. screenshots with user data;
6. config dumps with passwords;
7. environment variables;
8. stack traces exposing payload.

### 32.1 Evidence Redaction Rule

Before attaching evidence:

```text
- redact secrets;
- redact tokens;
- redact personal identifiers;
- redact full payloads;
- avoid heap dump attachment to CR;
- store sensitive diagnostics in controlled location;
- attach pointer/reference instead.
```

### 32.2 Safe Evidence Pattern

Instead of:

```text
Full request/response body
```

Use:

```text
transaction ID, timestamp, endpoint, status, sanitized error category
```

Instead of:

```text
full DB rows
```

Use:

```text
count, checksum, anonymized sample, query result summary
```

---

## 33. Governance for AI-Assisted Deployment Work

Modern teams may use AI to generate:

1. Dockerfile;
2. Kubernetes manifest;
3. runbook;
4. SQL migration;
5. CI/CD pipeline;
6. test script;
7. RCA draft.

Governance should define:

1. no production secrets to AI;
2. no PII;
3. human review required;
4. generated commands must be tested;
5. generated SQL must be reviewed;
6. AI output is not approval evidence by itself;
7. final artifact ownership remains human/team.

AI can accelerate drafting.

AI cannot own production accountability.

### 33.1 AI Use Evidence

For regulated environments, you may need to state:

```text
AI-assisted draft reviewed by engineer X.
No production data/secrets used.
Final implementation validated through tests and review.
```

---

## 34. Governance Automation Blueprint

A mature Java deployment governance system may look like this:

```text
Developer opens PR
  ↓
CI runs tests, SAST, SCA, SBOM
  ↓
Artifact built once
  ↓
Image signed and pushed by digest
  ↓
Release candidate created
  ↓
CR auto-populated with:
    - commit
    - artifact
    - scan result
    - test result
    - SBOM link
  ↓
Risk classification engine suggests level
  ↓
Required approvals based on risk
  ↓
CD pipeline deploys to environment
  ↓
Automated smoke + metric gate
  ↓
Evidence auto-attached
  ↓
CR closure requires verification result
  ↓
PIR required if failed/emergency
```

Key principle:

> Automate evidence generation, not judgment blindly.

---

## 35. Practical Governance Checklist for Java Deployment

Before production deployment:

```text
[ ] CR exists.
[ ] Scope is accurate.
[ ] Business reason is clear.
[ ] Risk level is justified.
[ ] Artifact identity is immutable.
[ ] Java runtime version is documented.
[ ] Config changes are listed.
[ ] Secret/cert changes are listed.
[ ] DB migration is classified.
[ ] Security impact reviewed if relevant.
[ ] Rollback feasibility is realistic.
[ ] Roll-forward path exists if rollback unsafe.
[ ] Test evidence attached.
[ ] Scan/SBOM evidence attached if required.
[ ] Deployment window approved.
[ ] Required teams available.
[ ] Runbook linked.
[ ] Monitoring dashboard ready.
[ ] Smoke/synthetic checks defined.
[ ] Evidence retention path known.
```

After production deployment:

```text
[ ] Version verified in runtime.
[ ] Health/readiness passed.
[ ] Smoke/synthetic passed.
[ ] Metrics within threshold.
[ ] Logs checked.
[ ] DB migration verified.
[ ] Queue/scheduler state verified if relevant.
[ ] User/business verification completed if required.
[ ] Evidence attached.
[ ] Stakeholders notified.
[ ] CR closed.
[ ] PIR created if failed/emergency/high-risk.
```

---

## 36. Case Study: Governance Failure

Scenario:

```text
A team deploys Java service v2.3.0.
CR says "minor backend fix".
Deployment includes:
- new JAR;
- new ConfigMap timeout;
- DB index creation;
- Keycloak role mapper update.
```

What happens:

1. DB index locks table longer than expected.
2. app startup succeeds but authorization fails for some users.
3. rollback to previous JAR does not fix Keycloak mapper.
4. CR evidence only shows “deployment successful”.
5. incident review finds scope mismatch.

Root governance failures:

1. CR scope incomplete;
2. security change not reviewed;
3. DB change not classified;
4. rollback plan only covered JAR;
5. no dependency verification;
6. evidence incomplete.

Corrected governance:

```text
- split CR or explicitly list all change types;
- require DB and security review;
- deployment sequence includes DB and Keycloak verification;
- rollback plan includes config/realm rollback;
- smoke test includes role-based login;
- closure evidence includes auth check and DB migration result.
```

---

## 37. Case Study: Good Governance With Fast Delivery

Scenario:

```text
Low-risk bug fix to report-service.
No DB change.
No config change.
No security impact.
Easy rollback.
```

Governance flow:

1. PR reviewed and merged.
2. CI passes test/SCA.
3. image built and signed.
4. CR auto-created from release metadata.
5. risk classification = low.
6. TL approval only.
7. pipeline deploys to UAT then PROD.
8. smoke and metric gate pass.
9. evidence auto-attached.
10. CR auto-closed after monitoring window.

This is good governance because it is:

1. fast;
2. controlled;
3. evidence-backed;
4. risk-based;
5. not manually heavy.

---

## 38. Top 1% Perspective: Governance as Engineering Design

Top-tier engineers do not merely complain about process.

They redesign process into reliable systems.

They ask:

```text
Which controls are truly reducing risk?
Which controls are manual and error-prone?
Which evidence can be generated automatically?
Which approvals are meaningful?
Which changes can be pre-approved by policy?
Which high-risk changes need more review?
Where can governance be encoded into pipeline?
Where does human judgment remain necessary?
```

The goal is not:

```text
more process
```

The goal is:

```text
less ambiguity, less hidden risk, more reliable change
```

---

## 39. Summary

Enterprise governance for Java deployment is about making change:

1. authorized;
2. scoped;
3. risk-assessed;
4. approved;
5. traceable;
6. secure;
7. verifiable;
8. reversible or consciously forward-only;
9. auditable;
10. learnable.

The central mental model:

> Deployment governance is the control plane that ensures technical changes are made with accountability, evidence, and operational safety.

For simple systems, lightweight automation may be enough.

For regulated, stateful, distributed Java systems, governance is part of the architecture.

---

## 40. References

- NIST SP 800-53 Rev. 5 — Security and Privacy Controls for Information Systems and Organizations: https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final
- NIST SP 800-218 — Secure Software Development Framework Version 1.1: https://csrc.nist.gov/pubs/sp/800/218/final
- Google SRE Book — Postmortem Culture: https://sre.google/sre-book/postmortem-culture/
- Google SRE Workbook — Postmortem Practices for Incident Management: https://sre.google/workbook/postmortem-culture/
- Kubernetes Documentation — Auditing: https://kubernetes.io/docs/tasks/debug/debug-cluster/audit/
- Kubernetes Documentation — Authorization / RBAC: https://kubernetes.io/docs/reference/access-authn-authz/rbac/
- GitHub Docs — Deployment Environments and Protection Rules: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- OpenSSF SLSA: https://slsa.dev/
- CycloneDX: https://cyclonedx.org/
- SPDX: https://spdx.dev/

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 31 — Runbook Engineering for Java Deployment](./learn-java-deployment-runtime-release-delivery-engineering-part-31-runbook-engineering-for-java-deployment.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 33 — Deployment Architecture Decision Records and Checklists](./learn-java-deployment-runtime-release-delivery-engineering-part-33-deployment-architecture-decision-records-and-checklists.md)

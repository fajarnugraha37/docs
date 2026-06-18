# learn-git-mastery-for-java-engineers-part-031.md

# Part 031 — Git dalam CI/CD, Release Automation, dan Compliance

> **Seri:** Git Mastery for Java Engineers  
> **Bagian:** 031 / 032  
> **Topik:** Menggunakan Git sebagai trust anchor dalam CI/CD, release automation, artifact provenance, GitOps, rollback, hotfix, dan compliance evidence  
> **Target pembaca:** Java software engineer, backend engineer, release engineer, platform engineer, tech lead, dan engineer yang bekerja di production/enterprise/regulatory environment  
> **Status seri:** Belum selesai. Bagian terakhir adalah `learn-git-mastery-for-java-engineers-part-032.md`.

---

## 0. Ringkasan Eksekutif

CI/CD bukan sekadar menjalankan test otomatis.

CI/CD adalah sistem yang menjawab pertanyaan:

```text
Source mana yang dibangun?
Siapa yang mengubahnya?
Apakah perubahan direview?
Apakah test/security check lulus?
Artifact apa yang dihasilkan?
Artifact itu berasal dari commit/tag mana?
Apakah artifact itu dipromosikan ke environment yang benar?
Apakah deployment disetujui?
Bagaimana rollback dilakukan?
Evidence apa yang tersedia untuk audit?
```

Git adalah salah satu trust anchor utama dalam rantai itu.

Tetapi Git hanya berguna sebagai trust anchor jika:

- branch protection kuat;
- tag release jelas;
- commit/tag tidak bisa dimanipulasi sembarangan;
- CI checkout tepat;
- artifact menyimpan metadata commit;
- release tidak dibuat dari dirty working tree;
- dependency versions traceable;
- deployment config versioned;
- approval dan audit trail tersimpan;
- rollback mengacu artifact/version yang jelas.

Mental model utama:

```text
CI/CD yang sehat menghubungkan Git commit -> verified build -> immutable artifact
-> controlled deployment -> observable runtime -> auditable evidence.
```

Untuk Java engineer, ini berarti Git harus terhubung dengan:

- Maven/Gradle build;
- unit/integration/contract tests;
- artifact repository;
- container registry;
- SBOM;
- release tags;
- changelog;
- deployment manifests;
- GitOps repo;
- environment promotion;
- incident/hotfix workflow;
- compliance evidence.

---

## 1. Git dalam Delivery Chain

Delivery chain sederhana:

```text
Developer commit
  -> Pull Request
  -> Review
  -> CI checks
  -> Merge to main
  -> Build artifact
  -> Tag/release
  -> Publish artifact
  -> Deploy to environment
  -> Observe
  -> Rollback/roll-forward if needed
```

Untuk setiap tahap, Git memberikan data:

| Tahap | Git Data |
|---|---|
| Commit | SHA, author, diff, message |
| PR | branch, merge commit/squash commit, review context |
| CI | checked-out commit, branch/tag |
| Release | tag, version bump, changelog |
| Artifact | source commit/tag metadata |
| Deploy | deployment manifest commit |
| Audit | commit/PR/check/tag/release evidence |
| Rollback | previous tag/artifact/manifest commit |

Jika salah satu link hilang, traceability melemah.

---

## 2. Source Commit Harus Eksplisit

CI harus selalu tahu commit SHA yang dibangun.

Command:

```bash
git rev-parse HEAD
```

Build metadata:

```text
git.commit=a13f9e2c9d7b...
git.branch=main
git.tag=case-service-v1.8.3
ci.run=4821
```

Jangan puas dengan:

```text
built from latest
```

`latest` bukan provenance.

Commit SHA adalah anchor.

Tag/release adalah nama manusiawi.

Artifact version adalah koordinat distribusi.

Ketiganya harus konsisten.

---

## 3. CI Checkout Strategy

CI checkout harus sesuai kebutuhan job.

## 3.1 PR Fast Check

Bisa shallow jika tidak butuh full history:

```text
fetch-depth: 1
```

Cocok untuk:

- compile;
- unit test;
- lint;
- formatting;
- current-tree scan.

## 3.2 Affected Build

Butuh merge-base dengan target branch.

Perlu fetch target branch dan cukup history.

Misal:

```bash
git fetch origin main
git merge-base HEAD origin/main
```

Jika shallow terlalu dangkal, affected detection salah.

## 3.3 Release Build

Butuh tags/history:

```text
fetch-depth: 0
fetch tags
```

Karena release sering memakai:

```bash
git describe --tags
```

## 3.4 Security Full History Scan

Butuh full history.

## 3.5 GitOps Deployment

Butuh exact commit/manifest state.

Rule:

```text
CI checkout depth harus didesain per job, bukan copy-paste default.
```

---

## 4. Detached HEAD di CI

CI sering checkout commit tertentu, bukan branch.

State:

```text
HEAD detached at a13f9e2
```

Ini normal.

Jangan menulis script yang mengasumsikan:

```bash
git rev-parse --abbrev-ref HEAD
```

selalu menghasilkan branch.

Di CI, hasil bisa:

```text
HEAD
```

Gunakan environment variable platform:

```text
GITHUB_SHA
GITHUB_REF
GITHUB_HEAD_REF
CI_COMMIT_SHA
CI_COMMIT_REF_NAME
BRANCH_NAME
```

Tetapi tetap validasi.

Untuk release script, lebih aman menggunakan explicit ref:

```bash
git checkout "refs/tags/$TAG"
```

atau source commit dari CI metadata.

---

## 5. Branch Protection sebagai Control Point

Branch utama harus dilindungi.

Minimal:

```text
main:
  - no direct push
  - PR required
  - required CI checks
  - required review
  - no force push
  - no branch deletion
```

Untuk repo kritikal:

```text
  - CODEOWNERS review
  - signed commits
  - linear history policy if needed
  - merge queue
  - security scan required
  - deployment approval
```

Branch protection menjadikan Git history lebih terpercaya.

Tanpa branch protection:

```text
Siapa pun dengan write access bisa bypass PR/CI.
```

---

## 6. Required Checks

Required checks harus mencerminkan risk.

Contoh Java backend:

```text
compile
unit test
integration test
contract test
format/lint
dependency scan
secret scan
container build
migration validation
OpenAPI compatibility
Docker image scan
```

Tidak semua harus blocking di setiap PR.

Struktur umum:

```text
PR checks:
  fast enough to give feedback

Merge/main checks:
  stronger verification

Release checks:
  full verification and provenance

Nightly checks:
  expensive broad scans
```

Rule:

```text
Required checks harus cukup kuat untuk melindungi main,
tetapi cukup cepat agar workflow tidak lumpuh.
```

---

## 7. Merge Strategy dan CI/CD

Merge strategy memengaruhi traceability.

## 7.1 Merge Commit

```text
Feature commits preserved.
Merge commit represents integration.
```

Pros:

- branch history preserved;
- PR integration visible;
- good for complex branches.

Cons:

- history non-linear;
- changelog may be noisy.

## 7.2 Squash Merge

```text
PR becomes one commit on main.
```

Pros:

- main clean;
- each PR one commit;
- easier revert per PR.

Cons:

- internal branch commits lost on main;
- bisect finds squash commit;
- co-author/detail may need message care.

## 7.3 Rebase Merge

```text
Commits replayed linearly on main.
```

Pros:

- linear history;
- individual commits preserved.

Cons:

- commit discipline required;
- PR boundary less obvious unless platform metadata.

CI/CD concern:

```text
Whatever strategy chosen, artifact provenance must point to final commit on protected branch/tag.
```

---

## 8. Build from PR vs Build from Main

PR build validates proposed change.

Main build validates integrated change.

Why both matter:

```text
PR branch may pass before merge.
Main may fail after merge due to concurrent changes.
```

Strategies:

- require branch up to date;
- merge queue;
- test merge commit;
- main branch CI;
- protected main.

Merge queue is strong for busy repos because it tests candidate integration state before merge.

---

## 9. Merge Queue

Merge queue serializes and tests changes before landing.

Benefits:

- reduces broken main;
- tests actual integrated state;
- helps high-change repos.

Costs:

- queue latency;
- CI capacity;
- more platform complexity.

For critical Java services or monorepo, merge queue can be valuable.

---

## 10. Versioning Strategy

Java artifacts need versions.

Common strategies:

## 10.1 Semantic Versioning

```text
MAJOR.MINOR.PATCH
```

Useful for libraries.

Example:

```text
workflow-core 2.4.1
```

## 10.2 Calendar Versioning

```text
2026.06.17
2026.06.0
```

Useful for platform/release train.

## 10.3 Commit-Based Versioning

```text
1.8.3+a13f9e2
```

or Docker tag:

```text
case-service:a13f9e2
```

Useful for internal services.

## 10.4 Build Number

```text
1.8.3-4821
```

Only meaningful with CI metadata.

Rule:

```text
Libraries consumed by others need stable version semantics.
Deployable services need traceable immutable artifact identity.
```

---

## 11. Maven Versioning

Maven artifact coordinate:

```text
groupId:artifactId:version
```

Example:

```xml
<groupId>com.acme.case</groupId>
<artifactId>case-service</artifactId>
<version>1.8.3</version>
```

Release artifact should be immutable.

Avoid release depending on:

```text
SNAPSHOT
latest
dynamic versions
```

Maven release flow should ensure:

- clean working tree;
- version set;
- tag created;
- tests pass;
- artifact deployed to repository;
- no mutable release overwrite.

---

## 12. Gradle Versioning

Gradle:

```kotlin
group = "com.acme.case"
version = "1.8.3"
```

Or version from Git tag.

Be careful if deriving version from `git describe`:

- CI must fetch tags;
- shallow clone can break;
- dirty tree must be handled;
- tag naming must be unambiguous.

Version catalog/lockfile changes should be reviewed.

---

## 13. Release Tags

Release tag connects source to release.

Good tag names:

```text
case-service-v1.8.3
workflow-core-v2.4.1
v2026.06.0
```

Use annotated/signed tags for important releases:

```bash
git tag -s case-service-v1.8.3 -m "Release case-service v1.8.3"
```

Push:

```bash
git push origin refs/tags/case-service-v1.8.3
```

Protect tags:

```text
no deletion
no force update
restricted creation
```

Avoid moving release tags.

---

## 14. Build from Tag vs Build then Tag

Preferred pattern for release:

```text
1. Prepare source/version.
2. Merge to protected branch.
3. Create release tag on exact commit.
4. CI builds from tag.
5. Publish artifact with tag/commit metadata.
```

Alternative:

```text
Build main commit, then tag after successful build.
```

This can work if tag points exactly to built commit and process is atomic/controlled.

Risk:

```text
Artifact built from commit not tagged due to failure in tag step.
```

Mitigation:

- CI records commit SHA;
- release job creates tag and builds from same SHA;
- no dirty tree;
- artifact metadata includes SHA.

---

## 15. Changelog Generation

Changelog can come from:

- Conventional Commits;
- PR titles;
- labels;
- issue tracker;
- manually curated notes;
- commit range between tags.

Example range:

```bash
git log case-service-v1.8.2..case-service-v1.8.3 --oneline
```

Better release notes answer:

```text
What changed?
Why?
Risk?
Migration?
Rollback?
Security impact?
```

Autogenerated changelog is useful but not sufficient for regulated or high-risk releases.

---

## 16. Artifact Publishing

Java artifacts go to artifact repository:

- Nexus;
- Artifactory;
- GitHub Packages;
- GitLab Package Registry;
- AWS CodeArtifact.

Publish should include:

- artifact file;
- POM/module metadata;
- checksums;
- sources jar if library;
- javadoc jar if needed;
- SBOM if policy;
- provenance/CI metadata if supported.

Do not commit release jar into Git.

---

## 17. Container Image Publishing

Service deploy often uses container image.

Build:

```bash
docker build -t registry/acme/case-service:1.8.3 .
```

Better tag set:

```text
case-service:1.8.3
case-service:a13f9e2
case-service:1.8.3-a13f9e2
```

Push:

```bash
docker push registry/acme/case-service:1.8.3
```

Use digest for deployment traceability:

```text
registry/acme/case-service@sha256:...
```

Mutable `latest` is not enough for production traceability.

---

## 18. Artifact Metadata

Artifact should answer:

```text
Which Git commit?
Which tag?
Which CI run?
Which build timestamp?
Which dependency versions?
Was working tree clean?
```

In Spring Boot, build info can be exposed via Actuator.

Example properties:

```properties
build.version=1.8.3
git.commit=a13f9e2c9d7b
git.branch=main
git.tag=case-service-v1.8.3
ci.run=4821
```

For container images, use OCI labels:

```dockerfile
LABEL org.opencontainers.image.revision=$GIT_COMMIT
LABEL org.opencontainers.image.version=$VERSION
LABEL org.opencontainers.image.source=$REPO_URL
```

---

## 19. Clean Tree Requirement

Release build must not include uncommitted changes.

Check:

```bash
git status --porcelain
```

Fail if not empty:

```bash
if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing release from dirty working tree."
  exit 1
fi
```

In CI, checkout should be clean by default, but generated files may dirty it.

If build modifies tracked files, fix generation policy.

---

## 20. Dependency Lock and Release

For release:

```text
Dependency set must be known.
```

Gradle:

- dependency locking;
- verification metadata;
- version catalog.

Maven:

- dependencyManagement/BOM;
- enforcer rules;
- repository manager immutability.

Release should avoid:

```text
SNAPSHOT
dynamic versions
untrusted repositories
changing plugin versions without review
```

Dependency diff should be part of review.

---

## 21. SBOM in Release Pipeline

SBOM lists dependencies/components.

For Java, generate via CycloneDX or SPDX tooling.

Recommended:

```text
Generate SBOM during CI release.
Attach SBOM to artifact/release.
Store as release evidence.
```

SBOM should be associated with exact artifact and commit.

Do not generate SBOM from a different dependency state than artifact.

---

## 22. Provenance and Attestation

Provenance answers:

```text
Who built it?
What source?
What builder?
What inputs?
What command/workflow?
What output?
```

Modern systems may use:

- SLSA provenance;
- in-toto attestations;
- Sigstore;
- cosign for containers;
- build attestations from CI.

Even if not fully implemented, design pipeline so provenance can be added:

```text
immutable source ref
controlled builder
pinned dependencies
artifact digest
signed release metadata
```

---

## 23. GitOps

GitOps uses Git as desired state for deployment.

Example:

```text
app source repo:
  case-service code

environment repo:
  environments/prod/case-service.yaml
```

Deployment change:

```yaml
image: registry/acme/case-service@sha256:abc...
```

Controller syncs cluster to Git state.

Benefits:

- deployment state versioned;
- audit trail;
- rollback via Git revert;
- review on environment changes;
- separation app build vs deploy.

Risks:

- source repo and env repo correlation needed;
- secrets must not be plain Git;
- force push/tag issues;
- emergency changes outside Git cause drift.

---

## 24. App Repo vs Config Repo

App repo contains:

```text
source code
tests
build config
Dockerfile
deployment templates maybe
```

Config/environment repo contains:

```text
environment-specific manifest
image digest
replica count
feature flags maybe
Helm values/Kustomize overlays
```

Separation helps controlled promotion.

But traceability must link:

```text
app commit -> image digest -> config commit -> environment
```

---

## 25. Promotion Across Environments

Do not rebuild from source for each environment if goal is artifact promotion.

Better:

```text
Build once.
Publish immutable artifact.
Promote same artifact dev -> staging -> prod.
```

Why:

```text
If you rebuild for prod, it may not be byte-identical.
Dependency/source/tooling may drift.
```

Promotion should change deployment reference, not rebuild artifact.

---

## 26. Environment Promotion Example

CI build:

```text
commit a13f9e2
image digest sha256:abc
artifact case-service:1.8.3
```

Deploy dev:

```text
dev manifest references sha256:abc
```

Promote staging:

```text
staging manifest references same sha256:abc
```

Promote prod:

```text
prod manifest references same sha256:abc
```

Audit:

```text
Which artifact is in prod?
sha256:abc
Built from?
commit a13f9e2 / tag case-service-v1.8.3
Approved by?
deployment PR #456
```

---

## 27. Rollback

Rollback should be defined.

Options:

## 27.1 Redeploy Previous Artifact

Preferred for service rollback:

```text
prod manifest image digest -> previous digest
```

GitOps rollback:

```bash
git revert <deployment-config-commit>
```

## 27.2 Revert Source and Build New Artifact

Use when:

- old artifact incompatible with current environment;
- data migration prevents binary rollback;
- fix forward is safer.

## 27.3 Feature Flag Disable

If change behind flag, rollback config flag.

## 27.4 Database Rollback

Hardest.

Need migration strategy.

Rule:

```text
Rollback is not just Git revert.
Rollback is runtime compatibility problem.
```

---

## 28. Git Revert in Release Workflow

If bad commit on main:

```bash
git revert <sha>
```

This creates new commit.

CI builds new artifact.

Deploy new artifact.

Benefits:

- audit trail preserved;
- no history rewrite;
- safe for protected branches.

Use revert for public history.

Avoid reset/force push main.

---

## 29. Hotfix Workflow

Typical hotfix:

```text
1. Identify production tag.
2. Create hotfix branch from tag or release branch.
3. Apply minimal fix.
4. Test.
5. Tag patch release.
6. Deploy.
7. Forward-port fix to main.
```

Commands concept:

```bash
git switch -c hotfix/CASE-999 case-service-v1.8.3
# fix
git commit -m "fix(case): prevent null escalation reason"
git tag -s case-service-v1.8.4 -m "Release case-service v1.8.4"
```

Forward-port:

```bash
git switch main
git cherry-pick <hotfix-commit>
```

or merge if branch model supports.

Checklist:

```text
Hotfix in production branch/tag.
Fix also in main.
Regression test added.
Release notes updated.
```

---

## 30. Release Branch Workflow

Release branch:

```text
release/2.8
```

Use when:

- release stabilization;
- multiple patch releases;
- long support;
- regulated approval cycle.

Rules:

```text
Only critical fixes.
No broad refactor.
Backport from main or forward-port to main.
Tags created from release branch.
```

Risk:

- divergence;
- forgotten fixes;
- merge conflicts;
- duplicate commits.

Need tracking:

```bash
git cherry -v main release/2.8
```

---

## 31. Backport and Forward-Port

Backport:

```text
Move fix from main to older release branch.
```

Usually cherry-pick:

```bash
git cherry-pick -x <sha>
```

`-x` records original commit SHA in message.

Forward-port:

```text
Ensure fix from release/hotfix also lands in main.
```

Failure to forward-port causes regression in next release.

CI/CD should track this.

---

## 32. Compliance Evidence

Compliance often needs evidence:

```text
Requirement/ticket
Code change
Review approval
Test result
Security scan
Build artifact
Release approval
Deployment approval
Production deployment
Rollback plan
```

Git contributes:

- commit;
- PR;
- diff;
- review;
- tag;
- branch;
- CODEOWNERS;
- history.

CI contributes:

- build logs;
- test reports;
- scan reports;
- artifact metadata.

Deployment platform contributes:

- deployment logs;
- approval;
- environment state.

Artifact repository contributes:

- artifact immutability;
- checksum;
- SBOM/provenance.

Compliance is cross-system traceability, not Git alone.

---

## 33. Evidence Chain Example

```text
Ticket: CASE-1842
PR: #842
Commit: a13f9e2
Reviewers: @case-lead, @security
CI run: 4821 passed
Tag: case-service-v1.8.3 signed
Artifact: com.acme:case-service:1.8.3 sha256:...
Image: registry/acme/case-service@sha256:abc
SBOM: attached to release
Deployment PR: env-prod#456
Approval: @release-manager
Prod deployment time: 2026-06-17T10:00Z
```

This is audit-ready.

---

## 34. Pull Request Template for Compliance

Example sections:

```markdown
## Summary

## Risk

## Testing

## Migration / Rollback

## Security / Privacy Impact

## Dependency Changes

## Deployment Notes

## Ticket
```

PR template improves evidence quality.

But avoid bureaucracy without value.

---

## 35. CODEOWNERS for Compliance

Sensitive paths:

```text
db/migration/ @database-reviewers
.github/workflows/ @dev-platform @security
helm/prod/ @platform-ops
src/main/resources/application-prod.yml @platform-ops
pom.xml @backend-platform
build.gradle* @backend-platform
```

With branch protection requiring CODEOWNERS review, this becomes control.

---

## 36. Database Migration in CI/CD

Migration is high-risk.

CI should validate:

- migration naming;
- migration applies to clean DB;
- migration applies to previous schema;
- rollback strategy if required;
- backward compatibility;
- generated jOOQ/schema updated;
- no destructive change without plan.

Deployment:

```text
expand -> deploy code -> contract
```

for zero-downtime changes.

Git migration files are source of truth.

Do not edit released migrations casually.

---

## 37. Expand/Contract Pattern

For DB/API compatibility:

## 37.1 Expand

Add backward-compatible schema/API.

Example:

```text
add nullable column
write both old/new
deploy compatible code
```

## 37.2 Migrate

Backfill/transition.

## 37.3 Contract

Remove old column/API after consumers migrated.

This often spans multiple commits/releases.

Git history should show each step.

Rollback depends on compatibility.

---

## 38. Feature Flags

Feature flags decouple deploy from release.

Git commit can deploy code disabled.

Runtime config enables feature later.

Traceability needs:

- code commit;
- flag definition;
- flag default;
- flag change audit;
- rollout plan;
- cleanup commit.

Do not let feature flags become permanent hidden branches.

Git should eventually remove dead flag code.

---

## 39. CI/CD and Secret Management

CI should not store secrets in Git.

Use CI secret store or secret manager.

Rules:

```text
No secrets in workflow files.
No printing secrets.
Least privilege tokens.
Environment-specific secrets.
Protected environments for prod.
No prod secrets in PR from untrusted code.
```

Git review should treat workflow changes as sensitive.

---

## 40. Build Once, Deploy Many

This principle improves trust.

Bad:

```text
Build jar separately for dev, staging, prod.
```

Good:

```text
Build once from commit/tag.
Promote same artifact.
```

Benefits:

- same tested artifact;
- fewer environmental differences;
- stronger provenance;
- easier rollback;
- better compliance.

Config can vary by environment, artifact should not.

---

## 41. Artifact Immutability

Release artifact must not be overwritten.

Bad:

```text
case-service:1.8.3 overwritten with new bytes
```

Good:

```text
1.8.3 immutable
1.8.4 for fix
```

Container tags can be mutable unless registry policy prevents it.

Use digest for exact identity.

Artifact repository should block redeploy of release versions.

---

## 42. Snapshot Builds

SNAPSHOT/dev builds are useful for integration.

But:

```text
Do not deploy SNAPSHOT to production.
```

SNAPSHOT is mutable.

If production incident needs forensic, mutable artifact is nightmare.

Use unique version for every deployable production artifact.

---

## 43. Git Describe for Version

Example:

```bash
git describe --tags --always --dirty
```

Output:

```text
case-service-v1.8.3-5-ga13f9e2
```

Useful for internal build metadata.

Caveats:

- tags needed;
- shallow clone issue;
- dirty flag must fail release;
- tag naming matters;
- monorepo component tags can confuse `git describe`.

For monorepo, restrict match:

```bash
git describe --tags --match 'case-service-v*'
```

---

## 44. Monorepo Release Automation

Monorepo with independent components needs component-aware release.

Questions:

```text
Which component changed?
Which version increments?
Which tag pattern?
Which artifact builds?
Which consumers need update?
```

Example tag:

```text
case-service-v1.8.3
workflow-core-v2.4.1
```

Use path-aware changelog:

```bash
git log case-service-v1.8.2..HEAD -- services/case-service
```

But shared libs complicate impact.

Need dependency graph.

---

## 45. Polyrepo Release Automation

Polyrepo simpler per repo, but cross-repo coordination harder.

Need:

- artifact versioning;
- dependency update PRs;
- compatibility checks;
- release notes per repo;
- integration environment;
- deployment manifest linking versions.

Dependency bots help propagate versions.

---

## 46. GitOps Rollback

If environment repo commit changed image digest:

```diff
-image: case-service@sha256:old
+image: case-service@sha256:new
```

Rollback:

```bash
git revert <env-commit>
```

Controller reconciles back.

But if database migration ran, rollback may not be safe.

Always include migration/rollback notes in deployment PR.

---

## 47. Deployment Manifest as Evidence

A deployment manifest commit can show:

```text
prod moved case-service from digest A to digest B
```

This is strong evidence.

But only if:

- manual cluster changes are prevented/detected;
- controller syncs from Git;
- secrets handled separately;
- manifest repo protected;
- approval recorded.

---

## 48. Release Approval

Approval should be tied to immutable artifact.

Bad:

```text
Approve "deploy latest".
```

Good:

```text
Approve deploy case-service v1.8.3 / image digest sha256:abc.
```

Approval record should include:

- artifact identity;
- environment;
- time;
- approver;
- risk notes if required.

---

## 49. Observability Link to Git

Runtime should expose build info.

Examples:

- `/actuator/info`;
- metrics label;
- log startup banner;
- tracing resource attribute;
- Kubernetes labels/annotations.

Useful fields:

```text
service.name
service.version
git.commit
git.tag
image.digest
build.time
```

During incident:

```text
Which commit is running in prod?
```

should be easy to answer.

---

## 50. Kubernetes Labels/Annotations

Deployment metadata:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: case-service
    app.kubernetes.io/version: "1.8.3"
  annotations:
    acme.com/git-commit: "a13f9e2c9d7b"
    acme.com/image-digest: "sha256:abc..."
```

Avoid labels with too-long values if platform limits apply.

Annotations can hold more metadata.

---

## 51. Roll Forward vs Rollback

In many Java backend systems, roll forward is safer than rollback when:

- DB migration is not reversible;
- data format changed;
- external side effects happened;
- consumers saw new contract;
- message schema advanced.

Git revert creates source fix, but operational rollback must consider state.

Decision:

```text
Can old artifact run safely against current data/config?
```

If no, roll forward.

---

## 52. Release Freeze and Change Control

Some environments require freeze windows.

Git controls:

- restrict merge to release branch;
- require approval;
- use labels;
- branch protection;
- deployment environment approval.

But process must be explicit.

Avoid hidden changes:

```text
No manual patch in production outside Git.
```

If emergency manual change occurs, backport to Git immediately.

---

## 53. Emergency Change Process

Emergency hotfix should still produce evidence.

Minimal:

```text
incident ID
hotfix branch
review if possible
CI run
release tag/artifact
deployment approval or emergency approval
post-incident review
forward-port to main
```

Speed does not mean abandoning traceability.

---

## 54. CI/CD Anti-Patterns

## 54.1 Deploy from Developer Laptop

Unreproducible, poor audit.

## 54.2 Build Separately per Environment

Artifact drift.

## 54.3 Use `latest` in Production

No exact identity.

## 54.4 No Branch Protection

CI/review bypass.

## 54.5 Mutable Release Artifacts

Cannot trust version.

## 54.6 Tag After Artifact Without Verification

Tag/artifact mismatch risk.

## 54.7 Release from Dirty Tree

No reproducibility.

## 54.8 No Forward-Port Hotfix

Bug returns later.

## 54.9 Migration Without Rollback/Compatibility Plan

Operational risk.

## 54.10 CI Secrets in PR Jobs

Supply chain risk.

---

## 55. Java CI Pipeline Example

PR pipeline:

```text
checkout
setup JDK
restore Maven/Gradle cache
compile
unit tests
format check
static analysis
secret scan current tree
dependency review
```

Main pipeline:

```text
checkout integrated commit
full test
integration test
contract test
build container
scan image
publish snapshot/internal artifact maybe
```

Release pipeline:

```text
checkout tag
verify clean source
full test
generate SBOM
build artifact/container
sign/attest
publish immutable artifact
create release notes
deploy/promote through environments
```

---

## 56. GitHub Actions Sketch

Concept:

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]
    tags: ["case-service-v*"]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # if versioning needs tags
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "21"
          cache: gradle
      - run: ./gradlew test spotlessCheck
```

Release job should have stricter permissions and only run on protected tag/environment.

---

## 57. GitLab CI Sketch

Concept:

```yaml
stages:
  - test
  - build
  - release

test:
  stage: test
  script:
    - ./gradlew test spotlessCheck

release:
  stage: release
  rules:
    - if: '$CI_COMMIT_TAG =~ /^case-service-v/'
  script:
    - ./gradlew clean build
    - ./gradlew publish
```

Ensure runner fetches tags/history as needed.

---

## 58. Jenkins Considerations

Jenkins pipelines often suffer from:

- stale workspace;
- dirty checkout;
- branch detection issues;
- credentials in logs;
- unpinned agents/tools;
- manual replay changes.

Best practices:

- clean checkout for release;
- record commit SHA;
- use Jenkinsfile from repo but protect changes;
- credentials binding carefully;
- archive artifacts with fingerprints/checksums;
- avoid building from mutable workspace state.

---

## 59. Compliance Checklist for Release

```text
[ ] Release source commit identified.
[ ] Release tag exists and protected/signed if required.
[ ] PR/review evidence exists.
[ ] CI checks passed.
[ ] Tests reports retained.
[ ] Security/dependency scan passed or exceptions approved.
[ ] SBOM generated if required.
[ ] Artifact checksum/digest recorded.
[ ] Artifact published immutably.
[ ] Deployment approval recorded.
[ ] Environment config commit recorded.
[ ] Rollback/roll-forward plan documented.
[ ] Hotfix forward-port tracked if applicable.
```

---

## 60. Developer Checklist Before Merge

```text
[ ] Branch up to date or merge queue handles it.
[ ] Tests pass locally or CI.
[ ] No secrets.
[ ] Dependency changes intentional.
[ ] Migration reviewed.
[ ] Generated code consistent.
[ ] PR description includes risk/testing/rollback.
[ ] Commit/PR message useful for changelog/audit.
```

---

## 61. Maintainer Checklist

```text
[ ] Branch protection configured.
[ ] Required checks meaningful.
[ ] CODEOWNERS current.
[ ] Release tags protected.
[ ] CI checkout strategies correct.
[ ] Artifact repository immutable for releases.
[ ] Build metadata includes Git SHA.
[ ] Secret scanning enabled.
[ ] Dependency scanning enabled.
[ ] Hotfix process documented.
[ ] Release evidence retained.
[ ] GitOps/config repo protected if used.
```

---

## 62. Incident Forensic Checklist

During incident:

```text
[ ] What version is running?
[ ] What Git commit/tag built it?
[ ] What artifact digest?
[ ] What changed since previous good release?
[ ] Which PRs included?
[ ] Any dependency change?
[ ] Any migration/config change?
[ ] Can we rollback safely?
[ ] Is hotfix needed?
[ ] How will fix reach main/release branches?
```

Commands:

```bash
git log previous-tag..current-tag --oneline
git diff previous-tag..current-tag --stat
git show current-tag
git tag --contains <fix-sha>
git branch --contains <fix-sha>
```

---

## 63. Latihan Praktis

## Latihan 1 — Trace Artifact to Commit

Ambil satu artifact service.

Jawab:

```text
Artifact version:
Image digest:
Git commit:
Git tag:
CI run:
Dependency set:
Deployment environment:
```

Jika tidak bisa dijawab, identifikasi gap.

## Latihan 2 — Review CI Checkout

Buka pipeline.

Jawab:

```text
Apakah PR job butuh full history?
Apakah release job fetch tags?
Apakah shallow clone mematahkan git describe?
```

## Latihan 3 — Release Tag Lab

Di repo lab:

```bash
git tag -a case-service-v0.1.0 -m "Release case-service v0.1.0"
git describe --tags --match 'case-service-v*'
```

Coba shallow clone dan lihat perbedaannya.

## Latihan 4 — Hotfix Simulation

Simulasikan:

```text
tag v1.0.0
main sudah lanjut
bug di prod
buat hotfix dari tag
tag v1.0.1
cherry-pick ke main
```

Catat commit graph.

## Latihan 5 — Deployment Evidence

Buat template evidence release:

```text
ticket
PR
commit
tag
artifact
digest
SBOM
approval
deployment commit
rollback plan
```

---

## 64. Pertanyaan Reflektif

1. Apakah artifact production bisa ditelusuri ke commit?
2. Apakah release dibuat dari clean tree?
3. Apakah release tag protected?
4. Apakah CI fetch strategy sesuai kebutuhan?
5. Apakah `latest` masih dipakai di production?
6. Apakah artifact immutable?
7. Apakah hotfix selalu forward-port ke main?
8. Apakah migration punya rollback/compatibility plan?
9. Apakah PR template menangkap risk/testing/rollback?
10. Apakah build metadata terlihat di runtime?
11. Apakah deployment config versioned?
12. Apakah approval terkait artifact spesifik?
13. Apakah dependency changes direview sebagai supply chain risk?
14. Apakah SBOM/provenance tersedia jika diminta audit?
15. Apakah rollback benar-benar pernah diuji?

---

## 65. Mental Model Akhir

CI/CD yang matang tidak hanya menjawab:

```text
Apakah test hijau?
```

Tetapi:

```text
Apakah artifact ini bisa dipercaya?
Apakah kita tahu source-nya?
Apakah perubahan direview?
Apakah dependencies diketahui?
Apakah deployment disetujui?
Apakah rollback aman?
Apakah audit bisa membuktikan semuanya?
```

Git adalah awal dari chain of custody.

Tetapi chain yang lengkap membutuhkan:

```text
protected refs
verified CI
immutable artifacts
traceable deployments
observable runtime metadata
documented approval
repeatable rollback/hotfix
```

Untuk Java engineer top-tier, Git bukan hanya tempat push code.

Git adalah fondasi release integrity.

---

## 66. Koneksi ke Part Berikutnya

Part ini adalah bagian terakhir sebelum capstone.

Part berikutnya:

```text
learn-git-mastery-for-java-engineers-part-032.md
```

Topik:

```text
Capstone: Mendesain Git Workflow untuk Java Engineering Team
```

Kita akan menggabungkan seluruh seri menjadi desain workflow nyata:

- branch model;
- PR policy;
- merge strategy;
- release strategy;
- hotfix flow;
- repository hygiene;
- security controls;
- CI/CD gates;
- monorepo/polyrepo decision;
- compliance evidence;
- team operating model.

---

## 67. Referensi

Rujukan utama untuk materi ini:

- Git official documentation: branch, tag, checkout, fetch, push, describe, verify-tag
- GitHub/GitLab/Jenkins CI/CD documentation concepts: protected branches, required checks, environments, releases, checkout strategies
- Maven/Gradle release, publishing, dependency locking, and artifact metadata practices
- OCI image metadata, container digest, registry immutability, and deployment traceability practices
- GitOps practices for environment repositories and deployment audit trail
- Supply chain security concepts: SBOM, provenance, artifact signing, SLSA, in-toto, Sigstore/cosign
- Praktik umum compliance evidence, change management, release governance, hotfix handling, and production incident forensic

---

## 68. Status Seri

```text
Progress: 031 / 032
Seri belum selesai.
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
```

Bagian berikutnya:

```text
learn-git-mastery-for-java-engineers-part-032.md
```

Topik:

```text
Capstone: Mendesain Git Workflow untuk Java Engineering Team
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-git-mastery-for-java-engineers-part-030.md">⬅️ Part 030 — Performance dan Maintenance Repository</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-git-mastery-for-java-engineers-part-032.md">Part 032 — Capstone: Mendesain Git Workflow untuk Java Engineering Team ➡️</a>
</div>

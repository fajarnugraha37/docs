# learn-git-mastery-for-java-engineers-part-032.md

# Part 032 — Capstone: Mendesain Git Workflow untuk Java Engineering Team

> **Seri:** Git Mastery for Java Engineers  
> **Bagian:** 032 / 032  
> **Topik:** Capstone desain workflow Git end-to-end untuk tim Java: branch strategy, PR policy, merge strategy, CI/CD, release, hotfix, security, repository hygiene, compliance, dan operating model  
> **Target pembaca:** Java software engineer, senior engineer, tech lead, engineering manager, platform engineer, release engineer, dan siapa pun yang ingin menerapkan Git secara matang di tim production  
> **Status seri:** **Selesai. Ini adalah bagian terakhir dari seri.**

---

## 0. Ringkasan Eksekutif

Setelah 31 bagian, kita sudah membahas Git dari banyak sudut:

- object model;
- working tree, index, repository;
- commit graph;
- branch;
- merge;
- rebase;
- conflict;
- remotes;
- pull request;
- release;
- hotfix;
- recovery;
- stash/worktree;
- bisect;
- blame/forensics;
- Java project hygiene;
- line endings;
- hooks;
- submodule/subtree;
- monorepo/polyrepo;
- large files;
- security;
- rewrite history;
- refs/refspec;
- performance;
- CI/CD;
- compliance.

Capstone ini menyatukan semuanya menjadi pertanyaan paling penting:

```text
Bagaimana mendesain workflow Git yang benar-benar bekerja untuk Java engineering team?
```

Jawabannya bukan satu template universal.

Workflow Git yang matang harus selaras dengan:

```text
architecture
team size
release cadence
risk profile
compliance needs
repository model
deployment model
CI/CD capability
ownership
incident response
```

Mental model utama:

```text
Git workflow bukan kumpulan command.
Git workflow adalah operating system untuk perubahan software.
```

Workflow yang baik membuat:

```text
perubahan kecil mudah,
perubahan besar terkendali,
review bermakna,
main tetap sehat,
release traceable,
hotfix cepat,
security terjaga,
dan audit evidence tersedia.
```

---

## 1. Tujuan Workflow Git

Workflow Git harus menjawab beberapa tujuan sekaligus.

## 1.1 Developer Productivity

Engineer harus bisa:

- membuat branch dengan cepat;
- commit atomic;
- sync dengan main;
- mengirim PR;
- mendapat feedback cepat;
- memperbaiki conflict;
- release tanpa ritual berlebihan;
- recover dari kesalahan.

## 1.2 Main Branch Health

Branch utama harus:

- buildable;
- testable;
- deployable;
- protected;
- tidak berisi secret;
- tidak berisi artifact/generated noise;
- tidak rusak karena commit sembarangan.

## 1.3 Review Quality

PR harus:

- kecil atau terstruktur;
- punya konteks;
- mudah direview;
- melewati CI;
- punya owner reviewer;
- menjelaskan risk/testing/rollback.

## 1.4 Release Traceability

Setiap release harus bisa ditelusuri:

```text
source commit -> tag -> artifact -> deployment -> runtime version
```

## 1.5 Security

Workflow harus mencegah:

- secret leakage;
- unreviewed build workflow changes;
- malicious dependency;
- mutable release tag;
- direct push ke main;
- artifact tidak jelas asalnya.

## 1.6 Compliance

Jika sistem regulated/enterprise:

- approval;
- audit trail;
- change ticket;
- test evidence;
- deployment evidence;
- segregation of duties;
- rollback plan.

Workflow Git harus mendukung semua itu.

---

## 2. Prinsip Desain Utama

## 2.1 Keep Main Healthy

Main branch adalah integration truth.

Jika main sering merah, semua melambat.

Policy:

```text
main harus selalu hijau atau cepat diperbaiki.
```

## 2.2 Prefer Small, Reversible Changes

Perubahan kecil:

- mudah direview;
- mudah dites;
- mudah revert;
- mudah bisect;
- mudah dipahami;
- mengurangi conflict.

## 2.3 Separate Mechanical from Semantic Changes

Pisahkan:

- formatting;
- generated code;
- dependency upgrade;
- business logic;
- migration;
- refactor;
- config.

Jika dicampur, review buruk.

## 2.4 Automate Cheap Checks Early

Gunakan hooks/CI untuk:

- whitespace;
- formatting;
- secret scan;
- build output guard;
- unit tests;
- static analysis.

## 2.5 CI Is the Authority

Local hooks membantu.

CI dan branch protection yang menentukan merge.

## 2.6 Release Artifacts Must Be Immutable

Jangan deploy dari “latest” yang mutable tanpa digest/version.

## 2.7 Public History Is Audit Trail

Jangan rewrite protected/shared history kecuali incident/migration terkontrol.

## 2.8 Security-Sensitive Paths Need Ownership

CI config, build files, deployment config, migration, wrapper, and secrets-adjacent config perlu CODEOWNERS.

---

## 3. Baseline Workflow Rekomendasi untuk Java Team

Untuk mayoritas tim Java backend/microservice dengan production CI/CD:

```text
Branch model:
  Trunk-based atau GitHub Flow dengan short-lived branches.

Main:
  Protected, always green, deployable.

Feature branches:
  Short-lived, PR-based, rebased or merged regularly.

PR:
  Required review + CI.

Merge strategy:
  Squash merge for small PRs, merge commit for structured multi-commit PRs if needed.
  Pilih satu policy utama agar konsisten.

Release:
  Build immutable artifact from protected commit/tag.
  Use annotated/signed tags for production releases if risk profile tinggi.

Hotfix:
  Branch from production tag/release branch.
  Patch release.
  Forward-port to main.

CI:
  Fast PR checks + stronger main/release checks.

Security:
  Secret scan + branch protection + CODEOWNERS + dependency review.

Repository hygiene:
  `.gitignore`, `.gitattributes`, `.editorconfig`, generated code policy.

Compliance:
  PR template + release evidence + artifact metadata + deployment traceability.
```

Ini baseline.

Detailnya disesuaikan.

---

## 4. Branch Strategy

## 4.1 Recommended Default: Short-Lived Feature Branches

Flow:

```text
main
  └── feature/CASE-123-add-escalation-guard
        commit
        commit
        PR
        CI
        review
        merge
```

Commands:

```bash
git switch main
git pull --ff-only
git switch -c feature/CASE-123-add-escalation-guard
```

Why:

- easy collaboration;
- PR review;
- CI gate;
- main protected;
- low overhead.

## 4.2 Branch Naming

Recommended:

```text
feature/CASE-123-short-description
fix/CASE-456-null-status
hotfix/CASE-999-prod-escalation
chore/CASE-321-upgrade-gradle
refactor/CASE-222-split-policy
```

Good branch name tells:

- type;
- ticket/context;
- short purpose.

Avoid:

```text
test
mybranch
new
fix
work
```

## 4.3 Branch Lifetime

Ideal:

```text
hours to a few days
```

Long-lived feature branches cause:

- conflict;
- stale design;
- delayed feedback;
- integration pain;
- large PR.

If feature is large:

```text
Use feature flags, branch by abstraction, stacked PRs, incremental merge.
```

---

## 5. Trunk-Based Development vs Git Flow

## 5.1 Trunk-Based / GitHub Flow

Best for:

- frequent deployment;
- strong CI;
- feature flags;
- small PRs;
- service teams;
- SaaS/backend systems.

Flow:

```text
main -> short branch -> PR -> main -> deploy
```

## 5.2 Git Flow

Branches:

```text
develop
feature/*
release/*
hotfix/*
main
```

Best rarely, maybe for:

- packaged software;
- long stabilization;
- multiple supported versions;
- infrequent release;
- complex release trains.

Risks:

- long-lived develop;
- delayed integration;
- painful merges;
- duplicated fixes.

## 5.3 Recommendation

For modern Java backend/service:

```text
Prefer trunk-based/GitHub Flow.
Use release branches only when support/stabilization requires.
```

Do not use Git Flow by default just because it is famous.

---

## 6. Commit Policy

## 6.1 Atomic Commits

A commit should represent one logical change.

Good:

```text
fix(case): reject enforcement while review pending
test(case): cover pending-review enforcement rejection
```

Bad:

```text
fix stuff
```

with:

- refactor;
- formatting;
- dependency upgrade;
- business logic;
- migration;
- generated code.

## 6.2 Commit Message

Recommended:

```text
type(scope): subject

body explaining why if needed
```

Examples:

```text
fix(case): preserve status reason during escalation

The previous mapper dropped statusReason when escalation happened from
manual review. This caused audit payload mismatch in downstream reports.

Refs: CASE-1842
```

## 6.3 When Squash Merge Is Used

If team squash-merges every PR, individual commit quality matters less on main, but still matters during review.

PR title/body become important.

---

## 7. Pull Request Policy

## 7.1 PR Should Explain Context

PR template:

```markdown
## Summary

## Why

## Testing

## Risk

## Migration / Rollback

## Security / Privacy

## Dependency Changes

## Screenshots / Evidence if relevant

## Ticket
```

For small PR, concise is fine.

For risky PR, detail matters.

## 7.2 PR Size

Prefer:

```text
< 300 lines changed when possible
```

Not a hard rule.

Generated code, migrations, and mechanical formatting distort size.

If PR is large, structure it:

- separate commits;
- sectioned description;
- reviewer guide;
- staged rollout.

## 7.3 PR Types

Different PR types need different review focus:

| Type | Reviewer Focus |
|---|---|
| Bug fix | root cause, regression test |
| Feature | behavior, API, test, rollout |
| Refactor | behavior preservation |
| Dependency upgrade | changelog, breaking changes, security |
| Migration | compatibility, rollback, data safety |
| Config | environment impact |
| Generated code | source spec consistency |
| Security fix | exposure, tests, disclosure |
| CI change | secret exposure, permissions |

---

## 8. Review Policy

## 8.1 Reviewer Responsibilities

Reviewer checks:

```text
Does this solve the right problem?
Is design appropriate?
Are tests meaningful?
Is rollback considered?
Are risks visible?
Are dependencies safe?
Are migrations safe?
Is code maintainable?
```

Reviewer is not just syntax checker.

## 8.2 Author Responsibilities

Author should:

- keep PR focused;
- explain why;
- self-review before requesting review;
- respond constructively;
- update tests/docs;
- avoid hiding risky changes.

## 8.3 CODEOWNERS

Sensitive paths:

```text
.github/workflows/ @dev-platform @security
.gitlab-ci.yml @dev-platform
pom.xml @backend-platform
build.gradle* @backend-platform
gradle/wrapper/ @dev-platform
.mvn/wrapper/ @dev-platform
db/migration/ @database-reviewers
helm/prod/ @platform-ops
k8s/prod/ @platform-ops
src/main/resources/application-prod.yml @platform-ops
```

Require CODEOWNERS review via branch protection.

---

## 9. Merge Strategy

Pick a default and document exceptions.

## 9.1 Squash Merge Default

Good for:

- PR as unit of change;
- clean main;
- easy revert;
- simple changelog.

Requirements:

- PR title/message high quality;
- preserve co-authors if needed;
- mention ticket.

## 9.2 Merge Commit Default

Good for:

- preserving branch structure;
- large feature branch with meaningful commits;
- complex integration.

Risk:

- noisy history if commits poor.

## 9.3 Rebase Merge

Good for:

- linear history;
- preserving commits.

Needs strong commit hygiene.

## 9.4 Recommendation

For many Java teams:

```text
Squash merge normal PRs.
Allow merge commit for special multi-commit integration if justified.
Disallow arbitrary messy merge commits.
```

---

## 10. Syncing Branches

Recommended:

```bash
git fetch origin
git rebase origin/main
```

for private feature branch.

Or merge main into branch if team prefers.

Avoid:

```bash
git pull
```

without understanding merge/rebase config.

Use:

```bash
git pull --ff-only
```

on main.

Config:

```bash
git config --global pull.ff only
```

or team-specific.

---

## 11. Conflict Policy

Conflicts are not just text.

When conflict happens:

```text
Understand both changes.
Resolve semantic intent.
Run tests.
Do not blindly accept ours/theirs.
```

For Java conflict-prone files:

- `pom.xml`;
- `build.gradle`;
- migration files;
- OpenAPI specs;
- generated code;
- config YAML;
- import-heavy classes.

Use:

```bash
git diff --ours
git diff --theirs
git diff --base
```

If rebase:

```text
ours/theirs terminology can feel inverted.
```

Know your operation.

---

## 12. CI/CD Gate Design

## 12.1 PR Checks

Recommended:

```text
compile
unit tests
format/lint
static analysis
secret scan
dependency diff/review
migration naming check
OpenAPI/protobuf compatibility if relevant
```

## 12.2 Main Checks

Recommended:

```text
full test suite
integration tests
contract tests
container build
image scan
publish snapshot/internal artifact if needed
```

## 12.3 Release Checks

Recommended:

```text
checkout tag
verify clean tree
full build
full tests
generate SBOM
sign/attest artifact if required
publish immutable artifact
create release notes
```

## 12.4 Nightly/Periodic

```text
full security scan
full dependency vulnerability scan
full history secret scan
performance regression
large repo audit
```

---

## 13. Repository Hygiene Baseline

Every Java repo should have:

```text
.gitignore
.gitattributes
.editorconfig
README.md
CONTRIBUTING.md
CODEOWNERS if platform supports
```

## 13.1 `.gitignore`

Must cover:

```text
target/
build/
.gradle/
*.class
*.log
*.hprof
.env
.env.*
```

With wrapper jar exceptions if needed.

## 13.2 `.gitattributes`

Must define:

```text
LF for source/scripts
CRLF for Windows scripts if needed
binary for jars/images
LFS if used
```

## 13.3 `.editorconfig`

Must define:

```text
UTF-8
LF
indentation
final newline
trailing whitespace
```

---

## 14. Generated Code Policy

Document:

```text
Which generated files are tracked?
Which are ignored?
How to regenerate?
Which generator version?
Can generated files be manually edited?
Does CI verify generated drift?
```

Recommended:

```text
Track source specs/contracts.
Generate output during build unless strong reason to track.
```

If tracked:

- separate generated commit;
- CI verify regeneration;
- mark generated files if review tooling supports.

---

## 15. Dependency Policy

For Java:

```text
[ ] No dynamic versions in release.
[ ] No SNAPSHOT in production release.
[ ] Dependency changes reviewed.
[ ] Build plugins reviewed.
[ ] Repositories restricted.
[ ] Lockfiles/BOM/version catalog used where appropriate.
[ ] Internal libraries published as artifacts.
[ ] No committed dependency jars except wrappers.
```

Dependency update PR should include:

- old/new version;
- changelog;
- risk;
- tests;
- migration notes if major.

---

## 16. Large File Policy

Baseline:

```text
No build artifacts.
No production dumps.
No heap dumps.
No large binary without approval.
Use artifact repo for jars.
Use container registry for images.
Use object storage/model registry for large data/model.
Use Git LFS only when justified.
```

CI/hook guard:

```text
block files > threshold unless allowlisted
block jar/war/ear except wrapper
```

---

## 17. Security Policy

Minimum:

```text
[ ] Secret scanning.
[ ] `.env` ignored, `.env.example` tracked.
[ ] Branch protection.
[ ] Required CI.
[ ] CODEOWNERS for sensitive paths.
[ ] Least privilege CI tokens.
[ ] Protected release tags.
[ ] No direct prod secrets in PR jobs.
[ ] Incident playbook for leaked secret.
```

Higher assurance:

```text
[ ] Signed release tags.
[ ] Signed commits on protected branches.
[ ] Artifact/image signing.
[ ] SBOM.
[ ] Provenance attestation.
[ ] Dependency verification.
```

---

## 18. Release Strategy

## 18.1 Service Release

For deployable Java service:

```text
main commit -> build artifact/container -> deploy
```

Version:

```text
service version + commit SHA + image digest
```

Tag:

```text
case-service-v1.8.3
```

Artifact:

```text
registry/acme/case-service@sha256:...
```

## 18.2 Library Release

For Java library:

```text
versioned Maven/Gradle artifact
SemVer or calendar version
sources/javadoc if needed
changelog
compatibility policy
```

## 18.3 Release Branch

Use only if:

- multiple supported versions;
- stabilization window;
- long-lived enterprise support;
- patch releases needed.

---

## 19. Hotfix Strategy

Hotfix checklist:

```text
[ ] Identify production artifact/tag.
[ ] Branch from release tag/branch.
[ ] Minimal fix.
[ ] Regression test.
[ ] CI full enough.
[ ] Patch version tag.
[ ] Deploy immutable artifact.
[ ] Forward-port to main.
[ ] Update incident/release notes.
```

Command concept:

```bash
git switch -c hotfix/CASE-999 case-service-v1.8.3
# fix
git commit -m "fix(case): prevent null escalation reason"
git tag -s case-service-v1.8.4 -m "Release case-service v1.8.4"
```

Forward-port:

```bash
git switch main
git cherry-pick -x <hotfix-sha>
```

---

## 20. Rollback / Roll Forward Policy

Define before incident.

Questions:

```text
Can previous artifact run with current DB schema?
Are migrations reversible?
Is feature flag available?
Can config revert solve it?
Is roll forward safer?
```

Preferred for services:

```text
Promote/deploy previous immutable artifact if compatible.
```

GitOps:

```bash
git revert <env-config-commit>
```

But DB/state compatibility decides reality.

---

## 21. Database Migration Policy

For Flyway/Liquibase:

```text
[ ] Migration tracked.
[ ] Released migration immutable.
[ ] Naming convention prevents conflict.
[ ] CI validates migration.
[ ] Backward compatibility considered.
[ ] Expand/contract for zero downtime.
[ ] Destructive changes require plan.
```

Do not edit released migrations casually.

Use new migration.

---

## 22. Monorepo vs Polyrepo Decision in Workflow

## 22.1 Monorepo Workflow Needs

```text
affected build/test
CODEOWNERS per path
component tags
sparse checkout if large
build graph governance
dependency boundary enforcement
```

## 22.2 Polyrepo Workflow Needs

```text
artifact versioning
dependency update automation
contract tests
cross-repo release traceability
platform build conventions
consistent branch protection
```

## 22.3 Hybrid

Often best:

```text
domain monorepo + platform libraries as artifacts + environment repo
```

Pick intentionally.

---

## 23. Compliance Operating Model

For regulated teams:

```text
PR = change evidence
CI = verification evidence
Tag = source release anchor
Artifact = immutable deployable
Deployment record = environment evidence
Ticket = business approval
```

Minimum evidence chain:

```text
Ticket -> PR -> commit -> CI -> tag -> artifact -> deploy -> runtime metadata
```

Use templates and automation to avoid manual audit scramble.

---

## 24. Incident Forensic Workflow

When production issue occurs:

1. Identify running version.
2. Map to artifact digest.
3. Map to Git commit/tag.
4. Compare with previous good release.
5. Check dependency changes.
6. Check migration/config changes.
7. Use logs/metrics/traces.
8. Bisect if needed.
9. Patch/revert/rollback.
10. Add regression test.
11. Document postmortem.

Git commands:

```bash
git log previous-tag..current-tag --oneline
git diff previous-tag..current-tag --stat
git show current-tag
git branch --contains <fix-sha>
git tag --contains <fix-sha>
```

---

## 25. Team Roles

## 25.1 Author

Owns clarity and correctness of change.

## 25.2 Reviewer

Owns review quality, not just approval speed.

## 25.3 Maintainer

Owns repository health, branch protection, CI baseline.

## 25.4 Release Owner

Owns release evidence, tag/artifact/deployment coordination.

## 25.5 Platform Engineer

Owns shared tooling, CI templates, artifact systems, security controls.

## 25.6 Security/Compliance Reviewer

Owns risk-sensitive paths and controls.

Good workflow clarifies these roles.

---

## 26. Operating Agreements

Document in `CONTRIBUTING.md`:

```text
Branch naming.
Commit message convention.
PR expectations.
Review SLA/expectations.
Merge strategy.
CI requirements.
Release process.
Hotfix process.
Generated code policy.
Dependency policy.
Secret policy.
Large file policy.
Migration policy.
```

A workflow not written down becomes folklore.

Folklore fails under pressure.

---

## 27. Example `CONTRIBUTING.md` Outline

```markdown
# Contributing

## Branching
Use short-lived branches from `main`.

## Commit Messages
Use `type(scope): subject`.

## Pull Requests
Keep PRs focused. Include testing, risk, rollback.

## Review
At least one approval. CODEOWNERS required for sensitive paths.

## CI
All required checks must pass before merge.

## Merge
Squash merge by default.

## Release
Releases are built from protected tags.

## Hotfix
Branch from production tag, patch, tag, deploy, forward-port.

## Secrets
Never commit secrets. Use `.env.example` for local config.

## Generated Code
Do not edit generated code manually.

## Database Migrations
Released migrations are immutable.
```

---

## 28. Example CODEOWNERS

```text
# Build and CI
.github/workflows/ @acme/dev-platform @acme/security
.gitlab-ci.yml @acme/dev-platform
Jenkinsfile @acme/dev-platform

# Build files
pom.xml @acme/backend-platform
**/pom.xml @acme/backend-platform
build.gradle* @acme/backend-platform
settings.gradle* @acme/backend-platform
gradle/wrapper/ @acme/dev-platform
.mvn/wrapper/ @acme/dev-platform

# Database
**/db/migration/ @acme/database-reviewers

# Deployment
helm/ @acme/platform-ops
k8s/ @acme/platform-ops
environments/prod/ @acme/platform-ops @acme/release-managers

# Security-sensitive config
**/application-prod.yml @acme/platform-ops @acme/security
```

Adjust for org.

---

## 29. Example Branch Protection Policy

For `main`:

```text
[ ] Require pull request before merging.
[ ] Require at least 1-2 approvals.
[ ] Require CODEOWNERS review.
[ ] Require status checks:
    - build
    - unit test
    - integration test where appropriate
    - format/lint
    - secret scan
    - dependency scan
[ ] Require branch up to date or merge queue.
[ ] Disallow force push.
[ ] Disallow deletion.
[ ] Restrict admin bypass.
```

For release branches:

```text
[ ] Restrict who can push/merge.
[ ] Require hotfix review.
[ ] Require release checks.
```

For tags:

```text
[ ] Protect release tag patterns.
[ ] Restrict creation.
[ ] Disallow deletion/updates.
[ ] Require signed tags if policy.
```

---

## 30. Example CI Pipeline for Java Service

```text
PR:
  checkout
  setup JDK
  restore dependency cache
  ./mvnw -q verify or ./gradlew check
  format/lint
  secret scan
  dependency review
  migration validation

main:
  full test
  integration test
  contract test
  build container
  scan image
  publish internal snapshot if needed

release tag:
  checkout tag with full history/tags
  verify clean tree
  build artifact
  generate SBOM
  sign/attest
  publish immutable artifact
  create release notes
```

---

## 31. Example Release Workflow

```text
1. Merge PRs to main.
2. CI green on main.
3. Create release PR if version file needs bump.
4. Merge release PR.
5. Create protected signed tag.
6. Release CI builds from tag.
7. Publish artifact/container.
8. Generate SBOM/provenance.
9. Deploy to dev/staging.
10. Approve prod deployment.
11. Promote same artifact to prod.
12. Record evidence.
```

Do not rebuild per environment.

---

## 32. Example Hotfix Workflow

```text
Production running: case-service-v1.8.3

1. git switch -c hotfix/CASE-999 case-service-v1.8.3
2. Apply minimal fix.
3. Add regression test.
4. Open PR to release/1.8 or hotfix branch.
5. CI passes.
6. Tag case-service-v1.8.4.
7. Build and deploy artifact.
8. Cherry-pick -x fix to main.
9. Close incident with evidence.
```

---

## 33. Example Repository Policy File

Create:

```text
docs/git-workflow.md
```

Sections:

```markdown
# Git Workflow

## Goals
## Branch Model
## Commit Policy
## PR Policy
## Merge Strategy
## CI/CD Gates
## Release Process
## Hotfix Process
## Security Controls
## Repository Hygiene
## Generated Code
## Dependency Updates
## Database Migrations
## Large Files
## Incident Recovery
## Compliance Evidence
```

This document becomes team operating manual.

---

## 34. Workflow Maturity Levels

## Level 1 — Basic

```text
Git used for commits.
Manual release.
Weak CI.
No branch protection.
```

Risk high.

## Level 2 — Team Workflow

```text
PRs.
CI required.
Main protected.
Basic release tags.
```

Good baseline.

## Level 3 — Production Workflow

```text
Artifact provenance.
Immutable artifacts.
Hotfix process.
Secret scanning.
CODEOWNERS.
Dependency policy.
```

Strong.

## Level 4 — Enterprise/Regulated

```text
Signed tags.
SBOM/provenance.
Deployment approval.
Compliance evidence chain.
Protected environments.
Audit-ready release records.
```

High assurance.

Aim for the level your system risk requires.

Do not over-engineer toy repos.

Do not under-engineer production-critical systems.

---

## 35. Common Failure Modes

## 35.1 Main Red Often

Cause:

- weak required checks;
- no merge queue;
- poor test reliability;
- large PRs;
- integration not tested.

Fix:

- strengthen CI;
- smaller PR;
- merge queue;
- flaky test ownership.

## 35.2 PRs Too Large

Cause:

- long-lived branches;
- no incremental delivery;
- no feature flags.

Fix:

- split changes;
- stacked PR;
- branch by abstraction;
- feature flags.

## 35.3 Hotfix Lost

Cause:

- hotfix applied to release branch but not main.

Fix:

- forward-port checklist;
- cherry-pick `-x`;
- release dashboard.

## 35.4 Release Not Traceable

Cause:

- artifact lacks Git SHA;
- tag missing;
- deployment uses latest.

Fix:

- build metadata;
- immutable tags/artifacts;
- digest deploy.

## 35.5 Secret Leak

Cause:

- no `.gitignore`;
- no scanner;
- local config committed.

Fix:

- rotate;
- cleanup;
- scanning;
- secret manager.

## 35.6 Dependency Chaos

Cause:

- dynamic versions;
- SNAPSHOT release;
- no BOM/lockfile;
- no review.

Fix:

- pin versions;
- dependency policy;
- bots;
- scanning.

---

## 36. Decision Framework: Pick Your Workflow

Answer:

```text
1. How often do you deploy?
2. How risky are releases?
3. How large is the team?
4. Do you need regulated evidence?
5. Are services independent?
6. Are DB migrations risky?
7. Is main deployable?
8. How good is CI?
9. Do you need long-lived release branches?
10. Are hotfixes common?
```

Then choose:

## High deploy frequency, strong CI

```text
Trunk-based, short-lived branches, feature flags, protected main, release from main/tag.
```

## Enterprise with release stabilization

```text
Protected main + release branches + patch tags + strict approval.
```

## Library team

```text
SemVer, signed tags, changelog, artifact publishing, compatibility tests.
```

## Monorepo platform

```text
Path ownership, affected CI, component tags, sparse checkout, strong governance.
```

---

## 37. Capstone Design: Recommended Java Service Workflow

Here is a complete default design.

## 37.1 Repository

```text
case-service/
  .github/workflows/
  .gitignore
  .gitattributes
  .editorconfig
  CODEOWNERS
  CONTRIBUTING.md
  README.md
  pom.xml or build.gradle.kts
  src/
  docs/
  scripts/
```

## 37.2 Branches

```text
main
feature/CASE-123-...
fix/CASE-456-...
hotfix/CASE-999-...
release/1.8 if needed
```

## 37.3 Main Protection

```text
PR required
1-2 approvals
CODEOWNERS
required CI
no force push
no deletion
```

## 37.4 PR Checks

```text
compile
unit test
format
secret scan
dependency review
migration check
```

## 37.5 Merge

```text
Squash merge by default.
PR title becomes commit message.
```

## 37.6 Release

```text
Tag: case-service-vX.Y.Z
Build from tag
Publish container by digest
Generate SBOM
Promote same artifact
```

## 37.7 Hotfix

```text
branch from prod tag
fix
tag patch version
deploy
cherry-pick -x to main
```

## 37.8 Security

```text
no secrets
secret scanning
CODEOWNERS sensitive paths
protected tags
least privilege CI
dependency pinning
```

---

## 38. Capstone Design: Recommended Java Library Workflow

For `workflow-core` library:

```text
main protected
SemVer
release tags workflow-core-vX.Y.Z
publish Maven artifact
source/javadoc jar
compatibility tests
changelog
no breaking change without major version
dependency locking/verification
signed tags if required
```

PR review emphasizes:

- public API compatibility;
- transitive dependency impact;
- binary/source compatibility;
- migration guide;
- deprecation.

Release:

```text
tag -> CI build -> publish immutable artifact -> consumers update via dependency PR
```

---

## 39. Capstone Design: Regulated Java System

For regulated case-management style system:

```text
protected main
CODEOWNERS
PR template with risk/testing/rollback
ticket required
required review
required CI/security scans
signed release tags
immutable artifacts
SBOM
deployment approval
environment config repo
runtime build metadata
hotfix playbook
audit evidence retention
```

Additional controls:

- migration review board;
- production deployment approval;
- release notes curated;
- segregation of duties;
- secret scanning full history periodic;
- dependency vulnerability exception process.

---

## 40. Capstone Design: Monorepo Java Platform

Repository:

```text
platform/
  services/
  libs/
  contracts/
  build-logic/
  deploy/
```

Workflow:

```text
short-lived branches
path CODEOWNERS
affected CI
component tags
sparse checkout docs
dependency graph enforcement
shared build conventions
module boundary tests
large file guard
release per component
```

CI:

```text
changed path + dependency graph -> affected modules
full nightly
release component from tag
```

Tags:

```text
case-service-v1.8.3
workflow-core-v2.4.1
platform-v2026.06.0 if release train
```

---

## 41. Capstone Design: Polyrepo Java Microservices

Each repo:

```text
same branch protection baseline
same CI template
same secret/dependency policy
same release metadata
```

Shared platform:

- Maven BOM;
- Gradle convention plugin;
- reusable CI workflow;
- dependency bots;
- artifact repository;
- contract tests.

Cross-repo traceability:

```text
release manifest
deployment config repo
artifact versions
image digests
ticket IDs
```

Avoid every repo inventing workflow independently.

---

## 42. Implementation Roadmap

Do not implement everything at once.

## Phase 1 — Stabilize

```text
branch protection
required CI
.gitignore
.gitattributes
.editorconfig
secret scanning
PR template
```

## Phase 2 — Improve Review and Release

```text
CODEOWNERS
merge strategy
release tags
artifact metadata
hotfix process
dependency policy
```

## Phase 3 — Strengthen Security and Compliance

```text
protected tags
signed tags
SBOM
artifact signing/provenance
deployment approvals
evidence chain
```

## Phase 4 — Optimize Scale

```text
affected CI
sparse checkout
partial clone
repository maintenance
large file audit
monorepo/polyrepo governance
```

Incremental rollout wins.

---

## 43. Metrics to Track

Workflow health metrics:

```text
main branch failure rate
PR cycle time
PR size
CI duration
flaky test rate
rollback frequency
hotfix frequency
change failure rate
deployment frequency
mean time to restore
repo clone time
repo size
secret leak count
dependency vulnerability age
```

Do not optimize only for speed.

Optimize for:

```text
speed + safety + traceability + developer experience
```

---

## 44. Git Skills Mastery Checklist

By the end of this series, you should be able to:

```text
[ ] Explain Git object model.
[ ] Use index/staging deliberately.
[ ] Read commit graph.
[ ] Choose merge/rebase correctly.
[ ] Resolve conflicts semantically.
[ ] Recover lost commits with reflog.
[ ] Use bisect for regressions.
[ ] Use blame/pickaxe for archaeology.
[ ] Maintain Java repo hygiene.
[ ] Design .gitignore/.gitattributes.
[ ] Use hooks appropriately.
[ ] Evaluate submodule/subtree/artifact dependency.
[ ] Decide monorepo vs polyrepo.
[ ] Prevent large file bloat.
[ ] Respond to secret leakage.
[ ] Understand refs/refspec.
[ ] Maintain repo performance.
[ ] Connect Git to CI/CD/release/compliance.
[ ] Design team workflow.
```

This is the difference between “knows Git commands” and “uses Git as engineering infrastructure”.

---

## 45. Final Practical Exercise

Design Git workflow for a fictional team:

```text
Team:
  12 Java engineers
  3 Spring Boot services
  2 shared libraries
  PostgreSQL with Flyway
  GitHub Actions
  Docker/Kubernetes
  Staging + production
  Monthly compliance audit
  Hotfixes 1-2 times per quarter
```

Deliver:

```text
1. Repo architecture.
2. Branch strategy.
3. PR policy.
4. Merge strategy.
5. CI pipeline.
6. Release process.
7. Hotfix process.
8. Migration policy.
9. Secret policy.
10. Artifact/deployment traceability.
11. CODEOWNERS.
12. Rollback plan.
```

Then ask:

```text
What failure modes remain?
What controls are too heavy?
What controls are missing?
```

That exercise is how you internalize the series.

---

## 46. Final Mental Model

Git mastery is not memorizing commands.

Git mastery is understanding change.

At top level:

```text
Working tree = current files.
Index = proposed snapshot.
Commit = immutable snapshot with history.
Branch = movable name for commit.
Merge = combine histories.
Rebase = replay history.
Remote = another repository.
Ref = name pointing to object.
Tag = named release anchor.
CI = verification of Git state.
Artifact = built output from Git state.
Deployment = runtime selection of artifact.
Audit = evidence chain across all of it.
```

A top 1% engineer uses Git to make software evolution:

```text
intentional
reviewable
recoverable
traceable
secure
performant
automated
auditable
```

That is the real goal.

---

## 47. Seri Selesai

Ini adalah bagian terakhir:

```text
learn-git-mastery-for-java-engineers-part-032.md
```

Seluruh seri:

```text
000 — Daftar Isi Series / orientation
001 — Git sebagai Model Evolusi Software
002 — Repository, Working Tree, Index, dan Object Database
003 — Commit Graph: Parent, Branch, HEAD, dan Reachability
004 — Lifecycle Perubahan: Dari Edit File sampai Commit Berkualitas
005 — Membaca History secara Efektif
006 — Diff Mental Model: Membandingkan State, Bukan Sekadar File
007 — Branching: Isolasi Perubahan dan Eksperimen Aman
008 — Merge: Menggabungkan Sejarah Tanpa Kehilangan Konteks
009 — Rebase: Memindahkan Perubahan dengan Aman
010 — Interactive Rebase: Sculpting History
011 — Conflict Resolution: Dari Mekanik ke Strategi
012 — Remote Repository: Clone, Fetch, Pull, Push
013 — Pull Request / Merge Request sebagai Engineering Control Point
014 — Git Workflow untuk Tim: Trunk-Based, Git Flow, GitHub Flow
015 — Release, Tagging, Versioning, dan Hotfix
016 — Cherry-Pick, Revert, Reset: Memilih Operasi Koreksi yang Tepat
017 — Recovery: Reflog, Lost Commit, dan Disaster Handling
018 — Stash, Worktree, dan Context Switching
019 — Bisect: Debugging Regresi dengan Git
020 — Blame, Pickaxe, dan Forensic Code Archaeology
021 — Git untuk Java Projects: Maven, Gradle, IDE, dan Generated Files
022 — Line Endings, Whitespace, Encoding, dan Cross-Platform Issues
023 — Git Hooks: Automasi Lokal dan Guardrails
024 — Submodules, Subtree, dan Multi-Repository Dependency
025 — Monorepo, Polyrepo, dan Repository Architecture
026 — Large Files, Binary Assets, Git LFS, dan Repository Bloat
027 — Security: Secret Leakage, Signed Commits, dan Supply Chain
028 — Rewrite History Lanjutan: Filter-Repo, BFG, dan Migration
029 — Advanced Ref Management: Refspec, Notes, Namespaces, dan Internals
030 — Performance dan Maintenance Repository
031 — Git dalam CI/CD, Release Automation, dan Compliance
032 — Capstone: Mendesain Git Workflow untuk Java Engineering Team
```

Status:

```text
Progress: 032 / 032
Seri selesai.
```

---

## 48. Referensi Akhir

Rujukan utama keseluruhan seri:

- Git official documentation: core concepts, branching, merging, rebasing, remotes, hooks, attributes, refs, internals, maintenance
- Pro Git Book: Git basics, branching, tools, internals, distributed workflows
- Maven and Gradle documentation: build lifecycle, wrapper, dependency management, publishing, multi-module/multi-project builds
- GitHub/GitLab/Bitbucket documentation: pull requests, branch protection, CODEOWNERS, CI/CD, signed commits/tags, secret scanning
- OWASP and supply chain practices: secret management, dependency review, SBOM, provenance, artifact signing
- Praktik engineering production: trunk-based development, release governance, GitOps, CI/CD traceability, incident response, monorepo/polyrepo architecture, and compliance evidence

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-git-mastery-for-java-engineers-part-031.md](./learn-git-mastery-for-java-engineers-part-031.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Part 0 — Build Engineering Mental Model: Dari Source Code ke Artifact yang Bisa Dipercaya](../../java/.base/build_tools/00-build-engineering-mental-model.md)

</div>
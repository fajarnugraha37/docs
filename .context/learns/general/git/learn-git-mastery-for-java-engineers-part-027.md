# learn-git-mastery-for-java-engineers-part-027.md

# Part 027 — Security: Secret Leakage, Signed Commits, dan Supply Chain

> **Seri:** Git Mastery for Java Engineers  
> **Bagian:** 027 / 032  
> **Topik:** Keamanan Git: secret leakage, history exposure, signed commits/tags, provenance, dependency trust, dan supply chain security untuk Java delivery  
> **Target pembaca:** Java software engineer, tech lead, maintainer, release engineer, dan engineer yang bekerja di sistem production, regulated, atau enterprise  
> **Status seri:** Belum selesai. Bagian terakhir adalah `learn-git-mastery-for-java-engineers-part-032.md`.

---

## 0. Ringkasan Eksekutif

Git adalah bagian dari supply chain software.

Banyak engineer menganggap Git hanya sebagai version control.

Engineer top-level melihat Git sebagai:

```text
source of truth
audit trail
collaboration boundary
release evidence
trust anchor
supply chain input
security risk surface
```

Jika repository mengandung secret, artifact palsu, commit tidak terpercaya, dependency tidak jelas, atau release tag bisa dipindah sembarangan, maka pipeline delivery tidak bisa dipercaya.

Masalah keamanan umum di Git:

- `.env` berisi password ter-commit;
- private key masuk history;
- token API masuk test resource;
- production dump masuk repo;
- secret dihapus di commit berikutnya tetapi masih ada di history;
- commit author bisa dipalsukan;
- release tag lightweight/tidak signed;
- force push rewrite history tanpa kontrol;
- dependency jar dicommit tanpa provenance;
- generated artifact tidak traceable;
- CI secret terekspos di log;
- branch protection lemah;
- dependency update tidak direview;
- build artifact tidak bisa ditelusuri ke commit;
- GitHub Actions workflow dimodifikasi untuk mencuri secret;
- submodule menunjuk commit tidak terverifikasi;
- release dibuat dari dirty working tree.

Mental model utama:

```text
Security Git bukan hanya “jangan commit password”.
Security Git adalah menjaga integritas, kerahasiaan, dan provenance dari source sampai artifact.
```

---

## 1. Threat Model Git

Sebelum membahas command, pikirkan ancaman.

Pertanyaan:

```text
Apa yang bisa salah jika repository tidak aman?
```

## 1.1 Confidentiality Risk

Data rahasia masuk Git:

- password database;
- API key;
- OAuth client secret;
- private key;
- service account JSON;
- JWT signing key;
- encryption key;
- production dump;
- customer data;
- internal endpoint;
- incident logs.

Dampak:

- unauthorized access;
- data breach;
- regulatory violation;
- credential rotation emergency;
- trust loss;
- incident response cost.

## 1.2 Integrity Risk

Source/release tidak bisa dipercaya:

- commit author dipalsukan;
- tag release dipindah;
- branch history di-rewrite;
- dependency jar tidak jelas asalnya;
- malicious workflow change;
- build script disusupi;
- submodule update ke commit berbahaya;
- artifact tidak dibangun dari source yang diklaim.

Dampak:

- supply chain compromise;
- malicious code masuk production;
- audit trail rusak;
- rollback sulit;
- root cause analysis gagal.

## 1.3 Availability/Productivity Risk

Repo rusak atau berat:

- huge secret cleanup rewrite;
- force push merusak clone banyak orang;
- LFS quota habis;
- CI gagal karena credential revoked;
- build tidak reproducible.

Security Git berkaitan dengan semua aspek ini.

---

## 2. `.gitignore` Bukan Security Boundary

`.gitignore` hanya mencegah untracked file muncul di status atau masuk staging secara tidak sengaja.

Contoh:

```gitignore
.env
*.pem
```

Ini membantu.

Tetapi:

```text
.gitignore tidak melindungi file yang sudah pernah di-commit.
.gitignore tidak menghapus history.
.gitignore tidak rotate secret.
.gitignore tidak mencegah copy-paste secret ke file lain.
.gitignore tidak mencegah `git add -f`.
```

Jika file secret sudah tracked:

```bash
git rm --cached .env
echo ".env" >> .gitignore
git commit -m "Stop tracking local environment file"
```

Ini hanya menghentikan tracking ke depan.

History lama masih mengandung secret.

Kesimpulan:

```text
.gitignore adalah hygiene tool, bukan security control final.
```

---

## 3. Kenapa Delete Secret Tidak Cukup

Misalkan:

```bash
echo "DB_PASSWORD=prod-password" > .env
git add .env
git commit -m "Add env file"

git rm .env
git commit -m "Remove env file"
```

File tidak ada di `HEAD`.

Tetapi commit pertama masih ada.

Siapa pun yang punya repo bisa:

```bash
git log -- .env
git show <old-commit>:.env
```

Secret tetap bocor.

Bahkan jika history di-rewrite:

- orang yang sudah clone punya copy;
- forks bisa punya copy;
- CI logs/caches bisa punya copy;
- hosting backup bisa punya copy;
- PR refs bisa punya copy.

Rule:

```text
Jika secret pernah masuk Git, anggap secret bocor.
Rotate secret.
```

History cleanup hanya mengurangi exposure lanjutan.

---

## 4. Secret Leakage Response Playbook

Jika secret masuk Git:

## 4.1 Jangan Panik, Tetapi Bertindak Cepat

Langkah pertama:

```text
Stop using the secret.
```

## 4.2 Identifikasi Secret

```text
Jenis secret?
Scope akses?
Environment?
Privilege?
Sejak kapan bocor?
Siapa yang punya akses repo?
Apakah repo public/private?
Apakah secret muncul di fork/CI log?
```

## 4.3 Rotate/Revoke

Ini paling penting.

- revoke API key;
- rotate database password;
- rotate service account key;
- rotate JWT signing key dengan migration plan;
- rotate SSH deploy key;
- rotate OAuth secret;
- rotate cloud credentials.

## 4.4 Hapus dari Current Tree

```bash
git rm --cached .env
echo ".env" >> .gitignore
git commit -m "Remove committed environment secret"
```

## 4.5 Rewrite History Jika Diperlukan

Gunakan:

- `git filter-repo`;
- BFG Repo-Cleaner.

Ini dibahas detail Part 028.

## 4.6 Force Push dan Koordinasi

Jika history rewrite:

```text
Announce freeze.
Backup.
Rewrite.
Force push.
Tell developers to re-clone/reset.
Purge caches if possible.
```

## 4.7 Incident Documentation

Catat:

```text
Secret type:
Exposure window:
Repos/branches/tags affected:
Rotation completed:
History cleanup status:
Follow-up controls:
```

## 4.8 Add Preventive Controls

- `.gitignore`;
- secret scanning;
- pre-commit hook;
- CI secret scan;
- platform push protection;
- least privilege secrets;
- short-lived credentials.

---

## 5. Secret Types yang Sering Bocor

## 5.1 `.env`

```dotenv
DATABASE_PASSWORD=...
AWS_SECRET_ACCESS_KEY=...
JWT_SECRET=...
```

Ignore:

```gitignore
.env
.env.*
!.env.example
```

Track safe example:

```text
.env.example
```

with fake values.

## 5.2 Private Keys

```text
*.pem
*.key
id_rsa
service-account.json
```

Be careful.

Test keys may be allowed only if explicitly test-only and documented.

## 5.3 Cloud Credentials

AWS:

```text
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
```

GCP:

```text
service-account.json
private_key
client_email
```

Azure:

```text
client_secret
tenant_id
subscription_id
```

Cloud credentials can have broad blast radius.

## 5.4 Database URLs

```text
jdbc:postgresql://prod:5432/db?user=...&password=...
```

## 5.5 Tokens in Config

- GitHub token;
- Slack webhook;
- Stripe key;
- SendGrid key;
- OAuth secret;
- internal API token.

## 5.6 Secrets in Tests

Common mistake:

```java
private static final String TOKEN = "real-token";
```

Use fake values.

---

## 6. Secret in Git History: Finding It

Search current tree:

```bash
git grep -n -i -E 'password|secret|api[_-]?key|private_key|token'
```

Search all history:

```bash
git grep -n -i -E 'password|secret|api[_-]?key|private_key|token' $(git rev-list --all)
```

This can be slow and noisy.

Search specific path:

```bash
git log -p -- .env
```

Use secret scanners:

- gitleaks;
- trufflehog;
- detect-secrets;
- git-secrets;
- platform secret scanning.

Example with gitleaks conceptually:

```bash
gitleaks detect --source .
```

Secret scanners reduce risk but are not perfect.

---

## 7. Secret Scanning Layers

Layered defense:

```text
1. Developer education.
2. `.gitignore` for known local files.
3. Pre-commit scanner.
4. Pre-push scanner.
5. CI scanner.
6. Platform push protection.
7. Periodic full-history scans.
8. Secret manager + short-lived credentials.
9. Least privilege.
10. Incident response.
```

No single layer is enough.

Pre-commit catches before commit.

CI catches before merge.

Platform catches before push/merge if enabled.

Periodic scan catches old leaks.

Short-lived credentials reduce blast radius.

---

## 8. Pre-Commit Secret Scan

Example simple guard:

```bash
#!/usr/bin/env bash
set -euo pipefail

FILES=$(git diff --cached --name-only --diff-filter=ACM || true)

[ -z "$FILES" ] && exit 0

PATTERN='(BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY|AWS_SECRET_ACCESS_KEY|password\s*=|api[_-]?key\s*=|client_secret\s*=)'

if echo "$FILES" | xargs grep -n -i -E "$PATTERN" 2>/dev/null; then
  echo "Potential secret detected in staged files."
  exit 1
fi
```

This is not enough, but useful.

Better: use proven tool.

Important:

```text
Allowlist false positives carefully.
Do not train people to bypass secret warnings casually.
```

---

## 9. Secret Manager Instead of Git

Secrets belong in secret management systems:

- AWS Secrets Manager;
- AWS SSM Parameter Store;
- GCP Secret Manager;
- Azure Key Vault;
- HashiCorp Vault;
- Kubernetes Secrets with encryption/External Secrets;
- Doppler/1Password/other approved tools;
- CI secret store.

Git should contain references/placeholders:

```yaml
database:
  password: ${DATABASE_PASSWORD}
```

Not values.

For local dev:

```text
.env.example tracked
.env ignored
```

For CI:

```text
Secrets injected by platform
```

For Kubernetes:

```text
Use external secret integration or sealed/encrypted secrets if policy allows.
```

Plain base64 Kubernetes Secret YAML is not secure.

---

## 10. Least Privilege and Short-Lived Credentials

Even with scanning, assume mistakes happen.

Reduce blast radius:

- service account per environment;
- least privilege IAM;
- short-lived tokens;
- rotation policy;
- separate dev/staging/prod credentials;
- no shared human credentials;
- no long-lived cloud root keys;
- scoped deploy keys;
- read-only tokens where possible.

If leaked credential has minimal scope and short TTL, incident impact is smaller.

---

## 11. Commit Author Is Not Strong Identity

Git commit author fields are text:

```text
Author: Name <email>
```

Anyone can configure:

```bash
git config user.name "Alice"
git config user.email "alice@company.com"
```

This does not prove Alice authored the commit.

Git commit identity by default is not cryptographic.

For trust, use signed commits/tags and platform verified identity.

---

## 12. Signed Commits

Signed commits use cryptographic signature to prove commit was signed by a key.

Git supports:

- GPG signing;
- SSH signing;
- S/MIME signing.

Configure signing key.

GPG example:

```bash
git config --global user.signingkey <key-id>
git config --global commit.gpgsign true
```

Sign one commit:

```bash
git commit -S -m "Fix escalation guard"
```

Verify:

```bash
git log --show-signature
git verify-commit <commit>
```

Platform like GitHub/GitLab can show “Verified” if key is associated.

---

## 13. SSH Commit Signing

Modern Git supports SSH signing.

Config concept:

```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

Verify needs allowed signers file.

SSH signing can be simpler for teams already using SSH keys.

But governance still matters:

- key ownership;
- key rotation;
- hardware-backed keys if required;
- offboarding;
- platform verification.

---

## 14. Signed Tags

Release tags are more important than everyday commits in many workflows.

Annotated tag:

```bash
git tag -a v1.8.3 -m "Release v1.8.3"
```

Signed tag:

```bash
git tag -s v1.8.3 -m "Release v1.8.3"
```

Verify:

```bash
git tag -v v1.8.3
```

Why signed tags matter:

```text
Release artifact often claims to be built from tag vX.Y.Z.
If tag can be moved or forged, release source trust weakens.
```

For release/security-sensitive systems:

```text
Prefer signed annotated tags for releases.
Protect release tags from deletion/overwrite.
```

---

## 15. Lightweight vs Annotated/Signed Tags

Lightweight tag:

```bash
git tag v1.8.3
```

Just a ref to commit.

Annotated tag:

```bash
git tag -a v1.8.3 -m "Release v1.8.3"
```

Tag object with metadata.

Signed tag:

```bash
git tag -s v1.8.3 -m "Release v1.8.3"
```

Cryptographically signed tag object.

For release:

```text
Use annotated/signed tags, not lightweight tags.
```

---

## 16. Tag Protection

Tags can be moved if not protected:

```bash
git tag -f v1.8.3 <other-commit>
git push --force origin v1.8.3
```

This is dangerous.

Use platform rules:

- protect tags matching `v*`;
- disallow deletion;
- restrict who can create release tags;
- require signed tags if supported/process demands;
- CI verifies tag points to expected commit.

Release tags should be immutable in practice.

---

## 17. Branch Protection

Protect critical branches:

```text
main
master
release/*
hotfix/*
```

Rules:

- no direct push;
- require PR/MR;
- require status checks;
- require review;
- require CODEOWNERS review;
- require up-to-date branch if needed;
- restrict force push;
- restrict deletion;
- require signed commits maybe;
- require linear history if policy;
- require conversation resolution.

Client hooks are not enough.

Platform branch protection is central control.

---

## 18. Force Push Risk

Force push rewrites branch refs.

Safe-ish for personal feature branch.

Dangerous for shared/protected branches.

Use:

```bash
git push --force-with-lease
```

Not:

```bash
git push --force
```

`--force-with-lease` checks that remote branch has not advanced unexpectedly.

Policy:

```text
Never force push protected/shared release/main branches.
Feature branch force push allowed only if team workflow accepts it.
```

Security angle:

```text
History rewrite can hide malicious changes or erase audit trail if uncontrolled.
```

---

## 19. Reproducible Build and Git

Security supply chain needs ability to answer:

```text
Which source produced this artifact?
```

Minimum metadata:

- commit SHA;
- tag;
- branch;
- dirty/clean state;
- build time;
- CI run ID;
- builder identity;
- dependency versions;
- artifact checksum;
- container digest.

Bad:

```text
Artifact name: app-latest.jar
Unknown source.
```

Good:

```text
com.acme:case-service:1.8.3
Built from tag case-service-v1.8.3
Commit a13f9e2
CI run 4821
SHA256 ...
```

Git is source anchor.

Artifact repository is binary anchor.

---

## 20. Dirty Working Tree Builds

Do not release from dirty working tree.

If build includes uncommitted changes, artifact cannot be reproduced from Git commit.

CI should build from clean checkout.

Local release should verify:

```bash
git status --short
```

Build script:

```bash
if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is dirty. Refusing release build."
  exit 1
fi
```

Exception for generated metadata must be controlled.

---

## 21. Embedding Git Metadata in Java Artifacts

Useful build metadata:

- commit SHA;
- branch;
- tag;
- build time;
- dirty flag;
- version.

Spring Boot can expose build info via Actuator if configured.

Gradle/Maven plugins can generate `build-info.properties`.

Example content:

```properties
git.commit=a13f9e2
git.branch=main
build.version=1.8.3
build.time=2026-06-17T10:00:00Z
```

Caveat:

```text
Build time makes artifact non-reproducible byte-for-byte unless controlled.
```

For strict reproducible builds, handle timestamps carefully.

---

## 22. Dependency Supply Chain Risk

Java dependencies are supply chain inputs.

Risks:

- malicious package;
- compromised maintainer;
- dependency confusion;
- typosquatting;
- vulnerable version;
- transitive dependency issue;
- untrusted repository;
- SNAPSHOT mutation;
- dynamic version;
- manually committed jar;
- plugin compromise.

Git security is connected because build files in Git define dependencies.

Review changes to:

```text
pom.xml
build.gradle
settings.gradle
gradle/libs.versions.toml
gradle.lockfile
maven settings
CI workflows
```

as security-sensitive.

---

## 23. Dependency Confusion

If internal dependency coordinate overlaps public namespace, build tool may resolve malicious public package.

Mitigations:

- use private groupId namespace;
- configure repository order carefully;
- restrict repositories;
- internal artifact proxy;
- dependency verification;
- lockfiles;
- avoid dynamic versions;
- monitor dependency sources.

Example internal group:

```text
com.acme.internal
```

Ensure artifacts only resolved from trusted repository.

---

## 24. Dependency Locking and Verification

Gradle supports dependency locking and verification metadata.

Benefits:

- dependency versions fixed;
- checksum verification;
- less unexpected transitive drift;
- better forensic.

Maven can use:

- dependencyManagement/BOM;
- enforcer plugin;
- repository manager policies;
- checksum verification;
- versions plugin/process.

Do not rely on floating versions for release.

Bad:

```kotlin
implementation("com.acme:workflow-core:2.+")
```

Good:

```kotlin
implementation("com.acme:workflow-core:2.4.1")
```

---

## 25. Build Plugins Are Dependencies Too

Maven/Gradle plugins execute code during build.

Review plugin changes carefully:

- plugin version bump;
- new plugin;
- repository source;
- plugin portal usage;
- custom build script logic;
- Gradle init scripts;
- Maven extensions.

Malicious build plugin can exfiltrate secrets in CI.

Build logic is code.

Treat it as security-sensitive.

---

## 26. CI Workflow Security

CI config in Git can access secrets.

Example GitHub Actions workflow:

```yaml
env:
  TOKEN: ${{ secrets.PROD_TOKEN }}
```

If PR modifies workflow to print token, platform protections may limit exposure depending event model, but risk exists.

Review changes to:

```text
.github/workflows/**
.gitlab-ci.yml
Jenkinsfile
.circleci/config.yml
azure-pipelines.yml
```

Security concerns:

- secret exposure;
- running untrusted code with privileged token;
- pull_request_target misuse;
- third-party actions pinned by branch not SHA;
- broad permissions;
- artifact tampering;
- deployment condition changes.

---

## 27. Pin Third-Party Actions

Bad:

```yaml
uses: some/action@main
```

Better:

```yaml
uses: some/action@v1
```

Stronger:

```yaml
uses: some/action@<full-commit-sha>
```

Trade-off:

- SHA pin is secure but updates manual;
- tag pin is convenient but tag could be moved if upstream compromised;
- allow Dependabot/Renovate to update actions.

For high-security pipelines, pin by SHA and review updates.

---

## 28. CI Token Permissions

Use least privilege.

GitHub Actions example:

```yaml
permissions:
  contents: read
```

Only grant write where needed:

```yaml
permissions:
  contents: write
  packages: write
```

Avoid broad default permissions.

CI secrets should not be available to untrusted PRs.

Deployment jobs should require environment protection/approval if needed.

---

## 29. Artifact Provenance

Modern supply chain security uses provenance:

```text
Who built this artifact?
From what source?
Using what workflow?
At what time?
With what dependencies?
Was source reviewed?
Was build isolated?
```

Concepts:

- SLSA;
- in-toto;
- Sigstore/cosign;
- SBOM;
- provenance attestations;
- build signatures.

Even if not implementing fully, understand direction:

```text
Release trust is moving from “we have a tag” to “we have verifiable provenance”.
```

Git commit/tag is one input in provenance.

---

## 30. SBOM

Software Bill of Materials lists components/dependencies.

For Java:

- Maven/Gradle dependency graph;
- CycloneDX plugin;
- SPDX.

SBOM can be attached to release artifact.

Do not casually commit generated SBOM on every build unless policy requires.

Better:

```text
Generate SBOM in CI.
Attach to artifact/release.
Store with release evidence.
```

---

## 31. Signed Artifacts and Container Images

Git signed tag proves source tag integrity.

But artifact can still be tampered after build.

Sign artifacts/images:

- jars with repository signing if required;
- container images with cosign;
- checksums;
- repository manager metadata.

For container:

```text
image digest is stronger than mutable tag.
```

Deploy by digest when possible:

```text
registry/acme/case-service@sha256:...
```

Not just:

```text
case-service:latest
```

---

## 32. Submodule Security

Submodules add supply chain surface.

Risks:

- submodule URL changed to malicious repo;
- pointer updated to unreviewed commit;
- submodule branch tracking pulls unexpected code;
- private submodule access leaks;
- submodule commit not tagged/released;
- CI recursively executes code from submodule.

Review:

```bash
git diff -- .gitmodules
git diff --submodule=log
git submodule status
```

Policy:

```text
Submodule updates require same review as dependency updates.
Pin to trusted commit/tag.
```

---

## 33. Git Hooks Security

Hooks can help detect issues, but hooks themselves are code.

If repo uses `.githooks` or hook manager:

- review hook changes;
- ensure hooks do not exfiltrate secrets;
- avoid network calls in hooks;
- keep hooks simple;
- CI equivalent should exist.

Remember:

```text
Client-side hooks can be bypassed.
Server-side/CI controls are authoritative.
```

---

## 34. Dangerous Files to Review Carefully

Security-sensitive files:

```text
.github/workflows/**
.gitlab-ci.yml
Jenkinsfile
Dockerfile
docker-compose*.yml
k8s/**
helm/**
pom.xml
build.gradle*
settings.gradle*
gradle/libs.versions.toml
gradle.lockfile
.mvn/**
gradle/wrapper/**
scripts/**
.githooks/**
.gitmodules
.gitattributes
```

Also:

```text
src/main/resources/application*.yml
db/migration/**
openapi.yaml
proto/**
```

Because they affect runtime behavior, build, deployment, or contract.

---

## 35. Maven/Gradle Wrapper Security

Wrapper files execute downloaded build tool.

Track wrapper files:

```text
mvnw
mvnw.cmd
.mvn/wrapper/*
gradlew
gradlew.bat
gradle/wrapper/*
```

Review wrapper changes carefully.

Gradle wrapper has distribution URL and checksum support.

Maven wrapper has wrapper URL/config.

Risks:

- wrapper URL changed to malicious host;
- wrapper jar altered;
- distribution version changed unexpectedly.

Policy:

```text
Wrapper updates should be explicit commits.
Review distribution URL.
Use official distributions or internal mirror.
```

---

## 36. Executable Scripts in Repo

Scripts can run in CI/local with secrets.

Review scripts carefully:

```text
scripts/deploy.sh
scripts/release.sh
scripts/generate.sh
```

Risks:

- curl | bash;
- echo secrets;
- upload artifacts to wrong place;
- unsafe rm;
- credential leakage;
- running unpinned tools.

Use:

```bash
set -euo pipefail
```

But security also needs code review.

---

## 37. Dockerfile Security and Git

Dockerfile changes affect supply chain.

Review:

- base image;
- tag vs digest;
- package installs;
- curl downloads;
- root user;
- copied files;
- secret handling;
- build args;
- exposed ports;
- entrypoint.

Bad:

```dockerfile
ARG TOKEN
RUN echo $TOKEN
```

Use build secrets if needed.

Pin base image digest for high assurance.

---

## 38. Secrets in GitHub Actions / CI Logs

Even if secret not in Git, CI can leak it.

Examples:

```bash
echo "$PROD_PASSWORD"
set -x
printenv
mvn -X
```

Avoid printing environment.

Masking helps but not perfect.

Review debug logging before enabling in CI.

Do not pass secrets to untrusted scripts.

---

## 39. Pull Requests from Forks

Open-source/public repos face fork PR risk.

Untrusted PR code can modify build/test to exfiltrate secrets if secrets are available.

Platform usually restricts secrets for fork PRs, but be careful with:

- `pull_request_target`;
- manual checkout of PR head;
- privileged workflows;
- write tokens.

Rule:

```text
Never run untrusted PR code with privileged secrets.
```

Enterprise internal repos can still have insider risk.

---

## 40. CODEOWNERS as Security Control

CODEOWNERS can require review from owners for sensitive paths.

Example:

```text
.github/workflows/ @acme/security @acme/dev-platform
k8s/prod/ @acme/platform-ops
helm/ @acme/platform-ops
gradle/wrapper/ @acme/dev-platform
pom.xml @acme/backend-platform
build.gradle* @acme/backend-platform
db/migration/ @acme/database-reviewers
```

This improves review routing.

But:

```text
CODEOWNERS is effective only with branch protection requiring code owner review.
```

---

## 41. Protected Environments

Deployment from Git should be gated.

Use platform environments:

- approval required for prod;
- restricted deployers;
- secrets scoped per environment;
- audit log;
- branch/tag restrictions.

Example policy:

```text
Only signed release tags matching v* can deploy to production.
CI must pass.
Manual approval required.
```

This connects Git refs to deployment trust.

---

## 42. Release from Tags vs Branches

Releasing from arbitrary branch HEAD can be risky.

Better:

```text
merge to main -> tag release -> build from tag -> publish artifact -> deploy artifact
```

Or:

```text
release branch -> signed tag -> build
```

Tag should be protected/immutable.

Build should record tag and commit SHA.

---

## 43. Changelog and Release Notes Integrity

Generated changelog from commits works only if commit messages meaningful and history trustworthy.

Security-sensitive release notes should mention:

- security fixes;
- dependency upgrades;
- breaking changes;
- migration;
- CVE fixes if allowed by disclosure policy.

Do not rely solely on autogenerated `fix:` messages for regulated release evidence.

---

## 44. Audit Trail and Rewrite History

History rewrite can be legitimate:

- remove secret;
- remove large file;
- repository migration.

But it can also destroy audit trail.

Policy:

```text
Protected branches should not be rewritten except under controlled incident/migration process.
```

If rewrite occurs:

- document reason;
- keep backup securely if appropriate;
- coordinate;
- preserve evidence;
- rotate secrets if applicable.

---

## 45. Commit Signing Limitations

Signed commit proves:

```text
Holder of key signed this commit object.
```

It does not prove:

- code is correct;
- author intended business change;
- key was not compromised;
- commit was reviewed;
- build artifact came from commit;
- deployment used artifact;
- dependency safe.

Signing is one layer.

Combine with:

- review;
- CI;
- branch protection;
- provenance;
- artifact signing;
- key management.

---

## 46. Key Management

Signing is only as strong as key management.

Questions:

```text
Where is private key stored?
Is it password-protected?
Hardware-backed?
What happens on laptop loss?
How is key rotated?
How is employee offboarded?
How are expired keys handled?
Which keys are trusted?
```

For organizations:

- publish allowed signing keys;
- enforce platform verification;
- use SSO-bound keys if available;
- prefer hardware-backed keys for release signing;
- document rotation.

---

## 47. Bot Commits

Bots commit:

- dependency updates;
- generated code;
- release version bump;
- formatting;
- vendored updates.

Bot identity should be clear.

Bot tokens should be least privilege.

Bot commits/tags may be signed depending policy.

Review bot PRs, especially dependency updates.

Do not auto-merge high-risk dependency changes without tests/security review.

---

## 48. Dependency Update Bots

Tools:

- Dependabot;
- Renovate;
- internal update bots.

Benefits:

- timely security updates;
- consistent dependency updates;
- reduced drift.

Risks:

- update fatigue;
- breaking changes;
- malicious dependency version if ecosystem compromised;
- auto-merge too broad.

Policy:

```text
Patch updates may be auto-merged after CI for low-risk libs.
Major updates require review.
Security updates prioritized.
Build plugin updates reviewed carefully.
```

---

## 49. Maven/Gradle Repository Policy

Restrict repositories.

Bad:

```kotlin
repositories {
    mavenCentral()
    maven("https://random.example.com/maven")
}
```

Better:

```kotlin
repositories {
    maven("https://repo.acme.internal/maven-proxy")
}
```

Enterprise often proxies external repositories through internal repository manager for:

- caching;
- vulnerability scanning;
- license policy;
- checksum verification;
- allow/deny list.

Review repository additions as security-sensitive.

---

## 50. Artifact Immutability

Artifact versions should be immutable.

Bad:

```text
com.acme:workflow-core:2.4.1 overwritten with different bytes
```

This destroys reproducibility.

Repository manager should prevent redeploy release versions.

SNAPSHOT can be mutable, but release builds should not depend on SNAPSHOT.

Use checksums and lockfiles where possible.

---

## 51. Supply Chain Attack Example: Build Script Exfiltration

Attacker changes PR:

```gradle
tasks.register("steal") {
    doLast {
        println(System.getenv("PROD_TOKEN"))
    }
}
test.dependsOn("steal")
```

If CI exposes secrets during PR test, token leaks.

Mitigations:

- no prod secrets in PR jobs;
- environment approvals;
- least privilege tokens;
- review build script changes;
- restrict workflow changes;
- CODEOWNERS for build files;
- secret masking;
- separate build/test/deploy jobs.

---

## 52. Supply Chain Attack Example: Malicious Dependency

PR changes:

```kotlin
implementation("com.acme:workflow-core:2.4.1")
```

to:

```kotlin
implementation("com.acrne:workflow-core:2.4.1")
```

Looks similar.

Or adds:

```kotlin
implementation("some-random:helper:1.0")
```

Mitigations:

- dependency review;
- lockfile diff;
- repository allowlist;
- vulnerability/license scan;
- package namespace policy;
- code owner review for build files.

---

## 53. Supply Chain Attack Example: Tag Move

Release tag:

```text
v1.8.3
```

is moved to malicious commit.

If CI deploys by tag name without protection, bad artifact can be built.

Mitigations:

- protected tags;
- signed tags;
- tag immutability policy;
- release approval;
- artifact checksum/provenance;
- alert on tag deletion/force update.

---

## 54. Supply Chain Attack Example: Submodule URL Change

`.gitmodules` changed:

```ini
url = git@github.com:acme/workflow-core.git
```

to:

```ini
url = git@github.com:attacker/workflow-core.git
```

Mitigation:

- review `.gitmodules`;
- CODEOWNERS;
- CI allowlist submodule URLs;
- prefer artifact dependencies for Java libraries;
- pin trusted commits/tags.

---

## 55. Security Review Checklist for PRs

```text
[ ] Any secrets or suspicious config?
[ ] Any build file changes?
[ ] Any dependency changes?
[ ] Any CI workflow changes?
[ ] Any Dockerfile/deployment changes?
[ ] Any script changes?
[ ] Any wrapper changes?
[ ] Any submodule changes?
[ ] Any binary/large files?
[ ] Any generated code changes?
[ ] Any migration/security config changes?
[ ] Any permission/role changes?
[ ] Any logging changes that might expose data?
[ ] Any new external network call?
[ ] Any change to release/tag/versioning?
```

---

## 56. Java-Specific Security Git Checklist

For Java repo:

```text
[ ] `pom.xml`/`build.gradle` changes reviewed.
[ ] Maven/Gradle repositories restricted.
[ ] Dependency versions pinned.
[ ] No release dependency on SNAPSHOT.
[ ] Wrapper files tracked and reviewed.
[ ] No committed jars except wrapper jars.
[ ] No secrets in `src/main/resources`.
[ ] `application-local.yml` ignored.
[ ] Test resources contain no real credentials/PII.
[ ] Migration files contain no production data.
[ ] CI workflows least-privilege.
[ ] Dockerfile does not bake secrets.
[ ] Artifact metadata includes Git SHA.
[ ] Release tags protected/signed if required.
```

---

## 57. Incident Playbook: Secret in Java Resource

Scenario:

```text
src/main/resources/application-prod.yml contains DB password.
Merged to main.
Repo private.
CI deployed service.
```

Response:

1. Revoke/rotate DB password.
2. Check access logs if possible.
3. Remove secret from config.
4. Replace with env/secret manager reference.
5. Commit fix.
6. Determine exposure window.
7. History rewrite if policy requires.
8. Force push under controlled process if rewriting.
9. Clear CI caches/logs if secret printed.
10. Add scanning rule.
11. Add CODEOWNERS for prod config.
12. Document incident.

Do not merely:

```text
Remove line and move on.
```

---

## 58. Incident Playbook: Malicious/Bad Dependency

Scenario:

```text
New dependency version causes suspicious network call.
```

Response:

1. Freeze deployment.
2. Identify dependency change commit.
3. Revert or pin previous version.
4. Audit transitive dependency tree.
5. Check artifact source/checksum.
6. Review CI logs and runtime logs.
7. Scan for compromise.
8. Update allowlist/policy.
9. Add dependency verification/lock if missing.
10. Document.

Git helps identify the commit and dependency diff.

---

## 59. Incident Playbook: Release Tag Moved

Scenario:

```text
v2.1.0 tag points to different commit than release notes.
```

Response:

1. Stop deployment from tag.
2. Identify who/what moved tag.
3. Check audit logs.
4. Compare old/new commit if known.
5. Verify artifact already published.
6. Restore correct tag if appropriate.
7. Protect tags.
8. Move to signed tags.
9. Communicate affected teams.
10. Document incident.

---

## 60. Governance Baseline

Minimum for serious Java teams:

```text
[ ] Protected main/release branches.
[ ] Required CI checks.
[ ] Required review.
[ ] CODEOWNERS for sensitive paths.
[ ] Secret scanning.
[ ] Large file/binary guard.
[ ] No release from dirty tree.
[ ] Artifact published to repository.
[ ] Release tag convention.
[ ] Dependency update review.
[ ] No SNAPSHOT in release.
[ ] CI least privilege.
[ ] `.gitignore` for local secrets.
[ ] Incident playbook for leaked secret.
```

For higher assurance:

```text
[ ] Signed release tags.
[ ] Signed commits for protected branches.
[ ] Artifact/image signing.
[ ] SBOM generation.
[ ] Provenance attestation.
[ ] Dependency verification.
[ ] Protected environments.
[ ] Hardware-backed release keys.
```

---

## 61. Practical Commands Cheat Sheet

Search secrets current tree:

```bash
git grep -n -i -E 'password|secret|api[_-]?key|private_key|token'
```

Search file history:

```bash
git log -p -- path/to/file
```

Remove tracked secret file from current tree:

```bash
git rm --cached .env
echo ".env" >> .gitignore
git add .gitignore
git commit -m "Stop tracking local environment file"
```

Sign commit:

```bash
git commit -S -m "Fix security config"
```

Show signatures:

```bash
git log --show-signature
```

Signed tag:

```bash
git tag -s v1.8.3 -m "Release v1.8.3"
```

Verify tag:

```bash
git tag -v v1.8.3
```

Check dependency diff:

```bash
git diff main...HEAD -- pom.xml build.gradle gradle.lockfile gradle/libs.versions.toml
```

Check suspicious binary:

```bash
git diff --name-status main...HEAD
```

---

## 62. Latihan Praktis

## Latihan 1 — Secret Hygiene Audit

Di repo Java:

```bash
git grep -n -i -E 'password|secret|api[_-]?key|private_key|token'
```

Klasifikasikan hasil:

```text
real secret
fake/test secret
false positive
needs allowlist/documentation
```

## Latihan 2 — Review Build File Security

Ambil PR yang mengubah `pom.xml` atau `build.gradle`.

Jawab:

```text
Dependency apa berubah?
Repository apa berubah?
Plugin apa berubah?
Apakah lockfile berubah?
Apakah ada SNAPSHOT/dynamic version?
```

## Latihan 3 — Signed Tag Lab

Buat annotated tag dan signed tag di repo lab.

```bash
git tag -a v0.1.0 -m "Release v0.1.0"
git tag -s v0.1.1 -m "Release v0.1.1"
git tag -v v0.1.1
```

Pahami perbedaannya.

## Latihan 4 — Release Traceability

Ambil artifact service terakhir.

Jawab:

```text
Git commit?
Tag?
CI run?
Artifact checksum?
Docker digest?
Dependency versions?
SBOM?
```

Jika tidak bisa dijawab, traceability gap.

## Latihan 5 — CODEOWNERS Sensitive Paths

Buat draft CODEOWNERS:

```text
.github/workflows/ @security @dev-platform
pom.xml @backend-platform
build.gradle* @backend-platform
k8s/prod/ @platform-ops
src/main/resources/application-prod.yml @platform-ops
```

Diskusikan dengan tim.

---

## 63. Pertanyaan Reflektif

1. Apakah repo pernah punya secret leak?
2. Apakah tim tahu playbook rotasi secret?
3. Apakah `.gitignore` mencakup local secret files?
4. Apakah secret scanning ada di pre-commit/CI/platform?
5. Apakah branch utama protected?
6. Apakah release tags protected?
7. Apakah release tags signed?
8. Apakah artifact bisa ditelusuri ke Git commit?
9. Apakah CI secrets least privilege?
10. Apakah build files punya CODEOWNERS?
11. Apakah dependency versions pinned?
12. Apakah SNAPSHOT dilarang untuk release?
13. Apakah wrapper changes direview?
14. Apakah Dockerfile/workflow changes dianggap security-sensitive?
15. Apakah incident forensic bisa membuktikan source-to-artifact chain?

---

## 64. Mental Model Akhir

Security Git punya tiga pilar:

```text
Confidentiality:
  Jangan biarkan secret/data sensitif masuk Git.
  Jika masuk, rotate dan tangani sebagai incident.

Integrity:
  Pastikan source, history, tag, dependency, dan build pipeline bisa dipercaya.

Provenance:
  Pastikan artifact production bisa ditelusuri ke commit/tag, CI run,
  dependency set, dan approval yang benar.
```

Git bukan hanya alat commit.

Git adalah bagian dari rantai kepercayaan.

Repository yang aman membuat pertanyaan ini bisa dijawab:

```text
Apa yang berubah?
Siapa/apa yang menyetujuinya?
Apakah perubahan diuji?
Dari source mana artifact dibangun?
Apakah release tag valid?
Apakah dependency-nya diketahui?
Apakah secret terlindungi?
```

Itulah standar engineering untuk sistem production yang serius.

---

## 65. Koneksi ke Part Berikutnya

Part ini membahas security, secret leakage, signed commits/tags, dan supply chain.

Part berikutnya masuk ke operasi Git paling berisiko:

```text
learn-git-mastery-for-java-engineers-part-028.md
```

Topik:

```text
Rewrite History Lanjutan: Filter-Repo, BFG, dan Migration
```

Kita akan membahas:

- kapan history rewrite boleh dilakukan;
- `git filter-repo`;
- BFG Repo-Cleaner;
- menghapus secret/large file dari history;
- migrasi repo;
- split/merge repo;
- koordinasi force push;
- dampak ke clone, fork, tag, CI, dan audit trail.

---

## 66. Referensi

Rujukan utama untuk materi ini:

- Git official documentation: commit signing, tag signing, verify-commit, verify-tag
- Git official documentation: gitignore, githooks, submodules, push force-with-lease
- GitHub/GitLab documentation: protected branches, protected tags, CODEOWNERS, secret scanning, signed commits
- Maven/Gradle documentation: dependency management, dependency locking, repository configuration, wrapper usage
- OWASP and supply chain security practices: secret management, dependency review, SBOM, artifact provenance, least privilege CI
- Praktik umum incident response untuk credential leakage, release integrity, and Java build pipeline hardening

---

## 67. Status Seri

```text
Progress: 027 / 032
Seri belum selesai.
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
```

Bagian berikutnya:

```text
learn-git-mastery-for-java-engineers-part-028.md
```

Topik:

```text
Rewrite History Lanjutan: Filter-Repo, BFG, dan Migration
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-git-mastery-for-java-engineers-part-026.md](./learn-git-mastery-for-java-engineers-part-026.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-git-mastery-for-java-engineers-part-028.md](./learn-git-mastery-for-java-engineers-part-028.md)

</div>
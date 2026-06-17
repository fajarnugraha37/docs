# learn-git-mastery-for-java-engineers-part-026.md

# Part 026 — Large Files, Binary Assets, Git LFS, dan Repository Bloat

> **Seri:** Git Mastery for Java Engineers  
> **Bagian:** 026 / 032  
> **Topik:** Mengelola file besar, binary artifact, Git LFS, repository bloat, artifact repository, dan policy binary dalam Java project  
> **Target pembaca:** Java software engineer, tech lead, build/release engineer, dan maintainer repository yang ingin menjaga repo tetap cepat, bersih, reproducible, dan aman  
> **Status seri:** Belum selesai. Bagian terakhir adalah `learn-git-mastery-for-java-engineers-part-032.md`.

---

## 0. Ringkasan Eksekutif

Git sangat kuat untuk source code text.

Git buruk untuk file besar yang sering berubah, terutama binary.

Contoh file yang sering merusak repository:

```text
target/*.jar
build/libs/*.jar
*.war
*.ear
*.zip
*.tar.gz
*.iso
*.mp4
*.mov
*.psd
*.ai
*.xlsx besar
database dump
heap dump
test fixture besar
model ML
generated binary
dependency jar di folder lib/
```

Masalahnya bukan hanya ukuran file saat ini.

Masalah utama Git:

```text
Jika file besar pernah masuk history, file itu tetap dibawa dalam history.
```

Menghapus file di commit berikutnya tidak otomatis menghapusnya dari history.

Akibat:

- clone lambat;
- fetch lambat;
- CI checkout mahal;
- repository storage membengkak;
- local disk boros;
- garbage collection berat;
- packfile besar;
- review binary tidak meaningful;
- merge binary sulit;
- secret/PII dalam dump tetap ada di history;
- incident cleanup butuh rewrite history.

Mental model utama:

```text
Git adalah database immutable object.
Large binary yang berubah berkali-kali menghasilkan banyak object besar.
```

Untuk Java project, default sehat:

```text
Source code, build config, schema, migration, contract, dan test fixture kecil masuk Git.
Build artifacts, dependency jars, dumps, logs, reports, dan generated binaries tidak masuk Git.
```

Jika file besar memang harus versioned bersama repo, pertimbangkan:

```text
Git LFS
artifact repository
object storage
test fixture registry
package registry
data versioning tool
```

---

## 1. Kenapa Git Buruk untuk Binary Besar?

Git menyimpan object berdasarkan content.

Untuk text source code, Git sangat efisien karena:

- file kecil;
- diff meaningful;
- compression efektif;
- merge line-based;
- history berguna;
- perubahan incremental.

Untuk binary besar:

- diff tidak meaningful;
- merge sulit;
- compression terbatas;
- setiap perubahan bisa menjadi object besar baru;
- review tidak bisa melihat perubahan semantic;
- conflict resolution manual;
- clone harus membawa history object;
- repository cepat bloat.

Contoh:

```text
model.bin 200 MB
Diubah 10 kali
History bisa menyimpan ~2 GB object terkait file itu
```

Walaupun file saat ini hanya 200 MB, history membawa versi lama.

---

## 2. Repository Bloat: Masalah History, Bukan Working Tree Saja

Misalkan:

```bash
git add target/app.jar
git commit -m "Add jar"
git rm target/app.jar
git commit -m "Remove jar"
```

Working tree sekarang bersih.

Tetapi object jar tetap ada di history.

Clone baru masih bisa membutuhkan object itu karena commit lama mereferensikannya.

Inilah sebabnya:

```text
"Sudah saya delete" tidak sama dengan "sudah hilang dari repository history".
```

Untuk menghapus dari history, perlu history rewrite dengan tool seperti:

- `git filter-repo`;
- BFG Repo-Cleaner;
- manual filter branch lama, tidak direkomendasikan untuk penggunaan baru.

Part 028 akan membahas rewrite history lebih dalam.

---

## 3. Binary Artifact dalam Java Project

Java project menghasilkan artifact:

```text
.jar
.war
.ear
```

Biasanya output dari:

```bash
./mvnw package
./gradlew build
```

Lokasi:

```text
target/
build/libs/
```

Rule:

```text
Jangan commit build artifact.
```

Artifact release harus masuk:

- Nexus;
- Artifactory;
- GitHub Packages;
- GitLab Package Registry;
- Maven repository internal;
- container registry untuk image;
- release asset jika sesuai, tetapi bukan source repo history.

Git source repo bukan artifact repository.

---

## 4. Dependency Jar di `lib/`: Anti-Pattern Umum

Struktur buruk:

```text
my-service/
  lib/
    mysql-connector.jar
    internal-common.jar
    some-vendor-sdk.jar
```

Masalah:

- version metadata lemah;
- transitive dependency tidak jelas;
- license scanning sulit;
- security scanning sulit;
- update manual;
- duplicate dependency;
- no checksum/provenance;
- merge/review buruk;
- repo bloat;
- build tool kehilangan dependency graph.

Lebih baik Maven:

```xml
<dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-j</artifactId>
    <version>8.4.0</version>
</dependency>
```

Gradle:

```kotlin
implementation("com.mysql:mysql-connector-j:8.4.0")
```

Untuk internal vendor jar:

```text
Publish to internal Maven repository.
```

Jika tidak bisa:

```text
Document origin, version, license, checksum, and migration plan.
```

Tetapi jangan jadikan commit jar sebagai default.

---

## 5. Artifact Repository vs Git

Artifact repository menyimpan build outputs dan dependencies.

Git menyimpan source of truth.

| Kebutuhan | Git | Artifact Repository |
|---|---:|---:|
| Source code | Ya | Tidak |
| Build config | Ya | Tidak |
| Release jar | Tidak | Ya |
| Dependency jar | Tidak | Ya |
| Version metadata | Terbatas | Ya |
| Checksums | Manual | Ya |
| Retention policy | Sulit | Ya |
| Promotion dev/stage/prod | Sulit | Ya |
| Vulnerability scan | Terbatas | Ya |
| Immutable artifact | Bisa, tapi salah tempat | Ya |
| Large binary storage | Buruk | Lebih cocok |

Artifact repository untuk Java:

- Nexus Repository;
- JFrog Artifactory;
- GitHub Packages;
- GitLab Package Registry;
- AWS CodeArtifact;
- Azure Artifacts.

---

## 6. Container Images: Jangan Simpan di Git

Container image adalah artifact binary/layered.

Simpan di:

- Docker registry;
- GHCR;
- ECR;
- GCR/Artifact Registry;
- ACR;
- Harbor;
- internal registry.

Git menyimpan:

```text
Dockerfile
.dockerignore
build scripts
Helm/K8s manifests
```

Git tidak menyimpan:

```text
image tarball
```

Bad:

```text
docker save my-service:latest > my-service.tar
git add my-service.tar
```

Good:

```bash
docker build -t registry/acme/case-service:1.2.3 .
docker push registry/acme/case-service:1.2.3
```

Traceability:

```text
image label should include Git commit SHA
```

Example Docker label:

```dockerfile
LABEL org.opencontainers.image.revision=$GIT_COMMIT
```

---

## 7. Logs, Reports, Heap Dumps

Do not commit:

```text
*.log
*.hprof
target/surefire-reports/
build/reports/
coverage/
jacoco.exec
```

Reasons:

- large;
- generated;
- local;
- may contain secrets/PII;
- not source of truth;
- changes constantly;
- poor review value.

If an incident requires sharing logs:

- attach to incident system;
- redact secrets/PII;
- store in approved evidence repository;
- link from ticket/ADR if needed.

Do not put raw production logs in Git.

---

## 8. Database Dumps

Do not commit production database dump.

Risks:

- PII;
- secrets;
- regulatory breach;
- huge size;
- stale data;
- impossible history cleanup without rewrite;
- access control issue;
- data retention violation.

For tests, prefer:

- small synthetic fixtures;
- migration scripts;
- seed scripts;
- anonymized minimal data;
- generated fixtures;
- containerized test DB setup.

If realistic dataset needed:

- store in approved secure object storage;
- document access;
- version dataset separately;
- use checksum;
- never commit sensitive dump.

---

## 9. Test Fixtures: Kapan Boleh Masuk Git?

Test fixture boleh masuk Git jika:

```text
[ ] kecil;
[ ] non-secret;
[ ] non-PII;
[ ] stable;
[ ] necessary untuk tests;
[ ] reviewable atau at least explainable;
[ ] source/origin jelas;
[ ] tidak sering berubah besar.
```

Contoh baik:

```text
src/test/resources/contracts/case-response.json
src/test/resources/fixtures/minimal-case.json
src/test/resources/certs/test-only-cert.pem
```

Contoh buruk:

```text
src/test/resources/prod-dump-2026-06.sql
src/test/resources/huge-500mb-payload.json
src/test/resources/customer-real-data.xlsx
```

Jika fixture besar tapi legitimate:

- compress? maybe, but compressed binary diff still poor;
- generate during test;
- store in object storage;
- use Git LFS;
- split into smaller representative fixtures.

---

## 10. Large JSON/XML Fixtures

Text file besar juga bisa bloat.

Example:

```text
20 MB OpenAPI generated snapshot
100 MB JSON sample
large XML payload
```

Even though text, review may be poor.

Questions:

```text
Can fixture be minimized?
Can it be generated?
Can we store schema + generator instead?
Can we use property-based test?
Can we keep only relevant fields?
Can we compress outside Git?
```

For contract tests, prefer small focused payloads.

Avoid “copy full production response” unless necessary and sanitized.

---

## 11. Generated Files and Bloat

Generated source can be huge:

- OpenAPI client/server;
- protobuf generated classes;
- jOOQ generated code;
- JAXB generated classes;
- generated docs;
- generated reports.

If generated output is committed, repository grows and diffs become noisy.

Decision:

```text
Track source spec and generator config.
Do not track generated output if deterministic and build can generate it.
```

If generated output must be tracked:

- pin generator version;
- separate generated commit;
- mark generated for review tooling if needed;
- CI verifies generated output up-to-date;
- do not edit manually.

---

## 12. Git LFS: Mental Model

Git LFS means Git Large File Storage.

Instead of storing large file content directly in Git object database, Git stores a small pointer file in Git, while actual large content is stored in LFS storage.

Pointer file looks conceptually like:

```text
version https://git-lfs.github.com/spec/v1
oid sha256:<hash>
size <bytes>
```

Working tree shows actual file if LFS is installed and content fetched.

Git history stores pointer files, not large binary content.

Actual binary lives in LFS server/storage.

---

## 13. Kapan Git LFS Cocok?

Git LFS cocok untuk:

```text
[ ] large binary file harus versioned bersama source;
[ ] file tidak cocok di artifact repository;
[ ] review content tidak perlu line diff;
[ ] team/tooling support LFS;
[ ] storage/quota dikelola;
[ ] CI bisa fetch LFS;
[ ] access control sama dengan repo cukup.
```

Examples:

- small set of model files;
- large test fixture non-sensitive;
- image assets;
- game/media assets;
- design assets;
- binary protocol fixture;
- certificate bundles for tests if safe;
- golden files that cannot be generated.

Untuk typical Java backend, Git LFS jarang perlu.

Artifact repository biasanya lebih tepat untuk jar, war, dependency, container, release bundle.

---

## 14. Kapan Git LFS Tidak Cocok?

Hindari Git LFS untuk:

```text
[ ] build artifacts that belong in artifact repository;
[ ] dependency jars;
[ ] production data dumps;
[ ] secrets;
[ ] files changing extremely often;
[ ] files with separate lifecycle from source;
[ ] data that needs fine-grained access different from repo;
[ ] huge datasets better in data lake/object storage.
```

Git LFS bukan solusi untuk secret leakage.

Git LFS pointer tetap versioned, dan binary masih accessible via LFS permissions.

---

## 15. Menggunakan Git LFS

Install:

```bash
git lfs install
```

Track pattern:

```bash
git lfs track "*.bin"
git lfs track "*.model"
git lfs track "src/test/resources/large-fixtures/**"
```

This modifies:

```text
.gitattributes
```

Example:

```gitattributes
*.bin filter=lfs diff=lfs merge=lfs -text
```

Add:

```bash
git add .gitattributes
git add path/to/large-file.bin
git commit -m "Track large fixture with Git LFS"
```

Clone with LFS:

```bash
git lfs pull
```

Or:

```bash
git clone <repo>
cd repo
git lfs pull
```

---

## 16. Git LFS Failure Modes

Common issues:

```text
Git LFS not installed.
CI checkout does not fetch LFS.
LFS quota exceeded.
LFS object missing.
User lacks access to LFS storage.
Pointer file committed but content not uploaded.
Large file committed before LFS tracking.
```

Symptoms:

- file content is pointer text, not binary;
- tests fail because fixture invalid;
- checkout slow;
- CI fails downloading LFS objects;
- push rejected due to LFS quota.

Mitigations:

- document LFS setup;
- CI checkout `lfs: true`;
- monitor quota;
- add pre-commit large file guard;
- migrate existing files properly;
- avoid LFS unless justified.

---

## 17. GitHub Actions LFS Checkout Example

```yaml
- uses: actions/checkout@v4
  with:
    lfs: true
```

Then:

```bash
git lfs pull
```

if needed.

GitLab:

```yaml
variables:
  GIT_LFS_SKIP_SMUDGE: "0"
```

or ensure runner supports LFS.

Always test fresh clone in CI.

---

## 18. LFS Does Not Fix Existing History Automatically

If you already committed large file normally:

```text
big-file.bin in Git history
```

Then later:

```bash
git lfs track "*.bin"
```

New versions go to LFS, but old Git objects remain in history.

To migrate history:

```bash
git lfs migrate import --include="*.bin"
```

This rewrites history.

Rewriting shared history requires coordination.

Part 028 covers this in more detail.

---

## 19. Detecting Large Files in Current Tree

Find tracked large files:

```bash
git ls-files -z | xargs -0 du -h | sort -h
```

Top largest:

```bash
git ls-files -z | xargs -0 du -b | sort -nr | head -20
```

On macOS, `du -b` may not exist. Use:

```bash
git ls-files -z | xargs -0 stat -f "%z %N" | sort -nr | head -20
```

Linux:

```bash
git ls-files -z | xargs -0 stat -c "%s %n" | sort -nr | head -20
```

---

## 20. Detecting Large Files in History

Use:

```bash
git rev-list --objects --all |
git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' |
sed -n 's/^blob //p' |
sort -nr -k2 |
head -20
```

This lists large blobs in history.

More readable script:

```bash
git rev-list --objects --all |
git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' |
awk '$1 == "blob" {print $3, $2, substr($0, index($0,$4))}' |
sort -nr |
head -20
```

This helps identify bloat sources.

Tools can also help:

- `git-sizer`;
- BFG Repo-Cleaner reports;
- `git filter-repo --analyze`.

---

## 21. `git-sizer`

`git-sizer` analyzes repository size characteristics.

Useful for:

- large blob count;
- tree size;
- commit count;
- path depth;
- tag count;
- reference count.

It helps answer:

```text
Is repo large because of big blobs, many commits, many refs, giant trees, or all?
```

Use in maintenance/audit.

---

## 22. `git count-objects`

Basic:

```bash
git count-objects -vH
```

Output includes:

```text
count
size
in-pack
packs
size-pack
prune-packable
garbage
size-garbage
```

Use:

```bash
git gc
git count-objects -vH
```

But note:

```text
git gc compresses/cleans unreachable objects.
It does not remove reachable large files from history.
```

---

## 23. Packfiles and Clone Cost

Git stores objects in packfiles.

Large binary history increases packfile size.

Clone must download packfiles needed for history.

Partial clone can help, but not all workflows support it well.

Large packfiles hurt:

- developer onboarding;
- CI cold checkout;
- repository hosting cost;
- backup;
- mirror;
- local disk.

Prevention is cheaper than cleanup.

---

## 24. Shallow Clone Is Not a Real Fix

CI may use:

```bash
git clone --depth=1
```

This avoids downloading full history.

But it does not fix repository bloat.

Problems remain:

- developers still suffer full clone;
- release/changelog may need history;
- tags/merge-base may fail;
- bisect impossible;
- old large blobs still in remote storage.

Shallow clone is optimization, not cleanup.

---

## 25. Partial Clone and Large Files

Partial clone:

```bash
git clone --filter=blob:none <repo>
```

Can avoid downloading blobs until needed.

Useful for large monorepos.

But:

- server support needed;
- missing blobs fetched on demand;
- tooling can accidentally fetch many blobs;
- not substitute for artifact policy;
- old bloat still exists remotely.

Use partial clone as scaling tool, not excuse to commit huge files.

---

## 26. Preventing Large Files with Hooks

Pre-commit check:

```bash
#!/usr/bin/env bash
set -euo pipefail

MAX_BYTES=$((10 * 1024 * 1024))

git diff --cached --name-only --diff-filter=ACM | while read -r file; do
  [ -f "$file" ] || continue
  size=$(wc -c < "$file")
  if [ "$size" -gt "$MAX_BYTES" ]; then
    echo "Error: $file is larger than $MAX_BYTES bytes."
    echo "Use artifact repository, object storage, or Git LFS if justified."
    exit 1
  fi
done
```

CI/server-side should also enforce.

Local hook catches accidents early.

---

## 27. Preventing Artifact Commit with `.gitignore`

Java baseline:

```gitignore
# Maven
target/

# Gradle
.gradle/
build/

# Java compiled
*.class

# Build artifacts
*.jar
*.war
*.ear

# Wrapper jar exceptions
!gradle/wrapper/gradle-wrapper.jar
!.mvn/wrapper/maven-wrapper.jar

# Logs/reports/dumps
*.log
*.hprof
coverage/
jacoco.exec
```

But remember:

```text
.gitignore does not apply to already tracked files.
```

If artifact already tracked:

```bash
git rm --cached path/to/artifact.jar
```

---

## 28. `.gitattributes` for Binary Files

Mark binary:

```gitattributes
*.jar binary
*.war binary
*.ear binary
*.class binary
*.zip binary
*.gz binary
*.tar binary
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.pdf binary
*.xlsx binary
```

This prevents Git from treating binary as text.

For LFS:

```gitattributes
*.bin filter=lfs diff=lfs merge=lfs -text
```

Be clear whether file is:

```text
ordinary binary tracked directly
or LFS-managed binary
```

---

## 29. CI Guard: Build Must Not Produce Dirty Tree

Useful check:

```bash
./mvnw clean verify
git diff --exit-code
```

or:

```bash
./gradlew clean build
git diff --exit-code
```

If build modifies tracked files, repo policy is unclear.

Causes:

- generated code tracked but not updated;
- formatter modifies files;
- build writes timestamp/version into source;
- generated resources in tracked directory;
- lockfile updated unintentionally.

Fix policy.

---

## 30. CI Guard: No Build Outputs Tracked

```bash
if git ls-files | grep -E '(^target/|^build/|\.class$|\.hprof$|\.log$)'; then
  echo "Build/runtime outputs are tracked."
  exit 1
fi
```

For jar:

```bash
git ls-files | grep -E '\.(jar|war|ear)$' |
grep -v -E '(^gradle/wrapper/gradle-wrapper.jar$|^\.mvn/wrapper/maven-wrapper.jar$)'
```

If output, fail or review allowlist.

---

## 31. Allowlist for Legitimate Binary Files

Some binary files are legitimate:

- Gradle wrapper jar;
- Maven wrapper jar;
- small image in docs;
- test-only certificate;
- small binary protocol fixture;
- icons/assets for app;
- snapshot PDF fixture if required.

Maintain allowlist:

```text
.binary-allowlist
```

Example:

```text
gradle/wrapper/gradle-wrapper.jar
.mvn/wrapper/maven-wrapper.jar
src/test/resources/fixtures/minimal-binary-message.dat
docs/images/architecture-overview.png
```

CI can compare binary tracked files against allowlist.

---

## 32. Policy for Test Binary Fixtures

If binary fixture is needed:

```text
[ ] Is it small?
[ ] Is it non-sensitive?
[ ] Is origin documented?
[ ] Is expected behavior documented?
[ ] Is there a checksum?
[ ] Is there a generator?
[ ] Does it change rarely?
```

Example README:

```text
src/test/resources/fixtures/binary-message-v1.dat

Purpose:
  Minimal binary protocol payload for backward compatibility test.

Origin:
  Generated by scripts/generate-binary-fixture.sh.

Contains:
  Synthetic data only. No production data.

Update:
  Run script and review compatibility test.
```

This transforms a mysterious blob into governed fixture.

---

## 33. Compression: Good or Bad?

Compressing a large text fixture:

```text
fixture.json -> fixture.json.gz
```

reduces size but worsens diff/review.

Trade-off:

- storage smaller;
- diff not readable;
- small changes become binary-like;
- merge impossible;
- review weaker.

Use compression if:

- fixture is large and stable;
- review of content not needed;
- generator/source exists;
- size matters.

Better: minimize fixture or generate it.

---

## 34. Generated Archives

Do not commit generated archives:

```text
dist.zip
release.tar.gz
api-docs.zip
bundle.zip
```

If docs site build produces static output, decide policy:

- source docs in Git, generated site in artifact/static hosting;
- generated site in separate deployment branch maybe, but be careful;
- do not mix generated docs with source unless explicit.

For Java backend, generated release archives belong in artifact repository.

---

## 35. Heap Dumps and Thread Dumps

Heap dumps:

```text
*.hprof
```

Usually huge and sensitive.

Thread dumps may contain:

- class names;
- paths;
- request data;
- secrets in thread names? sometimes;
- business identifiers.

Do not commit.

Store in incident system with access control.

Add ignore:

```gitignore
*.hprof
thread-dump*.txt
heap-dump*.hprof
```

But if thread dump is small and needed in documentation, sanitize and place in docs intentionally.

---

## 36. PII and Compliance Risk

Large files often contain data.

Examples:

- CSV export;
- Excel report;
- SQL dump;
- JSON production response;
- logs;
- PDFs;
- screenshots.

Risks:

- personal data;
- financial data;
- regulatory data;
- credentials;
- tokens;
- internal URLs;
- customer names;
- case IDs.

Git history makes accidental PII persistence serious.

Policy:

```text
No production data in Git unless explicitly approved, minimized, anonymized, and governed.
```

In regulated case management systems, this is critical.

---

## 37. Secret Scanning Large/Binary Files

Secret scanning text is easier.

Binary files can hide secrets:

- zip with config;
- jar with properties;
- heap dump;
- database dump;
- office docs;
- screenshots.

Avoid committing binary unknowns.

For jars/archives:

```bash
jar tf file.jar
unzip -l file.zip
```

Inspect before allowlisting.

Never allow binary simply because scanner did not detect secret.

---

## 38. Java Release Traceability Without Committing Artifacts

Need traceability?

Do not commit jar.

Instead record metadata:

- Git commit SHA;
- tag;
- artifact coordinates;
- checksum;
- build number;
- CI run ID;
- SBOM;
- container digest;
- deployment manifest.

Example:

```text
com.acme:case-service:1.8.3
Git commit: a13f9e2
Build: CI #4821
SHA256: ...
Docker image: registry/acme/case-service@sha256:...
```

Store in artifact repository/build system/release notes.

Git tag anchors source.

Artifact repository anchors binary.

---

## 39. Checksums

For external binary fixture:

```bash
sha256sum fixture.bin
```

Record:

```text
fixture.bin sha256:<hash>
```

In README or metadata.

For artifact download scripts, verify checksum.

Example:

```bash
echo "<hash>  tool.zip" | sha256sum -c -
```

This improves supply chain confidence.

---

## 40. Download-at-Build vs Commit Binary

Sometimes build needs a tool binary.

Options:

1. Use package manager/build plugin.
2. Download from trusted URL with checksum.
3. Store in artifact repository.
4. Commit binary only as last resort.

Bad:

```bash
curl https://random-url/tool.zip | bash
```

Better:

```bash
curl -L -o tool.zip "$TOOL_URL"
echo "$TOOL_SHA256  tool.zip" | sha256sum -c -
```

Best in enterprise:

```text
Mirror tool in internal artifact repository.
```

---

## 41. Repository Cleanup: Current Tree Only

If file is tracked but should not be:

```bash
git rm --cached path/to/file
echo "path/to/file" >> .gitignore
git add .gitignore
git commit -m "Stop tracking generated artifact"
```

For directory:

```bash
git rm -r --cached target/
```

This fixes future commits.

It does not remove history.

---

## 42. Repository Cleanup: History Rewrite Overview

If file is large/sensitive in history, use:

- `git filter-repo`;
- BFG Repo-Cleaner;
- Git LFS migrate.

Example concept:

```bash
git filter-repo --path target/app.jar --invert-paths
```

This rewrites history removing path.

After rewrite:

- all collaborators must re-clone or carefully reset;
- force push required;
- old clones still contain object;
- remote GC may be needed;
- forks/caches may retain data;
- secrets still need rotation.

History rewrite is organizational operation.

Part 028 covers full process.

---

## 43. BFG Repo-Cleaner Overview

BFG is simpler for common cleanup:

- remove large blobs;
- remove passwords text;
- strip blobs over size threshold.

Example concept:

```bash
bfg --strip-blobs-bigger-than 50M repo.git
```

Then:

```bash
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

Use carefully.

Coordinate with team.

---

## 44. `git filter-repo` Overview

`git filter-repo` is modern recommended tool for history rewriting.

Examples:

Remove path:

```bash
git filter-repo --path path/to/big-file --invert-paths
```

Analyze:

```bash
git filter-repo --analyze
```

Rewrite requires clean clone/mirror and coordination.

Do not casually run on active shared repo.

---

## 45. Remote Storage After Cleanup

Even after rewriting and force-pushing:

- hosting provider may retain objects until GC;
- forks may retain old history;
- collaborators may have old clones;
- pull request refs may preserve commits;
- caches/backups may retain data.

If sensitive data leaked:

```text
Assume compromised.
Rotate secrets.
Follow incident process.
```

History rewrite helps reduce future exposure but is not enough for secret/PII incident.

---

## 46. Cost Model of Bloat

Bloat cost is cumulative.

For each large object:

```text
developer clone cost
CI checkout cost
hosting storage cost
backup cost
mirror cost
local disk cost
network cost
maintenance cost
```

Example:

```text
500 MB unnecessary history
100 developers
20 CI cold clones/day
```

Cost multiplies quickly.

Prevention via hooks/CI/policy is cheap compared to cleanup.

---

## 47. Large File Policy Template

A good repo policy:

```text
1. Build outputs must not be committed.
2. Dependency artifacts must be resolved via build tool.
3. Release artifacts must be published to artifact repository.
4. Production data/dumps/logs must not be committed.
5. Files over 10 MB require explicit approval.
6. Binary files require documented purpose and owner.
7. Large legitimate fixtures use Git LFS or approved storage.
8. Generated files are not committed unless policy says so.
9. Secret/PII in Git requires incident response.
10. CI checks enforce large file and forbidden path policy.
```

---

## 48. Java `.gitignore` for Bloat Prevention

```gitignore
# Maven
target/

# Gradle
.gradle/
build/

# Java
*.class

# Build artifacts
*.jar
*.war
*.ear
!gradle/wrapper/gradle-wrapper.jar
!.mvn/wrapper/maven-wrapper.jar

# Archives
*.zip
*.tar
*.tar.gz
*.tgz

# Logs/reports
*.log
logs/
coverage/
jacoco.exec
target/surefire-reports/
target/failsafe-reports/
build/reports/
build/test-results/

# Dumps
*.hprof
heap-dump*.hprof
thread-dump*.txt

# Local env/data
.env
.env.*
*.sqlite
*.db
*.dump
*.sql.gz
```

Adjust for legitimate fixtures.

Do not ignore files that should be tracked, such as migration SQL:

```text
db/migration/*.sql should usually be tracked.
```

Avoid overly broad `*.sql` ignore if repo has migrations.

---

## 49. Binary Review Strategy

When binary file is added/changed in PR:

Ask:

```text
What is it?
Why is it needed?
How big is it?
Is it generated?
Can it be stored elsewhere?
Does it contain sensitive data?
Is license/provenance clear?
How often will it change?
Is Git LFS needed?
Is there a checksum?
Is it in allowlist?
```

Do not rubber-stamp binary additions.

Binary diff gives little information.

---

## 50. Dependency Update vs Binary Commit

If PR adds:

```text
lib/vendor-sdk.jar
```

Ask:

```text
Why not publish to artifact repository?
Can Maven/Gradle resolve it?
What version is it?
What license?
What checksum?
What transitive dependencies?
Who updates it?
```

If vendor only provides jar file:

- upload to internal artifact repository;
- create Maven coordinates;
- document source/license;
- pin checksum if possible.

Git should not be artifact registry.

---

## 51. Large Files in Monorepo

Monorepo amplifies bloat.

One team commits huge files; everyone pays.

Therefore monorepo needs stricter:

- large file hooks;
- CODEOWNERS for binary paths;
- LFS policy;
- artifact policy;
- CI enforcement;
- periodic audit.

In polyrepo, damage is contained to one repo, but still bad.

---

## 52. Large Files and Sparse Checkout

Sparse checkout can hide large files in working tree, but not necessarily solve object history.

If clone downloads full blobs, cost remains.

Partial clone helps more.

But governance still needed.

Do not rely on sparse checkout to compensate for bad file policy.

---

## 53. Large Files and CI Cache

Sometimes teams commit large files to “speed up CI”.

Bad examples:

```text
Commit Maven repository cache.
Commit node_modules.
Commit generated build cache.
Commit packaged dependencies.
```

Better:

- CI cache;
- artifact repository mirror;
- dependency cache;
- remote build cache;
- Docker layer cache;
- Gradle build cache;
- Maven local cache in CI.

Caches are not source of truth.

Do not version caches in Git.

---

## 54. ML Models and Java Services

Some Java services may load ML/rules/model files.

Question:

```text
Is model source code, artifact, or data?
```

If model is built artifact:

- store in model registry/artifact store;
- version model separately;
- include checksum/version in app config;
- deploy model with artifact pipeline.

If small static test model:

- maybe Git LFS.

If model must be released with app:

- package from artifact store during build;
- record provenance.

Avoid committing frequently changing large model binary directly to Git.

---

## 55. Rule Engines and Binary Rule Packages

Java systems may use:

- Drools rule packages;
- decision tables;
- Excel rule files;
- generated rule binaries.

If rule source is text/Excel:

- decide if source is reviewable;
- Excel binary diffs poorly;
- consider CSV/DSL/text format;
- store generated binaries as artifacts.

If regulatory rules need audit, prefer text-based versionable representation when possible.

Binary Excel files in Git can be problematic for review/audit.

---

## 56. Office Documents and PDFs

Docs like PDFs, XLSX, DOCX are binary.

If they are source-of-truth documents, Git can store them, but review is weak.

Alternatives:

- Markdown/AsciiDoc source;
- docs platform;
- artifact/document management system;
- generated PDF from text source.

If PDF is official evidence/spec:

- maybe store in document management system;
- link from repo;
- avoid frequent binary changes in Git.

For regulatory systems, document control may have separate compliance requirements.

---

## 57. Images and Diagrams

Small images in docs are usually fine.

But prefer diagram-as-code where useful:

- Mermaid;
- PlantUML;
- Structurizr DSL;
- Graphviz;
- draw.io XML if reviewable enough.

Binary diagrams can be okay if stable.

Policy:

```text
Small doc images allowed.
Large design assets use LFS or external storage.
```

---

## 58. `git archive` for Source Release

If you need source snapshot:

```bash
git archive --format=tar.gz --output=source.tar.gz HEAD
```

Do not commit the archive back to repo.

Publish it as release asset if needed.

---

## 59. Tags Instead of Artifact Commits

To mark release source:

```bash
git tag -a v1.8.3 -m "Release v1.8.3"
git push origin v1.8.3
```

Then build artifact from tag.

Do not commit:

```text
case-service-1.8.3.jar
```

Tag source, publish binary.

---

## 60. SBOM and Build Metadata

SBOM files may be generated.

Should they be committed?

Usually:

- source repo: no, unless curated policy requires;
- artifact/release: yes, attach SBOM to artifact/release;
- compliance evidence: store in artifact repository or governance system.

If SBOM is generated deterministically and required for release, generate in CI.

Do not commit changing SBOM every build unless it is intentional and reviewed.

---

## 61. Checklist: Before Adding a Large/Binary File

```text
[ ] Is this file source of truth?
[ ] Can it be generated from tracked source?
[ ] Is it a build artifact?
[ ] Is it a dependency?
[ ] Is it a release artifact?
[ ] Does it contain secret/PII/customer data?
[ ] Is it reviewable?
[ ] How large is it?
[ ] How often will it change?
[ ] Does it belong in artifact repository/object storage?
[ ] Should Git LFS be used?
[ ] Is owner/provenance/license documented?
[ ] Is there an allowlist entry?
[ ] Will CI/developers need special setup?
```

---

## 62. Checklist: Repository Bloat Audit

```text
[ ] Run large tracked file scan.
[ ] Run large history blob scan.
[ ] Check tracked jars/wars/ears.
[ ] Check dumps/logs/reports.
[ ] Check generated directories.
[ ] Check binary allowlist.
[ ] Check LFS tracking.
[ ] Check CI checkout time.
[ ] Check clone size.
[ ] Check top packfile size.
[ ] Check old release artifacts in history.
[ ] Check secret/PII risk in large files.
```

Commands:

```bash
git count-objects -vH
git ls-files | grep -E '\.(jar|war|ear|hprof|zip|tar|gz|dump)$'
```

---

## 63. Checklist: Cleaning Current Bad Files

```text
[ ] Identify tracked bad file.
[ ] Add ignore rule.
[ ] Remove from index with git rm --cached.
[ ] Commit cleanup.
[ ] Add hook/CI guard.
[ ] Decide if history rewrite needed.
[ ] If sensitive, rotate/report incident.
```

Command:

```bash
git rm --cached path/to/file
git add .gitignore
git commit -m "Stop tracking generated artifact"
```

---

## 64. Checklist: Deciding History Rewrite

History rewrite may be needed if:

```text
[ ] Secret committed.
[ ] PII/customer data committed.
[ ] Huge files severely bloat repo.
[ ] Legal/license issue.
[ ] Artifact accidentally committed many times.
```

History rewrite may not be worth it if:

```text
[ ] File is small.
[ ] Repo size impact minimal.
[ ] No sensitivity.
[ ] Coordination cost high.
```

If rewriting:

```text
[ ] Announce freeze.
[ ] Backup/mirror.
[ ] Use clean clone.
[ ] Run filter-repo/BFG.
[ ] Verify.
[ ] Force push.
[ ] Instruct re-clone.
[ ] Rotate secrets if needed.
[ ] Ask hosting provider about GC if needed.
```

Part 028 goes deeper.

---

## 65. Case Study 1 — Accidentally Committed Fat JAR

Problem:

```text
target/case-service-1.8.0.jar committed.
Repo clone grows by 120 MB.
```

Immediate fix:

```bash
git rm --cached target/case-service-1.8.0.jar
echo "target/" >> .gitignore
git commit -m "Stop tracking packaged service artifact"
```

If just one recent commit and branch not shared:

```bash
git reset HEAD~1
# recommit without jar
```

If already merged/shared and repo size impact serious:

- evaluate history rewrite;
- coordinate team;
- add hook preventing jars except wrapper jars.

Better release flow:

```text
Tag source.
CI builds jar.
Publish to Nexus/Artifactory.
Record artifact checksum.
```

---

## 66. Case Study 2 — Production SQL Dump in Repo

Problem:

```text
prod-dump.sql.gz committed for local testing.
Contains customer/case data.
```

Response:

```text
1. Treat as data incident.
2. Remove from current tree.
3. Rotate any credentials if present.
4. Assess access exposure.
5. Rewrite history if required.
6. Contact hosting/admin for purge/GC.
7. Replace with synthetic fixture.
8. Add secret/PII scanning and large file guard.
```

Do not say:

```text
We deleted it in next commit, so fine.
```

History still had it.

---

## 67. Case Study 3 — Huge OpenAPI Generated Client

Problem:

```text
Every API change regenerates 30,000 lines.
PRs are unreadable.
Repo grows quickly.
```

Options:

1. Track only `openapi.yaml`, generate client in build.
2. Publish generated client as artifact.
3. Split generated commit from logic commit.
4. Mark generated path in review tooling.
5. Use compatibility diff on spec instead of generated code.
6. Pin generator version.

Best often:

```text
Spec as source of truth.
Generated client as artifact/build output.
```

---

## 68. Case Study 4 — Binary Rule Spreadsheet

Problem:

```text
rules/enforcement-decision-table.xlsx changes often.
Reviewers cannot see meaningful diff.
Regulatory audit needs rule history.
```

Options:

- convert to CSV/text DSL;
- generate spreadsheet from text source;
- use decision model notation with text representation;
- store official spreadsheet in document system and version text extract in Git;
- if Excel must stay, require change log and owner review.

Git can store XLSX, but it is weak for review.

For audit-heavy systems, text-based rules are often more defensible.

---

## 69. Case Study 5 — Large ML Model

Problem:

```text
model.bin 800 MB required by Java scoring service.
```

Do not commit directly.

Options:

- model registry;
- artifact repository;
- object storage with version/checksum;
- container image layer if deployment model supports it;
- Git LFS only if repo-coupled and team accepts cost.

Traceability:

```text
app version -> model version -> model hash -> training data/version -> approval
```

Git source repo should reference model version, not store huge model blindly.

---

## 70. Practical Policy Recommendation for Java Teams

Baseline:

```text
Use Git for:
  - source
  - tests
  - build config
  - migration
  - schema/contract
  - small fixtures
  - docs

Use artifact repository for:
  - jars/wars/ears
  - internal dependencies
  - release bundles
  - SBOM/release metadata
  - generated clients if published

Use container registry for:
  - Docker/OCI images

Use object storage/model registry for:
  - huge datasets
  - ML models
  - large test corpora

Use Git LFS for:
  - legitimate large binary files that must version with repo
```

---

## 71. Mental Model Akhir

Git is not free storage.

Every object you commit becomes part of historical state.

For text source code, that is a feature.

For large binary files, that becomes a cost.

Good engineering asks:

```text
Is this file source, artifact, cache, data, secret, generated output, or evidence?
```

Then choose storage:

```text
source -> Git
artifact -> artifact repository
container -> registry
large data -> object storage/data registry
model -> model registry/artifact store
large repo-coupled binary -> Git LFS
secret -> secret manager, never Git
```

Repository bloat is easier to prevent than remove.

A senior engineer protects repository health like production infrastructure.

---

## 72. Koneksi ke Part Berikutnya

Part ini membahas large files, binary assets, dan repository bloat.

Part berikutnya masuk ke security:

```text
learn-git-mastery-for-java-engineers-part-027.md
```

Topik:

```text
Security: Secret Leakage, Signed Commits, dan Supply Chain
```

Kita akan membahas:

- secret leakage;
- kenapa delete file tidak cukup;
- secret rotation;
- secret scanning;
- `.gitignore` bukan security boundary;
- signed commits;
- signed tags;
- trust chain;
- dependency metadata;
- supply chain security;
- incident response saat credential bocor.

---

## 73. Referensi

Rujukan utama untuk materi ini:

- Git official documentation: Git LFS, gitattributes, git gc, git count-objects, partial clone
- Git LFS documentation and migration concepts
- GitHub/GitLab documentation for LFS checkout and quota behavior
- Maven/Gradle artifact publishing conventions
- Nexus, Artifactory, GitHub Packages, GitLab Package Registry concepts
- Praktik umum repository hygiene, artifact management, SBOM, CI caching, large file prevention, and supply chain traceability

---

## 74. Status Seri

```text
Progress: 026 / 032
Seri belum selesai.
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
```

Bagian berikutnya:

```text
learn-git-mastery-for-java-engineers-part-027.md
```

Topik:

```text
Security: Secret Leakage, Signed Commits, dan Supply Chain
```

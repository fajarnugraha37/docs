# learn-git-mastery-for-java-engineers-part-023.md

# Part 023 — Git Hooks: Automasi Lokal dan Guardrails

> **Seri:** Git Mastery for Java Engineers  
> **Bagian:** 023 / 032  
> **Topik:** Git hooks sebagai guardrails lokal dan server-side untuk formatting, test, commit message, secret scanning, dan repository hygiene  
> **Target pembaca:** Java software engineer yang ingin membangun workflow Git yang aman, cepat, konsisten, dan tidak terlalu bergantung pada ingatan manusia  
> **Status seri:** Belum selesai. Bagian terakhir adalah `learn-git-mastery-for-java-engineers-part-032.md`.

---

## 0. Ringkasan Eksekutif

Git hooks adalah script yang dijalankan Git pada event tertentu.

Contoh event:

```text
Sebelum commit dibuat.
Sebelum commit message diterima.
Sebelum push.
Setelah checkout.
Setelah merge.
Saat server menerima push.
```

Hooks bisa membantu mencegah kesalahan umum:

- commit file build output;
- commit secret;
- commit format code rusak;
- commit message tidak sesuai standar;
- push branch yang belum test;
- push langsung ke branch protected;
- generated code out-of-date;
- migration conflict;
- large file tidak sengaja masuk;
- line ending/whitespace error.

Tetapi hooks juga bisa menjadi beban:

- lambat;
- flaky;
- berbeda antar developer;
- sulit diinstall;
- menghalangi emergency fix;
- menjalankan test terlalu berat;
- bergantung tool yang tidak tersedia;
- membuat developer mencari cara bypass;
- memberi rasa aman palsu karena hooks lokal bisa dilewati.

Mental model utama:

```text
Hooks adalah guardrails, bukan source of truth final.
CI dan branch protection tetap menjadi enforcement utama.
```

Hooks terbaik adalah:

```text
cepat, deterministik, lokal, jelas, mudah diinstall, mudah dijelaskan,
dan hanya memblokir hal yang benar-benar layak diblokir.
```

---

## 1. Kenapa Hooks Penting?

Tanpa automation, developer harus mengingat banyak aturan:

```text
Jangan commit .env.
Jangan commit target/.
Jangan lupa formatter.
Jangan lupa update generated code.
Jangan lupa test kecil.
Jangan lupa commit message pakai ticket.
Jangan push force sembarangan.
Jangan commit file besar.
```

Manusia lupa.

Apalagi saat:

- context switching;
- incident hotfix;
- deadline;
- merge conflict;
- pairing;
- onboarding engineer baru;
- perubahan tooling;
- repository besar.

Hooks mengubah aturan menjadi mekanisme.

Contoh:

```text
Daripada berharap semua orang ingat menjalankan `./gradlew spotlessApply`,
pre-commit hook bisa menjalankan formatter/check cepat.
```

Namun hooks tidak boleh menggantikan judgement.

Hooks menjawab:

```text
Apakah perubahan ini melewati rule mekanis dasar?
```

Bukan:

```text
Apakah desain ini benar?
Apakah rule bisnis aman?
Apakah migration production-ready?
Apakah concurrency invariant terjaga?
```

---

## 2. Jenis Git Hooks

Git hooks dibagi dua kelompok besar:

```text
Client-side hooks
Server-side hooks
```

## 2.1 Client-Side Hooks

Berjalan di mesin developer.

Contoh:

- `pre-commit`
- `prepare-commit-msg`
- `commit-msg`
- `post-commit`
- `pre-rebase`
- `pre-push`
- `post-checkout`
- `post-merge`

Biasanya digunakan untuk:

- formatting;
- lint;
- commit message validation;
- secret scan lokal;
- prevent large file;
- test cepat;
- generated code check.

Kelemahan:

```text
Developer bisa bypass dengan --no-verify.
Tidak otomatis terinstall kecuali ada hook manager/setup.
Environment tiap developer berbeda.
```

## 2.2 Server-Side Hooks

Berjalan di server Git.

Contoh:

- `pre-receive`
- `update`
- `post-receive`

Biasanya digunakan untuk:

- reject push ke protected branch;
- enforce commit signature;
- enforce branch naming;
- block secret;
- block large file;
- enforce policy organisasi.

Di platform seperti GitHub/GitLab/Bitbucket, banyak fungsi server-side digantikan oleh:

- branch protection rules;
- required checks;
- push rules;
- protected branches;
- CODEOWNERS;
- signed commit enforcement;
- secret scanning;
- merge checks.

Server-side enforcement lebih kuat karena tidak bisa dibypass developer lokal.

---

## 3. Lokasi Hooks

Default hooks ada di:

```text
.git/hooks/
```

Saat `git init`, biasanya ada sample hooks:

```text
.git/hooks/pre-commit.sample
.git/hooks/commit-msg.sample
```

Agar aktif, hook harus:

1. punya nama tepat tanpa `.sample`;
2. executable;
3. exit `0` untuk sukses;
4. exit non-zero untuk gagal.

Contoh:

```bash
cp .git/hooks/pre-commit.sample .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

Masalah:

```text
.git/hooks/ tidak di-track oleh Git.
```

Jadi jika Anda membuat hook di `.git/hooks`, hook itu hanya ada di mesin Anda.

Untuk tim, perlu strategi distribusi.

---

## 4. `core.hooksPath`

Git mendukung konfigurasi lokasi hooks:

```bash
git config core.hooksPath .githooks
```

Lalu repository bisa punya:

```text
.githooks/
  pre-commit
  commit-msg
  pre-push
```

Track directory:

```bash
git add .githooks
git commit -m "Add shared Git hooks"
```

Setelah clone, developer perlu menjalankan:

```bash
git config core.hooksPath .githooks
```

Bisa dibuat script setup:

```bash
./scripts/setup-dev.sh
```

Isi:

```bash
#!/usr/bin/env bash
set -euo pipefail

git config core.hooksPath .githooks
echo "Git hooks installed from .githooks"
```

Kelebihan:

- hooks versioned;
- mudah direview;
- konsisten;
- tidak bergantung copy manual ke `.git/hooks`.

Kekurangan:

- perlu setup satu kali;
- tidak enforced jika developer tidak menjalankan setup;
- masih bisa bypass.

---

## 5. Exit Code Hook

Konvensi:

```text
exit 0     = allow operation
exit != 0  = block operation
```

Contoh minimal `pre-commit`:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Running pre-commit checks..."
./mvnw -q -DskipTests compile
```

Jika Maven compile gagal, hook gagal, commit diblokir.

Tetapi hook yang menjalankan compile penuh mungkin terlalu lambat.

Better:

```text
pre-commit: cepat, staged-file based
pre-push: lebih berat
CI: final full verification
```

---

## 6. Hook Bisa Di-bypass

Client-side hook bisa dilewati:

```bash
git commit --no-verify
git push --no-verify
```

Ini bukan bug.

Kadang memang perlu:

- emergency hotfix;
- hook rusak;
- false positive;
- environment lokal belum siap;
- perubahan docs tidak perlu test berat.

Karena itu:

```text
Jangan menaruh enforcement kritikal hanya di client-side hook.
```

Rule penting seperti:

- no direct push main;
- required tests;
- no secret;
- protected release branch;
- signed release tags;

harus ditegakkan di server/CI/platform, bukan hanya local hook.

---

## 7. Prinsip Desain Hook yang Baik

Hook yang baik:

```text
[ ] Cepat.
[ ] Deterministik.
[ ] Output jelas.
[ ] Bisa dijalankan manual.
[ ] Tidak membutuhkan network jika tidak perlu.
[ ] Tidak mengubah file diam-diam tanpa memberi tahu.
[ ] Memeriksa staged files, bukan seluruh repo, jika cocok.
[ ] Tidak menjalankan test berat di pre-commit.
[ ] Punya escape hatch yang wajar.
[ ] Didukung CI equivalent.
[ ] Terdokumentasi.
```

Hook buruk:

```text
[ ] Lambat 5 menit setiap commit.
[ ] Flaky.
[ ] Bergantung VPN.
[ ] Mengubah file tapi tidak men-stage ulang.
[ ] Error message obscure.
[ ] Berbeda antar OS.
[ ] Memblokir docs commit karena test integration gagal.
[ ] Tidak bisa dijalankan manual.
[ ] Hanya ada di laptop satu orang.
```

Tujuan hook bukan mengganggu developer.

Tujuan hook adalah menangkap kesalahan murah sedini mungkin.

---

## 8. Pre-Commit Hook

`pre-commit` berjalan sebelum commit dibuat.

Cocok untuk:

- whitespace check;
- staged file hygiene;
- secret pattern scan;
- large file check;
- formatter check cepat;
- lint cepat;
- generated code drift check ringan;
- no forbidden file paths;
- no debug statement tertentu;
- no conflict marker.

Tidak cocok untuk:

- full integration test;
- long-running test suite;
- deployment;
- remote calls;
- flaky checks;
- policy kompleks yang hanya bisa diketahui CI.

Contoh skeleton:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Running pre-commit checks..."

git diff --cached --check

echo "Pre-commit checks passed."
```

---

## 9. Pre-Commit: Block Conflict Markers

Conflict marker sering tidak sengaja ter-commit:

```text
<<<<<<< HEAD
=======
>>>>>>> branch
```

Hook:

```bash
#!/usr/bin/env bash
set -euo pipefail

if git diff --cached --name-only --diff-filter=ACM |
  xargs grep -n -E '^(<<<<<<<|=======|>>>>>>>)' 2>/dev/null; then
  echo "Error: conflict markers found in staged files."
  exit 1
fi
```

Masalah:

- pattern `=======` bisa muncul legitimate di Markdown/text.
- Lebih baik batasi pada source/config tertentu.

Versi lebih aman:

```bash
FILES=$(git diff --cached --name-only --diff-filter=ACM |
  grep -E '\.(java|kt|xml|yml|yaml|properties|sql|sh|gradle|kts)$' || true)

if [ -n "$FILES" ]; then
  if echo "$FILES" | xargs grep -n -E '^(<<<<<<<|=======|>>>>>>>)' 2>/dev/null; then
    echo "Error: conflict markers found."
    exit 1
  fi
fi
```

---

## 10. Pre-Commit: Block Build Outputs

Untuk Java repo:

```bash
#!/usr/bin/env bash
set -euo pipefail

FORBIDDEN='(^target/|^build/|\.class$|\.log$|\.hprof$)'

if git diff --cached --name-only | grep -E "$FORBIDDEN"; then
  echo "Error: generated/build/runtime files are staged."
  echo "Remove them from the commit or update .gitignore."
  exit 1
fi
```

Tambahkan exception jika perlu.

Jangan lupa:

```text
Gradle wrapper jar dan Maven wrapper jar mungkin legitimate.
```

Jika block semua `.jar`, beri exception:

```bash
if git diff --cached --name-only |
  grep -E '\.jar$' |
  grep -v -E '(^gradle/wrapper/gradle-wrapper.jar$|^\.mvn/wrapper/maven-wrapper.jar$)'; then
  echo "Error: jar files should not be committed except wrapper jars."
  exit 1
fi
```

---

## 11. Pre-Commit: Large File Check

File besar bisa membuat repo bloat.

Hook:

```bash
#!/usr/bin/env bash
set -euo pipefail

MAX_BYTES=$((5 * 1024 * 1024))

git diff --cached --name-only --diff-filter=ACM | while read -r file; do
  [ -f "$file" ] || continue

  size=$(wc -c < "$file")

  if [ "$size" -gt "$MAX_BYTES" ]; then
    echo "Error: $file is larger than $MAX_BYTES bytes."
    echo "Use artifact storage or Git LFS if appropriate."
    exit 1
  fi
done
```

Caveat:

```text
This checks working tree file size, not blob size in all edge cases.
```

Still useful as local guardrail.

CI/server-side should enforce real policy.

---

## 12. Pre-Commit: Secret Scan Sederhana

Secret scanning dengan regex sederhana tidak cukup, tetapi bisa menangkap kesalahan kasar.

Contoh:

```bash
#!/usr/bin/env bash
set -euo pipefail

PATTERN='(password\s*=|secret\s*=|api[_-]?key\s*=|BEGIN RSA PRIVATE KEY|BEGIN PRIVATE KEY)'

FILES=$(git diff --cached --name-only --diff-filter=ACM || true)

if [ -n "$FILES" ]; then
  if echo "$FILES" | xargs grep -n -i -E "$PATTERN" 2>/dev/null; then
    echo "Potential secret found in staged files."
    echo "If false positive, document and use approved allowlist process."
    exit 1
  fi
fi
```

Better tools:

- gitleaks;
- detect-secrets;
- trufflehog;
- GitHub secret scanning;
- GitLab secret detection;
- pre-commit framework hooks.

Important:

```text
If secret is committed, deleting it in next commit is not enough.
Rotate secret.
```

---

## 13. Pre-Commit: Whitespace Check

Simple:

```bash
git diff --cached --check
```

Hook:

```bash
#!/usr/bin/env bash
set -euo pipefail

git diff --cached --check
```

This catches:

- trailing whitespace;
- space before tab;
- whitespace errors recognized by Git.

Not complete, but cheap.

---

## 14. Pre-Commit: Formatter

Two strategies:

```text
A. Check only: fail if not formatted.
B. Auto-format: modify files automatically.
```

## 14.1 Check Only

Gradle:

```bash
./gradlew spotlessCheck
```

Maven:

```bash
./mvnw spotless:check
```

Potential issue: whole repo check may be slow.

Use staged-file-based tools if available.

## 14.2 Auto-Format

Gradle:

```bash
./gradlew spotlessApply
```

Maven:

```bash
./mvnw spotless:apply
```

If hook auto-formats, developer must re-stage changed files.

Hook should explain:

```bash
echo "Formatting applied. Please review and re-stage changed files."
exit 1
```

Do not silently modify and commit unexpected changes.

---

## 15. Pre-Commit: Staged Java Formatting Caveat

Many Java formatters operate on files, not staged hunks.

If developer staged only part of a file, formatter may modify unstaged parts.

This creates confusion.

Options:

1. Disallow partial staging for formatted files.
2. Use tooling that handles staged content.
3. Run formatter manually before staging.
4. Use check-only in hook, apply in IDE/build.
5. Accept re-stage workflow.

For senior workflow, be aware:

```text
Formatting hook can destroy carefully curated partial commits if poorly designed.
```

---

## 16. Commit Message Hook

`commit-msg` receives path to temporary commit message file.

Cocok untuk:

- Conventional Commits;
- ticket ID requirement;
- minimum message quality;
- no empty/vague subject;
- subject length;
- branch-name-to-ticket consistency.

Example:

```bash
#!/usr/bin/env bash
set -euo pipefail

MSG_FILE="$1"
SUBJECT="$(head -n1 "$MSG_FILE")"

if ! echo "$SUBJECT" | grep -Eq '^(feat|fix|docs|refactor|test|chore|build|ci|perf)(\([a-z0-9._-]+\))?: .+'; then
  echo "Invalid commit message."
  echo "Expected: type(scope): subject"
  echo "Example: fix(case): handle pending review escalation"
  exit 1
fi
```

This enforces format, not quality.

A message can be syntactically valid and still useless:

```text
fix(case): fix bug
```

Commit policy needs human review too.

---

## 17. Conventional Commits: Useful but Not Magic

Conventional Commits example:

```text
feat(case): add escalation override for supervisors
fix(api): preserve statusReason in case response
refactor(workflow): extract transition policy
test(case): cover closed-case escalation rejection
build(gradle): enable dependency locking
```

Benefits:

- changelog generation;
- release automation;
- semantic versioning hints;
- commit scanning;
- consistency.

Limitations:

- does not explain intent deeply;
- can become ceremony;
- type can be wrong;
- subject can still be vague;
- not enough for complex regulated change.

For important changes, use body:

```text
fix(case): block enforcement action while review is pending

Escalation remains allowed for supervisors because escalation is not an
enforcement action. This preserves the transition invariant introduced in
CASE-1842.

Refs: CASE-2091
```

---

## 18. Prepare-Commit-Msg Hook

`prepare-commit-msg` runs before editor opens.

Useful for auto-inserting ticket ID from branch name.

Branch:

```text
feature/CASE-1842-escalation-guard
```

Hook:

```bash
#!/usr/bin/env bash
set -euo pipefail

MSG_FILE="$1"
COMMIT_SOURCE="${2:-}"

# Do not modify merge/squash commit messages
if [ "$COMMIT_SOURCE" = "merge" ] || [ "$COMMIT_SOURCE" = "squash" ]; then
  exit 0
fi

BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
TICKET="$(echo "$BRANCH" | grep -oE '[A-Z]+-[0-9]+' | head -n1 || true)"

if [ -n "$TICKET" ] && ! grep -q "$TICKET" "$MSG_FILE"; then
  sed -i.bak "1s/^/[$TICKET] /" "$MSG_FILE"
  rm -f "$MSG_FILE.bak"
fi
```

Caveat:

- `sed -i` differs between GNU/macOS.
- Example above uses `.bak` for portability.

---

## 19. Pre-Push Hook

`pre-push` runs before push.

Cocok untuk checks lebih berat:

- unit tests;
- compile;
- generated code drift;
- branch naming;
- prevent push to protected branch;
- secret scan staged/commits;
- no fixup commits;
- no WIP commits.

Example:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Running pre-push checks..."
./mvnw -q test
```

But beware:

```text
If test suite takes 20 minutes, developers will bypass.
```

Better:

- run fast unit test locally;
- rely on CI for full suite;
- allow explicit skip with reason if needed.

---

## 20. Pre-Push: Prevent Direct Push to Main

Local guardrail:

```bash
#!/usr/bin/env bash
set -euo pipefail

BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || true)"

if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  echo "Direct push from $BRANCH is blocked locally."
  echo "Use a feature branch and PR."
  exit 1
fi
```

But true enforcement must be server-side branch protection.

Local hook only catches accidents.

---

## 21. Pre-Push: Block Fixup/Squash Commits

Before pushing PR branch:

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE_BRANCH:-origin/main}"

if git log --oneline "$BASE"..HEAD | grep -E 'fixup!|squash!|WIP'; then
  echo "Found fixup/squash/WIP commits. Clean history before push."
  exit 1
fi
```

Caveat:

- Some teams allow fixup commits in draft PR.
- Better enforce before merge, not always before push.
- Could be too strict for stacked/draft workflows.

Make policy explicit.

---

## 22. Pre-Push: Generated Code Drift

If generated code is tracked:

```bash
#!/usr/bin/env bash
set -euo pipefail

./gradlew generateOpenApi

if ! git diff --quiet; then
  echo "Generated code is out of date."
  echo "Run ./gradlew generateOpenApi and commit changes."
  git diff --stat
  exit 1
fi
```

This is strong but can be annoying if generator is slow.

Alternative: CI only.

If local hook exists, ensure it is not too slow.

---

## 23. Post-Checkout and Post-Merge Hooks

These run after checkout/merge.

Useful for:

- reminding dependency install/update;
- regenerating files;
- updating submodules;
- showing warnings after branch change;
- running lightweight setup.

Example:

```bash
#!/usr/bin/env bash
set -euo pipefail

if git diff --name-only HEAD@{1} HEAD 2>/dev/null | grep -E 'pom.xml|build.gradle|gradle/libs.versions.toml'; then
  echo "Build/dependency files changed. Consider refreshing your IDE/build."
fi
```

Be careful:

```text
Post hooks should not surprise developer by running heavy tasks automatically.
```

---

## 24. Pre-Rebase Hook

Can prevent risky rebases.

Use cases:

- block rebase of protected branches;
- warn before rebasing public branches;
- enforce clean working tree.

Example:

```bash
#!/usr/bin/env bash
set -euo pipefail

BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || true)"

case "$BRANCH" in
  main|master|release/*)
    echo "Rebasing protected branch $BRANCH is blocked."
    exit 1
    ;;
esac
```

But teams that use rebase heavily may find this intrusive.

Server policy and education often better.

---

## 25. Server-Side Hooks and Platform Rules

On self-hosted Git, server hooks can reject pushes.

On GitHub/GitLab/Bitbucket, prefer platform features:

- protected branches;
- required reviews;
- required status checks;
- signed commits/tags;
- secret scanning;
- push rules;
- CODEOWNERS;
- merge queue;
- linear history requirement;
- squash/rebase/merge strategy restrictions.

Server-side is where real enforcement belongs.

Client-side hooks are convenience.

---

## 26. Hooks vs CI

Hooks:

```text
Fast feedback before commit/push.
Run on developer machine.
Can be bypassed.
May differ by environment.
```

CI:

```text
Authoritative verification after push/PR.
Runs in controlled environment.
Can be required before merge.
Harder to bypass.
```

Recommended split:

| Check | Hook | CI |
|---|---:|---:|
| Whitespace | Yes | Yes |
| Secret scan | Yes | Yes |
| Format check | Maybe | Yes |
| Unit tests small | Maybe | Yes |
| Full unit tests | Pre-push maybe | Yes |
| Integration tests | Usually no | Yes |
| Build/package | Pre-push maybe | Yes |
| Branch protection | Local warning | Yes/server |
| Commit message | Yes | Maybe |
| Generated code drift | Maybe | Yes |
| Dependency vulnerability scan | Usually no | Yes |
| License scan | Usually no | Yes |

Rule:

```text
If it matters, CI enforces it.
If it is cheap, hooks catch it earlier.
```

---

## 27. Hook Managers

Manual hooks are possible, but hook managers improve team adoption.

Popular options:

- pre-commit framework;
- Husky for Node-heavy repos;
- Lefthook;
- Overcommit;
- pre-commit-hooks;
- Maven/Gradle plugins or scripts;
- custom `.githooks` with `core.hooksPath`.

For Java-only repo, simple `.githooks` may be enough.

For polyglot repo, `pre-commit` framework or Lefthook can be better.

Criteria:

```text
[ ] Cross-platform support.
[ ] Fast.
[ ] Easy install.
[ ] Tool versions pinned.
[ ] Works in CI.
[ ] Does not require global state too much.
[ ] Supports staged-file checks.
```

---

## 28. `pre-commit` Framework Example

Config file:

```yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: vX.Y.Z
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-merge-conflict
      - id: check-yaml
      - id: check-added-large-files
```

Install:

```bash
pre-commit install
```

Run manually:

```bash
pre-commit run --all-files
```

For Java formatting, integrate tool-specific commands carefully.

Pros:

- reusable hooks;
- staged-file aware;
- versions pinned;
- broad ecosystem.

Cons:

- Python dependency;
- another tool to install;
- network at setup;
- Java-specific build integration may still need custom hooks.

---

## 29. Lefthook Example

`lefthook.yml`:

```yaml
pre-commit:
  commands:
    whitespace:
      run: git diff --cached --check
    forbid-build-output:
      run: scripts/check-staged-files.sh

pre-push:
  commands:
    test:
      run: ./gradlew test
```

Pros:

- fast;
- cross-platform;
- simple config;
- good for polyglot repos.

Cons:

- requires binary/tool installation.

---

## 30. Custom `.githooks` Example Layout

```text
.githooks/
  pre-commit
  commit-msg
  pre-push
scripts/
  git-hooks/
    check-staged-files.sh
    check-commit-message.sh
    check-no-secrets.sh
    check-generated-code.sh
scripts/
  setup-dev.sh
```

Hook delegates to scripts:

```bash
#!/usr/bin/env bash
set -euo pipefail

scripts/git-hooks/check-staged-files.sh
scripts/git-hooks/check-no-secrets.sh
git diff --cached --check
```

Why delegate?

- easier to test scripts manually;
- hooks stay small;
- scripts can be used in CI;
- logic versioned cleanly.

---

## 31. Cross-Platform Hook Writing

Hooks often fail cross-platform.

Avoid:

- Linux-only commands if Windows developers use Git Bash inconsistently;
- GNU-specific `sed -i`;
- assumptions about `/bin/bash`;
- hardcoded `/usr/local/bin`;
- path with backslash;
- tool not installed.

Use:

```bash
#!/usr/bin/env bash
set -euo pipefail
```

But ensure developers have Bash.

For pure Java repo, another option:

```text
Make hooks call ./mvnw or ./gradlew tasks.
```

Build tool handles platform better.

Example:

```bash
./gradlew preCommitCheck
```

Then define logic in Gradle.

---

## 32. Hooks in Java Build Tool

Instead of complex shell hook:

```bash
#!/usr/bin/env bash
set -euo pipefail
./gradlew preCommitCheck
```

Gradle:

```kotlin
tasks.register("preCommitCheck") {
    dependsOn("spotlessCheck")
    dependsOn("test")
}
```

But this can be slow.

Better:

```kotlin
tasks.register("preCommitCheck") {
    dependsOn("spotlessCheck")
}
```

Pre-push:

```kotlin
tasks.register("prePushCheck") {
    dependsOn("test")
}
```

Maven profiles can also help:

```bash
./mvnw -q -Ppre-commit spotless:check
./mvnw -q -Ppre-push test
```

---

## 33. Hook Performance Strategy

Performance budget:

```text
pre-commit: ideally < 5 seconds, max maybe 10-15 seconds
commit-msg: near instant
pre-push: can be longer, but avoid excessive delay
CI: full verification
```

Optimizations:

- check only staged files;
- run formatter only on changed files if tool supports;
- avoid network;
- avoid full integration tests;
- cache tool downloads;
- use build daemon carefully;
- avoid `clean` in local hook;
- let CI do heavyweight checks.

If hook is too slow, developers will bypass it.

---

## 34. Hook Output UX

Bad output:

```text
Error 1
```

Good output:

```text
Error: .env is staged.

Why this is blocked:
  Local environment files may contain secrets and machine-specific config.

How to fix:
  git restore --staged .env
  echo ".env" >> .gitignore

If this is intentional:
  Discuss with maintainers; do not bypass without reason.
```

Hooks are part of developer experience.

Error messages should teach and unblock.

---

## 35. Hooks and Partial Staging

Partial staging is common for clean commits.

Example:

```bash
git add -p
```

Hook that modifies full files can break this.

If pre-commit auto-format modifies file, staged content and working tree diverge.

Safer options:

- check only, don't modify;
- fail with instruction to format manually;
- use staged-aware formatter;
- warn when partially staged file exists.

Detect partially staged files:

```bash
STAGED=$(git diff --cached --name-only)
UNSTAGED=$(git diff --name-only)

comm -12 <(echo "$STAGED" | sort) <(echo "$UNSTAGED" | sort)
```

If overlap, be careful.

---

## 36. Hooks and Generated Code

Generated code policy determines hook behavior.

If generated code is not tracked:

```text
Hook only needs to ensure build can generate it.
```

If generated code is tracked:

```text
Hook/CI can regenerate and assert no diff.
```

Local pre-commit may be too slow.

CI is safer.

A pre-push hook could run:

```bash
./gradlew generateSources
git diff --exit-code
```

But communicate clearly.

---

## 37. Hooks and Database Migrations

Common guardrails:

- prevent duplicate Flyway version;
- enforce timestamp naming;
- block modification of released migrations;
- validate migration naming convention;
- run migration check.

Example naming check:

```bash
#!/usr/bin/env bash
set -euo pipefail

FILES=$(git diff --cached --name-only --diff-filter=ACM |
  grep -E 'db/migration/.*\.sql$' || true)

if [ -z "$FILES" ]; then
  exit 0
fi

if echo "$FILES" | grep -v -E 'V[0-9]{14}__[a-z0-9_]+\.sql$'; then
  echo "Migration file names must match VyyyyMMddHHmmss__description.sql"
  exit 1
fi
```

Modification of old migrations is harder because hook needs know release boundary.

CI/server-side better.

---

## 38. Hooks and Branch Naming

Branch naming policy:

```text
feature/CASE-123-short-description
fix/CASE-456-bug-name
hotfix/CASE-789-production-issue
```

Pre-push hook:

```bash
#!/usr/bin/env bash
set -euo pipefail

BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || true)"

if ! echo "$BRANCH" | grep -Eq '^(feature|fix|hotfix|chore|refactor)/[A-Z]+-[0-9]+-[a-z0-9-]+$'; then
  echo "Branch name does not follow convention:"
  echo "  feature/CASE-123-short-description"
  exit 1
fi
```

Caveats:

- emergency branches;
- dependency bot branches;
- release branches;
- personal spikes.

Allow exceptions:

```bash
case "$BRANCH" in
  main|master|release/*|dependabot/*)
    exit 0
    ;;
esac
```

---

## 39. Hooks and Signed Commits

Signed commits are usually enforced by platform/server, not local hook.

Local hook can warn:

```bash
git config commit.gpgsign
```

But real enforcement:

- GitHub/GitLab branch rule;
- protected branch requiring signed commits;
- CI verification;
- server-side hook.

Local hook cannot prove remote policy.

Part 027 will cover signed commits/tags in security context.

---

## 40. Hooks and Secrets: Realistic Policy

Layered defense:

```text
1. .gitignore for obvious local env files.
2. Pre-commit secret scan.
3. CI secret scan.
4. Platform secret scanning.
5. Server-side push protection if available.
6. Incident response: rotate if leaked.
```

Never say:

```text
We have a hook, so secrets cannot leak.
```

Correct:

```text
Hooks reduce probability.
Response process handles failure.
```

---

## 41. Hooks and Emergency Hotfix

Hooks can obstruct urgent fix.

Policy:

```text
--no-verify allowed only when:
- hook is broken/flaky, or
- emergency requires bypass,
- and CI/server checks still run,
- and reason is documented if needed.
```

Do not shame bypass itself.

Shame relying on bypass as routine workflow.

If many developers bypass daily, hooks are badly designed.

---

## 42. Hooks in Regulated/Enterprise Systems

In regulated environments, hooks can support evidence and process, but they are not sufficient.

Useful guardrails:

- commit message includes ticket ID;
- branch name includes change request ID;
- migration naming valid;
- no local secrets;
- no direct main push;
- generated evidence/checklists included.

But compliance enforcement should rely on:

- branch protection;
- required review;
- CI logs;
- artifact provenance;
- deployment approvals;
- signed tags/releases;
- audit trail.

Client hooks do not provide strong audit evidence because they are local and bypassable.

---

## 43. Example: Complete Minimal `.githooks/pre-commit`

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Running pre-commit checks..."

# Whitespace errors
git diff --cached --check

# Block conflict markers in common source/config files
FILES=$(git diff --cached --name-only --diff-filter=ACM |
  grep -E '\.(java|kt|xml|yml|yaml|properties|sql|sh|gradle|kts)$' || true)

if [ -n "$FILES" ]; then
  if echo "$FILES" | xargs grep -n -E '^(<<<<<<<|=======|>>>>>>>)' 2>/dev/null; then
    echo "Error: conflict markers found."
    exit 1
  fi
fi

# Block obvious generated/local files
if git diff --cached --name-only |
  grep -E '(^target/|^build/|\.class$|\.log$|\.hprof$|^\.env$)'; then
  echo "Error: generated/local/runtime files are staged."
  exit 1
fi

# Block jar except wrappers
if git diff --cached --name-only |
  grep -E '\.jar$' |
  grep -v -E '(^gradle/wrapper/gradle-wrapper.jar$|^\.mvn/wrapper/maven-wrapper.jar$)'; then
  echo "Error: jar files should not be committed except wrapper jars."
  exit 1
fi

echo "Pre-commit checks passed."
```

---

## 44. Example: `.githooks/commit-msg`

```bash
#!/usr/bin/env bash
set -euo pipefail

MSG_FILE="$1"
SUBJECT="$(head -n1 "$MSG_FILE")"

if [ -z "$SUBJECT" ]; then
  echo "Commit subject cannot be empty."
  exit 1
fi

if [ "${#SUBJECT}" -gt 100 ]; then
  echo "Commit subject too long (${#SUBJECT} > 100)."
  exit 1
fi

if ! echo "$SUBJECT" | grep -Eq '^(feat|fix|docs|refactor|test|chore|build|ci|perf)(\([a-z0-9._-]+\))?: .+'; then
  echo "Invalid commit message format."
  echo "Expected: type(scope): subject"
  echo "Example: fix(case): handle pending review escalation"
  exit 1
fi
```

---

## 45. Example: `.githooks/pre-push`

```bash
#!/usr/bin/env bash
set -euo pipefail

BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || true)"

case "$BRANCH" in
  main|master)
    echo "Direct push from $BRANCH is blocked locally."
    echo "Use a feature branch and PR."
    exit 1
    ;;
esac

if git log --oneline origin/main..HEAD 2>/dev/null | grep -E 'fixup!|squash!|WIP'; then
  echo "Found fixup/squash/WIP commits."
  echo "Clean up history before pushing or use draft policy explicitly."
  exit 1
fi

echo "Running fast test suite before push..."
./mvnw -q test
```

Adjust for Gradle:

```bash
./gradlew test
```

---

## 46. Example: Setup Script

`scripts/setup-dev.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

git config core.hooksPath .githooks

chmod +x .githooks/pre-commit || true
chmod +x .githooks/commit-msg || true
chmod +x .githooks/pre-push || true

echo "Git hooks configured from .githooks"
```

Document:

```bash
./scripts/setup-dev.sh
```

Run after clone.

---

## 47. CI Equivalent

Do not rely only on hooks.

CI job:

```bash
git diff --check

./mvnw -q test

# Optional: secret scan
gitleaks detect --source . --no-git
```

Generated drift:

```bash
./mvnw -q generate-sources
git diff --exit-code
```

Format:

```bash
./mvnw spotless:check
```

Or Gradle:

```bash
./gradlew spotlessCheck test
```

CI should be authoritative.

---

## 48. Decision Matrix: What Goes Where?

| Check | pre-commit | commit-msg | pre-push | CI |
|---|---:|---:|---:|---:|
| Whitespace | Yes | No | Maybe | Yes |
| Conflict markers | Yes | No | Maybe | Yes |
| Secret scan | Yes | No | Maybe | Yes |
| Large file | Yes | No | Maybe | Yes |
| Commit message format | No | Yes | No | Maybe |
| Branch naming | No | No | Yes | Maybe/server |
| Formatter check | Maybe | No | Maybe | Yes |
| Unit test small | Maybe | No | Yes | Yes |
| Full test suite | No | No | Maybe | Yes |
| Integration test | No | No | Usually no | Yes |
| Generated code drift | Maybe | No | Maybe | Yes |
| Dependency vulnerability | No | No | No | Yes |
| License scan | No | No | No | Yes |
| Branch protection | Local warning | No | Local warning | Server |

---

## 49. Anti-Patterns

## 49.1 Slow Pre-Commit Hook

If every commit takes minutes, developers stop committing small atomic changes.

Bad:

```bash
./mvnw clean verify
docker compose up integration-tests
```

in `pre-commit`.

Better:

```text
pre-commit: whitespace + secrets + staged hygiene
pre-push: fast tests
CI: full verify
```

## 49.2 Hook Only on One Developer Machine

Not a team policy.

## 49.3 Hook Without CI Equivalent

False sense of safety.

## 49.4 Hook Modifies Files Silently

Dangerous.

## 49.5 Hook Requires Network

Flaky and slow.

## 49.6 Hook Blocks Legitimate Emergency Without Escape

Creates bad incentives.

## 49.7 Regex Secret Scan with No Incident Process

Detection without response is incomplete.

## 49.8 Enforcing Ceremony Without Value

Commit message rules should support traceability/release automation, not cargo cult.

---

## 50. Practical Hook Policy for Java Teams

A good baseline:

```text
pre-commit:
  - git diff --cached --check
  - block conflict markers
  - block target/build/class/log/env
  - block large files
  - lightweight secret scan

commit-msg:
  - enforce reasonable subject format
  - optionally require ticket ID

pre-push:
  - block direct main push locally
  - block fixup/WIP commits if branch is ready
  - run fast unit tests

CI:
  - full build
  - full test
  - formatting check
  - generated code drift
  - secret scan
  - dependency/security scan
  - branch protection/required checks
```

---

## 51. Hooks for Monorepo

Monorepo hooks need selective execution.

Bad:

```text
Every commit in docs runs all tests for all services.
```

Better:

- detect changed paths;
- run only relevant checks;
- use build tool affected-project logic;
- keep CI authoritative.

Example:

```bash
CHANGED=$(git diff --cached --name-only)

if echo "$CHANGED" | grep -q '^services/case-service/'; then
  ./gradlew :services:case-service:spotlessCheck
fi
```

Caveat:

```text
Shared library changes may affect many modules.
```

Affected logic must understand dependency graph or be conservative.

---

## 52. Hooks for Polyrepo

In polyrepo, each repo can have:

- local hooks;
- shared hook template;
- organization-wide hook package;
- platform branch rules.

Risk:

```text
Rules drift across repos.
```

Mitigation:

- shared scripts versioned as template;
- central engineering standards;
- CI reusable workflows;
- documented baseline;
- avoid over-customizing each repo.

---

## 53. Hooks and Developer Trust

Developer trust matters.

Hooks should explain:

```text
What failed?
Why does it matter?
How to fix?
How to bypass responsibly if needed?
```

If hooks often produce false positives, developers will distrust them.

If hooks are fast and helpful, developers appreciate them.

A hook is part of the engineering product.

---

## 54. Latihan Praktis

## Latihan 1 — Buat Shared Hooks

Di repo lab:

```bash
mkdir .githooks
cat > .githooks/pre-commit <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
git diff --cached --check
SCRIPT
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
```

Buat trailing whitespace dan coba commit.

## Latihan 2 — Block `.env`

Tambahkan ke `pre-commit`:

```bash
if git diff --cached --name-only | grep -E '^\.env$'; then
  echo "Do not commit .env"
  exit 1
fi
```

Test.

## Latihan 3 — Commit Message Hook

Buat `commit-msg` yang enforce:

```text
type(scope): subject
```

Coba commit message valid dan invalid.

## Latihan 4 — Pre-Push Test

Buat `pre-push`:

```bash
./mvnw -q test
```

atau:

```bash
./gradlew test
```

Ukur waktu.

Tentukan apakah layak untuk tim.

## Latihan 5 — Hook UX

Buat error message hook yang menjelaskan:

```text
apa gagal
kenapa penting
cara fix
```

Bandingkan dengan error message pendek.

## Latihan 6 — CI Equivalent

Ambil semua check lokal penting dan buat command CI yang setara.

Jawab:

```text
Jika developer bypass hook, apakah CI tetap menangkap masalah?
```

---

## 55. Pertanyaan Reflektif

1. Kesalahan apa yang paling sering masuk PR tim Anda?
2. Apakah kesalahan itu bisa dicegah murah dengan hook?
3. Apakah hook akan terlalu lambat?
4. Apakah check tersebut juga ada di CI?
5. Apakah hook bisa berjalan di Windows/macOS/Linux?
6. Apakah hook bergantung pada network/VPN?
7. Apakah error message cukup membantu?
8. Apakah generated code policy perlu hook?
9. Apakah commit message policy punya tujuan nyata?
10. Apakah secret scanning lokal sudah ada?
11. Apakah direct push ke main dicegah di server?
12. Apakah hook bisa diinstall mudah setelah clone?
13. Apakah bypass policy jelas?
14. Apakah hooks membuat atomic commits lebih mudah atau lebih sulit?
15. Apakah hooks meningkatkan trust atau friction?

---

## 56. Mental Model Akhir

Git hooks adalah automation di boundary perubahan.

Tetapi hooks bukan pengganti:

- code review;
- CI;
- branch protection;
- security scanning server-side;
- engineering judgement;
- release governance.

Formula yang sehat:

```text
Hooks catch cheap mistakes early.
CI verifies correctness in controlled environment.
Branch protection enforces team policy.
Review evaluates design and risk.
```

Untuk Java team, hooks paling bernilai ketika mencegah:

- accidental build outputs;
- secrets;
- conflict markers;
- whitespace noise;
- bad commit messages;
- missing formatting;
- obvious generated drift;
- accidental main push.

Hooks paling merusak ketika:

- lambat;
- flaky;
- terlalu ambisius;
- tidak cross-platform;
- tidak punya CI equivalent;
- membuat developer takut commit kecil.

Hook yang baik membuat jalur benar menjadi jalur paling mudah.

---

## 57. Koneksi ke Part Berikutnya

Part ini membahas guardrails lokal dan automation di sekitar Git event.

Part berikutnya masuk ke dependency antar repository:

```text
learn-git-mastery-for-java-engineers-part-024.md
```

Topik:

```text
Submodules, Subtree, dan Multi-Repository Dependency
```

Kita akan membahas:

- masalah dependency source code antar repo;
- Git submodule;
- Git subtree;
- vendor code;
- monorepo vs polyrepo;
- Maven/Gradle dependency sebagai alternatif;
- kapan submodule cocok;
- kapan submodule menyulitkan;
- update submodule;
- failure mode;
- pilihan strategi untuk Java/microservices.

---

## 58. Referensi

Rujukan utama untuk materi ini:

- Git official documentation: `githooks`
- Git official documentation: `core.hooksPath`
- Git official documentation: `git commit --no-verify`
- Git official documentation: `git push --no-verify`
- Git official documentation: `git diff --check`
- Pro Git Book: Customizing Git / Git Hooks
- Praktik umum pre-commit framework, secret scanning, branch protection, CI required checks, Java formatter integration, Maven/Gradle workflow

---

## 59. Status Seri

```text
Progress: 023 / 032
Seri belum selesai.
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
```

Bagian berikutnya:

```text
learn-git-mastery-for-java-engineers-part-024.md
```

Topik:

```text
Submodules, Subtree, dan Multi-Repository Dependency
```

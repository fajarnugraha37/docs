# learn-git-mastery-for-java-engineers-part-030.md

# Part 030 — Performance dan Maintenance Repository

> **Seri:** Git Mastery for Java Engineers  
> **Bagian:** 030 / 032  
> **Topik:** Menjaga repository tetap cepat, sehat, dan scalable: object database, packfiles, GC, commit-graph, maintenance, pruning, sparse checkout, partial clone, dan CI checkout optimization  
> **Target pembaca:** Java software engineer, maintainer repository, platform engineer, build engineer, dan tech lead yang bekerja dengan repo besar, monorepo, CI berat, atau history panjang  
> **Status seri:** Belum selesai. Bagian terakhir adalah `learn-git-mastery-for-java-engineers-part-032.md`.

---

## 0. Ringkasan Eksekutif

Git biasanya cepat.

Sampai suatu hari tidak.

Gejala umum:

```text
git status lambat
git fetch lambat
git checkout lambat
git log lambat
git blame lambat
CI checkout lama
clone pertama sangat besar
IDE indexing lama
repo memakan banyak disk
branch/tag terlalu banyak
GC berjalan lama
working tree berisi ratusan ribu file
monorepo terasa berat
```

Masalah performance Git jarang disebabkan satu hal.

Biasanya kombinasi:

- large files pernah masuk history;
- generated files terlalu banyak di-track;
- binary artifact masuk repo;
- working tree sangat besar;
- branch/tag/ref terlalu banyak;
- packfile tidak optimal;
- commit history sangat panjang;
- file count terlalu tinggi;
- remote-tracking refs stale;
- reflog/unreachable objects menumpuk;
- CI selalu full clone;
- monorepo tanpa sparse/affected build;
- filesystem lambat;
- antivirus/indexer mengganggu;
- IDE menjalankan Git terus-menerus;
- hooks terlalu berat.

Mental model utama:

```text
Repository performance adalah hasil dari object database, refs, working tree,
index, filesystem, network, dan workflow.
```

Maintenance yang baik bukan sekadar menjalankan `git gc`.

Maintenance yang baik adalah:

```text
mencegah bloat,
mengoptimalkan object storage,
mengurangi working tree scope,
membersihkan stale refs,
mengatur CI checkout,
dan mendesain workflow yang tidak melawan Git.
```

---

## 1. Komponen Performance Git

Git operations dipengaruhi oleh beberapa area:

## 1.1 Object Database

Lokasi:

```text
.git/objects/
```

Berisi:

- loose objects;
- packfiles;
- commit objects;
- tree objects;
- blob objects;
- tag objects.

Masalah:

- terlalu banyak loose objects;
- packfile besar/tidak optimal;
- large blobs;
- unreachable objects;
- history bloat.

## 1.2 Refs

Lokasi:

```text
.git/refs/
.git/packed-refs
```

Masalah:

- banyak branch/tag;
- stale remote-tracking refs;
- ref path collision;
- packed refs perlu maintenance.

## 1.3 Index

Lokasi:

```text
.git/index
```

Index menyimpan snapshot staging dan metadata working tree.

Masalah:

- sangat banyak file;
- filesystem stat lambat;
- file mode/line ending noise;
- generated files tracked;
- monorepo besar.

## 1.4 Working Tree

File nyata di disk.

Masalah:

- terlalu banyak file;
- node_modules/vendor/build output tidak ignored;
- antivirus;
- slow filesystem;
- network filesystem;
- Docker bind mount;
- WSL boundary;
- IDE scanning.

## 1.5 Network

Clone/fetch/push dipengaruhi:

- repo size;
- pack negotiation;
- remote latency;
- shallow/partial clone;
- tags/refs;
- LFS;
- submodules.

---

## 2. Membedakan Slow Git: Diagnostic First

Jangan langsung menjalankan random command.

Pertanyaan:

```text
Command apa yang lambat?
Sejak kapan?
Di semua mesin atau satu mesin?
Di repo ini saja atau semua repo?
Local operation atau network?
Working tree besar atau history besar?
CI atau developer local?
```

Contoh diagnosis:

| Gejala | Kemungkinan |
|---|---|
| `git status` lambat | working tree/index/file count/filesystem |
| `git clone` lambat | repo history/large blobs/network/LFS |
| `git fetch` lambat | many refs/large pack/network |
| `git log --graph --all` lambat | many commits/refs/graph |
| `git blame` lambat | file history/renames/large file |
| checkout branch lambat | many files/generated outputs |
| CI checkout lambat | full history/LFS/submodules/cache |
| disk `.git` besar | packfiles/large history/unreachable objects |
| repo root huge | build outputs/untracked files |

Diagnosis yang baik menentukan solusi.

---

## 3. Ukur Ukuran Repository

```bash
du -sh .git
du -sh .
```

Git object stats:

```bash
git count-objects -vH
```

Output contoh:

```text
count: 120
size: 2.34 MiB
in-pack: 184322
packs: 4
size-pack: 1.42 GiB
prune-packable: 0
garbage: 0
size-garbage: 0 bytes
```

Interpretasi:

- `count`: loose objects;
- `size`: size loose objects;
- `in-pack`: objects dalam packfiles;
- `packs`: jumlah packfile;
- `size-pack`: total packfile size;
- `garbage`: object rusak/garbage.

Jika `size-pack` besar, history/object besar.

Jika `count` besar, loose objects banyak; GC bisa membantu.

---

## 4. Cari File Besar di Working Tree

Linux:

```bash
git ls-files -z |
xargs -0 stat -c "%s %n" |
sort -nr |
head -20
```

macOS:

```bash
git ls-files -z |
xargs -0 stat -f "%z %N" |
sort -nr |
head -20
```

Portable-ish:

```bash
git ls-files -z | xargs -0 du -h | sort -h | tail -20
```

Jika ada:

```text
target/app.jar
build/libs/app.jar
large fixture
dump.sql
heap.hprof
```

maka repository hygiene bermasalah.

---

## 5. Cari Blob Besar di History

Command:

```bash
git rev-list --objects --all |
git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' |
awk '$1 == "blob" {print $3, $2, substr($0, index($0,$4))}' |
sort -nr |
head -20
```

Ini menemukan blob terbesar yang pernah ada dalam history.

Jika file besar sudah dihapus dari HEAD tapi masih muncul di sini, repo bloat berasal dari history.

Solusi bukan `.gitignore`.

Solusi mungkin history rewrite, dibahas Part 028.

---

## 6. `git-sizer`

`git-sizer` membantu menganalisis repository health.

Ia melihat:

- largest blobs;
- tree size;
- commit count;
- tag count;
- reference count;
- path depth;
- maximum history fanout.

Gunakan untuk repo besar/monorepo.

Output membantu menjawab:

```text
Masalah terbesar repo ini apa?
Blob besar?
Terlalu banyak refs?
Tree terlalu besar?
Commit history ekstrem?
```

---

## 7. Loose Objects vs Packfiles

Git awalnya bisa menyimpan object sebagai loose object:

```text
.git/objects/ab/cdef...
```

Seiring waktu, Git mengemas object ke packfiles:

```text
.git/objects/pack/pack-xxxx.pack
.git/objects/pack/pack-xxxx.idx
```

Packfiles:

- mengompresi object;
- delta-compress antar object;
- lebih efisien untuk transfer;
- lebih cepat untuk banyak operasi.

Banyak loose object bisa membuat repo lambat.

GC/repack mengemasnya.

---

## 8. `git gc`

`git gc` melakukan garbage collection.

Basic:

```bash
git gc
```

Apa yang dilakukan:

- pack loose objects;
- consolidate packfiles;
- remove unreachable objects yang expired;
- optimize storage;
- update auxiliary structures tergantung config/version.

Aggressive:

```bash
git gc --aggressive
```

Hati-hati:

- bisa lama;
- CPU intensive;
- tidak selalu perlu;
- tidak menghapus reachable large blobs.

Rule:

```text
Gunakan git gc normal untuk maintenance.
Jangan menganggap gc menyelesaikan history bloat.
```

---

## 9. `git gc` Tidak Menghapus File Besar yang Reachable

Jika large file ada di commit lama yang masih reachable dari branch/tag, `git gc` tidak akan menghapusnya.

Karena Git harus menjaga history.

Untuk menghapus reachable large object:

```text
rewrite history
```

dengan `git filter-repo`, BFG, atau LFS migrate.

`git gc` hanya membersihkan object unreachable/expired.

---

## 10. Pruning

Prune menghapus unreachable objects yang sudah expired.

Command:

```bash
git prune
```

Biasanya jangan dipakai langsung kecuali paham.

Lebih aman melalui:

```bash
git gc --prune=now
```

Setelah history rewrite lokal:

```bash
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

Caveat:

```text
Jika Anda prune terlalu cepat, recovery via reflog hilang.
```

---

## 11. Reflog Expiry

Reflog menjaga kemampuan recovery.

Config:

```bash
git config --get gc.reflogExpire
git config --get gc.reflogExpireUnreachable
```

Default biasanya menyimpan reflog untuk periode tertentu.

Expire manually:

```bash
git reflog expire --expire=now --all
```

Use case:

- after intentional history cleanup;
- before measuring size reduction.

Risk:

- lose recovery points.

Do not expire reflog casually.

---

## 12. Commit-Graph

Commit-graph adalah struktur data yang mempercepat operasi traversal commit graph.

Useful untuk:

- `git log`;
- merge-base;
- status in some cases;
- branch containment;
- graph traversal in large repos.

Write:

```bash
git commit-graph write --reachable
```

With changed paths Bloom filters:

```bash
git commit-graph write --reachable --changed-paths
```

Modern Git maintenance can manage commit-graph.

For large repositories, commit-graph can significantly help history queries.

---

## 13. Multi-Pack Index

Multi-pack-index membantu repo dengan banyak packfiles.

Command:

```bash
git multi-pack-index write
```

Maintenance tasks can manage it.

Useful for large repos/partial clones/object stores.

Most developers don't need manual use, but maintainers should know it exists.

---

## 14. `git maintenance`

Modern Git has maintenance framework.

Start scheduled maintenance:

```bash
git maintenance start
```

Run:

```bash
git maintenance run
```

Tasks can include:

- gc;
- commit-graph;
- prefetch;
- loose-objects;
- incremental-repack;
- pack-refs.

Inspect config:

```bash
git config --get-regexp maintenance
```

For active large repos, enabling maintenance can improve performance.

---

## 15. Pack Refs

Pack refs:

```bash
git pack-refs --all
```

This consolidates loose refs into `.git/packed-refs`.

Useful if many tags/branches.

But Git usually handles this during gc/maintenance.

Do not parse refs manually; packed refs exist.

---

## 16. Prune Remote-Tracking Refs

Stale remote branches create clutter and sometimes ref conflicts.

Prune:

```bash
git fetch --prune
```

Config globally:

```bash
git config --global fetch.prune true
```

Prune tags carefully:

```bash
git fetch --prune --prune-tags
```

Stale refs can slow some `--all` operations and confuse tooling.

---

## 17. Many Tags

Repos with thousands of tags can make operations heavier.

Examples:

- every CI build creates tag;
- artifact versions tag too frequently;
- old automation never deletes tags.

Questions:

```text
Are all tags needed?
Are tags meaningful releases?
Should build metadata be stored elsewhere?
Are ephemeral refs/tags cleaned?
```

Release tags are important.

Ephemeral build tags may be better as artifact metadata.

---

## 18. Index Performance and File Count

`git status` must inspect working tree/index.

Lots of files slow it down.

Tracked generated files hurt.

Untracked build outputs can also hurt if not ignored.

Use `.gitignore` to reduce untracked scan noise.

Check untracked noise:

```bash
git status --short --untracked-files=all
```

If huge output, fix `.gitignore`.

---

## 19. Untracked Cache

Git has untracked cache to speed untracked file detection.

Enable:

```bash
git config core.untrackedCache true
```

Test support:

```bash
git update-index --test-untracked-cache
```

Useful for large working trees.

But if filesystem behavior weird, be cautious.

---

## 20. FSMonitor

FSMonitor integrates file change monitoring to speed status.

Modern Git has built-in fsmonitor daemon on supported platforms.

Enable:

```bash
git config core.fsmonitor true
```

This can speed large repos significantly.

Caveats:

- platform support/version matters;
- network filesystems may be problematic;
- IDE/tooling interactions vary.

---

## 21. Split Index

Split index can help large repos by splitting shared index from changes.

Enable:

```bash
git config core.splitIndex true
```

Useful in some large working trees.

Most teams should first fix generated files/ignore/sparse before relying on split index.

---

## 22. Sparse Checkout

Sparse checkout reduces working tree files.

Cone mode:

```bash
git sparse-checkout init --cone
git sparse-checkout set services/case-service libs/workflow-core build-logic
```

For large Java monorepo, this can reduce:

- checkout time;
- IDE indexing;
- `git status` cost;
- disk usage.

Caveats:

- build scripts must work with sparse tree;
- dependencies outside sparse set missing;
- root config files needed;
- developer education required.

---

## 23. Partial Clone

Partial clone reduces object download.

```bash
git clone --filter=blob:none <repo>
```

Combine with sparse:

```bash
git clone --filter=blob:none --sparse <repo>
cd repo
git sparse-checkout set services/case-service libs/workflow-core
```

Good for large monorepo.

Caveats:

- missing blobs fetched on demand;
- network needed during later operations;
- tools can accidentally fetch many blobs;
- server support required;
- not a substitute for bloat prevention.

---

## 24. Shallow Clone in CI

CI often uses:

```bash
git clone --depth=1
```

Benefits:

- faster clone;
- less network;
- less disk.

Risks:

- `git describe` may fail;
- tags missing;
- changelog generation fails;
- merge-base with target branch unavailable;
- affected build logic wrong;
- Sonar/coverage diff analysis may fail;
- bisect impossible.

CI config must match needs.

If release needs tags:

```bash
git fetch --tags --unshallow
```

or configure fetch-depth 0.

---

## 25. CI Checkout Strategy

Choose based on job:

| Job | Recommended Checkout |
|---|---|
| Fast unit test PR | shallow may be okay |
| Affected test requiring merge-base | fetch target branch/history |
| Release build | full enough history + tags |
| Version from `git describe` | tags needed |
| Security scan history | full history |
| Docs build only | shallow okay |
| Monorepo affected graph | enough history for base comparison |
| LFS fixture tests | LFS enabled |

Do not use one checkout strategy blindly for all jobs.

---

## 26. Git LFS Performance

LFS can improve Git object size but adds network step.

CI must fetch LFS when needed:

```yaml
lfs: true
```

Local:

```bash
git lfs pull
```

Optimization:

- only use LFS for legitimate large binary;
- avoid putting build artifacts in LFS;
- avoid LFS files needed by every build if huge;
- cache LFS in CI if allowed;
- monitor quota.

---

## 27. Submodule Performance

Submodules add clone/fetch cost.

Recursive clone:

```bash
git clone --recurse-submodules
```

CI may fetch many repos.

Optimization:

- avoid submodules if artifact dependency works;
- shallow submodule if safe;
- update only needed submodule;
- cache submodules;
- ensure access fast/reliable.

But complexity can outweigh benefits.

---

## 28. Hooks Performance

Hooks can make Git feel slow.

Check:

- `pre-commit`;
- `pre-push`;
- `post-checkout`;
- `post-merge`;
- hook manager.

If `git commit` takes 60 seconds, developers will avoid small commits.

Policy:

```text
pre-commit: cheap checks
pre-push: medium checks
CI: heavy checks
```

Measure hook time.

---

## 29. IDE and Git Performance

IntelliJ/Eclipse/VS Code may run Git commands frequently.

Problems:

- repository huge;
- untracked files not ignored;
- generated outputs;
- file watchers;
- antivirus;
- WSL boundary;
- network filesystem;
- too many branches/tags.

Fix repository hygiene first.

Also configure IDE to exclude:

```text
target/
build/
.gradle/
.idea caches
generated output if not source
```

---

## 30. Filesystem Considerations

Git performs many filesystem operations.

Slow contexts:

- network drive;
- Docker bind mount from host;
- Windows filesystem accessed from WSL path `/mnt/c`;
- antivirus scanning `.git`;
- cloud sync folders;
- huge directory with many files.

Recommendations:

```text
Keep repo on local fast disk.
Avoid cloning active repo inside Dropbox/OneDrive.
For WSL, clone inside Linux filesystem.
Exclude repo/build dirs from aggressive antivirus if policy allows.
```

---

## 31. Java Build Outputs and Git Performance

If `target/` or `build/` not ignored, `git status` can become slow/noisy.

Fix `.gitignore`:

```gitignore
target/
build/
.gradle/
*.class
*.log
```

If already tracked:

```bash
git rm -r --cached target/ build/
```

Generated output should go under ignored build dirs unless intentionally tracked.

---

## 32. Monorepo Performance Strategy

For Java monorepo:

```text
[ ] Keep generated/build outputs untracked.
[ ] Use Gradle/Maven module selection.
[ ] Use affected testing.
[ ] Enable build cache where appropriate.
[ ] Use sparse checkout for focused work.
[ ] Consider partial clone.
[ ] Keep binary artifacts out.
[ ] Use CODEOWNERS and path-based CI with dependency graph.
[ ] Periodically audit large blobs.
[ ] Keep branch/tag refs tidy.
```

Monorepo without performance strategy becomes painful.

---

## 33. Gradle Performance and Git

Gradle build performance is separate from Git but interacts.

Good practices:

- Gradle wrapper tracked;
- configuration cache;
- build cache;
- project isolation where applicable;
- avoid checking generated build output;
- avoid invalidating cache with generated timestamps;
- affected module builds;
- version catalog.

Git performance suffers if Gradle outputs are not ignored.

Gradle performance suffers if repo layout/build graph poor.

---

## 34. Maven Performance and Git

Maven multi-module:

```bash
./mvnw -pl module -am test
```

Use reactor selection.

Avoid:

```text
running full reactor for every small change if unnecessary.
```

But ensure CI full/affected correctness.

Maven `target/` must be ignored.

Local `.m2` cache should not be in repo.

---

## 35. Large History and Blame/Log

`git blame` on huge file with long history can be slow.

Options:

```bash
git blame -L 100,150 file
git blame -w file
git log --follow -- file
```

For generated huge files, avoid tracking if possible.

For code archaeology, commit-graph may help log traversal.

---

## 36. Rename Detection Cost

Commands with rename/copy detection can be expensive:

```bash
git log --follow
git blame -M -C
git diff -M -C
```

Use when needed, not in broad automation over whole repo.

---

## 37. `git status` Optimization Checklist

If `git status` slow:

```text
[ ] Are build outputs ignored?
[ ] Are untracked files huge?
[ ] Is repo on slow filesystem?
[ ] Is antivirus scanning?
[ ] Is fsmonitor enabled?
[ ] Is untracked cache enabled?
[ ] Is file count enormous?
[ ] Is sparse checkout useful?
[ ] Are submodules slow?
[ ] Is IDE running concurrent Git?
```

Commands:

```bash
git status --untracked-files=no
git status --ignored
git config core.untrackedCache
git config core.fsmonitor
```

---

## 38. `git fetch` Optimization Checklist

If fetch slow:

```text
[ ] Is network slow?
[ ] Are there many refs/tags?
[ ] Is fetch pruning stale refs?
[ ] Are large objects being fetched?
[ ] Is LFS fetching automatically?
[ ] Is partial clone possible?
[ ] Is shallow fetch appropriate?
[ ] Are submodules fetched recursively?
```

Commands:

```bash
git remote -v
git config --get-all remote.origin.fetch
git fetch --prune
git ls-remote --heads origin | wc -l
git ls-remote --tags origin | wc -l
```

---

## 39. `git clone` Optimization Checklist

If clone slow:

```text
[ ] How large is .git after clone?
[ ] Are large blobs in history?
[ ] Are LFS objects fetched?
[ ] Are submodules recursive?
[ ] Is full history needed?
[ ] Can partial clone help?
[ ] Can sparse checkout help?
[ ] Can CI cache repo?
[ ] Should repo be cleaned/split?
```

Options:

```bash
git clone --depth=1 <repo>
git clone --filter=blob:none <repo>
git clone --sparse <repo>
```

Use intentionally.

---

## 40. Repository Health Audit Script Concept

A simple periodic audit can check:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Git object stats:"
git count-objects -vH

echo "Tracked build outputs:"
git ls-files | grep -E '(^target/|^build/|\.class$|\.hprof$|\.log$)' || true

echo "Tracked archives/artifacts:"
git ls-files | grep -E '\.(jar|war|ear|zip|tar|gz)$' || true

echo "Largest tracked files:"
git ls-files -z | xargs -0 du -h | sort -h | tail -20
```

Run in CI periodically or manually.

---

## 41. Maintenance Schedule

For normal developers:

```bash
git maintenance start
```

or occasional:

```bash
git gc
```

For repo maintainers:

- periodic bloat audit;
- stale branch cleanup;
- tag policy review;
- LFS quota check;
- CI checkout time monitoring;
- history cleanup if needed;
- `.gitignore` review;
- generated file policy review.

---

## 42. Stale Branch Cleanup

Many old branches clutter remote.

List remote branches by date:

```bash
git for-each-ref --sort=committerdate \
  --format='%(committerdate:short) %(refname:short)' refs/remotes/origin
```

Delete remote branch:

```bash
git push origin --delete old-branch
```

Policy:

```text
Delete merged stale feature branches.
Keep release/hotfix branches per retention policy.
Archive important branches with tags if needed.
```

Branch cleanup improves clarity and can reduce ref overhead.

---

## 43. Tag Retention

Release tags should remain.

Ephemeral tags should be avoided or cleaned.

If CI creates tags for every build:

```text
Consider artifact metadata instead.
```

Too many tags can slow fetch/listing.

Define tag policy:

```text
release tags permanent
candidate tags maybe temporary
build metadata in artifact system
```

---

## 44. Packfile Repack

Manual repack:

```bash
git repack -Ad
```

Aggressive:

```bash
git repack -Ad --depth=250 --window=250
```

Usually not necessary manually.

`git gc` handles typical repack.

Aggressive repack can be expensive and has diminishing returns.

Use only for maintenance windows / server-side optimization if needed.

---

## 45. Server-Side Maintenance

Repository hosting runs maintenance, but self-hosted Git needs admin care:

- gc/repack;
- bitmap indexes;
- commit-graph;
- backups;
- storage monitoring;
- LFS storage;
- ref cleanup.

Application developers may not manage server, but should know when to involve platform team.

Symptoms:

- all users experience slow fetch;
- remote rejects due to size/quota;
- server disk high;
- LFS quota exceeded;
- clone from server slow despite local repo healthy.

---

## 46. Pack Bitmaps

Pack bitmaps speed clone/fetch negotiation.

Mostly server-side concern.

`git gc` can write bitmaps depending config.

For large central repos, hosting/platform should manage bitmap indexes.

---

## 47. Avoiding Generated File Explosion

Generated sources can create huge tree.

Examples:

- OpenAPI generated clients;
- protobuf generated classes;
- jOOQ output;
- large static docs.

Policy:

```text
Generate during build unless there is strong reason to track.
If tracked, isolate path and review policy.
```

Generated file explosion hurts:

- checkout;
- status;
- diff;
- merge;
- blame;
- IDE indexing.

---

## 48. Avoiding Vendor Dependency Explosion

Do not commit:

```text
node_modules/
.m2/
.gradle/caches/
vendor jars
```

Use dependency managers and caches.

If frontend assets in Java repo, ensure:

```gitignore
node_modules/
dist/
```

If frontend build output must be packaged, generate in build/CI.

---

## 49. CI Cache vs Git Storage

Good:

```text
Cache Maven/Gradle dependencies in CI cache.
```

Bad:

```text
Commit dependency cache to Git.
```

CI cache is disposable optimization.

Git is source history.

Keep them separate.

---

## 50. Measuring CI Checkout Time

Track metrics:

```text
checkout duration
dependency restore duration
build duration
test duration
artifact upload duration
```

If checkout grows steadily, investigate repo bloat.

CI logs often reveal:

- full clone fetching tags;
- LFS pulling huge files;
- submodules slow;
- no cache;
- shallow disabled unnecessarily.

---

## 51. Release Build Needs More History

Release versioning often uses:

```bash
git describe --tags
```

This needs tags/history.

If CI checkout shallow, release version may become wrong.

For release jobs:

```text
fetch-depth: 0
fetch tags
verify clean tree
```

For PR jobs, shallow may be fine if affected logic does not need full merge-base.

---

## 52. Security Scans and Full History

Secret scans may scan:

- current tree;
- full history.

Full-history scan needs full clone.

Do not assume shallow clone scans old leaks.

Periodic full-history scan should run separately.

---

## 53. Repository Archival

Old repos should be archived when replaced.

Archive policy:

```text
read-only
README points to new repo
branch protections retained or repo archived
secrets cleaned if necessary
release tags preserved
```

Archived repo still consumes storage and may contain sensitive data.

Do not archive secret leak without incident handling.

---

## 54. When to Split a Repository for Performance

Splitting repo purely for performance is last resort.

First try:

- remove bloat;
- ignore generated files;
- sparse checkout;
- partial clone;
- affected CI;
- maintenance;
- build optimization.

Split if:

```text
[ ] Architecture boundary supports it.
[ ] Ownership/release independent.
[ ] Access control needs it.
[ ] Tooling cannot scale even after optimization.
```

Do not split and create dependency chaos just to avoid fixing bloat.

---

## 55. When to Use Monorepo Tooling

If repo has:

- many projects;
- affected builds needed;
- language mix;
- large CI matrix;
- dependency graph complexity;
- performance bottlenecks;

consider tooling:

- Bazel;
- Pants;
- Buck;
- Nx;
- Gradle Enterprise/build cache;
- custom graph tooling.

But tooling has cost.

Start with good hygiene and build graph discipline.

---

## 56. Java-Specific Performance Policy

Recommended baseline:

```text
[ ] `target/`, `build/`, `.gradle/` ignored.
[ ] wrapper jars allowed, other jars blocked.
[ ] generated output not tracked unless policy.
[ ] `.gitattributes` defines text/binary.
[ ] `.gitignore` handles logs/dumps/reports.
[ ] large file hook/CI guard.
[ ] dependency cache outside Git.
[ ] CI checkout depth intentional.
[ ] release job fetches tags/history.
[ ] monorepo uses module-targeted build.
[ ] repo maintenance enabled or documented.
```

---

## 57. Case Study 1 — `git status` Takes 20 Seconds

Symptoms:

```text
Java service repo, git status slow after running tests.
```

Diagnosis:

```bash
git status --short --untracked-files=all | head
```

Shows:

```text
?? target/
?? build/
?? logs/
```

Fix:

```gitignore
target/
build/
logs/
*.log
```

If already tracked:

```bash
git rm -r --cached target build logs
```

Result:

```text
status fast again, PR noise reduced.
```

---

## 58. Case Study 2 — Clone Takes 15 Minutes

Diagnosis:

```bash
git count-objects -vH
large blob history scan
```

Finds:

```text
500 MB prod-dump.sql.gz
200 MB app.jar
```

Even though deleted from HEAD.

Fix:

- assess sensitivity;
- rotate/report if data sensitive;
- rewrite history with filter-repo/BFG;
- force push coordinated;
- add large file guard;
- move fixtures/artifacts to proper storage.

---

## 59. Case Study 3 — Monorepo CI Runs Everything

Problem:

```text
Docs change triggers all Java integration tests.
CI takes 2 hours.
```

Fix:

- path filter for docs;
- dependency graph for modules;
- affected tests;
- required full nightly build;
- PR fast checks plus merge queue full checks.

Be careful:

```text
Path filters must account for shared libs/build logic.
```

---

## 60. Case Study 4 — Release Version Wrong in CI

Script:

```bash
git describe --tags --always
```

Output:

```text
a13f9e2
```

Expected:

```text
v1.8.3-2-ga13f9e2
```

Cause:

```text
CI shallow clone without tags.
```

Fix release job:

```text
fetch-depth: 0
fetch tags
```

---

## 61. Case Study 5 — Cannot Lock Ref After Branch Rename

Error:

```text
cannot lock ref refs/remotes/origin/feature/x
```

Cause:

```text
stale origin/feature conflicts with origin/feature/x
```

Fix:

```bash
git remote prune origin
```

or:

```bash
git update-ref -d refs/remotes/origin/feature
git fetch origin
```

Maintenance includes ref hygiene.

---

## 62. Checklist: Local Performance

```text
[ ] Repo on local fast disk.
[ ] Build outputs ignored.
[ ] Untracked files under control.
[ ] `.git` size reasonable.
[ ] `git count-objects -vH` checked.
[ ] `git gc` run if many loose objects.
[ ] `git maintenance start` considered.
[ ] fsmonitor/untracked cache considered.
[ ] sparse checkout considered for huge monorepo.
[ ] antivirus/cloud sync not interfering.
```

---

## 63. Checklist: Repository Maintainer

```text
[ ] Large file audit periodic.
[ ] Generated file policy enforced.
[ ] Stale branches pruned.
[ ] Tag policy clear.
[ ] LFS usage monitored.
[ ] CI checkout strategy intentional.
[ ] Secret/full-history scans scheduled.
[ ] Repo size metrics monitored.
[ ] `.gitignore`/`.gitattributes` maintained.
[ ] Maintenance guidance documented.
[ ] Monorepo affected build correct.
```

---

## 64. Checklist: CI Performance

```text
[ ] Checkout depth appropriate.
[ ] Tags fetched only when needed.
[ ] LFS fetched only when needed.
[ ] Submodules fetched only when needed.
[ ] Dependency cache used.
[ ] Build cache used if appropriate.
[ ] Affected modules tested.
[ ] Full verification scheduled where needed.
[ ] Checkout time monitored.
[ ] Generated outputs not uploaded/downloaded unnecessarily.
```

---

## 65. Commands Cheat Sheet

Stats:

```bash
git count-objects -vH
du -sh .git
```

GC:

```bash
git gc
git gc --prune=now
```

Maintenance:

```bash
git maintenance run
git maintenance start
```

Commit graph:

```bash
git commit-graph write --reachable --changed-paths
```

Prune refs:

```bash
git fetch --prune
git remote prune origin
```

Large tracked files:

```bash
git ls-files -z | xargs -0 du -h | sort -h | tail -20
```

Large history blobs:

```bash
git rev-list --objects --all |
git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' |
awk '$1 == "blob" {print $3, $2, substr($0, index($0,$4))}' |
sort -nr |
head -20
```

Sparse:

```bash
git sparse-checkout init --cone
git sparse-checkout set services/case-service libs/workflow-core
```

Partial clone:

```bash
git clone --filter=blob:none <repo>
```

---

## 66. Latihan Praktis

## Latihan 1 — Repository Health Snapshot

Di repo Java:

```bash
du -sh .git
git count-objects -vH
git status --short | head
```

Catat baseline.

## Latihan 2 — Large File Audit

```bash
git ls-files -z | xargs -0 du -h | sort -h | tail -20
```

Identifikasi apakah ada artifact/generated/dump.

## Latihan 3 — History Blob Audit

Jalankan large history blob scan.

Jawab:

```text
Apakah file terbesar masih ada di HEAD?
Apakah perlu cleanup history?
```

## Latihan 4 — Prune Remote Refs

```bash
git branch -r | wc -l
git fetch --prune
git branch -r | wc -l
```

Apakah banyak stale refs?

## Latihan 5 — Sparse Checkout Lab

Di repo besar/lab:

```bash
git sparse-checkout init --cone
git sparse-checkout set <subdir>
```

Lihat perubahan working tree.

## Latihan 6 — CI Checkout Review

Buka config CI.

Jawab:

```text
Apakah fetch-depth sesuai?
Apakah tags dibutuhkan?
Apakah LFS/submodule diaktifkan tanpa perlu?
```

---

## 67. Pertanyaan Reflektif

1. Apakah repo Anda lambat karena working tree atau history?
2. Apakah build outputs ignored dengan benar?
3. Apakah ada large blobs di history?
4. Apakah CI checkout strategy intentional?
5. Apakah release job fetch tags/history cukup?
6. Apakah monorepo punya affected testing?
7. Apakah generated files memperlambat status/review?
8. Apakah LFS dipakai hanya untuk kasus tepat?
9. Apakah stale branches/tags dibersihkan?
10. Apakah `git maintenance` berguna untuk tim Anda?
11. Apakah repo ada di filesystem lambat/cloud sync?
12. Apakah hooks membuat Git terasa lambat?
13. Apakah dependency cache salah tempat?
14. Apakah repo perlu cleanup atau split?
15. Apakah performance dipantau sebelum menjadi krisis?

---

## 68. Mental Model Akhir

Git performance bukan magic.

Ia berasal dari:

```text
object database health
ref hygiene
index size
working tree size
filesystem speed
network transfer
CI strategy
repository policy
```

Solusi terbaik selalu dimulai dari diagnosis.

Jangan memakai `git gc --aggressive` sebagai mantra.

Pertama pahami:

```text
Apakah lambat karena file besar?
Apakah karena terlalu banyak untracked files?
Apakah karena full clone di CI?
Apakah karena working tree monorepo terlalu besar?
Apakah karena history bloat?
Apakah karena hooks?
```

Repository yang sehat adalah repository yang:

```text
cepat di-clone,
cepat di-status,
jelas history-nya,
minim bloat,
punya maintenance policy,
dan CI-nya mengambil data sebanyak yang dibutuhkan, tidak lebih.
```

---

## 69. Koneksi ke Part Berikutnya

Part ini membahas performance dan maintenance repository.

Part berikutnya masuk ke Git dalam delivery pipeline:

```text
learn-git-mastery-for-java-engineers-part-031.md
```

Topik:

```text
Git dalam CI/CD, Release Automation, dan Compliance
```

Kita akan membahas:

- checkout strategy;
- build from tag/commit;
- branch protection;
- release automation;
- semantic versioning;
- changelog;
- artifact provenance;
- GitOps;
- compliance evidence;
- deployment traceability;
- promotion across environments;
- rollback dan hotfix.

---

## 70. Referensi

Rujukan utama untuk materi ini:

- Git official documentation: `git gc`, `git maintenance`, `git count-objects`, `git commit-graph`, `git repack`, `git prune`
- Git official documentation: sparse checkout, partial clone, shallow clone, fetch/prune
- Git official documentation: packfiles, refs, reflog expiry, fsmonitor, untracked cache
- Pro Git Book: Git internals, maintenance, transfer protocols
- Praktik umum large repository management, Java monorepo build optimization, CI checkout optimization, Gradle/Maven module builds, and repository health governance

---

## 71. Status Seri

```text
Progress: 030 / 032
Seri belum selesai.
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
```

Bagian berikutnya:

```text
learn-git-mastery-for-java-engineers-part-031.md
```

Topik:

```text
Git dalam CI/CD, Release Automation, dan Compliance
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-git-mastery-for-java-engineers-part-029.md](./learn-git-mastery-for-java-engineers-part-029.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-git-mastery-for-java-engineers-part-031.md](./learn-git-mastery-for-java-engineers-part-031.md)

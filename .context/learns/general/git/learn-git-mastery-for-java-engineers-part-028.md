# learn-git-mastery-for-java-engineers-part-028.md

# Part 028 — Rewrite History Lanjutan: Filter-Repo, BFG, dan Migration

> **Seri:** Git Mastery for Java Engineers  
> **Bagian:** 028 / 032  
> **Topik:** Rewrite history tingkat lanjut untuk menghapus secret/large file, migrasi repository, split/merge repo, dan operasi pembersihan berisiko tinggi  
> **Target pembaca:** Java software engineer, maintainer repo, tech lead, release engineer, platform engineer, dan engineer yang perlu melakukan repository migration/cleanup dengan aman  
> **Status seri:** Belum selesai. Bagian terakhir adalah `learn-git-mastery-for-java-engineers-part-032.md`.

---

## 0. Ringkasan Eksekutif

Rewrite history adalah salah satu operasi Git paling kuat dan paling berbahaya.

Ia dapat memperbaiki masalah besar:

- secret terlanjur masuk history;
- file besar membuat repository bloat;
- production dump perlu dihapus dari history;
- repository perlu di-split;
- banyak repo perlu digabung;
- path perlu dipindah massal;
- author/email lama perlu dinormalisasi;
- vendor/generated artifact perlu dibuang dari seluruh history;
- monorepo migration perlu preserving history;
- subdirectory perlu diekstrak menjadi repository baru.

Tetapi rewrite history juga bisa merusak:

- clone developer;
- open pull request;
- tag release;
- CI cache;
- forks;
- audit trail;
- branch protection assumptions;
- deployment traceability;
- submodule pointers;
- downstream repository.

Mental model utama:

```text
Rewrite history bukan mengubah commit lama.
Rewrite history membuat commit baru yang mirip commit lama,
tetapi punya identity/SHA berbeda.
```

Karena commit SHA bergantung pada content, parent, author, committer, message, dan metadata lain, setiap perubahan dalam history menciptakan commit graph baru.

Jadi rewrite history harus diperlakukan sebagai operasi migrasi, bukan command harian.

---

## 1. Kapan Rewrite History Layak Dilakukan?

Rewrite history layak dipertimbangkan jika:

```text
[ ] Secret/credential masuk history.
[ ] PII/customer data masuk history.
[ ] File besar membuat repo sangat bloat.
[ ] Binary artifact besar masuk berkali-kali.
[ ] Legal/license issue mengharuskan removal.
[ ] Repository split/merge perlu menjaga history relevan.
[ ] Path migration besar perlu dilakukan sebelum repo baru digunakan.
[ ] Author/email metadata perlu diperbaiki untuk compliance.
```

Rewrite history biasanya tidak layak untuk:

```text
[ ] Typo kecil di commit lama.
[ ] Commit message lama kurang bagus.
[ ] File kecil tidak sensitif.
[ ] History sudah banyak digunakan downstream dan benefit kecil.
[ ] Sekadar membuat history tampak rapi setelah sudah merge ke main.
```

Rule:

```text
Rewrite shared history hanya jika manfaatnya lebih besar dari koordinasi dan risiko.
```

Untuk private feature branch, rewrite biasa saja.

Untuk `main`, `release/*`, atau tag release, rewrite adalah operasi besar.

---

## 2. Rewrite Private vs Shared History

## 2.1 Private History

Contoh:

```text
feature branch lokal belum di-push
```

Aman untuk:

- interactive rebase;
- amend;
- reset;
- filter kecil;
- reorder commit.

Dampak hanya ke Anda.

## 2.2 Shared History

Contoh:

```text
main
release/2.8
branch yang sudah dipakai banyak orang
tag release
```

Rewrite berdampak ke semua orang.

Dampak:

```text
Commit SHA berubah.
Branch remote perlu force push.
Developer clone lama diverge.
Open PR bisa rusak.
CI cache invalid.
Tags lama mungkin menunjuk history lama.
Forks tetap punya old objects.
```

Shared history rewrite harus direncanakan.

---

## 3. Kenapa SHA Berubah?

Commit SHA dihitung dari commit object.

Commit object mengandung:

- tree hash;
- parent hash;
- author;
- committer;
- timestamp;
- commit message;
- optional signature;
- metadata lain.

Jika satu file di commit lama dihapus dari history, tree hash berubah.

Karena parent commit berubah, semua descendant commit juga berubah.

Contoh:

```text
A -- B -- C -- D
```

Jika B diubah menjadi B':

```text
A -- B' -- C' -- D'
```

C dan D juga berubah karena parent-nya berubah.

Ini efek domino.

---

## 4. Rewrite History Tidak Sama dengan Revert

Revert:

```text
Menambahkan commit baru yang membalik perubahan lama.
History lama tetap ada.
```

Rewrite:

```text
Membuat history baru seolah perubahan lama tidak pernah terjadi.
```

Jika secret bocor:

```text
git revert
```

tidak cukup, karena secret tetap ada di commit lama.

Jika bug logic perlu dibatalkan:

```text
git revert
```

biasanya lebih aman daripada rewrite.

Decision:

| Tujuan | Operasi |
|---|---|
| Membatalkan perubahan public | `git revert` |
| Membersihkan secret dari history | rewrite |
| Membersihkan large file dari history | rewrite |
| Merapikan private branch | rebase/amend |
| Menghapus commit public karena salah logic | biasanya revert |
| Migrasi repo/split path | rewrite/filter |

---

## 5. Tool Modern: `git filter-repo`

`git filter-repo` adalah tool modern untuk rewrite history.

Ia menggantikan banyak penggunaan lama `git filter-branch`.

Kegunaan:

- remove path from history;
- keep only path;
- move path;
- replace text;
- rewrite author;
- analyze repo;
- split repo;
- migration.

Contoh high-level:

```bash
git filter-repo --path target/app.jar --invert-paths
```

Artinya:

```text
Buat history baru tanpa path target/app.jar.
```

Catatan:

```text
git filter-repo biasanya perlu diinstall terpisah.
Jalankan pada clone bersih/mirror.
```

---

## 6. Tool Praktis: BFG Repo-Cleaner

BFG adalah tool yang lebih sederhana untuk kasus umum:

- remove large blobs;
- remove passwords/text;
- strip blobs above size threshold.

Contoh concept:

```bash
bfg --strip-blobs-bigger-than 50M repo.git
```

Kelebihan:

- cepat;
- simple;
- cocok untuk cleanup besar umum.

Kekurangan:

- kurang fleksibel dibanding `git filter-repo`;
- Java tool;
- perlu proses GC/manual steps;
- tidak cocok untuk semua transformasi kompleks.

Gunakan BFG jika kasusnya sederhana.

Gunakan `git filter-repo` untuk migrasi/filter kompleks.

---

## 7. Jangan Gunakan `git filter-branch` untuk Workflow Baru

`git filter-branch` adalah tool lama.

Masalah:

- lambat;
- footgun;
- banyak edge case;
- warning panjang;
- lebih mudah salah.

Untuk operasi baru, gunakan:

```text
git filter-repo
```

atau BFG untuk kasus sederhana.

---

## 8. Golden Rule Sebelum Rewrite

Sebelum rewrite shared repo:

```text
1. Pahami tujuan.
2. Buat backup.
3. Gunakan clone bersih.
4. Uji hasil lokal.
5. Verifikasi secret/file hilang.
6. Koordinasi dengan tim.
7. Freeze push sementara.
8. Force push dengan sengaja.
9. Instruksikan re-clone/reset.
10. Tangani tags/forks/caches.
11. Rotasi secret jika ada.
```

Jangan jalankan rewrite langsung di working repo harian tanpa backup.

---

## 9. Backup dan Clone Bersih

Buat mirror clone:

```bash
git clone --mirror git@github.com:acme/case-service.git case-service.git
cd case-service.git
```

Mirror clone menyimpan semua refs.

Backup:

```bash
cd ..
cp -a case-service.git case-service-backup.git
```

Atau gunakan storage internal aman.

Jangan mengandalkan “nanti bisa undo”.

Rewrite bisa merusak referensi jika salah.

---

## 10. Analisis Repository dengan `git filter-repo --analyze`

Di clone bersih:

```bash
git filter-repo --analyze
```

Tool menghasilkan laporan di:

```text
.git/filter-repo/analysis/
```

Bisa menunjukkan:

- large blobs;
- path besar;
- file extensions;
- directories;
- object sizes.

Gunakan sebelum cleanup large file.

---

## 11. Menghapus File Secret dari History

Misal secret file:

```text
src/main/resources/application-prod.yml
```

Langkah konsep:

```bash
git clone --mirror <repo-url> repo.git
cd repo.git

git filter-repo --path src/main/resources/application-prod.yml --invert-paths
```

Verifikasi:

```bash
git log --all -- src/main/resources/application-prod.yml
git grep -n "SECRET_VALUE" $(git rev-list --all)
```

Jika bersih, force push:

```bash
git push --force --mirror
```

Namun hati-hati dengan `--mirror`: ia mendorong semua refs, termasuk deletion. Pastikan memang itu yang diinginkan.

Alternatif push branch/tag tertentu lebih controlled.

Security note:

```text
Secret tetap harus dirotate.
```

---

## 12. Menghapus Banyak Path

Contoh:

```text
.env
.env.local
config/prod-secrets.yml
```

Buat file paths:

```text
paths-to-remove.txt
```

Isi:

```text
.env
.env.local
config/prod-secrets.yml
```

Command:

```bash
git filter-repo --paths-from-file paths-to-remove.txt --invert-paths
```

Pastikan path exact.

Jika secret muncul di banyak file dengan pattern, path removal mungkin tidak cukup.

---

## 13. Mengganti Text Secret di History

Kadang secret muncul di file yang tidak ingin dihapus total.

`git filter-repo` bisa replace text.

Buat replacements:

```text
replacements.txt
```

Format concept:

```text
literal:old-secret==>REDACTED
regex:password\s*=\s*[^ \n]+==>password=REDACTED
```

Run:

```bash
git filter-repo --replace-text replacements.txt
```

Caveat:

- binary/encoded secret mungkin tidak kena;
- regex bisa merusak file;
- secret tetap harus dirotate;
- test hasil dengan hati-hati.

Untuk secret, sering lebih aman menghapus file/path jika feasible.

---

## 14. Menghapus Large File dari History

Misal:

```text
target/case-service.jar
```

Run:

```bash
git filter-repo --path target/case-service.jar --invert-paths
```

Jika banyak build outputs:

```bash
git filter-repo --path-glob 'target/**' --path-glob 'build/**' --invert-paths
```

Hati-hati:

```text
Jangan menghapus path build/ jika repo punya legitimate source directory bernama build-logic atau build scripts.
```

Use exact patterns.

---

## 15. Menghapus Semua Blob di Atas Ukuran Tertentu dengan BFG

Concept:

```bash
git clone --mirror <repo-url> repo.git
java -jar bfg.jar --strip-blobs-bigger-than 50M repo.git
cd repo.git
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push --force --mirror
```

Caveat:

- BFG tidak menghapus file di HEAD by default unless removed first;
- pastikan current tree tidak masih mengandung file besar;
- verify after cleanup.

Use for bloat cleanup, not nuanced migration.

---

## 16. Membersihkan Reflog dan GC Setelah Rewrite Lokal

Setelah rewrite di local clone:

```bash
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

Ini membersihkan old objects lokal yang tidak reachable.

Namun remote hosting punya GC sendiri.

Setelah force push, remote mungkin masih menyimpan old objects untuk sementara atau karena refs tersembunyi.

---

## 17. Remote Refs, PR Refs, dan Hidden References

Hosting platform bisa punya refs lain:

- pull request refs;
- merge request refs;
- CI refs;
- backup refs;
- fork refs;
- protected refs.

Secret/large object bisa tetap reachable dari hidden refs.

Jika secret serius:

- contact platform admin/support;
- delete affected PR refs if possible;
- clean forks if possible;
- rotate secret anyway.

History rewrite tidak menjamin complete erasure dari semua copies.

---

## 18. Tags Saat Rewrite

Tags menunjuk commit lama.

Jika rewrite branch history, tags lama mungkin tetap menunjuk old commits.

Options:

1. Delete/recreate tags on rewritten commits.
2. Preserve old tags if they represent historical releases and no secret there.
3. Namespace old tags.
4. Avoid rewriting release history unless necessary.

If secret/large file exists before release tags, tags may keep old history reachable.

Need plan:

```bash
git tag
git show <tag>
```

For signed tags:

```text
Recreating tags invalidates old signatures.
Need re-sign if policy requires.
```

This is a major audit consideration.

---

## 19. Branches Saat Rewrite

Branches not rewritten can keep old objects reachable.

If you rewrite only `main` but old branch `feature/old` still has secret, object remains.

Analyze all refs:

```bash
git for-each-ref --format='%(refname)'
```

Rewrite all relevant refs.

Mirror rewrite covers all refs in mirror clone, but force pushing all refs is risky.

Coordinate.

---

## 20. Forks

If repository has forks, old history may persist there.

Options:

- notify fork owners;
- request deletion/rebase;
- platform admin action if internal;
- rotate secrets regardless.

Public repo secret leak:

```text
Assume irreversible exposure.
```

---

## 21. Developer Instructions After Rewrite

After shared history rewrite, developers should usually re-clone.

Safest:

```bash
mv case-service case-service-old
git clone <repo-url> case-service
```

If they have local work:

```text
Create patches before re-clone.
```

Example:

```bash
cd case-service-old
git format-patch origin/main..HEAD -o /tmp/my-patches
```

Then apply to new clone:

```bash
cd ../case-service
git am /tmp/my-patches/*.patch
```

If local branches need recovery, be careful.

Avoid casual `git pull` after rewrite; it can create confusing merges.

---

## 22. Reset Existing Clone After Rewrite

If re-clone impossible, advanced reset:

```bash
git fetch --all --prune
git checkout main
git reset --hard origin/main
git gc --prune=now
```

But old local refs/reflogs may keep old objects.

To fully clean local old objects:

```bash
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

If secret cleanup, re-clone is clearer.

---

## 23. Preserving Local Work Across Rewrite

Before reset/re-clone:

```bash
git status
git branch
git log --oneline --decorate --all -10
```

Options:

## 23.1 Patch

```bash
git diff > /tmp/work.patch
git diff --cached > /tmp/staged.patch
```

## 23.2 Format Patch for Commits

```bash
git format-patch <old-base>..my-branch -o /tmp/patches
```

## 23.3 Bundle

```bash
git bundle create /tmp/my-work.bundle my-branch
```

Apply after new clone carefully.

---

## 24. Splitting a Subdirectory into New Repo

Use case:

```text
Extract libs/workflow-core from monorepo into workflow-core.git
```

With `git filter-repo`:

```bash
git clone <monorepo-url> workflow-core-extract
cd workflow-core-extract
git filter-repo --path libs/workflow-core/ --path-rename libs/workflow-core/:
```

Result repo contains only files from that path, moved to root.

Then create new remote:

```bash
git remote remove origin
git remote add origin git@github.com:acme/workflow-core.git
git push -u origin main
```

Caveat:

- commit SHAs change;
- tags need filtering/renaming;
- build config may need reconstruction;
- history only for selected path;
- cross-module commits become partial.

---

## 25. Keeping Multiple Paths During Split

Example:

```text
libs/workflow-core/
build-logic/
gradle/
settings.gradle.kts
```

Command concept:

```bash
git filter-repo \
  --path libs/workflow-core/ \
  --path build-logic/ \
  --path gradle/ \
  --path settings.gradle.kts \
  --path-rename libs/workflow-core/:
```

But path rename only applies selected path.

Migration often requires post-filter cleanup.

Sometimes easier:

1. Filter relevant path.
2. Add new build files manually.
3. Commit migration cleanup.

---

## 26. Moving a Subdirectory Within History

Example:

```text
Old path: service/
New path: services/case-service/
```

Use:

```bash
git filter-repo --path-rename service/:services/case-service/
```

This rewrites history as if files always lived at new path.

Useful for monorepo migration.

But consider whether preserving old path in history is actually necessary.

Sometimes a normal move commit is better because it preserves audit event.

---

## 27. Merging Repositories into Monorepo

Goal:

```text
case-service.git -> monorepo/services/case-service
audit-service.git -> monorepo/services/audit-service
```

Strategy:

1. Rewrite each repo history to live under subdirectory.
2. Merge histories into monorepo.

For each repo:

```bash
git clone case-service.git case-service-rewrite
cd case-service-rewrite
git filter-repo --to-subdirectory-filter services/case-service
```

Then in monorepo:

```bash
git remote add case-service ../case-service-rewrite
git fetch case-service
git merge --allow-unrelated-histories case-service/main
```

Repeat for other repos.

Caveats:

- tag collisions;
- branch naming;
- CI/build config conflicts;
- CODEOWNERS;
- README conflicts;
- history size;
- access control change;
- release traceability.

---

## 28. Tag Collisions During Repo Merge

Two repos may both have:

```text
v1.0.0
v1.1.0
```

In monorepo, tags collide.

Before merge, rename tags:

```text
case-service-v1.0.0
audit-service-v1.0.0
```

Or keep old repos archived and start new tag convention.

Tag migration is policy decision.

Do not blindly import tags from multiple repos without plan.

---

## 29. Author Rewrite

Sometimes old commits have wrong emails:

```text
john@localhost
john.personal@gmail.com
```

Use mailmap for display:

```text
.mailmap
```

Example:

```text
John Doe <john.doe@acme.com> <john@localhost>
```

This changes display in logs without rewriting history.

Prefer `.mailmap` if possible.

Rewrite author only if necessary.

With `git filter-repo`, author callback can rewrite metadata, but commit SHAs change.

Decision:

```text
For display normalization -> .mailmap.
For legal/compliance migration -> maybe rewrite.
```

---

## 30. `.mailmap`

`.mailmap` lets Git show canonical author names/emails.

Track file:

```text
.mailmap
```

Example:

```text
Jane Smith <jane.smith@acme.com> <jsmith@oldmail.com>
Jane Smith <jane.smith@acme.com> Jane <jane@laptop.local>
```

Use:

```bash
git shortlog -sne
git log --use-mailmap
```

Benefit:

```text
No history rewrite.
```

This is safer than rewriting author history.

---

## 31. Removing Sensitive File But Keeping Placeholder

If file path should exist but without secret:

```text
application-prod.yml
```

Better future state:

```yaml
database:
  password: ${DATABASE_PASSWORD}
```

History cleanup options:

- remove entire old file from history;
- replace secret text with placeholder;
- keep current sanitized file.

If using filter-repo replace-text, current and old history may become sanitized.

After rewrite, verify all revisions.

---

## 32. Verification After Rewrite

Verify file gone:

```bash
git log --all -- path/to/secret.file
```

Search value:

```bash
git grep -n "actual-secret" $(git rev-list --all)
```

Search large blobs:

```bash
git rev-list --objects --all |
git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' |
awk '$1 == "blob" {print $3, $4}' |
sort -nr |
head -20
```

Run tests/build:

```bash
./mvnw test
./gradlew test
```

Check tags/branches:

```bash
git branch -a
git tag
```

Do not push before verification.

---

## 33. Communication Plan for Shared Rewrite

Announcement should include:

```text
What happened?
Why rewrite is needed?
When freeze starts?
Which branches/tags affected?
What developers must do?
How to preserve local work?
Who to contact?
When old clones should be deleted?
```

Example:

```text
We will rewrite case-service history on 2026-06-18 10:00 UTC
to remove an accidentally committed production credential and large dump.

Push freeze starts 09:30 UTC.
After completion, please re-clone the repository.
Do not merge old local branches directly; export patches if needed.
Credential has already been rotated.
```

Clarity prevents chaos.

---

## 34. Force Push Strategy

For rewritten main:

```bash
git push --force-with-lease origin main
```

For all branches/tags, mirror:

```bash
git push --force --mirror origin
```

`--mirror` is powerful and dangerous.

It updates/deletes all refs to match local mirror.

Use only if you intentionally manage all refs.

For shared repo, consider:

- push main first;
- update release branches;
- update tags carefully;
- delete old branches containing secret;
- avoid accidentally deleting protected refs.

---

## 35. Branch Protection During Rewrite

Branch protection may block force push.

Options:

- temporary admin bypass;
- temporarily allow force push;
- use platform migration mode;
- coordinate with repo admins.

After rewrite:

```text
Re-enable protections immediately.
```

Log who changed protection and why.

---

## 36. CI/CD After Rewrite

Expect:

- CI caches invalidated;
- open PRs need rebase/recreate;
- workflows referencing old SHAs fail;
- release jobs using old tags may fail;
- deployment manifests may reference old commit SHA;
- submodule pointers may break if rewritten repo used as submodule.

Update:

- badges;
- docs;
- deployment metadata if needed;
- submodule pointers;
- downstream references.

---

## 37. Open Pull Requests

Open PR branches based on old history may conflict.

Options:

1. Close and recreate PRs from new base.
2. Rebase PR branches onto new main.
3. Apply patches to fresh branches.

Developers should not merge old branch into rewritten main blindly because it can reintroduce old history.

Recommended:

```bash
git format-patch old-base..feature
# apply to fresh clone
git am patches
```

---

## 38. Avoid Reintroducing Removed Objects

After cleanup, old clones can accidentally push old history back.

Prevention:

- protect branches;
- delete/close old branches;
- instruct re-clone;
- server-side secret scanning;
- reject large blobs;
- monitor pushes;
- communicate clearly.

If old branch contains secret and someone opens PR, secret may return.

---

## 39. Secret Rotation Still Required

This cannot be overstated.

History rewrite is not enough.

If secret entered Git:

```text
Rotate/revoke secret first.
```

Reason:

- exposure already happened;
- old clones/forks exist;
- logs/caches/backups may exist;
- scanner bots may have captured public secret.

History cleanup is hygiene after containment.

---

## 40. Audit Considerations

Rewrite can change audit trail.

For regulated systems, document:

```text
Original issue:
Reason for rewrite:
Scope:
Tool used:
Refs affected:
Verification:
Secret rotation:
Approvals:
Date/time:
Operator:
Post-rewrite instructions:
```

Keep secure backup if required by policy, but not accessible broadly.

If removing illegal/sensitive data, backup retention must follow legal/security guidance.

---

## 41. Rewrite and Signed Commits/Tags

Rewriting commits invalidates commit signatures because commit object changes.

Signed tags pointing to old commits become invalid/unwanted.

After rewrite:

- commit signatures may be gone or invalid;
- tags need recreation/re-signing;
- verification history changes.

If signed history is required, rewrite is high-impact.

Sometimes you cannot preserve signatures.

Plan with security/compliance stakeholders.

---

## 42. Rewrite and Submodules

If a repo is used as submodule elsewhere, rewriting it changes commit availability.

Parent repos may point to old submodule commits.

After rewrite, those commits may disappear.

Need update parent repos:

```text
parent repo submodule pointer -> new rewritten commit
```

Coordinate consumers.

If old submodule commit is in release tag, rewriting can break checkout of old releases.

This is serious.

---

## 43. Rewrite and Artifact Provenance

If artifacts were built from old commit SHAs, rewriting history changes ability to resolve source by SHA.

For released artifacts:

```text
Artifact metadata may reference old SHA.
```

If old SHA removed from public repo, provenance link breaks.

Options:

- preserve secure archive;
- maintain mapping old SHA -> new SHA;
- do not rewrite release history unless necessary;
- if secret requires removal, document mapping and incident.

---

## 44. Mapping Old SHAs to New SHAs

`git filter-repo` can produce mapping info depending usage.

You can preserve mapping for migration.

Why useful:

- update references;
- audit;
- support developers rebasing old work;
- artifact provenance.

Store mapping securely if it references sensitive history.

For non-sensitive migration, mapping can be shared.

---

## 45. Repository Archive Before Rewrite

For migration, you may archive old repo read-only.

But if rewrite is due to secret/PII, do not keep broadly accessible old archive.

If archive is needed for legal/audit, restrict access.

For ordinary split/merge, archive old repo with notice:

```text
This repo has moved to monorepo path services/case-service.
Read-only after 2026-06-18.
```

---

## 46. Rewrite for Repo Split vs Normal Move Commit

If you split subdirectory into new repo and want clean history:

```text
Use filter-repo.
```

If you merely move directories in same repo:

```text
Use normal git mv commit.
```

Normal move preserves audit trail without changing SHA history.

Rewrite path history only if necessary for migration.

---

## 47. Rewrite for Large File vs Git LFS Migration

If large files should now be in LFS, use:

```bash
git lfs migrate import --include="*.bin"
```

This rewrites history so matching files become LFS pointers.

Caveat:

- all SHAs change;
- LFS storage required;
- CI/developers need LFS;
- old files must be uploaded to LFS;
- coordinate like any rewrite.

If large file should be removed entirely, use filter-repo/BFG instead.

---

## 48. Common Mistakes

## 48.1 Running Rewrite on Dirty Working Tree

Use clean clone.

## 48.2 Forgetting Tags

Old tags keep old history reachable.

## 48.3 Not Rotating Secret

Critical failure.

## 48.4 Force Push Without Announcement

Breaks everyone.

## 48.5 Reintroducing Old Branch

Old local branch merged after rewrite reintroduces bad objects.

## 48.6 Using `--mirror` Without Understanding

Can delete refs.

## 48.7 Assuming GitHub/GitLab Immediately Purges Old Objects

Not guaranteed.

## 48.8 Rewriting Public Release History Casually

Breaks provenance/audit.

## 48.9 Not Updating Submodule Consumers

Breaks parent repos.

## 48.10 Cleanup Current Tree Only

Does not remove history.

---

## 49. Practical Playbook: Remove Large JAR from History

Scenario:

```text
target/case-service.jar committed months ago.
Repo clone bloated by 500 MB.
No secret.
```

Plan:

1. Announce maintenance.
2. Clone mirror.
3. Analyze.
4. Remove path.
5. GC.
6. Verify size.
7. Force push.
8. Developers re-clone.
9. Add `.gitignore`.
10. Add hook/CI guard.

Commands concept:

```bash
git clone --mirror git@github.com:acme/case-service.git case-service.git
cd case-service.git

git filter-repo --path target/case-service.jar --invert-paths

git count-objects -vH

git push --force --mirror
```

Then in normal repo:

```gitignore
target/
*.jar
!gradle/wrapper/gradle-wrapper.jar
!.mvn/wrapper/maven-wrapper.jar
```

---

## 50. Practical Playbook: Secret in `.env`

Scenario:

```text
.env committed to main.
```

Priority:

1. Rotate secret.
2. Remove current file.
3. Rewrite history.
4. Force push.
5. Re-clone.
6. Add prevention.

Commands concept:

```bash
git rm --cached .env
echo ".env" >> .gitignore
git commit -m "Stop tracking local env file"
git push
```

Then rewrite in mirror:

```bash
git clone --mirror <repo> repo.git
cd repo.git
git filter-repo --path .env --invert-paths
git push --force --mirror
```

But if secret also in logs/other files, need broader scan.

---

## 51. Practical Playbook: Extract Maven Module to New Repo

Scenario:

```text
modules/workflow-core becomes independent library repo.
```

Steps:

```bash
git clone <monorepo> workflow-core
cd workflow-core
git filter-repo --path modules/workflow-core/ --path-rename modules/workflow-core/:
```

Add missing build wrapper/config if needed:

```bash
# edit pom.xml/build.gradle, README, CI
git add .
git commit -m "Prepare workflow-core as standalone repository"
```

Push:

```bash
git remote add origin git@github.com:acme/workflow-core.git
git push -u origin main
```

Then in original monorepo:

- remove module or replace with artifact dependency;
- update builds;
- add release pipeline for new repo;
- archive docs.

---

## 52. Practical Playbook: Merge Repos into Gradle Monorepo

Scenario:

```text
case-service.git and audit-service.git become services in platform.git.
```

For each source repo:

```bash
git clone <case-service> case-service-rewrite
cd case-service-rewrite
git filter-repo --to-subdirectory-filter services/case-service
```

In platform repo:

```bash
git remote add case-service ../case-service-rewrite
git fetch case-service
git merge --allow-unrelated-histories case-service/main
```

Repeat for audit.

Then:

- resolve build config;
- unify settings.gradle;
- add CODEOWNERS;
- update CI;
- rename tags or archive old tags;
- document migration.

---

## 53. Practical Playbook: Replace Author Emails with `.mailmap`

Instead of rewrite:

Create `.mailmap`:

```text
John Doe <john.doe@acme.com> <john@localhost>
Jane Smith <jane.smith@acme.com> <jane.old@gmail.com>
```

Commit:

```bash
git add .mailmap
git commit -m "Normalize contributor identities with mailmap"
```

Use:

```bash
git shortlog -sne
git log --use-mailmap
```

This is low-risk.

---

## 54. Decision Matrix

| Situation | Recommended |
|---|---|
| Secret committed | Rotate + rewrite if needed |
| PII committed | Incident + rewrite + legal/security process |
| Large jar committed once in private branch | Amend/reset before push |
| Large jar in main history | filter-repo/BFG if impact significant |
| Bad public logic commit | Revert |
| Private branch messy | Interactive rebase |
| Wrong author display | `.mailmap` |
| Wrong author compliance requirement | Maybe rewrite |
| Split module to new repo | filter-repo |
| Merge repos into monorepo | filter-repo + merge unrelated histories |
| Move folder in same repo | normal `git mv` unless migration needs rewrite |
| Remove generated files from future only | `git rm --cached` + `.gitignore` |
| Remove generated files from all history | rewrite |

---

## 55. Checklist Before Rewrite

```text
[ ] Is rewrite truly necessary?
[ ] Is secret/PII rotated or incident process started?
[ ] Is scope known?
[ ] Are all affected branches/tags identified?
[ ] Is there a clean clone/mirror?
[ ] Is there a backup?
[ ] Is tool chosen?
[ ] Is command tested on copy?
[ ] Is output verified?
[ ] Is team notified?
[ ] Is push freeze scheduled?
[ ] Is branch protection plan ready?
[ ] Are tags handled?
[ ] Are downstream repos/submodules handled?
[ ] Are developer instructions written?
[ ] Are prevention controls ready?
```

---

## 56. Checklist After Rewrite

```text
[ ] Force push completed.
[ ] Branch protection restored.
[ ] Tags verified/recreated.
[ ] Secret/file no longer found in rewritten refs.
[ ] Repo size improved if bloat cleanup.
[ ] CI passes.
[ ] Developers instructed to re-clone/reset.
[ ] Old branches/PRs handled.
[ ] Downstream references updated.
[ ] Prevention hooks/CI added.
[ ] Incident/migration documented.
[ ] Secret rotation confirmed.
```

---

## 57. Latihan Praktis

## Latihan 1 — Private Repo Cleanup Lab

Buat repo lab:

```bash
git init rewrite-lab
cd rewrite-lab
echo "hello" > app.txt
git add app.txt
git commit -m "Initial"

dd if=/dev/zero of=big.bin bs=1M count=5
git add big.bin
git commit -m "Accidentally add big file"

git rm big.bin
git commit -m "Remove big file"
```

Observe:

```bash
git count-objects -vH
```

Run filter-repo in copy, remove `big.bin`, compare size.

## Latihan 2 — Secret Replace Lab

Create fake secret:

```bash
echo "password=fake-secret" > config.properties
git add config.properties
git commit -m "Add config"
```

Use replace-text to redact fake value.

Verify with `git grep` across history.

## Latihan 3 — Subdirectory Split

Create repo with:

```text
services/a
libs/b
```

Use `git filter-repo --path libs/b/ --path-rename libs/b/:`.

Observe resulting history.

## Latihan 4 — Mailmap

Create commits with different emails.

Add `.mailmap`.

Compare:

```bash
git shortlog -sne
git shortlog -sne --use-mailmap
```

## Latihan 5 — Communication Draft

Write a rewrite announcement for a secret leak cleanup.

Include freeze, re-clone instructions, and rotation status.

---

## 58. Pertanyaan Reflektif

1. Apakah Anda tahu kapan harus revert vs rewrite?
2. Apakah tim punya playbook secret leak?
3. Apakah secret rotation selalu prioritas pertama?
4. Apakah repo punya large file guard?
5. Apakah ada tag/release yang tidak boleh disentuh?
6. Apakah artifact provenance bergantung pada old SHAs?
7. Apakah submodule consumers akan terdampak rewrite?
8. Apakah forks/PR refs perlu ditangani?
9. Apakah developer tahu cara menyelamatkan local work setelah rewrite?
10. Apakah `.mailmap` cukup untuk author cleanup?
11. Apakah repo split/merge butuh preserving history?
12. Apakah history rewrite akan merusak audit evidence?
13. Apakah backup aman dan aksesnya tepat?
14. Apakah branch protection akan dipulihkan?
15. Apakah prevention controls sudah siap setelah cleanup?

---

## 59. Mental Model Akhir

Rewrite history adalah operasi migrasi commit graph.

Ia bukan sekadar “menghapus file”.

Ia membuat dunia baru:

```text
old commits -> new commits
old branch tips -> new branch tips
old tags -> mungkin invalid
old clones -> divergent
old provenance -> perlu mapping
```

Gunakan rewrite untuk masalah yang memang membutuhkan rewrite:

- secret;
- PII;
- bloat besar;
- repo migration.

Jangan gunakan rewrite untuk membatalkan public logic change biasa. Gunakan revert.

Untuk shared history, keberhasilan rewrite bukan hanya command berhasil.

Keberhasilan rewrite berarti:

```text
data sensitive ditangani,
history baru diverifikasi,
tim berhasil migrasi,
CI kembali hijau,
downstream tidak rusak,
dan kontrol pencegahan ditambahkan.
```

---

## 60. Koneksi ke Part Berikutnya

Part ini membahas rewrite history, cleanup, dan migration.

Part berikutnya masuk ke Git internals dan ref management yang lebih advanced:

```text
learn-git-mastery-for-java-engineers-part-029.md
```

Topik:

```text
Advanced Ref Management: Refspec, Notes, Namespaces, dan Internals
```

Kita akan membahas:

- refs sebagai pointer;
- refspec;
- remote ref mapping;
- fetch/push advanced;
- namespaces;
- Git notes;
- packed refs;
- symbolic refs;
- replace refs;
- internal files;
- bagaimana memahami operasi Git pada level refs.

---

## 61. Referensi

Rujukan utama untuk materi ini:

- Git official documentation: filter-repo concepts, git gc, git reflog, git push, git tag
- Git LFS migrate documentation
- BFG Repo-Cleaner documentation
- Pro Git Book: rewriting history, Git internals, maintenance and data recovery
- Praktik umum incident response untuk secret leakage, repository migration, monorepo split/merge, large file cleanup, and enterprise Git governance

---

## 62. Status Seri

```text
Progress: 028 / 032
Seri belum selesai.
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
```

Bagian berikutnya:

```text
learn-git-mastery-for-java-engineers-part-029.md
```

Topik:

```text
Advanced Ref Management: Refspec, Notes, Namespaces, dan Internals
```

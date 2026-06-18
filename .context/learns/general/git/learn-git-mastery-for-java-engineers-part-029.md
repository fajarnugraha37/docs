# learn-git-mastery-for-java-engineers-part-029.md

# Part 029 — Advanced Ref Management: Refspec, Notes, Namespaces, dan Internals

> **Seri:** Git Mastery for Java Engineers  
> **Bagian:** 029 / 032  
> **Topik:** Manajemen reference tingkat lanjut: refs, refspec, remote mapping, symbolic refs, packed refs, namespaces, notes, replace refs, dan Git internals praktis  
> **Target pembaca:** Java software engineer yang ingin memahami Git pada level internal agar mampu mendiagnosis masalah remote, branch, tag, CI, mirroring, dan repository automation  
> **Status seri:** Belum selesai. Bagian terakhir adalah `learn-git-mastery-for-java-engineers-part-032.md`.

---

## 0. Ringkasan Eksekutif

Pada bagian-bagian awal, kita membangun mental model bahwa branch bukan salinan folder.

Branch adalah pointer ke commit.

Di bagian ini kita masuk lebih dalam:

```text
Apa sebenarnya pointer itu?
Di mana Git menyimpannya?
Bagaimana remote branch dipetakan?
Apa itu refspec?
Kenapa `origin/main` bukan branch lokal?
Apa bedanya refs/heads, refs/remotes, refs/tags?
Apa itu symbolic ref?
Kenapa HEAD bisa menunjuk branch atau commit langsung?
Apa itu packed-refs?
Apa itu git notes?
Apa itu replace refs?
Apa itu namespace?
Bagaimana fetch/push sebenarnya bekerja pada level ref?
```

Jika Anda hanya memakai Git sehari-hari, topik ini tampak internal.

Tetapi untuk engineer senior, pemahaman refs penting saat menghadapi:

- remote branch aneh;
- branch tidak muncul setelah fetch;
- tag release salah;
- force push recovery;
- mirror repository;
- CI checkout detached HEAD;
- submodule pointer;
- fork synchronization;
- GitOps repository;
- migration monorepo;
- custom automation;
- advanced release pipeline;
- incident forensic.

Mental model utama:

```text
Git object database menyimpan object.
Refs memberi nama pada object.
Sebagian besar operasi Git adalah memindahkan, membaca, atau memetakan refs.
```

---

## 1. Object vs Reference

Git object:

- blob;
- tree;
- commit;
- tag object.

Object disimpan berdasarkan hash content.

Commit SHA contoh:

```text
a13f9e2c9d7b...
```

Reference atau ref adalah nama yang menunjuk ke object.

Contoh:

```text
refs/heads/main       -> a13f9e2
refs/heads/feature-x  -> b21d7c9
refs/tags/v1.8.3      -> c44e12a
refs/remotes/origin/main -> a13f9e2
```

Branch bukan object khusus.

Branch adalah ref.

Tag juga ref, tetapi bisa menunjuk ke commit atau tag object.

HEAD adalah symbolic ref atau direct commit reference.

---

## 2. Lokasi Refs di `.git`

Di repository biasa:

```text
.git/
  HEAD
  refs/
    heads/
      main
      feature-x
    remotes/
      origin/
        main
    tags/
      v1.8.3
```

Lihat:

```bash
cat .git/refs/heads/main
```

Output:

```text
a13f9e2c9d7b...
```

Itu branch pointer.

Lihat HEAD:

```bash
cat .git/HEAD
```

Jika normal:

```text
ref: refs/heads/main
```

Jika detached HEAD:

```text
a13f9e2c9d7b...
```

Poin penting:

```text
Branch adalah file kecil berisi SHA, atau entry di packed-refs.
```

---

## 3. `refs/heads/*`

Local branches disimpan di:

```text
refs/heads/
```

Contoh:

```text
refs/heads/main
refs/heads/feature/case-escalation
refs/heads/release/2.8
```

Command:

```bash
git branch
```

pada dasarnya menampilkan refs di `refs/heads`.

Membuat branch:

```bash
git branch feature/x
```

membuat ref baru:

```text
refs/heads/feature/x
```

yang menunjuk ke commit saat ini.

---

## 4. `refs/remotes/*`

Remote-tracking branches disimpan di:

```text
refs/remotes/<remote>/<branch>
```

Contoh:

```text
refs/remotes/origin/main
refs/remotes/origin/feature/x
refs/remotes/upstream/main
```

`origin/main` bukan branch lokal.

Ia adalah local record dari posisi branch `main` di remote `origin` saat fetch terakhir.

Artinya:

```text
origin/main = snapshot lokal tentang remote branch.
```

Update:

```bash
git fetch origin
```

mengupdate `refs/remotes/origin/*`.

---

## 5. `refs/tags/*`

Tags disimpan di:

```text
refs/tags/
```

Contoh:

```text
refs/tags/v1.8.3
```

Lightweight tag:

```text
refs/tags/v1.8.3 -> commit
```

Annotated/signed tag:

```text
refs/tags/v1.8.3 -> tag object -> commit
```

Lihat:

```bash
git show-ref --tags
git cat-file -t v1.8.3
```

Jika output:

```text
tag
```

itu annotated tag.

Jika:

```text
commit
```

itu lightweight tag.

---

## 6. `git show-ref`

Tampilkan refs:

```bash
git show-ref
```

Contoh:

```text
a13f9e2 refs/heads/main
b21d7c9 refs/heads/feature/x
a13f9e2 refs/remotes/origin/main
c44e12a refs/tags/v1.8.3
```

Tampilkan heads:

```bash
git show-ref --heads
```

Tags:

```bash
git show-ref --tags
```

Cek ref specific:

```bash
git show-ref refs/heads/main
```

---

## 7. `git rev-parse`

`git rev-parse` menerjemahkan nama revision ke SHA atau path internal.

Contoh:

```bash
git rev-parse HEAD
git rev-parse main
git rev-parse origin/main
git rev-parse v1.8.3
```

Full ref:

```bash
git rev-parse --symbolic-full-name main
```

Output:

```text
refs/heads/main
```

Untuk CI/debugging:

```bash
git rev-parse --abbrev-ref HEAD
```

Jika detached HEAD, output bisa:

```text
HEAD
```

Cek repo root:

```bash
git rev-parse --show-toplevel
```

Cek git dir:

```bash
git rev-parse --git-dir
```

---

## 8. `git update-ref`

`git update-ref` memodifikasi refs secara plumbing.

Contoh:

```bash
git update-ref refs/heads/experiment HEAD
```

Membuat/memindahkan branch `experiment` ke `HEAD`.

Delete:

```bash
git update-ref -d refs/heads/experiment
```

Kenapa penting?

Karena banyak command porcelain melakukan ini di bawahnya.

Misal:

```bash
git branch experiment
```

secara konseptual:

```bash
git update-ref refs/heads/experiment <commit>
```

Jangan pakai `update-ref` sembarangan di repo kerja kecuali paham.

Tetapi ia berguna untuk automation/migration.

---

## 9. Symbolic Ref

Symbolic ref adalah ref yang menunjuk ke ref lain, bukan langsung ke object.

HEAD biasanya symbolic ref:

```bash
cat .git/HEAD
```

Output:

```text
ref: refs/heads/main
```

Cek:

```bash
git symbolic-ref HEAD
```

Output:

```text
refs/heads/main
```

Set HEAD symbolic:

```bash
git symbolic-ref HEAD refs/heads/main
```

Remote default branch juga punya symbolic ref:

```text
refs/remotes/origin/HEAD -> refs/remotes/origin/main
```

Lihat:

```bash
git symbolic-ref refs/remotes/origin/HEAD
```

atau:

```bash
git remote set-head origin -a
```

---

## 10. Detached HEAD Revisited

Normal HEAD:

```text
HEAD -> refs/heads/main -> commit A
```

Detached HEAD:

```text
HEAD -> commit A
```

Tidak ada branch ref di tengah.

Jika commit baru dibuat dalam detached HEAD:

```text
HEAD -> commit B
```

Tetapi tidak ada branch name menunjuk ke B.

Jika checkout ke branch lain, B bisa menjadi unreachable kecuali disimpan oleh reflog.

Recovery:

```bash
git branch rescue <sha>
```

Mental model:

```text
Detached HEAD bukan error.
Itu HEAD yang menunjuk commit langsung.
```

CI sering checkout detached HEAD.

---

## 11. Packed Refs

Di repo kecil, refs bisa berupa file:

```text
.git/refs/heads/main
.git/refs/tags/v1.0.0
```

Di repo besar, Git bisa pack refs ke file:

```text
.git/packed-refs
```

Lihat:

```bash
cat .git/packed-refs
```

Isi:

```text
a13f9e2 refs/tags/v1.0.0
b21d7c9 refs/tags/v1.1.0
```

Kenapa?

- banyak tag/refs sebagai file bisa lambat;
- packed-refs lebih efisien.

Poin penting:

```text
Jangan berasumsi semua refs selalu ada sebagai file di .git/refs.
Gunakan command Git, bukan parsing file manual.
```

Command:

```bash
git pack-refs --all
```

---

## 12. Reflog for Refs

Reflog mencatat pergerakan refs lokal.

Contoh:

```bash
git reflog show HEAD
git reflog show main
git reflog show refs/heads/main
```

Lokasi internal:

```text
.git/logs/HEAD
.git/logs/refs/heads/main
```

Reflog lokal, tidak dipush sebagai bagian normal Git.

Reflog membantu recovery:

- reset hard;
- deleted branch;
- bad rebase;
- detached HEAD commit.

Tapi reflog bisa expire.

---

## 13. Refspec: Mental Model

Refspec adalah aturan mapping refs antara repository.

Format umum:

```text
<source>:<destination>
```

Fetch refspec:

```text
remote refs -> local refs
```

Push refspec:

```text
local refs -> remote refs
```

Contoh fetch default:

```text
+refs/heads/*:refs/remotes/origin/*
```

Artinya:

```text
Ambil semua branch remote di refs/heads/*
simpan sebagai remote-tracking refs/remotes/origin/*
```

Tanda `+` artinya allow non-fast-forward update pada remote-tracking ref.

---

## 14. Melihat Fetch Refspec Remote

```bash
git config --get-all remote.origin.fetch
```

Output:

```text
+refs/heads/*:refs/remotes/origin/*
```

Remote config ada di:

```text
.git/config
```

Contoh:

```ini
[remote "origin"]
    url = git@github.com:acme/case-service.git
    fetch = +refs/heads/*:refs/remotes/origin/*
```

---

## 15. Fetch Spesifik Branch

Ambil branch remote tertentu:

```bash
git fetch origin main
```

Konsep:

```text
fetch refs/heads/main dari origin
update FETCH_HEAD
dan remote tracking sesuai config
```

Fetch ke local branch tertentu:

```bash
git fetch origin main:refs/heads/tmp-main
```

Artinya:

```text
Ambil origin main dan tulis ke local branch tmp-main.
```

Hati-hati: ini bisa memindahkan local branch.

---

## 16. `FETCH_HEAD`

Setelah fetch:

```text
.git/FETCH_HEAD
```

menyimpan refs yang baru di-fetch.

Lihat:

```bash
cat .git/FETCH_HEAD
```

Command seperti:

```bash
git pull
```

secara konseptual:

```text
git fetch
git merge/rebase FETCH_HEAD
```

Meskipun detail modern bisa lebih kompleks.

---

## 17. Push Refspec

Push branch saat ini ke remote branch sama:

```bash
git push origin HEAD
```

Push local branch ke remote branch berbeda:

```bash
git push origin local-branch:remote-branch
```

Full:

```bash
git push origin refs/heads/local-branch:refs/heads/remote-branch
```

Create remote branch:

```bash
git push origin feature/x
```

Delete remote branch:

```bash
git push origin :feature/x
```

or modern:

```bash
git push origin --delete feature/x
```

---

## 18. Force Push Refspec

Force push:

```bash
git push --force-with-lease origin feature/x
```

Equivalent concept:

```text
update remote refs/heads/feature/x even if non-fast-forward,
but only if remote still at expected old value.
```

`--force` is more dangerous.

Use `--force-with-lease`.

---

## 19. Push Tags

Push one tag:

```bash
git push origin v1.8.3
```

Push all tags:

```bash
git push origin --tags
```

Push annotated/signed tag same command.

Delete tag remote:

```bash
git push origin :refs/tags/v1.8.3
```

or:

```bash
git push origin --delete tag v1.8.3
```

Careful: deleting/moving release tags is high-risk.

---

## 20. Mirror Push/Fetch

Mirror clone:

```bash
git clone --mirror <url> repo.git
```

Mirror fetch/push deals with all refs.

Push mirror:

```bash
git push --mirror
```

Danger:

```text
It makes remote refs match local refs, including deleting refs absent locally.
```

Use for migrations, not normal development.

---

## 21. Remote Names: `origin`, `upstream`

`origin` is just default remote name.

Fork workflow:

```text
origin   = your fork
upstream = original repo
```

Commands:

```bash
git remote -v
git remote add upstream git@github.com:acme/case-service.git
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push origin main
```

Remote-tracking refs:

```text
origin/main
upstream/main
```

They are different refs.

---

## 22. Tracking Branch / Upstream Branch

Local branch can have upstream config:

```bash
git branch --set-upstream-to=origin/main main
```

Config:

```ini
[branch "main"]
    remote = origin
    merge = refs/heads/main
```

View:

```bash
git branch -vv
```

Upstream is used by:

```bash
git pull
git push
git status
```

A local branch named `main` does not automatically track `origin/main` unless configured.

---

## 23. `push.default`

Git config:

```bash
git config --global push.default simple
```

Common values:

- `simple`;
- `current`;
- `upstream`;
- `matching`;
- `nothing`.

Recommended for most:

```text
simple
```

It pushes current branch to upstream branch with same name.

Avoid old `matching` unless you know why.

---

## 24. Refname Rules

Refs are path-like names.

Examples valid:

```text
refs/heads/feature/case-escalation
refs/tags/v1.8.3
```

But rules disallow certain patterns.

Avoid:

- spaces;
- `..`;
- trailing dot;
- `~`;
- `^`;
- `:`;
- `?`;
- `*`;
- `[`;
- backslash;
- names ending `.lock`;
- path component starting dot.

Use simple branch naming:

```text
feature/CASE-123-short-description
fix/CASE-456-bug
release/2.8
hotfix/CASE-999-prod-fix
```

---

## 25. Ambiguous Refs

If branch and tag have same name:

```text
v1.0
```

Git may warn or resolve with precedence.

Avoid same name for branch and tag.

Use explicit refs:

```bash
git rev-parse refs/tags/v1.0
git rev-parse refs/heads/v1.0
```

Ambiguity makes automation dangerous.

---

## 26. Namespaces

Git namespaces allow refs to be isolated under namespace.

Environment variable:

```bash
GIT_NAMESPACE=<namespace>
```

Refs become under:

```text
refs/namespaces/<namespace>/
```

Use cases:

- hosting multi-tenant isolation;
- server-side organization;
- special refs.

Most application developers rarely use namespaces directly.

But understanding helps when seeing strange refs in hosted Git internals.

---

## 27. Special Refs

Git uses special refs/files:

```text
HEAD
FETCH_HEAD
ORIG_HEAD
MERGE_HEAD
CHERRY_PICK_HEAD
REVERT_HEAD
BISECT_HEAD
```

## 27.1 `ORIG_HEAD`

Often set before dangerous moves:

- merge;
- reset;
- rebase;
- pull.

Recovery:

```bash
git reset --hard ORIG_HEAD
```

when appropriate.

## 27.2 `MERGE_HEAD`

Exists during merge.

## 27.3 `CHERRY_PICK_HEAD`

Exists during cherry-pick conflict.

## 27.4 `REVERT_HEAD`

Exists during revert conflict.

These indicate operation in progress.

---

## 28. `git notes`

Git notes attach metadata to commits without changing commit object.

Example:

```bash
git notes add -m "Investigated in incident INC-2026-041"
git notes show <commit>
```

Notes stored in refs:

```text
refs/notes/commits
```

Push notes:

```bash
git push origin refs/notes/*
```

Fetch notes:

```bash
git fetch origin refs/notes/*:refs/notes/*
```

Use cases:

- incident annotations;
- code review metadata;
- release metadata;
- migration mapping;
- external analysis.

Caveat:

- not fetched/pushed by default;
- platform support varies;
- not substitute for issue tracker or commit message.

---

## 29. Notes vs Commit Rewrite

If you need to add metadata to old commit:

Option A: rewrite commit message.

Bad for shared history.

Option B: use git notes.

Good if team/tooling supports notes.

Example:

```bash
git notes add -m "Root cause: missing transition guard test" a13f9e2
```

This preserves commit SHA.

But notes distribution requires explicit fetch/push.

---

## 30. Replace Refs

`git replace` lets you pretend one object replaces another.

Example:

```bash
git replace <old-commit> <new-commit>
```

Stored under:

```text
refs/replace/
```

Use cases:

- temporary history grafting;
- migration experiments;
- fixing parentage locally;
- forensic analysis.

Danger:

```text
Replace refs alter how Git views history locally.
They are surprising.
```

Disable:

```bash
GIT_NO_REPLACE_OBJECTS=1 git log
```

Delete:

```bash
git replace -d <old-commit>
```

Most teams should avoid replace refs in shared workflows unless highly deliberate.

---

## 31. Grafts and History Stitching

Before replace refs/filter tools, Git had grafts.

Modern approach:

- replace refs for temporary local view;
- filter-repo for permanent rewrite.

In repo migration, you may see replace refs used to connect histories before rewrite.

Understand they are not normal branch history.

---

## 32. Ref Locks

When Git updates ref, it creates lock files like:

```text
.git/refs/heads/main.lock
```

If Git process crashes, lock can remain.

Error:

```text
cannot lock ref
```

Before deleting lock manually:

```text
Ensure no Git process is running.
```

Then remove stale lock.

Common causes:

- concurrent Git operations;
- IDE background fetch;
- interrupted command;
- filesystem issue.

---

## 33. Packed Refs and Lock Errors

Error example:

```text
cannot lock ref 'refs/remotes/origin/feature/x':
is at <old> but expected <other>
```

Causes:

- concurrent fetch;
- remote branch deleted/renamed;
- case-insensitive ref collision;
- stale packed ref;
- conflicting ref path.

Example conflict:

```text
refs/remotes/origin/feature
refs/remotes/origin/feature/x
```

Git cannot have both file `feature` and directory `feature/`.

Fix may involve pruning/deleting stale ref.

---

## 34. Ref Path Collision

Problem:

Remote has branch:

```text
feature
```

and later branch:

```text
feature/x
```

Locally:

```text
refs/remotes/origin/feature
```

is a file, so Git cannot create:

```text
refs/remotes/origin/feature/x
```

because `feature` would need to be directory.

Error:

```text
cannot lock ref 'refs/remotes/origin/feature/x'
```

Fix:

```bash
git remote prune origin
```

or delete stale ref:

```bash
git update-ref -d refs/remotes/origin/feature
git fetch origin
```

Avoid branch naming collisions by convention.

---

## 35. Pruning Remote-Tracking Refs

Remote branch deleted, local still has `origin/old`.

Prune:

```bash
git fetch --prune
```

or:

```bash
git remote prune origin
```

Config:

```bash
git config --global fetch.prune true
```

For tags:

```bash
git fetch --prune --prune-tags
```

Be careful with tag pruning depending workflow.

---

## 36. Remote Tags and Fetch

By default, Git fetches tags reachable from fetched commits.

Fetch all tags:

```bash
git fetch --tags
```

Prune tags:

```bash
git fetch --prune --prune-tags
```

If tag moved on remote, local tag may not update automatically.

Deleting/recreating tags is risky.

To update tag explicitly:

```bash
git tag -d v1.8.3
git fetch origin tag v1.8.3
```

But for release tags, moving should be exceptional.

---

## 37. Negative Refspec

Advanced fetch can exclude refs using negative refspec.

Concept:

```text
^refs/heads/wip/*
```

Use case:

- avoid fetching huge/irrelevant namespace;
- mirror except certain refs.

Most Java engineers rarely need this.

But in large enterprise repos, custom refspecs can reduce noise.

---

## 38. Custom Fetch Refspec

Fetch only release branches:

```bash
git config remote.origin.fetch '+refs/heads/release/*:refs/remotes/origin/release/*'
```

Then:

```bash
git fetch origin
```

Only release branches are tracked.

This can confuse if developer expects all branches.

Document custom refspecs.

---

## 39. CI Checkout and Detached HEAD

CI often checks out specific commit SHA.

State:

```text
HEAD detached at <sha>
```

This is normal.

Problems arise when scripts assume branch:

```bash
git rev-parse --abbrev-ref HEAD
```

returns branch name.

In CI, use environment variables from platform:

- GitHub: `GITHUB_REF`, `GITHUB_SHA`, `GITHUB_HEAD_REF`;
- GitLab: `CI_COMMIT_REF_NAME`, `CI_COMMIT_SHA`;
- Jenkins variables.

Do not rely only on local branch.

---

## 40. Release Automation and Refs

Release script should be explicit:

```bash
git fetch --tags --prune
git checkout refs/tags/v1.8.3
```

or:

```bash
git switch release/2.8
```

Avoid ambiguous:

```bash
git checkout v1.8.3
```

if branch/tag names could collide.

Use full refs in automation:

```text
refs/tags/v1.8.3
refs/heads/main
```

---

## 41. Git Remote Default Branch

Remote default branch can change from `master` to `main`.

Local symbolic ref:

```text
refs/remotes/origin/HEAD
```

Update:

```bash
git remote set-head origin -a
```

See:

```bash
git remote show origin
```

If automation assumes `origin/master`, it breaks.

Use configured default branch or platform metadata.

---

## 42. Mirror Repository

Mirror contains all refs.

Use cases:

- backup;
- migration;
- rewrite history;
- replica;
- internal mirror of external repo.

Command:

```bash
git clone --mirror <url>
```

Fetch updates:

```bash
git remote update
```

Push mirror:

```bash
git push --mirror <new-url>
```

Again, `--mirror` can delete refs on target.

Use carefully.

---

## 43. Bare Repository

Bare repo has no working tree.

Used for server/mirror.

Layout:

```text
repo.git/
  objects/
  refs/
  HEAD
  config
```

No `.git` directory because the repo root itself is git dir.

Clone mirror is bare.

Development usually uses non-bare repo.

---

## 44. Alternate Object Databases

Git can use alternate object stores.

File:

```text
.git/objects/info/alternates
```

Use cases:

- shared object cache;
- CI optimization;
- clones sharing objects.

Most developers rarely manage manually.

But if object missing/errors happen in unusual setup, alternates might be involved.

---

## 45. Worktrees and Refs

`git worktree` creates additional working trees sharing one object database.

Worktree metadata:

```text
.git/worktrees/
```

Each worktree has its own HEAD.

Branches checked out in one worktree cannot normally be checked out in another simultaneously.

List:

```bash
git worktree list
```

Prune stale:

```bash
git worktree prune
```

Refs and worktrees interact; deleting branch used by worktree may fail.

---

## 46. Submodules and Gitlinks

A submodule is represented in parent tree as gitlink entry.

Mode:

```text
160000
```

It stores commit SHA of submodule.

Show:

```bash
git ls-tree HEAD libs/workflow-core
```

Output:

```text
160000 commit a13f9e2 libs/workflow-core
```

This is not a normal directory in parent Git object model.

Understanding this explains why submodule update is pointer update.

---

## 47. `git cat-file`

Inspect object:

```bash
git cat-file -t <sha>
git cat-file -p <sha>
```

Examples:

```bash
git cat-file -t HEAD
git cat-file -p HEAD
git cat-file -p HEAD^{tree}
```

Use:

- learn internals;
- inspect tag object;
- inspect tree;
- debug weird object/ref issue.

---

## 48. `git ls-tree`

Show tree content:

```bash
git ls-tree HEAD
git ls-tree HEAD src/main/java
```

Recursive:

```bash
git ls-tree -r HEAD --name-only
```

Useful to inspect commit content without checkout.

For submodule:

```bash
git ls-tree HEAD path/to/submodule
```

shows mode `160000`.

---

## 49. `git for-each-ref`

Powerful ref listing:

```bash
git for-each-ref
```

Custom format:

```bash
git for-each-ref --format='%(refname) %(objectname) %(committerdate)'
```

Branches sorted by date:

```bash
git for-each-ref --sort=-committerdate --format='%(refname:short) %(committerdate:relative)' refs/heads
```

Remote stale analysis:

```bash
git for-each-ref refs/remotes/origin --format='%(refname:short)'
```

Great for automation.

---

## 50. `git name-rev`

Find symbolic name for commit:

```bash
git name-rev <sha>
```

Useful in debugging:

```bash
git name-rev --name-only <sha>
```

But output heuristic depends on refs.

---

## 51. `git describe`

Describe commit relative to tags:

```bash
git describe --tags --always
```

Example:

```text
v1.8.3-12-ga13f9e2
```

Means:

```text
12 commits after tag v1.8.3, commit abbreviated a13f9e2
```

Useful for build version.

Caveats:

- needs tags;
- shallow clone may fail;
- tag strategy matters;
- annotated tags considered by default unless `--tags`.

---

## 52. Refs and Garbage Collection

Object reachable from refs is protected from pruning.

If no ref/reflog points to object, it can eventually be pruned.

Important:

```text
Creating a branch/tag protects commit.
Deleting branch may make commits unreachable.
Reflog delays pruning locally.
```

For recovery:

```bash
git branch rescue <sha>
```

creates ref and protects commit.

---

## 53. Refs in Incident Recovery

After bad force push:

1. Find old commit via reflog:

```bash
git reflog show origin/main
git reflog show main
```

2. Create rescue ref:

```bash
git branch rescue-main <old-sha>
```

3. Decide restore:

```bash
git push origin rescue-main:main
```

or controlled fix.

Remote-tracking reflog may exist locally depending config and fetch history.

Someone's clone may have old ref.

---

## 54. Refspec for Backup Branch

Push current HEAD to backup branch:

```bash
git push origin HEAD:refs/heads/backup/main-before-rewrite
```

This creates remote branch:

```text
backup/main-before-rewrite
```

Useful before risky operations.

But if backup contains secret, do not push broadly.

For secret cleanup, backup must be secured.

---

## 55. Namespaces in Hosting Platforms

Hosting platforms use refs for:

- pull requests;
- merge requests;
- review refs;
- pipeline refs;
- hidden refs.

Examples conceptually:

```text
refs/pull/123/head
refs/pull/123/merge
refs/merge-requests/123/head
```

These may not appear in normal fetch.

But they can keep commits reachable.

During cleanup, remember hidden refs.

---

## 56. Advanced Fetch PR Ref

GitHub PR ref concept:

```bash
git fetch origin pull/123/head:pr-123
```

Full:

```bash
git fetch origin refs/pull/123/head:refs/heads/pr-123
```

This fetches PR head to local branch.

Useful for reviewing PR locally.

Platform-specific.

---

## 57. Refs and Forks

Forks have separate refs.

Your repo cleanup does not automatically update forks.

If secret/large file exists in fork refs, it persists.

For public repos, assume exposure.

For enterprise internal, coordinate fork cleanup.

---

## 58. Refs and Permissions

Git core does not enforce branch protection.

Server/hosting layer does.

Locally, you can move any ref.

Remote may reject:

- protected branch update;
- non-fast-forward push;
- tag deletion;
- unsigned commit;
- missing status checks.

Understand separation:

```text
Git command can request ref update.
Server policy decides whether to accept.
```

---

## 59. Ref Transactions

Git updates refs transactionally where possible.

Multi-ref update must avoid partial corruption.

Modern Git has ref transaction internals.

As user, you mainly see:

- lock files;
- rejection if expected old value mismatches;
- atomic push support on server.

Atomic push:

```bash
git push --atomic origin branch1 branch2
```

Either all refs update or none.

Useful for coordinated branch/tag push if server supports.

---

## 60. Atomic Push Use Case

Release push:

```bash
git push --atomic origin main v1.8.3
```

If one update fails, both fail.

Useful when pushing branch and tag together.

But release branch/tag policy should still be carefully controlled.

---

## 61. Ref Logs on Server

Local reflog exists by default for local refs.

Remote server may or may not expose reflog.

Git hosting providers generally do not give normal users remote reflog access.

So if remote branch is force-pushed, recovery often depends on:

- local clone reflog;
- CI checkout logs;
- protected branch history;
- backup;
- platform support;
- someone else's clone.

Do not assume remote reflog can save you.

---

## 62. Practical Debug Playbook: Branch Missing After Fetch

Symptoms:

```text
Remote branch exists on platform, but local cannot see origin/branch.
```

Check:

```bash
git remote -v
git config --get-all remote.origin.fetch
git fetch origin
git branch -r | grep branch-name
```

Maybe custom refspec excludes it.

Fetch explicitly:

```bash
git fetch origin refs/heads/branch-name:refs/remotes/origin/branch-name
```

---

## 63. Practical Debug Playbook: Cannot Lock Ref

Symptoms:

```text
cannot lock ref refs/remotes/origin/feature/x
```

Check for collision:

```bash
git show-ref | grep 'refs/remotes/origin/feature'
```

If stale `origin/feature` conflicts with `origin/feature/x`:

```bash
git update-ref -d refs/remotes/origin/feature
git fetch origin
```

Or:

```bash
git remote prune origin
```

Be cautious if local refs matter.

---

## 64. Practical Debug Playbook: Tag Wrong Locally

Remote tag moved or local stale.

Check:

```bash
git rev-parse refs/tags/v1.8.3
git ls-remote --tags origin v1.8.3
```

If policy allows updating local tag:

```bash
git tag -d v1.8.3
git fetch origin tag v1.8.3
```

But ask why tag moved.

Release tags should not move casually.

---

## 65. Practical Debug Playbook: CI Has Detached HEAD

Script fails:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
# BRANCH=HEAD
```

Fix:

Use CI env variables.

Fallback:

```bash
if [ "${GITHUB_REF:-}" != "" ]; then
  echo "$GITHUB_REF"
else
  git rev-parse --abbrev-ref HEAD
fi
```

Better: design scripts to work from commit SHA, not branch when possible.

---

## 66. Practical Debug Playbook: Remote-Tracking Branch Stale

Delete remote branch on platform, but local still shows:

```bash
git branch -r
```

Fix:

```bash
git fetch --prune
```

Config:

```bash
git config --global fetch.prune true
```

---

## 67. Automation Guidelines

For scripts:

```text
[ ] Use full refs when possible.
[ ] Avoid ambiguous branch/tag names.
[ ] Fetch explicitly.
[ ] Handle detached HEAD.
[ ] Do not assume origin/main exists.
[ ] Do not assume tags are fetched in shallow clone.
[ ] Use --force-with-lease, not --force.
[ ] Use --atomic when updating related refs if supported.
[ ] Check server rejection.
[ ] Log old/new SHAs for ref updates.
```

---

## 68. Java Release Script Example

Pseudo-script:

```bash
#!/usr/bin/env bash
set -euo pipefail

VERSION="$1"
TAG="case-service-v$VERSION"

git fetch origin --tags --prune

git switch main
git reset --hard origin/main

if [ -n "$(git status --porcelain)" ]; then
  echo "Dirty tree"
  exit 1
fi

if git rev-parse "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "Tag already exists: $TAG"
  exit 1
fi

./mvnw clean verify

git tag -s "$TAG" -m "Release $TAG"
git push origin "refs/tags/$TAG"
```

Notes:

- uses explicit tag ref;
- checks dirty tree;
- signs tag;
- does not push branch unexpectedly.

Real release script needs more.

---

## 69. Git Internals: Why This Matters for Java Teams

Java teams encounter refs in:

- Maven release plugin tags;
- Gradle release plugins;
- CI detached checkout;
- GitHub Actions branch/tag refs;
- GitLab merge request refs;
- artifact version from `git describe`;
- release branches;
- backport branches;
- GitOps repo refs;
- submodule gitlinks;
- monorepo split/merge;
- dependency update bots;
- protected tags.

Knowing refs prevents magical thinking.

---

## 70. Common Anti-Patterns

## 70.1 Parsing `.git/refs` Directly

Use Git commands because refs may be packed.

## 70.2 Assuming `origin/main` Is Live Remote

It is local snapshot from last fetch.

## 70.3 Assuming HEAD Is Always Branch

CI and detached checkout break this.

## 70.4 Moving Tags Casually

Release tags should be immutable.

## 70.5 Custom Refspec Without Documentation

Confuses future developers.

## 70.6 Force Push Without Lease

Can overwrite others.

## 70.7 Ambiguous Branch/Tag Names

Automation hazard.

## 70.8 Ignoring Hidden PR Refs During Secret Cleanup

Old objects may remain reachable.

## 70.9 Relying on Remote Reflog

Usually not accessible.

## 70.10 Replace Refs in Shared Workflow Without Warning

Surprising and dangerous.

---

## 71. Checklist: Ref Debugging

```text
[ ] What exact ref am I inspecting?
[ ] Is it local branch, remote-tracking branch, tag, or special ref?
[ ] What SHA does it point to?
[ ] Is HEAD symbolic or detached?
[ ] When was last fetch?
[ ] What refspec maps remote refs?
[ ] Is ref packed?
[ ] Is there a path collision?
[ ] Is tag lightweight or annotated?
[ ] Is branch protected on server?
[ ] Is CI using detached SHA?
[ ] Are hidden refs involved?
```

Commands:

```bash
git show-ref
git rev-parse <name>
git symbolic-ref HEAD
git for-each-ref
git config --get-all remote.origin.fetch
git ls-remote origin
git cat-file -t <name>
```

---

## 72. Checklist: Ref-Safe Automation

```text
[ ] Use full refs for tags/branches.
[ ] Fetch before reading remote state.
[ ] Validate old SHA before update.
[ ] Use --force-with-lease if rewriting feature branch.
[ ] Use --atomic for multi-ref push if supported.
[ ] Avoid moving protected tags.
[ ] Handle detached HEAD.
[ ] Avoid relying on local branch in CI.
[ ] Log ref updates.
[ ] Fail loudly on ambiguity.
```

---

## 73. Latihan Praktis

## Latihan 1 — Inspect Refs

```bash
git show-ref
git for-each-ref --format='%(refname) %(objectname)'
cat .git/HEAD
git symbolic-ref HEAD
```

Jawab:

```text
HEAD menunjuk ke mana?
Branch lokal disimpan di mana?
Remote-tracking branch disimpan di mana?
```

## Latihan 2 — Manual Branch with update-ref

```bash
git update-ref refs/heads/lab-ref HEAD
git branch
git update-ref -d refs/heads/lab-ref
```

Pahami bahwa branch adalah ref.

## Latihan 3 — Refspec Fetch

```bash
git fetch origin main:refs/heads/tmp-main
git log --oneline tmp-main -5
git branch -D tmp-main
```

## Latihan 4 — Tag Object

```bash
git tag lightweight-test
git tag -a annotated-test -m "Annotated test"

git cat-file -t lightweight-test
git cat-file -t annotated-test
git show-ref --tags | grep test
```

Hapus setelahnya.

## Latihan 5 — Notes

```bash
git notes add -m "Lab note" HEAD
git notes show HEAD
git log --show-notes -1
git notes remove HEAD
```

## Latihan 6 — Packed Refs

```bash
git pack-refs --all
cat .git/packed-refs | head
git show-ref | head
```

Perhatikan bahwa command tetap bekerja.

## Latihan 7 — Detached HEAD

```bash
git checkout HEAD~1
cat .git/HEAD
git switch -
```

Pahami direct SHA vs symbolic ref.

---

## 74. Pertanyaan Reflektif

1. Apakah Anda bisa menjelaskan perbedaan `main` dan `origin/main`?
2. Apakah Anda tahu fetch refspec remote Anda?
3. Apakah release script Anda aman terhadap detached HEAD?
4. Apakah branch/tag name ambiguous pernah terjadi?
5. Apakah tag release protected dan immutable?
6. Apakah automation memakai full refs?
7. Apakah CI butuh full history/tags?
8. Apakah remote-tracking refs diprune rutin?
9. Apakah tim pernah mengalami cannot lock ref?
10. Apakah submodule pointer dipahami sebagai gitlink?
11. Apakah notes berguna untuk incident metadata?
12. Apakah replace refs dilarang/diatur?
13. Apakah mirror push digunakan dengan hati-hati?
14. Apakah force push selalu memakai lease?
15. Apakah Anda tahu cara menyelamatkan old branch melalui reflog?

---

## 75. Mental Model Akhir

Git terdiri dari:

```text
objects + refs + index + working tree + config
```

Bagian ini fokus pada refs.

Refs adalah nama yang memberi makna pada object:

```text
main        = nama untuk commit terbaru branch main
origin/main = snapshot lokal remote main
v1.8.3      = nama release
HEAD        = posisi kerja saat ini
```

Refspec adalah aturan mapping antar repo:

```text
remote refs/heads/* -> local refs/remotes/origin/*
local refs/heads/x  -> remote refs/heads/x
```

Advanced Git menjadi jauh lebih masuk akal ketika Anda melihat operasi sebagai:

```text
membaca refs
memindahkan refs
membandingkan refs
memetakan refs
melindungi refs
```

Engineer yang memahami refs dapat mendiagnosis masalah yang bagi orang lain terlihat seperti “Git aneh”.

---

## 76. Koneksi ke Part Berikutnya

Part ini membahas refs, refspec, notes, namespaces, dan internals praktis.

Part berikutnya masuk ke performance dan maintenance repository:

```text
learn-git-mastery-for-java-engineers-part-030.md
```

Topik:

```text
Performance dan Maintenance Repository
```

Kita akan membahas:

- `git gc`;
- commit-graph;
- maintenance tasks;
- packfiles;
- pruning;
- reflog expiry;
- shallow/partial clone;
- sparse checkout;
- diagnosing slow Git;
- large monorepo performance;
- CI checkout optimization;
- repository health audit.

---

## 77. Referensi

Rujukan utama untuk materi ini:

- Git official documentation: `gitrevisions`, `gitglossary`, `git-show-ref`, `git-update-ref`, `git-symbolic-ref`, `git-for-each-ref`
- Git official documentation: `git-fetch`, `git-push`, refspecs, remote configuration
- Git official documentation: `git-notes`, `git-replace`, `git-pack-refs`, `git-cat-file`, `git-ls-tree`
- Pro Git Book: Git internals, refs, refspec, transfer protocols, Git tools
- Praktik umum release automation, CI detached checkout, mirror migration, submodule internals, and enterprise Git repository management

---

## 78. Status Seri

```text
Progress: 029 / 032
Seri belum selesai.
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
```

Bagian berikutnya:

```text
learn-git-mastery-for-java-engineers-part-030.md
```

Topik:

```text
Performance dan Maintenance Repository
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-git-mastery-for-java-engineers-part-028.md](./learn-git-mastery-for-java-engineers-part-028.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-git-mastery-for-java-engineers-part-030.md](./learn-git-mastery-for-java-engineers-part-030.md)

</div>
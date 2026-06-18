# learn-git-mastery-for-java-engineers-part-000.md

# Part 000 — Peta Belajar Git Mastery untuk Java Software Engineers

> Seri: **Git Mastery for Java Software Engineers**  
> Bagian: **000 dari 032**  
> Status seri: **Belum selesai — ini adalah bagian pembuka/orientasi**  
> Target pembaca: Java software engineer yang ingin naik dari “bisa memakai Git” menjadi engineer yang mampu bernalar, mendesain workflow, melakukan recovery, debugging historis, dan menjaga repository sebagai bagian dari engineering governance.

---

## 0. Mengapa Part 000 Ada?

Bagian ini bukan materi command Git harian. Bagian ini adalah **peta belajar**.

Kita sengaja memulai dari daftar isi dan orientasi karena Git sering dipelajari dengan cara yang salah:

```text
Command dulu → hafalan → bisa jalan saat normal → panik saat konflik/rebase/reset/hotfix.
```

Cara belajar yang lebih kuat:

```text
Model dulu → state transition → command sebagai alat manipulasi state → observability → recovery → governance.
```

Git bukan hanya alat untuk menyimpan versi file. Git adalah sistem yang memodelkan evolusi software sebagai graph immutable, dengan pointer mutable, index/staging layer, working tree, object database, dan remote synchronization.

Kalau mental model ini kuat, command Git tidak lagi terasa seperti mantra. Setiap command bisa ditanya:

- State sekarang apa?
- State targetnya apa?
- Object apa yang dibuat?
- Ref mana yang digeser?
- Working tree berubah atau tidak?
- Index berubah atau tidak?
- History private atau sudah public?
- Apakah operasi ini aman untuk tim?
- Apa recovery plan kalau salah?

Itulah standar belajar seri ini.

---

## 1. Definisi Target: “Top 1% Git Skill” Itu Apa?

Dalam konteks seri ini, “top 1%” bukan berarti tahu command paling obscure atau bisa menulis plumbing command dari memori.

Yang dimaksud adalah kemampuan operasional dan arsitektural berikut:

1. **Mental model kuat**  
   Bisa menjelaskan Git sebagai object database, commit graph, references, HEAD, index, working tree, dan remote repository.

2. **Command dengan reasoning**  
   Tidak menjalankan command karena “katanya harus begitu”, tetapi karena tahu state transition yang akan terjadi.

3. **Low panic under failure**  
   Bisa menghadapi reset salah, rebase gagal, branch terhapus, commit hilang, conflict sulit, stash conflict, force-push risk, dan repository bloat.

4. **Forensic capability**  
   Bisa menjawab pertanyaan seperti:

   - Kapan bug ini masuk?
   - Commit mana yang menyebabkan regresi?
   - Kenapa method ini berubah?
   - Perubahan ini berasal dari feature, hotfix, atau merge mana?
   - Apakah release ini mengandung commit tertentu?

5. **Collaboration discipline**  
   Bisa membuat commit dan PR yang mudah direview, mengurangi konflik, menjaga branch lifetime, dan memilih merge/rebase/squash dengan sadar.

6. **Release and incident readiness**  
   Bisa melakukan tag, hotfix, cherry-pick, revert, backport, rollback reasoning, dan traceability dari commit ke artifact/deployment.

7. **Repository governance**  
   Bisa menyusun aturan branch protection, commit policy, secret prevention, generated file policy, large file policy, dan workflow yang defensible untuk tim.

8. **Java-aware Git usage**  
   Paham konsekuensi Git terhadap Maven, Gradle, dependency lock, wrapper, generated code, IDE files, line endings, multi-module project, monorepo, dan CI/CD.

Top-tier Git skill berarti Anda tidak hanya menyelesaikan masalah lokal, tetapi juga mengurangi risiko sistemik dalam workflow tim.

---

## 2. Prinsip Utama Seri

### 2.1 Git Command Is Not the Skill

```text
Git command is not the skill.
Git state transition understanding is the skill.
```

Command Git hanyalah interface.

Skill sebenarnya adalah memahami:

- apa yang berubah,
- di mana berubah,
- kenapa berubah,
- siapa yang terdampak,
- bagaimana memverifikasi,
- bagaimana rollback atau recover jika salah.

Contoh:

```bash
git reset --hard HEAD~1
```

Engineer biasa bertanya:

```text
Apakah command ini menghapus commit?
```

Engineer kuat bertanya:

```text
Branch ref akan mundur ke parent commit.
Index dan working tree akan disamakan dengan commit target.
Commit lama mungkin menjadi unreachable dari branch, tetapi masih bisa ditemukan lewat reflog sampai garbage collection membersihkannya.
Apakah commit ini sudah dipush?
Apakah ada orang lain yang bergantung pada commit itu?
```

Perbedaan kualitasnya sangat besar.

---

### 2.2 Git Adalah Sistem State, Bukan Sekadar Riwayat File

Banyak orang mengira Git hanya menyimpan “versi file”. Ini tidak salah sepenuhnya, tetapi terlalu dangkal.

Git lebih tepat dipahami sebagai:

```text
Content-addressed object database
+ commit graph
+ mutable references
+ staging/index layer
+ working tree
+ synchronization protocol antar repository.
```

Dalam seri ini, hampir semua command akan dikaitkan ke lima area tersebut:

| Area | Pertanyaan Mental |
|---|---|
| Object database | Object baru apa yang dibuat atau dipakai? |
| Commit graph | Node/edge graph mana yang berubah? |
| Refs | Branch/tag/HEAD mana yang bergeser? |
| Index | Apa yang sudah dipilih untuk commit berikutnya? |
| Working tree | File kerja lokal berubah atau tidak? |
| Remote | Repository lain sudah tahu perubahan ini atau belum? |

---

### 2.3 Safe Git = Observability + Reversibility

Git menjadi berbahaya ketika engineer tidak melakukan observability.

Sebelum dan sesudah operasi penting, biasakan:

```bash
git status
git log --oneline --graph --decorate --all -n 20
git diff
git diff --staged
git branch -vv
```

Git menjadi aman ketika Anda tahu:

- state sebelum operasi,
- operasi yang dilakukan,
- state setelah operasi,
- cara kembali jika hasilnya salah.

---

## 3. Peta Besar Git yang Akan Dipakai Sepanjang Seri

Bayangkan repository Git sebagai beberapa lapisan:

```text
┌────────────────────────────────────────────────────────────┐
│ Remote Repository                                           │
│ origin/main, origin/feature/x, tags, pull request refs       │
└────────────────────────────────────────────────────────────┘
                         ▲
                         │ fetch / push / pull
                         ▼
┌────────────────────────────────────────────────────────────┐
│ Local Repository                                            │
│                                                            │
│ .git/objects  → blob, tree, commit, tag                     │
│ .git/refs     → branches, tags, remote-tracking refs        │
│ HEAD          → current position                            │
│ reflog        → local movement history                      │
└────────────────────────────────────────────────────────────┘
                         ▲
                         │ commit / checkout / reset / merge
                         ▼
┌────────────────────────────────────────────────────────────┐
│ Index / Staging Area                                        │
│ candidate snapshot untuk commit berikutnya                  │
└────────────────────────────────────────────────────────────┘
                         ▲
                         │ git add / git restore --staged
                         ▼
┌────────────────────────────────────────────────────────────┐
│ Working Tree                                                │
│ file yang Anda lihat dan edit di filesystem/IDE             │
└────────────────────────────────────────────────────────────┘
```

Kesalahan Git sering terjadi karena orang tidak tahu lapisan mana yang sedang mereka ubah.

Contoh:

| Command | Lapisan yang Terlibat |
|---|---|
| `git add` | Working tree → index |
| `git commit` | Index → object database + branch ref maju |
| `git checkout` / `git switch` | HEAD/ref + index + working tree dapat berubah |
| `git reset --soft` | Branch ref berubah, index/working tree tetap |
| `git reset --mixed` | Branch ref dan index berubah, working tree tetap |
| `git reset --hard` | Branch ref, index, dan working tree berubah |
| `git fetch` | Remote-tracking refs dan objects berubah, working tree tidak |
| `git pull` | Fetch + integrasi ke branch saat ini |
| `git push` | Mengirim objects/ref update ke remote |

Part berikutnya akan membangun ini dari bawah.

---

## 4. Scope Seri

Seri ini mencakup Git dari fondasi sampai tingkat arsitektural.

Yang akan dibahas:

- Git internals tingkat praktis.
- Daily workflow.
- Commit discipline.
- Branching, merge, rebase.
- Conflict resolution.
- Remote synchronization.
- Pull request/merge request.
- Team workflow.
- Release, tag, hotfix, backport.
- Undo, recovery, reflog.
- Stash dan worktree.
- Bisect dan forensic debugging.
- Java repository hygiene.
- Line endings dan cross-platform issues.
- Hooks.
- Submodule/subtree.
- Monorepo/polyrepo.
- Large files dan Git LFS.
- Security dan secret leakage.
- History rewrite lanjutan.
- Refspec dan internals advanced.
- Performance dan maintenance.
- CI/CD dan compliance.
- Capstone workflow design.

Yang tidak menjadi fokus utama:

- Tutorial UI GitHub/GitLab/Bitbucket secara klik-per-klik.
- Hafalan semua opsi command Git.
- Pembahasan mendalam implementasi C internal Git.
- Pengganti dokumentasi resmi Git.

Namun, ketika UI GitHub/GitLab relevan untuk PR, branch protection, CI, dan release governance, akan tetap dibahas secara konseptual.

---

## 5. Prasyarat

Prasyarat minimal:

- Bisa menggunakan terminal dasar.
- Bisa membaca struktur project Java.
- Familiar dengan Maven atau Gradle.
- Pernah memakai Git minimal untuk `clone`, `add`, `commit`, `push`, atau `pull`.

Prasyarat konseptual yang membantu:

- Paham immutable data secara umum.
- Paham graph/node/edge secara dasar.
- Paham distributed system secara kasar.
- Paham release lifecycle software.

Sebagai Java software engineer, analogi yang akan sering dipakai:

| Git Concept | Analogi Java/Engineering |
|---|---|
| Object identity by hash | Immutable value identity/content fingerprint |
| Commit graph | Event/history graph |
| Branch ref | Mutable pointer ke immutable commit |
| Index | Build plan/snapshot candidate |
| Merge | Integrasi dua line of work |
| Rebase | Replay patch set ke base baru |
| Tag | Release anchor/version marker |
| Reflog | Local audit trail untuk movement ref |
| CI checks | Automated quality gate |
| Branch protection | Governance boundary |

---

## 6. Struktur Seri Lengkap

Seri ini terdiri dari **32 part utama**, dimulai dari Part 000 sampai Part 032.

Catatan: Part 000 adalah orientasi dan daftar isi. Materi konseptual utama dimulai dari Part 001.

---

# Part 001 — Git sebagai Model Evolusi Software

**File:** `learn-git-mastery-for-java-engineers-part-001.md`

## Fokus

- Kenapa version control adalah primitive engineering.
- Masalah yang diselesaikan Git.
- Git vs backup vs file sharing vs centralized VCS.
- Git sebagai distributed revision control system.
- Snapshot vs diff mental model.
- Commit sebagai unit evolusi software.
- Repository sebagai object database + references + working tree.
- Kenapa Git terasa membingungkan jika dipahami sebagai folder biasa.

## Pertanyaan yang Dijawab

- Apa sebenarnya Git?
- Kenapa Git berbeda dari sekadar backup file?
- Mengapa commit disebut snapshot?
- Mengapa branch di Git murah?
- Apa hubungan Git dengan engineering safety?

## Outcome

Setelah part ini, Anda bisa menjelaskan Git sebagai model evolusi software, bukan sekadar tool command-line.

---

# Part 002 — Repository, Working Tree, Index, dan Object Database

**File:** `learn-git-mastery-for-java-engineers-part-002.md`

## Fokus

- Apa yang terjadi saat `git init`.
- Struktur `.git`.
- Working tree vs Git directory.
- Index/staging area.
- Local repository.
- Blob, tree, commit, tag.
- SHA/object id.
- Content-addressed storage.
- Snapshot candidate.

## Pertanyaan yang Dijawab

- Apa beda working tree, index, dan repository?
- Apa yang benar-benar disimpan Git?
- Apa yang terjadi saat `git add`?
- Apa yang terjadi saat `git commit`?

## Outcome

Anda bisa melihat Git sebagai database object lokal dan memahami staging area sebagai bagian penting dari desain Git.

---

# Part 003 — Commit Graph: Parent, Branch, HEAD, dan Reachability

**File:** `learn-git-mastery-for-java-engineers-part-003.md`

## Fokus

- Commit sebagai node.
- Parent commit sebagai edge.
- Commit graph sebagai DAG.
- Branch sebagai pointer.
- HEAD sebagai current position.
- Detached HEAD.
- Reachability.
- Unreachable/dangling commit.
- Kenapa commit bisa tampak hilang.

## Pertanyaan yang Dijawab

- Apa itu branch sebenarnya?
- Apa itu HEAD?
- Mengapa commit lama kadang masih bisa direcover?
- Apa maksud detached HEAD?

## Outcome

Anda bisa membaca Git history sebagai graph dan tidak lagi menganggap branch sebagai salinan folder.

---

# Part 004 — Lifecycle Perubahan: Dari Edit File sampai Commit Berkualitas

**File:** `learn-git-mastery-for-java-engineers-part-004.md`

## Fokus

- File states: untracked, modified, staged, committed.
- `git status` sebagai observability utama.
- `git add`, `git restore`, `git reset`.
- Partial staging.
- Interactive staging.
- Atomic commit.
- Commit message yang berguna.
- Commit sebagai unit review dan unit forensic.

## Pertanyaan yang Dijawab

- Apa yang sebaiknya masuk ke satu commit?
- Mengapa commit besar berbahaya?
- Bagaimana membuat commit yang mudah direview?
- Apa bedanya “save point” dan “logical change”?

## Outcome

Anda bisa membuat commit yang bersih, kecil, bermakna, dan berguna untuk debugging masa depan.

---

# Part 005 — Membaca History secara Efektif

**File:** `learn-git-mastery-for-java-engineers-part-005.md`

## Fokus

- `git log` sebagai query engine terhadap history.
- `--oneline`, `--graph`, `--decorate`, `--all`.
- `--stat`, `--patch`.
- `git show`.
- Author date vs commit date.
- Melihat history per file.
- Menelusuri perubahan class/method Java.

## Pertanyaan yang Dijawab

- Bagaimana membaca sejarah project tanpa tersesat?
- Bagaimana melihat perubahan detail sebuah commit?
- Bagaimana memahami konteks perubahan lama?

## Outcome

Anda bisa menjawab “apa yang berubah?” dan “bagaimana history-nya?” dengan presisi.

---

# Part 006 — Diff Mental Model: Membandingkan State, Bukan Sekadar File

**File:** `learn-git-mastery-for-java-engineers-part-006.md`

## Fokus

- Diff sebagai perbandingan snapshot.
- Working tree vs index.
- Index vs HEAD.
- Commit vs commit.
- Branch vs branch.
- Two-dot vs three-dot diff.
- Whitespace dan rename detection.
- Membaca diff Java dengan benar.

## Pertanyaan yang Dijawab

- Apa sebenarnya yang dibandingkan oleh `git diff`?
- Mengapa hasil diff branch kadang mengejutkan?
- Apa beda `A..B` dan `A...B`?

## Outcome

Anda bisa menggunakan diff untuk review, debugging, dan reasoning, bukan sekadar melihat baris merah/hijau.

---

# Part 007 — Branching: Isolasi Perubahan dan Eksperimen Aman

**File:** `learn-git-mastery-for-java-engineers-part-007.md`

## Fokus

- Branch sebagai ref mutable.
- Membuat, pindah, rename, delete branch.
- Local branch vs remote-tracking branch.
- Branch naming.
- Feature branch, bugfix branch, spike branch, release branch, hotfix branch.
- Detached HEAD.
- Branch lifetime.
- Risiko branch panjang.

## Pertanyaan yang Dijawab

- Mengapa branch di Git murah?
- Kapan branch harus dibuat?
- Kapan branch harus mati?
- Apa risiko branch yang terlalu lama hidup?

## Outcome

Anda bisa memakai branch sebagai alat isolasi dan koordinasi, bukan sebagai tempat menumpuk perubahan tanpa arah.

---

# Part 008 — Merge: Menggabungkan Sejarah Tanpa Kehilangan Konteks

**File:** `learn-git-mastery-for-java-engineers-part-008.md`

## Fokus

- Fast-forward merge.
- Three-way merge.
- Merge commit.
- Merge strategy secara konseptual.
- Conflict dasar.
- `--no-ff`.
- Merge sebagai dokumentasi integrasi.
- Kapan merge lebih baik daripada rebase.

## Pertanyaan yang Dijawab

- Apa yang terjadi saat merge?
- Mengapa merge commit kadang penting?
- Kapan fast-forward cukup?
- Kapan merge commit sebaiknya dipertahankan?

## Outcome

Anda bisa memilih merge dengan sadar dan memahami konsekuensinya terhadap history.

---

# Part 009 — Rebase: Memindahkan Perubahan dengan Aman

**File:** `learn-git-mastery-for-java-engineers-part-009.md`

## Fokus

- Rebase sebagai replay commit.
- Rebase vs merge.
- Commit baru hasil rebase.
- Rebase local vs public history.
- Conflict saat rebase.
- `continue`, `skip`, `abort`.
- Pull rebase.
- Golden rule rewrite history.

## Pertanyaan yang Dijawab

- Apa sebenarnya yang dilakukan rebase?
- Mengapa commit hash berubah setelah rebase?
- Kapan rebase aman?
- Kapan rebase berbahaya?

## Outcome

Anda bisa memakai rebase tanpa merusak history tim.

---

# Part 010 — Interactive Rebase: Sculpting History

**File:** `learn-git-mastery-for-java-engineers-part-010.md`

## Fokus

- `git rebase -i`.
- `pick`, `reword`, `edit`, `squash`, `fixup`, `drop`.
- Memecah commit.
- Menggabungkan commit.
- Merapikan commit sebelum PR.
- Autosquash.
- History sebagai narasi engineering.

## Pertanyaan yang Dijawab

- Bagaimana membersihkan commit sebelum review?
- Bagaimana mengubah commit message lama?
- Bagaimana split commit besar?
- Kapan rewrite history tidak etis atau berbahaya?

## Outcome

Anda bisa membentuk history yang reviewable, bukan hanya kode yang compile.

---

# Part 011 — Conflict Resolution: Dari Mekanik ke Strategi

**File:** `learn-git-mastery-for-java-engineers-part-011.md`

## Fokus

- Apa itu conflict.
- Conflict marker.
- Content conflict vs semantic conflict.
- Conflict pada import Java.
- Conflict pada method signature.
- Conflict pada config, migration, generated files.
- `ours` vs `theirs`.
- Merge conflict vs rebase conflict.
- Testing setelah resolusi.

## Pertanyaan yang Dijawab

- Mengapa conflict terjadi?
- Bagaimana menyelesaikan conflict tanpa merusak logic?
- Mengapa Git bisa sukses merge tetapi aplikasi tetap salah?
- Apa itu semantic conflict?

## Outcome

Anda bisa menyelesaikan konflik dengan memahami domain dan risiko, bukan hanya menghapus marker.

---

# Part 012 — Remote Repository: Clone, Fetch, Pull, Push

**File:** `learn-git-mastery-for-java-engineers-part-012.md`

## Fokus

- Remote sebagai repository lain.
- `origin`.
- Remote-tracking branch.
- `clone`.
- `fetch`.
- `pull = fetch + integrate`.
- Pull merge vs pull rebase.
- `push`.
- Upstream branch.
- Push rejection.
- `--force-with-lease`.

## Pertanyaan yang Dijawab

- Apa beda local branch dan `origin/main`?
- Mengapa `git fetch` aman?
- Mengapa `git pull` kadang membuat merge commit?
- Kapan force push boleh dilakukan?

## Outcome

Anda bisa menyinkronkan repository lokal dan remote tanpa mengacaukan kerja tim.

---

# Part 013 — Pull Request / Merge Request sebagai Engineering Control Point

**File:** `learn-git-mastery-for-java-engineers-part-013.md`

## Fokus

- PR sebagai boundary review.
- PR sebagai control point untuk CI, security, design, dan audit.
- Ukuran PR ideal.
- Draft PR.
- Stacked PR.
- Reviewable commit vs reviewable diff.
- Squash merge vs merge commit vs rebase merge.
- Checklist PR Java backend.
- Menanggapi review.

## Pertanyaan yang Dijawab

- Apa fungsi PR selain approval?
- Bagaimana membuat PR yang mudah direview?
- Kapan squash merge cocok?
- Mengapa approval bukan jaminan correctness?

## Outcome

Anda bisa menjadikan PR sebagai alat peningkatan kualitas, bukan sekadar formalitas.

---

# Part 014 — Git Workflow untuk Tim: Trunk-Based, Git Flow, GitHub Flow

**File:** `learn-git-mastery-for-java-engineers-part-014.md`

## Fokus

- Workflow mengikuti delivery model.
- Trunk-based development.
- Git Flow.
- GitHub Flow.
- Release branch.
- Feature branch.
- Environment branch anti-pattern.
- CI/CD implications.
- Workflow untuk monolith, microservices, dan regulated systems.

## Pertanyaan yang Dijawab

- Workflow mana yang cocok untuk tim saya?
- Mengapa long-lived branch berisiko?
- Apakah Git Flow masih relevan?
- Bagaimana menyeimbangkan speed, safety, dan auditability?

## Outcome

Anda bisa memilih workflow berdasarkan konteks sistem dan organisasi.

---

# Part 015 — Release, Tagging, Versioning, dan Hotfix

**File:** `learn-git-mastery-for-java-engineers-part-015.md`

## Fokus

- Lightweight tag vs annotated tag.
- Semantic versioning secara praktis.
- Tag sebagai release anchor.
- Release branch.
- Hotfix dari production tag.
- Backport.
- Cherry-pick patch.
- Release notes dari Git history.
- Maven/Gradle artifact versioning.

## Pertanyaan yang Dijawab

- Mengapa release perlu tag?
- Bagaimana hotfix production dilakukan dengan aman?
- Bagaimana menghubungkan Git commit dengan artifact Java?
- Kapan cherry-pick cocok untuk patch?

## Outcome

Anda bisa mengelola release dengan traceability dan risiko rendah.

---

# Part 016 — Cherry-Pick, Revert, Reset: Memilih Operasi Koreksi yang Tepat

**File:** `learn-git-mastery-for-java-engineers-part-016.md`

## Fokus

- `git cherry-pick`.
- `git revert`.
- `git reset`.
- Soft, mixed, hard reset.
- Undo commit vs undo change.
- Public vs private history.
- Revert merge commit.
- Cherry-pick conflict.
- Decision matrix operasi koreksi.

## Pertanyaan yang Dijawab

- Saya harus reset, revert, atau cherry-pick?
- Bagaimana menghapus efek commit yang sudah public?
- Apa risiko reset hard?
- Mengapa revert sering lebih aman di branch shared?

## Outcome

Anda bisa memperbaiki kesalahan tanpa memperparah keadaan.

---

# Part 017 — Recovery: Reflog, Lost Commit, dan Disaster Handling

**File:** `learn-git-mastery-for-java-engineers-part-017.md`

## Fokus

- Reflog sebagai safety net lokal.
- Recover setelah reset hard.
- Recover branch terhapus.
- Recover commit setelah rebase gagal.
- Dangling object.
- `git fsck`.
- Stash recovery.
- Kapan object benar-benar hilang.
- Prosedur recovery.

## Pertanyaan yang Dijawab

- Commit saya hilang, apakah benar-benar hilang?
- Bagaimana kembali setelah reset hard?
- Bagaimana menemukan branch yang terhapus?
- Kapan harus berhenti mengetik command dan observasi dulu?

## Outcome

Anda bisa menangani panic scenario dengan tenang dan sistematis.

---

# Part 018 — Stash, Worktree, dan Context Switching

**File:** `learn-git-mastery-for-java-engineers-part-018.md`

## Fokus

- `git stash`.
- Stash tracked dan untracked files.
- `stash pop` vs `stash apply`.
- Stash conflict.
- Naming stash.
- `git worktree`.
- Multiple working directories.
- Hotfix saat ada work-in-progress.
- Kapan stash menjadi smell.

## Pertanyaan yang Dijawab

- Bagaimana pindah konteks tanpa kehilangan pekerjaan?
- Kapan pakai stash?
- Kapan lebih baik pakai worktree?
- Bagaimana review branch lain tanpa mengganggu pekerjaan saat ini?

## Outcome

Anda bisa melakukan context switching dengan aman dan rapi.

---

# Part 019 — Bisect: Debugging Regresi dengan Git

**File:** `learn-git-mastery-for-java-engineers-part-019.md`

## Fokus

- Regresi sebagai problem historis.
- Binary search pada commit graph.
- `git bisect start/good/bad`.
- Automated bisect dengan Maven/Gradle test command.
- Memilih good dan bad commit.
- Handling flaky tests.
- Bisect pada monorepo.
- Membaca hasil bisect.

## Pertanyaan yang Dijawab

- Bagaimana menemukan commit penyebab bug?
- Bagaimana membuat bisect otomatis?
- Apa yang dilakukan saat test flaky?
- Bagaimana bisect membantu legacy code?

## Outcome

Anda bisa mengubah Git menjadi debugging engine untuk regresi.

---

# Part 020 — Blame, Pickaxe, dan Forensic Code Archaeology

**File:** `learn-git-mastery-for-java-engineers-part-020.md`

## Fokus

- `git blame` dengan konteks.
- Blame bukan alat menyalahkan.
- Ignore whitespace.
- Ignore revisions.
- `git log -S`.
- `git log -G`.
- Menelusuri perubahan simbol/method Java.
- Menghubungkan commit, issue, PR, dan incident.

## Pertanyaan yang Dijawab

- Kenapa kode ini ditulis seperti ini?
- Siapa terakhir mengubah baris ini dan dalam konteks apa?
- Kapan behavior tertentu diperkenalkan?
- Bagaimana membaca sejarah legacy code?

## Outcome

Anda bisa melakukan investigasi historis dengan matang dan tidak menyederhanakan blame menjadi personal accusation.

---

# Part 021 — Git untuk Java Projects: Maven, Gradle, IDE, dan Generated Files

**File:** `learn-git-mastery-for-java-engineers-part-021.md`

## Fokus

- `.gitignore` untuk Java.
- Maven `target/`.
- Gradle `build/`.
- Maven/Gradle wrapper.
- IntelliJ, Eclipse, VS Code files.
- Generated sources.
- Lombok, annotation processing, protobuf, OpenAPI.
- Binary artifacts.
- Dependency lockfiles.
- Repository hygiene.

## Pertanyaan yang Dijawab

- File Java apa yang harus masuk Git?
- File apa yang harus di-ignore?
- Apakah generated code boleh dicommit?
- Bagaimana menjaga build reproducible?

## Outcome

Anda bisa menjaga repository Java tetap bersih, reproducible, dan tidak penuh noise.

---

# Part 022 — Line Endings, Whitespace, Encoding, dan Cross-Platform Issues

**File:** `learn-git-mastery-for-java-engineers-part-022.md`

## Fokus

- LF vs CRLF.
- `core.autocrlf`.
- `.gitattributes`.
- Encoding file.
- Whitespace noise.
- File mode changes.
- Case sensitivity Windows/macOS/Linux.
- Shell script executable bit.
- Dampak ke Java, Docker, CI, dan build scripts.

## Pertanyaan yang Dijawab

- Mengapa satu file terlihat berubah seluruhnya?
- Bagaimana menghindari diff noise lintas OS?
- Mengapa script berjalan di Linux CI tapi tidak di Windows?
- Bagaimana membuat policy line ending repository?

## Outcome

Anda bisa mengurangi noise dan bug lintas platform.

---

# Part 023 — Git Hooks: Automasi Lokal dan Guardrails

**File:** `learn-git-mastery-for-java-engineers-part-023.md`

## Fokus

- Client-side hooks.
- Server-side hooks.
- `pre-commit`.
- `commit-msg`.
- `pre-push`.
- Formatting.
- Test guard.
- Conventional commits.
- Hook management tools.
- Hooks vs CI.
- Risiko hooks terlalu berat.

## Pertanyaan yang Dijawab

- Apa yang layak dipaksa sebelum commit?
- Apa yang sebaiknya hanya dipaksa di CI?
- Bagaimana menghindari hooks yang memperlambat developer?
- Bagaimana menjaga commit message consistency?

## Outcome

Anda bisa memakai hooks sebagai guardrail yang membantu, bukan penghambat.

---

# Part 024 — Submodules, Subtree, dan Multi-Repository Dependency

**File:** `learn-git-mastery-for-java-engineers-part-024.md`

## Fokus

- Problem dependency antar repository.
- Git submodule.
- Git subtree.
- Vendor code.
- Monorepo vs polyrepo preview.
- Maven/Gradle dependency sebagai alternatif.
- Update submodule.
- Failure mode submodule.

## Pertanyaan yang Dijawab

- Kapan submodule cocok?
- Mengapa submodule sering membuat tim bingung?
- Kapan subtree lebih sederhana?
- Kapan dependency sebaiknya menjadi artifact, bukan source inclusion?

## Outcome

Anda bisa memilih strategi dependency source code lintas repository secara sadar.

---

# Part 025 — Monorepo, Polyrepo, dan Repository Architecture

**File:** `learn-git-mastery-for-java-engineers-part-025.md`

## Fokus

- Monorepo vs polyrepo.
- Ownership.
- Build boundaries.
- Review boundaries.
- Release boundaries.
- Sparse checkout.
- Partial clone.
- Large repository performance.
- Java multi-module Maven/Gradle.
- Microservices dalam Git.
- Repository sebagai architecture boundary.

## Pertanyaan yang Dijawab

- Apakah microservices harus polyrepo?
- Kapan monorepo lebih baik?
- Bagaimana repository structure memengaruhi ownership?
- Apa risiko repository terlalu besar?

## Outcome

Anda bisa menilai repository architecture sebagai bagian dari system design.

---

# Part 026 — Large Files, Binary Assets, Git LFS, dan Repository Bloat

**File:** `learn-git-mastery-for-java-engineers-part-026.md`

## Fokus

- Kenapa Git buruk untuk binary besar.
- Repository bloat.
- Git LFS.
- Checked-in JAR.
- Test fixtures besar.
- Artifact repository.
- Nexus/Artifactory/GitHub Packages.
- Migration file besar.
- Policy binary untuk Java repository.

## Pertanyaan yang Dijawab

- Mengapa repository menjadi lambat?
- Apakah boleh commit JAR?
- Kapan Git LFS cocok?
- Kapan artifact repository lebih tepat?

## Outcome

Anda bisa mencegah repository menjadi lambat, mahal, dan sulit dikelola.

---

# Part 027 — Security: Secret Leakage, Signed Commits, dan Supply Chain

**File:** `learn-git-mastery-for-java-engineers-part-027.md`

## Fokus

- Secret leakage di Git.
- Kenapa delete file tidak cukup.
- Secret rotation.
- Secret scanning.
- `.gitignore` bukan security boundary.
- Signed commits.
- Signed tags.
- Trust chain.
- Git dalam supply chain security.
- Incident response.

## Pertanyaan yang Dijawab

- Apa yang dilakukan saat credential sudah tercommit?
- Mengapa history harus dianggap bocor?
- Kapan signed commit/tag penting?
- Bagaimana Git berhubungan dengan supply chain risk?

## Outcome

Anda bisa mencegah dan menangani kebocoran secret di repository.

---

# Part 028 — Rewrite History Lanjutan: Filter-Repo, BFG, dan Migration

**File:** `learn-git-mastery-for-java-engineers-part-028.md`

## Fokus

- Kapan rewrite history dibutuhkan.
- Risiko rewrite shared repository.
- `git filter-repo`.
- BFG Repo-Cleaner.
- Menghapus secret/file besar dari history.
- Migrasi repository.
- Split/merge repository.
- Preserving tags dan branches.
- Komunikasi rewrite ke tim.
- Recovery plan.

## Pertanyaan yang Dijawab

- Bagaimana membersihkan history repository?
- Mengapa rewrite history adalah operasi organisasi?
- Bagaimana menghindari tim kehilangan pekerjaan?
- Apa checklist sebelum force push hasil rewrite?

## Outcome

Anda bisa melakukan history surgery dengan disiplin dan mitigasi risiko.

---

# Part 029 — Advanced Ref Management: Refspec, Notes, Namespaces, dan Internals

**File:** `learn-git-mastery-for-java-engineers-part-029.md`

## Fokus

- References internal.
- `refs/heads`.
- `refs/remotes`.
- `refs/tags`.
- Refspec.
- Fetch/push mapping.
- Remote pruning.
- Git notes.
- Namespaces.
- Packed refs.
- Symbolic refs.
- Plumbing vs porcelain.

## Pertanyaan yang Dijawab

- Apa sebenarnya yang dipush dan difetch?
- Bagaimana refspec memetakan branch remote?
- Mengapa remote-tracking branch bisa stale?
- Apa beda command porcelain dan plumbing?

## Outcome

Anda bisa debug kasus ref/remote yang membingungkan dan memahami Git lebih dalam.

---

# Part 030 — Performance dan Maintenance Repository

**File:** `learn-git-mastery-for-java-engineers-part-030.md`

## Fokus

- Loose object.
- Packfile.
- Garbage collection.
- Commit graph file.
- Multi-pack index.
- Shallow clone.
- Partial clone.
- Sparse checkout.
- Repository maintenance.
- CI clone optimization.
- Diagnosa repository lambat.

## Pertanyaan yang Dijawab

- Mengapa Git repo lambat?
- Apa yang dilakukan `git gc`?
- Kapan shallow clone aman?
- Bagaimana mempercepat CI clone?

## Outcome

Anda bisa menjaga repository besar tetap sehat dan cepat.

---

# Part 031 — Git dalam CI/CD, Release Automation, dan Compliance

**File:** `learn-git-mastery-for-java-engineers-part-031.md`

## Fokus

- Git sebagai trigger pipeline.
- Branch protection.
- Required checks.
- Commit status.
- Release automation.
- Changelog generation.
- Traceability commit → build → artifact → deployment.
- Audit trail.
- Regulated environment.
- Separation of duties.
- Rollback dan roll-forward.
- Evidence untuk compliance.

## Pertanyaan yang Dijawab

- Bagaimana Git menjadi bagian dari delivery governance?
- Apa yang harus diproteksi di branch utama?
- Bagaimana membuktikan commit tertentu masuk release?
- Bagaimana Git membantu audit dan compliance?

## Outcome

Anda bisa menghubungkan Git workflow dengan delivery control dan regulatory defensibility.

---

# Part 032 — Capstone: Mendesain Git Workflow untuk Java Engineering Team

**File:** `learn-git-mastery-for-java-engineers-part-032.md`

## Fokus

- Studi kasus end-to-end.
- Tim Java backend/microservices.
- Mainline strategy.
- Feature development.
- PR policy.
- Commit policy.
- Release policy.
- Hotfix policy.
- Branch protection.
- CI/CD integration.
- Secret prevention.
- Incident recovery.
- Repository hygiene.
- Decision record untuk workflow Git.
- Failure scenario simulation.

## Pertanyaan yang Dijawab

- Bagaimana mendesain Git workflow yang benar-benar bisa dipakai tim?
- Apa policy minimum untuk production-grade repository?
- Bagaimana workflow berubah untuk regulated systems?
- Bagaimana menggabungkan seluruh konsep seri menjadi operating model?

## Outcome

Anda bisa mendesain, menjelaskan, dan mempertahankan Git workflow secara arsitektural.

---

## 7. Dependency Map antar Part

Urutan belajar sengaja dibuat bertingkat.

```text
Foundation
000 → 001 → 002 → 003 → 004

Daily Operation
005 → 006 → 007 → 008 → 009 → 010 → 011 → 012 → 013

Team Workflow & Release
014 → 015 → 016 → 017 → 018

Debugging & Forensics
019 → 020

Java Repository Hygiene
021 → 022 → 023 → 024 → 025 → 026

Security & Advanced Operations
027 → 028 → 029 → 030

Engineering Governance
031 → 032
```

Secara visual:

```text
                    ┌────────────────────┐
                    │ 000 Orientation     │
                    └─────────┬──────────┘
                              ▼
        ┌──────────────────────────────────────┐
        │ Foundation: 001 - 004                │
        │ model, repo, graph, commit quality   │
        └──────────────────┬───────────────────┘
                           ▼
        ┌──────────────────────────────────────┐
        │ Daily Operation: 005 - 013           │
        │ log, diff, branch, merge, rebase, PR │
        └──────────────────┬───────────────────┘
                           ▼
        ┌──────────────────────────────────────┐
        │ Workflow & Release: 014 - 018        │
        │ workflow, tag, hotfix, recovery      │
        └──────────────────┬───────────────────┘
                           ▼
        ┌──────────────────────────────────────┐
        │ Debugging & Forensics: 019 - 020     │
        │ bisect, blame, archaeology           │
        └──────────────────┬───────────────────┘
                           ▼
        ┌──────────────────────────────────────┐
        │ Java Repo Hygiene: 021 - 026         │
        │ Maven, Gradle, generated, LFS        │
        └──────────────────┬───────────────────┘
                           ▼
        ┌──────────────────────────────────────┐
        │ Advanced Ops: 027 - 030              │
        │ security, rewrite, refs, performance │
        └──────────────────┬───────────────────┘
                           ▼
        ┌──────────────────────────────────────┐
        │ Governance & Capstone: 031 - 032     │
        │ CI/CD, compliance, operating model   │
        └──────────────────────────────────────┘
```

---

## 8. Cara Belajar Setiap Part

Gunakan siklus berikut:

```text
1. Baca mental model.
2. Prediksi state Git sebelum command.
3. Jalankan command.
4. Observasi dengan git status/log/diff/show.
5. Jelaskan apa yang berubah.
6. Simulasikan failure case.
7. Latih recovery.
8. Catat invariant dan decision rule.
```

### 8.1 Jangan Hanya Menyalin Command

Kalau sebuah materi memberi command seperti:

```bash
git rebase main
```

Jangan langsung menghafal “untuk update branch, pakai rebase”.

Tanyakan:

- Branch saat ini apa?
- `main` menunjuk ke commit mana?
- Commit mana yang unik di branch saya?
- Apakah commit saya private?
- Apakah rebase akan membuat commit baru?
- Apakah perlu force push setelahnya?
- Apakah force push aman?

### 8.2 Selalu Verifikasi State

Minimal observability loop:

```bash
git status
git log --oneline --graph --decorate --all -n 20
git diff
git diff --staged
```

Untuk remote:

```bash
git branch -vv
git remote -v
git log --oneline --graph --decorate --all -n 30
```

Untuk recovery:

```bash
git reflog
```

### 8.3 Latih dengan Repository Mainan

Buat repo latihan khusus:

```bash
mkdir git-lab
cd git-lab
git init
```

Jangan latihan rebase/reset/filter history pertama kali di repository kerja nyata.

Repository latihan harus dipakai untuk:

- membuat branch dan merge conflict,
- mencoba reset soft/mixed/hard,
- menghapus branch lalu recover,
- rebase dan abort,
- cherry-pick conflict,
- bisect dengan test kecil,
- membuat tag release palsu,
- mensimulasikan hotfix.

---

## 9. Rubrik Kemampuan

Gunakan rubrik ini untuk mengukur progres.

### Level 0 — Survival User

Ciri:

- Bisa `clone`, `pull`, `commit`, `push`.
- Sering takut conflict.
- Tidak paham index.
- Menganggap branch sebagai folder copy.
- Panik saat error Git.

Risiko:

- Mengikuti command dari internet tanpa memahami dampak.
- Bisa kehilangan pekerjaan karena reset/checkout sembarangan.

### Level 1 — Daily Contributor

Ciri:

- Bisa membuat branch feature.
- Bisa commit dan push normal.
- Bisa membuat PR.
- Bisa menyelesaikan conflict sederhana.
- Mulai paham `fetch` vs `pull`.

Risiko:

- Commit masih terlalu besar.
- History kurang rapi.
- Masih bingung rebase/reset/revert.

### Level 2 — Reliable Team Engineer

Ciri:

- Paham working tree/index/HEAD.
- Bisa membuat atomic commit.
- Bisa membaca graph.
- Bisa memilih merge vs rebase.
- Bisa recovery dari kesalahan umum.
- Bisa membuat PR reviewable.

Risiko:

- Belum kuat untuk kasus release/hotfix/forensic.

### Level 3 — Senior Operational Git User

Ciri:

- Bisa cherry-pick, revert, reset dengan decision rule.
- Bisa hotfix dari tag.
- Bisa bisect regresi.
- Bisa forensic dengan blame/pickaxe.
- Bisa mengelola conflict sulit.
- Bisa mendeteksi semantic conflict.

Risiko:

- Belum tentu bisa mendesain workflow tim dan governance.

### Level 4 — Repository Steward

Ciri:

- Bisa menyusun branch strategy.
- Bisa menetapkan commit/PR policy.
- Bisa mengatur generated file dan binary policy.
- Bisa menangani secret leakage.
- Bisa memahami monorepo/polyrepo trade-off.
- Bisa memperbaiki repository bloat.

Risiko:

- Operasi history rewrite besar tetap perlu prosedur dan koordinasi.

### Level 5 — Git Workflow Architect

Ciri:

- Bisa mendesain workflow end-to-end untuk tim.
- Bisa menghubungkan Git dengan CI/CD, release, audit, dan compliance.
- Bisa membuat failure model dan recovery procedure.
- Bisa menjelaskan trade-off ke engineer, lead, security, auditor, dan management.
- Bisa mempertahankan workflow bukan karena preferensi, tetapi karena alasan delivery, risk, dan governance.

Target seri ini adalah membawa Anda mendekati Level 5.

---

## 10. Core Invariants yang Akan Diulang Sepanjang Seri

Invariants adalah aturan mental yang tetap benar di banyak situasi.

### Invariant 1 — Commit Itu Immutable

Commit yang sudah dibuat tidak diedit secara langsung.

Operasi seperti rebase, amend, squash, dan filter history biasanya membuat commit baru dengan hash baru.

### Invariant 2 — Branch Itu Pointer

Branch bukan folder. Branch adalah ref yang menunjuk ke commit.

Saat commit baru dibuat di atas branch, pointer branch maju.

### Invariant 3 — HEAD Menentukan Posisi Saat Ini

HEAD menunjukkan “di mana Anda berada”.

Biasanya HEAD menunjuk ke branch. Dalam detached HEAD, HEAD menunjuk langsung ke commit.

### Invariant 4 — Index Adalah Candidate Snapshot

Commit tidak otomatis mengambil semua isi working tree.

Commit mengambil snapshot dari index.

### Invariant 5 — Remote Bukan Source of Truth Mistis

Remote adalah repository lain.

`origin/main` adalah local remote-tracking ref yang terakhir Anda fetch dari remote, bukan real-time view ajaib.

### Invariant 6 — Public History Harus Diperlakukan Berbeda dari Private History

History private bisa dirapikan dengan rebase/reset/amend.

History public harus dijaga karena orang lain mungkin sudah membangun pekerjaan di atasnya.

### Invariant 7 — Undo Ada Banyak Jenis

Tidak semua “undo” sama.

| Keinginan | Operasi yang Mungkin |
|---|---|
| Buang perubahan working tree | `git restore` |
| Keluarkan file dari staging | `git restore --staged` atau `git reset` |
| Ubah commit terakhir private | `git commit --amend` |
| Mundurkan branch private | `git reset` |
| Batalkan efek commit public | `git revert` |
| Ambil commit tertentu ke branch lain | `git cherry-pick` |

### Invariant 8 — Conflict yang Hilang Belum Tentu Berarti Logic Benar

Git hanya bisa mendeteksi konflik tekstual dan struktur merge tertentu.

Semantic conflict tetap tanggung jawab engineer.

### Invariant 9 — Reflog Adalah Safety Net Lokal, Bukan Backup Permanen

Reflog sangat berguna, tetapi lokal dan bisa expire.

Jangan memperlakukan reflog sebagai strategi backup.

### Invariant 10 — Repository Policy Adalah Bagian dari Architecture

Struktur branch, PR rules, tag policy, generated files, dan secret scanning bukan kosmetik.

Semua itu memengaruhi delivery speed, production risk, auditability, dan developer experience.

---

## 11. Git untuk Java Engineer: Fokus Khusus

Karena targetnya Java software engineer, seri ini akan menekankan kasus-kasus berikut.

### 11.1 Maven/Gradle Build Output

File output seperti:

```text
target/
build/
out/
```

umumnya bukan source of truth dan seharusnya tidak masuk Git.

Namun wrapper seperti:

```text
mvnw
mvnw.cmd
.gradle/wrapper/gradle-wrapper.properties
gradlew
gradlew.bat
gradle/wrapper/gradle-wrapper.jar
```

sering justru perlu masuk Git agar build reproducible.

### 11.2 Generated Code

Generated code adalah area abu-abu.

Contoh:

- OpenAPI generated client/server stubs.
- Protobuf generated Java classes.
- Annotation processing output.
- QueryDSL generated classes.
- JOOQ generated classes.

Decision rule yang akan dipakai:

```text
Commit source of truth.
Jangan commit derivasi yang bisa dibuat deterministik, kecuali ada alasan distribusi, tooling, atau build isolation yang kuat.
```

### 11.3 Dependency and Artifact Boundary

Java punya ekosistem artifact repository seperti Maven repository, Nexus, Artifactory, dan GitHub Packages.

Karena itu, banyak hal yang tidak seharusnya dimasukkan ke Git:

- compiled JAR internal,
- dependency binary,
- build output,
- local cache,
- generated reports,
- temporary files.

Git menyimpan source dan history. Artifact repository menyimpan hasil build yang versioned.

### 11.4 Multi-Module dan Microservices

Git workflow berubah tergantung struktur:

| Struktur | Risiko Git Utama |
|---|---|
| Single Java app | Conflict kecil, release sederhana |
| Multi-module monolith | Large diff, dependency antar module |
| Microservices polyrepo | Cross-repo coordination, version skew |
| Microservices monorepo | Repo scale, ownership, CI selectivity |
| Regulated case management platform | Auditability, traceability, branch protection, evidence |

Seri ini akan berkali-kali kembali ke trade-off ini.

---

## 12. Anti-Pattern yang Akan Kita Hindari

### 12.1 “Git as Ritual”

Contoh:

```bash
git pull
git add .
git commit -m "update"
git push
```

Tanpa melihat status, diff, branch, atau dampak.

Masalah:

- commit tidak bermakna,
- accidental file masuk,
- conflict telat diketahui,
- history sulit diaudit.

### 12.2 “One Branch Forever”

Branch feature hidup terlalu lama dan jarang sync.

Masalah:

- conflict makin besar,
- feedback CI terlambat,
- review berat,
- integrasi berisiko.

### 12.3 “Fix Everything in One Commit”

Satu commit berisi:

- refactor,
- bugfix,
- formatting,
- dependency update,
- config change,
- test rewrite.

Masalah:

- review sulit,
- revert sulit,
- bisect kurang berguna,
- intent kabur.

### 12.4 “Force Push Without Lease”

Force push ke branch shared tanpa memastikan tidak menimpa pekerjaan orang lain.

Masalah:

- kehilangan commit tim,
- PR rusak,
- trust turun.

### 12.5 “Resolve Conflict by Making Git Quiet”

Hanya memilih ours/theirs tanpa memahami perubahan domain.

Masalah:

- semantic regression,
- test gagal belakangan,
- bug production.

### 12.6 “Commit Secret then Delete It”

Mengira secret aman setelah file dihapus di commit berikutnya.

Masalah:

- secret tetap ada di history,
- credential harus dianggap bocor,
- perlu rotation dan history cleanup.

### 12.7 “Environment Branch as Deployment Model”

Branch seperti:

```text
dev
qa
staging
production
```

sering dipakai sebagai environment state.

Masalah:

- branch menjadi konfigurasi environment,
- merge antar environment kacau,
- audit release sulit,
- commit order bisa menyimpang dari artifact deployment.

Tidak selalu salah dalam semua organisasi, tetapi sering menjadi smell yang harus dievaluasi keras.

---

## 13. Decision Framework Umum

Saat menghadapi masalah Git, gunakan framework berikut.

### 13.1 State Diagnosis

```text
1. Saya sedang di branch apa?
2. HEAD menunjuk ke mana?
3. Working tree bersih atau kotor?
4. Ada staged changes?
5. Branch saya ahead/behind remote berapa commit?
6. Perubahan ini private atau public?
7. Ada orang lain yang mungkin bergantung pada branch ini?
```

Command:

```bash
git status
git branch -vv
git log --oneline --graph --decorate --all -n 30
git diff
git diff --staged
```

### 13.2 Operation Selection

| Masalah | Pertanyaan Kunci | Operasi Umum |
|---|---|---|
| Perubahan belum commit ingin dibuang | Perubahan ada di working tree atau staged? | `restore`, `restore --staged` |
| Commit terakhir private ingin diperbaiki | Sudah dipush? | `commit --amend` |
| Branch private ingin dirapikan | Ada orang lain pakai? | `rebase -i` |
| Commit public salah | Perlu audit trail? | `revert` |
| Commit tertentu perlu dipindah | Patch isolated? | `cherry-pick` |
| Branch ketinggalan main | History policy apa? | merge atau rebase |
| Secret tercommit | Credential valid? | rotate + cleanup + notify |
| Bug muncul entah kapan | Ada good/bad commit? | `bisect` |

### 13.3 Safety Checklist Sebelum Operasi Berisiko

Sebelum menjalankan reset hard, rebase besar, force push, filter history, atau cleanup:

```text
[ ] git status bersih atau saya tahu perubahan yang belum commit
[ ] saya tahu branch saat ini
[ ] saya tahu commit target
[ ] saya tahu apakah history sudah public
[ ] saya punya backup branch sementara jika perlu
[ ] saya tahu cara abort/recover
[ ] saya sudah komunikasi jika berdampak ke tim
```

Backup branch cepat:

```bash
git branch backup/before-risky-operation
```

---

## 14. Format Setiap Part Berikutnya

Setiap part akan mengikuti struktur umum berikut:

```text
1. Tujuan part
2. Problem yang ingin diselesaikan
3. Mental model utama
4. Konsep inti
5. Command penting
6. State transition command
7. Contoh Java/project scenario
8. Failure mode
9. Anti-pattern
10. Decision rule
11. Latihan lab
12. Checklist
13. Ringkasan
14. Koneksi ke part berikutnya
```

Tidak semua part akan memiliki panjang yang sama. Part seperti rebase, conflict, release, recovery, security, dan capstone kemungkinan lebih panjang karena risiko dan reasoning-nya lebih besar.

---

## 15. Lab Setup yang Direkomendasikan

Untuk mengikuti seri ini, siapkan minimal:

- Git versi modern.
- Terminal.
- Java JDK.
- Maven atau Gradle.
- Editor/IDE seperti IntelliJ IDEA atau VS Code.
- Repository latihan lokal.

Cek versi Git:

```bash
git --version
```

Konfigurasi identitas:

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

Konfigurasi editor:

```bash
git config --global core.editor "code --wait"
```

Untuk IntelliJ atau editor lain, sesuaikan.

Alias observability yang berguna:

```bash
git config --global alias.lg "log --oneline --graph --decorate --all"
git config --global alias.st "status --short --branch"
git config --global alias.last "log -1 --stat"
```

Catatan: alias bukan pengganti pemahaman. Alias hanya mempercepat observability.

---

## 16. Mini Lab Part 000: Membuat Repository Latihan

Bagian ini belum mengajarkan internals secara penuh, tetapi Anda bisa menyiapkan lab.

```bash
mkdir git-mastery-lab
cd git-mastery-lab
git init
```

Buat file Java sederhana:

```bash
mkdir -p src/main/java/com/example
cat > src/main/java/com/example/App.java <<'JAVA'
package com.example;

public class App {
    public static void main(String[] args) {
        System.out.println("Git Mastery Lab");
    }
}
JAVA
```

Lihat status:

```bash
git status
```

Stage dan commit:

```bash
git add src/main/java/com/example/App.java
git commit -m "Initialize Java app skeleton"
```

Lihat graph:

```bash
git log --oneline --graph --decorate --all
```

Yang harus Anda amati:

```text
1. Sebelum git add, file berada di working tree sebagai untracked.
2. Setelah git add, file masuk index/staging area.
3. Setelah git commit, Git membuat commit baru.
4. Branch default menunjuk ke commit tersebut.
5. Working tree menjadi clean.
```

Jangan khawatir jika belum memahami detailnya. Itu akan dibedah di Part 001-004.

---

## 17. Peta Command yang Akan Dipelajari

Command bukan pusat seri, tetapi tetap penting.

### 17.1 Foundation Commands

```bash
git init
git status
git add
git commit
git log
git show
git diff
git restore
git reset
```

### 17.2 Branching and Integration

```bash
git branch
git switch
git checkout
git merge
git rebase
git rebase -i
git cherry-pick
git revert
```

### 17.3 Remote Collaboration

```bash
git clone
git remote
git fetch
git pull
git push
git branch -vv
```

### 17.4 Recovery and Debugging

```bash
git reflog
git fsck
git stash
git worktree
git bisect
git blame
git log -S
git log -G
```

### 17.5 Release and Repository Management

```bash
git tag
git describe
git archive
git gc
git maintenance
git sparse-checkout
git lfs
```

### 17.6 Advanced/Internal

```bash
git cat-file
git hash-object
git ls-tree
git rev-parse
git update-ref
git for-each-ref
git notes
git filter-repo
```

Tidak semua command advanced harus dipakai sehari-hari. Namun memahaminya membantu saat Git berperilaku “aneh”.

---

## 18. Git Concepts Glossary Awal

Definisi ringkas. Detail akan datang di part masing-masing.

| Istilah | Definisi Awal |
|---|---|
| Repository | Database Git berisi objects, refs, config, dan metadata |
| Working tree | File nyata yang Anda edit |
| Index/staging area | Snapshot candidate untuk commit berikutnya |
| Blob | Object yang menyimpan isi file |
| Tree | Object yang menyimpan struktur direktori dan pointer ke blob/tree |
| Commit | Object yang menunjuk ke tree, parent commit, author, committer, message |
| Tag | Ref/object untuk menandai commit tertentu, sering untuk release |
| Branch | Ref mutable yang menunjuk ke commit |
| HEAD | Pointer ke posisi saat ini |
| Remote | Repository lain yang bisa difetch/push |
| Remote-tracking branch | Ref lokal yang merekam state terakhir remote saat fetch |
| Merge | Integrasi dua line of development |
| Rebase | Replay commit ke base baru |
| Conflict | Situasi ketika Git tidak bisa menggabungkan perubahan secara otomatis |
| Reflog | Riwayat lokal pergerakan HEAD/ref |
| Reachable | Object bisa dicapai dari ref tertentu |
| Dangling object | Object tidak lagi reachable dari ref normal |
| Packfile | Format penyimpanan object yang dikompresi untuk efisiensi |
| Plumbing command | Command low-level Git |
| Porcelain command | Command high-level untuk user sehari-hari |

---

## 19. Mental Model Singkat: Snapshot, Bukan Patch Log Sederhana

Git sering dijelaskan sebagai “menyimpan perubahan”. Lebih akurat untuk mental model awal:

```text
Setiap commit menunjuk ke snapshot project.
Diff adalah hasil membandingkan dua snapshot.
```

Ini penting.

Kalau Git hanya dipahami sebagai daftar patch, branch/merge/rebase akan terasa membingungkan.

Dengan snapshot model:

```text
Commit A = snapshot project pada waktu A
Commit B = snapshot project pada waktu B
Diff A..B = perbedaan yang dihitung dari dua snapshot
```

Merge juga lebih masuk akal:

```text
Merge mencari common ancestor,
membandingkan dua line perubahan dari ancestor,
lalu menghasilkan snapshot gabungan.
```

Rebase juga lebih masuk akal:

```text
Rebase mengambil perubahan relatif dari commit lama,
lalu membuat commit baru di atas base baru.
```

---

## 20. Mental Model Singkat: Immutable Nodes, Mutable Pointers

Ini salah satu model paling penting.

```text
Commit = immutable node
Branch = mutable pointer
HEAD = current pointer
```

Contoh:

```text
A --- B --- C  main
```

`main` menunjuk ke `C`.

Jika Anda commit lagi:

```text
A --- B --- C --- D  main
```

Commit `D` dibuat. Pointer `main` maju ke `D`.

Branch bukan folder baru. Branch hanyalah pointer lain:

```text
A --- B --- C  main
          \
           X  feature/login
```

Kalau Anda paham ini, Git menjadi jauh lebih sederhana.

---

## 21. Mental Model Singkat: Public vs Private History

Salah satu decision rule paling penting:

```text
Private history boleh dibentuk ulang.
Public history harus diperlakukan sebagai kontrak kolaborasi.
```

Private:

- commit lokal belum dipush,
- branch pribadi yang tidak dipakai orang lain,
- draft commit sebelum PR.

Public:

- sudah dipush ke branch shared,
- sudah direview orang,
- sudah masuk `main`,
- sudah dirilis,
- sudah menjadi base pekerjaan orang lain.

Operasi seperti:

- amend,
- reset,
- rebase,
- squash,
- filter history,

lebih aman pada private history.

Untuk public history, biasanya gunakan:

- revert,
- merge commit,
- follow-up commit,
- hotfix branch,
- tag/release correction.

---

## 22. Learning Contract

Agar seri ini efisien dan tidak mengulang materi, aturan belajarnya:

1. Part 000 hanya orientasi dan peta.
2. Setiap part berikutnya tidak akan mengulang seluruh penjelasan part sebelumnya.
3. Konsep penting boleh dirujuk ulang, tetapi bukan dijelaskan ulang dari nol kecuali diperlukan.
4. Jika ada konsep yang muncul lagi, fokusnya akan pada konteks baru.
5. Materi akan bergerak dari basic → operational → advanced → governance.
6. Topik Java akan muncul ketika relevan, bukan dipaksakan di setiap bab.
7. Command akan selalu dikaitkan dengan mental model.
8. Failure mode akan selalu dianggap penting, bukan catatan pinggir.

---

## 23. Checklist Kesiapan Sebelum Masuk Part 001

Sebelum lanjut, pastikan Anda bisa menjawab secara kasar:

```text
[ ] Saya tahu bahwa Git bukan sekadar backup file.
[ ] Saya tahu bahwa repository lokal punya database sendiri.
[ ] Saya tahu bahwa branch bukan copy folder.
[ ] Saya tahu bahwa commit membentuk graph.
[ ] Saya tahu bahwa index/staging area berbeda dari working tree.
[ ] Saya tahu bahwa remote adalah repository lain.
[ ] Saya siap belajar Git dari state model, bukan command template.
```

Tidak perlu bisa menjelaskan detailnya sekarang. Detail dimulai di Part 001.

---

## 24. Referensi Utama untuk Seri

Seri ini menggunakan pemahaman dari dokumentasi resmi dan praktik engineering umum. Referensi utama yang relevan:

1. Git official documentation menyebut Git sebagai distributed revision control system yang cepat dan scalable, dengan command high-level dan akses ke internals.
2. Pro Git book menyediakan fondasi resmi/praktis tentang Git basics, branching, remotes, rebasing, internals, objects, references, dan packfiles.
3. Git glossary mendefinisikan istilah seperti working tree, index, object database, ref, HEAD, dan konsep internal lain.
4. Dokumentasi Git worktree menjelaskan kemampuan satu repository untuk memiliki beberapa working tree.
5. Dokumentasi Git internals menjelaskan object model Git: blob, tree, commit, tag, references, dan packfiles.

Daftar referensi ini akan dibuat lebih spesifik pada part-part yang membahas topik teknis terkait.

---

## 25. Ringkasan Part 000

Part ini menetapkan peta dan standar belajar.

Inti yang harus dibawa:

```text
Git bukan sekadar command.
Git adalah model evolusi software.
Commit adalah immutable node.
Branch adalah mutable pointer.
HEAD adalah posisi saat ini.
Index adalah candidate snapshot.
Remote adalah repository lain.
Safety berasal dari observability dan reversibility.
Workflow Git adalah bagian dari engineering architecture.
```

Seri belum selesai. Ini baru bagian pembuka.

Bagian berikutnya:

```text
learn-git-mastery-for-java-engineers-part-001.md
```

Topik:

```text
Git sebagai Model Evolusi Software
```

Di Part 001, kita mulai dari pertanyaan paling fundamental:

```text
Masalah engineering apa yang sebenarnya diselesaikan oleh Git?
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Notebook](../../README.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Part 001 — Git sebagai Model Evolusi Software](./learn-git-mastery-for-java-engineers-part-001.md)

# learn-git-mastery-for-java-engineers-part-007.md

# Part 007 — Branching: Isolasi Perubahan dan Eksperimen Aman

> Seri: **Git Mastery for Java Engineers**  
> Bagian: **007 / 032**  
> Status seri: **belum selesai**  
> Bagian terakhir: `learn-git-mastery-for-java-engineers-part-032.md`

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya, kita sudah membangun mental model `diff` sebagai pembanding **state/snapshot**, bukan sekadar daftar baris merah dan hijau. Sekarang kita masuk ke salah satu primitive Git yang paling sering dipakai tetapi paling sering disalahpahami: **branch**.

Banyak engineer memakai branch setiap hari:

```bash
git checkout -b feature/payment-validation
git switch main
git pull
git merge feature/payment-validation
git branch -d feature/payment-validation
```

Tetapi belum tentu bisa menjawab dengan jelas:

- Apa sebenarnya branch di Git?
- Apakah branch berisi commit?
- Kenapa membuat branch sangat murah?
- Apa bedanya branch lokal, remote branch, dan remote-tracking branch?
- Apa yang terjadi saat `HEAD` berpindah?
- Kenapa `detached HEAD` bukan selalu error?
- Kenapa branch panjang meningkatkan risiko integrasi?
- Kapan branch harus dibuat, dipush, direbase, dimerge, atau dihapus?
- Apa desain branch yang sehat untuk Java backend team?

Target bagian ini: kamu bisa memakai branch sebagai **alat isolasi perubahan**, **alat koordinasi tim**, dan **alat eksperimen aman**, bukan hanya sebagai folder alternatif untuk menaruh kode.

---

## 1. Premis Utama: Branch Bukan Copy Folder

Kesalahan mental model paling umum:

```text
Branch = salinan project.
```

Ini salah.

Mental model yang lebih benar:

```text
Branch = nama yang menunjuk ke satu commit.
```

Atau lebih presisi:

```text
Branch adalah reference mutable di refs/heads/* yang menunjuk ke commit tertentu.
```

Misalnya:

```text
refs/heads/main    -> a1b2c3d
refs/heads/feature -> f9e8d7c
```

Branch tidak “menyimpan file”. File disimpan di snapshot commit. Branch hanya menunjuk ke commit terakhir pada jalur history tertentu.

Karena branch hanya pointer kecil, membuat branch sangat murah. Git tidak menyalin seluruh folder project ketika kamu membuat branch. Git hanya membuat reference baru.

Contoh:

```bash
git branch feature/report-export
```

Secara konseptual:

```text
Sebelum:

A---B---C  main
          ^
          HEAD

Sesudah:

A---B---C  main
         \
          feature/report-export

HEAD masih di main jika hanya memakai git branch.
```

Jika kamu memakai:

```bash
git switch -c feature/report-export
```

Maka Git membuat branch baru dan memindahkan `HEAD` ke branch itu:

```text
A---B---C  main
          \
           feature/report-export
           ^
           HEAD
```

Saat kamu commit di branch itu:

```text
A---B---C  main
         \
          D---E  feature/report-export
               ^
               HEAD
```

Yang bergerak adalah pointer branch `feature/report-export`, bukan `main`.

---

## 2. Kenapa Branch Penting untuk Engineer Java

Dalam project Java nyata, perubahan jarang hanya satu file. Satu fitur bisa menyentuh:

- controller,
- service,
- repository,
- domain model,
- DTO,
- mapper,
- migration,
- validation,
- exception handling,
- tests,
- OpenAPI contract,
- CI configuration,
- dependency Maven/Gradle,
- feature flag,
- documentation.

Tanpa branch, semua perubahan itu bercampur langsung dengan mainline. Ini berbahaya karena:

- perubahan belum selesai bisa memblokir build utama,
- eksperimen bisa bocor ke release,
- hotfix production sulit dilakukan,
- review sulit karena perubahan bercampur,
- rollback tidak jelas,
- investigasi history menjadi noisy.

Branch menyediakan isolasi:

```text
main              = jalur stabil/integrasi
feature branch    = ruang kerja terisolasi
release branch    = ruang stabilisasi release
hotfix branch     = ruang koreksi production urgent
spike branch      = ruang eksperimen yang boleh dibuang
```

Untuk Java software engineer, branch bukan cuma fitur Git. Branch adalah cara mengatur **risiko perubahan**.

---

## 3. Branch sebagai Pointer Mutable

Branch berubah ketika commit baru dibuat saat `HEAD` berada di branch tersebut.

Misalkan:

```text
A---B---C  main
          ^
          HEAD
```

Kamu membuat branch dan pindah ke sana:

```bash
git switch -c feature/audit-log
```

```text
A---B---C  main, feature/audit-log
          ^
          HEAD -> feature/audit-log
```

Lalu commit:

```bash
git commit -m "Add audit log entity"
```

Hasil:

```text
A---B---C  main
         \
          D  feature/audit-log
          ^
          HEAD -> feature/audit-log
```

Commit `D` punya parent `C`. Branch `feature/audit-log` bergerak dari `C` ke `D`. Branch `main` tetap di `C`.

Lalu commit lagi:

```text
A---B---C  main
         \
          D---E  feature/audit-log
              ^
              HEAD -> feature/audit-log
```

Branch adalah pointer yang bergerak maju saat commit dibuat.

### 3.1 Yang Tidak Terjadi

Git tidak membuat:

```text
copy of all files for main
copy of all files for feature
```

Git menyimpan object commit/tree/blob. Branch hanya reference.

Itulah kenapa:

```bash
git branch test-1
git branch test-2
git branch test-3
```

sangat cepat walaupun repository besar.

---

## 4. HEAD: Posisi Aktif Git

`HEAD` menjawab pertanyaan:

```text
Saat ini aku berada di mana?
```

Dalam kondisi normal, `HEAD` menunjuk ke branch:

```text
HEAD -> refs/heads/feature/audit-log -> E
```

Artinya:

- branch aktif adalah `feature/audit-log`,
- commit aktif adalah `E`,
- commit berikutnya akan membuat branch `feature/audit-log` maju.

Kamu bisa melihatnya:

```bash
cat .git/HEAD
```

Biasanya akan terlihat seperti:

```text
ref: refs/heads/feature/audit-log
```

Jika `HEAD` menunjuk langsung ke commit, bukan branch, itu disebut detached HEAD.

---

## 5. Detached HEAD: Bukan Selalu Bahaya

Detached HEAD terjadi ketika `HEAD` menunjuk langsung ke commit tertentu:

```text
HEAD -> C
```

bukan:

```text
HEAD -> refs/heads/main -> C
```

Contoh command yang bisa membuat detached HEAD:

```bash
git switch --detach a1b2c3d
```

atau:

```bash
git checkout a1b2c3d
```

atau saat checkout tag:

```bash
git switch --detach v1.4.2
```

### 5.1 Kapan Detached HEAD Berguna

Detached HEAD berguna untuk:

- melihat kondisi repository di commit lama,
- menjalankan test terhadap versi lama,
- mengecek tag release,
- debugging regresi,
- eksperimen singkat,
- proses `git bisect`.

Contoh:

```bash
git switch --detach v2.1.0
mvn test
```

Kamu sedang memeriksa source code persis di release `v2.1.0`.

### 5.2 Risiko Detached HEAD

Jika kamu commit dalam detached HEAD:

```text
A---B---C  main
     \
      D  HEAD detached
```

Commit `D` tidak punya branch yang menunjuk ke sana. Ia masih ada, tetapi mudah “tertinggal” ketika kamu pindah lagi.

Jika kamu ingin menyelamatkan commit itu:

```bash
git switch -c rescue/my-detached-work
```

Atau:

```bash
git branch rescue/my-detached-work
```

Mental model:

```text
Detached HEAD aman untuk membaca dan eksperimen.
Detached HEAD berisiko jika kamu membuat commit lalu lupa memberi nama/branch.
```

---

## 6. Local Branch, Remote Branch, dan Remote-Tracking Branch

Istilah ini sering membingungkan.

### 6.1 Local Branch

Local branch adalah branch di repository lokal kamu:

```text
refs/heads/main
refs/heads/feature/audit-log
```

Dilihat dengan:

```bash
git branch
```

Contoh output:

```text
* feature/audit-log
  main
```

### 6.2 Remote Repository

Remote adalah repository lain. Biasanya di GitHub, GitLab, Bitbucket, atau server internal.

Remote default sering bernama `origin`:

```bash
git remote -v
```

Contoh:

```text
origin  git@github.com:company/payment-service.git (fetch)
origin  git@github.com:company/payment-service.git (push)
```

`origin` bukan nama sakral. Itu hanya nama alias.

### 6.3 Remote Branch

Remote branch sebenarnya branch yang berada di repository remote.

Misalnya di server:

```text
refs/heads/main
refs/heads/release/2026.06
refs/heads/feature/audit-log
```

Kamu tidak langsung mengedit remote branch. Kamu mengirim update lewat `git push`.

### 6.4 Remote-Tracking Branch

Remote-tracking branch adalah local reference yang mencatat state terakhir remote branch yang kamu fetch.

Contoh:

```text
refs/remotes/origin/main
refs/remotes/origin/feature/audit-log
```

Dilihat dengan:

```bash
git branch -r
```

Contoh output:

```text
origin/main
origin/feature/audit-log
origin/release/2026.06
```

Remote-tracking branch bukan remote branch itu sendiri. Ia adalah salinan lokal dari informasi terakhir yang kamu fetch.

Mental model:

```text
origin/main = pengetahuan lokalmu tentang main di origin saat terakhir fetch.
```

Jika remote berubah tetapi kamu belum fetch, `origin/main` lokalmu bisa stale.

---

## 7. Tracking Branch dan Upstream

Local branch bisa dikaitkan dengan upstream branch.

Contoh:

```text
local:  feature/audit-log
tracks: origin/feature/audit-log
```

Ini membuat Git tahu default target untuk:

```bash
git pull
git push
```

Melihat tracking relationship:

```bash
git branch -vv
```

Contoh:

```text
* feature/audit-log  e4f51aa [origin/feature/audit-log: ahead 2] Add audit query
  main               a1b2c3d [origin/main] Merge pull request #128
```

Makna:

```text
feature/audit-log branch lokal sedang 2 commit lebih maju dari origin/feature/audit-log.
```

Membuat branch lokal dari remote branch:

```bash
git switch --track origin/feature/audit-log
```

Atau:

```bash
git switch -c feature/audit-log origin/feature/audit-log
```

Push branch baru sekaligus set upstream:

```bash
git push -u origin feature/audit-log
```

`-u` adalah shorthand untuk `--set-upstream`.

---

## 8. Branch Command Modern: `switch` vs `checkout`

Historically, Git memakai `checkout` untuk banyak hal:

```bash
git checkout main
git checkout -b feature/audit-log
git checkout -- src/main/java/App.java
git checkout a1b2c3d
```

Masalahnya: `checkout` terlalu overloaded.

Sekarang Git menyediakan command yang lebih eksplisit:

```bash
git switch main
```

untuk berpindah branch, dan:

```bash
git restore src/main/java/App.java
```

untuk restore file.

Rekomendasi untuk belajar modern:

| Tujuan | Command modern |
|---|---|
| Pindah branch | `git switch branch-name` |
| Buat dan pindah branch | `git switch -c branch-name` |
| Detached HEAD | `git switch --detach commit-ish` |
| Restore file | `git restore file` |
| Restore staged file | `git restore --staged file` |

Tetap penting memahami `checkout` karena banyak dokumentasi, script lama, dan Stack Overflow masih memakainya.

---

## 9. Membuat Branch dengan Benar

### 9.1 Buat Branch dari Base yang Tepat

Sebelum membuat branch, pastikan kamu berada di base yang benar.

Untuk feature biasa:

```bash
git switch main
git fetch origin
git pull --ff-only
git switch -c feature/audit-log
```

Atau lebih eksplisit:

```bash
git fetch origin
git switch -c feature/audit-log origin/main
```

Perbedaannya:

```text
Membuat dari main lokal bergantung pada apakah main lokal sudah fresh.
Membuat dari origin/main memakai state remote-tracking terakhir setelah fetch.
```

Workflow aman:

```bash
git fetch origin
git switch -c feature/audit-log origin/main
```

### 9.2 Jangan Membuat Feature dari Feature Lain Tanpa Sadar

Kesalahan umum:

```bash
git switch feature/old-work
git switch -c feature/new-work
```

Akibatnya:

```text
main:              A---B---C
feature/old-work:           D---E
feature/new-work:               F---G
```

`feature/new-work` membawa commit `D` dan `E` dari old work.

Ini bisa membuat PR baru mengandung perubahan yang tidak relevan.

Sebelum membuat branch, cek:

```bash
git status
git branch --show-current
git log --oneline --decorate --graph -10
```

Jika base salah, buat ulang dari base benar:

```bash
git switch main
git pull --ff-only
git switch -c feature/new-work
```

Atau kalau branch sudah terlanjur dan hanya commit `F`/`G` yang ingin dipindahkan:

```bash
git switch -c feature/new-work-clean origin/main
git cherry-pick <F> <G>
```

---

## 10. Naming Branch yang Informatif

Branch name adalah metadata kolaborasi. Nama branch membantu orang memahami konteks sebelum membuka diff.

Format yang umum:

```text
feature/<short-description>
bugfix/<short-description>
hotfix/<short-description>
release/<version-or-date>
spike/<experiment-name>
chore/<maintenance-task>
refactor/<target-area>
```

Contoh baik:

```text
feature/audit-log-export
bugfix/null-customer-risk-score
hotfix/payment-timeout-prod
release/2026.06
spike/outbox-pattern-poc
chore/upgrade-spring-boot-3-4
refactor/extract-risk-rule-engine
```

Contoh buruk:

```text
my-branch
fix
new
test
john-work
update-service
final-final
```

### 10.1 Prinsip Naming

Nama branch sebaiknya:

- cukup pendek,
- searchable,
- menjelaskan intent,
- tidak mengandung data sensitif,
- konsisten dengan policy tim,
- tidak bergantung pada nama orang sebagai informasi utama,
- bisa dikaitkan dengan issue/ticket bila relevan.

Contoh dengan issue id:

```text
feature/ENF-2412-audit-log-export
bugfix/CASE-882-null-risk-score
hotfix/INC-20260617-payment-timeout
```

Untuk regulated/case-management systems, issue id sering berguna karena menghubungkan branch dengan requirement, approval, incident, atau audit trail.

---

## 11. Branch Lifetime: Semakin Lama, Semakin Mahal

Branch yang hidup lama cenderung menjadi mahal.

Kenapa?

Karena branch diverge dari mainline.

```text
main:    A---B---C---D---E---F---G---H
              \
feature:       X---Y---Z
```

Semakin banyak commit masuk ke `main` setelah branch dibuat, semakin besar kemungkinan:

- conflict meningkat,
- desain berubah,
- API berubah,
- migration berubah,
- dependency berubah,
- test expectation berubah,
- PR menjadi besar,
- reviewer kehilangan konteks,
- semantic conflict tidak terlihat,
- integrasi menjadi event besar.

Mental model:

```text
Branch lifetime is integration debt.
```

Bukan berarti semua long-lived branch buruk. Release branch bisa sengaja long-lived dalam konteks tertentu. Tetapi feature branch yang hidup lama biasanya smell.

### 11.1 Integrasi Sering Lebih Murah daripada Integrasi Besar

Daripada menunggu 3 minggu lalu merge 80 file, lebih sehat:

- pecah fitur,
- gunakan feature flag,
- buat PR kecil,
- integrate sering,
- jaga main tetap hijau,
- hide unfinished behavior dengan config/flag.

Untuk Java backend:

```text
Lebih baik merge schema-compatible groundwork kecil daripada menyimpan seluruh redesign di branch besar sampai selesai.
```

---

## 12. Jenis Branch Berdasarkan Tujuan

Tidak semua branch punya peran sama.

### 12.1 Feature Branch

Untuk pengembangan fitur:

```text
feature/<name>
```

Karakteristik sehat:

- dibuat dari mainline fresh,
- scope jelas,
- umur pendek,
- PR reviewable,
- test lengkap,
- tidak membawa perubahan tidak relevan,
- dihapus setelah merge.

Contoh:

```bash
git switch -c feature/case-assignment-rules origin/main
```

### 12.2 Bugfix Branch

Untuk memperbaiki bug non-production-urgent:

```text
bugfix/<name>
```

Contoh:

```text
bugfix/null-pointer-risk-score
```

Biasanya target merge ke main.

### 12.3 Hotfix Branch

Untuk memperbaiki masalah production urgent.

```text
hotfix/<incident-or-issue>
```

Sering dibuat dari tag release production, bukan dari `main` terbaru.

Contoh:

```bash
git switch -c hotfix/INC-20260617-payment-timeout v2.7.4
```

Setelah fix:

- merge/tag release hotfix,
- backport atau merge kembali ke main,
- pastikan fix tidak hilang di development line.

### 12.4 Release Branch

Untuk stabilisasi release:

```text
release/<version>
```

Contoh:

```text
release/2.8.0
release/2026.06
```

Digunakan ketika tim butuh freeze/stabilization window.

Risiko release branch:

- divergence dari main,
- double-fix,
- lupa backport,
- patch beda antara release dan main,
- environment branch anti-pattern.

### 12.5 Spike Branch

Untuk eksperimen yang boleh dibuang:

```text
spike/<name>
```

Contoh:

```text
spike/virtual-threads-for-report-export
spike/scylla-read-model
```

Spike sebaiknya tidak langsung merge sebagai production code tanpa dirapikan.

Spike menghasilkan learning. Jika hasilnya ingin dipakai, buat branch implementasi bersih.

### 12.6 Refactor Branch

Untuk perubahan struktur tanpa mengubah behavior.

```text
refactor/<area>
```

Contoh:

```text
refactor/extract-enforcement-state-machine
```

Bahaya refactor branch:

- scope melebar,
- bercampur dengan feature,
- conflict tinggi,
- reviewer sulit membedakan behavior change vs structure change.

Prinsip:

```text
Refactor branch harus sangat disiplin menjaga behavior.
```

---

## 13. Branch Lokal dan Working Tree: Yang Harus Bersih Sebelum Switch

Saat berpindah branch, Git perlu mengubah working tree agar sesuai dengan target commit.

Jika ada perubahan lokal yang akan tertimpa, Git akan menolak:

```text
error: Your local changes to the following files would be overwritten by checkout
```

Ini bukan gangguan. Ini safety mechanism.

Pilihan kamu:

### 13.1 Commit Dulu

Jika perubahan sudah bermakna:

```bash
git add .
git commit -m "WIP: draft audit query"
git switch main
```

Tetapi hati-hati dengan WIP commit di history publik. Nanti bisa dirapikan dengan interactive rebase sebelum PR.

### 13.2 Stash Dulu

Jika perubahan belum siap commit:

```bash
git stash push -m "audit log draft"
git switch main
```

Nanti:

```bash
git stash pop
```

Stash dibahas lebih dalam di part 018.

### 13.3 Buat Branch dari Work in Progress

Jika kamu sadar sedang bekerja di branch salah:

```bash
git switch -c feature/correct-branch
```

Perubahan working tree ikut berada di branch baru.

### 13.4 Buang Perubahan

Jika perubahan memang tidak dibutuhkan:

```bash
git restore path/to/file
```

Atau semua tracked changes:

```bash
git restore .
```

Untuk untracked file:

```bash
git clean -fd
```

Hati-hati: `git clean` menghapus file untracked dari filesystem.

---

## 14. Branch dan Index: Perubahan Staged Saat Switch

Index juga bagian dari state lokal. Jika kamu sudah stage perubahan:

```bash
git add src/main/java/com/example/AuditService.java
```

lalu switch branch, Git harus menjaga konsistensi index terhadap branch target.

Karena itu sebelum pindah branch, biasakan:

```bash
git status
```

Interpretasi:

```text
working tree clean
```

berarti aman berpindah.

Jika tidak clean, ambil keputusan eksplisit:

- commit,
- stash,
- restore,
- buat branch baru,
- atau lanjut dengan sadar.

Jangan membiasakan diri berpindah branch dalam keadaan setengah staged tanpa tahu konsekuensinya.

---

## 15. Branch Divergence: Ahead, Behind, dan Both

Saat local branch punya upstream, Git bisa menampilkan status:

```bash
git status
```

Contoh:

```text
Your branch is ahead of 'origin/feature/audit-log' by 2 commits.
```

Artinya:

```text
Local branch punya 2 commit yang belum ada di remote-tracking upstream.
```

```text
Your branch is behind 'origin/main' by 5 commits.
```

Artinya:

```text
Upstream punya 5 commit yang belum ada di local branch.
```

```text
Your branch and 'origin/feature/audit-log' have diverged,
and have 2 and 3 different commits each, respectively.
```

Artinya:

```text
Local dan upstream sama-sama punya commit unik.
```

Divergence perlu integrasi:

- merge,
- rebase,
- reset jika memang ingin mengikuti remote,
- atau force-with-lease jika sedang rewrite private branch dengan sadar.

Jangan asal `git pull` ketika diverged tanpa tahu apakah pull akan merge atau rebase.

---

## 16. Visualisasi Divergence

Misalkan local branch:

```text
A---B---C  origin/feature
     \
      D---E  feature
```

Local `feature` dan `origin/feature` diverged sejak `B`.

Jika kamu merge:

```text
A---B---C------M  feature
     \        /
      D---E---
```

Jika kamu rebase:

```text
A---B---C  origin/feature
         \
          D'---E'  feature
```

Rebase membuat commit baru `D'` dan `E'`.

Keputusan merge vs rebase akan dibahas lebih dalam di part 008 dan 009. Untuk sekarang, pahami bahwa divergence adalah kondisi graph, bukan sekadar pesan error.

---

## 17. Fetch Sebelum Menilai Branch

Karena remote-tracking branch bisa stale, selalu fetch sebelum mengambil keputusan penting:

```bash
git fetch origin
```

Lalu cek:

```bash
git branch -vv
git log --oneline --graph --decorate --all -20
```

Tanpa fetch, kamu mungkin berpikir:

```text
Branch saya up to date.
```

Padahal remote sudah berubah.

Mental model:

```text
git fetch memperbarui pengetahuan lokal tentang remote.
```

Fetch tidak mengubah working tree dan tidak mengintegrasikan perubahan ke branch aktif.

Ini membuat `fetch` relatif aman sebagai langkah observasi.

---

## 18. Push Branch Baru

Setelah membuat commit lokal:

```text
A---B---C  main
         \
          D---E  feature/audit-log
```

Push ke remote:

```bash
git push -u origin feature/audit-log
```

Hasil:

```text
origin/feature/audit-log -> E
feature/audit-log        -> E
```

`-u` membuat upstream sehingga berikutnya cukup:

```bash
git push
```

### 18.1 Kapan Push Feature Branch?

Push berguna ketika:

- ingin membuat PR,
- ingin backup remote,
- ingin kolaborasi dengan engineer lain,
- ingin CI berjalan,
- ingin review awal,
- ingin share work-in-progress.

Namun, begitu branch dipush dan dipakai orang lain, rewrite history harus lebih hati-hati.

---

## 19. Menghapus Branch

Setelah branch selesai dan merge, hapus branch lokal:

```bash
git branch -d feature/audit-log
```

`-d` aman karena menolak jika branch belum merged.

Force delete lokal:

```bash
git branch -D feature/audit-log
```

Gunakan jika benar-benar yakin branch tidak diperlukan.

Hapus branch remote:

```bash
git push origin --delete feature/audit-log
```

Setelah branch remote dihapus, remote-tracking reference lokal orang lain mungkin masih ada sampai mereka prune:

```bash
git fetch --prune
```

Atau:

```bash
git remote prune origin
```

### 19.1 Kenapa Branch Harus Dihapus?

Branch lama yang tidak dibersihkan menyebabkan:

- daftar branch noisy,
- orang bingung mana yang aktif,
- branch stale terlihat seperti masih relevan,
- automation bisa salah target,
- maintenance mental overhead.

Repository sehat punya hygiene branch.

---

## 20. Branch Protection dan Mainline Safety

Di team environment, branch penting seperti `main`, `master`, `develop`, atau `release/*` biasanya perlu protection rule.

Contoh policy:

```text
main:
- no direct push
- PR required
- CI required
- approval required
- status checks must pass
- linear history optional/required depending on workflow
- signed commits optional
- require branch up to date optional
```

Untuk Java backend, branch protection mencegah:

- push tidak sengaja ke main,
- commit yang belum test masuk main,
- bypass review,
- broken build masuk release,
- perubahan kritikal tanpa audit trail.

Git lokal tidak cukup untuk governance tim. Hosting platform dan CI/CD perlu ikut menegakkan aturan.

---

## 21. Branch sebagai Boundary Review

Branch sering menjadi basis Pull Request/Merge Request.

PR membandingkan branch feature terhadap base branch:

```text
base: main
compare: feature/audit-log
```

PR yang baik berasal dari branch yang baik:

- base benar,
- scope jelas,
- commit masuk akal,
- tidak membawa perubahan unrelated,
- tidak stale terlalu lama,
- test hijau,
- description menjelaskan intent,
- diff bisa direview.

Branch buruk menghasilkan PR buruk.

Contoh branch buruk:

```text
feature/big-refactor-and-new-payment-and-test-fix
```

Masalah:

- scope tidak jelas,
- reviewer tidak tahu intent utama,
- sulit rollback sebagian,
- conflict tinggi,
- risiko hidden behavior change.

---

## 22. Branch untuk Eksperimen Aman

Salah satu kekuatan Git adalah membuat eksperimen murah.

Misalnya kamu ingin mencoba mengganti implementation:

- dari synchronous validation ke async pipeline,
- dari JPA query ke projection read model,
- dari thread pool biasa ke virtual threads,
- dari in-memory rule evaluation ke compiled decision table.

Buat spike branch:

```bash
git switch -c spike/virtual-threads-report-export
```

Eksperimen bebas:

```bash
# ubah kode, benchmark, test, profiling
```

Jika gagal:

```bash
git switch main
git branch -D spike/virtual-threads-report-export
```

Jika berhasil, jangan otomatis merge semua eksperimen. Biasanya lebih baik:

1. Simpan insight.
2. Buat design note.
3. Buat branch implementasi bersih dari main.
4. Cherry-pick bagian relevan jika perlu.
5. Tulis tests dan cleanup.

Eksperimen dan production change punya standar berbeda.

---

## 23. Branch untuk Parallel Work

Kadang kamu perlu mengerjakan beberapa hal paralel:

```text
feature/audit-log
bugfix/risk-score-null
review/teammate-pr
hotfix/payment-timeout
```

Branch membantu, tetapi working tree tunggal bisa menjadi bottleneck.

Jika sering berpindah konteks, `git worktree` lebih sehat daripada stash berkali-kali.

Contoh:

```bash
git worktree add ../payment-service-hotfix hotfix/payment-timeout
```

Maka kamu punya directory terpisah untuk branch hotfix.

`git worktree` akan dibahas detail di part 018, tetapi penting memahami bahwa branch bukan satu-satunya mekanisme context switching. Branch adalah pointer; working tree adalah tempat file checkout.

---

## 24. Branch dan Feature Flag

Feature branch mengisolasi perubahan di Git. Feature flag mengisolasi behavior di runtime.

Untuk delivery modern, keduanya sering digabung:

```text
Branch kecil + feature flag = integrasi cepat tanpa expose behavior unfinished.
```

Contoh Java backend:

```java
if (featureFlags.isEnabled("case.assignment.v2")) {
    return assignmentV2.assign(caseData);
}
return assignmentV1.assign(caseData);
```

Dengan ini, kamu bisa merge groundwork lebih awal:

- domain object baru,
- repository baru,
- service baru,
- metrics,
- tests,
- config,
- shadow mode,

namun behavior production belum aktif.

Ini mengurangi long-lived feature branch.

Trade-off:

- flag menambah kompleksitas,
- perlu cleanup,
- perlu observability,
- perlu policy siapa yang boleh enable,
- perlu test kombinasi flag.

Git branch menyelesaikan isolasi source code. Feature flag menyelesaikan isolasi runtime behavior. Jangan campur mental modelnya.

---

## 25. Environment Branch: Anti-Pattern yang Sering Muncul

Beberapa tim memakai branch seperti:

```text
dev
qa
staging
prod
```

Lalu promote release dengan merge antar branch environment.

Ini sering bermasalah.

Kenapa?

Karena environment adalah deployment target, bukan necessarily source-code history line.

Masalah environment branch:

- branch drift,
- cherry-pick manual,
- fix beda antar environment,
- history sulit dibaca,
- deployment tidak reproducible,
- environment state tidak jelas,
- merge arah salah,
- production tidak selalu merepresentasikan tag/artifact tertentu.

Alternatif yang lebih sehat:

```text
source control: main/release branches/tags
artifact: immutable build artifact
promotion: deploy artifact yang sama ke env berbeda
config: environment-specific config di luar artifact
```

Untuk Java:

```text
Commit -> CI build -> artifact version -> deploy dev -> deploy staging -> deploy prod
```

Bukan:

```text
merge dev branch -> qa branch -> staging branch -> prod branch
```

Ada konteks tertentu di mana environment branch dipakai karena constraint organisasi lama, tetapi jangan jadikan default tanpa memahami failure mode.

---

## 26. Branch Strategy untuk Java Backend: Contoh Praktis

Misalkan tim mengembangkan `enforcement-case-service`.

Kebutuhan:

- main harus selalu buildable,
- PR wajib review,
- CI menjalankan unit/integration test,
- release mingguan,
- hotfix production bisa kapan saja,
- audit trail penting,
- deployment artifact immutable.

Strategi sederhana:

```text
main
  - branch integrasi utama
  - selalu hijau
  - protected
  - merge via PR only

feature/*
  - short-lived
  - dari origin/main
  - PR ke main

bugfix/*
  - short-lived
  - dari origin/main
  - PR ke main

release/*
  - dibuat saat stabilization
  - hanya bugfix release-critical
  - ditag saat release

hotfix/*
  - dari production tag
  - PR ke release/main sesuai policy
  - wajib backport/forward-port
```

Flow feature:

```bash
git fetch origin
git switch -c feature/ENF-2412-audit-log origin/main
# work
mvn test
git push -u origin feature/ENF-2412-audit-log
# open PR to main
```

Flow hotfix:

```bash
git fetch origin --tags
git switch -c hotfix/INC-20260617-payment-timeout v2.7.4
# fix + test
git push -u origin hotfix/INC-20260617-payment-timeout
# PR to release/prod line
# tag v2.7.5
# forward-port fix to main
```

---

## 27. Branch Strategy untuk Monorepo Java

Dalam monorepo, satu branch bisa memengaruhi banyak module:

```text
root
├── case-service
├── payment-service
├── notification-service
├── shared-kernel
└── build-logic
```

Risiko branching di monorepo:

- PR besar lintas module,
- conflict di shared-kernel,
- CI mahal,
- ownership kabur,
- perubahan build logic memengaruhi semua,
- branch lama cepat stale.

Praktik sehat:

- branch lebih pendek,
- PR kecil,
- CODEOWNERS/module ownership,
- selective CI,
- avoid unrelated module changes,
- feature flag untuk perubahan besar,
- contract tests antar module,
- careful shared-kernel evolution.

Branch di monorepo harus lebih disiplin karena blast radius lebih besar.

---

## 28. Branch Strategy untuk Polyrepo Microservices

Dalam polyrepo, setiap service punya repository sendiri:

```text
case-service repo
payment-service repo
notification-service repo
```

Branching lebih lokal, tetapi perubahan lintas service sulit dikoordinasikan.

Masalah umum:

- branch di banyak repo untuk satu feature,
- urutan merge/deploy kompleks,
- contract mismatch,
- rollback sebagian,
- PR tersebar,
- visibility rendah.

Praktik sehat:

- backward-compatible contract,
- consumer-driven contract tests,
- feature flag lintas service,
- versioned API,
- separate deployability,
- issue/epic id konsisten di branch name,
- integration plan eksplisit.

Contoh branch lintas repo:

```text
case-service:        feature/ENF-2412-case-assignment-v2
notification-service: feature/ENF-2412-assignment-events
frontend:            feature/ENF-2412-assignment-ui
```

Jangan mengandalkan branch multi-repo sebagai satu transaction. Git tidak memberi distributed transaction antar repository.

---

## 29. Branch Smells

Berikut tanda branch mulai tidak sehat.

### 29.1 Branch Terlalu Lama

Gejala:

- branch > beberapa hari/minggu tanpa integrasi,
- conflict makin sering,
- PR makin besar,
- base branch jauh berubah.

Perbaikan:

- pecah PR,
- merge groundwork,
- pakai feature flag,
- rebase/merge main secara teratur dengan sadar,
- kurangi scope.

### 29.2 Branch Scope Campur

Contoh:

```text
feature/add-report-export
```

tetapi isi:

- report export,
- upgrade Spring Boot,
- refactor security config,
- rename package,
- fix flaky test.

Perbaikan:

- pisah branch,
- pisah PR,
- cherry-pick commit relevan,
- interactive rebase untuk cleanup.

### 29.3 Branch Dibuat dari Base Salah

Gejala:

- PR mengandung commit orang lain,
- diff terlalu besar,
- merge base tidak sesuai.

Cek:

```bash
git merge-base main HEAD
git log --oneline --graph --decorate main...HEAD
```

Perbaikan:

```bash
git switch -c clean-branch origin/main
git cherry-pick <commit-yang-benar>
```

### 29.4 Branch Jadi Tempat Backup

Branch seperti:

```text
backup-before-refactor
old-working-version
john-temp-2
```

bisa berguna sementara, tetapi jika dibiarkan lama akan menjadi sampah referensi.

Lebih baik gunakan:

- tag sementara jika perlu anchor,
- branch dengan TTL,
- draft PR,
- remote backup dengan naming jelas,
- hapus setelah tidak perlu.

### 29.5 Branch Publik Sering Di-force Push Tanpa Koordinasi

Force push bisa wajar untuk branch pribadi. Tetapi untuk branch kolaboratif, force push bisa mengacaukan local clone orang lain.

Gunakan:

```bash
git push --force-with-lease
```

bukan:

```bash
git push --force
```

Tetap koordinasikan jika branch dipakai orang lain.

---

## 30. Decision Matrix: Kapan Membuat Branch?

| Situasi | Buat branch? | Jenis branch | Catatan |
|---|---:|---|---|
| Fitur baru kecil | Ya | `feature/*` | Short-lived, PR kecil |
| Bugfix biasa | Ya | `bugfix/*` | Dari main fresh |
| Hotfix production | Ya | `hotfix/*` | Biasanya dari production tag |
| Eksperimen teknis | Ya | `spike/*` | Boleh dibuang |
| Refactor kecil langsung | Ya/opsional | `refactor/*` | Jangan campur behavior change |
| Perubahan doc kecil | Bisa langsung branch kecil | `docs/*` / `chore/*` | Tetap via PR jika main protected |
| Simpan kerja belum selesai | Mungkin | WIP branch atau stash | Pilih berdasarkan durasi/context |
| Deploy ke environment | Biasanya tidak | Hindari env branch | Pakai artifact promotion |
| Release stabilization | Ya jika perlu | `release/*` | Butuh backport discipline |

---

## 31. Decision Matrix: Branch, Stash, Commit, atau Worktree?

| Situasi | Pilihan terbaik | Alasan |
|---|---|---|
| Perubahan sudah punya makna | Commit | Membuat state recoverable |
| Perubahan belum rapi tapi perlu pindah sebentar | Stash | Cepat untuk context switch pendek |
| Sedang di branch salah | Buat branch baru | Menyelamatkan WIP ke konteks benar |
| Perlu kerja paralel beberapa hari | Worktree | Lebih bersih daripada stash banyak |
| Eksperimen besar | Branch spike | Bisa dibuang atau dipelajari |
| Hotfix urgent saat feature belum selesai | Worktree atau stash+branch | Jangan campur hotfix dengan WIP |
| Perlu backup remote | Push branch | Remote sebagai shared/backup state |

---

## 32. Command Penting Branching

### 32.1 Melihat Branch

```bash
git branch
```

Melihat semua branch lokal dan remote-tracking:

```bash
git branch -a
```

Melihat branch dengan upstream dan ahead/behind:

```bash
git branch -vv
```

Melihat branch aktif:

```bash
git branch --show-current
```

### 32.2 Membuat dan Pindah Branch

```bash
git switch -c feature/audit-log
```

Membuat dari base tertentu:

```bash
git switch -c feature/audit-log origin/main
```

Pindah branch:

```bash
git switch main
```

Detached HEAD:

```bash
git switch --detach v2.1.0
```

### 32.3 Rename Branch

Rename branch aktif:

```bash
git branch -m feature/new-name
```

Rename branch tertentu:

```bash
git branch -m old-name new-name
```

Jika branch sudah dipush, push nama baru dan hapus lama:

```bash
git push -u origin new-name
git push origin --delete old-name
```

### 32.4 Delete Branch

Delete aman:

```bash
git branch -d feature/audit-log
```

Force delete lokal:

```bash
git branch -D feature/audit-log
```

Delete remote:

```bash
git push origin --delete feature/audit-log
```

### 32.5 Fetch dan Prune

```bash
git fetch origin
```

Fetch semua remote:

```bash
git fetch --all
```

Fetch dan prune remote-tracking branch yang sudah dihapus di remote:

```bash
git fetch --prune
```

### 32.6 Set Upstream

Push branch baru dan set upstream:

```bash
git push -u origin feature/audit-log
```

Set upstream untuk branch existing:

```bash
git branch --set-upstream-to=origin/feature/audit-log
```

---

## 33. Latihan Praktis: Melihat Branch sebagai Pointer

Buat repository latihan:

```bash
mkdir git-branch-lab
cd git-branch-lab
git init
```

Buat commit awal:

```bash
echo "v1" > app.txt
git add app.txt
git commit -m "Initial commit"
```

Buat branch:

```bash
git switch -c feature/a
```

Commit di branch:

```bash
echo "feature a" >> app.txt
git add app.txt
git commit -m "Add feature a"
```

Lihat graph:

```bash
git log --oneline --graph --decorate --all
```

Pindah ke main:

```bash
git switch main
cat app.txt
```

Kamu akan melihat file kembali ke state main. Commit feature tidak hilang; working tree berubah sesuai branch aktif.

Buat commit di main:

```bash
echo "main change" >> app.txt
git add app.txt
git commit -m "Add main change"
```

Lihat graph:

```bash
git log --oneline --graph --decorate --all
```

Kamu akan melihat divergence.

Target pemahaman:

```text
Branch bukan folder.
Branch adalah pointer.
Switch branch mengubah working tree agar sesuai commit target.
```

---

## 34. Latihan Praktis: Base Branch Salah

Simulasikan kesalahan umum.

Pastikan ada branch `feature/a` dari latihan sebelumnya. Dari `feature/a`, buat branch baru:

```bash
git switch feature/a
git switch -c feature/b
```

Buat commit:

```bash
echo "feature b" > b.txt
git add b.txt
git commit -m "Add feature b"
```

Sekarang lihat diff terhadap main:

```bash
git log --oneline --graph --decorate main...feature/b
git diff main...feature/b
```

Kamu akan melihat branch `feature/b` membawa perubahan dari `feature/a` juga.

Perbaikan dengan branch bersih:

```bash
git switch main
git switch -c feature/b-clean
git cherry-pick feature/b
```

Jika `feature/b` hanya punya satu commit terakhir, cherry-pick mudah. Jika punya beberapa commit, pilih commit yang relevan.

Lesson:

```text
Selalu pastikan base sebelum membuat branch.
```

---

## 35. Latihan Praktis: Detached HEAD Rescue

Checkout commit lama:

```bash
git log --oneline
```

Ambil salah satu commit hash lama:

```bash
git switch --detach <commit-hash>
```

Buat commit:

```bash
echo "detached experiment" > detached.txt
git add detached.txt
git commit -m "Experiment in detached HEAD"
```

Sekarang kamu punya commit tanpa branch.

Selamatkan:

```bash
git switch -c rescue/detached-experiment
```

Lihat:

```bash
git log --oneline --graph --decorate --all
```

Lesson:

```text
Detached HEAD bukan bencana jika kamu tahu cara memberi nama commit dengan branch.
```

---

## 36. Failure Mode: Branch Hilang Setelah Delete

Jika branch lokal terhapus:

```bash
git branch -D feature/audit-log
```

Commit mungkin masih recoverable jika kamu tahu hash atau melalui reflog.

Cek reflog:

```bash
git reflog
```

Lalu buat branch lagi:

```bash
git branch feature/audit-log <commit-hash>
```

Recovery detail akan dibahas di part 017, tetapi mental modelnya sudah harus jelas:

```text
Menghapus branch menghapus pointer, bukan langsung menghapus commit object.
Commit yang masih reachable dari ref lain tetap aman.
Commit unreachable biasanya masih bisa ditemukan sementara lewat reflog/object database.
```

---

## 37. Failure Mode: Push ke Branch Salah

Misalnya kamu tanpa sadar berada di branch `main` dan commit:

```bash
git branch --show-current
# main
```

Lalu sudah commit tetapi belum push. Perbaikan:

```bash
git switch -c feature/correct-branch
```

Sekarang branch baru menunjuk ke commit tersebut. Kembalikan main ke origin/main:

```bash
git switch main
git reset --hard origin/main
```

Hati-hati: `reset --hard` mengubah branch dan working tree. Gunakan hanya jika yakin commit sudah diselamatkan di branch baru.

Jika sudah push ke main, jangan asal reset/force push. Gunakan prosedur tim. Biasanya revert lebih aman untuk public protected branch.

---

## 38. Failure Mode: Branch Remote Dihapus Tapi Masih Muncul Lokal

Kamu melihat:

```bash
git branch -r
```

Masih ada:

```text
origin/feature/old-work
```

Padahal di GitHub/GitLab sudah dihapus.

Solusi:

```bash
git fetch --prune origin
```

Atau set default:

```bash
git config --global fetch.prune true
```

Dengan ini, remote-tracking branch stale akan dibersihkan saat fetch.

---

## 39. Failure Mode: Branch Name Bermasalah

Branch name bisa mengandung slash, tetapi ada aturan refname. Hindari nama yang:

- mengandung spasi,
- terlalu panjang,
- mengandung karakter aneh,
- berbeda hanya case di tim cross-platform,
- sama dengan path prefix yang konflik.

Contoh konflik:

```text
feature
feature/audit-log
```

Jika `refs/heads/feature` sudah ada sebagai file ref, kamu tidak bisa membuat `refs/heads/feature/audit-log` karena butuh directory `feature/`.

Praktik sehat:

```text
Selalu gunakan namespace konsisten: feature/*, bugfix/*, hotfix/*.
Jangan membuat branch bernama persis feature jika ingin memakai feature/*.
```

---

## 40. Branch dan Auditability

Dalam sistem regulasi/enforcement/case management, branch strategy memengaruhi auditability.

Pertanyaan audit yang harus bisa dijawab:

- perubahan ini berasal dari branch/PR apa?
- siapa yang mereview?
- CI apa yang berjalan?
- commit mana yang masuk release?
- apakah hotfix sudah dibawa kembali ke main?
- apakah branch release berbeda dari main?
- apakah production artifact bisa ditelusuri ke tag?
- apakah commit history di-rewrite setelah approval?

Branch tanpa policy bisa merusak traceability.

Contoh buruk:

```text
Developer force-push branch setelah approval.
PR squash tanpa mempertahankan issue reference.
Hotfix langsung commit ke prod branch tanpa backport.
Release dibuat dari branch yang tidak jelas base-nya.
```

Contoh lebih defensible:

```text
feature/ENF-2412-audit-log-export
PR #842 approved by code owner
CI build #11932 passed
merged to main commit abc123
release tag v2.8.0 includes abc123
artifact enforcement-case-service:2.8.0 built from v2.8.0
```

Git branch bukan audit record lengkap, tetapi branch naming dan workflow bisa memperkuat audit chain.

---

## 41. Branch dan Ownership

Branch sering mencerminkan ownership sementara.

Namun, hati-hati dengan mental model:

```text
Branch saya = kode saya.
```

Dalam team engineering, branch adalah ruang kerja sementara, bukan kepemilikan permanen. Setelah merge, kode menjadi milik sistem/tim.

Praktik sehat:

- gunakan branch untuk isolate work,
- gunakan PR untuk share context,
- gunakan CODEOWNERS untuk ownership area,
- gunakan issue/ADR untuk keputusan,
- jangan biarkan knowledge hanya hidup di branch lokal.

Branch lokal yang tidak dipush dan tidak didokumentasikan tidak membantu tim.

---

## 42. Branch dan Review Ergonomics

Branch yang baik membuat reviewer mudah bekerja.

Reviewer butuh menjawab:

```text
Apa intent perubahan ini?
Apa scope-nya?
Apa base-nya?
Apa risiko behavior-nya?
Apa yang tidak termasuk?
Bagaimana menguji?
```

Branch membantu jika:

- namanya jelas,
- PR description jelas,
- commit history masuk akal,
- diff tidak membawa unrelated changes,
- branch up to date dengan base secara wajar,
- generated files dipisahkan jika besar,
- refactor dan behavior change tidak dicampur.

Branch menghambat jika:

- terlalu besar,
- terlalu lama,
- terlalu sering force-push setelah review,
- tidak punya issue context,
- dibuat dari base salah.

---

## 43. Branch dan Semantic Conflict

Git hanya bisa mendeteksi textual conflict. Branch yang tidak conflict secara text belum tentu aman secara semantics.

Contoh:

Branch A mengubah enum:

```java
public enum CaseStatus {
    OPEN,
    UNDER_REVIEW,
    CLOSED
}
```

Branch B menambahkan logic:

```java
if (status == CaseStatus.OPEN) {
    allowAssignment();
}
```

Kedua branch bisa merge tanpa textual conflict. Tetapi behavior baru mungkin salah karena `UNDER_REVIEW` juga seharusnya allow assignment.

Semakin lama branch hidup, semakin besar risiko semantic conflict.

Mitigasi:

- integrasi sering,
- tests berbasis behavior,
- contract tests,
- domain review,
- feature flags,
- small PR,
- ownership review.

---

## 44. Branch dan Database Migration

Java backend sering membawa database migration:

```text
src/main/resources/db/migration/V202606171030__add_audit_log_table.sql
```

Branching dengan migration punya risiko khusus:

### 44.1 Migration Version Conflict

Dua branch membuat migration dengan version sama:

```text
V202606171030__add_audit_log_table.sql
V202606171030__add_assignment_rule_table.sql
```

Saat merge, bisa conflict atau runtime migration order bermasalah.

Mitigasi:

- naming timestamp presisi,
- CI migration validation,
- rebase sebelum merge,
- team convention,
- avoid editing applied migration.

### 44.2 Long-Lived Branch dengan Migration Lama

Branch lama menambahkan migration yang didesain terhadap schema lama. Main sudah berubah.

Risiko:

- migration gagal,
- constraint bentrok,
- column sudah berubah,
- data migration invalid,
- rollback sulit.

Mitigasi:

- keep branch short,
- run migration tests after integrating main,
- backward-compatible schema changes,
- expand-contract pattern.

Branch strategy dan database evolution tidak bisa dipisahkan.

---

## 45. Branch dan Dependency Upgrade

Dependency upgrade di Java sering menyentuh banyak file:

- `pom.xml`,
- `build.gradle`,
- lockfile,
- generated metadata,
- tests,
- config,
- deprecation fixes.

Sebaiknya dependency upgrade tidak dicampur dengan feature branch biasa.

Contoh baik:

```text
chore/upgrade-spring-boot-3-4-2
```

Kenapa dipisah?

- blast radius besar,
- conflict tinggi,
- CI failure bisa unrelated,
- review butuh fokus berbeda,
- rollback lebih jelas.

Jika upgrade dependency dibutuhkan untuk fitur, pertimbangkan dua step:

1. Merge upgrade dependency dulu.
2. Buat feature branch dari main terbaru.

---

## 46. Branch dan Generated Code

Project Java sering punya generated code dari:

- OpenAPI,
- Protobuf,
- Avro,
- GraphQL schema,
- annotation processor,
- MapStruct,
- JOOQ,
- QueryDSL.

Branch yang mengubah source contract dan generated code bisa menghasilkan diff besar.

Praktik sehat:

- pisahkan commit contract change dan generated output,
- pastikan generator version stabil,
- hindari generated noise akibat environment berbeda,
- gunakan `.gitattributes` jika perlu linguist/generated marking,
- jangan edit generated code manual.

Branch diff yang penuh generated code menyulitkan review behavior.

---

## 47. Branch Safety Checklist Sebelum Mulai Kerja

Sebelum membuat branch:

```text
[ ] Saya tahu base branch yang benar.
[ ] Saya sudah fetch remote terbaru.
[ ] Working tree bersih atau WIP sengaja dibawa.
[ ] Nama branch menjelaskan intent.
[ ] Scope branch cukup kecil.
[ ] Saya tahu target PR/merge branch.
[ ] Saya tahu apakah perubahan butuh feature flag.
[ ] Saya tahu apakah perubahan menyentuh migration/dependency/generated code.
```

Command praktis:

```bash
git status
git fetch origin
git switch -c feature/<name> origin/main
```

---

## 48. Branch Safety Checklist Sebelum Push

Sebelum push:

```text
[ ] Branch aktif benar.
[ ] Commit history tidak membawa perubahan unrelated.
[ ] Diff terhadap base masuk akal.
[ ] Tests relevan sudah berjalan.
[ ] Tidak ada secret/config lokal.
[ ] Tidak ada generated/binary noise yang tidak disengaja.
[ ] Branch name sesuai convention.
[ ] Upstream akan diset dengan benar.
```

Command praktis:

```bash
git branch --show-current
git status
git fetch origin
git log --oneline --graph --decorate origin/main...HEAD
git diff --stat origin/main...HEAD
git push -u origin HEAD
```

`git push -u origin HEAD` berarti push branch aktif ke remote dengan nama yang sama.

---

## 49. Branch Safety Checklist Sebelum Delete

Sebelum delete branch:

```text
[ ] Branch sudah merged atau memang tidak dibutuhkan.
[ ] Tidak ada commit unik yang masih perlu.
[ ] PR sudah selesai/closed.
[ ] Jika remote branch ada, sudah tidak dipakai orang lain.
[ ] Jika branch mengandung hotfix, fix sudah forward-port/backport sesuai policy.
```

Command:

```bash
git branch --merged
git branch -d feature/<name>
git push origin --delete feature/<name>
git fetch --prune
```

---

## 50. Branch Safety Checklist untuk Reviewer

Saat review PR dari branch:

```text
[ ] Branch base benar.
[ ] Diff tidak membawa commit unrelated.
[ ] Branch tidak terlalu stale.
[ ] Perubahan sesuai nama/description branch.
[ ] Migration/dependency/generated changes disengaja.
[ ] Conflict sudah diselesaikan dengan test.
[ ] Tidak ada hidden behavior change dalam refactor.
[ ] Commit/PR punya trace ke issue/context.
```

Command lokal jika perlu review mendalam:

```bash
git fetch origin
git switch --track origin/feature/<name>
git log --oneline --graph --decorate origin/main...HEAD
git diff origin/main...HEAD
mvn test
```

---

## 51. Mental Model Ringkas

```text
Repository = object database + refs + working tree + index.
Branch = ref/pointer mutable ke commit.
HEAD = posisi aktif Git.
Commit = snapshot dengan parent.
Switch branch = mengubah HEAD dan working tree ke commit target.
Remote-tracking branch = pengetahuan lokal tentang remote saat fetch terakhir.
Upstream = default remote branch untuk pull/push.
Long-lived branch = integration debt.
Branch naming = metadata kolaborasi.
Branch hygiene = bagian dari engineering governance.
```

---

## 52. Command Reference Ringkas

```bash
# lihat branch lokal
git branch

# lihat branch lokal + remote-tracking
git branch -a

# lihat upstream dan ahead/behind
git branch -vv

# branch aktif
git branch --show-current

# fetch remote
git fetch origin

# fetch dan bersihkan remote-tracking stale
git fetch --prune origin

# buat branch dari main remote
git switch -c feature/name origin/main

# pindah branch
git switch main

# buat branch dari current commit
git branch feature/name

# push branch baru dan set upstream
git push -u origin feature/name

# push branch aktif
git push -u origin HEAD

# rename branch aktif
git branch -m new-name

# delete branch lokal aman
git branch -d feature/name

# force delete branch lokal
git branch -D feature/name

# delete branch remote
git push origin --delete feature/name

# detached HEAD
git switch --detach <commit-or-tag>

# rescue detached HEAD
git switch -c rescue/name
```

---

## 53. Kesalahan yang Harus Dihindari

```text
[ ] Menganggap branch sebagai copy folder.
[ ] Membuat branch dari branch lain tanpa sadar.
[ ] Membiarkan feature branch hidup terlalu lama.
[ ] Mencampur feature, refactor, dependency upgrade, dan bugfix dalam satu branch.
[ ] Push ke branch salah.
[ ] Force push ke branch kolaboratif tanpa koordinasi.
[ ] Tidak fetch sebelum menilai branch up to date.
[ ] Menggunakan environment branch sebagai default release strategy.
[ ] Tidak menghapus branch stale.
[ ] Mengabaikan semantic conflict karena Git tidak menampilkan conflict marker.
```

---

## 54. Pertanyaan Reflektif

Jawab tanpa melihat command reference:

1. Apa perbedaan branch dan commit?
2. Kenapa membuat branch di Git murah?
3. Apa yang bergerak saat kamu membuat commit di branch aktif?
4. Apa beda local branch dan remote-tracking branch?
5. Kenapa `origin/main` bisa stale?
6. Apa arti branch `ahead 2`?
7. Apa arti branch diverged?
8. Kapan detached HEAD aman?
9. Bagaimana menyelamatkan commit dari detached HEAD?
10. Kenapa long-lived branch meningkatkan risiko semantic conflict?
11. Kenapa feature flag bisa mengurangi kebutuhan long-lived branch?
12. Kenapa environment branch sering menjadi anti-pattern?
13. Bagaimana cara memperbaiki branch yang dibuat dari base salah?
14. Apa checklist sebelum push branch?
15. Apa hubungan branch strategy dengan auditability?

Jika kamu bisa menjawab ini dengan graph dan state transition, kamu sudah memahami branching secara substansial.

---

## 55. Mini Case Study: Fitur Assignment Rules

Kamu bekerja di Java service untuk enforcement case management. Ada fitur baru: rule-based assignment.

Perubahan yang dibutuhkan:

- entity `AssignmentRule`,
- repository query,
- service evaluator,
- endpoint admin,
- migration table,
- tests,
- feature flag,
- audit log.

Branch buruk:

```text
feature/assignment
```

hidup 4 minggu, berisi:

- schema,
- service,
- UI contract,
- refactor package,
- upgrade dependency,
- fix flaky test,
- generated OpenAPI,
- behavior change besar.

Akibat:

- PR 120 files,
- conflict migration,
- reviewer overwhelmed,
- semantic conflict dengan case status baru,
- hotfix sulit,
- release risk tinggi.

Branch lebih sehat:

```text
feature/ENF-2412-assignment-rule-schema
feature/ENF-2412-assignment-rule-evaluator
feature/ENF-2412-assignment-rule-api
feature/ENF-2412-assignment-rule-audit
```

Dengan feature flag:

```text
case.assignment.rules.enabled=false
```

Urutan merge:

1. Schema additive dan domain model.
2. Evaluator service dengan tests, belum aktif.
3. API/admin endpoint protected by flag/role.
4. Audit log.
5. Enable flag di environment terbatas.
6. Observability.
7. Gradual rollout.
8. Cleanup old path jika sudah aman.

Git branch di sini bukan sekadar tempat coding. Branch menjadi mekanisme mengatur risk slicing.

---

## 56. Apa yang Harus Dikuasai Sebelum Lanjut

Sebelum masuk part berikutnya, pastikan kamu bisa:

```text
[ ] Menjelaskan branch sebagai pointer ke commit.
[ ] Menjelaskan HEAD normal vs detached HEAD.
[ ] Membedakan local branch, remote branch, remote-tracking branch.
[ ] Membuat branch dari base yang benar.
[ ] Membaca ahead/behind/diverged.
[ ] Menghapus branch lokal dan remote dengan aman.
[ ] Mengetahui kapan branch harus pendek.
[ ] Mengetahui kapan spike branch boleh dibuang.
[ ] Menghindari environment branch sebagai default.
[ ] Menghubungkan branch strategy dengan PR, CI, release, dan audit.
```

---

## 57. Transisi ke Part Berikutnya

Branch memungkinkan history bercabang. Pertanyaan berikutnya:

```text
Jika dua branch sudah bercabang, bagaimana cara menggabungkannya?
```

Ada dua operasi besar:

- **merge**: menggabungkan history dengan mempertahankan struktur percabangan,
- **rebase**: memindahkan/replay commit ke base baru dan membuat history terlihat linear.

Part berikutnya akan fokus pada merge:

```text
learn-git-mastery-for-java-engineers-part-008.md
```

Topik:

```text
Merge: Menggabungkan Sejarah Tanpa Kehilangan Konteks
```

Kita akan membahas fast-forward merge, three-way merge, merge commit, conflict, merge base, `--no-ff`, strategi merge, dan kapan merge lebih tepat daripada rebase.

---

## 58. Ringkasan Akhir

Branch adalah salah satu fitur Git yang paling powerful karena ia membuat isolasi perubahan murah.

Namun kekuatan branch bukan pada command-nya, melainkan pada pemahaman state:

```text
Branch adalah pointer.
HEAD menentukan branch/commit aktif.
Commit membuat pointer branch aktif maju.
Switch branch mengubah working tree.
Remote-tracking branch adalah pengetahuan lokal tentang remote.
Long-lived branch adalah integration debt.
Branch strategy adalah bagian dari delivery strategy.
```

Engineer yang matang tidak hanya bertanya:

```text
Saya harus checkout branch apa?
```

Tetapi bertanya:

```text
Base branch saya benar?
Scope branch ini jelas?
Berapa lama branch ini akan hidup?
Apa risiko integrasinya?
Apakah branch ini perlu feature flag?
Apakah branch ini menjaga auditability?
Apa recovery plan jika saya salah branch?
```

Itulah perbedaan antara memakai Git sebagai command-line tool dan memakai Git sebagai sistem kendali evolusi software.

---

**Status seri:** belum selesai.  
**Progress:** 007 / 032.  
**Bagian berikutnya:** `learn-git-mastery-for-java-engineers-part-008.md`.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-git-mastery-for-java-engineers-part-006.md">⬅️ Part 006 — Diff Mental Model: Membandingkan State, Bukan Sekadar File</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-git-mastery-for-java-engineers-part-008.md">Menggabungkan Sejarah Tanpa Kehilangan Konteks ➡️</a>
</div>

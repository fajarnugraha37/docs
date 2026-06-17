# learn-git-mastery-for-java-engineers-part-017.md

# Part 017 — Recovery: Reflog, Lost Commit, dan Disaster Handling

## Ringkasan

Bagian ini membahas cara berpikir dan prosedur pemulihan ketika sesuatu tampak “hilang” di Git: commit hilang setelah `reset --hard`, branch terhapus, rebase gagal, stash ter-drop, detached HEAD tertinggal, merge/rebase kacau, atau working tree rusak.

Fokus utama bukan hanya menghafal command recovery, tetapi memahami **kenapa recovery sering mungkin**:

```text
Di Git, banyak insiden bukan kehilangan data.
Banyak insiden hanyalah kehilangan reference.
```

Selama object commit/blob/tree masih ada di object database dan belum dihapus oleh garbage collection, kita sering bisa membuat reference baru untuk menyelamatkannya.

Bagian ini adalah salah satu fondasi penting untuk menjadi engineer yang tenang saat repository terlihat rusak. Engineer yang kuat bukan engineer yang tidak pernah salah command. Engineer yang kuat adalah engineer yang memahami state, tahu apa yang berisiko, tahu cara berhenti memperparah kerusakan, dan punya prosedur recovery yang defensible.

---

## Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu:

1. Memahami perbedaan antara commit yang **unreferenced**, **unreachable**, **dangling**, dan benar-benar hilang.
2. Menggunakan `git reflog` untuk menemukan commit/branch state sebelumnya.
3. Memulihkan commit setelah `reset --hard`, rebase gagal, branch terhapus, atau detached HEAD.
4. Menggunakan `git fsck` untuk menemukan dangling object.
5. Memahami kapan stash masih bisa dipulihkan dan kapan sudah sulit.
6. Memilih operasi recovery yang aman: `branch`, `switch`, `reset`, `cherry-pick`, `restore`, atau `revert`.
7. Membuat prosedur disaster handling untuk repository kerja pribadi maupun tim.
8. Menghindari command yang memperburuk insiden.
9. Menjelaskan recovery dalam bahasa commit graph, bukan sekadar “coba command ini”.

---

## Prasyarat Mental Model

Bagian ini bergantung pada materi sebelumnya:

- Part 002 — repository, working tree, index, object database.
- Part 003 — commit graph, branch, `HEAD`, reachability.
- Part 009 — rebase membuat commit baru.
- Part 016 — `reset`, `revert`, `cherry-pick` sebagai operasi koreksi.

Kalau masih menganggap Git sebagai “folder yang disinkronkan ke remote”, recovery akan terasa mistis. Kalau sudah melihat Git sebagai object database + references, recovery menjadi masuk akal.

---

# 1. Prinsip Utama Recovery di Git

## 1.1 Git menyimpan object, branch hanya menunjuk object

Commit adalah object. Branch adalah reference/pointer ke commit.

Contoh:

```text
A---B---C  main
```

Artinya:

```text
refs/heads/main -> C
C.parent -> B
B.parent -> A
```

Kalau branch `main` dipindahkan ke `A` dengan `reset --hard A`:

```text
A  main
 \
  B---C  ?
```

Commit `B` dan `C` tidak langsung hilang. Mereka hanya tidak lagi reachable dari `main`.

Selama object `B` dan `C` masih ada di `.git/objects` atau packfile, kita bisa menyelamatkannya dengan membuat reference baru:

```bash
git branch recovered C
```

Hasil:

```text
A  main
 \
  B---C  recovered
```

Inilah inti recovery Git.

---

## 1.2 Banyak kasus “hilang” berarti “tidak ada nama yang menunjuk”

Git object bisa ada tanpa branch/tag yang menunjuk ke sana.

Contoh umum:

- Commit dibuat di detached HEAD, lalu kamu pindah branch.
- Branch feature dihapus.
- Rebase membuat commit lama tidak lagi dipakai.
- `reset --hard` memindahkan branch mundur.
- `commit --amend` mengganti commit lama dengan commit baru.

Dalam semua kasus itu, commit lama sering masih ada.

Yang berubah adalah reference.

---

## 1.3 Recovery harus dimulai dengan menghentikan kerusakan

Saat sadar melakukan kesalahan Git, jangan langsung menjalankan banyak command random.

Urutan aman:

```text
1. Stop.
2. Jangan jalankan gc/prune/cleanup.
3. Jangan force push lagi.
4. Jangan menjalankan reset tambahan tanpa tahu target.
5. Catat state saat ini.
6. Inspect dengan read-only command.
7. Buat rescue branch sebelum eksperimen.
8. Baru lakukan pemulihan.
```

Read-only command yang relatif aman:

```bash
git status
git log --oneline --graph --decorate --all
git reflog
git reflog show HEAD
git reflog show <branch>
git fsck --no-reflogs --lost-found
git show <sha>
git diff
git branch -avv
```

Command yang harus hati-hati:

```bash
git reset --hard
git clean -fd
git rebase --abort / --continue / --skip
git push --force
git gc --prune=now
git reflog expire --expire=now --all
git prune
```

---

# 2. Reflog: Safety Net Lokal Git

## 2.1 Apa itu reflog?

Reflog adalah log lokal yang mencatat perubahan posisi reference, terutama `HEAD` dan branch lokal.

Kalau `main` sebelumnya menunjuk ke `C`, lalu kamu reset ke `A`, reflog masih mencatat bahwa `main` pernah berada di `C`.

Contoh:

```bash
git reflog
```

Output konseptual:

```text
4ab3c21 HEAD@{0}: reset: moving to HEAD~2
9f8e7d6 HEAD@{1}: commit: add payment validation
1a2b3c4 HEAD@{2}: commit: refactor order service
8d7c6b5 HEAD@{3}: checkout: moving from main to feature/payment
```

Interpretasi:

```text
HEAD@{0} = posisi HEAD sekarang
HEAD@{1} = posisi HEAD sebelumnya
HEAD@{2} = posisi HEAD sebelumnya lagi
```

Reflog bukan history project global. Reflog adalah safety journal lokal.

---

## 2.2 Reflog bukan remote history

Poin penting:

```text
Reflog bersifat lokal.
```

Artinya:

- Reflog di laptopmu tidak otomatis ada di laptop orang lain.
- Reflog tidak biasanya dikirim saat `push`.
- Remote hosting seperti GitHub/GitLab punya mekanisme internal sendiri, tetapi developer tidak boleh bergantung pada itu sebagai recovery utama.
- Kalau kamu clone ulang repository, reflog lama dari working copy sebelumnya tidak ikut.

Implikasi:

Kalau kamu melakukan destructive operation di lokal, reflog lokal sangat berguna. Kalau kamu sudah menghapus folder repository lokal lalu clone ulang, safety net itu hilang.

---

## 2.3 Melihat reflog HEAD vs branch

`git reflog` biasanya sama dengan:

```bash
git reflog show HEAD
```

Untuk branch tertentu:

```bash
git reflog show main
git reflog show feature/payment
```

Perbedaannya:

```text
HEAD reflog   = mencatat pergerakan HEAD: checkout, commit, reset, rebase, merge, dll.
branch reflog = mencatat perubahan tip branch tertentu.
```

Contoh branch reflog:

```bash
git reflog show feature/payment
```

Output:

```text
deadbee feature/payment@{0}: rebase finished: refs/heads/feature/payment onto a1b2c3d
cafe123 feature/payment@{1}: commit: add payment retry policy
babe456 feature/payment@{2}: branch: Created from main
```

Ini berguna saat rebase membuat commit lama “menghilang”.

---

## 2.4 Membaca reflog sebagai timeline pointer movement

Reflog bukan daftar commit secara konseptual. Reflog adalah daftar posisi reference dari waktu ke waktu.

Contoh:

```text
HEAD@{0}: reset: moving to HEAD~2
HEAD@{1}: commit: add validation
HEAD@{2}: commit: add repository layer
HEAD@{3}: checkout: moving from main to feature/x
```

Artinya:

- Sekarang HEAD berada setelah reset.
- Sebelum reset, HEAD menunjuk ke commit `add validation`.
- Sebelumnya lagi commit `add repository layer`.

Kalau reset menghapus dua commit dari branch, target recovery sering ada di `HEAD@{1}`.

---

# 3. Recovery Setelah `reset --hard`

## 3.1 Skenario

Misal history awal:

```text
A---B---C---D  feature/payment
```

Kamu tidak sengaja menjalankan:

```bash
git reset --hard HEAD~2
```

Sekarang:

```text
A---B  feature/payment
     \
      C---D  ?
```

Commit `C` dan `D` tidak lagi ada di branch, tetapi kemungkinan masih ada di object database.

---

## 3.2 Cari commit lama di reflog

```bash
git reflog
```

Output:

```text
b222222 HEAD@{0}: reset: moving to HEAD~2
d444444 HEAD@{1}: commit: add payment retry policy
c333333 HEAD@{2}: commit: add payment adapter
b222222 HEAD@{3}: commit: add payment DTO
```

Commit yang ingin diselamatkan adalah `d444444`.

---

## 3.3 Recovery dengan branch baru

Cara paling aman:

```bash
git branch rescue/payment-before-reset d444444
```

Lihat graph:

```bash
git log --oneline --graph --decorate --all
```

Sekarang:

```text
A---B  feature/payment
     \
      C---D  rescue/payment-before-reset
```

Setelah ada branch rescue, kamu bisa memutuskan:

### Opsi A — kembalikan branch feature ke commit lama

Kalau reset memang salah dan ingin kembali sepenuhnya:

```bash
git switch feature/payment
git reset --hard rescue/payment-before-reset
```

### Opsi B — cherry-pick commit yang diperlukan

Kalau hanya ingin mengambil sebagian:

```bash
git switch feature/payment
git cherry-pick c333333
git cherry-pick d444444
```

### Opsi C — bandingkan dulu

```bash
git diff feature/payment..rescue/payment-before-reset
```

---

## 3.4 Kenapa branch rescue lebih aman daripada langsung reset?

Karena branch rescue memberi nama permanen sementara pada commit yang ditemukan.

Tanpa branch rescue, kamu masih bergantung pada reflog entry.

Dengan branch rescue:

```text
Commit lama kembali reachable.
```

Itu mengurangi risiko commit dihapus oleh cleanup/garbage collection di masa depan.

---

# 4. Recovery Branch yang Terhapus

## 4.1 Skenario

Kamu menghapus branch:

```bash
git branch -D feature/reporting
```

Git mungkin mencetak:

```text
Deleted branch feature/reporting (was a1b2c3d).
```

Kalau masih ada SHA di terminal, recovery sangat mudah:

```bash
git branch feature/reporting a1b2c3d
```

Kalau SHA sudah tidak terlihat, gunakan reflog.

---

## 4.2 Cari dari HEAD reflog

Kalau kamu pernah checkout branch itu:

```bash
git reflog
```

Cari entry:

```text
checkout: moving from feature/reporting to main
commit: add reporting aggregate endpoint
```

Lalu buat ulang branch:

```bash
git branch feature/reporting <sha-terakhir-branch>
```

---

## 4.3 Cari dari branch reflog

Kadang branch reflog masih bisa ada sebelum benar-benar hilang tergantung kondisi repository. Coba:

```bash
git reflog show feature/reporting
```

Kalau masih ada, ambil SHA terakhir dan buat ulang branch.

---

## 4.4 Kalau branch pernah di-push ke remote

Cek remote-tracking branch:

```bash
git branch -r
```

Jika masih ada:

```bash
git switch -c feature/reporting origin/feature/reporting
```

Atau:

```bash
git branch feature/reporting origin/feature/reporting
```

Jika remote branch juga dihapus tetapi belum dipruning secara lokal, remote-tracking branch mungkin masih ada di lokal.

Jangan buru-buru menjalankan:

```bash
git fetch --prune
```

karena itu bisa menghapus remote-tracking ref yang justru sedang kamu butuhkan untuk recovery.

---

# 5. Recovery Setelah Rebase Gagal atau Salah

## 5.1 Rebase membuat commit baru

Misal sebelum rebase:

```text
A---B---C  main
     \
      D---E  feature
```

Setelah:

```bash
git switch feature
git rebase main
```

Graph menjadi:

```text
A---B---C  main
         \
          D'---E'  feature
```

Commit `D` dan `E` lama tidak dipakai lagi oleh branch `feature`, tetapi biasanya masih ada di reflog.

---

## 5.2 Rebase menghasilkan hasil salah

Misal setelah rebase, test gagal dan kamu sadar conflict resolution salah.

Langkah aman:

```bash
git reflog show feature
```

Cari entry sebelum rebase:

```text
feature@{0}: rebase finished: refs/heads/feature onto ccccccc
feature@{1}: commit: add validation rule
feature@{2}: commit: add payment service
```

Biasanya `feature@{1}` atau entry sebelum `rebase started/finished` adalah posisi lama.

Buat rescue branch:

```bash
git branch rescue/feature-before-bad-rebase feature@{1}
```

Kemudian pilih:

### Opsi A — reset feature kembali ke sebelum rebase

```bash
git switch feature
git reset --hard rescue/feature-before-bad-rebase
```

### Opsi B — rebase ulang dari rescue branch

```bash
git switch -c feature-rebase-redo rescue/feature-before-bad-rebase
git rebase main
```

Ini lebih aman kalau branch sudah sempat dipakai untuk eksperimen setelah rebase.

---

## 5.3 Rebase sedang berlangsung dan conflict kacau

Cek status:

```bash
git status
```

Jika Git mengatakan sedang dalam rebase:

```text
You are currently rebasing branch 'feature' on '...'
```

Pilihan:

```bash
git rebase --continue
```

jika conflict sudah diselesaikan.

```bash
git rebase --abort
```

jika ingin kembali ke state sebelum rebase.

```bash
git rebase --skip
```

jika ingin melewati commit yang sedang direplay.

Hati-hati dengan `--skip`. Untuk Java/backend, melewati commit bisa menghapus perubahan penting seperti migration, DTO, validation, atau test. Gunakan hanya jika benar-benar tahu commit itu sudah tidak relevan.

---

# 6. Recovery dari Detached HEAD

## 6.1 Skenario

Kamu checkout commit lama:

```bash
git switch --detach a1b2c3d
```

Lalu membuat commit:

```bash
# edit files
git add .
git commit -m "experiment with cache invalidation"
```

Graph:

```text
A---B---C  main
     \
      X  HEAD detached
```

Kalau kamu pindah branch:

```bash
git switch main
```

commit `X` tidak punya branch. Git biasanya memberi warning.

---

## 6.2 Recovery langsung

Kalau masih ingat SHA commit `X`:

```bash
git branch experiment/cache-invalidation X
```

Kalau tidak:

```bash
git reflog
```

Cari commit:

```text
x999999 HEAD@{1}: commit: experiment with cache invalidation
```

Buat branch:

```bash
git branch experiment/cache-invalidation x999999
```

---

## 6.3 Prinsip detached HEAD

Detached HEAD tidak berbahaya jika kamu tahu apa yang dilakukan.

Yang berbahaya adalah membuat commit tanpa membuat branch, lalu lupa SHA-nya.

Rule praktis:

```text
Kalau eksperimen mulai bernilai, segera beri nama dengan branch.
```

```bash
git switch -c experiment/cache-invalidation
```

---

# 7. Recovery Stash

## 7.1 Stash juga object Git

`git stash` menyimpan state working tree/index sebagai commit khusus yang dirujuk oleh `refs/stash`.

Lihat stash:

```bash
git stash list
```

Contoh:

```text
stash@{0}: WIP on feature/payment: a1b2c3d add payment DTO
stash@{1}: WIP on main: b2c3d4e release 1.8.0
```

Lihat isi stash:

```bash
git stash show stash@{0}
git stash show -p stash@{0}
```

Apply tanpa menghapus:

```bash
git stash apply stash@{0}
```

Apply lalu drop jika sukses:

```bash
git stash pop stash@{0}
```

Untuk recovery, `apply` lebih aman daripada `pop`.

---

## 7.2 Stash pop conflict

Jika `git stash pop` menghasilkan conflict, stash biasanya tidak langsung dihapus. Selesaikan conflict, lalu drop manual jika sudah yakin.

Cek:

```bash
git stash list
```

Kalau masih ada, jangan drop sampai perubahan sudah aman.

---

## 7.3 Stash ter-drop atau clear

Skenario:

```bash
git stash drop stash@{0}
```

atau:

```bash
git stash clear
```

Masih mungkin dipulihkan jika object belum dipruning.

Cari dangling commit:

```bash
git fsck --no-reflogs --unreachable --lost-found
```

Atau:

```bash
git fsck --no-reflogs | grep commit
```

Lalu inspect kandidat:

```bash
git show <sha>
```

Jika menemukan stash commit yang benar:

```bash
git stash store -m "recovered stash" <sha>
```

atau buat branch dari stash:

```bash
git branch recovered/stash <sha>
```

Kemudian inspect dan apply sesuai kebutuhan.

---

## 7.4 Pencegahan stash loss

Untuk pekerjaan penting, lebih baik commit di branch WIP daripada stash lama.

Contoh:

```bash
git switch -c wip/payment-refactor
git add .
git commit -m "WIP: payment refactor checkpoint"
```

Commit WIP jauh lebih mudah dicari, dipush, direview, dan dipulihkan daripada stash anonim.

Gunakan stash untuk context switching cepat, bukan sebagai storage jangka panjang.

---

# 8. `git fsck`: Menemukan Dangling Object

## 8.1 Apa itu dangling object?

Dangling object adalah object yang ada di database Git tetapi tidak reachable dari reference aktif.

Jenis umum:

```text
dangling commit
dangling blob
dangling tree
```

Dangling commit bisa berasal dari:

- commit sebelum amend,
- commit sebelum rebase,
- branch yang dihapus,
- detached HEAD,
- stash drop,
- reset hard.

---

## 8.2 Menjalankan fsck

```bash
git fsck --full
```

Untuk recovery lost object:

```bash
git fsck --lost-found
```

Untuk mencari object yang tidak reachable tanpa mempertimbangkan reflog:

```bash
git fsck --no-reflogs --unreachable
```

Output contoh:

```text
unreachable commit a1b2c3d4e5f6...
dangling commit deadbeef1234...
dangling blob cafe1234abcd...
```

Inspect commit:

```bash
git show deadbeef1234
```

Inspect blob:

```bash
git show cafe1234abcd
```

Jika commit benar:

```bash
git branch recovered/from-fsck deadbeef1234
```

---

## 8.3 Dangling blob recovery

Kadang yang tersisa bukan commit, tetapi blob. Ini bisa terjadi jika file pernah masuk index/object database tetapi belum menjadi commit.

Inspect:

```bash
git show <blob-sha>
```

Simpan ke file:

```bash
git show <blob-sha> > recovered-file.txt
```

Untuk file Java:

```bash
git show <blob-sha> > RecoveredPaymentService.java
```

Keterbatasan:

- Blob tidak tahu path aslinya secara langsung.
- Blob tidak tahu commit message.
- Blob tidak tahu konteks tree.

Jadi recovery blob lebih manual daripada recovery commit.

---

# 9. Kapan Object Benar-benar Hilang?

## 9.1 Git punya garbage collection

Object yang tidak reachable tidak dijamin hidup selamanya.

Git bisa membersihkan unreachable object melalui garbage collection/prune, terutama setelah reflog expire.

Command berbahaya saat recovery:

```bash
git gc --prune=now
git prune
git reflog expire --expire=now --all
git gc --aggressive --prune=now
```

Jangan jalankan command ini saat sedang mencoba recovery.

---

## 9.2 Reflog expiration

Reflog punya masa simpan yang dikonfigurasi. Default umum Git menyimpan reflog entry untuk periode tertentu, tetapi detail bisa berbeda tergantung konfigurasi.

Cek konfigurasi:

```bash
git config --get gc.reflogExpire
git config --get gc.reflogExpireUnreachable
git config --get gc.pruneExpire
```

Lihat semua konfigurasi terkait:

```bash
git config --list | grep -E 'gc\.|reflog'
```

Mental model:

```text
Semakin lama commit tidak reachable dan semakin banyak cleanup, semakin kecil peluang recovery.
```

---

## 9.3 Faktor yang memperbesar peluang recovery

Recovery lebih mungkin jika:

- Insiden baru terjadi.
- Repository lokal belum dihapus.
- Belum menjalankan aggressive GC/prune.
- Commit pernah dibuat, bukan hanya file belum pernah di-add.
- Perubahan pernah masuk index/stash/commit.
- SHA masih ada di terminal, CI log, PR, atau chat.
- Commit pernah dipush ke remote atau fork.

Recovery lebih sulit jika:

- Perubahan hanya ada di working tree dan belum pernah di-add/commit/stash.
- File dihapus oleh `git clean -fd` dan tidak pernah tracked.
- Repository folder dihapus total.
- `gc --prune=now` sudah dijalankan.
- Clone baru tidak punya reflog/object lama.

---

# 10. Recovery Working Tree dan Index

## 10.1 File modified belum commit

Jika file tracked berubah tetapi belum commit:

```bash
git status
git diff
```

Untuk membuang perubahan working tree:

```bash
git restore path/to/File.java
```

Untuk mengembalikan dari commit tertentu:

```bash
git restore --source=<commit> path/to/File.java
```

Untuk restore ke index dan working tree:

```bash
git restore --source=<commit> --staged --worktree path/to/File.java
```

---

## 10.2 File staged salah

Jika sudah `git add` tetapi belum commit:

```bash
git restore --staged path/to/File.java
```

Ini mengeluarkan file dari index tetapi tidak menghapus perubahan working tree.

Alternatif lama:

```bash
git reset HEAD path/to/File.java
```

---

## 10.3 File terhapus dari working tree

Jika file tracked terhapus:

```bash
git status
```

Restore:

```bash
git restore path/to/File.java
```

Jika ingin restore dari commit tertentu:

```bash
git restore --source=main path/to/File.java
```

---

## 10.4 File untracked terhapus

Jika file untracked dihapus oleh:

```bash
git clean -fd
```

dan file itu belum pernah di-add, commit, atau stash, Git biasanya tidak bisa memulihkannya.

Untuk mencegah:

```bash
git clean -fdn
```

`-n` berarti dry-run.

Gunakan sebelum menjalankan clean sungguhan:

```bash
git clean -fdn
# inspect output
git clean -fd
```

Untuk Java project, hati-hati karena `git clean -fdx` bisa menghapus file ignored seperti:

- `target/`,
- `build/`,
- `.gradle/`,
- generated files,
- local env files,
- IDE metadata,
- test output.

Kadang itu aman, kadang merusak local setup.

---

# 11. Recovery Setelah Force Push Salah

## 11.1 Skenario

Kamu melakukan:

```bash
git push --force origin feature/payment
```

Ternyata remote branch yang dipakai orang lain tertimpa.

Pertama: stop. Jangan force push lagi.

Cari commit remote sebelumnya dari:

1. Reflog lokal branch kamu.
2. Reflog lokal rekan kerja yang punya copy branch lama.
3. Remote-tracking branch di komputer lain.
4. CI log yang mencatat SHA commit.
5. PR/MR UI yang mungkin masih menyimpan commit SHA.
6. Tag/release reference jika pernah ditag.

---

## 11.2 Recovery remote branch

Misal SHA lama ditemukan:

```bash
git branch rescue/remote-before-force <old-sha>
git push origin rescue/remote-before-force
```

Jangan langsung menimpa remote branch lagi sebelum tim sepakat.

Setelah diskusi:

### Opsi A — restore branch remote ke SHA lama

```bash
git push --force-with-lease origin rescue/remote-before-force:feature/payment
```

### Opsi B — buka PR dari rescue branch

Lebih aman untuk tim:

```bash
git push origin rescue/remote-before-force
```

Lalu buat PR untuk mengembalikan perubahan yang hilang.

---

## 11.3 Kenapa `--force-with-lease` lebih aman?

`--force-with-lease` menolak push jika remote branch sudah berubah dari versi yang kamu kira. Ini mencegah kamu menimpa kerja orang lain yang masuk setelah fetch terakhir.

Namun tetap bukan jaminan absolut. Ia hanya guardrail terhadap stale knowledge.

Workflow aman:

```bash
git fetch origin
git log --oneline --graph --decorate --all
git push --force-with-lease
```

---

# 12. Recovery Merge yang Salah

## 12.1 Merge belum commit

Kalau sedang merge dan conflict kacau:

```bash
git status
```

Abort:

```bash
git merge --abort
```

Ini mencoba kembali ke state sebelum merge.

---

## 12.2 Merge sudah commit tetapi belum push

Jika merge commit salah dan belum dipush:

```bash
git reset --hard HEAD~1
```

Aman jika history masih private.

Buat rescue dulu jika ragu:

```bash
git branch rescue/bad-merge HEAD
```

Lalu reset:

```bash
git reset --hard HEAD~1
```

---

## 12.3 Merge sudah push

Jika merge commit sudah ada di public branch, jangan reset public branch sembarangan.

Gunakan revert merge:

```bash
git revert -m 1 <merge-commit-sha>
```

`-m 1` berarti mainline parent 1 dipakai sebagai basis. Ini penting karena merge commit punya lebih dari satu parent.

Hati-hati: revert merge punya konsekuensi lanjutan jika nanti branch yang sama ingin dimerge ulang. Git akan menganggap sebagian perubahan sudah pernah diintegrasikan/reverted. Strategi lanjutan harus direncanakan.

---

# 13. Recovery Revert yang Salah

## 13.1 Revert membuat commit baru

Kalau kamu salah revert:

```bash
git revert <commit>
```

Git membuat commit baru yang membalik patch.

Jika revert belum push dan history private, bisa reset.

Jika sudah public, revert commit revert:

```bash
git revert <revert-commit-sha>
```

Ini menghasilkan “revert of revert”, yaitu mengembalikan perubahan asli.

Mental model:

```text
revert(A) membalik A
revert(revert(A)) mengembalikan efek A
```

---

# 14. Recovery Cherry-Pick yang Salah

## 14.1 Cherry-pick sedang conflict

Jika cherry-pick conflict dan kamu ingin batal:

```bash
git cherry-pick --abort
```

Jika selesai conflict:

```bash
git add .
git cherry-pick --continue
```

Jika commit ternyata tidak perlu:

```bash
git cherry-pick --skip
```

---

## 14.2 Cherry-pick sudah commit

Jika belum push:

```bash
git reset --hard HEAD~1
```

Jika sudah push:

```bash
git revert <cherry-picked-commit-sha>
```

---

# 15. Disaster Handling Playbook

## 15.1 Template playbook saat panik

Gunakan ini ketika ada insiden Git:

```text
1. Stop menjalankan command destructive.
2. Catat command terakhir yang dijalankan.
3. Jalankan git status.
4. Jalankan git log --oneline --graph --decorate --all -n 50.
5. Jalankan git reflog --date=iso.
6. Jika branch tertentu terdampak, jalankan git reflog show <branch> --date=iso.
7. Identifikasi commit terakhir yang benar.
8. Buat rescue branch dari kandidat commit.
9. Verifikasi dengan git show / git diff / test.
10. Baru pilih recovery action: reset/cherry-pick/revert/branch restore.
11. Jika sudah menyentuh remote/shared branch, komunikasikan ke tim sebelum force push.
12. Setelah recovery, dokumentasikan root cause dan preventive guardrail.
```

---

## 15.2 Command pack untuk observability

```bash
git status

git branch -avv

git log --oneline --graph --decorate --all -n 80

git reflog --date=iso

git reflog show HEAD --date=iso

git reflog show $(git branch --show-current) --date=iso
```

Jika butuh dangling object:

```bash
git fsck --full

git fsck --no-reflogs --unreachable
```

---

## 15.3 Rescue branch naming

Gunakan nama yang jelas:

```bash
git branch rescue/payment-before-reset-2026-06-17 <sha>
git branch rescue/main-before-force-push-2026-06-17 <sha>
git branch rescue/stash-recovered-2026-06-17 <sha>
git branch rescue/rebase-before-conflict-fix <sha>
```

Kenapa perlu nama panjang?

Karena saat recovery, cognitive load tinggi. Nama branch yang eksplisit mengurangi risiko salah branch.

---

# 16. Decision Matrix Recovery

| Situasi | History private? | Operasi aman utama | Catatan |
|---|---:|---|---|
| Salah `reset --hard` | Ya | `reflog` → rescue branch → `reset` | Buat rescue branch dulu |
| Branch lokal terhapus | Ya | `reflog` / SHA terminal → `git branch` | Jangan prune dulu |
| Rebase salah | Ya | `reflog` → reset ke pre-rebase | Rebase membuat commit baru |
| Merge conflict kacau | Ya | `git merge --abort` | Jika merge belum commit |
| Rebase conflict kacau | Ya | `git rebase --abort` | Jika masih proses rebase |
| Merge commit salah belum push | Ya | rescue branch → `reset --hard HEAD~1` | Aman jika belum shared |
| Merge commit salah sudah push | Tidak | `git revert -m 1` | Jangan rewrite public history sembarangan |
| Commit buruk sudah push | Tidak | `git revert` | Audit-friendly |
| Salah cherry-pick sudah push | Tidak | `git revert` | Membalik patch |
| Force push salah | Tidak | cari SHA lama → rescue branch → koordinasi | Jangan force push kedua tanpa analisis |
| Stash drop | Lokal | `fsck` → `stash store`/branch | Peluang turun setelah GC |
| File untracked di-clean | Lokal | Git biasanya tidak bisa | Cari backup IDE/OS |

---

# 17. Recovery untuk Java Engineer: Kasus Nyata

## 17.1 Migration hilang setelah rebase

Skenario:

- Branch feature berisi migration `V20260617__add_case_escalation_table.sql`.
- Rebase conflict diselesaikan salah.
- File migration hilang.

Langkah:

```bash
git reflog show feature/case-escalation
```

Buat rescue:

```bash
git branch rescue/case-escalation-before-rebase feature/case-escalation@{1}
```

Cari file:

```bash
git log --oneline -- rescue/case-escalation-before-rebase -- db/migration
```

Restore file dari rescue:

```bash
git restore --source=rescue/case-escalation-before-rebase -- db/migration/V20260617__add_case_escalation_table.sql
```

Verifikasi:

```bash
git diff
git status
```

Run test/migration validation:

```bash
./mvnw test
./mvnw flyway:validate
```

---

## 17.2 Dependency upgrade salah di-release branch

Skenario:

- `release/2.4.x` tidak sengaja menerima dependency upgrade besar.
- Commit sudah push.

Jangan reset shared release branch sembarangan.

Gunakan:

```bash
git revert <dependency-upgrade-commit>
```

Lalu validasi:

```bash
./mvnw -U test
./mvnw dependency:tree
```

Kalau dependency upgrade terdiri dari beberapa commit:

```bash
git revert <sha1> <sha2> <sha3>
```

Atau revert range dengan hati-hati:

```bash
git revert <oldest-sha>^..<newest-sha>
```

---

## 17.3 Generated client hilang

Skenario:

- OpenAPI generated client seharusnya tidak dikomit.
- Tetapi branch lama berisi generated file yang ternyata dibutuhkan untuk membandingkan contract.

Cari di history:

```bash
git log --all -- path/to/generated/Client.java
```

Lihat versi lama:

```bash
git show <sha>:path/to/generated/Client.java
```

Restore sementara:

```bash
git show <sha>:path/to/generated/Client.java > /tmp/Client.java
```

Gunakan untuk compare, bukan otomatis recommit.

---

## 17.4 Commit incident fix hilang setelah amend

Skenario:

```bash
git commit --amend
```

Ternyata amend menghapus perubahan penting.

Cari commit sebelum amend:

```bash
git reflog
```

Output:

```text
newsha HEAD@{0}: commit (amend): fix incident timeout
oldsha HEAD@{1}: commit: fix incident timeout
```

Bandingkan:

```bash
git diff oldsha newsha
```

Ambil perubahan lama jika perlu:

```bash
git branch rescue/before-amend oldsha
```

Atau restore file tertentu:

```bash
git restore --source=oldsha -- src/main/java/com/acme/TimeoutPolicy.java
```

---

# 18. Anti-Pattern Recovery

## 18.1 Menjalankan command random dari internet

Masalah:

```text
Git recovery sangat state-dependent.
Command yang benar pada satu graph bisa destruktif pada graph lain.
```

Contoh:

```bash
git reset --hard origin/main
```

Bisa benar jika ingin membuang semua local work.
Bisa bencana jika local work justru yang ingin diselamatkan.

---

## 18.2 Force push untuk “memperbaiki” tanpa memahami remote state

Force push dapat memindahkan remote branch dan membuat commit orang lain tidak lagi reachable dari remote reference.

Selalu lakukan:

```bash
git fetch origin
git log --oneline --graph --decorate --all
```

Sebelum force push.

Gunakan:

```bash
git push --force-with-lease
```

bukan:

```bash
git push --force
```

---

## 18.3 Menghapus rescue branch terlalu cepat

Jangan hapus rescue branch sebelum:

- recovery selesai,
- test lewat,
- PR/branch remote aman,
- tim setuju,
- root cause dipahami.

Rescue branch murah. Kehilangan commit mahal.

---

## 18.4 Mengandalkan stash sebagai backup permanen

Stash bukan sistem arsip.

Lebih baik:

```bash
git switch -c wip/<topic>
git add .
git commit -m "WIP: checkpoint before refactor"
git push origin wip/<topic>
```

Untuk kerja penting, commit WIP jauh lebih aman daripada stash.

---

## 18.5 Menghapus repository lokal saat recovery

Kadang engineer panik lalu:

```text
rm -rf repo
clone ulang
```

Ini bisa menghapus reflog dan object lokal yang dibutuhkan untuk recovery.

Sebelum menghapus repository, minimal backup folder `.git` atau copy repository.

```bash
cp -a my-repo my-repo-backup-before-recovery
```

---

# 19. Latihan Praktis

## Latihan 1 — Recover setelah reset hard

```bash
mkdir git-recovery-lab
cd git-recovery-lab
git init

echo "A" > app.txt
git add app.txt
git commit -m "A"

echo "B" >> app.txt
git add app.txt
git commit -m "B"

echo "C" >> app.txt
git add app.txt
git commit -m "C"

git log --oneline

git reset --hard HEAD~2

git log --oneline

git reflog
```

Temukan commit `C`, lalu recovery:

```bash
git branch rescue/before-reset <sha-C>
git log --oneline --graph --decorate --all
```

Kembalikan branch:

```bash
git reset --hard rescue/before-reset
```

---

## Latihan 2 — Recover branch terhapus

```bash
git switch -c feature/demo

echo "feature" > feature.txt
git add feature.txt
git commit -m "add feature file"

FEATURE_SHA=$(git rev-parse HEAD)

git switch main 2>/dev/null || git switch master

git branch -D feature/demo
```

Recovery:

```bash
git branch feature/demo $FEATURE_SHA
git log --oneline --graph --decorate --all
```

Ulangi tanpa menyimpan `FEATURE_SHA`, gunakan reflog.

---

## Latihan 3 — Recover detached HEAD commit

```bash
git log --oneline

git switch --detach HEAD~1

echo "detached experiment" > detached.txt
git add detached.txt
git commit -m "detached experiment"

git switch main 2>/dev/null || git switch master

git reflog
```

Recovery:

```bash
git branch experiment/detached <sha>
```

---

## Latihan 4 — Stash recovery basic

```bash
echo "stash content" > stash-demo.txt
git add stash-demo.txt
git stash push -m "demo stash"

git stash list
git stash show -p stash@{0}
git stash apply stash@{0}
```

Ulangi dengan `git stash drop`, lalu coba cari dengan `git fsck`.

---

## Latihan 5 — Rebase recovery

Buat branch dengan beberapa commit, rebase ke branch lain, lalu gunakan reflog untuk kembali ke pre-rebase state.

Checklist:

```bash
git reflog show <branch>
git branch rescue/before-rebase <branch>@{n}
git reset --hard rescue/before-rebase
```

---

# 20. Checklist Operasional Recovery

## Sebelum recovery

```text
[ ] Saya tahu branch aktif saat ini.
[ ] Saya sudah menjalankan git status.
[ ] Saya sudah melihat git log --graph --all.
[ ] Saya sudah melihat git reflog.
[ ] Saya belum menjalankan gc/prune/clean tambahan.
[ ] Saya tahu apakah branch ini private atau sudah public.
[ ] Saya sudah membuat rescue branch dari kandidat commit penting.
```

## Saat recovery

```text
[ ] Saya menggunakan read-only command untuk investigasi.
[ ] Saya membuat branch rescue sebelum reset/cherry-pick lanjutan.
[ ] Saya memverifikasi commit dengan git show.
[ ] Saya membandingkan state dengan git diff.
[ ] Saya tidak force push tanpa fetch dan koordinasi.
```

## Setelah recovery

```text
[ ] History sudah sesuai ekspektasi.
[ ] Working tree bersih atau perubahan tersisa disengaja.
[ ] Test relevan sudah berjalan.
[ ] CI hijau jika menyentuh remote branch.
[ ] Rescue branch disimpan sampai yakin aman.
[ ] Root cause dicatat.
[ ] Guardrail diperbaiki jika perlu.
```

---

# 21. Guardrail Pencegahan Disaster

## 21.1 Alias aman

Tambahkan alias observability:

```bash
git config --global alias.lg "log --oneline --graph --decorate --all"
git config --global alias.st "status --short --branch"
git config --global alias.rh "reflog --date=iso"
```

Gunakan:

```bash
git lg
git st
git rh
```

---

## 21.2 Biasakan dry-run

Untuk clean:

```bash
git clean -fdn
```

Untuk fetch prune, pahami dulu:

```bash
git remote prune origin --dry-run
```

---

## 21.3 Gunakan branch checkpoint

Sebelum operasi besar:

```bash
git branch checkpoint/before-risky-rebase
```

Sebelum reset besar:

```bash
git branch checkpoint/before-reset
```

Sebelum force push:

```bash
git branch checkpoint/before-force-push
```

Branch checkpoint murah dan mengurangi risiko.

---

## 21.4 Push WIP jika aman secara policy

Untuk pekerjaan penting:

```bash
git switch -c wip/<topic>
git add .
git commit -m "WIP: checkpoint"
git push origin wip/<topic>
```

Catatan:

- Jangan push secret.
- Jangan push branch WIP jika policy tim melarang.
- Jangan jadikan WIP sebagai final history tanpa cleanup.

---

# 22. Mental Model Akhir

Git recovery menjadi mudah jika kamu mengingat empat pertanyaan:

```text
1. Object mana yang ingin saya selamatkan?
2. Reference mana yang dulu menunjuk ke object itu?
3. Apakah reflog atau fsck masih bisa menemukan object itu?
4. Apakah saya perlu membuat reference baru sebelum melakukan operasi lain?
```

Dan satu prinsip besar:

```text
Do not destroy more state while trying to recover state.
```

Dalam Git, “tenang” bukan sikap emosional saja. Tenang adalah hasil dari mental model yang benar.

---

# 23. Ringkasan Command Penting

## Reflog

```bash
git reflog
git reflog --date=iso
git reflog show HEAD
git reflog show <branch>
git log -g --oneline
```

## Rescue branch

```bash
git branch rescue/<name> <sha>
git switch -c rescue/<name> <sha>
```

## Recovery reset hard

```bash
git reflog
git branch rescue/before-reset <sha>
git reset --hard rescue/before-reset
```

## Recovery branch deleted

```bash
git reflog
git branch <branch-name> <sha>
```

## Recovery detached HEAD

```bash
git reflog
git branch recovered/detached <sha>
```

## Recovery rebase

```bash
git reflog show <branch>
git branch rescue/before-rebase <sha>
git reset --hard rescue/before-rebase
```

## Recovery stash

```bash
git stash list
git stash show -p stash@{0}
git fsck --no-reflogs --unreachable
git show <sha>
git stash store -m "recovered stash" <sha>
```

## Dangling object

```bash
git fsck --full
git fsck --lost-found
git fsck --no-reflogs --unreachable
git show <sha>
git branch recovered/from-fsck <sha>
```

## Abort ongoing operations

```bash
git merge --abort
git rebase --abort
git cherry-pick --abort
git revert --abort
```

---

# 24. Kesalahan yang Harus Dihindari

```text
[ ] Menjalankan git gc --prune=now saat recovery.
[ ] Menjalankan git clean -fd tanpa dry-run.
[ ] Force push kedua kali saat belum memahami force push pertama.
[ ] Menghapus repo lokal sebelum mengambil reflog/object yang dibutuhkan.
[ ] Menggunakan reset pada public branch tanpa koordinasi.
[ ] Menghapus rescue branch terlalu cepat.
[ ] Menganggap stash sebagai backup permanen.
[ ] Menggunakan --skip saat rebase tanpa memahami commit yang dilewati.
[ ] Menganggap conflict selesai hanya karena marker hilang.
```

---

# 25. Hubungan dengan Part Berikutnya

Part ini menutup kelompok besar operasi koreksi dan recovery.

Berikutnya, kita masuk ke **context switching**:

```text
Part 018 — Stash, Worktree, dan Context Switching
```

Part 017 sudah memperkenalkan stash sebagai recovery object. Part 018 akan membahas stash dan `git worktree` sebagai alat kerja harian yang lebih luas: berpindah konteks, menangani hotfix mendadak, review branch lain, dan menjaga working tree tetap sehat.

---

# 26. Referensi Utama

Referensi yang relevan untuk pendalaman:

- Dokumentasi resmi `git reflog`.
- Dokumentasi resmi `git fsck`.
- Dokumentasi resmi `git stash`.
- Dokumentasi resmi `git restore`.
- Dokumentasi resmi `git reset`.
- Pro Git Book — Git Tools, Stashing and Cleaning.
- Pro Git Book — Git Internals.

Gunakan dokumentasi resmi sebagai sumber utama saat ragu, karena banyak artikel recovery di internet benar hanya untuk state tertentu, bukan universal.

---

## Penutup

Kemampuan recovery adalah pembeda besar antara pengguna Git biasa dan engineer yang benar-benar memahami Git.

Engineer biasa berpikir:

```text
Saya takut menjalankan command Git karena bisa hilang.
```

Engineer kuat berpikir:

```text
Saya tahu state sekarang, tahu reference mana yang berubah, tahu object mana yang ingin diselamatkan, dan tahu cara membuat rescue point sebelum melakukan operasi berisiko.
```

Itulah tujuan bagian ini.

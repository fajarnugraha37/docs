# learn-git-mastery-for-java-engineers-part-018.md

# Part 018 — Stash, Worktree, dan Context Switching

## Status Seri

```text
Series: Git Mastery for Java Engineers
Part: 018 / 032
Status: Belum selesai
Bagian terakhir: learn-git-mastery-for-java-engineers-part-032.md
```

## Tujuan Part Ini

Pada part sebelumnya kita membahas recovery: `reflog`, lost commit, dangling object, dan disaster handling. Sekarang kita masuk ke masalah yang sangat sering terjadi di kerja nyata:

> “Saya sedang mengerjakan sesuatu, tiba-tiba harus pindah konteks.”

Contoh nyata:

- sedang refactor service Java, tiba-tiba harus hotfix production;
- sedang mengerjakan feature branch, tiba-tiba diminta review branch orang lain;
- sedang investigasi bug di release lama, tapi working tree penuh perubahan lokal;
- sedang debugging test, tiba-tiba harus pull perubahan terbaru;
- sedang eksperimen dependency upgrade, tapi ingin balik sebentar ke branch stabil;
- sedang mengerjakan beberapa PR paralel dalam repository yang sama.

Banyak engineer menyelesaikan ini dengan cara ad-hoc:

```bash
git add .
git commit -m "wip"
git checkout main
git pull
```

atau:

```bash
git stash
git checkout other-branch
```

Kadang berhasil. Kadang menyebabkan:

- stash lupa dipop;
- perubahan hilang secara mental walaupun masih ada;
- conflict saat `stash pop`;
- commit `WIP` bocor ke remote;
- branch menjadi kotor;
- generated file ikut tersimpan;
- hotfix bercampur dengan pekerjaan feature;
- review branch orang lain merusak working tree sendiri;
- dependency cache/build output mengganggu diff.

Part ini akan membangun mental model yang lebih kuat:

> Git menyediakan beberapa mekanisme context switching. `stash` dan `worktree` menyelesaikan problem yang berbeda.

`stash` cocok untuk menyimpan perubahan sementara dalam repository yang sama.

`worktree` cocok untuk membuka lebih dari satu working directory yang terhubung ke repository yang sama.

Engineer senior tidak hanya tahu command-nya, tetapi tahu kapan salah satu lebih aman dari yang lain.

---

# 1. Problem Dasar: Git Hanya Punya Satu Working Tree Default

Repository Git normal biasanya memiliki satu working tree aktif.

```text
my-service/
  .git/
  src/
  pom.xml
  README.md
```

Di dalam working tree ini, Git melacak tiga state utama yang sudah kita bahas:

```text
HEAD          = snapshot terakhir yang sedang menjadi basis kerja
Index         = staging area
Working tree  = file aktual di disk
```

Ketika kamu mengubah file:

```text
HEAD:         src/UserService.java versi lama
Index:        src/UserService.java versi lama
Working tree: src/UserService.java versi baru
```

Masalah muncul ketika kamu ingin pindah branch.

Misalnya:

```bash
git switch release/1.8
```

Git harus mengganti isi working tree agar sesuai dengan branch target. Tetapi jika file yang sama sedang kamu ubah, Git harus menjawab:

```text
Apakah perubahan lokal ini boleh ditimpa?
```

Jika berisiko overwrite, Git akan menolak:

```text
error: Your local changes to the following files would be overwritten by checkout
```

Ini bukan Git menyulitkan kamu. Ini Git melindungi perubahan lokal yang belum aman.

---

# 2. Tiga Cara Umum Context Switching

Secara praktis ada tiga pendekatan:

| Pendekatan | Mekanisme | Cocok untuk |
|---|---|---|
| Commit sementara | Simpan perubahan sebagai commit WIP | Jika perubahan sudah cukup coherent dan ingin safety maksimum |
| Stash | Simpan perubahan lokal ke stack stash | Jika perubahan sementara dan belum layak commit |
| Worktree | Buka working directory paralel | Jika perlu bekerja di beberapa branch tanpa saling mengganggu |

Tidak ada yang selalu benar. Yang penting adalah memilih berdasarkan risiko.

---

# 3. Mental Model `stash`

`git stash` sering dipahami sebagai:

```text
menyembunyikan perubahan sementara
```

Itu benar secara praktis, tetapi kurang cukup.

Mental model yang lebih akurat:

> `stash` membuat object commit khusus yang menyimpan state working tree dan index, lalu mengembalikan working tree ke state bersih.

Jadi stash bukan clipboard biasa. Stash adalah object di Git database yang direferensikan oleh `refs/stash` dan punya reflog sendiri.

Saat menjalankan:

```bash
git stash push
```

Git menyimpan perubahan lokal ke stash entry, biasanya terlihat seperti:

```bash
git stash list
```

Output:

```text
stash@{0}: WIP on feature/payment: 8ab21c4 Add payment validation skeleton
```

Artinya:

```text
stash@{0}
  = entry stash terbaru
  = dibuat ketika branch aktif feature/payment
  = basisnya commit 8ab21c4
```

Penting:

> Stash memiliki basis commit. Semakin jauh branch saat apply dari basis awal stash, semakin tinggi risiko conflict.

---

# 4. Apa yang Disimpan oleh Stash?

Secara default:

```bash
git stash push
```

menyimpan:

- tracked files yang modified;
- staged changes;
- unstaged changes pada tracked files.

Secara default stash **tidak** menyimpan:

- untracked files;
- ignored files.

Contoh:

```text
modified:   src/main/java/com/acme/UserService.java
new file:   notes/debug-notes.md       # untracked
ignored:    target/classes/...         # ignored
```

Jika menjalankan:

```bash
git stash push
```

maka `UserService.java` tersimpan, tetapi `notes/debug-notes.md` tidak.

Untuk menyertakan untracked files:

```bash
git stash push -u
```

atau:

```bash
git stash push --include-untracked
```

Untuk menyertakan ignored files juga:

```bash
git stash push -a
```

atau:

```bash
git stash push --all
```

Gunakan `--all` dengan hati-hati, terutama di Java project, karena bisa memasukkan:

```text
target/
build/
.gradle/
.idea/
*.class
*.jar
```

Jika `.gitignore` benar, `--all` sering terlalu agresif.

---

# 5. `stash push` dengan Message yang Jelas

Anti-pattern umum:

```bash
git stash
```

Lalu beberapa hari kemudian:

```bash
git stash list
```

Output:

```text
stash@{0}: WIP on feature/order: 2fe891a Work in progress
stash@{1}: WIP on main: 89ac221 Work in progress
stash@{2}: WIP on bugfix/login: abdd122 Work in progress
```

Kamu tidak tahu mana yang penting.

Gunakan message:

```bash
git stash push -m "WIP order validation before hotfix switch"
```

Output:

```text
stash@{0}: On feature/order: WIP order validation before hotfix switch
```

Untuk Java engineer, message stash yang baik biasanya menyebut:

- konteks pekerjaan;
- alasan stash;
- status risiko;
- branch asal jika relevan.

Contoh:

```bash
git stash push -m "WIP refactor PaymentService before prod hotfix"
```

```bash
git stash push -u -m "Debug failing UserRepositoryTest with local notes"
```

```bash
git stash push -m "Partial migration V17 before syncing main"
```

---

# 6. Melihat Isi Stash

Jangan apply stash secara buta.

Lihat daftar:

```bash
git stash list
```

Lihat ringkasan file:

```bash
git stash show stash@{0}
```

Lihat patch lengkap:

```bash
git stash show -p stash@{0}
```

Ini penting sebelum apply, terutama jika stash lama.

Contoh workflow aman:

```bash
git stash list
git stash show --stat stash@{0}
git stash show -p stash@{0}
```

Pertanyaan sebelum apply:

```text
1. Stash ini dibuat dari branch apa?
2. Apakah branch sekarang masih dekat dengan basis stash?
3. Apakah file yang disentuh masih relevan?
4. Apakah ada migration/config/dependency yang bisa conflict secara semantic?
```

---

# 7. `stash apply` vs `stash pop`

Ada dua cara umum mengembalikan stash:

```bash
git stash apply stash@{0}
```

atau:

```bash
git stash pop stash@{0}
```

Perbedaannya:

| Command | Efek |
|---|---|
| `apply` | menerapkan stash, stash entry tetap ada |
| `pop` | menerapkan stash, lalu menghapus stash jika sukses |

Rule praktis:

> Gunakan `apply` jika stash penting, lama, besar, atau berisiko conflict. Gunakan `pop` hanya jika yakin.

Kenapa?

Jika `pop` berhasil, stash hilang dari list. Memang masih bisa sering direcover lewat reflog/objects, tetapi tidak perlu membuat hidup sulit.

Workflow aman:

```bash
git stash apply stash@{0}
# verifikasi
git status
git diff
# jika aman dan sudah tidak perlu
git stash drop stash@{0}
```

---

# 8. Conflict Saat `stash apply/pop`

Stash conflict terjadi ketika perubahan yang disimpan tidak bisa diterapkan bersih ke working tree saat ini.

Contoh:

```bash
git stash apply stash@{0}
```

Output:

```text
Auto-merging src/main/java/com/acme/UserService.java
CONFLICT (content): Merge conflict in src/main/java/com/acme/UserService.java
```

Ini mirip conflict merge/cherry-pick. Git mencoba menerapkan patch stash ke state sekarang.

Langkah aman:

```bash
git status
```

Buka file conflict:

```text
<<<<<<< Updated upstream
kode dari working tree sekarang
=======
kode dari stash
>>>>>>> Stashed changes
```

Resolusi:

1. pahami dua perubahan;
2. edit file menjadi state final;
3. jalankan test relevan;
4. stage file yang sudah resolved;
5. lanjutkan kerja biasa.

Untuk stash apply/pop tidak ada `--continue` seperti rebase. Setelah conflict diselesaikan, kamu cukup stage/commit sesuai kebutuhan.

Jika ingin batal setelah conflict stash, pilihan tergantung kondisi. Jika belum ada perubahan lain yang penting:

```bash
git reset --hard
```

Tapi hati-hati: ini menghapus semua perubahan working tree yang belum disimpan.

Alternatif lebih aman:

```bash
git diff > /tmp/stash-conflict.patch
```

lalu evaluasi manual.

---

# 9. Staged State dan `--index`

Stash dapat menyimpan staged dan unstaged changes. Tetapi saat apply, default-nya tidak selalu mengembalikan staging persis seperti semula.

Jika ingin mencoba mengembalikan index/staging state:

```bash
git stash apply --index stash@{0}
```

atau:

```bash
git stash pop --index stash@{0}
```

Contoh:

Sebelum stash:

```text
staged:
  src/main/java/com/acme/UserService.java
unstaged:
  src/test/java/com/acme/UserServiceTest.java
```

Jika kamu ingin state staged/unstaged dipulihkan, gunakan `--index`.

Namun ini juga dapat menyebabkan conflict pada index. Jika tidak butuh staging state lama, apply biasa lebih sederhana.

Rule praktis:

- gunakan stash biasa untuk context switching cepat;
- gunakan `--index` jika staging state punya makna penting, misalnya kamu sedang menyusun commit atomic dengan partial staging.

---

# 10. Partial Stash

Kadang kamu tidak ingin stash semua perubahan.

Misalnya working tree:

```text
modified: src/main/java/com/acme/PaymentService.java
modified: src/main/java/com/acme/UserService.java
modified: README.md
```

Kamu hanya ingin stash perubahan `PaymentService.java`.

Gunakan pathspec:

```bash
git stash push -m "WIP payment only" -- src/main/java/com/acme/PaymentService.java
```

Atau interactive patch mode:

```bash
git stash push -p -m "Partial payment refactor"
```

`-p` memungkinkan memilih hunk mana yang masuk stash.

Ini berguna ketika:

- sebagian perubahan sudah siap commit;
- sebagian lain masih eksperimen;
- kamu ingin pindah branch tanpa membawa semua perubahan;
- kamu sedang memisahkan perubahan unrelated.

Tetapi partial stash menambah kompleksitas mental. Jangan gunakan kalau belum bisa menjelaskan state saat ini.

---

# 11. Membuat Branch dari Stash

Jika stash ternyata berkembang menjadi pekerjaan serius, lebih baik jadikan branch.

Command:

```bash
git stash branch feature/recover-payment-refactor stash@{0}
```

Ini akan:

1. membuat branch baru dari commit basis stash;
2. checkout branch tersebut;
3. apply stash;
4. drop stash jika apply sukses.

Ini sangat berguna ketika stash lama sulit diterapkan ke branch sekarang.

Mental model:

```text
Stash dibuat dari commit A.
Branch sekarang sudah di commit Z.
Apply stash ke Z conflict parah.
Maka buat branch dari A, apply stash di konteks asalnya.
```

Contoh:

```bash
git stash list
git stash branch feature/old-tax-refactor stash@{2}
```

Setelah itu kamu bisa:

```bash
git rebase main
```

atau merge secara bertahap.

---

# 12. Menghapus Stash

Hapus satu stash:

```bash
git stash drop stash@{0}
```

Hapus semua stash:

```bash
git stash clear
```

Hati-hati dengan `clear`. Dalam repository aktif, stash sering menjadi “tempat parkir” pekerjaan penting yang belum dicommit.

Sebelum clear:

```bash
git stash list
```

Lihat detail:

```bash
git stash show --stat stash@{0}
```

Jika ada stash penting, jadikan branch atau commit dulu.

---

# 13. Stash sebagai Smell

Stash berguna. Tetapi stash yang terlalu banyak sering menunjukkan masalah workflow.

Contoh smell:

```text
stash@{0}: WIP dependency upgrade
stash@{1}: WIP dependency upgrade again
stash@{2}: try fix tests
stash@{3}: temp
stash@{4}: old stuff maybe important
stash@{5}: WIP before pull
stash@{6}: WIP before rebase
```

Ini menandakan:

- pekerjaan tidak dipisah branch dengan baik;
- commit atomic belum disiplin;
- terlalu banyak context switching;
- branch terlalu lama hidup;
- developer takut membuat commit lokal;
- tim terlalu sering menginterupsi flow;
- tidak ada strategi hotfix/review yang bersih.

Rule praktis:

> Stash adalah tool transisi, bukan storage jangka panjang.

Jika perubahan penting lebih dari satu hari, biasanya lebih baik commit di branch lokal.

Contoh:

```bash
git switch -c wip/payment-refactor
git add .
git commit -m "WIP: payment refactor checkpoint"
```

Selama belum dipush ke shared branch, commit WIP lokal bisa dibersihkan dengan interactive rebase nanti.

---

# 14. Commit WIP vs Stash

Kapan commit WIP lebih baik?

| Situasi | Lebih cocok |
|---|---|
| Perubahan kecil, benar-benar sementara | Stash |
| Perubahan besar dan penting | Commit WIP lokal |
| Butuh berpindah branch sebentar | Stash atau worktree |
| Butuh menyimpan progres beberapa hari | Commit WIP lokal |
| Butuh review paralel branch lain | Worktree |
| Butuh hotfix production cepat | Worktree atau commit/stash aman |
| Perubahan belum compile tapi berharga | Commit WIP lokal di branch private |

Engineer kuat tidak alergi terhadap WIP commit lokal. Yang buruk bukan WIP commit lokal; yang buruk adalah membocorkan history berantakan ke shared branch tanpa dirapikan.

Workflow:

```bash
git switch -c wip/order-refactor
git add .
git commit -m "WIP: checkpoint order validation refactor"
```

Nanti sebelum PR:

```bash
git rebase -i main
```

Lalu squash/split/reword agar history bersih.

---

# 15. Mental Model `git worktree`

`git worktree` menyelesaikan masalah berbeda.

Stash berkata:

```text
Saya hanya punya satu working tree. Simpan dulu perubahan ini agar saya bisa pindah konteks.
```

Worktree berkata:

```text
Saya ingin beberapa working tree paralel untuk repository yang sama.
```

Contoh struktur:

```text
~/code/
  my-service/                  # worktree utama, branch feature/payment
  my-service-hotfix/           # worktree tambahan, branch hotfix/prod-login
  my-service-review-auth/      # worktree tambahan, branch review/auth-change
```

Semuanya berbagi object database yang sama, tetapi working directory berbeda.

Ini sangat kuat untuk:

- hotfix tanpa mengganggu pekerjaan feature;
- review branch orang lain tanpa stash;
- membandingkan release branch dan main;
- menjalankan dua versi aplikasi berdampingan;
- investigasi bug di tag lama;
- build/test paralel dengan branch berbeda;
- monorepo besar yang mahal untuk clone ulang.

---

# 16. Membuat Worktree Baru

Misalnya kamu sedang di repository:

```bash
cd ~/code/my-service
```

Branch aktif:

```text
feature/payment-refactor
```

Tiba-tiba harus hotfix dari `main`.

Alih-alih stash:

```bash
git worktree add ../my-service-hotfix main
```

Ini membuat directory baru:

```text
~/code/my-service-hotfix
```

Dengan branch `main` checked out di sana.

Lalu:

```bash
cd ../my-service-hotfix
git switch -c hotfix/login-null-pointer
```

Sekarang kamu bisa mengerjakan hotfix tanpa menyentuh working tree feature.

---

# 17. Membuat Worktree Langsung dengan Branch Baru

Command umum:

```bash
git worktree add -b hotfix/login-null-pointer ../my-service-hotfix main
```

Artinya:

```text
Buat worktree di ../my-service-hotfix
Buat branch baru hotfix/login-null-pointer
Start dari main
```

Untuk release branch:

```bash
git worktree add -b hotfix/1.8.3-login ../my-service-hotfix release/1.8
```

Untuk review branch remote:

```bash
git fetch origin
git worktree add ../my-service-review-auth origin/feature/auth-change
```

Namun jika ingin commit di review branch tersebut, sebaiknya buat local branch:

```bash
git worktree add -b review/auth-change ../my-service-review-auth origin/feature/auth-change
```

---

# 18. Melihat Worktree yang Ada

```bash
git worktree list
```

Contoh output:

```text
/Users/me/code/my-service          a1b2c3d [feature/payment-refactor]
/Users/me/code/my-service-hotfix   e4f5g6h [hotfix/login-null-pointer]
/Users/me/code/my-service-review   9a8b7c6 [review/auth-change]
```

Ini membantu mengetahui branch mana sedang checked out di directory mana.

---

# 19. Branch yang Sedang Dipakai Worktree Lain

Git mencegah branch yang sama checked out di dua worktree berbeda.

Misalnya `feature/payment-refactor` sudah aktif di `~/code/my-service`.

Jika kamu mencoba:

```bash
git worktree add ../my-service-copy feature/payment-refactor
```

Git bisa menolak karena branch itu sudah checked out.

Ini safety mechanism.

Kenapa?

Jika branch pointer yang sama bisa dimutasi dari dua working tree sekaligus, risiko confusion sangat tinggi.

Jika butuh state yang sama, buat branch baru dari commit yang sama:

```bash
git worktree add -b experiment/payment-alt ../my-service-experiment feature/payment-refactor
```

---

# 20. Menghapus Worktree

Jika sudah selesai:

```bash
git worktree remove ../my-service-hotfix
```

Jika directory sudah dihapus manual:

```bash
git worktree prune
```

Cek lagi:

```bash
git worktree list
```

Jangan hanya `rm -rf` sembarangan jika masih ada metadata worktree. `git worktree remove` lebih bersih.

---

# 21. Stash vs Worktree: Decision Matrix

| Pertanyaan | Pilihan Lebih Baik |
|---|---|
| Perubahan saat ini kecil dan sementara? | Stash |
| Perubahan saat ini besar dan penting? | Commit WIP atau worktree |
| Harus hotfix tanpa mengganggu feature? | Worktree |
| Harus review branch orang lain? | Worktree |
| Hanya perlu pull sebentar di branch sama? | Commit/stash tergantung state |
| Butuh menjalankan dua versi app sekaligus? | Worktree |
| Branch target sangat berbeda dari branch saat ini? | Worktree |
| Stash sudah lama dan sering conflict? | `git stash branch` |
| Banyak stash menumpuk? | Perbaiki workflow, gunakan branch/worktree |

Rule sederhana:

```text
Stash = parkir perubahan.
Worktree = buka ruang kerja baru.
```

---

# 22. Context Switching Scenario 1: Hotfix Production Saat Sedang Feature

Situasi:

```text
Branch aktif: feature/payment-refactor
Working tree: banyak perubahan belum siap commit
Incident: production login error harus hotfix dari main/release
```

Pilihan buruk:

```bash
git stash
git switch main
git pull
git switch -c hotfix/login
git commit ...
git switch feature/payment-refactor
git stash pop
```

Ini bisa benar, tetapi berisiko jika:

- stash conflict saat balik;
- lupa stash;
- generated files ikut berubah;
- feature branch dan hotfix branch bercampur mental.

Pilihan lebih bersih dengan worktree:

```bash
# dari repository utama
git fetch origin
git worktree add -b hotfix/login-null-pointer ../my-service-hotfix origin/main
```

Lalu:

```bash
cd ../my-service-hotfix
# edit fix
git status
git add src/main/java/com/acme/auth/LoginService.java
git commit -m "Fix null token handling in login flow"
git push -u origin hotfix/login-null-pointer
```

Keuntungan:

- feature work tetap utuh;
- tidak perlu stash;
- hotfix punya working directory bersih;
- mental context jelas;
- lebih aman untuk incident.

---

# 23. Context Switching Scenario 2: Review Branch Orang Lain

Situasi:

```text
Kamu sedang di feature/order-validation.
Ada PR besar dari teammate: feature/auth-session-cleanup.
Kamu perlu checkout dan run tests.
```

Dengan stash:

```bash
git stash push -m "WIP order validation before review"
git fetch origin
git switch feature/auth-session-cleanup
./mvnw test
```

Risiko:

- local work harus diparkir;
- setelah review harus balik dan apply;
- jika review butuh beberapa kali, context switching melelahkan.

Dengan worktree:

```bash
git fetch origin
git worktree add -b review/auth-session-cleanup ../my-service-review-auth origin/feature/auth-session-cleanup
cd ../my-service-review-auth
./mvnw test
```

Keuntungan:

- branch utama tetap tidak terganggu;
- review bisa ditinggal dan dibuka lagi;
- build output terpisah;
- IDE bisa membuka window terpisah jika perlu.

---

# 24. Context Switching Scenario 3: Investigasi Bug di Release Lama

Situasi:

```text
Production version: v1.8.2
Main sudah jauh di depan.
Kamu perlu reproduce bug di tag v1.8.2.
```

Dengan worktree:

```bash
git fetch --tags
git worktree add ../my-service-v1.8.2 v1.8.2
cd ../my-service-v1.8.2
./mvnw test
```

Jika perlu membuat hotfix:

```bash
git switch -c hotfix/1.8.3-from-v1.8.2
```

atau langsung:

```bash
git worktree add -b hotfix/1.8.3 ../my-service-hotfix-1.8.3 v1.8.2
```

Ini jauh lebih aman daripada checkout tag di working tree utama dan masuk detached HEAD tanpa sadar.

---

# 25. Context Switching Scenario 4: Dependency Upgrade Eksperimental

Situasi:

```text
Kamu ingin upgrade Spring Boot 3.x minor version.
Kemungkinan banyak test gagal.
Kamu tidak ingin mengganggu feature branch aktif.
```

Gunakan worktree:

```bash
git worktree add -b experiment/spring-boot-upgrade ../my-service-spring-upgrade main
cd ../my-service-spring-upgrade
```

Lakukan eksperimen:

```bash
# edit pom.xml / build.gradle
./mvnw test
```

Jika eksperimen gagal total:

```bash
cd ../my-service
git worktree remove ../my-service-spring-upgrade
```

Jika eksperimen berhasil:

```bash
git push -u origin experiment/spring-boot-upgrade
```

---

# 26. Context Switching Scenario 5: Local Debug Notes dan Untracked Files

Situasi:

```text
Kamu punya file lokal:
notes/debug-order-bug.md
scripts/local-reproduce.sh
```

File ini untracked. Default stash tidak menyimpannya.

Jika kamu menjalankan:

```bash
git stash push -m "WIP debug order bug"
```

untracked files tetap ada di working tree.

Jika branch switch tidak terganggu, mungkin aman. Tapi jika ingin working tree benar-benar bersih:

```bash
git stash push -u -m "WIP debug order bug with local notes"
```

Lihat isi stash:

```bash
git stash show --stat stash@{0}
```

Hati-hati agar file lokal yang sensitif tidak masuk commit nanti.

Untuk debug notes jangka panjang, pertimbangkan:

- simpan di luar repository;
- gunakan `.git/info/exclude` untuk ignore lokal;
- gunakan branch khusus investigasi;
- jangan taruh secret di notes.

---

# 27. `.git/info/exclude` untuk Ignore Lokal

Kadang kamu punya file lokal yang tidak ingin masuk `.gitignore` project, karena hanya berlaku untuk mesinmu.

Contoh:

```text
local-debug.md
scratch/
run-local-with-my-env.sh
```

Gunakan:

```bash
.git/info/exclude
```

Isi:

```gitignore
local-debug.md
scratch/
run-local-with-my-env.sh
```

Bedanya:

| File | Scope |
|---|---|
| `.gitignore` | dibagikan ke repository |
| `.git/info/exclude` | hanya lokal di repository tersebut |
| global gitignore | seluruh repository di mesin user |

Ini membantu mengurangi kebutuhan stash untuk untracked scratch files.

---

# 28. Stash dan Generated Files di Java Project

Java project sering menghasilkan banyak file:

Maven:

```text
target/
```

Gradle:

```text
build/
.gradle/
```

IDE:

```text
.idea/
*.iml
.classpath
.project
.settings/
```

Generated code:

```text
generated-sources/
build/generated/
target/generated-sources/
```

Jika `.gitignore` buruk, stash bisa menjadi kacau karena generated files ikut dianggap untracked/modified.

Sebelum stash, selalu cek:

```bash
git status --short
```

Output sehat:

```text
 M src/main/java/com/acme/PaymentService.java
 M src/test/java/com/acme/PaymentServiceTest.java
```

Output mencurigakan:

```text
 M target/generated-sources/openapi/src/main/java/...
?? build/classes/java/main/...
?? .idea/workspace.xml
```

Perbaiki hygiene repository sebelum memakai stash sebagai solusi.

---

# 29. Worktree dan Build Output Java

Worktree membuat directory kerja terpisah. Ini berarti build output juga terpisah:

```text
my-service/target/
my-service-hotfix/target/
my-service-review-auth/target/
```

Keuntungan:

- build satu branch tidak mengotori branch lain;
- IDE indexing bisa terpisah;
- bisa menjalankan test di dua branch;
- dependency generated source tidak bercampur.

Kerugian:

- lebih banyak disk usage;
- IDE bisa bingung jika membuka banyak project mirip;
- local service port bisa conflict;
- environment config lokal perlu dikelola;
- Docker compose project name mungkin bentrok.

Untuk Java/Spring Boot, jika menjalankan dua worktree sekaligus, perhatikan:

- server port;
- database schema lokal;
- migration history;
- Kafka/RabbitMQ topic lokal;
- Redis key namespace;
- Docker compose container name;
- `.env` lokal;
- generated client output.

---

# 30. Worktree dan IDE

Jika menggunakan IntelliJ IDEA, Eclipse, atau VS Code, worktree diperlakukan sebagai directory project berbeda.

Praktik aman:

- buka worktree hotfix di window terpisah;
- pastikan JDK sama;
- pastikan Maven/Gradle import benar;
- hindari commit IDE workspace file;
- jangan biarkan IDE auto-format seluruh project saat review branch;
- cek `git diff` sebelum commit.

Worktree sangat berguna untuk review PR:

```text
Window 1: feature pribadi
Window 2: PR teammate
Window 3: release/hotfix
```

Tetapi jangan membuka terlalu banyak worktree sampai kehilangan konteks.

---

# 31. Worktree dan Database Migration

Misalnya project memakai Flyway/Liquibase.

Branch A punya migration:

```text
V42__add_payment_status.sql
```

Branch B juga punya:

```text
V42__add_user_risk_flag.sql
```

Dengan worktree, kamu bisa checkout dua branch paralel. Tetapi database lokal tetap bisa sama.

Risiko:

- migration branch A sudah diterapkan ke DB lokal;
- lalu kamu menjalankan branch B pada DB yang sama;
- Flyway/Liquibase melihat state tidak sesuai;
- test gagal bukan karena kode, tapi karena database context campur.

Solusi:

- gunakan database lokal berbeda per worktree;
- gunakan schema berbeda;
- reset DB saat pindah worktree;
- gunakan container DB per worktree;
- namespace Docker Compose project.

Contoh:

```bash
COMPOSE_PROJECT_NAME=my-service-hotfix docker compose up -d
```

atau:

```yaml
spring.datasource.url=jdbc:postgresql://localhost:5432/my_service_hotfix
```

Worktree memisahkan file, bukan otomatis memisahkan external state.

---

# 32. Worktree dan Running Services

Untuk microservices Java, running local environment sering punya external state:

- PostgreSQL/MySQL;
- Redis;
- Kafka/RabbitMQ;
- Elasticsearch;
- localstack;
- MinIO;
- test containers;
- Docker networks.

Jika dua worktree menjalankan service yang sama:

```text
my-service on port 8080
my-service-hotfix also wants port 8080
```

maka conflict.

Praktik:

- gunakan profile berbeda;
- gunakan port override;
- gunakan `.env` lokal per worktree;
- gunakan Docker compose project name berbeda;
- jangan share database tanpa sadar;
- dokumentasikan local run convention.

Contoh:

```bash
SERVER_PORT=8081 ./mvnw spring-boot:run
```

atau:

```bash
SPRING_PROFILES_ACTIVE=hotfix-local ./mvnw spring-boot:run
```

---

# 33. Worktree dan CI/CD Mental Model

Worktree adalah lokal. CI/CD biasanya melakukan clone bersih per job.

Namun konsepnya mirip:

```text
Setiap CI job punya working directory sendiri.
```

Karena itu, worktree membantu kamu mensimulasikan CI isolation secara lokal:

- branch feature di satu worktree;
- branch release di worktree lain;
- test command berjalan di directory bersih;
- tidak perlu stash bolak-balik.

Tetapi jangan lupa:

> Worktree berbagi object database, tetapi working directory dan build output berbeda.

---

# 34. Advanced Stash: Stash Entry sebagai Commit

Stash entry bisa dilihat dengan command commit biasa:

```bash
git show stash@{0}
```

Atau:

```bash
git log --graph --oneline --decorate stash@{0}
```

Stash biasanya memiliki struktur commit khusus yang merepresentasikan working tree dan index.

Ini bukan materi yang harus dipakai setiap hari, tetapi penting untuk recovery.

Jika stash tampak hilang setelah `drop`, kadang masih bisa dicari dengan:

```bash
git fsck --lost-found
```

atau reflog terkait stash jika masih ada.

Namun jangan mengandalkan ini sebagai workflow utama. Gunakan message, branch, dan commit lokal untuk pekerjaan penting.

---

# 35. Advanced Worktree: Bare Repository Pattern

Beberapa engineer advanced menggunakan bare repository sebagai pusat object database, lalu semua branch aktif sebagai worktree.

Struktur:

```text
~/code/my-service.git/          # bare repo
~/code/my-service-main/         # worktree main
~/code/my-service-feature-x/    # worktree feature x
~/code/my-service-hotfix/       # worktree hotfix
```

Setup umum:

```bash
git clone --bare git@github.com:acme/my-service.git my-service.git
cd my-service.git
git worktree add ../my-service-main main
git worktree add -b feature/x ../my-service-feature-x main
```

Keuntungan:

- tidak ada “working tree utama” yang istimewa;
- semua pekerjaan eksplisit sebagai worktree;
- cocok untuk engineer yang sering paralel branch.

Kerugian:

- lebih advanced;
- tooling/IDE mungkin perlu penyesuaian;
- tidak cocok untuk pemula;
- bisa membingungkan tim jika tidak distandardisasi.

Untuk kebanyakan Java team, mulai dari repository normal + worktree tambahan sudah cukup.

---

# 36. Context Switching Anti-Patterns

## 36.1 `git stash` tanpa cek status

Buruk:

```bash
git stash
```

Tanpa tahu apa yang distash.

Lebih baik:

```bash
git status --short
git diff --stat
git stash push -m "WIP payment validation before hotfix"
```

## 36.2 Stash sebagai long-term storage

Buruk:

```text
stash@{12}: important old work maybe needed
```

Lebih baik:

```bash
git stash branch wip/recover-important-work stash@{12}
git add .
git commit -m "WIP: recover old payment experiment"
```

## 36.3 `stash pop` secara buta

Buruk:

```bash
git stash pop
```

Lebih baik:

```bash
git stash show --stat stash@{0}
git stash apply stash@{0}
```

## 36.4 Worktree tanpa lifecycle

Buruk:

```text
my-service-hotfix-old/
my-service-review-temp/
my-service-test2/
my-service-copy-final/
```

Lebih baik:

```bash
git worktree list
git worktree remove ../my-service-hotfix-old
git worktree prune
```

## 36.5 External state dianggap ikut terpisah

Buruk:

```text
Saya punya worktree berbeda, berarti DB lokal aman.
```

Salah. Worktree hanya memisahkan file. Database, message broker, cache, dan Docker daemon tetap external state yang harus dipisah sendiri.

---

# 37. Practical Playbook: Sebelum Pindah Konteks

Jalankan:

```bash
git status --short
git branch --show-current
git diff --stat
```

Tanyakan:

```text
1. Apakah perubahan saya sudah cukup coherent untuk commit lokal?
2. Apakah saya hanya butuh pindah sebentar?
3. Apakah branch target jauh berbeda?
4. Apakah saya perlu menjalankan build/test di dua branch?
5. Apakah ada external state seperti DB/migration yang perlu dipisahkan?
6. Apakah pekerjaan ini bisa menjadi PR/hotfix terpisah?
```

Keputusan:

```text
Kecil, sementara                -> stash
Besar, penting                  -> commit WIP lokal
Butuh branch paralel             -> worktree
Butuh review/hotfix/release lama -> worktree
Stash lama conflict              -> git stash branch
```

---

# 38. Practical Playbook: Stash Aman

```bash
# 1. Observasi state
git status --short
git diff --stat

# 2. Simpan dengan message
git stash push -m "WIP <konteks> before <alasan>"

# 3. Verifikasi working tree bersih
git status --short

# 4. Pindah konteks
git switch <branch-target>

# 5. Setelah selesai, kembali
git switch <branch-asal>

# 6. Lihat stash sebelum apply
git stash list
git stash show --stat stash@{0}

# 7. Apply dulu, jangan pop dulu
git stash apply stash@{0}

# 8. Verifikasi
git status
git diff

# 9. Drop jika sudah aman
git stash drop stash@{0}
```

Jika ada untracked files penting:

```bash
git stash push -u -m "WIP <konteks> with untracked notes"
```

---

# 39. Practical Playbook: Worktree untuk Hotfix

```bash
# Dari repo utama
git fetch origin

# Buat worktree hotfix dari main atau release branch
git worktree add -b hotfix/<issue-id>-<short-name> ../my-service-hotfix origin/main

# Masuk ke worktree hotfix
cd ../my-service-hotfix

# Kerjakan fix
git status

# Commit atomic
git add <files>
git commit -m "Fix <specific production issue>"

# Push branch
git push -u origin hotfix/<issue-id>-<short-name>

# Setelah PR merge dan selesai
cd ../my-service
git worktree remove ../my-service-hotfix
```

Untuk release branch:

```bash
git worktree add -b hotfix/1.8.3-login ../my-service-hotfix-1.8 origin/release/1.8
```

---

# 40. Practical Playbook: Worktree untuk Review PR

```bash
git fetch origin
git worktree add -b review/<topic> ../my-service-review-<topic> origin/<branch-name>
cd ../my-service-review-<topic>
./mvnw test
```

Setelah selesai:

```bash
cd ../my-service
git worktree remove ../my-service-review-<topic>
```

Jika ingin update branch review:

```bash
cd ../my-service-review-<topic>
git fetch origin
git pull --ff-only
```

---

# 41. Practical Playbook: Membersihkan Worktree

Lihat semua:

```bash
git worktree list
```

Hapus worktree yang selesai:

```bash
git worktree remove ../my-service-review-auth
```

Jika directory sudah hilang manual:

```bash
git worktree prune
```

Hapus branch review lokal jika tidak perlu:

```bash
git branch -d review/auth-session-cleanup
```

Jika branch belum merged dan memang ingin paksa hapus:

```bash
git branch -D review/auth-session-cleanup
```

Gunakan `-D` hanya jika yakin.

---

# 42. Failure Mode: Stash Pop Conflict dan Stash Hilang?

Saat `git stash pop` conflict, Git biasanya tidak drop stash jika apply tidak sukses. Tetapi jangan bergantung pada asumsi tanpa cek.

Setelah conflict:

```bash
git stash list
```

Jika stash masih ada, aman.

Jika stash tidak terlihat dan kamu belum yakin, jangan panik:

1. jangan jalankan `git gc`;
2. cek reflog;
3. cek `git fsck` jika perlu;
4. simpan patch working tree saat ini.

Command awal:

```bash
git status
git diff > /tmp/current-conflict.patch
git stash list
```

Jika ingin mulai ulang dan stash masih ada:

```bash
git reset --hard
git stash apply stash@{0}
```

Hati-hati: `reset --hard` menghapus perubahan working tree yang belum tersimpan.

---

# 43. Failure Mode: Worktree Tidak Bisa Dihapus

Jika worktree masih punya perubahan lokal, Git bisa menolak remove.

```bash
git worktree remove ../my-service-hotfix
```

Jika ada perubahan:

```text
fatal: '../my-service-hotfix' contains modified or untracked files
```

Masuk dan cek:

```bash
cd ../my-service-hotfix
git status --short
```

Pilihan:

- commit perubahan;
- stash perubahan;
- copy file penting;
- discard jika benar-benar tidak perlu.

Jika yakin ingin paksa:

```bash
git worktree remove --force ../my-service-hotfix
```

Gunakan `--force` hanya setelah cek status.

---

# 44. Failure Mode: Branch Terkunci oleh Worktree

Jika ingin delete branch:

```bash
git branch -d hotfix/login-null-pointer
```

Tapi branch masih checked out di worktree lain, Git akan menolak.

Cek:

```bash
git worktree list
```

Hapus atau pindahkan worktree tersebut dulu:

```bash
git worktree remove ../my-service-hotfix
```

Lalu:

```bash
git branch -d hotfix/login-null-pointer
```

---

# 45. Failure Mode: Worktree dengan Remote Branch Detached

Jika kamu menjalankan:

```bash
git worktree add ../review origin/feature/auth
```

Kamu bisa berada pada detached HEAD karena `origin/feature/auth` adalah remote-tracking ref, bukan local branch.

Untuk review read-only ini sering cukup.

Tetapi jika ingin commit, buat branch lokal:

```bash
git switch -c review/auth
```

atau dari awal:

```bash
git worktree add -b review/auth ../review origin/feature/auth
```

---

# 46. Failure Mode: Stash Salah Branch

Stash bisa di-apply di branch lain. Kadang itu berguna, kadang berbahaya.

Contoh:

```bash
git stash apply stash@{2}
```

di branch yang salah.

Jika belum commit dan ingin batal:

```bash
git reset --hard
```

Tetapi jika ada untracked files yang muncul dari stash, perlu:

```bash
git clean -fd
```

Sangat hati-hati: `git clean -fd` menghapus untracked files.

Sebelum membersihkan:

```bash
git status --short
git clean -fdn
```

`-n` adalah dry-run.

---

# 47. `git clean` dalam Context Switching

Kadang working tree kotor karena untracked build/debug files.

Cek dry-run:

```bash
git clean -fdn
```

Jika output aman:

```bash
git clean -fd
```

Untuk ignored files:

```bash
git clean -fdX
```

Untuk ignored dan untracked:

```bash
git clean -fdx
```

Hati-hati besar:

```text
-x dapat menghapus file lokal penting yang tidak tracked dan ignored.
```

Untuk Java project, `git clean -fdX` sering dipakai membersihkan build output ignored seperti `target/` atau `build/`, tetapi pastikan tidak ada file lokal penting di ignored path.

---

# 48. Java-Specific Context Switching Checklist

Sebelum pindah konteks:

```text
[ ] git status bersih atau perubahan sudah distash/commit
[ ] untracked files penting ikut disimpan jika perlu
[ ] generated files tidak ikut tersimpan sembarangan
[ ] branch asal diketahui
[ ] branch target diketahui
[ ] external state dipertimbangkan
```

Jika menggunakan worktree:

```text
[ ] directory worktree punya nama jelas
[ ] branch worktree punya nama jelas
[ ] port aplikasi tidak bentrok
[ ] database/schema tidak bercampur
[ ] Docker compose project name tidak bentrok
[ ] IDE tidak auto-format massal
[ ] worktree dihapus setelah selesai
```

Jika menggunakan stash:

```text
[ ] stash diberi message
[ ] stash list dicek
[ ] stash show dicek sebelum apply
[ ] gunakan apply sebelum drop untuk stash penting
[ ] stash tidak menjadi storage permanen
```

---

# 49. Latihan Praktis 1: Stash Dasar

Buat repo latihan:

```bash
mkdir git-context-lab
cd git-context-lab
git init
mkdir -p src/main/java/com/acme
cat > src/main/java/com/acme/App.java <<'EOF'
package com.acme;

public class App {
    public static void main(String[] args) {
        System.out.println("v1");
    }
}
EOF
git add .
git commit -m "Initial app"
```

Ubah file:

```bash
sed -i.bak 's/v1/v2/' src/main/java/com/acme/App.java
rm src/main/java/com/acme/App.java.bak 2>/dev/null || true
git status --short
```

Stash:

```bash
git stash push -m "Change output to v2"
git status --short
git stash list
git stash show -p stash@{0}
```

Apply:

```bash
git stash apply stash@{0}
git diff
git stash drop stash@{0}
```

Refleksi:

```text
Apa yang terjadi pada working tree sebelum dan sesudah stash?
Apakah stash menghapus object atau hanya memindahkan perubahan ke ref lain?
```

---

# 50. Latihan Praktis 2: Stash Untracked

Buat file untracked:

```bash
echo "debug notes" > debug-notes.md
git status --short
```

Stash default:

```bash
git stash push -m "Default stash test"
git status --short
```

Perhatikan `debug-notes.md` masih ada.

Sekarang stash dengan untracked:

```bash
git stash push -u -m "Stash with untracked debug notes"
git status --short
git stash show --stat stash@{0}
```

Apply:

```bash
git stash apply stash@{0}
```

Refleksi:

```text
Kapan untracked file perlu ikut stash?
Kapan lebih baik disimpan di luar repository?
```

---

# 51. Latihan Praktis 3: Worktree Hotfix

Dari repo latihan:

```bash
git switch -c feature/change-output
sed -i.bak 's/v1/feature work/' src/main/java/com/acme/App.java
rm src/main/java/com/acme/App.java.bak 2>/dev/null || true
```

Jangan commit dulu.

Buat worktree hotfix dari main/master. Jika branch default bernama `master`:

```bash
git worktree add -b hotfix/message ../git-context-lab-hotfix master
```

Jika branch default bernama `main`:

```bash
git worktree add -b hotfix/message ../git-context-lab-hotfix main
```

Masuk:

```bash
cd ../git-context-lab-hotfix
sed -i.bak 's/v1/hotfix/' src/main/java/com/acme/App.java
rm src/main/java/com/acme/App.java.bak 2>/dev/null || true
git add .
git commit -m "Fix output message"
```

Cek worktree list:

```bash
git worktree list
```

Refleksi:

```text
Apakah perubahan feature di directory utama terganggu?
Apakah hotfix bisa dikerjakan tanpa stash?
```

Bersihkan:

```bash
cd ../git-context-lab
git worktree remove ../git-context-lab-hotfix
```

---

# 52. Latihan Praktis 4: Conflict Saat Stash Apply

Buat branch dan stash:

```bash
git switch master 2>/dev/null || git switch main
git switch -c feature/stash-conflict
sed -i.bak 's/v1/stashed change/' src/main/java/com/acme/App.java
rm src/main/java/com/acme/App.java.bak 2>/dev/null || true
git stash push -m "Stashed output change"
```

Ubah file di branch yang sama:

```bash
sed -i.bak 's/v1/current branch change/' src/main/java/com/acme/App.java
rm src/main/java/com/acme/App.java.bak 2>/dev/null || true
git add .
git commit -m "Change output differently"
```

Apply stash:

```bash
git stash apply stash@{0}
```

Kemungkinan conflict.

Resolusi manual, lalu:

```bash
git status
git add src/main/java/com/acme/App.java
git commit -m "Resolve stashed output change"
```

Refleksi:

```text
Kenapa conflict terjadi?
Apa basis stash?
Apa state target saat apply?
```

---

# 53. Kesalahan Berpikir yang Harus Dihindari

## 53.1 “Stash itu aman untuk selamanya”

Tidak ideal. Stash adalah object Git, tetapi bisa hilang dari perhatian manusia, terkena cleanup pada kondisi tertentu, atau menjadi sangat sulit diintegrasikan.

## 53.2 “Worktree sama dengan clone baru”

Tidak sama. Worktree berbagi repository metadata/object database dengan repository asal. Ini lebih hemat daripada clone penuh, tetapi tetap punya working directory terpisah.

## 53.3 “Kalau worktree berbeda, semua state berbeda”

Salah. File berbeda, tetapi database lokal, Docker daemon, ports, message broker, dan cache bisa tetap sama.

## 53.4 “WIP commit itu buruk”

WIP commit lokal tidak buruk jika private dan nanti dirapikan. Justru sering lebih aman daripada stash besar tanpa nama.

## 53.5 “`stash pop` selalu aman”

Tidak. `pop` menggabungkan apply dan drop. Untuk stash penting, gunakan apply dulu.

---

# 54. Mental Model Akhir

Context switching di Git adalah soal menjaga invariant:

```text
Perubahan yang belum siap tidak boleh hilang.
Perubahan yang unrelated tidak boleh bercampur.
Branch yang berbeda sebaiknya punya ruang kerja yang jelas.
External state harus dipisahkan secara sadar.
```

Gunakan stash ketika:

```text
Saya perlu memarkir perubahan kecil/sementara.
```

Gunakan WIP commit lokal ketika:

```text
Perubahan ini penting dan harus punya checkpoint kuat.
```

Gunakan worktree ketika:

```text
Saya perlu ruang kerja paralel untuk branch lain.
```

Stash adalah laci sementara.

Commit adalah checkpoint historis.

Worktree adalah meja kerja tambahan.

Engineer kuat memilih berdasarkan risiko, bukan kebiasaan.

---

# 55. Command Reference Ringkas

## Stash

```bash
git stash push -m "message"
git stash push -u -m "message with untracked"
git stash push -a -m "message with ignored too"
git stash list
git stash show stash@{0}
git stash show -p stash@{0}
git stash apply stash@{0}
git stash apply --index stash@{0}
git stash pop stash@{0}
git stash drop stash@{0}
git stash clear
git stash branch new-branch stash@{0}
```

## Worktree

```bash
git worktree add ../path branch
git worktree add -b new-branch ../path start-point
git worktree list
git worktree remove ../path
git worktree remove --force ../path
git worktree prune
```

## Cleaning

```bash
git clean -fdn   # dry-run untracked cleanup
git clean -fd    # remove untracked files/directories
git clean -fdX   # remove ignored files only
git clean -fdx   # remove ignored + untracked files
```

---

# 56. Checklist Operasional Part 018

Sebelum stash:

```text
[ ] Saya sudah menjalankan git status --short
[ ] Saya tahu tracked/untracked/ignored mana yang relevan
[ ] Saya memberi message yang jelas
[ ] Saya tahu branch asal stash
[ ] Saya tidak memakai stash sebagai storage jangka panjang
```

Sebelum apply stash:

```text
[ ] Saya sudah melihat git stash list
[ ] Saya sudah melihat git stash show --stat/-p
[ ] Saya berada di branch yang tepat
[ ] Saya siap menghadapi conflict
[ ] Untuk stash penting, saya apply dulu, bukan pop
```

Sebelum worktree:

```text
[ ] Saya tahu branch/start point
[ ] Saya memberi nama directory yang jelas
[ ] Saya memberi nama branch yang jelas
[ ] Saya mempertimbangkan external state
[ ] Saya tahu kapan worktree akan dihapus
```

Sebelum menghapus worktree:

```text
[ ] Saya cek git status di worktree tersebut
[ ] Perubahan penting sudah commit/stash/copy
[ ] Branch yang masih perlu sudah dipush atau disimpan
[ ] Saya gunakan git worktree remove, bukan hanya rm -rf
```

---

# 57. Ringkasan

Di part ini kita membahas:

- kenapa context switching adalah masalah state management;
- mental model stash sebagai object/ref khusus;
- apa yang disimpan dan tidak disimpan stash;
- `stash push`, `list`, `show`, `apply`, `pop`, `drop`, `branch`;
- staged state dan `--index`;
- untracked/ignored files;
- stash conflict;
- stash sebagai smell jika dipakai berlebihan;
- perbedaan stash vs WIP commit;
- mental model `git worktree`;
- worktree untuk hotfix, review, release lama, dan eksperimen;
- worktree lifecycle;
- Java-specific concerns: generated files, IDE, build output, migration, Docker, local DB;
- `git clean` sebagai alat pembersih dengan risiko tinggi;
- decision matrix context switching.

Prinsip akhir:

```text
Jangan biarkan context switching mengubah pekerjaan unrelated menjadi satu kekacauan state.
```

Git menyediakan alatnya. Tugas engineer adalah memilih boundary yang benar.

---

# 58. Materi Berikutnya

Part berikutnya:

```text
learn-git-mastery-for-java-engineers-part-019.md
```

Topik:

```text
Bisect: Debugging Regresi dengan Git
```

Kita akan belajar menggunakan Git bukan hanya sebagai version control, tetapi sebagai mesin binary search untuk menemukan commit penyebab bug.

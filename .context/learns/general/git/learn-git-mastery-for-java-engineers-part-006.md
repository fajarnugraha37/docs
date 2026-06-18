# learn-git-mastery-for-java-engineers-part-006.md

# Part 006 — Diff Mental Model: Membandingkan State, Bukan Sekadar File

> Seri: **Git Mastery for Java Engineers**  
> Bagian: **006 / 032**  
> Status seri: **belum selesai**  
> Bagian terakhir: `learn-git-mastery-for-java-engineers-part-032.md`

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya, kita sudah mulai membaca history dengan `git log`, `git show`, dan `git diff`. Bagian ini memperdalam satu hal yang sering dianggap sederhana tetapi sebenarnya sangat menentukan kualitas kerja Git sehari-hari: **diff**.

Banyak engineer bisa menjalankan:

```bash
git diff
git diff main
git diff main...feature
git diff --cached
```

Tetapi tidak selalu bisa menjawab dengan presisi:

- state mana yang sedang dibandingkan?
- apakah diff ini membandingkan working tree, index, `HEAD`, branch, atau merge base?
- kenapa diff di lokal berbeda dari diff di Pull Request?
- kenapa `main..feature` dan `main...feature` memberi hasil yang berbeda?
- apakah diff ini menunjukkan “apa yang saya ubah” atau “apa perbedaan dua snapshot final”?
- apakah rename benar-benar rename atau delete + add?
- apakah perubahan ini meaningful atau noise whitespace?
- apakah diff kecil berarti risiko kecil?

Target bagian ini: kamu bisa membaca dan menghasilkan diff sebagai **alat reasoning**.

Bukan hanya melihat baris merah/hijau.

---

## 1. Premis Utama: Diff Membandingkan State

Mental model paling penting:

```text
Diff is not “a list of changes”.
Diff is a computed comparison between two states.
```

Git tidak menyimpan “diff antar commit” sebagai primitive utama. Git menyimpan snapshot. Saat kamu meminta diff, Git menghitung perbedaan antara dua snapshot atau dua area state.

Dalam Git, state yang sering dibandingkan adalah:

| State | Arti |
|---|---|
| Working tree | File aktual yang sedang ada di filesystem kamu |
| Index / staging area | Snapshot kandidat commit berikutnya |
| `HEAD` | Commit saat ini |
| Commit tertentu | Snapshot historis tertentu |
| Branch | Pointer ke commit tertentu |
| Tag | Pointer stabil ke commit/object tertentu |
| Merge base | Common ancestor dua branch |

Karena itu, pertanyaan pertama sebelum membaca diff adalah:

```text
Apa state kiri?
Apa state kanan?
Apa makna perbandingan ini?
```

Jika kamu salah menjawab tiga pertanyaan ini, kamu bisa salah membaca PR, salah menyimpulkan dampak perubahan, atau salah melakukan review.

---

## 2. Diff Bukan Patch yang Selalu Pernah Terjadi

Misalkan ada history:

```text
A---B---C  main
     \
      D---E  feature
```

Diff antara `main` dan `feature` dapat dihitung dengan beberapa cara:

```bash
git diff main feature
```

Artinya kira-kira:

```text
Bandingkan snapshot di commit C dengan snapshot di commit E.
```

Hasilnya bukan berarti Git sedang menampilkan “urutan perubahan D lalu E”. Git hanya menghitung perbedaan final antara C dan E.

Ini penting.

Jika file berubah di `main` dan `feature` secara bersamaan, diff final bisa terlihat sebagai konflik konsep, walaupun perubahan itu berasal dari dua jalur history yang berbeda.

Diff adalah hasil komputasi antara dua state. Ia bukan selalu rekaman kronologis.

---

## 3. Empat Area Dasar yang Harus Dikuasai

Dalam daily workflow, sebagian besar diff terjadi antara empat area berikut:

```text
Working Tree  <->  Index  <->  HEAD  <->  Other Commits/Branches
```

Visual sederhana:

```text
                 git add
Working Tree  ------------>  Index  ------------>  HEAD
               git restore           git commit

Working Tree = perubahan nyata di file system
Index        = kandidat snapshot commit berikutnya
HEAD         = commit saat ini
```

Diff command default mengasumsikan area tertentu.

Ini yang sering membuat engineer bingung.

---

## 4. `git diff`: Working Tree vs Index

Command:

```bash
git diff
```

Maknanya:

```text
Bandingkan working tree dengan index.
```

Dengan kata lain:

```text
Apa perubahan yang sudah ada di file saya, tetapi belum distage?
```

Contoh:

```bash
echo "new validation" >> src/main/java/com/acme/UserService.java
git diff
```

Jika file belum di-`git add`, perubahan muncul di `git diff`.

Setelah:

```bash
git add src/main/java/com/acme/UserService.java
git diff
```

Mungkin hasilnya kosong.

Bukan karena perubahan hilang, tetapi karena perubahan itu sekarang sudah masuk index.

Untuk melihat staged diff, gunakan command lain.

---

## 5. `git diff --cached` / `git diff --staged`: Index vs HEAD

Command:

```bash
git diff --cached
```

atau:

```bash
git diff --staged
```

Maknanya:

```text
Bandingkan index dengan HEAD.
```

Dengan kata lain:

```text
Apa isi commit berikutnya jika saya menjalankan git commit sekarang?
```

Ini command wajib sebelum commit.

Untuk engineer yang serius, flow aman sebelum commit adalah:

```bash
git status
git diff
git diff --staged
git commit
```

`git diff` menjawab:

```text
Apa yang belum saya stage?
```

`git diff --staged` menjawab:

```text
Apa yang akan masuk commit?
```

---

## 6. `git diff HEAD`: Working Tree vs HEAD

Command:

```bash
git diff HEAD
```

Maknanya:

```text
Bandingkan working tree dengan HEAD, termasuk staged dan unstaged changes.
```

Ini sering berguna jika kamu ingin melihat total perubahan lokal terhadap commit terakhir.

Perhatikan bedanya:

| Command | Membandingkan | Pertanyaan yang dijawab |
|---|---|---|
| `git diff` | Working tree vs index | Apa yang belum staged? |
| `git diff --staged` | Index vs HEAD | Apa yang staged untuk commit? |
| `git diff HEAD` | Working tree vs HEAD | Apa total perubahan lokal terhadap commit terakhir? |

Jika kamu hanya menghafal command, ini membingungkan.

Jika kamu melihatnya sebagai state comparison, semuanya konsisten.

---

## 7. Latihan Mini: Rasakan Tiga Diff Dasar

Buat repository latihan:

```bash
mkdir git-diff-lab
cd git-diff-lab
git init
mkdir -p src/main/java/com/acme
cat > src/main/java/com/acme/UserService.java <<'EOF'
package com.acme;

public class UserService {
    public boolean isActive(String status) {
        return "ACTIVE".equals(status);
    }
}
EOF

git add .
git commit -m "Add initial user service"
```

Ubah file:

```bash
perl -0pi -e 's/return "ACTIVE"\.equals\(status\);/return status != null \&\& "ACTIVE".equals(status);/' src/main/java/com/acme/UserService.java
```

Lihat diff:

```bash
git diff
```

Stage file:

```bash
git add src/main/java/com/acme/UserService.java
```

Sekarang:

```bash
git diff
```

Akan kosong.

Lalu:

```bash
git diff --staged
```

Akan menunjukkan perubahan.

Ubah file lagi:

```bash
cat >> src/main/java/com/acme/UserService.java <<'EOF'

// TODO: remove later
EOF
```

Sekarang jalankan:

```bash
git diff
git diff --staged
git diff HEAD
```

Kamu akan melihat tiga perspektif berbeda:

- unstaged TODO comment,
- staged null-check,
- total perubahan gabungan.

Mental model ini harus otomatis sebelum masuk branching, rebase, atau review.

---

## 8. Diff antar Commit

Command umum:

```bash
git diff A B
```

atau:

```bash
git diff A..B
```

Untuk `git diff`, dua bentuk ini pada dasarnya berarti:

```text
Bandingkan snapshot A dengan snapshot B.
```

Contoh:

```bash
git diff HEAD~1 HEAD
```

Maknanya:

```text
Apa perbedaan commit sebelumnya dengan commit sekarang?
```

Contoh lain:

```bash
git diff v1.2.0 v1.3.0
```

Maknanya:

```text
Apa perbedaan snapshot release v1.2.0 dan v1.3.0?
```

Ini berguna untuk:

- release review,
- audit perubahan,
- regression investigation,
- comparing production tag dengan current main,
- validating hotfix content.

---

## 9. Diff Branch vs Branch

Misalkan:

```text
A---B---C  main
     \
      D---E  feature
```

Command:

```bash
git diff main feature
```

atau:

```bash
git diff main..feature
```

Makna:

```text
Bandingkan snapshot main sekarang (C) dengan snapshot feature sekarang (E).
```

Ini menjawab:

```text
Apa perbedaan final antara dua branch sekarang?
```

Tetapi sering kali saat review feature branch, pertanyaan yang sebenarnya adalah:

```text
Apa perubahan yang diperkenalkan oleh feature sejak bercabang dari main?
```

Untuk itu, biasanya three-dot lebih tepat.

---

## 10. Two-Dot vs Three-Dot: Salah Paham Paling Mahal

Ada dua bentuk yang sering muncul:

```bash
git diff main..feature
```

```bash
git diff main...feature
```

Untuk `git diff`, maknanya berbeda.

### 10.1 Two-dot diff

```bash
git diff main..feature
```

Makna praktis:

```text
Bandingkan snapshot main dengan snapshot feature.
```

Sama seperti:

```bash
git diff main feature
```

### 10.2 Three-dot diff

```bash
git diff main...feature
```

Makna praktis:

```text
Bandingkan merge-base(main, feature) dengan feature.
```

Atau:

```bash
git diff $(git merge-base main feature) feature
```

Dengan graph:

```text
A---B---C  main
     \
      D---E  feature
```

Merge base `main` dan `feature` adalah `B`.

Maka:

```bash
git diff main...feature
```

artinya:

```text
Bandingkan B dengan E.
```

Ini biasanya menjawab:

```text
Apa perubahan yang dibuat oleh feature branch sejak bercabang dari main?
```

---

## 11. Kenapa Pull Request Biasanya Memakai Three-Dot

Dalam review PR, reviewer biasanya ingin tahu:

```text
Apa yang branch ini tambahkan dibanding common ancestor-nya dengan target branch?
```

Bukan:

```text
Apa perbedaan final antara branch ini dan main yang terus bergerak?
```

Misalkan `main` maju setelah feature dibuat:

```text
A---B---C---F---G  main
     \
      D---E        feature
```

`git diff main..feature` membandingkan `G` dengan `E`.

Hasilnya dapat mencampurkan:

- perubahan feature,
- perubahan yang ada di main tetapi tidak ada di feature,
- efek divergensi dua branch.

Sedangkan:

```bash
git diff main...feature
```

membandingkan:

```text
B -> E
```

Ini lebih dekat dengan “isi PR”.

Namun, ada konsekuensi penting:

Jika feature branch sudah outdated terhadap main, three-dot diff bisa tampak bersih, tetapi branch tetap bisa gagal merge/test setelah digabung dengan main terbaru.

Diff review tidak menggantikan integrasi.

---

## 12. Kesalahan Umum: Mengira `..` dan `...` Sama antara `log` dan `diff`

Hati-hati.

Untuk `git diff`:

```bash
git diff A..B
```

hampir sama dengan:

```bash
git diff A B
```

Sedangkan:

```bash
git diff A...B
```

berarti:

```text
merge-base(A, B) -> B
```

Tetapi untuk `git log`, range memiliki makna reachability commit, bukan snapshot comparison.

Contoh:

```bash
git log A..B
```

berarti:

```text
Commit yang reachable dari B tetapi tidak reachable dari A.
```

Sedangkan:

```bash
git log A...B
```

berarti:

```text
Commit yang reachable dari A atau B, tetapi bukan dari keduanya.
```

Jadi jangan menyamakan mental model `diff` dan `log` secara buta.

Ringkasnya:

| Command | Fokus |
|---|---|
| `git diff` | Membandingkan snapshot/state |
| `git log` | Menyeleksi commit berdasarkan reachability |

---

## 13. Diff Direction: A ke B Itu Bermakna

Command:

```bash
git diff A B
```

berarti:

```text
Tampilkan patch yang mengubah A menjadi B.
```

Jika dibalik:

```bash
git diff B A
```

maka merah/hijau juga terbalik.

Untuk review, direction penting.

```bash
git diff main...feature
```

menjawab:

```text
Apa yang perlu diterapkan ke merge-base agar menjadi feature?
```

Sedangkan:

```bash
git diff feature...main
```

menjawab:

```text
Apa yang perlu diterapkan ke merge-base agar menjadi main?
```

Keduanya bukan hal yang sama.

---

## 14. Membaca Format Diff

Contoh diff:

```diff
diff --git a/src/main/java/com/acme/UserService.java b/src/main/java/com/acme/UserService.java
index 1a2b3c4..5d6e7f8 100644
--- a/src/main/java/com/acme/UserService.java
+++ b/src/main/java/com/acme/UserService.java
@@ -3,7 +3,10 @@ package com.acme;
 public class UserService {
     public boolean isActive(String status) {
-        return "ACTIVE".equals(status);
+        if (status == null) {
+            return false;
+        }
+        return "ACTIVE".equals(status);
     }
 }
```

Bagian penting:

```text
diff --git a/file b/file
```

Menunjukkan file yang dibandingkan.

```text
index 1a2b3c4..5d6e7f8 100644
```

Menunjukkan object id lama dan baru, plus file mode.

```text
--- a/file
+++ b/file
```

Menunjukkan sisi kiri dan kanan perbandingan.

```text
@@ -3,7 +3,10 @@
```

Disebut hunk header.

Artinya kira-kira:

- di file lama, hunk mulai sekitar line 3, panjang 7 baris,
- di file baru, hunk mulai sekitar line 3, panjang 10 baris.

Baris:

```diff
- old line
+ new line
```

Minus adalah sisi kiri.

Plus adalah sisi kanan.

Bukan selalu “dihapus dari repository” dan “ditambahkan ke repository” secara absolut. Ia relatif terhadap direction diff.

---

## 15. Hunk Context: Kenapa Diff Menampilkan Baris yang Tidak Berubah

Diff sering menampilkan beberapa baris sekitar perubahan.

Contoh:

```diff
@@ -10,6 +10,9 @@ public class UserService {
     public User findById(String id) {
+        if (id == null) {
+            throw new IllegalArgumentException("id must not be null");
+        }
         return repository.findById(id);
     }
 }
```

Baris tanpa `+` atau `-` adalah context.

Context membantu:

- memahami lokasi perubahan,
- menerapkan patch,
- melihat struktur method/class,
- menilai apakah perubahan berada di tempat yang benar.

Kamu bisa mengatur jumlah context:

```bash
git diff -U1
```

atau:

```bash
git diff -U10
```

Untuk review design-level, context lebih banyak sering membantu.

Untuk melihat perubahan ringkas, context sedikit lebih mudah.

---

## 16. Word Diff: Berguna untuk Perubahan Kecil dalam Satu Baris

Untuk Java, banyak perubahan terjadi dalam satu baris panjang:

```java
return user != null && user.isActive() && !user.isLocked();
```

Diff line-based bisa kurang jelas.

Gunakan:

```bash
git diff --word-diff
```

atau:

```bash
git diff --word-diff=color
```

Contoh perubahan:

```java
return user != null && user.isActive() && !user.isLocked();
```

menjadi:

```java
return user != null && user.isActive() && !user.isSuspended();
```

Word diff membantu melihat bahwa yang berubah hanya `isLocked()` menjadi `isSuspended()`.

Untuk review Java, word diff berguna pada:

- boolean expression,
- SQL string,
- annotation value,
- regex,
- config property,
- long method chain,
- JSON/YAML inline value.

Namun hati-hati: word diff bisa terlalu noisy pada reformat besar.

---

## 17. Stat, Shortstat, dan Numstat

Kadang kamu tidak butuh patch detail dulu. Kamu butuh ukuran perubahan.

```bash
git diff --stat
```

Contoh output:

```text
 src/main/java/com/acme/UserService.java | 12 +++++++-----
 src/test/java/com/acme/UserServiceTest.java | 30 ++++++++++++++++++++++++++++++
 2 files changed, 37 insertions(+), 5 deletions(-)
```

Gunakan untuk overview.

```bash
git diff --shortstat
```

Output ringkas:

```text
2 files changed, 37 insertions(+), 5 deletions(-)
```

```bash
git diff --numstat
```

Output machine-readable:

```text
7       5       src/main/java/com/acme/UserService.java
30      0       src/test/java/com/acme/UserServiceTest.java
```

`--numstat` berguna untuk script, CI checks, atau review metrics.

Tetapi ukuran diff bukan ukuran risiko.

Perubahan 2 baris pada authorization logic bisa lebih berbahaya daripada perubahan 500 baris rename package.

---

## 18. Name-Only dan Name-Status

Untuk mengetahui file apa saja yang berubah:

```bash
git diff --name-only main...feature
```

Untuk mengetahui status file:

```bash
git diff --name-status main...feature
```

Contoh:

```text
M       src/main/java/com/acme/UserService.java
A       src/test/java/com/acme/UserServiceTest.java
D       src/main/java/com/acme/LegacyValidator.java
R100    src/main/java/com/acme/UserValidator.java src/main/java/com/acme/AccountValidator.java
```

Status umum:

| Status | Arti |
|---|---|
| `M` | Modified |
| `A` | Added |
| `D` | Deleted |
| `R` | Renamed |
| `C` | Copied |

Ini sering dipakai sebelum review mendalam:

```bash
git diff --name-status origin/main...HEAD
```

Pertanyaan review awal:

```text
Area mana yang berubah?
Apakah file yang berubah sesuai scope task?
Ada file generated/build artifact ikut masuk?
Ada config/security file berubah diam-diam?
```

---

## 19. Diff per Path

Untuk membatasi diff ke file/folder tertentu:

```bash
git diff main...feature -- src/main/java/com/acme/user
```

Format umum:

```bash
git diff <left> <right> -- <pathspec>
```

`--` memisahkan revision dari path.

Ini penting jika nama branch dan nama file ambigu.

Contoh:

```bash
git diff HEAD -- pom.xml
```

Artinya:

```text
Bandingkan pom.xml di working tree dengan pom.xml di HEAD.
```

Untuk Java engineer, path filtering sangat berguna untuk:

- review hanya module tertentu,
- melihat perubahan dependency di `pom.xml` atau `build.gradle`,
- memisahkan source code vs tests,
- memeriksa config deployment,
- memeriksa generated code.

Contoh:

```bash
git diff main...feature -- '**/pom.xml'
git diff main...feature -- '**/build.gradle*'
git diff main...feature -- src/main/resources/application.yml
```

---

## 20. Diff dengan Pathspec Magic

Git mendukung pathspec yang lebih kuat.

Contoh exclude:

```bash
git diff main...feature -- . ':(exclude)**/generated/**'
```

Contoh hanya Java files:

```bash
git diff main...feature -- '*.java'
```

Contoh exclude test:

```bash
git diff main...feature -- 'src/main/**' ':(exclude)src/test/**'
```

Hati-hati shell expansion. Kadang pattern perlu dikutip agar diproses Git, bukan shell.

Untuk repository besar, pathspec yang tepat menghemat waktu review.

---

## 21. Rename Detection: Rename Tidak Disimpan sebagai Rename

Git tidak menyimpan operasi rename sebagai metadata permanen di commit.

Git menyimpan snapshot. Saat diff diminta, Git mencoba mendeteksi rename berdasarkan similarity.

Command:

```bash
git diff -M
```

atau:

```bash
git diff --find-renames
```

Contoh:

```bash
git diff --find-renames --name-status main...feature
```

Output:

```text
R087    src/main/java/com/acme/UserDto.java    src/main/java/com/acme/dto/UserResponse.java
```

Artinya Git menganggap file lama dan file baru memiliki similarity 87%.

Atur threshold:

```bash
git diff -M90%
```

Makna:

```text
Anggap rename hanya jika similarity minimal 90%.
```

### Kenapa ini penting?

Refactor Java sering melibatkan:

- rename class,
- move package,
- split module,
- move test,
- rename DTO,
- move controller/service/repository.

Jika rename tidak terdeteksi, review terlihat sebagai delete + add besar. Itu membuat reviewer sulit melihat perubahan meaningful.

Strategi terbaik:

```text
Pisahkan commit rename/move dari commit behavioral change.
```

Contoh commit sequence:

```text
1. Move UserService to account package without behavior changes
2. Add account status validation
3. Add tests for suspended account behavior
```

Ini jauh lebih reviewable daripada satu commit berisi move + logic change + formatting.

---

## 22. Copy Detection

Git juga bisa mendeteksi copy:

```bash
git diff -C
```

atau:

```bash
git diff --find-copies
```

Ini berguna saat:

- class lama dijadikan basis class baru,
- test fixture disalin,
- migration script dibuat dari script lama,
- adapter baru dibuat dari adapter serupa.

Namun copy detection lebih mahal secara performa dan kadang noisy.

Gunakan saat investigasi atau review khusus, bukan selalu default.

---

## 23. Whitespace Diff: Noise yang Bisa Merusak Review

Whitespace noise umum terjadi karena:

- IDE auto-format,
- line endings CRLF/LF,
- trailing spaces,
- indentation changes,
- import organizer,
- formatter version berbeda,
- tab vs spaces,
- reformat whole file.

Command berguna:

```bash
git diff -w
```

Abaikan semua whitespace.

```bash
git diff --ignore-space-change
```

Abaikan perubahan jumlah whitespace.

```bash
git diff --ignore-blank-lines
```

Abaikan perubahan blank line.

Untuk melihat whitespace error:

```bash
git diff --check
```

Ini bisa mendeteksi whitespace problem seperti trailing whitespace.

Namun jangan selalu mengabaikan whitespace.

Dalam beberapa file, whitespace bermakna:

- YAML,
- Python,
- Makefile,
- Markdown table,
- SQL formatting tertentu,
- shell script heredoc,
- properties dengan trailing spaces yang intentional.

Untuk Java, whitespace biasanya tidak mengubah semantics, tetapi bisa mempengaruhi readability dan blame noise.

---

## 24. Move Detection dalam File

Kadang kode dipindah dalam file yang sama.

Gunakan:

```bash
git diff --color-moved
```

Ini membantu melihat blok yang sebenarnya hanya dipindah.

Untuk refactor Java, ini berguna saat:

- method dipindah posisinya,
- helper method dikelompokkan ulang,
- nested class dipindah,
- large class direorganisasi.

Untuk mengabaikan whitespace saat mendeteksi moved code:

```bash
git diff --color-moved --color-moved-ws=ignore-all-space
```

Gunakan saat review refactor struktural.

---

## 25. Algorithm Diff: Myers, Minimal, Patience, Histogram

Git mendukung beberapa algoritma diff.

Default umumnya berbasis Myers. Namun untuk beberapa perubahan, algoritma lain lebih mudah dibaca.

Contoh:

```bash
git diff --patience
```

atau:

```bash
git diff --histogram
```

### Kapan berguna?

Gunakan `--patience` atau `--histogram` ketika diff terlihat kacau padahal perubahan manusiawinya sederhana.

Contoh kasus:

- reorder method,
- reorder imports,
- reorder enum values,
- move block code,
- large refactor,
- repeated similar lines,
- generated-ish code.

`--histogram` sering menghasilkan diff yang lebih intuitif pada source code.

Prinsip:

```text
Diff algorithm does not change repository state.
It changes how comparison is presented.
```

Jangan ubah kode hanya karena diff default buruk. Coba algoritma diff lain dulu.

---

## 26. External Diff Tool dan IDE Diff

CLI diff penting karena portable dan scriptable.

Tetapi untuk perubahan kompleks, IDE diff bisa membantu:

- IntelliJ IDEA diff,
- VS Code diff,
- Beyond Compare,
- Meld,
- Kaleidoscope,
- Araxis Merge.

Git bisa dikonfigurasi:

```bash
git difftool
```

Namun jangan bergantung penuh pada UI.

Senior engineer perlu bisa membaca diff mentah karena:

- CI logs berbasis teks,
- patch email berbasis teks,
- server/headless environment,
- forensic/debugging sering via terminal,
- review cepat sering butuh command line.

Idealnya:

```text
CLI for precision and automation.
IDE/UI for spatial comprehension and complex review.
```

---

## 27. Diff untuk Review Java: Apa yang Harus Dilihat

Saat membaca diff Java, jangan hanya cari “baris berubah”. Cari perubahan terhadap behavior, contract, state, dan failure mode.

Checklist review:

```text
1. Public API berubah?
2. Method signature berubah?
3. Nullability berubah?
4. Exception behavior berubah?
5. Transaction boundary berubah?
6. Authorization/validation berubah?
7. Persistence mapping berubah?
8. Query/database access berubah?
9. Serialization/deserialization berubah?
10. Thread-safety atau shared state berubah?
11. Timeout/retry/circuit breaker berubah?
12. Logging/observability berubah?
13. Configuration default berubah?
14. Test benar-benar mengunci behavior baru?
15. Migration/backward compatibility aman?
```

Diff kecil bisa membawa perubahan besar.

Contoh:

```diff
- if (user.isAdmin() && request.isInternal()) {
+ if (user.isAdmin() || request.isInternal()) {
```

Satu karakter berubah dari `&&` ke `||` dapat mengubah model authorization secara drastis.

Review diff Java harus berpikir di atas syntax.

---

## 28. Diff untuk Dependency Change

Perubahan dependency sering terlihat sederhana:

```diff
- <version>2.6.8</version>
+ <version>2.7.0</version>
```

Tetapi dampaknya bisa besar:

- transitive dependency berubah,
- security patch masuk,
- breaking change minor/major,
- behavior default berubah,
- dependency conflict berubah,
- classpath order berubah,
- plugin build berubah,
- generated source berubah.

Saat melihat diff `pom.xml`, `build.gradle`, atau lockfile, tanyakan:

```text
Apakah ini compile dependency, runtime dependency, test dependency, plugin, atau annotation processor?
Apa transitive dependency yang ikut berubah?
Apakah ada CVE/security motivation?
Apakah build reproducible?
Apakah CI dan local environment sama?
```

Command pembantu Maven:

```bash
mvn dependency:tree
```

Command pembantu Gradle:

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency <name>
```

Git diff menunjukkan file berubah. Tool build menunjukkan graph dependency berubah.

Gabungkan keduanya.

---

## 29. Diff untuk Config Change

Config change sering lebih berisiko daripada code change.

Contoh file:

- `application.yml`,
- `application-prod.yml`,
- Helm values,
- Dockerfile,
- Kubernetes manifest,
- Terraform,
- CI workflow,
- feature flag config,
- logback config.

Pertanyaan review:

```text
Apakah default berubah?
Apakah environment tertentu terdampak?
Apakah secret muncul?
Apakah timeout/retry berubah?
Apakah limit/rate/concurrency berubah?
Apakah config backward compatible?
Apakah perubahan ini aman untuk rollback?
Apakah config key lama masih dipakai?
```

Contoh diff kecil:

```diff
-service.timeout-ms: 3000
+service.timeout-ms: 30000
```

Ini bisa mempengaruhi:

- latency,
- thread pool exhaustion,
- retry storm,
- circuit breaker behavior,
- user experience,
- incident duration.

Git diff hanya menunjukkan angka berubah. Engineer harus memahami operational consequence.

---

## 30. Diff untuk Test

Perubahan test harus dibaca sebagai perubahan kontrak behavior.

Tanyakan:

```text
Apakah test baru mengunci bug fix?
Apakah assertion kuat atau terlalu longgar?
Apakah hanya snapshot update tanpa validasi intent?
Apakah test menghapus coverage penting?
Apakah mock behavior berubah mengikuti implementasi, bukan requirement?
Apakah flaky test diperkenalkan?
```

Contoh diff berbahaya:

```diff
- assertEquals("ACTIVE", user.status());
+ assertNotNull(user.status());
```

Ini membuat test lebih lemah.

Contoh lain:

```diff
- verify(notificationService).sendWelcomeEmail(user);
+ verifyNoMoreInteractions(notificationService);
```

Perubahan kecil, tetapi behavior expectation berubah besar.

Review test diff bukan formalitas. Test adalah executable specification.

---

## 31. Diff untuk Generated Code

Generated code adalah area yang harus diperlakukan hati-hati.

Contoh:

- OpenAPI generated clients,
- protobuf generated Java,
- jOOQ generated classes,
- MapStruct generated code,
- annotation processor output,
- GraphQL generated models.

Pertanyaan:

```text
Apakah generated code memang harus committed?
Apakah source generator/spec berubah juga?
Apakah hasil generated konsisten dengan versi generator?
Apakah diff besar ini reviewable?
Apakah generated diff menyembunyikan perubahan source of truth kecil?
```

Strategi yang sering baik:

```text
Commit 1: ubah source of truth/spec.
Commit 2: regenerate output tanpa manual edit.
```

Ini membantu reviewer membedakan intent dari artifact.

---

## 32. Diff untuk Binary File

Git diff buruk untuk binary.

Jika binary berubah, output bisa hanya:

```text
Binary files a/file.jar and b/file.jar differ
```

Untuk Java repository, binary yang sering muncul:

- `.jar`,
- `.war`,
- `.class`,
- image test fixture,
- PDF fixture,
- keystore/truststore,
- database dump,
- generated archive.

Pertanyaan:

```text
Apakah binary ini seharusnya masuk Git?
Apakah ada checksum/version info?
Apakah artifact repository lebih tepat?
Apakah perubahan binary bisa direview?
Apakah binary mengandung secret?
```

Jika binary memang harus ada, gunakan `.gitattributes` untuk diff driver tertentu atau dokumentasikan sumbernya.

Tetapi default policy yang sehat:

```text
Source code and small intentional fixtures may live in Git.
Build artifacts should not.
```

---

## 33. `.gitattributes` dan Custom Diff Driver

`.gitattributes` bisa mengatur cara Git memperlakukan file tertentu.

Contoh:

```gitattributes
*.java text eol=lf
*.sh text eol=lf
*.bat text eol=crlf
*.png binary
*.jpg binary
*.pdf binary
```

Custom diff driver bisa dipakai untuk file tertentu.

Contoh untuk file XML agar function context lebih baik, atau untuk file lock tertentu.

Konsepnya:

```text
Repository dapat mendefinisikan policy diff dan text/binary behavior.
```

Ini penting untuk tim lintas OS dan repository besar.

Bagian line endings dan `.gitattributes` akan dibahas lebih dalam di Part 022.

---

## 34. Diff dan Patch

Diff bisa disimpan sebagai patch:

```bash
git diff > changes.patch
```

Patch bisa diterapkan:

```bash
git apply changes.patch
```

Cek apakah patch bisa diterapkan:

```bash
git apply --check changes.patch
```

Untuk staged changes:

```bash
git diff --staged > staged.patch
```

Patch berguna untuk:

- sharing perubahan tanpa push,
- menyimpan experiment,
- code review offline,
- applying vendor patch,
- debugging CI issue,
- transfer perubahan antar repo mirip.

Tetapi patch tidak membawa metadata commit seperti author, message, parent, dan signature.

Jika ingin preserve commit metadata, gunakan format-patch/am.

Akan dibahas lebih lanjut di bagian lanjutan/release/migration.

---

## 35. `git diff --exit-code` untuk Automation

Command:

```bash
git diff --exit-code
```

Akan exit non-zero jika ada diff.

Ini berguna untuk CI.

Contoh: memastikan formatter tidak meninggalkan perubahan:

```bash
./gradlew spotlessApply
git diff --exit-code
```

Jika formatter mengubah file, CI gagal.

Contoh lain: memastikan generated code up-to-date:

```bash
./gradlew generateSources
git diff --exit-code
```

Jika generated output berubah, berarti developer lupa commit hasil generate atau generator tidak deterministik.

Untuk staged diff:

```bash
git diff --cached --exit-code
```

Automation dengan diff sangat kuat karena Git bisa menjadi detector state drift.

---

## 36. `git diff --quiet`

Mirip `--exit-code`, tetapi tidak mencetak output.

```bash
git diff --quiet || echo "There are unstaged changes"
```

Berguna untuk script.

Contoh:

```bash
if ! git diff --quiet; then
  echo "Working tree has unstaged changes"
  exit 1
fi
```

Gunakan saat output patch tidak diperlukan.

---

## 37. Diff dalam Pre-Commit Mindset

Sebelum commit, urutan sehat:

```bash
git status --short
git diff
git diff --staged
git diff --check
```

Makna:

1. `git status --short`: overview file state.
2. `git diff`: pastikan tidak ada perubahan tertinggal di working tree.
3. `git diff --staged`: review isi commit.
4. `git diff --check`: cek whitespace error.

Untuk commit penting, tambahkan:

```bash
git diff --staged --stat
git diff --staged --name-status
```

Tujuannya bukan memperlambat kerja. Tujuannya menghindari commit sampah, file rahasia, generated noise, atau perubahan unrelated.

---

## 38. Diff dalam Pull Request Mindset

Sebelum membuka PR:

```bash
git fetch origin
git diff --name-status origin/main...HEAD
git diff --stat origin/main...HEAD
git diff origin/main...HEAD
```

Pertanyaan:

```text
Apakah scope file sesuai task?
Apakah diff terlalu besar untuk satu review?
Apakah ada perubahan unrelated?
Apakah commit perlu dipecah?
Apakah branch perlu update dari main?
Apakah test mengikuti behavior?
Apakah config/dependency/security file berubah?
```

Jika diff terlalu besar, jangan otomatis squash. Mungkin perlu memecah commit atau PR.

Reviewability adalah engineering property.

---

## 39. Diff dalam Release Mindset

Untuk release:

```bash
git diff --stat v1.2.0..v1.3.0
git diff --name-status v1.2.0..v1.3.0
git diff v1.2.0..v1.3.0 -- pom.xml build.gradle settings.gradle
```

Pertanyaan:

```text
Apa dependency berubah?
Apa migration berubah?
Apa config production berubah?
Apa public API berubah?
Apa generated contract berubah?
Apa module baru masuk?
Apa file yang tidak seharusnya ikut release?
```

Untuk regulated systems, diff release bisa menjadi bagian evidence.

Tetapi evidence yang baik bukan hanya raw diff. Perlu dikaitkan dengan:

- issue/ticket,
- PR,
- approval,
- test result,
- build artifact,
- deployment record,
- rollback plan.

---

## 40. Diff dalam Incident / Regression Mindset

Saat incident, diff membantu menjawab:

```text
Apa yang berubah sejak release terakhir yang sehat?
```

Command:

```bash
git diff --name-status last-known-good..production
```

atau:

```bash
git diff last-known-good..production -- src/main/java src/main/resources
```

Jika kamu punya tag:

```bash
git diff v1.2.3..v1.2.4
```

Kamu bisa fokus pada area rawan:

```bash
git diff v1.2.3..v1.2.4 -- '**/Security*.java' '**/Auth*.java' '**/application*.yml'
```

Namun diff hanya menunjukkan perubahan. Untuk menemukan commit penyebab regresi secara sistematis, nanti kita pakai `git bisect` di Part 019.

---

## 41. Diff dan Semantic Conflict

Git diff bisa menunjukkan textual changes. Git tidak selalu memahami semantic changes.

Contoh dua branch:

Branch A:

```java
public BigDecimal calculateFee(Order order) {
    return order.total().multiply(new BigDecimal("0.02"));
}
```

Branch B:

```java
public BigDecimal calculateFee(Order order) {
    return order.totalAfterDiscount().multiply(new BigDecimal("0.02"));
}
```

Mungkin tidak ada conflict jika perubahan terjadi di tempat berbeda. Tetapi secara bisnis, perubahan bisa bertabrakan.

Semantic conflict bisa terjadi pada:

- contract API,
- database migration,
- validation logic,
- feature flag semantics,
- authorization matrix,
- idempotency behavior,
- event schema,
- retry behavior,
- config default.

Diff adalah input untuk reasoning, bukan pengganti reasoning.

---

## 42. Diff Kecil, Risiko Besar

Contoh diff kecil:

```diff
- @Transactional(readOnly = true)
+ @Transactional
```

Dampak potensial:

- write transaction terbuka,
- locking behavior berubah,
- performance berubah,
- database side effect mungkin terjadi.

Contoh:

```diff
- private static final int MAX_RETRY = 3;
+ private static final int MAX_RETRY = 30;
```

Dampak:

- retry storm,
- downstream pressure,
- latency meningkat,
- incident blast radius membesar.

Contoh:

```diff
- .orElseThrow(() -> new NotFoundException(id));
+ .orElse(null);
```

Dampak:

- null propagation,
- NPE downstream,
- error semantics berubah,
- API behavior berubah.

Jangan mengukur risiko dari jumlah baris.

---

## 43. Diff Besar, Risiko Kecil

Contoh diff besar yang bisa relatif rendah risiko:

- rename package tanpa behavior change,
- reformat kode dengan formatter konsisten,
- generated code setelah spec update kecil,
- moving class antar module tanpa logic change,
- update copyright header.

Tetapi hanya rendah risiko jika:

```text
1. Terisolasi dari behavior change.
2. Tooling deterministik.
3. Tests cukup kuat.
4. Reviewer bisa memverifikasi intent.
5. Commit/PR tidak mencampur perubahan semantik.
```

Karena itu commit hygiene sangat mempengaruhi readability diff.

---

## 44. Strategi Membuat Diff yang Mudah Direview

Engineer kuat tidak hanya membaca diff. Ia membuat diff yang membantu orang lain berpikir.

Strategi:

### 44.1 Pisahkan mechanical change dari behavioral change

Buruk:

```text
Rename package + reformat + change validation logic + update tests dalam satu commit
```

Baik:

```text
1. Move account classes to account package
2. Apply formatter after package move
3. Add suspended account validation
4. Add tests for suspended account validation
```

### 44.2 Hindari drive-by changes

Jika sedang fix bug authorization, jangan sekalian rename variable unrelated di payment service.

### 44.3 Stage secara selektif

Gunakan:

```bash
git add -p
```

atau IDE partial staging.

### 44.4 Review diff sendiri sebelum meminta review orang lain

```bash
git diff origin/main...HEAD
```

Jika kamu sendiri kesulitan menjelaskan diff, reviewer juga akan kesulitan.

### 44.5 Buat commit message sesuai intent

Diff menunjukkan what. Commit message harus menjelaskan why.

---

## 45. `git add -p` sebagai Diff-Driven Commit Sculpting

`git add -p` memungkinkan staging sebagian hunk.

```bash
git add -p
```

Pilihan umum:

| Key | Arti |
|---|---|
| `y` | stage hunk ini |
| `n` | jangan stage hunk ini |
| `s` | split hunk |
| `e` | edit hunk manual |
| `q` | quit |
| `?` | help |

Ini sangat berguna ketika satu file mengandung beberapa intent.

Contoh satu file berubah untuk:

- null-check,
- logging improvement,
- rename variable,
- formatting.

Dengan `git add -p`, kamu bisa membuat commit atomic walau editing dilakukan bersamaan.

Namun jangan jadikan ini alasan bekerja serampangan. Lebih baik tetap mengedit dengan intent jelas.

---

## 46. Diff dan Index sebagai Review Buffer

Index adalah buffer untuk menyusun commit.

Flow:

```bash
# Edit banyak hal
git diff

# Stage hanya satu intent
git add -p

# Review kandidat commit
git diff --staged

# Commit
git commit -m "Validate suspended account before login"
```

Lalu ulangi untuk intent lain.

Mental model:

```text
Working tree = raw workshop
Index        = curated commit draft
HEAD         = accepted history
```

Diff adalah kaca pembesar untuk memindahkan perubahan dari workshop ke history.

---

## 47. Membandingkan Branch Lokal dengan Remote

Command penting:

```bash
git fetch origin
git diff origin/main...HEAD
```

Makna:

```text
Apa isi branch saya terhadap main terbaru dari origin?
```

Jangan hanya pakai local `main` jika belum fetch.

```bash
git diff main...HEAD
```

bisa misleading jika `main` lokal stale.

Flow aman sebelum PR:

```bash
git fetch origin
git status
git log --oneline --graph --decorate --all --max-count=20
git diff --name-status origin/main...HEAD
git diff origin/main...HEAD
```

Ini mencegah review berdasarkan target branch yang sudah ketinggalan.

---

## 48. Diff Setelah Rebase atau Merge

Setelah rebase:

```bash
git diff origin/main...HEAD
```

Pastikan isi branch masih sesuai intent.

Setelah merge main ke feature:

```bash
git diff origin/main...HEAD
```

Perhatikan bahwa merge base bisa berubah.

Kadang PR diff berubah setelah merge/rebase bukan karena feature berubah, tetapi karena base berubah.

Jika PR tiba-tiba besar/kecil, cek:

```bash
git merge-base origin/main HEAD
git log --oneline --graph --decorate origin/main HEAD
```

Jangan langsung panik. Pahami graph-nya.

---

## 49. Diff untuk Merge Commit

Merge commit memiliki lebih dari satu parent.

Misalkan merge commit `M`:

```text
A---B---C------M
     \        /
      D---E---
```

Untuk melihat diff merge commit terhadap parent pertama:

```bash
git diff M^1 M
```

Terhadap parent kedua:

```bash
git diff M^2 M
```

Untuk melihat combined diff:

```bash
git show --cc M
```

Merge diff bisa membingungkan karena merge commit sering tidak hanya “isi branch”, tetapi juga hasil resolusi konflik.

Saat review merge commit, fokus pada:

```text
Apakah ada manual conflict resolution?
Apakah resolusi mengubah behavior?
Apakah test dijalankan setelah merge?
Apakah ada perubahan yang tidak berasal dari parent manapun?
```

---

## 50. Diff dan Conflict Resolution

Saat conflict, Git menaruh conflict markers di working tree.

Setelah menyelesaikan conflict, gunakan diff untuk memverifikasi hasil resolusi.

Dalam merge conflict:

```bash
git diff
```

bisa menunjukkan unresolved conflict.

Setelah stage:

```bash
git diff --staged
```

review final resolution.

Command khusus berguna:

```bash
git diff --ours
git diff --theirs
git diff --base
```

Saat file conflicted, ini membantu membandingkan:

- versi kita,
- versi mereka,
- base ancestor.

Detail conflict akan dibahas di Part 011.

---

## 51. Diff Tidak Cukup: Selalu Verifikasi dengan Test dan Build

Diff menjawab:

```text
Apa yang berbeda secara textual/structural?
```

Ia tidak menjawab penuh:

```text
Apakah sistem masih benar?
```

Untuk Java project, setelah diff penting:

```bash
./mvnw test
```

atau:

```bash
./gradlew test
```

Untuk perubahan dependency/build:

```bash
./mvnw clean verify
```

atau:

```bash
./gradlew clean build
```

Untuk perubahan integration behavior, perlu test lebih tinggi:

- integration test,
- contract test,
- migration test,
- performance smoke,
- security check,
- static analysis.

Diff adalah observability. Correctness butuh validation.

---

## 52. Diff dan Review Conversation

Dalam PR review, komentar yang baik merujuk ke diff tetapi berpikir di atas diff.

Komentar lemah:

```text
Kenapa ini berubah?
```

Komentar lebih kuat:

```text
Perubahan ini mengubah behavior null input dari NotFoundException menjadi IllegalArgumentException. Apakah API consumer sudah mengandalkan status 404 lama?
```

Komentar lemah:

```text
Ini risky.
```

Komentar lebih kuat:

```text
Timeout dinaikkan dari 3s ke 30s. Dengan pool 50 thread, request lambat bisa menahan kapasitas 10x lebih lama. Apakah circuit breaker dan retry downstream sudah disesuaikan?
```

Diff adalah evidence. Review adalah reasoning.

---

## 53. Diff dan Commit Message

Diff menjelaskan:

```text
What changed.
```

Commit message harus menjelaskan:

```text
Why it changed.
What constraints matter.
What alternatives were rejected if relevant.
```

Contoh buruk:

```text
fix validation
```

Contoh lebih baik:

```text
Reject suspended users before session creation

Suspended accounts previously passed credential validation and failed later
when loading account permissions. This made audit logs look like an
authorization failure instead of an account-state rejection.

The check is moved before session creation so no session id is created for
suspended accounts.
```

Saat diff dibaca enam bulan kemudian, message membantu memahami intent.

---

## 54. Diff dan Code Ownership

Diff juga membantu menentukan reviewer.

Contoh:

```bash
git diff --name-only origin/main...HEAD
```

Jika berubah:

```text
src/main/java/com/acme/security/AuthFilter.java
src/main/resources/application-prod.yml
infra/helm/values-prod.yaml
```

Maka reviewer seharusnya tidak hanya satu backend engineer. Mungkin perlu:

- security/domain owner,
- platform/infra owner,
- service owner,
- QA/release owner.

File yang berubah adalah sinyal ownership dan risiko.

Dalam organisasi matang, CODEOWNERS dan branch protection memakai ide ini.

---

## 55. Diff Smells

Beberapa smell saat melihat diff:

### 55.1 Banyak file unrelated

Contoh:

```text
UserService.java
PaymentGateway.java
README.md
Dockerfile
pom.xml
```

Mungkin task terlalu besar atau ada drive-by changes.

### 55.2 Reformat bercampur behavior

Sulit review behavior.

### 55.3 Test hanya dihapus/dilonggarkan

Bisa menunjukkan bug disembunyikan.

### 55.4 Generated code berubah tanpa source spec

Mungkin hasil generate tidak reproducible atau manual edit.

### 55.5 Dependency version berubah tanpa alasan

Risiko transitive dan runtime.

### 55.6 Config production berubah tanpa test/deployment note

Risiko operational.

### 55.7 Binary berubah tanpa explanation

Tidak reviewable.

### 55.8 Diff terlalu besar untuk satu mental context

Mungkin perlu split PR.

---

## 56. Diff Decision Matrix

| Situasi | Command utama | Pertanyaan |
|---|---|---|
| Melihat unstaged changes | `git diff` | Apa yang belum staged? |
| Melihat staged commit | `git diff --staged` | Apa yang akan masuk commit? |
| Melihat semua local changes | `git diff HEAD` | Apa total perubahan dari commit terakhir? |
| Review feature branch | `git diff origin/main...HEAD` | Apa isi branch sejak merge base dengan main? |
| Compare dua release | `git diff v1.2.0..v1.3.0` | Apa beda snapshot release? |
| Lihat file berubah | `git diff --name-status` | Area mana terdampak? |
| Lihat ukuran perubahan | `git diff --stat` | Seberapa besar secara textual? |
| Abaikan whitespace | `git diff -w` | Apa perubahan non-whitespace? |
| Detect rename | `git diff -M` | Apakah ini rename/move? |
| Review refactor move | `git diff --color-moved` | Apakah kode hanya dipindah? |
| Automation no drift | `git diff --exit-code` | Apakah ada perubahan yang tidak di-commit? |
| Patch sharing | `git diff > x.patch` | Bagikan perubahan tanpa commit metadata |

---

## 57. Command Cheat Sheet dengan Mental Model

```bash
# Working tree vs index
git diff

# Index vs HEAD
git diff --staged

git diff --cached

# Working tree vs HEAD
git diff HEAD

# Snapshot A vs B
git diff A B

git diff A..B

# Merge base of A/B vs B
git diff A...B

# Branch changes for PR
git fetch origin
git diff origin/main...HEAD

# List changed files
git diff --name-only origin/main...HEAD

git diff --name-status origin/main...HEAD

# Summary
git diff --stat origin/main...HEAD

git diff --shortstat origin/main...HEAD

# Path-specific
git diff origin/main...HEAD -- src/main/java

# Staged path-specific
git diff --staged -- pom.xml

# Ignore whitespace
git diff -w

git diff --ignore-space-change

# Check whitespace errors
git diff --check

# Rename detection
git diff -M

git diff --find-renames

# Moved code visualization
git diff --color-moved

# Alternative diff algorithms
git diff --patience

git diff --histogram

# Automation
git diff --exit-code

git diff --quiet
```

---

## 58. Latihan Praktis End-to-End

Buat repository:

```bash
mkdir git-diff-deep-lab
cd git-diff-deep-lab
git init
mkdir -p src/main/java/com/acme/account src/test/java/com/acme/account
cat > src/main/java/com/acme/account/Account.java <<'EOF'
package com.acme.account;

public class Account {
    private final String id;
    private final String status;

    public Account(String id, String status) {
        this.id = id;
        this.status = status;
    }

    public String id() {
        return id;
    }

    public String status() {
        return status;
    }
}
EOF

cat > src/main/java/com/acme/account/AccountService.java <<'EOF'
package com.acme.account;

public class AccountService {
    public boolean canLogin(Account account) {
        return "ACTIVE".equals(account.status());
    }
}
EOF

git add .
git commit -m "Add account login baseline"
```

Buat branch feature:

```bash
git switch -c feature/suspended-account-validation
```

Ubah behavior:

```bash
perl -0pi -e 's/return "ACTIVE"\.equals\(account\.status\(\)\);/if (account == null) {\n            return false;\n        }\n        return "ACTIVE".equals(account.status());/' src/main/java/com/acme/account/AccountService.java
```

Stage sebagian/semua:

```bash
git diff
git add src/main/java/com/acme/account/AccountService.java
git diff --staged
git commit -m "Reject null account login attempts"
```

Tambahkan perubahan lain:

```bash
cat > src/main/java/com/acme/account/AccountStatus.java <<'EOF'
package com.acme.account;

public enum AccountStatus {
    ACTIVE,
    SUSPENDED,
    CLOSED
}
EOF

git add .
git commit -m "Introduce account status enum"
```

Kembali ke main dan buat perubahan lain:

```bash
git switch main
cat >> README.md <<'EOF'
# Account Service

Baseline account service module.
EOF

git add README.md
git commit -m "Document account service module"
```

Sekarang bandingkan:

```bash
git diff main..feature/suspended-account-validation --stat
git diff main...feature/suspended-account-validation --stat
git diff main..feature/suspended-account-validation
git diff main...feature/suspended-account-validation
```

Amati:

```text
Kenapa two-dot dan three-dot berbeda?
Apa yang sebenarnya ingin kamu lihat saat review feature?
Apa peran merge base?
```

Cari merge base:

```bash
git merge-base main feature/suspended-account-validation
git log --oneline --graph --decorate --all
```

Latihan ini harus membuat konsep `..` dan `...` terasa konkret.

---

## 59. Latihan: Rename vs Behavior Change

Di branch feature:

```bash
git switch feature/suspended-account-validation
mkdir -p src/main/java/com/acme/account/model
git mv src/main/java/com/acme/account/Account.java src/main/java/com/acme/account/model/Account.java
perl -0pi -e 's/package com\.acme\.account;/package com.acme.account.model;/' src/main/java/com/acme/account/model/Account.java
perl -0pi -e 's/import com\.acme\.account\.Account;//' src/main/java/com/acme/account/AccountService.java || true
```

Perbaiki import `AccountService.java` manual jika perlu:

```java
import com.acme.account.model.Account;
```

Commit move saja:

```bash
git add .
git diff --staged --name-status
git diff --staged -M --name-status
git commit -m "Move Account model to model package"
```

Kemudian ubah behavior di commit terpisah.

Bandingkan reviewability antara:

```text
move-only commit
behavior-only commit
```

vs satu commit campuran.

---

## 60. Latihan: Whitespace Noise

Ubah format satu file dengan IDE atau manual.

Lalu bandingkan:

```bash
git diff
git diff -w
git diff --ignore-space-change
git diff --check
```

Pertanyaan:

```text
Apakah perubahan meaningful atau hanya formatting?
Apakah formatting sebaiknya commit terpisah?
Apakah formatter tim konsisten?
```

---

## 61. Latihan: Diff untuk Dependency

Tambahkan `pom.xml` sederhana atau gunakan project Java nyata.

Ubah dependency version.

Lihat:

```bash
git diff -- pom.xml
git diff --word-diff -- pom.xml
```

Kemudian jalankan:

```bash
mvn dependency:tree
```

atau untuk Gradle:

```bash
./gradlew dependencies
```

Pertanyaan:

```text
Apakah Git diff cukup untuk memahami dampak dependency?
Apa graph dependency yang berubah?
```

---

## 62. Mental Model Final

Ringkasnya:

```text
Git diff compares states.
The meaning of a diff depends entirely on which states are compared.
```

Tiga hal yang harus selalu jelas:

```text
1. Left side: state asal perbandingan.
2. Right side: state target perbandingan.
3. Intent: pertanyaan engineering yang ingin dijawab.
```

Command yang sama bisa berguna atau misleading tergantung intent.

Contoh:

```bash
git diff main..feature
```

berguna untuk membandingkan final snapshot dua branch.

```bash
git diff main...feature
```

berguna untuk melihat isi feature branch sejak bercabang dari main.

Tidak ada yang “selalu benar”. Yang benar adalah command yang menjawab pertanyaan yang tepat.

---

## 63. Common Failure Modes

### 63.1 Mengira `git diff` menunjukkan semua perubahan lokal

Padahal `git diff` default hanya unstaged changes.

Gunakan:

```bash
git diff HEAD
```

untuk total local changes.

### 63.2 Mengira staged changes hilang karena `git diff` kosong

Tidak hilang. Sudah masuk index.

Gunakan:

```bash
git diff --staged
```

### 63.3 Salah pakai two-dot saat review PR

`main..feature` membandingkan final snapshot main dan feature.

Untuk isi branch sejak merge base, gunakan:

```bash
git diff main...feature
```

### 63.4 Review diff tanpa fetch

Local `main` bisa stale.

Gunakan:

```bash
git fetch origin
git diff origin/main...HEAD
```

### 63.5 Mengabaikan whitespace pada file yang whitespace-sensitive

`-w` tidak selalu aman untuk YAML/Makefile/Python.

### 63.6 Menganggap rename disimpan Git secara eksplisit

Rename adalah hasil deteksi diff, bukan metadata commit utama.

### 63.7 Menganggap diff kecil pasti aman

Diff kecil dapat mengubah authorization, transaction, retry, atau error semantics.

### 63.8 Menganggap diff besar pasti buruk

Diff besar bisa acceptable jika mechanical dan terisolasi.

---

## 64. Review Checklist Sebelum Commit

```text
[ ] Saya sudah menjalankan git status.
[ ] Saya sudah melihat git diff untuk unstaged changes.
[ ] Saya sudah melihat git diff --staged untuk kandidat commit.
[ ] Tidak ada file unrelated.
[ ] Tidak ada secret/config lokal ikut masuk.
[ ] Tidak ada generated/build artifact tidak sengaja.
[ ] Tidak ada whitespace error dari git diff --check.
[ ] Commit ini punya satu intent utama.
[ ] Commit message menjelaskan alasan perubahan.
[ ] Perubahan sudah divalidasi dengan test/build yang sesuai.
```

---

## 65. Review Checklist Sebelum Pull Request

```text
[ ] Saya sudah git fetch origin.
[ ] Saya sudah review git diff origin/main...HEAD.
[ ] Saya sudah lihat git diff --name-status origin/main...HEAD.
[ ] Saya sudah lihat git diff --stat origin/main...HEAD.
[ ] File yang berubah sesuai scope task.
[ ] Mechanical changes dipisahkan dari behavior changes.
[ ] Dependency/config/security changes dijelaskan.
[ ] Test changes memperkuat, bukan melemahkan, kontrak.
[ ] Branch tidak membawa perubahan unrelated.
[ ] Jika diff besar, ada struktur commit/PR yang membantu review.
```

---

## 66. Pertanyaan Reflektif

Jawab tanpa melihat materi:

1. Apa bedanya `git diff`, `git diff --staged`, dan `git diff HEAD`?
2. Mengapa `git diff` kosong tidak berarti tidak ada perubahan?
3. Apa yang dibandingkan oleh `git diff A..B`?
4. Apa yang dibandingkan oleh `git diff A...B`?
5. Mengapa PR review biasanya lebih dekat ke three-dot diff?
6. Kenapa `git log A..B` tidak boleh dimaknai sama seperti `git diff A..B`?
7. Apa risiko mencampur rename dan behavior change dalam satu commit?
8. Kapan `git diff -w` membantu dan kapan berbahaya?
9. Mengapa diff kecil bisa berisiko besar?
10. Apa command untuk memastikan generated code tidak meninggalkan perubahan setelah build?

---

## 67. Ringkasan

Di bagian ini kita membangun mental model diff sebagai pembanding state:

- `git diff` membandingkan working tree dengan index.
- `git diff --staged` membandingkan index dengan `HEAD`.
- `git diff HEAD` membandingkan working tree dengan `HEAD`.
- `git diff A B` membandingkan snapshot `A` dengan snapshot `B`.
- `git diff A..B` untuk diff pada dasarnya snapshot `A` vs `B`.
- `git diff A...B` membandingkan merge base `A/B` dengan `B`.
- Diff direction menentukan arti plus/minus.
- Rename/copy adalah hasil deteksi, bukan metadata utama.
- Whitespace, algorithm, moved code, dan pathspec mempengaruhi readability.
- Diff adalah evidence, bukan pengganti reasoning.
- Review diff Java harus fokus pada behavior, contract, state, failure mode, dan operational risk.

Prinsip akhir:

```text
Before reading a diff, identify the states.
Before trusting a diff, identify the question.
Before approving a diff, reason about the behavior.
```

---

## 68. Bagian Berikutnya

Bagian berikutnya:

```text
learn-git-mastery-for-java-engineers-part-007.md
```

Topik:

```text
Branching: Isolasi Perubahan dan Eksperimen Aman
```

Kita akan membahas branch sebagai pointer mutable, local branch, remote-tracking branch, detached HEAD, branch lifecycle, naming, isolation strategy, dan risiko branch yang hidup terlalu lama.

---

## 69. Status Seri

```text
Progress: 006 / 032
Seri belum selesai.
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-git-mastery-for-java-engineers-part-005.md](./learn-git-mastery-for-java-engineers-part-005.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-git-mastery-for-java-engineers-part-007.md](./learn-git-mastery-for-java-engineers-part-007.md)

</div>
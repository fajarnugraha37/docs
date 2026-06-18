# learn-git-mastery-for-java-engineers-part-005.md

# Part 005 — Membaca History secara Efektif

> Seri: `git-mastery-for-java-engineers`  
> Bagian: `005 / 032`  
> Status seri: **belum selesai**  
> Bagian terakhir: `learn-git-mastery-for-java-engineers-part-032.md`

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas lifecycle perubahan dari edit file sampai commit berkualitas. Kita sudah melihat bahwa commit yang bagus bukan hanya menyimpan kode, tetapi menyimpan **unit pemahaman**: apa yang berubah, kenapa berubah, dan bagaimana perubahan itu bisa direview.

Part ini membalik perspektifnya.

Jika Part 004 menjawab:

```text
Bagaimana membuat commit yang bagus?
```

Part 005 menjawab:

```text
Bagaimana membaca commit dan history dengan efektif?
```

Git history adalah salah satu sumber informasi paling penting dalam software engineering. Tetapi banyak engineer hanya memakai history sebagai daftar kronologis commit. Itu terlalu dangkal.

Engineer yang kuat memakai history untuk:

1. memahami evolusi desain,
2. menginvestigasi bug,
3. membaca konteks legacy code,
4. mengevaluasi risiko perubahan,
5. menyiapkan review,
6. men-debug regresi,
7. membuat release note,
8. menemukan ownership perubahan,
9. menghubungkan kode dengan issue/PR/incident,
10. membangun narasi teknis dari masa lalu repository.

Git history bukan arsip pasif. Ia adalah **queryable engineering memory**.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. membaca history bukan sebagai list commit, tetapi sebagai graph perubahan,
2. memilih variasi `git log` yang sesuai dengan pertanyaan investigasi,
3. membedakan history-level view, commit-level view, file-level view, dan patch-level view,
4. memakai `git show` untuk membedah satu commit secara akurat,
5. memakai `git diff` untuk membandingkan state repository,
6. memahami author date vs commit date,
7. membaca statistik perubahan tanpa tertipu angka,
8. menelusuri perubahan file/class Java dari waktu ke waktu,
9. membaca history branch lokal dan remote,
10. menyusun workflow investigasi history yang repeatable.

---

## 2. Mental Model Utama: History adalah Query terhadap Commit Graph

Sebelum masuk command, kita perlu menanamkan mental model yang benar.

`git log` bukan sekadar:

```text
Tampilkan commit lama sampai baru.
```

Lebih tepatnya:

```text
Tampilkan commit yang reachable dari titik awal tertentu, lalu format dan filter hasilnya sesuai opsi yang diberikan.
```

Dokumentasi resmi `git log` mendeskripsikan `git log` sebagai command untuk menampilkan commit logs, dengan kontrol terhadap commit mana yang ditampilkan dan bagaimana perubahan setiap commit diperlihatkan. Secara praktis, ini berarti `git log` adalah query engine terhadap commit graph.

### 2.1 Commit Graph sebagai Struktur Data

Bayangkan history seperti ini:

```text
A---B---C---D  main
     \
      E---F    feature/payment-validation
```

Jika kamu berada di `main` dan menjalankan:

```bash
git log
```

Git akan menampilkan commit yang reachable dari `main`:

```text
D, C, B, A
```

Commit `E` dan `F` tidak muncul karena tidak reachable dari `main`.

Jika kamu menjalankan:

```bash
git log feature/payment-validation
```

Git akan menampilkan:

```text
F, E, B, A
```

Jadi `git log` selalu punya tiga dimensi:

| Dimensi | Pertanyaan |
|---|---|
| Starting point | Dari commit/ref mana pencarian dimulai? |
| Selection/filter | Commit mana yang ingin dimasukkan/dikeluarkan? |
| Presentation | Informasi apa yang ingin ditampilkan dan dalam format apa? |

Engineer yang kuat tidak bertanya:

```text
Command log apa yang harus saya hafal?
```

Ia bertanya:

```text
Saya sedang mencari jawaban apa dari graph ini?
```

---

## 3. Kategori Pertanyaan Saat Membaca History

Sebelum memilih command, klasifikasikan pertanyaannya.

### 3.1 Pertanyaan Kronologis

Contoh:

```text
Commit terbaru apa saja di branch ini?
Apa yang berubah minggu ini?
Siapa yang terakhir mengubah module billing?
```

Command umum:

```bash
git log
git log --since="1 week ago"
git log --author="Alice"
git log -- path/to/module
```

### 3.2 Pertanyaan Struktural Graph

Contoh:

```text
Branch ini bercabang dari mana?
Commit apa saja yang belum masuk main?
Apakah branch ini sudah merge main terbaru?
```

Command umum:

```bash
git log --graph --oneline --decorate --all
git log main..feature
git log feature --not main
git merge-base main feature
```

### 3.3 Pertanyaan Perubahan Isi

Contoh:

```text
Apa isi perubahan commit ini?
File apa yang disentuh?
Method mana yang berubah?
```

Command umum:

```bash
git show <commit>
git show --stat <commit>
git show --name-only <commit>
git show -- path/to/File.java
git diff <commit>^ <commit>
```

### 3.4 Pertanyaan Forensik

Contoh:

```text
Kapan validasi ini ditambahkan?
Kenapa kode ini berubah?
Commit mana yang menghapus check ini?
```

Command umum:

```bash
git log -S"some text"
git log -G"regex"
git blame path/to/File.java
git log --follow -- path/to/File.java
```

`blame`, `pickaxe`, dan archaeology akan dibahas lebih dalam di Part 020, tetapi Part 005 mulai membangun fondasinya.

### 3.5 Pertanyaan Release dan Audit

Contoh:

```text
Apa saja perubahan antara v1.8.0 dan v1.9.0?
Commit mana yang masuk release ini?
Apakah hotfix sudah masuk main?
```

Command umum:

```bash
git log v1.8.0..v1.9.0
git diff --stat v1.8.0..v1.9.0
git branch --contains <commit>
git tag --contains <commit>
```

---

## 4. Setup Repository Latihan

Kamu bisa memakai repository project nyata, tetapi untuk memahami command lebih aman memakai repo latihan.

```bash
mkdir git-history-lab
cd git-history-lab
git init
```

Buat struktur Java sederhana:

```bash
mkdir -p src/main/java/com/example/order
cat > src/main/java/com/example/order/OrderService.java <<'EOF'
package com.example.order;

public class OrderService {
    public boolean canSubmit(Order order) {
        return order != null;
    }
}
EOF

cat > src/main/java/com/example/order/Order.java <<'EOF'
package com.example.order;

public class Order {
    private final String id;

    public Order(String id) {
        this.id = id;
    }

    public String id() {
        return id;
    }
}
EOF

git add .
git commit -m "Create initial order domain"
```

Tambahkan beberapa commit:

```bash
python3 - <<'PY'
from pathlib import Path
p = Path('src/main/java/com/example/order/Order.java')
s = p.read_text()
s = s.replace('private final String id;', 'private final String id;\n    private final long amount;')
s = s.replace('public Order(String id) {\n        this.id = id;\n    }', 'public Order(String id, long amount) {\n        this.id = id;\n        this.amount = amount;\n    }')
s = s.replace('public String id() {\n        return id;\n    }', 'public String id() {\n        return id;\n    }\n\n    public long amount() {\n        return amount;\n    }')
p.write_text(s)
PY

git add .
git commit -m "Add amount to order"
```

```bash
python3 - <<'PY'
from pathlib import Path
p = Path('src/main/java/com/example/order/OrderService.java')
s = p.read_text()
s = s.replace('return order != null;', 'return order != null && order.amount() > 0;')
p.write_text(s)
PY

git add .
git commit -m "Require positive order amount"
```

```bash
mkdir -p src/test/java/com/example/order
cat > src/test/java/com/example/order/OrderServiceTest.java <<'EOF'
package com.example.order;

class OrderServiceTest {
    // intentionally minimal for Git history lab
}
EOF

git add .
git commit -m "Add order service test skeleton"
```

Sekarang kita punya history kecil untuk dieksplorasi.

---

## 5. `git log` Dasar

Command paling dasar:

```bash
git log
```

Output umumnya berisi:

```text
commit <hash>
Author: <name> <email>
Date:   <date>

    <commit message>
```

Secara default, `git log` menampilkan commit terbaru lebih dulu.

### 5.1 Informasi yang Ditampilkan

| Field | Arti |
|---|---|
| commit hash | Identitas commit object |
| Author | Orang yang menulis perubahan |
| Date | Tanggal authoring default yang ditampilkan |
| Message | Deskripsi perubahan |

Tetapi jangan berhenti di sini. Tampilan default berguna untuk overview, tetapi tidak cukup untuk investigasi serius.

---

## 6. `--oneline`: Ringkasan Cepat

Untuk melihat history ringkas:

```bash
git log --oneline
```

Contoh:

```text
7f3a2c1 Add order service test skeleton
91bd2e0 Require positive order amount
43ac18f Add amount to order
b52d9a4 Create initial order domain
```

`--oneline` efektif untuk:

1. melihat shape kasar history,
2. memilih commit hash untuk command lanjutan,
3. membaca branch pendek,
4. review branch sebelum push.

Tetapi `--oneline` menyembunyikan banyak konteks. Jangan gunakan sebagai satu-satunya alat investigasi.

---

## 7. `--graph`, `--decorate`, dan `--all`: Membaca Bentuk Graph

Untuk melihat graph:

```bash
git log --oneline --graph --decorate --all
```

Makna opsi:

| Opsi | Fungsi |
|---|---|
| `--graph` | Menampilkan ASCII graph hubungan parent/branch |
| `--decorate` | Menampilkan label branch/tag/HEAD |
| `--all` | Menampilkan semua refs, bukan hanya current branch |
| `--oneline` | Membuat output ringkas |

Contoh output:

```text
* 7f3a2c1 (HEAD -> main) Add order service test skeleton
* 91bd2e0 Require positive order amount
* 43ac18f Add amount to order
* b52d9a4 Create initial order domain
```

Saat ada branch:

```bash
git switch -c feature/discount
# buat commit baru
git switch main
# buat commit lain

git log --oneline --graph --decorate --all
```

Output bisa menjadi:

```text
* c3d91af (feature/discount) Add discount calculation
| * a7b22e1 (HEAD -> main) Update README
|/
* 7f3a2c1 Add order service test skeleton
* 91bd2e0 Require positive order amount
```

Yang perlu dibaca:

1. garis `|` menunjukkan jalur ancestry,
2. `*` adalah commit,
3. label `(HEAD -> main)` menunjukkan posisi HEAD dan branch saat ini,
4. label `(feature/discount)` menunjukkan pointer branch lain,
5. titik percabangan adalah commit common ancestor.

### 7.1 Alias yang Sangat Berguna

Banyak engineer senior membuat alias:

```bash
git config --global alias.lg "log --oneline --graph --decorate --all"
```

Lalu cukup:

```bash
git lg
```

Untuk versi sedikit lebih kaya:

```bash
git config --global alias.lga "log --graph --decorate --all --pretty=format:'%C(auto)%h %C(cyan)%ad %C(yellow)%d %C(reset)%s %C(green)(%an)' --date=short"
```

Gunakan:

```bash
git lga
```

Catatan: alias bukan skill utama. Skill utamanya adalah tahu **informasi apa** yang sedang kamu cari.

---

## 8. `--stat`: Melihat Skala dan Distribusi Perubahan

Untuk melihat statistik file:

```bash
git log --stat
```

Atau satu commit:

```bash
git show --stat <commit>
```

Contoh:

```text
src/main/java/com/example/order/Order.java        | 10 +++++++---
src/main/java/com/example/order/OrderService.java |  2 +-
2 files changed, 8 insertions(+), 4 deletions(-)
```

`--stat` berguna untuk:

1. menilai skala commit,
2. mendeteksi commit terlalu besar,
3. melihat module mana yang terkena dampak,
4. menyiapkan review,
5. membaca release delta antar tag.

Tetapi `--stat` bisa menipu.

### 8.1 Kenapa `--stat` Bisa Menipu

Commit dengan:

```text
1 file changed, 2 insertions(+), 1 deletion(-)
```

bisa sangat berisiko jika mengubah:

```java
if (user.isAdmin())
```

menjadi:

```java
if (!user.isAdmin())
```

Sebaliknya, commit dengan:

```text
120 files changed
```

bisa rendah risiko jika hanya rename package mekanis atau formatting.

Jadi statistik menjawab:

```text
Berapa besar area perubahan secara tekstual?
```

Bukan:

```text
Seberapa besar risiko semantik perubahan?
```

Untuk risiko, kamu perlu membaca patch, test, dependency, runtime path, dan domain impact.

---

## 9. `--patch` / `-p`: Melihat Perubahan Isi Tiap Commit

Untuk melihat patch setiap commit:

```bash
git log -p
```

Atau batasi jumlah commit:

```bash
git log -p -3
```

`-p` berarti tampilkan textual diff untuk setiap commit.

Ini berguna saat kamu ingin membaca history bukan hanya dari message, tetapi dari perubahan aktual.

Contoh:

```bash
git log -p -- src/main/java/com/example/order/OrderService.java
```

Pertanyaan yang dijawab:

```text
Bagaimana file ini berubah dari waktu ke waktu?
```

### 9.1 Cara Membaca Patch dengan Disiplin

Saat membaca patch, jangan hanya mencari line hijau/merah.

Gunakan urutan:

1. Baca commit message.
2. Baca file yang disentuh.
3. Baca hunk header.
4. Baca konteks sekitar perubahan.
5. Identifikasi invariant yang berubah.
6. Cari test yang berubah bersama production code.
7. Perhatikan deletion, bukan hanya addition.
8. Evaluasi apakah perubahan sesuai message.

Contoh diff:

```diff
-        return order != null;
+        return order != null && order.amount() > 0;
```

Pertanyaan yang harus muncul:

1. Apakah `amount()` selalu tersedia?
2. Apakah `order.amount()` bisa throw exception?
3. Apakah validasi amount seharusnya di domain object atau service?
4. Apakah `amount == 0` memang invalid?
5. Apakah ada currency/minimum amount rule?
6. Apakah test mencakup null, zero, negative, positive?

History reading yang matang selalu berakhir pada reasoning, bukan hanya decoding text.

---

## 10. `git show`: Membaca Satu Object/Commit secara Dalam

Jika `git log` adalah daftar/query history, `git show` adalah kaca pembesar untuk satu object.

```bash
git show <commit>
```

Untuk commit, `git show` biasanya menampilkan:

1. commit hash,
2. author,
3. date,
4. commit message,
5. diff yang diperkenalkan commit tersebut.

Contoh:

```bash
git show HEAD
```

```bash
git show HEAD~1
```

```bash
git show 91bd2e0
```

### 10.1 Membaca Commit Terakhir

```bash
git show --stat HEAD
```

Untuk melihat hanya nama file:

```bash
git show --name-only HEAD
```

Untuk melihat nama + status:

```bash
git show --name-status HEAD
```

Output `--name-status` bisa menunjukkan:

| Status | Arti |
|---|---|
| `A` | added |
| `M` | modified |
| `D` | deleted |
| `R` | renamed |
| `C` | copied |

### 10.2 Menampilkan File pada Commit Tertentu

Ini sangat penting.

Untuk melihat isi file pada commit tertentu:

```bash
git show <commit>:path/to/file
```

Contoh:

```bash
git show HEAD~2:src/main/java/com/example/order/Order.java
```

Artinya:

```text
Tampilkan isi file Order.java sebagaimana adanya pada snapshot HEAD~2.
```

Ini bukan diff. Ini adalah membaca file dari snapshot lama.

Use case:

1. membandingkan implementasi lama dan baru,
2. mengambil kembali konfigurasi lama tanpa checkout seluruh branch,
3. memahami state sebelum refactor,
4. membaca file dari tag release lama.

Contoh untuk release tag:

```bash
git show v1.8.0:src/main/resources/application.yml
```

---

## 11. Revision Selection: Cara Menunjuk Commit

Agar efektif membaca history, kamu harus fasih menunjuk commit.

### 11.1 Hash

```bash
git show a1b2c3d
```

Git menerima prefix hash selama tidak ambigu.

### 11.2 Ref Name

```bash
git show main
git show feature/payment-validation
git show origin/main
```

Ref adalah pointer ke commit.

### 11.3 `HEAD`

```bash
git show HEAD
```

`HEAD` berarti posisi saat ini.

### 11.4 Parent dengan `^`

```bash
git show HEAD^
```

Artinya parent pertama dari `HEAD`.

Untuk merge commit:

```bash
git show HEAD^1
git show HEAD^2
```

`^1` parent pertama, biasanya branch tempat merge dilakukan.  
`^2` parent kedua, biasanya branch yang dimerge.

### 11.5 Ancestor dengan `~`

```bash
git show HEAD~1
git show HEAD~2
git show HEAD~5
```

`HEAD~3` berarti ikuti parent pertama sebanyak 3 kali.

### 11.6 Range dengan `..`

```bash
git log main..feature
```

Artinya:

```text
Commit yang reachable dari feature tetapi tidak reachable dari main.
```

Ini sering dipakai untuk menjawab:

```text
Commit apa saja yang ada di branch feature tapi belum ada di main?
```

### 11.7 Symmetric Difference dengan `...`

```bash
git log main...feature
```

Artinya:

```text
Commit yang ada di main atau feature tetapi tidak di keduanya.
```

Ini menunjukkan divergence dua branch.

Catatan penting: `..` dan `...` punya makna yang berbeda antara `git log` dan `git diff`. Kita bahas lebih dalam di Part 006. Untuk sekarang, cukup pahami bahwa range selection harus dibaca hati-hati.

---

## 12. Melihat Commit yang Belum Masuk Branch Lain

Misalnya kamu sedang di branch feature:

```bash
git log --oneline main..HEAD
```

Artinya:

```text
Commit di branch saat ini yang belum reachable dari main.
```

Ini sangat berguna sebelum membuat PR.

Alternatif:

```bash
git log --oneline origin/main..HEAD
```

Ini lebih realistis jika `origin/main` adalah state remote terakhir yang kamu fetch.

Workflow sebelum push:

```bash
git fetch origin
git log --oneline --graph --decorate origin/main..HEAD
git diff --stat origin/main..HEAD
git diff origin/main...HEAD
```

Interpretasi:

1. `git fetch origin`: update informasi remote tanpa mengintegrasikan.
2. `origin/main..HEAD`: commit lokal yang belum ada di remote main.
3. `--stat`: area perubahan.
4. `diff`: isi perubahan yang akan muncul di PR.

---

## 13. Membaca History Per File

Untuk melihat history sebuah file:

```bash
git log -- path/to/file
```

Contoh:

```bash
git log -- src/main/java/com/example/order/OrderService.java
```

Dengan ringkas:

```bash
git log --oneline -- src/main/java/com/example/order/OrderService.java
```

Dengan patch:

```bash
git log -p -- src/main/java/com/example/order/OrderService.java
```

### 13.1 Kenapa Ada `--`?

Dalam Git command, `--` sering dipakai sebagai separator antara revision/options dan path.

```bash
git log <revision> -- <path>
```

Contoh:

```bash
git log main -- src/main/java/com/example/order/OrderService.java
```

Tanpa `--`, Git kadang bisa bingung jika nama path mirip nama branch/tag.

Biasakan memakai `--` untuk pathspec.

---

## 14. Rename dan `--follow`

Jika file pernah di-rename, history per file bisa tampak putus.

Contoh:

```bash
git mv src/main/java/com/example/order/OrderService.java src/main/java/com/example/order/OrderApplicationService.java
git commit -m "Rename order service for application layer clarity"
```

Lalu:

```bash
git log -- src/main/java/com/example/order/OrderApplicationService.java
```

Mungkin hanya menampilkan history setelah rename.

Gunakan:

```bash
git log --follow -- src/main/java/com/example/order/OrderApplicationService.java
```

`--follow` mencoba melanjutkan history melintasi rename untuk satu file.

### 14.1 Batasan `--follow`

`--follow` bukan mesin semantik. Ia berdasarkan heuristik rename detection. Jika file dipecah, digabung, atau direwrite besar-besaran, Git mungkin tidak bisa mengikuti dengan sempurna.

Contoh sulit:

1. `OrderService.java` dipecah menjadi `OrderValidationService.java` dan `OrderSubmissionService.java`.
2. Package diubah besar-besaran bersamaan dengan formatting.
3. Class dipindah dan isinya direfactor dalam commit yang sama.

Pelajaran praktis:

```text
Pisahkan rename/move mekanis dari refactor logis.
```

Commit yang hanya rename lebih mudah dibaca history-nya daripada commit yang rename + refactor + behavior change sekaligus.

---

## 15. Filtering History Berdasarkan Waktu

Untuk melihat commit setelah tanggal tertentu:

```bash
git log --since="2026-01-01"
```

Atau:

```bash
git log --since="2 weeks ago"
```

Sebelum tanggal tertentu:

```bash
git log --until="2026-03-01"
```

Gabungan:

```bash
git log --since="2026-01-01" --until="2026-01-31"
```

Use case:

1. audit perubahan dalam sprint,
2. mencari commit sekitar waktu incident,
3. membuat release note bulanan,
4. melihat activity module tertentu.

Contoh:

```bash
git log --since="2026-02-01" --until="2026-02-15" -- src/main/java/com/example/order
```

Pertanyaan yang dijawab:

```text
Apa saja perubahan di module order selama rentang tanggal ini?
```

---

## 16. Filtering Berdasarkan Author dan Committer

Untuk author:

```bash
git log --author="Alice"
```

Author adalah orang yang membuat perubahan awal.

Untuk committer:

```bash
git log --committer="Bob"
```

Committer adalah orang/proses yang membuat commit object final di repository.

### 16.1 Author vs Committer

Biasanya author dan committer sama. Tetapi bisa berbeda saat:

1. patch dikirim oleh satu orang dan diaplikasikan oleh orang lain,
2. rebase dilakukan oleh orang lain,
3. commit diamend,
4. bot melakukan commit final,
5. merge queue membuat commit,
6. cherry-pick dilakukan oleh maintainer.

Lihat keduanya dengan:

```bash
git log --format=fuller
```

Output akan menampilkan:

```text
Author:
AuthorDate:
Commit:
CommitDate:
```

### 16.2 Kenapa Ini Penting?

Dalam konteks engineering governance:

| Field | Berguna untuk |
|---|---|
| Author | Siapa yang menulis perubahan |
| AuthorDate | Kapan perubahan awal dibuat |
| Committer | Siapa/proses yang memasukkan ke history saat ini |
| CommitDate | Kapan commit object ini dibuat/diubah |

Jika commit direbase, commit hash dan commit date bisa berubah, tetapi author date dapat tetap mengacu pada waktu awal perubahan dibuat.

Untuk investigasi incident, commit date sering lebih relevan untuk “kapan masuk branch ini”, sementara author date lebih relevan untuk “kapan perubahan mulai dibuat”.

---

## 17. Formatting Output dengan `--pretty` / `--format`

Output default sering terlalu panjang atau kurang informatif.

Contoh format ringkas:

```bash
git log --pretty=format:'%h %ad %an %s' --date=short
```

Output:

```text
91bd2e0 2026-06-17 Alice Require positive order amount
```

Format tokens umum:

| Token | Arti |
|---|---|
| `%H` | full commit hash |
| `%h` | abbreviated hash |
| `%an` | author name |
| `%ae` | author email |
| `%ad` | author date |
| `%cn` | committer name |
| `%cd` | committer date |
| `%s` | subject commit message |
| `%d` | ref names / decorations |

Contoh untuk audit:

```bash
git log --pretty=format:'%H|%ad|%an|%ae|%s' --date=iso-strict
```

Ini bisa diekspor atau diproses oleh script.

Contoh untuk review harian:

```bash
git log --pretty=format:'%C(auto)%h %C(cyan)%ad %C(yellow)%d%C(reset) %s %C(green)(%an)' --date=short --graph --decorate
```

---

## 18. Membatasi Jumlah Commit

Tampilkan 5 commit terakhir:

```bash
git log -5
```

Tampilkan 20 commit terakhir satu baris:

```bash
git log --oneline -20
```

Tampilkan commit terbaru yang menyentuh module tertentu:

```bash
git log -10 --oneline -- src/main/java/com/example/order
```

Ini sederhana tetapi penting untuk repository besar. Jangan menjalankan query history luas jika pertanyaannya sempit.

---

## 19. Searching Commit Message

Untuk mencari commit berdasarkan message:

```bash
git log --grep="validation"
```

Case-insensitive:

```bash
git log --regexp-ignore-case --grep="validation"
```

Contoh:

```bash
git log --oneline --grep="hotfix"
```

Use case:

1. mencari commit terkait issue id,
2. mencari hotfix,
3. mencari revert,
4. mencari migration,
5. mencari release preparation.

Contoh dengan issue key:

```bash
git log --oneline --grep="PAY-1842"
```

### 19.1 Keterbatasan `--grep`

`--grep` hanya mencari commit message, bukan isi diff.

Jika commit message buruk seperti:

```text
fix
update
changes
misc
```

maka history sulit dicari.

Inilah alasan Part 004 menekankan commit message berkualitas.

---

## 20. Searching Perubahan Isi dengan `-S` dan `-G`

Ini mulai masuk area forensic.

### 20.1 `-S`: Pickaxe Berdasarkan Perubahan Jumlah Kemunculan String

```bash
git log -S"order.amount() > 0"
```

`-S` mencari commit yang mengubah jumlah kemunculan string tersebut.

Use case:

```text
Kapan check ini ditambahkan atau dihapus?
```

Contoh:

```bash
git log -S"isAdmin" -- src/main/java
```

### 20.2 `-G`: Regex terhadap Patch

```bash
git log -G"amount\(\).*0" -- src/main/java
```

`-G` mencari commit yang patch-nya memiliki line yang match regex.

Perbedaan ringkas:

| Opsi | Cocok untuk |
|---|---|
| `-S"literal"` | Mencari kapan literal ditambah/dihapus |
| `-G"regex"` | Mencari pola perubahan dalam patch |

Keduanya sangat kuat untuk archaeology, tetapi akan dibahas lebih dalam di Part 020.

---

## 21. `git diff`: Membandingkan State Repository

Walaupun Part 006 akan membahas diff secara khusus, Part 005 perlu memperkenalkan perannya dalam membaca history.

`git diff` bukan membaca commit. `git diff` membandingkan dua state.

### 21.1 Working Tree vs Index

```bash
git diff
```

Artinya:

```text
Apa perubahan di working tree yang belum distage?
```

### 21.2 Index vs HEAD

```bash
git diff --staged
```

atau:

```bash
git diff --cached
```

Artinya:

```text
Apa perubahan yang sudah distage untuk commit berikutnya dibanding HEAD?
```

### 21.3 Commit vs Commit

```bash
git diff HEAD~1 HEAD
```

Artinya:

```text
Apa beda snapshot parent commit dan snapshot HEAD?
```

Ini kurang lebih sama dengan melihat patch commit HEAD.

### 21.4 Branch vs Branch

```bash
git diff main feature
```

Artinya:

```text
Apa beda snapshot main dan snapshot feature?
```

Perlu hati-hati: ini bukan selalu “apa perubahan feature branch sejak bercabang”. Untuk itu biasanya menggunakan three-dot dalam konteks review:

```bash
git diff main...feature
```

Akan dibahas detail di Part 006.

---

## 22. Membaca History Branch Lokal dan Remote

Repository lokal punya branch lokal dan remote-tracking branch.

Contoh:

```bash
git branch
```

Menampilkan local branches.

```bash
git branch -r
```

Menampilkan remote-tracking branches.

```bash
git branch -a
```

Menampilkan semua.

Untuk melihat semua history:

```bash
git log --oneline --graph --decorate --all
```

### 22.1 Fetch Dulu Sebelum Investigasi Remote

Jika kamu ingin membandingkan dengan remote terbaru:

```bash
git fetch origin
```

Lalu:

```bash
git log --oneline HEAD..origin/main
```

Artinya:

```text
Commit yang ada di origin/main tetapi belum ada di branch saat ini.
```

Sebaliknya:

```bash
git log --oneline origin/main..HEAD
```

Artinya:

```text
Commit di branch saat ini yang belum ada di origin/main.
```

### 22.2 Ahead/Behind Mental Model

Jika Git mengatakan:

```text
Your branch is ahead of 'origin/main' by 2 commits.
```

Artinya:

```text
HEAD punya 2 commit reachable yang tidak reachable dari origin/main.
```

Jika:

```text
Your branch is behind 'origin/main' by 3 commits.
```

Artinya:

```text
origin/main punya 3 commit reachable yang tidak reachable dari HEAD.
```

Jika ahead dan behind sekaligus, branch diverged.

---

## 23. Membaca Merge Commit

Merge commit punya lebih dari satu parent.

Lihat parent commit:

```bash
git show --pretty=raw <merge-commit>
```

Atau:

```bash
git log --pretty=raw -1 <merge-commit>
```

Kamu akan melihat beberapa parent:

```text
parent <hash1>
parent <hash2>
```

### 23.1 Melihat Diff Merge Commit

Merge commit agak khusus. Secara default, `git show <merge-commit>` tidak selalu menampilkan diff seperti commit biasa, karena perubahan merge adalah hasil kombinasi beberapa parent.

Beberapa opsi:

```bash
git show --stat <merge-commit>
```

```bash
git show -m <merge-commit>
```

`-m` memperlakukan merge commit sebagai diff terhadap masing-masing parent.

```bash
git show --cc <merge-commit>
```

Menampilkan combined diff.

### 23.2 Pertanyaan Saat Membaca Merge Commit

1. Branch apa yang digabung?
2. Apakah merge hanya integrasi bersih atau ada conflict resolution?
3. Apakah merge commit memperkenalkan perubahan tambahan di luar hasil merge?
4. Apakah ada test yang dijalankan setelah merge?
5. Parent mana mainline?

Merge commit penting untuk audit karena sering merepresentasikan titik integrasi, bukan sekadar perubahan file.

---

## 24. Melihat File yang Berubah antar Commit/Tag

Untuk release atau audit:

```bash
git diff --name-only v1.0.0..v1.1.0
```

Dengan status:

```bash
git diff --name-status v1.0.0..v1.1.0
```

Dengan statistik:

```bash
git diff --stat v1.0.0..v1.1.0
```

Dengan ringkasan rename/create/delete:

```bash
git diff --summary v1.0.0..v1.1.0
```

Use case Java:

```bash
git diff --name-only v1.8.0..v1.9.0 -- '*.java' 'pom.xml' 'build.gradle' 'src/main/resources/*.yml'
```

Pertanyaan:

```text
File Java, dependency, dan config apa yang berubah antar release?
```

---

## 25. Membaca Perubahan Dependency Java

Dependency changes sering berisiko tinggi.

Untuk Maven:

```bash
git log -p -- pom.xml
```

Untuk Gradle:

```bash
git log -p -- build.gradle settings.gradle gradle.properties
```

Untuk Gradle Kotlin DSL:

```bash
git log -p -- build.gradle.kts settings.gradle.kts gradle.properties
```

Untuk lockfile:

```bash
git log -p -- gradle.lockfile
```

Pertanyaan saat membaca perubahan dependency:

1. Apakah major version berubah?
2. Apakah transitive dependency berubah?
3. Apakah plugin build berubah?
4. Apakah dependency scope berubah, misalnya `test` ke `compile`?
5. Apakah dependency security patch atau behavior change?
6. Apakah ada perubahan config yang menyertai?
7. Apakah CI/build image ikut berubah?

History dependency harus dibaca dengan kecurigaan sehat. Banyak production incident berasal dari perubahan dependency kecil yang tampak aman.

---

## 26. Membaca Perubahan Configuration

Untuk Spring Boot misalnya:

```bash
git log -p -- src/main/resources/application.yml
```

Atau:

```bash
git log -p -- 'src/main/resources/application*.yml'
```

Pertanyaan:

1. Apakah default timeout berubah?
2. Apakah feature flag berubah?
3. Apakah endpoint external system berubah?
4. Apakah pool size berubah?
5. Apakah retry/backoff berubah?
6. Apakah logging level berubah?
7. Apakah property security berubah?

Perubahan config sering tidak terlihat dalam code review jika reviewer hanya fokus Java source.

---

## 27. Membaca Perubahan Test

Untuk melihat perubahan test:

```bash
git log -p -- src/test
```

Atau spesifik:

```bash
git log -p -- src/test/java/com/example/order/OrderServiceTest.java
```

Saat membaca commit production code, lihat apakah test ikut berubah:

```bash
git show --name-only <commit>
```

Jika commit mengubah behavior tetapi tidak mengubah/menambah test, itu bukan selalu salah, tetapi perlu ditanyakan.

Pertanyaan:

1. Apakah test ditambah atau hanya diubah agar pass?
2. Apakah assertion diperkuat atau dilemahkan?
3. Apakah test dihapus?
4. Apakah test menjadi lebih brittle?
5. Apakah test hanya cover happy path?
6. Apakah ada regression test untuk bugfix?

---

## 28. Membaca History untuk Code Review

Sebelum review PR, kamu bisa membaca branch history lokal:

```bash
git fetch origin
git log --oneline --graph --decorate origin/main..HEAD
```

Lihat file berubah:

```bash
git diff --name-status origin/main...HEAD
```

Lihat statistik:

```bash
git diff --stat origin/main...HEAD
```

Baca patch:

```bash
git diff origin/main...HEAD
```

Jika branch punya banyak commit, baca commit satu per satu:

```bash
git log --reverse --oneline origin/main..HEAD
```

`--reverse` membuat commit tampil dari paling lama ke terbaru, sehingga narasi perubahan lebih mudah diikuti.

### 28.1 Review by Commit vs Review by Final Diff

Ada dua mode membaca PR:

| Mode | Cocok untuk |
|---|---|
| Final diff | PR kecil, perubahan sederhana, squash workflow |
| Commit-by-commit | PR besar, perubahan bertahap, refactor + behavior change |

Commit-by-commit efektif jika author membuat commit atomic. Jika commit berantakan, final diff kadang lebih mudah.

Prinsip:

```text
History yang baik mengurangi cognitive load reviewer.
```

---

## 29. Membaca History untuk Incident Investigation

Misalnya ada incident pada service order setelah deploy.

Langkah awal:

```bash
git fetch origin
```

Identifikasi range release/deploy:

```bash
git log --oneline v1.8.0..v1.9.0
```

Lihat file yang berubah:

```bash
git diff --name-status v1.8.0..v1.9.0
```

Filter area terkait:

```bash
git log --oneline -p v1.8.0..v1.9.0 -- src/main/java/com/example/order
```

Cari perubahan config:

```bash
git log -p v1.8.0..v1.9.0 -- 'src/main/resources/application*.yml'
```

Cari perubahan dependency:

```bash
git log -p v1.8.0..v1.9.0 -- pom.xml build.gradle build.gradle.kts
```

Pertanyaan investigasi:

1. Commit mana yang masuk release ini?
2. Perubahan mana yang menyentuh path runtime incident?
3. Apakah ada perubahan config/dependency/test?
4. Apakah ada commit revert/hotfix?
5. Apakah ada merge commit dengan conflict resolution?
6. Apakah perubahan tampak related secara domain?

Git history tidak membuktikan root cause sendirian, tetapi mempersempit ruang pencarian.

---

## 30. Membaca History untuk Legacy Code

Saat masuk module lama, jangan langsung refactor.

Gunakan history untuk memahami konteks.

Misalnya:

```bash
git log --oneline -- src/main/java/com/example/payment/PaymentPolicy.java
```

Lalu baca commit penting:

```bash
git show <commit>
```

Cari issue key di message:

```bash
git log --grep="PAY-" -- src/main/java/com/example/payment
```

Cari kapan rule muncul:

```bash
git log -S"MAX_RETRY" -- src/main/java/com/example/payment
```

Baca sekitar commit:

```bash
git log --oneline --graph --decorate <commit>~5..<commit>~5
```

Lebih praktis:

```bash
git log --oneline --graph --decorate --ancestry-path <old>..<new>
```

Legacy archaeology mindset:

```text
Kode yang terlihat aneh bisa jadi hasil constraint lama, bug production, aturan compliance, integrasi vendor, atau migration bertahap.
```

Git history membantu membedakan:

1. accidental complexity,
2. intentional workaround,
3. temporary patch yang menjadi permanen,
4. behavior yang dikunci oleh production dependency,
5. desain lama yang sudah tidak relevan.

---

## 31. `--simplify-by-decoration` dan Membaca Release/Tag

Untuk melihat commit yang punya branch/tag decoration:

```bash
git log --oneline --decorate --simplify-by-decoration --all
```

Ini berguna untuk overview release/tag:

```text
* a8c1d21 (tag: v1.9.0, origin/main, main) Release 1.9.0
* f31d9ac (tag: v1.8.1) Hotfix payment timeout
* c9e1120 (tag: v1.8.0) Release 1.8.0
```

Untuk melihat tag:

```bash
git tag
```

Untuk tag yang mengandung commit tertentu:

```bash
git tag --contains <commit>
```

Untuk branch yang mengandung commit tertentu:

```bash
git branch --contains <commit>
```

Use case:

```text
Apakah bugfix commit ini sudah masuk release tag tertentu?
```

---

## 32. `--first-parent`: Membaca Mainline History

Pada repository dengan banyak merge commit, history bisa ramai.

```bash
git log --oneline --first-parent main
```

`--first-parent` mengikuti parent pertama setiap merge commit. Ini sering dipakai untuk membaca history mainline, terutama jika PR di-merge dengan merge commit.

Contoh:

```text
M1 Merge pull request #124 from feature/payment-timeout
M2 Merge pull request #123 from feature/order-validation
M3 Merge pull request #122 from hotfix/logging
```

Ini memberi narasi integrasi ke main.

### 32.1 Kapan `--first-parent` Berguna?

1. Membuat release note dari PR merge.
2. Membaca apa yang masuk main tanpa semua commit internal branch.
3. Melihat urutan integrasi.
4. Audit deployment jika deploy dari main.

### 32.2 Kapan Tidak Cukup?

Jika kamu perlu memahami perubahan detail, `--first-parent` terlalu kasar. Kamu perlu masuk ke merge commit atau branch commit.

---

## 33. `--cherry-pick` dan Duplicate Patch Semantics

Kadang commit berbeda hash tetapi membawa perubahan patch yang sama, misalnya karena cherry-pick.

Contoh:

```text
A---B---C main
     \
      D---E release/1.8
```

Commit `C` dan `E` bisa punya patch yang sama tetapi hash berbeda.

Command seperti:

```bash
git log --cherry-pick --right-only main...release/1.8
```

bisa membantu menyaring commit dengan patch yang setara.

Ini advanced, tetapi penting untuk backport/hotfix workflow. Akan dibahas lagi di Part 015/016.

---

## 34. Membaca History dengan Pathspec yang Tepat

Git pathspec bisa lebih kuat dari sekadar path literal.

Contoh semua Java file:

```bash
git log -- '*.java'
```

Semua file di module order:

```bash
git log -- src/main/java/com/example/order
```

Exclude path tertentu:

```bash
git log -- . ':(exclude)src/test'
```

Cari perubahan production Java tanpa test:

```bash
git log -- src/main/java ':(exclude)src/test'
```

Catatan: quoting penting agar shell tidak melakukan glob expansion sebelum Git menerima pattern.

Gunakan:

```bash
git log -- '*.java'
```

Bukan selalu:

```bash
git log -- *.java
```

Karena `*.java` tanpa quote bisa diekspansi oleh shell berdasarkan file di direktori saat ini.

---

## 35. Membaca History dengan `--` dan Shell Safety

Jika nama file mengandung spasi atau karakter khusus:

```bash
git log -- "path/with space/File.java"
```

Jika nama branch mirip nama file, separator `--` mencegah ambiguitas.

Contoh:

```bash
git log main -- main
```

Bisa berarti:

```text
Tampilkan history path bernama main pada branch main.
```

Tanpa `--`, interpretasi bisa membingungkan.

Prinsip:

```text
Selalu pisahkan revision dan path dengan -- saat query path.
```

---

## 36. Menggabungkan Filter

Kekuatan `git log` muncul dari kombinasi filter.

Contoh: perubahan module order oleh Alice dalam 30 hari terakhir:

```bash
git log --oneline --author="Alice" --since="30 days ago" -- src/main/java/com/example/order
```

Contoh: commit yang mengandung kata `timeout` di message dan menyentuh config:

```bash
git log --oneline --grep="timeout" -- 'src/main/resources/application*.yml'
```

Contoh: patch perubahan method tertentu:

```bash
git log -G"canSubmit" -p -- src/main/java/com/example/order/OrderService.java
```

Contoh: release delta untuk production source saja:

```bash
git log --oneline v1.8.0..v1.9.0 -- src/main/java src/main/resources
```

Contoh: semua perubahan dependency oleh bot:

```bash
git log --author="dependabot" --oneline -- pom.xml build.gradle build.gradle.kts gradle.lockfile
```

---

## 37. Praktik Investigasi: “Kapan Rule Ini Masuk?”

Misalnya kamu menemukan code:

```java
return order != null && order.amount() > 0;
```

Pertanyaan:

```text
Kapan rule amount > 0 ditambahkan?
```

Langkah:

```bash
git log -S"order.amount() > 0" -- src/main/java/com/example/order/OrderService.java
```

Baca commit:

```bash
git show <commit>
```

Jika string berubah bentuk, gunakan regex:

```bash
git log -G"amount\(\).*0" -p -- src/main/java/com/example/order/OrderService.java
```

Lalu baca konteks ancestry sebelum commit tersebut:

```bash
git log --oneline --graph --decorate <commit>~5..<commit>
```

Artinya:

```text
Tampilkan jalur commit dari sekitar lima parent sebelum <commit> sampai <commit>.
```

Untuk repository dengan branch/merge yang kompleks, gunakan graph global agar kamu melihat posisi commit terhadap branch lain:

```bash
git log --oneline --graph --decorate --all --date-order --max-count=40
```

Jika kamu sudah tahu dua titik dalam ancestry yang sama, kamu bisa membatasi jalur:

```bash
git log --oneline --graph --decorate --ancestry-path <old-known-commit>..<new-known-commit>
```

Pelajaran penting: membaca sekitar commit di graph tidak selalu sesederhana “ambil 3 sebelum dan 3 sesudah”, karena history bisa bercabang. Gunakan graph view untuk memahami konteks.

---

## 38. Praktik Investigasi: “Apa yang Akan Masuk PR Saya?”

Sebelum membuat PR dari branch feature ke main:

```bash
git fetch origin
```

Lihat commit branch:

```bash
git log --oneline --graph --decorate origin/main..HEAD
```

Baca dari awal:

```bash
git log --reverse --oneline origin/main..HEAD
```

Lihat file:

```bash
git diff --name-status origin/main...HEAD
```

Lihat statistik:

```bash
git diff --stat origin/main...HEAD
```

Baca patch:

```bash
git diff origin/main...HEAD
```

Cek apakah ada file tidak sengaja:

```bash
git diff --name-only origin/main...HEAD
```

Pertanyaan review diri:

1. Apakah ada file generated ikut masuk?
2. Apakah ada config lokal ikut masuk?
3. Apakah commit history bisa dibaca?
4. Apakah test ikut berubah sesuai behavior?
5. Apakah perubahan dependency disengaja?
6. Apakah ada secret/log/debug code?
7. Apakah branch mengandung commit yang tidak relevan?

---

## 39. Praktik Investigasi: “Apa yang Berubah Sejak Release Terakhir?”

Misalnya release sebelumnya `v1.8.0`, kandidat release `v1.9.0`.

Daftar commit:

```bash
git log --oneline v1.8.0..v1.9.0
```

Mainline only:

```bash
git log --oneline --first-parent v1.8.0..v1.9.0
```

Statistik:

```bash
git diff --stat v1.8.0..v1.9.0
```

File berubah:

```bash
git diff --name-status v1.8.0..v1.9.0
```

Production code:

```bash
git diff --name-status v1.8.0..v1.9.0 -- src/main src/main/resources
```

Dependency/config:

```bash
git diff v1.8.0..v1.9.0 -- pom.xml build.gradle build.gradle.kts 'src/main/resources/application*.yml'
```

Commit message untuk release note:

```bash
git log --pretty=format:'- %s (%h)' v1.8.0..v1.9.0
```

Catatan: release note yang baik biasanya tidak hanya mengambil commit message mentah. Commit message adalah input, bukan output final. Tetap perlu kurasi berdasarkan user impact, operational impact, dan risk.

---

## 40. Praktik Investigasi: “Kenapa Branch Saya Diverged?”

Misalnya Git berkata:

```text
Your branch and 'origin/main' have diverged.
```

Langkah:

```bash
git fetch origin
```

Lihat graph:

```bash
git log --oneline --graph --decorate --all -30
```

Lihat commit lokal yang belum di remote:

```bash
git log --oneline origin/main..HEAD
```

Lihat commit remote yang belum di lokal:

```bash
git log --oneline HEAD..origin/main
```

Cari merge base:

```bash
git merge-base HEAD origin/main
```

Tampilkan merge base:

```bash
git show --oneline --no-patch $(git merge-base HEAD origin/main)
```

Interpretasi:

1. Jika commit lokal hanya pekerjaan pribadi, rebase mungkin cocok.
2. Jika commit lokal sudah dipush/shared, merge mungkin lebih aman.
3. Jika divergence karena force push remote, investigasi lebih hati-hati.
4. Jangan langsung `git pull` tanpa paham mode pull merge/rebase.

---

## 41. Anti-Pattern Saat Membaca History

### 41.1 Hanya Membaca Commit Message

Commit message bisa salah, kurang lengkap, atau terlalu umum.

Selalu cek patch untuk perubahan penting.

### 41.2 Hanya Membaca Diff Tanpa Message

Diff menunjukkan apa yang berubah, tetapi belum tentu kenapa.

Message, issue, PR, dan surrounding commits membantu konteks.

### 41.3 Menganggap Author sebagai Pihak yang Harus Disalahkan

`git blame` dan history adalah alat pemahaman, bukan alat mencari kambing hitam.

Kode adalah hasil sistem: requirement, deadline, review, incident, constraint, dan tooling.

### 41.4 Mengabaikan Merge Commit

Merge commit bisa menyimpan conflict resolution penting.

Jika bug muncul setelah merge, jangan hanya lihat commit branch; lihat merge result juga.

### 41.5 Mengabaikan Config dan Dependency

Banyak bug runtime tidak berasal dari `.java`, tetapi dari:

1. config,
2. dependency,
3. Dockerfile,
4. migration,
5. CI pipeline,
6. environment variable,
7. generated code.

### 41.6 Salah Memakai Range

`main..feature` bukan sama dengan `feature..main`.

Urutan penting.

Biasakan verbalize:

```text
A..B = commit reachable dari B yang tidak reachable dari A.
```

### 41.7 Membaca History Tanpa Fetch

Jika membandingkan dengan remote, lakukan:

```bash
git fetch origin
```

Tanpa fetch, `origin/main` bisa stale.

---

## 42. Decision Matrix: Command Mana untuk Pertanyaan Apa?

| Pertanyaan | Command Awal |
|---|---|
| Commit terbaru apa saja? | `git log --oneline -10` |
| Bentuk graph branch seperti apa? | `git log --oneline --graph --decorate --all` |
| Apa isi commit ini? | `git show <commit>` |
| File apa yang berubah di commit ini? | `git show --name-status <commit>` |
| Statistik commit ini? | `git show --stat <commit>` |
| History file ini? | `git log -- <path>` |
| History file meski rename? | `git log --follow -- <path>` |
| Patch perubahan file ini? | `git log -p -- <path>` |
| Commit branch feature yang belum ada di main? | `git log main..feature` |
| Perubahan antar release? | `git log v1.8.0..v1.9.0` |
| File berubah antar release? | `git diff --name-status v1.8.0..v1.9.0` |
| Kapan string ditambah/dihapus? | `git log -S"text"` |
| Kapan pola berubah? | `git log -G"regex"` |
| Siapa author perubahan? | `git log --author="name"` |
| Commit dalam rentang waktu? | `git log --since="..." --until="..."` |
| Mainline merge history? | `git log --first-parent --oneline main` |
| Branch/tag apa yang mengandung commit? | `git branch --contains <commit>` / `git tag --contains <commit>` |

---

## 43. Java Engineer Checklist Saat Membaca History

Saat membaca history Java project, cek kategori berikut.

### 43.1 Production Code

```bash
git log -p -- src/main/java
```

Pertanyaan:

1. Apakah behavior berubah?
2. Apakah invariant domain berubah?
3. Apakah error handling berubah?
4. Apakah concurrency behavior berubah?
5. Apakah transaction boundary berubah?
6. Apakah serialization/deserialization berubah?
7. Apakah public API berubah?

### 43.2 Test Code

```bash
git log -p -- src/test
```

Pertanyaan:

1. Apakah test cover behavior baru?
2. Apakah assertion melemah?
3. Apakah flaky test diperbaiki atau diabaikan?
4. Apakah integration test berubah?

### 43.3 Build and Dependency

```bash
git log -p -- pom.xml build.gradle build.gradle.kts settings.gradle settings.gradle.kts gradle.properties
```

Pertanyaan:

1. Apakah dependency berubah?
2. Apakah plugin berubah?
3. Apakah Java version berubah?
4. Apakah build profile berubah?
5. Apakah test task berubah?

### 43.4 Runtime Config

```bash
git log -p -- 'src/main/resources/application*.yml' 'src/main/resources/application*.properties'
```

Pertanyaan:

1. Timeout?
2. Retry?
3. Pool size?
4. Security?
5. Feature flag?
6. Endpoint?
7. Logging?

### 43.5 Deployment/Infra

```bash
git log -p -- Dockerfile docker-compose.yml k8s helm .github/workflows Jenkinsfile
```

Pertanyaan:

1. Build image berubah?
2. Environment variable berubah?
3. Resource limit berubah?
4. Health check berubah?
5. Pipeline gate berubah?

---

## 44. History Reading as Observability

Di distributed systems, observability biasanya berarti logs, metrics, traces. Git history bukan runtime observability, tetapi ia adalah **development-time observability**.

Runtime observability menjawab:

```text
Apa yang sedang terjadi di sistem berjalan?
```

Git history menjawab:

```text
Bagaimana sistem sampai ke bentuk ini?
```

Keduanya saling melengkapi.

Saat incident:

1. metrics menunjukkan gejala,
2. logs menunjukkan event,
3. traces menunjukkan path request,
4. Git history menunjukkan perubahan yang mungkin memperkenalkan behavior baru,
5. CI/CD metadata menunjukkan kapan perubahan dideploy.

Engineer kuat menghubungkan semuanya.

---

## 45. Latihan Praktis

### Latihan 1 — Baca History Ringkas

Di repo latihan:

```bash
git log --oneline
```

Jawab:

1. Commit terbaru apa?
2. Commit pertama apa?
3. Apakah message cukup jelas?

### Latihan 2 — Baca Patch Commit

```bash
git log --oneline
```

Pilih commit `Require positive order amount`, lalu:

```bash
git show <commit>
```

Jawab:

1. File apa yang berubah?
2. Behavior apa yang berubah?
3. Apakah ada test yang berubah?
4. Risiko apa yang muncul?

### Latihan 3 — History Per File

```bash
git log -p -- src/main/java/com/example/order/OrderService.java
```

Jawab:

1. Berapa kali file berubah?
2. Perubahan mana yang behavior-changing?
3. Apakah ada perubahan kosmetik?

### Latihan 4 — Simulasi Branch

Buat branch:

```bash
git switch -c feature/minimum-order-amount
```

Ubah validasi amount menjadi minimal 100:

```java
return order != null && order.amount() >= 100;
```

Commit:

```bash
git add .
git commit -m "Require minimum order amount"
```

Kembali ke main dan buat commit lain:

```bash
git switch main
cat > README.md <<'EOF'
# Git History Lab
EOF
git add README.md
git commit -m "Add repository readme"
```

Lihat graph:

```bash
git log --oneline --graph --decorate --all
```

Jawab:

1. Di mana branch bercabang?
2. Commit apa saja di feature tetapi tidak di main?
3. Commit apa saja di main tetapi tidak di feature?

Gunakan:

```bash
git log --oneline main..feature/minimum-order-amount
git log --oneline feature/minimum-order-amount..main
```

### Latihan 5 — Release Delta

Buat tag:

```bash
git tag v0.1.0 HEAD~2
git tag v0.2.0 HEAD
```

Lihat perubahan:

```bash
git log --oneline v0.1.0..v0.2.0
git diff --stat v0.1.0..v0.2.0
git diff --name-status v0.1.0..v0.2.0
```

Jawab:

1. Commit apa saja yang masuk v0.2.0?
2. File apa berubah?
3. Apakah release note bisa dibuat dari commit message saja?

---

## 46. Pertanyaan Reflektif

1. Apakah kamu bisa menjelaskan perbedaan `git log`, `git show`, dan `git diff`?
2. Apakah kamu bisa membaca `A..B` tanpa menebak?
3. Apakah kamu tahu kapan harus memakai `--stat`, `--name-status`, dan `-p`?
4. Apakah kamu selalu `fetch` sebelum membandingkan dengan remote?
5. Apakah kamu bisa mencari kapan sebuah rule ditambahkan?
6. Apakah kamu bisa membedakan author date dan commit date?
7. Apakah kamu membaca dependency/config/test history saat investigasi?
8. Apakah commit message di repository kamu cukup searchable?
9. Apakah kamu bisa membaca merge commit?
10. Apakah kamu bisa menjelaskan history branch kepada reviewer lain?

---

## 47. Ringkasan Mental Model

Ingat rumus ini:

```text
git log = query commit graph
git show = inspect object/commit
git diff = compare snapshots
```

Dan:

```text
A..B = reachable from B, not reachable from A
```

Serta:

```text
History reading is not passive reading.
It is structured investigation.
```

Jika kamu hanya melihat commit list, kamu mendapatkan kronologi.  
Jika kamu membaca graph, patch, file path, range, author/committer, dan context, kamu mendapatkan engineering understanding.

---

## 48. Cheat Sheet Operasional

### Daily Overview

```bash
git log --oneline -10
git log --oneline --graph --decorate --all
```

### Inspect Commit

```bash
git show <commit>
git show --stat <commit>
git show --name-status <commit>
git show <commit>:path/to/file
```

### Branch Delta

```bash
git fetch origin
git log --oneline origin/main..HEAD
git log --reverse --oneline origin/main..HEAD
git diff --name-status origin/main...HEAD
git diff --stat origin/main...HEAD
```

### File History

```bash
git log -- path/to/file
git log -p -- path/to/file
git log --follow -- path/to/file
```

### Search

```bash
git log --grep="keyword"
git log -S"literal"
git log -G"regex"
```

### Release Delta

```bash
git log --oneline v1.0.0..v1.1.0
git log --first-parent --oneline v1.0.0..v1.1.0
git diff --stat v1.0.0..v1.1.0
git diff --name-status v1.0.0..v1.1.0
```

---

## 49. Common Failure Mode dan Recovery Mindset

### Failure Mode 1 — Salah Range

Gejala:

```text
Commit yang muncul tidak sesuai ekspektasi.
```

Tindakan:

```bash
git log --oneline --graph --decorate --all
```

Lalu verbalize:

```text
A..B = commit di B yang tidak ada di A.
```

### Failure Mode 2 — Remote Stale

Gejala:

```text
Diff dengan origin/main tidak sesuai PR.
```

Tindakan:

```bash
git fetch origin
```

Ulangi query.

### Failure Mode 3 — Rename Memutus History

Gejala:

```text
File tampak baru padahal pernah ada sebelumnya.
```

Tindakan:

```bash
git log --follow -- path/to/file
```

Jika masih tidak cukup, cari string penting dengan `-S` atau `-G`.

### Failure Mode 4 — Statistik Menyesatkan

Gejala:

```text
Commit kecil dianggap aman.
```

Tindakan:

Baca patch dan domain impact:

```bash
git show <commit>
```

### Failure Mode 5 — Merge Commit Diabaikan

Gejala:

```text
Bug muncul setelah merge tetapi tidak terlihat di commit feature.
```

Tindakan:

```bash
git show -m <merge-commit>
git show --cc <merge-commit>
```

---

## 50. Penutup

Membaca history adalah skill inti yang sering diremehkan. Banyak engineer bisa menulis kode, tetapi tidak bisa membaca evolusi kode dengan baik. Padahal di sistem nyata, terutama sistem Java backend, microservices, dan regulated systems, konteks historis sering menentukan keputusan teknis yang aman.

Git history membantu menjawab:

```text
Apa yang berubah?
Kapan berubah?
Siapa yang menulis?
Siapa yang memasukkan?
Kenapa mungkin berubah?
File dan module apa yang terdampak?
Apakah perubahan ini sudah masuk release?
Apakah branch ini diverged?
Apakah commit ini memperkenalkan risiko?
```

Part berikutnya akan memperdalam `git diff`.

Kita akan membahas perbedaan:

```text
working tree vs index
index vs HEAD
commit vs commit
branch two-dot vs three-dot
merge-base diff
rename detection
whitespace diff
semantic reading of Java diffs
```

---

## 51. Status Seri

```text
Progress: 005 / 032
Seri belum selesai.
Bagian terakhir: learn-git-mastery-for-java-engineers-part-032.md
```

Bagian berikutnya:

```text
learn-git-mastery-for-java-engineers-part-006.md
```

Topik:

```text
Diff Mental Model: Membandingkan State, Bukan Sekadar File
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 004 — Lifecycle Perubahan: Dari Edit File sampai Commit Berkualitas](./learn-git-mastery-for-java-engineers-part-004.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Part 006 — Diff Mental Model: Membandingkan State, Bukan Sekadar File](./learn-git-mastery-for-java-engineers-part-006.md)

# learn-git-mastery-for-java-engineers-part-002.md

# Part 002 — Repository, Working Tree, Index, dan Object Database

> Seri: **Git Mastery for Java Engineers**  
> Bagian: **002 / 032**  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-git-mastery-for-java-engineers-part-001.md`  
> Bagian berikutnya: `learn-git-mastery-for-java-engineers-part-003.md`

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya, kita membangun mental model besar bahwa Git adalah sistem untuk merepresentasikan evolusi software. Sekarang kita masuk satu lapis lebih rendah: **apa sebenarnya isi repository Git dan bagaimana Git memindahkan perubahan dari file biasa menjadi history yang tersimpan secara permanen**.

Banyak engineer bisa memakai Git setiap hari, tetapi tetap bingung ketika menghadapi kasus seperti:

```text
Kenapa file sudah saya edit tetapi belum masuk commit?
Kenapa git add diperlukan?
Kenapa commit saya tidak berubah walaupun file saya ubah setelah commit?
Apa bedanya working tree, index, dan repository?
Apa isi folder .git?
Kenapa Git bisa recover commit yang tampak hilang?
Kenapa Git bisa tahu file berubah?
Kenapa rename file kadang terdeteksi, kadang tidak?
Apa sebenarnya yang disimpan Git: diff atau snapshot?
```

Jawaban dari semua pertanyaan itu ada di empat konsep inti:

```text
1. Working tree
2. Index / staging area
3. Local repository
4. Object database
```

Bagian ini akan sangat fundamental. Setelah memahaminya, command seperti `git add`, `git commit`, `git diff`, `git reset`, `git restore`, `git checkout`, `git status`, dan `git log` tidak lagi terasa seperti command terpisah. Semuanya menjadi operasi terhadap state.

---

## 1. Peta Mental Awal

Sebuah project Git lokal secara konseptual punya tiga area utama:

```text
+-------------------+        +-------------------+        +----------------------+
|   Working Tree    | -----> |       Index       | -----> |   Local Repository   |
|                   | git add|  / Staging Area   | commit |      .git/objects    |
+-------------------+        +-------------------+        +----------------------+
        |                            |                              |
        | files yang sedang          | snapshot calon commit         | object database permanen
        | kamu edit                  |                              |
```

Cara paling sederhana memahaminya:

| Area | Pertanyaan yang dijawab | Contoh |
|---|---|---|
| Working tree | “Apa isi file di disk saya sekarang?” | `src/main/java/...` yang sedang diedit |
| Index | “Apa yang akan masuk commit berikutnya?” | perubahan yang sudah `git add` |
| Local repository | “Apa yang sudah tersimpan sebagai history?” | commit, tree, blob, tag di `.git/objects` |

Git bukan langsung mengambil semua file dari working tree saat commit. Git membuat commit dari **index**, bukan langsung dari working tree.

Ini sangat penting.

```text
commit berikutnya = isi index, bukan seluruh isi working tree
```

Karena itu, file yang sudah diedit tetapi belum di-`add` tidak masuk commit. File yang sudah di-`add`, lalu diedit lagi, memiliki dua versi sekaligus:

```text
versi staged     = versi saat terakhir git add
versi unstaged   = perubahan tambahan setelah git add
```

Inilah salah satu alasan Git sangat powerful: Git memungkinkan engineer menyusun commit secara sadar, bukan sekadar menyimpan semua perubahan yang kebetulan ada di folder.

---

## 2. Repository Git Bukan Folder Project Saja

Ketika melihat project Java, kita biasanya melihat struktur seperti ini:

```text
my-service/
├── pom.xml
├── src/
│   ├── main/
│   │   └── java/
│   └── test/
└── README.md
```

Setelah `git init`, ada folder tersembunyi:

```text
my-service/
├── .git/
├── pom.xml
├── src/
└── README.md
```

Folder `.git` adalah pusat repository lokal. Tanpa `.git`, folder itu hanya folder biasa. Dengan `.git`, folder itu menjadi working tree dari repository Git.

Secara sederhana:

```text
working tree = file project yang terlihat dan kamu edit
.git         = database dan metadata Git
```

Jika kamu menghapus `.git`, history Git hilang dari folder tersebut, tetapi file project tetap ada. Sebaliknya, jika kamu punya `.git` yang valid, Git punya metadata untuk memahami status file, branch, HEAD, object, remote, config, dan history.

---

## 3. Apa yang Terjadi Saat `git init`?

Ketika menjalankan:

```bash
git init
```

Git membuat struktur internal repository. Contoh isi awal `.git` biasanya seperti ini:

```text
.git/
├── HEAD
├── config
├── description
├── hooks/
├── info/
├── objects/
└── refs/
```

Belum ada commit. Belum ada file project yang tersimpan dalam history. Yang ada hanya struktur kosong untuk menampung object dan references.

### 3.1 `.git/HEAD`

`HEAD` menunjukkan posisi kerja saat ini. Pada repository baru, isinya biasanya:

```text
ref: refs/heads/main
```

Artinya:

```text
HEAD menunjuk ke branch main
branch main nantinya menunjuk ke commit terakhir branch tersebut
```

Pada repository baru tanpa commit, branch `main` belum benar-benar menunjuk ke commit apa pun. Ia baru nama target.

### 3.2 `.git/config`

Berisi konfigurasi lokal repository, misalnya:

```ini
[core]
    repositoryformatversion = 0
    filemode = true
    bare = false
    logallrefupdates = true
```

Konfigurasi ini berlaku hanya untuk repository tersebut, berbeda dari config global user.

### 3.3 `.git/objects/`

Ini adalah object database. Di sinilah Git menyimpan data permanen seperti isi file, struktur directory, commit, dan tag.

Pada repository baru, folder ini hampir kosong:

```text
.git/objects/
├── info/
└── pack/
```

Nanti, ketika kamu membuat object, Git akan menyimpan object berdasarkan hash-nya.

### 3.4 `.git/refs/`

Berisi reference seperti branch dan tag:

```text
.git/refs/
├── heads/
└── tags/
```

Branch lokal normalnya disimpan di `refs/heads/`. Tag disimpan di `refs/tags/`.

---

## 4. Tiga Area Utama Git

Mari kita detailkan satu per satu.

---

## 5. Working Tree

Working tree adalah checkout dari satu versi project yang ditempatkan sebagai file biasa di disk.

Contoh:

```text
src/main/java/com/example/order/OrderService.java
src/test/java/com/example/order/OrderServiceTest.java
pom.xml
README.md
```

Ini adalah area tempat IDE, compiler, test runner, formatter, dan developer bekerja.

Untuk Java engineer, working tree adalah tempat kamu melakukan hal seperti:

```text
- edit class Java
- tambah unit test
- ubah pom.xml
- generate source dari OpenAPI/protobuf
- menjalankan mvn test
- menjalankan formatter
- menghapus file lama
- rename package
```

Git memonitor working tree dengan membandingkan state file terhadap index dan commit terakhir.

### 5.1 Working Tree Bukan History

Perubahan di working tree belum berarti tersimpan di Git history.

Misalnya:

```bash
vim src/main/java/com/acme/payment/PaymentService.java
```

Setelah edit, Git bisa melihat file berubah:

```bash
git status
```

Namun perubahan itu belum menjadi bagian dari commit. Ia hanya perubahan di working tree.

### 5.2 Working Tree Bisa Berisi Banyak Jenis Perubahan

Git melihat file dalam working tree sebagai beberapa kategori:

```text
untracked  = file baru yang belum pernah dilacak Git
modified   = file tracked yang isinya berubah
 deleted   = file tracked yang hilang dari working tree
renamed    = file yang terdeteksi berpindah nama/lokasi
ignored    = file yang sengaja diabaikan melalui .gitignore atau konfigurasi lain
```

Contoh di project Java:

| Kondisi | Contoh |
|---|---|
| Untracked | `src/main/java/com/acme/NewService.java` baru dibuat |
| Modified | `OrderService.java` diedit |
| Deleted | `LegacyDao.java` dihapus |
| Ignored | `target/`, `.idea/`, `*.class` |

### 5.3 Working Tree Adalah Tempat Risiko Paling Tinggi

Perubahan di working tree belum aman secara historis.

Jika file belum distage atau dicommit, risiko masih tinggi:

```text
- bisa tertimpa manual
- bisa hilang karena checkout/reset yang salah
- belum bisa dishare
- belum punya commit id
- belum punya audit trail
```

Karena itu, engineer yang kuat sering membuat commit kecil dan sering, atau minimal menggunakan branch/stash/worktree untuk menjaga state.

---

## 6. Index / Staging Area

Index adalah salah satu konsep Git yang paling sering diremehkan.

Banyak pemula menganggap `git add` hanya berarti “mulai track file”. Itu hanya sebagian kecil. Lebih tepat:

```text
git add = salin state file dari working tree ke index sebagai calon isi commit berikutnya
```

Index adalah snapshot sementara yang akan menjadi commit berikutnya.

### 6.1 Commit Dibuat dari Index

Saat menjalankan:

```bash
git commit
```

Git tidak bertanya:

```text
Apa semua isi working tree saat ini?
```

Git bertanya:

```text
Apa isi index saat ini?
```

Lalu Git membuat commit dari index.

Artinya:

```text
working tree     = apa yang sedang terjadi sekarang
index            = apa yang kamu pilih untuk commit berikutnya
HEAD commit      = commit terakhir yang sudah tersimpan
```

### 6.2 Kenapa Index Ada?

Index membuat Git bisa mendukung workflow yang sangat penting:

#### 6.2.1 Membuat commit atomic dari perubahan campur aduk

Misalnya kamu sedang mengerjakan `PaymentService.java`, lalu menemukan bug kecil di `MoneyUtils.java`.

Working tree berisi dua perubahan:

```text
1. refactor PaymentService untuk fitur baru
2. fix rounding bug di MoneyUtils
```

Tanpa staging area, kamu harus commit semuanya sekaligus atau memindahkan perubahan manual. Dengan index:

```bash
git add src/main/java/com/acme/MoneyUtils.java
git commit -m "Fix rounding in money utility"

git add src/main/java/com/acme/PaymentService.java
git commit -m "Refactor payment authorization flow"
```

Hasilnya dua commit bersih.

#### 6.2.2 Partial staging

Bahkan dalam satu file, kamu bisa memilih sebagian perubahan:

```bash
git add -p src/main/java/com/acme/OrderService.java
```

Ini memungkinkan satu file besar berisi beberapa perubahan logis dipisah menjadi commit berbeda.

#### 6.2.3 Review sebelum commit

Kamu bisa melihat apa yang akan masuk commit:

```bash
git diff --staged
```

Ini jauh lebih aman daripada commit membabi buta.

#### 6.2.4 Menjaga history sebagai narasi

Index adalah alat editorial. Ia memungkinkan kamu menyusun history seperti cerita yang bisa dibaca:

```text
commit 1: add validation rule
commit 2: add test coverage
commit 3: wire validation into controller
commit 4: update error response contract
```

Bukan:

```text
commit: update stuff
```

### 6.3 Index Bukan Sekadar “Daftar File”

Index menyimpan informasi lebih kaya daripada sekadar nama file. Secara konseptual, index menyimpan:

```text
- path file
- mode file
- object id untuk isi file staged
- metadata untuk deteksi perubahan
- informasi stage saat conflict
```

Pada kondisi normal, setiap path punya satu entry staged. Pada kondisi conflict, index bisa menyimpan beberapa stage untuk path yang sama:

```text
stage 1 = common ancestor
stage 2 = ours
stage 3 = theirs
```

Ini akan dibahas lebih detail di bagian conflict resolution.

### 6.4 Melihat Index

Command yang sering dipakai:

```bash
git status
```

Untuk melihat staged diff:

```bash
git diff --staged
```

Untuk melihat entry index secara lebih internal:

```bash
git ls-files --stage
```

Contoh output:

```text
100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 0 README.md
```

Maknanya:

```text
100644      = file mode
hash        = object id blob yang distage
0           = stage normal
README.md   = path
```

---

## 7. Local Repository

Local repository adalah database Git lokal yang berisi history dan metadata.

Secara fisik, pusatnya ada di:

```text
.git/
```

Secara konseptual, local repository berisi:

```text
- object database
- refs / branch / tag
- HEAD
- config
- reflog
- hooks
- remote metadata
```

Yang paling penting untuk bagian ini adalah object database dan refs.

### 7.1 Local Repository Bukan Remote

Saat kamu commit, commit itu masuk local repository dulu.

```bash
git commit -m "Add payment validation"
```

Commit tersebut belum otomatis ada di GitHub/GitLab/Bitbucket.

Untuk mengirim ke remote:

```bash
git push
```

Jadi ada dua level penyimpanan:

```text
local commit  = tersimpan di repository lokal
remote commit = sudah dikirim ke repository remote
```

Ini penting untuk memahami rewrite history:

```text
history private lokal lebih bebas diubah
history yang sudah dipush harus diperlakukan sebagai kontrak bersama
```

---

## 8. Object Database

Object database adalah jantung Git.

Git menyimpan data sebagai object yang diidentifikasi oleh hash. Secara fundamental, Git dapat dipahami sebagai content-addressable object database.

Artinya:

```text
alamat object ditentukan oleh isi object itu sendiri
```

Jika isi berubah, object id berubah.

### 8.1 Empat Jenis Object Utama

Git punya beberapa jenis object. Yang paling penting:

```text
1. blob
2. tree
3. commit
4. tag
```

| Object | Fungsi | Analogi |
|---|---|---|
| Blob | Menyimpan isi file | byte content file |
| Tree | Menyimpan struktur directory dan referensi ke blob/tree lain | directory snapshot |
| Commit | Menunjuk ke root tree + parent + metadata | titik history |
| Tag | Memberi nama stabil ke object, biasanya commit | label release |

Bagian ini fokus pada blob, tree, dan commit. Tag akan dibahas lebih dalam di bagian release.

---

## 9. Blob Object

Blob menyimpan isi file.

Penting:

```text
blob tidak menyimpan nama file
blob tidak menyimpan path
blob tidak menyimpan metadata commit
blob hanya menyimpan isi
```

Misalnya dua file punya isi sama:

```text
src/main/resources/banner.txt
src/test/resources/expected-banner.txt
```

Jika isi byte-nya identik, Git bisa menyimpan satu blob yang sama dan direferensikan oleh dua path berbeda melalui tree.

### 9.1 Blob Adalah Content, Bukan File Identity

Dalam Git, identitas isi file dan identitas path dipisahkan.

```text
blob = isi file
path = disimpan di tree
```

Ini menjelaskan banyak perilaku Git:

```text
- rename tidak disimpan sebagai operasi khusus di blob
- Git dapat mendeteksi rename berdasarkan kemiripan content
- file dengan isi sama dapat menunjuk ke blob sama
```

### 9.2 Membuat Blob Secara Internal

Secara plumbing, kamu bisa membuat object dari file:

```bash
echo "hello" > hello.txt
git hash-object -w hello.txt
```

Outputnya object id, misalnya:

```text
ce013625030ba8dba906f756967f9e9ca394464a
```

Object disimpan di `.git/objects/`.

Biasanya kamu tidak perlu memakai command plumbing seperti ini dalam kerja harian, tetapi memahami ini membuat Git lebih transparan.

---

## 10. Tree Object

Tree menyimpan struktur directory.

Jika blob menyimpan isi file, tree menjawab:

```text
path ini menunjuk ke blob/tree mana?
mode file-nya apa?
nama entry-nya apa?
```

Contoh konseptual tree:

```text
root tree
├── README.md                         -> blob abc123
├── pom.xml                           -> blob def456
└── src                               -> tree 111aaa
    └── main                          -> tree 222bbb
        └── java                      -> tree 333ccc
            └── com/acme/App.java     -> blob 999fff
```

Git commit tidak menyimpan semua file secara flat. Commit menunjuk ke root tree. Root tree menunjuk ke tree/blob lain.

### 10.1 Tree Adalah Snapshot Struktur Project

Jika commit adalah snapshot project, tree adalah struktur snapshot itu.

Commit menunjuk ke satu root tree:

```text
commit C1
  tree T1
```

Tree T1 kemudian merepresentasikan seluruh isi project pada commit tersebut.

### 10.2 Tree Memungkinkan Sharing Object

Misalnya kamu mengubah hanya satu file:

```text
src/main/java/com/acme/PaymentService.java
```

Git tidak harus membuat ulang semua blob. File yang tidak berubah tetap menunjuk ke blob lama. Tree untuk directory yang berubah akan berubah, dan tree ancestor-nya ikut berubah, tetapi object yang tidak berubah bisa dipakai ulang.

Inilah salah satu alasan Git efisien walaupun model mentalnya snapshot.

---

## 11. Commit Object

Commit object adalah titik history.

Commit biasanya berisi:

```text
- pointer ke root tree
- pointer ke parent commit
- author
- committer
- timestamp
- commit message
```

Contoh konseptual:

```text
tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904
parent a1b2c3d4...
author Alice <alice@example.com> 1710000000 +0700
committer Alice <alice@example.com> 1710000000 +0700

Add payment validation
```

Commit tidak “berisi diff” sebagai penyimpanan utama. Commit menunjuk ke snapshot tree. Diff bisa dihitung dengan membandingkan tree commit tersebut dengan tree parent-nya.

### 11.1 Commit Sebagai Node Graph

Jika commit punya parent, maka history menjadi graph:

```text
A <- B <- C
```

Maknanya:

```text
B punya parent A
C punya parent B
```

Branch nanti hanyalah pointer ke salah satu commit.

### 11.2 Initial Commit

Commit pertama tidak punya parent:

```text
A
```

Commit biasa punya satu parent:

```text
A <- B
```

Merge commit punya dua atau lebih parent:

```text
A <- B ---- M
     \     /
      C <-
```

Part ini belum membahas merge secara detail, tetapi penting untuk tahu bahwa parent commit adalah bagian dari object commit.

---

## 12. Bagaimana `git add` Bekerja?

Misalkan kamu punya file:

```bash
echo "hello" > README.md
```

Lalu menjalankan:

```bash
git add README.md
```

Secara konseptual Git melakukan ini:

```text
1. Membaca isi README.md dari working tree.
2. Membuat blob object untuk isi tersebut jika belum ada.
3. Menambahkan/men更新 entry README.md di index agar menunjuk ke blob itu.
```

Diagram:

```text
Working Tree                  Index                         Object DB
-------------                 ----------------------        -----------------
README.md = "hello"  ----->   README.md -> blob abc123 --->  blob abc123
```

Belum ada commit. Tetapi object blob mungkin sudah ada di database.

Ini penting: `git add` bukan sekadar “mark file”. Ia menyiapkan object content untuk calon commit.

---

## 13. Bagaimana `git commit` Bekerja?

Setelah `git add`, kamu menjalankan:

```bash
git commit -m "Add README"
```

Secara konseptual Git melakukan:

```text
1. Membaca index.
2. Membuat tree object dari isi index.
3. Membuat commit object yang menunjuk ke root tree.
4. Menetapkan parent commit jika ada.
5. Menggerakkan branch saat ini agar menunjuk ke commit baru.
6. HEAD tetap menunjuk ke branch tersebut.
```

Diagram sebelum commit pertama:

```text
HEAD -> refs/heads/main -> belum ada commit

Index:
README.md -> blob abc123
```

Setelah commit:

```text
HEAD -> refs/heads/main -> commit C1

commit C1
  tree T1
    README.md -> blob abc123
```

Pada commit kedua:

```text
HEAD -> refs/heads/main -> commit C2

commit C2
  parent C1
  tree T2
```

---

## 14. Kenapa Commit Hash Berubah Jika Metadata Berubah?

Object id commit dihitung dari isi commit object. Isi commit object mencakup:

```text
- tree id
- parent id
- author
- committer
- timestamp
- message
```

Maka perubahan kecil pada commit message atau parent akan menghasilkan commit id berbeda.

Ini menjelaskan kenapa rebase membuat commit baru walaupun diff terlihat sama. Saat rebase, parent commit berubah. Karena parent adalah bagian dari isi commit object, hash commit juga berubah.

```text
same patch + different parent = different commit object
```

Ini juga alasan rewrite history harus hati-hati.

---

## 15. Hash: SHA-1, SHA-256, dan Content Addressing

Secara historis, Git menggunakan SHA-1 sebagai object id. Git juga mendukung repository SHA-256 dalam mode tertentu. Yang penting untuk mental model:

```text
object id ditentukan oleh content object
```

Jadi bukan seperti auto-increment database id:

```text
commit id bukan nomor urut
blob id bukan id random
object id adalah fingerprint dari isi object
```

Konsekuensi:

```text
- object dengan isi sama punya id sama
- object dengan isi berbeda punya id berbeda
- Git bisa memverifikasi integritas object
- perubahan metadata commit mengubah commit id
```

Untuk kerja sehari-hari, kamu tidak perlu peduli algoritma hash secara detail. Yang penting adalah sifat content-addressed-nya.

---

## 16. Snapshot vs Diff: Klarifikasi Penting

Git sering disebut menyimpan snapshot, bukan diff. Ini benar sebagai mental model utama, tetapi perlu dibuat presisi.

### 16.1 Dari Sudut Pandang Model

Setiap commit merepresentasikan snapshot project.

```text
commit C1 = project state pada titik C1
commit C2 = project state pada titik C2
```

Diff antara C1 dan C2 dihitung saat dibutuhkan:

```bash
git diff C1 C2
```

### 16.2 Dari Sudut Pandang Storage Optimization

Git bisa melakukan packing dan delta compression di internal storage untuk efisiensi. Tetapi ini detail implementasi penyimpanan, bukan model konseptual commit.

Mental model yang aman:

```text
Git exposes commits as snapshots.
Git may optimize storage internally.
```

Jangan memahami commit sebagai “patch file” biasa. Itu akan membuat rebase, merge, tree, dan object sharing lebih sulit dipahami.

---

## 17. HEAD, Branch, dan Index dalam Commit Baru

Walaupun part khusus commit graph baru ada di Part 003, kita perlu preview kecil.

Misalnya state awal:

```text
HEAD -> main -> C1
```

Kamu edit file, lalu `git add`, lalu `git commit`.

Setelah commit:

```text
HEAD -> main -> C2
              parent -> C1
```

Yang bergerak adalah branch `main`, bukan `HEAD` secara langsung. HEAD tetap menunjuk ke `main`.

Jika detached HEAD, HEAD langsung menunjuk ke commit. Ini akan dibahas nanti.

---

## 18. `git status` sebagai Observability Tool

`git status` adalah command observability paling penting untuk daily Git.

Ia membandingkan tiga state:

```text
HEAD commit
Index
Working tree
```

Secara konseptual:

```text
Changes to be committed      = index berbeda dari HEAD
Changes not staged           = working tree berbeda dari index
Untracked files              = ada di working tree tetapi tidak ada di index/HEAD
```

Contoh:

```text
On branch main
Changes to be committed:
  modified:   src/main/java/com/acme/OrderService.java

Changes not staged for commit:
  modified:   src/main/java/com/acme/OrderService.java

Untracked files:
  src/test/java/com/acme/NewOrderServiceTest.java
```

Ini berarti satu file yang sama punya dua perubahan:

```text
OrderService.java staged     = versi yang akan masuk commit
OrderService.java unstaged   = tambahan perubahan setelah git add
```

Banyak engineer salah mengira Git “duplikat status”. Padahal Git sedang memberi tahu bahwa index dan working tree berbeda.

---

## 19. `git diff` dari Perspektif Tiga Area

Untuk memahami Git dengan benar, hafalkan perbandingan ini:

```bash
git diff
```

Membandingkan:

```text
working tree vs index
```

Artinya: perubahan yang belum staged.

```bash
git diff --staged
```

Membandingkan:

```text
index vs HEAD
```

Artinya: perubahan yang akan masuk commit.

```bash
git diff HEAD
```

Membandingkan:

```text
working tree vs HEAD
```

Artinya: semua perubahan lokal dibanding commit terakhir, baik staged maupun unstaged.

Tabel:

| Command | Membandingkan | Makna |
|---|---|---|
| `git diff` | Working tree ↔ Index | Belum staged |
| `git diff --staged` | Index ↔ HEAD | Akan masuk commit |
| `git diff HEAD` | Working tree ↔ HEAD | Semua perubahan lokal |

Ini sangat penting untuk menghindari commit yang salah.

---

## 20. Praktik Step-by-Step: Melihat Tiga Area Secara Konkret

Buat repository eksperimen:

```bash
mkdir git-three-areas-demo
cd git-three-areas-demo
git init
```

Buat file:

```bash
echo "version 1" > app.txt
```

Cek status:

```bash
git status
```

Kamu akan melihat `app.txt` sebagai untracked.

Stage file:

```bash
git add app.txt
```

Cek diff staged:

```bash
git diff --staged
```

Commit:

```bash
git commit -m "Add app file"
```

Sekarang state:

```text
HEAD = commit pertama
Index = sama dengan HEAD
Working tree = sama dengan index
```

Status clean:

```bash
git status
```

Ubah file:

```bash
echo "version 2" > app.txt
```

Sekarang:

```text
Working tree berbeda dari index
Index sama dengan HEAD
```

Cek:

```bash
git diff
```

Stage:

```bash
git add app.txt
```

Sekarang:

```text
Working tree sama dengan index
Index berbeda dari HEAD
```

Cek:

```bash
git diff
git diff --staged
```

Ubah lagi tanpa add:

```bash
echo "version 3" > app.txt
```

Sekarang:

```text
HEAD          = version 1
Index         = version 2
Working tree  = version 3
```

Cek:

```bash
git status
git diff
git diff --staged
```

Inilah latihan paling penting untuk memahami Git.

---

## 21. State Matrix: HEAD, Index, Working Tree

Bayangkan satu file `OrderService.java`.

| HEAD | Index | Working Tree | Status |
|---|---|---|---|
| v1 | v1 | v1 | clean |
| v1 | v1 | v2 | modified, not staged |
| v1 | v2 | v2 | staged |
| v1 | v2 | v3 | staged + unstaged |
| absent | absent | v1 | untracked |
| v1 | absent | absent | deleted staged, jika removal distage |
| v1 | v1 | absent | deleted not staged |

Dengan matrix ini, banyak command Git menjadi masuk akal:

```text
git add       = copy working tree version to index
git commit    = copy index snapshot to repository as commit
git restore   = copy from index/HEAD to working tree
git reset     = move branch/HEAD and/or copy from commit to index
git checkout  = switch HEAD/branch and update index + working tree
```

---

## 22. `git restore` dan `git reset` dari Perspektif Area

Kita belum masuk detail reset/revert/cherry-pick, tetapi perlu fondasi awal.

### 22.1 Menghapus Perubahan Working Tree

Jika working tree berubah tetapi belum staged:

```bash
git restore app.txt
```

Makna:

```text
copy versi dari index ke working tree
```

Jika index sama dengan HEAD, file kembali ke versi commit terakhir.

### 22.2 Unstage File

Jika perubahan sudah staged:

```bash
git restore --staged app.txt
```

Makna:

```text
copy versi dari HEAD ke index
```

Working tree tetap berisi perubahan.

### 22.3 Reset Mixed

```bash
git reset HEAD~1
```

Secara default reset adalah mixed. Ia memindahkan branch/HEAD ke commit target dan memperbarui index, tetapi working tree biasanya tetap.

Simplifikasi:

```text
branch pointer berubah
index disamakan ke commit target
working tree tidak disentuh
```

Detail lengkap akan dibahas di part koreksi operasi.

---

## 23. File Tracking: Tracked, Untracked, Ignored

Git tidak otomatis melacak semua file. Ada tiga kategori penting.

### 23.1 Tracked

File tracked adalah file yang ada di commit terakhir atau index.

Contoh:

```text
pom.xml
src/main/java/com/acme/App.java
```

### 23.2 Untracked

File untracked adalah file di working tree yang belum masuk index dan tidak diabaikan.

Contoh:

```text
src/main/java/com/acme/NewService.java
```

Jika ingin masuk Git:

```bash
git add src/main/java/com/acme/NewService.java
```

### 23.3 Ignored

File ignored adalah file yang sengaja tidak ditampilkan sebagai kandidat tracking.

Contoh umum Java:

```gitignore
target/
build/
*.class
.idea/
*.iml
.gradle/
```

Ignored tidak berarti mustahil ditrack. Jika file sudah tracked sebelumnya, `.gitignore` tidak otomatis menghentikan tracking. Ini sumber kebingungan umum.

Jika file sudah terlanjur tracked lalu ingin dihentikan tracking-nya tanpa menghapus file lokal:

```bash
git rm --cached path/to/file
```

---

## 24. `.gitignore` Bukan Bagian dari Object Database Secara Khusus

`.gitignore` adalah file biasa yang biasanya ikut dicommit.

Ia memengaruhi bagaimana Git memperlakukan file untracked. Tetapi ia bukan security boundary.

Penting:

```text
.gitignore tidak menghapus file dari history
.gitignore tidak mencegah secret yang sudah tracked ikut tercommit
.gitignore tidak melindungi credential
```

Untuk Java, `.gitignore` berguna menjaga repository tidak dipenuhi hasil build, file IDE personal, dan artifact lokal.

Contoh minimal:

```gitignore
# Maven
target/

# Gradle
.gradle/
build/

# Java bytecode
*.class

# IDE
.idea/
*.iml
.classpath
.project
.settings/

# OS
.DS_Store
Thumbs.db

# Logs
*.log
```

Namun perlu hati-hati: beberapa file IDE mungkin sengaja dishare untuk konsistensi, tergantung tim.

---

## 25. File Mode dan Executable Bit

Git menyimpan mode file tertentu di tree, terutama perbedaan executable bit.

Contoh shell script:

```bash
chmod +x ./mvnw
```

Perubahan ini bisa muncul di Git sebagai mode change.

Untuk project Java, ini penting karena:

```text
- mvnw harus executable di Linux/macOS
- gradlew harus executable
- script CI/CD harus punya mode benar
```

Jika mode file berubah tanpa sengaja, misalnya karena OS/config berbeda, diff bisa menjadi noise.

Cek config:

```bash
git config core.filemode
```

Di environment tertentu, terutama Windows filesystem, perilaku file mode bisa berbeda. Detail cross-platform akan dibahas di part line endings dan platform issues.

---

## 26. Rename: Kenapa Git Tidak Menyimpan Rename Sebagai Operasi Utama

Git secara model menyimpan snapshot tree, bukan daftar operasi “rename file X ke Y”.

Jika kamu melakukan:

```bash
git mv OldName.java NewName.java
```

Git pada akhirnya melihat snapshot baru:

```text
OldName.java hilang
NewName.java muncul
```

Saat menampilkan diff/log, Git bisa mendeteksi rename berdasarkan similarity.

Konsekuensi:

```text
- rename detection bisa tergantung threshold similarity
- rename + edit besar kadang terlihat sebagai delete + add
- git mv membantu staging rename, tetapi tidak membuat jenis object khusus rename
```

Untuk Java, rename class/package sering menghasilkan banyak perubahan path. Ini harus dikelola hati-hati agar review tidak kacau.

Strategi yang baik:

```text
commit 1: pure rename/move tanpa logic change
commit 2: logic changes setelah rename
```

Dengan begitu Git dan reviewer lebih mudah mengikuti perubahan.

---

## 27. Anatomy `.git` Lebih Detail

Mari lihat beberapa bagian `.git` yang sering relevan.

```text
.git/
├── HEAD
├── config
├── index
├── objects/
├── refs/
├── logs/
├── hooks/
├── info/
├── packed-refs
└── FETCH_HEAD
```

Tidak semua langsung ada di repository baru. Sebagian muncul setelah operasi tertentu.

### 27.1 `.git/index`

File binary yang menyimpan index/staging area.

Jangan edit manual.

Command untuk melihatnya:

```bash
git ls-files --stage
```

### 27.2 `.git/objects/`

Object database.

Loose object biasanya disimpan dengan pola:

```text
.git/objects/ab/cdef...
```

Dua karakter pertama menjadi nama directory, sisanya nama file.

### 27.3 `.git/refs/heads/`

Branch lokal.

Misalnya:

```text
.git/refs/heads/main
```

Isinya commit id terakhir branch `main`.

### 27.4 `.git/refs/tags/`

Tag lokal.

Tag bisa menunjuk langsung ke commit atau ke tag object annotated.

### 27.5 `.git/logs/`

Reflog. Menyimpan pergerakan refs lokal.

Ini sangat penting untuk recovery.

### 27.6 `.git/hooks/`

Template hook lokal seperti:

```text
pre-commit.sample
commit-msg.sample
pre-push.sample
```

Hook akan dibahas lebih jauh di part khusus.

### 27.7 `.git/FETCH_HEAD`

Muncul setelah fetch. Menyimpan informasi branch/commit yang baru diambil dari remote.

---

## 28. Bare Repository vs Non-Bare Repository

Repository normal yang kamu pakai untuk coding adalah non-bare repository:

```text
working tree + .git
```

Bare repository tidak punya working tree. Isinya langsung struktur Git database.

Biasanya remote repository server menggunakan bare repository.

Konsep:

```text
non-bare repo = untuk kerja/edit file
bare repo     = untuk menyimpan dan menerima push/fetch
```

Kamu bisa membuat bare repo:

```bash
git init --bare my-service.git
```

Strukturnya seperti isi `.git`, tetapi tidak berada dalam folder `.git`.

Ini menjelaskan kenapa remote repository bukan “folder kerja” yang sama seperti local working tree.

---

## 29. Clone: Menyalin Repository dan Membuat Working Tree

Saat menjalankan:

```bash
git clone <url>
```

Git secara konseptual:

```text
1. Membuat local repository baru.
2. Mengambil objects dan refs dari remote.
3. Membuat remote-tracking refs seperti origin/main.
4. Membuat branch lokal default.
5. Checkout branch tersebut ke working tree.
```

Hasilnya:

```text
working tree berisi file project
.git berisi object database dan metadata
origin menunjuk ke remote asal
```

Ini berbeda dari download zip. Download zip hanya memberi snapshot file, tanpa object database dan history.

---

## 30. Kenapa Git Bisa Cepat?

Beberapa alasan konseptual:

```text
- mayoritas operasi membaca database lokal
- object bersifat immutable
- branch hanyalah pointer
- file yang tidak berubah bisa reuse object lama
- Git bisa melakukan compression/packing
- index menyimpan metadata untuk mempercepat status/diff
```

Karena repository lokal punya history sendiri, banyak operasi tidak perlu network:

```bash
git log
git diff
git branch
git checkout
git commit
git blame
```

Network hanya diperlukan untuk sinkronisasi dengan repository lain:

```bash
git fetch
git pull
git push
```

---

## 31. Immutability: Object Git Tidak Diubah, Dibuat Baru

Git object bersifat immutable secara konseptual.

Jika isi file berubah, Git membuat blob baru.
Jika struktur tree berubah, Git membuat tree baru.
Jika commit message diubah, Git membuat commit baru.

Ini memberikan beberapa konsekuensi besar:

```text
1. History bisa diverifikasi.
2. Commit lama tetap menunjuk ke snapshot lama.
3. Rewrite history sebenarnya membuat object baru dan mengubah refs.
4. Banyak operasi recovery mungkin dilakukan selama object lama belum di-GC.
```

Misalnya amend commit:

```bash
git commit --amend
```

Bukan mengedit commit lama. Git membuat commit baru dengan parent yang sama tetapi content/message/metadata baru, lalu branch dipindah ke commit baru.

---

## 32. Referential Model: Object dan Pointer

Git bisa diringkas sebagai dua hal:

```text
immutable objects + mutable references
```

Object:

```text
blob, tree, commit, tag
```

Reference:

```text
branch, tag reference, HEAD, remote-tracking branch
```

Object relatif aman karena immutable. Reference adalah bagian yang bergerak.

Banyak command Git sebenarnya memindahkan reference:

```text
git commit       = buat commit baru, gerakkan branch saat ini
git branch       = buat pointer baru
git reset        = gerakkan branch/HEAD ke commit lain
git checkout     = ubah HEAD dan working tree
git rebase       = buat commit baru, gerakkan branch
git fetch        = update remote-tracking refs
git push         = minta remote update refs
```

Ini akan menjadi fondasi Part 003.

---

## 33. Studi Kasus Java: Commit Salah Karena Tidak Memahami Index

### Situasi

Kamu sedang mengerjakan fitur validasi order.

File berubah:

```text
OrderController.java
OrderService.java
OrderValidator.java
OrderServiceTest.java
pom.xml
```

Ternyata perubahan `pom.xml` hanya eksperimen dependency lokal dan tidak boleh masuk commit.

Engineer yang tidak memahami index mungkin menjalankan:

```bash
git add .
git commit -m "Add order validation"
```

Akibatnya dependency eksperimen masuk commit.

### Pendekatan Lebih Aman

Cek status:

```bash
git status
```

Stage file spesifik:

```bash
git add src/main/java/com/acme/order/OrderController.java
git add src/main/java/com/acme/order/OrderService.java
git add src/main/java/com/acme/order/OrderValidator.java
git add src/test/java/com/acme/order/OrderServiceTest.java
```

Review staged diff:

```bash
git diff --staged
```

Commit:

```bash
git commit -m "Add order validation"
```

Biarkan `pom.xml` unstaged atau restore jika tidak diperlukan:

```bash
git restore pom.xml
```

### Pelajaran

```text
Index adalah boundary antara eksperimen lokal dan history resmi.
```

---

## 34. Studi Kasus Java: Generated Code

Misalnya project menggunakan OpenAPI generator.

Setelah menjalankan build:

```bash
mvn generate-sources
```

Muncul file:

```text
target/generated-sources/openapi/...
```

Jika `target/` tidak di-ignore, Git akan menampilkan banyak untracked files.

Pertanyaan penting:

```text
Apakah generated code ini source of truth?
Atau hasil build yang bisa direproduksi?
```

Jika bisa direproduksi dari spec:

```text
commit spec-nya, bukan hasil generated di target/
```

Jika generated source sengaja dicommit karena alasan tertentu:

```text
pastikan lokasinya stabil
pastikan proses regeneration jelas
pisahkan commit spec change dan generated change jika perlu
```

Git tidak tahu konteks ini. Git hanya melihat file. Engineer yang harus menentukan boundary source of truth.

---

## 35. Studi Kasus Java: Maven Wrapper

File Maven wrapper biasanya melibatkan:

```text
mvnw
mvnw.cmd
.mvn/wrapper/maven-wrapper.properties
.mvn/wrapper/maven-wrapper.jar
```

Pertanyaan umum: apakah jar wrapper boleh dicommit?

Jawabannya tergantung policy tim, tetapi banyak project mencatat wrapper agar build reproducible. Yang penting:

```text
- jangan ignore semua .mvn/ secara membabi buta
- pastikan mvnw executable di Unix
- pahami mana artifact build dan mana tool bootstrap
```

Ini contoh bahwa `.gitignore` tidak boleh dibuat hanya dari template tanpa memahami build model.

---

## 36. Anti-Pattern Umum

### 36.1 Selalu `git add .` Tanpa Review

Masalah:

```text
- file eksperimen ikut commit
- secret lokal bisa ikut staged
- generated file/noise masuk history
- commit menjadi tidak atomic
```

Alternatif:

```bash
git status
git add <file-spesifik>
git add -p
git diff --staged
```

### 36.2 Menganggap Commit Mengambil Isi Working Tree

Salah:

```text
git commit akan mengambil semua file yang sedang berubah
```

Benar:

```text
git commit mengambil isi index
```

### 36.3 Mengedit File Setelah `git add` Lalu Mengira Semua Masuk Commit

Jika kamu melakukan:

```bash
git add OrderService.java
# edit lagi OrderService.java
git commit
```

Commit hanya berisi versi saat `git add`, bukan edit tambahan setelahnya.

Cek:

```bash
git status
git diff
git diff --staged
```

### 36.4 Menghapus `.git` untuk “Memperbaiki Git”

Menghapus `.git` akan menghapus history lokal, refs, config, dan metadata repository.

Ini hampir tidak pernah solusi yang benar untuk masalah Git.

### 36.5 Memasukkan Artifact Build ke Repository

Contoh buruk:

```text
target/
build/
*.class
*.jar hasil build lokal
```

Kecuali ada alasan eksplisit, artifact build seharusnya berada di artifact repository, bukan Git.

---

## 37. Checklist Mental Sebelum Commit

Sebelum commit, tanyakan:

```text
1. Apakah saya tahu isi working tree saya?
2. Apakah saya tahu isi index saya?
3. Apakah staged diff sudah saya review?
4. Apakah commit ini atomic?
5. Apakah ada file generated/build/IDE yang ikut staged?
6. Apakah ada secret/config lokal?
7. Apakah perubahan test relevan ikut disertakan?
8. Apakah commit message menjelaskan intent?
```

Command minimal:

```bash
git status
git diff
git diff --staged
```

---

## 38. Latihan Praktis

### Latihan 1 — Tiga Versi Satu File

Tujuan: memahami HEAD, index, working tree.

Langkah:

```bash
mkdir git-index-lab
cd git-index-lab
git init

echo "v1" > app.txt
git add app.txt
git commit -m "Add app v1"

echo "v2" > app.txt
git add app.txt

echo "v3" > app.txt
```

Prediksi sebelum menjalankan:

```bash
git status
git diff
git diff --staged
```

Pertanyaan:

```text
1. Versi mana yang ada di HEAD?
2. Versi mana yang ada di index?
3. Versi mana yang ada di working tree?
4. Versi mana yang akan masuk commit jika git commit dijalankan sekarang?
```

Jawaban:

```text
HEAD         = v1
Index        = v2
Working tree = v3
Commit next  = v2
```

### Latihan 2 — Partial Staging

Buat file:

```bash
cat > Calculator.java <<'EOF'
class Calculator {
    int add(int a, int b) {
        return a + b;
    }
}

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-git-mastery-for-java-engineers-part-001.md">⬅️ Part 001 — Git sebagai Model Evolusi Software</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-git-mastery-for-java-engineers-part-003.md">Part 003 — Commit Graph: Parent, Branch, HEAD, dan Reachability ➡️</a>
</div>

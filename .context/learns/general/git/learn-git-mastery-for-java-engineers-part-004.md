# learn-git-mastery-for-java-engineers-part-004.md

# Part 004 — Lifecycle Perubahan: Dari Edit File sampai Commit Berkualitas

> Seri: **Git Mastery for Java Engineers**  
> Bagian: **004 / 032**  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-git-mastery-for-java-engineers-part-003.md`  
> Bagian berikutnya: `learn-git-mastery-for-java-engineers-part-005.md`

---

## Ringkasan Eksekutif

Bagian ini membahas fase paling sering kamu lakukan di Git: mengubah file, memilih perubahan yang masuk commit, membuat commit, memperbaiki commit lokal, dan memastikan commit tersebut berkualitas.

Banyak engineer bisa menjalankan:

```bash
git add .
git commit -m "fix"
git push
```

Tetapi engineer yang kuat tidak sekadar “membuat Git menerima perubahan”. Ia memahami:

1. **State sekarang ada di mana?** Working tree, index, atau `HEAD`?
2. **Perubahan mana yang benar-benar siap menjadi unit historis?**
3. **Apakah commit ini atomic, reviewable, reversible, dan searchable?**
4. **Apakah commit message menjelaskan intent, bukan hanya aktivitas?**
5. **Jika commit ini dipakai untuk debugging 6 bulan lagi, apakah cukup membantu?**

Git menyimpan history dalam bentuk commit graph. Tetapi kualitas commit graph sangat ditentukan oleh keputusan kecil yang kamu ambil setiap hari saat staging dan committing.

---

## Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan lifecycle perubahan dari file diedit sampai menjadi commit.
2. Membedakan `working tree`, `index`, dan `HEAD` secara operasional.
3. Membaca `git status` sebagai observability utama kondisi repository.
4. Menggunakan `git add`, `git restore`, `git reset`, dan `git commit` dengan aman.
5. Melakukan partial staging untuk membuat commit atomic.
6. Menghindari commit “campur aduk” yang menyulitkan review dan debugging.
7. Menulis commit message yang berguna untuk manusia, bukan hanya memenuhi formality.
8. Menilai apakah perubahan layak menjadi satu commit atau harus dipecah.
9. Memahami kapan boleh amend commit dan kapan tidak.
10. Membangun kebiasaan commit yang mendukung review, release, audit, dan recovery.

---

## Prasyarat Konseptual

Sebelum masuk ke bagian ini, kamu perlu mengingat tiga konsep dari part sebelumnya:

### 1. `HEAD`

`HEAD` menunjuk ke commit saat ini, biasanya melalui branch aktif.

Secara sederhana:

```text
HEAD = snapshot terakhir yang sedang menjadi basis kerja kamu
```

Jika kamu berada di branch `feature/payment-validation`, maka biasanya:

```text
HEAD -> refs/heads/feature/payment-validation -> commit tertentu
```

### 2. Working Tree

Working tree adalah file nyata yang kamu edit di editor/IDE.

Contoh:

```text
src/main/java/com/acme/payment/PaymentService.java
pom.xml
README.md
```

Ini adalah area paling “fisik”. Saat kamu mengetik di IntelliJ, VS Code, Vim, atau editor lain, yang berubah adalah working tree.

### 3. Index / Staging Area

Index adalah snapshot calon commit berikutnya.

Ini bukan sekadar daftar file. Index menyimpan versi staged dari path tertentu.

```text
working tree = apa yang ada di disk sekarang
index        = apa yang akan masuk commit berikutnya
HEAD         = commit terakhir yang sudah tercatat
```

---

## Mental Model Utama: Commit Bukan Menyimpan Semua yang Ada di Folder

Salah satu miskonsepsi paling umum:

> “Kalau saya menjalankan `git commit`, Git akan menyimpan semua perubahan di folder.”

Tidak tepat.

Git commit membuat commit dari **isi index**, bukan otomatis dari semua isi working tree.

Modelnya:

```text
Working Tree  --git add-->  Index  --git commit-->  Commit baru
```

Atau:

```text
File diedit
   ↓
Modified di working tree
   ↓
Dipilih dengan git add
   ↓
Staged di index
   ↓
Dicatat dengan git commit
   ↓
Commit baru menjadi HEAD
```

Artinya, kamu bisa punya:

1. perubahan yang sudah diedit tetapi belum staged,
2. perubahan yang staged dan akan masuk commit,
3. perubahan lain di file yang sama yang belum masuk commit,
4. file baru yang belum tracked,
5. file terhapus,
6. file rename,
7. file ignored yang tidak diperhatikan Git.

Di sinilah kualitas engineering muncul. Kamu tidak hanya “menyimpan kerja”, tetapi **memilih perubahan mana yang membentuk satu unit historis yang masuk akal**.

---

## Lifecycle Perubahan Git

Lifecycle satu perubahan biasanya seperti ini:

```text
1. Clean
   Tidak ada perubahan terhadap HEAD.

2. Edit
   File berubah di working tree.

3. Observe
   git status / git diff untuk melihat perubahan.

4. Stage
   git add memilih perubahan yang akan masuk commit.

5. Review staged state
   git diff --staged untuk memeriksa calon commit.

6. Commit
   git commit membuat snapshot baru dari index.

7. Validate
   git log / git show / test / build untuk memverifikasi commit.
```

Untuk engineer senior, fase penting bukan hanya nomor 4 dan 6. Fase 3 dan 5 sering lebih penting, karena di sana kamu mencegah commit buruk.

---

## `git status` sebagai Dashboard Repository

Command paling penting dalam daily Git bukan `commit`, `push`, atau `merge`.

Command paling penting adalah:

```bash
git status
```

Karena `git status` menjawab:

1. Branch apa yang aktif?
2. Apakah branch tracking remote?
3. Apakah branch ahead/behind remote?
4. File mana yang modified?
5. File mana yang staged?
6. File mana yang untracked?
7. Apakah ada conflict?
8. Apakah sedang rebase/merge/cherry-pick/bisect?

Git status adalah observability primitive.

### Contoh Status Clean

```bash
git status
```

Output:

```text
On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean
```

Maknanya:

```text
HEAD, index, dan working tree konsisten.
Tidak ada perubahan lokal.
```

### Contoh Modified tetapi Belum Staged

```text
On branch feature/payment-validation
Changes not staged for commit:
  modified:   src/main/java/com/acme/payment/PaymentService.java

no changes added to commit
```

Maknanya:

```text
Working tree berbeda dari index.
Index masih sama dengan HEAD untuk file tersebut.
Commit berikutnya belum akan memasukkan perubahan ini.
```

### Contoh Staged

```text
Changes to be committed:
  modified:   src/main/java/com/acme/payment/PaymentService.java
```

Maknanya:

```text
Index berbeda dari HEAD.
Commit berikutnya akan memasukkan versi staged file tersebut.
```

### Contoh File Sama: Staged dan Modified

```text
Changes to be committed:
  modified:   PaymentService.java

Changes not staged for commit:
  modified:   PaymentService.java
```

Ini sering membingungkan.

Artinya:

```text
File PaymentService.java punya sebagian perubahan yang sudah staged,
tetapi setelah itu file tersebut berubah lagi di working tree.
```

Secara state:

```text
HEAD version       = versi commit terakhir
Index version      = versi yang sudah kamu stage
Working tree       = versi terbaru di disk
```

Untuk satu path, Git bisa melihat tiga versi berbeda sekaligus.

---

## Empat Kategori Perubahan yang Harus Kamu Kenali

### 1. Tracked Modified

File sudah dikenal Git, lalu isinya berubah.

Contoh:

```text
modified: src/main/java/com/acme/user/UserService.java
```

### 2. Untracked

File ada di working tree tetapi belum dikenal Git.

Contoh:

```text
Untracked files:
  src/test/java/com/acme/user/UserServiceTest.java
```

File untracked tidak akan masuk commit kecuali kamu `git add`.

### 3. Deleted

File tracked dihapus dari working tree.

Contoh:

```text
deleted: src/main/java/com/acme/legacy/OldValidator.java
```

Deletion juga perubahan yang harus distage.

### 4. Renamed

Git tidak menyimpan rename sebagai operasi khusus di commit object. Git menyimpan snapshot. Rename biasanya dideteksi dari perbandingan similarity antar file.

Contoh status bisa menampilkan:

```text
renamed: OldPaymentValidator.java -> PaymentValidator.java
```

Tetapi secara internal, commit tetap snapshot pohon file baru.

---

## `git diff`: Melihat Perubahan Sebelum Staging

Sebelum staging, gunakan:

```bash
git diff
```

Ini membandingkan:

```text
working tree vs index
```

Bukan `working tree vs HEAD` secara selalu. Jika index belum berubah, memang hasilnya terasa seperti working tree vs HEAD. Tetapi begitu ada staged changes, `git diff` hanya menampilkan perubahan yang belum staged.

### Contoh

```bash
git diff
```

Digunakan untuk menjawab:

```text
Apa yang sudah saya ubah di working tree tetapi belum saya pilih untuk commit?
```

---

## `git diff --staged`: Melihat Calon Commit

Sebelum commit, biasakan:

```bash
git diff --staged
```

atau:

```bash
git diff --cached
```

Ini membandingkan:

```text
index vs HEAD
```

Maknanya:

```text
Jika saya commit sekarang, diff inilah yang akan masuk commit.
```

Ini adalah quality gate lokal paling murah.

### Kebiasaan Senior Engineer

Sebelum menjalankan `git commit`, lakukan minimal:

```bash
git status
git diff --staged
```

Jika perubahan belum staged:

```bash
git diff
```

Tujuannya bukan ritual. Tujuannya menghindari:

1. file debug ikut commit,
2. konfigurasi lokal ikut commit,
3. test sementara ikut commit,
4. perubahan tidak relevan tercampur,
5. secret/token tidak sengaja masuk,
6. generated file ikut commit tanpa sadar,
7. formatting massal mencampur perubahan logic.

---

## `git add`: Bukan “Add File”, Tetapi “Add Content to Index”

Nama `git add` sedikit menyesatkan. Banyak orang mengira `git add` hanya untuk file baru.

Lebih akurat:

```text
git add = salin content dari working tree ke index untuk path/hunk tertentu
```

Jika file sudah tracked dan kamu mengubahnya, kamu tetap perlu `git add` agar versi baru masuk index.

### Contoh

```bash
git add src/main/java/com/acme/payment/PaymentService.java
```

Maknanya:

```text
Ambil versi PaymentService.java yang saat ini ada di working tree,
lalu jadikan versi itu staged di index.
```

Jika setelah itu kamu edit file lagi, perubahan baru belum otomatis staged.

---

## `git add .` vs `git add -A` vs `git add -u`

Command ini sering dipakai sembarangan. Perbedaannya penting.

### `git add <path>`

Stage perubahan pada path tertentu.

```bash
git add src/main/java/com/acme/payment/PaymentService.java
```

Cocok untuk commit terkontrol.

### `git add .`

Stage perubahan di direktori saat ini dan turunannya.

```bash
git add .
```

Di root repository, biasanya stage banyak hal sekaligus. Ini praktis tetapi berisiko.

### `git add -A`

Stage semua perubahan di seluruh working tree:

1. modified,
2. new/untracked,
3. deleted.

```bash
git add -A
```

Cocok jika kamu sudah memeriksa semuanya dan memang ingin memasukkan semua perubahan.

### `git add -u`

Stage perubahan pada tracked files saja:

1. modified,
2. deleted,
3. tidak termasuk untracked file baru.

```bash
git add -u
```

Cocok jika kamu ingin update file yang sudah tracked tanpa memasukkan file baru yang mungkin tidak sengaja dibuat IDE/build.

### Decision Table

| Command | Modified tracked | Deleted tracked | New untracked | Risiko |
|---|---:|---:|---:|---|
| `git add file` | Ya, untuk file itu | Ya, untuk file itu | Ya, jika file itu | Rendah |
| `git add .` | Ya | Ya | Ya | Sedang/tinggi jika tidak dicek |
| `git add -A` | Ya | Ya | Ya | Tinggi jika repo kotor |
| `git add -u` | Ya | Ya | Tidak | Lebih aman untuk update tracked |

Rule praktis:

```text
Default untuk engineer yang peduli kualitas: git add path atau git add -p.
Gunakan git add . hanya setelah git status dan git diff jelas.
```

---

## Partial Staging: Skill Penting untuk Commit Atomic

Realitas kerja harian:

Kamu sering mengubah satu file untuk beberapa alasan sekaligus.

Contoh `PaymentService.java` berubah karena:

1. memperbaiki bug rounding,
2. menambah logging,
3. refactor nama method,
4. memperbaiki formatting,
5. menambahkan TODO sementara.

Kalau semuanya masuk satu commit, history menjadi buram.

Partial staging memungkinkan kamu memilih sebagian perubahan saja.

Command utama:

```bash
git add -p
```

atau:

```bash
git add --patch
```

Git akan menampilkan hunk perubahan dan bertanya apakah hunk tersebut ingin distage.

### Pilihan Umum di Patch Mode

Biasanya kamu akan melihat pilihan seperti:

```text
Stage this hunk [y,n,q,a,d,s,e,?]?
```

Makna umumnya:

| Pilihan | Makna |
|---|---|
| `y` | stage hunk ini |
| `n` | jangan stage hunk ini |
| `q` | keluar |
| `a` | stage hunk ini dan semua hunk berikutnya di file ini |
| `d` | jangan stage hunk ini dan semua hunk berikutnya di file ini |
| `s` | split hunk menjadi bagian lebih kecil |
| `e` | edit hunk manual |
| `?` | bantuan |

### Kapan Partial Staging Berguna?

Partial staging berguna ketika:

1. kamu memperbaiki bug dan melakukan refactor kecil di file sama,
2. kamu ingin commit test dulu, implementation setelahnya,
3. kamu ingin memisahkan formatting dari logic,
4. kamu ingin commit perubahan API terpisah dari perubahan caller,
5. kamu menemukan cleanup saat mengerjakan fitur lain.

### Contoh Commit yang Dipisah

Daripada satu commit:

```text
fix payment validation and cleanup
```

Lebih baik:

```text
fix payment amount rounding for IDR transactions
refactor payment validation into dedicated policy object
add regression tests for payment amount boundary cases
```

Tiga commit itu memberi cerita yang lebih jelas.

---

## Commit Atomic: Unit Perubahan yang Bisa Dipahami dan Dibatalkan

Commit atomic bukan berarti commit harus kecil secara jumlah baris.

Commit atomic berarti:

```text
Satu commit merepresentasikan satu alasan perubahan yang utuh.
```

### Ciri Commit Atomic

Commit atomic biasanya:

1. punya satu intent utama,
2. bisa dijelaskan dalam satu kalimat jelas,
3. bisa direview tanpa melompat ke topik lain,
4. bisa direvert tanpa merusak perubahan lain yang tidak terkait,
5. build/test tetap masuk akal setelah commit tersebut,
6. tidak mencampur formatting massal dengan logic,
7. tidak mencampur refactor mekanis dengan perubahan behavior.

### Contoh Tidak Atomic

```text
commit: update user service

Isi:
- rename UserService ke AccountService
- ubah endpoint login
- fix NPE di UserMapper
- update Dockerfile
- format seluruh project
- tambah dependency Redis
```

Masalah:

1. reviewer sulit memahami intent,
2. revert login bug ikut membatalkan rename dan Redis,
3. blame menjadi tidak informatif,
4. regression sulit dicari,
5. changelog sulit dibuat.

### Contoh Atomic

```text
commit 1: rename UserService to AccountService
commit 2: add Redis dependency for login throttling
commit 3: enforce login throttling in AccountService
commit 4: fix null email mapping in UserMapper
commit 5: update Docker image healthcheck path
```

Ini bukan “lebih banyak commit karena suka rapi”. Ini membuat history menjadi alat kerja.

---

## Commit Harus Kecil atau Besar?

Pertanyaan yang lebih tepat:

```text
Apakah commit ini punya boundary intent yang benar?
```

Commit bisa besar jika perubahan memang satu operasi logis.

Contoh commit besar yang masih atomic:

```text
migrate service package from javax to jakarta namespace
```

Ini bisa menyentuh ratusan file tetapi satu alasan.

Commit kecil yang buruk:

```text
fix
more fix
try again
final fix
really final
```

Kecil tidak otomatis bagus. Commit yang bagus adalah commit yang punya intent jelas.

---

## Commit sebagai Contract Historis

Commit yang baik harus membantu beberapa pembaca masa depan:

### 1. Reviewer

Reviewer bertanya:

```text
Apa yang berubah dan kenapa?
Apakah scope-nya masuk akal?
Apa risiko behavior change?
```

### 2. Debugger

Saat production incident, engineer bertanya:

```text
Commit mana yang memperkenalkan perubahan ini?
Apa alasan awalnya?
Apakah aman direvert?
```

### 3. Release Manager

Release manager bertanya:

```text
Perubahan apa yang masuk release ini?
Apakah commit ini bugfix, feature, breaking change, atau refactor?
```

### 4. Auditor / Compliance Reviewer

Di sistem regulated, auditor bisa bertanya:

```text
Siapa mengubah rule ini?
Kapan?
Untuk alasan apa?
Terkait requirement/ticket mana?
Apakah review dan test evidence ada?
```

### 5. Future Maintainer

Maintainer bertanya:

```text
Kenapa desain ini dipilih?
Apa trade-off yang diketahui saat itu?
```

Commit message yang baik bukan dokumentasi formal lengkap, tetapi harus memberi cukup konteks untuk menelusuri jawaban.

---

## Struktur Commit Message yang Baik

Format umum yang kuat:

```text
<subject singkat dengan imperative mood>

<body: alasan, konteks, konsekuensi, trade-off>

<footer: issue/ticket/breaking change/co-authored-by bila perlu>
```

Contoh:

```text
Reject expired enforcement case transitions

Expired cases must not move from REVIEW to APPROVED because the legal
window for enforcement action has passed. Previously, the transition
validator only checked actor permission and case status, so a stale case
could still be approved when reopened from the dashboard.

This adds an expiry check at the domain transition layer instead of the
controller so API, batch, and UI flows share the same invariant.

Refs: CASE-1842
```

### Kenapa Ini Bagus?

Subject:

```text
Reject expired enforcement case transitions
```

Menjelaskan behavior.

Body menjawab:

1. masalahnya apa,
2. kenapa penting,
3. invariant apa yang ditegakkan,
4. kenapa solusi ditempatkan di domain layer,
5. referensi ticket.

Ini jauh lebih berguna daripada:

```text
fix validation
```

---

## Subject Commit Message

Subject adalah baris pertama commit message.

Gunakan subject yang:

1. spesifik,
2. menjelaskan perubahan behavior/struktur,
3. tidak terlalu panjang,
4. bisa dibaca di `git log --oneline`,
5. tidak bergantung pada konteks lokal di kepala kamu.

### Contoh Buruk dan Lebih Baik

| Buruk | Lebih Baik |
|---|---|
| `fix` | `Fix null customer email mapping` |
| `update service` | `Add retry policy to payment gateway client` |
| `changes` | `Validate enforcement deadline before approval` |
| `wip` | `Extract case transition rules into policy object` |
| `bugfix` | `Prevent duplicate sanction creation on retry` |
| `cleanup` | `Remove unused legacy case mapper` |

### Imperative Mood

Banyak project memakai gaya imperative:

```text
Add payment retry policy
Fix case deadline validation
Remove unused account mapper
```

Bukan:

```text
Added payment retry policy
Fixes case deadline validation
Removing unused account mapper
```

Kenapa? Karena commit subject dibaca seperti:

```text
This commit will <subject>
```

Contoh:

```text
This commit will add payment retry policy
This commit will fix case deadline validation
```

---

## Body Commit Message: Tempat Menjelaskan Intent

Subject menjelaskan “apa”. Body menjelaskan “kenapa” dan “kenapa begini”.

Body berguna ketika:

1. perubahan tidak trivial,
2. ada trade-off design,
3. ada risiko behavior change,
4. ada invariant domain,
5. ada constraint backward compatibility,
6. ada migrasi data,
7. ada keputusan arsitektural kecil,
8. ada alasan menghindari solusi alternatif.

### Template Body yang Praktis

```text
<Subject>

Problem:
<apa masalah yang terjadi>

Change:
<apa yang diubah>

Reasoning:
<kenapa solusi ini dipilih>

Risk:
<risiko / compatibility / migration impact>

Refs: <ticket>
```

Tidak semua commit butuh format formal. Tetapi untuk commit yang signifikan, struktur seperti ini sangat membantu.

---

## Commit Message untuk Java Backend

Java backend sering punya perubahan lintas layer:

```text
Controller -> Service -> Domain -> Repository -> Migration -> Test
```

Commit message harus menjelaskan boundary.

### Contoh Buruk

```text
add validation
```

### Contoh Baik

```text
Validate case closure reason in domain transition policy

Case closure reason is required by the audit report, but the previous
check lived only in the REST controller. Batch closure jobs could bypass
that validation and create incomplete case history entries.

Move the validation into CaseTransitionPolicy so REST, batch, and admin
flows share the same invariant.

Refs: ENF-913
```

Kualitas utamanya:

1. menjelaskan invariant domain,
2. menjelaskan lokasi validasi,
3. menjelaskan bypass path,
4. menjelaskan dampak audit.

---

## `git commit`: Membuat Snapshot dari Index

Command dasar:

```bash
git commit
```

Ini membuka editor untuk menulis message.

Atau:

```bash
git commit -m "Fix null customer email mapping"
```

Untuk commit penting, lebih baik gunakan editor agar body bisa ditulis baik.

### Apa yang Terjadi Saat Commit?

Git akan:

1. mengambil snapshot dari index,
2. membuat tree object baru jika perlu,
3. membuat commit object,
4. commit object menunjuk ke parent commit saat ini,
5. branch aktif bergerak ke commit baru,
6. `HEAD` tetap menunjuk ke branch aktif,
7. index biasanya menjadi sama dengan commit baru,
8. working tree mungkin masih punya perubahan yang belum staged.

Secara graph:

```text
Sebelum commit:

A --- B   <- main, HEAD

Index berisi calon snapshot C

Setelah commit:

A --- B --- C   <- main, HEAD
```

---

## `git commit -a`: Shortcut yang Harus Dipahami

Command:

```bash
git commit -a -m "Update payment validator"
```

atau:

```bash
git commit -am "Update payment validator"
```

Maknanya:

```text
Stage semua perubahan tracked file yang modified/deleted,
lalu commit.
```

Tetapi command ini tidak menambahkan untracked file baru.

### Risiko

`git commit -am` bisa membuat kamu melewatkan file test baru.

Contoh:

```text
modified: PaymentValidator.java
untracked: PaymentValidatorTest.java
```

Jika kamu menjalankan:

```bash
git commit -am "Fix payment validation"
```

Maka test baru tidak masuk commit.

Akibatnya commit mungkin compile, mungkin tidak, atau feature masuk tanpa test.

Rule:

```text
Gunakan git commit -am hanya jika kamu yakin tidak ada file baru yang perlu masuk.
Tetap cek git status setelahnya.
```

---

## `git restore`: Membatalkan Perubahan Working Tree atau Unstage

`git restore` adalah command modern untuk mengembalikan file.

### Membuang Perubahan Working Tree

```bash
git restore src/main/java/com/acme/payment/PaymentService.java
```

Maknanya:

```text
Kembalikan file di working tree dari index.
Perubahan unstaged hilang.
```

Jika index sama dengan HEAD, file kembali ke versi HEAD.

Hati-hati: ini membuang perubahan lokal yang belum staged.

### Unstage File

```bash
git restore --staged src/main/java/com/acme/payment/PaymentService.java
```

Maknanya:

```text
Kembalikan versi index untuk file itu dari HEAD,
tetapi biarkan working tree tetap berubah.
```

Ini tidak membuang edit. Hanya menghapus dari staging area.

### Mental Model

```text
git restore file
  mengubah working tree

 git restore --staged file
  mengubah index
```

---

## `git reset`: Unstage dan Menggerakkan HEAD

`git reset` punya beberapa mode dan sering membingungkan. Di bagian ini fokus pada pemakaian aman untuk unstage.

### Unstage File

```bash
git reset src/main/java/com/acme/payment/PaymentService.java
```

Maknanya mirip:

```bash
git restore --staged src/main/java/com/acme/payment/PaymentService.java
```

Yaitu mengeluarkan file dari index tetapi tetap menyimpan perubahan di working tree.

### Unstage Semua

```bash
git reset
```

Makna umum:

```text
Reset index ke HEAD, working tree tetap.
```

Ini sering berguna jika kamu terlanjur:

```bash
git add .
```

lalu sadar terlalu banyak yang staged.

### Jangan Sembarangan `git reset --hard`

```bash
git reset --hard
```

Maknanya:

```text
Reset HEAD/index/working tree sesuai target.
Perubahan working tree yang belum commit bisa hilang.
```

Kita akan bahas reset detail di part 016. Untuk sekarang, anggap `--hard` sebagai command destruktif yang butuh alasan jelas.

---

## `git rm` dan `git mv`

### Menghapus File Tracked

Jika kamu hapus file lewat shell/IDE:

```bash
rm src/main/java/com/acme/legacy/OldValidator.java
```

Git akan melihat deleted file. Kamu bisa stage deletion dengan:

```bash
git add -u
```

atau:

```bash
git add src/main/java/com/acme/legacy/OldValidator.java
```

Atau langsung:

```bash
git rm src/main/java/com/acme/legacy/OldValidator.java
```

`git rm` menghapus file dari working tree dan stage deletion.

### Rename / Move File

```bash
git mv OldName.java NewName.java
```

Ini setara dengan move file lalu stage perubahan path. Tetapi ingat: Git tetap menyimpan snapshot, rename dideteksi saat diff/log.

---

## Amend Commit: Memperbaiki Commit Terakhir

Jika kamu baru saja commit lalu sadar ada typo kecil atau file test lupa ditambahkan, gunakan:

```bash
git add src/test/java/com/acme/payment/PaymentValidatorTest.java
git commit --amend
```

Atau untuk hanya mengubah message:

```bash
git commit --amend
```

### Apa yang Terjadi Saat Amend?

Amend tidak benar-benar mengedit commit lama.

Git membuat commit baru yang menggantikan posisi commit terakhir di branch.

Graph:

```text
Sebelum amend:

A --- B --- C   <- feature, HEAD

Setelah amend:

A --- B --- C'  <- feature, HEAD
       \
        C       dangling/unreachable sementara
```

Commit `C` lama masih mungkin recoverable melalui reflog, tetapi branch sekarang menunjuk ke `C'`.

### Kapan Amend Aman?

Aman jika commit belum kamu push atau belum dipakai orang lain.

```text
Private local history: boleh amend.
Public shared history: hati-hati, karena amend rewrite history.
```

Jika commit sudah di-push dan branch dipakai orang lain, amend akan membutuhkan force push. Ini berpotensi mengganggu rekan kerja.

---

## Commit Quality Gate Lokal

Sebelum commit, gunakan checklist ini:

```text
1. Apakah saya sudah menjalankan git status?
2. Apakah saya sudah membaca git diff / git diff --staged?
3. Apakah commit hanya punya satu intent?
4. Apakah ada debug print, temporary config, atau TODO palsu?
5. Apakah generated file ikut tanpa alasan?
6. Apakah file test yang relevan ikut?
7. Apakah build/test minimal sudah berjalan?
8. Apakah commit message menjelaskan behavior/intent?
9. Apakah commit ini aman direvert sendiri?
10. Apakah commit ini membantu reviewer memahami perubahan?
```

---

## Commit dan Test: Haruskah Setiap Commit Build?

Idealnya, setiap commit di branch utama harus build dan test pass.

Untuk branch lokal feature, ada dua pendekatan:

### Pendekatan 1: Setiap Commit Harus Build

Keuntungan:

1. bisect lebih efektif,
2. revert lebih aman,
3. review commit-by-commit lebih mudah,
4. history lebih sehat.

Kekurangan:

1. butuh disiplin lebih tinggi,
2. kadang memperlambat eksplorasi.

### Pendekatan 2: Commit Lokal Boleh WIP, Dibersihkan Sebelum PR

Keuntungan:

1. eksplorasi cepat,
2. aman menyimpan checkpoint lokal.

Kekurangan:

1. history mentah tidak reviewable,
2. perlu interactive rebase/squash sebelum PR,
3. jika lupa dibersihkan, branch menjadi berisik.

Praktik senior:

```text
Local private branch boleh punya WIP commit.
Sebelum PR/merge, rapikan menjadi commit yang bisa direview dan sebaiknya buildable.
```

---

## WIP Commit: Boleh, Tapi Jangan Dijadikan History Publik Sembarangan

WIP commit berguna untuk menyimpan pekerjaan sementara.

Contoh:

```bash
git commit -m "WIP payment retry experiment"
```

Ini tidak dosa jika masih lokal.

Tetapi saat masuk PR atau mainline, WIP commit harus:

1. di-squash,
2. di-reword,
3. dipecah ulang,
4. atau dihapus jika tidak relevan.

History publik harus menceritakan keputusan engineering, bukan seluruh proses trial-error internal.

---

## Commit vs Save Point

Git sering dipakai sebagai save point. Itu boleh di local branch.

Tetapi commit dalam shared history punya fungsi lebih tinggi:

```text
Local commit  = safety checkpoint + working narrative
Shared commit = historical record + collaboration contract
```

Jangan samakan keduanya.

---

## Anti-Pattern Commit Harian

### 1. Mega Commit

```text
implement feature X
```

Isi 3.000 baris, 80 file, banyak topik.

Masalah:

1. sulit review,
2. sulit revert,
3. sulit bisect,
4. conflict lebih berat,
5. reviewer cenderung rubber stamp.

### 2. Noise Commit

```text
fix
fix again
try
update
```

Masalah:

1. tidak informatif,
2. mengganggu log,
3. membuat changelog buruk.

### 3. Formatting Dicampur Logic

```text
fix payment bug
```

Isi:

1. 20 baris bugfix,
2. 1.000 baris formatting.

Masalah:

Reviewer sulit melihat perubahan behavior.

Solusi:

```text
commit 1: format payment module with google-java-format
commit 2: fix payment rounding for IDR transactions
```

### 4. Commit Generated File Tanpa Kebijakan

Contoh:

```text
src/generated/openapi/...
target/generated-sources/...
build/generated/...
```

Generated code boleh saja dicommit jika memang menjadi source of truth distribusi. Tetapi harus berdasarkan policy, bukan kebetulan.

### 5. Commit Secret atau Local Config

Contoh:

```text
application-local.yml
.env
private-key.pem
aws-credentials.json
```

`.gitignore` membantu, tetapi bukan security boundary. Cek `git diff --staged` tetap wajib.

### 6. Commit yang Tidak Menyertakan Test Relevan

Jika bugfix tidak punya test, mungkin ada alasan. Tetapi commit message atau PR harus menjelaskan.

### 7. Commit “Drive-by Refactor”

Saat mengerjakan bug kecil, kamu refactor area lain tanpa kaitan jelas.

Masalah:

1. memperbesar risiko,
2. memperlebar review scope,
3. mengaburkan bugfix,
4. menyulitkan rollback.

Lebih baik pisah commit atau PR.

---

## Pattern Commit untuk Java Engineer

### Pattern 1: Test First Bugfix

```text
commit 1: add regression test for duplicate sanction creation
commit 2: prevent duplicate sanction creation on retry
```

Keuntungan:

1. test membuktikan bug,
2. implementation jelas memperbaiki test,
3. bisect dan review lebih mudah.

### Pattern 2: Refactor Then Behavior Change

```text
commit 1: extract payment gateway response mapper
commit 2: handle timeout response as retryable failure
```

Keuntungan:

1. reviewer bisa memverifikasi refactor tidak mengubah behavior,
2. behavior change terlihat bersih.

### Pattern 3: Mechanical Change Separate

```text
commit 1: migrate imports from javax.validation to jakarta.validation
commit 2: update validation error mapping for Jakarta constraints
```

Keuntungan:

1. migration mekanis bisa direview sebagai pattern,
2. semantic change tidak tersembunyi.

### Pattern 4: API Contract Then Implementation

```text
commit 1: add case transition reason to API contract
commit 2: persist transition reason in case history
commit 3: require transition reason for closure approval
```

Cocok untuk perubahan lintas boundary.

### Pattern 5: Schema Migration Split

```text
commit 1: add nullable enforcement_deadline column
commit 2: backfill enforcement deadline from case events
commit 3: enforce non-null deadline in domain validation
commit 4: make enforcement_deadline non-null
```

Cocok untuk sistem production dengan migration bertahap.

---

## Decision Matrix: Satu Commit atau Beberapa?

Tanyakan:

| Pertanyaan | Jika Ya | Jika Tidak |
|---|---|---|
| Apakah semua perubahan punya alasan yang sama? | Mungkin satu commit | Pisah |
| Apakah commit bisa direvert tanpa membatalkan hal tak terkait? | Mungkin satu commit | Pisah |
| Apakah reviewer bisa memahami diff dalam satu konteks? | Mungkin satu commit | Pisah |
| Apakah ada formatting massal? | Pisah formatting | Bisa gabung jika kecil |
| Apakah ada refactor sebelum behavior change? | Biasanya pisah | Bisa gabung jika trivial |
| Apakah ada test dan implementation? | Bisa satu atau dua commit | Tergantung review style |
| Apakah ada migration database? | Sering pisah bertahap | Gabung jika sangat kecil |
| Apakah ada generated code? | Pisah atau jelaskan | Tidak relevan |

Rule sederhana:

```text
Jika rollback satu alasan harus membatalkan perubahan lain yang tidak terkait,
commit itu terlalu besar atau terlalu campur.
```

---

## Working Example: Dari Repo Bersih ke Commit Berkualitas

Kita gunakan contoh project Java sederhana.

### 1. Mulai dari Clean State

```bash
git status
```

```text
On branch feature/payment-rounding
nothing to commit, working tree clean
```

### 2. Edit Production Code

Misalnya ubah:

```text
src/main/java/com/acme/payment/MoneyCalculator.java
```

### 3. Tambah Test

Tambah file:

```text
src/test/java/com/acme/payment/MoneyCalculatorTest.java
```

### 4. Observe

```bash
git status
```

```text
Changes not staged for commit:
  modified:   src/main/java/com/acme/payment/MoneyCalculator.java

Untracked files:
  src/test/java/com/acme/payment/MoneyCalculatorTest.java
```

### 5. Lihat Diff

```bash
git diff
```

Baca perubahan production code.

### 6. Stage Test dan Implementation

```bash
git add src/main/java/com/acme/payment/MoneyCalculator.java

git add src/test/java/com/acme/payment/MoneyCalculatorTest.java
```

### 7. Review Calon Commit

```bash
git diff --staged
```

Pastikan:

1. bugfix dan test relevan,
2. tidak ada print debug,
3. tidak ada perubahan unrelated,
4. nama test menjelaskan case.

### 8. Jalankan Test

Contoh Maven:

```bash
./mvnw test -Dtest=MoneyCalculatorTest
```

Contoh Gradle:

```bash
./gradlew test --tests '*MoneyCalculatorTest'
```

### 9. Commit

```bash
git commit
```

Message:

```text
Fix IDR rounding for payment totals

Payment totals in IDR must round half-up to the nearest integer because
minor units are not supported for settlement. The previous calculation
used the default BigDecimal division scale and could produce fractional
values that failed downstream settlement validation.

Add regression coverage for half-up boundary cases.

Refs: PAY-728
```

### 10. Validate Commit

```bash
git show --stat

git show --name-only

git log --oneline -1
```

---

## Working Example: Memisahkan Refactor dan Bugfix dengan Partial Staging

Misalnya kamu mengubah `CaseTransitionService.java` dan tanpa sengaja ada dua jenis perubahan:

1. rename variable untuk clarity,
2. bugfix: reject expired transition.

Cek:

```bash
git diff
```

Stage hanya refactor:

```bash
git add -p src/main/java/com/acme/caseflow/CaseTransitionService.java
```

Pilih hunk rename saja.

Commit:

```bash
git commit -m "Clarify case transition variable names"
```

Lalu stage bugfix:

```bash
git add -p src/main/java/com/acme/caseflow/CaseTransitionService.java

git add src/test/java/com/acme/caseflow/CaseTransitionServiceTest.java
```

Commit:

```bash
git commit
```

Message:

```text
Reject expired case transitions

Expired cases must not transition to APPROVED because the enforcement
window has already closed. Add validation at the transition service layer
so UI and batch flows share the same rule.

Refs: CASE-1842
```

Hasilnya:

```text
commit 1: refactor murni
commit 2: behavior change + test
```

Reviewer lebih mudah melihat bahwa commit pertama tidak mengubah behavior dan commit kedua adalah perubahan domain.

---

## Membaca State dengan Tiga Diff Penting

Gunakan tiga pertanyaan ini:

### 1. Apa yang belum staged?

```bash
git diff
```

```text
working tree vs index
```

### 2. Apa yang akan masuk commit?

```bash
git diff --staged
```

```text
index vs HEAD
```

### 3. Apa total perubahan lokal terhadap commit terakhir?

```bash
git diff HEAD
```

```text
working tree vs HEAD, termasuk staged dan unstaged
```

Tabel:

| Command | Membandingkan | Menjawab |
|---|---|---|
| `git diff` | working tree vs index | Apa yang belum staged? |
| `git diff --staged` | index vs HEAD | Apa calon commit berikutnya? |
| `git diff HEAD` | working tree vs HEAD | Apa total perubahan lokal? |

---

## Menangani File yang Tidak Sengaja Distage

Situasi:

```bash
git add .
```

Lalu:

```bash
git status
```

Ternyata file `.env` atau config lokal ikut staged.

### Unstage File Tertentu

```bash
git restore --staged .env
```

atau:

```bash
git reset .env
```

### Membuang Perubahan File Tertentu

Jika file tracked dan perubahan lokal ingin dibuang:

```bash
git restore path/to/file
```

### Untuk File Untracked

Jika file baru tidak ingin masuk Git, hapus manual atau gunakan `git clean` dengan hati-hati.

Lihat dulu:

```bash
git clean -n
```

Eksekusi:

```bash
git clean -f
```

Hati-hati: `git clean` menghapus file untracked. Jangan gunakan tanpa preview.

---

## File Ignored dan `.gitignore`

File ignored tidak muncul sebagai untracked jika pattern `.gitignore` cocok.

Contoh Java `.gitignore`:

```gitignore
# Maven
target/

# Gradle
.gradle/
build/

# IntelliJ
.idea/
*.iml

# Environment
.env
application-local.yml

# Logs
*.log
```

Namun:

```text
.gitignore tidak menghapus file yang sudah tracked.
```

Jika file sudah pernah masuk Git, menambahkan ke `.gitignore` tidak cukup. Kamu perlu menghapus dari index:

```bash
git rm --cached application-local.yml
```

Lalu commit perubahan tersebut.

---

## Commit Hygiene untuk Java Project

### Jangan Commit Build Output

Biasanya jangan commit:

```text
target/
build/
out/
.gradle/
.classpath
.project
*.class
*.jar hasil build lokal
```

Kecuali ada alasan repository policy tertentu.

### Wrapper Files Biasanya Dicommmit

Untuk Maven:

```text
mvnw
mvnw.cmd
.mvn/wrapper/maven-wrapper.properties
```

Untuk Gradle:

```text
gradlew
gradlew.bat
gradle/wrapper/gradle-wrapper.properties
gradle/wrapper/gradle-wrapper.jar
```

Wrapper membantu reproducible build antar developer/CI.

### IDE Files: Tergantung Policy

Beberapa tim commit sebagian konfigurasi IDE, misalnya code style atau inspection profile. Tetapi file workspace lokal sebaiknya tidak.

Yang penting bukan “selalu jangan commit `.idea`”, tetapi:

```text
Apakah file itu shared project configuration atau state lokal user?
```

---

## Commit dan Reviewability

Commit yang baik memudahkan review.

Reviewability dipengaruhi oleh:

1. ukuran diff,
2. kohesi perubahan,
3. urutan commit,
4. commit message,
5. pemisahan mechanical vs semantic change,
6. test relevan,
7. minim noise formatting,
8. minim perubahan generated yang tidak perlu.

### Reviewer Harus Bisa Menjawab

```text
Apa intent commit ini?
Apa invariant yang berubah?
Apa edge case yang ditangani?
Apa risiko integrasi?
Bagian mana yang mechanical?
Bagian mana yang behavior change?
```

Jika reviewer tidak bisa menjawab, commit mungkin perlu dipecah atau message perlu diperbaiki.

---

## Commit dan Revertability

Commit yang baik harus mudah direvert.

Pertanyaan:

```text
Jika commit ini menyebabkan incident production,
bisakah kita revert commit ini sendiri tanpa membatalkan perubahan lain?
```

Jika jawabannya tidak, commit mungkin terlalu campur.

Contoh buruk:

```text
commit: update payment module

Isi:
- bugfix settlement
- refactor package
- upgrade dependency
- update config
```

Jika dependency upgrade bermasalah, revert akan ikut membatalkan bugfix settlement.

Lebih baik:

```text
commit 1: upgrade payment SDK to 4.2.1
commit 2: adapt payment client to SDK 4.2 response model
commit 3: fix settlement retry classification
```

---

## Commit dan Bisectability

`git bisect` bekerja paling baik jika setiap commit bisa dibuild/test.

Jika history penuh commit rusak seperti:

```text
WIP
fix compile
fix test
fix again
```

Bisect menjadi kurang efektif.

Target ideal:

```text
Setiap commit penting di shared history merepresentasikan state yang masuk akal.
```

Tidak selalu harus sempurna, tetapi semakin baik commit quality, semakin kuat Git sebagai debugging tool.

---

## Commit dan Auditability

Untuk sistem enforcement, financial, identity, healthcare, atau regulated workflow, commit bisa menjadi bagian evidence trail.

Commit yang buruk:

```text
update rules
```

Commit yang baik:

```text
Require supervisor approval for high-risk case closure

High-risk cases must now be reviewed by a supervisor before closure to
match the updated enforcement procedure effective 2026-06-01. The rule is
enforced in CaseClosurePolicy so REST and batch closure flows share the
same approval invariant.

Refs: POLICY-2026-014
```

Ini membantu menjawab:

1. rule apa berubah,
2. kenapa berubah,
3. sejak kapan requirement berlaku,
4. layer mana menegakkan invariant,
5. referensi policy/ticket.

---

## Commit Message dan Conventional Commits

Sebagian tim memakai Conventional Commits:

```text
<type>(<scope>): <description>
```

Contoh:

```text
fix(payment): reject expired settlement requests
feat(case): add supervisor approval requirement
refactor(auth): extract token verifier
```

Type umum:

| Type | Makna |
|---|---|
| `feat` | fitur baru |
| `fix` | bugfix |
| `refactor` | perubahan struktur tanpa behavior change |
| `test` | perubahan test |
| `docs` | dokumentasi |
| `build` | build system/dependency |
| `ci` | CI/CD |
| `chore` | maintenance |
| `perf` | performance |
| `revert` | revert commit |

Conventional Commits berguna untuk:

1. changelog automation,
2. semantic release,
3. filtering history,
4. standardisasi tim.

Tetapi jangan salah paham:

```text
Format rapi tidak menggantikan intent yang jelas.
```

Commit ini masih buruk:

```text
fix: update
```

Commit ini lebih baik:

```text
fix(payment): reject expired settlement requests
```

---

## Commit Message dengan Ticket ID

Ticket ID berguna, tetapi jangan jadikan satu-satunya konteks.

Buruk:

```text
ABC-123
```

Lebih baik:

```text
ABC-123 Fix duplicate case assignment on retry
```

Lebih baik lagi:

```text
Fix duplicate case assignment on retry

Retrying a failed assignment request could create a second active case
assignment because the idempotency key was checked after persistence.
Move the idempotency check before assignment creation.

Refs: ABC-123
```

Kenapa?

Karena ticket system bisa berubah, link bisa mati, permission bisa hilang, atau konteks ticket terlalu panjang. Commit harus tetap punya konteks minimal.

---

## Commit Message dan “Why”

Diff menjelaskan apa yang berubah. Commit message harus menjelaskan kenapa.

Contoh diff sudah menunjukkan:

```java
if (caseFile.isExpired()) {
    throw new InvalidTransitionException("Case is expired");
}
```

Commit message “Add expired check” kurang bernilai.

Lebih baik:

```text
Reject expired cases before approval

Approval after expiry violates the enforcement action window. Enforce the
check in the transition policy so admin UI and batch approval jobs share
the same rule.
```

Nilai tambah message ada di domain reasoning.

---

## Commit Message dan Layering Reasoning

Untuk Java/backend, commit message sering perlu menjelaskan layer.

Contoh:

```text
Move duplicate assignment guard into domain service

The REST controller already rejected duplicate assignments, but retry jobs
and internal admin actions bypassed that controller. Move the guard into
CaseAssignmentService so all write paths share the same idempotency rule.
```

Ini membantu future engineer memahami kenapa validasi tidak diletakkan di controller.

---

## Commit Message dan Risk Disclosure

Jika commit punya risiko, tulis.

Contoh:

```text
Change case search default sort to updatedAt descending

This aligns the API with dashboard expectations and makes recently touched
cases visible first. Existing clients that relied on implicit createdAt
ordering should pass an explicit sort parameter.

Refs: CASE-2021
```

Message ini memberi sinyal compatibility risk.

---

## Praktik Commit di Branch Feature

### Saat Eksplorasi

Boleh:

```text
WIP spike transition policy
WIP add approval rule tests
```

### Sebelum PR

Rapikan menjadi:

```text
Extract transition policy from case service
Require supervisor approval for high-risk closure
Add transition policy regression tests
```

Gunakan interactive rebase di part 010 nanti.

---

## Menghindari Kehilangan Perubahan Saat Commit

Commit tidak menghapus perubahan unstaged.

Jika kamu punya state:

```text
Changes to be committed:
  modified: A.java

Changes not staged for commit:
  modified: B.java
```

Lalu commit:

```bash
git commit -m "Update A"
```

Maka:

```text
A.java masuk commit.
B.java tetap modified di working tree.
```

Ini powerful, tetapi bisa membingungkan jika kamu tidak membaca `git status`.

---

## File Sama Staged dan Unstaged: Cara Menanganinya

Situasi:

```text
Changes to be committed:
  modified: PaymentService.java

Changes not staged for commit:
  modified: PaymentService.java
```

Langkah aman:

```bash
git diff --staged PaymentService.java
```

Lihat versi yang akan masuk commit.

```bash
git diff PaymentService.java
```

Lihat perubahan tambahan yang belum masuk.

Jika perubahan tambahan juga harus masuk:

```bash
git add PaymentService.java
```

Jika tidak, commit staged dulu:

```bash
git commit -m "..."
```

Perubahan unstaged tetap tinggal untuk commit berikutnya.

---

## Commit dan File Mode

Kadang Git menunjukkan:

```text
old mode 100644
new mode 100755
```

Ini berarti executable bit berubah.

Untuk Java project, ini sering terjadi pada script:

```text
mvnw
gradlew
scripts/run-local.sh
```

Pastikan perubahan mode disengaja.

Jika tidak disengaja karena OS/tooling, restore atau konfigurasi `core.fileMode` sesuai konteks. Detail cross-platform akan dibahas di part 022.

---

## Commit dan Line Ending Noise

Diff yang terlihat seluruh file berubah bisa disebabkan oleh line ending CRLF/LF.

Jika kamu melihat ribuan baris berubah padahal hanya edit kecil:

1. cek whitespace/line endings,
2. cek `.gitattributes`,
3. jangan commit sebelum jelas.

Detail akan dibahas di part 022, tetapi awareness-nya penting sejak sekarang.

---

## Commit dan Generated Code

Generated code bisa menciptakan diff besar.

Contoh:

```text
OpenAPI generated client
protobuf generated classes
jOOQ generated sources
MapStruct generated implementation
```

Sebelum commit generated file, tanya:

```text
Apakah generated file ini source of truth di repo?
Apakah CI menghasilkan file ini?
Apakah reviewer perlu membaca generated diff?
Apakah perubahan generated konsisten dengan contract/source generator?
```

Jika generated code memang harus dicommit, sering lebih baik pisahkan:

```text
commit 1: update payment OpenAPI contract
commit 2: regenerate payment API client
commit 3: adapt payment service to new client model
```

---

## Commit dan Dependency Update

Dependency update di Java bisa berdampak luas.

Contoh:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-web</artifactId>
  <version>...</version>
</dependency>
```

atau Gradle:

```kotlin
implementation("org.springframework.boot:spring-boot-starter-web")
```

Sebaiknya dependency update dipisah dari behavior change jika dampaknya besar.

Contoh:

```text
build: upgrade jackson to 2.17.2
fix(api): adapt enum serialization after jackson upgrade
```

Ini membantu rollback jika dependency bermasalah.

---

## Commit dan Database Migration

Database migration harus sangat hati-hati.

Anti-pattern:

```text
add new feature
```

Isi:

1. schema migration,
2. entity change,
3. repository query,
4. service behavior,
5. UI/API change,
6. data backfill.

Untuk sistem production, lebih aman memikirkan commit sebagai deployment step:

```text
commit 1: add nullable column
commit 2: write new column while preserving old behavior
commit 3: backfill existing rows
commit 4: read from new column with fallback
commit 5: enforce non-null constraint
commit 6: remove old column usage
```

Commit dan deployment tidak selalu 1:1, tetapi history yang baik memudahkan migration review.

---

## Commit dan Feature Flags

Jika perubahan behavior besar, commit bisa dipisahkan:

```text
commit 1: add feature flag for new sanction workflow
commit 2: implement new sanction workflow behind flag
commit 3: route pilot users to new sanction workflow
```

Ini membuat rollback/disable lebih aman.

---

## Commit dan Backward Compatibility

Untuk API/public contract, commit message harus menyebut compatibility.

Contoh:

```text
Add optional closureReason to case closure API

The field is optional to preserve compatibility with existing clients. The
server records it when present but does not require it until all internal
clients have been migrated.

Refs: CASE-2331
```

Ini jauh lebih membantu daripada:

```text
update dto
```

---

## Latihan Praktis 1: State Transition Dasar

Buat repo latihan:

```bash
mkdir git-part-004-lab
cd git-part-004-lab
git init
mkdir -p src/main/java/example
cat > src/main/java/example/App.java <<'EOF'
package example;

public class App {
    public static void main(String[] args) {
        System.out.println("hello");
    }
}
EOF

git status
git add src/main/java/example/App.java
git diff --staged
git commit -m "Add initial Java app"
```

Amati:

```bash
git status
git log --oneline
git show --stat
```

Pertanyaan:

1. Kapan file berpindah dari untracked menjadi staged?
2. Apa isi index sebelum commit?
3. Apa yang berubah setelah commit?

---

## Latihan Praktis 2: File Sama Staged dan Unstaged

Edit file:

```bash
cat > src/main/java/example/App.java <<'EOF'
package example;

public class App {
    public static void main(String[] args) {
        System.out.println("hello git");
    }
}
EOF

git add src/main/java/example/App.java
```

Edit lagi:

```bash
cat > src/main/java/example/App.java <<'EOF'
package example;

public class App {
    public static void main(String[] args) {
        System.out.println("hello git mastery");
    }
}
EOF
```

Lihat:

```bash
git status
git diff --staged
git diff
```

Pertanyaan:

1. Kenapa file sama muncul di staged dan unstaged?
2. Versi mana yang akan masuk commit?
3. Apa yang terjadi jika kamu commit sekarang?

---

## Latihan Praktis 3: Partial Staging

Buat perubahan berisi dua intent:

```bash
cat > src/main/java/example/App.java <<'EOF'
package example;

public class App {
    public static void main(String[] args) {
        String name = "git mastery";
        System.out.println(greeting(name));
    }

    static String greeting(String name) {
        return "hello " + name;
    }
}
EOF
```

Lalu tambahkan test atau file lain jika mau. Gunakan:

```bash
git add -p
```

Coba stage sebagian hunk. Jika hunk terlalu besar, coba `s` untuk split.

Pertanyaan:

1. Apakah kamu bisa membuat commit refactor terpisah dari behavior change?
2. Apa bedanya `git diff` dan `git diff --staged` setelah partial staging?

---

## Latihan Praktis 4: Amend Commit Lokal

Buat commit dengan typo message:

```bash
git add .
git commit -m "Add greting helper"
```

Perbaiki message:

```bash
git commit --amend -m "Add greeting helper"
```

Lihat log:

```bash
git log --oneline
```

Pertanyaan:

1. Apakah commit hash berubah?
2. Kenapa hash berubah?
3. Kenapa amend dianggap rewrite history?

---

## Latihan Praktis 5: Commit Message Forensics

Ambil perubahan nyata dari project Java kamu atau contoh imajiner.

Tulis tiga versi commit message:

1. versi buruk satu kata,
2. versi cukup baik dengan subject jelas,
3. versi senior dengan subject, body, reasoning, risk, dan reference.

Bandingkan:

```text
Apakah message ini membantu engineer yang membaca 6 bulan lagi?
Apakah message ini menjelaskan why?
Apakah message ini membantu rollback decision?
```

---

## Checklist Sebelum Commit

Gunakan checklist operasional ini:

```text
[ ] git status sudah dibaca
[ ] git diff untuk unstaged changes sudah dicek
[ ] git diff --staged untuk calon commit sudah dicek
[ ] commit punya satu intent utama
[ ] tidak ada debug print/log sementara
[ ] tidak ada secret/local config
[ ] tidak ada generated/build output tanpa alasan
[ ] test relevan ikut atau alasan tidak ada test jelas
[ ] formatting tidak mencampur logic besar
[ ] commit message menjelaskan intent dan why
[ ] commit aman direvert sendiri
```

---

## Checklist Setelah Commit

```text
[ ] git status menunjukkan state yang dipahami
[ ] git log --oneline -1 sesuai ekspektasi
[ ] git show --stat masuk akal
[ ] git show menampilkan diff yang benar
[ ] test/build minimal sudah dijalankan jika relevan
[ ] tidak ada file penting tertinggal unstaged/untracked
```

---

## Decision Guide Cepat

### Saya sudah `git add .` tapi terlalu banyak yang staged

Gunakan:

```bash
git reset
```

atau:

```bash
git restore --staged .
```

Lalu stage ulang lebih selektif.

### Saya ingin membuang perubahan file tracked

Gunakan:

```bash
git restore path/to/file
```

### Saya ingin mengeluarkan file dari staging tetapi edit tetap ada

Gunakan:

```bash
git restore --staged path/to/file
```

### Saya lupa memasukkan file di commit terakhir

Jika belum push/shared:

```bash
git add path/to/file
git commit --amend
```

### Saya ingin commit hanya sebagian perubahan file

Gunakan:

```bash
git add -p path/to/file
```

### Saya ingin melihat calon commit

Gunakan:

```bash
git diff --staged
```

---

## Kesalahan yang Harus Sengaja Dihindari

1. Commit tanpa membaca `git diff --staged`.
2. Selalu memakai `git add .` tanpa seleksi.
3. Menganggap commit message tidak penting karena ada PR description.
4. Mencampur refactor, formatting, dan behavior change besar.
5. Amend commit yang sudah dipakai orang lain tanpa koordinasi.
6. Commit file lokal/secret lalu mengira delete commit berikutnya cukup.
7. Mengabaikan untracked test file.
8. Menggunakan `git reset --hard` untuk “membersihkan” tanpa paham dampaknya.
9. Membuat commit yang tidak bisa direvert tanpa collateral damage.
10. Menganggap Git hanya alat simpan, bukan alat reasoning historis.

---

## Mental Model Akhir Bagian Ini

Ingat tiga state utama:

```text
HEAD         = snapshot commit terakhir
Index        = snapshot calon commit berikutnya
Working tree = file yang sedang kamu edit
```

Command dasar sebagai transisi state:

```text
git add              working tree -> index
git restore          index -> working tree
git restore --staged HEAD -> index
git reset            HEAD -> index
git commit           index -> commit baru
git commit --amend   index -> commit pengganti commit terakhir
```

Commit berkualitas bukan soal command.

Commit berkualitas adalah hasil dari pertanyaan:

```text
Apa intent perubahan ini?
Apa boundary-nya?
Apakah calon commit merepresentasikan satu unit reasoning?
Apakah bisa direview?
Apakah bisa direvert?
Apakah bisa dipakai debugging?
Apakah membantu pembaca masa depan?
```

---

## Ringkasan

Di bagian ini kamu belajar bahwa lifecycle perubahan Git bukan sekadar:

```bash
git add .
git commit -m "update"
```

Tetapi proses engineering:

```text
observe -> select -> verify -> record -> validate
```

Kunci utamanya:

1. `git status` adalah dashboard state.
2. `git diff` menunjukkan perubahan belum staged.
3. `git diff --staged` menunjukkan calon commit.
4. `git add` memindahkan content ke index.
5. `git commit` membuat snapshot dari index.
6. Partial staging membantu commit atomic.
7. Commit message harus menjelaskan intent dan reasoning.
8. Commit yang baik harus reviewable, revertable, bisectable, dan auditable.

---

## Referensi

Referensi utama untuk bagian ini:

1. Pro Git Book — Git Basics: Recording Changes to the Repository  
   https://git-scm.com/book/en/v2/Git-Basics-Recording-Changes-to-the-Repository

2. Pro Git Book — What is Git?  
   https://git-scm.com/book/en/v2/Getting-Started-What-is-Git%3F

3. Git Documentation — git-add  
   https://git-scm.com/docs/git-add

4. Git Documentation — git-commit  
   https://git-scm.com/docs/git-commit

5. Git Documentation — git-status  
   https://git-scm.com/docs/git-status

6. Git Documentation — git-diff  
   https://git-scm.com/docs/git-diff

7. Git Documentation — git-restore  
   https://git-scm.com/docs/git-restore

8. Git Documentation — git-reset  
   https://git-scm.com/docs/git-reset

9. Git Cheat Sheet  
   https://git-scm.com/cheat-sheet

---

## Status Seri

```text
Progress: 004 / 032
Seri belum selesai.
Bagian berikutnya: learn-git-mastery-for-java-engineers-part-005.md
Topik berikutnya: Membaca History secara Efektif
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-git-mastery-for-java-engineers-part-003.md">⬅️ Part 003 — Commit Graph: Parent, Branch, HEAD, dan Reachability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-git-mastery-for-java-engineers-part-005.md">Part 005 — Membaca History secara Efektif ➡️</a>
</div>

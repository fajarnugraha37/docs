# learn-git-mastery-for-java-engineers-part-001.md

# Part 001 — Git sebagai Model Evolusi Software

> Series: **Git Mastery for Java Software Engineers**  
> Part: **001 / 032**  
> Status seri: **belum selesai**  
> Bagian sebelumnya: [`learn-git-mastery-for-java-engineers-part-000.md`](learn-git-mastery-for-java-engineers-part-000.md)  
> Bagian berikutnya: `learn-git-mastery-for-java-engineers-part-002.md` — Repository, Working Tree, Index, dan Object Database

---

## Tujuan Part Ini

Bagian ini membangun fondasi mental model Git.

Kita belum mengejar hafalan command. Kita akan memahami Git sebagai sistem untuk merepresentasikan **evolusi software**. Ini penting karena banyak engineer bisa menjalankan `git add`, `git commit`, `git push`, tetapi masih mudah panik saat conflict, rebase, detached HEAD, force push, lost commit, atau release hotfix.

Target setelah menyelesaikan part ini:

1. Memahami Git sebagai **distributed version control system**, bukan sekadar folder backup.
2. Memahami Git sebagai model evolusi berbasis **snapshot**, bukan sekadar kumpulan diff.
3. Memahami commit sebagai **node historis** yang membentuk graph.
4. Memahami branch sebagai **nama/pointer**, bukan salinan folder.
5. Memahami repository sebagai kombinasi antara:
   - object database,
   - references,
   - index/staging area,
   - working tree.
6. Mampu menjelaskan mengapa Git sangat cocok untuk software engineering modern, termasuk Java backend, microservices, CI/CD, audit, rollback, dan release governance.
7. Mulai berpikir dalam bentuk **state transition**, bukan command template.

---

## Sumber Utama

Materi ini konsisten dengan konsep resmi Git:

- Git adalah distributed version control system yang dirancang untuk menangani project kecil sampai sangat besar dengan cepat dan efisien.
- Pro Git menjelaskan bahwa Git bekerja terutama dengan snapshot; saat commit, Git menyimpan snapshot dari staging area ke repository.
- Git object database menyimpan object seperti blob, tree, commit, dan tag.
- Git references adalah nama yang menunjuk ke object id/commit tertentu.

Referensi resmi:

- Git SCM — What is Git: https://git-scm.com/book/en/v2/Getting-Started-What-is-Git%3F
- Git SCM — About Version Control: https://git-scm.com/book/en/v2/Getting-Started-About-Version-Control
- Git SCM — Git Objects: https://git-scm.com/book/en/v2/Git-Internals-Git-Objects
- Git SCM — Git References: https://git-scm.com/book/en/v2/Git-Internals-Git-References
- Git SCM — Reference Manual: https://git-scm.com/docs

---

# 1. Kenapa Git Perlu Dipahami Serius?

Banyak engineer memperlakukan Git sebagai “ritual sebelum deploy”:

```bash
git add .
git commit -m "update"
git pull
git push
```

Itu cukup untuk project kecil, tetapi rapuh untuk sistem nyata.

Dalam sistem Java enterprise atau backend production, Git berada di pusat banyak aktivitas:

- feature development,
- bug fixing,
- pull request review,
- release branching,
- rollback,
- hotfix,
- audit perubahan,
- investigasi regression,
- dependency upgrade,
- migrasi arsitektur,
- incident response,
- compliance evidence,
- CI/CD pipeline,
- code ownership,
- traceability dari requirement ke deployment.

Git bukan hanya alat menyimpan source code. Git adalah **timeline formal dari perubahan sistem**.

Jika timeline itu berantakan, maka engineering process juga ikut berantakan.

---

## 1.1 Git sebagai Infrastructure of Change

Software berubah terus:

- requirement berubah,
- bug ditemukan,
- security vulnerability muncul,
- dependency perlu diupgrade,
- design lama perlu diganti,
- production incident memaksa hotfix,
- tim berbeda bekerja pada modul yang sama,
- release lama perlu dipatch,
- eksperimen perlu dilakukan tanpa merusak mainline.

Git memberi struktur untuk perubahan tersebut.

Tanpa Git, perubahan hanya berupa file yang berubah. Dengan Git, perubahan menjadi:

```text
siapa mengubah apa,
kapan,
di atas state mana,
dengan alasan apa,
tergabung lewat jalur mana,
masuk release mana,
bisa dikembalikan atau tidak,
dan berdampak ke bagian mana.
```

Itulah mengapa Git harus dipahami sebagai **model evolusi**, bukan command-line utility biasa.

---

## 1.2 Analogi yang Salah: Git sebagai Backup Folder

Analogi umum:

```text
Git itu seperti backup versi file.
```

Analogi ini membantu di awal, tetapi cepat menyesatkan.

Backup folder biasanya seperti ini:

```text
project-final.zip
project-final-v2.zip
project-final-v2-fixed.zip
project-final-v2-fixed-real-final.zip
```

Masalahnya:

- tidak jelas perubahan apa yang terjadi,
- tidak jelas urutan logisnya,
- sulit membandingkan perubahan,
- sulit menggabungkan kerja beberapa orang,
- sulit rollback sebagian,
- sulit membuktikan kenapa sebuah perubahan ada,
- sulit menelusuri asal bug,
- tidak ada struktur branch/merge,
- tidak ada graph perubahan.

Git bukan sekadar menyimpan salinan folder lama. Git menyimpan **sejarah terstruktur**.

---

## 1.3 Analogi yang Lebih Tepat: Git sebagai Database Evolusi

Mental model yang lebih kuat:

```text
Git adalah database content-addressed yang menyimpan snapshot project dan relasi historis antar snapshot.
```

Dalam model ini:

- commit adalah record historis,
- file content disimpan sebagai object,
- directory disimpan sebagai tree,
- branch adalah pointer bernama,
- tag adalah pointer untuk versi penting,
- HEAD adalah pointer ke posisi kerja saat ini,
- repository adalah database lokal,
- remote adalah repository lain yang dapat disinkronkan.

Dengan kata lain:

```text
Git bukan folder dengan history.
Git adalah history database yang dapat mewujudkan folder pada state tertentu.
```

Ini pembalikan cara pandang yang sangat penting.

---

# 2. Masalah Fundamental yang Diselesaikan Git

Sebelum memahami Git, kita perlu memahami problem domain-nya.

Version control muncul karena software engineering memiliki beberapa problem dasar.

---

## 2.1 Problem 1 — Change Tracking

Pertanyaan:

```text
Apa yang berubah antara versi kemarin dan hari ini?
```

Tanpa version control, kita hanya melihat file saat ini.

Dengan Git, kita bisa melihat:

- file mana berubah,
- baris mana berubah,
- commit mana memperkenalkan perubahan,
- siapa author-nya,
- kapan dibuat,
- pesan perubahan,
- parent commit-nya,
- branch tempat perubahan dikembangkan.

Untuk Java engineer, ini penting ketika terjadi:

- behavior service berubah,
- endpoint REST mulai gagal,
- query repository menjadi lambat,
- dependency upgrade memicu regression,
- serialization berubah,
- contract antar service rusak,
- config production berbeda dari ekspektasi.

---

## 2.2 Problem 2 — Collaboration

Software jarang dikerjakan sendiri.

Beberapa engineer bisa mengubah:

```text
UserService.java
OrderController.java
pom.xml
application.yml
Dockerfile
DatabaseMigration.sql
```

secara bersamaan.

Git harus menjawab:

- bagaimana setiap orang bekerja tanpa saling overwrite,
- bagaimana perubahan paralel digabung,
- bagaimana conflict dideteksi,
- bagaimana review dilakukan,
- bagaimana tim tahu perubahan mana yang sudah masuk mainline,
- bagaimana menjaga main branch tetap sehat.

Git menyelesaikan ini bukan dengan mengunci file, tetapi dengan memungkinkan **divergence** dan **convergence**:

```text
Divergence  = beberapa jalur perubahan berjalan paralel.
Convergence = jalur tersebut digabung kembali.
```

Branch dan merge adalah primitive untuk itu.

---

## 2.3 Problem 3 — Experimentation

Engineering membutuhkan eksperimen:

- mencoba cache strategy baru,
- mengganti ORM mapping,
- menguji pendekatan async processing,
- melakukan spike untuk refactor modul,
- mencoba Java version upgrade,
- mengubah Gradle/Maven setup,
- menguji branch framework baru.

Eksperimen harus bisa dilakukan tanpa merusak mainline.

Git memungkinkan kita membuat branch murah:

```bash
git switch -c experiment/new-cache-strategy
```

Tetapi mental model yang benar:

```text
Kita tidak menyalin seluruh repository.
Kita hanya membuat pointer baru ke commit saat ini.
```

Itulah alasan branch di Git sangat ringan.

---

## 2.4 Problem 4 — Recovery

Engineer akan melakukan kesalahan:

- commit salah file,
- reset terlalu jauh,
- branch terhapus,
- rebase gagal,
- conflict resolution salah,
- force push tidak sengaja,
- stash hilang,
- merge salah branch,
- hotfix dibuat dari base yang salah.

Git menyediakan banyak mekanisme recovery karena Git menyimpan object dan pergerakan reference.

Konsep seperti reflog, dangling object, commit reachability, dan object retention akan dibahas mendalam nanti.

Untuk sekarang, pahami prinsipnya:

```text
Dalam Git, banyak hal yang tampak hilang sebenarnya hanya tidak lagi ditunjuk oleh nama yang mudah terlihat.
```

Ini hanya masuk akal jika kita memahami Git sebagai graph + pointer.

---

## 2.5 Problem 5 — Auditability

Dalam sistem serius, pertanyaan berikut sering muncul:

```text
Kenapa validasi ini berubah?
Kapan rule ini ditambahkan?
Siapa yang approve perubahan fee calculation?
Commit mana yang masuk release 2.7.4?
Bug ini ada sejak versi berapa?
Apakah hotfix production juga sudah masuk main?
Apakah perubahan ini punya ticket?
Apakah dependency vulnerable sudah benar-benar dihapus?
```

Git menyediakan data mentah untuk audit, tetapi kualitas audit sangat tergantung pada kualitas commit, branch, tag, dan workflow.

Git yang dipakai asal-asalan tetap menyimpan history, tetapi history-nya tidak selalu berguna.

---

# 3. Git Dibangun di Atas Snapshot, Bukan Sekadar Diff

Salah satu mental model paling penting:

```text
Git berpikir terutama dalam snapshot project.
```

Saat commit dibuat, Git menyimpan representasi state project pada saat itu. Secara efisien, Git tidak menggandakan semua file setiap kali jika content sama, tetapi model konseptual yang benar adalah snapshot.

---

## 3.1 Diff Model vs Snapshot Model

Banyak orang membayangkan version control seperti ini:

```text
Version 1 + perubahan A + perubahan B + perubahan C = Version 4
```

Ini adalah diff/patch mental model.

Git lebih baik dipahami seperti ini:

```text
Commit A = snapshot project pada state A
Commit B = snapshot project pada state B
Commit C = snapshot project pada state C
```

Lalu Git bisa menghitung perbedaannya saat dibutuhkan:

```bash
git diff A B
```

Artinya, diff adalah hasil perbandingan antara dua state, bukan inti utama yang selalu kita manipulasi secara langsung.

---

## 3.2 Contoh Snapshot Sederhana

Misal project Java kecil:

```text
src/main/java/com/example/UserService.java
src/main/java/com/example/UserRepository.java
pom.xml
```

Commit pertama:

```text
A
├── UserService.java      content hash: aaa111
├── UserRepository.java   content hash: bbb222
└── pom.xml               content hash: ccc333
```

Kemudian `UserService.java` berubah.

Commit kedua:

```text
B
├── UserService.java      content hash: ddd444
├── UserRepository.java   content hash: bbb222
└── pom.xml               content hash: ccc333
```

Secara konseptual, commit B adalah snapshot lengkap. Tetapi Git bisa reuse object untuk file yang tidak berubah.

Yang berubah hanya object untuk `UserService.java` dan tree yang menunjuknya.

---

## 3.3 Kenapa Snapshot Model Penting?

Karena banyak operasi Git sebenarnya menjawab pertanyaan:

```text
State mana yang sedang saya lihat?
State mana yang ingin saya bandingkan?
State mana yang ingin saya jadikan parent?
State mana yang ingin saya pindahkan pointer-nya?
```

Contoh:

```bash
git checkout v1.0.0
```

Mental model:

```text
Wujudkan working tree sesuai snapshot yang ditunjuk tag v1.0.0.
```

Contoh:

```bash
git diff main feature/payment-validation
```

Mental model:

```text
Bandingkan snapshot yang ditunjuk main dengan snapshot yang ditunjuk feature/payment-validation.
```

Contoh:

```bash
git reset --hard HEAD~1
```

Mental model:

```text
Pindahkan branch saat ini ke parent commit sebelumnya, lalu paksa index dan working tree mengikuti snapshot itu.
```

Tanpa snapshot mental model, command-command ini tampak seperti mantra.

Dengan snapshot mental model, command-command ini menjadi state transition.

---

# 4. Commit sebagai Unit Evolusi

Commit bukan hanya “save point”.

Commit adalah unit historis yang menyatakan:

```text
Dari parent state tertentu,
saya membuat state baru,
dengan perubahan logis tertentu,
oleh author tertentu,
pada waktu tertentu,
dengan message tertentu.
```

---

## 4.1 Isi Konseptual Commit

Sebuah commit secara konseptual berisi:

| Elemen | Makna |
|---|---|
| Tree | Snapshot isi project pada commit tersebut |
| Parent(s) | Commit sebelumnya yang menjadi basis |
| Author | Orang yang membuat perubahan awal |
| Committer | Orang/proses yang membuat commit object final |
| Timestamp | Waktu authoring dan committing |
| Message | Penjelasan intent perubahan |

Untuk merge commit, parent bisa lebih dari satu.

---

## 4.2 Commit sebagai Node Graph

Jika commit A dilanjutkan oleh B, lalu C:

```text
A --- B --- C
```

Artinya:

```text
B punya parent A.
C punya parent B.
```

Bukan A “menyimpan diff ke B” secara sederhana, tetapi B adalah commit baru yang menunjuk parent A.

Branching:

```text
A --- B --- C  main
      \
       D --- E  feature
```

Artinya:

- `main` menunjuk ke C,
- `feature` menunjuk ke E,
- D dibuat dari B,
- E dibuat dari D,
- history bercabang setelah B.

---

## 4.3 Commit yang Baik adalah Commit yang Punya Intent

Commit berkualitas bukan hanya “kode berhasil compile”.

Commit berkualitas menjawab:

```text
Perubahan logis apa yang dibuat?
Kenapa dibuat?
Apa boundary-nya?
Apakah bisa direview sendiri?
Apakah bisa direvert sendiri?
Apakah message-nya membantu debugging 6 bulan kemudian?
```

Contoh buruk:

```text
update
fix
misc changes
final
changes after review
```

Contoh lebih baik:

```text
Validate duplicate payment request id before authorization

Reject repeated request ids at the service boundary before creating
authorization records. This prevents duplicate downstream calls when
clients retry after timeout.
```

Untuk Java backend, commit ideal biasanya terkait satu intent:

- tambah validation rule,
- ubah repository query,
- perbaiki transaction boundary,
- update dependency,
- refactor nama method tanpa behavior change,
- tambah test coverage untuk bug tertentu,
- ubah config timeout,
- tambah migration schema.

Jangan campur semua dalam satu commit kecuali memang satu perubahan atomik yang tidak bisa dipisah.

---

# 5. Branch sebagai Pointer, Bukan Folder

Ini salah satu konsep yang paling sering disalahpahami.

Banyak engineer membayangkan branch seperti salinan folder:

```text
main/     = folder A
feature/  = folder B
```

Mental model ini salah.

Branch di Git adalah **reference** yang menunjuk ke commit tertentu.

---

## 5.1 Visualisasi Branch

Misal:

```text
A --- B --- C
            ^
            main
```

`main` adalah nama yang menunjuk ke commit C.

Saat membuat branch baru:

```bash
git switch -c feature/login-policy
```

Graph:

```text
A --- B --- C
            ^
            main
            feature/login-policy
```

Belum ada file yang disalin. Hanya ada reference baru.

Saat commit baru dibuat di feature:

```text
A --- B --- C  main
             \
              D  feature/login-policy
```

Branch `feature/login-policy` maju ke D. `main` tetap di C.

---

## 5.2 Kenapa Branch Murah?

Karena membuat branch pada dasarnya membuat file/reference kecil yang berisi object id commit.

Bukan menyalin semua file project.

Itulah mengapa branch bisa dibuat untuk:

- feature,
- bugfix,
- spike,
- experiment,
- hotfix,
- release stabilization,
- code review,
- bisect investigation,
- dependency upgrade trial.

Branch murah secara teknis, tetapi tidak selalu murah secara organisasi.

Branch yang hidup terlalu lama bisa mahal karena:

- makin jauh dari main,
- conflict makin besar,
- semantic drift meningkat,
- review makin berat,
- CI feedback terlambat,
- ownership perubahan menjadi kabur.

---

## 5.3 Branch Tidak Sama dengan Environment

Anti-pattern umum:

```text
dev branch
qa branch
staging branch
production branch
```

Kadang ini dipakai, tetapi sering menimbulkan masalah karena branch diperlakukan sebagai environment state, bukan history line software.

Environment sebaiknya mereferensikan immutable artifact atau commit/tag tertentu, misalnya:

```text
staging deploys commit abc123
production deploys tag v2.7.4
```

Bukan berarti semua organisasi harus menghindari branch environment dalam semua kasus, tetapi harus disadari risikonya:

- branch drift,
- hotfix hilang,
- merge bolak-balik kacau,
- tidak jelas source of truth,
- audit release sulit.

Topik ini akan dibahas lebih dalam di workflow dan CI/CD part.

---

# 6. HEAD: Posisi Kesadaran Git Saat Ini

`HEAD` adalah konsep kecil tetapi sangat penting.

Secara sederhana:

```text
HEAD menunjukkan posisi kerja Git saat ini.
```

Biasanya HEAD menunjuk ke branch.

Contoh:

```text
HEAD -> main -> C
```

Artinya:

- kita sedang berada di branch `main`,
- `main` menunjuk ke commit C,
- commit baru akan membuat `main` maju.

---

## 6.1 HEAD Normal

```text
A --- B --- C
            ^
            main
            ^
            HEAD
```

Atau lebih akurat:

```text
HEAD -> refs/heads/main -> C
```

Saat commit D dibuat:

```text
A --- B --- C --- D
                  ^
                  main
                  ^
                  HEAD
```

Branch bergerak maju.

---

## 6.2 Detached HEAD

Detached HEAD terjadi ketika HEAD menunjuk langsung ke commit, bukan branch.

Misal:

```bash
git switch --detach C
```

Graph:

```text
A --- B --- C --- D  main
          ^
          HEAD
```

Jika kita commit dari sini:

```text
A --- B --- C --- D  main
          \
           E  HEAD
```

Commit E ada, tetapi tidak punya branch name yang menunjuknya.

Ini bukan langsung hilang, tetapi mudah “tidak terlihat” setelah pindah branch.

Maka saat berada di detached HEAD dan ingin menyimpan eksperimen:

```bash
git switch -c experiment/from-old-version
```

Mental model:

```text
Buat nama branch agar commit ini punya reference stabil.
```

---

# 7. Repository: Bukan Hanya Working Folder

Ketika melihat folder project Java, kita melihat:

```text
my-service/
├── src/
├── pom.xml
├── Dockerfile
├── README.md
└── .git/
```

Banyak orang menganggap repository adalah seluruh folder itu.

Secara praktis boleh, tetapi secara mental perlu lebih presisi.

Repository Git sebenarnya terutama berada di:

```text
.git/
```

Folder kerja di luar `.git` adalah working tree.

---

## 7.1 Empat Area Penting

Git sehari-hari melibatkan empat area:

```text
Working Tree  -> file yang terlihat dan diedit
Index         -> staging area / rencana commit berikutnya
Local Repo    -> object database + refs di .git
Remote Repo   -> repository lain yang disinkronkan
```

Visual:

```text
┌────────────────┐
│ Working Tree   │  file yang Anda edit
└───────┬────────┘
        │ git add
        v
┌────────────────┐
│ Index / Stage  │  snapshot kandidat commit
└───────┬────────┘
        │ git commit
        v
┌────────────────┐
│ Local Repo     │  commit/object/refs lokal
└───────┬────────┘
        │ git push / fetch
        v
┌────────────────┐
│ Remote Repo    │  repo lain: GitHub/GitLab/server
└────────────────┘
```

Part 002 akan membedah ini secara internal.

Untuk sekarang, pahami bahwa Git tidak langsung commit semua file yang diedit. Ada staging area sebagai boundary.

---

## 7.2 Kenapa Index/Staging Area Ada?

Staging area memungkinkan kita membentuk commit yang rapi.

Misal Anda mengubah tiga hal:

1. memperbaiki bug validasi payment,
2. rename method untuk clarity,
3. update README.

Di working tree, semuanya tercampur.

Dengan staging, Anda bisa membuat commit terpisah:

```text
Commit 1: Fix payment validation for duplicate request id
Commit 2: Rename PaymentPolicyEvaluator method for clarity
Commit 3: Document retry behavior in README
```

Tanpa staging, Git akan mendorong engineer membuat commit campur-aduk.

Staging area adalah alat untuk menyusun narasi perubahan.

---

# 8. Distributed Version Control: Setiap Clone adalah Repository

Git bersifat distributed.

Artinya, saat Anda melakukan:

```bash
git clone <url>
```

Anda tidak hanya mengambil working copy. Anda mendapatkan repository lokal dengan history dan object database sendiri.

Ini berbeda dari model centralized VCS klasik, di mana server pusat adalah sumber history utama dan client hanya checkout working copy.

---

## 8.1 Implikasi Distributed Model

Karena setiap clone adalah repository:

- commit bisa dibuat offline,
- branch lokal bisa dibuat tanpa server,
- history bisa dibaca lokal,
- diff bisa dihitung lokal,
- bisect bisa dilakukan lokal,
- rollback lokal bisa dilakukan cepat,
- remote bisa lebih dari satu,
- sinkronisasi adalah operasi eksplisit: fetch/pull/push.

Ini alasan Git sangat kuat untuk workflow modern.

Tetapi ada konsekuensi:

```text
Local state dan remote state bisa diverge.
```

Contoh:

```text
origin/main: A --- B --- C
local main : A --- B --- C --- D
```

Local punya commit D yang belum dipush.

Atau:

```text
origin/main: A --- B --- C --- E
local main : A --- B --- C --- D
```

Local dan remote sama-sama maju dengan commit berbeda.

Ini bukan error aneh. Ini kondisi normal dalam distributed system.

---

## 8.2 Git sebagai Distributed System Kecil

Sebagai Java engineer yang familiar dengan distributed systems, Git bisa dipahami seperti sistem replikasi state berbasis log historis.

Ada beberapa repository:

```text
Developer A repo
Developer B repo
CI repo
Origin repo
Fork repo
Release mirror repo
```

Masing-masing punya object dan refs.

Operasi sinkronisasi:

| Operasi | Makna distributed |
|---|---|
| `fetch` | Ambil object/ref dari remote ke local tracking refs |
| `pull` | Fetch lalu integrasikan ke branch aktif |
| `push` | Kirim commit/ref update ke remote |
| `merge` | Gabungkan dua line history |
| `rebase` | Replay perubahan lokal di atas base baru |

Git tidak menyembunyikan divergence. Git membuat divergence eksplisit.

Itu kekuatan sekaligus sumber kebingungan.

---

# 9. Git sebagai Commit Graph

Git history adalah graph, bukan list linear.

List linear sederhana:

```text
A --- B --- C --- D
```

Tetapi software nyata sering seperti ini:

```text
A --- B --- C -------- F --- G  main
      \              /
       D --- E ------        feature/payment
```

Atau lebih kompleks:

```text
A --- B --- C --- H -------- K  main
      \         \          /
       D --- E   I --- J --     feature/refactor
            \                
             F --- G           hotfix/v1.2
```

Graph ini merepresentasikan:

- urutan perubahan,
- percabangan kerja,
- titik integrasi,
- relasi parent,
- ancestry,
- reachability.

---

## 9.1 Kenapa Graph Penting?

Karena banyak pertanyaan Git adalah pertanyaan graph:

```text
Apakah commit X sudah termasuk dalam branch main?
Commit mana common ancestor antara feature dan main?
Apa saja commit di feature yang belum ada di main?
Apakah branch ini sudah merged?
Dari commit mana release branch dibuat?
Hotfix ini sudah masuk main atau hanya release branch?
```

Command seperti ini adalah operasi graph:

```bash
git merge-base main feature/foo
git branch --contains <commit>
git log main..feature/foo
git log --graph --oneline --decorate --all
git cherry main release/1.4
```

Kita akan membahas command tersebut nanti. Untuk sekarang, pahami bahwa Git adalah graph traversal engine.

---

## 9.2 Reachability

Commit disebut reachable jika ada reference yang bisa mencapai commit tersebut melalui rantai parent.

Misal:

```text
A --- B --- C --- D  main
```

Jika `main` menunjuk D, maka D, C, B, A reachable dari main.

Jika ada commit E:

```text
A --- B --- C --- D  main
      \
       E
```

Tetapi tidak ada branch/tag yang menunjuk E, maka E mungkin tidak reachable dari reference normal.

E belum tentu langsung hilang, tetapi ia rentan dibersihkan oleh garbage collection setelah masa tertentu jika tidak ada reference/reflog yang menjaganya.

Mental model:

```text
Nama/reference membuat commit mudah ditemukan dan dipertahankan.
Tanpa reference, commit bisa menjadi yatim secara navigasi.
```

---

# 10. Git State Transition Thinking

Git mastery bukan tentang menghafal command. Git mastery adalah kemampuan menjawab:

```text
State sekarang apa?
State target apa?
Object/ref/index/working tree mana yang akan berubah?
Apakah history ini private atau public?
Apakah operasi ini menambah commit, memindahkan pointer, atau mengubah working tree?
Apa recovery plan jika salah?
```

---

## 10.1 Contoh: `git commit`

Command:

```bash
git commit -m "Add duplicate payment validation"
```

Pertanyaan mental:

```text
Apa state sekarang?
- Working tree punya perubahan.
- Index berisi subset perubahan yang ingin dicommit.
- HEAD menunjuk branch aktif.

Apa state target?
- Buat commit baru dari isi index.
- Parent commit baru adalah commit HEAD saat ini.
- Branch aktif maju menunjuk commit baru.
- Working tree tetap berisi file yang sama.
```

Graph sebelum:

```text
A --- B  main, HEAD
```

Graph sesudah:

```text
A --- B --- C  main, HEAD
```

---

## 10.2 Contoh: `git switch -c feature/foo`

Command:

```bash
git switch -c feature/foo
```

Pertanyaan mental:

```text
Apa state sekarang?
- HEAD menunjuk branch main di commit B.

Apa state target?
- Buat branch baru feature/foo yang menunjuk commit B.
- HEAD pindah ke branch feature/foo.
- Working tree tidak berubah.
```

Graph:

```text
A --- B
      ^
      main
      feature/foo
      HEAD -> feature/foo
```

Tidak ada snapshot baru. Tidak ada commit baru. Hanya reference baru.

---

## 10.3 Contoh: `git merge feature/foo`

Command:

```bash
git merge feature/foo
```

Pertanyaan mental:

```text
Apa state sekarang?
- HEAD berada di main.
- feature/foo menunjuk commit lain.

Apa state target?
- Integrasikan snapshot/history feature/foo ke main.
- Jika fast-forward mungkin hanya main pointer maju.
- Jika histories diverged, buat merge commit dengan dua parent.
```

Merge bukan sekadar “copy file dari feature”. Merge adalah operasi graph + content reconciliation.

---

## 10.4 Contoh: `git rebase main`

Command:

```bash
git rebase main
```

Pertanyaan mental:

```text
Apa state sekarang?
- HEAD ada di feature branch.
- Feature punya commit D dan E di atas base lama B.
- Main sudah maju ke C.

Apa state target?
- Ambil perubahan D dan E.
- Replay di atas C.
- Buat commit baru D' dan E'.
- Pindahkan feature branch ke E'.
```

Sebelum:

```text
A --- B --- C  main
      \
       D --- E  feature
```

Sesudah:

```text
A --- B --- C  main
              \
               D' --- E'  feature
```

Rebase membuat commit baru. Itu mengapa rewrite public history berbahaya.

---

# 11. Git dalam Konteks Java Software Engineering

Sebagai Java engineer, Git bukan hanya untuk `.java` file.

Repository Java biasanya mencakup:

```text
src/main/java/...
src/test/java/...
pom.xml atau build.gradle
application.yml
Dockerfile
schema migration
OpenAPI spec
protobuf schema
CI config
Helm chart/Kubernetes manifest
README/design doc
```

Setiap perubahan bisa berdampak ke runtime behavior.

---

## 11.1 Commit Boundary untuk Java

Contoh perubahan yang sebaiknya dipisah:

1. Refactor nama method tanpa behavior change.
2. Tambah validation rule baru.
3. Update test untuk validation rule.
4. Update error code mapping.
5. Update API documentation.

Kadang 2 dan 3 harus satu commit karena test menjelaskan behavior baru. Tetapi refactor murni sebaiknya dipisahkan agar review jelas.

Bad commit:

```text
Update payment service
```

Isi:

- rename class,
- ubah transaction propagation,
- update dependency,
- tambah migration,
- ubah error response,
- fix flaky test.

Masalah:

- review sulit,
- rollback sulit,
- bisect bisa menemukan commit besar tanpa pinpoint,
- conflict resolution lebih rawan,
- intent kabur.

Better history:

```text
1. Rename PaymentAuthorizer to PaymentAuthorizationService
2. Add idempotency lookup before payment authorization
3. Persist duplicate payment attempts for audit trail
4. Map duplicate payment request to 409 response
5. Add integration tests for duplicate payment retries
```

Ini bukan sekadar estetika. Ini meningkatkan operability.

---

## 11.2 Git dan Build Reproducibility

Java build sering bergantung pada:

- Maven/Gradle version,
- dependency version,
- plugin version,
- generated source,
- annotation processor,
- JDK version,
- environment variable,
- repository artifact internal.

Git commit seharusnya cukup untuk menjawab:

```text
Source code apa yang dipakai untuk build artifact ini?
```

Tetapi untuk reproducibility penuh, commit perlu didukung oleh:

- dependency lock/version policy,
- build script yang deterministic,
- CI metadata,
- artifact repository,
- tag release,
- container image digest,
- configuration management.

Git adalah anchor, bukan seluruh jawaban.

---

## 11.3 Git dan CI/CD

CI/CD biasanya dipicu oleh Git event:

```text
push to branch
pull request opened
pull request updated
tag created
release branch updated
```

Artinya, Git history bukan hanya catatan pasif. Ia memicu automation.

Contoh:

```text
push feature branch -> run unit tests
open PR -> run integration tests + static analysis
merge main -> build snapshot artifact
tag v2.3.0 -> build release artifact + deploy staging
approve deployment -> deploy production artifact
```

Jika Git workflow buruk, CI/CD juga menjadi rapuh.

---

## 11.4 Git dan Regulatory/Compliance Context

Dalam sistem yang butuh defensibility, Git membantu menyediakan evidence:

- perubahan dibuat di commit tertentu,
- commit direview dalam PR tertentu,
- CI check lulus,
- release tag dibuat,
- artifact dibangun dari commit/tag tersebut,
- deployment mengarah ke artifact itu,
- rollback/hotfix punya trace.

Tetapi Git hanya berguna jika workflow konsisten.

History yang penuh commit `fix`, force push sembarangan, tag tidak konsisten, dan branch release kacau akan melemahkan auditability.

---

# 12. Model Operasional: Dari Ide ke Production

Mari lihat Git dalam alur kerja nyata.

Skenario: menambahkan validasi duplicate payment request.

---

## 12.1 Tanpa Git Mental Model

Engineer menjalankan:

```bash
git pull
git checkout -b fix-payment
git add .
git commit -m "fix"
git push
```

Lalu membuat PR.

Masalah:

- tidak jelas fix apa,
- mungkin commit berisi file tidak relevan,
- branch name terlalu umum,
- tidak jelas apakah perubahan atomic,
- reviewer harus menebak intent,
- audit sulit,
- revert sulit.

---

## 12.2 Dengan Git Mental Model

Engineer berpikir:

```text
Problem:
Duplicate request id bisa memicu authorization ganda.

State target:
Sistem harus reject duplicate request id sebelum downstream authorization.

Commit boundary:
1. Tambah repository lookup by request id.
2. Tambah service validation before authorization.
3. Tambah API error mapping 409.
4. Tambah integration test retry scenario.

Branch:
feature/payment-idempotency-validation

PR intent:
Prevent duplicate downstream payment authorization during client retry.
```

Commit history:

```text
A --- B --- C  main
             \
              D --- E --- F --- G  feature/payment-idempotency-validation
```

Setiap commit punya intent.

Reviewer bisa melihat perubahan sebagai narasi.

Jika bug muncul di error mapping, commit F bisa direvert/cherry-pick lebih mudah.

---

# 13. Git Bukan Pengganti Engineering Discipline

Git kuat, tetapi tidak otomatis membuat workflow baik.

Git bisa menyimpan history buruk dengan sangat akurat.

Contoh history buruk:

```text
fix
fix again
wip
temp
asdf
revert revert temp
final fix
merge branch main into main
```

Git tetap bekerja, tetapi manusia kesulitan.

Git mastery berarti menggabungkan:

- technical correctness,
- readable history,
- team coordination,
- operational safety,
- auditability,
- recovery awareness.

---

# 14. Perbedaan “Tahu Command” vs “Menguasai Git”

Engineer yang hanya tahu command akan bertanya:

```text
Command apa untuk membatalkan commit?
```

Engineer yang menguasai Git akan bertanya:

```text
Commit sudah dipush atau belum?
Ingin menghapus commit dari history atau membuat commit pembalik?
Branch dipakai sendiri atau bersama?
Apakah perlu preserve audit trail?
Apakah commit mengandung secret?
Apakah ada tag/release yang sudah menunjuk commit itu?
```

Jawaban bisa berbeda:

| Situasi | Operasi yang mungkin tepat |
|---|---|
| Commit lokal belum dipush, ingin edit | `git commit --amend` atau `git reset` |
| Commit lokal belum dipush, ingin buang | `git reset` |
| Commit sudah public, ingin undo change | `git revert` |
| Commit mengandung secret | rotate secret + history cleanup + force coordination |
| Commit sudah masuk release tag | patch/revert/hotfix dengan traceability |

Inilah perbedaan antara command knowledge dan operational judgement.

---

# 15. Lima Invariant Awal Git

Simpan lima invariant ini. Kita akan menggunakannya di seluruh series.

---

## Invariant 1 — Commit Hampir Selalu Immutable

Commit yang sudah dibuat tidak diedit in-place.

Saat amend/rebase/squash, Git biasanya membuat commit baru dengan object id baru.

Implikasi:

```text
Rewrite history bukan mengubah commit lama.
Rewrite history membuat commit baru dan memindahkan reference.
```

---

## Invariant 2 — Branch adalah Pointer Bergerak

Branch bukan folder.

Branch adalah nama yang menunjuk ke commit.

Saat commit baru dibuat di branch aktif, branch pointer maju.

---

## Invariant 3 — HEAD Menentukan Posisi Operasi

Banyak command bergantung pada posisi HEAD.

Sebelum menjalankan command berisiko, cek:

```bash
git status
git branch --show-current
git log --oneline --decorate -5
```

---

## Invariant 4 — Index adalah Kandidat Commit Berikutnya

Working tree bisa berisi banyak perubahan. Index menentukan apa yang akan masuk commit berikutnya.

`git add` bukan “simpan ke Git”. Lebih tepat:

```text
Masukkan versi perubahan ini ke staging area sebagai kandidat snapshot commit berikutnya.
```

---

## Invariant 5 — Remote adalah Repo Lain, Bukan Kebenaran Mistis

`origin` hanyalah nama remote default.

Remote punya refs sendiri. Local punya refs sendiri. Sinkronisasi eksplisit lewat fetch/push.

Banyak kebingungan `pull`, `push rejected`, dan divergence berasal dari tidak memahami ini.

---

# 16. Peta Konsep Awal

```text
Software evolves through changes.
Git stores that evolution as snapshots.
Snapshots are represented by commits.
Commits form a graph through parent links.
Branches are names pointing to graph tips.
HEAD tells Git where you are.
The index prepares the next snapshot.
The working tree is where you edit files.
Remotes are other repositories that exchange commits and refs.
```

Versi pendek:

```text
Git = snapshots + graph + pointers + working area + synchronization.
```

---

# 17. Latihan Mental Model

Bagian ini bisa dilakukan tanpa command, hanya dengan prediksi state.

---

## Latihan 1 — Branch Pointer

Awal:

```text
A --- B --- C  main, HEAD
```

Anda menjalankan:

```bash
git switch -c feature/x
```

Pertanyaan:

1. Apakah commit baru dibuat?
2. Apakah working tree berubah?
3. Ke mana `main` menunjuk?
4. Ke mana `feature/x` menunjuk?
5. HEAD menunjuk ke mana?

Jawaban:

1. Tidak.
2. Tidak.
3. Tetap C.
4. C.
5. Branch `feature/x`.

---

## Latihan 2 — Commit di Branch Baru

State:

```text
A --- B --- C
            ^
            main
            feature/x, HEAD
```

Anda membuat commit D.

Pertanyaan:

1. Branch mana yang maju?
2. Apakah `main` ikut maju?
3. Parent D siapa?

Jawaban:

1. `feature/x`.
2. Tidak.
3. C.

Graph:

```text
A --- B --- C  main
             \
              D  feature/x, HEAD
```

---

## Latihan 3 — Detached HEAD

State:

```text
A --- B --- C --- D  main, HEAD
```

Anda menjalankan:

```bash
git switch --detach B
```

Pertanyaan:

1. Apakah `main` pindah?
2. HEAD menunjuk ke apa?
3. Jika commit baru dibuat, branch mana yang maju?

Jawaban:

1. Tidak.
2. Langsung ke commit B.
3. Tidak ada branch yang maju, kecuali Anda membuat branch baru.

---

## Latihan 4 — Snapshot vs Diff

Commit A:

```text
UserService.java      v1
UserRepository.java   v1
pom.xml               v1
```

Commit B:

```text
UserService.java      v2
UserRepository.java   v1
pom.xml               v1
```

Pertanyaan:

1. Apakah commit B hanya menyimpan diff UserService?
2. Secara konseptual, B merepresentasikan apa?
3. Kenapa Git bisa tetap efisien?

Jawaban:

1. Git tidak paling tepat dipahami seperti itu.
2. B merepresentasikan snapshot project pada state B.
3. Content yang tidak berubah bisa direuse sebagai object yang sama.

---

# 18. Praktik Mini: Membuat Graph Pertama

Part ini belum fokus command, tetapi latihan kecil berikut membantu mengikat mental model.

Buat folder latihan:

```bash
mkdir git-mental-model-lab
cd git-mental-model-lab
git init
```

Buat file:

```bash
echo "version=1" > app.properties
git add app.properties
git commit -m "Initialize application properties"
```

Buat branch:

```bash
git switch -c feature/change-timeout
```

Ubah file:

```bash
echo "timeout.ms=3000" >> app.properties
git add app.properties
git commit -m "Configure default request timeout"
```

Lihat graph:

```bash
git log --oneline --graph --decorate --all
```

Kembali ke main:

```bash
git switch main
```

Ubah file berbeda:

```bash
echo "retries=3" >> app.properties
git add app.properties
git commit -m "Configure default retry count"
```

Lihat graph:

```bash
git log --oneline --graph --decorate --all
```

Anda akan melihat divergence.

Mungkin bentuknya seperti:

```text
* abc123 Configure default retry count (HEAD -> main)
| * def456 Configure default request timeout (feature/change-timeout)
|/
* 789abc Initialize application properties
```

Artinya:

- `main` punya commit retry count,
- feature punya commit timeout,
- keduanya berasal dari commit awal yang sama.

Ini inti Git branching.

---

# 19. Common Misconceptions

## Misconception 1 — “Git menyimpan file versi lama”

Lebih tepat:

```text
Git menyimpan object dan snapshot project yang saling terhubung oleh commit graph.
```

---

## Misconception 2 — “Branch adalah copy project”

Lebih tepat:

```text
Branch adalah reference bernama ke commit tertentu.
```

---

## Misconception 3 — “Commit message tidak terlalu penting”

Lebih tepat:

```text
Commit message adalah metadata intent. Tanpa intent, history hanya perubahan mekanis.
```

---

## Misconception 4 — “Pull selalu aman”

Lebih tepat:

```text
Pull adalah fetch + integrasi. Integrasi bisa merge atau rebase. Dampaknya tergantung state graph lokal dan remote.
```

---

## Misconception 5 — “Kalau Git tidak conflict berarti aman”

Lebih tepat:

```text
Git hanya mendeteksi conflict tekstual/struktural tertentu. Semantic conflict tetap tanggung jawab engineer.
```

Contoh semantic conflict Java:

- satu branch mengubah meaning field `status`, branch lain menambah logic yang masih memakai asumsi lama,
- satu branch mengubah default timeout, branch lain menambah retry policy yang membuat total wait terlalu panjang,
- satu branch mengubah transaction boundary, branch lain menambah event publishing yang sekarang terjadi dalam transaction berbeda.

Git tidak bisa sepenuhnya memahami domain behavior.

---

# 20. Pertanyaan Reflektif

Gunakan pertanyaan ini sebelum lanjut ke Part 002.

1. Apa perbedaan Git sebagai backup folder dan Git sebagai object database?
2. Mengapa snapshot model lebih kuat daripada diff-only mental model?
3. Mengapa branch di Git murah secara teknis?
4. Mengapa branch panjang tetap mahal secara organisasi?
5. Apa perbedaan HEAD menunjuk branch dan detached HEAD?
6. Mengapa staging area membantu membuat commit berkualitas?
7. Kenapa Git sangat berguna untuk debugging regression?
8. Kenapa Git tidak bisa menggantikan code review dan test?
9. Apa risiko commit message yang buruk untuk audit dan maintenance?
10. Apa maksud “Git mastery adalah state transition thinking”?

---

# 21. Checklist Pemahaman

Sebelum lanjut, pastikan Anda bisa menjelaskan tanpa melihat catatan:

- [ ] Git menyimpan evolusi software, bukan sekadar backup file.
- [ ] Commit merepresentasikan snapshot project plus metadata dan parent link.
- [ ] Commit membentuk graph.
- [ ] Branch adalah pointer ke commit.
- [ ] HEAD menunjukkan posisi kerja saat ini.
- [ ] Detached HEAD berarti HEAD menunjuk langsung ke commit, bukan branch.
- [ ] Working tree adalah file yang diedit.
- [ ] Index/staging area adalah kandidat commit berikutnya.
- [ ] Local repository berbeda dari remote repository.
- [ ] Fetch/push adalah sinkronisasi antar repository.
- [ ] Merge dan rebase adalah cara berbeda mengintegrasikan history.
- [ ] Commit yang baik punya intent dan boundary jelas.

---

# 22. Ringkasan Eksekutif

Git adalah sistem untuk merepresentasikan perubahan software sebagai graph snapshot yang bisa disinkronkan antar repository.

Mental model paling penting:

```text
Git = object database + commit graph + references + index + working tree + remotes.
```

Commit bukan sekadar save point. Commit adalah unit evolusi.

Branch bukan folder. Branch adalah pointer.

HEAD bukan magic. HEAD adalah posisi kerja.

Diff bukan inti utama. Diff adalah hasil membandingkan snapshot.

Remote bukan cloud ajaib. Remote adalah repository lain.

Git command bukan skill utama. Skill utama adalah memahami transisi state:

```text
sebelum command: state apa?
setelah command: state apa?
apa yang berubah?
apa yang tidak berubah?
apakah aman untuk history public?
bagaimana recovery jika salah?
```

Itulah fondasi untuk seluruh series.

---

# 23. Apa yang Akan Dibahas di Part 002

Part berikutnya:

```text
learn-git-mastery-for-java-engineers-part-002.md
```

Topik:

```text
Repository, Working Tree, Index, dan Object Database
```

Kita akan membedah lebih dalam:

- apa yang terjadi saat `git init`,
- struktur `.git`,
- working tree,
- index,
- object database,
- blob,
- tree,
- commit,
- tag,
- bagaimana file berubah menjadi object,
- bagaimana commit menunjuk snapshot,
- kenapa SHA/object id penting.

---

# Status Series

```text
Part 001 selesai.
Seri belum selesai.
Progress: 001 / 032.
Bagian terakhir yang direncanakan: Part 032 — Capstone: Mendesain Git Workflow untuk Java Engineering Team.
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-git-mastery-for-java-engineers-part-000.md](./learn-git-mastery-for-java-engineers-part-000.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-git-mastery-for-java-engineers-part-002.md](./learn-git-mastery-for-java-engineers-part-002.md)

</div>
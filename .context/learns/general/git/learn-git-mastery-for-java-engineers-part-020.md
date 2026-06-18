# learn-git-mastery-for-java-engineers-part-020.md

# Part 020 — Blame, Pickaxe, dan Forensic Code Archaeology

> **Seri:** Git Mastery for Java Engineers  
> **Bagian:** 020 / 032  
> **Topik:** Menelusuri asal-usul kode, perubahan simbol, dan alasan historis dengan `git blame`, pickaxe, log, show, dan grep  
> **Target pembaca:** Java software engineer yang ingin mampu melakukan investigasi historis pada legacy code, regression, incident, dan perubahan arsitektur  
> **Status seri:** Belum selesai. Bagian terakhir adalah `learn-git-mastery-for-java-engineers-part-032.md`.

---

## 0. Ringkasan Eksekutif

Pada part sebelumnya, kita membahas `git bisect`.

`bisect` menjawab pertanyaan:

```text
Commit mana yang pertama kali membuat behavior berubah?
```

Part ini membahas toolkit forensic lain:

```text
git blame
git log -S
git log -G
git log --follow
git show
git grep
git diff
```

Tool-tool ini membantu menjawab pertanyaan berbeda:

```text
Kapan baris ini berubah?
Commit mana yang memperkenalkan simbol ini?
Kenapa method ini sekarang punya kondisi aneh?
Apakah field ini pernah bernama lain?
Kapan rule bisnis ini masuk?
Apakah perubahan ini berasal dari refactor, bugfix, incident, atau requirement?
Siapa reviewer-nya?
PR/issue mana yang menjelaskan konteks?
```

Istilah penting:

```text
Code archaeology = investigasi sejarah kode untuk memahami alasan, konteks, dan konsekuensi perubahan.
```

Skill ini penting untuk Java engineer karena sistem Java enterprise sering hidup lama:

- domain model berubah bertahun-tahun;
- rule bisnis bertumpuk;
- migration database meninggalkan jejak;
- legacy code penuh conditional;
- shared library dipakai banyak service;
- behavior production tidak lagi jelas dari kode saat ini saja;
- commit message/PR/issue menjadi bagian dari knowledge base;
- auditability dibutuhkan untuk incident dan regulated systems.

Namun ada satu prinsip budaya yang harus jelas sejak awal:

```text
git blame bukan alat untuk menyalahkan orang.
git blame adalah alat untuk menemukan konteks.
```

Engineer junior memakai blame untuk mencari “siapa”.
Engineer senior memakai blame untuk mencari “kenapa”.

---

## 1. Masalah yang Diselesaikan oleh Code Archaeology

Bayangkan Anda melihat kode ini:

```java
if (caseRecord.hasPendingDocumentReview() && !actor.hasRole(SUPERVISOR)) {
    return TransitionDecision.blocked("PENDING_DOCUMENT_REVIEW");
}
```

Pertanyaan natural:

```text
Kenapa pending document review hanya memblokir non-supervisor?
Apakah ini requirement?
Apakah ini hotfix?
Apakah sebelumnya semua actor diblokir?
Apakah kondisi ini aman untuk escalation?
Apakah ada incident yang melatarbelakangi?
```

Membaca kode saat ini saja tidak cukup.

Anda perlu sejarah.

Beberapa pertanyaan yang ingin dijawab:

```text
1. Commit apa yang terakhir mengubah baris ini?
2. Apakah commit itu bagian dari PR tertentu?
3. Commit message-nya menjelaskan apa?
4. Apakah ada issue/ticket referensi?
5. Apakah baris ini dipindah dari class lain?
6. Apakah nama method berubah?
7. Apakah constant ini pernah punya value berbeda?
8. Apakah logic ini hasil revert?
9. Apakah ada merge conflict yang pernah terjadi di sini?
10. Apakah perubahan terkait test ikut ditambahkan?
```

Git menyediakan data mentahnya.

Tugas engineer adalah membaca data itu dengan benar.

---

## 2. Perbedaan Bisect, Blame, dan Pickaxe

| Tool | Pertanyaan Utama | Output |
|---|---|---|
| `git bisect` | Commit mana yang pertama membuat predicate berubah? | First bad commit |
| `git blame` | Commit mana yang terakhir mengubah setiap baris file? | Line-to-commit mapping |
| `git log -S` | Commit mana yang mengubah jumlah kemunculan string tertentu? | Commit yang menambah/menghapus symbol/string |
| `git log -G` | Commit mana yang diff-nya cocok regex tertentu? | Commit dengan patch matching regex |
| `git log --follow` | Bagaimana sejarah file melewati rename? | Commit history lintas rename |
| `git grep` | Di state saat ini atau commit tertentu, string/symbol muncul di mana? | Location match |
| `git show` | Apa isi detail commit tertentu? | Metadata + diff |
| `git diff` | Apa perbedaan dua state? | Patch/snapshot delta |

Jangan pakai satu tool untuk semua hal.

Contoh:

- Jika behavior regression tidak jelas commitnya, gunakan `bisect`.
- Jika ingin tahu kapan baris terakhir diubah, gunakan `blame`.
- Jika ingin tahu kapan constant `PENDING_DOCUMENT_REVIEW` diperkenalkan, gunakan `log -S`.
- Jika ingin tahu kapan pattern validasi berubah, gunakan `log -G`.
- Jika file pernah rename, tambahkan `--follow`.
- Jika ingin tahu lokasi semua pemakaian saat ini, gunakan `grep` atau IDE.

---

## 3. `git blame`: Mental Model

`git blame` menampilkan untuk setiap line dalam file:

```text
commit SHA
author
date
line number
line content
```

Contoh:

```bash
git blame src/main/java/com/acme/caseflow/CaseTransitionPolicy.java
```

Output kira-kira:

```text
a13f9e2c (Rina 2026-02-14 120) if (caseRecord.hasPendingDocumentReview()) {
b21d7c90 (Dimas 2026-03-03 121)     return blocked("PENDING_DOCUMENT_REVIEW");
a13f9e2c (Rina 2026-02-14 122) }
```

Artinya:

- line 120 terakhir diubah oleh commit `a13f9e2c`;
- line 121 terakhir diubah oleh commit `b21d7c90`;
- line 122 terakhir diubah oleh commit `a13f9e2c`.

Tetapi “terakhir diubah” bukan berarti “menciptakan ide”.

Sebuah line bisa berubah karena:

- format;
- rename variable;
- move method;
- refactor;
- import cleanup;
- indentation;
- mass migration;
- mechanical rewrite;
- code generation;
- conflict resolution;
- actual behavior change.

`git blame` adalah pintu masuk, bukan kesimpulan.

---

## 4. Menggunakan `git blame` dengan Benar

Format dasar:

```bash
git blame <file>
```

Contoh:

```bash
git blame src/main/java/com/acme/caseflow/CaseTransitionPolicy.java
```

Batasi range line:

```bash
git blame -L 110,150 src/main/java/com/acme/caseflow/CaseTransitionPolicy.java
```

Cari berdasarkan function/method name jika didukung oleh regex:

```bash
git blame -L '/boolean canEscalate/',/^}/ src/main/java/com/acme/caseflow/CaseTransitionPolicy.java
```

Lebih umum untuk Java, gunakan line range dari IDE atau `nl`:

```bash
nl -ba src/main/java/com/acme/caseflow/CaseTransitionPolicy.java | sed -n '110,150p'
git blame -L 110,150 src/main/java/com/acme/caseflow/CaseTransitionPolicy.java
```

Lihat commit detail:

```bash
git show <sha>
```

Lihat hanya statistik:

```bash
git show --stat <sha>
```

Lihat commit message saja:

```bash
git show --no-patch --format=fuller <sha>
```

Flow dasar:

```text
1. Blame line.
2. Ambil SHA.
3. Show commit.
4. Baca diff dan message.
5. Cari PR/issue.
6. Jika commit hanya refactor, blame parent atau gunakan ignore revisions.
```

---

## 5. Blame Bukan Alat Menyalahkan Orang

Nama command `blame` buruk secara budaya.

Interpretasi yang salah:

```text
Line ini author-nya Budi.
Berarti Budi salah.
```

Interpretasi yang benar:

```text
Commit ini terakhir mengubah line ini.
Kita perlu memahami konteks perubahan tersebut.
```

Mengapa blame tidak boleh dipakai sebagai “pengadilan”?

- author bisa hanya menjalankan refactor;
- reviewer dan approver juga bagian dari keputusan;
- requirement mungkin datang dari product/legal/ops;
- commit bisa hasil pair programming;
- commit bisa hasil conflict resolution;
- line bisa dipindahkan dari tempat lain;
- perubahan bisa benar pada saat itu tetapi konteks berubah;
- bug bisa latent dan baru muncul setelah perubahan lain;
- sistem adalah hasil keputusan kolektif.

Gunakan bahasa:

```text
Commit ini memperkenalkan perubahan X.
Apa konteksnya?
```

Hindari bahasa:

```text
Siapa yang bikin bug ini?
```

Untuk tim yang matang, code archaeology meningkatkan learning, bukan fear.

---

## 6. Blame dengan Whitespace Ignore

Kadang line terlihat berubah karena formatting.

Contoh:

```java
if(condition){
```

menjadi:

```java
if (condition) {
```

Secara behavior sama.

Gunakan:

```bash
git blame -w <file>
```

`-w` mengabaikan perubahan whitespace saat melakukan blame.

Contoh:

```bash
git blame -w -L 110,150 src/main/java/com/acme/caseflow/CaseTransitionPolicy.java
```

Kapan berguna:

- reformat massal;
- import ordering;
- indentation;
- line wrapping;
- migration formatter;
- Java code style enforcement;
- Spotless/google-java-format adoption.

Namun hati-hati.

Whitespace kadang meaningful pada:

- YAML;
- Makefile;
- Python;
- Markdown tables;
- shell heredoc;
- text fixtures;
- SQL formatting tertentu jika string literal berubah.

Untuk Java source, `-w` sering aman.

---

## 7. Blame dengan Move/Copy Detection

Git blame bisa mencoba mendeteksi line yang dipindah atau disalin.

Opsi:

```bash
git blame -M <file>
```

Mendeteksi moved/copied lines dalam file yang sama.

```bash
git blame -C <file>
```

Mendeteksi copied lines dari file lain juga. Bisa dipakai beberapa kali:

```bash
git blame -C -C -C <file>
```

Contoh:

```bash
git blame -w -M -C -L 80,140 src/main/java/com/acme/caseflow/CaseTransitionPolicy.java
```

Kapan berguna:

- method dipindah ke class lain;
- utility diekstrak;
- package rename;
- monolith-to-module refactor;
- service split;
- DTO dipindah;
- validator disalin dari legacy implementation.

Kelemahan:

- lebih lambat;
- heuristic, bukan bukti absolut;
- bisa salah jika banyak code mirip;
- tidak selalu mengikuti rename kompleks.

Gunakan sebagai petunjuk investigasi.

---

## 8. Ignore Revisions: Mengabaikan Commit Reformat Massal

Masalah umum:

```text
Tim menjalankan google-java-format di seluruh repo.
Setelah itu git blame semua baris menunjuk ke commit formatting.
```

Solusi: ignore revisions.

Buat file:

```text
.git-blame-ignore-revs
```

Isi dengan SHA commit yang hanya mechanical formatting:

```text
# Apply google-java-format to entire repository
a1b2c3d4e5f678901234567890abcdef12345678

# Normalize imports
b2c3d4e5f678901234567890abcdef1234567890
```

Gunakan:

```bash
git blame --ignore-revs-file .git-blame-ignore-revs <file>
```

Atau konfigurasi:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

Untuk repo tim, commit file ini agar semua orang bisa memakai aturan sama.

Kriteria commit yang boleh masuk ignore file:

```text
[ ] Perubahan mechanical.
[ ] Tidak mengubah behavior.
[ ] Bisa dijelaskan sebagai formatting/import/restructure.
[ ] Sudah direview sebagai non-functional.
[ ] Tidak mencampur logic change.
```

Anti-pattern:

```text
Memasukkan commit besar yang sebenarnya juga mengubah logic.
```

Jika commit formatting mencampur logic change, blame ignore menjadi berbahaya.

Pelajaran:

```text
Pisahkan mechanical refactor dari behavior change.
```

---

## 9. `git log -S`: Pickaxe untuk Mencari Perubahan Jumlah String

`git log -S` sering disebut pickaxe.

Format:

```bash
git log -S'<string>'
```

Ia mencari commit yang mengubah jumlah occurrence string tersebut dalam file.

Contoh:

```bash
git log -S'PENDING_DOCUMENT_REVIEW' --oneline
```

Artinya:

```text
Tampilkan commit yang menambah atau menghapus occurrence string PENDING_DOCUMENT_REVIEW.
```

Contoh lain:

```bash
git log -S'canEscalate' -- src/main/java
```

```bash
git log -S'EscalationPolicy' -- src/main/java
```

```bash
git log -S'CASE_ESCALATED' -- .
```

Kapan `-S` kuat:

- mencari kapan constant diperkenalkan;
- mencari kapan method/class pertama muncul;
- mencari kapan field JSON ditambahkan/dihapus;
- mencari kapan enum value berubah;
- mencari kapan SQL column name muncul;
- mencari kapan feature flag diperkenalkan.

Contoh Java:

```bash
git log -S'UNDER_REVIEW' -- src/main/java src/test/java
```

Lihat patch:

```bash
git log -S'UNDER_REVIEW' -p -- src/main/java
```

Batasi output:

```bash
git log -S'UNDER_REVIEW' --oneline --decorate -- src/main/java
```

---

## 10. `git log -S` Tidak Sama dengan Search Biasa

`git grep` mencari di state tertentu.

```bash
git grep 'PENDING_DOCUMENT_REVIEW'
```

Ini menjawab:

```text
Di state saat ini, string ini ada di mana?
```

`git log -S` mencari perubahan jumlah kemunculan dalam history.

```bash
git log -S'PENDING_DOCUMENT_REVIEW'
```

Ini menjawab:

```text
Commit mana yang menambah/menghapus string ini?
```

Perbedaan:

```text
git grep = where is it now?
git log -S = when did it enter/leave history?
```

Contoh:

Jika string dipindahkan dari file A ke file B dalam satu commit, jumlah occurrence total mungkin tetap sama.

`git log -S` bisa tidak menangkapnya karena count tidak berubah.

Untuk kasus pattern moved/modified, gunakan `-G`.

---

## 11. `git log -G`: Pickaxe Regex pada Patch

Format:

```bash
git log -G'<regex>'
```

Ia mencari commit yang patch-nya memiliki added/removed lines yang cocok regex.

Contoh:

```bash
git log -G'hasPendingDocumentReview' -p -- src/main/java
```

Atau:

```bash
git log -G'if \(.*canEscalate' -p -- src/main/java
```

`-G` lebih cocok ketika:

- string tetap ada tetapi line berubah;
- method dipindah;
- condition diubah;
- operator berubah;
- regex lebih fleksibel;
- Anda mencari pattern, bukan exact string count.

Contoh:

```bash
git log -G'ESCALATED|UNDER_REVIEW' -p -- src/main/java
```

Contoh mencari perubahan annotation:

```bash
git log -G'@Transactional' -p -- src/main/java
```

Contoh mencari perubahan security rule:

```bash
git log -G'hasRole|PreAuthorize|Secured' -p -- src/main/java
```

Contoh mencari perubahan JSON behavior:

```bash
git log -G'JsonProperty|JsonIgnore|ObjectMapper|JsonInclude' -p -- src/main/java
```

---

## 12. `-S` vs `-G`: Decision Rule

| Tujuan | Gunakan |
|---|---|
| Kapan constant/method/class pertama muncul | `git log -S'Name'` |
| Kapan string dihapus | `git log -S'Name'` |
| Kapan condition tertentu berubah | `git log -G'regex'` |
| Kapan annotation berubah | `git log -G'@Annotation'` |
| Kapan line dengan pattern berubah | `git log -G'pattern'` |
| Kapan symbol dipindahkan tanpa mengubah jumlah total | `git log -G` atau blame `-M/-C` |
| Mencari lokasi saat ini | `git grep` atau IDE |
| Mencari commit terakhir yang mengubah baris | `git blame` |
| Mencari commit yang membuat test gagal | `git bisect` |

Rule sederhana:

```text
-S untuk “kapan string ini masuk/keluar?”
-G untuk “kapan patch yang menyentuh pattern ini terjadi?”
```

---

## 13. Mengikuti Rename File dengan `--follow`

Jika file pernah rename:

```bash
git log --follow -- src/main/java/com/acme/caseflow/CaseTransitionPolicy.java
```

Dengan patch:

```bash
git log --follow -p -- src/main/java/com/acme/caseflow/CaseTransitionPolicy.java
```

Tanpa `--follow`, history bisa berhenti di commit rename.

Kapan berguna:

- package rename;
- class rename;
- module extraction;
- migration dari `service` ke `domain`;
- monolith refactor;
- file dipindah dari `core` ke `workflow`.

Kelemahan:

- `--follow` bekerja satu path;
- rename detection heuristic;
- tidak selalu sempurna untuk split/merge file;
- tidak mengikuti banyak file sekaligus dengan baik.

Untuk Java, rename sering terjadi karena:

```text
src/main/java/com/old/package/Foo.java
src/main/java/com/new/package/Foo.java
```

Git rename detection berdasarkan similarity content, bukan Java semantics.

Jika file dipecah menjadi beberapa class, `--follow` mungkin tidak cukup. Gunakan pickaxe dan blame `-C`.

---

## 14. `git grep`: Search pada Snapshot Git

`git grep` mencari pattern dalam tracked files.

```bash
git grep 'CaseEscalationPolicy'
```

Dengan line number:

```bash
git grep -n 'CaseEscalationPolicy'
```

Case insensitive:

```bash
git grep -i 'escalation'
```

Regex:

```bash
git grep -n -E 'ESCALATED|UNDER_REVIEW'
```

Cari di commit tertentu:

```bash
git grep -n 'PENDING_DOCUMENT_REVIEW' v1.12.0
```

Cari di branch lain:

```bash
git grep -n 'PENDING_DOCUMENT_REVIEW' release/2.8
```

Cari hanya Java:

```bash
git grep -n 'PENDING_DOCUMENT_REVIEW' -- '*.java'
```

Kapan `git grep` lebih baik daripada IDE?

- mencari di commit/tag lama tanpa checkout;
- mencari di branch lain;
- scripting;
- forensic cepat;
- mencari di CI/debug shell;
- memastikan symbol ada/tidak ada di release tag.

Contoh:

```bash
git grep -n 'ObjectMapper' v2.8.0 -- src/main/java
git grep -n 'ObjectMapper' HEAD -- src/main/java
```

---

## 15. Membaca Commit dengan `git show`

Setelah menemukan SHA dari blame/pickaxe:

```bash
git show <sha>
```

Gunakan variasi:

```bash
git show --stat <sha>
git show --name-only <sha>
git show --name-status <sha>
git show --summary <sha>
git show --format=fuller <sha>
```

Untuk commit besar:

```bash
git show --stat <sha>
git show <sha> -- src/main/java/com/acme/caseflow
```

Untuk melihat parent:

```bash
git show --pretty=raw --no-patch <sha>
```

Untuk merge commit:

```bash
git show --cc <merge-sha>
git show -m <merge-sha>
```

Pertanyaan saat membaca commit:

```text
Apa intensi commit menurut message?
Apa file yang berubah?
Apakah test ikut berubah?
Apakah behavior change dicampur refactor?
Apakah ada migration?
Apakah ada dependency upgrade?
Apakah ada config change?
Apakah commit kecil atau mega commit?
Apakah commit hasil revert?
Apakah commit bagian dari PR/issue?
```

---

## 16. Menemukan PR/Issue dari Commit

Git sendiri menyimpan commit message, bukan PR discussion.

Tetapi commit message sering berisi:

```text
CASE-1842
#1234
GH-1234
Refs: ABC-99
Fixes: BUG-123
```

Gunakan:

```bash
git show --no-patch --format=%B <sha>
```

Cari referensi:

```bash
git log --grep='CASE-1842' --oneline
```

Atau:

```bash
git log --grep='pending document' --all --oneline
```

Jika project memakai merge commit PR:

```bash
git log --merges --oneline
```

Contoh merge commit:

```text
Merge pull request #842 from team/case-escalation-guard
```

Dari sini Anda bisa buka PR di platform hosting.

Dalam regulated system, commit sebaiknya punya traceability:

```text
Ticket -> PR -> commit -> build artifact -> deployment -> incident/evidence
```

Tanpa traceability, forensic menjadi mahal.

---

## 17. Investigasi History Method Java

Misalkan method:

```java
boolean canEscalate(CaseRecord caseRecord, Actor actor)
```

Ingin tahu sejarahnya.

Langkah:

## 17.1 Cari Lokasi Saat Ini

```bash
git grep -n 'canEscalate'
```

## 17.2 Blame Method Range

```bash
nl -ba src/main/java/com/acme/caseflow/CaseTransitionPolicy.java | sed -n '70,130p'
git blame -w -L 70,130 src/main/java/com/acme/caseflow/CaseTransitionPolicy.java
```

## 17.3 Cari Perubahan Symbol

```bash
git log -S'canEscalate' --oneline -- src/main/java
git log -S'canEscalate' -p -- src/main/java
```

## 17.4 Cari Perubahan Pattern

```bash
git log -G'canEscalate|hasPendingDocumentReview|SUPERVISOR' -p -- src/main/java
```

## 17.5 Ikuti File Rename

```bash
git log --follow -p -- src/main/java/com/acme/caseflow/CaseTransitionPolicy.java
```

## 17.6 Baca Commit Penting

```bash
git show <sha>
```

## 17.7 Cari Test History

```bash
git log -S'canEscalate' -p -- src/test/java
git log -G'PENDING_DOCUMENT_REVIEW|ESCALATED' -p -- src/test/java
```

Pertanyaan penting:

```text
Apakah test ditambahkan bersamaan dengan rule?
Apakah test pernah dihapus?
Apakah behavior berubah tanpa test?
Apakah test hanya happy path?
```

---

## 18. Investigasi Enum dan State Machine

Untuk regulatory/case-management systems, enum sering merepresentasikan state penting:

```java
enum CaseStatus {
    NEW,
    UNDER_REVIEW,
    ESCALATED,
    ENFORCEMENT_ACTION,
    CLOSED
}
```

Investigasi:

```bash
git log -S'ESCALATED' -p -- src/main/java src/test/java
git log -G'CaseStatus\.' -p -- src/main/java
git grep -n 'CaseStatus.ESCALATED'
```

Pertanyaan:

```text
Kapan state ditambahkan?
Transition apa yang ikut diubah?
Apakah database migration ikut ada?
Apakah API contract berubah?
Apakah UI/client ikut berubah?
Apakah audit event ikut ditambah?
Apakah authorization rule berubah?
Apakah report/analytics terkena dampak?
```

Cari migration:

```bash
git log -S'ESCALATED' -p -- src/main/resources db migrations
git grep -n 'ESCALATED' -- 'src/main/resources/**' 'db/**'
```

Cari audit event:

```bash
git log -S'CASE_ESCALATED' -p -- .
git grep -n 'CASE_ESCALATED'
```

Untuk state machine, jangan hanya cari enum. Cari invariant sekelilingnya:

- transition policy;
- validator;
- command handler;
- event publisher;
- persistence mapping;
- API DTO;
- migration;
- integration event;
- audit log;
- reporting query;
- test fixtures.

---

## 19. Investigasi Database Migration

Migration sering meninggalkan jejak historis penting.

Contoh:

```sql
ALTER TABLE cases ADD COLUMN escalation_reason VARCHAR(255);
```

Cari:

```bash
git log -S'escalation_reason' -p -- .
git grep -n 'escalation_reason'
```

Jika column rename:

```bash
git log -G'escalation.*reason|reason.*escalation' -p -- db src/main/resources src/main/java
```

Pertanyaan:

```text
Kapan column ditambahkan?
Apakah nullable?
Apakah default value ada?
Apakah backfill dilakukan?
Apakah index dibuat?
Apakah constraint dibuat?
Apakah ORM entity diubah di commit sama?
Apakah query native ikut berubah?
Apakah migration reversible?
Apakah data production lama kompatibel?
```

File migration biasanya immutable. Jika migration lama diedit, itu red flag.

Gunakan history untuk melihat apakah migration pernah diubah setelah merge:

```bash
git log --follow -p -- db/migration/V202602141200__add_escalation_reason.sql
```

Jika migration file berubah setelah release, investigasi serius diperlukan.

---

## 20. Investigasi API Contract

Contoh field DTO:

```java
@JsonProperty("statusReason")
private String statusReason;
```

Cari:

```bash
git log -S'statusReason' -p -- src/main/java src/test/java
git log -G'JsonProperty|JsonIgnore|JsonInclude|statusReason' -p -- src/main/java src/test/java
git grep -n 'statusReason'
```

Pertanyaan:

```text
Kapan field ditambahkan?
Apakah field pernah rename?
Apakah field pernah dibuat nullable?
Apakah `@JsonIgnore` ditambahkan?
Apakah ObjectMapper config berubah?
Apakah DTO berubah dari class ke record?
Apakah serialization test ada?
Apakah OpenAPI spec ikut berubah?
Apakah generated client ikut diupdate?
```

Cari OpenAPI:

```bash
git log -S'statusReason' -p -- '**/*.yaml' '**/*.yml' '**/*.json'
git grep -n 'statusReason' -- '*.yaml' '*.yml' '*.json'
```

Jika API contract regression terjadi, history harus dilihat lintas:

- DTO;
- serializer config;
- OpenAPI spec;
- test contract;
- generated code;
- client SDK;
- release notes.

---

## 21. Investigasi Dependency Upgrade

Bug sering berasal dari dependency bump.

Cari dependency di Maven:

```bash
git log -S'<artifactId>spring-boot-starter-web</artifactId>' -p -- pom.xml
git log -G'<version>|spring-boot|jackson|hibernate' -p -- pom.xml
```

Gradle:

```bash
git log -G'org.springframework.boot|jackson|hibernate' -p -- build.gradle settings.gradle gradle.properties
```

Lockfile:

```bash
git log -p -- gradle.lockfile
```

Pertanyaan:

```text
Dependency apa yang berubah?
Apakah major/minor/patch?
Apakah transitive dependency berubah?
Apakah config ikut disesuaikan?
Apakah migration guide diikuti?
Apakah test coverage cukup?
Apakah bug muncul di runtime, compile, serialization, security, atau database?
```

Gunakan:

```bash
git show <sha> -- pom.xml build.gradle gradle.lockfile
```

Setelah commit ditemukan:

```bash
./mvnw dependency:tree
./gradlew dependencies
```

Untuk dependency forensic, Git hanya satu sisi. Artifact repository dan lockfile juga penting.

---

## 22. Investigasi Security Rule

Spring Security sering berubah secara halus.

Cari:

```bash
git log -G'PreAuthorize|Secured|hasRole|hasAuthority|SecurityFilterChain|authorizeHttpRequests' -p -- src/main/java
git grep -n -E 'PreAuthorize|Secured|hasRole|hasAuthority|SecurityFilterChain'
```

Pertanyaan:

```text
Kapan endpoint dibuka/ditutup?
Role mana yang berubah?
Apakah rule method-level dan HTTP-level konsisten?
Apakah test security ada?
Apakah default deny tetap berlaku?
Apakah annotation dipindah saat refactor?
Apakah filter order berubah?
Apakah matcher path berubah?
```

Security forensic harus berhati-hati:

- commit kecil bisa berdampak besar;
- default framework bisa berubah saat upgrade;
- rule ordering penting;
- path matching berubah antar versi;
- tests sering hanya happy path.

---

## 23. Investigasi Concurrency dan Async Behavior

Bug concurrency sering tidak mudah dicari dengan exact string.

Cari pattern:

```bash
git log -G'synchronized|volatile|CompletableFuture|Executor|Thread|parallelStream|@Async|Transaction' -p -- src/main/java
```

Cari specific class:

```bash
git log -p -- src/main/java/com/acme/caseflow/CaseEscalationHandler.java
```

Pertanyaan:

```text
Apakah async ditambahkan?
Apakah transaction boundary berubah?
Apakah event publish dipindah sebelum commit?
Apakah lock dihapus?
Apakah cache ditambahkan?
Apakah executor berubah?
Apakah retry ditambahkan?
Apakah idempotency key berubah?
```

Untuk concurrency, blame line terakhir sering tidak cukup. Bug bisa berasal dari interaksi:

- transaction boundary;
- event ordering;
- outbox;
- executor;
- retry;
- locking;
- cache;
- database isolation.

Gunakan `bisect` untuk menemukan boundary behavior, lalu `log -G` untuk memahami area perubahan.

---

## 24. Investigasi Config

Banyak bug Java backend berasal dari config, bukan class.

Cari:

```bash
git log -G'feature|timeout|retry|cache|datasource|kafka|security|jackson' -p -- src/main/resources
git grep -n -E 'timeout|retry|cache|datasource|kafka|security|jackson' -- src/main/resources
```

YAML:

```bash
git log -p -- src/main/resources/application.yml
git log -p -- src/main/resources/application-prod.yml
```

Pertanyaan:

```text
Apakah config berubah di profile tertentu?
Apakah default berubah?
Apakah environment variable name berubah?
Apakah property deprecated?
Apakah timeout/retry/circuit breaker berubah?
Apakah feature flag default berubah?
Apakah secret/config eksternal tidak ada di Git?
```

Ingat:

```text
Git tidak selalu menyimpan runtime config production.
```

Untuk forensic production, Anda perlu menggabungkan:

- Git commit;
- config repository;
- deployment manifest;
- Helm chart;
- Kubernetes config;
- secret manager;
- feature flag state;
- runtime logs.

---

## 25. Investigasi Test History

Test adalah dokumentasi behavior.

Cari kapan test ditambahkan:

```bash
git log -S'CaseEscalationServiceTest' -- src/test/java
git log -S'shouldEscalate' -p -- src/test/java
```

Cari test yang dihapus:

```bash
git log -S'shouldBlockEscalationWhenPendingReview' -p -- src/test/java
```

Pertanyaan:

```text
Apakah test ditambahkan bersamaan dengan feature?
Apakah test pernah diubah agar pass tanpa menjaga invariant?
Apakah assertion dilemahkan?
Apakah test dihapus saat refactor?
Apakah test ignored/disabled?
Apakah flaky test dihapus tanpa pengganti?
```

Cari disable:

```bash
git log -G'@Disabled|@Ignore|disabled|skip' -p -- src/test/java
git grep -n -E '@Disabled|@Ignore' -- src/test/java
```

Test archaeology sering menjelaskan intention lebih baik daripada source code.

---

## 26. Investigasi Revert

Revert commit punya pola message:

```text
Revert "..."
```

Cari:

```bash
git log --grep='Revert' --oneline
```

Atau untuk symbol:

```bash
git log -S'PENDING_DOCUMENT_REVIEW' --oneline
```

Jika string muncul, hilang, muncul lagi, mungkin ada revert atau re-implementation.

Gunakan:

```bash
git log --oneline --decorate --all --graph --grep='PENDING_DOCUMENT_REVIEW'
```

Saat melihat revert:

```bash
git show <revert-sha>
```

Pertanyaan:

```text
Apa yang direvert?
Mengapa direvert?
Apakah revert lengkap?
Apakah ada follow-up fix?
Apakah revert terjadi di release branch saja atau main juga?
Apakah revert membuat divergence antar branch?
```

Revert sering menjadi clue incident.

---

## 27. Investigasi Merge Commit

Merge commit bisa menyembunyikan perubahan integrasi.

Lihat merge:

```bash
git show --cc <merge-sha>
```

Atau terhadap masing-masing parent:

```bash
git show -m <merge-sha>
```

Lihat parent:

```bash
git show --pretty=raw --no-patch <merge-sha>
```

Pertanyaan:

```text
Apakah conflict resolution terjadi?
Apakah file hasil merge berbeda dari kedua parent?
Apakah dependency version dipilih salah?
Apakah migration order berubah?
Apakah dua feature valid secara terpisah tetapi gagal bersama?
Apakah test integration ada?
```

Jika `bisect` menunjuk merge commit, lakukan:

```bash
git checkout <merge-sha>^1
./predicate.sh

git checkout <merge-sha>^2
./predicate.sh

git checkout <merge-sha>
./predicate.sh
```

Jika kedua parent good tetapi merge bad, masalahnya integrasi.

---

## 28. Investigasi File yang Dihapus

Jika file sudah tidak ada:

```bash
git log --all -- path/to/deleted-file.java
```

Lihat commit delete:

```bash
git log --diff-filter=D --summary -- path/to/deleted-file.java
```

Pulihkan untuk melihat isi lama:

```bash
git show <sha-before-delete>:path/to/deleted-file.java
```

Atau:

```bash
git checkout <sha-before-delete> -- path/to/deleted-file.java
```

Untuk forensic, lebih aman pakai `git show` daripada checkout file ke working tree.

Contoh:

```bash
git show v1.12.0:src/main/java/com/acme/LegacyEscalationPolicy.java
```

---

## 29. Investigasi File pada Commit/Tag Tanpa Checkout

Lihat file lama:

```bash
git show v1.12.0:src/main/java/com/acme/caseflow/CaseTransitionPolicy.java
```

Bandingkan file antar tag:

```bash
git diff v1.12.0..v1.13.0 -- src/main/java/com/acme/caseflow/CaseTransitionPolicy.java
```

Cari string di tag lama:

```bash
git grep -n 'PENDING_DOCUMENT_REVIEW' v1.12.0
```

Ini berguna karena checkout commit lama bisa mahal atau mengganggu working tree.

---

## 30. Investigasi dengan Range

Cari commit di antara dua release:

```bash
git log v1.12.0..v1.13.0 --oneline
```

Dengan path:

```bash
git log v1.12.0..v1.13.0 --oneline -- src/main/java/com/acme/caseflow
```

Dengan patch:

```bash
git log v1.12.0..v1.13.0 -p -- src/main/java/com/acme/caseflow
```

Dengan grep message:

```bash
git log v1.12.0..v1.13.0 --grep='escalation' --oneline
```

Dengan author:

```bash
git log v1.12.0..v1.13.0 --author='Rina' --oneline
```

Dengan date:

```bash
git log --since='2026-02-01' --until='2026-02-20' --oneline
```

Range membuat investigation lebih fokus.

---

## 31. Two-Dot dan Three-Dot dalam Forensic

Saat membandingkan branch:

```bash
git log main..feature
```

Artinya:

```text
commit yang reachable dari feature tetapi tidak reachable dari main
```

Untuk PR-like comparison, sering ingin:

```bash
git diff main...feature
```

Artinya diff dari merge-base ke feature.

Forensic branch:

```bash
git log --left-right --cherry-pick --oneline main...release/2.8
```

Ini membantu melihat divergence:

- commit di main tapi tidak di release;
- commit di release tapi tidak di main;
- patch-equivalent commit yang sudah cherry-pick.

Untuk backport/hotfix forensic:

```bash
git cherry -v main release/2.8
```

Pertanyaan:

```text
Apakah hotfix sudah forward-ported?
Apakah release branch tertinggal?
Apakah commit yang sama ada dengan SHA berbeda?
Apakah patch-equivalent sudah masuk?
```

---

## 32. Mencari Commit Berdasarkan Message

Jika commit message baik, forensic jadi mudah.

Cari:

```bash
git log --grep='escalation' --oneline --all
git log --grep='CASE-1842' --oneline --all
git log --grep='hotfix' --oneline --all
git log --grep='revert' --oneline --all
```

Case insensitive:

```bash
git log --regexp-ignore-case --grep='escalation' --oneline --all
```

Multiple grep:

```bash
git log --all --grep='escalation' --grep='pending document' --oneline
```

Secara default, multiple `--grep` adalah OR. Untuk AND:

```bash
git log --all --all-match --grep='escalation' --grep='pending' --oneline
```

Commit message yang buruk membuat archaeology mahal:

```text
fix
update
misc
changes
wip
bugfix
```

Commit message yang baik menjadi index historis:

```text
CASE-1842 Block enforcement action while document review is pending
```

---

## 33. Mencari Commit Berdasarkan Author/Committer

Kadang Anda perlu mencari konteks dari domain owner, bukan menyalahkan.

```bash
git log --author='Rina' --oneline -- src/main/java/com/acme/caseflow
```

Atau committer:

```bash
git log --committer='release-bot' --oneline
```

Gunakan untuk:

- mencari batch migration;
- menemukan automated commits;
- mencari release bot;
- memahami ownership area;
- bertanya ke orang yang paling punya konteks.

Namun hati-hati:

```text
Author bukan satu-satunya pemilik keputusan.
```

---

## 34. Mencari Berdasarkan Date

```bash
git log --since='2026-01-01' --until='2026-02-01' --oneline
```

Dengan path:

```bash
git log --since='2026-01-01' --until='2026-02-01' --oneline -- src/main/java/com/acme/caseflow
```

Dengan patch:

```bash
git log --since='2026-01-01' --until='2026-02-01' -p -- src/main/java/com/acme/caseflow
```

Gunakan saat:

- incident terjadi setelah tanggal tertentu;
- release window diketahui;
- freeze period;
- regulatory change date;
- migration window.

Perhatikan:

- author date bisa berbeda dari commit date;
- rebase mengubah commit date;
- timezone bisa memengaruhi interpretasi;
- merge date berbeda dari authoring date.

Gunakan `--format=fuller` jika perlu:

```bash
git log --format=fuller -1 <sha>
```

---

## 35. Archaeology pada Generated Code

Generated code bisa menipu blame.

Contoh:

```text
OpenAPI generated DTO berubah.
Blame menunjuk commit regenerate client.
Root cause sebenarnya ada di openapi.yaml.
```

Strategi:

1. Cari generated file.
2. Cari source of truth.
3. Investigasi source of truth.

Contoh:

```bash
git log -S'statusReason' -p -- openapi.yaml src/main/resources/api
git log -S'statusReason' -p -- generated
```

Jika generated code committed, commit sebaiknya memisahkan:

```text
1. Update API spec.
2. Regenerate code.
```

Jika dicampur, review dan forensic jadi sulit.

Untuk Java:

- MapStruct generated code biasanya tidak committed;
- protobuf generated code kadang committed di beberapa repo;
- OpenAPI generated client/server kadang committed;
- jOOQ generated classes kadang committed;
- QueryDSL Q-classes kadang generated saat build.

Tentukan policy repo.

---

## 36. Archaeology pada Binary/Lock Files

Binary file tidak mudah dibaca dengan diff.

Jika bug terkait binary fixture atau jar:

```bash
git log --stat -- path/to/file.jar
git log --summary -- path/to/file.jar
```

Untuk lockfile:

```bash
git log -p -- gradle.lockfile
git log -p -- pom.xml
```

Untuk Maven dependency:

```bash
git log -G'<dependency>|<artifactId>|<version>' -p -- pom.xml
```

Policy yang baik:

```text
Jangan simpan jar dependency di Git kecuali ada alasan sangat kuat.
Gunakan artifact repository.
```

Jika binary fixture harus ada:

- ukuran kecil;
- naming jelas;
- source/generator terdokumentasi;
- hash/version dicatat;
- perubahan binary disertai penjelasan.

---

## 37. Archaeology dan `.gitignore`

Kadang bug muncul karena file yang seharusnya tracked ternyata ignored, atau sebaliknya.

Investigasi:

```bash
git check-ignore -v path/to/file
git log -p -- .gitignore
git log -p -- .gitattributes
```

Pertanyaan:

```text
Kapan file mulai ignored?
Apakah generated source tidak sengaja tidak tracked?
Apakah config example hilang?
Apakah wrapper jar ignored?
Apakah build output committed?
Apakah line endings berubah?
```

Untuk Java:

- `target/` biasanya ignored;
- `build/` biasanya ignored;
- Maven wrapper jar biasanya tracked;
- Gradle wrapper jar biasanya tracked;
- generated sources tergantung policy;
- `.idea` sebagian besar ignored, tetapi style config tertentu mungkin tracked;
- `.editorconfig` sebaiknya tracked.

---

## 38. Archaeology pada `.gitattributes`

`.gitattributes` memengaruhi line ending, diff, merge, linguist, LFS.

Investigasi:

```bash
git log -p -- .gitattributes
git check-attr -a -- path/to/file
```

Pertanyaan:

```text
Kapan file mulai pakai Git LFS?
Kapan line ending dinormalisasi?
Apakah SQL/YAML punya merge strategy khusus?
Apakah binary file ditandai benar?
Apakah diff driver berubah?
```

Jika banyak file terlihat berubah tanpa logic, cek:

```bash
git log -p -- .gitattributes
```

Perubahan line ending bisa menyebabkan diff noise besar.

---

## 39. Archaeology untuk Release Branch

Pertanyaan:

```text
Apakah fix di main sudah masuk release branch?
```

Gunakan:

```bash
git branch --contains <sha>
```

Atau:

```bash
git tag --contains <sha>
```

Jika cherry-pick menghasilkan SHA berbeda:

```bash
git cherry -v release/2.8 main
```

Cari patch-equivalent:

```bash
git log --cherry-pick --right-only --oneline release/2.8...main
```

Untuk release forensic:

```bash
git log v2.8.0..v2.8.1 --oneline
git diff v2.8.0..v2.8.1 --stat
```

Pertanyaan:

```text
Apa saja perubahan patch release?
Apakah hanya hotfix?
Apakah dependency ikut berubah?
Apakah migration ikut berubah?
Apakah tag menunjuk commit benar?
Apakah artifact dibangun dari tag itu?
```

---

## 40. Archaeology untuk Hotfix

Hotfix harus mudah dilacak.

Ideal:

```text
production tag -> hotfix branch -> fix commit -> tag patch release -> forward-port to main
```

Investigasi:

```bash
git log --grep='hotfix' --oneline --all
git branch --contains <hotfix-sha>
git tag --contains <hotfix-sha>
```

Cari apakah forward-port ada:

```bash
git cherry -v main release/2.8
```

Jika hotfix di-release branch tidak ada di main, bug bisa kembali pada release berikutnya.

Checklist:

```text
[ ] Hotfix commit ada di release branch.
[ ] Patch tag dibuat.
[ ] Commit/patch-equivalent ada di main.
[ ] Regression test ada.
[ ] Release notes mencatat fix.
[ ] Incident/ticket terhubung.
```

---

## 41. Archaeology untuk Incident Report

Incident report yang baik membutuhkan evidence.

Data dari Git:

```text
Good version:
Bad version:
First bad commit:
Commit message:
PR/issue:
Files changed:
Tests added/missing:
Fix commit:
Release tag:
Deployment artifact:
```

Command:

```bash
git show --no-patch --format=fuller <sha>
git show --stat <sha>
git log <good>..<bad> --oneline
git diff <good>..<bad> --stat
git tag --contains <fix-sha>
git branch --contains <fix-sha>
```

Narasi yang baik:

```text
Bug introduced by commit X, merged via PR Y, which changed escalation guard behavior.
The change was intended to block enforcement action while review was pending,
but it also blocked escalation for supervisor override.
Regression test Z has been added.
Fix released in tag v2.8.3 and forward-ported to main.
```

Hindari:

```text
Budi broke escalation.
```

---

## 42. Case Study 1 — “Kenapa Rule Ini Ada?”

Kode:

```java
if (actor.isExternalPartner()) {
    return blocked("EXTERNAL_PARTNER_CANNOT_ESCALATE");
}
```

Langkah:

```bash
git grep -n 'EXTERNAL_PARTNER_CANNOT_ESCALATE'
git blame -w -L 80,110 src/main/java/com/acme/caseflow/CaseTransitionPolicy.java
git log -S'EXTERNAL_PARTNER_CANNOT_ESCALATE' -p -- .
```

Commit ditemukan:

```text
CASE-2091 Block external partner escalation after audit finding
```

Baca:

```bash
git show <sha>
```

Ternyata:

- ada audit finding;
- external partner sebelumnya bisa escalate case;
- fix menambah rule dan audit test;
- regulatory requirement melarang actor eksternal mengambil aksi enforcement.

Kesimpulan:

```text
Rule ini bukan accidental complexity.
Rule ini compliance guard.
Jangan hapus walaupun tampak aneh.
```

---

## 43. Case Study 2 — “Siapa Menghapus Field JSON?”

Bug:

```text
Client lama gagal karena `statusReason` hilang.
```

Langkah:

```bash
git log -S'statusReason' -p -- src/main/java src/test/java openapi
git log -G'JsonIgnore|JsonInclude|JsonProperty|statusReason' -p -- src/main/java
git grep -n 'statusReason' v2.4.0
git grep -n 'statusReason' HEAD
```

Hasil:

- field masih ada di DTO;
- `@JsonInclude(NON_NULL)` ditambahkan;
- service tidak lagi mengisi value default;
- OpenAPI tetap menyatakan field optional.

Root cause bukan field dihapus, tetapi value menjadi null dan serializer menyembunyikan null.

Pelajaran:

```text
Pickaxe exact string tidak cukup.
Gunakan pattern sekitar serialization behavior.
```

---

## 44. Case Study 3 — “Kenapa Query Jadi Lambat?”

Gejala:

```text
Endpoint /cases/search P95 naik dari 150ms ke 1200ms.
```

Langkah:

```bash
git log -G'findCases|searchCases|@Query|JOIN|ORDER BY|Pageable|Specification' -p -- src/main/java
git log -p -- src/main/resources/db/migration
git log -G'index|CREATE INDEX|DROP INDEX' -p -- db src/main/resources
```

Kemungkinan commit:

```text
Add flexible sorting to case search
```

Diff:

```java
Sort.by(request.sortField())
```

Query sekarang sorting field non-indexed.

Migration tidak menambah index.

Root cause:

```text
Feature sorting menambah pilihan field tanpa performance guard/index.
```

Fix:

- batasi allowed sort fields;
- tambah index yang sesuai;
- tambahkan integration/performance test;
- update API contract.

---

## 45. Case Study 4 — “Kenapa Test Ini Dihapus?”

Cari:

```bash
git log -S'shouldRejectEscalationWhenCaseClosed' -p -- src/test/java
```

Hasil:

```text
Commit: Remove flaky escalation tests
```

Baca commit:

```bash
git show <sha>
```

Ternyata test dihapus karena flaky, tanpa pengganti.

Pertanyaan:

```text
Apakah behavior masih penting?
Apakah flakiness dari async timing?
Apakah harus diganti dengan Awaitility?
Apakah invariant perlu test baru?
```

Pelajaran:

```text
Test deletion adalah perubahan behavior risk, bukan housekeeping.
```

---

## 46. Case Study 5 — Merge Commit sebagai Penyebab

`bisect` menunjuk merge commit.

Analisis:

```bash
git show --pretty=raw --no-patch <merge-sha>
git show --cc <merge-sha>
git show -m <merge-sha>
```

Parent 1:

```text
Feature A: introduce new CaseStatus ESCALATED
```

Parent 2:

```text
Feature B: restrict document review transitions
```

Masing-masing parent pass.

Merge bad.

Root cause:

```text
Conflict resolution mempertahankan transition matrix lama dan lupa menambahkan ESCALATED + pending review combination.
```

Fix:

- update transition matrix;
- tambahkan combinatorial state transition tests;
- review merge conflict lebih hati-hati.

Pelajaran:

```text
Merge commit bisa benar-benar memperkenalkan bug.
```

---

## 47. Advanced: Membaca Line Evolution Manual

Kadang blame menunjuk commit reformat. Pickaxe terlalu kasar.

Strategi manual:

```bash
git log -p -L 80,120:src/main/java/com/acme/caseflow/CaseTransitionPolicy.java
```

`git log -L` menelusuri evolusi line range atau function.

Contoh:

```bash
git log -L :canEscalate:src/main/java/com/acme/caseflow/CaseTransitionPolicy.java
```

Keterbatasan:

- function detection tergantung heuristik;
- Java method overloaded bisa membingungkan;
- rename file tidak selalu mulus;
- output bisa panjang.

Tetap berguna untuk melihat perubahan method dari waktu ke waktu.

---

## 48. Advanced: Menggunakan `git range-diff`

Untuk branch yang direbase:

```bash
git range-diff main..feature-v1 main..feature-v2
```

Gunanya:

```text
Membandingkan dua versi rangkaian commit.
```

Cocok untuk:

- review setelah rebase;
- melihat apakah patch berubah;
- membandingkan PR revision;
- memastikan fixup tidak mengubah behavior tak sengaja.

Forensic:

```text
Sebelum rebase, commit A punya change X.
Setelah rebase, apakah change X masih ada?
```

---

## 49. Advanced: `git notes`

Kadang ingin menambahkan metadata ke commit tanpa mengubah commit.

```bash
git notes add -m "Investigated in incident INC-2026-041. Predicate: escalation stuck."
git notes show <sha>
```

Kegunaan:

- forensic annotation;
- incident link;
- review note;
- release note internal.

Namun:

- notes tidak selalu dipush/fetch default;
- hosting platform support bervariasi;
- jangan jadikan satu-satunya source of truth.

Push notes:

```bash
git push origin refs/notes/*
```

Fetch notes:

```bash
git fetch origin refs/notes/*:refs/notes/*
```

---

## 50. Advanced: Combining Tools

Contoh flow incident:

```text
1. `git bisect` menemukan first bad commit.
2. `git show` membaca commit.
3. `git log -S` mencari symbol terkait.
4. `git blame -w` melihat line sekitar.
5. `git log --grep` mencari issue/ticket.
6. `git diff good..bad --stat` melihat release delta.
7. `git branch --contains` memastikan fix masuk branch.
8. `git tag --contains` memastikan release tag.
```

Command contoh:

```bash
git bisect start prod-bad prod-good
git bisect run ./scripts/reproduce.sh

git show --stat <bad-sha>
git show <bad-sha>

git log -S'PENDING_DOCUMENT_REVIEW' -p -- .
git blame -w -L 100,140 src/main/java/com/acme/caseflow/CaseTransitionPolicy.java
git log --grep='CASE-1842' --all --oneline

git branch --contains <fix-sha>
git tag --contains <fix-sha>
```

---

## 51. Decision Matrix: Tool Mana yang Dipakai?

| Pertanyaan | Tool |
|---|---|
| Commit mana yang memperkenalkan regression? | `git bisect` |
| Baris ini terakhir diubah oleh commit apa? | `git blame` |
| Kapan constant ini pertama muncul? | `git log -S` |
| Kapan condition ini berubah? | `git log -G` |
| File ini sejarahnya bagaimana setelah rename? | `git log --follow` |
| Symbol ini ada di mana sekarang? | `git grep` |
| Symbol ini ada di tag lama? | `git grep <pattern> <tag>` |
| Apa isi commit tertentu? | `git show` |
| Apa perubahan antara dua release? | `git diff old..new` |
| Apakah fix sudah masuk release branch? | `git branch --contains`, `git cherry` |
| Apakah patch-equivalent sudah diterapkan? | `git cherry`, `log --cherry-pick` |
| Bagaimana method berubah seiring waktu? | `git log -L` |
| Bagaimana branch berubah setelah rebase? | `git range-diff` |

---

## 52. Anti-Pattern Forensic

## 52.1 Berhenti di Blame

Salah:

```text
Blame menunjuk commit X, selesai.
```

Benar:

```text
Blame menunjuk commit X.
Baca commit X.
Jika X hanya refactor, telusuri lebih dalam.
```

## 52.2 Mengabaikan Test History

Behavior sering lebih jelas dari test yang ditambahkan/dihapus.

## 52.3 Mencari Exact String Terlalu Sempit

Field mungkin rename.

Gunakan regex/pattern:

```bash
git log -G'status.*reason|reason.*status' -p
```

## 52.4 Mengabaikan Config dan Migration

Bug Java backend sering muncul dari YAML, SQL migration, dependency, atau deployment config.

## 52.5 Menyalahkan Author

Ini merusak budaya engineering dan sering salah secara teknis.

## 52.6 Menganggap Commit Message Selalu Benar

Commit message adalah clue, bukan bukti final.

Diff dan behavior tetap harus diverifikasi.

## 52.7 Tidak Membedakan Mechanical vs Semantic Change

Formatting commit bukan logic commit.

Gunakan ignore revs, tetapi hanya untuk commit yang benar-benar mechanical.

## 52.8 Tidak Mencari PR/Issue

Commit diff menunjukkan apa.
PR/issue sering menjelaskan kenapa.

---

## 53. Checklist Code Archaeology

Saat menemukan kode aneh:

```text
[ ] Cari lokasi symbol dengan `git grep`.
[ ] Blame line dengan `-w`.
[ ] Jika perlu gunakan `-M -C`.
[ ] Baca commit hasil blame.
[ ] Jika commit mechanical, gunakan ignore-revs atau telusuri parent.
[ ] Gunakan `git log -S` untuk exact symbol.
[ ] Gunakan `git log -G` untuk pattern perubahan.
[ ] Gunakan `--follow` jika file rename.
[ ] Cek test history.
[ ] Cek config/migration/dependency jika relevan.
[ ] Cari PR/issue dari commit message.
[ ] Validasi behavior jika mengambil keputusan.
[ ] Dokumentasikan konteks jika knowledge penting.
```

---

## 54. Checklist Investigasi Regression

```text
[ ] Apakah regression boundary sudah ditemukan dengan bisect?
[ ] Apakah commit hasil bisect sudah dibaca dengan `git show`?
[ ] Apakah parent vs commit sudah divalidasi?
[ ] Apakah diff hanya logic, atau juga config/dependency/migration?
[ ] Apakah line terkait sudah ditelusuri dengan blame/pickaxe?
[ ] Apakah test terkait berubah?
[ ] Apakah PR/issue menjelaskan intent?
[ ] Apakah bug berasal dari merge/semantic conflict?
[ ] Apakah fix perlu revert, patch, atau redesign?
[ ] Apakah regression test baru menangkap invariant?
```

---

## 55. Checklist untuk Membuat History Lebih Mudah Diinvestigasi

Sebagai author commit:

```text
[ ] Pisahkan mechanical refactor dari behavior change.
[ ] Tulis commit message yang menjelaskan intent.
[ ] Tambahkan ticket/issue reference.
[ ] Tambahkan test untuk behavior penting.
[ ] Jangan hapus test tanpa pengganti/penjelasan.
[ ] Jangan campur dependency upgrade dengan refactor besar.
[ ] Jangan campur migration dengan unrelated cleanup.
[ ] Buat PR kecil dan reviewable.
[ ] Gunakan tag/release note yang traceable.
[ ] Commit `.git-blame-ignore-revs` untuk formatting massal.
```

History yang baik adalah investasi forensic.

---

## 56. Latihan Praktis

## Latihan 1 — Blame Method

Pilih satu method di project Java.

Jalankan:

```bash
git blame -w -L <start>,<end> <file>
```

Ambil 3 SHA berbeda dan baca:

```bash
git show --stat <sha>
git show <sha>
```

Catat:

```text
Apakah commit behavior change atau mechanical?
Apakah commit message cukup membantu?
Apakah test ikut berubah?
```

## Latihan 2 — Pickaxe Constant

Pilih enum/constant penting:

```bash
git log -S'<CONSTANT_NAME>' -p -- .
```

Jawab:

```text
Kapan constant muncul?
Apa konteksnya?
Apakah ada test?
Apakah ada migration/config/API impact?
```

## Latihan 3 — Pattern History

Cari perubahan authorization:

```bash
git log -G'PreAuthorize|hasRole|hasAuthority' -p -- src/main/java
```

Pilih satu commit dan analisis risk.

## Latihan 4 — File Rename

Pilih file yang pernah rename/move:

```bash
git log --follow -p -- <file>
```

Bandingkan dengan:

```bash
git log -p -- <file>
```

Catat perbedaannya.

## Latihan 5 — Test Deletion

Cari test disabled/deleted:

```bash
git log -G'@Disabled|@Ignore' -p -- src/test/java
git log --diff-filter=D --summary -- src/test/java
```

Tentukan apakah deletion/disable masuk akal.

## Latihan 6 — Release Forensic

Ambil dua tag release:

```bash
git log vX.Y.Z..vX.Y.Z+1 --oneline
git diff vX.Y.Z..vX.Y.Z+1 --stat
```

Jawab:

```text
Apa perubahan paling berisiko?
Apakah dependency berubah?
Apakah migration berubah?
Apakah API contract berubah?
```

---

## 57. Pertanyaan Reflektif

1. Apakah Anda memakai `git blame` untuk mencari konteks atau mencari orang?
2. Apakah commit history tim Anda cukup membantu forensic?
3. Apakah mechanical refactor dipisah dari behavior change?
4. Apakah formatting massal sudah masuk `.git-blame-ignore-revs`?
5. Apakah commit message punya ticket/issue reference?
6. Apakah test history mencerminkan behavior domain?
7. Apakah migration dan API contract mudah ditelusuri?
8. Apakah hotfix mudah dicek apakah sudah forward-port?
9. Apakah branch/release/tag bisa dihubungkan ke deployment artifact?
10. Apakah tim punya standar investigasi incident berbasis Git?

---

## 58. Mental Model Akhir

Code archaeology bukan aktivitas nostalgia.

Ia adalah kemampuan engineering untuk menghubungkan:

```text
current code
historical change
intent
review context
runtime behavior
business invariant
release/deployment evidence
```

Command yang dipakai:

```text
blame  -> line terakhir berubah kapan
-S     -> symbol/string masuk/keluar kapan
-G     -> pattern patch berubah kapan
grep   -> symbol ada di mana
show   -> commit melakukan apa
log    -> sejarah/range/metadata
diff   -> dua state berbeda bagaimana
```

Kesimpulan yang matang bukan:

```text
Commit ini punya author X.
```

Melainkan:

```text
Perubahan behavior ini masuk melalui commit X,
dengan intent Y,
berdampak pada invariant Z,
tidak/kurang ditutup oleh test A,
dan remediation paling aman adalah B.
```

Itulah cara Git menjadi alat engineering intelligence.

---

## 59. Koneksi ke Part Berikutnya

Part ini menutup kelompok **Debugging & Forensics** bersama part sebelumnya tentang `bisect`.

Part berikutnya masuk ke area khusus Java project:

```text
learn-git-mastery-for-java-engineers-part-021.md
```

Topik:

```text
Git untuk Java Projects: Maven, Gradle, IDE, dan Generated Files
```

Kita akan membahas repository hygiene:

- `.gitignore`;
- Maven `target/`;
- Gradle `build/`;
- wrapper files;
- IDE files;
- generated code;
- annotation processing;
- OpenAPI/protobuf/jOOQ/MapStruct;
- binary artifacts;
- dependency lockfiles;
- apa yang menjadi source of truth;
- bagaimana menjaga repo Java tetap reproducible dan bersih.

---

## 60. Referensi

Rujukan utama untuk materi ini:

- Git official documentation: `git blame`
- Git official documentation: `git log`
- Git official documentation: pickaxe options `-S` and `-G`
- Git official documentation: `git grep`
- Git official documentation: `git show`
- Git official documentation: `git diff`
- Git official documentation: `git range-diff`
- Git official documentation: `git notes`
- Pro Git Book: Git Tools, revision selection, searching, rewriting history, debugging, and internals
- Praktik umum forensic debugging, incident investigation, code review, release traceability, dan Java backend repository maintenance

---

## 61. Status Seri

```text
Progress: 020 / 032
Seri belum selesai.
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
```

Bagian berikutnya:

```text
learn-git-mastery-for-java-engineers-part-021.md
```

Topik:

```text
Git untuk Java Projects: Maven, Gradle, IDE, dan Generated Files
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-git-mastery-for-java-engineers-part-019.md](./learn-git-mastery-for-java-engineers-part-019.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-git-mastery-for-java-engineers-part-021.md](./learn-git-mastery-for-java-engineers-part-021.md)

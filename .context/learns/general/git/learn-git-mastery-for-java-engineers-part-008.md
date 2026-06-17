# learn-git-mastery-for-java-engineers-part-008.md

# Merge: Menggabungkan Sejarah Tanpa Kehilangan Konteks

## Status Seri

```text
Series      : Git Mastery for Java Engineers
Part        : 008 / 032
Status      : Belum selesai
Bagian akhir: learn-git-mastery-for-java-engineers-part-032.md
```

## Tujuan Bagian Ini

Di bagian sebelumnya, kita sudah membangun mental model tentang branch sebagai pointer yang memungkinkan isolasi perubahan. Sekarang kita masuk ke operasi yang membuat branch-branch itu bertemu kembali: **merge**.

Banyak engineer menggunakan merge secara mekanis:

```bash
git checkout main
git merge feature-x
```

atau menekan tombol **Merge Pull Request** di GitHub/GitLab/Bitbucket.

Namun Git merge bukan sekadar “gabungkan kode”. Merge adalah operasi terhadap **commit graph** yang mencoba membangun snapshot baru dari beberapa garis sejarah. Jika dipahami dengan benar, merge adalah alat integrasi yang kuat, aman, dan ekspresif. Jika dipahami dangkal, merge menjadi sumber conflict buruk, history berantakan, regresi tersembunyi, dan release risk.

Target bagian ini:

1. Memahami merge sebagai operasi graph, bukan sekadar operasi file.
2. Membedakan fast-forward merge, true merge, dan merge commit.
3. Memahami bagaimana Git melakukan three-way merge.
4. Memahami konflik secara struktural sebelum masuk detail conflict resolution di part 011.
5. Mampu membaca merge commit dan menilai apakah merge itu bermakna atau noise.
6. Mampu menentukan kapan merge lebih tepat daripada rebase.
7. Mampu membuat kebijakan merge yang sehat untuk tim Java/backend.

---

# 1. Core Mental Model: Merge Menggabungkan Garis Sejarah

Branch adalah pointer ke commit.

Misalkan kita punya graph:

```text
A---B---C  main
     \
      D---E  feature/payment-validation
```

Artinya:

- `main` menunjuk ke `C`.
- `feature/payment-validation` menunjuk ke `E`.
- Commit `D` bercabang dari `B`.
- `B` adalah common ancestor dari `C` dan `E`.

Ketika kita melakukan:

```bash
git switch main
git merge feature/payment-validation
```

Git mencoba mengintegrasikan perubahan dari branch feature ke branch `main`.

Pertanyaan utama merge bukan:

```text
File mana yang harus digabung?
```

Melainkan:

```text
Bagaimana membangun state baru yang merepresentasikan gabungan evolusi dari dua garis sejarah sejak common ancestor?
```

Itulah sebabnya merge sangat bergantung pada commit graph.

---

# 2. Merge Bekerja pada Snapshot, tetapi Menggunakan History

Dari part sebelumnya, Git menyimpan snapshot, bukan diff. Tetapi saat merge, Git perlu menghitung perubahan dengan membandingkan beberapa snapshot.

Pada true merge, Git biasanya melihat tiga titik:

```text
        C  ours/main
       /
A---B
     \
      E  theirs/feature
```

Tiga snapshot penting:

| Snapshot | Makna |
|---|---|
| `B` | merge base / common ancestor |
| `C` | state branch saat ini, sering disebut ours |
| `E` | state branch yang digabungkan, sering disebut theirs |

Git membandingkan:

```text
B -> C = perubahan yang terjadi di branch saat ini
B -> E = perubahan yang terjadi di branch lain
```

Lalu Git mencoba membangun snapshot gabungan.

Inilah yang disebut **three-way merge**.

---

# 3. Dua Jenis Merge Besar

Secara praktis, ada dua jenis merge yang paling sering ditemui:

1. **Fast-forward merge**
2. **Three-way merge dengan merge commit**

Keduanya sama-sama disebut merge, tetapi konsekuensi history-nya berbeda.

---

# 4. Fast-Forward Merge

## 4.1 Kondisi Fast-Forward

Fast-forward terjadi jika branch tujuan belum punya commit baru sejak branch feature dibuat.

Contoh:

```text
A---B  main
     \
      C---D  feature/login
```

`main` masih berada di `B`. Branch feature maju ke `D`. Tidak ada divergensi baru di `main`.

Saat menjalankan:

```bash
git switch main
git merge feature/login
```

Git cukup memindahkan pointer `main` dari `B` ke `D`.

Hasil:

```text
A---B---C---D  main, feature/login
```

Tidak ada commit baru dibuat.

## 4.2 Fast-Forward Itu Bukan “Menggabungkan File”

Fast-forward lebih tepat dipahami sebagai:

```text
Pointer branch tujuan dapat dimajukan tanpa membuat commit integrasi baru.
```

Karena `main` belum berubah, tidak ada dua garis sejarah yang perlu dipadukan. Branch feature sebenarnya sudah mengandung seluruh history `main`.

## 4.3 Kelebihan Fast-Forward

Fast-forward menghasilkan history yang linear dan sederhana.

Kelebihan:

- history mudah dibaca,
- tidak ada merge commit tambahan,
- cocok untuk perubahan kecil,
- cocok untuk branch pendek,
- cocok untuk workflow linear/trunk-based.

## 4.4 Kekurangan Fast-Forward

Fast-forward menghilangkan informasi eksplisit bahwa beberapa commit pernah berada dalam satu branch feature.

Misalnya sebelum merge:

```text
A---B  main
     \
      C---D---E  feature/refactor-auth
```

Setelah fast-forward:

```text
A---B---C---D---E  main
```

Dari history linear, tidak jelas bahwa `C-D-E` merupakan satu unit kerja feature/refactor-auth, kecuali commit message atau PR metadata menyediakannya.

Dalam banyak tim modern, informasi tersebut disimpan di Pull Request UI. Namun dari Git murni, konteks branch tidak lagi terlihat sebagai merge boundary.

## 4.5 Kapan Fast-Forward Cocok

Fast-forward cocok ketika:

- branch sangat pendek,
- perubahan kecil dan atomic,
- setiap commit sudah berkualitas,
- tim menginginkan linear history,
- PR metadata cukup sebagai konteks integrasi,
- release/debugging lebih mudah dengan history linear.

Contoh Java/backend:

- rename method kecil,
- update test assertion,
- memperbaiki typo config,
- menambah validation sederhana,
- memperbaiki satu bug kecil dengan satu commit.

## 4.6 Kapan Fast-Forward Kurang Cocok

Fast-forward kurang cocok ketika:

- feature terdiri dari banyak commit eksploratif,
- branch merepresentasikan integration event penting,
- perubahan lintas modul besar,
- branch release/hotfix perlu terlihat sebagai boundary,
- audit membutuhkan bukti eksplisit kapan feature masuk mainline.

---

# 5. Three-Way Merge dan Merge Commit

## 5.1 Kondisi True Merge

True merge terjadi ketika branch tujuan dan branch sumber sama-sama punya perkembangan sejak common ancestor.

Contoh:

```text
      C---D  main
     /
A---B
     \
      E---F  feature/invoice-rule
```

Di sini:

- `main` maju dari `B` ke `D`.
- `feature/invoice-rule` maju dari `B` ke `F`.
- Kedua branch diverge.

Ketika menjalankan:

```bash
git switch main
git merge feature/invoice-rule
```

Git tidak bisa sekadar memindahkan pointer `main` ke `F`, karena `F` tidak mengandung commit `C-D`.

Git harus membuat commit baru yang punya dua parent.

Hasil:

```text
      C---D------M  main
     /          /
A---B          /
     \        /
      E---F--/  feature/invoice-rule
```

Commit `M` adalah **merge commit**.

## 5.2 Merge Commit Punya Lebih dari Satu Parent

Commit biasa punya satu parent:

```text
parent -> commit
```

Merge commit biasanya punya dua parent:

```text
parent 1: state branch tujuan sebelum merge
parent 2: state branch yang digabungkan
```

Dalam contoh:

```text
M parent 1 = D
M parent 2 = F
```

Ini penting untuk membaca history.

Parent pertama biasanya merepresentasikan branch tempat merge dijalankan. Parent kedua merepresentasikan branch yang dimerge.

## 5.3 Merge Commit Adalah Commit Nyata

Merge commit bukan metadata UI. Ia adalah commit Git nyata yang memiliki:

- object id,
- tree/snapshot,
- parent lebih dari satu,
- author,
- committer,
- message,
- timestamp.

Artinya merge commit bisa:

- dilihat dengan `git show`,
- direvert,
- diblame secara tidak langsung,
- menjadi bagian release,
- menjadi titik audit,
- menjadi sumber conflict future jika buruk.

---

# 6. Three-Way Merge secara Konseptual

Misalkan file `InvoiceService.java` pada merge base `B`:

```java
public class InvoiceService {
    public BigDecimal calculateTotal(Invoice invoice) {
        return invoice.getSubtotal();
    }
}
```

Di `main`, commit `C-D` mengubahnya menjadi:

```java
public class InvoiceService {
    public BigDecimal calculateTotal(Invoice invoice) {
        return invoice.getSubtotal().add(invoice.getTax());
    }
}
```

Di `feature`, commit `E-F` mengubahnya menjadi:

```java
public class InvoiceService {
    public BigDecimal calculateTotal(Invoice invoice) {
        return invoice.getSubtotal().subtract(invoice.getDiscount());
    }
}
```

Git melihat:

```text
Base : return subtotal
Ours : return subtotal + tax
Theirs: return subtotal - discount
```

Git tidak tahu business rule final yang benar:

```java
return subtotal.add(tax).subtract(discount);
```

atau:

```java
return subtotal.subtract(discount).add(tax);
```

atau mungkin tax harus dihitung setelah discount.

Git hanya melihat teks. Git tidak memahami domain invoice.

Maka Git menandai conflict.

---

# 7. Git Merge Tidak Menjamin Semantic Correctness

Ini prinsip penting:

```text
Merge yang berhasil secara teknis belum tentu benar secara semantik.
```

Git bisa auto-merge jika dua branch mengubah bagian file yang berbeda.

Contoh:

Branch `main`:

```java
public boolean isEligible(Customer customer) {
    return customer.isActive();
}
```

Branch feature menambahkan method baru:

```java
public BigDecimal calculateFee(Customer customer) {
    return customer.isPremium() ? BigDecimal.ZERO : DEFAULT_FEE;
}
```

Secara teks, tidak conflict.

Tetapi secara domain, perubahan eligibility di branch lain mungkin harus memengaruhi fee calculation. Git tidak bisa tahu.

Contoh semantic conflict:

- branch A mengubah default currency dari `USD` ke `IDR`,
- branch B menambah fee calculation dengan asumsi `USD`,
- Git auto-merge sukses,
- production bug muncul karena asumsi business berbeda.

Karena itu, merge harus diikuti oleh:

- test,
- review,
- build,
- domain validation,
- sometimes manual integration testing,
- observability setelah deploy.

---

# 8. Command Dasar Merge

## 8.1 Merge Branch ke Branch Saat Ini

```bash
git switch main
git merge feature/payment-validation
```

Artinya:

```text
Integrasikan feature/payment-validation ke branch yang sedang aktif, yaitu main.
```

## 8.2 Melihat Branch Saat Ini

```bash
git branch --show-current
```

atau:

```bash
git status
```

Biasakan melihat state sebelum merge:

```bash
git status
git log --oneline --graph --decorate --all --max-count=20
```

## 8.3 Membatalkan Merge yang Belum Selesai

Jika conflict terjadi dan ingin kembali ke state sebelum merge:

```bash
git merge --abort
```

Ini penting. Jangan panik saat conflict.

Selama merge belum dicommit, Git memiliki state merge in-progress. `--abort` mencoba mengembalikan working tree ke kondisi sebelum merge.

## 8.4 Membuat Merge Commit Walaupun Fast-Forward Mungkin

```bash
git merge --no-ff feature/payment-validation
```

`--no-ff` memaksa Git membuat merge commit meskipun fast-forward bisa dilakukan.

Gunanya:

- mempertahankan boundary branch,
- menunjukkan bahwa sekumpulan commit adalah satu integration event,
- membantu audit,
- membantu revert satu feature melalui merge commit,
- cocok untuk feature besar.

## 8.5 Hanya Izinkan Fast-Forward

```bash
git merge --ff-only origin/main
```

Ini berarti:

```text
Merge hanya boleh terjadi jika cukup dengan memajukan pointer.
Jika perlu merge commit, batalkan.
```

Cocok untuk sinkronisasi branch lokal dengan remote jika ingin menghindari merge commit tidak sengaja.

Contoh:

```bash
git switch main
git fetch origin
git merge --ff-only origin/main
```

Jika gagal, berarti local `main` diverge dari `origin/main`.

---

# 9. Merge State: Apa yang Terjadi Saat Merge Dimulai

Ketika merge berjalan tanpa conflict, Git langsung membuat hasil akhir:

- fast-forward: pointer branch digeser,
- true merge: merge commit dibuat.

Ketika conflict terjadi, Git masuk ke state khusus:

```text
MERGING
```

Pada kondisi ini:

- working tree berisi file dengan conflict marker,
- index memiliki staged entries khusus untuk conflict,
- `.git/MERGE_HEAD` menyimpan commit yang sedang dimerge,
- `.git/MERGE_MSG` menyimpan template message merge,
- `.git/ORIG_HEAD` biasanya menunjuk state sebelum operasi berisiko.

Kita tidak harus menghafal semua file internal ini untuk daily use, tapi penting memahami bahwa Git sedang berada dalam mode operasi belum selesai.

Cek:

```bash
git status
```

Biasanya Git akan memberi instruksi:

```text
You have unmerged paths.
fix conflicts and run "git commit"
use "git merge --abort" to abort the merge
```

---

# 10. Conflict Marker Dasar

Jika conflict terjadi, file bisa berisi:

```java
public BigDecimal calculateTotal(Invoice invoice) {
<<<<<<< HEAD
    return invoice.getSubtotal().add(invoice.getTax());
=======
    return invoice.getSubtotal().subtract(invoice.getDiscount());
>>>>>>> feature/invoice-rule
}
```

Makna:

```text
<<<<<<< HEAD
bagian dari branch saat ini / ours
=======
batas antara ours dan theirs
>>>>>>> feature/invoice-rule
bagian dari branch yang sedang dimerge / theirs
```

Namun hati-hati:

- pada merge, `ours` biasanya branch aktif,
- pada rebase, persepsi `ours/theirs` bisa terasa terbalik karena commit sedang direplay,
- detail conflict resolution akan dibahas lebih dalam pada part 011.

Untuk part ini, cukup pegang prinsip:

```text
Conflict marker adalah permintaan Git kepada manusia untuk menentukan snapshot final yang benar.
```

---

# 11. Membaca Merge dengan `git log`

## 11.1 Melihat Graph

```bash
git log --oneline --graph --decorate --all
```

Contoh output:

```text
*   a1b2c3d (HEAD -> main) Merge branch 'feature/invoice-rule'
|\
| * e5f6a7b Add discount rule
| * d4c3b2a Add invoice validation
* | c9d8e7f Update tax calculation
* | b8a7c6d Refactor customer status
|/
* 123abcd Base invoice service
```

Baca dari atas:

- `a1b2c3d` adalah merge commit,
- garis `|\` menunjukkan dua parent,
- satu sisi adalah history `main`,
- satu sisi adalah history feature.

## 11.2 Menampilkan Merge Commit Saja

```bash
git log --merges --oneline
```

Berguna untuk melihat integration events.

## 11.3 Menyembunyikan Merge Commit

```bash
git log --no-merges --oneline
```

Berguna untuk melihat commit perubahan biasa tanpa noise merge.

## 11.4 Melihat Parent Merge Commit

```bash
git show --summary --pretty=raw <merge-commit>
```

Contoh konseptual:

```text
commit a1b2c3d
parent c9d8e7f
parent e5f6a7b
author ...
committer ...

    Merge branch 'feature/invoice-rule'
```

Parent pertama dan kedua sangat penting ketika melakukan revert merge commit nanti.

---

# 12. Merge Commit: Informasi atau Noise?

Tidak semua merge commit buruk. Tidak semua merge commit baik.

Pertanyaan yang lebih benar:

```text
Apakah merge commit ini membawa informasi integrasi yang berguna?
```

## 12.1 Merge Commit yang Berguna

Merge commit berguna jika ia menunjukkan event integrasi yang bermakna.

Contoh:

```text
Merge feature/regulatory-case-escalation into main
```

Branch tersebut berisi:

- perubahan domain model,
- migration database,
- update service logic,
- update tests,
- update OpenAPI contract,
- update documentation.

Merge commit sebagai boundary membantu menjawab:

```text
Kapan feature escalation resmi masuk mainline?
```

Atau:

```text
Commit mana yang harus direvert jika seluruh feature harus dibatalkan?
```

## 12.2 Merge Commit yang Noise

Merge commit menjadi noise jika dibuat tidak sengaja karena `git pull` default merge pada branch lokal.

Contoh history buruk:

```text
Merge branch 'main' of github.com:org/repo into main
Merge remote-tracking branch 'origin/main'
Merge branch 'main' into feature/foo
Merge branch 'main' into feature/foo
Merge branch 'main' into feature/foo
```

Ini sering terjadi karena engineer melakukan:

```bash
git pull
```

pada branch yang diverge tanpa memahami bahwa `pull = fetch + merge`.

Akibatnya:

- history penuh merge kecil yang tidak bermakna,
- review sulit,
- bisect lebih noisy,
- graph sulit dibaca,
- integrasi terlihat lebih kompleks daripada kenyataan.

## 12.3 Prinsip

```text
Merge commit should represent integration intent, not accidental synchronization.
```

---

# 13. `git pull` dan Merge Tidak Sengaja

`git pull` secara konseptual adalah:

```bash
git fetch
git merge
```

atau jika dikonfigurasi rebase:

```bash
git fetch
git rebase
```

Masalah terjadi ketika engineer menganggap `git pull` hanya “update local”. Padahal ia juga melakukan operasi integrasi.

Contoh:

```text
origin/main: A---B---C
local main : A---B---D
```

Jika menjalankan:

```bash
git pull
```

Git mungkin membuat merge commit:

```text
      C
     / \
A---B---M  local main
     \ /
      D
```

Jika commit `D` seharusnya tidak ada di local main, history menjadi kotor.

Praktik lebih aman:

```bash
git fetch origin
git status
git log --oneline --graph --decorate --all --max-count=20
```

Lalu pilih secara sadar:

```bash
git merge --ff-only origin/main
```

atau:

```bash
git rebase origin/main
```

tergantung konteks.

---

# 14. Merge vs Rebase: Perbedaan Konseptual

Part 009 akan membahas rebase secara dalam. Di sini kita cukup bandingkan secara strategis.

Merge:

```text
Menyatukan dua garis sejarah dan mempertahankan fakta bahwa keduanya pernah diverge.
```

Rebase:

```text
Membuat ulang commit di atas base baru sehingga history tampak linear.
```

Contoh sebelum:

```text
      C---D  main
     /
A---B
     \
      E---F  feature
```

Merge menghasilkan:

```text
      C---D------M  main
     /          /
A---B          /
     \        /
      E---F--/  feature
```

Rebase feature ke main menghasilkan:

```text
A---B---C---D  main
             \
              E'---F'  feature
```

Lalu fast-forward merge:

```text
A---B---C---D---E'---F'  main
```

Merge mempertahankan topology. Rebase membuat history linear dengan commit baru.

---

# 15. Kapan Merge Lebih Tepat daripada Rebase

Merge lebih tepat ketika:

## 15.1 History Sudah Public dan Dipakai Banyak Orang

Jika branch sudah dipush dan dipakai bersama, merge lebih aman daripada rewrite.

```text
Public shared history should generally be preserved.
```

Rebase akan membuat commit baru dan bisa menyulitkan orang lain yang sudah berbasis pada commit lama.

## 15.2 Ingin Menjaga Konteks Integrasi

Feature besar sering lebih jelas jika history menunjukkan branch boundary.

Contoh:

```text
Merge feature/case-management-state-machine
```

Dari sisi audit, ini menunjukkan satu event integrasi yang penting.

## 15.3 Branch Mengandung Banyak Commit Kolaboratif

Jika banyak engineer bekerja di branch yang sama, rewrite history bisa berbahaya.

Merge menjaga kontribusi apa adanya.

## 15.4 Release Branch dan Hotfix Branch

Dalam release management, merge commit sering berguna untuk menunjukkan:

- kapan hotfix masuk release branch,
- kapan release branch masuk main,
- kapan backport dilakukan,
- kapan stabilization branch diintegrasikan.

## 15.5 Regulated / Audit-Heavy Environment

Dalam lingkungan yang membutuhkan traceability, merge commit bisa menjadi bukti integration checkpoint.

Contoh pertanyaan audit:

```text
Perubahan mana saja yang masuk release 2.8.0?
Kapan rule enforcement lifecycle v3 masuk mainline?
Siapa yang menyetujui integrasi?
Apakah ada CI green pada merge point?
```

Walaupun PR metadata sering menyimpan approval dan CI, merge commit tetap bisa menjadi anchor Git-level.

---

# 16. Kapan Rebase Biasanya Lebih Tepat daripada Merge

Rebase biasanya lebih tepat ketika:

- branch masih private/local,
- ingin membersihkan commit sebelum PR,
- ingin menghindari merge commit sinkronisasi kecil,
- branch pendek,
- tim mengutamakan linear history,
- commit belum dipakai orang lain.

Contoh:

```bash
git switch feature/small-validation
git fetch origin
git rebase origin/main
```

Lalu PR menjadi lebih mudah direview.

Tetapi ingat: rebase akan dibahas detail di part 009.

---

# 17. Merge Strategy secara Ringkas

Git memiliki beberapa strategy dan option. Untuk mayoritas engineer, yang penting adalah memahami default strategy modern dan beberapa opsi umum.

## 17.1 Default Strategy Modern: `ort`

Versi Git modern menggunakan strategy `ort` untuk two-head merge. Secara praktis, ini adalah penerus dari recursive strategy dan dirancang lebih cepat serta lebih baik pada beberapa kasus rename/conflict.

Sebagai user, biasanya tidak perlu memilih strategy secara manual.

Cukup pahami:

```text
Git mencoba three-way merge berbasis merge base, ours, dan theirs.
```

## 17.2 `--strategy-option=ours` Bukan Sama dengan Strategy `ours`

Ada dua konsep yang sering membingungkan.

Opsi:

```bash
git merge -X ours feature
```

Artinya:

```text
Saat ada conflict, prefer perubahan branch saat ini.
```

Sedangkan strategy:

```bash
git merge -s ours feature
```

Artinya:

```text
Buat merge commit, tetapi hasil tree memakai branch saat ini dan mengabaikan isi branch lain.
```

Ini sangat berbeda.

`-s ours` adalah operasi khusus yang biasanya dipakai untuk menandai branch sudah “dianggap tergabung” tanpa mengambil kontennya. Jangan gunakan sembarangan.

## 17.3 `-X theirs`

```bash
git merge -X theirs feature
```

Saat conflict, prefer sisi branch yang dimerge.

Namun ini bukan jaminan semantic correctness. Untuk Java/domain logic, memilih “theirs” otomatis bisa menghapus perubahan penting di branch aktif.

Gunakan dengan hati-hati.

---

# 18. Squash Merge

Squash merge sering tersedia di platform seperti GitHub/GitLab/Bitbucket.

Secara konseptual:

```text
Ambil seluruh perubahan dari branch feature, lalu masukkan sebagai satu commit baru di branch tujuan.
```

Contoh sebelum:

```text
A---B---C  main
     \
      D---E---F  feature
```

Squash merge menghasilkan:

```text
A---B---C---S  main
     \
      D---E---F  feature
```

`S` adalah commit baru yang berisi total perubahan `D-E-F`, tetapi tidak punya parent ke `F`.

## 18.1 Kelebihan Squash Merge

- history main lebih ringkas,
- commit kecil/noisy di feature tidak masuk main,
- cocok untuk PR yang commit internalnya berantakan,
- memudahkan revert satu PR sebagai satu commit,
- cocok untuk tim yang review berbasis PR, bukan commit-by-commit.

## 18.2 Kekurangan Squash Merge

- kehilangan struktur commit asli,
- kehilangan topology branch,
- sulit melihat evolusi internal feature,
- attribution commit bisa berubah tergantung platform,
- branch feature tidak dianggap merged secara graph murni,
- repeated squash dari branch yang sama bisa membingungkan.

## 18.3 Squash Merge Bukan True Merge Commit

Ini penting:

```text
Squash merge tidak menghasilkan merge commit dua parent.
```

Ia menghasilkan commit biasa dengan satu parent.

Jadi dari sudut pandang Git graph, history feature tidak benar-benar tersambung ke main.

## 18.4 Kapan Squash Merge Cocok

Cocok ketika:

- PR kecil sampai menengah,
- commit branch tidak bernilai sebagai narasi permanen,
- tim ingin mainline bersih,
- PR metadata menjadi sumber konteks review,
- setiap PR dianggap satu unit perubahan.

## 18.5 Kapan Squash Merge Kurang Cocok

Kurang cocok ketika:

- commit individual penting untuk audit,
- feature besar memiliki tahap evolusi yang penting,
- branch dikerjakan kolaboratif oleh banyak orang,
- release engineering membutuhkan topology lengkap,
- ingin mempertahankan merge boundary Git-level.

---

# 19. Merge Commit Message

Default merge message sering seperti:

```text
Merge branch 'feature/payment-validation'
```

Untuk merge kecil, ini mungkin cukup. Untuk feature besar, message yang lebih informatif lebih baik.

Contoh buruk:

```text
Merge branch 'feature/foo'
```

Contoh lebih baik:

```text
Merge feature/payment-validation into main

Integrates payment validation rules for card, bank transfer, and virtual account flows.

Key changes:
- adds PaymentValidationService
- adds rule-based validation for payment method constraints
- updates checkout API response for invalid payment state
- adds integration tests for invalid payment transitions

Operational notes:
- no database migration
- backward compatible API response structure
- guarded by payment.validation.v2 feature flag

PR: #1842
```

Manfaat:

- reviewer memahami scope,
- future debugging lebih cepat,
- release notes lebih mudah,
- audit trail lebih jelas,
- revert decision lebih informed.

---

# 20. Merge dan Testing

Merge adalah titik risiko.

Sebelum merge:

```text
Feature branch tests pass.
Main branch tests pass.
```

Belum tentu:

```text
Merged result tests pass.
```

Karena hasil merge bisa menciptakan kombinasi state baru yang belum pernah dites.

## 20.1 Minimal Validation untuk Java Backend

Sebelum merge ke main:

```bash
./mvnw clean test
```

atau:

```bash
./gradlew clean test
```

Untuk project besar:

```bash
./mvnw clean verify
```

atau:

```bash
./gradlew clean check
```

CI sebaiknya menjalankan:

- compile,
- unit test,
- integration test relevan,
- static analysis,
- formatting/lint,
- dependency/security scan,
- contract test jika API berubah,
- migration validation jika database berubah.

## 20.2 Merge Queue / Merge Train

Pada repository aktif, PR bisa green secara individual tetapi gagal setelah digabung dengan PR lain.

Contoh:

```text
PR A green against main@100
PR B green against main@100
PR A merged -> main@101
PR B now stale, but still appears green from previous base
PR B merged -> breaks main
```

Solusi modern:

- require branch up-to-date before merge,
- merge queue,
- merge train,
- test final merged result,
- batch merge dengan validasi.

Untuk tim besar, merge policy bukan sekadar preferensi estetika history. Ia memengaruhi stabilitas mainline.

---

# 21. Merge dalam Pull Request Platform

Platform biasanya menawarkan beberapa opsi:

1. Merge commit
2. Squash and merge
3. Rebase and merge

## 21.1 Merge Commit via PR

Graph mempertahankan branch topology.

Cocok untuk:

- feature besar,
- audit-heavy flow,
- integration event penting,
- branch release/hotfix.

## 21.2 Squash and Merge

Main hanya mendapat satu commit per PR.

Cocok untuk:

- feature branch berisi commit WIP,
- tim ingin mainline ringkas,
- PR kecil/menengah,
- revert per PR mudah.

## 21.3 Rebase and Merge

Commit dari branch ditempatkan linear di atas main tanpa merge commit.

Cocok jika:

- commit individual berkualitas,
- tim ingin linear history,
- branch tidak terlalu panjang,
- commit-by-commit review bernilai.

## 21.4 Tidak Ada Opsi Universal

Pilihan merge harus mengikuti prinsip:

```text
History shape should serve debugging, review, release, and audit needs.
```

Bukan:

```text
History harus linear karena terlihat rapi.
```

atau:

```text
History harus penuh merge commit karena semua konteks harus terlihat.
```

---

# 22. Merge Policy untuk Tim Java

Berikut contoh kebijakan yang sehat untuk tim Java backend/microservices.

## 22.1 Untuk PR Kecil

Contoh:

- bugfix kecil,
- test update,
- rename sederhana,
- config minor,
- refactor lokal.

Policy:

```text
Squash merge atau rebase merge.
```

Syarat:

- PR title jelas,
- commit final jelas,
- test green,
- tidak ada migration berisiko.

## 22.2 Untuk Feature Menengah

Contoh:

- endpoint baru,
- service baru,
- validation rule baru,
- perubahan flow kecil.

Policy:

```text
Squash merge jika commit internal tidak penting.
Merge commit jika ingin mempertahankan boundary feature.
```

Syarat:

- PR description menjelaskan scope,
- integration test cukup,
- backward compatibility dicek,
- observability/logging jika behavior production berubah.

## 22.3 Untuk Feature Besar / Cross-Cutting

Contoh:

- perubahan state machine,
- database migration besar,
- authorization model baru,
- enforcement lifecycle baru,
- perubahan contract lintas service.

Policy:

```text
Merge commit dengan message informatif.
```

Syarat:

- branch pendek atau diintegrasikan bertahap,
- feature flag jika memungkinkan,
- migration plan,
- rollback/roll-forward plan,
- contract compatibility,
- release note,
- architecture decision record jika perlu.

## 22.4 Untuk Release Branch

Policy:

```text
Merge commit atau cherry-pick terkontrol.
```

Syarat:

- semua commit traceable,
- tag release jelas,
- hotfix dicatat,
- backport terdokumentasi.

## 22.5 Untuk Hotfix Production

Policy:

```text
Buat branch dari production tag atau release branch.
Merge/cherry-pick kembali ke main dengan traceability.
```

Syarat:

- issue/incident ID,
- test minimal yang membuktikan bug fix,
- release tag baru,
- post-incident linkage.

---

# 23. Anti-Pattern Merge

## 23.1 Merge `main` ke Feature Terlalu Sering Tanpa Alasan

```bash
git switch feature/foo
git merge main
```

Dilakukan berkali-kali hanya agar “up to date”.

Masalah:

- history feature penuh merge commit,
- review sulit,
- conflict bisa tersebar,
- branch tampak lebih kompleks.

Alternatif:

- rebase feature jika private,
- merge main hanya ketika perlu validasi integrasi nyata,
- gunakan short-lived branch.

## 23.2 Merge Tanpa Membaca Diff

```bash
git merge feature/foo
# conflict selesai asal pilih
# commit
```

Masalah:

- semantic conflict lolos,
- behavior berubah diam-diam,
- test mungkin tidak cukup,
- production bug.

Praktik sehat:

```bash
git diff ORIG_HEAD..HEAD
```

atau review final merged result sebelum push.

## 23.3 Merge Commit dengan Message Tidak Berguna

```text
Merge branch 'x'
```

Untuk feature besar, ini kehilangan kesempatan dokumentasi.

## 23.4 Merge Branch yang Terlalu Lama Hidup

Branch lama cenderung:

- makin jauh dari main,
- conflict makin besar,
- asumsi makin stale,
- review makin sulit,
- risiko integration hell makin tinggi.

Solusi:

- integrasi kecil bertahap,
- feature flag,
- trunk-based development,
- modular commits,
- PR kecil.

## 23.5 Menggunakan `-X ours` atau `-X theirs` untuk Menghindari Berpikir

Ini sangat berbahaya.

Conflict adalah sinyal bahwa ada dua evolusi yang perlu disintesiskan. Menggunakan opsi preferensi otomatis bisa benar pada kasus mekanis, tetapi buruk pada domain logic.

## 23.6 Merge Generated Files Tanpa Policy

Java project sering memiliki generated files:

- OpenAPI generated clients,
- protobuf generated code,
- annotation processing output,
- build output,
- generated migration metadata,
- lockfiles.

Jika policy tidak jelas, merge conflict bisa terjadi pada file yang seharusnya tidak dicommit.

---

# 24. Merge dan Java-Specific Risk

## 24.1 Import Conflict

Java import sering auto-organized oleh IDE.

Conflict kecil:

```java
<<<<<<< HEAD
import java.time.Clock;
=======
import java.time.Instant;
>>>>>>> feature
```

Solusi bukan sekadar memilih salah satu. Mungkin keduanya dibutuhkan.

## 24.2 Method Signature Conflict

Branch A:

```java
public CaseDecision evaluate(CaseContext context)
```

Branch B:

```java
public CaseDecision evaluate(CaseContext context, EvaluationOptions options)
```

Merge bisa conflict atau auto-merge dengan compile failure di call site lain.

Validation:

```bash
./mvnw test
```

atau setidaknya compile module terkait.

## 24.3 Dependency Conflict

Branch A update dependency:

```xml
<version>2.17.0</version>
```

Branch B update dependency:

```xml
<version>2.18.1</version>
```

Git mungkin conflict di `pom.xml`, tetapi keputusan benar memerlukan memahami:

- compatibility,
- transitive dependency,
- security CVE,
- binary compatibility,
- runtime behavior.

## 24.4 Migration Conflict

Branch A menambah migration:

```text
V42__add_case_priority.sql
```

Branch B juga menambah:

```text
V42__add_escalation_reason.sql
```

Git tidak selalu conflict jika file berbeda, tetapi migration tool seperti Flyway akan conflict secara runtime karena version number sama.

Ini semantic conflict.

Solusi:

- rename salah satu migration,
- cek ordering,
- cek backward compatibility,
- jalankan migration di database kosong dan database existing.

## 24.5 Config Conflict

Branch A:

```yaml
case:
  escalation:
    enabled: true
```

Branch B:

```yaml
case:
  escalation:
    threshold-days: 14
```

Auto-merge bisa sukses, tapi config final mungkin tidak valid jika feature flag belum siap.

---

# 25. Practical Merge Workflow

Gunakan workflow sadar state.

## 25.1 Sebelum Merge

```bash
git status
```

Pastikan working tree bersih.

```bash
git fetch origin
```

Update informasi remote.

```bash
git log --oneline --graph --decorate --all --max-count=30
```

Pahami graph.

```bash
git diff main...feature/payment-validation
```

Lihat perubahan feature terhadap merge base.

## 25.2 Merge

```bash
git switch main
git merge --no-ff feature/payment-validation
```

atau jika ingin fast-forward only:

```bash
git merge --ff-only feature/payment-validation
```

## 25.3 Jika Conflict

```bash
git status
```

Buka file conflict, selesaikan dengan domain understanding.

Setelah selesai:

```bash
git add <resolved-files>
git status
git commit
```

atau jika ingin batal:

```bash
git merge --abort
```

## 25.4 Setelah Merge

```bash
git log --oneline --graph --decorate --max-count=20
```

Verifikasi graph.

```bash
git diff ORIG_HEAD..HEAD
```

Review hasil gabungan.

Jalankan test:

```bash
./mvnw clean test
```

atau:

```bash
./gradlew clean test
```

Jika semua aman:

```bash
git push origin main
```

---

# 26. Lab Praktis: Fast-Forward vs Merge Commit

Buat repository latihan:

```bash
mkdir git-merge-lab
cd git-merge-lab
git init
```

Buat file awal:

```bash
cat > App.java <<'EOF'
public class App {
    public static void main(String[] args) {
        System.out.println("v1");
    }
}
EOF

git add App.java
git commit -m "Initial app"
```

Buat branch feature:

```bash
git switch -c feature/greeting
```

Ubah file:

```bash
cat > App.java <<'EOF'
public class App {
    public static void main(String[] args) {
        System.out.println("hello");
    }
}
EOF

git add App.java
git commit -m "Change greeting output"
```

Kembali ke main:

```bash
git switch main
```

Lihat graph:

```bash
git log --oneline --graph --decorate --all
```

Merge fast-forward:

```bash
git merge feature/greeting
```

Lihat graph lagi:

```bash
git log --oneline --graph --decorate --all
```

Observasi:

- apakah merge commit dibuat?
- pointer mana yang berubah?
- kenapa fast-forward mungkin?

---

# 27. Lab Praktis: True Merge

Reset lab atau buat repo baru.

```bash
mkdir git-true-merge-lab
cd git-true-merge-lab
git init
```

Commit awal:

```bash
cat > InvoiceService.java <<'EOF'
import java.math.BigDecimal;

public class InvoiceService {
    public BigDecimal calculateTotal(BigDecimal subtotal) {
        return subtotal;
    }
}
EOF

git add InvoiceService.java
git commit -m "Add invoice service"
```

Buat branch feature:

```bash
git switch -c feature/discount
```

Ubah feature:

```bash
cat > InvoiceService.java <<'EOF'
import java.math.BigDecimal;

public class InvoiceService {
    public BigDecimal calculateTotal(BigDecimal subtotal, BigDecimal discount) {
        return subtotal.subtract(discount);
    }
}
EOF

git add InvoiceService.java
git commit -m "Apply discount to invoice total"
```

Kembali ke main dan buat perubahan berbeda:

```bash
git switch main
cat > InvoiceService.java <<'EOF'
import java.math.BigDecimal;

public class InvoiceService {
    public BigDecimal calculateTotal(BigDecimal subtotal, BigDecimal tax) {
        return subtotal.add(tax);
    }
}
EOF

git add InvoiceService.java
git commit -m "Apply tax to invoice total"
```

Sekarang graph diverge:

```bash
git log --oneline --graph --decorate --all
```

Merge feature:

```bash
git merge feature/discount
```

Kemungkinan conflict. Buka file:

```bash
cat InvoiceService.java
```

Selesaikan menjadi:

```java
import java.math.BigDecimal;

public class InvoiceService {
    public BigDecimal calculateTotal(BigDecimal subtotal, BigDecimal tax, BigDecimal discount) {
        return subtotal.add(tax).subtract(discount);
    }
}
```

Stage dan commit:

```bash
git add InvoiceService.java
git commit
```

Lihat graph:

```bash
git log --oneline --graph --decorate --all
```

Pertanyaan reflektif:

1. Commit merge punya berapa parent?
2. Apa merge base-nya?
3. Mengapa Git tidak bisa menentukan business rule final sendiri?
4. Apakah hasil compile jika call site belum diubah?
5. Test apa yang seharusnya ditambahkan?

---

# 28. Lab Praktis: Semantic Conflict yang Tidak Terdeteksi Git

Buat contoh:

```bash
mkdir git-semantic-merge-lab
cd git-semantic-merge-lab
git init
```

File awal:

```bash
cat > Policy.java <<'EOF'
public class Policy {
    public static final String DEFAULT_CURRENCY = "USD";

    public int calculateFee(int amount) {
        return amount / 100;
    }
}
EOF

git add Policy.java
git commit -m "Add policy defaults"
```

Branch A mengubah currency:

```bash
git switch -c feature/local-currency
sed -i.bak 's/"USD"/"IDR"/' Policy.java
rm -f Policy.java.bak
git add Policy.java
git commit -m "Change default currency to IDR"
```

Kembali ke main, branch B menambah fee logic:

```bash
git switch main
git switch -c feature/minimum-fee
python3 - <<'PY'
from pathlib import Path
p = Path('Policy.java')
s = p.read_text()
s = s.replace('return amount / 100;', 'return Math.max(1, amount / 100);')
p.write_text(s)
PY

git add Policy.java
git commit -m "Add minimum fee"
```

Merge currency:

```bash
git merge feature/local-currency
```

Mungkin auto-merge sukses.

Pertanyaan:

1. Apakah Git mendeteksi conflict?
2. Apakah `Math.max(1, amount / 100)` masih benar untuk IDR?
3. Apakah minimum fee `1` berarti 1 USD atau 1 IDR?
4. Test apa yang gagal atau seharusnya dibuat?

Pelajaran:

```text
Auto-merge success is not domain correctness.
```

---

# 29. Decision Matrix: Merge Mode

| Situasi | Pilihan Umum | Alasan |
|---|---|---|
| Branch lokal pendek, commit rapi | rebase lalu fast-forward | linear, bersih |
| PR kecil dengan commit WIP | squash merge | satu unit perubahan |
| Feature besar dengan konteks penting | merge commit | menjaga boundary integrasi |
| Release branch | merge commit/cherry-pick | traceability |
| Hotfix production | branch dari tag + merge/cherry-pick balik | audit dan kontrol |
| Shared branch aktif | merge | hindari rewrite history |
| Local main update dari origin | merge `--ff-only` | hindari merge tak sengaja |
| Ingin hanya sync remote-tracking info | fetch | tidak mengubah working branch |
| Branch sangat stale | evaluasi ulang, rebase/merge bertahap | kurangi conflict besar |

---

# 30. Checklist Sebelum Merge ke Main

Gunakan checklist ini sebelum merge PR penting.

```text
[ ] Apakah branch target benar?
[ ] Apakah working tree bersih?
[ ] Apakah branch sudah berdasarkan main terbaru atau merge queue akan menangani?
[ ] Apakah diff sudah direview terhadap merge base?
[ ] Apakah commit/PR scope jelas?
[ ] Apakah ada migration database?
[ ] Apakah ada perubahan API contract?
[ ] Apakah ada perubahan config/feature flag?
[ ] Apakah generated files sesuai policy?
[ ] Apakah dependency berubah?
[ ] Apakah test relevan sudah berjalan?
[ ] Apakah ada risiko semantic conflict?
[ ] Apakah merge mode sesuai kebijakan tim?
[ ] Apakah rollback/revert strategy jelas?
```

---

# 31. Checklist Setelah Merge

```text
[ ] Graph terlihat sesuai ekspektasi.
[ ] Tidak ada conflict marker tertinggal.
[ ] Build/test berjalan.
[ ] CI green pada hasil merge final.
[ ] Release note/changelog ter-update jika perlu.
[ ] Branch feature boleh dihapus jika sudah tidak diperlukan.
[ ] Jika feature besar, observability/monitoring siap.
[ ] Jika hotfix, perubahan sudah dibawa balik ke main/develop sesuai policy.
```

Cek conflict marker tersisa:

```bash
git grep -n '<<<<<<<\|=======\|>>>>>>>'
```

Jika output muncul, jangan push/merge.

---

# 32. Common Failure Scenarios dan Recovery Ringkas

## 32.1 Salah Merge Branch

Jika merge belum commit:

```bash
git merge --abort
```

Jika merge commit sudah dibuat tapi belum push:

```bash
git reset --hard ORIG_HEAD
```

Hati-hati: `reset --hard` menghapus perubahan working tree. Pastikan tidak ada pekerjaan penting yang belum disimpan.

Jika merge commit sudah push ke shared branch:

```bash
git revert -m 1 <merge-commit>
```

Detail revert merge akan dibahas di part 016.

## 32.2 Conflict Resolution Salah

Jika belum commit:

```bash
git checkout --conflict=merge -- <file>
```

atau abort dan ulang:

```bash
git merge --abort
```

Jika sudah commit tapi belum push:

```bash
git reset --hard ORIG_HEAD
```

Jika sudah push:

- buat commit koreksi, atau
- revert merge commit jika seluruh merge harus dibatalkan.

## 32.3 Merge Commit Tidak Sengaja karena `git pull`

Jika belum push dan ingin membatalkan:

```bash
git reset --hard ORIG_HEAD
```

Kemudian sinkronisasi dengan cara sadar:

```bash
git fetch origin
git merge --ff-only origin/main
```

atau rebase jika sesuai:

```bash
git rebase origin/main
```

---

# 33. Git Merge sebagai Engineering Communication

Merge adalah komunikasi.

Ia menjawab:

```text
Perubahan dari garis sejarah mana yang sekarang menjadi bagian dari garis sejarah ini?
```

Untuk engineer junior, merge sering terlihat sebagai operasi teknis.

Untuk engineer kuat, merge adalah titik integrasi yang menggabungkan:

- code state,
- domain intent,
- review result,
- CI validation,
- release readiness,
- rollback strategy,
- audit trail.

Jika sebuah merge menyebabkan production incident, pertanyaan investigasi biasanya bukan hanya:

```text
Siapa yang merge?
```

Tetapi:

```text
Apa yang digabung?
Apa base-nya?
Apakah branch stale?
Apakah test final merged result berjalan?
Apakah semantic conflict terdeteksi?
Apakah PR terlalu besar?
Apakah merge policy cocok untuk risiko perubahan?
Apakah release governance memadai?
```

Git merge berada di tengah antara mechanics dan engineering process.

---

# 34. Ringkasan Mental Model

Pegang beberapa invariants berikut:

```text
1. Branch adalah pointer.
2. Merge mengintegrasikan sejarah branch ke branch aktif.
3. Fast-forward hanya memindahkan pointer.
4. True merge membuat commit baru dengan lebih dari satu parent.
5. Three-way merge membandingkan merge base, ours, dan theirs.
6. Git hanya memahami teks dan snapshot, bukan domain intent.
7. Conflict teknis hanyalah sebagian dari risiko integrasi.
8. Merge commit bisa menjadi informasi penting atau noise.
9. Merge mode harus mengikuti kebutuhan review, debugging, release, dan audit.
10. Merge yang sukses harus divalidasi sebagai state final baru, bukan diasumsikan benar.
```

---

# 35. Latihan Reflektif

Jawab tanpa menjalankan command terlebih dahulu:

1. Jika `main` berada tepat di ancestor branch feature, merge jenis apa yang terjadi?
2. Jika `main` dan feature sama-sama punya commit baru sejak common ancestor, apa yang dibutuhkan Git?
3. Apa perbedaan merge commit dan squash merge?
4. Kenapa auto-merge sukses belum tentu aman?
5. Kenapa merge commit bisa berguna untuk audit?
6. Kenapa `git pull` bisa membuat merge commit tidak sengaja?
7. Mengapa `git merge --ff-only` sering lebih aman untuk update local main?
8. Kapan `--no-ff` masuk akal?
9. Mengapa branch release/hotfix sering lebih cocok mempertahankan merge boundary?
10. Apa test minimal setelah conflict resolution di project Java?

---

# 36. Kesalahan Cara Berpikir yang Harus Dihindari

## 36.1 “Conflict selesai berarti merge benar”

Tidak. Conflict selesai hanya berarti file tidak lagi memiliki unresolved conflict dari sudut pandang Git.

Correctness harus dibuktikan dengan compile, test, review, dan domain reasoning.

## 36.2 “Merge commit selalu jelek”

Tidak. Merge commit yang disengaja bisa sangat berguna.

Yang jelek adalah merge commit tidak sengaja dan tidak informatif.

## 36.3 “Linear history selalu lebih profesional”

Tidak selalu. Linear history bagus untuk readability, tetapi bisa menghilangkan topology integrasi yang penting.

## 36.4 “Squash merge selalu paling bersih”

Squash membuat main ringkas, tetapi menghapus struktur commit internal.

Ini trade-off, bukan kebenaran mutlak.

## 36.5 “Git tahu cara menggabungkan logic”

Git tidak memahami Java semantics, business rules, framework behavior, dependency compatibility, atau database migration ordering.

---

# 37. Koneksi ke Part Berikutnya

Merge mempertahankan topology sejarah. Rebase mengambil pendekatan berbeda: ia **menulis ulang commit** agar tampak seolah-olah perubahan dibuat di atas base baru.

Setelah memahami merge, kita siap membahas:

```text
learn-git-mastery-for-java-engineers-part-009.md
```

Topik:

```text
Rebase: Memindahkan Perubahan dengan Aman
```

Rebase akan lebih mudah dipahami jika kita membawa mental model dari part ini:

```text
Merge preserves history topology.
Rebase rewrites commit placement.
```

---

# 38. Status Akhir Part Ini

```text
Part 008 selesai.
Seri belum selesai.
Progress saat ini: 008 / 032.
Bagian terakhir seri ini: learn-git-mastery-for-java-engineers-part-032.md.
```


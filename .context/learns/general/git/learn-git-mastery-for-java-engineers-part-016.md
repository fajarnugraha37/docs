# learn-git-mastery-for-java-engineers-part-016.md

# Part 016 — Cherry-Pick, Revert, Reset: Memilih Operasi Koreksi yang Tepat

> Seri: **Git Mastery for Java Engineers**  
> Bagian: **016 / 032**  
> Status seri: **Belum selesai**  
> Bagian sebelumnya: `learn-git-mastery-for-java-engineers-part-015.md` — Release, Tagging, Versioning, dan Hotfix  
> Bagian berikutnya: `learn-git-mastery-for-java-engineers-part-017.md` — Recovery: Reflog, Lost Commit, dan Disaster Handling

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita membahas release, tag, versioning, dan hotfix. Pada praktik nyata, setelah release atau selama integrasi harian, cepat atau lambat kamu akan menghadapi situasi seperti ini:

- commit salah masuk ke branch `main`,
- perubahan harus dibatalkan dari production,
- satu fix dari branch lain harus dibawa ke release branch,
- commit lokal perlu dipecah ulang,
- branch feature sudah kacau dan perlu dikembalikan ke titik aman,
- merge salah dilakukan,
- hotfix perlu di-backport ke versi lama,
- revert perlu dilakukan tanpa menghapus jejak audit,
- atau kamu tidak sengaja melakukan `reset --hard`.

Di sinilah banyak engineer yang “bisa Git” mulai panik. Mereka hafal command, tetapi tidak paham konsekuensi graph-nya.

Bagian ini bertujuan membuat kamu bisa memilih operasi koreksi secara sadar:

```text
Apakah saya ingin mengambil perubahan dari commit lain?
Apakah saya ingin membatalkan efek perubahan tapi menjaga history?
Apakah saya ingin memindahkan pointer branch?
Apakah history ini sudah public?
Apakah tindakan ini perlu audit trail?
Apakah perubahan harus aman untuk tim lain?
```

Tiga command utama:

```bash
git cherry-pick
git revert
git reset
```

Ketiganya sering dianggap sama-sama “undo” atau “ambil commit”, padahal model mentalnya berbeda jauh.

---

## 1. Ringkasan Mental Model

Sebelum masuk detail, pegang peta besar ini.

| Command | Pertanyaan yang dijawab | Efek utama | Aman untuk public history? | Membuat commit baru? |
|---|---|---:|---:|---:|
| `cherry-pick` | “Saya mau membawa perubahan dari commit tertentu ke posisi branch sekarang.” | Apply patch dari commit lain ke `HEAD` saat ini | Umumnya aman | Ya, default-nya membuat commit baru |
| `revert` | “Saya mau membatalkan efek commit tertentu tanpa menghapus history.” | Membuat commit baru yang inverse dari commit lama | Ya | Ya |
| `reset` | “Saya mau memindahkan branch/HEAD ke commit lain.” | Mengubah pointer dan opsional index/working tree | Berbahaya jika sudah public | Tidak, kecuali kamu commit lagi setelahnya |

Versi lebih tajam:

```text
cherry-pick = copy effect of commit into current branch
revert      = add inverse effect of commit into current branch
reset       = move current branch pointer, optionally rewrite index and working tree
```

Git documentation menjelaskan `cherry-pick` sebagai operasi yang menerapkan perubahan dari commit yang sudah ada dan merekam commit baru untuk setiap perubahan tersebut. `revert` juga merekam commit baru, tetapi tujuannya membalik efek commit terdahulu. `reset` berbeda: ia mengubah commit yang ditunjuk oleh `HEAD` dan, tergantung mode, dapat memodifikasi index serta working tree.

---

## 2. Problem Inti: “Undo” Itu Kata yang Terlalu Kabur

Banyak masalah Git muncul karena engineer berkata:

```text
Saya mau undo.
```

Tapi “undo” bisa berarti banyak hal.

### 2.1 Undo apa?

Apakah yang ingin dibatalkan adalah:

1. perubahan file yang belum dicommit?
2. staging yang salah?
3. commit lokal terakhir?
4. commit yang sudah dipush?
5. efek perubahan, tapi history harus tetap ada?
6. merge commit?
7. satu commit dari beberapa commit?
8. seluruh branch kembali ke remote?
9. commit tertentu di release branch?
10. perubahan production yang sudah deployed?

Setiap kasus punya command yang berbeda.

### 2.2 Dimensi keputusan

Sebelum memilih command, tanyakan lima hal:

```text
1. Perubahan sudah commit atau belum?
2. Commit sudah dipush atau masih lokal?
3. Branch dipakai orang lain atau private?
4. Butuh audit trail atau boleh rewrite history?
5. Mau membatalkan commit, membatalkan efek commit, atau memindahkan pointer?
```

Inilah bedanya engineer biasa dengan engineer kuat. Engineer biasa langsung menjalankan command. Engineer kuat mengidentifikasi state sekarang dan state target.

---

## 3. Commit Graph Dasar untuk Koreksi

Misalkan branch `main` punya history:

```text
A---B---C---D  main
```

Kemudian kamu menemukan bahwa commit `C` salah.

Ada beberapa kemungkinan target state.

### 3.1 Ingin branch terlihat seperti sebelum C dan D

```text
A---B  main
```

Ini berarti memindahkan pointer branch dari `D` ke `B`.

Command:

```bash
git reset --hard B
```

Tapi ini berbahaya kalau `C` dan `D` sudah public.

### 3.2 Ingin membatalkan efek C tapi tetap menyimpan sejarah

```text
A---B---C---D---E  main
             
E = revert of C
```

Command:

```bash
git revert C
```

History tetap menunjukkan bahwa `C` pernah terjadi, lalu dibatalkan oleh `E`.

### 3.3 Ingin mengambil perubahan C ke branch lain

Misalkan:

```text
A---B---C---D  main
     \
      X---Y    release/1.2
```

Kamu ingin membawa perubahan dari `C` ke `release/1.2`.

```bash
git switch release/1.2
git cherry-pick C
```

Hasil:

```text
A---B---C---D  main
     \
      X---Y---C'  release/1.2
```

`C'` bukan commit yang sama dengan `C`. Isinya mungkin sama atau mirip, tetapi object id-nya berbeda karena parent-nya berbeda.

---

## 4. `git cherry-pick`: Mengambil Efek Commit Tertentu

### 4.1 Definisi mental

`cherry-pick` berarti:

```text
Ambil perubahan yang diperkenalkan oleh commit X,
lalu terapkan perubahan itu di atas HEAD branch saat ini,
dan buat commit baru.
```

Bukan memindahkan commit asli.
Bukan meng-copy node commit secara identik.
Bukan merge branch.

Ia mengambil **patch/effect** dari commit.

### 4.2 Contoh sederhana

History:

```text
A---B---C---D  main
     \
      E---F    release/1.0
```

Commit `C` berisi bugfix penting:

```text
C = fix null handling in PaymentValidator
```

Kamu ingin bugfix itu masuk ke `release/1.0`.

```bash
git switch release/1.0
git cherry-pick C
```

Hasil:

```text
A---B---C---D   main
     \
      E---F---C'  release/1.0
```

`C'` punya perubahan yang sama dengan `C`, tetapi parent-nya adalah `F`, bukan `B`.

### 4.3 Kapan cherry-pick cocok?

Gunakan `cherry-pick` ketika:

- satu bugfix perlu dibawa ke release branch,
- hotfix dari `main` perlu dibawa ke branch versi lama,
- patch security perlu diterapkan ke beberapa versi,
- commit kecil dari branch eksperimen ingin diselamatkan,
- kamu tidak ingin merge seluruh branch,
- kamu hanya perlu satu atau beberapa commit spesifik.

Contoh Java:

```text
main punya commit:
- add experimental Kafka pipeline
- refactor PaymentService
- fix CVE by upgrading vulnerable dependency
- change API response format

release/2.1 hanya butuh fix CVE.
```

Di sini merge seluruh `main` terlalu berisiko. Cherry-pick commit CVE fix lebih masuk akal.

### 4.4 Kapan cherry-pick tidak cocok?

Hindari cherry-pick jika:

- commit yang dipilih bergantung pada banyak commit lain,
- perubahan tersebar dan tidak atomic,
- kamu sebenarnya ingin mengintegrasikan branch secara utuh,
- commit berisi migration yang butuh urutan tertentu,
- commit yang diambil mengubah API contract tanpa commit pendukung,
- kamu tidak memahami dependency konteksnya.

Cherry-pick dari commit non-atomic sering menghasilkan branch yang compile tetapi behavior-nya salah.

### 4.5 Cherry-pick satu commit

```bash
git switch release/1.2
git cherry-pick abc1234
```

Pastikan working tree bersih sebelum menjalankan:

```bash
git status
```

Kalau tidak bersih, Git bisa menolak atau membuat situasi sulit dibaca.

### 4.6 Cherry-pick beberapa commit

```bash
git cherry-pick abc1234 def5678 999aaaa
```

Git akan menerapkan commit satu per satu sesuai urutan argument.

### 4.7 Cherry-pick range commit

Misalkan history:

```text
A---B---C---D---E main
```

Ingin cherry-pick `C`, `D`, `E`:

```bash
git cherry-pick B..E
```

Range `B..E` berarti commit yang reachable dari `E` tetapi tidak dari `B`, yaitu `C`, `D`, `E`.

Hati-hati: range selection harus dipahami dari Part 005. Salah range bisa membawa commit lebih banyak dari yang diinginkan.

### 4.8 Cherry-pick tanpa langsung commit

```bash
git cherry-pick -n abc1234
```

atau:

```bash
git cherry-pick --no-commit abc1234
```

Efeknya:

- perubahan commit diterapkan ke working tree/index,
- tetapi tidak langsung membuat commit.

Ini berguna jika kamu ingin:

- menggabungkan beberapa cherry-pick menjadi satu commit,
- menyesuaikan patch untuk release branch,
- memecah patch,
- mengedit sebelum commit.

Contoh:

```bash
git switch release/2.0
git cherry-pick -n fix1
git cherry-pick -n fix2
mvn test
git commit -m "Backport payment validation fixes to 2.0"
```

### 4.9 Cherry-pick conflict

Jika conflict terjadi:

```bash
git cherry-pick abc1234
# conflict
```

Workflow:

```bash
git status
# edit files
mvn test
git add <resolved-files>
git cherry-pick --continue
```

Atau batalkan:

```bash
git cherry-pick --abort
```

Lewati commit yang conflict:

```bash
git cherry-pick --skip
```

Hati-hati dengan `--skip`. Jika commit itu penting, skip bisa membuat patch tidak lengkap.

### 4.10 Cherry-pick dan semantic conflict

Git hanya tahu konflik teks. Ia tidak tahu apakah perubahan masih valid secara domain.

Contoh:

Commit dari `main`:

```java
public BigDecimal calculateFee(Payment payment) {
    return policy.calculate(payment.amount(), payment.currency());
}
```

Di release branch, signature masih lama:

```java
public BigDecimal calculateFee(BigDecimal amount) {
    return policy.calculate(amount);
}
```

Cherry-pick mungkin conflict. Setelah kamu resolusi, code mungkin compile. Tapi semantic bisa salah karena policy di release branch belum support currency.

Pertanyaan yang harus dijawab setelah cherry-pick:

```text
Apakah commit ini punya dependency konseptual?
Apakah data model di branch target sama?
Apakah API contract sama?
Apakah migration terkait sudah ada?
Apakah test di branch target cukup menutup behavior ini?
```

### 4.11 Cherry-pick merge commit

Secara default, cherry-pick merge commit tidak bisa begitu saja karena merge commit punya lebih dari satu parent. Git perlu tahu parent mana yang dianggap mainline.

Contoh:

```bash
git cherry-pick -m 1 <merge-commit>
```

`-m 1` berarti parent pertama dianggap mainline.

Gunakan ini dengan hati-hati. Cherry-pick merge commit sering membingungkan karena kamu tidak sekadar mengambil satu patch linear. Biasanya lebih baik cari commit individual di dalam PR dan cherry-pick commit yang relevan.

### 4.12 Best practice cherry-pick untuk release branch

Saat backport:

```bash
git switch release/2.3
git pull --ff-only
git cherry-pick -x <commit>
mvn test
mvn verify
```

Option `-x` menambahkan catatan pada commit message:

```text
(cherry picked from commit <sha>)
```

Ini berguna untuk traceability.

Contoh commit message:

```text
Fix null handling in payment validator

Backported to release/2.3 for production incident INC-2026-042.

(cherry picked from commit abc1234...)
```

Untuk regulated environment, `-x` sangat berguna karena reviewer dapat menelusuri asal perubahan.

---

## 5. `git revert`: Membatalkan Efek Commit Tanpa Menghapus History

### 5.1 Definisi mental

`git revert X` berarti:

```text
Buat commit baru yang membalik efek commit X.
```

Ia bukan menghapus commit X.
Ia bukan memundurkan branch pointer.
Ia bukan membersihkan history.

Ia menambahkan commit baru.

History:

```text
A---B---C---D  main
```

Revert `C`:

```bash
git revert C
```

Hasil:

```text
A---B---C---D---E  main

E = inverse of C
```

### 5.2 Kenapa revert aman untuk public history?

Karena revert tidak mengubah commit lama. Ia hanya menambah commit baru.

Jika `C` dan `D` sudah dipush dan dipakai orang lain, revert tidak membuat repository orang lain kehilangan base history.

Ini membuat revert cocok untuk:

- branch `main`,
- release branch,
- commit yang sudah dipush,
- production rollback logical,
- audit trail,
- regulated system,
- collaborative branch.

### 5.3 Revert bukan rollback sempurna

Revert membalik patch. Tapi sistem nyata tidak selalu bisa “dibalik” hanya dengan patch code.

Contoh:

- database migration sudah jalan,
- message sudah dikirim ke Kafka,
- cache sudah terisi,
- external API sudah menerima request,
- data sudah berubah,
- contract sudah dikonsumsi client,
- feature flag sudah enabled,
- deployment sudah menghasilkan side effect.

Git revert hanya mengubah source code. Ia tidak otomatis membatalkan side effect runtime.

Untuk Java/backend system, selalu bedakan:

```text
Git revert    = membatalkan perubahan repository
App rollback  = menjalankan versi artifact lama
Data rollback = mengembalikan state data
Business undo = membatalkan konsekuensi domain
```

### 5.4 Revert satu commit

```bash
git revert abc1234
```

Git akan membuat commit baru dengan message default:

```text
Revert "Original commit subject"

This reverts commit abc1234...
```

Edit message agar konteksnya jelas.

Contoh:

```text
Revert "Enable strict duplicate invoice validation"

Reverted because production traffic showed legitimate retry flows were
incorrectly rejected for idempotent payment callbacks.

Incident: INC-2026-071
Follow-up: implement retry-aware duplicate detection.
```

### 5.5 Revert tanpa langsung commit

```bash
git revert -n abc1234
```

atau:

```bash
git revert --no-commit abc1234
```

Ini menerapkan inverse patch ke working tree/index, tetapi belum commit.

Berguna untuk:

- revert beberapa commit menjadi satu commit,
- menyesuaikan revert,
- melakukan partial revert manual,
- menambahkan test regression sebelum commit.

Contoh:

```bash
git revert -n c1 c2 c3
mvn test
git commit -m "Revert unstable invoice retry changes"
```

### 5.6 Revert range commit

Untuk revert beberapa commit:

```bash
git revert old..new
```

Namun hati-hati dengan urutan. Revert biasanya perlu dilakukan dari commit terbaru ke yang lebih lama jika commit saling bergantung.

Contoh:

```bash
git revert C..F
```

Git akan membuat revert untuk commit dalam range. Pastikan kamu memahami urutannya dan cek `git log --oneline C..F` dulu.

Pendekatan aman:

```bash
git log --oneline --reverse C..F
```

Lalu tentukan apakah revert perlu dilakukan reverse order.

### 5.7 Revert merge commit

Merge commit punya lebih dari satu parent. Untuk revert merge commit, Git harus tahu parent mana yang dianggap mainline.

```bash
git revert -m 1 <merge-commit>
```

Misalkan:

```text
A---B---M---D main
     \ /
      C feature
```

`M` adalah merge commit. `-m 1` biasanya berarti parent pertama adalah `main` sebelum merge.

Revert merge commit akan membuat commit baru yang membatalkan perubahan yang dibawa oleh branch feature relatif terhadap mainline.

### 5.8 Bahaya revert merge commit

Revert merge commit punya konsekuensi penting:

```text
Git menganggap merge commit tersebut tetap pernah terjadi.
```

Jika kemudian kamu mencoba merge branch feature yang sama lagi, Git bisa menganggap banyak commit sudah terintegrasi, sehingga perubahan yang pernah direvert tidak otomatis muncul lagi.

Contoh:

```text
A---B---M---R main
     \ /     
      C feature
```

`R` revert merge `M`.

Jika branch `feature` dilanjutkan lalu merge lagi, hasilnya bisa mengejutkan karena Git melihat history-nya, bukan niat manusia.

Untuk reintroduce perubahan yang pernah direvert, kadang perlu:

```bash
git revert <revert-commit>
```

Alias “revert the revert”.

### 5.9 Revert vs reset untuk commit public

Jika commit sudah ada di `main` remote:

```bash
# Biasanya benar
git revert <bad-commit>
git push
```

Bukan:

```bash
# Berbahaya pada shared branch
git reset --hard <old-commit>
git push --force
```

Reset + force push pada branch shared dapat merusak kerja orang lain, menghilangkan referensi yang sedang dipakai CI, dan membuat audit trail sulit.

### 5.10 Revert untuk production incident

Misalkan release `v2.4.0` berisi commit:

```text
A = refactor payment timeout
B = enable new fraud scoring
C = update invoice PDF style
```

Production incident berasal dari `B`.

Jika kamu revert `B` di `main`:

```bash
git revert B
```

Lalu deploy commit baru, ini adalah **roll-forward fix**, bukan rollback artifact.

Kapan ini cocok:

- perubahan mudah dibalik,
- migration/data aman,
- pipeline cepat,
- kamu ingin tetap di versi terbaru plus inverse patch,
- audit butuh commit eksplisit.

Kapan rollback artifact lebih cocok:

- incident parah,
- revert patch tidak sederhana,
- perubahan saling bergantung,
- perlu restore service cepat,
- data migration tidak reversible.

---

## 6. `git reset`: Memindahkan Pointer dan Mengatur Tiga Tree

### 6.1 Definisi mental

`git reset` adalah command yang paling sering disalahgunakan.

Mental model utama:

```text
reset memindahkan HEAD/branch ke commit tertentu,
lalu tergantung mode, menyelaraskan index dan working tree.
```

Pro Git menjelaskan reset dengan model tiga tree:

```text
HEAD         = snapshot commit saat ini
Index        = snapshot yang disiapkan untuk commit berikutnya
Working tree = file yang kamu lihat/edit di filesystem
```

`reset` bisa memengaruhi ketiganya.

### 6.2 Reset bukan revert

Misalkan:

```text
A---B---C  main
```

Jika:

```bash
git reset --hard B
```

Hasil local:

```text
A---B  main
```

Commit `C` tidak lagi reachable dari `main`.

Tapi object `C` mungkin masih ada sementara di reflog. Ia tidak langsung hilang.

### 6.3 Tiga mode utama reset

| Mode | Pindahkan HEAD/branch | Update index | Update working tree | Risiko kehilangan perubahan working tree |
|---|---:|---:|---:|---:|
| `--soft` | Ya | Tidak | Tidak | Rendah |
| `--mixed` | Ya | Ya | Tidak | Rendah-sedang |
| `--hard` | Ya | Ya | Ya | Tinggi |

Default `git reset <commit>` adalah `--mixed`.

### 6.4 `git reset --soft`

```bash
git reset --soft HEAD~1
```

Efek:

```text
HEAD/branch mundur satu commit.
Index tetap berisi perubahan dari commit yang dibatalkan.
Working tree tetap sama.
```

Gunakan ketika:

- commit lokal terakhir salah message,
- ingin menggabungkan beberapa commit lokal,
- ingin recommit tanpa kehilangan staging,
- perubahan masih private.

Contoh:

```bash
git commit -m "fix"
# sadar message buruk
git reset --soft HEAD~1
git commit -m "Fix null handling in payment callback validation"
```

### 6.5 `git reset --mixed`

```bash
git reset --mixed HEAD~1
```

atau:

```bash
git reset HEAD~1
```

Efek:

```text
HEAD/branch mundur.
Index disamakan dengan commit target.
Working tree tetap membawa perubahan.
```

Perubahan dari commit yang dibatalkan menjadi unstaged.

Gunakan ketika:

- commit lokal terlalu besar,
- ingin memecah commit,
- ingin memilih ulang staging,
- ingin menghapus staging tapi mempertahankan file changes.

Contoh memecah commit:

```bash
git reset HEAD~1

git add src/main/java/com/acme/payment/PaymentValidator.java
git commit -m "Fix payment validation null handling"

git add src/test/java/com/acme/payment/PaymentValidatorTest.java
git commit -m "Add regression tests for payment validation"
```

### 6.6 `git reset --hard`

```bash
git reset --hard HEAD~1
```

Efek:

```text
HEAD/branch mundur.
Index disamakan.
Working tree disamakan.
Perubahan lokal yang tidak tersimpan bisa hilang dari working tree.
```

Gunakan hanya ketika kamu yakin:

- perubahan lokal tidak dibutuhkan,
- ada backup/reflog/branch lain,
- branch private,
- kamu sedang membersihkan eksperimen,
- kamu ingin menyamakan branch lokal dengan remote.

Contoh menyamakan branch lokal dengan remote:

```bash
git fetch origin
git reset --hard origin/main
```

Ini menghapus semua commit lokal di branch saat ini yang tidak ada di `origin/main`, dan menghapus perubahan working tree.

### 6.7 Reset pathspec: unstaging file

`reset` juga bisa digunakan untuk index-level operation.

```bash
git reset HEAD path/to/file.java
```

Ini menghapus file dari staging area, tetapi tidak mengubah working tree.

Command modern yang lebih eksplisit:

```bash
git restore --staged path/to/file.java
```

Gunakan `restore --staged` untuk readability; pahami `reset` karena banyak dokumentasi lama masih menggunakannya.

### 6.8 Reset ke remote branch

Kasus umum:

```text
Branch lokal kacau. Saya ingin persis seperti origin/main.
```

Command:

```bash
git fetch origin
git switch main
git reset --hard origin/main
```

Sebelum itu, cek:

```bash
git status
git log --oneline --decorate --graph --max-count=10
git log --oneline origin/main..main
```

Jika ada commit lokal yang mungkin masih dibutuhkan:

```bash
git branch backup/before-reset
```

Baru reset:

```bash
git reset --hard origin/main
```

### 6.9 Reset dan public history

Reset aman untuk private local work.

Reset berbahaya untuk public shared branch jika diikuti force push:

```bash
git reset --hard HEAD~3
git push --force
```

Ini mengubah history remote. Orang lain yang sudah mengambil commit lama akan mengalami divergence.

Jika harus rewrite public history karena insiden besar seperti secret leakage, itu bukan sekadar command Git. Itu operasi koordinasi tim:

- umumkan freeze,
- backup repository,
- rotate secret,
- rewrite history,
- force push terkontrol,
- instruksikan semua developer re-clone/reset,
- invalidate artifact lama,
- audit CI/CD.

Materi rewrite besar dibahas di Part 028.

---

## 7. Decision Matrix: Pilih Command yang Tepat

### 7.1 Kasus perubahan belum dicommit

| Situasi | Command yang cocok | Catatan |
|---|---|---|
| File berubah, ingin buang perubahan file tertentu | `git restore <file>` | Working tree kembali ke `HEAD` untuk file itu |
| File sudah staged, ingin unstage | `git restore --staged <file>` | Working tree tetap |
| Semua perubahan lokal ingin dibuang | `git reset --hard HEAD` | Berbahaya; pastikan tidak ada yang penting |
| Ingin simpan sementara | `git stash push` | Dibahas Part 018 |

### 7.2 Kasus commit lokal belum dipush

| Situasi | Command | Alasan |
|---|---|---|
| Commit terakhir salah message | `git commit --amend` atau `reset --soft HEAD~1` | Rewrite private history aman |
| Commit terakhir perlu dipecah | `git reset HEAD~1` | Perubahan jadi unstaged, bisa dipilih ulang |
| Beberapa commit lokal perlu dirapikan | `git rebase -i` | Dibahas Part 010 |
| Commit lokal ingin dibuang total | `git reset --hard <safe-commit>` | Pastikan tidak butuh perubahan |

### 7.3 Kasus commit sudah dipush ke shared branch

| Situasi | Command | Alasan |
|---|---|---|
| Perubahan perlu dibatalkan | `git revert <commit>` | Menjaga history |
| Merge PR perlu dibatalkan | `git revert -m 1 <merge-commit>` | Membuat inverse commit dari merge |
| Satu bugfix perlu masuk release branch | `git cherry-pick -x <commit>` | Traceability backport |
| Secret bocor | Rotate secret + history rewrite terkontrol | Delete/revert saja tidak cukup |

### 7.4 Kasus branch release/hotfix

| Situasi | Command | Alasan |
|---|---|---|
| Bawa fix dari main ke release | `git cherry-pick -x <commit>` | Ambil patch spesifik |
| Batalkan perubahan di release branch | `git revert <commit>` | Audit trail penting |
| Release branch lokal salah | `git fetch && git reset --hard origin/release/x` | Hanya jika local changes tidak penting |
| Patch butuh adaptasi | `git cherry-pick -n <commit>` lalu edit | Hindari commit otomatis yang salah konteks |

---

## 8. Skenario Praktis untuk Java Engineer

### 8.1 Skenario: Commit lokal terlalu besar

Kamu punya commit:

```text
abc1234 Add invoice validation, refactor mapper, update tests, format files
```

Belum dipush.

Masalah:

- susah direview,
- perubahan domain bercampur formatting,
- test bercampur refactor,
- PR jadi noise.

Solusi:

```bash
git reset HEAD~1
```

Lalu stage ulang secara atomic:

```bash
git add src/main/java/com/acme/invoice/InvoiceValidator.java
git add src/test/java/com/acme/invoice/InvoiceValidatorTest.java
git commit -m "Add invoice validation for duplicate invoice number"

/git add src/main/java/com/acme/invoice/InvoiceMapper.java
git commit -m "Refactor invoice mapper extraction logic"

# jika ada formatting noise
git add <formatting-files>
git commit -m "Apply formatting to invoice package"
```

Catatan: baris `/git add` di atas seharusnya `git add`; sengaja perhatikan latihan review. Dalam praktik nyata, typo command seperti ini tidak akan jalan. Biasakan membaca sebelum copy-paste.

Versi command benar:

```bash
git add src/main/java/com/acme/invoice/InvoiceMapper.java
git commit -m "Refactor invoice mapper extraction logic"
```

### 8.2 Skenario: Salah commit ke `main`, sudah push

History:

```text
A---B---C main
```

`C` adalah perubahan yang salah dan sudah ada di remote.

Jangan:

```bash
git reset --hard B
git push --force
```

Gunakan:

```bash
git revert C
git push
```

Hasil:

```text
A---B---C---R main
```

`R` membatalkan efek `C`.

### 8.3 Skenario: Fix production harus dibawa ke release branch lama

Commit fix di `main`:

```text
abc1234 Fix idempotency key handling in payment callback
```

Release branch:

```bash
git switch release/2.7
git pull --ff-only
git cherry-pick -x abc1234
mvn test
mvn verify
git push
```

Jika conflict:

```bash
# resolve conflict
mvn test
git add .
git cherry-pick --continue
```

Tambahkan PR khusus backport.

### 8.4 Skenario: Branch lokal ingin disamakan dengan remote

Kamu eksperimen di `main` lokal dan ingin buang semuanya.

```bash
git status
git log --oneline origin/main..main
```

Jika yakin tidak perlu:

```bash
git fetch origin
git reset --hard origin/main
```

Jika ragu:

```bash
git branch backup/main-before-reset
git reset --hard origin/main
```

### 8.5 Skenario: Revert lalu reintroduce perubahan

Kamu revert feature karena production incident:

```bash
git revert <feature-commit>
```

Setelah bug diperbaiki, kamu ingin mengaktifkan lagi perubahan tersebut.

Opsi:

1. Buat commit baru yang mengimplementasikan ulang dengan fix.
2. Revert commit revert:

```bash
git revert <revert-commit>
```

Opsi kedua disebut “revert the revert”. Cocok jika perubahan asli masih relevan dan hanya perlu dikembalikan.

Namun untuk perubahan kompleks, lebih bersih membuat PR baru dengan patch yang sudah diperbaiki.

### 8.6 Skenario: Salah cherry-pick

Kamu cherry-pick commit yang salah dan belum push.

Jika commit cherry-pick adalah commit terakhir:

```bash
git reset --hard HEAD~1
```

Jika sudah push ke shared branch:

```bash
git revert <cherry-picked-commit>
```

Jika sedang proses cherry-pick dan conflict:

```bash
git cherry-pick --abort
```

### 8.7 Skenario: Revert commit dependency upgrade

Commit:

```text
Upgrade jackson-databind from 2.x to 2.y
```

Revert terlihat mudah:

```bash
git revert <commit>
```

Tapi cek:

- apakah lockfile berubah?
- apakah dependency transitif berubah?
- apakah code sudah memakai API baru?
- apakah vulnerability lama kembali?
- apakah artifact cache CI perlu dibersihkan?
- apakah SBOM berubah?

Untuk dependency security fix, revert bisa mengembalikan vulnerability. Kadang solusi lebih baik adalah patch forward ke versi aman lain, bukan revert.

---

## 9. Deep Mental Model: Patch, Pointer, dan Inverse Patch

### 9.1 Cherry-pick sebagai patch replay

Commit `C` punya parent `B`.

```text
B---C
```

Patch commit `C` secara konseptual:

```text
diff(B, C)
```

Cherry-pick ke `F` berarti:

```text
apply diff(B, C) onto F, produce C'
```

```text
A---B---C main
     \
      E---F---C' release
```

### 9.2 Revert sebagai inverse patch

Commit `C` punya patch:

```text
diff(B, C)
```

Revert `C` membuat inverse patch:

```text
diff(C, B)
```

Lalu menerapkannya ke `HEAD` sekarang.

```text
A---B---C---D---R
```

`R` bukan kembali ke `B`. Ia hanya membalik perubahan `C` pada state `D` sejauh bisa diaplikasikan.

### 9.3 Reset sebagai pointer movement

Reset tidak membuat patch baru.

```text
A---B---C---D main
```

```bash
git reset --hard B
```

Hasil:

```text
A---B main
```

`C` dan `D` tidak dihapus langsung dari object database, tetapi tidak lagi reachable dari branch `main`.

---

## 10. Reset Mode dengan Contoh State

Misalkan file `PaymentService.java` pada commit `C` punya state:

```text
HEAD = C
Index = C
Working tree = C
```

Lalu kamu menjalankan:

```bash
git reset --soft B
```

Hasil:

```text
HEAD = B
Index = C
Working tree = C
```

Artinya perubahan dari `B` ke `C` masih staged.

---

```bash
git reset --mixed B
```

Hasil:

```text
HEAD = B
Index = B
Working tree = C
```

Artinya perubahan masih ada di file, tetapi unstaged.

---

```bash
git reset --hard B
```

Hasil:

```text
HEAD = B
Index = B
Working tree = B
```

Artinya perubahan dari `C` hilang dari working tree.

---

## 11. Public vs Private History

Ini aturan yang sangat penting.

### 11.1 Private history

Private history adalah commit yang:

- belum dipush,
- hanya ada di local machine,
- belum menjadi base kerja orang lain,
- belum dipakai CI/release/tag.

Di private history, operasi rewrite biasanya aman:

```bash
git reset
git rebase -i
git commit --amend
```

### 11.2 Public history

Public history adalah commit yang:

- sudah dipush ke remote bersama,
- sudah direview orang lain,
- sudah dipakai CI,
- sudah masuk release branch,
- sudah ditag,
- sudah dideploy,
- sudah menjadi base branch orang lain.

Di public history, prefer:

```bash
git revert
git cherry-pick
git merge
```

Hindari rewrite kecuali benar-benar perlu dan terkoordinasi.

### 11.3 Rule of thumb

```text
Private mistake? Rewrite boleh.
Public mistake? Tambahkan commit koreksi.
```

Atau lebih formal:

```text
If others may have observed or depended on the commit, preserve history and add a corrective commit.
```

---

## 12. Force Push dan `--force-with-lease`

Kadang setelah reset/rebase private branch yang sudah kamu push ke branch pribadi, kamu perlu update remote.

Jangan langsung:

```bash
git push --force
```

Lebih aman:

```bash
git push --force-with-lease
```

Mental model:

```text
--force = timpa remote tanpa peduli apakah berubah sejak terakhir fetch
--force-with-lease = timpa remote hanya jika remote masih seperti yang saya kira
```

Jika orang lain sudah push ke branch itu, `--force-with-lease` akan menolak.

Gunakan `--force-with-lease` untuk branch pribadi/feature branch, bukan untuk `main` atau release branch kecuali ada prosedur khusus.

---

## 13. Merge Commit: Revert atau Reset?

### 13.1 Merge belum dipush

Jika kamu baru saja merge salah branch secara lokal:

```bash
git merge feature/foo
```

Belum push.

Jika merge commit terakhir:

```bash
git reset --hard HEAD~1
```

Atau jika merge belum selesai:

```bash
git merge --abort
```

### 13.2 Merge sudah dipush

Jika merge commit sudah masuk `main` remote:

```bash
git revert -m 1 <merge-commit>
```

Bukan reset + force push.

### 13.3 Squash merge beda cerita

Jika PR di-squash merge, `main` hanya punya satu commit hasil squash:

```text
A---B---S main
```

Revert-nya sederhana:

```bash
git revert S
```

Ini salah satu alasan squash merge disukai pada beberapa tim: rollback PR menjadi satu commit lebih mudah. Trade-off-nya: commit granular dalam branch hilang dari mainline history.

---

## 14. Reset vs Restore vs Checkout

Git modern memisahkan beberapa fungsi lama `checkout`/`reset` menjadi command yang lebih eksplisit.

| Tujuan | Command modern | Command lama/alternatif |
|---|---|---|
| Buang perubahan file di working tree | `git restore file` | `git checkout -- file` |
| Unstage file | `git restore --staged file` | `git reset HEAD file` |
| Pindah branch | `git switch branch` | `git checkout branch` |
| Pindahkan branch pointer | `git reset <commit>` | tetap `reset` |

Gunakan command modern untuk readability:

```bash
git switch
git restore
```

Tetap pahami `checkout` dan `reset` karena masih banyak digunakan di dokumentasi, Stack Overflow, script lama, dan CI pipeline.

---

## 15. Anti-Pattern Umum

### 15.1 `reset --hard` sebagai refleks

Anti-pattern:

```bash
git reset --hard
```

Tanpa memahami apa yang hilang.

Lebih aman:

```bash
git status
git diff
git diff --staged
git branch backup/before-hard-reset
```

Baru:

```bash
git reset --hard
```

### 15.2 Force push ke shared branch

Anti-pattern:

```bash
git push --force origin main
```

Ini hampir selalu red flag.

### 15.3 Cherry-pick commit besar

Commit besar berisi:

- refactor,
- behavior change,
- dependency upgrade,
- formatting,
- tests,
- migration.

Cherry-pick commit seperti ini ke release branch berisiko tinggi.

Solusi:

- buat patch khusus release,
- split commit di source branch jika masih private,
- cherry-pick bagian yang atomic,
- gunakan `-n` lalu edit.

### 15.4 Revert tanpa memahami dependency

Revert commit `B` padahal `C` bergantung pada `B`.

```text
A---B---C---D main
```

Revert `B` bisa membuat `C` rusak secara semantic.

Selalu cek:

```bash
git log --oneline B..HEAD
git show B
git log --stat B..HEAD
```

### 15.5 Menganggap revert menghapus secret dari history

Jika secret pernah commit:

```text
A---B(secret)---C---R(revert secret file)
```

Secret masih ada di commit `B`.

Solusi benar:

1. rotate secret,
2. revoke credential,
3. rewrite history jika perlu,
4. purge caches/artifacts,
5. audit access logs,
6. koordinasi dengan tim.

Dibahas lebih jauh di Part 027 dan Part 028.

---

## 16. Checklist Sebelum Menjalankan Command Koreksi

Sebelum `cherry-pick`, `revert`, atau `reset`, jawab:

```text
1. Saya sedang di branch apa?
2. Working tree bersih?
3. Commit target benar?
4. Commit sudah public atau private?
5. Apakah branch ini dipakai orang lain?
6. Apakah perlu audit trail?
7. Apakah ada tag/release/deployment yang menunjuk commit ini?
8. Apakah perubahan punya migration/data side effect?
9. Apakah saya punya recovery point?
10. Bagaimana saya memverifikasi hasilnya?
```

Command observability:

```bash
git status
git branch --show-current
git log --oneline --decorate --graph --max-count=20
git diff
git diff --staged
```

Recovery point murah:

```bash
git branch backup/before-correction-$(date +%Y%m%d-%H%M%S)
```

Jika shell tidak support command substitution di environment tertentu, buat manual:

```bash
git branch backup/before-correction
```

---

## 17. Checklist Setelah Command Koreksi

Setelah koreksi:

```text
1. Apakah graph sesuai ekspektasi?
2. Apakah diff sesuai target?
3. Apakah test berjalan?
4. Apakah commit message menjelaskan konteks?
5. Apakah PR/reviewer bisa memahami alasan koreksi?
6. Apakah release notes perlu diperbarui?
7. Apakah ticket/incident perlu dilink?
8. Apakah branch remote perlu update?
9. Apakah ada backport/forward-port tambahan?
10. Apakah ada dampak ke deployment/data?
```

Command:

```bash
git log --oneline --decorate --graph --max-count=20
git show --stat HEAD
git diff <base>...HEAD
mvn test
mvn verify
```

Untuk Gradle:

```bash
./gradlew test
./gradlew build
```

---

## 18. Latihan Praktis

Latihan ini dirancang agar kamu memahami state transition, bukan sekadar command.

### 18.1 Setup repository latihan

```bash
mkdir git-correction-lab
cd git-correction-lab
git init

git config user.name "Git Lab"
git config user.email "git-lab@example.com"

mkdir -p src/main/java/com/acme/payment
cat > src/main/java/com/acme/payment/PaymentValidator.java <<'EOF'
package com.acme.payment;

public class PaymentValidator {
    public boolean isValid(String paymentId) {
        return paymentId != null && !paymentId.isBlank();
    }
}
EOF

git add .
git commit -m "Add basic payment validator"
```

### 18.2 Buat commit salah lokal

```bash
cat > src/main/java/com/acme/payment/PaymentValidator.java <<'EOF'
package com.acme.payment;

public class PaymentValidator {
    public boolean isValid(String paymentId) {
        return true;
    }
}
EOF

git add .
git commit -m "bad quick fix"
```

Cek:

```bash
git log --oneline
```

Karena belum public, ubah commit dengan reset:

```bash
git reset --mixed HEAD~1
```

Cek state:

```bash
git status
git diff
```

Buang perubahan:

```bash
git restore src/main/java/com/acme/payment/PaymentValidator.java
```

### 18.3 Latihan revert

Buat commit yang salah dan anggap sudah public:

```bash
cat > src/main/java/com/acme/payment/PaymentValidator.java <<'EOF'
package com.acme.payment;

public class PaymentValidator {
    public boolean isValid(String paymentId) {
        return paymentId != null;
    }
}
EOF

git add .
git commit -m "Relax payment id validation"
```

Sekarang revert:

```bash
git revert HEAD
```

Cek:

```bash
git log --oneline --decorate --graph
git show --stat HEAD
```

Perhatikan: commit lama tetap ada, commit baru membatalkan efeknya.

### 18.4 Latihan cherry-pick

Buat branch feature:

```bash
git switch -c feature/trim-payment-id

cat > src/main/java/com/acme/payment/PaymentValidator.java <<'EOF'
package com.acme.payment;

public class PaymentValidator {
    public boolean isValid(String paymentId) {
        return paymentId != null && !paymentId.trim().isBlank();
    }
}
EOF

git add .
git commit -m "Trim payment id before validation"
```

Simpan SHA:

```bash
git log --oneline -1
```

Kembali ke main:

```bash
git switch main
```

Cherry-pick commit feature:

```bash
git cherry-pick <sha-feature-commit>
```

Cek graph:

```bash
git log --oneline --decorate --graph --all
```

Perhatikan commit baru ada di `main`.

### 18.5 Latihan reset soft/mixed/hard

Buat commit:

```bash
echo "notes" > NOTES.md
git add NOTES.md
git commit -m "Add notes"
```

Soft reset:

```bash
git reset --soft HEAD~1
git status
```

Commit ulang:

```bash
git commit -m "Add development notes"
```

Mixed reset:

```bash
git reset --mixed HEAD~1
git status
```

Stage dan commit lagi:

```bash
git add NOTES.md
git commit -m "Add development notes"
```

Hard reset:

```bash
git reset --hard HEAD~1
git status
ls
```

Perhatikan `NOTES.md` hilang dari working tree.

---

## 19. Kesalahan yang Sengaja Harus Kamu Simulasikan

Untuk menjadi benar-benar kuat, jangan hanya latihan happy path. Simulasikan failure.

### 19.1 Cherry-pick conflict

Buat dua branch yang mengubah line sama, lalu cherry-pick.

Observasi:

```bash
git status
git diff
git cherry-pick --abort
```

### 19.2 Revert conflict

Buat commit `B`, lalu commit `C` yang mengubah area sama. Revert `B`.

Observasi bahwa revert juga bisa conflict karena inverse patch tidak selalu bisa diterapkan bersih.

### 19.3 Reset hard lalu recovery

Buat commit, reset hard, lalu cari dengan reflog:

```bash
git reflog
```

Jangan lanjut jauh sekarang; ini akan dibahas lebih dalam di Part 017.

---

## 20. Git Correction Policy untuk Tim Java

Tim yang matang sebaiknya punya policy eksplisit.

Contoh:

```text
1. Commit yang belum dipush boleh diubah dengan amend, reset, atau rebase.
2. Commit yang sudah dipush ke branch pribadi boleh rewrite hanya dengan --force-with-lease.
3. Commit yang sudah masuk main/release tidak boleh dihapus; gunakan revert.
4. Backport ke release branch menggunakan cherry-pick -x.
5. Force push ke main/release dilarang kecuali prosedur incident history rewrite.
6. Secret leakage harus ditangani sebagai security incident, bukan sekadar revert.
7. Merge commit public direvert dengan -m dan review wajib.
8. Semua correction commit harus menyebut issue/incident/change request jika relevan.
9. Untuk production-affecting revert, wajib jalankan regression test dan deployment checklist.
10. Untuk database migration, revert code tidak dianggap cukup tanpa data/migration assessment.
```

Policy seperti ini mengurangi debat saat incident. Saat tekanan tinggi, tim tidak boleh baru mulai memutuskan prinsip dasar.

---

## 21. Contoh Commit Message untuk Koreksi

### 21.1 Revert production issue

```text
Revert "Enable strict invoice duplicate validation"

The validation rejected legitimate idempotent retries from the payment
callback provider. This revert restores the previous behavior while we
redesign duplicate detection around provider event IDs.

Incident: INC-2026-083
Risk: duplicate invoice detection temporarily returns to previous behavior
```

### 21.2 Backport cherry-pick

```text
Fix null handling in payment callback parser

Backported to release/2.7 because malformed optional metadata caused
production callbacks to fail with NullPointerException.

Original commit: abc1234
Incident: INC-2026-091
```

Jika menggunakan `git cherry-pick -x`, Git menambahkan original commit hash otomatis.

### 21.3 Reset tidak punya commit message

Karena reset tidak membuat commit. Jika kamu reset untuk merapikan commit lokal, commit message baru harus menjelaskan final perubahan, bukan proses reset-nya.

Buruk:

```text
Reset and fix stuff
```

Baik:

```text
Add validation for duplicate invoice number
```

---

## 22. Hubungan dengan CI/CD dan Release

### 22.1 Revert memicu pipeline seperti commit biasa

Karena revert membuat commit baru, CI/CD akan berjalan seperti perubahan normal.

Ini bagus karena:

- ada build baru,
- ada artifact baru,
- ada audit trail,
- ada deployment trace,
- bisa direview.

### 22.2 Reset lokal tidak terlihat CI

Reset lokal belum berarti apa-apa bagi CI sampai kamu push hasilnya.

### 22.3 Cherry-pick menghasilkan commit berbeda

Jika commit `C` di `main` sudah lulus CI, cherry-pick `C'` di release branch tetap harus diuji ulang.

Kenapa?

Karena context branch berbeda:

- dependency bisa beda,
- config bisa beda,
- data model bisa beda,
- API bisa beda,
- test suite bisa beda,
- parent commit berbeda.

Jangan menganggap cherry-picked commit otomatis aman karena commit asal lulus CI.

---

## 23. Hubungan dengan Audit dan Regulatory Defensibility

Dalam sistem regulated, pilihan antara `reset` dan `revert` bukan sekadar teknis.

### 23.1 Revert lebih defensible

Revert menunjukkan:

```text
Perubahan X pernah dibuat.
Perubahan X dinilai salah/berisiko.
Tim membuat perubahan Y untuk membatalkan efek X.
Alasan ada di commit/PR/ticket.
```

Ini membentuk chain of evidence.

### 23.2 Reset menghapus narasi branch

Reset pada public branch bisa membuat history resmi tidak menunjukkan apa yang pernah terjadi.

Itu bisa problem jika:

- ada audit,
- ada incident review,
- ada traceability requirement,
- ada compliance evidence,
- ada separation of duties,
- ada production deployment berdasarkan commit yang kemudian hilang dari branch.

### 23.3 Cherry-pick untuk controlled propagation

Cherry-pick dengan `-x` membantu menunjukkan bahwa patch tertentu disalin dari commit tertentu ke release branch tertentu.

Untuk hotfix/backport, ini penting karena auditor atau reviewer bisa menjawab:

```text
Patch mana yang masuk versi ini?
Dari mana asalnya?
Apakah sama dengan fix di main?
Apakah ada adaptasi?
Siapa yang approve?
```

---

## 24. Latihan Berpikir: Pilih Command

Untuk setiap kasus, pilih command dan jelaskan alasannya.

### Kasus 1

Kamu commit lokal dengan message buruk. Belum push.

Jawaban umum:

```bash
git commit --amend
```

atau:

```bash
git reset --soft HEAD~1
```

### Kasus 2

Commit buruk sudah masuk `main` dan sudah dipull beberapa engineer.

Jawaban:

```bash
git revert <commit>
```

### Kasus 3

Bugfix di `main` perlu masuk `release/1.5`, tapi `main` punya banyak perubahan lain.

Jawaban:

```bash
git switch release/1.5
git cherry-pick -x <bugfix-commit>
```

### Kasus 4

Kamu ingin branch lokal persis seperti `origin/main`, semua perubahan lokal tidak penting.

Jawaban:

```bash
git fetch origin
git reset --hard origin/main
```

### Kasus 5

PR di-squash merge ke `main`, lalu harus dibatalkan.

Jawaban:

```bash
git revert <squash-commit>
```

### Kasus 6

Merge commit sudah masuk `main`, ingin membatalkan seluruh PR.

Jawaban:

```bash
git revert -m 1 <merge-commit>
```

### Kasus 7

Secret sudah pernah commit, lalu direvert.

Jawaban:

```text
Revert tidak cukup.
Rotate/revoke secret, lakukan incident response, lalu pertimbangkan history rewrite terkoordinasi.
```

---

## 25. Ringkasan Command

### Cherry-pick

```bash
git cherry-pick <commit>
git cherry-pick -x <commit>
git cherry-pick -n <commit>
git cherry-pick <commit1> <commit2>
git cherry-pick <old>..<new>
git cherry-pick --continue
git cherry-pick --abort
git cherry-pick --skip
```

### Revert

```bash
git revert <commit>
git revert -n <commit>
git revert <commit1> <commit2>
git revert -m 1 <merge-commit>
git revert --continue
git revert --abort
git revert --skip
```

### Reset

```bash
git reset --soft <commit>
git reset --mixed <commit>
git reset <commit>
git reset --hard <commit>
git reset HEAD <file>
git reset --hard origin/main
```

Modern alternative untuk beberapa kasus:

```bash
git restore <file>
git restore --staged <file>
git switch <branch>
```

---

## 26. Invariant yang Harus Diingat

```text
Invariant 1:
Cherry-pick mengambil efek commit dan membuat commit baru di branch saat ini.
```

```text
Invariant 2:
Revert membatalkan efek commit dengan commit baru. Ia tidak menghapus commit lama.
```

```text
Invariant 3:
Reset memindahkan pointer branch/HEAD dan dapat mengubah index serta working tree.
```

```text
Invariant 4:
Private history boleh dirapikan. Public history harus diperlakukan sebagai kontrak sosial.
```

```text
Invariant 5:
Git hanya membatalkan source state, bukan otomatis membatalkan data/runtime/business side effect.
```

```text
Invariant 6:
Sebelum operasi destruktif, buat recovery point murah.
```

---

## 27. Koneksi ke Part Berikutnya

Bagian ini sengaja menyinggung recovery beberapa kali:

- commit hilang setelah reset,
- branch terhapus,
- cherry-pick/rebase gagal,
- reset hard tidak sengaja,
- reflog,
- dangling commit,
- `git fsck`,
- stash recovery.

Itu akan menjadi fokus Part 017.

Di Part 016, kamu belajar memilih operasi koreksi.
Di Part 017, kamu belajar memulihkan diri ketika operasi koreksi salah atau pekerjaan tampak hilang.

---

## 28. Penutup

`cherry-pick`, `revert`, dan `reset` adalah tiga alat yang sangat kuat karena mereka mengubah arah evolusi repository.

Namun kekuatannya berbeda:

```text
cherry-pick = propagasi patch terpilih
revert      = koreksi historis yang audit-friendly
reset       = manipulasi pointer dan working state
```

Kesalahan paling umum bukan salah mengetik command, tetapi salah memilih model operasi.

Untuk menjadi engineer yang kuat, biasakan berpikir seperti ini:

```text
State sekarang apa?
State target apa?
History ini private atau public?
Apakah saya butuh audit trail?
Apakah command ini membuat commit baru atau memindahkan pointer?
Apa recovery plan jika salah?
```

Jika kamu bisa menjawab pertanyaan itu sebelum menjalankan command, kamu tidak hanya “bisa Git”. Kamu mulai menggunakan Git sebagai alat engineering control.

---

# Status Seri

```text
Progress: 016 / 032
Seri belum selesai.
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
```

Bagian berikutnya:

```text
learn-git-mastery-for-java-engineers-part-017.md
```

Topik:

```text
Recovery: Reflog, Lost Commit, dan Disaster Handling
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 015 — Release, Tagging, Versioning, dan Hotfix](./learn-git-mastery-for-java-engineers-part-015.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Part 017 — Recovery: Reflog, Lost Commit, dan Disaster Handling](./learn-git-mastery-for-java-engineers-part-017.md)

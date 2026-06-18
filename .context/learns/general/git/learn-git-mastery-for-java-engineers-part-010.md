# learn-git-mastery-for-java-engineers-part-010.md

# Part 010 — Interactive Rebase: Sculpting History

> Seri: Git Mastery for Java Engineers  
> Bagian: 010 / 032  
> Status seri: belum selesai  
> Topik sebelumnya: `learn-git-mastery-for-java-engineers-part-009.md` — Rebase: Memindahkan Perubahan dengan Aman  
> Topik berikutnya: `learn-git-mastery-for-java-engineers-part-011.md` — Conflict Resolution: Dari Mekanik ke Strategi

---

## 0. Tujuan Bagian Ini

Di part sebelumnya, kita sudah membahas `rebase` sebagai operasi **replay commit**: Git mengambil perubahan dari commit lama, lalu menerapkannya ulang di atas base baru sehingga commit baru tercipta.

Di bagian ini kita masuk ke **interactive rebase**.

Interactive rebase bukan sekadar fitur untuk “squash commit”. Ia adalah alat untuk mengubah history dari tumpukan checkpoint acak menjadi **narasi perubahan yang bersih, reviewable, dan bisa dipertanggungjawabkan**.

Setelah bagian ini, kamu diharapkan mampu:

1. Memahami interactive rebase sebagai operasi rewrite history yang terkontrol.
2. Menggunakan `pick`, `reword`, `edit`, `squash`, `fixup`, `drop`, dan `exec` dengan benar.
3. Merapikan commit sebelum pull request tanpa menghilangkan konteks penting.
4. Memecah commit besar menjadi beberapa commit atomic.
5. Menggabungkan commit kecil/noisy menjadi commit bermakna.
6. Menggunakan `--autosquash` dengan `fixup!` dan `squash!`.
7. Menyelesaikan conflict saat interactive rebase.
8. Memulihkan diri dari rebase yang salah menggunakan `reflog`.
9. Menentukan kapan history boleh ditulis ulang dan kapan tidak boleh.
10. Membentuk judgement senior: kapan history perlu rapi, kapan jangan disentuh.

---

## 1. Core Mental Model

Interactive rebase menjawab pertanyaan ini:

> “Saya sudah membuat beberapa commit. Sebelum saya bagikan ke orang lain, bisakah saya menyusun ulang commit-commit ini agar menceritakan perubahan dengan lebih jelas?”

Jawabannya: bisa, selama kamu paham bahwa Git tidak benar-benar “mengedit commit lama”.

Git melakukan ini:

```text
Commit lama:

A -- B -- C -- D -- E   feature

Interactive rebase terhadap B..E:

A -- B' -- C' -- D' -- E'   feature
```

Commit lama `B`, `C`, `D`, `E` tidak dimodifikasi. Git membuat commit baru: `B'`, `C'`, `D'`, `E'`.

Kenapa baru?

Karena commit id Git adalah identitas berbasis isi. Jika message, parent, author metadata tertentu, atau snapshot berubah, hash commit berubah.

Jadi prinsip pentingnya:

```text
Interactive rebase does not edit history in place.
It creates a replacement history.
```

Konsekuensinya:

- commit id berubah,
- branch pointer dipindahkan ke history baru,
- commit lama mungkin masih bisa ditemukan via `reflog`,
- jika commit lama sudah dipakai orang lain, kamu bisa merusak koordinasi tim.

---

## 2. Kapan Interactive Rebase Dipakai

Interactive rebase cocok untuk **private/local history**, misalnya:

- sebelum membuka pull request,
- sebelum meminta review serius,
- setelah membuat commit kecil-kecil selama eksplorasi,
- setelah menemukan typo di commit message lama,
- setelah commit berisi campuran perubahan yang seharusnya dipisah,
- setelah ada commit “fix test”, “fix typo”, “oops”, “forgot file”,
- saat ingin membuat commit sequence yang bisa direview step-by-step.

Interactive rebase kurang cocok atau berbahaya untuk:

- branch yang sudah dipakai banyak orang,
- commit yang sudah menjadi base branch lain,
- release branch yang sudah diaudit,
- commit yang sudah dipakai untuk build production,
- repository dengan policy melarang rewrite public history,
- situasi incident di mana traceability lebih penting daripada estetika history.

Rule sederhana:

```text
Private history boleh dirapikan.
Shared/public history harus diperlakukan sebagai audit record.
```

---

## 3. Kenapa Ini Penting untuk Java Engineer

Dalam project Java, commit sering membawa banyak jenis perubahan sekaligus:

- domain model,
- service logic,
- repository/query,
- migration database,
- DTO/API contract,
- test,
- dependency Maven/Gradle,
- generated code,
- refactor IDE,
- formatting,
- konfigurasi Spring,
- Docker/CI adjustment.

Jika semuanya masuk ke satu commit besar, reviewer sulit menjawab:

- perubahan behavior ada di mana?
- refactor murni atau ada semantic change?
- test ditambah untuk behavior mana?
- migration database terkait perubahan service yang mana?
- apakah perubahan dependency memang dibutuhkan?
- apakah generated code seharusnya direview atau hanya output generator?

Interactive rebase membantu kamu mengubah history seperti ini:

```text
bad history:

1. update user feature
2. fix
3. fix test
4. cleanup
5. forgot migration
6. update again
```

Menjadi:

```text
better history:

1. Add user status domain model
2. Persist user status transition in repository
3. Expose user status in REST response
4. Add migration for user_status column
5. Cover user status transition with integration tests
```

Kode sama, tetapi **narasi engineering berbeda**.

History yang rapi membantu:

- review lebih cepat,
- debugging lebih mudah,
- revert lebih presisi,
- cherry-pick lebih aman,
- bisect lebih efektif,
- audit lebih defensible.

---

## 4. Command Dasar Interactive Rebase

Format umum:

```bash
git rebase -i <base>
```

Contoh:

```bash
git rebase -i HEAD~3
```

Artinya:

> “Buka 3 commit terakhir untuk saya susun ulang.”

Jika history:

```text
A -- B -- C -- D -- E   HEAD
```

Maka:

```bash
git rebase -i HEAD~3
```

akan membuka commit:

```text
C
D
E
```

Bukan `B`, karena `HEAD~3` adalah base sebelum 3 commit terakhir.

Editor akan menampilkan semacam todo list:

```text
pick c111111 Add user status field
pick d222222 Add status repository update
pick e333333 Fix test
```

Urutannya biasanya dari commit paling lama ke paling baru dalam range yang sedang direbase.

Git akan menjalankan todo list tersebut dari atas ke bawah.

---

## 5. Interactive Rebase adalah Script

Ini mental model yang sangat penting.

Interactive rebase membuka file todo. File itu adalah script rencana operasi.

Misalnya:

```text
pick c111111 Add user status field
pick d222222 Add status repository update
pick e333333 Fix test
```

Maknanya:

```text
1. Ambil commit c111111 dan replay.
2. Ambil commit d222222 dan replay.
3. Ambil commit e333333 dan replay.
```

Jika kamu mengubahnya menjadi:

```text
pick c111111 Add user status field
fixup e333333 Fix test
pick d222222 Add status repository update
```

Maka Git akan:

```text
1. Replay c111111.
2. Gabungkan perubahan e333333 ke commit sebelumnya tanpa menyimpan message-nya.
3. Replay d222222.
```

Jadi interactive rebase bukan magic. Ia adalah:

```text
commit replay plan + instruction per commit
```

---

## 6. Action Utama dalam Interactive Rebase

Biasanya Git menampilkan daftar action seperti ini:

```text
pick    = use commit
reword  = use commit, but edit the commit message
edit    = use commit, but stop for amending
squash  = use commit, but meld into previous commit
fixup   = like squash, but discard this commit's log message
drop    = remove commit
exec    = run command
break   = stop here
```

Kita bahas satu per satu.

---

## 7. `pick`: Gunakan Commit Apa Adanya

Default action adalah `pick`.

```text
pick c111111 Add user status field
pick d222222 Add status repository update
pick e333333 Add tests
```

Artinya Git akan replay semua commit dalam urutan tersebut.

Kalau semua tetap `pick` dan urutannya tidak berubah, hasil history biasanya sama secara isi, tetapi commit id bisa berubah jika rebase dilakukan ke base berbeda atau metadata berubah.

Gunakan `pick` untuk commit yang sudah:

- atomic,
- message-nya jelas,
- posisinya benar,
- tidak perlu digabung/dipecah.

---

## 8. `reword`: Mengubah Commit Message Lama

`reword` digunakan jika isi commit sudah benar, tetapi message-nya buruk.

Contoh awal:

```text
pick c111111 Add user status field
pick d222222 fix
pick e333333 Add tests
```

Ubah menjadi:

```text
pick c111111 Add user status field
reword d222222 fix
pick e333333 Add tests
```

Git akan berhenti dan membuka editor untuk commit `d222222`.

Kamu bisa mengubah message:

```text
fix
```

menjadi:

```text
Persist user status transition in repository
```

Gunakan `reword` ketika:

- commit message tidak menjelaskan intent,
- message typo,
- message terlalu generic,
- message tidak sesuai convention tim,
- message perlu issue id/ticket id,
- message perlu menjelaskan risk atau migration.

Jangan gunakan `reword` untuk mengubah isi commit. Untuk itu gunakan `edit`.

---

## 9. `edit`: Berhenti pada Commit untuk Mengubah Isinya

`edit` digunakan ketika kamu ingin Git berhenti di commit tertentu agar kamu bisa:

- menambah file yang lupa,
- menghapus perubahan yang tidak seharusnya ada,
- memperbaiki isi commit,
- memecah commit,
- menjalankan test di tengah history,
- memperbaiki commit lama sebelum melanjutkan replay.

Contoh:

```text
pick c111111 Add user status field
edit d222222 Add status repository update
pick e333333 Add tests
```

Saat Git berhenti, kamu bisa cek:

```bash
git status
git log --oneline --decorate -5
```

Misalnya kamu lupa menambahkan test fixture ke commit tersebut:

```bash
vim src/test/resources/user-status-fixture.json
git add src/test/resources/user-status-fixture.json
git commit --amend
```

Lalu lanjutkan:

```bash
git rebase --continue
```

Mental model:

```text
edit = replay commit, stop, allow amend, then continue
```

---

## 10. `squash`: Gabungkan Commit dan Simpan Message untuk Diedit

`squash` menggabungkan commit ke commit sebelumnya dan membuka editor untuk menyusun commit message gabungan.

Contoh history:

```text
c111111 Add user status field
d222222 Add repository update
e333333 Add missing repository test
```

Kalau `e333333` sebenarnya bagian dari `d222222`, ubah todo:

```text
pick c111111 Add user status field
pick d222222 Add repository update
squash e333333 Add missing repository test
```

Hasilnya:

```text
c111111' Add user status field
x444444' Add repository update
```

Git akan membuka editor untuk message gabungan dari `d222222` dan `e333333`.

Gunakan `squash` ketika:

- commit kedua punya message yang mungkin masih mengandung informasi penting,
- kamu ingin menulis ulang message gabungan secara eksplisit,
- commit kecil adalah lanjutan logis dari commit sebelumnya,
- kamu ingin menjaga beberapa konteks dari message lama.

---

## 11. `fixup`: Gabungkan Commit dan Buang Message-nya

`fixup` mirip `squash`, tetapi message commit yang di-fixup dibuang.

Contoh:

```text
pick c111111 Add user status field
pick d222222 Add repository update
fixup e333333 fix typo
```

Hasilnya:

```text
c111111' Add user status field
x444444' Add repository update
```

Message `fix typo` tidak dipakai.

Gunakan `fixup` untuk commit seperti:

```text
fix typo
fix test
forgot import
oops
formatting
address review comment
```

Jika commit message-nya tidak punya informasi bernilai, `fixup` lebih tepat daripada `squash`.

---

## 12. `drop`: Menghapus Commit dari History Baru

`drop` menghilangkan commit dari hasil rebase.

Contoh:

```text
pick c111111 Add user status field
drop d222222 Add debug logging
pick e333333 Add tests
```

Commit `d222222` tidak akan direplay.

Gunakan `drop` ketika commit berisi:

- debug print,
- temporary experiment,
- file yang tidak sengaja masuk,
- perubahan yang sudah tidak diperlukan,
- commit yang membatalkan dirinya sendiri dan ingin dibersihkan.

Risiko `drop`:

- perubahan benar-benar tidak muncul di history baru,
- commit berikutnya mungkin bergantung pada perubahan itu,
- conflict atau build failure bisa muncul.

Setelah drop commit, wajib jalankan test relevan.

---

## 13. `exec`: Jalankan Command di Tengah Rebase

`exec` menjalankan command shell setelah commit tertentu diterapkan.

Contoh:

```text
pick c111111 Add user status field
exec ./mvnw -q test
pick d222222 Add repository update
exec ./mvnw -q test
pick e333333 Add integration test
exec ./mvnw -q verify
```

Ini berguna untuk memastikan setiap commit dalam sequence tetap buildable/testable.

Untuk Java project:

```bash
./mvnw -q test
./mvnw -q -DskipITs test
./mvnw -q verify
./gradlew test
./gradlew check
```

Gunakan `exec` jika:

- kamu ingin commit series tetap bisectable,
- kamu sedang menyusun patch series yang harus valid per commit,
- kamu ingin menemukan commit mana yang merusak build selama rewrite.

Jangan gunakan `exec` dengan command berat tanpa alasan, karena rebase bisa menjadi lambat.

---

## 14. Reordering: Mengubah Urutan Commit

Karena todo list adalah script, kamu bisa mengubah urutan commit.

Awal:

```text
pick c111111 Add REST endpoint
pick d222222 Add service method
pick e333333 Add domain model
```

Ini urutan yang buruk secara narasi. Endpoint bergantung pada service, service bergantung pada domain model.

Lebih baik:

```text
pick e333333 Add domain model
pick d222222 Add service method
pick c111111 Add REST endpoint
```

Tetapi hati-hati: mengubah urutan bisa menimbulkan conflict atau build failure jika commit saling bergantung.

Urutan commit ideal biasanya mengikuti dependency:

```text
1. Pure refactor/preparation
2. Domain model / core abstraction
3. Persistence / integration boundary
4. Business logic
5. API exposure
6. Tests
7. Documentation/config
```

Namun test tidak selalu harus di akhir. Untuk commit yang baik, test sering lebih baik berada dalam commit yang sama dengan behavior yang diuji.

---

## 15. Squash Semua Commit? Tidak Selalu Benar

Banyak tim memakai squash merge di platform seperti GitHub/GitLab. Itu bukan masalah mutlak, tetapi ada trade-off.

Squash semua commit menjadi satu bagus jika:

- branch berisi perubahan kecil,
- commit history branch sangat noisy,
- tim lebih peduli mainline linear sederhana,
- PR adalah unit perubahan yang memang atomic,
- issue kecil dan tidak perlu patch series.

Squash semua commit buruk jika:

- PR besar berisi beberapa perubahan logis,
- ada refactor + behavior change + migration,
- ada commit yang bisa direvert secara terpisah,
- bisectability penting,
- audit membutuhkan sequence perubahan,
- reviewer butuh memahami tahapan perubahan.

Contoh buruk jika di-squash semua:

```text
1. Extract PaymentPolicy interface
2. Replace old payment validation with policy implementation
3. Add payment status migration
4. Add integration tests for rejected payment
5. Remove legacy validator
```

Kalau jadi satu commit besar:

```text
Implement payment policy
```

Reviewer kehilangan struktur evolusi.

Senior judgement:

```text
Tujuan bukan sedikit commit.
Tujuan adalah commit yang bermakna.
```

---

## 16. Commit Atomic: Unit Terbaik untuk Interactive Rebase

Interactive rebase paling bernilai jika kamu punya definisi commit atomic.

Commit atomic adalah commit yang:

1. Punya satu intent utama.
2. Bisa dijelaskan dalam satu kalimat spesifik.
3. Build/test relevannya tetap masuk akal.
4. Bisa direview sebagai unit kecil.
5. Bisa di-revert tanpa merusak perubahan lain yang tidak terkait.
6. Tidak mencampur refactor besar dengan behavior change tersembunyi.

Contoh commit tidak atomic:

```text
Update order flow
```

Isinya:

- rename class,
- ubah status transition,
- tambah DB column,
- update REST response,
- update test,
- update Gradle plugin,
- format 50 file.

Contoh commit atomic:

```text
Extract OrderStatusTransitionPolicy
```

```text
Apply transition policy in OrderService
```

```text
Persist rejected order reason
```

```text
Expose rejected reason in order response
```

```text
Cover rejected order transition with integration tests
```

Interactive rebase membantu mengubah commit pertama menjadi sequence kedua.

---

## 17. Workflow Umum Merapikan Branch Sebelum PR

Misal branch kamu:

```bash
git log --oneline --decorate main..HEAD
```

Output:

```text
f6f6f6f fix test
e5e5e5e cleanup
d4d4d4d add endpoint
c3c3c3c forgot migration
b2b2b2b service logic
a1a1a1a add domain field
```

Ingat `git log` default menampilkan commit terbaru di atas. Interactive rebase todo biasanya menampilkan dari lama ke baru:

```bash
git rebase -i main
```

Todo:

```text
pick a1a1a1a add domain field
pick b2b2b2b service logic
pick c3c3c3c forgot migration
pick d4d4d4d add endpoint
pick e5e5e5e cleanup
pick f6f6f6f fix test
```

Kamu ubah menjadi:

```text
reword a1a1a1a add domain field
pick c3c3c3c forgot migration
reword b2b2b2b service logic
reword d4d4d4d add endpoint
fixup f6f6f6f fix test
drop e5e5e5e cleanup
```

Tapi hati-hati: `fixup f6f6f6f` akan digabung ke commit sebelumnya, yaitu `d4d4d4d`. Jika fix test sebenarnya untuk service logic, letakkan tepat setelah `b2b2b2b`:

```text
reword a1a1a1a add domain field
pick c3c3c3c forgot migration
reword b2b2b2b service logic
fixup f6f6f6f fix test
reword d4d4d4d add endpoint
drop e5e5e5e cleanup
```

Hasil yang diinginkan:

```text
Add user status domain field
Add migration for user_status column
Apply user status transition in service
Expose user status in REST endpoint
```

Setelah selesai:

```bash
git log --oneline --decorate main..HEAD
git diff --stat main...HEAD
./mvnw test
```

Kalau branch sudah pernah dipush dan ini private branch kamu:

```bash
git push --force-with-lease
```

Jangan gunakan `--force` tanpa alasan kuat.

---

## 18. Autosquash dengan `fixup!` dan `squash!`

Interactive rebase sering dipakai untuk menggabungkan commit fix kecil ke commit target.

Git menyediakan workflow yang lebih cepat: `--autosquash`.

Misal kamu punya commit:

```text
a1a1a1a Add user status domain field
b2b2b2b Apply user status transition in service
c3c3c3c Expose user status in REST endpoint
```

Lalu kamu menemukan typo di commit pertama.

Daripada membuat commit:

```bash
git commit -m "fix typo"
```

buat commit fixup terhadap commit target:

```bash
git commit --fixup=a1a1a1a
```

Git akan membuat commit message seperti:

```text
fixup! Add user status domain field
```

Kemudian jalankan:

```bash
git rebase -i --autosquash main
```

Git akan otomatis memindahkan commit `fixup!` tepat setelah target dan mengubah action menjadi `fixup`.

Contoh todo otomatis:

```text
pick a1a1a1a Add user status domain field
fixup d4d4d4d fixup! Add user status domain field
pick b2b2b2b Apply user status transition in service
pick c3c3c3c Expose user status in REST endpoint
```

Untuk commit yang message-nya ingin ikut digabung, gunakan squash:

```bash
git commit --squash=b2b2b2b
```

Lalu:

```bash
git rebase -i --autosquash main
```

Autosquash sangat berguna saat review PR:

```bash
# reviewer menemukan bug kecil pada commit tertentu
vim src/main/java/com/example/UserStatusPolicy.java
git add src/main/java/com/example/UserStatusPolicy.java
git commit --fixup=<target-commit>

# setelah semua review feedback selesai
git rebase -i --autosquash main
```

Ini menjaga review loop tetap cepat tanpa membiarkan history akhir penuh dengan “address review comments”.

---

## 19. `git commit --fixup` Varian Lanjutan

Git modern mendukung beberapa bentuk fixup, tergantung versi Git yang digunakan.

Bentuk paling umum:

```bash
git commit --fixup=<commit>
```

Artinya perubahan akan digabung ke commit target dan message fixup dibuang.

Ada juga mode amend/reword pada beberapa versi Git:

```bash
git commit --fixup=amend:<commit>
git commit --fixup=reword:<commit>
```

Secara konseptual:

- `fixup=<commit>`: perbaiki isi commit target, buang message fixup.
- `fixup=amend:<commit>`: perbaiki isi dan siapkan pengeditan message target.
- `fixup=reword:<commit>`: ubah message target tanpa perubahan isi.

Karena dukungan detail bisa bergantung pada versi Git, biasakan cek:

```bash
git commit --help
git rebase --help
```

---

## 20. Memecah Commit Besar Menjadi Beberapa Commit

Ini skill sangat penting.

Misal kamu punya satu commit besar:

```text
x999999 Implement user status feature
```

Isinya:

- domain enum,
- entity field,
- migration,
- repository update,
- service logic,
- REST response,
- tests.

Kamu ingin memecahnya menjadi commit atomic.

Langkah:

```bash
git rebase -i main
```

Todo:

```text
edit x999999 Implement user status feature
```

Saat Git berhenti di commit itu, reset commit tersebut tetapi pertahankan perubahan di working tree:

```bash
git reset HEAD^
```

Sekarang semua perubahan dari commit besar menjadi unstaged changes.

Cek:

```bash
git status
git diff
```

Stage bagian pertama:

```bash
git add src/main/java/com/example/user/UserStatus.java
git add src/main/java/com/example/user/User.java
git commit -m "Add user status domain model"
```

Stage migration:

```bash
git add src/main/resources/db/migration/V42__add_user_status.sql
git commit -m "Add migration for user status"
```

Stage repository/service:

```bash
git add src/main/java/com/example/user/UserRepository.java
git add src/main/java/com/example/user/UserService.java
git commit -m "Apply user status transition in service"
```

Stage API:

```bash
git add src/main/java/com/example/user/UserResponse.java
git add src/main/java/com/example/user/UserController.java
git commit -m "Expose user status in API response"
```

Stage tests:

```bash
git add src/test/java/com/example/user/UserServiceTest.java
git add src/test/java/com/example/user/UserControllerIT.java
git commit -m "Cover user status transition behavior"
```

Lanjutkan rebase:

```bash
git rebase --continue
```

Jika commit besar tadi bukan satu-satunya commit, Git akan melanjutkan replay commit berikutnya.

---

## 21. Memecah Commit dengan Partial Staging

Kadang perubahan dalam satu file perlu dipecah.

Contoh `UserService.java` berisi:

- rename variable,
- perubahan logic status,
- tambahan logging.

Kamu ingin commit rename/refactor terpisah dari behavior change.

Gunakan:

```bash
git add -p src/main/java/com/example/user/UserService.java
```

Git akan menampilkan hunk dan bertanya apakah mau stage.

Pilihan umum:

```text
y = stage this hunk
n = do not stage this hunk
s = split hunk
e = manually edit hunk
q = quit
? = help
```

Workflow:

```bash
git add -p src/main/java/com/example/user/UserService.java
git commit -m "Rename user status variables for clarity"

git add -p src/main/java/com/example/user/UserService.java
git commit -m "Reject invalid user status transition"
```

Partial staging perlu disiplin. Jangan membuat commit yang tidak compile karena separasi terlalu agresif.

Prinsipnya:

```text
Pisahkan intent, tetapi jangan rusak buildability tanpa alasan.
```

---

## 22. Menghapus File yang Tidak Sengaja Masuk ke Commit Lama

Misal commit lama tidak sengaja memasukkan:

```text
application-local.yml
```

History:

```text
a1a1a1a Add user status domain field
b2b2b2b Add service logic
c3c3c3c Add local config accidentally
```

Kalau commit config itu berdiri sendiri:

```bash
git rebase -i main
```

Todo:

```text
pick a1a1a1a Add user status domain field
pick b2b2b2b Add service logic
drop c3c3c3c Add local config accidentally
```

Kalau file config masuk ke commit yang juga valid:

```text
edit b2b2b2b Add service logic
```

Saat berhenti:

```bash
git rm --cached src/main/resources/application-local.yml
echo "src/main/resources/application-local.yml" >> .gitignore
git add .gitignore
git commit --amend
git rebase --continue
```

Jika file berisi secret dan sudah pernah dipush, ini bukan sekadar interactive rebase. Kamu perlu:

1. rotasi secret,
2. hapus dari history jika perlu,
3. koordinasi dengan tim,
4. gunakan secret scanning,
5. lakukan incident response.

Topik ini akan dibahas lebih dalam di Part 027 dan Part 028.

---

## 23. Conflict Saat Interactive Rebase

Conflict saat interactive rebase mirip conflict saat rebase biasa.

Git sedang replay commit satu per satu. Jika perubahan commit yang sedang direplay tidak cocok dengan state saat ini, Git berhenti.

Cek status:

```bash
git status
```

Buka file conflict, selesaikan, lalu:

```bash
git add <file>
git rebase --continue
```

Jika ingin membatalkan seluruh rebase:

```bash
git rebase --abort
```

Jika ingin melewati commit yang sedang bermasalah:

```bash
git rebase --skip
```

Hati-hati dengan `--skip`: itu berarti commit tersebut tidak masuk ke history baru.

---

## 24. `ours` dan `theirs` Saat Rebase: Sumber Kebingungan

Saat merge conflict biasa:

- `ours` biasanya branch saat ini,
- `theirs` biasanya branch yang sedang digabung.

Saat rebase, mental model-nya lebih membingungkan karena Git sedang replay commit kamu di atas base baru.

Dalam rebase:

- `ours` sering merujuk pada state base/current rebased history,
- `theirs` sering merujuk pada commit yang sedang direplay.

Karena ini mudah salah, jangan asal:

```bash
git checkout --ours file
```

atau:

```bash
git checkout --theirs file
```

Sebelum memilih, cek:

```bash
git status
git diff
git diff --ours
git diff --theirs
git diff --base
```

Untuk Java code, conflict resolution harus semantic:

- apakah signature method berubah?
- apakah test masih valid?
- apakah dependency injection masih benar?
- apakah migration masih kompatibel?
- apakah enum value baru memengaruhi switch/case?
- apakah API contract berubah?

Git hanya mendeteksi text conflict, bukan behavior conflict.

---

## 25. Recovery dari Interactive Rebase yang Salah

Interactive rebase terasa menakutkan karena history berubah. Tetapi selama kamu belum kehilangan object karena GC, biasanya masih bisa pulih.

Safety net utama: `reflog`.

Cek:

```bash
git reflog
```

Contoh:

```text
abc1234 HEAD@{0}: rebase (finish): returning to refs/heads/feature/user-status
def5678 HEAD@{1}: rebase (pick): Expose user status in API response
789abcd HEAD@{2}: rebase (start): checkout main
old9999 HEAD@{3}: commit: fix test
```

Jika ingin kembali ke posisi sebelum rebase:

```bash
git reset --hard HEAD@{3}
```

Lebih aman buat branch penyelamat dulu:

```bash
git branch rescue-before-reset HEAD@{3}
```

Lalu inspeksi:

```bash
git log --oneline --graph --decorate --all --max-count=30
```

Pattern aman sebelum interactive rebase besar:

```bash
git branch backup/feature-user-status-before-rebase
```

Lalu lakukan rebase:

```bash
git rebase -i main
```

Jika kacau:

```bash
git reset --hard backup/feature-user-status-before-rebase
```

---

## 26. Force Push Setelah Interactive Rebase

Jika branch belum pernah dipush, tidak ada masalah remote.

Jika branch sudah pernah dipush, interactive rebase membuat commit id berubah. Remote akan menolak push biasa:

```bash
git push
```

Kemungkinan error:

```text
! [rejected] feature -> feature (non-fast-forward)
```

Jika branch itu milikmu sendiri dan tidak dipakai orang lain:

```bash
git push --force-with-lease
```

Kenapa `--force-with-lease`?

Karena ia menolak overwrite jika remote sudah berubah tanpa sepengetahuan local-mu.

Jangan biasakan:

```bash
git push --force
```

`--force` bisa menimpa kerja orang lain dengan lebih mudah.

Rule:

```text
Rewrite local/private history: okay.
Rewrite shared remote history: only with coordination.
Force push: prefer --force-with-lease.
```

---

## 27. Interactive Rebase untuk Review Feedback

Skenario umum:

1. Kamu buka PR.
2. Reviewer memberi komentar.
3. Kamu membuat commit kecil untuk setiap komentar.

History sementara:

```text
a1a1a1a Add user status domain model
b2b2b2b Apply user status transition
c3c3c3c Expose user status in API response
d4d4d4d fix review comment
e5e5e5e fix typo
f6f6f6f add missing test
```

Selama review masih aktif, commit kecil bisa diterima agar reviewer mudah melihat delta.

Sebelum merge, rapikan:

```bash
git rebase -i --autosquash main
```

Atau manual:

```text
pick a1a1a1a Add user status domain model
fixup e5e5e5e fix typo
pick b2b2b2b Apply user status transition
fixup f6f6f6f add missing test
pick c3c3c3c Expose user status in API response
fixup d4d4d4d fix review comment
```

Namun jangan otomatis menghapus semua jejak diskusi penting. Kadang review feedback menghasilkan keputusan desain yang perlu tercermin di commit message final.

Contoh message final lebih baik:

```text
Apply user status transition in service

The transition is enforced in the service layer rather than the controller
so batch jobs and REST requests share the same invariant.
```

---

## 28. Interactive Rebase dan Bisectability

Commit history yang rapi bukan hanya estetika. Ia membantu `git bisect`.

Kalau setiap commit buildable dan testable, bisect bisa menemukan regression dengan akurat.

Buruk:

```text
1. Big refactor and behavior change
2. fix compile
3. fix tests
4. fix runtime error
```

Jika commit 1 tidak compile, bisect terganggu.

Lebih baik:

```text
1. Rename payment validator without behavior change
2. Introduce PaymentPolicy abstraction
3. Apply PaymentPolicy in payment service
4. Add rejected payment tests
```

Setiap commit sebaiknya minimal:

```bash
./mvnw test
```

atau untuk project besar:

```bash
./mvnw -pl payment-service -am test
```

Bisectability tidak berarti setiap commit harus menjalankan seluruh pipeline production. Tetapi commit tidak boleh sengaja dalam kondisi rusak jika bisa dihindari.

---

## 29. Interactive Rebase dan Auditability

Dalam regulated atau high-risk systems, ada tension antara:

- history bersih,
- audit trail lengkap,
- review process,
- release traceability.

Interactive rebase sebelum merge biasanya baik.

Interactive rebase setelah merge/release biasanya buruk.

Untuk sistem yang butuh defensibility:

- jangan rewrite protected branch,
- gunakan branch protection,
- gunakan PR review sebagai audit boundary,
- gunakan signed tags/releases jika relevan,
- simpan issue/decision context di commit atau PR,
- gunakan revert untuk membatalkan public change,
- jangan reset public release history.

History yang “bersih” tetapi tidak jujur bisa berbahaya.

Tujuan interactive rebase bukan menghapus fakta penting. Tujuannya menghapus noise sebelum history menjadi shared record.

---

## 30. Decision Matrix

| Situasi | Operasi yang Cocok | Catatan |
|---|---|---|
| Commit message typo di commit lokal lama | `reword` | Aman jika history private |
| Commit `fix typo` setelah commit target | `fixup` | Cocok dengan `--autosquash` |
| Commit kecil punya message penting | `squash` | Edit message gabungan |
| Commit debug tidak sengaja | `drop` | Pastikan tidak ada dependency |
| Commit besar campur banyak intent | `edit` + `git reset HEAD^` | Pecah dengan staging selektif |
| Ingin ubah isi commit lama | `edit` + `commit --amend` | Lanjut dengan `rebase --continue` |
| Branch sudah direview tapi belum merge | interactive rebase boleh | Koordinasi jika reviewer sedang aktif |
| Branch dipakai engineer lain | Hindari rewrite | Atau koordinasi eksplisit |
| Commit sudah di main/release | Jangan interactive rebase | Gunakan `revert` atau commit baru |
| Secret sudah ter-push | Bukan hanya rebase | Rotasi secret + incident response |

---

## 31. Anti-Pattern Umum

### 31.1 Squash Semua Tanpa Memikirkan Intent

```text
Everything becomes: "Implement feature"
```

Masalah:

- reviewer kehilangan struktur,
- revert jadi kasar,
- bisect kurang informatif,
- audit melemah.

Lebih baik commit berdasarkan intent.

---

### 31.2 Rewrite Public History Tanpa Koordinasi

```bash
git rebase -i main
git push --force
```

Di branch shared, ini bisa membuat rekan kerja harus memperbaiki local history mereka.

Gunakan:

```bash
git push --force-with-lease
```

hanya jika kamu yakin dan sudah koordinasi.

---

### 31.3 Menggunakan `drop` untuk Menyembunyikan Kesalahan yang Sudah Public

Kalau kesalahan sudah masuk public branch, gunakan revert agar audit trail jelas.

```bash
git revert <commit>
```

Bukan rewrite diam-diam.

---

### 31.4 Memecah Commit Sampai Tidak Compile

Commit atomic bukan berarti sekecil mungkin.

Commit atomic berarti satu intent yang coherent.

Jika commit terlalu kecil sampai project tidak compile, kamu merusak bisectability.

---

### 31.5 Menganggap Conflict Selesai Saat Marker Hilang

Conflict selesai bukan ketika `<<<<<<<` hilang.

Conflict selesai ketika:

- code compile,
- test relevan lewat,
- behavior benar,
- invariant domain tetap valid,
- tidak ada semantic regression.

---

## 32. Praktik Command: Mini Lab

Buat repository latihan:

```bash
mkdir git-interactive-rebase-lab
cd git-interactive-rebase-lab
git init
```

Buat file awal:

```bash
cat > UserService.java <<'EOF'
public class UserService {
    public String status() {
        return "ACTIVE";
    }
}
EOF

git add UserService.java
git commit -m "Add user service"
```

Buat commit noisy:

```bash
cat > UserStatus.java <<'EOF'
public enum UserStatus {
    ACTIVE,
    SUSPENDED
}
EOF

git add UserStatus.java
git commit -m "add enum"
```

```bash
python3 - <<'PY'
from pathlib import Path
p = Path('UserService.java')
s = p.read_text()
s = s.replace('return "ACTIVE";', 'return UserStatus.ACTIVE.name();')
p.write_text(s)
PY

git add UserService.java
git commit -m "fix"
```

```bash
cat > debug.log <<'EOF'
temporary debug
EOF

git add debug.log
git commit -m "debug"
```

```bash
cat > UserServiceTest.java <<'EOF'
public class UserServiceTest {
    public static void main(String[] args) {
        if (!"ACTIVE".equals(new UserService().status())) {
            throw new RuntimeException("invalid status");
        }
    }
}
EOF

git add UserServiceTest.java
git commit -m "test"
```

Lihat history:

```bash
git log --oneline --graph --decorate
```

Sekarang rapikan 4 commit terakhir:

```bash
git rebase -i HEAD~4
```

Ubah todo menjadi kira-kira:

```text
reword <commit-add-enum> add enum
reword <commit-fix> fix
reword <commit-test> test
drop <commit-debug> debug
```

Message baru:

```text
Add user status enum
```

```text
Return user status from service
```

```text
Cover user service status behavior
```

Cek hasil:

```bash
git log --oneline --graph --decorate
ls
```

Pastikan `debug.log` hilang.

---

## 33. Lab: Autosquash

Buat perubahan typo:

```bash
# edit UserStatus.java, misalnya tambah comment kecil
cat > UserStatus.java <<'EOF'
public enum UserStatus {
    ACTIVE,
    SUSPENDED
}
EOF
```

Cari commit target:

```bash
git log --oneline
```

Buat fixup commit:

```bash
git add UserStatus.java
git commit --fixup=<commit-id-add-user-status-enum>
```

Lalu:

```bash
git rebase -i --autosquash HEAD~4
```

Perhatikan Git otomatis menempatkan commit fixup setelah target.

Selesaikan rebase, lalu cek:

```bash
git log --oneline
```

Commit `fixup! ...` tidak lagi terlihat sebagai commit terpisah.

---

## 34. Lab: Split Commit

Buat satu commit besar:

```bash
cat > Order.java <<'EOF'
public class Order {
    private String status = "NEW";
    public String status() { return status; }
}
EOF

cat > OrderService.java <<'EOF'
public class OrderService {
    public String create() {
        return new Order().status();
    }
}
EOF

git add Order.java OrderService.java
git commit -m "Add order feature"
```

Sekarang split commit terakhir:

```bash
git rebase -i HEAD~1
```

Ubah:

```text
edit <commit> Add order feature
```

Saat berhenti:

```bash
git reset HEAD^
```

Commit file pertama:

```bash
git add Order.java
git commit -m "Add order domain model"
```

Commit file kedua:

```bash
git add OrderService.java
git commit -m "Add order creation service"
```

Lanjut:

```bash
git rebase --continue
```

Cek:

```bash
git log --oneline --graph --decorate
```

---

## 35. Checklist Sebelum Interactive Rebase

Sebelum rebase:

```text
[ ] Apakah history ini masih private?
[ ] Apakah branch ini dipakai orang lain?
[ ] Apakah saya tahu base yang benar?
[ ] Apakah working tree bersih?
[ ] Apakah saya perlu backup branch?
[ ] Apakah saya tahu commit mana yang mau diubah?
[ ] Apakah ada secret/file besar yang butuh treatment khusus?
[ ] Apakah saya punya test command untuk verifikasi?
```

Command yang disarankan:

```bash
git status
git log --oneline --graph --decorate --all --max-count=30
git branch backup/<branch-name>-before-rebase
```

---

## 36. Checklist Setelah Interactive Rebase

Setelah rebase:

```text
[ ] `git status` bersih?
[ ] `git log` sudah sesuai narasi?
[ ] `git diff main...HEAD` masih berisi perubahan yang diharapkan?
[ ] Tidak ada file debug/local/secret?
[ ] Test relevan lewat?
[ ] Branch remote perlu force-with-lease?
[ ] Reviewer perlu diberi tahu bahwa history berubah?
```

Command:

```bash
git status
git log --oneline --graph --decorate main..HEAD
git diff --stat main...HEAD
./mvnw test
```

Jika perlu push:

```bash
git push --force-with-lease
```

---

## 37. Template Commit Series untuk Java Feature

Untuk feature backend Java yang cukup besar, sequence commit yang reviewable bisa seperti ini:

```text
1. Add domain model for <concept>
2. Add persistence mapping for <concept>
3. Add database migration for <concept>
4. Implement <business invariant> in service layer
5. Expose <concept> through REST API
6. Cover <business invariant> with unit tests
7. Cover <API behavior> with integration tests
8. Document operational/configuration change
```

Untuk refactor:

```text
1. Add characterization tests for existing behavior
2. Extract <abstraction> without behavior change
3. Replace legacy path with <abstraction>
4. Remove unused legacy implementation
5. Simplify tests around new abstraction
```

Untuk bug fix:

```text
1. Add regression test for <bug condition>
2. Fix <root cause> in <component>
3. Document edge case if operationally relevant
```

Pattern bug fix yang kuat:

```text
test first, fix second
```

Ini membuat commit history menjawab:

> “Bug-nya apa, dan fix-nya benar-benar menutup bug itu?”

---

## 38. Cara Berpikir Senior Saat Sculpting History

Sebelum menyusun ulang history, tanyakan:

```text
Apa cerita perubahan ini?
Apa unit review yang paling alami?
Apa unit revert yang paling aman?
Apa urutan dependency antar perubahan?
Apa yang harus tetap terlihat untuk audit?
Apa noise yang sebaiknya hilang?
Apa commit yang harus buildable/testable?
Apa yang akan membantu engineer lain 6 bulan dari sekarang?
```

Interactive rebase bukan cosmetic cleanup. Ia adalah desain komunikasi teknis.

Kode adalah artifact pertama. History adalah artifact kedua.

Engineer yang kuat mengelola keduanya.

---

## 39. Ringkasan Mental Model

```text
Interactive rebase = rewrite private history dengan script replay commit.
```

Action penting:

```text
pick   = gunakan commit
reword = ubah message
edit   = berhenti untuk amend/split
squash = gabung ke commit sebelumnya dan edit message
defixup = gabung ke commit sebelumnya dan buang message
drop   = hapus commit
exec   = jalankan command
```

Catatan: di todo Git action-nya adalah `fixup`, bukan `defixup`. Baris di atas sengaja ditulis ulang di bawah dengan benar:

```text
fixup  = gabung ke commit sebelumnya dan buang message
```

Prinsip utama:

```text
History yang baik bukan history yang paling pendek.
History yang baik adalah history yang menjelaskan perubahan dengan unit yang benar.
```

---

## 40. Kesalahan yang Harus Diingat

1. Interactive rebase membuat commit baru.
2. Commit id berubah.
3. Jangan rewrite public history sembarangan.
4. `fixup` bergabung ke commit sebelumnya dalam todo list.
5. `drop` benar-benar menghilangkan commit dari history baru.
6. Conflict resolution harus semantic, bukan sekadar textual.
7. Backup branch murah; kehilangan waktu debugging mahal.
8. `--force-with-lease` lebih aman daripada `--force`.
9. Reflog adalah safety net utama.
10. Tujuan akhir adalah reviewability, revertability, bisectability, dan auditability.

---

## 41. Latihan Reflektif

Jawab tanpa menjalankan command terlebih dahulu:

1. Jika kamu mengubah commit message commit lama dengan `reword`, apakah commit id berubah? Kenapa?
2. Jika kamu `fixup` commit A ke commit B, commit mana yang message-nya dipertahankan?
3. Apa risiko meletakkan commit fixup di posisi yang salah dalam todo list?
4. Kenapa `git push --force-with-lease` lebih aman daripada `git push --force`?
5. Kapan lebih baik mempertahankan beberapa commit daripada squash semua?
6. Kenapa commit yang tidak compile bisa merusak `git bisect`?
7. Jika interactive rebase gagal total, command apa yang pertama kamu cek?
8. Mengapa rewrite release branch biasanya buruk?
9. Apa bedanya menghapus commit noisy sebelum merge dan menghapus commit buruk setelah merge?
10. Dalam Java project, kenapa refactor dan behavior change sebaiknya dipisah?

---

## 42. Koneksi ke Part Berikutnya

Interactive rebase sering memunculkan conflict. Tetapi conflict bukan hanya masalah marker teks.

Di Part 011, kita akan membahas conflict resolution dari level mekanik sampai strategi:

- apa yang sebenarnya Git tahu dan tidak tahu,
- conflict content vs semantic conflict,
- conflict pada Java import, method signature, dependency injection, migration, generated code,
- `ours`/`theirs`,
- merge tool,
- test strategy setelah conflict,
- dan bagaimana menyelesaikan conflict tanpa merusak invariant sistem.

---

## 43. Status Seri

```text
Progress: 010 / 032
Status: belum selesai
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
Bagian berikutnya: learn-git-mastery-for-java-engineers-part-011.md
Topik berikutnya: Conflict Resolution: Dari Mekanik ke Strategi
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 009 — Rebase: Memindahkan Perubahan dengan Aman](./learn-git-mastery-for-java-engineers-part-009.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Part 011 — Conflict Resolution: Dari Mekanik ke Strategi](./learn-git-mastery-for-java-engineers-part-011.md)

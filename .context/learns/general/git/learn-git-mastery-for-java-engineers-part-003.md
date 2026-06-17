# learn-git-mastery-for-java-engineers-part-003.md

# Part 003 — Commit Graph: Parent, Branch, HEAD, dan Reachability

> Series: **Git Mastery for Java Engineers**  
> Target pembaca: **Java software engineer** yang ingin memahami Git pada level mental model, bukan sekadar command.  
> Status seri: **Part 003 dari 032**  
> Part sebelumnya: `learn-git-mastery-for-java-engineers-part-002.md`  
> Part berikutnya: `learn-git-mastery-for-java-engineers-part-004.md`

---

## 0. Tujuan Part Ini

Pada part sebelumnya, kita membongkar Git sebagai kombinasi dari:

1. **working tree**,
2. **index / staging area**,
3. **local repository**,
4. **object database**,
5. **refs**.

Part ini naik satu level: kita akan memahami **commit graph**.

Git bukan hanya menyimpan daftar perubahan linear seperti:

```text
commit 1 -> commit 2 -> commit 3 -> commit 4
```

Git menyimpan sejarah software sebagai **graph**.

Lebih tepatnya, commit di Git membentuk struktur yang secara praktis dapat dipahami sebagai **directed acyclic graph**: setiap commit menunjuk ke parent commit sebelumnya, dan pointer itu berjalan ke arah masa lalu, bukan ke masa depan.

Setelah menyelesaikan part ini, kamu harus bisa menjawab dengan jelas:

- Apa sebenarnya commit graph?
- Apa arti parent pada commit?
- Kenapa branch di Git sangat murah?
- Apa bedanya branch dengan commit?
- Apa sebenarnya `HEAD`?
- Kenapa kadang kita berada dalam kondisi `detached HEAD`?
- Apa arti reachable dan unreachable commit?
- Kenapa commit bisa tampak hilang tetapi masih bisa dipulihkan?
- Kenapa merge, rebase, revert, reset, cherry-pick, dan recovery semuanya bergantung pada pemahaman graph?

Part ini sangat penting karena banyak engineer menggunakan Git setiap hari, tetapi tetap panik ketika melihat situasi seperti:

```text
You are in 'detached HEAD' state.
```

atau:

```text
Your branch and 'origin/main' have diverged.
```

atau:

```text
fatal: Not possible to fast-forward, aborting.
```

Akar dari banyak kebingungan itu bukan command, melainkan **model graph yang belum kuat**.

---

## 1. Core Mental Model

Pegang prinsip ini sejak awal:

```text
Commit adalah node.
Parent adalah edge ke masa lalu.
Branch adalah nama/pointer ke commit.
HEAD adalah posisi kerja saat ini.
History adalah graph, bukan daftar file.
```

Atau lebih ringkas:

```text
Git repository = object database + commit graph + refs yang menunjuk ke node graph.
```

Part 002 sudah menjelaskan bahwa commit object menyimpan:

- pointer ke tree object,
- metadata author,
- metadata committer,
- message,
- dan parent commit, kecuali initial commit.

Bagian “parent commit” inilah yang membuat kumpulan commit menjadi graph.

---

## 2. Commit sebagai Node dalam Graph

Bayangkan kamu membuat tiga commit berturut-turut:

```bash
git init
echo "v1" > app.txt
git add app.txt
git commit -m "Initial app"

echo "v2" >> app.txt
git add app.txt
git commit -m "Add second version"

echo "v3" >> app.txt
git add app.txt
git commit -m "Add third version"
```

Secara visual:

```text
A <- B <- C
```

Keterangan:

```text
A = commit pertama
B = commit kedua
C = commit ketiga
```

Kenapa panahnya ke kiri?

Karena commit `C` menyimpan pointer ke parent-nya, yaitu `B`. Commit `B` menyimpan pointer ke parent-nya, yaitu `A`. Commit `A` tidak punya parent karena ia initial commit.

Jadi secara internal:

```text
C.parent = B
B.parent = A
A.parent = none
```

Banyak diagram Git menggambar seperti ini:

```text
A -- B -- C
```

Itu boleh saja untuk kemudahan visual. Tetapi secara mental, lebih akurat jika kamu ingat bahwa setiap commit menunjuk **ke belakang**.

Git tidak menyimpan pointer natural dari `A` ke `B`. Git tahu `B` anak dari `A` karena ketika membaca commit `B`, Git melihat parent-nya adalah `A`.

Konsekuensinya penting:

- Commit tahu masa lalunya.
- Commit tidak tahu semua masa depannya secara langsung.
- Banyak operasi Git adalah traversal dari satu commit menuju parent-parent-nya.

---

## 3. Parent Commit

### 3.1 Initial Commit

Commit pertama dalam repository tidak punya parent.

```text
A
```

Secara konseptual:

```text
A.parent = null
```

Ini root dari sejarah repository tersebut.

Dalam repository normal biasanya hanya ada satu root commit. Tetapi ada kasus khusus repository bisa memiliki lebih dari satu root, misalnya jika kamu menggabungkan dua repository yang tidak punya common ancestor.

---

### 3.2 Normal Commit

Commit biasa punya satu parent.

```text
A <- B <- C
```

```text
B.parent = A
C.parent = B
```

Setiap kali kamu melakukan commit biasa di atas branch normal, Git membuat commit baru dengan parent = commit yang sedang ditunjuk oleh `HEAD`.

Contoh:

```text
HEAD -> main -> C
```

Saat kamu commit:

```text
A <- B <- C <- D
              ^    ^
              |    |
             old  new
```

Branch `main` berpindah dari `C` ke `D`.

```text
HEAD -> main -> D
```

Yang penting:

```text
Commit baru menunjuk ke commit lama sebagai parent.
Branch bergerak maju ke commit baru.
```

---

### 3.3 Merge Commit

Merge commit adalah commit yang punya lebih dari satu parent.

Misalnya:

```text
A <- B <- C  main
      \
       D <- E  feature
```

Ketika `feature` di-merge ke `main` dengan merge commit:

```text
A <- B <- C <- M  main
      \       /
       D <- E    feature
```

Commit `M` punya dua parent:

```text
M.parent1 = C
M.parent2 = E
```

Parent pertama biasanya adalah commit pada branch tempat kamu sedang berada ketika menjalankan merge. Parent kedua adalah commit dari branch yang di-merge.

Ini bukan sekadar detail internal. Ini memengaruhi banyak command:

- `git log --first-parent`,
- revert merge commit,
- analisis release history,
- conflict resolution,
- audit integrasi branch.

Merge commit adalah bukti historis bahwa dua garis pengembangan pernah digabungkan.

---

## 4. Commit Graph Bukan Timeline Sederhana

Banyak engineer pemula mengira Git history adalah timeline linear:

```text
A -> B -> C -> D -> E
```

Padahal dalam kerja tim nyata, history lebih mirip seperti ini:

```text
A <- B <- C <- F <- G <- K  main
      \         \       /
       D <- E    H <- I
           feature-1  feature-2
```

Beberapa hal bisa terjadi bersamaan:

- Developer A membuat branch feature.
- Developer B juga membuat branch lain.
- `main` terus bergerak.
- Branch lama tertinggal dari `main`.
- Beberapa branch digabung dengan merge.
- Beberapa branch dirapikan dengan rebase.
- Beberapa commit di-cherry-pick ke release branch.

Git tetap bisa mengelola ini karena Git tidak bergantung pada satu timeline tunggal. Git bergantung pada relasi parent antar commit.

---

## 5. Branch sebagai Pointer, Bukan Container

Ini salah satu mental model terpenting dalam Git:

```text
Branch bukan folder.
Branch bukan copy repository.
Branch bukan container commit.
Branch hanyalah nama yang menunjuk ke satu commit.
```

Misalnya:

```text
A <- B <- C
          ^
          |
        main
```

`main` hanyalah reference yang menunjuk ke commit `C`.

Dalam `.git`, branch lokal biasanya direpresentasikan sebagai ref di:

```text
.git/refs/heads/main
```

Isinya kurang lebih object id commit:

```text
8f3a2b9...
```

Dokumentasi Git menjelaskan bahwa refs adalah nama sederhana yang menunjuk ke SHA/object id, dan branch lokal berada di namespace `refs/heads/`.

---

## 6. Membuat Branch Tidak Menyalin File

Misalnya state awal:

```text
A <- B <- C
          ^
          |
        main
```

Kamu menjalankan:

```bash
git branch feature/payment
```

Graph menjadi:

```text
A <- B <- C
          ^
          |
        main
          |
          v
   feature/payment
```

Atau lebih umum:

```text
A <- B <- C
          ^
          |
          +-- main
          |
          +-- feature/payment
```

Yang terjadi bukan penyalinan semua file.

Yang terjadi hanya:

```text
Buat nama baru feature/payment yang menunjuk ke commit C.
```

Itulah sebabnya branch di Git murah.

Biaya membuat branch kurang lebih hanya biaya membuat reference kecil, bukan menyalin seluruh working directory atau seluruh history.

---

## 7. Branch Bergerak saat Commit

Misalnya kamu berada di branch `feature/payment`:

```text
A <- B <- C
          ^
          |
        main
          |
          v
   feature/payment

HEAD -> feature/payment
```

Lalu kamu membuat commit baru `D`.

```text
A <- B <- C
          ^
          |
        main
          \
           D
           ^
           |
   feature/payment

HEAD -> feature/payment
```

Yang terjadi:

1. Git membuat commit `D`.
2. Parent `D` adalah `C`.
3. Branch aktif `feature/payment` dipindahkan dari `C` ke `D`.
4. `main` tetap menunjuk ke `C`.

Branch adalah pointer yang bergerak.

Commit adalah object immutable yang tidak berubah.

Ini prinsip besar:

```text
Commit immutable.
Branch mutable.
```

---

## 8. HEAD: Posisi Kerja Saat Ini

`HEAD` adalah salah satu konsep yang paling sering disebut tetapi sering disalahpahami.

Secara praktis:

```text
HEAD menunjukkan posisi kerja saat ini.
```

Namun detailnya ada dua mode utama:

1. `HEAD` menunjuk ke branch.
2. `HEAD` menunjuk langsung ke commit.

---

## 9. Normal HEAD: Menunjuk ke Branch

Dalam kondisi normal, `HEAD` adalah symbolic reference ke branch aktif.

Misalnya:

```text
HEAD -> main -> C
```

File `.git/HEAD` biasanya berisi:

```text
ref: refs/heads/main
```

Artinya:

```text
HEAD tidak langsung berisi commit id.
HEAD menunjuk ke ref branch.
Branch itulah yang menunjuk ke commit.
```

Jadi chain-nya:

```text
HEAD -> refs/heads/main -> commit C
```

Ketika kamu commit dalam kondisi ini:

1. Git membaca `HEAD`.
2. Git tahu `HEAD` menunjuk ke `refs/heads/main`.
3. Git membaca commit yang ditunjuk `main`.
4. Git membuat commit baru dengan parent commit lama.
5. Git menggeser `refs/heads/main` ke commit baru.

Contoh:

Sebelum commit:

```text
A <- B <- C
          ^
          |
        main
        ^
        |
       HEAD
```

Setelah commit `D`:

```text
A <- B <- C <- D
               ^
               |
             main
             ^
             |
            HEAD
```

`HEAD` tetap menunjuk ke `main`, tetapi `main` bergerak.

---

## 10. Detached HEAD: HEAD Menunjuk Langsung ke Commit

`detached HEAD` terjadi ketika `HEAD` tidak menunjuk ke branch, tetapi langsung menunjuk ke commit.

Misalnya kamu menjalankan:

```bash
git checkout C
```

atau:

```bash
git switch --detach C
```

Maka:

```text
A <- B <- C <- D
          ^    ^
          |    |
        HEAD  main
```

`HEAD` langsung menunjuk ke `C`, bukan ke `main`.

Ini bukan error.

Ini adalah state Git yang valid.

Tetapi ada konsekuensi penting.

Jika kamu membuat commit baru dari detached HEAD:

```text
A <- B <- C <- D
          ^    ^
          |    |
          |   main
          \
           E
           ^
           |
          HEAD
```

Commit `E` ada, tetapi tidak ada branch yang menunjuk ke `E`.

Kalau kamu pindah ke `main`:

```bash
git switch main
```

Maka:

```text
A <- B <- C <- D
          \
           E
```

`E` menjadi tidak terlihat dari branch normal.

Git biasanya memberi peringatan:

```text
Warning: you are leaving 1 commit behind, not connected to any of your branches
```

Untuk menyelamatkan commit itu, buat branch sebelum berpindah atau segera setelah sadar:

```bash
git branch experiment E
```

atau jika masih berada di detached HEAD:

```bash
git switch -c experiment
```

Maka:

```text
A <- B <- C <- D  main
          \
           E  experiment
```

---

## 11. Detached HEAD Bukan Selalu Buruk

Detached HEAD sering dianggap menakutkan karena pesan Git cukup panjang dan bernada peringatan. Tetapi untuk engineer yang paham graph, detached HEAD adalah alat yang berguna.

Contoh penggunaan:

### 11.1 Mengecek Versi Lama

```bash
git switch --detach v1.2.0
```

Berguna untuk melihat source code pada release tag lama tanpa membuat branch.

### 11.2 Reproduksi Bug Lama

```bash
git switch --detach <old-commit>
mvn test
```

Berguna untuk memverifikasi apakah bug sudah ada pada commit tertentu.

### 11.3 Bisect

`git bisect` secara internal sering memindahkan working tree ke commit berbeda. Dalam proses itu, kamu akan berada pada commit tertentu, bukan branch workflow biasa.

### 11.4 Build Artifact Historis

Kadang kamu perlu membangun ulang artifact dari commit lama:

```bash
git switch --detach release-2025.11.03
./mvnw clean package
```

Selama kamu tidak membuat commit baru yang ingin disimpan, detached HEAD aman.

Rule of thumb:

```text
Detached HEAD aman untuk observasi.
Detached HEAD berisiko jika kamu mulai membuat commit tanpa branch.
```

---

## 12. Commit Graph dan Reachability

Reachability adalah konsep penting dalam Git.

Sebuah commit disebut **reachable** jika commit itu bisa dicapai dengan berjalan mundur dari suatu reference, misalnya branch, tag, atau remote-tracking branch.

Misalnya:

```text
A <- B <- C <- D
               ^
               |
             main
```

Dari `main`, Git bisa mencapai:

```text
D, C, B, A
```

Maka semuanya reachable dari `main`.

---

## 13. Reachable dari Banyak Reference

Misalnya:

```text
A <- B <- C <- D  main
      \
       E <- F  feature
```

Dari `main`, reachable:

```text
D, C, B, A
```

Dari `feature`, reachable:

```text
F, E, B, A
```

Dari semua branch lokal, reachable:

```text
A, B, C, D, E, F
```

Commit `A` dan `B` reachable dari dua branch.

Commit `C`, `D` hanya reachable dari `main`.

Commit `E`, `F` hanya reachable dari `feature`.

Git sering menggunakan konsep reachable ini untuk:

- menentukan commit mana yang perlu dikirim saat push,
- menentukan commit mana yang perlu diambil saat fetch,
- menentukan apakah fast-forward mungkin,
- menentukan commit unik pada sebuah branch,
- garbage collection,
- log traversal,
- merge base calculation.

---

## 14. Unreachable Commit

Misalnya state awal:

```text
A <- B <- C <- D
               ^
               |
             main
```

Lalu kamu reset branch `main` ke `B`:

```bash
git reset --hard B
```

Graph object masih bisa ada seperti ini:

```text
A <- B <- C <- D
     ^
     |
   main
```

Commit `C` dan `D` tidak lagi reachable dari `main`.

Tetapi belum tentu langsung hilang dari disk.

Git memiliki reflog dan garbage collection policy. Selama object belum dipruning, commit bisa dipulihkan.

Inilah alasan Git sering “forgiving” terhadap kesalahan lokal.

Namun jangan salah:

```text
Unreachable bukan berarti langsung terhapus.
Unreachable berarti tidak ada ref normal yang menunjuk ke commit itu atau keturunannya.
```

---

## 15. Dangling Commit

Dangling commit adalah commit yang ada di object database tetapi tidak reachable dari refs biasa.

Contoh umum:

- kamu commit di detached HEAD lalu pindah branch,
- kamu melakukan reset hard ke commit lama,
- kamu melakukan rebase sehingga commit lama digantikan commit baru,
- kamu menghapus branch yang belum di-merge,
- kamu melakukan amend sehingga commit lama tidak lagi ditunjuk branch.

Misalnya sebelum amend:

```text
A <- B <- C
          ^
          |
        main
```

Setelah:

```bash
git commit --amend
```

Git tidak mengubah commit `C`. Git membuat commit baru `C'`.

```text
A <- B <- C
      \
       C'
       ^
       |
     main
```

`C` lama menjadi tidak reachable dari `main`.

Banyak operasi “rewrite history” sebenarnya membuat commit baru dan memindahkan pointer branch, bukan mengedit commit lama.

---

## 16. Commit Immutable, History Bisa Diatur Ulang lewat Pointer

Git commit object bersifat immutable karena object id commit dihitung dari isi commit tersebut, termasuk parent, tree, author/committer metadata, dan message.

Kalau salah satu bagian berubah, object id berubah.

Jadi ketika kamu melakukan:

```bash
git commit --amend
```

Git tidak benar-benar “mengedit commit lama”.

Git membuat commit baru yang mirip dengan commit lama tetapi berbeda object id.

Begitu juga rebase:

```bash
git rebase main
```

Git membuat ulang commit-commit branch di atas base baru.

Contoh sebelum rebase:

```text
A <- B <- C <- D  main
      \
       E <- F  feature
```

Setelah rebase feature ke main:

```text
A <- B <- C <- D  main
               \
                E' <- F'  feature

      E <- F  // commit lama, biasanya tidak lagi reachable dari feature
```

Commit `E'` dan `F'` bukan commit yang sama dengan `E` dan `F`, walaupun patch-nya mungkin mirip.

Inilah kenapa rebase public history berbahaya: orang lain mungkin masih punya pointer ke `E` dan `F`, sementara kamu sudah memindahkan branch ke `E'` dan `F'`.

---

## 17. Branch, Tag, dan Remote-Tracking Branch sebagai Ref

Git memiliki beberapa jenis reference penting:

```text
refs/heads/*       local branches
refs/tags/*        tags
refs/remotes/*     remote-tracking branches
```

Contoh:

```text
refs/heads/main
refs/heads/feature/payment
refs/tags/v1.0.0
refs/remotes/origin/main
```

Semua ini pada akhirnya menunjuk ke object, biasanya commit object.

### 17.1 Local Branch

```text
refs/heads/main -> C
```

Branch lokal bisa bergerak saat kamu commit, merge, reset, rebase.

### 17.2 Tag

Tag biasanya dipakai sebagai anchor release.

```text
refs/tags/v1.0.0 -> B
```

Tag seharusnya stabil. Dalam praktik release engineering, tag yang sudah dipublikasikan sebaiknya tidak dipindahkan sembarangan.

### 17.3 Remote-Tracking Branch

```text
refs/remotes/origin/main -> D
```

Remote-tracking branch adalah pandangan lokalmu tentang posisi branch di remote saat terakhir fetch.

Ini bukan branch yang kamu commit langsung.

Saat kamu menjalankan:

```bash
git fetch origin
```

Git memperbarui `refs/remotes/origin/*` berdasarkan remote.

---

## 18. HEAD, Branch, dan Remote-Tracking Branch

Contoh umum setelah clone:

```text
A <- B <- C
          ^
          |
          +-- main
          |
          +-- origin/main

HEAD -> main
```

Jika remote bergerak karena orang lain push:

```text
A <- B <- C <- D
          ^    ^
          |    |
        main origin/main

HEAD -> main
```

Setelah kamu fetch:

```text
origin/main -> D
main masih -> C
```

Branch lokalmu belum otomatis bergerak hanya karena fetch.

Untuk mengintegrasikan perubahan remote ke branch lokal, kamu perlu merge/rebase/pull.

Ini akan dibahas detail di part remote repository, tetapi mental model-nya sudah perlu ditanam sekarang:

```text
fetch memperbarui remote-tracking refs.
pull = fetch + integrasi ke branch aktif.
```

---

## 19. Fast-Forward sebagai Gerak Pointer

Fast-forward adalah operasi sederhana: branch pointer bisa digeser maju karena target commit sudah merupakan descendant dari commit saat ini.

Misalnya:

```text
A <- B <- C <- D
          ^    ^
          |    |
        main feature
```

Jika kamu berada di `main` dan merge `feature`:

```bash
git switch main
git merge feature
```

Git bisa melakukan fast-forward:

```text
A <- B <- C <- D
               ^
               |
               +-- main
               |
               +-- feature
```

Tidak perlu merge commit karena `main` hanya tertinggal dari `feature`, dan tidak ada divergent work di `main`.

Fast-forward secara mental:

```text
Move branch pointer forward.
```

Bukan:

```text
Create new integration commit.
```

---

## 20. Divergence

Divergence terjadi ketika dua branch punya common ancestor tetapi masing-masing sudah punya commit sendiri setelah titik percabangan.

Contoh:

```text
A <- B <- C  main
      \
       D <- E  feature
```

`main` dan `feature` sama-sama reachable ke `B`, tetapi:

- `C` hanya ada di `main`,
- `D` dan `E` hanya ada di `feature`.

Dalam kondisi ini, merge `feature` ke `main` tidak bisa fast-forward karena `main` punya commit `C` yang bukan ancestor dari `feature`.

Git perlu:

1. membuat merge commit, atau
2. melakukan rebase feature di atas main, lalu fast-forward, atau
3. memilih strategi lain.

Jadi pesan seperti:

```text
branches have diverged
```

berarti:

```text
Ada commit unik di kedua sisi sejak common ancestor.
```

Bukan berarti Git rusak.

---

## 21. Common Ancestor dan Merge Base

Untuk menggabungkan branch, Git perlu mengetahui titik nenek moyang bersama.

Contoh:

```text
A <- B <- C <- D  main
      \
       E <- F  feature
```

Common ancestor terbaik antara `main` dan `feature` adalah `B`.

Git menyebut ini **merge base**.

Merge base penting untuk three-way merge:

```text
base   = B
ours   = D
 theirs = F
```

Git membandingkan:

- perubahan dari `B` ke `D`,
- perubahan dari `B` ke `F`,
- lalu mencoba menggabungkan keduanya.

Tanpa memahami merge base, conflict sering terlihat random. Dengan merge base, conflict menjadi lebih masuk akal:

```text
Conflict terjadi ketika dua sisi mengubah area yang sama dari base dengan cara yang tidak bisa digabung otomatis.
```

---

## 22. Graph Membantu Memahami Merge

Misalnya:

```text
A <- B <- C  main
      \
       D <- E  feature
```

Merge `feature` ke `main`:

```bash
git switch main
git merge feature
```

Hasil:

```text
A <- B <- C <- M  main
      \       /
       D <- E  feature
```

`M` memiliki dua parent:

```text
M.parent1 = C
M.parent2 = E
```

Secara semantic:

```text
M berarti: state akhir main setelah mengintegrasikan perubahan main dan feature.
```

Secara historis:

```text
M mempertahankan fakta bahwa feature berkembang sebagai branch terpisah.
```

---

## 23. Graph Membantu Memahami Rebase

Rebase bukan menggabungkan dua garis dengan merge commit.

Rebase memindahkan rangkaian commit ke base baru.

Sebelum:

```text
A <- B <- C <- D  main
      \
       E <- F  feature
```

Rebase feature ke main:

```bash
git switch feature
git rebase main
```

Sesudah:

```text
A <- B <- C <- D  main
               \
                E' <- F'  feature
```

Commit `E'` dan `F'` memiliki perubahan yang setara dengan `E` dan `F`, tetapi parent-nya berbeda, sehingga object id berbeda.

Rebase secara mental:

```text
Find commits unique to current branch.
Replay them on top of new base.
Move branch pointer to replayed commits.
```

Graph membantu menjawab pertanyaan:

```text
Kenapa setelah rebase commit hash berubah?
```

Karena parent berubah, maka isi commit object berubah, maka hash berubah.

---

## 24. Graph Membantu Memahami Reset

Reset adalah operasi yang memindahkan branch pointer, lalu opsional mengubah index dan working tree.

Misalnya:

```text
A <- B <- C <- D
               ^
               |
             main
             ^
             |
            HEAD
```

Jalankan:

```bash
git reset --hard B
```

Hasil:

```text
A <- B <- C <- D
     ^
     |
   main
   ^
   |
  HEAD
```

Commit `C` dan `D` tidak otomatis hilang, tetapi tidak lagi reachable dari `main`.

Mode reset menentukan apa yang terjadi pada index dan working tree:

- `--soft`: hanya branch pointer bergerak, index dan working tree tetap.
- `--mixed`: branch pointer dan index berubah, working tree tetap.
- `--hard`: branch pointer, index, dan working tree berubah.

Detail reset akan dibahas di part 016. Di sini cukup pahami bahwa reset adalah operasi pointer plus state area.

---

## 25. Graph Membantu Memahami Revert

Revert berbeda dari reset.

Reset memindahkan pointer branch ke commit lain.

Revert membuat commit baru yang membatalkan perubahan commit lama.

Misalnya:

```text
A <- B <- C <- D  main
```

Jika `C` salah dan sudah dipush ke shared branch, kamu sebaiknya tidak reset public history. Kamu bisa revert:

```bash
git revert C
```

Hasil:

```text
A <- B <- C <- D <- R  main
```

`R` adalah commit baru yang membalik patch dari `C`.

History tetap jujur:

```text
C pernah terjadi.
R membatalkan C.
```

Ini lebih aman untuk public/shared history.

---

## 26. Graph Membantu Memahami Cherry-Pick

Cherry-pick mengambil perubahan dari commit tertentu dan menerapkannya sebagai commit baru di posisi saat ini.

Misalnya:

```text
A <- B <- C <- D  main
      \
       E <- F  release
```

Kamu ingin mengambil bugfix `D` ke branch `release`.

```bash
git switch release
git cherry-pick D
```

Hasil:

```text
A <- B <- C <- D  main
      \
       E <- F <- D'  release
```

`D'` bukan commit yang sama dengan `D`.

Ia commit baru dengan patch mirip, tetapi parent berbeda.

---

## 27. Visualisasi Graph dengan Command

Untuk memahami Git, biasakan melihat graph.

Command dasar:

```bash
git log --oneline --graph --decorate --all
```

Format yang lebih nyaman:

```bash
git log --graph --oneline --decorate --all --date-order
```

Atau buat alias:

```bash
git config --global alias.lg "log --graph --oneline --decorate --all --date-order"
```

Lalu:

```bash
git lg
```

Output bisa seperti:

```text
*   a1b2c3d (HEAD -> main) Merge branch 'feature/payment'
|\
| * f6e7d8c (feature/payment) Add payment validation
| * d4c5b6a Add payment endpoint
* | c3b2a1f Update order status flow
|/
* b9a8c7d Initial order module
```

Cara membacanya:

- `*` adalah commit.
- Garis menunjukkan parent relationship.
- `(HEAD -> main)` berarti HEAD menunjuk ke branch `main`, dan `main` menunjuk ke commit itu.
- `(feature/payment)` berarti branch itu menunjuk ke commit tersebut.
- Merge commit terlihat dari dua garis parent.

---

## 28. Membaca `git log --graph` Tanpa Tertipu

Graph ASCII Git kadang membingungkan karena layout visual bukan selalu urutan waktu mutlak.

Perhatikan:

```text
*   M Merge feature
|\
| * F feature commit 2
| * E feature commit 1
* | D main commit 2
* | C main commit 1
|/
* B common ancestor
* A initial
```

Ini berarti:

```text
M.parent1 = D
M.parent2 = F
F.parent = E
E.parent = B
D.parent = C
C.parent = B
B.parent = A
```

Jangan hanya membaca dari atas ke bawah sebagai timeline sederhana. Baca garis parent-nya.

---

## 29. `HEAD~`, `HEAD^`, dan Revision Syntax Dasar

Git punya sintaks untuk merujuk commit relatif dari `HEAD`.

### 29.1 `HEAD~1`, `HEAD~2`

Pada history linear:

```text
A <- B <- C <- D
               ^
               |
              HEAD
```

```text
HEAD    = D
HEAD~1  = C
HEAD~2  = B
HEAD~3  = A
```

`~n` berarti ikuti parent pertama sebanyak `n` langkah.

### 29.2 `HEAD^`

Pada commit biasa:

```text
HEAD^ = parent pertama HEAD
```

Pada merge commit:

```text
A <- B <- C <- M
      \       /
       D <- E
```

Jika `HEAD = M`:

```text
HEAD^1 = parent pertama M = C
HEAD^2 = parent kedua M = E
```

Ini penting saat:

- revert merge commit,
- melihat diff merge,
- memahami first-parent history.

### 29.3 Contoh Praktis

Lihat commit sebelumnya:

```bash
git show HEAD~1
```

Lihat parent kedua merge commit:

```bash
git show HEAD^2
```

Bandingkan state sekarang dengan dua commit sebelumnya:

```bash
git diff HEAD~2..HEAD
```

Revision syntax akan semakin penting di part diff, merge, rebase, dan release.

---

## 30. Two-Dot dan Three-Dot dalam Konteks Graph

Kita akan membahas detail diff di part 006, tetapi commit graph perlu menyiapkan fondasinya.

Misalnya:

```text
A <- B <- C <- D  main
      \
       E <- F  feature
```

### 30.1 `main..feature`

```bash
git log main..feature
```

Artinya kira-kira:

```text
Commit yang reachable dari feature tetapi tidak reachable dari main.
```

Hasil:

```text
E, F
```

### 30.2 `feature..main`

```bash
git log feature..main
```

Hasil:

```text
C, D
```

### 30.3 `main...feature`

Three-dot untuk log biasanya berarti symmetric difference:

```text
Commit yang reachable dari salah satu sisi, tetapi bukan dari keduanya.
```

Hasil:

```text
C, D, E, F
```

Untuk `git diff`, three-dot punya makna berbeda yang melibatkan merge base. Nanti dibahas khusus agar tidak tertukar.

Yang penting sekarang:

```text
Dot syntax hanya masuk akal jika kamu memahami reachability.
```

---

## 31. Ancestry: Ancestor dan Descendant

Dalam graph:

```text
A <- B <- C <- D
```

`A` adalah ancestor dari `D`.

`D` adalah descendant dari `A`.

Git sering melakukan pengecekan ancestor.

Contoh:

```bash
git merge-base --is-ancestor A D
```

Jika `A` adalah ancestor dari `D`, command sukses.

Ini berguna dalam scripting CI/CD, release automation, dan branch policy.

Misalnya sebelum deploy, kamu ingin memastikan commit release branch sudah mengandung commit tertentu:

```bash
git merge-base --is-ancestor <required-fix> HEAD
```

Jika exit code 0, fix tersebut ada dalam history `HEAD`.

---

## 32. Why Branches Are Cheap but Integration Is Not

Git branch murah secara teknis karena branch hanya pointer.

Tetapi integrasi branch tidak selalu murah secara engineering.

Contoh:

```text
A <- B <- C <- D <- E <- F  main
      \
       X <- Y <- Z          feature/long-lived
```

Branch `feature/long-lived` secara teknis mudah dibuat. Tetapi makin lama branch hidup, makin besar risiko:

- conflict meningkat,
- semantic drift meningkat,
- dependency berubah,
- database migration berubah,
- API contract berubah,
- test assumptions berubah,
- product requirement berubah,
- reviewer kehilangan konteks.

Jadi prinsipnya:

```text
Branch creation is cheap.
Branch integration may be expensive.
```

Engineer kuat tidak menyimpulkan “branch murah” sebagai alasan untuk membuat branch panjang tanpa integrasi berkala.

---

## 33. Java Engineer Perspective: Commit Graph pada Sistem Nyata

Untuk Java backend/microservices, commit graph bukan teori. Ia memengaruhi banyak situasi nyata.

### 33.1 Database Migration

Misalnya branch `feature/account-status` menambahkan Flyway migration:

```text
V42__add_account_status.sql
```

Sementara `main` sudah menerima branch lain dengan:

```text
V42__add_order_status.sql
```

Graph:

```text
A <- B <- C  main
      \
       D  feature/account-status
```

Dari perspektif Git, file berbeda mungkin tidak conflict.

Tetapi secara domain/build/runtime, ada semantic conflict karena dua migration memakai nomor yang sama.

Commit graph membantu menemukan kapan branch bercabang dan perubahan apa saja yang terjadi sejak base.

Command berguna:

```bash
git merge-base main feature/account-status
git diff $(git merge-base main feature/account-status)..feature/account-status
git diff $(git merge-base main feature/account-status)..main
```

### 33.2 Maven/Gradle Dependency Drift

Feature branch dibuat saat `main` memakai dependency versi lama.

Selama branch berjalan, `main` upgrade Spring Boot atau plugin Gradle.

Graph:

```text
A <- B <- C <- D  main
      \
       E <- F  feature
```

Saat merge/rebase, mungkin tidak ada conflict tekstual besar, tetapi test gagal karena dependency behavior berubah.

Graph membantu menjelaskan:

```text
Branch feature dikembangkan dengan asumsi dependency state pada B, tetapi diintegrasikan ke state D.
```

### 33.3 Generated Code

Jika repository menyimpan generated code dari OpenAPI/protobuf, branch yang berbeda bisa menghasilkan file besar yang conflict.

Graph membantu memutuskan apakah lebih baik:

- regenerate dari source schema setelah merge,
- merge manual generated file,
- atau mengubah policy agar generated code tidak disimpan.

### 33.4 Hotfix Production

Production berjalan di tag:

```text
v1.4.2 -> C
```

`main` sudah maju:

```text
A <- B <- C <- D <- E <- F  main
          ^
          |
        v1.4.2
```

Bugfix production harus dibuat dari `C`, bukan dari `main`, jika ingin patch minimal:

```bash
git switch -c hotfix/v1.4.3 v1.4.2
```

Graph:

```text
A <- B <- C <- D <- E <- F  main
          \
           H  hotfix/v1.4.3
```

Setelah rilis hotfix, kamu mungkin perlu merge/cherry-pick `H` kembali ke `main`.

Tanpa mental model graph, hotfix sering dilakukan dari base yang salah.

---

## 34. Branch Name Tidak Menentukan Isi History

Nama branch hanyalah label.

Branch bernama `release/1.0` tidak otomatis berarti aman untuk release.

Branch bernama `main` tidak otomatis berarti production-ready.

Yang menentukan adalah:

- commit apa yang ditunjuk branch,
- commit apa saja yang reachable dari branch,
- policy apa yang menjaga branch tersebut,
- CI/CD status commit tersebut,
- tag/release evidence apa yang mengikat commit tersebut.

Jadi jangan tertipu nama branch.

Selalu tanyakan:

```text
Branch ini menunjuk ke commit mana?
Commit itu mengandung perubahan apa?
Commit itu reachable dari mana?
Apakah commit itu sudah diverifikasi?
```

---

## 35. `origin/main` Bukan `main`

Kesalahan umum:

```text
main == origin/main
```

Padahal:

```text
main        = branch lokal
origin/main = remote-tracking branch lokal yang merepresentasikan remote origin/main saat fetch terakhir
```

Contoh:

```text
A <- B <- C <- D  origin/main
          ^
          |
        main
```

Artinya local `main` tertinggal dari remote-tracking `origin/main`.

Contoh lain:

```text
A <- B <- C <- E  main
          \
           D  origin/main
```

Artinya local `main` dan `origin/main` diverged.

Saat kamu push, Git akan menolak jika remote head bukan ancestor dari local head, kecuali kamu force push. Ini untuk mencegah kamu menimpa kerja orang lain.

---

## 36. Reachability dan Push/Fetch

Ketika kamu push branch, Git tidak mengirim seluruh repository. Git menentukan object apa yang remote belum punya.

Secara konseptual:

```text
Push = kirim object reachable dari local ref yang belum ada di remote, lalu minta remote update ref.
```

Ketika kamu fetch:

```text
Fetch = ambil object reachable dari remote ref yang belum ada lokal, lalu update remote-tracking ref.
```

Jadi lagi-lagi, konsep reachability muncul.

Ini menjelaskan kenapa Git efisien untuk kolaborasi: object yang sudah ada tidak perlu dikirim ulang.

---

## 37. Reachability dan Garbage Collection

Git menyimpan object di object database. Tetapi tidak semua object akan disimpan selamanya.

Object yang tidak reachable dari refs dan sudah melewati periode tertentu bisa dibersihkan oleh garbage collection.

Namun Git punya safety net bernama reflog, yang mencatat pergerakan refs lokal seperti `HEAD` dan branch.

Contoh:

```bash
git reflog
```

Bisa menunjukkan history pergerakan:

```text
abc1234 HEAD@{0}: reset: moving to HEAD~2
def5678 HEAD@{1}: commit: Add payment validation
789abcd HEAD@{2}: commit: Add payment endpoint
```

Jika commit hilang dari branch, kamu sering bisa memulihkannya dari reflog:

```bash
git branch recovery def5678
```

Recovery detail akan dibahas di part 017. Di sini yang penting:

```text
Git recovery bekerja karena commit object sering masih ada meskipun tidak lagi reachable dari branch normal.
```

---

## 38. Practical Lab: Membuat dan Membaca Commit Graph

Latihan ini membangun graph kecil yang akan kamu baca sendiri.

### 38.1 Setup Repository

```bash
mkdir git-graph-lab
cd git-graph-lab
git init
git config user.name "Graph Lab"
git config user.email "graph-lab@example.com"
```

Buat commit awal:

```bash
echo "app.name=graph-lab" > application.properties
git add application.properties
git commit -m "Initial application config"
```

Tambahkan service sederhana:

```bash
mkdir -p src/main/java/com/example
cat > src/main/java/com/example/OrderService.java <<'EOF'
package com.example;

public class OrderService {
    public String status() {
        return "CREATED";
    }
}
EOF

git add src/main/java/com/example/OrderService.java
git commit -m "Add order service"
```

Lihat graph:

```bash
git log --oneline --graph --decorate --all
```

---

### 38.2 Buat Branch Feature

```bash
git switch -c feature/payment
```

Ubah file:

```bash
cat > src/main/java/com/example/PaymentService.java <<'EOF'
package com.example;

public class PaymentService {
    public boolean authorize(int amount) {
        return amount > 0;
    }
}
EOF

git add src/main/java/com/example/PaymentService.java
git commit -m "Add payment authorization service"
```

Lihat graph:

```bash
git log --oneline --graph --decorate --all
```

Perhatikan:

```text
feature/payment bergerak.
main tetap di commit lama.
```

---

### 38.3 Buat Divergence

Pindah ke main:

```bash
git switch main
```

Tambahkan commit berbeda:

```bash
cat > README.md <<'EOF'
# Git Graph Lab

Repository for learning Git commit graph.
EOF

git add README.md
git commit -m "Add project README"
```

Lihat graph:

```bash
git log --oneline --graph --decorate --all
```

Sekarang `main` dan `feature/payment` diverged.

---

### 38.4 Cari Merge Base

```bash
git merge-base main feature/payment
```

Lihat commit-nya:

```bash
git show --oneline --no-patch $(git merge-base main feature/payment)
```

Bandingkan perubahan dari base ke masing-masing branch:

```bash
git diff --stat $(git merge-base main feature/payment)..main
git diff --stat $(git merge-base main feature/payment)..feature/payment
```

---

### 38.5 Merge Feature

```bash
git switch main
git merge feature/payment
```

Lihat graph:

```bash
git log --oneline --graph --decorate --all
```

Jika Git membuat merge commit, perhatikan commit dengan dua parent.

Cek parent merge commit:

```bash
git show --pretty=raw --no-patch HEAD
```

Cari baris `parent`.

---

### 38.6 Eksperimen Detached HEAD

Pilih commit lama:

```bash
git log --oneline
```

Lalu checkout commit tertentu:

```bash
git switch --detach <commit-id>
```

Cek:

```bash
git status
git log --oneline --graph --decorate --all
```

Buat commit eksperimental:

```bash
echo "detached experiment" > experiment.txt
git add experiment.txt
git commit -m "Experiment in detached HEAD"
```

Lihat graph:

```bash
git log --oneline --graph --decorate --all
```

Selamatkan commit itu:

```bash
git switch -c experiment/detached-save
```

Lihat graph lagi:

```bash
git log --oneline --graph --decorate --all
```

---

## 39. Checklist Membaca Commit Graph

Saat melihat graph Git, jangan langsung panik. Baca dengan checklist ini:

```text
1. Branch aktif apa?
2. HEAD menunjuk ke branch atau langsung ke commit?
3. Branch lokal menunjuk ke commit mana?
4. Remote-tracking branch menunjuk ke commit mana?
5. Apakah branch diverged?
6. Common ancestor-nya di mana?
7. Commit mana yang reachable dari branch target?
8. Apakah ada commit yang belum punya branch/tag?
9. Apakah operasi yang akan dilakukan membuat commit baru atau hanya menggeser pointer?
10. Apakah history ini private atau sudah public?
```

Pertanyaan terakhir sangat penting.

Banyak operasi aman di branch lokal pribadi, tetapi berbahaya di branch yang sudah dipakai orang lain.

---

## 40. Common Misconceptions

### 40.1 “Branch berisi commit”

Kurang tepat.

Lebih akurat:

```text
Branch menunjuk ke commit.
Commit yang dianggap bagian dari branch adalah commit yang reachable dari pointer branch tersebut.
```

### 40.2 “Commit hilang setelah reset”

Belum tentu.

Lebih akurat:

```text
Branch tidak lagi menunjuk ke commit itu, tetapi object mungkin masih ada dan bisa direcover lewat reflog.
```

### 40.3 “Rebase mengubah commit”

Kurang tepat.

Lebih akurat:

```text
Rebase membuat commit baru berdasarkan patch lama di atas base baru, lalu memindahkan branch pointer.
```

### 40.4 “Detached HEAD berarti repository rusak”

Salah.

Lebih akurat:

```text
Detached HEAD berarti HEAD menunjuk langsung ke commit, bukan branch. Ini valid, tetapi commit baru perlu diberi branch jika ingin disimpan secara mudah.
```

### 40.5 “origin/main adalah branch remote langsung”

Kurang tepat.

Lebih akurat:

```text
origin/main adalah remote-tracking branch lokal, yaitu snapshot lokal tentang posisi remote branch saat fetch terakhir.
```

---

## 41. Failure Mode dan Cara Berpikirnya

### 41.1 Commit Dibuat di Detached HEAD

Gejala:

```text
You are in detached HEAD state.
```

Lalu kamu membuat commit dan pindah branch.

Solusi:

```bash
git reflog
git branch recovery/<name> <commit-id>
```

Mental model:

```text
Commit ada, tetapi tidak ada branch yang menunjuk ke sana.
Buat ref baru agar commit reachable.
```

---

### 41.2 Branch Terhapus Sebelum Merge

Jika branch lokal dihapus:

```bash
git branch -D feature/payment
```

Commit mungkin masih ada jika:

- pernah menjadi HEAD,
- masih ada di reflog,
- masih reachable dari remote branch,
- atau belum dipruning.

Solusi awal:

```bash
git reflog
git branch feature/payment <commit-id>
```

Mental model:

```text
Menghapus branch berarti menghapus pointer, bukan langsung menghapus commit object.
```

---

### 41.3 Force Push Menimpa Remote History

Misalnya remote:

```text
A <- B <- C <- D  origin/main
```

Local kamu:

```text
A <- B <- C <- E  main
```

Jika kamu force push, remote `main` bisa berpindah dari `D` ke `E`, membuat `D` tidak reachable dari remote main.

Itu bisa menghilangkan kerja orang lain dari branch utama.

Solusi lebih aman:

```bash
git push --force-with-lease
```

Tetapi prinsipnya:

```text
Jangan rewrite public/shared branch kecuali benar-benar paham dampaknya dan tim sepakat.
```

---

### 41.4 Rebase Branch yang Sudah Dipakai Orang Lain

Sebelum:

```text
A <- B <- C  main
      \
       D <- E  shared-feature
```

Orang lain sudah mengambil `D` dan `E`.

Kamu rebase:

```text
A <- B <- C  main
           \
            D' <- E'  shared-feature
```

Sekarang ada dua versi history:

```text
D, E   versi lama yang dimiliki orang lain
D', E' versi baru yang kamu push
```

Ini menyebabkan konflik sosial dan teknis.

Mental model:

```text
Rebase mengganti identitas commit.
Jika commit lama sudah dipakai orang lain, kamu menciptakan duplikasi history.
```

---

## 42. Decision Matrix: Operasi Graph

| Tujuan | Operasi Umum | Efek pada Graph | Aman untuk Public History? |
|---|---|---|---|
| Membuat titik baru | `git commit` | commit baru, branch aktif maju | Ya |
| Membuat branch | `git branch x` | ref baru menunjuk commit | Ya |
| Pindah branch | `git switch x` | HEAD pindah ke branch lain | Ya |
| Melihat commit lama | `git switch --detach` | HEAD langsung ke commit | Ya, jika tidak commit permanen |
| Gabung branch | `git merge` | fast-forward atau merge commit | Ya |
| Rapikan branch lokal | `git rebase` | commit baru, pointer pindah | Ya jika private |
| Batalkan commit public | `git revert` | commit baru pembalik | Ya |
| Kembali ke commit lama | `git reset` | pointer branch mundur | Tidak untuk shared branch |
| Ambil satu commit | `git cherry-pick` | commit baru dengan patch serupa | Umumnya ya |
| Ubah commit terakhir | `git commit --amend` | commit baru menggantikan pointer | Private saja |

---

## 43. Engineering Heuristics

Gunakan prinsip-prinsip ini dalam kerja nyata:

### 43.1 Selalu Ketahui State Sebelum Operasi

Sebelum merge/rebase/reset/push:

```bash
git status
git log --oneline --graph --decorate --all -n 20
```

Jangan menjalankan command destruktif saat tidak tahu posisi `HEAD`.

### 43.2 Jangan Campur “Local Cleanup” dan “Shared Coordination”

Rebase/amend/reset cocok untuk membersihkan history lokal/private.

Merge/revert lebih cocok untuk history shared/public.

### 43.3 Branch Murah, Tetapi Integrasi Mahal

Buat branch untuk isolasi, tetapi jangan biarkan branch terlalu lama diverged.

### 43.4 Tag Release Harus Stabil

Tag release adalah anchor evidence. Jangan pindahkan tag release sembarangan setelah dipublikasikan.

### 43.5 Gunakan Graph untuk Diskusi Tim

Daripada berkata:

```text
Branch-ku aneh.
```

Lebih baik:

```text
Branch feature saya bercabang dari B, main sekarang di D, ada dua commit unik di feature dan dua commit unik di main. Saya ingin rebase feature ke main sebelum PR.
```

Itu bahasa yang bisa ditindaklanjuti.

---

## 44. Mini Case Study: PR yang “Tidak Bisa Fast-Forward”

### Situasi

Kamu membuat branch:

```text
A <- B  main
      \
       C <- D  feature/invoice
```

Selama kamu bekerja, tim merge perubahan lain ke `main`:

```text
A <- B <- E <- F  main
      \
       C <- D  feature/invoice
```

Saat PR, sistem bilang branch out-of-date atau tidak bisa fast-forward.

### Interpretasi Graph

`feature/invoice` tidak berbasis pada `F`, melainkan pada `B`.

Ada commit unik di `main`:

```text
E, F
```

Ada commit unik di feature:

```text
C, D
```

### Pilihan

#### Pilihan 1: Merge main ke feature

```bash
git switch feature/invoice
git merge main
```

Graph:

```text
A <- B <- E <- F  main
      \       \
       C <- D <- M  feature/invoice
```

Kelebihan:

- Tidak rewrite commit `C`, `D`.
- Aman jika branch sudah dipakai orang lain.

Kekurangan:

- Ada merge commit di feature.

#### Pilihan 2: Rebase feature ke main

```bash
git switch feature/invoice
git rebase main
```

Graph:

```text
A <- B <- E <- F  main
                \
                 C' <- D'  feature/invoice
```

Kelebihan:

- History linear.
- PR terlihat seolah dibuat dari main terbaru.

Kekurangan:

- Commit hash berubah.
- Jangan lakukan jika branch sudah dipakai bersama tanpa koordinasi.

### Decision

Jika branch private:

```text
rebase biasanya lebih bersih.
```

Jika branch shared:

```text
merge biasanya lebih aman.
```

---

## 45. Mental Model untuk Top 1% Engineer

Engineer biasa melihat Git seperti daftar command:

```text
git add
git commit
git push
git pull
```

Engineer kuat melihat Git sebagai state machine di atas graph:

```text
Current state:
- HEAD -> feature/payment
- feature/payment -> F
- main -> D
- merge base = B
- unique commits on feature = E, F
- unique commits on main = C, D

Target state:
- feature/payment rebased onto main
- feature/payment -> E', F'
- no uncommitted working tree changes
- push requires --force-with-lease because commit identity changed
```

Pertanyaan engineer kuat sebelum operasi Git:

```text
1. Ref mana yang akan bergerak?
2. Commit baru akan dibuat atau tidak?
3. Commit lama masih reachable atau tidak?
4. Operation ini rewrite history atau preserve history?
5. History ini private atau shared?
6. Bagaimana cara rollback jika salah?
```

Itulah level berpikir yang membedakan pengguna Git biasa dari engineer yang benar-benar menguasai Git.

---

## 46. Ringkasan

Part ini membangun fondasi commit graph.

Inti yang harus melekat:

```text
Commit adalah node immutable.
Parent adalah edge ke masa lalu.
Branch adalah pointer mutable ke commit.
HEAD adalah posisi kerja saat ini.
Reachability menentukan commit mana yang dianggap bagian dari history aktif.
Detached HEAD valid, tetapi commit baru perlu branch agar mudah diselamatkan.
Merge membuat commit dengan lebih dari satu parent.
Rebase membuat commit baru dengan parent baru.
Reset menggeser pointer branch.
Revert membuat commit baru yang membatalkan perubahan lama.
Cherry-pick membuat commit baru dari patch commit lain.
```

Jika kamu memahami part ini, banyak command Git yang sebelumnya terasa seperti mantra akan menjadi operasi logis di atas graph.

---

## 47. Latihan Reflektif

Jawab tanpa menjalankan command terlebih dahulu.

### Soal 1

Graph:

```text
A <- B <- C  main
      \
       D <- E  feature
```

Pertanyaan:

1. Commit apa saja yang reachable dari `main`?
2. Commit apa saja yang reachable dari `feature`?
3. Apa merge base antara `main` dan `feature`?
4. Apakah merge `feature` ke `main` bisa fast-forward?

Jawaban:

```text
1. main: C, B, A
2. feature: E, D, B, A
3. merge base: B
4. Tidak, karena main memiliki commit C yang tidak ada di feature.
```

### Soal 2

Graph:

```text
A <- B <- C <- D  main
```

Kamu menjalankan:

```bash
git reset --hard B
```

Pertanyaan:

1. Branch `main` menunjuk ke mana?
2. Apakah `C` dan `D` langsung pasti hilang dari object database?
3. Bagaimana kemungkinan recovery?

Jawaban:

```text
1. main menunjuk ke B.
2. Tidak pasti. C dan D menjadi unreachable dari main, tetapi object bisa masih ada.
3. Gunakan git reflog lalu buat branch baru ke commit yang ingin diselamatkan.
```

### Soal 3

Kamu berada di detached HEAD pada commit `C`, lalu membuat commit `E`.

```text
A <- B <- C <- D  main
          \
           E  HEAD
```

Pertanyaan:

1. Apa risiko jika kamu langsung `git switch main`?
2. Command apa yang bisa menyelamatkan `E`?

Jawaban:

```text
1. E tidak lagi ditunjuk branch normal sehingga mudah tampak hilang.
2. git switch -c experiment atau git branch experiment E.
```

---

## 48. Operational Checklist Sebelum Lanjut Part Berikutnya

Sebelum lanjut ke part 004, pastikan kamu bisa melakukan ini:

```text
[ ] Menjelaskan commit sebagai node graph.
[ ] Menjelaskan parent commit.
[ ] Menjelaskan perbedaan normal commit dan merge commit.
[ ] Menjelaskan branch sebagai pointer.
[ ] Menjelaskan HEAD normal dan detached HEAD.
[ ] Menjelaskan reachable vs unreachable commit.
[ ] Menjelaskan kenapa rebase mengubah commit hash.
[ ] Menjelaskan kenapa reset bisa membuat commit tampak hilang.
[ ] Membaca output git log --graph --oneline --decorate --all.
[ ] Menggunakan merge-base untuk memahami branch divergence.
```

Jika belum bisa, ulangi lab di bagian 38 sampai visual graph terasa natural.

---

## 49. Referensi Utama

Materi ini disusun dengan mengacu pada dokumentasi dan referensi resmi Git berikut:

- Pro Git Book — **Git Branching: Branches in a Nutshell**: menjelaskan branch sebagai pointer ringan ke commit dan bagaimana commit graph bercabang.
- Pro Git Book — **Git Internals: Git References**: menjelaskan refs, branch refs, tag refs, dan `HEAD` sebagai symbolic reference.
- Git Documentation — **gitglossary**: mendefinisikan istilah seperti ref, head, reachable, dangling object, dan konsep object database.
- Pro Git Book — **Git Internals: Maintenance and Data Recovery**: menjelaskan recovery, unreachable/dangling object, dan peran reflog/maintenance.
- Git Documentation — **user manual / revisions**: menjelaskan reachability, commit selection, dan revision syntax.

---

# Status Seri

```text
Progress: 003 / 032
Seri belum selesai.
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
```

Part berikutnya:

```text
learn-git-mastery-for-java-engineers-part-004.md
```

Topik berikutnya:

```text
Lifecycle Perubahan: Dari Edit File sampai Commit Berkualitas
```

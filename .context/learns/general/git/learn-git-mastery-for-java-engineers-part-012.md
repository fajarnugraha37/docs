# learn-git-mastery-for-java-engineers-part-012.md

# Remote Repository: Clone, Fetch, Pull, Push

> Series: **Git Mastery for Java Engineers**  
> Part: **012 / 032**  
> Status seri: **belum selesai**  
> Bagian terakhir: `learn-git-mastery-for-java-engineers-part-032.md`

---

## 0. Posisi Part Ini dalam Series

Pada part sebelumnya kita sudah membangun fondasi:

1. Git sebagai model evolusi software.
2. Repository, working tree, index, object database.
3. Commit graph, branch, `HEAD`, reachability.
4. Lifecycle perubahan dan commit berkualitas.
5. Membaca history.
6. Diff sebagai pembanding state.
7. Branching sebagai isolasi perubahan.
8. Merge sebagai integrasi graph.
9. Rebase sebagai replay commit.
10. Interactive rebase sebagai penyusunan ulang narasi history.
11. Conflict resolution sebagai strategi integrasi perubahan.

Sekarang kita masuk ke wilayah yang sering membuat engineer salah paham:

```text
remote repository
```

Banyak developer memperlakukan remote sebagai “server Git”, “GitHub”, “GitLab”, “Bitbucket”, atau “cloud tempat push”. Secara praktis itu tidak salah, tetapi secara mental model kurang tajam.

Git tidak didesain dengan asumsi hanya ada satu repository pusat. Git adalah **distributed version control system**. Artinya:

```text
Setiap clone adalah repository penuh yang punya object database, refs, branches, tags, dan history sendiri.
```

Remote bukan sumber kebenaran metafisik. Remote hanyalah **repository lain** yang kita beri nama, biasanya `origin`, dan kita sinkronkan melalui operasi network seperti `fetch` dan `push`.

Mental model ini penting karena banyak operasi Git yang tampak membingungkan sebenarnya menjadi jelas jika dipahami sebagai sinkronisasi antar repository.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus bisa:

1. Menjelaskan apa itu remote repository secara konseptual.
2. Membedakan local branch, remote-tracking branch, dan upstream branch.
3. Menjelaskan apa yang terjadi saat `git clone`.
4. Menjelaskan kenapa `git fetch` aman dan tidak mengubah working tree.
5. Menjelaskan kenapa `git pull` bisa berbahaya jika dipakai tanpa memahami integrasi.
6. Membedakan `pull --merge`, `pull --rebase`, dan `fetch + merge/rebase` manual.
7. Memahami push sebagai update ref pada repository lain.
8. Menangani push rejection dengan benar.
9. Memahami kapan force push boleh dilakukan dan kenapa `--force-with-lease` lebih aman daripada `--force`.
10. Mendesain kebiasaan sinkronisasi yang aman untuk tim Java/backend.

---

## 2. Masalah yang Diselesaikan Remote Repository

Tanpa remote, Git tetap bisa bekerja.

Kamu bisa:

```bash
git init
git add .
git commit -m "Initial commit"
git branch feature/payment-refactor
```

Semua itu lokal.

Masalah muncul ketika:

1. Banyak engineer bekerja pada codebase yang sama.
2. CI perlu mengambil source code.
3. Pull request perlu dibuat.
4. Release perlu ditandai.
5. Production hotfix perlu dikolaborasikan.
6. History perlu diaudit oleh tim.
7. Build server perlu mengambil commit tertentu.
8. Branch protection perlu diberlakukan.

Remote repository menyelesaikan masalah koordinasi:

```text
local repo engineer A
local repo engineer B
local repo engineer C
          │
          ▼
remote repo bersama
          │
          ▼
CI/CD, review, release, audit
```

Tetapi penting:

```text
Remote tidak otomatis sinkron dengan local.
```

Local repository dan remote repository adalah dua graph yang bisa berbeda.

---

## 3. Mental Model Utama: Remote adalah Repository Lain

Misalkan ada remote repository:

```text
git@github.com:company/order-service.git
```

Saat kamu clone:

```bash
git clone git@github.com:company/order-service.git
```

Kamu tidak hanya membuat folder kerja. Kamu membuat repository lokal:

```text
order-service/
  .git/
    objects/
    refs/
    HEAD
    config
  src/
  pom.xml
```

Repository lokal ini punya:

1. Object database sendiri.
2. Branch sendiri.
3. Remote-tracking refs sendiri.
4. Working tree sendiri.
5. Index sendiri.

Remote repository juga punya object database dan refs sendiri.

Secara konseptual:

```text
Local Repository                         Remote Repository

.git/objects                             objects
refs/heads/main                          refs/heads/main
refs/heads/feature/x                     refs/heads/release/1.4
refs/remotes/origin/main       <---->    refs/heads/main
working tree                             no working tree in bare repo
index                                    no index for normal bare repo
```

Banyak hosted Git server menyimpan remote repository sebagai **bare repository**. Bare repository biasanya tidak punya working tree karena fungsinya bukan tempat edit file, tetapi tempat menyimpan object dan refs.

---

## 4. Remote Name: Kenapa Biasanya `origin`?

Setelah clone, biasanya Git membuat remote bernama `origin`.

Cek:

```bash
git remote
```

Output:

```text
origin
```

Cek detail URL:

```bash
git remote -v
```

Output contoh:

```text
origin  git@github.com:company/order-service.git (fetch)
origin  git@github.com:company/order-service.git (push)
```

`origin` bukan keyword sakral.

Itu hanya nama default untuk remote asal clone.

Kamu bisa punya beberapa remote:

```bash
git remote add upstream git@github.com:main-org/order-service.git
git remote add fork git@github.com:your-user/order-service.git
```

Contoh pada open source:

```text
origin    = fork milikmu
upstream  = repository utama project
```

Contoh pada enterprise migration:

```text
origin    = GitHub Enterprise baru
old       = GitLab lama
backup    = mirror internal
```

Mental model:

```text
Remote name hanyalah alias ke repository lain.
```

---

## 5. Local Branch vs Remote-Tracking Branch

Ini bagian yang sangat penting.

Misalkan remote punya branch:

```text
main
feature/payment-api
release/1.8
```

Setelah kamu `fetch`, Git membuat atau memperbarui remote-tracking refs lokal:

```text
origin/main
origin/feature/payment-api
origin/release/1.8
```

Perhatikan:

```text
origin/main bukan branch remote yang sedang live di server.
origin/main adalah local reference yang mencatat posisi terakhir branch main remote saat terakhir fetch.
```

Dengan kata lain:

```text
origin/main = cache lokal tentang main di origin
```

Jika remote `main` sudah maju, tetapi kamu belum fetch, maka `origin/main` di local masih lama.

### 5.1 Contoh

Awalnya:

```text
Remote origin/main: A---B---C
Local origin/main:  A---B---C
Local main:         A---B---C
```

Engineer lain push commit `D` ke remote.

Remote sekarang:

```text
Remote origin/main: A---B---C---D
```

Tetapi local kamu belum tahu.

Di local:

```text
Local origin/main:  A---B---C
Local main:         A---B---C
```

Setelah:

```bash
git fetch origin
```

Local menjadi:

```text
Local origin/main:  A---B---C---D
Local main:         A---B---C
```

`fetch` mengupdate remote-tracking branch, bukan local branch kamu.

---

## 6. Upstream Branch: Relasi Tracking untuk Local Branch

Saat kamu berada di local branch `main`, branch itu bisa dikonfigurasi untuk track `origin/main`.

Cek:

```bash
git branch -vv
```

Output contoh:

```text
* main  a1b2c3d [origin/main] Add payment validation
```

Artinya:

```text
local main punya upstream origin/main
```

Upstream dipakai oleh Git untuk menentukan default target saat kamu menjalankan:

```bash
git pull
git push
git status
```

Contoh output `git status`:

```text
Your branch is ahead of 'origin/main' by 2 commits.
```

Artinya:

```text
local main punya 2 commit yang belum ada di origin/main
```

Atau:

```text
Your branch is behind 'origin/main' by 3 commits.
```

Artinya:

```text
origin/main punya 3 commit yang belum ada di local main
```

Atau:

```text
Your branch and 'origin/main' have diverged,
and have 2 and 3 different commits each, respectively.
```

Artinya:

```text
local main punya commit sendiri,
origin/main juga punya commit lain,
dan keduanya perlu diintegrasikan.
```

---

## 7. `git clone`: Apa yang Sebenarnya Terjadi?

Command:

```bash
git clone git@github.com:company/order-service.git
```

Secara konseptual melakukan beberapa hal:

1. Membuat directory baru.
2. Membuat `.git` repository lokal.
3. Menambahkan remote bernama `origin`.
4. Mengambil object dan refs dari remote.
5. Membuat remote-tracking branch seperti `origin/main`.
6. Membuat local branch default, biasanya `main`.
7. Mengatur local branch tersebut untuk track `origin/main`.
8. Checkout snapshot branch default ke working tree.

Setelah clone:

```bash
cd order-service
git status
git branch -vv
git remote -v
```

Biasanya kamu melihat:

```text
On branch main
Your branch is up to date with 'origin/main'.
```

Graph sederhana:

```text
origin/main
    │
    ▼
A---B---C
        ▲
        │
       main
       HEAD
```

`main` dan `origin/main` menunjuk commit yang sama.

---

## 8. Clone Tidak Selalu Sama: Full, Shallow, Partial, Sparse

Pada repository kecil, clone default cukup.

Pada repository besar, terutama monorepo Java atau repository dengan history panjang, clone strategy menjadi penting.

### 8.1 Full Clone

```bash
git clone git@github.com:company/big-platform.git
```

Mengambil history penuh dan object yang dibutuhkan.

Kelebihan:

1. Semua history lokal tersedia.
2. `bisect`, `blame`, `log`, dan checkout commit lama bekerja penuh.
3. Cocok untuk development normal.

Kekurangan:

1. Lambat untuk repo besar.
2. Berat untuk CI ephemeral.
3. Bisa boros storage.

### 8.2 Shallow Clone

```bash
git clone --depth=1 git@github.com:company/big-platform.git
```

Mengambil history terbatas.

Kelebihan:

1. Cepat.
2. Hemat bandwidth.
3. Cocok untuk sebagian pipeline CI.

Kekurangan:

1. History tidak lengkap.
2. `git blame`, `git bisect`, release notes, dan comparison historis bisa terbatas.
3. Beberapa operasi merge/rebase/tag bisa membutuhkan unshallow.

Untuk CI Java:

```text
shallow clone cocok untuk build/test cepat,
tetapi kurang cocok untuk pipeline yang perlu changelog, semantic versioning dari tag, atau analysis history.
```

### 8.3 Partial Clone

Partial clone memungkinkan Git menunda pengambilan object tertentu sampai dibutuhkan.

Contoh:

```bash
git clone --filter=blob:none git@github.com:company/big-platform.git
```

Cocok untuk repository sangat besar.

### 8.4 Sparse Checkout

Sparse checkout membuat working tree hanya berisi sebagian path.

Contoh:

```bash
git sparse-checkout init --cone
git sparse-checkout set services/order-service libs/common
```

Cocok untuk monorepo besar.

Tetapi sparse checkout harus dipahami sebagai optimasi working tree, bukan pemisahan repository secara logis.

---

## 9. `git fetch`: Sinkronisasi Informasi Tanpa Mengubah Kerja Aktif

Command:

```bash
git fetch origin
```

Melakukan:

1. Menghubungi remote `origin`.
2. Mengambil object baru yang belum ada di local.
3. Memperbarui remote-tracking refs seperti `origin/main`.
4. Tidak mengubah local branch aktif.
5. Tidak mengubah working tree.
6. Tidak mengubah index.

Inilah kenapa `fetch` adalah command yang relatif aman.

Jika kamu sedang bekerja di branch:

```text
main
```

Lalu menjalankan:

```bash
git fetch origin
```

`main` tidak otomatis berubah.

Graph:

Sebelum fetch:

```text
origin/main: A---B---C
main:        A---B---C---E
```

Remote sebenarnya sudah punya `D`:

```text
remote main: A---B---C---D
```

Setelah fetch:

```text
origin/main: A---B---C---D
main:        A---B---C---E
```

Sekarang local tahu bahwa branch diverged:

```text
        D  origin/main
       /
A---B---C---E  main
```

Belum ada integrasi. Kamu baru memperbarui informasi.

---

## 10. Kenapa `fetch` adalah Kebiasaan Senior Engineer

Engineer yang kuat sering memisahkan dua tahap:

```text
1. Ambil informasi dari remote.
2. Putuskan strategi integrasi.
```

Daripada langsung:

```bash
git pull
```

Mereka sering melakukan:

```bash
git fetch origin
git log --oneline --graph --decorate --all --max-count=30
git status
git diff main..origin/main
```

Lalu baru memilih:

```bash
git merge origin/main
```

atau:

```bash
git rebase origin/main
```

atau tidak melakukan apa-apa karena sedang di branch yang tidak boleh diubah.

Mental model:

```text
fetch is observation.
pull is observation + mutation.
```

Dalam sistem kompleks, operasi observasi biasanya lebih aman daripada operasi mutasi.

---

## 11. `git pull`: Fetch + Integrate

`git pull` bukan command primitive sederhana.

Secara konseptual:

```text
git pull = git fetch + integrasi ke branch aktif
```

Integrasi bisa berupa:

1. merge, atau
2. rebase,

gantung konfigurasi.

Default historis banyak setup adalah merge, tetapi banyak tim mengubah ke rebase.

Contoh:

```bash
git pull origin main
```

Kurang lebih:

```bash
git fetch origin main
git merge FETCH_HEAD
```

Jika configured pull rebase:

```bash
git pull --rebase origin main
```

Kurang lebih:

```bash
git fetch origin main
git rebase FETCH_HEAD
```

### 11.1 Kenapa `pull` Bisa Berbahaya?

Karena kamu menjalankan operasi integrasi tanpa melihat dulu apa yang akan diintegrasikan.

Bayangkan kamu punya work-in-progress di branch feature:

```text
A---B---C---E---F  feature/local
         \
          D        origin/feature/local
```

Kamu menjalankan:

```bash
git pull
```

Jika pull melakukan merge, Git bisa membuat merge commit.

Jika pull melakukan rebase, Git akan replay `E` dan `F` di atas `D`.

Keduanya bisa benar, tetapi kalau tidak disengaja, history bisa menjadi berbeda dari yang kamu harapkan.

---

## 12. Pull dengan Merge

Command:

```bash
git pull --no-rebase
```

Atau eksplisit:

```bash
git fetch origin
git merge origin/main
```

Jika local branch dan upstream diverged:

```text
        D---E  origin/main
       /
A---B---C---F  main
```

Merge menghasilkan:

```text
        D---E  origin/main
       /     \
A---B---C---F---M  main
```

Kelebihan:

1. Tidak menulis ulang commit lokal.
2. Aman untuk public history.
3. Mempertahankan fakta integrasi.
4. Cocok untuk branch bersama.

Kekurangan:

1. Bisa membuat history penuh merge commit kecil.
2. Jika sering pull merge di feature branch, graph bisa berisik.
3. Review stack commit bisa lebih sulit.

Cocok untuk:

1. Branch yang sudah public/shared.
2. Release branch.
3. Integrasi antar branch tim.
4. Situasi saat audit trail integrasi penting.

---

## 13. Pull dengan Rebase

Command:

```bash
git pull --rebase
```

Atau eksplisit:

```bash
git fetch origin
git rebase origin/main
```

Jika graph:

```text
        D---E  origin/main
       /
A---B---C---F  main
```

Rebase menghasilkan:

```text
A---B---C---D---E---F'  main
                ▲
                │
           origin/main
```

Commit `F` lama diganti dengan commit baru `F'`.

Kelebihan:

1. History lebih linear.
2. Cocok untuk feature branch pribadi.
3. PR lebih mudah dibaca.
4. Menghindari merge commit kecil akibat sinkronisasi harian.

Kekurangan:

1. Rewrite history.
2. Berbahaya jika commit sudah dipakai orang lain.
3. Bisa membuat conflict berulang di setiap commit.
4. Perlu pemahaman recovery.

Cocok untuk:

1. Feature branch pribadi.
2. Cleanup sebelum PR.
3. Menjaga branch tetap di atas main terbaru.

Tidak cocok untuk:

1. Branch bersama yang banyak orang pakai.
2. Release branch public.
3. Branch yang sudah menjadi base branch untuk banyak branch lain tanpa koordinasi.

---

## 14. Pull dengan Fast-Forward Only

Command:

```bash
git pull --ff-only
```

Atau konfigurasi:

```bash
git config --global pull.ff only
```

Artinya:

```text
Pull hanya berhasil jika branch lokal bisa dimajukan tanpa merge commit dan tanpa rebase.
```

Jika local tidak punya commit tambahan:

```text
Local main:        A---B---C
origin/main:       A---B---C---D---E
```

Fast-forward menjadi:

```text
main/origin-main:  A---B---C---D---E
```

Jika diverged:

```text
        D---E  origin/main
       /
A---B---C---F  main
```

`pull --ff-only` akan gagal.

Ini bagus karena memaksa kamu sadar bahwa perlu keputusan eksplisit:

```bash
git merge origin/main
# atau
git rebase origin/main
```

Untuk banyak engineer senior, ini default yang sehat:

```bash
git config --global pull.ff only
```

Lalu gunakan `fetch + merge/rebase` saat perlu integrasi non-trivial.

---

## 15. `FETCH_HEAD`: Pointer Sementara Setelah Fetch

Saat menjalankan:

```bash
git fetch origin main
```

Git menyimpan informasi hasil fetch di:

```text
.git/FETCH_HEAD
```

Kamu bisa melakukan:

```bash
git merge FETCH_HEAD
```

atau:

```bash
git rebase FETCH_HEAD
```

Pada workflow modern, kita lebih sering memakai remote-tracking branch eksplisit:

```bash
git merge origin/main
git rebase origin/main
```

Tetapi memahami `FETCH_HEAD` membantu saat membaca dokumentasi atau debugging operasi fetch/pull.

---

## 16. `git push`: Mengirim Object dan Mengupdate Ref Remote

Command:

```bash
git push origin main
```

Secara konseptual:

1. Git menentukan commit lokal yang belum dimiliki remote.
2. Git mengirim object yang dibutuhkan.
3. Git meminta remote memperbarui ref `refs/heads/main`.
4. Remote menerima atau menolak update tersebut.

Push bukan sekadar “upload file”.

Push adalah permintaan:

```text
Tolong ubah branch main di remote agar menunjuk ke commit ini.
```

Jika local `main`:

```text
A---B---C---D  main
```

Remote `main`:

```text
A---B---C  origin/main
```

Push fast-forward:

```bash
git push origin main
```

Remote menjadi:

```text
A---B---C---D  main
```

Ini aman karena remote hanya maju.

---

## 17. Push Rejection: Non-Fast-Forward

Push bisa ditolak jika remote punya commit yang local kamu belum punya.

Contoh:

Remote:

```text
A---B---C---D  origin/main
```

Local:

```text
A---B---C---E  main
```

Kamu menjalankan:

```bash
git push origin main
```

Remote menolak:

```text
! [rejected] main -> main (non-fast-forward)
```

Artinya:

```text
Jika remote menerima push kamu, commit D di remote akan tidak reachable dari main.
```

Git melindungi remote dari kehilangan history.

### 17.1 Cara Salah Merespons

Cara buruk:

```bash
git push --force origin main
```

Ini bisa menghapus commit orang lain dari branch remote.

### 17.2 Cara Benar Merespons

Pertama ambil update:

```bash
git fetch origin
```

Lihat graph:

```bash
git log --oneline --graph --decorate --all --max-count=30
```

Lalu pilih integrasi:

```bash
git rebase origin/main
```

atau:

```bash
git merge origin/main
```

Setelah itu push lagi:

```bash
git push origin main
```

Jika memilih rebase, graph menjadi:

```text
A---B---C---D---E'  main
            ▲
            │
       origin/main
```

Push sekarang fast-forward.

Jika memilih merge:

```text
A---B---C---D---M  main
         \     /
          E---
```

Push juga fast-forward terhadap remote karena remote `D` tetap preserved.

---

## 18. `--force` vs `--force-with-lease`

Kadang force push memang diperlukan, terutama setelah rewrite private feature branch.

Contoh:

```bash
git rebase -i origin/main
```

Commit lama:

```text
A---B---C---F---G  feature
```

Menjadi:

```text
A---B---C---F'---G'  feature
```

Remote masih punya `F---G`.

Push biasa ditolak karena bukan fast-forward.

### 18.1 `--force`

```bash
git push --force origin feature/payment-api
```

Artinya:

```text
Update remote branch ke commit lokal saya, walaupun remote akan kehilangan commit yang sekarang ada.
```

Masalahnya: jika orang lain sudah push commit baru ke branch itu sejak fetch terakhir, `--force` bisa menimpa commit mereka.

### 18.2 `--force-with-lease`

```bash
git push --force-with-lease origin feature/payment-api
```

Artinya kira-kira:

```text
Force update boleh dilakukan hanya jika remote branch masih berada pada posisi yang saya kira.
```

Jika remote sudah berubah oleh orang lain, push ditolak.

Ini jauh lebih aman.

Rule praktis:

```text
Jangan gunakan --force untuk branch kolaboratif.
Jika benar-benar perlu force push feature branch pribadi, gunakan --force-with-lease.
```

---

## 19. Push Default dan Upstream

Saat membuat branch baru:

```bash
git switch -c feature/payment-validation
```

Branch ini belum ada di remote.

Push pertama:

```bash
git push -u origin feature/payment-validation
```

`-u` atau `--set-upstream` mengatur upstream branch.

Setelah itu cukup:

```bash
git push
```

Dan:

```bash
git pull
```

Git tahu default remote/branch.

Cek:

```bash
git branch -vv
```

Output:

```text
* feature/payment-validation  abc1234 [origin/feature/payment-validation] Add validation rules
```

### 19.1 Konfigurasi Push Default

Cek:

```bash
git config --global push.default
```

Value umum:

```text
simple
```

`simple` berarti Git push current branch ke upstream branch dengan nama yang sesuai. Ini default yang aman untuk kebanyakan developer.

---

## 20. Remote-Tracking Branch Bukan Branch Kerja

Remote-tracking branch seperti `origin/main` tidak seharusnya kamu commit langsung.

Jika kamu checkout:

```bash
git switch --detach origin/main
```

Kamu masuk detached HEAD.

Jika ingin membuat branch lokal dari remote branch:

```bash
git switch -c feature/payment-api origin/feature/payment-api
```

Atau versi modern yang lebih sederhana:

```bash
git switch --track origin/feature/payment-api
```

Jika nama branch lokal sama:

```bash
git switch feature/payment-api
```

Git sering bisa otomatis membuat local branch yang track remote branch jika nama unik.

Mental model:

```text
origin/xxx adalah read-only-ish tracking pointer lokal.
xxx adalah branch lokal tempat kamu bekerja.
```

Secara teknis kamu bisa memanipulasi remote-tracking refs, tetapi secara workflow normal jangan jadikan itu tempat kerja.

---

## 21. Pruning: Membersihkan Remote-Tracking Branch yang Sudah Hilang

Jika branch remote dihapus, misalnya PR sudah merge lalu branch dihapus di server, local kamu mungkin masih punya:

```text
origin/feature/old-branch
```

Padahal di remote sudah tidak ada.

Gunakan:

```bash
git fetch --prune origin
```

Atau:

```bash
git remote prune origin
```

Konfigurasi otomatis:

```bash
git config --global fetch.prune true
```

Ini tidak menghapus local branch kamu. Ini hanya membersihkan remote-tracking refs yang stale.

Cek branch remote-tracking:

```bash
git branch -r
```

Cek branch lokal yang sudah merged:

```bash
git branch --merged main
```

Hapus branch lokal lama:

```bash
git branch -d feature/old-branch
```

Jika belum merged tetapi yakin mau hapus:

```bash
git branch -D feature/old-branch
```

---

## 22. Remote URL: SSH vs HTTPS

Cek remote URL:

```bash
git remote -v
```

Contoh SSH:

```text
origin  git@github.com:company/order-service.git (fetch)
origin  git@github.com:company/order-service.git (push)
```

Contoh HTTPS:

```text
origin  https://github.com/company/order-service.git (fetch)
origin  https://github.com/company/order-service.git (push)
```

Ganti URL:

```bash
git remote set-url origin git@github.com:company/order-service.git
```

### 22.1 SSH

Kelebihan:

1. Nyaman untuk developer harian.
2. Tidak perlu token setiap push.
3. Bisa memakai SSH key per device.

Risiko:

1. Key management harus benar.
2. Key lama perlu dicabut saat device hilang.

### 22.2 HTTPS

Kelebihan:

1. Sering lebih mudah di lingkungan korporat tertentu.
2. Bisa menggunakan token berbasis policy.
3. Cocok untuk automation tertentu.

Risiko:

1. Token harus dijaga seperti secret.
2. Credential helper perlu dikonfigurasi dengan aman.

Rule untuk tim:

```text
Akses Git adalah bagian dari supply chain security.
Jangan perlakukan remote credential sebagai hal sepele.
```

---

## 23. Authentication vs Authorization

Saat push gagal, penyebabnya bisa berbeda.

### 23.1 Authentication gagal

Artinya remote tidak tahu atau tidak percaya identitasmu.

Gejala:

```text
Permission denied (publickey)
Authentication failed
```

Masalah umum:

1. SSH key belum terdaftar.
2. Token expired.
3. Credential helper menyimpan credential lama.
4. Salah akun GitHub/GitLab.
5. Corporate SSO belum authorize.

### 23.2 Authorization gagal

Artinya remote tahu siapa kamu, tetapi kamu tidak punya hak melakukan operasi itu.

Gejala:

```text
You are not allowed to push code to this project.
Protected branch hook declined.
```

Penyebab:

1. Tidak punya write permission.
2. Branch protected.
3. Required PR review.
4. Required status checks.
5. Signed commits required.
6. Commit message policy gagal.

Sebagai engineer senior, bedakan:

```text
authentication = siapa kamu?
authorization = apa yang boleh kamu lakukan?
```

---

## 24. Protected Branch dan Push Policy

Pada tim profesional, branch seperti `main`, `master`, `develop`, atau `release/*` biasanya dilindungi.

Contoh policy:

1. Tidak boleh direct push ke `main`.
2. Harus melalui pull request.
3. Minimal satu atau dua approval.
4. CI wajib hijau.
5. Tidak boleh force push.
6. Branch harus up to date sebelum merge.
7. Commit harus signed.
8. Linear history required.

Ini bukan hambatan birokrasi semata.

Ini guardrail untuk menjaga:

1. Traceability.
2. Reviewability.
3. Auditability.
4. Release safety.
5. Supply chain integrity.

Untuk Java backend di sistem production:

```text
main branch adalah jalur menuju artifact production.
```

Maka push policy adalah bagian dari production control.

---

## 25. Remote dalam Pull Request Workflow

PR/MR pada dasarnya membandingkan dua refs:

```text
base branch: main
head branch: feature/payment-validation
```

Biasanya head branch ada di remote:

```text
origin/feature/payment-validation
```

Saat kamu push update ke branch itu:

```bash
git push origin feature/payment-validation
```

PR otomatis update karena remote ref berubah.

### 25.1 PR Setelah Rebase

Jika kamu rebase branch feature:

```bash
git fetch origin
git rebase origin/main
```

Lalu branch lokal punya commit baru.

Push biasa ditolak.

Gunakan:

```bash
git push --force-with-lease
```

PR akan update dengan commit baru.

Ini normal jika branch tersebut milikmu sendiri.

Tetapi jika PR branch dipakai beberapa orang, koordinasi wajib.

---

## 26. `origin/main` Bisa Stale

Kesalahan umum:

```bash
git diff main..origin/main
```

lalu menganggap hasilnya menggambarkan remote saat ini.

Padahal `origin/main` hanya seakurat fetch terakhir.

Biasakan:

```bash
git fetch origin
```

sebelum membuat keputusan berbasis remote-tracking branch.

Contoh keputusan yang butuh fetch terbaru:

1. Rebase ke `origin/main`.
2. Membuat release notes.
3. Membandingkan branch untuk PR lokal.
4. Menentukan apakah branch sudah merged.
5. Menghapus branch lokal.
6. Menilai push rejection.

Mental model:

```text
origin/main is not the remote.
origin/main is your last known remote/main.
```

---

## 27. `git remote show origin`

Command:

```bash
git remote show origin
```

Memberikan informasi:

1. Fetch URL.
2. Push URL.
3. HEAD branch remote.
4. Remote branches.
5. Local branches configured for pull.
6. Local refs configured for push.
7. Stale remote branches.

Contoh output ringkas:

```text
* remote origin
  Fetch URL: git@github.com:company/order-service.git
  Push  URL: git@github.com:company/order-service.git
  HEAD branch: main
  Remote branches:
    main tracked
    release/1.8 tracked
  Local branches configured for 'git pull':
    main merges with remote main
  Local refs configured for 'git push':
    main pushes to main (up to date)
```

Ini berguna saat:

1. Branch tracking terasa aneh.
2. `git pull` mengambil branch yang tidak diharapkan.
3. Push default membingungkan.
4. Remote HEAD berubah dari `master` ke `main`.

---

## 28. `git ls-remote`: Melihat Remote Tanpa Fetch Penuh

Command:

```bash
git ls-remote origin
```

Menampilkan refs yang ada di remote.

Contoh:

```text
a1b2c3d refs/heads/main
b2c3d4e refs/heads/release/1.8
c3d4e5f refs/tags/v1.8.0
```

Berguna untuk:

1. Mengecek apakah branch/tag ada di remote.
2. Automation script.
3. CI/CD validation.
4. Debugging tanpa mengubah local refs.

---

## 29. Tags dan Remote

Tag tidak selalu otomatis ikut push.

Membuat tag lokal:

```bash
git tag -a v1.8.0 -m "Release v1.8.0"
```

Push tag tertentu:

```bash
git push origin v1.8.0
```

Push semua tag:

```bash
git push origin --tags
```

Ambil tags:

```bash
git fetch --tags
```

Atau fetch dengan prune tags:

```bash
git fetch --prune --prune-tags
```

Untuk release Java:

```text
Git tag sering menjadi anchor antara source code, CI build, Maven/Gradle artifact, Docker image, dan deployment record.
```

Karena itu tag policy harus jelas:

1. Siapa boleh membuat tag release?
2. Apakah tag boleh dipindah?
3. Apakah tag harus annotated?
4. Apakah tag harus signed?
5. Apakah CI deploy berdasarkan tag?

Rule kuat:

```text
Release tag sebaiknya immutable secara organisasi.
```

---

## 30. Remote Branch Deletion

Hapus branch remote:

```bash
git push origin --delete feature/old-branch
```

Atau bentuk refspec lama:

```bash
git push origin :feature/old-branch
```

Setelah branch remote dihapus, developer lain perlu prune:

```bash
git fetch --prune origin
```

Hapus branch lokal:

```bash
git branch -d feature/old-branch
```

Dalam PR workflow, branch feature biasanya dihapus setelah merge untuk mengurangi noise.

Tetapi jangan hapus branch release/hotfix tanpa policy.

---

## 31. Multiple Remotes

### 31.1 Fork Workflow

```text
upstream = repository utama
origin   = fork milikmu
```

Setup:

```bash
git clone git@github.com:your-user/project.git
cd project
git remote add upstream git@github.com:main-org/project.git
```

Sinkronisasi:

```bash
git fetch upstream
git switch main
git merge upstream/main
git push origin main
```

Feature branch:

```bash
git switch -c feature/my-change
git push -u origin feature/my-change
```

PR dibuat dari:

```text
your-user:feature/my-change -> main-org:main
```

### 31.2 Mirror/Migration Workflow

Kadang satu repo perlu push ke dua remote:

```bash
git remote add github git@github.com:company/order-service.git
git remote add gitlab git@gitlab.company.com:platform/order-service.git
```

Push ke remote tertentu:

```bash
git push github main
git push gitlab main
```

Untuk migration, hati-hati dengan:

1. Branches.
2. Tags.
3. Protected branch policy.
4. CI secrets.
5. Webhooks.
6. Deploy keys.
7. Commit signature verification.

---

## 32. Refspec: Mapping Ref Local ke Remote

Saat kamu menjalankan:

```bash
git fetch origin
```

Git memakai refspec untuk memetakan remote refs ke local remote-tracking refs.

Cek:

```bash
git config --get-all remote.origin.fetch
```

Biasanya:

```text
+refs/heads/*:refs/remotes/origin/*
```

Artinya:

```text
Ambil semua branch remote di refs/heads/*
dan simpan sebagai refs/remotes/origin/* di local.
```

Saat push:

```bash
git push origin main
```

Secara konseptual:

```text
local refs/heads/main -> remote refs/heads/main
```

Bisa eksplisit:

```bash
git push origin local-branch:remote-branch
```

Contoh:

```bash
git push origin feature/local-payment:feature/payment-api
```

Artinya:

```text
Push local branch feature/local-payment ke remote branch feature/payment-api.
```

Refspec jarang diperlukan sehari-hari, tetapi penting untuk memahami operasi advanced dan automation.

---

## 33. `pull` Configuration yang Sehat

Git modern sering meminta kamu menentukan strategi pull saat branch diverged.

Pilihan konfigurasi:

### 33.1 Pull Merge

```bash
git config --global pull.rebase false
```

### 33.2 Pull Rebase

```bash
git config --global pull.rebase true
```

### 33.3 Pull Fast-Forward Only

```bash
git config --global pull.ff only
```

Rekomendasi untuk engineer yang ingin aman:

```bash
git config --global pull.ff only
```

Lalu saat diverged, lakukan eksplisit:

```bash
git fetch origin
git rebase origin/main
```

atau:

```bash
git fetch origin
git merge origin/main
```

Untuk tim, konfigurasi bisa berbeda tergantung workflow.

### 33.4 Rekomendasi Berdasarkan Konteks

| Konteks | Rekomendasi |
|---|---|
| Feature branch pribadi | `fetch + rebase origin/main` |
| Branch shared | `fetch + merge` |
| Main branch lokal tanpa commit lokal | `pull --ff-only` |
| Release branch | Hindari rebase; gunakan merge/cherry-pick sesuai policy |
| Hotfix branch | Eksplisit; jangan pull sembarangan |
| CI checkout | Fetch ref spesifik atau clone depth sesuai kebutuhan |

---

## 34. Remote Workflow untuk Java Engineer Harian

Workflow aman untuk feature branch:

```bash
# 1. Ambil informasi terbaru
git fetch origin

# 2. Pastikan base lokal main terbaru
git switch main
git pull --ff-only

# 3. Buat branch feature
git switch -c feature/payment-validation

# 4. Kerjakan perubahan
# edit src/main/java/...
# edit src/test/java/...

# 5. Commit atomic
git add -p
git commit -m "Validate payment request amount"

# 6. Sinkron dengan main terbaru sebelum PR
git fetch origin
git rebase origin/main

# 7. Jalankan test
./mvnw test
# atau
./gradlew test

# 8. Push branch
git push -u origin feature/payment-validation
```

Jika setelah review perlu update:

```bash
# edit
git add -p
git commit --fixup <target-commit>
git rebase -i --autosquash origin/main
./mvnw test
git push --force-with-lease
```

---

## 35. Workflow Aman Saat Push Ditolak

Saat melihat:

```text
! [rejected] feature/payment-validation -> feature/payment-validation (non-fast-forward)
```

Jangan panik.

Langkah:

```bash
git fetch origin
git status
git log --oneline --graph --decorate --all --max-count=40
```

Tanya:

1. Apakah branch ini hanya milikku?
2. Apakah ada orang lain push ke branch ini?
3. Apakah commit remote harus dipertahankan?
4. Apakah branch ini sudah dipakai sebagai base oleh orang lain?
5. Apakah PR akan rusak jika history di-rewrite?

Jika branch pribadi dan rejection karena kamu rebase:

```bash
git push --force-with-lease
```

Jika branch shared:

```bash
git merge origin/feature/payment-validation
# atau koordinasikan rebase dengan tim
```

Jika tidak yakin:

```bash
git branch backup/feature-payment-before-fix
```

Backup branch murah dan memberi safety net.

---

## 36. Avoiding Accidental Push to Wrong Branch

Sebelum push:

```bash
git status
git branch -vv
git log --oneline --decorate -5
```

Pastikan:

1. Branch aktif benar.
2. Upstream benar.
3. Commit terakhir sesuai.
4. Tidak sedang di detached HEAD.
5. Tidak push ke `main` jika policy melarang.

Konfigurasi helpful:

```bash
git config --global push.default simple
```

Alias aman:

```bash
git config --global alias.st "status -sb"
git config --global alias.br "branch -vv"
git config --global alias.lg "log --oneline --graph --decorate --all --max-count=30"
```

Sebelum push:

```bash
git st
git br
git lg
```

---

## 37. Remote dan CI/CD

CI biasanya melakukan fetch/checkout pada commit tertentu.

Dalam PR build, CI bisa checkout:

1. Head branch commit.
2. Synthetic merge commit antara PR branch dan base branch.
3. Merge queue commit.
4. Tag commit untuk release.

Karena itu hasil CI bisa berbeda dari local jika:

1. Local branch belum rebase/merge dengan main terbaru.
2. CI menjalankan merge result, bukan head branch murni.
3. Shallow clone membuat tag/history tidak tersedia.
4. Generated files berbeda.
5. Submodule tidak di-fetch.
6. LFS objects tidak diambil.
7. Sparse checkout salah path.

Untuk Java project, perhatikan:

1. Maven/Gradle dependency cache.
2. Wrapper version.
3. Annotation processor.
4. Generated sources.
5. Integration test profile.
6. Docker build context.
7. Versioning dari Git tag.

Rule:

```text
CI harus membangun artifact dari commit/ref yang jelas dan reproducible.
```

---

## 38. Remote dan Release Traceability

Dalam pipeline release yang sehat:

```text
commit -> CI build -> artifact -> container image -> deployment -> production evidence
```

Git remote menyediakan anchor:

1. Branch policy memastikan commit masuk lewat review.
2. Tag menandai release source.
3. Commit SHA mengidentifikasi source persis.
4. PR menghubungkan discussion dan approval.
5. CI status menghubungkan validation.
6. Deployment record menghubungkan artifact ke environment.

Untuk regulated atau high-risk systems, commit yang di-push ke remote bukan sekadar code sync. Ia menjadi bagian dari evidence chain.

Pertanyaan yang harus bisa dijawab:

1. Commit mana yang masuk release ini?
2. Siapa yang approve?
3. Test apa yang berjalan?
4. Artifact mana yang dibangun?
5. Apakah source code sama dengan artifact production?
6. Apakah ada force push setelah approval?
7. Apakah tag release immutable?

Git remote workflow harus mendukung jawaban tersebut.

---

## 39. Common Failure Modes

### 39.1 `git pull` Membuat Merge Commit Tidak Sengaja

Penyebab:

```bash
git pull
```

di branch yang diverged dan default strategy merge.

Mitigasi:

```bash
git config --global pull.ff only
```

atau gunakan:

```bash
git fetch origin
git rebase origin/main
```

### 39.2 Force Push Menghapus Commit Orang Lain

Penyebab:

```bash
git push --force
```

Mitigasi:

```bash
git push --force-with-lease
```

Dan jangan force push branch shared.

### 39.3 Push ke Branch Salah

Penyebab:

1. Branch aktif tidak dicek.
2. Upstream salah.
3. `push.default` tidak dipahami.

Mitigasi:

```bash
git branch -vv
git status -sb
```

### 39.4 Remote-Tracking Branch Stale

Penyebab:

Tidak fetch sebelum diff/rebase.

Mitigasi:

```bash
git fetch --prune origin
```

### 39.5 Pull Rebase pada Branch Shared

Penyebab:

Global config `pull.rebase true` tanpa judgement.

Mitigasi:

1. Pahami branch ownership.
2. Gunakan merge untuk branch shared.
3. Set policy per repo jika perlu.

### 39.6 CI Gagal Karena Shallow Clone

Penyebab:

Pipeline butuh tag/history tetapi checkout depth terlalu dangkal.

Mitigasi:

1. Fetch tags.
2. Increase depth.
3. Unshallow jika perlu.
4. Jangan hitung version dari history jika history tidak tersedia.

---

## 40. Decision Matrix: Fetch, Pull, Merge, Rebase, Push

| Situasi | Operasi Aman | Catatan |
|---|---|---|
| Mau melihat update remote | `git fetch origin` | Tidak mengubah working tree |
| Local main hanya behind | `git pull --ff-only` | Aman jika tidak diverged |
| Feature branch pribadi perlu update dari main | `git fetch origin && git rebase origin/main` | Linear, rewrite private history |
| Branch shared perlu update | `git fetch origin && git merge origin/branch` | Preserve commit orang lain |
| Push feature branch pertama kali | `git push -u origin feature/x` | Set upstream |
| Push ditolak karena remote maju | Fetch, inspect, merge/rebase | Jangan langsung force |
| Setelah rebase branch pribadi | `git push --force-with-lease` | Hanya jika aman |
| Hapus branch remote setelah merge | `git push origin --delete feature/x` | Sesuai policy |
| Bersihkan stale remote refs | `git fetch --prune origin` | Tidak hapus branch lokal |
| CI butuh source commit tertentu | Fetch checkout SHA/ref eksplisit | Reproducibility |

---

## 41. Praktik Konfigurasi yang Direkomendasikan

Untuk developer individual yang ingin aman:

```bash
git config --global pull.ff only
git config --global fetch.prune true
git config --global push.default simple
git config --global rebase.autoStash true
```

Catatan untuk `rebase.autoStash`:

Ini bisa membantu saat rebase dengan working tree yang belum bersih, tetapi jangan jadikan alasan untuk sering rebase dalam kondisi berantakan. Working tree bersih tetap lebih baik.

Alias useful:

```bash
git config --global alias.st "status -sb"
git config --global alias.br "branch -vv"
git config --global alias.lg "log --oneline --graph --decorate --all --max-count=40"
git config --global alias.fp "fetch --prune"
```

Gunakan:

```bash
git st
git br
git lg
git fp origin
```

---

## 42. Latihan Praktis: Simulasi Remote di Local Machine

Kamu bisa belajar remote tanpa GitHub/GitLab dengan membuat bare repository lokal.

### 42.1 Buat Remote Bare

```bash
mkdir /tmp/git-remote-lab
cd /tmp/git-remote-lab
mkdir remote.git
cd remote.git
git init --bare
```

Bare repo ini bertindak sebagai remote.

### 42.2 Buat Clone Pertama

```bash
cd /tmp/git-remote-lab
git clone remote.git alice
cd alice

git config user.name "Alice"
git config user.email "alice@example.com"

echo "# Order Service" > README.md
git add README.md
git commit -m "Initial commit"
git branch -M main
git push -u origin main
```

### 42.3 Buat Clone Kedua

```bash
cd /tmp/git-remote-lab
git clone remote.git bob
cd bob

git config user.name "Bob"
git config user.email "bob@example.com"

git switch main
```

Sekarang kamu punya:

```text
remote.git = remote bersama
alice      = clone developer Alice
bob        = clone developer Bob
```

### 42.4 Simulasi Push Rejection

Di Alice:

```bash
cd /tmp/git-remote-lab/alice
echo "Alice change" >> README.md
git add README.md
git commit -m "Add Alice change"
git push
```

Di Bob, tanpa fetch dulu:

```bash
cd /tmp/git-remote-lab/bob
echo "Bob change" >> README.md
git add README.md
git commit -m "Add Bob change"
git push
```

Bob akan mendapat rejection.

Lalu:

```bash
git fetch origin
git log --oneline --graph --decorate --all
```

Sekarang pilih:

```bash
git rebase origin/main
```

atau:

```bash
git merge origin/main
```

Resolusi conflict jika ada, lalu:

```bash
git push
```

Latihan ini sangat penting karena menunjukkan bahwa remote adalah repository lain, bukan konsep abstrak.

---

## 43. Latihan: Remote-Tracking Branch Stale

Di Alice:

```bash
cd /tmp/git-remote-lab/alice
echo "Another Alice change" >> README.md
git add README.md
git commit -m "Add another Alice change"
git push
```

Di Bob:

```bash
cd /tmp/git-remote-lab/bob
git log --oneline --decorate origin/main -1
```

Sebelum fetch, `origin/main` Bob belum berubah.

Lalu:

```bash
git fetch origin
git log --oneline --decorate origin/main -1
```

Sekarang baru update.

Pelajaran:

```text
origin/main adalah last-known state, bukan live remote state.
```

---

## 44. Latihan: Force-with-Lease Safety

Buat branch di Bob:

```bash
cd /tmp/git-remote-lab/bob
git switch -c feature/demo
echo "v1" > demo.txt
git add demo.txt
git commit -m "Add demo v1"
git push -u origin feature/demo
```

Alice mengambil branch itu:

```bash
cd /tmp/git-remote-lab/alice
git fetch origin
git switch --track origin/feature/demo
echo "alice update" >> demo.txt
git add demo.txt
git commit -m "Update demo from Alice"
git push
```

Bob rewrite branch lokal tanpa fetch:

```bash
cd /tmp/git-remote-lab/bob
echo "bob rewrite" >> demo.txt
git add demo.txt
git commit --amend -m "Add rewritten demo v1"
```

Coba:

```bash
git push --force-with-lease
```

Push akan ditolak jika remote sudah berubah dari lease yang Bob tahu.

Pelajaran:

```text
--force-with-lease melindungi update orang lain yang belum kamu fetch.
```

---

## 45. Java-Specific Remote Workflow Patterns

### 45.1 Multi-Module Maven Repository

Pada repo Maven multi-module:

```text
root pom.xml
service-order/pom.xml
service-payment/pom.xml
common-domain/pom.xml
```

Sebelum push:

```bash
./mvnw -pl service-order -am test
```

Jika perubahan di `common-domain`, jangan hanya test service yang kamu ubah secara langsung. Cek dependents.

Git remote workflow harus dikaitkan dengan impact analysis:

```text
branch diff -> changed modules -> affected tests -> CI scope
```

### 45.2 Gradle Composite/Multi-Project Build

Sebelum push:

```bash
./gradlew :service-order:test
```

Untuk perubahan shared library:

```bash
./gradlew test
```

atau selective build jika build graph mendukung.

### 45.3 Generated Code

Jika project menghasilkan code dari OpenAPI/protobuf:

1. Pastikan source contract berubah.
2. Pastikan generated code policy jelas.
3. Jangan push generated drift tanpa source.
4. Jangan resolve conflict generated file secara manual jika bisa regenerate.

### 45.4 Database Migration

Remote branch yang memuat migration harus diuji terhadap urutan migration main terbaru.

Sebelum PR:

```bash
git fetch origin
git rebase origin/main
./mvnw test
```

Jika migration conflict:

1. Jangan hanya rename file.
2. Pastikan ordering migration benar.
3. Pastikan rollback/forward compatibility sesuai policy.
4. Jalankan integration test migration jika tersedia.

---

## 46. Anti-Pattern Remote Workflow

### 46.1 Blind Pull

```bash
git pull
```

tanpa tahu branch aktif dan strategy pull.

Lebih baik:

```bash
git status -sb
git fetch origin
git log --oneline --graph --decorate --all --max-count=30
```

### 46.2 Force Push sebagai Kebiasaan

Jika sering butuh force push, tanyakan:

1. Apakah branch terlalu lama hidup?
2. Apakah commit terlalu banyak dan tidak terstruktur?
3. Apakah workflow PR tidak jelas?
4. Apakah banyak orang bekerja pada branch yang sama?

### 46.3 Menggunakan Remote Branch sebagai Backup WIP

```bash
git add .
git commit -m "wip"
git push
```

Boleh sesekali untuk backup branch pribadi, tetapi jangan biarkan WIP masuk PR tanpa cleanup.

Lebih baik:

1. Commit WIP lokal.
2. Gunakan interactive rebase sebelum PR.
3. Tandai PR draft jika belum siap.

### 46.4 Branch Per Environment

```text
dev
staging
qa
prod
```

Sering menjadi anti-pattern jika branch merepresentasikan environment state, bukan source evolution.

Masalah:

1. Divergence sulit dikontrol.
2. Cherry-pick manual rawan salah.
3. Production tidak jelas berasal dari commit mana.
4. Audit trail kacau.

Lebih baik:

```text
branch/tag merepresentasikan source state,
deployment system merepresentasikan environment state.
```

### 46.5 Pull dari Main ke Feature Berulang dengan Merge Commit Berisik

Jika feature branch pribadi sering melakukan:

```bash
git pull origin main
```

lalu menghasilkan merge commit berkali-kali, PR history sulit dibaca.

Lebih baik:

```bash
git fetch origin
git rebase origin/main
```

Untuk branch pribadi.

---

## 47. Troubleshooting Cheatsheet

### 47.1 “Your branch is ahead of origin/main by N commits”

Artinya local punya commit yang belum dipush.

Cek:

```bash
git log --oneline origin/main..HEAD
```

Push:

```bash
git push
```

### 47.2 “Your branch is behind origin/main by N commits”

Artinya remote-tracking branch punya commit yang belum ada di local branch.

Jika tidak ada commit lokal:

```bash
git pull --ff-only
```

### 47.3 “Your branch and origin/main have diverged”

Cek:

```bash
git log --oneline --graph --decorate --all
```

Pilih:

```bash
git rebase origin/main
```

atau:

```bash
git merge origin/main
```

### 47.4 “No upstream branch”

Push pertama:

```bash
git push -u origin current-branch-name
```

Atau:

```bash
git push --set-upstream origin current-branch-name
```

### 47.5 “non-fast-forward”

Jangan langsung force.

```bash
git fetch origin
git log --oneline --graph --decorate --all --max-count=40
```

Integrasikan dulu.

### 47.6 “Permission denied publickey”

Cek:

```bash
ssh -T git@github.com
```

atau sesuai host Git.

Cek remote:

```bash
git remote -v
```

### 47.7 “Protected branch hook declined”

Artinya branch policy menolak push.

Solusi biasanya:

1. Buat feature branch.
2. Push branch.
3. Buka PR/MR.
4. Ikuti required checks.

---

## 48. Checklist Sebelum Pull

Sebelum menjalankan `git pull`, cek:

```bash
git status -sb
git branch -vv
```

Pertanyaan:

1. Branch aktif benar?
2. Working tree bersih?
3. Pull strategy diketahui?
4. Branch ini pribadi atau shared?
5. Apakah boleh rebase?
6. Apakah perlu fetch dulu dan inspect?

Untuk operasi aman:

```bash
git fetch origin
```

Lalu putuskan.

---

## 49. Checklist Sebelum Push

Sebelum push:

```bash
git status -sb
git branch -vv
git log --oneline --decorate -5
```

Pastikan:

1. Branch aktif benar.
2. Upstream benar.
3. Commit terakhir sesuai.
4. Tidak ada secret.
5. Test relevan sudah jalan.
6. Tidak ada generated artifact yang salah.
7. Tidak push langsung ke protected branch.
8. Jika force push, branch benar-benar aman dan gunakan `--force-with-lease`.

---

## 50. Checklist Saat Push Ditolak

1. Baca pesan error.
2. Bedakan auth error, permission error, policy error, non-fast-forward error.
3. Jangan langsung `--force`.
4. Jalankan:

```bash
git fetch origin
git status -sb
git branch -vv
git log --oneline --graph --decorate --all --max-count=40
```

5. Pilih merge/rebase sesuai ownership branch.
6. Jalankan test.
7. Push ulang.
8. Force-with-lease hanya jika rewrite branch pribadi memang disengaja.

---

## 51. Mental Model Ringkas

```text
Remote repository = repository lain.
origin = alias ke repository lain.
origin/main = cache lokal posisi main di origin saat fetch terakhir.
fetch = update informasi remote-tracking tanpa mengubah branch aktif.
pull = fetch + integrasi.
push = kirim object + minta remote update ref.
upstream = default remote-tracking branch untuk local branch.
non-fast-forward rejection = remote punya history yang akan hilang jika push diterima.
force-with-lease = force push dengan safety check terhadap remote state yang kamu ketahui.
```

---

## 52. Prinsip Senior Engineer

Engineer biasa berpikir:

```text
Saya pull dulu biar terbaru.
Saya push saja kalau sudah selesai.
Kalau ditolak, force push.
```

Engineer kuat berpikir:

```text
Branch aktif saya apa?
Upstream-nya apa?
origin/main saya fresh atau stale?
Remote punya commit apa yang belum saya punya?
Local punya commit apa yang belum remote punya?
Apakah branch ini private atau shared?
Integrasi yang benar merge atau rebase?
Apakah push saya fast-forward?
Kalau perlu rewrite, apakah --force-with-lease aman?
Apa dampaknya ke PR, CI, release, dan teammate?
```

Inilah perbedaan antara memakai Git sebagai tool command-line dan memahami Git sebagai sistem koordinasi perubahan.

---

## 53. Ringkasan Part Ini

Pada part ini kamu mempelajari:

1. Remote adalah repository lain.
2. `origin` hanyalah nama default remote.
3. `origin/main` adalah remote-tracking branch lokal, bukan live branch di server.
4. `clone` membuat repository lokal penuh dan mengatur remote/upstream.
5. `fetch` aman karena hanya mengupdate object dan remote-tracking refs.
6. `pull` adalah fetch plus integrasi, sehingga perlu judgement.
7. Pull bisa merge, rebase, atau fast-forward only.
8. `push` adalah operasi update ref remote.
9. Push rejection melindungi remote dari kehilangan history.
10. `--force-with-lease` lebih aman daripada `--force`.
11. Branch protection adalah bagian dari engineering governance.
12. Remote workflow terkait langsung dengan PR, CI/CD, release, audit, dan supply chain.

---

## 54. Latihan Reflektif

Jawab tanpa menjalankan command dulu:

1. Apa bedanya `main` dan `origin/main`?
2. Setelah `git fetch origin`, apakah working tree berubah?
3. Kenapa `git pull` bisa menghasilkan merge commit?
4. Kenapa push bisa ditolak walaupun kamu punya commit terbaru di local?
5. Apa risiko `git push --force`?
6. Kapan `--force-with-lease` masih tidak boleh dipakai?
7. Kenapa branch shared sebaiknya tidak direbase sembarangan?
8. Kenapa CI bisa gagal walaupun local test sukses setelah push?
9. Apa yang harus dicek sebelum push ke branch release?
10. Apa konsekuensi audit jika release tag bisa dipindah?

---

## 55. Preview Part Berikutnya

Part berikutnya:

```text
learn-git-mastery-for-java-engineers-part-013.md
```

Topik:

```text
Pull Request / Merge Request sebagai Engineering Control Point
```

Kita akan membahas PR/MR bukan sebagai formalitas approval UI, tetapi sebagai control point engineering untuk:

1. review kualitas perubahan,
2. CI validation,
3. security scanning,
4. design discussion,
5. audit trail,
6. release risk reduction,
7. dan koordinasi antar engineer.

---

## 56. Status Series

```text
Progress: 012 / 032
Status: belum selesai
Bagian terakhir: learn-git-mastery-for-java-engineers-part-032.md
```

Seri belum selesai. Masih ada 20 bagian setelah ini.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-git-mastery-for-java-engineers-part-011.md](./learn-git-mastery-for-java-engineers-part-011.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-git-mastery-for-java-engineers-part-013.md](./learn-git-mastery-for-java-engineers-part-013.md)

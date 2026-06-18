# learn-git-mastery-for-java-engineers-part-009.md

# Part 009 — Rebase: Memindahkan Perubahan dengan Aman

> Series: **Git Mastery for Java Engineers**  
> Bagian: **009 / 032**  
> Status seri: **Belum selesai**  
> Bagian sebelumnya: `learn-git-mastery-for-java-engineers-part-008.md` — Merge: Menggabungkan Sejarah Tanpa Kehilangan Konteks  
> Bagian berikutnya: `learn-git-mastery-for-java-engineers-part-010.md` — Interactive Rebase: Sculpting History

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita membahas **merge** sebagai operasi integrasi dua garis sejarah. Merge mempertahankan fakta bahwa dua jalur kerja pernah berjalan paralel lalu digabungkan.

Bagian ini membahas **rebase**, operasi yang sering dianggap “lebih rapi”, tetapi juga sering menjadi sumber kekacauan jika digunakan tanpa memahami commit graph.

Target bagian ini bukan sekadar bisa menjalankan:

```bash
git rebase main
```

Target sebenarnya adalah memahami:

1. Apa yang terjadi pada commit graph saat rebase.
2. Mengapa rebase bukan “memindahkan commit lama”, tetapi membuat commit baru.
3. Kapan rebase aman dan kapan berbahaya.
4. Bagaimana menyelesaikan conflict saat rebase.
5. Mengapa rebase terhadap history public dapat merusak workflow tim.
6. Bagaimana menggunakan `--force-with-lease` dengan lebih aman dibanding `--force`.
7. Bagaimana rebase dipakai dalam workflow Java engineer sebelum membuat atau memperbarui Pull Request.

Setelah bagian ini, kamu harus mampu melihat rebase bukan sebagai command ajaib, tetapi sebagai operasi transformasi history.

---

## 1. Core Mental Model: Rebase adalah Replay, Bukan Merge

Misalkan commit graph kamu seperti ini:

```text
A---B---C  main
     \
      D---E  feature/payment-timeout
```

Artinya:

- `main` sekarang berada di commit `C`.
- Branch `feature/payment-timeout` dibuat dari `B`.
- Di branch feature ada dua commit: `D` dan `E`.
- Sementara itu, `main` sudah maju dari `B` ke `C`.

Jika kamu menjalankan:

```bash
git switch feature/payment-timeout
git rebase main
```

Maka Git secara konseptual melakukan ini:

1. Cari common ancestor antara `feature/payment-timeout` dan `main`, yaitu `B`.
2. Ambil daftar commit unik di feature sejak `B`: `D`, `E`.
3. Pindahkan posisi base feature ke ujung `main`, yaitu `C`.
4. Terapkan ulang perubahan dari `D` di atas `C` → menghasilkan commit baru `D'`.
5. Terapkan ulang perubahan dari `E` di atas `D'` → menghasilkan commit baru `E'`.
6. Geser pointer branch `feature/payment-timeout` ke `E'`.

Hasilnya:

```text
A---B---C  main
         \
          D'---E'  feature/payment-timeout
```

Commit `D` dan `E` lama tidak benar-benar dipindahkan. Mereka digantikan oleh commit baru `D'` dan `E'`.

Ini poin paling penting:

```text
Rebase does not move commits.
Rebase copies the changes into new commits with new parents and new object IDs.
```

Karena parent commit berubah, hash commit juga berubah. Commit identity di Git bersifat content-addressed dan mencakup metadata commit, termasuk parent. Maka `D'` dan `E'` bukan commit yang sama dengan `D` dan `E`.

---

## 2. Merge vs Rebase: Dua Cara Mengintegrasikan Perubahan

Dengan graph awal:

```text
A---B---C  main
     \
      D---E  feature
```

### 2.1 Jika memakai merge

```bash
git switch feature
git merge main
```

Hasilnya:

```text
A---B---C  main
     \   \
      D---E---M  feature
```

Karakteristik:

- Commit lama `D` dan `E` tetap sama.
- Git membuat merge commit `M`.
- History menunjukkan bahwa ada dua jalur kerja paralel yang digabung.
- Integrasi eksplisit terlihat di graph.

### 2.2 Jika memakai rebase

```bash
git switch feature
git rebase main
```

Hasilnya:

```text
A---B---C  main
         \
          D'---E'  feature
```

Karakteristik:

- Commit lama `D` dan `E` digantikan oleh `D'` dan `E'`.
- Tidak ada merge commit.
- History terlihat linear.
- Seolah-olah branch feature baru dibuat setelah `C`.

### 2.3 Rebase bukan lebih “benar” daripada merge

Rebase dan merge menjawab kebutuhan berbeda.

Merge menjawab:

```text
Bagaimana dua garis kerja yang paralel digabungkan sambil mempertahankan konteks integrasi?
```

Rebase menjawab:

```text
Bagaimana perubahan lokal saya diterapkan ulang di atas base terbaru agar history terlihat linear?
```

Jika kamu memilih berdasarkan “mana yang kelihatan rapi”, kamu akan mudah salah. Pilih berdasarkan konsekuensi history.

---

## 3. Mengapa Rebase Berguna?

Rebase berguna karena banyak workflow development membutuhkan branch feature tetap relatif segar terhadap `main` tanpa membuat merge commit berulang.

Contoh problem sehari-hari:

```text
Kamu membuat branch feature tiga hari lalu.
Selama tiga hari, main sudah berubah banyak.
Sekarang PR kamu conflict dengan main.
Kamu ingin memperbarui branch feature agar berdiri di atas main terbaru.
```

Pilihan pertama: merge `main` ke feature.

```bash
git switch feature
git merge main
```

Ini valid, tetapi jika dilakukan berkali-kali, branch feature bisa penuh merge commit:

```text
A---B---C---F---G  main
     \   \   \
      D---E---M1---H---M2  feature
```

Pilihan kedua: rebase feature ke `main` terbaru.

```bash
git switch feature
git fetch origin
git rebase origin/main
```

History menjadi:

```text
A---B---C---F---G  main
                 \
                  D'---E'---H'  feature
```

Manfaatnya:

1. PR diff lebih mudah dibaca.
2. Commit feature terlihat sebagai urutan perubahan di atas main terbaru.
3. Tidak ada noise merge commit dari sinkronisasi berkala.
4. Bisect di masa depan lebih mudah jika commit atomic.
5. Reviewer bisa memahami kontribusi branch tanpa terganggu commit integrasi.

Namun manfaat ini datang dengan harga: rebase menulis ulang commit branch.

---

## 4. Golden Rule Rebase

Aturan praktis paling penting:

```text
Jangan rebase commit yang sudah menjadi basis kerja orang lain.
```

Versi yang sering didengar:

```text
Do not rebase public history.
```

Tetapi kalimat itu perlu dipahami dengan presisi.

Public history bukan hanya “sudah dipush ke remote”. Public history berarti:

```text
Commit tersebut mungkin sudah dilihat, dipull, direview, dijadikan base branch lain, atau dipakai proses lain.
```

Contoh:

```text
A---B---C  main
     \
      D---E  feature/shared-api
           \
            F---G  teammate-branch
```

Jika kamu rebase `feature/shared-api`, commit `D` dan `E` akan berubah menjadi `D'` dan `E'`.

```text
A---B---C  main
         \
          D'---E'  feature/shared-api

      D---E---F---G  teammate-branch lama
```

Sekarang teammate masih punya branch berbasis commit lama `E`. Saat mereka pull/push/merge, history bisa menjadi kacau karena Git melihat dua keluarga commit yang berbeda:

- `D`, `E` lama.
- `D'`, `E'` baru.

Padahal secara patch mungkin mirip.

Inilah penyebab klasik duplicate commit, conflict berulang, PR diff aneh, dan history sulit dibaca.

---

## 5. Kapan Rebase Aman?

Rebase relatif aman jika:

1. Branch masih private/lokal.
2. Branch sudah dipush tetapi hanya kamu yang menggunakannya.
3. Tim punya convention eksplisit bahwa feature branch boleh direbase sebelum merge.
4. PR belum menjadi base branch lain.
5. Kamu tahu cara recover dengan reflog.
6. Kamu menggunakan `--force-with-lease`, bukan `--force`, saat perlu update remote branch.

Contoh aman:

```text
Kamu membuat branch feature sendiri.
Kamu push ke remote untuk backup/PR.
Tidak ada orang lain membuat branch dari branch kamu.
CI hanya menjalankan test dari branch itu.
Kamu rebase branch terhadap origin/main agar PR bersih.
```

Ini umum dan wajar.

---

## 6. Kapan Rebase Berbahaya?

Rebase berbahaya jika:

1. Branch dipakai bersama oleh beberapa developer.
2. Branch adalah `main`, `develop`, `release`, atau branch integrasi tim.
3. Branch sudah menjadi base branch lain.
4. Ada automation yang mengandalkan commit SHA lama.
5. Ada tag release di commit yang akan direwrite.
6. Ada audit/compliance process yang menganggap commit SHA sebagai evidence.
7. Kamu tidak tahu siapa yang sudah pull branch itu.

Contoh buruk:

```bash
git switch main
git rebase some-feature
git push --force
```

Ini hampir selalu salah dalam kerja tim.

Contoh buruk lain:

```bash
git switch release/2026.06
git rebase main
git push --force
```

Jika release branch sudah dipakai QA, deployment pipeline, atau audit evidence, rewrite history dapat memutus traceability.

---

## 7. Perintah Dasar Rebase

### 7.1 Rebase branch saat ini ke branch lain

```bash
git switch feature/payment-timeout
git fetch origin
git rebase origin/main
```

Artinya:

```text
Ambil commit unik di feature/payment-timeout yang belum ada di origin/main,
lalu replay commit tersebut di atas origin/main.
```

### 7.2 Rebase branch tertentu tanpa switch dulu

```bash
git rebase origin/main feature/payment-timeout
```

Artinya secara konseptual:

```text
Checkout feature/payment-timeout, lalu rebase ke origin/main.
```

Untuk pemula, lebih aman eksplisit:

```bash
git switch feature/payment-timeout
git rebase origin/main
```

Karena kamu melihat state branch aktif lebih jelas.

### 7.3 Rebase terhadap local main

```bash
git switch main
git pull --ff-only

git switch feature/payment-timeout
git rebase main
```

Ini baik jika local `main` sudah pasti up to date. Namun dalam tim, sering lebih eksplisit memakai `origin/main` setelah `fetch`:

```bash
git fetch origin
git rebase origin/main
```

Dengan ini kamu tidak bergantung pada apakah local `main` sudah diperbarui.

---

## 8. Rebase Step-by-Step dengan Contoh Konkret

Buat repository latihan:

```bash
mkdir git-rebase-lab
cd git-rebase-lab
git init

git config user.name "Rebase Student"
git config user.email "student@example.com"
```

Buat commit awal:

```bash
cat > README.md <<'EOF'
# Git Rebase Lab
EOF

git add README.md
git commit -m "docs: add project readme"
```

Buat file Java sederhana:

```bash
mkdir -p src/main/java/com/example/payment
cat > src/main/java/com/example/payment/PaymentService.java <<'EOF'
package com.example.payment;

public class PaymentService {
    public String status() {
        return "OK";
    }
}
EOF

git add src/main/java/com/example/payment/PaymentService.java
git commit -m "feat(payment): add payment service"
```

Buat branch feature:

```bash
git switch -c feature/payment-timeout
```

Tambahkan perubahan di feature:

```bash
python3 - <<'PY'
from pathlib import Path
p = Path('src/main/java/com/example/payment/PaymentService.java')
s = p.read_text()
s = s.replace('    public String status() {\n        return "OK";\n    }', '''    public String status() {
        return "OK";
    }

    public int timeoutMillis() {
        return 3000;
    }''')
p.write_text(s)
PY

git add src/main/java/com/example/payment/PaymentService.java
git commit -m "feat(payment): add timeout configuration"
```

Sekarang kembali ke `main` dan buat perubahan lain:

```bash
git switch main

python3 - <<'PY'
from pathlib import Path
p = Path('src/main/java/com/example/payment/PaymentService.java')
s = p.read_text()
s = s.replace('public class PaymentService {', '''public class PaymentService {
    private static final String HEALTHY_STATUS = "OK";
''')
s = s.replace('return "OK";', 'return HEALTHY_STATUS;')
p.write_text(s)
PY

git add src/main/java/com/example/payment/PaymentService.java
git commit -m "refactor(payment): extract healthy status constant"
```

Graph sekarang:

```bash
git log --oneline --graph --decorate --all
```

Kira-kira:

```text
* <C> refactor(payment): extract healthy status constant
| * <D> feat(payment): add timeout configuration
|/
* <B> feat(payment): add payment service
* <A> docs: add project readme
```

Sekarang rebase feature ke main:

```bash
git switch feature/payment-timeout
git rebase main
```

Jika tidak conflict, graph menjadi:

```text
* <D'> feat(payment): add timeout configuration
* <C>  refactor(payment): extract healthy status constant
* <B>  feat(payment): add payment service
* <A>  docs: add project readme
```

Perhatikan: commit feature punya hash baru.

---

## 9. Apa yang Terjadi Jika Conflict Saat Rebase?

Misalkan `main` dan feature mengubah bagian file yang sama.

Graph:

```text
A---B---C  main
     \
      D---E  feature
```

Saat:

```bash
git switch feature
git rebase main
```

Git mencoba apply `D` di atas `C`. Jika patch `D` tidak bisa diterapkan otomatis, rebase berhenti sementara.

State-nya kira-kira:

```text
A---B---C  main
         \
          [sedang mencoba membuat D']
```

Git akan memberi tahu:

```text
CONFLICT (content): Merge conflict in ...
error: could not apply <sha> ...
```

Ini berarti:

```text
Git sedang replay satu commit tertentu.
Conflict terjadi pada commit itu.
Selesaikan conflict, stage hasilnya, lalu lanjutkan replay.
```

Command utama saat conflict rebase:

```bash
git status
# edit file conflict

git add <resolved-file>
git rebase --continue
```

Jika ingin membatalkan seluruh rebase:

```bash
git rebase --abort
```

Jika commit yang sedang direplay ternyata tidak perlu diterapkan:

```bash
git rebase --skip
```

Gunakan `--skip` dengan hati-hati. Itu berarti perubahan dari commit tersebut tidak dimasukkan ke history baru.

---

## 10. Conflict Saat Rebase vs Conflict Saat Merge

Conflict saat merge dan conflict saat rebase terlihat mirip di file, tetapi konteks mentalnya berbeda.

### 10.1 Conflict saat merge

```bash
git merge main
```

Git mencoba menggabungkan dua branch sekaligus.

Kamu menyelesaikan conflict untuk menghasilkan satu merge commit.

```text
A---B---C  main
     \   \
      D---E---M  feature
```

Conflict resolution menjadi bagian dari commit `M`.

### 10.2 Conflict saat rebase

```bash
git rebase main
```

Git replay commit satu per satu.

Jika branch feature punya 5 commit, conflict bisa terjadi pada commit ke-1, lalu setelah selesai bisa muncul lagi pada commit ke-3.

```text
Replay D -> maybe conflict -> create D'
Replay E -> maybe conflict -> create E'
Replay F -> maybe conflict -> create F'
```

Conflict resolution menjadi bagian dari commit baru yang sedang dibuat.

Dampaknya:

- Rebase bisa meminta kamu menyelesaikan conflict beberapa kali.
- Merge biasanya menyelesaikan conflict dalam satu titik integrasi.
- Rebase membuat history linear tetapi bisa lebih melelahkan jika branch lama dan banyak konflik.

---

## 11. `--ours` dan `--theirs` Saat Rebase: Sumber Kebingungan Besar

Saat conflict merge biasa:

```bash
git switch feature
git merge main
```

Biasanya:

- `ours` = branch saat ini, yaitu `feature`.
- `theirs` = branch yang di-merge, yaitu `main`.

Tetapi saat rebase:

```bash
git switch feature
git rebase main
```

Git sedang berada dalam proses menerapkan commit feature di atas base baru.

Dalam banyak konteks conflict rebase:

- `ours` merujuk ke state base/rebased side yang sedang dibangun, yaitu sisi `main` + commit yang sudah berhasil direplay.
- `theirs` merujuk ke patch commit feature yang sedang diterapkan.

Ini terasa terbalik bagi banyak orang.

Karena itu, jangan asal menjalankan:

```bash
git checkout --ours file
git checkout --theirs file
```

atau versi baru:

```bash
git restore --ours file
git restore --theirs file
```

Tanpa memeriksa isi file dan konteks commit yang sedang direplay.

Gunakan:

```bash
git status
git show REBASE_HEAD
```

`REBASE_HEAD` membantu melihat commit mana yang sedang diterapkan.

---

## 12. Cara Membaca State Saat Rebase Berhenti

Saat rebase conflict, selalu mulai dari:

```bash
git status
```

Git biasanya menjelaskan:

```text
interactive rebase in progress; onto <sha>
Last command done ...
Next commands to do ...
You are currently rebasing branch 'feature' on '<sha>'.
```

Command observability penting:

```bash
git status
```

Melihat commit yang sedang diaplikasikan:

```bash
git show REBASE_HEAD
```

Melihat patch commit tersebut:

```bash
git show --stat REBASE_HEAD
git show --patch REBASE_HEAD
```

Melihat conflict markers:

```bash
git diff
```

Melihat file yang belum selesai:

```bash
git diff --name-only --diff-filter=U
```

Melihat graph sementara:

```bash
git log --oneline --graph --decorate --all --boundary
```

Prinsip:

```text
Saat rebase berhenti, jangan panik.
Git sedang meminta kamu menyelesaikan satu commit replay.
```

---

## 13. Rebase dan Commit Identity

Sebelum rebase:

```text
A---B---C  main
     \
      D---E  feature
```

Commit `D` punya metadata:

```text
tree: <tree-id>
parent: B
author: ...
committer: ...
message: ...
```

Setelah rebase:

```text
A---B---C  main
         \
          D'---E'  feature
```

Commit `D'` punya parent `C`, bukan `B`.

Karena parent berubah, hash commit berubah.

Bahkan jika isi patch sama, commit object berbeda.

Ini penting untuk:

1. Review: komentar PR mungkin tetap ada, tetapi commit SHA berubah.
2. CI: build berdasarkan SHA lama tidak lagi merepresentasikan branch terbaru.
3. Audit: evidence berbasis commit SHA harus diperbarui.
4. Tag: tag yang menunjuk commit lama tidak otomatis berpindah.
5. Branch downstream: branch lain berbasis commit lama akan diverge.

---

## 14. Rebase dan Remote Branch

Misalkan kamu sudah push feature branch:

```bash
git push -u origin feature/payment-timeout
```

Remote punya:

```text
A---B---C  origin/main
     \
      D---E  origin/feature/payment-timeout
```

Kamu rebase lokal:

```bash
git fetch origin
git rebase origin/main
```

Lokal menjadi:

```text
A---B---C  origin/main
         \
          D'---E'  feature/payment-timeout

      D---E  origin/feature/payment-timeout
```

Sekarang local branch dan remote branch tidak linear. Jika kamu push biasa:

```bash
git push
```

Git akan menolak:

```text
! [rejected] feature/payment-timeout -> feature/payment-timeout (non-fast-forward)
```

Karena remote masih menunjuk `E`, sedangkan local menunjuk `E'`. Remote tidak bisa fast-forward dari `E` ke `E'` karena keduanya bukan garis keturunan langsung.

Untuk memperbarui remote branch setelah rebase, kamu perlu force update.

Namun jangan gunakan ini sembarangan:

```bash
git push --force
```

Lebih aman:

```bash
git push --force-with-lease
```

---

## 15. `--force` vs `--force-with-lease`

### 15.1 `--force`

```bash
git push --force
```

Artinya kira-kira:

```text
Paksa remote branch menunjuk ke commit lokal saya, walaupun remote sudah berubah.
```

Bahaya:

Jika orang lain sudah push commit baru ke remote setelah terakhir kamu fetch, `--force` bisa menimpa commit mereka.

### 15.2 `--force-with-lease`

```bash
git push --force-with-lease
```

Artinya kira-kira:

```text
Paksa update remote branch hanya jika remote branch masih berada pada posisi yang saya kira.
```

Jika remote ternyata sudah berubah sejak terakhir kamu fetch, push ditolak.

Ini bukan jaminan mutlak terhadap semua kesalahan, tetapi jauh lebih aman daripada `--force`.

Workflow aman:

```bash
git fetch origin
git rebase origin/main
# run tests

git push --force-with-lease
```

Untuk branch feature pribadi, ini lazim.

Untuk branch shared, tetap harus hati-hati.

---

## 16. `git pull --rebase`

Secara default, `git pull` adalah:

```text
git fetch + git merge
```

Jika kamu menjalankan:

```bash
git pull --rebase
```

Maka Git melakukan:

```text
git fetch + git rebase
```

Contoh:

Remote:

```text
A---B---C  origin/main
```

Local main:

```text
A---B---D  main
```

Jika kamu berada di `main` dan menjalankan:

```bash
git pull --rebase
```

Git akan fetch `C`, lalu replay local commit `D` di atas `C`:

```text
A---B---C---D'  main
```

Ini berguna ketika kamu punya commit lokal yang belum dipush dan ingin menaruhnya di atas remote terbaru tanpa merge commit.

Namun untuk branch utama tim seperti `main`, idealnya developer biasa tidak membuat commit lokal langsung di `main`. Workflow lebih sehat:

```bash
git switch main
git pull --ff-only

git switch -c feature/...
```

`--ff-only` menolak pull jika perlu merge commit, sehingga main lokal tetap bersih.

---

## 17. Konfigurasi Pull Rebase

Git dapat dikonfigurasi agar pull menggunakan rebase.

Per repository:

```bash
git config pull.rebase true
```

Global:

```bash
git config --global pull.rebase true
```

Untuk menjaga local changes saat rebase:

```bash
git config --global rebase.autoStash true
```

Namun hati-hati dengan `autoStash`. Ia nyaman, tetapi bisa menyembunyikan fakta bahwa working tree kamu belum bersih.

Untuk workflow yang disiplin, sebelum rebase:

```bash
git status
```

Pastikan working tree bersih atau stash secara sadar:

```bash
git stash push -u -m "wip before rebase feature/payment-timeout"
```

---

## 18. Rebase dengan Working Tree Kotor

Git biasanya menolak rebase jika ada perubahan lokal yang belum dicommit dan berpotensi tertimpa.

Contoh pesan:

```text
error: cannot rebase: You have unstaged changes.
error: Please commit or stash them.
```

Pilihan kamu:

### 18.1 Commit dulu

Jika perubahan sudah layak menjadi commit:

```bash
git add .
git commit -m "..."
git rebase origin/main
```

### 18.2 Stash dulu

Jika perubahan masih work in progress:

```bash
git stash push -u -m "wip before rebase"
git rebase origin/main
git stash pop
```

### 18.3 Buang perubahan

Jika perubahan tidak diperlukan:

```bash
git restore .
git clean -fd
```

Hati-hati: `git clean -fd` menghapus untracked files.

Prinsip:

```text
Rebase adalah operasi history. Jangan campur dengan working tree yang tidak jelas.
```

---

## 19. Rebase Onto: Memindahkan Branch ke Base yang Berbeda

`git rebase --onto` adalah bentuk rebase yang lebih presisi.

Format umum:

```bash
git rebase --onto <new-base> <old-base> <branch>
```

Artinya:

```text
Ambil commit di <branch> setelah <old-base>, lalu replay di atas <new-base>.
```

Contoh:

```text
A---B---C---D  main
     \
      E---F  feature/base
           \
            G---H  feature/child
```

Kamu awalnya membuat `feature/child` dari `feature/base`, tetapi ternyata `G-H` harus berdiri langsung di atas `main`.

Command:

```bash
git rebase --onto main feature/base feature/child
```

Hasil:

```text
A---B---C---D  main
             \
              G'---H'  feature/child

      E---F  feature/base
```

Ini sangat berguna untuk:

1. Memindahkan stacked branch.
2. Memisahkan perubahan yang keliru dibuat dari branch salah.
3. Membersihkan dependency antar branch.
4. Mengambil subset commit dari satu base ke base lain.

Tetapi `--onto` juga lebih berbahaya jika kamu salah memilih old-base. Selalu verifikasi dengan:

```bash
git log --oneline --graph --decorate --all
```

Dan preview commit yang akan direbase:

```bash
git log --oneline <old-base>..<branch>
```

---

## 20. Rebase Stacked Branch

Stacked branch sering terjadi saat kamu punya PR berlapis.

```text
A---B---C  main
         \
          D---E  feature/domain-model
               \
                F---G  feature/payment-api
```

`feature/payment-api` bergantung pada perubahan `feature/domain-model`.

Jika `feature/domain-model` direbase ke `main`, commit `D-E` berubah menjadi `D'-E'`:

```text
A---B---C---H  main
             \
              D'---E'  feature/domain-model

          D---E---F---G  feature/payment-api lama
```

Sekarang `feature/payment-api` masih berbasis `E` lama. Kamu perlu rebase child branch ke parent baru:

```bash
git switch feature/payment-api
git rebase --onto feature/domain-model <old-E> feature/payment-api
```

Atau jika Git bisa memahami base dengan jelas, kadang:

```bash
git rebase feature/domain-model
```

Namun untuk stacked PR, `--onto` sering lebih presisi.

Rule praktis:

```text
Jika parent branch direbase, child branch hampir pasti perlu direbase ulang.
```

---

## 21. Rebase dan Empty Commit

Saat rebase, Git bisa menemukan bahwa perubahan dari satu commit sudah ada di base baru.

Contoh:

```text
A---B---C---D  main
     \
      C'---E  feature
```

Jika perubahan `C'` sudah ada di `main` sebagai `C`, saat rebase Git mungkin melewati commit tersebut atau memberi tahu commit menjadi empty.

Pesan bisa berupa:

```text
The previous cherry-pick is now empty, possibly due to conflict resolution.
```

Pilihan:

```bash
git rebase --continue
```

atau:

```bash
git rebase --skip
```

Tergantung konteks.

Jika commit kosong memang ingin dipertahankan sebagai marker, ada opsi rebase tertentu untuk empty commit, tetapi dalam workflow feature biasa, empty commit sering berarti perubahan sudah terintegrasi.

---

## 22. Rebase dan Test Strategy

Setelah rebase, jangan hanya percaya bahwa Git berhasil.

Rebase berhasil berarti:

```text
Patch bisa diterapkan dan conflict terselesaikan secara tekstual.
```

Itu tidak berarti:

```text
Behavior aplikasi masih benar.
```

Untuk Java project, minimal setelah rebase:

```bash
./mvnw test
```

atau:

```bash
./gradlew test
```

Untuk perubahan yang menyentuh integration layer:

```bash
./mvnw verify
```

atau:

```bash
./gradlew check
```

Untuk service backend nyata, pertimbangkan:

1. Unit test.
2. Integration test.
3. Contract test.
4. Static analysis.
5. Formatting/linting.
6. Generated source validation.
7. Database migration validation.
8. API compatibility check.

Rebase dapat menciptakan semantic conflict yang tidak terlihat oleh Git.

Contoh:

- `main` mengubah default timeout menjadi 5 detik.
- Feature kamu menambahkan retry policy dengan asumsi timeout 3 detik.
- Rebase berhasil tanpa conflict.
- Tetapi behavior runtime berubah.

Git tidak memahami domain. Kamu yang harus memahami.

---

## 23. Rebase dalam Pull Request Workflow

Workflow umum untuk feature branch pribadi:

```bash
git switch feature/payment-timeout

git fetch origin
git rebase origin/main

./mvnw test

git push --force-with-lease
```

Urutan ini menjaga PR tetap berdiri di atas `main` terbaru.

Namun ada beberapa nuance.

### 23.1 Sebelum PR dibuat

Rebase sangat cocok untuk merapikan branch sebelum PR:

```bash
git fetch origin
git rebase origin/main
```

Jika commit masih berantakan, nanti Part 010 akan membahas interactive rebase.

### 23.2 Saat PR sedang direview

Rebase boleh dilakukan jika:

- Tim setuju feature branch boleh direwrite.
- Tidak ada reviewer yang bergantung pada commit SHA lama.
- Tidak ada branch lain dibuat dari branch tersebut.

Kadang, terlalu sering rebase saat review bisa menyulitkan reviewer karena komentar lama berpindah atau diff berubah besar.

Praktik baik:

- Rebase saat perlu update terhadap main.
- Jangan rebase setiap lima menit hanya untuk “terlihat bersih”.
- Jika review sedang aktif, komunikasikan jika kamu melakukan force push besar.

### 23.3 Setelah PR approved

Tergantung policy tim:

- Merge commit.
- Squash merge.
- Rebase merge.
- Fast-forward only.

Jangan melakukan rebase besar setelah approval jika itu mengubah substansi PR tanpa review ulang.

---

## 24. Rebase vs Squash Merge vs Rebase Merge di Platform Git

Platform seperti GitHub/GitLab/Bitbucket biasanya menyediakan beberapa strategi merge PR.

### 24.1 Merge commit

PR digabung dengan merge commit.

```text
A---B---C---M  main
     \     /
      D---E
```

Kelebihan:

- Konteks branch dipertahankan.
- Cocok untuk PR sebagai unit integrasi.

Kekurangan:

- History tidak linear.

### 24.2 Squash merge

Semua commit PR disatukan menjadi satu commit di main.

```text
A---B---C---S  main
```

Kelebihan:

- Main bersih.
- PR kecil menjadi satu unit perubahan.

Kekurangan:

- Detail commit internal hilang di main.
- Bisect lebih kasar.

### 24.3 Rebase merge

Commit PR diterapkan ulang di atas main tanpa merge commit.

```text
A---B---C---D'---E'  main
```

Kelebihan:

- History linear.
- Commit individual dipertahankan.

Kekurangan:

- Commit SHA berubah saat masuk main.
- Commit harus berkualitas baik.
- Jika commit internal buruk, main ikut membawa history buruk.

Implikasi:

```text
Jika tim memakai rebase merge, commit hygiene menjadi sangat penting.
Jika tim memakai squash merge, kualitas final PR description dan squash commit message menjadi sangat penting.
```

---

## 25. Rebase dalam Tim Java: Skenario Nyata

### 25.1 Skenario: Feature branch tertinggal dari main

Kamu mengerjakan endpoint baru:

```text
feature/customer-risk-score
```

Sementara itu, `main` menambahkan refactor besar pada security filter.

Sebelum PR:

```bash
git fetch origin
git rebase origin/main
./mvnw test
```

Tujuan:

- Memastikan endpoint kamu bekerja dengan security filter terbaru.
- Mengurangi conflict saat merge.
- Membuat reviewer melihat diff terhadap main terbaru.

### 25.2 Skenario: Branch salah base

Kamu tidak sengaja membuat branch dari branch eksperimen teman:

```text
main
  \
   teammate/experimental-cache
       \
        your/feature-audit-log
```

Kamu ingin branch kamu berdiri langsung di atas `main`.

Gunakan:

```bash
git rebase --onto origin/main teammate/experimental-cache your/feature-audit-log
```

### 25.3 Skenario: Hotfix branch

Untuk hotfix production, jangan asal rebase release branch.

Lebih aman:

1. Buat hotfix dari tag production.
2. Commit fix.
3. Merge/cherry-pick ke release/main sesuai policy.
4. Tag release baru.

Rebase pada jalur release yang sudah diaudit bisa mengganggu traceability.

### 25.4 Skenario: PR besar dengan banyak commit WIP

Sebelum review, kamu ingin membuat history lebih masuk akal.

Gunakan interactive rebase, yang akan dibahas di Part 010:

```bash
git rebase -i origin/main
```

Tujuan:

- Gabungkan commit “fix typo”, “fix test”, “oops”.
- Pecah commit besar berdasarkan concern.
- Reword commit message.

---

## 26. Decision Matrix: Rebase atau Merge?

| Situasi | Lebih cocok | Alasan |
|---|---:|---|
| Feature branch pribadi ingin update dari main | Rebase | History PR lebih linear dan bersih |
| Branch shared oleh banyak developer | Merge | Hindari rewrite history orang lain |
| Release branch sudah dipakai QA/deployment | Merge / cherry-pick / revert | Traceability lebih penting daripada linearity |
| Ingin mempertahankan konteks integrasi branch besar | Merge | Merge commit merekam titik integrasi |
| Branch belum dipush dan commit lokal ingin ditaruh di atas main terbaru | Rebase | Aman karena private |
| PR kecil dengan commit rapi | Rebase merge bisa cocok | Main linear dan commit tetap bermakna |
| PR dengan banyak commit WIP | Squash atau interactive rebase dulu | Hindari history noisy di main |
| Branch salah dibuat dari base yang keliru | Rebase `--onto` | Memindahkan subset commit ke base benar |
| Ada conflict kompleks lintas banyak commit | Merge bisa lebih praktis | Conflict diselesaikan sekali di merge commit |
| Compliance menuntut audit SHA stabil | Hindari rewrite public history | SHA lama bisa menjadi evidence |

---

## 27. Anti-Pattern Rebase

### 27.1 Rebase branch publik tanpa komunikasi

```bash
git switch shared/feature
git rebase origin/main
git push --force
```

Risiko:

- Commit teammate hilang dari remote.
- Branch downstream rusak.
- PR diff kacau.
- Trust tim turun.

### 27.2 Rebase untuk menyembunyikan masalah

Rebase dapat merapikan history, tetapi tidak boleh digunakan untuk mengaburkan keputusan buruk atau menghapus konteks penting.

Contoh buruk:

```text
Bug diperkenalkan, diperbaiki, lalu commit bug dan fix di-squash tanpa catatan.
```

Kadang itu wajar sebelum PR. Tetapi setelah incident atau review security, menghapus konteks bisa merusak auditability.

### 27.3 Rebase branch terlalu tua tanpa memahami perubahan main

Jika branch hidup berminggu-minggu, rebase bisa menjadi deretan conflict dan semantic mismatch.

Solusi yang lebih sehat:

- Integrasi lebih sering.
- Pecah PR.
- Gunakan feature flag.
- Hindari branch long-lived.

### 27.4 Force push setelah rebase tanpa lease

```bash
git push --force
```

Biasakan:

```bash
git push --force-with-lease
```

### 27.5 Menggunakan rebase sebagai pengganti desain workflow

Jika tim terus-menerus harus rebase branch besar yang conflict berat, masalahnya mungkin bukan Git. Masalahnya bisa berupa:

- Ownership tidak jelas.
- Modul terlalu coupling.
- PR terlalu besar.
- Branch lifetime terlalu panjang.
- Tidak ada feature flag.
- Arsitektur memaksa banyak tim menyentuh file yang sama.

Git hanya memunculkan gejala.

---

## 28. Recovery Jika Rebase Salah

Rebase terasa menakutkan karena commit berubah. Tetapi Git biasanya masih menyimpan jejak lama di reflog.

Jika rebase baru saja selesai dan kamu sadar salah:

```bash
git reflog
```

Contoh output:

```text
abc1234 HEAD@{0}: rebase (finish): returning to refs/heads/feature
abc1234 HEAD@{1}: rebase (pick): feat(payment): add timeout configuration
old5678 HEAD@{2}: rebase (start): checkout origin/main
old9999 HEAD@{3}: commit: feat(payment): add timeout configuration
```

Kamu bisa kembali ke state sebelum rebase:

```bash
git reset --hard HEAD@{3}
```

Atau lebih aman buat branch penyelamat dulu:

```bash
git branch recovery/before-reset HEAD@{3}
```

Lalu inspeksi:

```bash
git log --oneline --graph --decorate --all
```

Prinsip recovery:

```text
Sebelum reset hard ke reflog entry, buat branch recovery jika ragu.
```

Part 017 nanti akan membahas recovery lebih dalam.

---

## 29. Checklist Sebelum Rebase

Sebelum menjalankan rebase, jawab pertanyaan ini:

```text
1. Branch apa yang sedang aktif?
2. Base baru yang saya inginkan apa?
3. Commit mana saja yang akan direplay?
4. Apakah branch ini private atau public/shared?
5. Apakah ada orang lain membuat branch dari branch ini?
6. Apakah ada tag/release/audit evidence di commit ini?
7. Apakah working tree bersih?
8. Apakah saya sudah fetch remote terbaru?
9. Apakah saya tahu cara abort/recover?
10. Setelah rebase, test apa yang harus dijalankan?
```

Command sebelum rebase:

```bash
git status
git fetch origin
git log --oneline --graph --decorate --all --max-count=30
```

Preview commit yang akan direbase:

```bash
git log --oneline origin/main..HEAD
```

Jika output commit sesuai ekspektasi, lanjut:

```bash
git rebase origin/main
```

---

## 30. Checklist Saat Rebase Conflict

Saat rebase berhenti:

```bash
git status
```

Lihat commit yang sedang diterapkan:

```bash
git show REBASE_HEAD
```

Lihat file conflict:

```bash
git diff --name-only --diff-filter=U
```

Selesaikan file:

```bash
# edit file
```

Stage hasil resolve:

```bash
git add <file>
```

Lanjut:

```bash
git rebase --continue
```

Jika salah arah:

```bash
git rebase --abort
```

Jika commit memang tidak dibutuhkan:

```bash
git rebase --skip
```

Setelah selesai:

```bash
git log --oneline --graph --decorate --all --max-count=30
./mvnw test
```

---

## 31. Checklist Setelah Rebase

Setelah rebase sukses:

```text
1. Periksa graph.
2. Periksa diff branch terhadap base.
3. Jalankan test relevan.
4. Pastikan commit count masuk akal.
5. Pastikan tidak ada perubahan tak disengaja.
6. Jika branch remote perlu diperbarui, gunakan --force-with-lease.
```

Command:

```bash
git log --oneline --graph --decorate --all --max-count=40

git diff --stat origin/main...HEAD
git diff origin/main...HEAD

./mvnw test

git push --force-with-lease
```

Catatan tentang diff:

```bash
git diff origin/main...HEAD
```

Membandingkan perubahan branch sejak merge base terhadap `HEAD`. Ini biasanya cocok untuk melihat diff PR.

---

## 32. Java-Specific Rebase Failure Modes

### 32.1 Import conflict yang terlihat sepele

Dua branch menambahkan import berbeda. Git conflict atau auto-merge.

Risiko:

- Import tidak digunakan.
- Static import salah.
- Class dengan nama sama dari package berbeda.

Setelah rebase:

```bash
./mvnw test
./mvnw -DskipTests compile
```

### 32.2 Dependency version conflict

`main` mengubah `pom.xml`, feature juga mengubah dependency.

Git mungkin bisa merge XML secara tekstual, tetapi hasilnya salah secara dependency graph.

Periksa:

```bash
./mvnw dependency:tree
```

atau Gradle:

```bash
./gradlew dependencies
```

### 32.3 Generated code mismatch

Feature mengubah OpenAPI/protobuf schema, `main` mengubah generator/plugin.

Rebase sukses, tetapi generated code stale.

Solusi:

```bash
./mvnw generate-sources
```

atau:

```bash
./gradlew generateProto
```

Sesuaikan dengan project.

### 32.4 Database migration ordering

Dua branch menambah migration:

```text
V202606170900__add_payment_timeout.sql
V202606171000__add_customer_risk.sql
```

Setelah rebase, urutan migration mungkin berubah. Git tidak tahu konsekuensi schema migration.

Periksa:

- Naming migration.
- Checksum migration.
- Idempotency.
- Backward compatibility.
- Deployment order.

### 32.5 Configuration semantic conflict

`main` mengubah default config:

```yaml
payment:
  timeout: 5000
```

Feature menambahkan retry:

```yaml
payment:
  retry: 3
```

Auto-merge sukses, tetapi kombinasi timeout/retry membuat total wait time terlalu tinggi.

Ini semantic conflict.

---

## 33. Rebase dan Regulated/Compliance Context

Dalam sistem regulasi, enforcement lifecycle, case management, financial systems, health systems, atau domain dengan audit kuat, commit history bisa menjadi bagian dari evidence chain.

Rebase private branch sebelum PR umumnya tidak masalah.

Tetapi rewrite history pada branch yang sudah digunakan untuk:

- release candidate,
- UAT evidence,
- production deployment,
- incident investigation,
- approval trail,
- security review,
- audit export,

bisa menjadi masalah serius.

Prinsip:

```text
Rebase is a development hygiene tool, not a compliance-safe correction mechanism for published delivery history.
```

Untuk public delivery history, operasi koreksi yang lebih defensible biasanya:

- `git revert`, karena membuat commit baru yang membatalkan perubahan.
- `git cherry-pick`, untuk membawa patch ke branch release.
- Merge commit, untuk mempertahankan titik integrasi.
- Tag baru, untuk release evidence baru.

Rebase mengubah narasi masa lalu. Dalam konteks audit, sering lebih baik membuat koreksi eksplisit di masa kini.

---

## 34. Practical Operating Model untuk Rebase

Gunakan aturan kerja berikut:

### 34.1 Untuk branch pribadi

```text
Rebase bebas, selama kamu paham recovery.
```

Workflow:

```bash
git fetch origin
git rebase origin/main
./mvnw test
git push --force-with-lease
```

### 34.2 Untuk branch PR pribadi

```text
Rebase boleh, tetapi jangan mengganggu review tanpa alasan.
```

Gunakan saat:

- PR conflict dengan main.
- PR perlu test terhadap main terbaru.
- Commit perlu dirapikan sebelum final review.

### 34.3 Untuk branch shared

```text
Jangan rebase tanpa kesepakatan eksplisit.
```

Pilih merge atau buat branch baru.

### 34.4 Untuk branch release/main

```text
Hindari rebase. Gunakan merge, revert, atau cherry-pick sesuai policy.
```

### 34.5 Untuk stacked PR

```text
Rebase parent dulu, lalu rebase child dengan hati-hati.
```

Verifikasi setiap layer.

---

## 35. Latihan Praktis

### Latihan 1 — Rebase Feature Branch ke Main

Buat repository kecil dengan:

```text
main: A---B---C
feature: B---D---E
```

Lalu jalankan:

```bash
git switch feature
git rebase main
```

Verifikasi:

```bash
git log --oneline --graph --decorate --all
```

Jawab:

1. Apakah hash `D` dan `E` berubah?
2. Apakah merge commit dibuat?
3. Apakah branch feature sekarang berdiri di atas `C`?

### Latihan 2 — Rebase Conflict

Buat file yang sama diubah oleh `main` dan `feature` di baris yang sama.

Jalankan rebase.

Saat conflict:

```bash
git status
git show REBASE_HEAD
git diff
```

Resolve, lalu:

```bash
git add <file>
git rebase --continue
```

Jawab:

1. Commit mana yang sedang diterapkan saat conflict?
2. Apakah conflict resolution masuk ke commit baru?
3. Apa bedanya dengan conflict saat merge?

### Latihan 3 — Force With Lease

Push branch feature ke remote test.

Rebase lokal.

Coba push biasa:

```bash
git push
```

Amati penolakan non-fast-forward.

Lalu:

```bash
git push --force-with-lease
```

Jawab:

1. Mengapa push biasa ditolak?
2. Apa yang dilindungi oleh `--force-with-lease`?
3. Kapan tetap tidak boleh force push?

### Latihan 4 — Rebase Onto

Buat graph:

```text
main
 \
  experimental
       \
        feature
```

Pindahkan `feature` agar berdiri langsung di atas `main`:

```bash
git rebase --onto main experimental feature
```

Verifikasi graph.

Jawab:

1. Commit mana yang dipindahkan?
2. Commit mana yang ditinggalkan?
3. Apa risiko salah memilih old-base?

---

## 36. Pertanyaan Reflektif

Gunakan pertanyaan ini untuk menguji pemahaman:

1. Mengapa rebase menghasilkan hash commit baru?
2. Apa perbedaan rebase dan merge dari sisi commit graph?
3. Mengapa rebase public history berbahaya?
4. Mengapa `--force-with-lease` lebih aman daripada `--force`?
5. Apa yang terjadi jika rebase conflict pada commit ke-2 dari 5 commit?
6. Mengapa rebase bisa menyebabkan semantic conflict walaupun tidak ada textual conflict?
7. Kapan merge lebih baik daripada rebase?
8. Kapan rebase `--onto` diperlukan?
9. Apa yang harus dicek sebelum melakukan rebase branch PR?
10. Bagaimana cara recover jika rebase salah?

---

## 37. Ringkasan Mental Model

Rebase adalah operasi untuk membuat ulang commit di atas base baru.

```text
Before:
A---B---C  main
     \
      D---E  feature

After rebase feature onto main:
A---B---C  main
         \
          D'---E'  feature
```

Hal penting:

```text
D' dan E' bukan D dan E.
Mereka commit baru dengan parent baru.
```

Rebase cocok untuk:

- branch pribadi,
- feature branch sebelum PR,
- membersihkan branch dari merge commit sinkronisasi,
- memindahkan branch ke base yang benar,
- stacked branch dengan disiplin.

Rebase berbahaya untuk:

- branch shared,
- main/release branch,
- history yang sudah menjadi evidence,
- branch yang menjadi base orang lain,
- commit yang sudah ditag untuk release.

Command inti:

```bash
git fetch origin
git rebase origin/main

git rebase --continue
git rebase --abort
git rebase --skip

git push --force-with-lease
```

Prinsip utama:

```text
Rebase is not about making history look pretty.
Rebase is about changing the base of a line of work while accepting the responsibility of rewriting commit identity.
```

---

## 38. Hubungan ke Part Berikutnya

Part ini membahas rebase dasar: memindahkan branch ke base baru.

Part berikutnya akan membahas bentuk rebase yang lebih kuat:

```text
learn-git-mastery-for-java-engineers-part-010.md
Interactive Rebase: Sculpting History
```

Di sana kita akan membahas:

- `git rebase -i`,
- `pick`, `reword`, `edit`, `squash`, `fixup`, `drop`,
- memecah commit,
- menggabungkan commit,
- merapikan commit sebelum PR,
- autosquash,
- batas etis rewrite history.

---

## 39. Status Seri

```text
Progress: 009 / 032
Status: Belum selesai
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
```

Seri belum mencapai bagian terakhir. Lanjutkan ke Part 010 untuk memahami interactive rebase sebagai alat membentuk history yang reviewable dan defensible.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-git-mastery-for-java-engineers-part-008.md">⬅️ Menggabungkan Sejarah Tanpa Kehilangan Konteks</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-git-mastery-for-java-engineers-part-010.md">Part 010 — Interactive Rebase: Sculpting History ➡️</a>
</div>

# learn-git-mastery-for-java-engineers-part-019.md

# Part 019 — Bisect: Debugging Regresi dengan Git

> **Seri:** Git Mastery for Java Engineers  
> **Bagian:** 019 / 032  
> **Topik:** Menggunakan `git bisect` sebagai mesin pencari commit penyebab regresi  
> **Target pembaca:** Java software engineer yang ingin mampu melakukan debugging historis secara sistematis, bukan berbasis tebakan  
> **Status seri:** Belum selesai. Bagian terakhir adalah `learn-git-mastery-for-java-engineers-part-032.md`.

---

## 0. Ringkasan Eksekutif

`git bisect` adalah salah satu command Git yang paling underrated.

Banyak engineer menggunakan Git hanya untuk:

```bash
git status
git add
git commit
git push
git pull
```

Engineer yang lebih matang menggunakan Git juga untuk:

```bash
git log
git diff
git blame
git show
```

Tetapi engineer yang benar-benar kuat menggunakan Git sebagai **debugging engine**.

`git bisect` membantu menjawab pertanyaan seperti:

```text
Commit mana yang pertama kali memperkenalkan bug ini?
```

Bukan:

```text
Siapa yang salah?
```

Bukan juga:

```text
File mana kira-kira penyebabnya?
```

Tetapi:

```text
Dari seluruh commit di antara versi yang masih benar dan versi yang sudah rusak,
commit mana yang menjadi boundary perubahan perilaku?
```

Itu perbedaan penting.

`git bisect` memakai binary search di commit history. Anda memberi Git dua titik:

```text
good commit = state yang diketahui belum punya bug
bad commit  = state yang diketahui sudah punya bug
```

Lalu Git memilih commit di tengah range. Anda menguji commit itu dan memberi label:

```bash
git bisect good
# atau
git bisect bad
```

Git terus mempersempit range sampai menemukan commit pertama yang buruk.

Untuk Java engineer, `git bisect` sangat berguna ketika menghadapi:

- regression bug setelah banyak commit masuk;
- test yang tiba-tiba gagal;
- endpoint Spring Boot yang berubah behavior;
- query repository yang menjadi lambat;
- memory leak yang baru muncul;
- dependency upgrade yang memecahkan compatibility;
- migration database yang mengubah asumsi aplikasi;
- perubahan serialization/deserialization JSON;
- perubahan concurrency yang menghasilkan race condition;
- perubahan build Gradle/Maven yang membuat CI gagal.

Skill utama bukan hanya tahu command `git bisect`.

Skill utama adalah:

```text
Mampu mendefinisikan predicate yang stabil untuk membedakan good vs bad.
```

Tanpa predicate yang jelas, `bisect` hanya menjadi ritual.

Dengan predicate yang jelas, Git menjadi mesin forensic yang sangat kuat.

---

## 1. Masalah yang Diselesaikan oleh Bisect

Bayangkan Anda punya branch `main` dengan 300 commit baru sejak release terakhir.

Versi production `v1.18.0` masih benar.

Versi terbaru `main` punya bug:

```text
POST /api/cases/{id}/escalate kadang mengembalikan 200 OK
tetapi status case tidak berubah dari UNDER_REVIEW ke ESCALATED.
```

Pendekatan umum yang buruk:

```text
1. Buka file yang "kelihatannya" relevan.
2. Cari-cari perubahan terakhir.
3. Salahkan commit paling mencurigakan.
4. Tambah log.
5. Coba test manual.
6. Ulangi sampai capek.
```

Pendekatan ini mahal karena:

- bias terhadap file yang terlihat familiar;
- bias terhadap author tertentu;
- bias terhadap commit terbaru;
- sulit membedakan penyebab dari gejala;
- tidak scale ketika history besar;
- sangat buruk untuk bug yang muncul akibat interaksi beberapa layer.

Pendekatan `git bisect`:

```text
1. Tentukan versi yang pasti good.
2. Tentukan versi yang pasti bad.
3. Definisikan test/predicate.
4. Biarkan Git memilih commit kandidat.
5. Jalankan predicate.
6. Label commit sebagai good/bad.
7. Ulangi sampai commit penyebab ditemukan.
```

Dengan 300 commit, binary search kira-kira butuh sekitar 9 pemeriksaan.

```text
2^8 = 256
2^9 = 512
```

Jadi 300 commit tidak perlu diperiksa satu-satu.

Anda hanya perlu membuat pengujian yang cukup dapat dipercaya.

---

## 2. Mental Model: Bisect Bukan Mencari File, Tetapi Mencari Boundary

`git bisect` tidak berpikir dalam bentuk:

```text
File mana yang berubah?
Class mana yang salah?
Method mana yang bug?
```

Git berpikir dalam bentuk commit graph.

Misalkan history linear:

```text
A -- B -- C -- D -- E -- F -- G -- H
^                                  ^
good                               bad
```

Artinya:

- commit `A` diketahui benar;
- commit `H` diketahui salah;
- bug diperkenalkan di salah satu commit setelah `A` sampai `H`.

Git akan memilih titik tengah:

```text
A -- B -- C -- D -- E -- F -- G -- H
               ^
             test
```

Kalau `D` masih good, maka bug pasti setelah `D`:

```text
D -- E -- F -- G -- H
^                  ^
good               bad
```

Kalau `D` bad, maka bug pasti di `B`, `C`, atau `D`:

```text
A -- B -- C -- D
^              ^
good           bad
```

Bisect mencari boundary:

```text
... good good good BAD bad bad bad ...
                  ^
          first bad commit
```

Commit yang ditemukan bukan selalu satu-satunya penyebab secara semantik.

Ia adalah commit pertama dalam range yang membuat predicate berubah dari good ke bad.

Perbedaan ini penting.

Jika predicate Anda adalah:

```text
"unit test X gagal"
```

maka bisect mencari commit pertama yang membuat unit test X gagal.

Jika predicate Anda adalah:

```text
"endpoint mengembalikan response field `statusReason` kosong"
```

maka bisect mencari commit pertama yang membuat field itu kosong.

Jika predicate Anda tidak jelas, hasil bisect juga tidak jelas.

---

## 3. Syarat Mental: Bug Harus Bisa Dimodelkan sebagai Predicate

`git bisect` efektif jika Anda bisa membuat pertanyaan boolean:

```text
Pada commit ini, apakah behavior buruk muncul?
```

Dengan output:

```text
good = belum ada bug
bad  = sudah ada bug
skip = tidak bisa diuji / commit tidak valid untuk predicate ini
```

Contoh predicate yang baik:

```text
Running `./mvnw -q -Dtest=CaseEscalationServiceTest test`
returns exit code 0.
```

Atau:

```text
Running `./gradlew test --tests CaseEscalationServiceTest`
passes.
```

Atau:

```text
A small script starts the app, calls endpoint X, and exits 1 if response invalid.
```

Contoh predicate yang buruk:

```text
Kode ini kelihatannya mencurigakan.
```

```text
Saya rasa behavior-nya agak aneh.
```

```text
Kadang gagal, kadang tidak.
```

```text
Manual test via UI kalau sempat.
```

`bisect` bisa dipakai manual, tetapi hasil terbaik datang dari predicate yang otomatis, cepat, dan deterministik.

---

## 4. Istilah Penting

## 4.1 Good Commit

Commit yang diketahui tidak memiliki bug menurut predicate.

```bash
git bisect good <commit>
```

Contoh:

```bash
git bisect good v1.18.0
```

Good bukan berarti commit itu sempurna.

Good hanya berarti:

```text
Untuk predicate yang sedang diuji, commit tersebut masih lolos.
```

## 4.2 Bad Commit

Commit yang diketahui memiliki bug menurut predicate.

```bash
git bisect bad <commit>
```

Biasanya bad adalah `HEAD` saat ini:

```bash
git bisect bad HEAD
```

Bad bukan berarti seluruh commit salah.

Bad hanya berarti:

```text
Untuk predicate yang sedang diuji, behavior buruk sudah muncul.
```

## 4.3 First Bad Commit

Commit pertama di range yang membuat predicate berubah menjadi bad.

Output akhir biasanya berbentuk:

```text
<sha> is the first bad commit
```

Interpretasinya:

```text
Commit ini adalah boundary historis pertama yang membuat predicate gagal.
```

Bukan otomatis:

```text
Author commit ini pasti bersalah.
```

Satu commit bisa tampak sebagai penyebab karena:

- commit sebelumnya menyiapkan kondisi;
- test baru mengekspos bug lama;
- dependency behavior berubah;
- konfigurasi environment berubah;
- predicate terlalu sempit;
- commit tersebut hanya membuat bug lebih terlihat.

## 4.4 Skip

Digunakan ketika commit tidak bisa diuji secara valid.

```bash
git bisect skip
```

Contoh alasan skip:

- build tidak bisa jalan karena transient compile error;
- migration schema tidak kompatibel;
- test infrastructure belum ada;
- dependency eksternal tidak tersedia;
- commit berada di tengah refactor besar yang tidak bisa dikompilasi;
- predicate membutuhkan file/test yang belum ada.

`skip` sebaiknya dipakai hati-hati. Terlalu banyak skip bisa membuat hasil tidak pasti.

---

## 5. Alur Dasar `git bisect`

Format paling umum:

```bash
git bisect start
git bisect bad
git bisect good <known-good-commit>
```

Atau eksplisit:

```bash
git bisect start <bad> <good>
```

Contoh:

```bash
git bisect start HEAD v1.18.0
```

Lalu Git checkout commit kandidat.

Anda menjalankan test:

```bash
./mvnw -q -Dtest=CaseEscalationServiceTest test
```

Jika test pass:

```bash
git bisect good
```

Jika test fail karena bug yang dicari:

```bash
git bisect bad
```

Jika commit tidak bisa diuji:

```bash
git bisect skip
```

Setelah selesai:

```bash
git bisect reset
```

`git bisect reset` mengembalikan working tree ke posisi sebelum bisect dimulai.

---

## 6. Contoh Manual End-to-End

Misalkan bug saat ini muncul di `main`.

Release terakhir `v1.12.0` diketahui sehat.

```bash
git checkout main
git pull --ff-only
```

Mulai bisect:

```bash
git bisect start
git bisect bad HEAD
git bisect good v1.12.0
```

Git akan checkout commit di tengah range.

Jalankan test:

```bash
./mvnw -q -Dtest=CaseEscalationServiceTest test
```

Jika pass:

```bash
git bisect good
```

Jika fail:

```bash
git bisect bad
```

Git pindah ke commit kandidat berikutnya.

Ulangi sampai muncul:

```text
a13f9e2c9d7b... is the first bad commit
commit a13f9e2c9d7b...
Author: ...
Date: ...
    Refactor escalation status transition
```

Lalu lihat commit:

```bash
git show --stat a13f9e2
git show a13f9e2
```

Selesai:

```bash
git bisect reset
```

Setelah itu debugging baru benar-benar dimulai:

```text
Bisect menemukan commit boundary.
Engineer tetap harus memahami mengapa commit itu menyebabkan behavior buruk.
```

---

## 7. Automated Bisect

Manual bisect berguna, tetapi automated bisect jauh lebih kuat.

Git bisa menjalankan command untuk setiap commit kandidat:

```bash
git bisect run <command>
```

Command harus mengikuti exit code:

```text
0      = good
1-127  = bad, kecuali 125
125    = skip
>127   = biasanya dianggap error/abort-like, hindari
```

Contoh Maven:

```bash
git bisect start HEAD v1.12.0
git bisect run ./mvnw -q -Dtest=CaseEscalationServiceTest test
git bisect reset
```

Contoh Gradle:

```bash
git bisect start HEAD v1.12.0
git bisect run ./gradlew test --tests CaseEscalationServiceTest
git bisect reset
```

Contoh script:

```bash
git bisect start HEAD v1.12.0
git bisect run ./scripts/bisect-case-escalation.sh
git bisect reset
```

Automated bisect ideal ketika:

- test cepat;
- test deterministic;
- dependency lokal bisa disiapkan;
- range commit cukup besar;
- bug bisa direproduksi tanpa UI manual.

---

## 8. Membuat Script Bisect yang Baik

Script bisect harus sederhana, eksplisit, dan stabil.

Contoh `scripts/bisect-case-escalation.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

./mvnw -q -DskipITs -Dtest=CaseEscalationServiceTest test
```

Jika test pass, Maven exit `0`, Git menganggap commit good.

Jika test fail, Maven exit non-zero, Git menganggap commit bad.

Tetapi di dunia nyata, build bisa gagal karena alasan yang tidak relevan dengan bug.

Contoh script lebih defensif:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [ ! -f "./mvnw" ]; then
  echo "No Maven wrapper in this commit; skipping"
  exit 125
fi

chmod +x ./mvnw || true

./mvnw -q -DskipITs -Dtest=CaseEscalationServiceTest test
```

Contoh jika test class belum ada di commit lama:

```bash
#!/usr/bin/env bash
set -euo pipefail

TEST_FILE="src/test/java/com/acme/caseflow/CaseEscalationServiceTest.java"

if [ ! -f "$TEST_FILE" ]; then
  echo "Test does not exist in this commit; skipping"
  exit 125
fi

./mvnw -q -Dtest=CaseEscalationServiceTest test
```

Namun ini punya konsekuensi.

Jika test baru dibuat setelah bug muncul, commit lama yang tidak punya test akan di-skip. Kadang lebih baik membuat predicate eksternal yang tidak bergantung pada test yang ada di history.

---

## 9. Predicate Eksternal: Cara Lebih Kuat untuk Bug Lama

Masalah umum:

```text
Bug sudah ada sekarang, tetapi test untuk bug itu baru akan kita tulis hari ini.
Kalau kita menulis test di working tree, lalu bisect checkout commit lama, test itu hilang.
```

Solusi:

1. Simpan test script di luar repository.
2. Saat bisect, script eksternal menjalankan aplikasi/command di commit kandidat.
3. Script menentukan good/bad.

Contoh struktur:

```text
~/bisect-scripts/case-escalation-regression.sh
```

Isi script:

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(pwd)"

if [ ! -f "$REPO_DIR/mvnw" ]; then
  exit 125
fi

./mvnw -q -DskipTests package

java -jar target/case-service.jar &
APP_PID=$!

cleanup() {
  kill "$APP_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

sleep 10

RESPONSE="$(curl -s -X POST http://localhost:8080/api/cases/123/escalate)"

echo "$RESPONSE" | grep -q '"status":"ESCALATED"'
```

Lalu:

```bash
git bisect start HEAD v1.12.0
git bisect run ~/bisect-scripts/case-escalation-regression.sh
git bisect reset
```

Keuntungan predicate eksternal:

- tidak hilang saat checkout commit lama;
- bisa dipakai lintas branch;
- bisa menguji behavior secara black-box;
- bisa memasukkan setup environment;
- bisa dipakai ulang untuk incident forensic.

Kelemahannya:

- harus tahan terhadap perubahan build layout;
- harus tahan terhadap perubahan config;
- bisa lambat;
- perlu membersihkan state antar run.

---

## 10. Bisect untuk Java Unit Test

Contoh Maven Surefire:

```bash
git bisect start HEAD v2.4.0
git bisect run ./mvnw -q -Dtest=PaymentPolicyTest test
```

Contoh method tertentu:

```bash
git bisect run ./mvnw -q -Dtest=PaymentPolicyTest#shouldRejectExpiredMandate test
```

Contoh Gradle:

```bash
git bisect run ./gradlew test --tests 'com.acme.PaymentPolicyTest.shouldRejectExpiredMandate'
```

Tips:

- pilih test paling kecil yang mereproduksi bug;
- hindari menjalankan seluruh suite jika satu test cukup;
- matikan integration test jika tidak relevan;
- pastikan test tidak bergantung pada urutan eksekusi;
- pastikan test tidak bergantung waktu sekarang tanpa kontrol;
- pastikan test tidak memakai random tanpa seed;
- pastikan test membersihkan static/global state.

Untuk Java, sumber flakiness umum:

- timezone;
- locale;
- current date/time;
- parallel test;
- shared database state;
- testcontainers reuse;
- port collision;
- async processing belum selesai;
- thread scheduling;
- cache static;
- mock yang terlalu longgar;
- order by yang tidak deterministik;
- filesystem path OS-specific;
- line endings.

Jika predicate flaky, bisect bisa mengarah ke commit yang salah.

---

## 11. Bisect untuk Integration Test

Integration test lebih realistis tetapi lebih mahal.

Contoh:

```bash
git bisect run ./mvnw -q -DskipUnitTests -Dit.test=CaseEscalationIT verify
```

Atau Gradle:

```bash
git bisect run ./gradlew integrationTest --tests CaseEscalationIT
```

Pertimbangan:

```text
Apakah setiap commit di range bisa menjalankan integration test?
```

Jika tidak, Anda perlu script yang bisa:

- menjalankan migration;
- menyiapkan database kosong;
- membersihkan container;
- memilih profile test;
- memberi timeout;
- mengembalikan exit 125 jika setup tidak valid.

Contoh script dengan Docker Compose:

```bash
#!/usr/bin/env bash
set -euo pipefail

docker compose -f docker-compose.test.yml down -v --remove-orphans >/dev/null 2>&1 || true
docker compose -f docker-compose.test.yml up -d postgres kafka

cleanup() {
  docker compose -f docker-compose.test.yml down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

./mvnw -q -DskipUnitTests -Dit.test=CaseEscalationIT verify
```

Masalah:

- lambat;
- rentan transient failure;
- perlu Docker tersedia;
- perubahan schema lama mungkin tidak kompatibel;
- commit lama mungkin belum punya compose file;
- dependency image bisa berubah.

Untuk incident besar, biaya ini sering tetap layak.

---

## 12. Bisect untuk Performance Regression

Bisect tidak hanya untuk functional bug.

Ia juga bisa dipakai untuk mencari commit penyebab performance regression.

Contoh kasus:

```text
Endpoint search cases sebelumnya P95 120 ms.
Sekarang P95 800 ms.
```

Predicate:

```text
bad jika benchmark lebih lambat dari threshold.
good jika benchmark masih di bawah threshold.
```

Contoh pseudo-script:

```bash
#!/usr/bin/env bash
set -euo pipefail

./mvnw -q -DskipTests package

RESULT_MS="$(./scripts/run-search-benchmark.sh | awk '/p95/ {print $2}')"

echo "P95=$RESULT_MS ms"

if [ "$RESULT_MS" -le 200 ]; then
  exit 0
else
  exit 1
fi
```

Namun performance bisect lebih sulit karena:

- noise tinggi;
- JIT warmup;
- GC;
- CPU contention;
- database cache;
- network variance;
- container resource variance;
- hardware difference;
- test data difference.

Untuk performance bisect, lakukan:

- local dedicated environment;
- fixed dataset;
- warmup;
- multiple runs;
- median/p95 evaluation;
- threshold dengan margin;
- disable background load;
- jangan terlalu ketat.

Contoh:

```bash
RUNS=5
BAD_COUNT=0

for i in $(seq 1 "$RUNS"); do
  MS="$(./scripts/bench.sh)"
  if [ "$MS" -gt 250 ]; then
    BAD_COUNT=$((BAD_COUNT + 1))
  fi
done

if [ "$BAD_COUNT" -ge 4 ]; then
  exit 1
else
  exit 0
fi
```

Ini tidak sempurna, tetapi lebih baik daripada satu run noisy.

---

## 13. Bisect untuk Memory Leak

Memory leak sering sulit karena predicate tidak langsung biner.

Contoh predicate:

```text
Setelah 10.000 request, heap used tidak boleh naik lebih dari 50MB setelah GC.
```

Script bisa:

1. Start app.
2. Warm up.
3. Kirim traffic.
4. Trigger GC jika memungkinkan.
5. Ambil metric memory.
6. Bandingkan threshold.
7. Exit 0/1.

Masalah:

- hasil bisa noisy;
- JVM ergonomics berubah;
- dependency berbeda;
- heap behavior tidak selalu linear;
- test lambat.

Bisect tetap berguna jika leak cukup jelas.

Untuk Java, gunakan bantuan:

- JFR;
- async-profiler;
- jcmd;
- jmap;
- Micrometer metrics;
- actuator endpoint;
- heap histogram;
- deterministic workload.

Tetapi jangan biarkan tooling performance mengaburkan prinsip dasar:

```text
Bisect hanya butuh predicate yang cukup stabil.
```

---

## 14. Bisect pada Commit Graph dengan Merge

History nyata sering tidak linear:

```text
A -- B -- C -- M -- F -- G
 \        /
  D -- E
```

Git bisect bekerja pada commit graph, bukan sekadar list linear.

Dengan merge commit, ada beberapa komplikasi:

- bug bisa diperkenalkan di branch samping;
- bug bisa muncul karena integrasi di merge commit;
- masing-masing side branch sendiri mungkin good, tetapi gabungan bad;
- merge commit bisa menjadi first bad commit jika conflict resolution salah;
- test predicate bisa gagal hanya setelah dua perubahan bertemu.

Jika `git bisect` menunjuk merge commit, jangan langsung menganggap merge commit “hanya noise”.

Merge commit bisa benar-benar penyebab jika:

- conflict diselesaikan salah;
- satu side mengubah API, side lain memakai asumsi lama;
- dependency version conflict diselesaikan salah;
- migration order salah;
- konfigurasi environment digabung tidak konsisten;
- semantic conflict tidak terdeteksi Git.

Untuk menganalisis merge commit:

```bash
git show --cc <merge-commit>
git show -m <merge-commit>
git log --graph --oneline --decorate --all
```

Interpretasi:

- `git show --cc` menunjukkan combined diff;
- `git show -m` memecah merge commit sebagai diff terhadap masing-masing parent.

---

## 15. Bisect dengan Path Limiting

Kadang Anda yakin bug berada di area tertentu.

Git bisect bisa diberi pathspec:

```bash
git bisect start -- src/main/java/com/acme/caseflow
```

Atau:

```bash
git bisect start HEAD v1.12.0 -- src/main/java/com/acme/caseflow
```

Ini membatasi commit yang dipertimbangkan ke commit yang menyentuh path tersebut.

Gunakan dengan hati-hati.

Keuntungan:

- lebih sedikit commit;
- lebih cepat;
- fokus pada area relevan.

Risiko:

- bug bisa berasal dari dependency/config/test/build file di luar path;
- perubahan framework, security config, serialization, atau migration bisa berdampak ke area itu tanpa menyentuh path;
- path limiting bisa melewatkan penyebab sebenarnya.

Rule praktis:

```text
Gunakan path limiting hanya jika area penyebab sudah sangat kuat,
atau sebagai second pass setelah bisect umum terlalu mahal.
```

Untuk Java backend, path limiting bisa menipu ketika bug disebabkan oleh:

- `pom.xml`;
- `build.gradle`;
- Spring configuration;
- ObjectMapper configuration;
- global exception handler;
- filter/interceptor;
- security config;
- database migration;
- generated client/server model;
- shared library upgrade.

---

## 16. Bisect dan Test yang Baru Ditulis

Kasus umum:

1. Bug ditemukan hari ini.
2. Anda menulis regression test hari ini.
3. Ingin menjalankan bisect ke commit lama.

Masalah:

```text
Saat Git checkout commit lama, test baru Anda tidak ada.
```

Ada beberapa strategi.

## 16.1 Simpan Test di Branch Sementara dan Apply Patch

Buat patch test:

```bash
git diff > /tmp/regression-test.patch
```

Script bisect:

```bash
#!/usr/bin/env bash
set -euo pipefail

git apply /tmp/regression-test.patch || exit 125
./mvnw -q -Dtest=CaseEscalationRegressionTest test
```

Kelemahan:

- patch mungkin gagal apply di commit lama;
- test mungkin bergantung pada API baru;
- cleanup perlu hati-hati.

## 16.2 Gunakan Script Eksternal Black-Box

Lebih robust untuk API behavior:

```bash
git bisect run ~/bisect-scripts/case-escalation-api-check.sh
```

Script tidak bergantung pada test source di repo.

## 16.3 Buat Minimal Reproducer yang Kompatibel

Kadang Anda bisa membuat test dengan API lama yang stabil.

Misal public service method sudah ada lama:

```java
caseEscalationService.escalate(caseId);
```

Test bisa tetap apply ke banyak commit.

## 16.4 Gunakan `git bisect run` dengan Setup Patch yang Toleran

Contoh:

```bash
#!/usr/bin/env bash
set -euo pipefail

git apply --3way /tmp/regression-test.patch || exit 125
./mvnw -q -Dtest=CaseEscalationRegressionTest test
```

`--3way` membantu jika patch tidak apply langsung, tetapi tetap bisa gagal.

---

## 17. Flaky Test: Musuh Utama Bisect

`git bisect` mengasumsikan predicate cukup stabil:

```text
Commit yang sama, diuji ulang, hasilnya sama.
```

Flaky test melanggar asumsi ini.

Contoh:

```text
commit X kadang good, kadang bad.
```

Akibat:

- bisect bisa memilih cabang pencarian yang salah;
- first bad commit bisa salah;
- proses jadi tidak reproducible;
- waktu debugging membengkak.

Strategi menghadapi flakiness:

## 17.1 Ulangi Predicate Beberapa Kali

```bash
#!/usr/bin/env bash
set -euo pipefail

for i in 1 2 3; do
  if ! ./mvnw -q -Dtest=CaseEscalationServiceTest test; then
    exit 1
  fi
done

exit 0
```

Ini menandai bad jika salah satu run gagal.

Cocok untuk test yang harus selalu pass.

## 17.2 Majority Vote

```bash
#!/usr/bin/env bash
set -euo pipefail

FAIL=0
RUNS=5

for i in $(seq 1 "$RUNS"); do
  if ! ./mvnw -q -Dtest=CaseEscalationServiceTest test; then
    FAIL=$((FAIL + 1))
  fi
done

if [ "$FAIL" -ge 3 ]; then
  exit 1
else
  exit 0
fi
```

Lebih cocok untuk performance/noisy behavior.

## 17.3 Stabilkan Test

Untuk Java:

- inject `Clock`, jangan pakai `Instant.now()` langsung;
- set timezone eksplisit;
- gunakan deterministic seed;
- disable parallelism jika perlu;
- bersihkan DB per run;
- gunakan Awaitility untuk async;
- hindari sleep buta;
- pastikan order query deterministic;
- isolasi static state;
- pakai port random/dynamic;
- reset mock dan cache.

## 17.4 Jangan Bisect Dulu Jika Predicate Belum Valid

Kadang keputusan terbaik:

```text
Stabilkan reproducer dulu, baru bisect.
```

Bisect dengan predicate buruk menghasilkan keyakinan palsu.

---

## 18. Commit yang Tidak Build

History ideal:

```text
Setiap commit bisa build dan test.
```

History nyata:

```text
Beberapa commit tengah tidak bisa build.
```

Penyebab:

- commit WIP masuk ke branch;
- refactor dipisah salah;
- dependency version belum sinkron;
- generated source belum committed;
- test broken sementara;
- build tool berubah;
- Java version berubah;
- module rename parsial.

Jika commit tidak build, Anda punya pilihan:

```bash
git bisect skip
```

Namun terlalu banyak skip melemahkan hasil.

Alternatif:

- gunakan range lebih kecil;
- pilih predicate black-box yang tidak butuh full test suite;
- patch build script sementara;
- gunakan old JDK sesuai commit;
- gunakan Docker image sesuai era commit;
- skip hanya commit yang benar-benar tidak bisa diuji.

Script:

```bash
#!/usr/bin/env bash
set -euo pipefail

if ! ./mvnw -q -DskipTests compile; then
  echo "Compile failed; skipping"
  exit 125
fi

./mvnw -q -Dtest=CaseEscalationServiceTest test
```

Ini bisa berbahaya jika compile failure sebenarnya adalah gejala bug yang dicari. Untuk functional regression, biasanya compile failure bukan predicate. Untuk build regression, compile failure justru bad.

Definisikan dulu:

```text
Apakah bug yang dicari adalah build failure atau runtime behavior failure?
```

---

## 19. Bisect untuk Build Regression

Jika masalahnya adalah build yang mulai gagal, predicate sangat sederhana.

Contoh:

```bash
git bisect start HEAD v1.12.0
git bisect run ./mvnw -q clean verify
git bisect reset
```

Atau lebih cepat:

```bash
git bisect run ./mvnw -q -DskipTests compile
```

Untuk Gradle:

```bash
git bisect run ./gradlew clean build
```

Masalah build regression umum di Java:

- dependency conflict;
- plugin upgrade;
- JDK compatibility;
- annotation processor issue;
- Lombok compatibility;
- generated code mismatch;
- Maven profile berubah;
- Gradle task dependency berubah;
- checkstyle/spotbugs/pmd rule berubah;
- test fixture dependency hilang;
- repository artifact tidak tersedia.

Jika build bergantung pada remote artifact repository, pastikan environment stabil.

Gunakan local cache dengan hati-hati:

```text
Cache bisa menyembunyikan bug dependency resolution.
```

Untuk dependency regression, kadang perlu:

```bash
rm -rf ~/.m2/repository/com/acme/problematic-lib
```

atau Gradle:

```bash
./gradlew --refresh-dependencies
```

Namun menjalankan ini di setiap bisect bisa mahal.

---

## 20. Bisect untuk Dependency Upgrade Regression

Misalkan setelah upgrade Spring Boot, behavior berubah.

Range commit:

```text
v2.2.0 good
HEAD bad
```

Predicate:

```bash
./mvnw -q -Dtest=JsonCompatibilityTest test
```

Bisect mungkin menunjuk commit:

```text
Upgrade Spring Boot 3.2.1 -> 3.3.0
```

Analisis lanjutan:

- apakah perubahan akibat framework behavior;
- apakah konfigurasi lama tidak kompatibel;
- apakah test terlalu bergantung detail internal;
- apakah ada transitive dependency berubah;
- apakah object mapper berubah behavior;
- apakah validation default berubah;
- apakah security filter chain berubah;
- apakah Hibernate dialect berubah;
- apakah timezone/date serialization berubah.

Bisect menemukan boundary, bukan seluruh reasoning.

Setelah commit ditemukan:

```bash
git show <sha> -- pom.xml build.gradle gradle.lockfile
./mvnw dependency:tree
./gradlew dependencies
```

---

## 21. Bisect untuk Database Migration Regression

Database migration sering membuat bisect sulit karena state database eksternal.

Contoh bug:

```text
Query case history sekarang mengembalikan duplicate rows.
```

Kemungkinan:

- migration menambahkan join table;
- unique constraint berubah;
- index berubah;
- default value berubah;
- nullable column berubah;
- query repository berubah;
- data seed berubah;
- transaction isolation berubah.

Predicate harus mengontrol database state.

Script ideal:

```bash
#!/usr/bin/env bash
set -euo pipefail

docker compose -f docker-compose.test.yml down -v --remove-orphans || true
docker compose -f docker-compose.test.yml up -d postgres

./mvnw -q -DskipTests package
./mvnw -q -Dit.test=CaseHistoryRepositoryIT verify
```

Untuk migration range panjang, commit lama mungkin memiliki migration tool berbeda.

Gunakan `exit 125` jika setup tidak valid.

Poin penting:

```text
Jangan bisect dengan database yang sudah tercemar state dari commit sebelumnya.
```

Setiap commit kandidat harus diuji pada state bersih atau state yang sengaja dikontrol.

---

## 22. Bisect untuk API Contract Regression

Contoh:

```text
Field `statusReason` hilang dari JSON response.
```

Predicate bisa berupa contract test:

```bash
curl -s http://localhost:8080/api/cases/123 |
  jq -e '.statusReason != null'
```

Script:

```bash
#!/usr/bin/env bash
set -euo pipefail

./mvnw -q -DskipTests package

java -jar target/case-service.jar --spring.profiles.active=bisect &
PID=$!

cleanup() {
  kill "$PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for i in $(seq 1 30); do
  if curl -fs http://localhost:8080/actuator/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -s http://localhost:8080/api/cases/123 | jq -e '.statusReason != null'
```

Kelebihan:

- menguji behavior yang user lihat;
- tidak peduli implementasi internal;
- cocok untuk backward compatibility.

Kekurangan:

- perlu app startup;
- perlu data seed;
- lambat;
- rentan perubahan port/config;
- butuh tool eksternal seperti `jq`.

---

## 23. Bisect dan Monorepo

Pada monorepo, range commit bisa sangat besar.

Masalah:

- banyak commit tidak relevan;
- build seluruh repo mahal;
- path ownership kompleks;
- shared library berubah berdampak luas;
- CI matrix besar.

Strategi:

## 23.1 Path Limiting

```bash
git bisect start HEAD v1.12.0 -- services/case-service libs/workflow-core
```

Gunakan jika yakin impact area.

## 23.2 Sparse Checkout / Partial Build

Jika repo mendukung:

```bash
./gradlew :services:case-service:test --tests CaseEscalationServiceTest
```

atau Maven module:

```bash
./mvnw -pl services/case-service -am -Dtest=CaseEscalationServiceTest test
```

`-pl` memilih module, `-am` membangun dependency module yang diperlukan.

## 23.3 External Predicate per Service

Untuk microservices monorepo:

```bash
git bisect run ./services/case-service/scripts/bisect-regression.sh
```

## 23.4 Hati-Hati dengan Shared Libraries

Bug service bisa berasal dari:

```text
libs/workflow-core
libs/security
libs/serialization
platform/spring-config
build-logic
```

Jangan terlalu cepat membatasi path ke service saja.

---

## 24. Bisect dan Polyrepo

Pada polyrepo, bug bisa muncul karena kombinasi commit antar repo.

Contoh:

```text
case-service HEAD bad
workflow-lib version 1.8.3
contract-service schema version 2026.04
```

Jika bug muncul akibat dependency eksternal, bisect di satu repo mungkin menunjuk commit yang hanya mengubah version pin:

```text
Bump workflow-lib from 1.8.2 to 1.8.3
```

Itu tetap informasi berguna.

Tetapi root cause mungkin ada di repo lain.

Strategi:

1. Bisect service repo untuk menemukan dependency bump.
2. Catat old/new dependency version.
3. Masuk repo dependency.
4. Bisect antara tag dependency lama dan baru.
5. Gunakan predicate yang mereproduksi behavior.

Contoh:

```bash
# repo service
git bisect run ./scripts/check-case-behavior.sh
# hasil: bump workflow-lib 1.8.2 -> 1.8.3

# repo workflow-lib
git bisect start v1.8.3 v1.8.2
git bisect run ./scripts/check-workflow-behavior.sh
```

Ini disebut multi-repo forensic.

Kuncinya adalah traceability:

- Git commit;
- artifact version;
- dependency lockfile;
- build metadata;
- deployment record;
- release tag.

---

## 25. Bisect pada Branch yang Sudah Rebased

Jika history sudah direwrite, commit SHA berubah.

Bisect tetap bisa dilakukan pada history saat ini, tetapi:

- hasil SHA mungkin tidak sama dengan SHA lama;
- referensi PR lama bisa membingungkan;
- commit lama mungkin sudah tidak reachable;
- reflog atau remote lama mungkin diperlukan.

Jika bug muncul pada branch feature sebelum merge, lebih baik bisect branch tersebut sebelum rewrite besar.

Jika bug sudah masuk main, bisect main/release branch yang menjadi sumber deploy.

Untuk auditability, jangan bergantung pada SHA branch private yang sudah direbase jika sudah tidak tersedia.

---

## 26. Bisect dan Revert

Misalkan bug muncul di `main`, lalu ada revert.

History:

```text
A -- B -- C -- D -- E -- R -- F
          ^ bug introduced
                  ^ revert C
```

Jika `HEAD` setelah revert sudah good, Anda tidak bisa memakai `HEAD` sebagai bad.

Pilih bad commit sebelum revert:

```bash
git bisect start E A
```

Atau cari range dari release bad.

Jika bug sempat masuk production dan kemudian direvert, gunakan deployment tag:

```bash
git bisect start prod-bad-tag prod-good-tag
```

Bisect harus mengikuti pertanyaan historis yang benar:

```text
Versi mana yang diketahui bad?
Versi mana yang diketahui good?
```

---

## 27. Bisect dengan Good/Bad Terbalik

Kadang Anda mencari commit yang memperbaiki bug, bukan memperkenalkannya.

Contoh:

```text
Bug ada di v1.12.0.
Bug sudah hilang di main.
Commit mana yang memperbaikinya?
```

Secara tradisional, `bad` berarti “punya property yang dicari” tergantung istilah. Git versi modern mendukung istilah alternatif `old` dan `new` untuk menghindari good/bad yang membingungkan pada perubahan non-bug.

Pola umum:

```bash
git bisect start --term-old broken --term-new fixed
git bisect fixed HEAD
git bisect broken v1.12.0
```

Atau tetap pakai good/bad dengan definisi eksplisit:

```text
good = bug sudah fixed
bad  = bug masih ada
```

Tetapi ini rawan kebingungan.

Untuk tim, lebih baik tulis di catatan:

```text
Dalam bisect ini:
- old/broken = behavior lama yang masih bug
- new/fixed = behavior baru yang sudah benar
```

---

## 28. Bisect Terms: Menghindari Ambiguitas Good/Bad

`good` dan `bad` cocok untuk regression bug.

Tetapi tidak selalu cocok untuk perubahan behavior lain:

- kapan feature pertama muncul;
- kapan performance membaik;
- kapan warning pertama muncul;
- kapan API field hilang;
- kapan dependency version berubah;
- kapan test mulai pass.

Git mendukung custom terms:

```bash
git bisect start --term-old old --term-new new
```

Contoh mencari commit ketika feature mulai ada:

```bash
git bisect start --term-old absent --term-new present
git bisect present HEAD
git bisect absent v1.10.0
```

Saat Git checkout kandidat:

```bash
# jika feature belum ada
git bisect absent

# jika feature sudah ada
git bisect present
```

Ini membantu menghindari percakapan tim yang rancu.

---

## 29. Menyimpan Log Bisect

Selama bisect:

```bash
git bisect log
```

Simpan:

```bash
git bisect log > /tmp/bisect-case-escalation.log
```

Manfaat:

- audit trail investigasi;
- bisa dibagikan ke engineer lain;
- bisa direplay;
- membantu incident report;
- membantu review metode predicate.

Replay:

```bash
git bisect replay /tmp/bisect-case-escalation.log
```

Untuk regulated/enterprise systems, log investigasi bisa menjadi evidence:

```text
Kami menentukan commit penyebab melalui binary search dengan predicate X,
range good Y, bad Z, dan hasil commit C.
```

---

## 30. Setelah Bisect Menemukan Commit

Jangan berhenti di output.

Langkah berikutnya:

## 30.1 Baca Commit

```bash
git show --stat <sha>
git show <sha>
```

Lihat:

- file berubah;
- diff utama;
- test yang berubah;
- config yang berubah;
- dependency yang berubah;
- migration yang berubah;
- commit message;
- author/committer date;
- parent commit.

## 30.2 Cari PR/Issue Terkait

Jika commit message punya reference:

```text
CASE-1842 Refactor escalation transition
```

Cari issue/PR:

- alasan perubahan;
- review discussion;
- trade-off;
- known risk;
- test coverage;
- migration note.

## 30.3 Reproduksi di Parent dan Commit

```bash
git checkout <sha>^
./scripts/reproduce.sh

git checkout <sha>
./scripts/reproduce.sh
```

Pastikan boundary valid:

```text
Parent good, commit bad.
```

Untuk merge commit:

```bash
git show --pretty=raw <sha>
git show -m <sha>
```

## 30.4 Tentukan Root Cause

Pertanyaan:

- apa invariant yang dilanggar?
- apakah commit mengubah behavior sengaja?
- apakah test lama kurang?
- apakah contract berubah tanpa migrasi?
- apakah dependency behavior berubah?
- apakah config default berubah?
- apakah bug sebenarnya sudah latent?
- apakah commit hanya mengekspos bug lama?
- apakah fix terbaik revert, patch, atau forward correction?

## 30.5 Buat Regression Test

Setelah root cause jelas:

```text
Tambahkan test yang gagal sebelum fix dan pass setelah fix.
```

Bisect membantu menemukan commit, tetapi regression test mencegah bug kembali.

---

## 31. Decision Matrix: Kapan Menggunakan Bisect

| Situasi | Gunakan Bisect? | Alasan |
|---|---:|---|
| Regression jelas antara dua versi | Ya | Cocok dengan model good/bad |
| Range commit besar | Ya | Binary search sangat efisien |
| Predicate otomatis tersedia | Sangat ya | Biaya rendah, hasil kuat |
| Bug hanya bisa diuji manual 30 menit | Mungkin | Masih bisa, tetapi mahal |
| Bug tidak bisa direproduksi | Belum | Stabilkan reproducer dulu |
| Test flaky berat | Belum | Predicate belum dipercaya |
| Anda tahu commit pasti penyebabnya | Mungkin tidak | Verifikasi langsung lebih cepat |
| Build banyak commit tengah rusak | Mungkin | Perlu skip atau range lebih baik |
| Bug akibat environment production saja | Sulit | Perlu reproduce environment |
| Performance regression noisy | Mungkin | Butuh benchmark stabil |
| Multi-repo dependency regression | Ya, bertahap | Bisect repo pemicu lalu repo dependency |

---

## 32. Anti-Pattern dalam Bisect

## 32.1 Predicate Kabur

```text
Saya lihat manual apakah terasa benar.
```

Masalah:

- subjektif;
- lambat;
- tidak reproducible.

## 32.2 Tidak Reset Setelah Bisect

Lupa:

```bash
git bisect reset
```

Akibat:

- tetap berada di detached HEAD;
- bingung kenapa branch hilang;
- kerja baru dibuat di commit lama.

## 32.3 Menjalankan Bisect di Working Tree Kotor

Sebelum bisect:

```bash
git status
```

Pastikan bersih.

Jika ada WIP:

```bash
git stash push -u -m "wip before bisect"
```

atau gunakan `git worktree`.

## 32.4 Menganggap First Bad Commit Sama dengan Orang Bersalah

Ini anti-pattern budaya engineering.

Commit adalah boundary, bukan pengadilan.

Gunakan hasil untuk memahami sistem, bukan menyalahkan individu.

## 32.5 Tidak Memvalidasi Parent vs Commit

Selalu validasi:

```bash
git checkout <sha>^
./predicate.sh

git checkout <sha>
./predicate.sh
```

## 32.6 Terlalu Cepat Path-Limit

Bug yang tampak di service A bisa disebabkan oleh shared config, dependency, serializer, database, atau security filter.

## 32.7 Mengabaikan Semantic Conflict

Bisect bisa menunjuk merge commit.

Jangan anggap itu noise.

Merge commit bisa memperkenalkan bug akibat integrasi dua perubahan yang masing-masing valid sendiri.

---

## 33. Workflow Operasional untuk Incident

Misalkan production incident:

```text
Setelah deployment 2026-06-15, beberapa case escalation stuck.
Deployment sebelumnya 2026-06-10 aman.
```

Langkah:

## 33.1 Identifikasi Artifact/Commit

Cari:

```text
good deploy commit/tag = deploy-2026-06-10
bad deploy commit/tag  = deploy-2026-06-15
```

## 33.2 Buat Predicate

Minimal:

```text
Given case in UNDER_REVIEW,
when escalate,
then case status becomes ESCALATED and audit event exists.
```

Automasi:

```bash
./scripts/reproduce-escalation-stuck.sh
```

## 33.3 Jalankan Bisect

```bash
git bisect start deploy-2026-06-15 deploy-2026-06-10
git bisect run ./scripts/reproduce-escalation-stuck.sh
```

## 33.4 Simpan Log

```bash
git bisect log > incident-2026-06-15-bisect.log
```

## 33.5 Analisis Commit

```bash
git show <first-bad-sha>
```

## 33.6 Pilih Remediation

Pilihan:

- hotfix;
- revert;
- config rollback;
- data repair;
- forward fix;
- dependency pin rollback.

## 33.7 Tambahkan Regression Test

```text
Test harus merepresentasikan invariant bisnis, bukan hanya line coverage.
```

## 33.8 Catat Evidence

Incident note:

```text
Good commit:
Bad commit:
Predicate:
First bad commit:
Root cause:
Fix:
Regression test:
Deployment artifact:
```

---

## 34. Bisect dengan `git worktree`

Agar tidak mengganggu working tree utama:

```bash
git worktree add ../case-service-bisect main
cd ../case-service-bisect
```

Jalankan bisect di worktree itu:

```bash
git bisect start HEAD v1.12.0
git bisect run ./scripts/reproduce.sh
git bisect reset
```

Setelah selesai:

```bash
cd ..
git worktree remove case-service-bisect
```

Keuntungan:

- branch kerja utama aman;
- tidak perlu stash WIP;
- bisa membandingkan commit di dua directory;
- cocok untuk hotfix/incident.

Untuk Java project, worktree juga membantu karena IDE/build cache di folder utama tidak terganggu.

---

## 35. Bisect dan IDE

Bisect paling baik dijalankan dari CLI.

IDE bisa membantu setelah commit ditemukan:

- open diff;
- navigate usage;
- run debugger;
- inspect tests;
- compare parent/commit.

Tetapi jangan bergantung pada IDE untuk checkout otomatis selama bisect jika IDE melakukan background indexing/build yang mengubah file generated.

Perhatikan:

- IntelliJ mungkin membuat `.idea` changes;
- annotation processing bisa menghasilkan file;
- Gradle/Maven import bisa menulis metadata;
- generated files bisa mengotori working tree.

Pastikan `.gitignore` benar.

Sebelum `git bisect good/bad`:

```bash
git status --short
```

Jika ada generated noise, bersihkan atau ignore.

---

## 36. Bisect dan Generated Code

Java project sering menggunakan generated code:

- OpenAPI generator;
- protobuf;
- gRPC;
- MapStruct;
- QueryDSL;
- jOOQ;
- annotation processing;
- Lombok;
- Immutables;
- Avro.

Jika generated code committed, bisect bisa menemukan commit yang mengubah generated file, padahal root cause di spec/source generator.

Jika generated code tidak committed, commit lama mungkin butuh generator version tertentu.

Predicate perlu memperhitungkan:

- apakah generated code adalah source of truth;
- apakah generator version pinned;
- apakah build reproducible;
- apakah generated output deterministic;
- apakah generated code harus dibersihkan antar run.

Contoh:

```bash
./mvnw -q clean test
```

`clean` penting jika generated code dari commit sebelumnya tertinggal.

---

## 37. Bisect dan State Eksternal

Git hanya checkout file.

Git tidak otomatis mengubah:

- database schema eksternal;
- Docker volume;
- Kafka topic;
- Redis cache;
- local Maven cache;
- Gradle cache;
- environment variable;
- running process;
- feature flag service;
- object storage;
- local config file di luar repo.

Jadi predicate harus mengontrol state eksternal.

Checklist sebelum automated bisect:

```text
Apakah setiap run mulai dari state yang sama?
Apakah ada process lama yang masih hidup?
Apakah database volume dibersihkan?
Apakah port digunakan process lain?
Apakah cache perlu direset?
Apakah feature flag dipaksa nilainya?
Apakah timezone/locale/JDK version tetap?
```

Tanpa ini, bisect bisa salah.

---

## 38. Bisect dan JDK Version

Commit lama bisa membutuhkan JDK berbeda.

Contoh:

```text
v1.12.0 pakai Java 11
main pakai Java 21
```

Jika Anda menjalankan semua commit dengan Java 21, commit lama bisa gagal bukan karena bug, tetapi compatibility.

Strategi:

- gunakan `.java-version`;
- gunakan SDKMAN!;
- gunakan asdf;
- gunakan Maven toolchains;
- gunakan Docker image per era commit;
- exit 125 jika JDK requirement tidak terpenuhi.

Script sederhana:

```bash
if grep -q '<maven.compiler.release>17</maven.compiler.release>' pom.xml; then
  export JAVA_HOME="$JAVA17_HOME"
elif grep -q '<maven.compiler.release>21</maven.compiler.release>' pom.xml; then
  export JAVA_HOME="$JAVA21_HOME"
else
  export JAVA_HOME="$JAVA11_HOME"
fi

./mvnw -q -Dtest=CaseEscalationServiceTest test
```

Ini tidak sempurna, tetapi menunjukkan prinsip:

```text
Predicate harus menguji commit dalam environment yang valid untuk commit itu.
```

---

## 39. Bisect dengan Submodules

Jika repo memakai submodule:

```bash
git submodule update --init --recursive
```

Script bisect perlu memasukkan itu:

```bash
#!/usr/bin/env bash
set -euo pipefail

git submodule update --init --recursive || exit 125
./mvnw -q -Dtest=CaseEscalationServiceTest test
```

Masalah:

- submodule commit bisa hilang;
- submodule repo private tidak accessible;
- submodule branch berubah;
- old commit menunjuk submodule SHA yang tidak ada.

Jika submodule state tidak reproducible, bisect sulit dipercaya.

---

## 40. Bisect dengan Git LFS

Jika repo memakai Git LFS:

```bash
git lfs pull
```

Script:

```bash
#!/usr/bin/env bash
set -euo pipefail

git lfs pull || exit 125
./mvnw -q -Dtest=ModelCompatibilityTest test
```

Masalah:

- file LFS lama mungkin tidak tersedia;
- bandwidth besar;
- checkout lambat;
- CI/local environment belum install Git LFS.

Jika test butuh binary fixture besar, pertimbangkan apakah fixture bisa dibuat lebih kecil.

---

## 41. Menulis Predicate yang Menguji Invariant, Bukan Implementasi

Bug regression paling penting biasanya melanggar invariant bisnis.

Contoh buruk:

```text
Test gagal jika method internal `calculateNextState` return X.
```

Mungkin terlalu implementation-specific.

Contoh lebih baik:

```text
Given case eligible for escalation,
when escalation requested,
then case status becomes ESCALATED,
audit event is written,
and duplicate escalation command is idempotent.
```

Untuk sistem regulatory/enforcement lifecycle, invariant lebih penting daripada method internal:

- state transition valid;
- actor permission benar;
- audit event tercatat;
- timestamp konsisten;
- case lock dihormati;
- escalation rule deterministic;
- duplicate command idempotent;
- prohibited transition ditolak;
- SLA calculation tidak mundur;
- generated notice tidak berubah tanpa reason.

Bisect dengan predicate invariant memberi hasil yang lebih bernilai daripada test implementation detail.

---

## 42. Case Study: Escalation Regression

## 42.1 Konteks

Sistem case management punya state:

```text
NEW -> UNDER_REVIEW -> ESCALATED -> ENFORCEMENT_ACTION
```

Bug:

```text
Pada commit terbaru, escalation command mengembalikan success,
tetapi status case tetap UNDER_REVIEW jika case punya pending document review.
```

Good version:

```text
v2.8.0
```

Bad version:

```text
main HEAD
```

## 42.2 Buat Predicate

Test invariant:

```text
Given case UNDER_REVIEW with pending document review,
when supervisor escalates,
then case status becomes ESCALATED
and audit event CASE_ESCALATED exists.
```

Script:

```bash
#!/usr/bin/env bash
set -euo pipefail

./mvnw -q -Dtest=CaseEscalationRegressionTest test
```

Jika test baru belum ada di commit lama, gunakan patch atau external script.

## 42.3 Jalankan

```bash
git worktree add ../case-bisect main
cd ../case-bisect

git bisect start HEAD v2.8.0
git bisect run ~/bisect-scripts/case-escalation-predicate.sh
```

Output:

```text
9f4c2a1 is the first bad commit
```

## 42.4 Analisis Commit

```bash
git show --stat 9f4c2a1
git show 9f4c2a1
```

Diff menunjukkan:

```text
Refactor transition guard to include pending document checks
```

Ternyata perubahan dimaksudkan untuk mencegah enforcement action sebelum document review selesai, tetapi guard diterapkan terlalu awal pada transition ke ESCALATED.

## 42.5 Fix

Pilihan:

- ubah guard hanya untuk `ESCALATED -> ENFORCEMENT_ACTION`;
- tambahkan test untuk transition matrix;
- tambahkan audit invariant;
- update decision table.

## 42.6 Lesson

Bisect tidak menggantikan domain reasoning.

Bisect mempersempit search space dari ratusan commit menjadi satu commit boundary, sehingga domain reasoning bisa difokuskan.

---

## 43. Case Study: JSON Contract Regression

Bug:

```text
Mobile client gagal karena field `statusReason` hilang dari JSON response.
```

Good:

```text
v3.1.2
```

Bad:

```text
v3.2.0
```

Predicate:

```bash
#!/usr/bin/env bash
set -euo pipefail

./mvnw -q -DskipTests package

java -jar target/case-api.jar --spring.profiles.active=contract-test &
PID=$!

cleanup() { kill "$PID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

sleep 15

curl -s http://localhost:8080/api/cases/demo |
  jq -e '.statusReason != null and (.statusReason | type == "string")'
```

Bisect result:

```text
Commit: Replace Jackson field visibility with constructor-only serialization
```

Root cause:

- DTO field had no getter;
- previous ObjectMapper config serialized fields;
- new config serialized getters/constructor properties only.

Fix:

- add explicit getter/record field;
- add contract test;
- lock ObjectMapper behavior;
- document API compatibility.

---

## 44. Case Study: Gradle Build Regression

Bug:

```text
CI mulai gagal dengan `NoClassDefFoundError` saat test runtime.
```

Good:

```text
build-2026-05-01
```

Bad:

```text
HEAD
```

Predicate:

```bash
git bisect run ./gradlew clean test --no-build-cache
```

Bisect result:

```text
Commit: Convert internal-platform dependency from api to implementation
```

Root cause:

- module yang bergantung transitively kehilangan class di test runtime;
- compile masih pass karena test compile path berbeda;
- runtime classpath berubah.

Fix:

- restore `api` for exported dependency;
- add dependency constraints;
- add module boundary test.

Lesson:

```text
Bisect build regression sering menunjuk perubahan build logic, bukan source code Java.
```

---

## 45. Practical Command Cheat Sheet

Mulai bisect:

```bash
git bisect start
git bisect bad HEAD
git bisect good v1.12.0
```

Shortcut:

```bash
git bisect start HEAD v1.12.0
```

Label commit kandidat:

```bash
git bisect good
git bisect bad
git bisect skip
```

Automated:

```bash
git bisect run ./mvnw -q -Dtest=SomeTest test
```

Reset:

```bash
git bisect reset
```

Lihat log:

```bash
git bisect log
```

Simpan log:

```bash
git bisect log > bisect.log
```

Replay:

```bash
git bisect replay bisect.log
```

Custom terms:

```bash
git bisect start --term-old broken --term-new fixed
git bisect broken v1.0.0
git bisect fixed HEAD
```

Path limited:

```bash
git bisect start HEAD v1.12.0 -- src/main/java/com/acme/caseflow
```

Analisis hasil:

```bash
git show --stat <sha>
git show <sha>
git show -m <merge-sha>
git log --graph --oneline --decorate --all
```

---

## 46. Checklist Sebelum Bisect

Sebelum mulai:

```text
[ ] Working tree bersih.
[ ] Good commit benar-benar good.
[ ] Bad commit benar-benar bad.
[ ] Predicate jelas dan biner.
[ ] Predicate cukup cepat.
[ ] Predicate cukup deterministic.
[ ] Environment stabil.
[ ] External state dikontrol.
[ ] JDK/build tool sesuai.
[ ] Test data disiapkan.
[ ] Cleanup antar run tersedia.
[ ] Range commit masuk akal.
[ ] Jika perlu, gunakan worktree terpisah.
```

Command:

```bash
git status --short
git log --oneline --decorate -5
```

---

## 47. Checklist Saat Bisect

```text
[ ] Jangan edit source sembarangan di tengah bisect.
[ ] Jalankan predicate yang sama.
[ ] Gunakan `good` hanya jika predicate benar-benar pass.
[ ] Gunakan `bad` hanya jika failure sesuai bug yang dicari.
[ ] Gunakan `skip` untuk commit yang tidak valid diuji.
[ ] Catat anomali.
[ ] Jika hasil terasa tidak masuk akal, curigai predicate/environment.
```

---

## 48. Checklist Setelah Bisect

```text
[ ] Simpan `git bisect log`.
[ ] Jalankan `git bisect reset`.
[ ] `git show` commit hasil.
[ ] Validasi parent good dan commit bad.
[ ] Cari PR/issue terkait.
[ ] Pahami root cause.
[ ] Tambahkan regression test.
[ ] Pilih remediation.
[ ] Dokumentasikan incident/investigation jika perlu.
```

---

## 49. Hubungan Bisect dengan Command Lain

| Command | Peran |
|---|---|
| `git log` | Melihat range dan history |
| `git diff` | Memahami perubahan antar commit |
| `git show` | Membaca commit hasil bisect |
| `git blame` | Menelusuri line-level history setelah area diketahui |
| `git grep` | Mencari simbol/pattern di commit tertentu |
| `git worktree` | Menjalankan bisect tanpa mengganggu working tree utama |
| `git stash` | Menyimpan WIP sebelum bisect |
| `git reset` | Jangan dipakai sembarangan saat bisect |
| `git clean` | Membersihkan untracked/generated state bila perlu |
| `git reflog` | Recovery jika checkout/state membingungkan |

Bisect bukan pengganti `log`, `diff`, atau `show`.

Bisect mempersempit ruang pencarian.

`show`, `diff`, dan domain reasoning menjelaskan penyebab.

---

## 50. Latihan Praktis

## Latihan 1 — Manual Bisect Sederhana

Buat repo kecil:

```bash
mkdir git-bisect-lab
cd git-bisect-lab
git init
```

Buat file:

```bash
cat > calc.sh <<'SCRIPT'
#!/usr/bin/env bash
echo 10
SCRIPT
chmod +x calc.sh
git add calc.sh
git commit -m "Initial correct calculator"
```

Buat beberapa commit:

```bash
for i in 1 2 3 4; do
  echo "# comment $i" >> calc.sh
  git add calc.sh
  git commit -m "Add comment $i"
done
```

Perkenalkan bug:

```bash
cat > calc.sh <<'SCRIPT'
#!/usr/bin/env bash
echo 11
SCRIPT
chmod +x calc.sh
git add calc.sh
git commit -m "Change calculator behavior"
```

Tambahkan commit lanjutan:

```bash
for i in 5 6 7 8; do
  echo "# comment $i" >> calc.sh
  git add calc.sh
  git commit -m "Add comment $i"
done
```

Predicate manual:

```bash
./calc.sh
```

Mulai bisect:

```bash
git bisect start
git bisect bad HEAD
git bisect good HEAD~8
```

Setiap commit:

```bash
if [ "$(./calc.sh)" = "10" ]; then
  git bisect good
else
  git bisect bad
fi
```

Akhiri:

```bash
git bisect reset
```

## Latihan 2 — Automated Bisect

Buat script:

```bash
cat > test-calc.sh <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

[ "$(./calc.sh)" = "10" ]
SCRIPT
chmod +x test-calc.sh
```

Jalankan:

```bash
git bisect start HEAD HEAD~8
git bisect run ./test-calc.sh
git bisect reset
```

## Latihan 3 — Java/Maven Bisect

Di project Java:

1. Pilih test kecil yang sedang gagal.
2. Cari tag/commit yang good.
3. Jalankan:

```bash
git bisect start HEAD <good-tag>
git bisect run ./mvnw -q -Dtest=YourFailingTest test
git bisect reset
```

Catat:

- berapa commit di range;
- berapa langkah bisect;
- commit hasil;
- apakah hasil masuk akal;
- apakah test deterministic.

## Latihan 4 — Flaky Predicate

Buat script yang kadang gagal:

```bash
#!/usr/bin/env bash
R=$(( RANDOM % 2 ))
exit "$R"
```

Jalankan bisect dan amati kekacauannya.

Lalu ubah menjadi deterministic.

Tujuan:

```text
Merasakan langsung kenapa flaky predicate berbahaya.
```

## Latihan 5 — Bisect dengan Worktree

```bash
git worktree add ../repo-bisect main
cd ../repo-bisect
git bisect start HEAD <good-tag>
git bisect run ./mvnw -q -Dtest=SomeTest test
git bisect reset
cd ..
git worktree remove repo-bisect
```

---

## 51. Pertanyaan Reflektif

Jawab sebelum memakai bisect di incident nyata:

1. Apa definisi good dan bad dalam kasus ini?
2. Apakah bug benar-benar regression?
3. Commit/tag mana yang pasti good?
4. Commit/tag mana yang pasti bad?
5. Apakah predicate bisa diotomasi?
6. Apakah predicate deterministic?
7. Apakah test terlalu sempit atau terlalu luas?
8. Apakah external state dikontrol?
9. Apakah commit lama bisa build dengan environment sekarang?
10. Apakah ada dependency eksternal yang berubah di luar Git?
11. Apakah bug mungkin berasal dari multi-repo dependency?
12. Apakah path limiting aman?
13. Apakah hasil bisect akan cukup untuk remediation?
14. Bagaimana regression test permanen akan dibuat?
15. Bagaimana hasil investigasi akan didokumentasikan?

---

## 52. Mental Model Akhir

`git bisect` adalah:

```text
Binary search over commit graph using a developer-defined predicate.
```

Ia efektif jika:

```text
good dan bad jelas,
predicate stabil,
environment terkontrol,
dan hasilnya dianalisis dengan domain reasoning.
```

Ia tidak efektif jika:

```text
bug tidak reproducible,
test flaky,
external state kacau,
atau engineer menganggap output bisect sebagai vonis final.
```

Cara berpikir engineer kuat:

```text
Saya tidak mencari "siapa yang salah".
Saya mencari boundary historis perubahan behavior.
Setelah boundary ditemukan, saya analisis invariant yang rusak,
membuat regression test,
dan memilih remediation paling aman.
```

---

## 53. Koneksi ke Part Berikutnya

Part ini mengajarkan cara menemukan commit boundary penyebab regresi.

Part berikutnya akan melengkapi forensic toolkit dengan:

```text
git blame
git log -S
git log -G
git grep
code archaeology
```

Jika `bisect` menjawab:

```text
Commit mana yang pertama membuat behavior berubah?
```

Maka `blame` dan `pickaxe` membantu menjawab:

```text
Kapan baris/simbol ini berubah?
Kenapa kode ini menjadi seperti sekarang?
Perubahan mana yang memperkenalkan konsep ini?
```

---

## 54. Referensi

Rujukan utama untuk materi ini:

- Git official documentation: `git bisect`
- Pro Git Book: debugging with Git
- Git official documentation: revision selection, log, show, worktree, stash
- Praktik umum Java build/test dengan Maven Surefire, Maven Failsafe, Gradle test filtering
- Praktik engineering regression debugging, CI investigation, incident forensic, dan release traceability

---

## 55. Status Seri

```text
Progress: 019 / 032
Seri belum selesai.
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
```

Bagian berikutnya:

```text
learn-git-mastery-for-java-engineers-part-020.md
```

Topik:

```text
Blame, Pickaxe, dan Forensic Code Archaeology
```

# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-001.md

# Part 001 — Shell Mental Model: Process, Stream, Exit Code, Environment

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: memahami shell sebagai orchestrator proses, bukan sekadar “bahasa command line”.

---

## 0. Posisi Part Ini dalam Seri

Part 000 membangun orientasi besar: scripting sebagai **engineering control plane**.

Part 001 masuk ke fondasi yang sering dilewati: **apa sebenarnya yang terjadi ketika kita menjalankan command?**

Banyak engineer belajar shell dari contoh seperti:

```bash
grep error app.log | sort | uniq -c
```

atau:

```bash
mvn test && docker build -t app .
```

Contoh itu berguna, tetapi tidak cukup untuk membuat automation yang robust.

Untuk bisa menulis script level senior, kita harus mengerti:

- command dieksekusi sebagai proses;
- proses punya input, output, error stream;
- proses mengembalikan exit status;
- environment diwariskan dari parent ke child;
- working directory adalah bagian dari state;
- PATH menentukan command mana yang benar-benar dijalankan;
- shell variable berbeda dari environment variable;
- pipeline bukan function call;
- subshell bukan current shell;
- script yang “jalan di laptop” bisa gagal di CI karena asumsi lingkungan berbeda.

Part ini adalah fondasi untuk seluruh seri. Tanpa ini, Bash, PowerShell, dan Makefile akan terasa seperti kumpulan trik. Dengan ini, kita bisa melihat semuanya sebagai sistem eksekusi yang punya invariants.

---

## 1. Mental Model Utama: Shell adalah Process Orchestrator

Shell bukan hanya bahasa pemrograman. Shell adalah **program yang membaca command, menyiapkan eksekusi, lalu menjalankan proses lain**.

Ketika kita mengetik:

```bash
ls -lah /tmp
```

kita sebenarnya meminta shell untuk:

1. membaca teks command;
2. memecahnya menjadi command name dan argument;
3. mencari executable bernama `ls`;
4. membuat proses baru;
5. mengirim argument `-lah` dan `/tmp` ke proses tersebut;
6. menghubungkan stream input/output/error;
7. menunggu proses selesai;
8. menyimpan exit status.

Dalam Java, kira-kira analoginya bukan seperti memanggil method biasa:

```java
listFiles("/tmp");
```

Melainkan lebih dekat ke:

```java
ProcessBuilder pb = new ProcessBuilder("ls", "-lah", "/tmp");
Process p = pb.start();
int exitCode = p.waitFor();
```

Perbedaannya sangat penting.

Function call dalam Java:

- berjalan dalam proses yang sama;
- berbagi heap;
- menggunakan exception untuk failure;
- punya type system;
- punya stack trace;
- bisa memanggil object/method secara langsung.

Command execution dalam shell:

- biasanya membuat proses baru;
- tidak berbagi memory dengan parent;
- komunikasi lewat argument, stream, file, socket, environment, exit code;
- failure direpresentasikan sebagai exit code;
- data sering berupa byte/text stream;
- shell melakukan parsing sebelum program menerima argument.

Inilah sebabnya scripting harus dipahami sebagai **inter-process orchestration**.

---

## 2. Proses: Unit Eksekusi Fundamental

### 2.1 Apa itu proses?

Proses adalah instance program yang sedang berjalan.

Satu executable bisa punya banyak proses. Misalnya:

```bash
java -jar app.jar
java -jar worker.jar
java -jar scheduler.jar
```

Semua mungkin menggunakan executable `java`, tetapi masing-masing adalah proses berbeda dengan:

- PID berbeda;
- argument berbeda;
- environment berbeda;
- working directory berbeda;
- file descriptor berbeda;
- lifecycle berbeda.

Contoh melihat proses:

```bash
ps -ef | grep java
```

Contoh lebih aman agar tidak menangkap proses `grep` itu sendiri:

```bash
ps -ef | grep '[j]ava'
```

Namun untuk production script, parsing `ps` sering rapuh. Lebih baik gunakan mekanisme pid file, service manager, container runtime, atau API yang tepat bila tersedia.

---

### 2.2 Parent dan child process

Ketika shell menjalankan command eksternal, biasanya shell membuat child process.

Contoh:

```bash
echo $$
bash -c 'echo "child pid: $$"'
```

`$$` di shell menunjukkan PID shell saat ini. Command `bash -c ...` membuat shell baru sebagai child.

Mental model:

```text
interactive shell
└── child process: bash -c '...'
```

Child process mewarisi beberapa state dari parent, terutama:

- environment variables;
- current working directory awal;
- file descriptors;
- signal dispositions tertentu;
- resource limits tertentu.

Tetapi child tidak bisa mengubah state parent secara langsung.

Ini sangat penting.

---

### 2.3 Child process tidak bisa mengubah current shell

Perhatikan:

```bash
pwd
bash -c 'cd /tmp; pwd'
pwd
```

Output kira-kira:

```text
/home/user/project
/tmp
/home/user/project
```

Kenapa `pwd` terakhir tidak berubah ke `/tmp`?

Karena `cd /tmp` terjadi di child shell. Setelah child selesai, parent shell tetap berada di directory lama.

Ini juga menjelaskan kenapa script tidak bisa begitu saja mengubah directory terminal pemanggil, kecuali script di-source.

Contoh:

```bash
./change-dir.sh
```

tidak mengubah directory shell pemanggil.

Sedangkan:

```bash
source ./change-dir.sh
```

atau:

```bash
. ./change-dir.sh
```

menjalankan isi script di current shell, sehingga bisa mengubah state current shell.

Perbedaan ini akan sangat penting ketika kita membahas:

- environment bootstrap;
- activation script;
- virtual environment;
- SDK manager;
- shell profile;
- script library;
- trap;
- subshell.

---

## 3. Program, Command, Builtin, Function, Alias

Tidak semua yang kita ketik di shell adalah executable file.

Misalnya:

```bash
cd /tmp
echo hello
ls
type cd
type echo
type ls
```

Kemungkinan output:

```text
cd is a shell builtin
echo is a shell builtin
ls is /usr/bin/ls
```

Shell command bisa berupa:

1. **alias**
2. **keyword**
3. **function**
4. **builtin**
5. **external executable**

Urutan resolusi bergantung shell, tetapi Bash umumnya punya mekanisme lookup melalui alias, reserved word, function, builtin, lalu PATH executable.

Cek command:

```bash
type command_name
command -V command_name
```

Contoh:

```bash
type cd
type test
type [
type echo
type printf
type grep
```

Mengapa penting?

Karena perilaku command bisa berbeda tergantung apakah yang dijalankan adalah builtin atau executable eksternal.

Contoh `echo` sering tidak konsisten antar shell untuk escape sequence. Untuk output yang lebih predictable, gunakan `printf`.

Kurang ideal:

```bash
echo "name=$name"
```

Lebih predictable:

```bash
printf 'name=%s\n' "$name"
```

---

## 4. Argument: Shell Tidak Mengirim “String Command” ke Program

Ketika kita menulis:

```bash
grep -i "error message" app.log
```

Program `grep` tidak menerima satu string:

```text
grep -i "error message" app.log
```

Ia menerima array argument kira-kira seperti:

```text
argv[0] = grep
argv[1] = -i
argv[2] = error message
argv[3] = app.log
```

Quote diproses oleh shell. Quote tidak dikirim ke program sebagai karakter biasa.

Ini sangat penting.

Contoh:

```bash
printf '<%s>\n' "hello world"
```

Output:

```text
<hello world>
```

Satu argument.

Sedangkan:

```bash
printf '<%s>\n' hello world
```

Output:

```text
<hello>
<world>
```

Dua argument.

Bug scripting sering muncul karena engineer berpikir variable yang berisi spasi tetap satu argument.

Contoh buruk:

```bash
file="my report.txt"
cat $file
```

Shell melakukan word splitting, sehingga menjadi:

```text
cat my report.txt
```

Tiga argument.

Benar:

```bash
file="my report.txt"
cat "$file"
```

Satu argument.

Prinsip awal yang harus diingat:

> Di shell, data string yang tidak di-quote bisa berubah menjadi banyak argument.

Nanti di Part 002 kita akan masuk sangat detail ke parsing, expansion, word splitting, globbing, dan quoting.

---

## 5. Standard Streams: stdin, stdout, stderr

Setiap proses Unix-like umumnya punya tiga stream standar:

| File Descriptor | Nama | Fungsi |
|---:|---|---|
| 0 | stdin | input utama |
| 1 | stdout | output normal |
| 2 | stderr | output error/diagnostic |

Contoh:

```bash
echo "normal output"
```

`echo` menulis ke stdout.

Contoh stderr:

```bash
ls /path/yang/tidak/ada
```

Pesan error ditulis ke stderr.

Mengapa dipisahkan?

Karena output data dan output diagnostic punya tujuan berbeda.

Misalnya:

```bash
some-command > result.txt
```

Ini hanya mengarahkan stdout ke file. Stderr tetap tampil di terminal.

Jika stderr juga diarahkan:

```bash
some-command > result.txt 2> error.log
```

stdout masuk `result.txt`, stderr masuk `error.log`.

Gabungkan stderr ke stdout:

```bash
some-command > combined.log 2>&1
```

Atau Bash modern:

```bash
some-command &> combined.log
```

Namun untuk portability POSIX, gunakan:

```bash
some-command > combined.log 2>&1
```

Urutan redirection penting.

Ini:

```bash
some-command > combined.log 2>&1
```

berarti:

1. stdout diarahkan ke `combined.log`;
2. stderr diarahkan ke tempat stdout saat ini, yaitu `combined.log`.

Sedangkan:

```bash
some-command 2>&1 > combined.log
```

berarti:

1. stderr diarahkan ke tempat stdout saat ini, biasanya terminal;
2. stdout kemudian diarahkan ke `combined.log`.

Akibatnya stderr tetap ke terminal.

---

## 6. Stream sebagai Interface Antar Proses

Pipeline:

```bash
cat app.log | grep ERROR | sort | uniq -c
```

Secara mental:

```text
cat stdout ──> grep stdin
grep stdout ──> sort stdin
sort stdout ──> uniq stdin
```

Pipeline menghubungkan stdout command kiri ke stdin command kanan.

Namun ada beberapa hal penting:

1. Pipeline hanya mengalirkan stdout secara default.
2. Stderr tidak masuk pipeline kecuali diarahkan.
3. Setiap command dalam pipeline biasanya berjalan sebagai proses/subshell terpisah.
4. Exit status pipeline default biasanya exit status command terakhir, kecuali `pipefail` diaktifkan di Bash.
5. Pipeline bekerja dengan byte/text stream, bukan object typed seperti Java Stream API.

Contoh:

```bash
false | true
echo $?
```

Di Bash default, output exit status:

```text
0
```

Karena command terakhir `true` berhasil.

Dengan `pipefail`:

```bash
set -o pipefail
false | true
echo $?
```

Output:

```text
1
```

Inilah kenapa script CI bisa salah menganggap pipeline berhasil.

Contoh buruk:

```bash
generate-report | upload-report
```

Jika `generate-report` gagal tetapi `upload-report` tetap exit 0, pipeline bisa dianggap berhasil tanpa `pipefail`.

Lebih aman:

```bash
set -o pipefail
generate-report | upload-report
```

Atau eksplisit memeriksa masing-masing tahap bila critical.

---

## 7. Exit Code: Contract Failure Paling Dasar

Di shell, command menandakan sukses/gagal lewat exit status.

Konvensi umum:

- `0` berarti sukses;
- non-zero berarti gagal;
- nilai spesifik bisa punya arti tertentu tergantung program.

Contoh:

```bash
grep "ERROR" app.log
echo $?
```

`grep` punya semantic exit status khusus:

- `0`: match ditemukan;
- `1`: match tidak ditemukan;
- `2`: error terjadi.

Ini penting karena `1` tidak selalu “fatal error”. Dalam konteks `grep`, `1` bisa berarti kondisi bisnis: tidak ada match.

Contoh:

```bash
if grep -q "ERROR" app.log; then
  echo "error found"
else
  echo "no error found or grep failed"
fi
```

Kode di atas mencampur “tidak ada match” dan “grep gagal membaca file”.

Lebih teliti:

```bash
if grep -q "ERROR" app.log; then
  echo "error found"
else
  status=$?
  if [ "$status" -eq 1 ]; then
    echo "no error found"
  else
    echo "grep failed with status $status" >&2
    exit "$status"
  fi
fi
```

Pelajaran:

> Exit code adalah API. Jangan mengasumsikan semua non-zero punya arti yang sama.

Dalam automation production, kita perlu memahami exit code dari command yang kita panggil.

---

## 8. Conditional Execution: `&&`, `||`, `if`

Shell punya operator eksekusi berbasis exit status.

### 8.1 `&&`

```bash
mvn test && echo "tests passed"
```

Command kanan hanya berjalan jika command kiri exit 0.

### 8.2 `||`

```bash
mvn test || echo "tests failed"
```

Command kanan hanya berjalan jika command kiri non-zero.

### 8.3 Kombinasi yang sering disalahpahami

Banyak orang menulis pseudo ternary:

```bash
command && success || failure
```

Ini tidak selalu sama dengan:

```text
if command then success else failure
```

Karena jika `success` gagal, `failure` juga akan dijalankan.

Contoh:

```bash
true && false || echo "failure"
```

Output:

```text
failure
```

Padahal command pertama sukses. Yang gagal adalah command tengah.

Lebih jelas:

```bash
if command; then
  success
else
  failure
fi
```

Untuk script yang harus mudah direview, `if` sering lebih baik daripada chaining kompleks.

---

## 9. Environment Variable vs Shell Variable

Ini salah satu sumber kebingungan besar.

Shell variable:

```bash
name="alice"
```

Environment variable:

```bash
export name="alice"
```

Child process hanya menerima variable yang di-export ke environment.

Contoh:

```bash
name="alice"
bash -c 'echo "$name"'
```

Output kosong.

Sedangkan:

```bash
export name="alice"
bash -c 'echo "$name"'
```

Output:

```text
alice
```

Atau one-shot environment untuk command tertentu:

```bash
APP_ENV=dev java -jar app.jar
```

Variable `APP_ENV` diberikan ke proses `java`, tanpa harus mengubah environment shell secara permanen.

Penting:

```bash
APP_ENV=dev
java -jar app.jar
```

Jika tidak `export`, Java process tidak menerima `APP_ENV`.

Benar:

```bash
export APP_ENV=dev
java -jar app.jar
```

atau:

```bash
APP_ENV=dev java -jar app.jar
```

---

## 10. Environment sebagai API

Environment variable sering dipakai sebagai configuration channel untuk automation.

Contoh:

```bash
APP_ENV=staging
DATABASE_URL=...
JAVA_OPTS=...
CI=true
```

Namun environment variable punya risiko:

- tidak typed;
- mudah tertimpa;
- tidak terlihat dalam code path;
- bisa bocor ke child process;
- bisa muncul di debug log;
- bisa berbeda antara terminal, IDE, CI, cron, systemd, container;
- nama variable bisa bentrok.

Untuk script production-grade, environment perlu diperlakukan sebagai API.

Artinya script harus:

1. mendefinisikan variable apa yang dibutuhkan;
2. memvalidasi variable di awal;
3. membedakan required dan optional;
4. memberi default yang jelas;
5. tidak diam-diam memakai environment global tanpa kontrak;
6. tidak mencetak secret;
7. memberi pesan error yang actionable.

Contoh buruk:

```bash
curl -H "Authorization: Bearer $TOKEN" "$API_URL/deploy"
```

Jika `TOKEN` kosong, request tetap dikirim dengan auth kosong.

Lebih baik:

```bash
: "${API_URL:?API_URL is required}"
: "${TOKEN:?TOKEN is required}"

curl -H "Authorization: Bearer $TOKEN" "$API_URL/deploy"
```

Namun syntax `:?` akan dibahas lebih dalam di Part 004 dan 005.

---

## 11. Working Directory adalah Hidden State

Command relatif bergantung pada current working directory.

Contoh:

```bash
cat config/app.yml
```

Ini hanya benar bila script dijalankan dari root project.

Jika dijalankan dari directory lain:

```bash
cd /tmp
/path/to/project/scripts/run.sh
```

maka `config/app.yml` mungkin tidak ditemukan.

Script yang robust biasanya menentukan root directory sendiri.

Contoh Bash:

```bash
#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"

config_file="$project_root/config/app.yml"

printf 'Using config: %s\n' "$config_file"
```

Namun ada nuance:

- `${BASH_SOURCE[0]}` Bash-specific;
- tidak portable ke POSIX sh;
- symlink resolution punya kompleksitas tambahan;
- `pwd` bisa logical atau physical tergantung `-L`/`-P`.

Pada tahap ini, cukup ingat:

> Jangan diam-diam mengasumsikan script selalu dijalankan dari directory tertentu.

Makefile juga punya working directory semantics sendiri. Biasanya `make` berjalan dari directory tempat `Makefile` berada atau dari current directory pemanggil, tergantung cara dipanggil.

---

## 12. PATH Lookup: Command Mana yang Sebenarnya Berjalan?

Ketika kita mengetik:

```bash
java -version
```

shell mencari executable `java` melalui variable `PATH`.

Cek:

```bash
echo "$PATH"
command -v java
type java
```

Masalah umum:

- laptop memakai Java 21, CI memakai Java 17;
- `mvn` dari SDKMAN berbeda dari system `mvn`;
- `docker` tidak tersedia di runner;
- `kubectl` versi berbeda;
- script menjalankan command palsu karena PATH hijacking;
- alias/function lokal membuat behavior berbeda dari CI.

Untuk automation serius, validasi command di awal.

Contoh:

```bash
require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'ERROR: required command not found: %s\n' "$1" >&2
    exit 127
  }
}

require_cmd java
require_cmd mvn
require_cmd docker
```

Exit code `127` lazim untuk command not found.

Namun jangan berlebihan juga. Untuk command yang hanya dipakai pada branch tertentu, validasi bisa dilakukan dekat lokasi pemakaian agar tidak memblokir mode lain.

---

## 13. File Descriptor: Lebih dari stdin/stdout/stderr

File descriptor adalah handle numerik ke resource I/O.

Standar:

```text
0 stdin
1 stdout
2 stderr
```

Kita bisa membuka FD tambahan.

Contoh log ke file descriptor 3:

```bash
exec 3>debug.log

printf 'normal output\n'
printf 'debug message\n' >&3

exec 3>&-
```

Kenapa ini berguna?

- memisahkan machine-readable stdout dari human-readable log;
- membuat script bisa mengembalikan data via stdout tanpa tercampur log;
- mengirim diagnostic ke stderr;
- mengelola lock file atau pipe;
- advanced redirection.

Prinsip penting untuk CLI internal:

> stdout idealnya untuk output data yang bisa dipipe. stderr untuk log, warning, progress, dan diagnostic.

Contoh baik:

```bash
get_version() {
  printf 'Reading version file...\n' >&2
  cat VERSION
}
```

Pemanggil bisa melakukan:

```bash
version="$(get_version)"
```

Tanpa `version` tercampur pesan log.

---

## 14. Subshell: State yang Hilang Setelah Block Selesai

Subshell adalah shell child yang menjalankan sebagian command.

Contoh:

```bash
pwd
(
  cd /tmp
  pwd
)
pwd
```

Output:

```text
/home/user/project
/tmp
/home/user/project
```

Parent tidak berubah.

Subshell berguna untuk membatasi side effect.

Contoh:

```bash
(
  cd "$project_root"
  mvn test
)
```

Setelah block selesai, working directory parent tetap.

Namun subshell juga bisa membuat variable assignment hilang.

Contoh umum:

```bash
count=0

printf '%s\n' a b c | while read -r line; do
  count=$((count + 1))
done

echo "$count"
```

Di banyak shell, `while` dalam pipeline berjalan di subshell. Akibatnya `count` tetap 0 di parent.

Solusi Bash dengan process substitution:

```bash
count=0

while read -r line; do
  count=$((count + 1))
done < <(printf '%s\n' a b c)

echo "$count"
```

Ini Bash-specific.

Alternatif POSIX sering memakai temporary file atau redirection dari file.

Pelajaran:

> Jangan mengubah state parent dari dalam pipeline kalau portability penting.

---

## 15. Current Shell vs Executed Script vs Sourced Script

Ada tiga mode penting:

### 15.1 Menjalankan executable script

```bash
./script.sh
```

Script berjalan sebagai proses shell baru.

Efek:

- variable tidak bocor ke parent;
- `cd` tidak mengubah parent;
- `exit` hanya mengakhiri script process;
- cocok untuk command/tool biasa.

### 15.2 Sourcing script

```bash
source script.sh
```

atau POSIX:

```bash
. script.sh
```

Script berjalan di current shell.

Efek:

- variable bisa mengubah current shell;
- function bisa didefinisikan di current shell;
- `cd` mengubah current shell;
- `exit` bisa menutup terminal/session jika tidak hati-hati.

Cocok untuk:

- environment activation;
- shell profile;
- library function;
- completion script.

Tidak cocok untuk arbitrary operational script yang bisa gagal destruktif.

### 15.3 Menjalankan command dalam subshell

```bash
(
  cd /tmp
  do_something
)
```

Efek dibatasi ke subshell.

Cocok untuk isolasi working directory atau temporary state.

---

## 16. Script Boundary: Input, Output, Side Effect

Sebuah script yang baik punya boundary yang jelas.

Pertanyaan desain:

1. Input script dari mana?
   - argument?
   - environment?
   - config file?
   - stdin?
   - current directory?
   - network?
   - file system?

2. Output script ke mana?
   - stdout?
   - stderr?
   - file?
   - network API?
   - database?
   - exit code?

3. Side effect apa?
   - membuat file?
   - menghapus file?
   - deploy?
   - mengubah config?
   - membuat tag?
   - mengirim request?
   - mengubah permission?

4. Failure mode apa?
   - command dependency hilang?
   - permission denied?
   - timeout?
   - partial write?
   - invalid input?
   - network error?
   - concurrent execution?

Untuk Java engineer, anggap script sebagai public method atau API endpoint.

Contoh function Java yang baik:

```java
DeploymentPlan plan = planner.createPlan(input);
```

Ia punya input/output jelas.

Script yang baik juga begitu:

```bash
./deploy.sh --env staging --version 1.2.3 --dry-run
```

Kontraknya harus jelas:

- env apa yang valid;
- version format apa;
- dry-run benar-benar tidak mengubah state;
- exit code apa jika deploy gagal;
- log di mana;
- artifact apa yang dihasilkan.

---

## 17. Shell State yang Sering Tersembunyi

Script sering gagal karena hidden state.

Contoh hidden state:

| Hidden State | Contoh Failure |
|---|---|
| Current directory | relative path salah |
| PATH | command berbeda |
| Environment | variable tidak ada di CI |
| Locale | sort/parsing berbeda |
| Timezone | timestamp berbeda |
| Umask | permission file berbeda |
| Shell option | globbing/errexit berbeda |
| Aliases/functions | command override |
| Installed tools | versi command beda |
| Network context | VPN/proxy/DNS beda |
| Credentials | token ada di laptop, tidak ada di runner |
| File permissions | executable bit hilang |
| Line endings | CRLF script gagal di Linux |
| Encoding | UTF-8 vs legacy encoding |
| TTY availability | command interaktif gagal di CI |

Top 1% scripting engineer tidak hanya tahu syntax. Mereka tahu hidden state mana yang bisa membuat automation tidak reproducible.

---

## 18. TTY vs Non-TTY: Interactive Assumptions

Terminal interaktif menyediakan TTY. CI pipeline biasanya non-interactive.

Cek:

```bash
if [ -t 1 ]; then
  echo "stdout is a terminal"
else
  echo "stdout is not a terminal"
fi
```

Command tertentu berubah behavior jika stdout adalah TTY:

- progress bar aktif/nonaktif;
- warna aktif/nonaktif;
- prompt interaktif muncul;
- paging dengan `less`;
- password prompt;
- line buffering berbeda.

Masalah umum:

```bash
docker login
```

atau:

```bash
read -p "Deploy to production? " answer
```

Bisa hang di CI jika tidak ada TTY.

Script production harus jelas:

- mode interaktif boleh prompt;
- mode CI harus non-interactive;
- confirmation harus eksplisit;
- destructive command tidak boleh diam-diam berjalan karena prompt dilewati.

Contoh guard:

```bash
if [ "${CI:-false}" = "true" ]; then
  non_interactive=true
else
  non_interactive=false
fi
```

Namun jangan hanya bergantung pada `CI`; beberapa environment tidak mengatur variable itu.

---

## 19. Local vs CI vs Production: Lingkungan Berbeda, Kontrak Harus Sama

Script yang baik mengurangi gap antara:

- laptop developer;
- IDE terminal;
- local Docker environment;
- CI runner;
- build agent;
- staging host;
- production host.

Tetapi kita tidak bisa menghapus semua perbedaan. Yang bisa dilakukan adalah membuat **kontrak eksplisit**.

Contoh kontrak:

```text
Required tools:
- bash >= 4
- java >= 21
- mvn >= 3.9
- docker available for image build target

Required env:
- APP_ENV
- ARTIFACT_REPOSITORY_URL
- RELEASE_TOKEN only for release target

Outputs:
- target/app.jar
- build/reports/tests
- Docker image tag

Exit codes:
- 0 success
- 2 invalid usage
- 10 missing dependency
- 20 test failure
- 30 publish failure
```

Semakin penting script, semakin penting kontraknya.

---

## 20. Command Composition: Sequential, Conditional, Pipeline, Parallel

Ada beberapa bentuk composition dasar.

### 20.1 Sequential

```bash
command1
command2
command3
```

Command berjalan berurutan. Tanpa strict mode atau explicit check, command berikut tetap berjalan walaupun command sebelumnya gagal.

### 20.2 Conditional

```bash
command1 && command2
```

`command2` hanya berjalan kalau `command1` sukses.

```bash
command1 || command2
```

`command2` hanya berjalan kalau `command1` gagal.

### 20.3 Pipeline

```bash
command1 | command2 | command3
```

Data stdout mengalir kiri ke kanan.

### 20.4 Background

```bash
command1 &
pid=$!
wait "$pid"
```

Command berjalan di background. Parent bisa melakukan hal lain, lalu menunggu.

### 20.5 Subshell Group

```bash
(
  command1
  command2
)
```

State mutation dibatasi ke subshell.

### 20.6 Current Shell Group

```bash
{
  command1
  command2
}
```

Group berjalan di current shell. Perhatikan spasi dan semicolon/newline:

```bash
{ echo one; echo two; }
```

Group berguna untuk redirection bersama:

```bash
{
  echo "line one"
  echo "line two"
} > output.txt
```

---

## 21. Exit Status dari Group dan Subshell

Group atau subshell mengembalikan exit status command terakhir.

Contoh:

```bash
{
  false
  true
}
echo $?
```

Output:

```text
0
```

Karena command terakhir `true`.

Dengan `set -e`, perilakunya punya nuance yang akan dibahas di Part 005.

Untuk script yang critical, jangan mengandalkan “command terakhir” secara tidak sengaja.

Lebih eksplisit:

```bash
{
  step1
  step2
  step3
}
```

Jika semua step wajib sukses, gunakan fail-fast mode dengan pemahaman yang benar atau cek eksplisit:

```bash
step1 || exit $?
step2 || exit $?
step3 || exit $?
```

Namun pattern ini juga bisa dibuat lebih rapi dengan function `run`.

---

## 22. Exit Code Script Kita Sendiri

Script sebaiknya mengembalikan exit code bermakna.

Contoh:

```bash
#!/usr/bin/env bash

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <env>" >&2
  exit 2
fi

env="$1"

case "$env" in
  dev|staging|prod)
    ;;
  *)
    echo "invalid env: $env" >&2
    exit 2
    ;;
esac

echo "deploying to $env"
```

Konvensi umum:

- `0`: success
- `1`: generic failure
- `2`: usage error
- `126`: command found but not executable
- `127`: command not found
- `130`: terminated by Ctrl+C/SIGINT

Jangan terlalu banyak membuat taxonomy exit code kalau tidak ada consumer yang memakainya. Untuk internal tooling, kategori sederhana cukup:

- usage/config error;
- dependency error;
- validation failure;
- operation failure;
- interrupted.

---

## 23. Signals: Proses Bisa Dihentikan dari Luar

Process tidak hanya selesai secara normal. Ia bisa menerima signal.

Contoh umum:

- `SIGINT`: Ctrl+C;
- `SIGTERM`: permintaan terminate;
- `SIGKILL`: paksa kill, tidak bisa ditangkap;
- `SIGHUP`: terminal/session closed;
- `SIGPIPE`: menulis ke pipe yang sudah ditutup.

Signal penting untuk cleanup.

Contoh:

```bash
tmp_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_dir"
}

trap cleanup EXIT INT TERM

# work with "$tmp_dir"
```

`trap` akan dibahas detail di Part 005 dan Part 008.

Untuk sekarang, pahami:

> Script production harus memikirkan apa yang terjadi jika dihentikan di tengah jalan.

Jika script sedang menulis file lalu dihentikan, apakah file partial tersisa? Jika sedang deploy, apakah state setengah berubah? Jika sedang memegang lock, apakah lock dilepas?

---

## 24. Race Condition dalam Script

Banyak orang menganggap script kecil tidak punya concurrency bug. Salah.

Contoh buruk:

```bash
if [ ! -f output.txt ]; then
  generate > output.txt
fi
```

Jika dua process menjalankan script bersamaan:

1. process A cek file belum ada;
2. process B cek file belum ada;
3. A generate;
4. B generate juga;
5. output bisa tertimpa atau corrupt.

Solusi tergantung konteks:

- lock file;
- atomic write;
- unique temp file;
- idempotent operation;
- database/service-side guard;
- `mkdir` sebagai atomic lock sederhana;
- `flock` bila tersedia.

Contoh atomic-ish write:

```bash
tmp_file="$(mktemp)"
generate > "$tmp_file"
mv "$tmp_file" output.txt
```

`mv` dalam filesystem yang sama biasanya atomic untuk rename.

Namun ini tidak menyelesaikan semua race. Untuk concurrent writers, tetap perlu locking atau compare-and-swap style.

---

## 25. Shell Script sebagai Distributed System Kecil

Ini terdengar berlebihan, tetapi berguna sebagai mental model.

Script sering berinteraksi dengan:

- filesystem;
- network API;
- container runtime;
- package registry;
- build cache;
- CI runner;
- cloud service;
- database migration tool;
- deployment orchestrator;
- human operator.

Masing-masing bisa gagal sebagian.

Distributed system punya masalah:

- retry;
- timeout;
- partial failure;
- idempotency;
- ordering;
- consistency;
- visibility;
- cancellation;
- duplicate execution.

Automation script juga punya masalah yang sama, hanya skalanya lebih kecil.

Contoh:

```bash
create_release
upload_artifact
notify_slack
```

Jika `notify_slack` gagal, apakah release gagal? Jika `upload_artifact` sukses tapi script exit karena network error setelah upload, apakah retry akan upload duplicate? Jika `create_release` dipanggil dua kali, apakah idempotent?

Top engineer akan bertanya seperti itu sebelum menulis command.

---

## 26. Designing Script Invariants

Invariant adalah hal yang harus selalu benar.

Contoh invariant untuk script build:

```text
Jika exit 0:
- semua test wajib sudah sukses;
- artifact dibuat di path yang terdokumentasi;
- version artifact sesuai input;
- tidak ada secret dicetak ke stdout/stderr;
- working tree tidak dimodifikasi kecuali target explicit.
```

Contoh invariant untuk script deploy:

```text
Jika exit 0:
- versi yang diminta sudah tersedia;
- target environment tervalidasi;
- deployment request diterima orchestrator;
- smoke test minimal sukses;
- log mencantumkan deployment id;
- tidak ada credential bocor.
```

Contoh invariant untuk script cleanup:

```text
Script tidak boleh menghapus path di luar project root.
Script tidak boleh menghapus jika variable target kosong.
Script harus mendukung dry-run.
```

Invariant membuat script bisa direview secara engineering, bukan sekadar dibaca sebagai command sequence.

---

## 27. Practical Example: Dari Fragile Script ke Robust Script

Misalnya ada script:

```bash
#!/bin/bash

cd ..
rm -rf build
mvn test
mvn package
docker build -t myapp .
```

Masalah:

1. `cd ..` mengasumsikan lokasi pemanggil.
2. `rm -rf build` destruktif tanpa guard.
3. Jika `mvn test` gagal, script mungkin tetap lanjut tergantung shell options.
4. Tidak memvalidasi `mvn` dan `docker`.
5. Tag image hardcoded.
6. Tidak ada error message jelas.
7. Tidak ada output contract.
8. Tidak ada working directory yang eksplisit.
9. Tidak ada mode CI/local distinction.
10. Tidak ada cleanup atau trap.

Versi lebih baik:

```bash
#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"

image_tag="${IMAGE_TAG:-myapp:local}"

require_cmd mvn
require_cmd docker

case "$image_tag" in
  *[[:space:]]*)
    die "IMAGE_TAG must not contain whitespace: $image_tag"
    ;;
esac

cd "$project_root"

if [ ! -f "pom.xml" ]; then
  die "pom.xml not found at project root: $project_root"
fi

printf 'Project root: %s\n' "$project_root" >&2
printf 'Image tag: %s\n' "$image_tag" >&2

rm -rf "$project_root/build"

mvn test
mvn package

docker build -t "$image_tag" .

printf 'Build complete: %s\n' "$image_tag"
```

Masih belum sempurna, tetapi jauh lebih baik.

Perhatikan beberapa prinsip:

- resolve project root;
- quote variable;
- validate command dependency;
- fail fast;
- log ke stderr;
- output final machine-readable bisa tetap ke stdout;
- gunakan env sebagai input dengan default;
- guard path penting.

Di part berikutnya, kita akan membedah kenapa quoting dan expansion adalah pusat correctness.

---

## 28. Mapping ke Java Engineer Mental Model

Agar lebih intuitif, berikut mapping sederhana.

| Shell Concept | Java/Backend Analogy |
|---|---|
| Command | External service call / process call |
| Argument | Method parameter / request field |
| Exit code | Status code / result enum |
| stdout | Response body / data stream |
| stderr | Log/diagnostic stream |
| Environment | Process-level config |
| Working directory | Implicit context |
| PATH | Dependency resolver |
| Pipeline | Stream processing across processes |
| File | Persistent/shared state |
| Signal | Cancellation/interruption |
| Trap | finally/cleanup hook |
| Subshell | Isolated execution context |
| Make target | Named workflow / dependency node |
| Script | CLI API / automation endpoint |

Namun analogi punya batas.

Shell tidak punya type system kuat. Shell parsing terjadi sebelum command menerima argument. Failure handling tidak seperti exception. Banyak state tersembunyi. Karena itu shell butuh disiplin lebih besar, bukan lebih kecil.

---

## 29. Checklist Mental Model Part 001

Setelah part ini, kamu harus bisa menjawab:

- Apa bedanya command execution dengan function call?
- Apa yang diwariskan parent process ke child process?
- Kenapa child process tidak bisa mengubah current shell?
- Apa bedanya shell variable dan environment variable?
- Apa itu stdin/stdout/stderr?
- Kenapa stderr sebaiknya dipisah dari stdout?
- Bagaimana pipeline menghubungkan proses?
- Kenapa exit status pipeline bisa menipu?
- Apa bedanya menjalankan script dan source script?
- Apa itu subshell dan kapan berguna?
- Kenapa working directory adalah hidden state?
- Bagaimana PATH bisa menyebabkan command berbeda berjalan?
- Apa risiko TTY vs non-TTY?
- Kenapa script harus punya input/output/side effect contract?
- Hidden state apa saja yang membuat script tidak reproducible?
- Apa invariant yang harus dijaga oleh script build/deploy/cleanup?

Jika jawaban atas pertanyaan ini sudah nyaman, syntax Bash/PowerShell/Makefile akan jauh lebih masuk akal.

---

## 30. Common Anti-Patterns

### 30.1 Menganggap shell script sama seperti list command manual

Buruk:

```bash
cd project
mvn test
docker build -t app .
```

Lebih baik: script mendefinisikan root, dependency, error behavior, input, output, dan failure mode.

---

### 30.2 Mencampur data output dan log

Buruk:

```bash
echo "Reading version..."
cat VERSION
```

Jika dipakai:

```bash
version="$(./version.sh)"
```

Maka variable berisi log juga.

Lebih baik:

```bash
echo "Reading version..." >&2
cat VERSION
```

---

### 30.3 Mengandalkan current directory

Buruk:

```bash
cat config.yml
```

Lebih baik:

```bash
cat "$project_root/config.yml"
```

---

### 30.4 Tidak memahami exit code command

Buruk:

```bash
grep -q pattern file || exit 1
```

Ini menyamakan “tidak ada match” dengan “grep error”.

---

### 30.5 Menggunakan environment tanpa validasi

Buruk:

```bash
deploy "$APP_ENV" "$TOKEN"
```

Lebih baik:

```bash
: "${APP_ENV:?APP_ENV is required}"
: "${TOKEN:?TOKEN is required}"
deploy "$APP_ENV" "$TOKEN"
```

---

### 30.6 Menggunakan pipeline critical tanpa `pipefail`

Buruk:

```bash
generate | upload
```

Lebih baik di Bash:

```bash
set -o pipefail
generate | upload
```

---

### 30.7 Mengasumsikan interaktif di CI

Buruk:

```bash
read -p "Deploy? " answer
```

Lebih baik: gunakan explicit flag, approval step CI, atau `--yes` yang tervalidasi.

---

## 31. Mini Lab

Lab ini bisa dijalankan di Linux/macOS/Git Bash/WSL dengan Bash.

### Lab 1 — Parent vs Child

Buat file:

```bash
cat > child-state.sh <<'EOF'
#!/usr/bin/env bash
cd /tmp
export CHILD_ONLY=hello
echo "inside script pwd: $(pwd)"
EOF

chmod +x child-state.sh
```

Jalankan:

```bash
pwd
./child-state.sh
pwd
echo "${CHILD_ONLY:-not set}"
```

Amati:

- `pwd` parent tidak berubah;
- `CHILD_ONLY` tidak tersedia di parent.

Sekarang source:

```bash
source ./child-state.sh
pwd
echo "${CHILD_ONLY:-not set}"
```

Amati efeknya.

---

### Lab 2 — stdout vs stderr

Buat:

```bash
cat > streams.sh <<'EOF'
#!/usr/bin/env bash
echo "data output"
echo "diagnostic output" >&2
EOF

chmod +x streams.sh
```

Jalankan:

```bash
./streams.sh > out.txt
cat out.txt
```

Lalu:

```bash
./streams.sh > out.txt 2> err.txt
cat out.txt
cat err.txt
```

Pahami kenapa pemisahan ini penting untuk command substitution:

```bash
value="$(./streams.sh)"
printf 'value=<%s>\n' "$value"
```

---

### Lab 3 — Pipeline Exit Status

Jalankan:

```bash
false | true
echo $?
```

Lalu:

```bash
set -o pipefail
false | true
echo $?
```

Reset shell baru jika perlu.

---

### Lab 4 — Environment Export

Jalankan:

```bash
APP_ENV=dev
bash -c 'echo "APP_ENV=$APP_ENV"'
```

Lalu:

```bash
export APP_ENV=dev
bash -c 'echo "APP_ENV=$APP_ENV"'
```

Lalu one-shot:

```bash
APP_ENV=staging bash -c 'echo "APP_ENV=$APP_ENV"'
echo "parent APP_ENV=$APP_ENV"
```

---

### Lab 5 — PATH Lookup

Jalankan:

```bash
command -v java || true
type java || true
echo "$PATH"
```

Jika punya beberapa versi Java, bandingkan dari terminal berbeda: IDE terminal, system terminal, CI, container.

---

## 32. Design Exercise untuk Java Project

Ambil satu Java service yang kamu punya. Desain script `scripts/verify.sh`.

Jangan langsung coding. Tulis kontraknya dulu.

Contoh:

```text
Name:
  scripts/verify.sh

Purpose:
  Menjalankan semua verification lokal yang harus sama dengan CI.

Inputs:
  - optional env SKIP_INTEGRATION_TESTS=true|false
  - optional env MAVEN_OPTS
  - optional arg --quick

Required tools:
  - bash
  - java
  - mvn

Outputs:
  - stdout: ringkasan hasil akhir
  - stderr: progress/log
  - files: target/ reports dari Maven

Side effects:
  - menjalankan test
  - membuat build artifacts lokal
  - tidak melakukan deploy
  - tidak mengubah file source

Exit:
  - 0 success
  - 2 invalid usage/config
  - 10 missing dependency
  - 20 test/build failure

Invariants:
  - jika exit 0, unit test sukses
  - jika exit 0 dan bukan --quick, integration test sukses
  - tidak mencetak secret
  - bisa dijalankan dari directory mana pun
```

Baru setelah kontrak jelas, tulis script.

Ini membedakan scripting sebagai engineering dari scripting sebagai command dumping.

---

## 33. Part 001 Summary

Shell scripting bukan dimulai dari `for`, `if`, atau `grep`. Ia dimulai dari model eksekusi.

Inti part ini:

1. Shell menjalankan proses, bukan method.
2. Proses berkomunikasi lewat argument, stream, file, environment, dan exit code.
3. stdout dan stderr harus dipisahkan secara sengaja.
4. Exit code adalah contract, bukan sekadar angka.
5. Environment variable harus diperlakukan sebagai API.
6. Working directory dan PATH adalah hidden state.
7. Child process tidak bisa mengubah parent shell.
8. Subshell berguna untuk isolasi, tetapi bisa menghilangkan state yang kamu kira tersimpan.
9. Pipeline punya semantics sendiri dan bisa menyembunyikan failure.
10. Script yang baik punya input/output/side-effect contract dan invariants.

Dengan fondasi ini, kita siap masuk ke Part 002: **Command Execution Semantics: Parsing, Expansion, Quoting**.

---

## 34. Referensi Resmi dan Bacaan Lanjutan

- GNU Bash Reference Manual — shell execution, parameters, redirections, pipelines, exit status.
- POSIX Shell Command Language — baseline portable shell behavior.
- GNU Coreutils Manual — banyak command dasar yang sering dipakai script.
- Microsoft PowerShell Documentation — untuk perbandingan model pipeline object pada bagian PowerShell.
- GNU Make Manual — untuk memahami process/recipe semantics saat masuk Makefile.

---

## 35. Status Seri

Seri belum selesai.

Progress:

- [x] Part 000 — Orientation: Scripting as Engineering Control Plane
- [x] Part 001 — Shell Mental Model: Process, Stream, Exit Code, Environment
- [ ] Part 002 — Command Execution Semantics: Parsing, Expansion, Quoting
- [ ] Part 003 — POSIX Shell Baseline: Portable Script Before Bash-Specific Script
- [ ] Part 004 — Bash Fundamentals Without Toy Examples
- [ ] Part 005 — Error Handling in Bash: Fail Fast, Fail Clear, Fail Safe
- [ ] Part 006 — Data Handling in Bash: Text, Lines, Null Bytes, JSON, CSV
- [ ] Part 007 — Filesystem Automation: Safe File Operations
- [ ] Part 008 — Process Control: Background Jobs, Signals, Timeouts, Concurrency
- [ ] Part 009 — CLI Design for Internal Tools
- [ ] Part 010 — Bash Testing, Linting, Formatting, and Reviewability
- [ ] Part 011 — Security Model for Shell Scripts
- [ ] Part 012 — PowerShell Mental Model: Objects, Pipeline, Providers
- [ ] Part 013 — PowerShell Language Fundamentals for Java Engineers
- [ ] Part 014 — PowerShell Error Handling, Strictness, and Observability
- [ ] Part 015 — PowerShell Data Automation: JSON, XML, CSV, REST, Objects
- [ ] Part 016 — Cross-Platform PowerShell: Windows, Linux, macOS, Containers
- [ ] Part 017 — PowerShell Modules and Reusable Automation Architecture
- [ ] Part 018 — Makefile Mental Model: Dependency Graph, Targets, Recipes
- [ ] Part 019 — Practical Makefile Syntax and Execution Semantics
- [ ] Part 020 — Makefile for Java Projects: Maven, Gradle, Docker, CI Facade
- [ ] Part 021 — Makefile as Workflow Orchestrator, Not Build System Replacement
- [ ] Part 022 — Script Portability Matrix: Bash, POSIX sh, PowerShell, Make, Java
- [ ] Part 023 — Environment Management and Configuration Contracts
- [ ] Part 024 — CI/CD Scripting: From Laptop Command to Pipeline Contract
- [ ] Part 025 — Release and Deployment Automation
- [ ] Part 026 — Operational Scripts: Diagnostics, Runbooks, Incident Tools
- [ ] Part 027 — Advanced Bash and PowerShell Interop
- [ ] Part 028 — Refactoring Legacy Scripts
- [ ] Part 029 — Capstone: Production-Grade Automation Toolkit for a Java Service


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-000.md">⬅️ Part 000 — Orientation: Scripting as Engineering Control Plane</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-002.md">Part 002 — Command Execution Semantics: Parsing, Expansion, Quoting ➡️</a>
</div>

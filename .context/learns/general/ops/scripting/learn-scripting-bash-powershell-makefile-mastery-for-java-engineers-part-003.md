# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-003.md

# Part 003 — POSIX Shell Baseline: Portable Script Before Bash-Specific Script

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: memahami kapan harus menulis script portable `/bin/sh`, kapan boleh memakai Bash, dan bagaimana menghindari asumsi yang membuat automation gagal di container, CI, server minimal, atau sistem operasi berbeda.

---

## 0. Posisi Part Ini dalam Seri

Part 001 membahas model proses, stream, exit code, environment, dan working directory.

Part 002 membedah parsing, expansion, quoting, word splitting, globbing, command substitution, dan argument boundary.

Part 003 membahas pertanyaan arsitektural yang sering disepelekan:

> Script ini harus portable atau boleh bergantung pada Bash?

Banyak engineer menulis:

```bash
#!/bin/sh
set -euo pipefail

arr=(one two three)
[[ "$env" == prod ]]
```

Script seperti ini tampak wajar bagi pengguna Bash, tetapi salah secara portability:

- `pipefail` bukan POSIX shell;
- array `arr=(...)` bukan POSIX shell;
- `[[ ... ]]` bukan POSIX shell;
- `==` di `[ ... ]` tidak portable, gunakan `=`;
- `/bin/sh` belum tentu Bash.

Di banyak sistem:

- Debian/Ubuntu `/bin/sh` biasanya `dash`;
- Alpine Linux `/bin/sh` biasanya BusyBox `ash`;
- macOS punya Bash lama sebagai `/bin/bash`, tetapi `/bin/sh` mode-nya berbeda;
- container minimal sering tidak punya Bash;
- CI runner bisa memakai shell berbeda tergantung image;
- Makefile recipes default memakai `/bin/sh`, bukan Bash.

Part ini membangun decision framework: kapan pakai POSIX sh, kapan Bash, kapan PowerShell, kapan Makefile, dan kapan berhenti menulis shell lalu pakai bahasa lain.

---

## 1. Definisi Kerja: Apa Itu POSIX Shell?

POSIX shell adalah baseline standar shell command language yang ditentukan oleh POSIX. Ia mendefinisikan syntax dan behavior yang diharapkan tersedia di shell kompatibel POSIX.

Secara praktis, POSIX shell adalah target ketika kamu memakai:

```sh
#!/bin/sh
```

Artinya kamu tidak boleh mengasumsikan fitur Bash-specific seperti:

```bash
[[ ... ]]
(( ... ))
function name() { ...; }
local
arrays
associative arrays
${var//a/b}
process substitution <(...)
read -d ''
mapfile/readarray
shopt
coproc
BASH_SOURCE
PIPESTATUS
set -o pipefail
```

Sebagian shell punya fitur ekstra, tetapi jika target kamu adalah POSIX sh, jangan pakai ekstensi itu kecuali kamu sengaja membatasi runtime.

---

## 2. `/bin/sh` Bukan Sinonim Bash

Ini salah satu kesalahan paling mahal.

Command:

```bash
ls -l /bin/sh
```

Mungkin outputnya:

```text
/bin/sh -> dash
```

atau:

```text
/bin/sh -> busybox
```

atau shell lain.

Jika script memakai shebang:

```sh
#!/bin/sh
```

maka ia harus ditulis dalam subset POSIX-compatible.

Jika script membutuhkan Bash, tulis eksplisit:

```bash
#!/usr/bin/env bash
```

atau dalam environment yang sangat terkontrol:

```bash
#!/bin/bash
```

Preferensi umum:

```bash
#!/usr/bin/env bash
```

lebih fleksibel untuk environment di mana Bash berada di lokasi berbeda, tetapi bergantung pada `env`.

Untuk script POSIX:

```sh
#!/bin/sh
```

---

## 3. Kenapa Java Engineer Perlu Peduli POSIX Shell?

Sebagai Java engineer, kamu mungkin berpikir:

> Saya bisa pakai Bash saja. Tim saya pakai Linux.

Realitasnya:

1. Docker image minimal mungkin tidak punya Bash.
2. Makefile recipe default memakai `/bin/sh`.
3. CI platform sering menjalankan command dengan shell default.
4. Kubernetes init container bisa memakai image Alpine/BusyBox.
5. Installer script perlu jalan di banyak sistem.
6. Entrypoint container harus kecil dan predictable.
7. Production host lama mungkin punya Bash versi tua.
8. macOS default Bash-nya sering tertinggal dari Bash modern.
9. Shell script pendek lebih aman jika portable.
10. Tool internal bisa dipakai oleh engineer Windows via Git Bash/WSL dengan variasi behavior.

Portability bukan nilai absolut. Portability adalah trade-off.

Tapi kamu harus memilih secara sadar.

---

## 4. Decision Framework: POSIX sh vs Bash

Gunakan POSIX sh jika:

- script kecil;
- mostly command orchestration;
- harus berjalan di `/bin/sh`;
- dipakai dalam Docker image minimal;
- dipakai sebagai entrypoint;
- dipakai di Makefile recipe;
- dependency harus minimal;
- logic sederhana;
- tidak butuh array;
- tidak butuh complex parsing;
- portability lebih penting dari expressiveness.

Gunakan Bash jika:

- script cukup kompleks;
- butuh array untuk argument boundary;
- butuh `[[ ... ]]`;
- butuh safer command construction;
- butuh `pipefail`;
- butuh associative array;
- butuh process substitution;
- butuh better function ergonomics;
- environment bisa menjamin Bash tersedia;
- script adalah developer tooling internal, bukan bootstrap minimal.

Gunakan PowerShell jika:

- target cross-platform termasuk Windows dengan first-class support;
- automation bekerja dengan object/JSON/.NET/API;
- perlu structured data pipeline;
- tim familiar dengan Windows ecosystem;
- butuh module system yang lebih kuat;
- interaksi dengan Microsoft/cloud/admin tooling dominan.

Gunakan Java/Go/Python/Node jika:

- logic kompleks;
- parsing format data non-trivial;
- perlu testability kuat;
- perlu concurrency kompleks;
- perlu API client robust;
- perlu domain model;
- perlu long-running tool;
- perlu distribusi binary/package;
- correctness lebih penting daripada zero-dependency.

Gunakan Makefile jika:

- kamu butuh workflow facade;
- target punya dependency relationship;
- ingin command standar seperti `make test`, `make build`, `make run`;
- ingin local/CI parity;
- ingin mengorkestrasi command, bukan menulis logic berat.

---

## 5. Portability Matrix

| Kebutuhan | POSIX sh | Bash | PowerShell | Makefile | Java/Go/Python/Node |
|---|---:|---:|---:|---:|---:|
| Minimal dependency | Sangat baik | Sedang | Rendah-sedang | Sedang | Rendah |
| Container minimal | Sangat baik | Tergantung image | Jarang | Tergantung make | Tergantung runtime |
| Complex argument construction | Lemah | Baik | Baik | Lemah | Sangat baik |
| Structured data | Lemah | Lemah-sedang | Baik | Lemah | Sangat baik |
| Cross-platform Windows/Linux | Lemah | Sedang via Git Bash/WSL | Sangat baik | Sedang | Baik |
| CI command wrapper | Baik | Baik | Baik | Sangat baik | Sedang |
| Long-term maintainability logic kompleks | Lemah | Sedang | Sedang-baik | Lemah | Sangat baik |
| Startup speed | Sangat baik | Sangat baik | Sedang | Sangat baik | Bervariasi |
| Build workflow facade | Sedang | Sedang | Sedang | Sangat baik | Sedang |
| Safety untuk dynamic commands | Lemah | Baik via arrays | Baik | Lemah | Sangat baik |

---

## 6. Shebang sebagai Contract

Shebang bukan dekorasi. Ia contract runtime.

```sh
#!/bin/sh
```

berarti:

> Script ini bisa dijalankan oleh POSIX-compatible sh.

```bash
#!/usr/bin/env bash
```

berarti:

> Script ini membutuhkan Bash di PATH.

```pwsh
#!/usr/bin/env pwsh
```

berarti:

> Script ini membutuhkan PowerShell Core/modern cross-platform.

Masalah umum:

```sh
#!/bin/sh
set -euo pipefail
```

`pipefail` bukan POSIX. Di `dash`:

```text
set: Illegal option -o pipefail
```

Masalah lain:

```sh
#!/bin/sh
source ./env.sh
```

`source` bukan POSIX. POSIX memakai:

```sh
. ./env.sh
```

Masalah lain:

```sh
#!/bin/sh
if [[ "$x" == "yes" ]]; then
  echo yes
fi
```

`[[ ... ]]` bukan POSIX.

Rule:

> Jika kamu memakai fitur Bash, shebang harus Bash. Jika shebang `/bin/sh`, tulis POSIX-compatible.

---

## 7. Shell Feature Comparison: POSIX sh vs Bash

| Feature | POSIX sh | Bash |
|---|---:|---:|
| Variables | Ya | Ya |
| Export env | Ya | Ya |
| Functions | Ya, syntax terbatas | Ya |
| Arrays | Tidak | Ya |
| Associative arrays | Tidak | Ya |
| `[[ ... ]]` | Tidak | Ya |
| `[ ... ]` | Ya | Ya |
| `case` | Ya | Ya |
| `for` loop | Ya | Ya |
| `while read` | Ya | Ya |
| Here-doc | Ya | Ya |
| Here-string `<<<` | Tidak | Ya |
| Process substitution `<(...)` | Tidak | Ya |
| Command substitution `$(...)` | Ya | Ya |
| Arithmetic expansion `$((...))` | Ya | Ya |
| `pipefail` | Tidak | Ya |
| `local` | Tidak standar | Ya |
| `readarray`/`mapfile` | Tidak | Ya |
| `${var//a/b}` | Tidak | Ya |
| `${BASH_SOURCE[0]}` | Tidak | Ya |
| `shopt` | Tidak | Ya |
| `trap` | Ya | Ya |

Catatan: beberapa shell non-Bash memiliki ekstensi mirip Bash, tetapi jangan mengandalkannya untuk POSIX portability.

---

## 8. POSIX-Compatible Function Style

Bash sering ditulis:

```bash
function die() {
  echo "ERROR: $*" >&2
  exit 1
}
```

POSIX style:

```sh
die() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}
```

Jangan pakai keyword `function` jika target POSIX.

Gunakan `printf`, bukan `echo`, untuk output predictable.

```sh
printf '%s\n' "hello"
```

Kenapa bukan `echo`?

Karena `echo` punya variasi behavior untuk:

- `-n`;
- backslash escape;
- argument yang diawali `-`.

`printf` lebih konsisten.

---

## 9. POSIX Conditional: `[ ... ]` dan `case`

### 9.1 String comparison

Portable:

```sh
if [ "$env" = "prod" ]; then
  printf '%s\n' "production"
fi
```

Jangan pakai `==` untuk POSIX `[ ... ]`:

```sh
[ "$env" == "prod" ]
```

Banyak shell menerimanya, tetapi POSIX memakai `=`.

### 9.2 Empty variable safety

Buruk:

```sh
if [ $env = prod ]; then
  ...
fi
```

Jika `env` kosong, expression rusak.

Benar:

```sh
if [ "$env" = "prod" ]; then
  ...
fi
```

### 9.3 Pattern matching dengan `case`

Portable dan bagus:

```sh
case "$env" in
  dev|staging|prod)
    ;;
  *)
    printf '%s\n' "ERROR: invalid env: $env" >&2
    exit 2
    ;;
esac
```

`case` sering lebih baik daripada rantai `if` untuk validasi value.

### 9.4 Numeric comparison

```sh
if [ "$count" -gt 10 ]; then
  printf '%s\n' "large"
fi
```

Pastikan input numeric sudah divalidasi.

```sh
case "$count" in
  ''|*[!0-9]*)
    printf '%s\n' "ERROR: count must be numeric" >&2
    exit 2
    ;;
esac
```

---

## 10. POSIX Variable Expansion yang Aman

Default value:

```sh
env=${APP_ENV:-dev}
```

Required value:

```sh
: "${APP_ENV:?APP_ENV is required}"
```

Suffix/prefix removal:

```sh
file="archive.tar.gz"
base=${file%.gz}
ext=${file##*.}
```

POSIX mendukung:

```sh
${var:-word}
${var-word}
${var:=word}
${var=word}
${var:?word}
${var?word}
${var:+word}
${var+word}
${#var}
${var%pattern}
${var%%pattern}
${var#pattern}
${var##pattern}
```

Bash-specific yang harus dihindari di POSIX sh:

```bash
${var//old/new}
${var:offset:length}
${var^^}
${var,,}
${!prefix*}
```

Untuk string replacement portable, sering kali gunakan external tool seperti `sed`, tetapi itu menambah dependency dan quoting concerns.

Contoh:

```sh
new=$(printf '%s\n' "$old" | sed 's/api/service/g')
```

Namun parsing/escaping `sed` replacement untuk arbitrary string tidak trivial. Jika data kompleks, pertimbangkan tool lain.

---

## 11. POSIX Tidak Punya Array

Ini perbedaan besar.

Bash:

```bash
cmd=(docker build -t "$image_tag" "$context")
"${cmd[@]}"
```

POSIX sh tidak punya array.

Alternatif POSIX untuk argument list adalah positional parameters:

```sh
set -- docker build -t "$image_tag" "$context"
"$@"
```

Namun ini mengganti positional parameters script/function saat ini.

Di function, pattern ini bisa berguna:

```sh
run_build() {
  image_tag=$1
  context=$2

  set -- docker build -t "$image_tag" "$context"
  "$@"
}
```

Jika perlu mempertahankan original args, simpan desain lebih sederhana atau gunakan subshell/function boundary.

Untuk optional arguments:

```sh
set -- docker build -t "$image_tag"

if [ "$no_cache" = "true" ]; then
  set -- "$@" --no-cache
fi

set -- "$@" "$context"

"$@"
```

Ini portable dan menjaga argument boundary.

Namun readability menurun bila command makin kompleks. Itu sinyal untuk memakai Bash arrays atau bahasa lain.

---

## 12. POSIX `read`: Batas dan Pattern Aman

Basic:

```sh
while IFS= read -r line; do
  printf '%s\n' "$line"
done < input.txt
```

Kenapa `IFS=` dan `-r`?

- `IFS=` mencegah trimming leading/trailing whitespace;
- `-r` mencegah backslash diperlakukan sebagai escape.

Pattern ini penting untuk line-based data.

Namun POSIX `read` tidak punya `-d ''` untuk null-delimited input. Jadi pattern aman untuk file dengan newline di nama sulit dilakukan murni POSIX.

Untuk file traversal portable, prefer:

```sh
find . -type f -exec sh -c '
  for file do
    printf "%s\n" "$file"
  done
' sh {} +
```

Ini menghindari parsing output `find` sebagai line text.

---

## 13. `for x in $(command)` Tetap Buruk di POSIX

Buruk:

```sh
for file in $(find . -type f); do
  printf '%s\n' "$file"
done
```

Masalah:

- command substitution menghapus trailing newline;
- word splitting;
- globbing;
- file dengan spasi/newline rusak.

Lebih baik:

```sh
find . -type f -exec sh -c '
  for file do
    printf "%s\n" "$file"
  done
' sh {} +
```

Atau jika domain kamu menjamin tidak ada whitespace di output, tulis asumsi itu eksplisit. Tetapi untuk reusable tooling, jangan jadikan default.

---

## 14. `set -e` di POSIX: Berguna tetapi Berbahaya Jika Disalahpahami

POSIX sh mendukung:

```sh
set -e
```

Artinya shell keluar ketika command sederhana gagal dalam kondisi tertentu.

Tetapi `set -e` punya banyak pengecualian dan nuance:

- command dalam kondisi `if` tidak membuat shell exit;
- command sebelum `&&` atau `||` punya behavior khusus;
- pipeline default hanya status command terakhir;
- subshell/function interaction bisa membingungkan;
- command substitution behavior berbeda antar shell dalam detail tertentu.

POSIX tidak punya portable `pipefail`.

Jadi ini:

```sh
set -e

generate | upload
```

masih bisa menyembunyikan failure `generate` jika `upload` exit 0.

Portable alternative untuk critical pipeline sering perlu temporary file:

```sh
tmp=${TMPDIR:-/tmp}/output.$$

if ! generate > "$tmp"; then
  rm -f "$tmp"
  printf '%s\n' "ERROR: generate failed" >&2
  exit 1
fi

if ! upload < "$tmp"; then
  rm -f "$tmp"
  printf '%s\n' "ERROR: upload failed" >&2
  exit 1
fi

rm -f "$tmp"
```

Lebih verbose, tetapi failure semantics jelas.

Kita akan membahas error handling lebih dalam di Part 005.

---

## 15. `set -u` di POSIX

POSIX sh umumnya mendukung:

```sh
set -u
```

Referencing unset variable menjadi error.

Contoh:

```sh
set -u
printf '%s\n' "$UNSET_VAR"
```

Namun hati-hati dengan optional variable. Gunakan default:

```sh
printf '%s\n' "${OPTIONAL_VAR:-}"
```

Untuk required env:

```sh
: "${REQUIRED_VAR:?REQUIRED_VAR is required}"
```

`set -u` bisa membantu, tetapi juga bisa membuat script rapuh jika tidak disiplin memakai default expansion.

---

## 16. Tidak Ada `pipefail`: Apa Strateginya?

Bash:

```bash
set -o pipefail
generate | upload
```

POSIX sh tidak punya `pipefail`.

Strategi:

### 16.1 Hindari pipeline critical

Pisahkan tahap:

```sh
tmp=$(mktemp "${TMPDIR:-/tmp}/generate.XXXXXX") || exit 1

if ! generate > "$tmp"; then
  rm -f "$tmp"
  exit 1
fi

if ! upload < "$tmp"; then
  rm -f "$tmp"
  exit 1
fi

rm -f "$tmp"
```

### 16.2 Gunakan command yang punya integrated mode

Daripada:

```sh
cat file | grep pattern
```

pakai:

```sh
grep pattern file
```

### 16.3 Terima pipeline hanya untuk non-critical display

```sh
ps -ef | grep '[j]ava'
```

Jika hanya diagnostic manual, acceptable. Untuk automation decision critical, jangan.

### 16.4 Jika pipeline semantics penting, gunakan Bash

Jika script sangat membutuhkan reliable pipeline failure detection, itu alasan valid untuk memilih Bash.

---

## 17. Temporary File Portable

`mktemp` tersedia luas, tetapi detail option bisa berbeda antar platform lama.

Umum:

```sh
tmp=$(mktemp) || {
  printf '%s\n' "ERROR: mktemp failed" >&2
  exit 1
}
```

Temporary directory:

```sh
tmp_dir=$(mktemp -d) || {
  printf '%s\n' "ERROR: mktemp -d failed" >&2
  exit 1
}
```

Cleanup:

```sh
cleanup() {
  rm -rf "$tmp_dir"
}

trap cleanup EXIT HUP INT TERM
```

Caveat:

- `EXIT` trap didukung luas, tetapi signal naming/detail bisa beda;
- jangan membuat tmp file manual dengan `$$` saja untuk security-sensitive code;
- pastikan quote variable;
- jangan `rm -rf "$tmp_dir"` jika tmp_dir bisa kosong. Validasi bila perlu.

Safer cleanup:

```sh
case "$tmp_dir" in
  /tmp/*)
    rm -rf "$tmp_dir"
    ;;
  *)
    printf '%s\n' "WARNING: refusing to remove suspicious tmp_dir: $tmp_dir" >&2
    ;;
esac
```

---

## 18. Resolving Script Directory: POSIX Caveat

Bash umum:

```bash
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
```

POSIX tidak punya `BASH_SOURCE`.

Dalam POSIX sh, `$0` bisa dipakai, tetapi punya caveat:

```sh
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
```

Namun `--` untuk `cd`/`dirname` tidak selalu portable di semua environment tua. Banyak modern system mendukungnya, tetapi strict POSIX tidak selalu mengharuskan semua utility support `--`.

Lebih conservative:

```sh
script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd) || exit 1
```

Masalah:

- jika script dipanggil via PATH, `$0` bisa hanya nama command;
- jika symlink, tidak otomatis resolve real path;
- jika sourced, `$0` adalah shell, bukan file;
- path dengan newline tetap bermasalah untuk beberapa command output;
- `dirname` external utility.

Untuk script POSIX sederhana, ini biasanya cukup:

```sh
script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd) || {
  printf '%s\n' "ERROR: cannot resolve script directory" >&2
  exit 1
}
```

Jika kamu butuh robust symlink resolution cross-platform, shell murni menjadi rumit. Pertimbangkan Bash atau bahasa lain.

---

## 19. `local` Bukan POSIX

Bash:

```bash
foo() {
  local x="hello"
}
```

POSIX sh tidak mendefinisikan `local`.

Banyak shell punya `local`, tetapi tidak portable.

Alternatif POSIX:

1. Gunakan nama variable unik.
2. Jalankan function dalam subshell jika ingin isolasi.
3. Simpan dan restore value.
4. Terima bahwa script kecil punya global variables.
5. Gunakan Bash jika scoping penting.

Contoh subshell:

```sh
do_work() (
  tmp_dir=$(mktemp -d) || exit 1
  cd "$tmp_dir" || exit 1
  # state isolated
)
```

Function body dengan `(...)` berjalan dalam subshell. Perubahan variable dan directory tidak bocor.

Namun exit/return semantics harus dipahami.

---

## 20. POSIX Function Return

Function return status adalah exit status command terakhir, atau value dari `return`.

```sh
is_prod() {
  [ "$1" = "prod" ]
}

if is_prod "$env"; then
  printf '%s\n' "prod"
fi
```

Function bisa return 0-255:

```sh
validate_env() {
  case "$1" in
    dev|staging|prod) return 0 ;;
    *) return 1 ;;
  esac
}
```

Jangan return string. Output string via stdout:

```sh
normalize_env() {
  case "$1" in
    production) printf '%s\n' "prod" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

env=$(normalize_env "$raw_env") || exit 1
```

Pisahkan:

- stdout untuk data;
- return code untuk success/failure;
- stderr untuk diagnostics.

---

## 21. POSIX Arithmetic

POSIX mendukung arithmetic expansion:

```sh
count=$((count + 1))
```

Contoh:

```sh
count=0
while [ "$count" -lt 3 ]; do
  count=$((count + 1))
  printf '%s\n' "$count"
done
```

Tidak perlu Bash `(( count++ ))`.

Bash-specific:

```bash
((count++))
if (( count > 3 )); then ...
```

POSIX:

```sh
count=$((count + 1))
if [ "$count" -gt 3 ]; then
  ...
fi
```

---

## 22. POSIX String Processing: Gunakan Shell Pattern, Bukan Regex

Parameter expansion prefix/suffix removal memakai shell pattern.

```sh
path="/a/b/c.txt"
file=${path##*/}
dir=${path%/*}
ext=${file##*.}
base=${file%.*}
```

Caveat:

```sh
dir=${path%/*}
```

Jika `path` tidak mengandung `/`, hasilnya original path. Perlu guard sesuai kebutuhan.

Untuk regex, POSIX shell sendiri tidak punya regex operator seperti Bash `[[ =~ ]]`.

Gunakan `case` untuk pattern sederhana:

```sh
case "$version" in
  [0-9]*.[0-9]*.[0-9]*)
    ;;
  *)
    printf '%s\n' "invalid-ish version" >&2
    exit 2
    ;;
esac
```

Namun shell pattern bukan regex semver valid. Untuk validation serius, gunakan `grep -E`, `awk`, atau bahasa lain.

---

## 23. External Utilities: POSIX Utility vs GNU Extension

Menulis POSIX shell bukan berarti seluruh command eksternal portable.

Contoh GNU-specific yang sering tidak portable:

```sh
sed -r
grep -P
date -d
readlink -f
xargs -r
mktemp --suffix
cp -a
stat -c
```

macOS/BSD utility sering beda dari GNU.

BusyBox utility sering subset.

Jika portability lintas Linux distro saja, GNU-ish mungkin acceptable. Jika lintas macOS, Alpine, BusyBox, strict portability, hati-hati.

Contoh date:

GNU:

```sh
date -d 'yesterday' +%F
```

macOS BSD:

```sh
date -v-1d +%F
```

Tidak portable.

Untuk date manipulation non-trivial, shell bukan pilihan ideal.

---

## 24. Alpine/BusyBox Reality

Alpine populer untuk container kecil. Default shell-nya BusyBox `ash`, bukan Bash.

Script ini gagal di Alpine minimal:

```bash
#!/bin/bash
```

karena `/bin/bash` tidak ada kecuali diinstall.

Script ini juga gagal jika memakai Bash feature walau shebang `/bin/sh`:

```sh
#!/bin/sh
arr=(a b c)
```

Untuk container entrypoint minimal, pilihan:

1. Tulis POSIX sh.
2. Install Bash secara eksplisit.
3. Gunakan binary/app sebagai entrypoint.
4. Gunakan init/wrapper kecil yang tidak butuh shell kompleks.

Untuk Java container, entrypoint sering cukup:

```sh
#!/bin/sh
set -eu

: "${JAVA_OPTS:=}"

exec java $JAVA_OPTS -jar /app/app.jar
```

Namun ini punya issue: unquoted `$JAVA_OPTS` sengaja splitting. Itu bisa acceptable jika `JAVA_OPTS` didefinisikan sebagai shell words, tetapi harus disadari. Jika ingin argument boundary kuat, shell string env bukan format ideal.

Alternative: gunakan explicit env per option atau config file.

---

## 25. `exec` dalam Entrypoint

Untuk container entrypoint, sering perlu:

```sh
exec java -jar /app/app.jar
```

Tanpa `exec`, shell tetap menjadi PID 1 dan Java menjadi child. Signal handling bisa bermasalah.

Dengan `exec`, shell digantikan oleh process Java. Java menjadi PID 1.

Contoh POSIX entrypoint:

```sh
#!/bin/sh
set -eu

: "${APP_ENV:=dev}"

case "$APP_ENV" in
  dev|staging|prod) ;;
  *)
    printf '%s\n' "ERROR: invalid APP_ENV: $APP_ENV" >&2
    exit 2
    ;;
esac

exec java -Dapp.env="$APP_ENV" -jar /app/app.jar
```

Ini portable, simple, dan cukup baik.

Namun detail PID 1 signal/zombie reaping masuk ke container/runtime behavior; tidak kita bahas dalam seri ini secara mendalam karena sudah mendekati materi container.

---

## 26. Makefile dan `/bin/sh`

Makefile recipe default dijalankan oleh `/bin/sh`.

Contoh:

```make
test:
	[[ -f pom.xml ]] && mvn test
```

Ini bisa gagal karena `[[` bukan POSIX.

Jika ingin Bash di Makefile:

```make
SHELL := /usr/bin/env bash
```

Namun `SHELL` di Make punya nuance. Pada banyak Make, `SHELL` mengharapkan path executable; `/usr/bin/env bash` dengan argumen bisa tidak bekerja seperti command line biasa. Lebih aman:

```make
SHELL := /bin/bash
```

Tetapi path Bash bisa berbeda.

Alternatif: panggil Bash eksplisit dalam recipe:

```make
test:
	bash -c '[[ -f pom.xml ]] && mvn test'
```

Atau lebih baik, Makefile memanggil script Bash:

```make
test:
	./scripts/test.sh
```

Lalu `scripts/test.sh` punya shebang Bash.

Design rule:

> Jangan menyelipkan Bash feature diam-diam di Makefile recipe jika Make default shell masih `/bin/sh`.

Part Makefile nanti akan membahas lebih dalam.

---

## 27. CI YAML dan Shell Default

CI YAML sering tampak seperti list command:

```yaml
script:
  - set -euo pipefail
  - [[ -f pom.xml ]]
  - mvn test
```

Tetapi shell yang menjalankan command bergantung platform/runner/image.

Better approach:

```yaml
script:
  - ./scripts/ci-verify.sh
```

Lalu script punya shebang jelas:

```bash
#!/usr/bin/env bash
set -euo pipefail
```

Atau POSIX:

```sh
#!/bin/sh
set -eu
```

Keuntungan:

- bisa dijalankan lokal;
- bisa dilint;
- bisa dites;
- shebang jadi contract;
- CI YAML tipis;
- behavior lebih konsisten.

---

## 28. POSIX Script Template

Template dasar:

```sh
#!/bin/sh

set -eu

usage() {
  cat >&2 <<'EOF'
Usage:
  script.sh <env>

Examples:
  script.sh dev
  script.sh staging
EOF
}

die() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

if [ "$#" -ne 1 ]; then
  usage
  exit 2
fi

env=$1

case "$env" in
  dev|staging|prod)
    ;;
  *)
    die "invalid env: $env"
    ;;
esac

require_cmd java

printf '%s\n' "Running for env=$env" >&2

exec java -Dapp.env="$env" -jar app.jar
```

Catatan:

- `set -eu`, bukan `set -euo pipefail`;
- `printf`, bukan `echo`;
- `[ "$#" -ne 1 ]`, quote variable;
- `case` untuk whitelist;
- `command -v` untuk dependency check;
- no arrays;
- no Bash-only syntax.

---

## 29. Bash Script Template

Jika memilih Bash, gunakan contract jelas:

```bash
#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  script.sh <env> [--dry-run]

Examples:
  script.sh dev
  script.sh prod --dry-run
EOF
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

if (($# < 1)); then
  usage
  exit 2
fi

env=$1
shift

case "$env" in
  dev|staging|prod) ;;
  *) die "invalid env: $env" ;;
esac

dry_run=false

while (($# > 0)); do
  case "$1" in
    --dry-run)
      dry_run=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

require_cmd java

cmd=(java -Dapp.env="$env")

if [[ "$dry_run" == "true" ]]; then
  cmd+=(-DdryRun=true)
fi

cmd+=(-jar app.jar)

printf 'Running:' >&2
printf ' %q' "${cmd[@]}" >&2
printf '\n' >&2

exec "${cmd[@]}"
```

Bash memberi ergonomics:

- arrays;
- `[[ ... ]]`;
- arithmetic command `((...))`;
- `pipefail`;
- `printf %q`;
- safer command construction.

Tetapi membutuhkan Bash.

---

## 30. Common Bashisms yang Sering Tidak Sengaja Masuk `/bin/sh`

### 30.1 `[[ ... ]]`

Bash:

```bash
[[ "$x" == yes ]]
```

POSIX:

```sh
[ "$x" = yes ]
```

### 30.2 Arrays

Bash:

```bash
args=(--name "$name")
cmd "${args[@]}"
```

POSIX:

```sh
set -- --name "$name"
cmd "$@"
```

### 30.3 `source`

Bash:

```bash
source ./env.sh
```

POSIX:

```sh
. ./env.sh
```

### 30.4 `function`

Bash-ish:

```bash
function hello() {
  ...
}
```

POSIX:

```sh
hello() {
  ...
}
```

### 30.5 `==` in test

Bash tolerated:

```bash
[ "$x" == yes ]
```

POSIX:

```sh
[ "$x" = yes ]
```

### 30.6 Here-string

Bash:

```bash
grep foo <<< "$text"
```

POSIX:

```sh
printf '%s\n' "$text" | grep foo
```

### 30.7 Process substitution

Bash:

```bash
diff <(sort a.txt) <(sort b.txt)
```

POSIX alternative:

```sh
tmp1=$(mktemp) || exit 1
tmp2=$(mktemp) || { rm -f "$tmp1"; exit 1; }

sort a.txt > "$tmp1"
sort b.txt > "$tmp2"
diff "$tmp1" "$tmp2"
rm -f "$tmp1" "$tmp2"
```

Verbose, but portable.

### 30.8 `${var//a/b}`

Bash:

```bash
new=${old//api/service}
```

POSIX:

```sh
new=$(printf '%s\n' "$old" | sed 's/api/service/g')
```

Caveat: escaping arbitrary replacement is hard.

### 30.9 `read -d`

Bash:

```bash
while IFS= read -r -d '' file; do
  ...
done
```

POSIX: no direct equivalent. Use `find -exec`.

---

## 31. Linting for Portability

Tools useful:

- `shellcheck`;
- `shfmt`.

ShellCheck can target shell dialect.

For POSIX sh:

```bash
shellcheck -s sh script.sh
```

For Bash:

```bash
shellcheck -s bash script.bash
```

Typical portability warnings:

- using `[[` in sh;
- using arrays in sh;
- using `source` in sh;
- unquoted expansions;
- `echo` portability concerns;
- `local` in sh;
- `read` flags not POSIX.

Do not blindly silence warnings. Understand whether warning violates your contract.

If script shebang is Bash, Bash-specific warnings may be irrelevant. If shebang is `/bin/sh`, warnings are critical.

---

## 32. Portability Levels

Not all portability is equal. Define level explicitly.

### Level 0 — Single controlled environment

Example:

```text
Runs only in company CI image v2026.06 with Bash 5.2.
```

Bash-specific is fine.

### Level 1 — Linux distro portability

Example:

```text
Runs on Ubuntu/Debian/RHEL with Bash installed.
```

Avoid GNU version assumptions if possible, but Bash OK.

### Level 2 — `/bin/sh` portability on Linux containers

Example:

```text
Runs on Debian dash and Alpine BusyBox ash.
```

Need POSIX shell and careful utility usage.

### Level 3 — Unix-like portability including macOS/BSD

Example:

```text
Runs on Linux and macOS developer machines.
```

Avoid GNU-only `sed`, `date`, `grep -P`, `readlink -f`.

### Level 4 — Cross-platform including Windows

Shell portability is hard. Consider PowerShell, Java, Go, Node, or Python.

The mistake is not “using Bash”. The mistake is pretending a Bash script is portable `/bin/sh`.

---

## 33. Example: POSIX Entrypoint for Java App

Goal:

- run in Alpine/Debian minimal;
- validate env;
- avoid Bash;
- pass Java options carefully;
- use `exec`.

```sh
#!/bin/sh
set -eu

die() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

: "${APP_ENV:=dev}"
: "${APP_PORT:=8080}"

case "$APP_ENV" in
  dev|staging|prod)
    ;;
  *)
    die "invalid APP_ENV: $APP_ENV"
    ;;
esac

case "$APP_PORT" in
  ''|*[!0-9]*)
    die "APP_PORT must be numeric: $APP_PORT"
    ;;
esac

# JAVA_OPTS is intentionally unquoted because it is treated as shell words.
# This is a trade-off and should only be used for trusted configuration.
: "${JAVA_OPTS:=}"

printf '%s\n' "Starting app env=$APP_ENV port=$APP_PORT" >&2

# shellcheck disable=SC2086
exec java $JAVA_OPTS \
  -Dapp.env="$APP_ENV" \
  -Dserver.port="$APP_PORT" \
  -jar /app/app.jar
```

Important nuance:

```sh
exec java $JAVA_OPTS ...
```

Unquoted `$JAVA_OPTS` is intentional splitting. ShellCheck will warn. This is one of the rare cases where unquoted expansion is sometimes used.

But the trade-off is real:

- `JAVA_OPTS='-Xmx512m -Dfoo=bar'` works;
- option with spaces is hard;
- untrusted value can inject options;
- argument boundary not robust.

Alternative: avoid `JAVA_OPTS` string; use explicit env variables:

```sh
exec java \
  -Xmx"${JAVA_MAX_HEAP:-512m}" \
  -Dapp.env="$APP_ENV" \
  -Dserver.port="$APP_PORT" \
  -jar /app/app.jar
```

This is safer but less flexible.

---

## 34. Example: POSIX CI Wrapper

Goal:

- run from any directory;
- check Java/Maven;
- use `/bin/sh`;
- no Bash arrays;
- no `pipefail`.

```sh
#!/bin/sh
set -eu

die() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd) || die "cannot resolve script directory"
project_root=$(CDPATH= cd "$script_dir/.." && pwd) || die "cannot resolve project root"

require_cmd java
require_cmd mvn

cd "$project_root"

[ -f pom.xml ] || die "pom.xml not found in $project_root"

printf '%s\n' "Running verification in $project_root" >&2

mvn test
mvn package

printf '%s\n' "Verification complete"
```

This is intentionally simple. If you need:

- dynamic optional Maven args;
- complex profile parsing;
- parallel orchestration;
- robust pipeline failure;
- arrays;

then Bash may be better.

---

## 35. Example: Same Wrapper in Bash

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

quick=false
profiles=()

while (($# > 0)); do
  case "$1" in
    --quick)
      quick=true
      shift
      ;;
    --profile)
      (($# >= 2)) || die "--profile requires value"
      profiles+=("$2")
      shift 2
      ;;
    -h|--help)
      printf 'Usage: ci-verify.sh [--quick] [--profile NAME]\n'
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

require_cmd java
require_cmd mvn

cd "$project_root"

cmd=(mvn)

if ((${#profiles[@]} > 0)); then
  joined_profiles=$(IFS=,; printf '%s' "${profiles[*]}")
  cmd+=(-P "$joined_profiles")
fi

cmd+=(test)

if [[ "$quick" != "true" ]]; then
  cmd+=(package)
fi

printf 'Running:' >&2
printf ' %q' "${cmd[@]}" >&2
printf '\n' >&2

"${cmd[@]}"
```

Bash is more expressive. But it is not `/bin/sh`.

---

## 36. Design Heuristics: Start POSIX, Graduate to Bash?

A useful heuristic:

1. Start with POSIX sh if script is tiny and environment is broad.
2. Move to Bash when argument construction or logic becomes awkward.
3. Move to PowerShell when object/Windows/cross-platform admin automation dominates.
4. Move to Java/Go/Python/Node when the script becomes an application.

Signs POSIX sh is no longer enough:

- you simulate arrays repeatedly;
- you need nested parsing;
- temp files only exist to compensate for missing process substitution;
- error handling becomes fragile;
- portability hacks dominate business intent;
- ShellCheck suppressions grow;
- reviewers need too much shell expertise to verify safety.

Signs Bash is no longer enough:

- you parse complex JSON/YAML deeply;
- you implement retry/backoff/state machine manually;
- you need serious unit tests around logic;
- you need concurrency beyond simple jobs;
- you handle API pagination/auth/error models;
- you need domain model;
- script exceeds a few hundred lines with complex branches.

---

## 37. Review Checklist: Is This Script Really POSIX?

Ask:

- Shebang is `#!/bin/sh`?
- No `[[ ... ]]`?
- No arrays?
- No `function` keyword?
- No `source`?
- No `pipefail`?
- No here-string `<<<`?
- No process substitution `<(...)`?
- No `read -d`, `readarray`, `mapfile`?
- No `${var//a/b}`?
- No `local` unless you accept non-POSIX extension?
- No `BASH_SOURCE`, `$RANDOM`, `$SECONDS`, `PIPESTATUS`?
- `[ ... ]` uses `=`, not `==`?
- Variable expansions quoted?
- External utilities avoid GNU-only options if portability level requires it?
- Tested with `dash` or BusyBox `sh`?
- ShellCheck run with `-s sh`?

If answer banyak “tidak”, ubah shebang ke Bash atau refactor.

---

## 38. Testing Portability Locally

Test with `dash` if available:

```bash
dash ./script.sh
```

Test with BusyBox:

```bash
docker run --rm -v "$PWD:/work" -w /work busybox sh ./script.sh
```

Test with Alpine:

```bash
docker run --rm -v "$PWD:/work" -w /work alpine sh ./script.sh
```

Test Bash script explicitly:

```bash
bash ./script.sh
```

Test POSIX syntax roughly:

```bash
shellcheck -s sh ./script.sh
```

Note: passing ShellCheck does not prove runtime portability, but it catches many mistakes.

---

## 39. Mini Lab

### Lab 1 — Bashism under `/bin/sh`

Create:

```sh
cat > bashism.sh <<'EOF'
#!/bin/sh
set -eu

name="alice"

if [[ "$name" == "alice" ]]; then
  echo "hello"
fi
EOF

chmod +x bashism.sh
```

Run:

```bash
./bashism.sh
```

Then:

```bash
sh ./bashism.sh
```

Observe failure.

Fix POSIX:

```sh
if [ "$name" = "alice" ]; then
  printf '%s\n' "hello"
fi
```

---

### Lab 2 — Array failure in sh

```sh
cat > array-sh.sh <<'EOF'
#!/bin/sh
args=(one two)
printf '%s\n' "${args[0]}"
EOF

chmod +x array-sh.sh
sh ./array-sh.sh
```

Now write POSIX positional-parameter version:

```sh
set -- one two
printf '%s\n' "$1"
```

---

### Lab 3 — Makefile default shell

Create `Makefile`:

```make
bad:
	[[ -f Makefile ]] && echo yes

good:
	[ -f Makefile ] && printf '%s\n' yes
```

Run:

```bash
make bad
make good
```

Observe whether `bad` fails depending on `/bin/sh`.

---

### Lab 4 — Alpine portability

Run:

```bash
docker run --rm -v "$PWD:/work" -w /work alpine sh ./script.sh
```

Try a Bash-specific script and see it fail.

---

### Lab 5 — ShellCheck dialect

Run:

```bash
shellcheck -s sh script.sh
shellcheck -s bash script.sh
```

Compare warnings.

---

## 40. Design Exercise

Take a Java project and classify scripts into portability levels.

Example:

```text
scripts/entrypoint.sh
  Target: POSIX sh
  Reason: runs in minimal container.

scripts/ci-verify.sh
  Target: Bash
  Reason: CI image guarantees Bash; needs arrays and pipefail.

scripts/dev/run-local.sh
  Target: Bash
  Reason: developer convenience, argument forwarding.

Makefile
  Target: POSIX recipe or calls scripts
  Reason: default make shell is /bin/sh.

scripts/admin/windows-maintenance.ps1
  Target: PowerShell
  Reason: Windows/admin APIs.
```

Then enforce:

- shebang;
- lint mode;
- CI test;
- documentation.

This is how scripting becomes architecture, not accidental tooling.

---

## 41. Part 003 Summary

Part ini memberi baseline portability.

Key takeaways:

1. `/bin/sh` is not Bash.
2. Shebang is a runtime contract.
3. POSIX sh is useful for minimal, portable, simple scripts.
4. Bash is better for complex argument construction and safer ergonomics.
5. PowerShell is better when object pipeline/cross-platform Windows support matters.
6. Makefile recipes default to `/bin/sh`.
7. CI YAML shell default must not be assumed blindly.
8. POSIX sh has no arrays, no `[[`, no `pipefail`, no process substitution.
9. Many external utility options are GNU-specific, not portable.
10. Use ShellCheck with the right dialect.
11. If Bash features appear in `/bin/sh`, either remove them or change shebang.
12. Portability level should be explicit per script.

The real skill is not always choosing POSIX. The real skill is choosing the correct runtime contract and keeping the implementation honest.

---

## 42. Referensi Resmi dan Bacaan Lanjutan

- POSIX Shell Command Language — baseline syntax and expansion model.
- POSIX Utilities — portable behavior of standard utilities.
- GNU Bash Reference Manual — Bash-specific features and POSIX mode differences.
- ShellCheck Wiki — common portability warnings and shell dialect issues.
- GNU Make Manual — recipe execution and default shell behavior.
- BusyBox documentation — practical constraints in minimal container environments.
- Alpine Linux documentation — common base image behavior and package availability.

---

## 43. Status Seri

Seri belum selesai.

Progress:

- [x] Part 000 — Orientation: Scripting as Engineering Control Plane
- [x] Part 001 — Shell Mental Model: Process, Stream, Exit Code, Environment
- [x] Part 002 — Command Execution Semantics: Parsing, Expansion, Quoting
- [x] Part 003 — POSIX Shell Baseline: Portable Script Before Bash-Specific Script
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
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-002.md">⬅️ Part 002 — Command Execution Semantics: Parsing, Expansion, Quoting</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-004.md">Part 004 — Bash Fundamentals Without Toy Examples ➡️</a>
</div>

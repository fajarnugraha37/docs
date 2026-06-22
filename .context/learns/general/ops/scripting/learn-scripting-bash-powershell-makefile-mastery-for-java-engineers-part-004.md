# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-004.md

# Part 004 — Bash Fundamentals Without Toy Examples

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: membangun kemampuan Bash yang praktis, aman, dan production-oriented: script layout, variable, function, array, argument parsing, command construction, validation, dan workflow automation.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya:

- Part 001: shell sebagai process orchestrator.
- Part 002: parsing, expansion, quoting.
- Part 003: POSIX shell baseline dan kapan memilih Bash.

Sekarang kita masuk Bash secara eksplisit.

Artinya runtime contract kita adalah:

```bash
#!/usr/bin/env bash
```

Bukan:

```sh
#!/bin/sh
```

Karena kita akan memakai fitur Bash seperti:

- arrays;
- associative arrays;
- `[[ ... ]]`;
- `(( ... ))`;
- `set -o pipefail`;
- `${BASH_SOURCE[0]}`;
- `printf %q`;
- `mapfile`/`readarray` pada konteks tertentu;
- `local`;
- `shopt`;
- extended parameter expansion.

Namun pendekatan part ini bukan “belajar Bash syntax dari nol” seperti tutorial umum. Kita akan belajar Bash sebagai alat engineering untuk:

- membuat developer workflow;
- menjalankan build/test;
- membungkus Maven/Gradle/Docker;
- membuat script CI;
- memvalidasi environment;
- membuat CLI internal;
- menjaga argument boundary;
- menghindari footgun yang umum;
- menulis script yang mudah direview.

Mental model utamanya:

> Bash script yang baik adalah CLI kecil dengan kontrak input, output, failure, side effect, dan observability.

---

## 1. Kapan Bash Layak Dipilih?

Bash layak dipilih ketika:

1. Target environment Unix-like dan Bash tersedia.
2. Tugas utama adalah mengorkestrasi command eksternal.
3. Script perlu lebih ekspresif daripada POSIX sh.
4. Kamu butuh array untuk menjaga argument boundary.
5. Kamu butuh `pipefail`.
6. Kamu butuh fungsi reusable sederhana.
7. Kamu perlu wrapper untuk Java/Maven/Gradle/Docker/kubectl/tooling lain.
8. Startup cepat dan zero compile matters.
9. Logic masih cukup kecil sehingga shell tetap terbaca.

Bash kurang cocok ketika:

1. Kamu perlu domain model kompleks.
2. Kamu memproses JSON/YAML/CSV besar secara intensif.
3. Kamu butuh concurrency kompleks.
4. Kamu perlu API client dengan pagination/retry/auth/error model kompleks.
5. Kamu butuh testing setara application code.
6. Script sudah menjadi aplikasi.
7. Kamu perlu cross-platform Windows first-class tanpa WSL/Git Bash.
8. Kamu butuh tipe data kuat.

Rule praktis:

> Bash sangat baik untuk orchestration, buruk untuk domain-heavy computation.

---

## 2. Minimal Production Bash Script Skeleton

Template dasar:

```bash
#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  script.sh [options]

Options:
  -h, --help    Show help.
EOF
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

main() {
  # parse args
  # validate env
  # execute workflow
  :
}

main "$@"
```

Kenapa ada `main "$@"`?

Karena:

- menjaga top-level script tetap deklaratif;
- memungkinkan local variable di dalam `main`;
- memudahkan testing function;
- membuat `return`/`exit` lebih mudah dikelola;
- memberi struktur yang familiar untuk engineer aplikasi.

Untuk script sangat pendek, `main` tidak wajib. Tetapi untuk script yang akan tumbuh, gunakan `main`.

---

## 3. Shebang dan Runtime Contract

Gunakan:

```bash
#!/usr/bin/env bash
```

Ini mencari `bash` dari `PATH`. Cocok untuk developer tooling.

Jika environment sangat terkunci dan security/path determinism lebih penting:

```bash
#!/bin/bash
```

Tetapi `/bin/bash` tidak selalu ada, terutama di Nix, Homebrew, atau beberapa environment khusus.

Jangan tulis:

```sh
#!/bin/sh
```

lalu memakai Bash feature.

Shebang harus sesuai dengan fitur yang digunakan.

---

## 4. `set -euo pipefail`: Berguna, Bukan Sihir

Baseline umum:

```bash
set -euo pipefail
```

Makna:

- `set -e`: exit saat command gagal pada kondisi tertentu;
- `set -u`: error saat memakai variable unset;
- `set -o pipefail`: pipeline gagal jika salah satu command penting gagal, bukan hanya command terakhir.

Namun ini bukan pengganti error handling.

### 4.1 `set -e` punya pengecualian

Command dalam kondisi `if` boleh gagal:

```bash
if grep -q "ERROR" app.log; then
  echo "found"
fi
```

Command sebelum `||` juga tidak langsung exit:

```bash
mkdir existing_dir || true
```

Karena itu jangan berpikir `set -e` berarti semua failure otomatis benar.

### 4.2 `set -u` butuh default expansion

Buruk:

```bash
echo "$OPTIONAL_ENV"
```

Jika unset, script gagal.

Benar:

```bash
echo "${OPTIONAL_ENV:-}"
```

Required env:

```bash
: "${APP_ENV:?APP_ENV is required}"
```

### 4.3 `pipefail` penting untuk pipeline

Tanpa `pipefail`:

```bash
false | true
```

pipeline dianggap sukses.

Dengan:

```bash
set -o pipefail
```

pipeline gagal.

Namun jika pipeline punya command yang boleh gagal seperti `grep`, perlu desain hati-hati.

---

## 5. Output Discipline: stdout untuk Data, stderr untuk Log

Script internal sering dipakai dalam command substitution:

```bash
version="$(./scripts/version.sh)"
```

Jika script mencetak log ke stdout, variable akan rusak.

Buruk:

```bash
echo "Reading version..."
cat VERSION
```

Baik:

```bash
printf 'Reading version...\n' >&2
cat VERSION
```

Pattern:

```bash
log() {
  printf '%s\n' "$*" >&2
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}
```

Untuk timestamp:

```bash
log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}
```

Catatan: timestamp logging memakai `date`, yang bisa punya portability nuance. Untuk Bash di Linux CI biasanya acceptable.

---

## 6. Variable: Assignment, Scope, Naming

Assignment:

```bash
name="alice"
```

Tidak boleh ada spasi:

```bash
name = "alice"   # salah
```

Gunakan quote saat assignment untuk clarity:

```bash
project_root="$HOME/project"
```

Bash variable default global di shell/script. Di function, gunakan `local`:

```bash
build() {
  local profile="$1"
  printf 'profile=%s\n' "$profile"
}
```

Naming convention:

- lower_snake_case untuk variable lokal;
- UPPER_SNAKE_CASE untuk environment/config;
- readonly untuk constant;
- prefix untuk global internal bila script besar.

Contoh:

```bash
readonly SCRIPT_NAME="$(basename "$0")"
readonly DEFAULT_PROFILE="dev"
```

Namun hati-hati: `readonly` membuat variable tidak bisa diubah, termasuk di test/mocking context.

---

## 7. Environment Variable sebagai Input Contract

Environment variable adalah input eksternal.

Required:

```bash
: "${API_TOKEN:?API_TOKEN is required}"
```

Optional dengan default:

```bash
app_env="${APP_ENV:-dev}"
```

Optional boolean:

```bash
dry_run="${DRY_RUN:-false}"
```

Validasi:

```bash
case "$app_env" in
  dev|staging|prod)
    ;;
  *)
    die "invalid APP_ENV: $app_env"
    ;;
esac
```

Jangan diam-diam menggunakan env tanpa kontrak.

Buruk:

```bash
curl -H "Authorization: Bearer $TOKEN" "$URL"
```

Baik:

```bash
: "${TOKEN:?TOKEN is required}"
: "${URL:?URL is required}"
```

Jika variable secret, jangan dicetak.

---

## 8. Function: Command dengan Contract Kecil

Function Bash sebaiknya punya:

- input lewat argument;
- output data lewat stdout;
- log lewat stderr;
- success/failure lewat return status;
- tidak diam-diam memakai global kecuali memang config global.

Contoh:

```bash
normalize_env() {
  local raw_env="$1"

  case "$raw_env" in
    dev|development)
      printf 'dev\n'
      ;;
    staging|stage)
      printf 'staging\n'
      ;;
    prod|production)
      printf 'prod\n'
      ;;
    *)
      return 1
      ;;
  esac
}
```

Pemakaian:

```bash
if app_env="$(normalize_env "$raw_env")"; then
  log "normalized env: $app_env"
else
  die "invalid env: $raw_env"
fi
```

Function tidak perlu selalu `echo`. Gunakan `printf`.

---

## 9. Return vs Exit

Dalam function:

```bash
return 1
```

mengembalikan status ke caller.

Dalam script:

```bash
exit 1
```

mengakhiri proses script.

Guideline:

- utility function sebaiknya `return`, bukan `exit`;
- top-level fatal condition boleh `exit` lewat `die`;
- function yang namanya `die` memang exit;
- function library jangan sembarangan exit kecuali contract-nya jelas.

Buruk:

```bash
parse_env() {
  if invalid; then
    exit 1
  fi
}
```

Lebih composable:

```bash
parse_env() {
  if invalid; then
    return 1
  fi
}
```

Caller memutuskan:

```bash
parse_env "$env" || die "invalid env"
```

---

## 10. Local Variable dan Dynamic Scope

Bash `local` bersifat function-local, tetapi Bash punya dynamic scoping: function yang dipanggil bisa melihat local variable caller jika nama sama tidak ditimpa.

Contoh:

```bash
outer() {
  local value="from outer"
  inner
}

inner() {
  printf '%s\n' "$value"
}
```

`inner` bisa melihat `value`. Ini bisa mengejutkan Java engineer yang terbiasa lexical scoping ketat.

Rule:

- jangan bergantung pada dynamic scope;
- pass argument eksplisit;
- gunakan nama variable lokal yang jelas;
- hindari global mutable state;
- gunakan `shellcheck` untuk mendeteksi banyak issue.

---

## 11. Arrays: Fitur Bash yang Sangat Penting

Array adalah alasan besar memilih Bash.

```bash
args=(one "two words" "*.java")
printf '<%s>\n' "${args[@]}"
```

Output:

```text
<one>
<two words>
<*.java>
```

Array menjaga argument boundary.

### 11.1 Menjalankan command dari array

```bash
cmd=(docker build -t "$image_tag" "$context_dir")
"${cmd[@]}"
```

Ini benar.

Jangan:

```bash
cmd="docker build -t $image_tag $context_dir"
$cmd
```

String command merusak argument boundary.

### 11.2 Menambahkan optional args

```bash
cmd=(mvn)

if [[ "$skip_tests" == "true" ]]; then
  cmd+=(-DskipTests)
fi

cmd+=(package)

"${cmd[@]}"
```

### 11.3 Array length

```bash
if ((${#cmd[@]} > 0)); then
  ...
fi
```

### 11.4 Loop array

```bash
for arg in "${cmd[@]}"; do
  printf 'arg=%q\n' "$arg"
done
```

### 11.5 Semua elemen: `"${array[@]}"` vs `"${array[*]}"`

- `"${array[@]}"`: setiap elemen tetap argument terpisah.
- `"${array[*]}"`: semua elemen digabung menjadi satu string.

Untuk command execution, hampir selalu:

```bash
"${array[@]}"
```

---

## 12. Associative Arrays

Bash mendukung associative array:

```bash
declare -A ports=(
  [dev]=8080
  [staging]=8081
  [prod]=8082
)

env="dev"
printf '%s\n' "${ports[$env]}"
```

Cocok untuk mapping kecil.

Namun jangan berlebihan. Jika mapping mulai kompleks, pertimbangkan config file atau bahasa lain.

Cek key exists:

```bash
if [[ -v "ports[$env]" ]]; then
  printf 'port=%s\n' "${ports[$env]}"
else
  die "no port configured for env: $env"
fi
```

`[[ -v ... ]]` membutuhkan Bash versi modern. Untuk environment lama, perlu alternatif.

---

## 13. `[[ ... ]]`: Bash Conditional yang Lebih Aman

Bash `[[ ... ]]` bukan command biasa. Ia keyword dengan semantics khusus.

Contoh:

```bash
if [[ "$env" == "prod" ]]; then
  ...
fi
```

Di dalam `[[ ]]`, variable expansion tidak mengalami word splitting dan globbing seperti command biasa.

Tetapi tetap quote literal comparison RHS jika ingin literal.

Pattern matching:

```bash
if [[ "$file" == *.java ]]; then
  echo "java file"
fi
```

Regex:

```bash
semver_re='^[0-9]+\.[0-9]+\.[0-9]+$'

if [[ "$version" =~ $semver_re ]]; then
  echo "valid"
fi
```

Jangan quote regex variable di RHS `=~` jika ingin regex semantics penuh.

---

## 14. Arithmetic dengan `(( ... ))`

Bash arithmetic command:

```bash
count=0
((count++))
```

Conditional:

```bash
if ((count > 10)); then
  echo "large"
fi
```

Loop:

```bash
for ((i = 0; i < 3; i++)); do
  printf 'i=%s\n' "$i"
done
```

Caveat:

- arithmetic integer;
- input user harus divalidasi;
- leading zero bisa punya interpretation issue;
- jangan pakai untuk decimal/float.

Validasi numeric:

```bash
is_uint() {
  [[ "$1" =~ ^[0-9]+$ ]]
}
```

---

## 15. Case Statement: Whitelist yang Sangat Berguna

`case` tetap sangat berguna di Bash.

```bash
case "$env" in
  dev|staging|prod)
    ;;
  *)
    die "invalid env: $env"
    ;;
esac
```

Untuk command dispatch:

```bash
case "$command" in
  build)
    do_build
    ;;
  test)
    do_test
    ;;
  deploy)
    do_deploy
    ;;
  *)
    usage
    die "unknown command: $command"
    ;;
esac
```

Untuk CLI internal, `case` sering lebih jelas daripada nested `if`.

---

## 16. Parsing Argument Manual

Untuk script internal, manual parsing sering cukup.

Example:

```bash
profile="dev"
dry_run=false
verbose=false

while (($# > 0)); do
  case "$1" in
    --profile)
      (($# >= 2)) || die "--profile requires a value"
      profile="$2"
      shift 2
      ;;
    --profile=*)
      profile="${1#*=}"
      shift
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    -v|--verbose)
      verbose=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      die "unknown option: $1"
      ;;
    *)
      break
      ;;
  esac
done

remaining_args=("$@")
```

Support `--` untuk end of options.

Validasi setelah parsing:

```bash
case "$profile" in
  dev|staging|prod) ;;
  *) die "invalid profile: $profile" ;;
esac
```

Jangan membuat parser terlalu canggih di Bash. Jika CLI makin kompleks, gunakan tool/language lain.

---

## 17. Positional Arguments dan `"$@"`

Function menerima argument seperti script.

```bash
run_maven() {
  local goal="$1"
  shift

  local cmd=(mvn "$goal" "$@")
  "${cmd[@]}"
}
```

Pemakaian:

```bash
run_maven test -DskipITs=true
```

`"$@"` menjaga argument boundary.

Jika kamu membuat wrapper:

```bash
#!/usr/bin/env bash
set -euo pipefail

exec mvn "$@"
```

Ini benar.

Jangan:

```bash
exec mvn $@
```

---

## 18. Command Construction Pattern

Pattern production:

```bash
cmd=(tool subcommand)

cmd+=(--env "$env")

if [[ "$dry_run" == "true" ]]; then
  cmd+=(--dry-run)
fi

if [[ -n "${config_file:-}" ]]; then
  cmd+=(--config "$config_file")
fi

cmd+=("${remaining_args[@]}")

log_command "${cmd[@]}"
"${cmd[@]}"
```

Logging command:

```bash
log_command() {
  printf 'Running:' >&2
  printf ' %q' "$@" >&2
  printf '\n' >&2
}
```

Caveat: jangan log command yang mengandung secret.

Secret-aware:

```bash
log "Running deploy command for env=$env"
```

Bukan:

```bash
log_command curl -H "Authorization: Bearer $TOKEN" ...
```

---

## 19. Require Command

Common utility:

```bash
require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || die "required command not found: $cmd"
}
```

Use:

```bash
require_cmd java
require_cmd mvn
require_cmd docker
```

Jika butuh versi:

```bash
require_java() {
  require_cmd java

  local version_output
  version_output="$(java -version 2>&1 | head -n 1)" || die "java -version failed"

  log "Detected $version_output"
}
```

Parsing versi Java secara robust bisa rumit. Untuk script internal, bisa cukup cek command ada, lalu biarkan build tool memvalidasi versi. Jangan over-engineer parsing di Bash kecuali perlu.

---

## 20. Resolving Project Root

Untuk Bash script di `scripts/`:

```bash
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"
```

Use:

```bash
cd "$project_root"
```

Kenapa?

Agar script bisa dijalankan dari mana pun:

```bash
./scripts/verify.sh
/path/to/project/scripts/verify.sh
cd /tmp && /path/to/project/scripts/verify.sh
```

Caveat:

- symlink handling bisa lebih rumit;
- `${BASH_SOURCE[0]}` lebih baik daripada `$0` untuk function/source context;
- jika script bisa disymlink, tentukan apakah ingin follow symlink atau tidak.

Untuk sebagian besar project internal, pattern ini cukup.

---

## 21. Reading Files

Line-by-line safe pattern:

```bash
while IFS= read -r line; do
  printf 'line=%s\n' "$line"
done < "$file"
```

Kenapa bukan:

```bash
for line in $(cat "$file"); do
  ...
done
```

Karena word splitting.

Read whole file:

```bash
content="$(< "$file")"
```

Bash shortcut. Equivalent roughly to command substitution but avoids external `cat`. Tetap trailing newline behavior? `$(<file)` adalah command substitution-like expansion dan trailing newlines bisa dihapus dalam assignment context. Jika newline persis penting, jangan pakai ini untuk binary/precise content.

Untuk config sederhana, prefer explicit parser atau env.

---

## 22. `mapfile` / `readarray`

Bash bisa membaca lines ke array:

```bash
mapfile -t lines < "$file"
```

`-t` menghapus trailing newline per line.

Use:

```bash
for line in "${lines[@]}"; do
  printf 'line=%s\n' "$line"
done
```

Caveat:

- membaca seluruh file ke memory;
- line-based, bukan null-safe;
- Bash-specific;
- tidak cocok untuk file sangat besar.

Untuk output command:

```bash
mapfile -t modules < <(find modules -mindepth 1 -maxdepth 1 -type d -printf '%f\n')
```

Caveat: `find -printf` GNU-specific.

Untuk portable-ish Bash di macOS, hindari `-printf`.

---

## 23. Globbing Options

Bash `shopt` mengubah behavior shell.

Common:

```bash
shopt -s nullglob
```

Jika glob tidak match, hasilnya empty, bukan literal pattern.

```bash
files=(./*.log)
```

Dengan `nullglob`, jika tidak ada `.log`, array empty.

Tanpa `nullglob`, array berisi literal `./*.log`.

Use carefully:

```bash
shopt -s nullglob
log_files=(./logs/*.log)
shopt -u nullglob
```

Tetapi mengubah global shell option bisa memengaruhi code lain.

Pattern better in function/subshell:

```bash
collect_logs() (
  shopt -s nullglob
  local files=(./logs/*.log)
  printf '%s\n' "${files[@]}"
)
```

Namun output line-based lagi punya caveat untuk newline filename. Untuk kebanyakan project logs, acceptable.

Other options:

- `failglob`: unmatched glob becomes error;
- `dotglob`: glob includes dotfiles;
- `globstar`: `**` recursive glob.

Gunakan hanya bila dibutuhkan dan dokumentasikan.

---

## 24. Temporary Directory dan Cleanup

Bash pattern:

```bash
tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT
```

Safer:

```bash
tmp_dir=""

cleanup() {
  if [[ -n "$tmp_dir" && -d "$tmp_dir" ]]; then
    rm -rf -- "$tmp_dir"
  fi
}

tmp_dir="$(mktemp -d)"
trap cleanup EXIT INT TERM
```

Untuk destructive cleanup, guard path:

```bash
cleanup() {
  if [[ -n "$tmp_dir" && "$tmp_dir" == /tmp/* && -d "$tmp_dir" ]]; then
    rm -rf -- "$tmp_dir"
  fi
}
```

Jika script menerima target path dari user, jangan `rm -rf "$target"` tanpa validation.

---

## 25. Trap Basics

`trap` menjalankan code saat signal/event.

```bash
trap cleanup EXIT
```

Jalan saat shell exit.

```bash
trap 'echo interrupted >&2; exit 130' INT
```

Jalan saat Ctrl+C.

Pattern:

```bash
on_exit() {
  local status=$?
  if ((status != 0)); then
    log "failed with status $status"
  fi
  cleanup
  exit "$status"
}

trap on_exit EXIT
```

Hati-hati:

- trap function harus tidak menimpa status tanpa sengaja;
- trap bisa membuat debugging membingungkan;
- `SIGKILL` tidak bisa ditangkap;
- cleanup harus idempotent.

Trap detail akan dibahas lebih jauh di Part 005 dan 008.

---

## 26. Boolean di Bash

Bash tidak punya boolean type native seperti Java.

Gunakan string:

```bash
dry_run=false

if [[ "$dry_run" == "true" ]]; then
  ...
fi
```

Atau gunakan command status:

```bash
is_ci() {
  [[ "${CI:-false}" == "true" ]]
}

if is_ci; then
  ...
fi
```

Jangan:

```bash
if $dry_run; then
  ...
fi
```

Karena itu mengeksekusi command bernama value variable. Jika `dry_run=true`, command `true` memang ada; jika `dry_run=false`, command `false` juga ada. Ini kadang dipakai, tetapi bisa berbahaya jika value tidak tervalidasi.

Lebih jelas:

```bash
if [[ "$dry_run" == "true" ]]; then
  ...
fi
```

---

## 27. Logging Levels

Simple logging:

```bash
verbose=false

log() {
  printf '%s\n' "$*" >&2
}

debug() {
  if [[ "$verbose" == "true" ]]; then
    printf 'DEBUG: %s\n' "$*" >&2
  fi
}
```

Use:

```bash
debug "project_root=$project_root"
```

For production scripts, consider:

- `--quiet`;
- `--verbose`;
- `--debug`;
- structured key-value logs;
- avoid secrets;
- include operation id/deployment id;
- keep stdout clean.

---

## 28. Usage Text

Good CLI has help.

```bash
usage() {
  cat >&2 <<'EOF'
Usage:
  verify.sh [options] [-- <maven-args>...]

Options:
  --profile <name>     Maven profile: unit, integration, smoke.
  --quick              Skip slow checks.
  -v, --verbose        Print debug logs.
  -h, --help           Show this help.

Examples:
  verify.sh
  verify.sh --profile integration
  verify.sh --quick -- -DskipDocker=true
EOF
}
```

Help should include:

- purpose;
- options;
- examples;
- env variables if relevant;
- side effects if dangerous.

For destructive scripts, help must be explicit.

---

## 29. Example: `verify.sh` for Java Project

Goal:

- run from any directory;
- support `--quick`;
- support `--profile`;
- forward remaining args to Maven after `--`;
- validate Maven/Java exist;
- use Bash arrays;
- log command safely.

```bash
#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  verify.sh [options] [-- <extra-maven-args>...]

Options:
  --profile <name>   Verification profile: unit, integration, smoke.
  --quick            Run unit-level checks only.
  -v, --verbose      Print debug logs.
  -h, --help         Show this help.

Examples:
  verify.sh
  verify.sh --profile integration
  verify.sh --quick -- -DskipDocker=true
EOF
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '%s\n' "$*" >&2
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || die "required command not found: $cmd"
}

log_command() {
  printf 'Running:' >&2
  printf ' %q' "$@" >&2
  printf '\n' >&2
}

main() {
  local profile="unit"
  local quick=false
  local verbose=false

  while (($# > 0)); do
    case "$1" in
      --profile)
        (($# >= 2)) || die "--profile requires a value"
        profile="$2"
        shift 2
        ;;
      --profile=*)
        profile="${1#*=}"
        shift
        ;;
      --quick)
        quick=true
        shift
        ;;
      -v|--verbose)
        verbose=true
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      --)
        shift
        break
        ;;
      -*)
        die "unknown option: $1"
        ;;
      *)
        break
        ;;
    esac
  done

  case "$profile" in
    unit|integration|smoke)
      ;;
    *)
      die "invalid profile: $profile"
      ;;
  esac

  require_cmd java
  require_cmd mvn

  local script_dir
  local project_root

  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  project_root="$(cd -- "$script_dir/.." && pwd)"

  cd "$project_root"

  [[ -f pom.xml ]] || die "pom.xml not found at project root: $project_root"

  local cmd=(mvn -P "$profile")

  if [[ "$quick" == "true" ]]; then
    cmd+=(-DskipITs=true)
  fi

  cmd+=(test)

  # Forward extra Maven args after --
  cmd+=("$@")

  log "Project root: $project_root"
  log "Profile: $profile"
  log "Quick: $quick"

  if [[ "$verbose" == "true" ]]; then
    log_command "${cmd[@]}"
  fi

  "${cmd[@]}"
}

main "$@"
```

This script demonstrates:

- `main "$@"`;
- manual option parsing;
- validation;
- arrays;
- `"$@"` forwarding;
- project root resolution;
- stdout/stderr discipline.

---

## 30. Example: `run-local.sh` for Spring Boot Jar

Goal:

- validate env;
- construct Java command safely;
- support debug mode;
- forward app args.

```bash
#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  run-local.sh [options] [-- <app-args>...]

Options:
  --env <env>       App env: dev, staging-like.
  --debug           Enable remote debugging on port 5005.
  --jar <path>      Path to jar. Default: target/app.jar.
  -h, --help        Show help.

Examples:
  run-local.sh --env dev
  run-local.sh --debug -- --server.port=9090
EOF
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

main() {
  local app_env="dev"
  local debug=false
  local jar_path="target/app.jar"

  while (($# > 0)); do
    case "$1" in
      --env)
        (($# >= 2)) || die "--env requires value"
        app_env="$2"
        shift 2
        ;;
      --debug)
        debug=true
        shift
        ;;
      --jar)
        (($# >= 2)) || die "--jar requires value"
        jar_path="$2"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      --)
        shift
        break
        ;;
      -*)
        die "unknown option: $1"
        ;;
      *)
        break
        ;;
    esac
  done

  case "$app_env" in
    dev|staging-like)
      ;;
    *)
      die "invalid env: $app_env"
      ;;
  esac

  require_cmd java

  local cmd=(java)

  if [[ "$debug" == "true" ]]; then
    cmd+=(
      -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005
    )
  fi

  cmd+=(
    -Dspring.profiles.active="$app_env"
    -jar "$jar_path"
  )

  cmd+=("$@")

  printf 'Starting app env=%s debug=%s jar=%s\n' "$app_env" "$debug" "$jar_path" >&2

  exec "${cmd[@]}"
}

main "$@"
```

Notice:

- no command string;
- all dynamic args preserve boundary;
- app args after `--` are forwarded exactly;
- `exec` replaces shell with Java process.

---

## 31. Example: Safe Cleanup Script

Goal:

- clean build artifacts;
- refuse suspicious paths;
- support dry-run;
- no accidental root deletion.

```bash
#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '%s\n' "$*" >&2
}

main() {
  local dry_run=false

  while (($# > 0)); do
    case "$1" in
      --dry-run)
        dry_run=true
        shift
        ;;
      -h|--help)
        printf 'Usage: clean-build.sh [--dry-run]\n' >&2
        exit 0
        ;;
      *)
        die "unknown argument: $1"
        ;;
    esac
  done

  local script_dir
  local project_root

  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  project_root="$(cd -- "$script_dir/.." && pwd)"

  [[ -f "$project_root/pom.xml" || -f "$project_root/build.gradle" || -f "$project_root/settings.gradle" ]] \
    || die "refusing cleanup: project marker not found in $project_root"

  local targets=(
    "$project_root/target"
    "$project_root/build"
    "$project_root/.gradle"
  )

  local target
  for target in "${targets[@]}"; do
    [[ -e "$target" ]] || continue

    case "$target" in
      "$project_root"/*)
        ;;
      *)
        die "refusing to remove path outside project root: $target"
        ;;
    esac

    if [[ "$dry_run" == "true" ]]; then
      log "Would remove: $target"
    else
      log "Removing: $target"
      rm -rf -- "$target"
    fi
  done
}

main "$@"
```

Key safety properties:

- project marker required;
- target paths constructed from project root;
- target path checked before removal;
- `--dry-run`;
- `rm -rf -- "$target"` with quote and `--`.

---

## 32. Example: Deploy Guard Skeleton

Deploy scripts need stronger guardrails.

```bash
#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  deploy.sh --env <staging|prod> --version <version> [--dry-run] [--yes]

This script triggers deployment. Production requires --yes.
EOF
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

main() {
  local env=""
  local version=""
  local dry_run=false
  local yes=false

  while (($# > 0)); do
    case "$1" in
      --env)
        (($# >= 2)) || die "--env requires value"
        env="$2"
        shift 2
        ;;
      --version)
        (($# >= 2)) || die "--version requires value"
        version="$2"
        shift 2
        ;;
      --dry-run)
        dry_run=true
        shift
        ;;
      --yes)
        yes=true
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

  [[ -n "$env" ]] || die "--env is required"
  [[ -n "$version" ]] || die "--version is required"

  case "$env" in
    staging|prod) ;;
    *) die "invalid env: $env" ;;
  esac

  local semver_re='^[0-9]+\.[0-9]+\.[0-9]+$'
  [[ "$version" =~ $semver_re ]] || die "version must look like x.y.z: $version"

  if [[ "$env" == "prod" && "$yes" != "true" ]]; then
    die "production deploy requires --yes"
  fi

  if [[ "$dry_run" == "true" ]]; then
    printf 'DRY RUN deploy env=%s version=%s\n' "$env" "$version" >&2
    exit 0
  fi

  printf 'Deploying env=%s version=%s\n' "$env" "$version" >&2

  # call deploy tool here, e.g.
  # deployctl deploy --env "$env" --version "$version"
}

main "$@"
```

Principles:

- explicit env;
- explicit version;
- production guard;
- dry-run;
- no implicit current branch deploy;
- version validation;
- no prompt dependency.

---

## 33. Error Handling Preview

Part 005 akan membahas ini detail, tetapi di Part 004 gunakan baseline:

```bash
die "message"
```

For command that can fail with expected semantics:

```bash
if grep -q "pattern" "$file"; then
  found=true
else
  status=$?
  if ((status == 1)); then
    found=false
  else
    die "grep failed with status $status"
  fi
fi
```

Do not blindly write:

```bash
grep -q pattern file || true
```

unless failure is truly irrelevant and documented.

---

## 34. Input Validation Patterns

### 34.1 Enum

```bash
case "$env" in
  dev|staging|prod) ;;
  *) die "invalid env: $env" ;;
esac
```

### 34.2 Non-empty

```bash
[[ -n "$version" ]] || die "version is required"
```

### 34.3 Unsigned integer

```bash
[[ "$port" =~ ^[0-9]+$ ]] || die "port must be numeric"
```

### 34.4 Path exists

```bash
[[ -f "$config_file" ]] || die "config file not found: $config_file"
```

### 34.5 Directory inside project root

```bash
case "$target_dir" in
  "$project_root"/*) ;;
  *) die "target outside project root: $target_dir" ;;
esac
```

Caveat: string prefix check is not full canonical path security. For high-risk deletion/security, resolve real paths carefully and consider symlinks.

---

## 35. Avoiding Global Mutable State

Small scripts often use globals:

```bash
project_root=""
verbose=false
```

Acceptable, but control it.

Better patterns:

- parse args in `main`;
- pass values to functions;
- functions return data/status;
- keep constants readonly;
- isolate side-effect-heavy code.

Example:

```bash
build_cmd() {
  local profile="$1"
  local skip_tests="$2"

  local cmd=(mvn -P "$profile")

  if [[ "$skip_tests" == "true" ]]; then
    cmd+=(-DskipTests)
  fi

  cmd+=(package)

  printf '%s\0' "${cmd[@]}"
}
```

Returning arrays from functions is awkward in Bash. Often simpler to build command in caller or use namerefs in modern Bash. Do not over-engineer.

Bash is not Java. Keep design simple.

---

## 36. Nameref: Advanced Bash, Use Sparingly

Bash supports nameref:

```bash
build_maven_cmd() {
  local -n out_cmd=$1
  local profile="$2"

  out_cmd=(mvn -P "$profile" test)
}

cmd=()
build_maven_cmd cmd integration
"${cmd[@]}"
```

This mutates array by reference.

Useful, but less familiar and requires Bash 4.3+. Use only when benefit is clear.

For internal scripts where Bash version is controlled, okay. Otherwise avoid.

---

## 37. Bash Version Compatibility

macOS historically ships older Bash 3.2 due to licensing. Many Linux systems have Bash 4/5.

Features to watch:

- associative arrays need Bash 4+;
- nameref needs Bash 4.3+;
- `mapfile` exists Bash 4+;
- some `[[ -v array[key] ]]` behavior differs by version.

If developer machines include macOS default Bash, either:

1. avoid modern Bash features;
2. require Homebrew Bash;
3. run scripts in container;
4. use POSIX sh;
5. use another language.

Version check:

```bash
if ((BASH_VERSINFO[0] < 4)); then
  die "Bash 4+ is required"
fi
```

But if `die` uses Bash features, define carefully.

---

## 38. Style: Prefer Boring Bash

Bash allows clever one-liners. Avoid them in production scripts.

Clever:

```bash
[[ $env =~ ^(dev|staging|prod)$ ]] || { echo bad >&2; exit 1; }
```

Clear:

```bash
case "$env" in
  dev|staging|prod)
    ;;
  *)
    die "invalid env: $env"
    ;;
esac
```

Clever:

```bash
cmd+=( ${dry_run:+--dry-run} )
```

Potentially problematic if value splitting occurs.

Clear:

```bash
if [[ "$dry_run" == "true" ]]; then
  cmd+=(--dry-run)
fi
```

Optimize for reviewability.

---

## 39. ShellCheck-Oriented Habits

Write code that ShellCheck likes:

- quote variables;
- use arrays for commands;
- avoid useless `cat`;
- avoid `for x in $(...)`;
- use `read -r`;
- avoid masked return status;
- avoid undefined variables;
- clarify intentional unquoted expansion.

When suppressing:

```bash
# shellcheck disable=SC2086
exec java $JAVA_OPTS -jar app.jar
```

Add reason:

```bash
# JAVA_OPTS is intentionally split as trusted shell words.
# shellcheck disable=SC2086
exec java $JAVA_OPTS -jar app.jar
```

Suppression without reason becomes technical debt.

---

## 40. Common Bash Anti-Patterns

### 40.1 Command in string

Bad:

```bash
cmd="mvn -P $profile test"
$cmd
```

Good:

```bash
cmd=(mvn -P "$profile" test)
"${cmd[@]}"
```

### 40.2 Unquoted variable

Bad:

```bash
cp $src $dst
```

Good:

```bash
cp -- "$src" "$dst"
```

### 40.3 Fragile arg forwarding

Bad:

```bash
mvn $@
```

Good:

```bash
mvn "$@"
```

### 40.4 Global `cd` without root resolution

Bad:

```bash
cd ..
mvn test
```

Good:

```bash
cd "$project_root"
mvn test
```

### 40.5 `echo` for arbitrary data

Bad:

```bash
echo "$value"
```

Better:

```bash
printf '%s\n' "$value"
```

### 40.6 `eval`

Bad:

```bash
eval "$cmd"
```

Good:

```bash
cmd=(...)
"${cmd[@]}"
```

### 40.7 Parsing ls

Bad:

```bash
for f in $(ls); do ...
```

Good:

```bash
for f in ./*; do
  [[ -e "$f" ]] || continue
  ...
done
```

---

## 41. Mini Lab

### Lab 1 — Build command safely

Create:

```bash
image_tag="my app:local"
context_dir="."

cmd=(docker build -t "$image_tag" "$context_dir")

printf 'argc=%s\n' "${#cmd[@]}"
printf '<%s>\n' "${cmd[@]}"
```

Compare with string command.

---

### Lab 2 — Argument forwarding

Create wrapper:

```bash
cat > wrapper.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf 'Forwarding args:\n' >&2
printf '<%s>\n' "$@" >&2

./show-args.sh "$@"
EOF

chmod +x wrapper.sh
```

Run:

```bash
./wrapper.sh "hello world" "*.java" ""
```

Observe boundary.

---

### Lab 3 — Manual parser

Implement parser for:

```text
--env dev|staging|prod
--dry-run
--verbose
--
remaining args
```

Print parsed values.

---

### Lab 4 — Project root

Put script in `scripts/lab-root.sh`, run from different directories, verify it resolves project root correctly.

---

### Lab 5 — Cleanup guard

Write dry-run cleanup for `target/` and `build/`. Ensure it refuses to delete if project marker missing.

---

## 42. Design Exercise: Bash CLI for Java Service

Design `scripts/service.sh` with subcommands:

```text
service.sh verify [--quick] [-- <maven args>...]
service.sh run [--env dev] [--debug] [-- <app args>...]
service.sh clean [--dry-run]
service.sh help
```

Requirements:

- Bash shebang;
- `set -euo pipefail`;
- `main "$@"`;
- subcommand dispatch with `case`;
- one function per subcommand;
- arrays for command construction;
- clean stdout/stderr discipline;
- usage text;
- validation;
- no `eval`;
- no unquoted variable;
- no destructive action without guard.

This will become a stepping stone toward the capstone in Part 029.

---

## 43. Part 004 Summary

Part ini membentuk Bash fundamentals yang langsung berguna untuk engineering work.

Key takeaways:

1. Bash dipilih ketika orchestration butuh fitur lebih dari POSIX sh.
2. Shebang harus eksplisit: `#!/usr/bin/env bash`.
3. `set -euo pipefail` membantu, tetapi bukan pengganti desain error handling.
4. `main "$@"` memberi struktur script yang rapi.
5. stdout untuk data, stderr untuk logs.
6. Environment variable adalah input contract.
7. Function sebaiknya punya input/output/failure contract.
8. Gunakan `local` untuk variable function.
9. Gunakan arrays untuk command construction.
10. Gunakan `"$@"` untuk argument forwarding.
11. Gunakan `[[ ... ]]`, `(( ... ))`, dan `case` dengan jelas.
12. Validasi input sebelum side effect.
13. Resolve project root, jangan bergantung pada current directory.
14. Trap dan cleanup perlu dipakai dengan hati-hati.
15. Hindari command string, `eval`, unquoted variables, dan clever one-liners.
16. Bash script yang baik adalah CLI kecil yang reviewable.

Dengan ini, kita siap masuk ke Part 005: **Error Handling in Bash: Fail Fast, Fail Clear, Fail Safe**.

---

## 44. Referensi Resmi dan Bacaan Lanjutan

- GNU Bash Reference Manual — Bash startup, shell parameters, arrays, conditional expressions, shell functions.
- GNU Bash Reference Manual — The Set Builtin and shell options.
- GNU Bash Reference Manual — Bash Conditional Expressions.
- GNU Bash Reference Manual — Arrays.
- ShellCheck documentation — common Bash pitfalls and static analysis rules.
- Google Shell Style Guide — useful style perspective, though not absolute law.
- Bash Hackers Wiki — practical deep dives into Bash behavior.

---

## 45. Status Seri

Seri belum selesai.

Progress:

- [x] Part 000 — Orientation: Scripting as Engineering Control Plane
- [x] Part 001 — Shell Mental Model: Process, Stream, Exit Code, Environment
- [x] Part 002 — Command Execution Semantics: Parsing, Expansion, Quoting
- [x] Part 003 — POSIX Shell Baseline: Portable Script Before Bash-Specific Script
- [x] Part 004 — Bash Fundamentals Without Toy Examples
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
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-003.md">⬅️ Part 003 — POSIX Shell Baseline: Portable Script Before Bash-Specific Script</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-005.md">Part 005 — Error Handling in Bash: Fail Fast, Fail Clear, Fail Safe ➡️</a>
</div>

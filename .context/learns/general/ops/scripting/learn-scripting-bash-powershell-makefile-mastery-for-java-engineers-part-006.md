# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-006.md

# Part 006 — Data Handling in Bash: Text, Lines, Null Bytes, JSON, CSV

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: memahami batas dan pola aman Bash saat menangani data: text stream, line-oriented processing, null-delimited data, JSON, CSV, logs, command output, dan kapan harus berhenti memakai Bash.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya:

- Part 001: process, stream, exit code, environment.
- Part 002: parsing, expansion, quoting.
- Part 003: POSIX shell baseline.
- Part 004: Bash fundamentals.
- Part 005: error handling.

Part 006 membahas data.

Bash sangat sering dipakai untuk:

```bash
grep ...
awk ...
sed ...
cut ...
sort ...
uniq ...
xargs ...
find ...
jq ...
curl ...
```

Masalahnya: banyak script gagal bukan karena command-nya salah, tetapi karena salah memahami bentuk data.

Contoh klasik:

```bash
for file in $(find . -type f); do
  rm "$file"
done
```

Script ini gagal untuk file dengan spasi, tab, newline, atau karakter aneh.

Contoh lain:

```bash
version=$(cat version.txt)
```

Terlihat aman, tetapi command substitution menghapus trailing newline.

Contoh lain:

```bash
name=$(jq .name data.json)
```

Output mungkin masih mengandung quote JSON.

Contoh lain:

```bash
IFS=, read -r a b c <<< "$csv_line"
```

Ini bukan CSV parser. Ini hanya split by comma.

Tujuan part ini:

> Membuat kamu tahu kapan Bash cocok untuk data, bagaimana cara aman menangani data sederhana, dan kapan data sudah terlalu structured untuk Bash.

---

## 1. Mental Model: Bash Bekerja dengan Bytes dan Words, Bukan Object

Bash tidak punya model data seperti Java:

```java
record User(String id, String name, List<Role> roles) {}
```

Bash punya:

- string;
- array string;
- associative array string;
- exit code;
- stream bytes/text;
- file;
- command output.

Pipeline Unix tradisional bekerja sangat baik saat data berbentuk:

- text stream;
- satu record per line;
- field sederhana;
- delimiter jelas;
- format stabil;
- volume bisa diproses streaming.

Bash mulai rapuh saat data:

- nested;
- quoted;
- escaped;
- binary;
- mengandung newline dalam field;
- butuh schema;
- butuh type;
- butuh validation kompleks;
- butuh error recovery;
- butuh transformation besar;
- butuh business rules.

Rule utama:

> Bash bagus untuk mengorkestrasi parser dan transformer. Bash buruk sebagai parser format kompleks.

---

## 2. Stream vs Variable

Data bisa mengalir lewat stream:

```bash
find . -type f | grep '\.java$' | sort
```

Atau ditampung ke variable:

```bash
files="$(find . -type f)"
```

Menampung data multi-line ke variable sering menyebabkan masalah:

- trailing newline hilang;
- data besar masuk memory;
- word splitting jika tidak diquote;
- record boundary tidak kuat;
- error status command bisa terlupakan;
- stderr bisa tercampur bila diarahkan.

Prefer streaming jika:

- data besar;
- satu record per line;
- tidak perlu seluruh data sekaligus;
- command berikutnya bisa membaca stdin.

Gunakan variable jika:

- single scalar value;
- output kecil;
- perlu dipakai beberapa kali;
- command output memang contract-nya satu nilai.

Contoh single scalar yang baik:

```bash
version="$(< VERSION)"
version="${version//$'\n'/}"  # Bash-specific; only if VERSION must be one line
```

Lebih baik validasi:

```bash
version="$(tr -d '\n' < VERSION)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid version: $version"
```

Namun `tr -d '\n'` menghapus semua newline. Jika file punya dua line, ini bisa menyembunyikan error. Lebih baik:

```bash
mapfile -t version_lines < VERSION

((${#version_lines[@]} == 1)) || die "VERSION must contain exactly one line"

version="${version_lines[0]}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid version: $version"
```

---

## 3. stdout sebagai Data Contract

Jika script/function menghasilkan data, stdout harus bersih.

Function buruk:

```bash
get_version() {
  echo "Reading version"
  cat VERSION
}
```

Pemanggil:

```bash
version="$(get_version)"
```

`version` berisi log juga.

Function baik:

```bash
get_version() {
  printf 'Reading version\n' >&2
  cat VERSION
}
```

Atau jika function utility:

```bash
get_version() {
  local version
  version="$(< VERSION)"
  printf '%s\n' "$version"
}
```

Rule:

- stdout: data;
- stderr: log, warning, progress, diagnostic;
- exit code: success/failure.

Ini membuat script composable.

---

## 4. Line-Oriented Data: Aman Jika Benar-Benar Line-Oriented

Banyak Unix tools mengasumsikan satu record per line.

Contoh log:

```text
2026-06-22T10:00:00Z INFO started
2026-06-22T10:01:00Z ERROR failed
```

Processing:

```bash
grep ' ERROR ' app.log | cut -d' ' -f1
```

Ini acceptable jika format log stabil.

Namun line-oriented data gagal jika field bisa mengandung newline. File path Unix bisa mengandung newline, jadi path list bukan line-oriented secara aman kecuali domain kamu melarang newline dalam path.

Untuk data internal project, kamu bisa membuat constraint:

```text
Module names must not contain whitespace or newline.
```

Jika constraint valid dan enforced, line-oriented processing aman. Jika tidak, gunakan null delimiter.

---

## 5. Reading Lines Safely

Pattern:

```bash
while IFS= read -r line; do
  printf 'line=%s\n' "$line"
done < "$file"
```

Kenapa:

- `IFS=` mencegah trimming whitespace;
- `-r` mencegah backslash escape;
- redirection `< "$file"` menghindari useless cat;
- `"$line"` menjaga data sebagai satu argument.

Buruk:

```bash
for line in $(cat "$file"); do
  echo "$line"
done
```

Masalah:

- word splitting;
- globbing;
- whitespace hancur;
- empty line hilang;
- backslash/escape issues.

### 5.1 Last line without newline

`read` returns non-zero if EOF reached without newline, walaupun ada data partial. Untuk memproses last line tanpa newline:

```bash
while IFS= read -r line || [[ -n "$line" ]]; do
  printf 'line=%s\n' "$line"
done < "$file"
```

Gunakan jika file mungkin tidak berakhir newline.

---

## 6. Pipeline Loop dan Subshell

Bash pitfall:

```bash
count=0

printf '%s\n' a b c | while IFS= read -r line; do
  count=$((count + 1))
done

echo "$count"
```

Di banyak shell/Bash default, `while` dalam pipeline berjalan di subshell. `count` tetap 0 di parent.

Bash solution:

```bash
count=0

while IFS= read -r line; do
  count=$((count + 1))
done < <(printf '%s\n' a b c)

echo "$count"
```

Process substitution `< <(...)` adalah Bash-specific.

Alternative: temporary file.

```bash
tmp="$(mktemp)"
printf '%s\n' a b c > "$tmp"

count=0
while IFS= read -r line; do
  count=$((count + 1))
done < "$tmp"

rm -f "$tmp"
echo "$count"
```

Guideline:

- If loop only emits output and does not need parent state, pipeline loop is okay.
- If loop updates parent variables, avoid pipeline loop.

---

## 7. `mapfile` / `readarray`

Bash can read lines into array:

```bash
mapfile -t lines < "$file"
```

Then:

```bash
for line in "${lines[@]}"; do
  printf 'line=%s\n' "$line"
done
```

Pros:

- simple;
- preserves spaces;
- array boundary per line.

Cons:

- reads whole file to memory;
- line-based only;
- not null-safe;
- Bash 4+;
- trailing newline removed with `-t`;
- cannot represent whether final line had newline unless handled separately.

Use for:

- small config lists;
- module list;
- test target list;
- generated output with stable line records.

Avoid for:

- huge logs;
- arbitrary file paths;
- binary data.

---

## 8. Null-Delimited Data: Correct Pattern for File Paths

Unix pathnames cannot contain null byte (`\0`). Therefore null delimiter is the safe delimiter for arbitrary file names.

Find:

```bash
find . -type f -print0
```

Read in Bash:

```bash
while IFS= read -r -d '' file; do
  printf 'file=%s\n' "$file"
done < <(find . -type f -print0)
```

Why this is good:

- preserves spaces;
- preserves tabs;
- preserves newlines;
- prevents word splitting;
- uses null as delimiter.

Bash-specific:

- `read -d ''`;
- process substitution.

For batch command execution:

```bash
find . -type f -name '*.log' -print0 |
xargs -0 gzip --
```

Caveat:

- `xargs -0` widely available but not POSIX;
- command may receive many files per invocation;
- if command has side effects, understand batching.

Safer with `find -exec`:

```bash
find . -type f -name '*.log' -exec gzip -- {} +
```

This avoids shell loop entirely and preserves path boundaries.

---

## 9. Avoid Parsing `ls`

Never do:

```bash
for file in $(ls); do
  ...
done
```

Reasons:

- `ls` output is for humans;
- output may be columnar;
- filenames with whitespace break;
- filenames with newlines break;
- colors/aliases can interfere;
- locale affects sorting;
- cannot distinguish weird names reliably.

Use glob:

```bash
for file in ./*; do
  [[ -e "$file" ]] || continue
  printf 'file=%s\n' "$file"
done
```

Or find:

```bash
find . -maxdepth 1 -type f -print0 |
while IFS= read -r -d '' file; do
  printf 'file=%s\n' "$file"
done
```

---

## 10. Globs as Data Source

Globs can be simple and readable:

```bash
for jar in target/*.jar; do
  [[ -e "$jar" ]] || continue
  printf 'jar=%s\n' "$jar"
done
```

Bash `nullglob`:

```bash
shopt -s nullglob
jars=(target/*.jar)
shopt -u nullglob

if ((${#jars[@]} == 0)); then
  die "no jar found"
fi
```

If exactly one jar expected:

```bash
shopt -s nullglob
jars=(target/*.jar)
shopt -u nullglob

case "${#jars[@]}" in
  0) die "no jar found in target/" ;;
  1) jar="${jars[0]}" ;;
  *) die "multiple jars found: ${jars[*]}" ;;
esac
```

Caveat: `${jars[*]}` for error message is okay-ish, but filenames with newlines can make output messy. For internal build artifacts, acceptable.

---

## 11. Field Splitting: `cut`, `awk`, `IFS`

If data is simple delimiter-separated and fields cannot contain delimiter, tools are fine.

Example colon file:

```text
dev:8080
staging:8081
prod:8082
```

Read:

```bash
while IFS=: read -r env port; do
  [[ -n "$env" ]] || continue
  [[ "$env" == \#* ]] && continue

  [[ "$port" =~ ^[0-9]+$ ]] || die "invalid port for env=$env: $port"
  printf 'env=%s port=%s\n' "$env" "$port"
done < env-ports.txt
```

This is not general CSV. It is a simple domain-specific line format.

`cut`:

```bash
cut -d: -f1 env-ports.txt
```

`awk`:

```bash
awk -F: '{print $1}' env-ports.txt
```

Guideline:

> Use delimiter splitting only when delimiter cannot appear inside fields or escaping rules are deliberately simple.

---

## 12. CSV: Do Not Pretend It Is Simple

CSV can contain:

```csv
id,name,comment
1,Alice,"hello, world"
2,Bob,"multi
line"
3,Carol,"quote "" inside"
```

This breaks simple:

```bash
IFS=, read -r id name comment
```

Because CSV has:

- quoted fields;
- escaped quotes;
- commas inside quotes;
- newlines inside quoted fields;
- optional headers;
- encoding issues.

Bash is not a CSV parser.

For simple internal comma-separated config where comma is forbidden in fields, do not call it “CSV”; call it “comma-delimited simple config” and enforce constraints.

For real CSV:

- use Python;
- use Miller (`mlr`);
- use csvkit;
- use a proper parser;
- use Java if part of application workflow.

Example Python one-liner is possible, but for maintainability, prefer small script file if logic grows.

---

## 13. JSON: Use `jq`, Not `grep`

Bad:

```bash
version="$(grep version package.json | cut -d'"' -f4)"
```

Breaks with whitespace, ordering, nested fields, formatting.

Good:

```bash
version="$(jq -r '.version' package.json)"
```

`-r` gives raw string, not JSON-quoted string.

Without `-r`:

```bash
jq '.version' package.json
```

Output:

```text
"1.2.3"
```

With `-r`:

```bash
jq -r '.version' package.json
```

Output:

```text
1.2.3
```

Validate:

```bash
version="$(jq -er '.version | select(type == "string")' package.json)" \
  || die "package.json must contain string .version"
```

`-e` makes jq exit non-zero for false/null.

---

## 14. JSON Construction with `jq`

Bad:

```bash
payload="{\"env\":\"$env\",\"version\":\"$version\"}"
```

This breaks if values contain quotes, backslashes, newlines.

Good:

```bash
payload="$(jq -n \
  --arg env "$env" \
  --arg version "$version" \
  '{env: $env, version: $version}')"
```

Use with curl:

```bash
curl \
  --fail \
  --show-error \
  --silent \
  --header 'Content-Type: application/json' \
  --data "$payload" \
  "$url"
```

For numeric:

```bash
payload="$(jq -n \
  --arg env "$env" \
  --argjson replicas "$replicas" \
  '{env: $env, replicas: $replicas}')"
```

Validate before `--argjson`:

```bash
[[ "$replicas" =~ ^[0-9]+$ ]] || die "replicas must be numeric"
```

---

## 15. JSON Arrays to Bash Arrays

Example JSON:

```json
{
  "modules": ["api", "worker", "scheduler"]
}
```

Read:

```bash
mapfile -t modules < <(jq -r '.modules[]' config.json)
```

Validate:

```bash
jq -e '.modules | type == "array" and all(.[]; type == "string")' config.json >/dev/null \
  || die "config.json .modules must be array of strings"

mapfile -t modules < <(jq -r '.modules[]' config.json)
```

Then:

```bash
for module in "${modules[@]}"; do
  printf 'module=%s\n' "$module"
done
```

Caveat: JSON strings can contain newlines. `jq -r '.modules[]'` emits raw strings separated by newline. If module names can contain newline, line-based mapfile is not fully safe.

For many project configs, module names are constrained and newline is invalid. Enforce:

```bash
for module in "${modules[@]}"; do
  [[ "$module" != *$'\n'* ]] || die "module contains newline"
done
```

Better: domain names should not allow newlines.

---

## 16. JSON Objects to Key-Value

Example:

```json
{
  "ports": {
    "dev": 8080,
    "staging": 8081,
    "prod": 8082
  }
}
```

Read with jq:

```bash
port="$(jq -er --arg env "$env" '.ports[$env]' config.json)" \
  || die "no port configured for env=$env"
```

Validate number:

```bash
port="$(jq -er --arg env "$env" '.ports[$env] | select(type == "number")' config.json)" \
  || die "port must be number for env=$env"
```

Convert to Bash associative array if needed:

```bash
declare -A ports=()

while IFS=$'\t' read -r key value; do
  ports["$key"]="$value"
done < <(jq -r '.ports | to_entries[] | [.key, .value] | @tsv' config.json)
```

Caveat: TSV escaping exists. `jq @tsv` escapes tabs/newlines/backslashes. Raw `read` will receive escaped sequences, not automatically unescaped to original. For simple keys/values, okay. For arbitrary strings, keep using jq queries rather than converting to Bash map.

---

## 17. YAML: Be Careful

YAML is complex. Do not parse YAML with `grep`/`sed`.

Bad:

```bash
image="$(grep image values.yaml | cut -d: -f2)"
```

YAML can contain:

- nested structures;
- anchors;
- multiline strings;
- comments;
- quoted/unquoted values;
- repeated keys depending parser;
- indentation significance.

Use a real parser:

- `yq`;
- application config parser;
- Python/Ruby library;
- Java if part of build logic.

If using `yq`, be aware there are multiple different `yq` tools with incompatible syntax. Pin tool and version in CI.

For automation stability, JSON is often easier than YAML.

---

## 18. Logs: Grep Is Fine, But Know the Contract

Log processing with Bash is okay when used for:

- simple diagnostics;
- CI summaries;
- extracting known markers;
- counting occurrences;
- quick health checks.

Example:

```bash
if grep -q 'BUILD SUCCESS' build.log; then
  log "build success marker found"
else
  warn "build success marker not found"
fi
```

Counting:

```bash
error_count="$(grep -c ' ERROR ' app.log || true)"
```

But `grep -c` returns 1 when no match? Actually `grep -c` still returns 1 if no selected lines. If using `set -e`, handle:

```bash
if error_count="$(grep -c ' ERROR ' app.log)"; then
  :
else
  status=$?
  if ((status == 1)); then
    error_count=0
  else
    die "grep failed status=$status"
  fi
fi
```

Alternative with awk:

```bash
error_count="$(awk '/ ERROR / { count++ } END { print count + 0 }' app.log)"
```

`awk` returns success unless file read error or syntax issue.

---

## 19. `sed`, `awk`, `grep`: Use the Right Tool

### 19.1 `grep`

Use for filtering lines:

```bash
grep -E 'ERROR|WARN' app.log
```

Use `-q` for existence:

```bash
if grep -q 'ERROR' app.log; then
  ...
fi
```

Use `--` when pattern may start with dash:

```bash
grep -- "$pattern" "$file"
```

### 19.2 `sed`

Use for simple stream edits:

```bash
sed 's/foo/bar/g' file.txt
```

But escaping arbitrary replacement is tricky.

Bad for JSON/YAML/CSV parsing.

### 19.3 `awk`

Use for field-based and record-based text processing:

```bash
awk '$3 == "ERROR" { count++ } END { print count + 0 }' app.log
```

`awk` is much better than complicated Bash loops for text calculations.

Guideline:

> If you are writing nested Bash loops to process columns, `awk` may be the better shell-native tool.

---

## 20. Sorting and Locale

`sort` behavior can depend on locale.

For deterministic CI output:

```bash
LC_ALL=C sort
```

Example:

```bash
printf '%s\n' "${items[@]}" | LC_ALL=C sort
```

Locale affects:

- sort order;
- character classes;
- case conversion;
- regex ranges in some tools.

For reproducible automation, set locale where needed:

```bash
export LC_ALL=C
```

But global `LC_ALL=C` may affect tools expecting UTF-8. Use local prefix when possible:

```bash
LC_ALL=C sort file.txt
```

---

## 21. Deduplication

Line-based:

```bash
sort file.txt | uniq
```

Or:

```bash
sort -u file.txt
```

Count:

```bash
sort file.txt | uniq -c
```

Caveats:

- line-based;
- locale affects sort;
- leading spaces in `uniq -c` output;
- cannot handle arbitrary null-delimited records unless using tool options like `sort -z` where available.

GNU tools support null options:

```bash
find . -type f -print0 | sort -z | xargs -0 ...
```

But `sort -z` is GNU-specific.

---

## 22. `xargs`: Powerful and Dangerous

Common:

```bash
find . -name '*.log' -print0 | xargs -0 rm --
```

Caveat: if no input, some `xargs` versions still run command with no args. GNU `xargs -r` avoids this, but `-r` is not portable to all xargs.

Safer with find:

```bash
find . -name '*.log' -exec rm -- {} +
```

Use `xargs` when:

- command does not support `-exec` style;
- batching matters;
- you understand no-input behavior;
- delimiter is safe (`-0`).

Avoid:

```bash
find . -name '*.log' | xargs rm
```

because line delimiter is unsafe for paths.

---

## 23. `find -exec`: Often Better Than Shell Loop

Example:

```bash
find . -type f -name '*.class' -exec rm -- {} +
```

Advantages:

- preserves path boundary;
- avoids shell loop;
- batches arguments;
- no parsing text output.

For per-file command:

```bash
find . -type f -name '*.log' -exec sh -c '
  for file do
    gzip -- "$file"
  done
' sh {} +
```

The first `sh` after script is `$0` inside `sh -c`; actual files are `$1...`.

This pattern is robust but less readable. Use when path correctness matters.

---

## 24. Command Output as API: Avoid Human Output When Possible

Many tools provide machine-readable output.

Prefer:

```bash
docker inspect --format '{{.Id}}' container
```

over parsing:

```bash
docker ps | grep container | awk '{print $1}'
```

Prefer:

```bash
kubectl get pods -o json
```

with `jq`

over:

```bash
kubectl get pods | grep ...
```

Prefer:

```bash
git rev-parse --show-toplevel
```

over parsing `git status`.

Prefer:

```bash
mvn help:evaluate -Dexpression=project.version -q -DforceStdout
```

over grepping `pom.xml`.

Rule:

> If a command has structured or explicit output mode, use it.

---

## 25. Capturing Single Values Safely

Function:

```bash
get_project_root() {
  git rev-parse --show-toplevel
}
```

Use:

```bash
if project_root="$(get_project_root)"; then
  :
else
  die "not inside a git repository"
fi
```

Validate single line:

```bash
if [[ "$project_root" == *$'\n'* || -z "$project_root" ]]; then
  die "unexpected project root output"
fi
```

Another example:

```bash
version="$(mvn help:evaluate -Dexpression=project.version -q -DforceStdout)"
[[ "$version" =~ ^[0-9]+(\.[0-9]+)*(-[A-Za-z0-9._-]+)?$ ]] || die "invalid project version: $version"
```

Do not assume command output is valid just because command succeeded.

---

## 26. Handling Binary Data

Bash variables cannot safely hold null bytes. Bash strings are not suitable for arbitrary binary data.

Do not:

```bash
data="$(cat binary.bin)"
```

Null bytes will be lost/handled incorrectly.

For binary:

- keep data in files;
- pipe directly between commands;
- use base64 if text transport needed;
- use a real language for manipulation.

Example:

```bash
base64 < binary.bin > binary.b64
```

But base64 wrapping differs by implementation. Use flags carefully and test portability.

For automation, avoid binary-in-variable.

---

## 27. Encoding and Line Endings

Scripts often fail due to CRLF:

```text
/usr/bin/env: ‘bash\r’: No such file or directory
```

Cause: Windows line endings.

Detect:

```bash
file script.sh
```

Convert:

```bash
dos2unix script.sh
```

or:

```bash
sed -i 's/\r$//' script.sh
```

macOS `sed -i` differs from GNU. Better use editor/git config.

In Git repo:

```gitattributes
*.sh text eol=lf
```

Encoding:

- prefer UTF-8;
- be cautious with locale;
- external tools may behave differently under non-UTF-8 locales.

---

## 28. Data Validation Boundary

Whenever Bash reads data from outside, validate.

External data sources:

- environment variables;
- CLI arguments;
- config files;
- command output;
- API response;
- file names;
- Git branch names;
- Docker image tags;
- Maven versions;
- JSON payloads.

Examples:

```bash
[[ "$env" =~ ^(dev|staging|prod)$ ]] || die "invalid env"
```

Use `case` for enum:

```bash
case "$env" in
  dev|staging|prod) ;;
  *) die "invalid env: $env" ;;
esac
```

Docker-ish tag validation can be complex. Use conservative validation:

```bash
[[ "$image_tag" =~ ^[A-Za-z0-9._/-]+:[A-Za-z0-9._-]+$ ]] || die "invalid image tag: $image_tag"
```

But do not pretend this fully implements Docker reference grammar. If exact compliance matters, use a library/tool.

---

## 29. When to Use Temporary Files Instead of Variables

Use temp file when:

- data is large;
- binary;
- multi-line exactness matters;
- you need inspectable artifact;
- multiple commands need same stream;
- pipeline status needs separation;
- you want to avoid subshell variable issue.

Example:

```bash
tmp_response="$(mktemp)"
tmp_headers="$(mktemp)"

if ! curl \
    --fail \
    --show-error \
    --silent \
    --dump-header "$tmp_headers" \
    --output "$tmp_response" \
    "$url"; then
  die "curl failed"
fi

jq -e '.status == "ok"' "$tmp_response" >/dev/null || die "unexpected response"
```

Cleanup with trap.

---

## 30. API Response Handling

Bad:

```bash
response="$(curl "$url")"
id="$(echo "$response" | grep id | cut -d: -f2)"
```

Good:

```bash
response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

curl \
  --fail \
  --show-error \
  --silent \
  --output "$response_file" \
  "$url"

id="$(jq -er '.id | select(type == "string")' "$response_file")" \
  || die "response missing string id"
```

If response is small, variable is okay:

```bash
response="$(curl --fail --show-error --silent "$url")"
id="$(jq -er '.id | select(type == "string")' <<< "$response")" \
  || die "response missing string id"
```

Here-string `<<<` is Bash-specific.

Caveat: do not print response if it may contain secrets.

---

## 31. JSON Error Responses

For API calls, HTTP error may return useful JSON body. But `curl --fail` may discard/handle body depending version/options.

One robust pattern:

```bash
response_file="$(mktemp)"
status_file="$(mktemp)"

http_status="$(
  curl \
    --silent \
    --show-error \
    --output "$response_file" \
    --write-out '%{http_code}' \
    "$url"
)" || die "curl transport failed"

case "$http_status" in
  2??)
    id="$(jq -er '.id' "$response_file")" || die "success response missing id"
    ;;
  401|403)
    die "authorization failed with HTTP $http_status"
    ;;
  5??)
    die "server error HTTP $http_status; retry may be safe only if operation is idempotent"
    ;;
  *)
    die "unexpected HTTP status $http_status"
    ;;
esac
```

This distinguishes transport failure from HTTP response status.

Add timeout/retry as needed.

---

## 32. Template Rendering: Avoid Ad-Hoc Sed for Complex Templates

Simple template:

```bash
cat > config.properties <<EOF
app.env=$env
server.port=$port
EOF
```

Good enough if values are simple and validated.

JSON template: use jq.

YAML/template with escaping requirements: use a real templating tool or language.

Bad:

```bash
sed "s/{{ENV}}/$env/g" template.yml
```

If `$env` contains `/`, `&`, newline, backslash, sed replacement breaks.

If you still use `sed`, escape replacement carefully. But this becomes complexity. Often better:

- generate JSON with `jq`;
- use envsubst for simple env replacement;
- use Helm/Kustomize for Kubernetes;
- use application config mechanisms;
- use Python/Java for complex templates.

---

## 33. `envsubst`

For simple environment substitution:

Template:

```text
app.env=${APP_ENV}
server.port=${APP_PORT}
```

Command:

```bash
envsubst < template.conf > output.conf
```

Caveats:

- substitutes environment variables only;
- no validation by default;
- can substitute more variables than intended;
- not always installed;
- not logic-capable;
- can produce invalid config if values need escaping.

Limit variables:

```bash
envsubst '${APP_ENV} ${APP_PORT}' < template.conf > output.conf
```

Validate before:

```bash
: "${APP_ENV:?APP_ENV is required}"
: "${APP_PORT:?APP_PORT is required}"
```

---

## 34. Data Shape Documentation

For internal scripts, document expected data shape.

Example:

```bash
# config/modules.txt format:
# - one module name per line
# - empty lines ignored
# - lines starting with # ignored
# - module names must match ^[a-z][a-z0-9-]*$
# - module names must not contain whitespace
```

Parser:

```bash
modules=()

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" ]] && continue
  [[ "$line" == \#* ]] && continue

  [[ "$line" =~ ^[a-z][a-z0-9-]*$ ]] || die "invalid module name: $line"

  modules+=("$line")
done < config/modules.txt
```

This is much safer than ambiguous parsing.

---

## 35. Data Contracts Between Scripts

If script A calls script B, define output contract.

Bad:

```bash
version="$(./compute-version.sh)"
```

But `compute-version.sh` may print logs.

Contract:

```text
compute-version.sh:
- stdout: exactly one line, semantic version string
- stderr: logs
- exit 0: version computed
- exit non-zero: no version
```

Implementation:

```bash
version="$(./compute-version.sh)" || die "failed to compute version"

[[ "$version" != *$'\n'* ]] || die "compute-version returned multiple lines"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid version: $version"
```

For structured output, use JSON:

```bash
metadata="$(./build-metadata.sh --json)"
artifact_id="$(jq -er '.artifactId' <<< "$metadata")"
version="$(jq -er '.version' <<< "$metadata")"
```

---

## 36. Prefer JSON for Script-to-Script Structured Data

Instead of custom multi-line output:

```text
artifactId=my-app
version=1.2.3
commit=abc123
```

Use JSON:

```json
{
  "artifactId": "my-app",
  "version": "1.2.3",
  "commit": "abc123"
}
```

Generate:

```bash
jq -n \
  --arg artifactId "$artifact_id" \
  --arg version "$version" \
  --arg commit "$commit" \
  '{artifactId:$artifactId, version:$version, commit:$commit}'
```

Consume:

```bash
metadata="$(./metadata.sh)"
artifact_id="$(jq -er '.artifactId | select(type == "string")' <<< "$metadata")"
```

Benefits:

- escaping handled;
- nested structure possible;
- validation easier;
- readable;
- language-neutral.

Cost:

- requires `jq`;
- still not ideal for huge data in variables.

---

## 37. When Bash Should Stop

Stop using Bash and move to a real language when:

1. You are implementing a parser.
2. You need robust CSV support.
3. You need complex YAML manipulation.
4. You need nested JSON transformations beyond simple jq.
5. You maintain large state.
6. You need domain objects.
7. You need unit tests around business logic.
8. You need concurrency beyond simple fan-out.
9. You need robust HTTP client behavior.
10. You need pagination, auth refresh, retry policy, and typed errors.
11. You need cross-platform path semantics.
12. You are writing more comments explaining Bash pitfalls than business intent.
13. Script exceeds a few hundred lines and keeps growing.

Good architecture:

- Bash orchestrates.
- `jq` handles JSON.
- `awk` handles simple text records.
- Java/Go/Python handles domain logic.
- Makefile provides workflow facade.
- CI calls stable scripts.

---

## 38. Example: Module Build Selector

File `modules.json`:

```json
{
  "modules": [
    {"name": "api", "type": "service", "enabled": true},
    {"name": "worker", "type": "service", "enabled": true},
    {"name": "experimental", "type": "service", "enabled": false}
  ]
}
```

Script:

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

main() {
  require_cmd jq

  local config="modules.json"

  jq -e '
    .modules
    | type == "array"
    and all(.[]; (.name|type=="string") and (.enabled|type=="boolean"))
  ' "$config" >/dev/null || die "invalid modules.json schema"

  local modules=()
  mapfile -t modules < <(
    jq -r '
      .modules[]
      | select(.enabled == true)
      | .name
    ' "$config"
  )

  local module
  for module in "${modules[@]}"; do
    [[ "$module" =~ ^[a-z][a-z0-9-]*$ ]] || die "invalid module name from config: $module"
    printf 'Building module: %s\n' "$module" >&2
    mvn -pl "$module" test
  done
}

main "$@"
```

This uses Bash for orchestration and jq for structured data.

---

## 39. Example: Safe File Compression

Goal: gzip all `.log` files under `logs/`, handling spaces/newlines.

```bash
#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '%s\n' "$*" >&2
}

main() {
  local root="logs"

  [[ -d "$root" ]] || {
    log "no logs directory"
    exit 0
  }

  find "$root" -type f -name '*.log' -print0 |
  while IFS= read -r -d '' file; do
    log "compressing: $file"
    gzip -- "$file"
  done
}

main "$@"
```

This loop runs in a subshell because of pipeline, but it does not need to update parent variables, so fine.

If you need count after loop:

```bash
count=0

while IFS= read -r -d '' file; do
  gzip -- "$file"
  count=$((count + 1))
done < <(find "$root" -type f -name '*.log' -print0)

log "compressed files: $count"
```

---

## 40. Example: API JSON Validation

```bash
#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

main() {
  : "${API_URL:?API_URL is required}"

  local response_file
  response_file="$(mktemp)"
  trap 'rm -f "$response_file"' EXIT

  curl \
    --fail \
    --silent \
    --show-error \
    --connect-timeout 5 \
    --max-time 30 \
    --output "$response_file" \
    "$API_URL/status"

  jq -e '
    type == "object"
    and (.status | type == "string")
    and (.version | type == "string")
  ' "$response_file" >/dev/null || die "invalid status response schema"

  local status
  local version

  status="$(jq -r '.status' "$response_file")"
  version="$(jq -r '.version' "$response_file")"

  printf 'status=%s version=%s\n' "$status" "$version"
}

main "$@"
```

stdout here is final data. Logs/errors go stderr.

---

## 41. Review Checklist: Data Handling

Ask these questions:

### Shape

- Is the data scalar, line-based, null-delimited, structured, or binary?
- Is the delimiter guaranteed not to appear inside fields?
- Is the format documented?
- Is the format validated?

### Streams

- Does stdout contain only data?
- Are logs on stderr?
- Are large streams kept streaming instead of loaded into variables?

### Lines

- Is `while IFS= read -r` used?
- Is final line without newline handled if needed?
- Is parent state updated inside pipeline loop accidentally?

### Files

- Are file paths handled with null delimiter if arbitrary?
- Is `find -print0` or `find -exec` used?
- Is parsing `ls` avoided?
- Are globs handled when no match?

### JSON/YAML/CSV

- Is JSON parsed with `jq`?
- Is JSON built with `jq`, not string concatenation?
- Is CSV parsed with a real parser if it is real CSV?
- Is YAML parsed with a real YAML parser?

### Safety

- Are values validated before being used in commands?
- Are patterns passed with `--` where needed?
- Are secrets kept out of logs?
- Is binary data kept out of Bash variables?

---

## 42. Mini Lab

### Lab 1 — Read lines safely

Create:

```bash
printf ' one\n\nthree\\backslash\nno-newline' > lines.txt
```

Read with:

```bash
while IFS= read -r line || [[ -n "$line" ]]; do
  printf '<%s>\n' "$line"
done < lines.txt
```

Compare with:

```bash
for line in $(cat lines.txt); do
  printf '<%s>\n' "$line"
done
```

---

### Lab 2 — File names with spaces

```bash
mkdir -p /tmp/bash-data-lab
cd /tmp/bash-data-lab
touch "hello world.log"
touch "normal.log"
```

Bad:

```bash
for f in $(find . -name '*.log'); do
  printf '<%s>\n' "$f"
done
```

Good:

```bash
find . -name '*.log' -print0 |
while IFS= read -r -d '' f; do
  printf '<%s>\n' "$f"
done
```

---

### Lab 3 — JSON with jq

Create:

```bash
cat > config.json <<'JSON'
{
  "env": "dev",
  "modules": ["api", "worker"]
}
JSON
```

Read:

```bash
env="$(jq -er '.env | select(type == "string")' config.json)"
mapfile -t modules < <(jq -r '.modules[]' config.json)
```

Print modules safely.

---

### Lab 4 — Build JSON payload

```bash
env='dev'
version='1.2.3"test'

payload="$(jq -n --arg env "$env" --arg version "$version" '{env:$env, version:$version}')"
printf '%s\n' "$payload"
```

Observe escaping.

---

### Lab 5 — CSV trap

Create:

```bash
cat > data.csv <<'CSV'
id,name,comment
1,Alice,"hello, world"
CSV
```

Try:

```bash
IFS=, read -r id name comment < <(tail -n +2 data.csv)
printf 'id=<%s> name=<%s> comment=<%s>\n' "$id" "$name" "$comment"
```

Observe why this is not real CSV parsing.

---

## 43. Design Exercise: Data Contract for Build Metadata

Design `scripts/build-metadata.sh` that outputs JSON:

```json
{
  "artifactId": "my-service",
  "version": "1.2.3",
  "commit": "abc123",
  "dirty": false,
  "timestamp": "2026-06-22T10:00:00Z"
}
```

Contract:

```text
stdout:
  exactly one JSON object

stderr:
  logs only

exit:
  0 if metadata produced
  non-zero if git/maven/version detection fails

validation:
  artifactId non-empty string
  version valid project version
  commit short hash
  dirty boolean
  timestamp ISO-like UTC
```

Implementation hints:

- use `mvn help:evaluate` or Gradle equivalent for version/artifact;
- use `git rev-parse --short HEAD`;
- use `git status --porcelain` for dirty check;
- use `jq -n` to build JSON;
- validate before output.

This is the kind of script-to-script contract that scales.

---

## 44. Part 006 Summary

Bash data handling is powerful when the data shape is simple and explicit.

Key takeaways:

1. Bash works with strings, arrays, streams, files, and exit codes—not typed objects.
2. Keep stdout as data and stderr as diagnostics.
3. Prefer streaming for large data.
4. Use `while IFS= read -r` for line-based data.
5. Avoid pipeline loops when parent variable mutation matters.
6. Use null delimiters for arbitrary file paths.
7. Never parse `ls`.
8. Use globs carefully and handle no-match cases.
9. Do not parse real CSV with `IFS=,`.
10. Do not parse JSON/YAML with grep/sed.
11. Use `jq` to read and build JSON.
12. Be careful converting structured data into Bash arrays.
13. Use machine-readable output modes from tools.
14. Keep binary data out of Bash variables.
15. Validate all external data before using it in commands.
16. Move to another language when parsing or data modeling becomes complex.

Part 007 will move from data to filesystem automation: safe file operations, atomic writes, locks, symlinks, destructive guards, and backup/rollback patterns.

---

## 45. Referensi Resmi dan Bacaan Lanjutan

- GNU Bash Reference Manual — Shell Parameters, Arrays, Redirections, Command Substitution.
- GNU Coreutils Manual — `sort`, `uniq`, `tr`, `mktemp`, `base64`, common text utilities.
- GNU Findutils Manual — `find`, `-print0`, `-exec`.
- jq Manual — JSON parsing, construction, `-r`, `-e`, `--arg`, `--argjson`.
- POSIX Shell Command Language — field splitting, command substitution, redirection.
- ShellCheck documentation — common data handling warnings.
- RFC 4180 and CSV parser documentation — for understanding why CSV is not simple delimiter splitting.

---

## 46. Status Seri

Seri belum selesai.

Progress:

- [x] Part 000 — Orientation: Scripting as Engineering Control Plane
- [x] Part 001 — Shell Mental Model: Process, Stream, Exit Code, Environment
- [x] Part 002 — Command Execution Semantics: Parsing, Expansion, Quoting
- [x] Part 003 — POSIX Shell Baseline: Portable Script Before Bash-Specific Script
- [x] Part 004 — Bash Fundamentals Without Toy Examples
- [x] Part 005 — Error Handling in Bash: Fail Fast, Fail Clear, Fail Safe
- [x] Part 006 — Data Handling in Bash: Text, Lines, Null Bytes, JSON, CSV
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
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-005.md">⬅️ Part 005 — Error Handling in Bash: Fail Fast, Fail Clear, Fail Safe</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-007.md">Part 007 — Filesystem Automation: Safe File Operations ➡️</a>
</div>

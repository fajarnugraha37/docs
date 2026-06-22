# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-002.md

# Part 002 — Command Execution Semantics: Parsing, Expansion, Quoting

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: memahami bagaimana shell mengubah teks command menjadi eksekusi proses, terutama parsing, expansion, quoting, word splitting, globbing, dan command substitution.

---

## 0. Posisi Part Ini dalam Seri

Part 001 membahas shell sebagai orchestrator proses:

- process;
- stream;
- exit code;
- environment;
- working directory;
- PATH;
- subshell;
- hidden state.

Part 002 membahas masalah yang lebih halus tetapi jauh lebih sering menyebabkan bug:

> Sebelum command berjalan, shell mengubah teks yang kamu tulis menjadi token, word, argument, redirection, assignment, dan expansion.

Di Java, ketika kamu memanggil method:

```java
deploy(env, version, dryRun);
```

compiler dan runtime menjaga struktur argument. String tetap string. List tetap list. Object tetap object.

Di shell, yang kamu tulis adalah teks:

```bash
deploy $env $version --dry-run=$dry_run
```

Sebelum program `deploy` menerima argument, shell melakukan banyak transformasi:

- quote processing;
- variable expansion;
- command substitution;
- arithmetic expansion;
- word splitting;
- pathname expansion/globbing;
- quote removal;
- redirection handling.

Karena itu shell bug sering bukan bug command yang dipanggil, tetapi bug di boundary sebelum command menerima argument.

Prinsip utama part ini:

> Shell scripting yang aman dimulai dari menjaga agar data tetap data, bukan berubah menjadi syntax atau argument tambahan.

---

## 1. Kenapa Parsing dan Expansion adalah Jantung Shell Correctness

Lihat script sederhana:

```bash
file=$1
rm -rf $file
```

Tampak biasa. Tetapi jika input:

```text
my folder
```

maka command menjadi kira-kira:

```bash
rm -rf my folder
```

dua path.

Jika input:

```text
*
```

maka command bisa menjadi semua file di current directory.

Jika input kosong:

```text

```

maka command menjadi:

```bash
rm -rf
```

atau dalam variasi lain bisa lebih buruk bila digabung dengan path.

Jika input:

```text
--no-preserve-root /
```

maka argument bisa berubah menjadi option.

Masalahnya bukan hanya `rm`. Masalahnya adalah:

```bash
$file
```

tidak otomatis berarti satu argument data. Ia adalah unquoted expansion yang bisa mengalami word splitting dan globbing.

Shell tidak punya tipe `Path`, `String`, `List<String>`, atau `CommandArg`. Semua harus dijaga lewat disiplin syntax.

---

## 2. Model Eksekusi Tingkat Tinggi

Saat shell membaca command, kira-kira alurnya:

```text
raw text
  ↓
lexing/tokenization
  ↓
parsing into command structure
  ↓
expansions
  ↓
redirection setup
  ↓
command lookup
  ↓
process execution / builtin execution
  ↓
exit status
```

Untuk Bash, ekspansi command line dilakukan setelah line dibagi menjadi token. Bash mendokumentasikan urutan expansion seperti brace expansion, tilde expansion, parameter/variable expansion, command substitution, arithmetic expansion, word splitting, filename expansion, dan quote removal.

Penting: ini bukan sekadar detail akademik. Urutan ini menentukan apakah sebuah variable menjadi satu argument, banyak argument, nama file, atau bahkan tidak ada argument.

---

## 3. Word, Token, Argument: Jangan Dicampur

Dalam shell, istilah ini perlu dibedakan.

### 3.1 Raw text

Yang kamu tulis:

```bash
printf '%s\n' "$name"
```

### 3.2 Token / word shell

Shell membaca command menjadi komponen sintaksis:

```text
printf
'%s\n'
"$name"
```

Quote memengaruhi bagaimana word dibaca dan diekspansi.

### 3.3 Argument program

Program menerima argument setelah expansion dan quote removal.

Jika:

```bash
name="Alice Smith"
printf '%s\n' "$name"
```

Program `printf` menerima:

```text
argv[0] = printf
argv[1] = %s\n
argv[2] = Alice Smith
```

Satu argument untuk `Alice Smith`.

Jika:

```bash
name="Alice Smith"
printf '%s\n' $name
```

Program menerima:

```text
argv[0] = printf
argv[1] = %s\n
argv[2] = Alice
argv[3] = Smith
```

Dua argument karena word splitting.

Mental model yang benar:

> Quote tidak sekadar “menampilkan string”. Quote menentukan apakah hasil expansion tetap satu word atau boleh dipecah.

---

## 4. Shell Quote: Single Quote, Double Quote, Backslash

### 4.1 Single quote: literal paling kuat

```bash
printf '%s\n' '$HOME'
```

Output:

```text
$HOME
```

Di dalam single quote, hampir semua karakter literal. Variable tidak diekspansi.

Cocok untuk:

- string literal;
- regex sederhana;
- JSON fragment yang tidak butuh interpolasi;
- command contoh;
- pattern yang tidak ingin diekspansi shell.

Keterbatasan: single quote tidak bisa langsung mengandung single quote.

Untuk string:

```text
It's fine
```

Bisa ditulis:

```bash
printf '%s\n' 'It'\''s fine'
```

Ini terlihat aneh, tetapi artinya:

- `'It'` literal;
- `\'` single quote escaped di luar single quote;
- `'s fine'` literal.

Untuk script yang sering membuat string kompleks, ini sinyal bahwa mungkin Bash bukan tool terbaik untuk membangun struktur data kompleks.

---

### 4.2 Double quote: allow expansion, prevent splitting/globbing

```bash
name="Alice Smith"
printf '%s\n' "$name"
```

Double quote masih mengizinkan:

- parameter expansion: `$name`;
- command substitution: `$(...)`;
- arithmetic expansion: `$((...))`;
- beberapa escape sequence tertentu.

Tetapi double quote mencegah word splitting dan filename expansion pada hasil expansion.

Ini adalah default aman:

```bash
"$var"
```

Rule praktis:

> Quote hampir semua variable expansion kecuali kamu sengaja ingin splitting/globbing dan sudah bisa menjelaskan alasannya.

Contoh:

```bash
cp "$source_file" "$target_dir/"
curl -H "Authorization: Bearer $token" "$url"
docker build -t "$image_tag" "$context_dir"
```

---

### 4.3 Backslash: escape karakter berikutnya

```bash
printf "hello \"world\"\n"
```

Backslash berguna, tetapi bisa membingungkan karena maknanya berbeda dalam single quote, double quote, dan unquoted context.

Contoh escaping space:

```bash
cat my\ file.txt
```

Ini menghasilkan satu argument:

```text
my file.txt
```

Namun dalam script, lebih baik pakai quote:

```bash
cat "my file.txt"
```

---

## 5. Expansion Overview

Bash punya beberapa expansion penting:

1. Brace expansion
2. Tilde expansion
3. Parameter and variable expansion
4. Command substitution
5. Arithmetic expansion
6. Word splitting
7. Filename expansion/pathname expansion/globbing
8. Quote removal

Tidak semuanya berlaku dalam semua context. Assignment, `[[ ... ]]`, `case`, array assignment, here-doc, dan redirection punya nuance masing-masing.

Tujuan part ini bukan menghafal semua corner case, tetapi membangun model aman.

---

## 6. Brace Expansion

Brace expansion terjadi sangat awal dan bersifat tekstual.

Contoh:

```bash
echo file-{a,b,c}.txt
```

Output:

```text
file-a.txt file-b.txt file-c.txt
```

Contoh range:

```bash
echo {1..5}
```

Output:

```text
1 2 3 4 5
```

Contoh nested:

```bash
echo {dev,staging,prod}-{api,worker}
```

Output:

```text
dev-api dev-worker staging-api staging-worker prod-api prod-worker
```

Brace expansion tidak melihat filesystem. Ia hanya menghasilkan teks.

Contoh:

```bash
echo /path/not/exist/{a,b}
```

Tetap menghasilkan:

```text
/path/not/exist/a /path/not/exist/b
```

### 6.1 Bahaya brace expansion

Brace expansion bisa membuat banyak argument tanpa sadar:

```bash
rm -rf /tmp/app-{old,new}
```

Ini bisa benar, tetapi harus jelas.

Jangan gunakan brace expansion untuk data dari user. Brace expansion terjadi sebelum parameter expansion, jadi ini tidak bekerja seperti yang sering diasumsikan:

```bash
items="a,b,c"
echo {$items}
```

Output bukan `a b c`. Biasanya menjadi literal atau bentuk yang tidak diharapkan.

Brace expansion cocok untuk command manual dan script internal yang sangat jelas, tetapi jangan jadikan mekanisme parsing data.

---

## 7. Tilde Expansion

```bash
echo ~
echo ~/project
```

`~` diekspansi menjadi home directory.

Namun tilde expansion punya aturan posisi. Ini bekerja:

```bash
cd ~/project
```

Ini tidak seperti yang mungkin diasumsikan:

```bash
dir="~/project"
cd "$dir"
```

Dalam assignment, `~` di dalam quote tidak diekspansi. Variable `dir` berisi literal `~/project`.

Lebih baik:

```bash
dir="$HOME/project"
cd "$dir"
```

Rule praktis:

> Dalam script, gunakan `$HOME` untuk path home. Jangan simpan `~` dalam variable dan berharap shell selalu mengekspansinya.

---

## 8. Parameter Expansion: Variable Bukan Sekadar `$var`

Parameter expansion adalah salah satu fitur Bash paling kuat.

Dasar:

```bash
name="Alice"
echo "$name"
echo "${name}"
```

Gunakan `${name}` saat variable berdampingan dengan karakter lain:

```bash
service="api"
echo "${service}_PORT"
```

Tanpa brace:

```bash
echo "$service_PORT"
```

shell mencari variable bernama `service_PORT`.

---

### 8.1 Default value

```bash
env="${APP_ENV:-dev}"
```

Artinya: jika `APP_ENV` unset atau kosong, gunakan `dev`.

Perbedaan penting:

```bash
${VAR-default}
${VAR:-default}
```

- `-` memakai default hanya jika VAR unset.
- `:-` memakai default jika VAR unset atau empty.

Contoh:

```bash
VAR=""
echo "${VAR-default}"   # empty
echo "${VAR:-default}"  # default
```

---

### 8.2 Required value

```bash
: "${APP_ENV:?APP_ENV is required}"
```

Jika `APP_ENV` unset atau empty, shell error dan command gagal.

Ini sangat berguna untuk validasi environment di awal script.

Contoh:

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${APP_ENV:?APP_ENV is required}"
: "${API_TOKEN:?API_TOKEN is required}"
```

Namun hati-hati: jangan sampai error message mencetak secret value. Pesan error cukup menyebut nama variable.

---

### 8.3 Assign default jika unset/empty

```bash
: "${APP_ENV:=dev}"
```

Jika `APP_ENV` unset atau empty, set menjadi `dev`.

Gunakan dengan hati-hati karena ini mengubah state shell.

---

### 8.4 Alternative value

```bash
echo "${CI:+running in CI}"
```

Jika `CI` set dan non-empty, hasilnya `running in CI`.

---

### 8.5 String length

```bash
name="Alice"
echo "${#name}"
```

Output:

```text
5
```

---

### 8.6 Prefix/suffix removal

```bash
file="archive.tar.gz"

echo "${file%.gz}"      # archive.tar
echo "${file%%.*}"      # archive
echo "${file#*.}"       # tar.gz
echo "${file##*.}"      # gz
```

Operator:

| Operator | Makna |
|---|---|
| `${var#pattern}` | hapus shortest prefix match |
| `${var##pattern}` | hapus longest prefix match |
| `${var%pattern}` | hapus shortest suffix match |
| `${var%%pattern}` | hapus longest suffix match |

Pattern di sini adalah shell pattern, bukan regex.

---

### 8.7 Search replace Bash-specific

```bash
text="api-api-worker"
echo "${text/api/service}"    # service-api-worker
echo "${text//api/service}"   # service-service-worker
```

Ini Bash-specific, bukan POSIX baseline.

---

## 9. Word Splitting: Bug Generator Utama

Setelah parameter expansion, command substitution, dan arithmetic expansion, shell melakukan word splitting pada hasil yang tidak di-quote.

Default splitting memakai `IFS`, biasanya whitespace: space, tab, newline.

Contoh:

```bash
name="Alice Smith"
printf '<%s>\n' $name
```

Output:

```text
<Alice>
<Smith>
```

Sedangkan:

```bash
printf '<%s>\n' "$name"
```

Output:

```text
<Alice Smith>
```

Satu argument.

---

### 9.1 Word splitting bukan parsing CSV

```bash
items="one,two,three"
IFS=,
for item in $items; do
  echo "$item"
done
```

Ini bisa terlihat berguna, tetapi rapuh:

- tidak menangani escaping;
- tidak menangani quoted comma;
- global `IFS` bisa bocor jika tidak hati-hati;
- whitespace behavior punya aturan khusus;
- empty field bisa hilang.

Untuk data kompleks, gunakan format dan parser yang benar: JSON dengan `jq`, CSV parser, atau bahasa lain.

---

### 9.2 Kapan unquoted expansion memang diinginkan?

Ada kasus langka:

```bash
set -- $words
```

Jika kamu memang ingin shell memecah string menjadi positional parameters.

Namun untuk production script, ini harus disengaja dan diberi komentar.

Contoh lebih eksplisit untuk array Bash:

```bash
read -r -a args <<< "$words"
```

Tetap hati-hati: ini splitting berdasarkan IFS, bukan parsing shell quote.

Jangan menyimpan command lengkap dalam string lalu menjalankannya.

Buruk:

```bash
cmd="grep -i error app.log"
$cmd
```

Lebih baik array:

```bash
cmd=(grep -i error app.log)
"${cmd[@]}"
```

Array akan dibahas lebih dalam di Part 004.

---

## 10. Filename Expansion / Globbing

Setelah word splitting, shell melakukan filename expansion pada pattern unquoted seperti:

- `*`
- `?`
- `[abc]`
- `[a-z]`

Contoh:

```bash
echo *.java
```

Jika ada file:

```text
A.java B.java
```

Maka menjadi:

```text
A.java B.java
```

Jika tidak ada match, default Bash membiarkan pattern literal:

```bash
echo *.doesnotexist
```

Output:

```text
*.doesnotexist
```

Namun shell lain atau opsi Bash bisa berbeda.

---

### 10.1 Bahaya globbing dari variable

```bash
pattern="*"
echo $pattern
```

Ini bisa mencetak semua file di directory.

Dengan quote:

```bash
echo "$pattern"
```

Output:

```text
*
```

Inilah alasan rule “quote variable” begitu penting.

---

### 10.2 Globbing untuk file list

Globbing bukan selalu buruk.

Contoh:

```bash
for file in ./*.java; do
  printf 'file=%s\n' "$file"
done
```

Masalah: jika tidak ada file `.java`, loop akan berjalan sekali dengan literal `./*.java`.

Guard:

```bash
for file in ./*.java; do
  [ -e "$file" ] || continue
  printf 'file=%s\n' "$file"
done
```

Bash-specific alternative:

```bash
shopt -s nullglob
for file in ./*.java; do
  printf 'file=%s\n' "$file"
done
```

Tetapi `shopt` Bash-specific dan stateful.

---

## 11. Quote Removal

Quote dipakai oleh shell untuk menentukan grouping dan expansion behavior. Setelah semua proses, quote dihapus sebelum argument dikirim ke program.

Contoh:

```bash
printf '%s\n' "hello"
```

Program tidak menerima quote. Ia menerima argument:

```text
hello
```

Quote bukan bagian dari data kecuali quote itu sendiri di-escape atau berada dalam quote context lain.

Contoh mencetak quote:

```bash
printf '%s\n' '"hello"'
```

Output:

```text
"hello"
```

---

## 12. Command Substitution

Command substitution menjalankan command dan mengganti expression dengan stdout command tersebut.

Modern syntax:

```bash
version="$(cat VERSION)"
```

Legacy syntax:

```bash
version=`cat VERSION`
```

Gunakan `$(...)` karena lebih mudah dibaca dan nested.

Contoh:

```bash
current_branch="$(git branch --show-current)"
printf 'branch=%s\n' "$current_branch"
```

---

### 12.1 Command substitution menghapus trailing newline

Ini penting.

```bash
value="$(printf 'hello\n\n')"
printf '<%s>\n' "$value"
```

Trailing newline dihapus oleh command substitution.

Jangan gunakan command substitution untuk data yang harus mempertahankan trailing newline secara persis.

---

### 12.2 Quote command substitution

Buruk:

```bash
files=$(find . -name '*.java')
printf '%s\n' $files
```

Masalah:

- word splitting;
- globbing;
- file dengan spasi rusak;
- newline sebagai separator tidak cukup aman;
- command substitution menghapus trailing newline.

Lebih baik untuk simple single value:

```bash
version="$(cat VERSION)"
```

Untuk banyak file, gunakan loop null-delimited:

```bash
find . -name '*.java' -print0 |
while IFS= read -r -d '' file; do
  printf 'file=%s\n' "$file"
done
```

`read -d ''` Bash-specific. POSIX alternatives lebih terbatas dan akan dibahas di Part 006.

---

### 12.3 Command substitution hanya menangkap stdout

```bash
value="$(some_command)"
```

Hanya stdout masuk variable. Stderr tetap ke terminal kecuali diarahkan.

Untuk menangkap stderr juga:

```bash
value="$(some_command 2>&1)"
```

Tetapi hati-hati: sekarang data dan diagnostic tercampur.

Lebih baik desain command agar stdout adalah data, stderr adalah log.

---

### 12.4 Exit status command substitution

Assignment dengan command substitution punya nuance.

```bash
value="$(some_command)"
status=$?
```

`status` adalah exit status assignment. Dalam Bash, jika assignment berisi command substitution, status assignment adalah status command substitution terakhir.

Namun jika kamu menambahkan command lain, bisa tertimpa.

Aman:

```bash
if value="$(some_command)"; then
  printf 'value=%s\n' "$value"
else
  status=$?
  printf 'some_command failed: %s\n' "$status" >&2
  exit "$status"
fi
```

---

## 13. Arithmetic Expansion

```bash
count=3
echo "$((count + 1))"
```

Arithmetic expansion berguna untuk integer arithmetic.

Contoh:

```bash
retries=0
max_retries=3

while [ "$retries" -lt "$max_retries" ]; do
  retries=$((retries + 1))
  printf 'attempt %s\n' "$retries"
done
```

Hati-hati:

- Bash arithmetic umumnya integer;
- leading zero bisa dianggap octal di beberapa context;
- variable dalam arithmetic context bisa dievaluasi dengan aturan khusus;
- jangan memasukkan input user tidak tervalidasi ke arithmetic expression kompleks.

Untuk angka sederhana:

```bash
case "$port" in
  ''|*[!0-9]*)
    echo "port must be numeric" >&2
    exit 2
    ;;
esac
```

---

## 14. Redirection Semantics

Redirection mengubah file descriptor untuk command.

Contoh:

```bash
command > out.txt
command 2> err.txt
command > out.txt 2> err.txt
command > combined.txt 2>&1
```

Urutan penting:

```bash
command > combined.txt 2>&1
```

berbeda dari:

```bash
command 2>&1 > combined.txt
```

Redirection word juga mengalami expansion tertentu. Jika hasilnya banyak word, Bash bisa error.

Contoh buruk:

```bash
log_file="logs/app log.txt"
command > $log_file
```

Bisa menjadi redirection ambigu karena word splitting.

Benar:

```bash
command > "$log_file"
```

---

## 15. Assignment Context Berbeda dari Command Argument Context

Ini penting.

```bash
x=$value
```

Dalam assignment, word splitting dan pathname expansion tidak terjadi pada right-hand side assignment di Bash/POSIX shell assignment context.

Contoh:

```bash
value="hello world"
x=$value
printf '<%s>\n' "$x"
```

Output:

```text
<hello world>
```

Tetapi:

```bash
value="hello world"
printf '<%s>\n' $value
```

Output:

```text
<hello>
<world>
```

Meskipun assignment lebih aman dari splitting, tetap gunakan quote untuk clarity:

```bash
x="$value"
```

Terutama saat value berupa command substitution:

```bash
x="$(some_command)"
```

---

## 16. `test`, `[ ... ]`, dan `[[ ... ]]`

Shell conditional adalah sumber bug besar.

### 16.1 POSIX `[ ... ]`

`[` adalah command. Biasanya builtin, tetapi tetap command.

Contoh:

```bash
if [ "$name" = "alice" ]; then
  echo "hello"
fi
```

Spasi penting:

```bash
[ "$name" = "alice" ]
```

bukan:

```bash
["$name"="alice"]
```

Quote variable penting:

```bash
if [ "$file" = "$expected" ]; then
  ...
fi
```

Tanpa quote, empty value bisa merusak expression.

Buruk:

```bash
if [ $name = alice ]; then
  ...
fi
```

Jika `name` kosong, menjadi:

```bash
[ = alice ]
```

error.

---

### 16.2 Bash `[[ ... ]]`

`[[ ... ]]` adalah Bash keyword dengan semantics lebih aman untuk banyak kasus.

Contoh:

```bash
if [[ $name == alice ]]; then
  echo "hello"
fi
```

Di dalam `[[ ... ]]`, word splitting dan pathname expansion tidak dilakukan pada variable expansion seperti di command biasa.

Namun tetap ada nuance:

- RHS `==` bisa menjadi pattern jika unquoted;
- regex matching dengan `=~` punya aturan quoting sendiri;
- `[[` bukan POSIX.

Contoh pattern:

```bash
name="alice.txt"

if [[ $name == *.txt ]]; then
  echo "text file"
fi
```

Jika kamu ingin literal comparison:

```bash
pattern="*.txt"
if [[ $name == "$pattern" ]]; then
  echo "literal match"
fi
```

Tanpa quote, RHS dianggap pattern.

---

### 16.3 Rule praktis

Untuk POSIX sh:

```bash
[ "$a" = "$b" ]
```

Untuk Bash script:

```bash
[[ $a == "$b" ]]
```

Untuk pattern matching di Bash:

```bash
[[ $file == *.java ]]
```

Untuk regex:

```bash
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
```

Regex quoting punya nuance: quote seluruh regex bisa mengubah perilaku matching di beberapa kasus. Simpan regex dalam variable jika kompleks:

```bash
semver_re='^[0-9]+\.[0-9]+\.[0-9]+$'
if [[ $version =~ $semver_re ]]; then
  echo "valid"
fi
```

---

## 17. `"$@"` vs `"$*"`: Forwarding Arguments dengan Benar

Ini critical untuk wrapper script.

Misalnya script:

```bash
#!/usr/bin/env bash
echo "args:"
printf '<%s>\n' "$@"
```

`"$@"` mempertahankan setiap positional parameter sebagai argument terpisah.

Contoh:

```bash
./script.sh "hello world" "*.java"
```

Output:

```text
<hello world>
<*.java>
```

Untuk forwarding:

```bash
mvn "$@"
```

Jika user menjalankan:

```bash
./mvn-wrapper.sh -Dname="Alice Smith" test
```

Maka argument tetap benar.

Buruk:

```bash
mvn $@
```

atau:

```bash
mvn "$*"
```

Perbedaan:

- `"$@"`: setiap arg tetap arg sendiri.
- `"$*"`: semua arg digabung menjadi satu string, dipisahkan karakter pertama `IFS`.

Rule:

> Untuk meneruskan argument, hampir selalu gunakan `"$@"`.

---

## 18. Array Bash untuk Command Construction

Jangan simpan command lengkap dalam string.

Buruk:

```bash
cmd="docker build -t $image_tag $context"
$cmd
```

Masalah:

- splitting;
- globbing;
- quote dalam variable tidak bekerja seperti syntax;
- injection risk;
- path dengan spasi rusak.

Lebih benar Bash:

```bash
cmd=(docker build -t "$image_tag" "$context")
"${cmd[@]}"
```

Menambahkan optional args:

```bash
cmd=(docker build -t "$image_tag")

if [ "$no_cache" = "true" ]; then
  cmd+=(--no-cache)
fi

cmd+=("$context")

"${cmd[@]}"
```

Ini mirip `List<String>` untuk `ProcessBuilder` di Java.

Java analogy:

```java
List<String> cmd = new ArrayList<>();
cmd.add("docker");
cmd.add("build");
cmd.add("-t");
cmd.add(imageTag);
cmd.add(context);
new ProcessBuilder(cmd).start();
```

Bash array adalah cara menjaga argument boundary.

Catatan: array bukan POSIX sh. Untuk portability POSIX, desain command construction harus lebih sederhana atau memakai `set --`.

---

## 19. `eval`: Hampir Selalu Sinyal Bahaya

`eval` membuat shell mem-parsing string sebagai shell code.

Contoh:

```bash
cmd="echo hello"
eval "$cmd"
```

Masalahnya: data bisa menjadi code.

Contoh berbahaya:

```bash
user_input='hello; rm -rf important'
eval "echo $user_input"
```

Shell akan mem-parsing `;` sebagai command separator.

Prinsip:

> Jangan gunakan `eval` untuk membangun command dari data.

Alternatif:

- gunakan array Bash;
- gunakan case statement;
- gunakan function dispatch eksplisit;
- gunakan config format yang tidak dieksekusi sebagai shell;
- gunakan JSON/YAML parser;
- gunakan bahasa lain untuk dynamic behavior kompleks.

Ada kasus advanced yang valid untuk `eval`, tetapi di production automation internal, default review posture harus: **tolak sampai ada alasan kuat**.

---

## 20. `source` pada File Konfigurasi: Bahaya Tersembunyi

Banyak script melakukan:

```bash
source .env
```

Jika `.env` berisi:

```bash
APP_ENV=dev
```

terlihat nyaman.

Tetapi `source` mengeksekusi file sebagai shell code.

Jika `.env` berisi:

```bash
rm -rf "$HOME"
```

itu akan dieksekusi.

Bahkan tanpa niat jahat, value kompleks bisa menyebabkan error:

```bash
PASSWORD=abc def
```

Shell membaca `def` sebagai command.

Lebih aman:

- batasi `.env` ke format sederhana;
- jangan source file tidak trusted;
- gunakan parser `.env` yang jelas;
- validasi variable setelah load;
- jangan commit secret;
- dokumentasikan syntax yang didukung.

Untuk internal repo trusted, `source .env` bisa diterima dengan guard dan ekspektasi jelas, tetapi jangan anggap `.env` sebagai data murni bila di-source.

---

## 21. Option Injection: Quote Saja Tidak Cukup

Quoting menjaga argument boundary, tetapi tidak selalu menjaga semantic.

Contoh:

```bash
file="--help"
rm "$file"
```

Argument tetap satu, tetapi `rm` bisa menganggapnya sebagai option.

Gunakan `--` untuk mengakhiri option parsing jika command mendukung:

```bash
rm -- "$file"
```

Contoh:

```bash
grep -- "$pattern" "$file"
cp -- "$source" "$target"
```

Namun tidak semua command mendukung `--`, terutama beberapa builtins atau command non-GNU/portable environment.

Prinsip:

> Quote mencegah splitting/globbing. `--` mencegah data diawali dash dianggap option.

Untuk path yang mungkin diawali `-`, gunakan `./` prefix atau `--`.

---

## 22. Newline, Tab, Space: Filename Bisa Aneh

Unix filename bisa mengandung banyak karakter, termasuk space dan newline. Tidak semua script perlu mendukung semua karakter ekstrem, tetapi script harus sadar boundary.

Buruk:

```bash
for file in $(find . -type f); do
  echo "$file"
done
```

Masalah:

- command substitution;
- word splitting;
- file dengan spasi/newline rusak.

Lebih baik:

```bash
find . -type f -print0 |
while IFS= read -r -d '' file; do
  printf 'file=%s\n' "$file"
done
```

Bash-specific because `read -d`.

Jika portability POSIX penting, gunakan `find ... -exec`:

```bash
find . -type f -exec sh -c '
  for file do
    printf "%s\n" "$file"
  done
' sh {} +
```

Ini lebih advanced, tetapi menjaga argument boundary.

---

## 23. IFS: Powerful but Dangerous

`IFS` menentukan field splitting.

Default kira-kira:

```bash
space tab newline
```

Banyak script mengubah IFS:

```bash
IFS=,
```

Masalah: perubahan global bisa memengaruhi expansion berikutnya.

Lebih aman gunakan local scope di function:

```bash
parse_csvish() {
  local IFS=,
  read -r a b c <<< "$1"
}
```

Atau one-command context:

```bash
IFS=, read -r a b c <<< "$line"
```

Tetapi jangan mengira ini parsing CSV penuh. Ini hanya split sederhana.

---

## 24. Here Document dan Here String

### 24.1 Here document

```bash
cat <<EOF
Hello $USER
EOF
```

Variable diekspansi.

Jika delimiter di-quote:

```bash
cat <<'EOF'
Hello $USER
EOF
```

Variable tidak diekspansi.

Ini sangat berguna untuk template literal.

Contoh menghasilkan config dengan interpolasi:

```bash
cat > app.conf <<EOF
env=$APP_ENV
port=$PORT
EOF
```

Contoh menghasilkan script literal tanpa expansion:

```bash
cat > child.sh <<'EOF'
#!/usr/bin/env bash
echo "$HOME"
EOF
```

Rule:

> Quote delimiter here-doc jika kontennya harus literal.

---

### 24.2 Here string Bash-specific

```bash
grep pattern <<< "$text"
```

Here string mengirim string sebagai stdin ke command. Ini Bash/ksh/zsh feature, bukan POSIX sh.

POSIX alternative:

```bash
printf '%s\n' "$text" | grep pattern
```

Namun pipeline bisa membuat subshell bila dipakai dengan loop. Jadi pilih sesuai context.

---

## 25. Red Flags yang Harus Langsung Terlihat Saat Review

Saat review Bash script, mata harus otomatis menangkap pola ini:

```bash
rm -rf $dir
cp $src $dst
for x in $(...)
cmd="$tool $args"
eval "$cmd"
grep $pattern $file
[ $x = yes ]
cat file | while read line
source .env
docker run $opts image
kubectl delete $resource $name
```

Bukan semua pasti salah, tetapi semuanya perlu pertanyaan:

- Apakah variable sudah diquote?
- Apakah argument boundary terjaga?
- Apakah option injection dicegah?
- Apakah command substitution memecah data?
- Apakah `eval` benar-benar perlu?
- Apakah file config dieksekusi sebagai code?
- Apakah loop aman untuk spasi/newline?
- Apakah command destructive punya guard?
- Apakah failure tertangkap?

---

## 26. Safe Defaults: Style Rules Awal

Untuk Bash production script, baseline awal:

```bash
#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

: "${APP_ENV:?APP_ENV is required}"

cmd=(some-tool --env "$APP_ENV")

if [ "${DRY_RUN:-false}" = "true" ]; then
  cmd+=(--dry-run)
fi

"${cmd[@]}"
```

Style rules:

1. Quote variable: `"$var"`.
2. Use `"${var}"` when concatenating.
3. Use `"$@"` for forwarding args.
4. Use arrays for dynamic command construction in Bash.
5. Use `--` before user-controlled path/pattern where supported.
6. Avoid `eval`.
7. Avoid `for x in $(command)`.
8. Keep stdout for data, stderr for logs.
9. Validate required env/args early.
10. Prefer explicit `if` over clever `&& ||`.

---

## 27. Deep Example: Safe Wrapper Around Maven

Fragile wrapper:

```bash
#!/bin/bash
profile=$1
mvn -P $profile clean test
```

Problems:

- `$1` might be empty;
- unquoted profile;
- profile starting with `-` can be interpreted as option;
- no usage message;
- no dependency validation;
- no project root resolution;
- no command boundary.

Better:

```bash
#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  verify-profile.sh <profile>

Examples:
  verify-profile.sh unit
  verify-profile.sh integration
EOF
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

if [ "$#" -ne 1 ]; then
  usage
  exit 2
fi

profile="$1"

case "$profile" in
  unit|integration|smoke)
    ;;
  *)
    die "unsupported profile: $profile"
    ;;
esac

require_cmd mvn

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"

cd "$project_root"

cmd=(mvn -P "$profile" clean test)

printf 'Running:' >&2
printf ' %q' "${cmd[@]}" >&2
printf '\n' >&2

"${cmd[@]}"
```

Notes:

- `"$#"` memastikan jumlah argument.
- `case` whitelist mencegah profile arbitrary.
- `cmd=(...)` menjaga argument.
- `${cmd[@]}` menjalankan dengan boundary benar.
- log command ke stderr.
- `printf %q` Bash-specific untuk debug shell-escaped representation.

---

## 28. Deep Example: Building `curl` Command Safely

Fragile:

```bash
curl -H "Authorization: Bearer $TOKEN" $API_URL/deploy?env=$ENV
```

Problems:

- `TOKEN` mungkin kosong;
- URL tidak diquote;
- query string bisa rusak;
- env tidak divalidasi;
- token bisa muncul di debug log jika command dicetak sembarangan;
- API URL mungkin mengandung trailing slash;
- curl failure semantics perlu dipahami.

Better:

```bash
#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

: "${API_URL:?API_URL is required}"
: "${TOKEN:?TOKEN is required}"
: "${APP_ENV:?APP_ENV is required}"

case "$APP_ENV" in
  dev|staging|prod)
    ;;
  *)
    die "invalid APP_ENV: $APP_ENV"
    ;;
esac

api_url="${API_URL%/}"
endpoint="${api_url}/deploy"

cmd=(
  curl
  --fail
  --show-error
  --silent
  --request POST
  --header "Authorization: Bearer $TOKEN"
  --header "Content-Type: application/json"
  --data "{\"env\":\"$APP_ENV\"}"
  "$endpoint"
)

# Do not print full command because it contains TOKEN.
printf 'Calling deploy endpoint for env=%s\n' "$APP_ENV" >&2

"${cmd[@]}"
```

Still not perfect: JSON should ideally be built with `jq` for escaping if values are arbitrary.

Better JSON construction:

```bash
payload="$(jq -n --arg env "$APP_ENV" '{env: $env}')"

cmd=(
  curl
  --fail
  --show-error
  --silent
  --request POST
  --header "Authorization: Bearer $TOKEN"
  --header "Content-Type: application/json"
  --data "$payload"
  "$endpoint"
)
```

This requires `jq`, so script should validate it.

---

## 29. Deep Example: Do Not Parse `ls`

Bad:

```bash
for file in $(ls *.log); do
  gzip $file
done
```

Problems:

- `ls` output is for humans;
- filenames with spaces/newlines break;
- glob with no match problematic;
- unquoted `$file`;
- option injection if file starts with `-`.

Better Bash:

```bash
shopt -s nullglob

for file in ./*.log; do
  gzip -- "$file"
done
```

More portable with existence guard:

```bash
for file in ./*.log; do
  [ -e "$file" ] || continue
  gzip -- "$file"
done
```

For recursive:

```bash
find . -type f -name '*.log' -exec gzip -- {} +
```

This avoids line parsing entirely.

---

## 30. Mental Model: Shell Syntax vs Program Syntax

A common mistake: assuming quotes inside variable will work as shell syntax later.

Example:

```bash
args='-H "Content-Type: application/json"'
curl $args "$url"
```

This does not produce intended argument boundary. Quote characters inside variable are data after expansion; they are not reinterpreted as shell syntax unless `eval` is used, which is dangerous.

Correct Bash array:

```bash
args=(-H "Content-Type: application/json")
curl "${args[@]}" "$url"
```

This is one of the most important shell mental models:

> Shell syntax is parsed before variable values are expanded. Quotes stored inside variables do not behave like source-code quotes.

---

## 31. Checklist: Quoting and Expansion Review

Use this checklist when reviewing any shell script.

### Variable expansion

- Is every variable expansion quoted unless intentional?
- If intentional unquoted expansion exists, is it documented?
- Are concatenated variables using braces: `"${name}_suffix"`?

### Arguments

- Are dynamic commands built with arrays in Bash?
- Is `"$@"` used for forwarding?
- Is `--` used before user-controlled path or pattern where supported?
- Are options and values separate arguments when appropriate?

### Command substitution

- Is command substitution quoted?
- Is it used only for single-value output?
- Are multi-line/file-list outputs handled with safe loops?
- Is stderr intentionally handled?

### Globbing

- Is globbing intentional?
- What happens if no file matches?
- Are matched filenames quoted when used?

### Tests

- Are `[ ... ]` variables quoted?
- Is `[[ ... ]]` used only in Bash scripts?
- Are pattern vs literal comparisons clear?

### Config

- Is `source` used only for trusted shell code?
- Are required variables validated?
- Are secrets kept out of logs?

### Dangerous constructs

- Is `eval` avoided?
- Is `for x in $(...)` avoided?
- Are destructive commands guarded?

---

## 32. Mini Lab

### Lab 1 — Word splitting

```bash
name="Alice Smith"
printf '<%s>\n' $name
printf '<%s>\n' "$name"
```

Explain why output differs.

---

### Lab 2 — Globbing from variable

In a temp directory:

```bash
mkdir -p /tmp/shell-lab
cd /tmp/shell-lab
touch a.txt b.txt

pattern="*"
printf '<%s>\n' $pattern
printf '<%s>\n' "$pattern"
```

Explain why first command expands to filenames.

---

### Lab 3 — Quotes inside variable do not work as syntax

```bash
args='-H "Content-Type: application/json"'
printf '<%s>\n' $args
```

Compare with:

```bash
args=(-H "Content-Type: application/json")
printf '<%s>\n' "${args[@]}"
```

---

### Lab 4 — `"$@"`

Create `show-args.sh`:

```bash
cat > show-args.sh <<'EOF'
#!/usr/bin/env bash
printf 'argc=%s\n' "$#"
i=0
for arg in "$@"; do
  i=$((i + 1))
  printf 'arg%s=<%s>\n' "$i" "$arg"
done
EOF

chmod +x show-args.sh
```

Run:

```bash
./show-args.sh "hello world" "*.txt" ""
```

Then create wrappers using `$@`, `"$@"`, and `"$*"`. Compare.

---

### Lab 5 — Here-doc expansion

```bash
name="Alice"

cat <<EOF
Hello $name
EOF

cat <<'EOF'
Hello $name
EOF
```

Explain why output differs.

---

## 33. Design Exercise: Safe Java Service Wrapper

Design `scripts/run-local.sh` with requirements:

- accepts optional `--profile dev|test`;
- accepts optional `--debug`;
- forwards remaining args to Java app;
- validates `java` command exists;
- resolves project root;
- does not break args with spaces;
- logs to stderr;
- exits 2 for invalid usage.

Sketch:

```bash
#!/usr/bin/env bash
set -euo pipefail

# parse args into:
# profile
# debug flag
# app_args array

# build command:
# java [debug opts] -jar target/app.jar --spring.profiles.active="$profile" "${app_args[@]}"
```

Key challenge: preserve argument boundary.

You should use Bash arrays, not command strings.

---

## 34. Part 002 Summary

Shell execution correctness depends on parsing and expansion.

Key takeaways:

1. Shell source text is transformed before program execution.
2. Quote controls grouping and expansion behavior.
3. Single quote means literal.
4. Double quote allows expansion but prevents word splitting and globbing.
5. Unquoted variables can become many arguments.
6. Unquoted variables can trigger globbing.
7. Command substitution should almost always be quoted.
8. Do not store command syntax in strings.
9. Use Bash arrays for dynamic command construction.
10. Use `"$@"` for argument forwarding.
11. Avoid `eval`.
12. Treat sourced config as shell code, not data.
13. Use `--` to reduce option injection risk.
14. Do not parse `ls`.
15. Here-doc delimiter quoting controls whether content is expanded.

This part is the defensive core of shell scripting. Many later best practices are just consequences of this model.

---

## 35. Referensi Resmi dan Bacaan Lanjutan

- GNU Bash Reference Manual — Shell Expansions.
- GNU Bash Reference Manual — Quoting.
- GNU Bash Reference Manual — Word Splitting.
- GNU Bash Reference Manual — Filename Expansion.
- GNU Bash Reference Manual — Command Substitution.
- POSIX Shell Command Language — Word Expansions, Field Splitting, Pathname Expansion.
- ShellCheck wiki and diagnostics — practical warnings for unsafe shell constructs.

---

## 36. Status Seri

Seri belum selesai.

Progress:

- [x] Part 000 — Orientation: Scripting as Engineering Control Plane
- [x] Part 001 — Shell Mental Model: Process, Stream, Exit Code, Environment
- [x] Part 002 — Command Execution Semantics: Parsing, Expansion, Quoting
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
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-001.md">⬅️ Part 001 — Shell Mental Model: Process, Stream, Exit Code, Environment</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-003.md">Part 003 — POSIX Shell Baseline: Portable Script Before Bash-Specific Script ➡️</a>
</div>

# learn-git-mastery-for-java-engineers-part-022.md

# Part 022 — Line Endings, Whitespace, Encoding, dan Cross-Platform Issues

> **Seri:** Git Mastery for Java Engineers  
> **Bagian:** 022 / 032  
> **Topik:** Mengelola LF/CRLF, whitespace, encoding, file mode, case sensitivity, dan isu lintas OS dalam repository Java  
> **Target pembaca:** Java software engineer yang bekerja dalam tim lintas Windows/macOS/Linux, CI/CD, Docker, shell script, dan repository besar  
> **Status seri:** Belum selesai. Bagian terakhir adalah `learn-git-mastery-for-java-engineers-part-032.md`.

---

## 0. Ringkasan Eksekutif

Banyak konflik Git yang tampak “aneh” sebenarnya bukan konflik logic.

Sering kali akar masalahnya adalah:

- line endings berbeda;
- whitespace berubah massal;
- executable bit hilang;
- encoding file tidak konsisten;
- case sensitivity berbeda antar OS;
- IDE melakukan auto-format tanpa kontrol;
- Git config lokal berbeda antar developer;
- file binary diperlakukan sebagai text;
- shell script dibuat di Windows lalu gagal di Linux;
- Docker build gagal karena CRLF;
- CI menjalankan Linux sementara developer memakai Windows.

Untuk Java engineer, isu ini terlihat kecil, tetapi dampaknya besar:

```text
PR berisi ribuan line changed padahal logic tidak berubah.
Shell script gagal di CI dengan error aneh.
Docker entrypoint tidak bisa dieksekusi.
Gradle wrapper gagal Permission denied.
File rename hanya beda huruf gagal di macOS/Windows.
Properties/YAML rusak karena encoding/whitespace.
Merge conflict muncul di file yang tidak disentuh secara logic.
```

Tujuan part ini:

```text
Membuat repository Java konsisten lintas platform sehingga Git diff,
review, build, test, CI, dan release tidak terganggu noise teknis.
```

Mental model utama:

```text
Git menyimpan bytes dan metadata terbatas.
Operating system, editor, IDE, build tool, dan Git config lokal bisa mengubah bytes itu.
Repository sehat harus punya aturan eksplisit agar perubahan bytes tidak liar.
```

---

## 1. Kenapa Ini Penting untuk Java Engineer?

Java sering dianggap cross-platform karena JVM.

Tetapi repository Java tidak otomatis cross-platform.

Contoh masalah nyata:

## 1.1 Shell Script CRLF

File:

```text
scripts/run-local.sh
```

Dibuat di Windows dengan CRLF.

Di Linux CI:

```bash
./scripts/run-local.sh
```

Error:

```text
/usr/bin/env: ‘bash\r’: No such file or directory
```

Penyebab:

```text
Shebang menjadi #!/usr/bin/env bash\r
```

Linux membaca `bash\r` sebagai nama executable.

## 1.2 Gradle Wrapper Tidak Executable

Di macOS/Windows tidak terasa.

Di Linux CI:

```text
Permission denied: ./gradlew
```

Penyebab:

```text
Executable bit tidak tersimpan di Git atau berubah.
```

## 1.3 PR Penuh Perubahan Line Ending

Developer membuka file di editor yang mengubah LF ke CRLF.

Git diff terlihat:

```text
5000 lines changed
```

Padahal logic tidak berubah.

Review menjadi tidak berguna.

## 1.4 Case-Only Rename

File:

```text
CaseService.java
```

diubah menjadi:

```text
caseService.java
```

Di Linux ini file berbeda.

Di Windows/macOS default bisa dianggap file sama.

Git status bisa membingungkan.

## 1.5 YAML Whitespace

Indentasi YAML berubah atau tab masuk.

Aplikasi Spring Boot gagal parse config.

## 1.6 Encoding

File properties mengandung karakter non-ASCII.

Di satu environment terbaca benar, di environment lain rusak.

---

## 2. Git Menyimpan Apa?

Git menyimpan:

```text
1. Content file sebagai bytes.
2. Path file.
3. Executable bit terbatas untuk file.
4. Symlink information.
```

Git tidak menyimpan penuh:

- permission lengkap POSIX;
- owner;
- group;
- ACL;
- creation time;
- extended attributes umum;
- encoding semantic;
- apakah file “seharusnya” Java/YAML/shell selain dari path/attributes.

Artinya:

```text
Git tidak tahu bahwa file .java harus UTF-8,
file .sh harus LF,
file .bat boleh CRLF,
file .jar binary,
dan file migration tidak boleh diubah setelah release.
```

Aturan itu harus Anda definisikan melalui:

- `.gitattributes`;
- `.editorconfig`;
- `.gitignore`;
- formatter/linter;
- IDE settings;
- CI checks;
- team policy.

---

## 3. Line Endings: LF vs CRLF

Ada dua style utama:

```text
LF   = Line Feed, "\n"
CRLF = Carriage Return + Line Feed, "\r\n"
```

Unix/Linux/macOS modern biasanya memakai LF.

Windows tradisional memakai CRLF.

Contoh visual:

```text
LF:
line1\n
line2\n

CRLF:
line1\r\n
line2\r\n
```

Di banyak editor, perbedaan ini tidak terlihat.

Tetapi Git melihat bytes berbeda.

Jika file berubah dari LF ke CRLF, Git bisa melihat seluruh file berubah.

---

## 4. Kenapa CRLF Berbahaya di Shell Script?

Shell script di Linux memakai shebang:

```bash
#!/usr/bin/env bash
```

Jika file CRLF:

```text
#!/usr/bin/env bash\r\n
```

Linux mencoba menjalankan:

```text
bash\r
```

Bukan:

```text
bash
```

Error:

```text
/usr/bin/env: ‘bash\r’: No such file or directory
```

Atau:

```text
bad interpreter: No such file or directory
```

Solusi:

```text
Pastikan *.sh selalu LF.
```

Dengan `.gitattributes`:

```gitattributes
*.sh text eol=lf
```

---

## 5. Git Normalization: Working Tree vs Repository

Git bisa melakukan line ending normalization.

Konsep:

```text
Repository/index canonical form biasanya LF.
Working tree bisa LF atau CRLF tergantung config/attributes.
```

Saat add/commit:

```text
working tree -> index/repository
```

Saat checkout:

```text
repository -> working tree
```

Jika dikonfigurasi, Git bisa mengubah CRLF ke LF saat commit, dan LF ke CRLF saat checkout.

Masalah muncul jika setiap developer punya config berbeda.

Karena itu, rule terbaik ada di repository melalui `.gitattributes`, bukan hanya config personal.

---

## 6. `core.autocrlf`

Git config umum:

```bash
git config --global core.autocrlf true
git config --global core.autocrlf input
git config --global core.autocrlf false
```

## 6.1 `core.autocrlf=true`

Biasanya dipakai di Windows.

Perilaku umum:

```text
checkout: LF -> CRLF
commit:   CRLF -> LF
```

Risiko:

- working tree Windows jadi CRLF;
- script bisa rusak jika tidak dipaksa LF;
- berbeda dari CI Linux;
- diff noise jika tidak konsisten.

## 6.2 `core.autocrlf=input`

Biasanya dipakai macOS/Linux.

Perilaku umum:

```text
checkout: no conversion
commit:   CRLF -> LF
```

## 6.3 `core.autocrlf=false`

Tidak otomatis konversi.

Bisa aman jika `.gitattributes` kuat dan editor dikonfigurasi.

## 6.4 Rekomendasi

Untuk repository tim:

```text
Jangan hanya mengandalkan core.autocrlf.
Gunakan .gitattributes untuk aturan repository.
```

Config personal bisa berbeda, tetapi `.gitattributes` harus menjadi policy utama.

---

## 7. `.gitattributes`: Policy Line Ending Repository

`.gitattributes` adalah tempat utama untuk mendefinisikan bagaimana Git memperlakukan path tertentu.

Contoh baseline Java repo:

```gitattributes
# Default: normalize text files
* text=auto

# Source files use LF
*.java text eol=lf
*.kt text eol=lf
*.groovy text eol=lf
*.xml text eol=lf
*.properties text eol=lf
*.yml text eol=lf
*.yaml text eol=lf
*.json text eol=lf
*.md text eol=lf
*.sql text eol=lf

# Shell scripts must be LF
*.sh text eol=lf
*.bash text eol=lf
*.zsh text eol=lf

# Windows scripts can be CRLF
*.bat text eol=crlf
*.cmd text eol=crlf
*.ps1 text eol=crlf

# Binary files
*.jar binary
*.war binary
*.ear binary
*.class binary
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.ico binary
*.pdf binary
*.zip binary
*.gz binary
*.tar binary
```

`text eol=lf` artinya file dianggap text dan checkout sebagai LF.

`binary` biasanya equivalent dengan:

```text
-text -diff
```

Artinya Git tidak melakukan text normalization/diff biasa.

---

## 8. `text=auto` vs Explicit Rules

```gitattributes
* text=auto
```

Membiarkan Git mendeteksi text/binary otomatis.

Ini bagus sebagai baseline, tetapi tidak cukup untuk file penting.

Gunakan explicit rules untuk:

- shell script;
- Java/XML/YAML/SQL;
- Windows scripts;
- binary artifacts;
- generated files tertentu.

Kenapa?

```text
Auto detection adalah heuristic.
Repository policy harus eksplisit untuk file penting.
```

---

## 9. Menambahkan `.gitattributes` ke Repository Lama

Jika repository sudah lama tanpa `.gitattributes`, menambah aturan bisa membuat banyak file terlihat berubah.

Proses aman:

## 9.1 Tambahkan `.gitattributes`

```bash
git add .gitattributes
git commit -m "Define repository text and binary attributes"
```

## 9.2 Renormalize

Preview:

```bash
git add --renormalize --dry-run .
```

Apply:

```bash
git add --renormalize .
git status --short
git diff --cached --stat
```

Commit terpisah:

```bash
git commit -m "Normalize line endings"
```

Penting:

```text
Commit normalisasi harus terpisah dari logic change.
```

Kalau dicampur, blame/review menjadi kacau.

## 9.3 Masukkan ke `.git-blame-ignore-revs`

Jika normalisasi/formatting massal tidak mengubah behavior, tambahkan SHA ke:

```text
.git-blame-ignore-revs
```

Lalu:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

---

## 10. Mengecek Line Endings

Gunakan `file`:

```bash
file scripts/run-local.sh
```

Output bisa menunjukkan:

```text
ASCII text
ASCII text, with CRLF line terminators
```

Gunakan `cat -v`:

```bash
cat -v scripts/run-local.sh | head
```

CRLF terlihat sebagai:

```text
^M
```

Gunakan `grep`:

```bash
grep -Il $'\r' -r .
```

Cari CRLF di tracked files:

```bash
git grep -Il $'\r'
```

Namun support pattern `$'\r'` tergantung shell.

Dengan Perl:

```bash
perl -ne 'print "$ARGV\n" if /\r/; close ARGV' $(git ls-files)
```

Hati-hati untuk binary file.

---

## 11. Mengubah CRLF ke LF

Dengan `dos2unix`:

```bash
dos2unix scripts/run-local.sh
```

Tanpa tool:

```bash
perl -pi -e 's/\r\n/\n/g' scripts/run-local.sh
```

Atau:

```bash
sed -i 's/\r$//' scripts/run-local.sh
```

Di macOS `sed -i` syntax berbeda, jadi Perl lebih portable.

Setelah ubah:

```bash
git diff --check
git diff --word-diff
```

Commit:

```bash
git add scripts/run-local.sh
git commit -m "Normalize shell script line endings"
```

---

## 12. Whitespace: Lebih dari Spasi Kosmetik

Whitespace issue meliputi:

- trailing spaces;
- tab vs spaces;
- indentation;
- missing final newline;
- mixed indentation;
- invisible whitespace;
- whitespace-only diff;
- CRLF;
- non-breaking space;
- zero-width character.

Di Java, whitespace biasanya tidak mengubah behavior.

Tetapi di file lain bisa critical:

| File | Whitespace Sensitivity |
|---|---|
| Java | Umumnya tidak semantic |
| YAML | Indentation semantic |
| Makefile | Tab semantic |
| Python | Indentation semantic |
| Markdown | Kadang semantic |
| SQL | Biasanya tidak, kecuali string |
| Properties | Leading/trailing bisa penting |
| Shell | Quoting/spacing bisa penting |
| Dockerfile | Line continuation penting |

Jadi jangan menganggap semua whitespace aman.

---

## 13. `git diff --check`

Gunakan:

```bash
git diff --check
```

Ini mendeteksi whitespace error seperti trailing whitespace dan space before tab.

Sebelum commit:

```bash
git diff --cached --check
```

Jika ada error:

```text
file.java:123: trailing whitespace.
```

Perbaiki sebelum commit.

CI bisa menjalankan:

```bash
git diff --check origin/main...HEAD
```

Atau sebagai pre-commit hook.

---

## 14. Melihat Diff Mengabaikan Whitespace

Kadang ingin review logic tanpa noise whitespace.

```bash
git diff -w
```

Atau:

```bash
git diff --ignore-space-at-eol
git diff --ignore-space-change
git diff --ignore-all-space
```

Untuk log:

```bash
git show -w <sha>
git blame -w <file>
```

Gunakan dengan hati-hati.

Whitespace bisa semantic di YAML, Makefile, Python, shell, properties.

Untuk Java refactor, `-w` sering membantu.

---

## 15. Whitespace-only Commit

Jika formatter diterapkan ke banyak file, buat commit terpisah:

```bash
git commit -m "Apply Java formatter"
```

Jangan campur dengan logic.

Alasan:

- review logic tetap jelas;
- blame bisa ignore commit itu;
- revert lebih aman;
- forensic lebih mudah;
- conflict lebih mudah dipahami.

Tambahkan SHA ke `.git-blame-ignore-revs` jika benar-benar mechanical.

---

## 16. `.editorconfig` untuk Whitespace Policy

Contoh:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true

[*.java]
indent_style = space
indent_size = 4

[*.{yml,yaml,json}]
indent_style = space
indent_size = 2

[*.md]
trim_trailing_whitespace = false

[Makefile]
indent_style = tab

[*.{bat,cmd}]
end_of_line = crlf
```

Manfaat:

- editor/IDE mengikuti aturan;
- mengurangi diff noise;
- cross-platform lebih konsisten;
- onboarding lebih mudah.

`.editorconfig` tidak menggantikan `.gitattributes`.

Peran:

```text
.editorconfig   -> editor writes files consistently.
.gitattributes  -> Git normalizes/checks out files consistently.
formatter       -> code style enforced.
CI              -> verifies compliance.
```

---

## 17. Encoding: UTF-8 sebagai Default Praktis

Untuk Java modern, gunakan UTF-8 sebagai baseline.

Potensi file:

```text
*.java
*.properties
*.xml
*.yml
*.sql
*.md
```

Masalah encoding:

- karakter non-ASCII rusak;
- resource bundle terbaca salah;
- SQL migration mengandung special character;
- generated docs/spec berubah;
- build lokal dan CI berbeda;
- Windows default encoding berbeda tergantung setup.

Pastikan build compiler encoding eksplisit.

Maven:

```xml
<properties>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <project.reporting.outputEncoding>UTF-8</project.reporting.outputEncoding>
</properties>
```

Compiler:

```xml
<plugin>
    <artifactId>maven-compiler-plugin</artifactId>
    <configuration>
        <encoding>UTF-8</encoding>
    </configuration>
</plugin>
```

Gradle:

```kotlin
tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
}
```

`.editorconfig`:

```ini
[*]
charset = utf-8
```

---

## 18. Java Properties Encoding

Historically, `.properties` had ISO-8859-1 considerations in older Java tooling.

Modern Java usage often supports UTF-8 in many contexts, but you must know your runtime/tooling behavior.

For Spring Boot applications, `.properties` and YAML resources are commonly treated as UTF-8 in modern setups.

Still, be explicit:

- build encoding UTF-8;
- editorconfig UTF-8;
- avoid ambiguous characters if not needed;
- test resource loading if non-ASCII matters.

If maintaining legacy Java:

```text
Check whether native2ascii or ISO-8859-1 assumptions still exist.
```

Do not assume.

---

## 19. BOM: Byte Order Mark

UTF-8 BOM can cause issues in scripts/config.

BOM bytes:

```text
EF BB BF
```

Symptoms:

- shell script shebang not recognized;
- parser error at beginning of file;
- weird invisible character in first token;
- config key includes hidden character.

Detect:

```bash
xxd -g 1 -l 3 file
```

If output:

```text
ef bb bf
```

File has UTF-8 BOM.

Remove:

```bash
sed -i '1s/^\xEF\xBB\xBF//' file
```

Portable Perl:

```bash
perl -i -pe 's/^\x{FEFF}//' file
```

Policy:

```text
Use UTF-8 without BOM for source/config/scripts unless a tool explicitly requires BOM.
```

---

## 20. Executable Bit

Git tracks executable bit for files.

Mode examples:

```text
100644 = normal file
100755 = executable file
```

Check:

```bash
git ls-files -s gradlew
git ls-files -s scripts/run-local.sh
```

Set executable:

```bash
chmod +x gradlew
git update-index --chmod=+x gradlew
```

Unset:

```bash
git update-index --chmod=-x file
```

Common files that should be executable:

```text
mvnw
gradlew
scripts/*.sh
```

Common files that should not:

```text
*.java
*.yml
*.xml
*.md
```

---

## 21. `core.filemode`

On some filesystems, Git may detect executable bit changes unexpectedly.

Config:

```bash
git config core.filemode
```

If false:

```bash
git config core.filemode false
```

This tells Git to ignore file mode changes in working tree.

But repository still stores executable bit.

Do not use `core.filemode=false` as substitute for committing correct executable bit.

For CI/Linux, executable bit must be in repo.

---

## 22. Symlinks

Git can track symlinks.

But Windows support can vary depending on config/permissions.

Issues:

- symlink becomes regular text file;
- checkout differs by OS;
- build script expects symlink;
- Docker context follows differently;
- security restriction.

Check:

```bash
git ls-files -s path/to/link
```

Symlink mode:

```text
120000
```

If repository must support Windows developers, use symlinks carefully.

Alternatives:

- duplicate small config;
- generate symlink in setup script;
- avoid symlink for critical build path;
- document required Windows developer mode/admin config.

---

## 23. Case Sensitivity

Linux filesystems are usually case-sensitive.

Windows and default macOS filesystems are often case-insensitive but case-preserving.

Problem:

```text
CaseService.java
caseservice.java
```

Linux sees two files.

Windows/macOS may not.

Java package/class convention reduces some risk, but not all.

Case-only rename:

```bash
git mv CaseService.java CaseServiceTmp.java
git mv CaseServiceTmp.java caseService.java
```

Or force:

```bash
git mv -f CaseService.java caseService.java
```

If Git does not detect case change, check:

```bash
git config core.ignorecase
```

But avoid relying on local config.

Policy:

```text
Avoid case-only rename unless necessary.
Review path case carefully.
CI on Linux catches many issues.
```

---

## 24. Java Class Names and Case

Java convention:

```text
Class name = File name
CaseService -> CaseService.java
```

Problems:

- import path case mismatch;
- package directory case mismatch;
- class compiles on case-insensitive FS but fails on Linux;
- resource file path case mismatch;
- Spring resource loading path case mismatch.

Example:

```java
getResourceAsStream("/Templates/email.html")
```

But actual path:

```text
templates/email.html
```

Works accidentally on case-insensitive FS, fails in Linux container.

CI Linux is important.

---

## 25. Path Separators

Windows uses:

```text
\
```

Unix uses:

```text
/
```

In Java code, prefer:

```java
Path.of("src", "test", "resources", "fixtures", "case.json")
```

Not:

```java
"src\\test\\resources\\fixtures\\case.json"
```

In scripts:

- shell uses `/`;
- batch uses `\`;
- Gradle/Maven should avoid hardcoded OS separators where possible.

Git paths use `/` internally.

Avoid committing generated files with OS-specific absolute paths.

---

## 26. File Names Illegal on Windows

Linux allows names Windows rejects:

```text
CON
PRN
AUX
NUL
COM1
LPT1
file:name
file*name
file?name
```

If repo must support Windows, avoid such names.

Also avoid trailing spaces/dots:

```text
file.
file 
```

Windows has trouble.

Policy:

```text
Use conservative portable filenames.
```

---

## 27. Long Path Issues on Windows

Windows historically had path length limits.

Deep Java package paths plus generated code can exceed limits.

Symptoms:

- checkout fails;
- build fails;
- generated sources fail;
- Git complains path too long.

Mitigation:

```bash
git config --global core.longpaths true
```

But repository design matters:

- avoid overly deep module paths;
- avoid generated code under extremely nested dirs;
- use shorter root clone path;
- keep package naming reasonable.

---

## 28. File Permissions Beyond Executable Bit

Git does not track full permissions.

If deployment needs:

```text
0600 private key
0644 config
0755 script
```

Git will not preserve all details.

Use:

- setup script;
- Dockerfile `chmod`;
- Kubernetes Secret mount mode;
- build packaging config;
- Ansible/Terraform;
- CI step.

Do not assume Git checkout creates exact permission model.

---

## 29. Binary Files and Diff

If binary file not marked binary, Git may try text diff.

Use `.gitattributes`:

```gitattributes
*.jar binary
*.png binary
*.pdf binary
*.xlsx binary
```

For some binary formats, Git can show custom diff if configured, but default team policy should be simple.

Binary files create issues:

- no meaningful line diff;
- merge hard;
- repository grows;
- review weak;
- conflict resolution manual;
- LFS may be needed.

Part 026 covers large files and Git LFS.

---

## 30. Whitespace and Java Formatter

Use a formatter rather than relying on manual discipline.

Options:

- google-java-format;
- Spotless;
- Palantir Java Format;
- Checkstyle;
- IDE formatter plus CI check.

Spotless Gradle example:

```kotlin
plugins {
    id("com.diffplug.spotless") version "..."
}

spotless {
    java {
        googleJavaFormat()
        removeUnusedImports()
        trimTrailingWhitespace()
        endWithNewline()
    }
}
```

Maven Spotless example:

```xml
<plugin>
    <groupId>com.diffplug.spotless</groupId>
    <artifactId>spotless-maven-plugin</artifactId>
    <version>...</version>
    <configuration>
        <java>
            <googleJavaFormat/>
        </java>
    </configuration>
</plugin>
```

CI:

```bash
./gradlew spotlessCheck
```

or:

```bash
./mvnw spotless:check
```

Rule:

```text
Formatter config belongs in repo.
Formatter enforcement belongs in CI.
Formatting-only changes belong in separate commits.
```

---

## 31. YAML and Properties Whitespace

Spring config examples:

```yaml
case:
  escalation:
    enabled: true
```

Wrong indentation can change meaning.

Tabs can break YAML.

`.editorconfig`:

```ini
[*.{yml,yaml}]
indent_style = space
indent_size = 2
```

Properties:

```properties
key=value
```

Leading/trailing spaces may matter depending parsing.

Avoid casual whitespace cleanup in config files without review.

---

## 32. SQL Migration Whitespace and Encoding

SQL whitespace is usually not semantic, but can be inside string literals.

Example:

```sql
UPDATE notice_template
SET body = 'Line 1
Line 2';
```

Line endings or indentation inside string may be semantic.

Migration files should be stable after release.

Policy:

```text
Do not mass-format old released migrations casually.
```

If SQL formatter is used, apply before release or only to unreleased files.

---

## 33. Markdown Whitespace

Markdown trailing spaces can mean line break.

`.editorconfig` often sets:

```ini
[*.md]
trim_trailing_whitespace = false
```

Why?

In Markdown, two trailing spaces can intentionally create a line break.

However many teams avoid trailing spaces and use blank lines.

Choose policy explicitly.

---

## 34. Makefile Tabs

Makefile recipes require tabs.

If editor converts tabs to spaces, build breaks.

`.editorconfig`:

```ini
[Makefile]
indent_style = tab
```

Also:

```ini
[*.mk]
indent_style = tab
```

Do not apply generic whitespace conversion blindly to Makefile.

---

## 35. PowerShell Scripts

PowerShell on modern platforms can run LF, but Windows tooling may expect CRLF.

Policy can be:

```gitattributes
*.ps1 text eol=crlf
```

or LF if your team standardizes cross-platform PowerShell.

Be explicit.

Also consider execution policy, not just line endings.

---

## 36. Docker and Line Endings

Docker builds often run in Linux containers.

Common failure:

```dockerfile
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

If `entrypoint.sh` has CRLF, container fails.

Ensure:

```gitattributes
*.sh text eol=lf
```

Also ensure executable or Dockerfile chmod:

```dockerfile
RUN chmod +x /entrypoint.sh
```

But chmod does not fix CRLF.

Use CI to catch:

```bash
grep -Il $'\r' scripts/*.sh
```

---

## 37. CI as Cross-Platform Gate

Even if developers use Windows/macOS, CI should include Linux build for typical Java backend.

CI catches:

- executable bit;
- case sensitivity;
- shell script line endings;
- Docker issues;
- path assumptions;
- locale/timezone differences if configured;
- file permission assumptions.

For truly cross-platform tools/libraries, run matrix:

```text
Linux
Windows
macOS
```

But for backend service deployed on Linux, at least Linux CI is mandatory.

---

## 38. Locale and Timezone Are Also Cross-Platform Issues

Not strictly Git file issues, but often appear in tests after checkout.

Java tests may depend on:

```java
Locale.getDefault()
ZoneId.systemDefault()
Charset.defaultCharset()
```

Different OS/CI can produce different results.

Build/test scripts can set:

```bash
export TZ=UTC
```

Maven Surefire:

```xml
<argLine>-Duser.timezone=UTC -Dfile.encoding=UTF-8</argLine>
```

Gradle:

```kotlin
tasks.withType<Test>().configureEach {
    systemProperty("user.timezone", "UTC")
    systemProperty("file.encoding", "UTF-8")
}
```

This connects to Git because reproducibility starts at file checkout but does not end there.

---

## 39. Detecting Accidental Mass Line Ending Change

Before PR:

```bash
git diff --stat
```

If huge unexpected changes:

```bash
git diff --numstat
```

Line ending-only changes often show many lines removed/added.

Check:

```bash
git diff --ignore-space-at-eol
```

If diff disappears, likely line ending/trailing whitespace.

Also:

```bash
git diff --check
```

To inspect attributes:

```bash
git check-attr -a -- path/to/file
```

Example:

```bash
git check-attr -a -- scripts/run-local.sh
```

---

## 40. Fixing Accidental Mass Line Ending Change

If you accidentally changed line endings in many files:

```bash
git restore .
```

If some real changes exist, be careful.

Use interactive restore:

```bash
git restore -p .
```

Or inspect:

```bash
git diff -w
```

If you need to preserve logic changes but drop whitespace changes, it can be tricky.

Strategy:

1. Save patch of logic changes.
2. Restore files.
3. Reapply changes carefully.
4. Configure editor and `.gitattributes`.
5. Re-run formatter intentionally.

Avoid committing accidental line ending mass changes.

---

## 41. `git diff --word-diff` for Whitespace-Sensitive Review

Sometimes line diff too coarse.

Use:

```bash
git diff --word-diff
```

Or:

```bash
git diff --word-diff=color
```

Useful for:

- Markdown;
- SQL;
- text templates;
- properties;
- JSON/YAML small changes.

For Java, IDE diff may be more readable, but CLI still useful.

---

## 42. Invisible Characters

Invisible characters can break code/config:

- non-breaking space;
- zero-width space;
- BOM;
- carriage return;
- smart quotes;
- homoglyphs.

Detect with:

```bash
cat -vet file
```

Or:

```bash
xxd file | head
```

Search non-ASCII:

```bash
LC_ALL=C grep -n '[^ -~]' file
```

But non-ASCII may be legitimate in docs/messages.

Policy:

```text
Non-ASCII allowed where intentional.
Suspicious invisible characters should be removed.
```

For Java source, avoid invisible characters outside strings/comments.

---

## 43. `.gitattributes` for Custom Diff Drivers

For special files, custom diff can improve review.

Example for `.properties` maybe normal text.

For lockfiles, sometimes text.

For generated files, you may mark as linguist-generated on GitHub, but that is hosting-specific.

General `.gitattributes` examples:

```gitattributes
*.lock text eol=lf
*.gradle text eol=lf
*.kts text eol=lf
```

For binary:

```gitattributes
*.xlsx binary
```

For generated code, if tracked:

```gitattributes
src/generated/** linguist-generated=true
```

Note: `linguist-generated` affects GitHub display, not Git core.

---

## 44. Normalization and Blame

A normalization commit can dominate blame.

Mitigation:

1. Keep normalization commit separate.
2. Add to `.git-blame-ignore-revs`.
3. Configure blame ignore.

Example:

```bash
echo "<normalization-commit-sha>" >> .git-blame-ignore-revs
git add .git-blame-ignore-revs
git commit -m "Ignore normalization commit in blame"
```

Local config:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

This keeps archaeology useful.

---

## 45. Renormalization Workflow for Existing Repo

Full workflow:

```bash
# 1. Ensure clean tree
git status --short

# 2. Add .gitattributes
cat > .gitattributes <<'EOF'
* text=auto
*.java text eol=lf
*.xml text eol=lf
*.yml text eol=lf
*.yaml text eol=lf
*.properties text eol=lf
*.sql text eol=lf
*.sh text eol=lf
*.bat text eol=crlf
*.cmd text eol=crlf
*.jar binary
*.png binary
*.pdf binary
EOF

git add .gitattributes
git commit -m "Define Git attributes"

# 3. Renormalize
git add --renormalize .

# 4. Review
git status --short
git diff --cached --stat

# 5. Commit separately
git commit -m "Normalize line endings"
```

After merge, tell team:

```bash
git rm --cached -r .
git reset --hard
```

Usually a fresh checkout after attributes change is safest if working tree acts weird.

Do not do destructive commands with uncommitted work.

---

## 46. Cross-Platform Policy Template

A mature Java repo should state:

```text
1. All source/config files use UTF-8.
2. Java/XML/YAML/SQL/Markdown use LF.
3. Shell scripts use LF and executable bit.
4. Windows batch/cmd files use CRLF.
5. Build outputs are ignored.
6. IDE personal state is ignored.
7. Formatting is enforced by build/CI.
8. Normalization commits are separate and ignored in blame.
9. CI runs on Linux at minimum.
10. Case-only renames require care.
```

Put in:

```text
CONTRIBUTING.md
README.md
docs/development.md
```

---

## 47. Recommended Baseline Files

## 47.1 `.gitattributes`

```gitattributes
* text=auto

*.java text eol=lf
*.kt text eol=lf
*.groovy text eol=lf
*.xml text eol=lf
*.properties text eol=lf
*.yml text eol=lf
*.yaml text eol=lf
*.json text eol=lf
*.md text eol=lf
*.sql text eol=lf
*.gradle text eol=lf
*.kts text eol=lf

*.sh text eol=lf
*.bash text eol=lf
*.zsh text eol=lf

*.bat text eol=crlf
*.cmd text eol=crlf
*.ps1 text eol=crlf

*.jar binary
*.war binary
*.ear binary
*.class binary
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.ico binary
*.pdf binary
*.zip binary
*.gz binary
*.tar binary
```

## 47.2 `.editorconfig`

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true

[*.java]
indent_style = space
indent_size = 4

[*.{xml,yml,yaml,json}]
indent_style = space
indent_size = 2

[*.md]
trim_trailing_whitespace = false

[Makefile]
indent_style = tab

[*.{bat,cmd,ps1}]
end_of_line = crlf
```

---

## 48. Common Error Messages and Likely Causes

| Error | Likely Cause |
|---|---|
| `/usr/bin/env: ‘bash\r’: No such file or directory` | CRLF in shell script |
| `bad interpreter: No such file or directory` | CRLF or wrong shebang |
| `Permission denied: ./gradlew` | Missing executable bit |
| `file not found` only in Linux CI | Case mismatch |
| Huge PR diff with no logic change | Line ending/formatting |
| YAML parse error after formatting | Indentation/tab issue |
| Makefile missing separator | Spaces instead of tab |
| Docker entrypoint fails | CRLF or executable issue |
| Resource loads locally but not in container | Case-sensitive path issue |
| Weird first character in file | BOM/invisible char |

---

## 49. Practical Debug Playbook

## 49.1 Script Fails in CI

```bash
file scripts/run-local.sh
cat -v scripts/run-local.sh | head
git ls-files -s scripts/run-local.sh
git check-attr -a -- scripts/run-local.sh
```

Fix:

```bash
dos2unix scripts/run-local.sh
git update-index --chmod=+x scripts/run-local.sh
```

Add:

```gitattributes
*.sh text eol=lf
```

## 49.2 PR Has Huge Diff

```bash
git diff --stat
git diff -w --stat
git diff --check
```

If whitespace-only, revert and fix formatter/line endings.

## 49.3 Build Works Locally, Fails Linux

Check:

```text
case-sensitive paths
executable bits
CRLF scripts
default charset
timezone/locale
OS-specific path separators
```

## 49.4 Git Keeps Showing Mode Changes

```bash
git config core.filemode
git diff --summary
```

If local filesystem issue:

```bash
git config core.filemode false
```

But commit correct mode once.

## 49.5 Case Rename Not Detected

```bash
git mv OldName.java TempName.java
git mv TempName.java NewName.java
```

Commit.

---

## 50. Review Checklist

When reviewing PR:

```text
[ ] Does diff include unexpected line-ending changes?
[ ] Does `git diff --check` pass?
[ ] Are shell scripts LF and executable?
[ ] Are batch/cmd files correct for Windows?
[ ] Are file renames case-only?
[ ] Are YAML/properties whitespace changes intentional?
[ ] Are generated formatting changes separate?
[ ] Are binary files marked/justified?
[ ] Did formatter run on unrelated files?
[ ] Are `.gitattributes` and `.editorconfig` consistent?
```

Commands:

```bash
git diff --check main...HEAD
git diff --name-status main...HEAD
git diff --stat main...HEAD
```

---

## 51. Maintainer Checklist

For repo maintainers:

```text
[ ] Add `.gitattributes`.
[ ] Add `.editorconfig`.
[ ] Normalize line endings in separate commit.
[ ] Add normalization/formatting commits to `.git-blame-ignore-revs`.
[ ] Ensure wrapper scripts executable.
[ ] Ensure shell scripts LF.
[ ] Ensure CI runs on Linux.
[ ] Add formatter check.
[ ] Add whitespace check.
[ ] Document Windows/macOS/Linux setup.
[ ] Avoid case-only rename or handle carefully.
[ ] Audit binary/text attributes.
[ ] Verify build leaves working tree clean.
```

---

## 52. Latihan Praktis

## Latihan 1 — Cek Attribute File

```bash
git check-attr -a -- src/main/java/com/acme/App.java
git check-attr -a -- scripts/run-local.sh
git check-attr -a -- gradlew
```

Jawab:

```text
Apakah file diperlakukan sesuai policy?
```

## Latihan 2 — Cek Whitespace Error

```bash
git diff --check
git diff --cached --check
```

Buat trailing whitespace di file test, lalu lihat output.

## Latihan 3 — Cek Executable Bit

```bash
git ls-files -s mvnw gradlew scripts/*.sh 2>/dev/null
```

Pastikan script penting punya `100755`.

## Latihan 4 — Cek CRLF

```bash
git grep -Il $'\r'
```

Jika shell tidak support, gunakan:

```bash
perl -ne 'print "$ARGV\n" if /\r/; close ARGV' $(git ls-files)
```

Investigasi hasilnya.

## Latihan 5 — Simulasi CRLF Script

Buat script CRLF lalu jalankan di Linux/container.

Lihat error.

Perbaiki dengan `.gitattributes`.

## Latihan 6 — Case Sensitivity

Buat rename case-only di branch lab.

Coba di OS berbeda jika memungkinkan.

Pahami kenapa `git mv` dua langkah kadang perlu.

## Latihan 7 — Renormalize Lab

Di repo kecil:

1. Buat file CRLF dan LF campur.
2. Tambah `.gitattributes`.
3. Jalankan `git add --renormalize .`.
4. Lihat diff.
5. Commit normalisasi terpisah.

---

## 53. Pertanyaan Reflektif

1. Apakah repo Anda punya `.gitattributes`?
2. Apakah repo Anda punya `.editorconfig`?
3. Apakah shell script selalu LF?
4. Apakah `gradlew`/`mvnw` executable di Git?
5. Apakah PR sering punya whitespace-only noise?
6. Apakah formatter dijalankan otomatis dan dicek CI?
7. Apakah formatting-only commit dipisah dari logic?
8. Apakah normalisasi commit masuk `.git-blame-ignore-revs`?
9. Apakah developer Windows dan Linux menghasilkan diff yang sama?
10. Apakah file resource path case-sensitive aman di Linux?
11. Apakah build/test menetapkan UTF-8?
12. Apakah CI menjalankan Linux?
13. Apakah repo punya case-only filename collision?
14. Apakah binary files ditandai benar?
15. Apakah policy lintas platform tertulis?

---

## 54. Mental Model Akhir

Line endings, whitespace, encoding, dan file mode adalah hal kecil yang bisa menjadi gangguan besar.

Git tidak cukup pintar untuk mengetahui semua intent tim.

Karena itu repository harus menyatakan policy eksplisit:

```text
.gitattributes  -> bagaimana Git memperlakukan file
.editorconfig   -> bagaimana editor menulis file
formatter       -> bagaimana source diformat
CI              -> bagaimana policy diverifikasi
CONTRIBUTING    -> bagaimana manusia memahami aturan
```

Untuk Java engineer, targetnya:

```text
Tidak ada diff noise.
Tidak ada script gagal karena CRLF.
Tidak ada CI gagal karena executable bit.
Tidak ada bug Linux-only karena case mismatch.
Tidak ada encoding surprise.
Tidak ada formatting massal tercampur logic.
```

Repository yang sehat membuat review fokus pada perubahan makna, bukan perubahan bytes yang tidak disengaja.

---

## 55. Koneksi ke Part Berikutnya

Part ini membahas cross-platform repository correctness.

Part berikutnya masuk ke automasi lokal dan guardrails:

```text
learn-git-mastery-for-java-engineers-part-023.md
```

Topik:

```text
Git Hooks: Automasi Lokal dan Guardrails
```

Kita akan membahas:

- client-side hooks;
- server-side hooks;
- pre-commit;
- commit-msg;
- pre-push;
- formatter checks;
- secret scanning;
- Conventional Commits;
- hook manager;
- kapan hooks membantu;
- kapan hooks mengganggu;
- perbedaan hooks vs CI.

---

## 56. Referensi

Rujukan utama untuk materi ini:

- Git official documentation: `gitattributes`
- Git official documentation: `git config`, especially `core.autocrlf`, `core.filemode`, `core.ignorecase`
- Git official documentation: `git add --renormalize`
- Git official documentation: `git diff --check`
- Git official documentation: `git ls-files`, `git check-attr`
- EditorConfig specification
- Java/Maven/Gradle build encoding practices
- Praktik umum cross-platform repository hygiene, CI reproducibility, and Java backend delivery

---

## 57. Status Seri

```text
Progress: 022 / 032
Seri belum selesai.
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
```

Bagian berikutnya:

```text
learn-git-mastery-for-java-engineers-part-023.md
```

Topik:

```text
Git Hooks: Automasi Lokal dan Guardrails
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-git-mastery-for-java-engineers-part-021.md](./learn-git-mastery-for-java-engineers-part-021.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-git-mastery-for-java-engineers-part-023.md](./learn-git-mastery-for-java-engineers-part-023.md)

</div>
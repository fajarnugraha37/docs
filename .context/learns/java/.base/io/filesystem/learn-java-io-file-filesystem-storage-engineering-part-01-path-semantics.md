# learn-java-io-file-filesystem-storage-engineering-part-01-path-semantics

# Part 01 — Path Semantics Deep Dive: Name, Root, Absolute, Relative, Normalize, Resolve

> Seri: `learn-java-io-file-filesystem-storage-engineering`  
> Target Java: 8 sampai 25  
> Fokus: memahami `java.nio.file.Path` sebagai model lokasi filesystem, bukan sekadar string path.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan tidak lagi melihat path sebagai string seperti:

```java
"/var/app/data/report.csv"
"C:\\Users\\fajar\\Downloads\\file.txt"
"../../etc/passwd"
```

Tetapi sebagai struktur konseptual yang punya:

1. **filesystem provider**,
2. **root component**,
3. **sequence of name elements**,
4. **absolute/relative semantics**,
5. **normalization semantics**,
6. **resolution semantics**,
7. **real-path/canonicalization semantics**,
8. **platform-specific behavior**.

Di level engineer biasa, path sering diperlakukan sebagai teks.  
Di level engineer yang kuat, path diperlakukan sebagai **alamat simbolik di dalam namespace filesystem yang bisa berubah, bisa ambiguous, bisa disalahgunakan, dan bisa berbeda antar platform/provider**.

---

## 1. Mental Model Utama: `Path` Bukan File

Hal paling penting:

> `Path` adalah representasi lokasi/nama dalam filesystem. `Path` bukan file, bukan directory, bukan file descriptor, dan bukan bukti bahwa sesuatu benar-benar ada.

Contoh:

```java
Path p = Paths.get("/var/app/data/report.csv");
```

Kode di atas belum:

- membuka file,
- mengecek file ada,
- membaca metadata,
- mengunci file,
- membuat file,
- menjamin `/var/app/data/report.csv` valid secara runtime.

Ia hanya membuat object path.

Secara mental:

```text
Path object
  └── symbolic location expression
        └── interpreted by FileSystem
              └── implemented by FileSystemProvider
                    └── mapped to OS/filesystem semantics
```

Java API documentation mendefinisikan `Path` sebagai representasi path hierarkis yang terdiri dari urutan elemen nama, dipisahkan oleh separator/delimiter khusus, dan mungkin punya root component. Definisi ini konsisten dari Java 8 sampai Java 25.

Referensi:

- Java 8 `Path`: https://docs.oracle.com/javase/8/docs/api/java/nio/file/Path.html
- Java 25 `Path`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Path.html

---

## 2. Kenapa Ini Penting?

Banyak bug serius file handling berasal dari pemahaman path yang terlalu dangkal.

Contoh bug:

```java
Path base = Paths.get("/app/uploads");
Path target = base.resolve(userInput);

if (target.startsWith(base)) {
    Files.copy(uploadStream, target);
}
```

Kelihatannya aman. Tapi belum tentu.

Jika `userInput` adalah:

```text
../../etc/passwd
```

maka:

```text
/app/uploads/../../etc/passwd
```

Secara string masih terlihat berawal dari `/app/uploads`, tapi setelah dinormalisasi bisa keluar dari direktori upload.

Lebih parah lagi, jika ada symbolic link di dalam `/app/uploads`, maka path yang tampak aman secara lexical bisa mengarah keluar saat di-resolve oleh filesystem nyata.

Karena itu, path punya beberapa level kebenaran:

```text
Raw path string
  ↓ parsed
Path object
  ↓ lexical normalization
Normalized path
  ↓ filesystem lookup
Real path
  ↓ opened
File descriptor / handle
```

Setiap level punya makna berbeda.

---

## 3. Vocabulary Dasar

Sebelum masuk API, kita perlu stabilkan vocabulary.

### 3.1 Path String

Path string adalah teks mentah:

```text
/var/log/app.log
../data/input.csv
C:\Users\Alice\file.txt
```

String ini belum tentu valid untuk filesystem tertentu.

### 3.2 `Path`

`Path` adalah object Java yang mewakili path di suatu `FileSystem`.

```java
Path path = Paths.get("/var/log/app.log");
```

### 3.3 FileSystem

`FileSystem` adalah konteks interpretasi path.

```java
FileSystem fs = FileSystems.getDefault();
Path p = fs.getPath("/var/log/app.log");
```

Default filesystem biasanya OS filesystem tempat JVM berjalan, tetapi Java NIO juga mendukung provider lain seperti ZIP filesystem.

### 3.4 Root Component

Root adalah bagian yang mengikat path ke akar hierarki filesystem.

Unix-like:

```text
/
```

Windows:

```text
C:\
\\server\share\
```

### 3.5 Name Element

Name element adalah komponen path selain root.

Untuk:

```text
/var/app/data/report.csv
```

komponennya:

```text
root: /
name[0]: var
name[1]: app
name[2]: data
name[3]: report.csv
```

### 3.6 File Name

Dalam API `Path`, file name adalah elemen paling kanan/farthest from root.

Untuk:

```text
/var/app/data/report.csv
```

file name:

```text
report.csv
```

Walaupun namanya “file name”, elemen itu bisa juga directory name.

### 3.7 Parent

Parent adalah path tanpa elemen terakhir.

```text
/var/app/data/report.csv
parent = /var/app/data
```

### 3.8 Absolute Path

Absolute path adalah path yang lengkap dari root filesystem.

Unix:

```text
/var/app/data
```

Windows:

```text
C:\app\data
```

### 3.9 Relative Path

Relative path adalah path yang harus diinterpretasikan relatif terhadap working directory atau path lain.

```text
data/report.csv
../config/app.yml
```

---

## 4. Java 8 sampai 25: `Paths.get` vs `Path.of`

### 4.1 Java 8

Di Java 8, cara umum membuat path adalah:

```java
Path p = Paths.get("data", "input.csv");
```

`Paths` tersedia sejak Java 7.

Referensi Java 8:

- https://docs.oracle.com/javase/8/docs/api/java/nio/file/Paths.html

### 4.2 Java 11+

Sejak Java 11, `Path.of(...)` tersedia dan lebih direkomendasikan.

```java
Path p = Path.of("data", "input.csv");
```

Di dokumentasi Java 25, `Paths` punya API note yang merekomendasikan memperoleh `Path` lewat `Path.of` dibanding `Paths.get`, karena `Paths` dapat dideprekasi di masa depan.

Referensi:

- Java 25 `Paths`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Paths.html

### 4.3 Compatibility Rule

Jika library harus support Java 8:

```java
Path p = Paths.get("data", "input.csv");
```

Jika minimum runtime Java 11+:

```java
Path p = Path.of("data", "input.csv");
```

### 4.4 Prinsip Penting

Jangan membuat path dengan string concatenation manual:

```java
// Buruk
String path = base + "/" + child;

// Lebih benar
Path path = base.resolve(child);
```

Kenapa?

Karena separator, root, absolute path, dan provider semantics tidak bisa direduksi menjadi `"/"`.

---

## 5. Anatomi `Path`

Mari lihat kode:

```java
Path p = Paths.get("/var/app/data/report.csv");

System.out.println("path          = " + p);
System.out.println("root          = " + p.getRoot());
System.out.println("fileName      = " + p.getFileName());
System.out.println("parent        = " + p.getParent());
System.out.println("nameCount     = " + p.getNameCount());

for (int i = 0; i < p.getNameCount(); i++) {
    System.out.println("name[" + i + "]      = " + p.getName(i));
}
```

Pada Unix-like filesystem, output kira-kira:

```text
path          = /var/app/data/report.csv
root          = /
fileName      = report.csv
parent        = /var/app/data
nameCount     = 4
name[0]       = var
name[1]       = app
name[2]       = data
name[3]       = report.csv
```

Untuk relative path:

```java
Path p = Paths.get("data/report.csv");
```

Output kira-kira:

```text
path          = data/report.csv
root          = null
fileName      = report.csv
parent        = data
nameCount     = 2
name[0]       = data
name[1]       = report.csv
```

Perhatikan:

```text
root = null
```

Itu tanda path relatif.

---

## 6. Root Itu Provider-Specific

Jangan hard-code asumsi bahwa root selalu `/`.

Contoh root:

```text
Unix:       /
Windows:    C:\
UNC:        \\server\share\
ZIP FS:     /
Custom FS:  tergantung provider
```

Kode seperti ini rapuh:

```java
if (path.toString().startsWith("/")) {
    // assume absolute
}
```

Lebih benar:

```java
if (path.isAbsolute()) {
    // absolute according to provider
}
```

Atau:

```java
Path root = path.getRoot();
```

### Mental Model

```text
Root is not a character.
Root is a filesystem-specific component.
```

---

## 7. Separator: File Separator vs Path Separator

Ini sering tertukar.

### 7.1 File Separator

File separator memisahkan komponen path.

Unix:

```text
/
```

Windows:

```text
\
```

Di Java:

```java
String sep = File.separator;
String sep2 = System.getProperty("file.separator");
```

### 7.2 Path Separator

Path separator memisahkan beberapa path dalam environment variable seperti classpath.

Unix:

```text
:
```

Windows:

```text
;
```

Di Java:

```java
String pathSep = File.pathSeparator;
String pathSep2 = System.getProperty("path.separator");
```

Oracle tutorial system properties menjelaskan bahwa `file.separator` memisahkan komponen file path, sedangkan `path.separator` memisahkan elemen path list seperti classpath.

Referensi:

- https://docs.oracle.com/javase/tutorial/essential/environment/sysprop.html

### 7.3 Kesalahan Umum

```java
// Salah untuk join path
String s = dir + File.pathSeparator + file;
```

`File.pathSeparator` bukan untuk `/a/b`, tapi untuk list seperti:

```text
lib/a.jar:lib/b.jar
```

---

## 8. Absolute vs Relative: Jangan Anggap Relative Itu Buruk, Tapi Jangan Biarkan Ambiguous

### 8.1 Absolute Path

```java
Path p = Paths.get("/var/app/config.yml");
System.out.println(p.isAbsolute()); // true pada Unix-like
```

Absolute path terikat pada root.

### 8.2 Relative Path

```java
Path p = Paths.get("config/app.yml");
System.out.println(p.isAbsolute()); // false
```

Relative path membutuhkan base.

Base bisa:

- current working directory JVM,
- path lain yang dipakai di `resolve`,
- filesystem provider-specific default directory.

### 8.3 Current Working Directory

```java
Path relative = Paths.get("config/app.yml");
Path absolute = relative.toAbsolutePath();
```

`toAbsolutePath()` mengubah relative menjadi absolute menggunakan default context, biasanya working directory JVM.

Tapi:

```java
Path p = Paths.get("config/app.yml").toAbsolutePath();
```

belum tentu file-nya ada.

### 8.4 Top 1% Rule

Relative path boleh dipakai untuk konfigurasi developer/local, tetapi untuk workflow production sebaiknya segera diubah menjadi base-scoped path eksplisit:

```java
Path appHome = Paths.get(System.getenv("APP_HOME")).toAbsolutePath().normalize();
Path config = appHome.resolve("config/app.yml").normalize();
```

Namun untuk security-sensitive operation, `normalize()` saja tidak cukup. Nanti kita bahas di Part 13.

---

## 9. `getFileName`, `getParent`, `getRoot`, `getName`

### 9.1 `getFileName()`

```java
Path p = Paths.get("/var/app/data/report.csv");
System.out.println(p.getFileName()); // report.csv
```

Untuk path root:

```java
Path p = Paths.get("/");
System.out.println(p.getFileName()); // null pada Unix-like
```

Karena root tidak punya name element.

### 9.2 `getParent()`

```java
Path p = Paths.get("/var/app/data/report.csv");
System.out.println(p.getParent()); // /var/app/data
```

Untuk single relative name:

```java
Path p = Paths.get("report.csv");
System.out.println(p.getParent()); // null
```

Kenapa null?

Karena `report.csv` tidak punya parent secara lexical. Ia bukan berarti parent-nya current directory. Itu asumsi runtime, bukan struktur path object.

### 9.3 `getRoot()`

```java
Path p = Paths.get("/var/app/data/report.csv");
System.out.println(p.getRoot()); // /
```

Untuk relative:

```java
Path p = Paths.get("var/app");
System.out.println(p.getRoot()); // null
```

### 9.4 `getName(int)`

```java
Path p = Paths.get("/var/app/data/report.csv");

for (int i = 0; i < p.getNameCount(); i++) {
    System.out.println(p.getName(i));
}
```

Output:

```text
var
app
data
report.csv
```

Root tidak masuk `getName(i)`.

---

## 10. `subpath`: Mengambil Potongan Name Element

```java
Path p = Paths.get("/var/app/data/report.csv");

System.out.println(p.subpath(0, 2)); // var/app
System.out.println(p.subpath(1, 3)); // app/data
System.out.println(p.subpath(2, 4)); // data/report.csv
```

`subpath(begin, end)` memakai indeks name element, bukan karakter.

Untuk:

```text
/var/app/data/report.csv
```

name elements:

```text
0 = var
1 = app
2 = data
3 = report.csv
```

Maka:

```java
p.subpath(0, 2)
```

menghasilkan:

```text
var/app
```

Perhatikan: hasil `subpath` tidak menyertakan root.

---

## 11. `resolve`: Menggabungkan Path Secara Semantik

### 11.1 Basic Resolve

```java
Path base = Paths.get("/var/app");
Path child = Paths.get("data/report.csv");

Path result = base.resolve(child);
System.out.println(result); // /var/app/data/report.csv
```

Mental model:

```text
base + relative child = child interpreted under base
```

### 11.2 Resolve String

```java
Path result = base.resolve("data/report.csv");
```

Ini convenience method yang mengubah string menjadi Path lalu resolve.

### 11.3 Absolute Child Override

Ini bagian penting.

```java
Path base = Paths.get("/var/app");
Path child = Paths.get("/etc/passwd");

Path result = base.resolve(child);
System.out.println(result); // /etc/passwd
```

Jika `other` absolute, hasil resolve biasanya `other` itu sendiri.

Artinya, ini berbahaya:

```java
Path target = uploadBase.resolve(userInput);
```

Jika user input bisa absolute path, base bisa diabaikan.

### 11.4 Defensive Pattern

Untuk input user, tolak absolute path:

```java
Path input = Paths.get(userInput);

if (input.isAbsolute()) {
    throw new IllegalArgumentException("Absolute paths are not allowed");
}

Path target = base.resolve(input).normalize();
```

Tapi sekali lagi, ini belum cukup untuk melawan symlink race. Ini hanya tahap lexical safety.

---

## 12. `resolveSibling`: Mengganti Nama di Parent Yang Sama

Misalnya:

```java
Path original = Paths.get("/var/app/data/report.csv");
Path renamed = original.resolveSibling("report.done");

System.out.println(renamed); // /var/app/data/report.done
```

Mental model:

```text
resolve sibling = parent.resolve(newName)
```

Berguna untuk:

- mengganti extension,
- membuat temporary sidecar file,
- membuat `.tmp`, `.lock`, `.done`, `.metadata`.

Contoh:

```java
Path payload = Paths.get("/inbox/order-123.json");
Path lock = payload.resolveSibling(payload.getFileName() + ".lock");
Path done = payload.resolveSibling(payload.getFileName() + ".done");
```

Namun hati-hati: `payload.getFileName() + ".lock"` akan memanggil `toString()` pada `Path`. Untuk filename sederhana biasanya aman, tapi jika ingin eksplisit:

```java
String filename = payload.getFileName().toString();
Path lock = payload.resolveSibling(filename + ".lock");
```

---

## 13. `relativize`: Membuat Path Relatif Dari Satu Path ke Path Lain

### 13.1 Basic Example

```java
Path base = Paths.get("/var/app");
Path target = Paths.get("/var/app/data/report.csv");

Path relative = base.relativize(target);
System.out.println(relative); // data/report.csv
```

Mental model:

```text
base.relativize(target) = path from base to target
```

### 13.2 Sibling Example

```java
Path from = Paths.get("/var/app/logs");
Path to = Paths.get("/var/app/data/report.csv");

System.out.println(from.relativize(to)); // ../data/report.csv
```

### 13.3 Absolute vs Relative Must Match

Biasanya kamu tidak bisa relativize absolute path terhadap relative path.

```java
Path a = Paths.get("/var/app");
Path b = Paths.get("data/report.csv");

Path r = a.relativize(b); // IllegalArgumentException pada default Unix-like FS
```

Rule mental:

```text
relativize works between paths in compatible coordinate systems.
```

### 13.4 Use Case

`relativize` berguna untuk:

- menyimpan path relatif ke database,
- membuat manifest file,
- export/import tree,
- logging path tanpa membocorkan absolute server path,
- mapping filesystem path ke logical key.

Contoh:

```java
Path root = Paths.get("/data/archive");
Path file = Paths.get("/data/archive/2026/06/report.csv");

String logicalKey = root.relativize(file).toString();
// 2026/06/report.csv
```

---

## 14. `normalize`: Lexical Cleanup, Bukan Filesystem Lookup

### 14.1 Apa Yang Dilakukan `normalize`

```java
Path p = Paths.get("/var/app/../log/./app.log");
System.out.println(p.normalize()); // /var/log/app.log
```

`normalize()` menghapus elemen redundant seperti:

```text
.
..
```

secara lexical.

### 14.2 Lexical Artinya Apa?

Lexical berarti hanya berdasarkan struktur path, tanpa cek filesystem.

```java
Path p = Paths.get("/a/b/../c");
Path n = p.normalize();
```

Java tidak perlu tahu apakah:

- `/a` ada,
- `/a/b` ada,
- `/a/b` adalah directory,
- `/a/b` adalah symbolic link.

### 14.3 Symlink Problem

Misalnya filesystem nyata:

```text
/app/base/link -> /etc
```

Path:

```text
/app/base/link/../safe.txt
```

Secara lexical:

```text
/app/base/safe.txt
```

Tapi jika `link` diikuti sebagai symlink, traversal runtime bisa berbeda.

Karena itu:

> `normalize()` bukan security boundary.

### 14.4 Kapan `normalize` Berguna?

Berguna untuk:

- canonical-looking logging,
- lexical comparison,
- menghapus `.` dan `..` sebelum validasi awal,
- membuat path lebih stabil untuk manifest,
- mencegah path bloat.

Tidak cukup untuk:

- membuktikan file berada di bawah base directory,
- melawan symlink attack,
- membuktikan file benar-benar ada,
- membuktikan dua path menunjuk file yang sama.

---

## 15. `toAbsolutePath`: Membuat Absolute, Tapi Belum Real

```java
Path p = Paths.get("data/report.csv");
Path abs = p.toAbsolutePath();

System.out.println(abs);
```

Jika working directory JVM adalah:

```text
/home/app
```

hasilnya bisa:

```text
/home/app/data/report.csv
```

Namun:

```java
Path abs = Paths.get("missing.txt").toAbsolutePath();
```

Tidak berarti `missing.txt` ada.

### Top 1% Rule

`toAbsolutePath()` menjawab:

```text
Path ini absolute-nya seperti apa menurut context sekarang?
```

Bukan:

```text
Path ini benar-benar eksis dan canonical di filesystem?
```

---

## 16. `toRealPath`: Filesystem Lookup dan Canonical-Like Resolution

```java
Path p = Paths.get("data/report.csv");
Path real = p.toRealPath();
```

`toRealPath()` melakukan filesystem lookup.

Ia bisa:

- mengubah menjadi absolute,
- menyelesaikan symbolic link secara default,
- menghapus redundant name element,
- gagal jika file tidak ada,
- gagal jika permission tidak cukup.

### 16.1 Dengan `NOFOLLOW_LINKS`

```java
Path real = p.toRealPath(LinkOption.NOFOLLOW_LINKS);
```

Ini memengaruhi symbolic link handling.

### 16.2 Perbedaan Dengan `normalize`

```java
Path p = Paths.get("/app/base/../config.yml");

Path normalized = p.normalize();
Path real = p.toRealPath();
```

`normalize()`:

```text
lexical only
may work even if file does not exist
```

`toRealPath()`:

```text
filesystem lookup
requires existence
may resolve symlinks
may throw IOException
```

### 16.3 Use Case

`toRealPath()` berguna untuk:

- membandingkan lokasi aktual,
- validasi path existing,
- audit filesystem,
- mencegah path ambiguity,
- canonicalization sebelum operasi sensitif.

Namun tetap hati-hati: untuk operation yang nanti membuka file, masih ada race antara validasi dan open. Ini akan dibahas dalam security part.

---

## 17. `startsWith` dan `endsWith`: Path-Aware, Tapi Tetap Lexical

### 17.1 `startsWith`

```java
Path base = Paths.get("/var/app");
Path file = Paths.get("/var/app/data/report.csv");

System.out.println(file.startsWith(base)); // true
```

Ini path-aware, bukan string `startsWith`.

Bandingkan:

```java
Path base = Paths.get("/var/app");
Path tricky = Paths.get("/var/application/file.txt");

System.out.println(tricky.startsWith(base)); // false
```

String check bisa salah:

```java
"/var/application/file.txt".startsWith("/var/app") // true, tapi salah secara path boundary
```

### 17.2 `endsWith`

```java
Path p = Paths.get("/var/app/data/report.csv");

System.out.println(p.endsWith("report.csv"));      // true
System.out.println(p.endsWith("data/report.csv")); // true
System.out.println(p.endsWith("app/report.csv"));  // false
```

### 17.3 Security Caveat

Walaupun path-aware, `startsWith` tetap lexical terhadap path object.

```java
Path base = Paths.get("/app/uploads").toAbsolutePath().normalize();
Path target = base.resolve("link/passwd").normalize();

if (target.startsWith(base)) {
    // lexical containment true
}
```

Jika `link` adalah symlink ke `/etc`, real target bisa keluar.

Jadi:

```text
startsWith is useful, but not sufficient for symlink-safe containment.
```

---

## 18. `equals`, `compareTo`, dan `isSameFile`

### 18.1 `equals`

```java
Path a = Paths.get("/var/app/../log/app.log");
Path b = Paths.get("/var/log/app.log");

System.out.println(a.equals(b)); // biasanya false
System.out.println(a.normalize().equals(b)); // bisa true
```

`equals` membandingkan path object semantics, bukan file identity.

### 18.2 `compareTo`

`compareTo` memberi ordering antar path dari provider yang sama. Ini bukan ordering filesystem universal.

### 18.3 `Files.isSameFile`

Untuk mengecek apakah dua path menunjuk file yang sama:

```java
boolean same = Files.isSameFile(a, b);
```

Ini bisa melakukan filesystem access dan bisa throw `IOException`.

Gunakan untuk identity, bukan `Path.equals`.

### Rule

```text
Path.equals       = path object equality
normalize.equals  = lexical simplified equality
isSameFile        = filesystem identity check
```

---

## 19. Empty Path dan Current Directory

```java
Path p = Paths.get("");
```

Empty path adalah path dengan zero name elements. Dalam banyak default filesystem, ia merepresentasikan current directory secara konseptual saat di-resolve.

Contoh:

```java
Path empty = Paths.get("");
System.out.println(empty.toAbsolutePath());
```

Bisa menghasilkan working directory.

Namun jangan terlalu sering memakai empty path dalam production logic kecuali memang disengaja.

Lebih eksplisit:

```java
Path cwd = Paths.get(".").toAbsolutePath().normalize();
```

Atau lebih baik lagi, ambil base directory dari config/env.

---

## 20. Dot dan Dot-Dot: `.` dan `..`

### 20.1 Dot

```text
.
```

Berarti current directory secara lexical.

```java
Paths.get("./data/report.csv").normalize()
// data/report.csv
```

### 20.2 Dot-Dot

```text
..
```

Berarti parent directory secara lexical.

```java
Paths.get("/var/app/../log/app.log").normalize()
// /var/log/app.log
```

### 20.3 Security Warning

`..` pada input user harus dianggap mencurigakan, tetapi sekadar memblokir substring `".."` juga tidak cukup karena:

- encoded input,
- unicode lookalike,
- separator alternatif,
- symlink,
- provider-specific behavior,
- archive path traversal.

Part 13 akan membahas khusus path traversal.

---

## 21. Windows Path Semantics Yang Sering Menjebak

Bagian ini penting meskipun server production kamu Linux, karena:

- developer sering pakai Windows,
- CI bisa jalan di Windows,
- aplikasi desktop Java bisa multi-platform,
- ZIP/archive bisa membawa path Windows-like,
- test portability bisa rusak.

### 21.1 Drive Letter

Contoh:

```text
C:\Users\Alice\file.txt
```

Root bisa melibatkan drive.

### 21.2 Backslash Separator

Windows memakai:

```text
\
```

Tapi Java string butuh escaping:

```java
Path p = Paths.get("C:\\Users\\Alice\\file.txt");
```

Lebih baik:

```java
Path p = Paths.get("C:", "Users", "Alice", "file.txt");
```

Atau Java 11+:

```java
Path p = Path.of("C:", "Users", "Alice", "file.txt");
```

Namun hati-hati: drive-root semantics bisa tricky.

### 21.3 UNC Path

```text
\\server\share\folder\file.txt
```

UNC path menunjuk network share.

### 21.4 Reserved Names

Windows punya reserved names seperti:

```text
CON
PRN
AUX
NUL
COM1
LPT1
```

Path yang valid di Linux bisa gagal di Windows.

### 21.5 Case Insensitivity

Banyak Windows filesystem case-insensitive:

```text
Report.csv
report.csv
REPORT.CSV
```

bisa menunjuk file yang sama.

Jangan pakai asumsi case-sensitive untuk logic portability.

---

## 22. Unix/Linux Path Semantics Yang Sering Disederhanakan

### 22.1 Root Tunggal

Unix-like filesystem punya root `/`.

Tapi mount point membuat banyak filesystem bisa muncul di bawah satu namespace:

```text
/
/home
/mnt/data
/var/lib/app
```

Dua path bisa terlihat dalam satu tree tetapi sebenarnya berada pada filesystem berbeda.

Ini penting untuk atomic move:

```text
/var/app/tmp/file.tmp
/var/app/final/file.dat
```

Jika keduanya berbeda mount/filesystem, rename atomic bisa gagal atau tidak berlaku.

### 22.2 Slash Dalam Filename Tidak Boleh

Pada Unix-like filesystem, `/` adalah separator dan tidak bisa menjadi bagian filename.

### 22.3 Null Byte Tidak Boleh

Null byte tidak valid di path. Di Java modern, path parsing akan menolak invalid char tertentu tergantung provider.

### 22.4 Hidden File

Unix hidden file biasanya nama diawali titik:

```text
.env
.gitignore
```

Ini berbeda dari Windows hidden attribute.

---

## 23. Provider Semantics: Path Tidak Selalu Default OS File

Kita sering berpikir:

```java
Path p = Paths.get("/tmp/a.txt");
```

berarti local OS file.

Untuk default filesystem, iya. Tapi NIO memungkinkan filesystem provider lain.

Contoh ZIP filesystem:

```java
URI uri = URI.create("jar:file:/tmp/archive.zip");
try (FileSystem zipFs = FileSystems.newFileSystem(uri, Map.of())) {
    Path insideZip = zipFs.getPath("/data/report.csv");
}
```

`insideZip` adalah `Path`, tapi bukan path OS biasa.

Konsekuensi:

- separator bisa provider-specific,
- attribute support bisa berbeda,
- `toFile()` bisa tidak didukung,
- file operation bisa punya cost/semantics berbeda,
- tidak semua provider mendukung semua fitur.

Referensi package `java.nio.file` Java 25 menjelaskan bahwa package ini mendefinisikan class untuk akses file dan filesystem, sementara package SPI digunakan implementor provider untuk memperluas default provider atau membangun provider lain.

Referensi:

- https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/package-summary.html

---

## 24. `Path.toFile()` dan `File.toPath()`

### 24.1 `Path.toFile()`

```java
Path p = Paths.get("data/report.csv");
File f = p.toFile();
```

Ini berguna untuk interop dengan API lama.

Namun tidak semua `Path` bisa dikonversi ke `File`. Path dari provider non-default bisa throw `UnsupportedOperationException`.

### 24.2 `File.toPath()`

```java
File f = new File("data/report.csv");
Path p = f.toPath();
```

Ini migration bridge dari legacy `java.io.File`.

### 24.3 Rule

```text
Use Path as primary abstraction.
Convert to File only at legacy boundary.
```

---

## 25. URI dan Path

`Path` bisa dibuat dari URI:

```java
Path p = Paths.get(URI.create("file:///var/app/data/report.csv"));
```

Di Java 11+:

```java
Path p = Path.of(URI.create("file:///var/app/data/report.csv"));
```

Namun jangan bingung:

```text
URI != Path string
```

URI punya:

- scheme,
- authority,
- escaping rules,
- encoding semantics.

Path string punya filesystem parsing rules.

Contoh path dengan spasi:

```text
/var/app/my file.txt
```

URI bisa menjadi:

```text
file:///var/app/my%20file.txt
```

Jangan encode/decode path sembarangan.

---

## 26. Path Matching: Glob dan Regex

`FileSystem` menyediakan `getPathMatcher`.

```java
PathMatcher matcher = FileSystems.getDefault()
    .getPathMatcher("glob:**/*.java");

boolean matched = matcher.matches(Paths.get("src/main/App.java"));
```

Oracle tutorial menjelaskan bahwa `PathMatcher` bisa diperoleh dari `FileSystem.getPathMatcher(String)`.

Referensi:

- https://docs.oracle.com/javase/tutorial/essential/io/find.html
- Java 8 `FileSystem`: https://docs.oracle.com/javase/8/docs/api/java/nio/file/FileSystem.html

### 26.1 Glob vs Regex

Glob:

```text
glob:**/*.java
```

Regex:

```text
regex:.*\.java
```

### 26.2 Important Caveat

Path matching bergantung pada provider dan path representation.

Jangan samakan glob path dengan string regex biasa.

---

## 27. Anti-Pattern: Path String Concatenation

### 27.1 Buruk

```java
String path = baseDir + "/" + filename;
```

Masalah:

- separator tidak portable,
- double separator,
- absolute child tidak terdeteksi,
- path traversal tidak terkontrol,
- provider semantics hilang,
- sulit diuji.

### 27.2 Lebih Baik

```java
Path path = baseDir.resolve(filename);
```

### 27.3 Lebih Baik Lagi Untuk Input User

```java
Path base = Paths.get("/app/uploads").toAbsolutePath().normalize();
Path input = Paths.get(userInput);

if (input.isAbsolute()) {
    throw new IllegalArgumentException("Absolute path is not allowed");
}

Path target = base.resolve(input).normalize();

if (!target.startsWith(base)) {
    throw new IllegalArgumentException("Path escapes base directory");
}
```

Ini lexical containment. Untuk symlink-safe containment, perlu strategi tambahan.

---

## 28. Anti-Pattern: Validasi Dengan String Prefix

### 28.1 Buruk

```java
String base = "/app/uploads";
String target = base + "/" + userInput;

if (!target.startsWith(base)) {
    throw new SecurityException();
}
```

Masalah:

```text
/app/uploads_evil/file.txt
```

akan lolos string prefix terhadap `/app/uploads`.

### 28.2 Lebih Baik

```java
Path base = Paths.get("/app/uploads").toAbsolutePath().normalize();
Path target = base.resolve(userInput).normalize();

if (!target.startsWith(base)) {
    throw new SecurityException("Escaped base directory");
}
```

Tetap lexical, tapi minimal path-aware.

---

## 29. Anti-Pattern: Menganggap `normalize()` Membuat Path Aman

```java
Path target = base.resolve(userInput).normalize();

if (target.startsWith(base)) {
    Files.write(target, bytes);
}
```

Ini belum aman jika:

```text
base/safe-link -> /etc
```

Lalu user input:

```text
safe-link/passwd
```

Secara lexical masih di bawah base. Secara real path bisa keluar.

Solusi final butuh:

- base real path,
- symlink policy,
- secure open strategy,
- permission boundary,
- possible OS-level sandbox/container boundary.

Akan dibahas di Part 12 dan Part 13.

---

## 30. Anti-Pattern: Menganggap `toAbsolutePath()` Mengecek File Ada

```java
Path p = Paths.get("missing.txt").toAbsolutePath();
```

Ini tidak mengecek existence.

Jika butuh existence:

```java
Files.exists(p)
```

Jika butuh real canonical path existing:

```java
p.toRealPath()
```

Jika butuh buka file dengan race-safe behavior, gunakan open operation langsung dengan option yang sesuai. Ini dibahas di part selanjutnya.

---

## 31. Path Operation Classification

Untuk membangun mental model kuat, kelompokkan operasi path:

| Operasi | Lexical? | Filesystem Access? | Bisa Throw IOException? | Catatan |
|---|---:|---:|---:|---|
| `getFileName()` | Ya | Tidak | Tidak | Ambil elemen terakhir |
| `getParent()` | Ya | Tidak | Tidak | Parent lexical |
| `getRoot()` | Ya | Tidak | Tidak | Root provider-specific |
| `resolve()` | Ya | Tidak | Tidak | Gabung path |
| `relativize()` | Ya | Tidak | Tidak biasanya, tapi bisa IllegalArgumentException | Butuh path kompatibel |
| `normalize()` | Ya | Tidak | Tidak | Hapus `.` dan `..` secara lexical |
| `toAbsolutePath()` | Mostly lexical/contextual | Tidak harus lookup | Bisa SecurityException di environment tertentu | Pakai cwd/context |
| `toRealPath()` | Tidak hanya lexical | Ya | Ya | Resolve real path, existence, symlink |
| `Files.isSameFile()` | Tidak | Ya | Ya | Cek identity file |

Rule:

```text
Lexical path operation does not prove filesystem truth.
```

---

## 32. Practical Pattern: Base Directory Initialization

Untuk aplikasi production, tentukan base directory secara eksplisit.

```java
public final class AppPaths {
    private final Path appHome;
    private final Path uploadDir;
    private final Path stagingDir;
    private final Path archiveDir;

    public AppPaths(String appHomeValue) {
        this.appHome = Paths.get(appHomeValue).toAbsolutePath().normalize();
        this.uploadDir = appHome.resolve("uploads").normalize();
        this.stagingDir = appHome.resolve("staging").normalize();
        this.archiveDir = appHome.resolve("archive").normalize();
    }

    public Path appHome() {
        return appHome;
    }

    public Path uploadDir() {
        return uploadDir;
    }

    public Path stagingDir() {
        return stagingDir;
    }

    public Path archiveDir() {
        return archiveDir;
    }
}
```

Jika Java 11+:

```java
this.appHome = Path.of(appHomeValue).toAbsolutePath().normalize();
```

### Kenapa Base Directory Di-normalize?

Agar base stabil secara lexical:

```text
/app/service/../service/uploads
```

menjadi:

```text
/app/service/uploads
```

Tapi untuk security-sensitive base, sebaiknya saat startup gunakan:

```java
this.appHome = Paths.get(appHomeValue).toRealPath();
```

Dengan catatan directory harus sudah ada.

---

## 33. Practical Pattern: Resolve User Relative Path Secara Lexical

```java
public static Path resolveUserPathLexically(Path base, String userInput) {
    Path input = Paths.get(userInput);

    if (input.isAbsolute()) {
        throw new IllegalArgumentException("Absolute path is not allowed: " + userInput);
    }

    Path normalizedBase = base.toAbsolutePath().normalize();
    Path target = normalizedBase.resolve(input).normalize();

    if (!target.startsWith(normalizedBase)) {
        throw new IllegalArgumentException("Path escapes base directory: " + userInput);
    }

    return target;
}
```

### Apa Yang Dilindungi?

Melindungi dari lexical escape seperti:

```text
../../etc/passwd
```

### Apa Yang Belum Dilindungi?

Belum melindungi dari symlink escape.

Contoh:

```text
base/link -> /etc
userInput = link/passwd
```

Itu masih perlu strategi symlink-safe.

---

## 34. Practical Pattern: Storage Key vs Filesystem Path

Dalam sistem production, jangan simpan absolute path mentah sebagai business identifier.

Lebih baik pisahkan:

```text
Business object:
  documentId = 123
  storageKey = 2026/06/18/123/original.pdf

Runtime filesystem:
  baseDir.resolve(storageKey)
```

Contoh:

```java
public final class StoragePathResolver {
    private final Path baseDir;

    public StoragePathResolver(Path baseDir) {
        this.baseDir = baseDir.toAbsolutePath().normalize();
    }

    public Path resolveStorageKey(String storageKey) {
        Path key = Paths.get(storageKey);

        if (key.isAbsolute()) {
            throw new IllegalArgumentException("Storage key must be relative");
        }

        Path resolved = baseDir.resolve(key).normalize();

        if (!resolved.startsWith(baseDir)) {
            throw new IllegalArgumentException("Storage key escapes base directory");
        }

        return resolved;
    }
}
```

### Kenapa Ini Penting?

Karena path absolute:

```text
/var/app/storage/2026/06/18/123/original.pdf
```

adalah deployment detail.

Sedangkan storage key:

```text
2026/06/18/123/original.pdf
```

adalah logical location.

Dengan pemisahan ini, kamu bisa pindah dari:

- local filesystem,
- mounted volume,
- object storage,
- archive storage,
- test in-memory filesystem,

lebih mudah.

---

## 35. Case Study: Upload File Dengan Path Input User

### 35.1 Requirement

User upload file dengan original filename.

Contoh filename:

```text
invoice.pdf
```

Tapi attacker bisa kirim:

```text
../../../../etc/passwd
```

atau:

```text
C:\Windows\System32\drivers\etc\hosts
```

atau:

```text
folder/evil.txt
```

### 35.2 Rule Yang Lebih Aman

Untuk uploaded original filename, biasanya jangan jadikan input itu path.

Ambil hanya filename terakhir atau generate nama baru.

```java
String original = submittedFilename;
String safeStoredName = UUID.randomUUID() + ".bin";
Path target = uploadDir.resolve(safeStoredName);
```

Simpan original filename sebagai metadata, bukan sebagai path.

```text
storedName:  7d4b2c5e-9f6e-4e95-8017-6e91b7.bin
originalName: invoice.pdf
```

### 35.3 Kenapa?

Karena original filename adalah user-controlled data.

Jangan beri user kemampuan memilih path storage internal.

---

## 36. Case Study: Manifest File Dengan Relative Path

Misalnya kamu punya export bundle:

```text
/export-root
  /docs/a.pdf
  /docs/b.pdf
  /metadata/index.json
```

Kamu ingin manifest:

```json
{
  "files": [
    "docs/a.pdf",
    "docs/b.pdf",
    "metadata/index.json"
  ]
}
```

Gunakan `relativize`:

```java
Path exportRoot = Paths.get("/export-root").toAbsolutePath().normalize();
Path file = Paths.get("/export-root/docs/a.pdf").toAbsolutePath().normalize();

Path relative = exportRoot.relativize(file);
String key = relative.toString();
```

Namun jika manifest akan dipakai lintas OS, jangan langsung percaya separator lokal.

Di Windows, `relative.toString()` bisa menghasilkan:

```text
docs\a.pdf
```

Untuk manifest portable, kamu bisa standardisasi ke `/` sebagai logical separator:

```java
String key = relative.toString().replace(File.separatorChar, '/');
```

Atau bangun logical key secara eksplisit.

### Important Distinction

```text
Filesystem path separator != logical storage key separator
```

---

## 37. Case Study: Config Directory Dari Environment Variable

Misalnya:

```text
APP_CONFIG_DIR=../config
```

Kode:

```java
Path configDir = Paths.get(System.getenv("APP_CONFIG_DIR"))
    .toAbsolutePath()
    .normalize();
```

Ini menghasilkan absolute lexical path.

Jika config directory wajib ada:

```java
Path configDir = Paths.get(System.getenv("APP_CONFIG_DIR"))
    .toRealPath();
```

Jika tidak ada, startup gagal. Itu bisa menjadi behavior yang bagus untuk aplikasi production.

### Policy Design

Pilih salah satu:

1. **Strict startup**: directory harus ada, permission benar, gagal cepat.
2. **Auto-create**: aplikasi membuat directory jika belum ada.
3. **Lazy create**: directory dibuat saat dibutuhkan.

Untuk sistem regulatory/enterprise, strict startup sering lebih defensible karena environment misconfiguration terdeteksi lebih awal.

---

## 38. Case Study: Extension Replacement

Buruk:

```java
String out = input.toString().replace(".csv", ".done");
```

Masalah:

```text
/report.csv.backup
/report.csv/data
```

Lebih eksplisit:

```java
Path input = Paths.get("/data/report.csv");
String name = input.getFileName().toString();

if (!name.endsWith(".csv")) {
    throw new IllegalArgumentException("Not a CSV file");
}

String newName = name.substring(0, name.length() - ".csv".length()) + ".done";
Path done = input.resolveSibling(newName);
```

Atau jika hanya sidecar:

```java
Path done = input.resolveSibling(name + ".done");
```

---

## 39. Aplikasi Mental Model Pada Design

Ketika mendesain file workflow, selalu jawab pertanyaan berikut:

### 39.1 Dari Mana Path Berasal?

- hardcoded?
- config?
- environment variable?
- user input?
- database?
- archive entry?
- external system?

Semakin tidak trusted sumbernya, semakin ketat validasinya.

### 39.2 Apakah Path Harus Ada?

- path existing?
- file baru?
- parent directory harus ada?
- boleh auto-create?

### 39.3 Apakah Path Harus Tetap Di Bawah Base Directory?

Jika ya, lexical containment saja atau symlink-safe containment?

### 39.4 Apakah Path Akan Disimpan?

Jika disimpan ke DB, lebih baik simpan logical key, bukan absolute path.

### 39.5 Apakah Path Portable?

Apakah path akan dipindah antar OS? Jika iya, jangan simpan separator lokal sembarangan.

### 39.6 Apakah Path Akan Dibandingkan?

Bandingkan apa?

```text
Path syntax?        Path.equals
Lexical normalized? normalize().equals
Actual same file?   Files.isSameFile
Logical same key?   domain-specific comparison
```

---

## 40. Checklist Path Engineering

Gunakan checklist ini setiap menulis file code:

```text
[ ] Apakah saya memakai Path, bukan string concatenation?
[ ] Apakah saya tahu path ini berasal dari trusted atau untrusted source?
[ ] Apakah absolute path dari input user ditolak jika tidak boleh?
[ ] Apakah relative path di-resolve terhadap base eksplisit?
[ ] Apakah normalize dipakai hanya sebagai lexical cleanup, bukan security final?
[ ] Apakah saya membedakan toAbsolutePath dan toRealPath?
[ ] Apakah saya membedakan path equality dan file identity?
[ ] Apakah saya mempertimbangkan separator lintas OS?
[ ] Apakah saya menyimpan logical storage key, bukan absolute deployment path?
[ ] Apakah symlink behavior sudah dipikirkan?
[ ] Apakah provider non-default bisa muncul di test atau runtime?
[ ] Apakah kode support Java 8 atau boleh memakai Path.of?
```

---

## 41. Java Version Notes: 8 sampai 25

### Java 8

Gunakan:

```java
Paths.get("a", "b", "c.txt")
```

`Path`, `Paths`, `Files`, `FileSystem`, `FileSystems` sudah tersedia.

### Java 11+

Bisa gunakan:

```java
Path.of("a", "b", "c.txt")
```

### Java 25

Dokumentasi Java 25 masih mempertahankan API `Path`, `Paths`, `Files`, dan package `java.nio.file`. Namun API note pada `Paths` merekomendasikan `Path.of` dibanding `Paths.get`.

Rule praktis:

```text
Library Java 8 compatible: use Paths.get
Application Java 11+: prefer Path.of
Shared educational material: show both when relevant
```

---

## 42. Common Failure Modes

### 42.1 File Tidak Ditemukan Karena Working Directory Berbeda

```java
Path p = Paths.get("config/app.yml");
```

Di local jalan karena cwd project root. Di production gagal karena cwd `/` atau `/app`.

Solusi:

```java
Path config = appHome.resolve("config/app.yml");
```

### 42.2 Upload Keluar Directory

```java
Path target = uploadDir.resolve(userInput);
```

Input:

```text
../../secret.txt
```

Solusi lexical awal:

```java
target = uploadDir.resolve(userPath).normalize();
if (!target.startsWith(uploadDir)) reject;
```

Solusi final harus pertimbangkan symlink.

### 42.3 Windows Test Gagal Karena Hardcoded Slash

```java
assertEquals("data/report.csv", path.toString());
```

Di Windows bisa:

```text
data\report.csv
```

Solusi:

```java
assertEquals(Paths.get("data", "report.csv"), path);
```

Atau untuk logical key:

```java
String key = path.toString().replace(File.separatorChar, '/');
```

### 42.4 `relativize` Throw Exception

Karena satu path absolute, satu relative.

Solusi:

```java
Path base = basePath.toAbsolutePath().normalize();
Path target = targetPath.toAbsolutePath().normalize();
Path rel = base.relativize(target);
```

### 42.5 `Path.toFile()` Gagal Pada Provider Non-Default

Jika memakai ZIP filesystem atau custom filesystem, `toFile()` bisa tidak supported.

Solusi:

```text
Gunakan Files API sebisa mungkin.
Hanya convert ke File di legacy boundary.
```

---

## 43. Mini Lab: Eksperimen Path Semantics

Buat class:

```java
import java.nio.file.Path;
import java.nio.file.Paths;

public class PathSemanticsLab {
    public static void main(String[] args) {
        inspect(Paths.get("/var/app/data/report.csv"));
        inspect(Paths.get("data/report.csv"));
        inspect(Paths.get("../config/app.yml"));
        inspect(Paths.get("."));
        inspect(Paths.get(""));
    }

    private static void inspect(Path p) {
        System.out.println("==============================");
        System.out.println("path           : " + p);
        System.out.println("isAbsolute     : " + p.isAbsolute());
        System.out.println("root           : " + p.getRoot());
        System.out.println("parent         : " + p.getParent());
        System.out.println("fileName       : " + p.getFileName());
        System.out.println("nameCount      : " + p.getNameCount());
        System.out.println("normalize      : " + p.normalize());
        System.out.println("toAbsolutePath : " + p.toAbsolutePath());

        for (int i = 0; i < p.getNameCount(); i++) {
            System.out.println("name[" + i + "]        : " + p.getName(i));
        }
    }
}
```

Jalankan di Linux/macOS dan Windows jika memungkinkan. Perhatikan perbedaan output.

---

## 44. Mini Lab: Resolve dan Relativize

```java
import java.nio.file.Path;
import java.nio.file.Paths;

public class ResolveRelativizeLab {
    public static void main(String[] args) {
        Path base = Paths.get("/var/app");

        Path child = Paths.get("data/report.csv");
        Path absoluteChild = Paths.get("/etc/passwd");

        System.out.println(base.resolve(child));
        System.out.println(base.resolve(absoluteChild));

        Path target = Paths.get("/var/app/data/report.csv");
        System.out.println(base.relativize(target));

        Path siblingFrom = Paths.get("/var/app/logs");
        Path siblingTo = Paths.get("/var/app/data/report.csv");
        System.out.println(siblingFrom.relativize(siblingTo));
    }
}
```

Expected pada Unix-like:

```text
/var/app/data/report.csv
/etc/passwd
data/report.csv
../data/report.csv
```

Perhatikan bahwa absolute child mengabaikan base.

---

## 45. Mini Lab: Normalize Bukan Real Path

```java
import java.nio.file.Path;
import java.nio.file.Paths;

public class NormalizeLab {
    public static void main(String[] args) throws Exception {
        Path p = Paths.get("/tmp/does-not-need-to-exist/../file.txt");

        System.out.println("raw       : " + p);
        System.out.println("normalize : " + p.normalize());

        try {
            System.out.println("real      : " + p.toRealPath());
        } catch (Exception e) {
            System.out.println("toRealPath failed: " + e.getClass().getName() + " - " + e.getMessage());
        }
    }
}
```

Lesson:

```text
normalize can succeed even when filesystem lookup fails.
```

---

## 46. Design Heuristics Untuk Engineer Senior

### 46.1 Jangan Biarkan Path Ambiguous Terlalu Lama

Begitu path masuk sistem:

```text
raw input
  → parse as Path
  → reject unsupported form
  → resolve against explicit base
  → normalize lexically
  → optionally real-path validate
  → use in operation
```

### 46.2 Pisahkan Path Untuk Manusia dan Path Untuk Mesin

Human/original filename:

```text
Invoice June 2026.pdf
```

Machine storage path:

```text
2026/06/18/01JY4K7M7Z6N9R8N3Q5.pdf
```

Jangan jadikan original filename sebagai storage authority.

### 46.3 Jangan Menganggap Filesystem Sama Dengan Object Storage

Path seperti:

```text
2026/06/18/report.pdf
```

bisa menjadi:

- filesystem relative path,
- object storage key,
- ZIP entry name,
- logical manifest key.

Masing-masing punya semantics berbeda.

### 46.4 Jangan Membuat Security Boundary Hanya Dari String

String check mudah ditembus karena:

- separator,
- normalization,
- encoding,
- symlink,
- case sensitivity,
- provider-specific behavior.

### 46.5 Ketahui Apakah Operasi Kamu Lexical atau Real

Ini bedanya engineer kuat dan engineer biasa.

Engineer biasa:

```text
Saya sudah normalize, berarti aman.
```

Engineer kuat:

```text
Saya baru melakukan lexical simplification. Saya belum membuktikan real filesystem containment, belum membuka file secara race-safe, dan belum menentukan symlink policy.
```

---

## 47. Ringkasan Mental Model

`Path` adalah expression, bukan file.

```text
Path string
  ↓ parsed by provider
Path object
  ↓ lexical operations
normalized/resolved/relative path
  ↓ filesystem operations
real path / metadata / open handle
```

Operasi seperti:

```java
resolve
relativize
normalize
getParent
getFileName
startsWith
endsWith
```

mayoritas adalah lexical/path-structure operation.

Operasi seperti:

```java
toRealPath
Files.exists
Files.isSameFile
Files.readAttributes
Files.newByteChannel
```

melibatkan filesystem reality.

Kunci top-tier file engineering:

```text
Never confuse lexical truth with filesystem truth.
Never confuse path with file identity.
Never confuse user filename with storage path.
Never confuse local filesystem semantics with universal semantics.
```

---

## 48. Apa Yang Belum Dibahas

Bagian ini sengaja belum membahas detail:

- existence check race,
- `Files.exists` vs `notExists`,
- `isRegularFile`, `isDirectory`, `isSymbolicLink`,
- file identity via attributes,
- TOCTOU,
- safe create pattern,
- symlink attack secara penuh,
- secure upload secara penuh,
- atomic move,
- locking,
- durability.

Itu akan masuk part berikutnya.

---

## 49. Referensi Resmi

- Java 8 `Path`:  
  https://docs.oracle.com/javase/8/docs/api/java/nio/file/Path.html

- Java 25 `Path`:  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Path.html

- Java 8 `Paths`:  
  https://docs.oracle.com/javase/8/docs/api/java/nio/file/Paths.html

- Java 25 `Paths`:  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Paths.html

- Java 8 `FileSystem`:  
  https://docs.oracle.com/javase/8/docs/api/java/nio/file/FileSystem.html

- Java 25 `java.nio.file` package summary:  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/package-summary.html

- Oracle Tutorial — Finding Files / PathMatcher:  
  https://docs.oracle.com/javase/tutorial/essential/io/find.html

- Oracle Tutorial — System Properties:  
  https://docs.oracle.com/javase/tutorial/essential/environment/sysprop.html

---

## 50. Status Seri

Seri belum selesai.

Sudah selesai:

```text
Part 00 — Orientation: Mental Model File, Path, Filesystem, dan Storage Boundary
Part 01 — Path Semantics Deep Dive: Name, Root, Absolute, Relative, Normalize, Resolve
```

Berikutnya:

```text
Part 02 — File Existence, Type, and Identity: exists Is Not a Lock
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-io-file-filesystem-storage-engineering-part-00-orientation.md">⬅️ Part 00 — Orientation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-io-file-filesystem-storage-engineering-part-02-file-existence-type-identity.md">Part 02 — File Existence, Type, and Identity: `exists` Is Not a Lock ➡️</a>
</div>

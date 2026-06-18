# Part 012 — File Attributes, Permissions, Ownership, Metadata, dan Cross-Platform Semantics

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-012.md`  
> Status: Part 012 dari 030 — **seri belum selesai**

---

## 1. Tujuan Pembelajaran

Pada bagian sebelumnya kita sudah membahas NIO.2 file API: `Path`, `Files`, `FileSystem`, `FileStore`, dan provider filesystem. Sekarang kita masuk ke lapisan yang sering diabaikan tetapi sangat penting untuk correctness, security, dan operability: **metadata file**.

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami bahwa file bukan hanya isi byte, tetapi juga memiliki metadata: type, size, timestamp, owner, permission, ACL, hidden flag, symbolic link status, dan attribute lain yang bergantung filesystem.
2. Menggunakan attribute API Java secara benar:
   - `BasicFileAttributes`
   - `PosixFileAttributes`
   - `DosFileAttributes`
   - `AclFileAttributeView`
   - `FileOwnerAttributeView`
   - `UserDefinedFileAttributeView`
3. Memahami perbedaan antara:
   - membaca attribute satu per satu vs bulk read
   - mengikuti symbolic link vs tidak mengikuti symbolic link
   - path string validation vs real filesystem validation
   - authorization check sebelum operasi vs operasi aktual
4. Mendesain file operation yang lebih aman terhadap:
   - TOCTOU race
   - symlink attack
   - permission mismatch
   - cross-platform behavior
   - container filesystem behavior
   - network filesystem behavior
5. Membuat mental model kapan metadata perlu dipercaya, kapan harus divalidasi ulang, dan kapan metadata hanya boleh digunakan sebagai optimisasi.

---

## 2. Mental Model: File = Content + Metadata + Namespace + Semantics

Banyak developer memandang file sebagai:

```text
path -> bytes
```

Model itu terlalu sempit. Untuk production-grade I/O, file sebaiknya dipahami sebagai:

```text
path name
  -> directory entry
  -> filesystem object
  -> content bytes
  -> metadata
  -> permissions/access control
  -> link semantics
  -> provider-specific behavior
```

Atau secara lebih lengkap:

```text
┌──────────────────────────────────────────────────────────────┐
│ Path                                                         │
│   e.g. /data/inbox/report.csv                                │
└───────────────┬──────────────────────────────────────────────┘
                │ resolved by filesystem namespace
                ▼
┌──────────────────────────────────────────────────────────────┐
│ Directory Entry                                               │
│   name -> file object / symlink / directory / special file     │
└───────────────┬──────────────────────────────────────────────┘
                │ points to
                ▼
┌──────────────────────────────────────────────────────────────┐
│ File Object                                                   │
│   content bytes                                               │
│   type                                                        │
│   size                                                        │
│   timestamps                                                  │
│   owner/group                                                 │
│   permissions / ACL                                           │
│   file key / inode-like identity                              │
│   platform-specific attributes                                │
└──────────────────────────────────────────────────────────────┘
```

Implikasinya besar:

- Dua path bisa menunjuk ke object yang sama.
- Satu path bisa berubah menunjuk ke object lain di antara dua operasi.
- Symbolic link bisa membuat validasi path terlihat benar tetapi operasi aktual mengenai target lain.
- Permission check bisa berubah setelah dicek.
- Attribute tidak selalu tersedia di semua filesystem.
- Timestamp tidak selalu presisi sama di semua platform.
- Hidden file di Unix dan Windows punya semantic berbeda.
- File identity tidak selalu stabil pada network filesystem atau virtual filesystem.

Jadi invariant pentingnya:

> **Path adalah nama. File object adalah target. Metadata adalah state target. Semua bisa berubah kecuali kita mendesain operasi dengan boundary yang benar.**

---

## 3. Package dan Class Utama

Java NIO.2 menyediakan package `java.nio.file.attribute` untuk attribute dan metadata file. Package ini berisi view dan interface untuk mengakses attribute yang umum maupun platform-specific. Dokumentasi Java menjelaskan bahwa `BasicFileAttributeView` memberi akses ke attribute dasar yang umum di banyak filesystem, sedangkan `PosixFileAttributeView` memperluas basic view untuk attribute filesystem POSIX. Lihat dokumentasi resmi Java `java.nio.file.attribute` dan `Files.readAttributes` untuk API detail.

### 3.1 Class dan Interface Penting

| Area | API | Fungsi |
|---|---|---|
| Basic metadata | `BasicFileAttributes` | size, type, timestamp, file key |
| Basic view | `BasicFileAttributeView` | baca/update timestamp basic |
| POSIX metadata | `PosixFileAttributes` | owner, group, permissions POSIX |
| POSIX view | `PosixFileAttributeView` | baca/update owner, group, permission |
| DOS metadata | `DosFileAttributes` | readonly, hidden, archive, system |
| DOS view | `DosFileAttributeView` | update DOS flags |
| ACL | `AclFileAttributeView` | ACL entry list |
| Owner | `FileOwnerAttributeView` | baca/update owner |
| User-defined | `UserDefinedFileAttributeView` | extended attributes |
| Principal lookup | `UserPrincipalLookupService` | resolve user/group principal |
| Link behavior | `LinkOption.NOFOLLOW_LINKS` | jangan follow symlink |
| File time | `FileTime` | timestamp filesystem |
| Permission enum | `PosixFilePermission` | owner/group/others rwx |
| Permission helper | `PosixFilePermissions` | convert permission set ke/dari string |

### 3.2 Dua Cara Membaca Attribute

Ada dua gaya utama:

#### Type-safe read

```java
BasicFileAttributes attrs = Files.readAttributes(
    path,
    BasicFileAttributes.class
);
```

Kelebihan:

- compile-time type lebih jelas
- method eksplisit
- lebih aman untuk code production

#### String-based read

```java
Map<String, Object> attrs = Files.readAttributes(
    path,
    "basic:size,lastModifiedTime,isDirectory"
);
```

Kelebihan:

- fleksibel
- bisa memilih subset attribute
- berguna untuk tooling, diagnostic, atau generic file browser

Kekurangan:

- raw string rentan typo
- value perlu cast
- kurang nyaman untuk domain logic

Rekomendasi:

> Untuk application code, gunakan type-safe API. Untuk generic tooling atau diagnostic, string-based API boleh dipakai.

---

## 4. BasicFileAttributes: Metadata Minimum yang Hampir Selalu Ada

`BasicFileAttributes` adalah view paling fundamental. Ia tersedia di banyak filesystem karena mewakili attribute dasar.

Contoh:

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;

public final class BasicAttributeExample {
    public static void main(String[] args) throws IOException {
        Path path = Path.of("data/report.csv");

        BasicFileAttributes attrs = Files.readAttributes(
            path,
            BasicFileAttributes.class
        );

        System.out.println("regularFile = " + attrs.isRegularFile());
        System.out.println("directory   = " + attrs.isDirectory());
        System.out.println("symbolicLink= " + attrs.isSymbolicLink());
        System.out.println("other       = " + attrs.isOther());
        System.out.println("size        = " + attrs.size());
        System.out.println("created     = " + attrs.creationTime());
        System.out.println("modified    = " + attrs.lastModifiedTime());
        System.out.println("accessed    = " + attrs.lastAccessTime());
        System.out.println("fileKey     = " + attrs.fileKey());
    }
}
```

### 4.1 Attribute Type

```text
isRegularFile()
isDirectory()
isSymbolicLink()
isOther()
```

Mental model:

```text
filesystem object type != file extension
```

Contoh:

- `report.csv` bisa saja directory.
- `image.png` bisa saja symlink.
- file tanpa extension bisa regular file.
- special file/device/socket bisa `isOther()`.

Jangan pernah membuat security decision berdasarkan nama file saja.

### 4.2 Size

```java
long size = attrs.size();
```

`size()` adalah ukuran file dalam byte menurut filesystem metadata.

Hati-hati:

- Untuk regular file, biasanya ukuran content byte.
- Untuk directory, value bisa provider-specific.
- Untuk special file, value bisa tidak meaningful.
- Size bisa berubah setelah dibaca.
- Size tidak menjamin file berhasil dibaca penuh.

Anti-pattern:

```java
long size = Files.size(path);
byte[] data = new byte[(int) size];
// lalu asumsi read pasti memenuhi semua byte
```

Masalah:

- file bisa berubah setelah size dibaca
- file bisa lebih besar dari `Integer.MAX_VALUE`
- read bisa partial
- memory bisa tidak cukup

### 4.3 Timestamps

```text
creationTime()
lastModifiedTime()
lastAccessTime()
```

Timestamp tampak sederhana, tetapi penuh jebakan.

Hal yang perlu dipahami:

1. Tidak semua filesystem punya creation time yang benar-benar native.
2. Last access time bisa dimatikan atau di-update secara lazy oleh OS untuk alasan performance.
3. Resolusi timestamp berbeda:
   - nanosecond
   - microsecond
   - millisecond
   - second
4. Network filesystem bisa punya clock/consistency issue.
5. Timestamp bisa berubah karena metadata operation, bukan hanya content operation.

Jangan menjadikan timestamp sebagai satu-satunya bukti integritas data. Untuk integritas, gunakan checksum/hash.

### 4.4 File Key

```java
Object key = attrs.fileKey();
```

`fileKey()` dapat digunakan sebagai identitas file object jika filesystem mendukungnya. Di Unix-like filesystem, ini sering berkaitan dengan inode/device, tetapi Java tidak menjamin bentuknya.

Gunakan untuk:

- mendeteksi apakah dua path mengarah ke object yang sama
- mendeteksi cycle saat traversal
- diagnostic

Jangan gunakan untuk:

- persistent identity jangka panjang antar reboot/mount/provider berbeda
- portable business key
- security invariant lintas platform

---

## 5. Attribute View: Kenapa Ada “View”?

NIO.2 tidak membuat satu class raksasa `FileMetadata` karena filesystem berbeda-beda. Sebaliknya, Java memakai konsep **attribute view**.

Mental model:

```text
FileSystemProvider
  ├─ supports basic view? almost always
  ├─ supports posix view? Unix/Linux/macOS-like, not typical Windows default
  ├─ supports dos view? Windows-like, sometimes available elsewhere
  ├─ supports acl view? depends
  └─ supports user-defined view? depends
```

Cek view yang didukung:

```java
import java.nio.file.FileSystem;
import java.nio.file.FileSystems;

public final class SupportedViewsExample {
    public static void main(String[] args) {
        FileSystem fs = FileSystems.getDefault();
        System.out.println(fs.supportedFileAttributeViews());
    }
}
```

Output di Linux bisa seperti:

```text
[owner, dos, basic, posix, user, unix]
```

Output di Windows bisa berbeda:

```text
[owner, dos, acl, basic, user]
```

Rule penting:

> Jangan asumsikan `posix` selalu tersedia hanya karena aplikasi berjalan di server. Cek capability atau desain fallback.

---

## 6. BasicFileAttributeView: Update Timestamp secara Eksplisit

Untuk membaca dan mengubah basic timestamp, bisa memakai `BasicFileAttributeView`.

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributeView;
import java.nio.file.attribute.FileTime;
import java.time.Instant;

public final class BasicViewUpdateExample {
    public static void main(String[] args) throws IOException {
        Path path = Path.of("data/report.csv");

        BasicFileAttributeView view = Files.getFileAttributeView(
            path,
            BasicFileAttributeView.class
        );

        FileTime now = FileTime.from(Instant.now());

        view.setTimes(
            now,   // lastModifiedTime
            null,  // lastAccessTime unchanged
            null   // creationTime unchanged
        );
    }
}
```

`null` berarti tidak mengubah attribute itu.

Use case:

- preserve timestamp saat copy custom
- mark checkpoint file
- testing
- import/export migration

Caveat:

- update bisa gagal karena permission
- filesystem bisa menurunkan presisi timestamp
- provider bisa tidak mendukung update semua field

---

## 7. POSIX Attributes: Owner, Group, dan rwx Permission

POSIX permission adalah model umum pada Linux/Unix-like system.

```text
owner: read/write/execute
group: read/write/execute
others: read/write/execute
```

Di Java:

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFileAttributes;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Set;

public final class PosixReadExample {
    public static void main(String[] args) throws IOException {
        Path path = Path.of("data/report.csv");

        PosixFileAttributes attrs = Files.readAttributes(
            path,
            PosixFileAttributes.class
        );

        System.out.println("owner = " + attrs.owner().getName());
        System.out.println("group = " + attrs.group().getName());

        Set<PosixFilePermission> perms = attrs.permissions();
        System.out.println("permissions = " + perms);
    }
}
```

### 7.1 Convert Permission ke String

```java
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Set;

Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rw-r-----");
String text = PosixFilePermissions.toString(perms);
```

String format:

```text
rwxrwxrwx
│ │ │
│ │ └── others
│ └──── group
└────── owner
```

Contoh:

| Permission | Meaning |
|---|---|
| `rw-------` | hanya owner read/write |
| `rw-r-----` | owner read/write, group read |
| `rwx------` | owner read/write/execute |
| `rw-r--r--` | owner write, semua bisa read |
| `rwxr-x---` | owner full, group read/execute |

### 7.2 Membuat File dengan Permission Awal

Untuk security, lebih baik set permission saat create, bukan setelah create.

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileAttribute;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Set;

public final class SecureCreateExample {
    public static void main(String[] args) throws IOException {
        Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rw-------");
        FileAttribute<Set<PosixFilePermission>> attr =
            PosixFilePermissions.asFileAttribute(perms);

        Path file = Files.createFile(Path.of("secret.txt"), attr);
        System.out.println(file);
    }
}
```

Kenapa ini penting?

Jika kamu membuat file dulu lalu mengubah permission kemudian, ada window kecil:

```text
create file with default permission
   ↓
attacker/other process may observe/read it
   ↓
set restrictive permission
```

Ini contoh race condition. Untuk secret, temp file, credential, token, private key, export sensitif, permission harus dipasang sedini mungkin.

### 7.3 Mengubah Permission

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;

public final class SetPermissionExample {
    public static void main(String[] args) throws IOException {
        Path path = Path.of("data/report.csv");

        Files.setPosixFilePermissions(
            path,
            PosixFilePermissions.fromString("rw-r-----")
        );
    }
}
```

Caveat:

- Tidak portable ke Windows default filesystem.
- Bisa gagal jika filesystem tidak support POSIX view.
- Permission aktual juga dipengaruhi mount option, ACL, container runtime, user namespace, dan process credentials.

---

## 8. File Owner dan Group

Owner dan group bukan sekadar metadata informatif. Mereka mempengaruhi access control.

### 8.1 Membaca Owner

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.UserPrincipal;

public final class OwnerReadExample {
    public static void main(String[] args) throws IOException {
        Path path = Path.of("data/report.csv");
        UserPrincipal owner = Files.getOwner(path);
        System.out.println(owner.getName());
    }
}
```

### 8.2 Mengubah Owner

```java
import java.io.IOException;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.UserPrincipal;
import java.nio.file.attribute.UserPrincipalLookupService;

public final class OwnerUpdateExample {
    public static void main(String[] args) throws IOException {
        Path path = Path.of("data/report.csv");

        UserPrincipalLookupService lookup =
            FileSystems.getDefault().getUserPrincipalLookupService();

        UserPrincipal user = lookup.lookupPrincipalByName("appuser");
        Files.setOwner(path, user);
    }
}
```

### 8.3 Group via POSIX View

```java
import java.io.IOException;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.GroupPrincipal;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.UserPrincipalLookupService;

public final class GroupUpdateExample {
    public static void main(String[] args) throws IOException {
        Path path = Path.of("data/report.csv");

        PosixFileAttributeView view = Files.getFileAttributeView(
            path,
            PosixFileAttributeView.class
        );

        if (view == null) {
            throw new UnsupportedOperationException("POSIX file attributes not supported");
        }

        UserPrincipalLookupService lookup =
            FileSystems.getDefault().getUserPrincipalLookupService();

        GroupPrincipal group = lookup.lookupPrincipalByGroupName("appgroup");
        view.setGroup(group);
    }
}
```

Production caution:

- Lookup user/group bisa berbeda antara host, container, LDAP, Active Directory, dan Kubernetes node.
- Nama principal bisa tidak portable.
- Numeric UID/GID mapping di container bisa berbeda dari host.
- Jangan hardcode owner/group kecuali deployment environment benar-benar dikontrol.

---

## 9. DOS Attributes: Hidden, Readonly, Archive, System

Pada Windows-style filesystem, ada attribute seperti:

```text
readonly
hidden
archive
system
```

Java menyediakan `DosFileAttributes` dan `DosFileAttributeView`.

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.DosFileAttributes;

public final class DosReadExample {
    public static void main(String[] args) throws IOException {
        Path path = Path.of("data/report.csv");

        DosFileAttributes attrs = Files.readAttributes(
            path,
            DosFileAttributes.class
        );

        System.out.println("readonly = " + attrs.isReadOnly());
        System.out.println("hidden   = " + attrs.isHidden());
        System.out.println("archive  = " + attrs.isArchive());
        System.out.println("system   = " + attrs.isSystem());
    }
}
```

Update:

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.DosFileAttributeView;

public final class DosUpdateExample {
    public static void main(String[] args) throws IOException {
        Path path = Path.of("data/report.csv");

        DosFileAttributeView view = Files.getFileAttributeView(
            path,
            DosFileAttributeView.class
        );

        if (view == null) {
            throw new UnsupportedOperationException("DOS file attributes not supported");
        }

        view.setHidden(true);
        view.setReadOnly(true);
    }
}
```

Important distinction:

- Unix hidden file biasanya berdasarkan nama diawali titik: `.env`.
- Windows hidden file adalah metadata flag.
- `Files.isHidden(path)` menyembunyikan perbedaan ini di level API, tetapi behavior tetap provider-specific.

---

## 10. ACL Attributes: Access Control List

ACL lebih ekspresif dibanding POSIX mode sederhana. ACL bisa berisi daftar rule untuk principal tertentu.

Konseptual:

```text
file.txt
  ACL:
    ALLOW alice READ_DATA, WRITE_DATA
    DENY  bob   WRITE_DATA
    ALLOW group:auditors READ_DATA
```

Java menyediakan `AclFileAttributeView`.

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclFileAttributeView;
import java.util.List;

public final class AclReadExample {
    public static void main(String[] args) throws IOException {
        Path path = Path.of("data/report.csv");

        AclFileAttributeView view = Files.getFileAttributeView(
            path,
            AclFileAttributeView.class
        );

        if (view == null) {
            System.out.println("ACL view not supported");
            return;
        }

        List<AclEntry> acl = view.getAcl();
        for (AclEntry entry : acl) {
            System.out.println(entry);
        }
    }
}
```

ACL sering relevan di:

- Windows file server
- enterprise shared drive
- network-attached storage
- domain-managed environment
- regulated data repository

Namun untuk aplikasi server/cloud-native, lebih umum access control dikelola di:

- application authorization layer
- object storage IAM policy
- Linux user/group permission
- Kubernetes volume/security context

Rule praktis:

> Jangan mencampur terlalu banyak model access control tanpa desain eksplisit. POSIX permission + ACL + application role + IAM + container user dapat menghasilkan debugging yang sangat sulit.

---

## 11. User-Defined File Attributes / Extended Attributes

Beberapa filesystem mendukung attribute tambahan yang ditentukan user atau aplikasi.

```java
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.UserDefinedFileAttributeView;

public final class UserDefinedAttributeExample {
    public static void main(String[] args) throws IOException {
        Path path = Path.of("data/report.csv");

        UserDefinedFileAttributeView view = Files.getFileAttributeView(
            path,
            UserDefinedFileAttributeView.class
        );

        if (view == null) {
            throw new UnsupportedOperationException("User-defined attributes not supported");
        }

        String name = "app.checksum";
        String value = "sha256:abc123";

        view.write(name, StandardCharsets.UTF_8.encode(value));

        ByteBuffer buffer = ByteBuffer.allocate(view.size(name));
        view.read(name, buffer);
        buffer.flip();

        String readBack = StandardCharsets.UTF_8.decode(buffer).toString();
        System.out.println(readBack);
    }
}
```

Use case:

- local metadata
- checksum marker
- ingestion state
- classification label

Caveat besar:

- Tidak portable antar filesystem.
- Bisa hilang saat copy/archive/upload.
- Tidak selalu terlihat oleh tooling umum.
- Bisa tidak didukung di container volume atau cloud volume tertentu.
- Jangan gunakan sebagai satu-satunya business metadata.

Untuk metadata bisnis, sering lebih baik gunakan sidecar file atau database:

```text
report.csv
report.csv.meta.json
```

atau:

```text
file_transfer_manifest table
```

---

## 12. Symbolic Link Semantics: Follow vs No-Follow

Ini salah satu topik paling penting untuk security.

Default banyak operasi Java mengikuti symbolic link. Jika kamu ingin operasi berlaku ke link itu sendiri, bukan targetnya, gunakan:

```java
LinkOption.NOFOLLOW_LINKS
```

Dokumentasi Java mendefinisikan `NOFOLLOW_LINKS` sebagai opsi untuk tidak mengikuti symbolic link.

### 12.1 Membaca Attribute Target Symlink

```java
BasicFileAttributes attrs = Files.readAttributes(
    path,
    BasicFileAttributes.class
);
```

Jika `path` adalah symlink, secara default ini membaca target.

### 12.2 Membaca Attribute Symlink Itu Sendiri

```java
import java.nio.file.LinkOption;

BasicFileAttributes attrs = Files.readAttributes(
    path,
    BasicFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);
```

### 12.3 Deteksi Symlink

```java
boolean symlink = Files.isSymbolicLink(path);
```

Tetapi jangan terlalu cepat puas. Ada race:

```text
check: path is not symlink
   ↓ attacker replaces path with symlink
open: application follows symlink target
```

Ini TOCTOU.

---

## 13. TOCTOU: Time-of-Check to Time-of-Use

TOCTOU adalah race antara pengecekan dan penggunaan.

Contoh buruk:

```java
if (Files.exists(path) && Files.isRegularFile(path) && Files.isReadable(path)) {
    byte[] data = Files.readAllBytes(path);
}
```

Kelihatannya aman, tetapi tidak atomic.

Timeline race:

```text
T1 app: check path is regular file
T2 attacker/process: replace path with symlink to sensitive file
T3 app: read path
```

Masalah:

- hasil check tidak menjamin target saat operasi aktual
- permission bisa berubah
- file bisa dihapus
- file bisa diganti
- symlink bisa disisipkan

Prinsip production:

> **Jangan gunakan pre-check sebagai jaminan. Lakukan operasi aktual dan tangani exception.**

Pre-check boleh untuk:

- user-friendly error message
- optimisasi
- diagnostic

Pre-check tidak boleh menjadi:

- security boundary utama
- correctness guarantee
- atomicity guarantee

### 13.1 Better Pattern: Operasi Aktual + Exception Handling

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;

public final class OperationFirstExample {
    public static byte[] readSmallFile(Path path) throws IOException {
        try {
            return Files.readAllBytes(path);
        } catch (NoSuchFileException e) {
            throw new IOException("File does not exist: " + path, e);
        }
    }
}
```

Untuk kasus security-sensitive, gunakan strategi lebih ketat:

- resolve base directory secara real path
- reject symlink jika perlu
- gunakan `NOFOLLOW_LINKS`
- gunakan `SecureDirectoryStream` jika tersedia
- batasi operasi pada directory handle, bukan path string bebas
- gunakan permission saat create
- hindari path dari input user tanpa validasi

---

## 14. Safe Path Validation dan Directory Boundary

Kasus umum: user boleh membaca file di `/data/export`, tetapi tidak boleh keluar dari directory itu.

Naive code:

```java
Path path = Path.of("/data/export", userInput);
return Files.readAllBytes(path);
```

Input berbahaya:

```text
../../etc/passwd
```

Atau:

```text
allowed.txt -> symlink to /etc/passwd
```

### 14.1 Normalization Saja Tidak Cukup

```java
Path base = Path.of("/data/export").normalize();
Path candidate = base.resolve(userInput).normalize();

if (!candidate.startsWith(base)) {
    throw new SecurityException("Outside base directory");
}
```

Ini mencegah banyak traversal berbasis `..`, tetapi belum cukup untuk symlink.

### 14.2 Real Path Boundary Check

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public final class SafeResolveExample {
    public static Path resolveInsideBase(Path baseDir, String userInput) throws IOException {
        Path realBase = baseDir.toRealPath();

        Path candidate = realBase.resolve(userInput).normalize();

        if (!candidate.startsWith(realBase)) {
            throw new SecurityException("Path escapes base directory: " + userInput);
        }

        Path realCandidate = candidate.toRealPath();

        if (!realCandidate.startsWith(realBase)) {
            throw new SecurityException("Resolved target escapes base directory: " + userInput);
        }

        return realCandidate;
    }
}
```

Caveat:

- `toRealPath()` membutuhkan file sudah ada.
- Masih ada race jika path bisa dimodifikasi setelah validation.
- Untuk create file baru, strategi berbeda diperlukan.
- Untuk environment sangat hostile, gunakan directory handle approach dan `SecureDirectoryStream` jika provider mendukung.

### 14.3 Untuk Create File Baru

Untuk create file dari input user:

1. Validasi nama file sebagai nama, bukan path.
2. Reject separator `/`, `\`, `..`, NUL-like invalid char.
3. Resolve ke base directory.
4. Gunakan `CREATE_NEW`, bukan overwrite.
5. Set permission saat create jika sensitif.

```java
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.channels.SeekableByteChannel;
import java.util.EnumSet;

public final class SafeCreateNewExample {
    public static void createNewFile(Path baseDir, String fileName, byte[] content) throws IOException {
        if (fileName.contains("/") || fileName.contains("\\") || fileName.equals("..") || fileName.contains("..")) {
            throw new IllegalArgumentException("Invalid file name");
        }

        Path base = baseDir.toRealPath();
        Path target = base.resolve(fileName).normalize();

        if (!target.startsWith(base)) {
            throw new SecurityException("Target escapes base directory");
        }

        try (SeekableByteChannel channel = Files.newByteChannel(
            target,
            EnumSet.of(StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)
        )) {
            channel.write(ByteBuffer.wrap(content));
        }
    }
}
```

`CREATE_NEW` penting karena menghindari overwrite file existing.

---

## 15. `Files.exists`, `isReadable`, `isWritable`: Berguna tapi Bukan Jaminan

API seperti ini sering dipakai:

```java
Files.exists(path)
Files.notExists(path)
Files.isReadable(path)
Files.isWritable(path)
Files.isExecutable(path)
```

Gunanya:

- UI validation
- diagnostic
- conditional flow sederhana
- best-effort check

Tetapi jangan dianggap jaminan.

### 15.1 `exists` vs `notExists`

Ada tiga kondisi logis:

```text
exists     = true
notExists  = true
unknown    = both false
```

Kenapa unknown?

- permission denied
- I/O error
- network filesystem unavailable
- provider error

Jadi ini tidak selalu binary.

### 15.2 `isReadable` Tidak Menjamin Read Berhasil

```java
if (Files.isReadable(path)) {
    Files.readString(path);
}
```

Read tetap bisa gagal karena:

- permission berubah
- file dihapus
- file diganti directory
- disk/network error
- lock contention
- antivirus/security tool
- encoding error saat readString

Pattern benar:

```java
try {
    String text = Files.readString(path);
} catch (IOException e) {
    // handle real failure
}
```

---

## 16. Cross-Platform Semantics

File attribute adalah area yang sangat platform-dependent.

### 16.1 Linux / Unix-like

Umumnya mendukung:

- POSIX permissions
- owner/group
- symlink
- executable bit
- inode-like file key
- dotfile hidden convention

Caveat:

- ACL bisa aktif atau tidak
- extended attribute bisa aktif atau tidak
- mount options mempengaruhi behavior
- container user bisa bukan host user
- rootless container punya UID mapping

### 16.2 Windows

Umumnya mendukung:

- DOS flags
- ACL
- owner
- case-insensitive path default
- drive letter
- different reserved names
- hidden sebagai attribute flag

Caveat:

- POSIX permission tidak dapat diasumsikan
- symlink creation bisa butuh privilege/config tertentu
- path length historis punya batas tertentu tergantung konfigurasi
- file delete/rename behavior berbeda jika file sedang dibuka

### 16.3 macOS

Umumnya Unix-like tetapi punya detail sendiri:

- case-insensitive filesystem sering default
- extended attributes umum
- resource fork/historical metadata
- POSIX permission ada
- ACL dapat ada

### 16.4 Container

Container menambah layer:

- process user mungkin non-root
- mounted volume punya owner dari host
- ConfigMap/Secret punya mode tertentu
- read-only root filesystem
- ephemeral filesystem
- overlay filesystem
- UID/GID mismatch

Bug umum:

```text
works on developer laptop
fails in Kubernetes because app user cannot write mounted directory
```

Checklist container:

- user apa yang menjalankan process?
- UID/GID berapa?
- volume owner siapa?
- apakah root filesystem read-only?
- apakah directory temp writable?
- apakah `/tmp` tersedia?
- apakah file permission compatible dengan security context?

### 16.5 Network Filesystem

NFS/SMB/EFS/remote mount bisa berbeda:

- metadata caching
- delayed visibility
- clock skew
- lock semantics berbeda
- permission mapping
- stale file handle
- lower throughput/higher latency
- rename atomicity tergantung provider/config

Jangan anggap local filesystem semantics selalu berlaku di remote filesystem.

---

## 17. Permission Model vs Application Authorization

File permission menjawab:

```text
Apakah OS mengizinkan process ini mengakses file ini?
```

Application authorization menjawab:

```text
Apakah user/domain actor ini boleh mengakses resource ini menurut business rule?
```

Keduanya berbeda.

Contoh:

```text
OS user appsvc bisa membaca semua file export.
Tetapi user Alice hanya boleh download export milik agency A.
```

Jadi permission filesystem tidak menggantikan authorization aplikasi.

Layer yang ideal:

```text
Application authorization
  ↓
Path/resource resolution
  ↓
Filesystem permission
  ↓
Audit/logging
```

Anti-pattern:

```text
"Kalau file bisa dibaca process, berarti user boleh download."
```

Ini salah.

---

## 18. Metadata sebagai Signal, Bukan Source of Truth Tunggal

Metadata berguna untuk:

- filtering file
- detecting candidate changes
- sorting
- diagnostics
- incremental scan
- validation awal

Tetapi metadata sering tidak cukup sebagai source of truth.

Contoh ingestion pipeline:

```text
scan directory
  read size + modifiedTime
  if changed -> process
```

Masalah:

- timestamp precision rendah
- file berubah tetapi size sama
- copy belum selesai tetapi file sudah muncul
- writer preserve timestamp lama
- network filesystem metadata stale

Lebih robust:

```text
scan candidate
  wait until stable size/mtime
  open file
  compute checksum
  parse/process
  persist manifest/checkpoint
  atomic move to processed/error
```

---

## 19. File Attribute Race saat File Ingestion

Kasus common: folder inbound menerima file dari sistem lain.

Naive:

```java
Files.list(inbox)
    .filter(Files::isRegularFile)
    .forEach(this::process);
```

Risiko:

- file masih sedang ditulis
- file diganti setelah list
- symlink masuk
- permission belum selesai
- writer rename file saat processor membaca
- duplicate process

Better pattern:

```text
producer writes to temp name: report.csv.part
producer fsync/close
producer atomic rename to: report.csv.ready
consumer only reads *.ready
consumer claims file by atomic move to working/
consumer processes
consumer writes result/checkpoint
consumer moves to done/ or error/
```

Contoh claim via atomic move:

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

public final class ClaimFileExample {
    public static Path claim(Path inboxFile, Path workingDir) throws IOException {
        Path target = workingDir.resolve(inboxFile.getFileName().toString());

        return Files.move(
            inboxFile,
            target,
            StandardCopyOption.ATOMIC_MOVE
        );
    }
}
```

Catatan:

- `ATOMIC_MOVE` biasanya hanya berlaku dalam filesystem yang sama.
- Jika tidak didukung, Java akan throw exception.
- Untuk distributed workers, atomic move sering menjadi primitive claiming sederhana.

---

## 20. Membaca Attribute secara Efficient: Bulk Read

Jangan membaca attribute satu per satu jika kamu butuh banyak metadata.

Kurang baik:

```java
boolean regular = Files.isRegularFile(path);
long size = Files.size(path);
FileTime modified = Files.getLastModifiedTime(path);
```

Ini bisa menghasilkan beberapa syscall/provider call.

Lebih baik:

```java
BasicFileAttributes attrs = Files.readAttributes(
    path,
    BasicFileAttributes.class
);

boolean regular = attrs.isRegularFile();
long size = attrs.size();
FileTime modified = attrs.lastModifiedTime();
```

Untuk traversal directory besar, bulk read dapat mengurangi overhead.

---

## 21. Attribute Handling dalam Directory Traversal

Saat memakai `Files.walkFileTree`, Java memberikan attribute di callback `visitFile`.

```java
import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;

public final class WalkWithAttributesExample {
    public static void main(String[] args) throws IOException {
        Path root = Path.of("data");

        Files.walkFileTree(root, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                if (attrs.isRegularFile()) {
                    System.out.println(file + " size=" + attrs.size());
                }
                return FileVisitResult.CONTINUE;
            }
        });
    }
}
```

Keuntungan:

- attribute sudah tersedia
- tidak perlu `Files.size(file)` lagi
- traversal lebih efisien
- type check lebih konsisten dengan traversal event

---

## 22. Cross-Platform Utility Pattern

Kadang aplikasi perlu melakukan best-effort metadata read tanpa gagal total jika attribute view tidak tersedia.

```java
import java.io.IOException;
import java.nio.file.FileSystem;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.PosixFileAttributes;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Optional;

public record FileMetadataSnapshot(
    Path path,
    boolean regularFile,
    boolean directory,
    boolean symbolicLink,
    long size,
    String lastModifiedTime,
    Optional<String> owner,
    Optional<String> group,
    Optional<String> posixPermissions
) {}

public final class MetadataSnapshotReader {
    public static FileMetadataSnapshot read(Path path) throws IOException {
        BasicFileAttributes basic = Files.readAttributes(
            path,
            BasicFileAttributes.class
        );

        Optional<String> owner = Optional.empty();
        Optional<String> group = Optional.empty();
        Optional<String> perms = Optional.empty();

        FileSystem fs = path.getFileSystem();
        if (fs.supportedFileAttributeViews().contains("posix")) {
            PosixFileAttributes posix = Files.readAttributes(
                path,
                PosixFileAttributes.class
            );
            owner = Optional.of(posix.owner().getName());
            group = Optional.of(posix.group().getName());
            perms = Optional.of(PosixFilePermissions.toString(posix.permissions()));
        } else if (fs.supportedFileAttributeViews().contains("owner")) {
            owner = Optional.of(Files.getOwner(path).getName());
        }

        return new FileMetadataSnapshot(
            path,
            basic.isRegularFile(),
            basic.isDirectory(),
            basic.isSymbolicLink(),
            basic.size(),
            basic.lastModifiedTime().toString(),
            owner,
            group,
            perms
        );
    }
}
```

Design principle:

> Core logic jangan bergantung pada metadata yang tidak portable, kecuali environment memang dikontrol.

---

## 23. Security Pattern: Secure Temporary File

Temporary file sering digunakan untuk:

- upload staging
- export generation
- compression intermediate
- atomic write
- report generation
- encryption/decryption intermediate

Masalah:

- predictable filename
- wrong permission
- leftover sensitive data
- symlink attack
- shared temp directory

Gunakan API Java:

```java
Path temp = Files.createTempFile("upload-", ".tmp");
```

Untuk POSIX permission ketat:

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileAttribute;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Set;

public final class SecureTempFileExample {
    public static Path createSecureTempFile(Path dir) throws IOException {
        Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rw-------");
        FileAttribute<Set<PosixFilePermission>> attr =
            PosixFilePermissions.asFileAttribute(perms);

        return Files.createTempFile(dir, "secure-", ".tmp", attr);
    }
}
```

Caveat:

- Ini hanya berlaku jika POSIX view supported.
- Di Windows, permission model berbeda.
- Temp file tetap harus dibersihkan.
- Untuk data sangat sensitif, pertimbangkan encryption at rest dan hindari menulis plaintext ke disk.

---

## 24. Metadata dan Auditability

Dalam sistem regulasi, enforcement, case management, dan data transfer, metadata bisa menjadi bagian audit trail.

Contoh audit metadata saat menerima file:

```json
{
  "event": "FILE_RECEIVED",
  "path": "/inbox/case-123.zip",
  "size": 10485760,
  "lastModifiedTime": "2026-06-16T10:15:30Z",
  "owner": "sftpuser",
  "permissions": "rw-r-----",
  "sha256": "...",
  "receivedAt": "2026-06-16T10:16:00Z",
  "processorNode": "worker-03"
}
```

Tapi perhatikan:

- Path bisa mengandung sensitive info.
- Owner/group bisa environment-specific.
- Permission snapshot bukan bukti file tidak berubah.
- Timestamp filesystem bukan timestamp business event.
- Untuk integritas, simpan checksum.
- Untuk chain of custody, simpan event waktu aplikasi + actor/system + checksum + transfer ID.

---

## 25. Production Failure Model

| Failure | Penyebab | Dampak | Mitigasi |
|---|---|---|---|
| `NoSuchFileException` setelah `exists=true` | file dihapus race | read gagal | operation-first + exception handling |
| `AccessDeniedException` | permission/ACL/container user | processing gagal | startup permission check + clear error |
| `UnsupportedOperationException` | attribute view tidak tersedia | crash di Windows/container | capability check + fallback |
| Symlink escape | attacker/user-controlled symlink | baca/tulis file di luar base | realpath check, nofollow, secure dir stream |
| Wrong timestamp assumption | FS precision/cache | missed update | checksum/manifest/checkpoint |
| Owner mismatch in container | UID/GID berbeda | app tidak bisa tulis | securityContext/fsGroup/initContainer/chown strategy |
| Atomic move fails | beda filesystem/provider | claim/publish tidak atomic | same-volume staging, fallback explicit design |
| Hidden file mismatch | Unix dotfile vs Windows flag | filtering salah | use `Files.isHidden`, define policy |
| ACL vs POSIX conflict | mixed permission model | access confusing | choose one primary model, document fallback |
| Network FS stale metadata | caching/latency | duplicate/missed processing | reconciliation + idempotency |

---

## 26. Anti-Pattern yang Harus Dihindari

### 26.1 Menganggap File Extension sebagai Type

```java
if (path.toString().endsWith(".csv")) {
    processCsv(path);
}
```

Extension hanya nama. Minimal cek regular file, size limit, dan content validation.

### 26.2 Menggunakan `exists` sebagai Security Gate

```java
if (Files.exists(path)) {
    // dianggap aman
}
```

Tidak aman. Path bisa berubah setelah check.

### 26.3 Hardcode POSIX Permission di Aplikasi Cross-Platform

```java
Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("rw-------"));
```

Akan gagal di filesystem yang tidak support POSIX.

### 26.4 Menyimpan Metadata Bisnis Hanya di Extended Attribute

Extended attribute tidak portable dan bisa hilang saat transfer.

### 26.5 Menganggap Last Modified Time sebagai Bukti Perubahan

Timestamp bisa preserve, precision rendah, atau stale.

### 26.6 Follow Symlink tanpa Policy

Untuk file dari input user, symlink harus punya policy eksplisit:

```text
allowed?
rejected?
resolved but must stay inside base?
```

Default “tidak kepikiran” adalah bug.

---

## 27. Design Checklist

### 27.1 Saat Membaca File dari Path Internal

- [ ] Apakah path berasal dari trusted config atau user input?
- [ ] Apakah perlu cek symlink?
- [ ] Apakah perlu limit size?
- [ ] Apakah read harus streaming?
- [ ] Apakah metadata hanya diagnostic atau correctness?
- [ ] Apakah exception handling jelas?

### 27.2 Saat Membaca File dari User-Controlled Path

- [ ] Reject absolute path jika tidak boleh.
- [ ] Normalize path.
- [ ] Resolve terhadap base directory.
- [ ] Pastikan tidak escape base directory.
- [ ] Handle symlink dengan policy eksplisit.
- [ ] Jangan bergantung pada pre-check.
- [ ] Batasi file size.
- [ ] Validasi content, bukan hanya extension.

### 27.3 Saat Membuat File Baru

- [ ] Gunakan `CREATE_NEW` jika tidak boleh overwrite.
- [ ] Set permission saat create jika sensitif.
- [ ] Gunakan temp file untuk write besar.
- [ ] Publish dengan atomic move jika perlu.
- [ ] Pastikan target di filesystem yang sama untuk atomic move.
- [ ] Simpan checksum/manifest jika integritas penting.

### 27.4 Saat Berjalan di Container

- [ ] App berjalan sebagai user apa?
- [ ] UID/GID cocok dengan volume?
- [ ] Directory writable?
- [ ] Root filesystem read-only?
- [ ] Temp directory tersedia?
- [ ] Secret/config file mode cocok?

### 27.5 Saat Cross-Platform

- [ ] Jangan asumsikan POSIX view.
- [ ] Jangan asumsikan DOS view.
- [ ] Jangan asumsikan case sensitivity.
- [ ] Jangan asumsikan hidden semantics sama.
- [ ] Jangan asumsikan timestamp precision sama.
- [ ] Jangan asumsikan file locking sama.

---

## 28. Latihan Praktis

### Latihan 1 — Metadata Snapshot Tool

Buat CLI Java yang menerima path dan mencetak:

- type
- size
- creation time
- last modified time
- last access time
- owner
- posix permission jika tersedia
- dos attributes jika tersedia
- apakah symlink
- real path jika bisa di-resolve

Tambahkan fallback jika view tidak tersedia.

### Latihan 2 — Safe Download Resolver

Buat fungsi:

```java
Path resolveDownloadPath(Path baseDir, String userInput)
```

Requirement:

- tidak boleh keluar dari `baseDir`
- reject absolute path
- reject path traversal
- reject symlink yang targetnya keluar dari base
- return real path
- throw exception yang jelas

### Latihan 3 — Secure Temp Export

Buat fungsi export report:

```text
write temp file
set restrictive permission
write content
flush/close
compute checksum
atomic move to final name
write manifest
```

### Latihan 4 — Cross-Platform Attribute Reader

Buat class yang membaca attribute dengan strategi:

```text
always: basic
if supported: owner
if supported: posix
if supported: dos
if supported: user-defined
```

Pastikan tidak crash jika salah satu view tidak tersedia.

### Latihan 5 — TOCTOU Simulation

Buat dua thread/process:

1. Thread A melakukan `isRegularFile` lalu sleep lalu read.
2. Thread B mengganti file menjadi symlink saat Thread A sleep.

Tujuannya memahami kenapa check-then-use tidak aman.

---

## 29. Ringkasan

File metadata bukan detail kecil. Metadata adalah bagian dari kontrak antara aplikasi, JVM, OS, filesystem, container runtime, dan environment deployment.

Hal paling penting dari Part 012:

1. File bukan hanya bytes; file punya type, size, timestamp, owner, permission, link semantics, dan provider-specific attributes.
2. Java NIO.2 memakai model attribute view karena filesystem berbeda-beda.
3. `BasicFileAttributes` adalah baseline; POSIX, DOS, ACL, dan user-defined attributes tidak selalu tersedia.
4. Symbolic link harus punya policy eksplisit.
5. `Files.exists`, `isReadable`, dan sejenisnya berguna, tetapi bukan guarantee.
6. TOCTOU adalah bug fundamental dalam file operation security.
7. Permission filesystem tidak sama dengan authorization aplikasi.
8. Metadata bagus sebagai signal, tetapi integrity tetap membutuhkan checksum/manifest.
9. Cross-platform semantics harus didesain, bukan diasumsikan.
10. Di container dan network filesystem, metadata behavior bisa berbeda signifikan dari laptop developer.

Mental model yang harus dibawa ke part berikutnya:

```text
Path is a name.
File object is the target.
Metadata is mutable state.
Permissions are environment-dependent.
Symlink changes resolution.
Pre-check is not atomic.
Operation + exception handling is the real boundary.
```

---

## 30. Referensi Utama

- Oracle Java SE API — `java.nio.file.Files`
- Oracle Java SE API — `java.nio.file.attribute`
- Oracle Java SE API — `BasicFileAttributes`
- Oracle Java SE API — `BasicFileAttributeView`
- Oracle Java SE API — `PosixFileAttributes`
- Oracle Java SE API — `DosFileAttributes`
- Oracle Java SE API — `AclFileAttributeView`
- Oracle Java SE API — `LinkOption.NOFOLLOW_LINKS`
- Oracle Java SE API — `SecureDirectoryStream`

---

## 31. Status Seri

Part ini adalah:

```text
Part 012 — File Attributes, Permissions, Ownership, Metadata, dan Cross-Platform Semantics
```

Seri masih **belum selesai**.

Part berikutnya:

```text
Part 013 — Directory Traversal, File Tree Walking, Search, Copy, Move, Delete
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 011 — NIO.2 File API: `Path`, `Files`, `FileSystem`, dan Modern File Operations](./learn-java-io-nio-networking-data-transfer-part-011.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 013 — Directory Traversal, File Tree Walking, Search, Copy, Move, Delete](./learn-java-io-nio-networking-data-transfer-part-013.md)

</div>
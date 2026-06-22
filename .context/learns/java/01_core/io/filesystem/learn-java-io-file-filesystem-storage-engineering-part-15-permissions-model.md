# learn-java-io-file-filesystem-storage-engineering — Part 15
# Permissions Model: POSIX, Windows ACL, Containers, and Runtime Identity

> Seri: `learn-java-io-file-filesystem-storage-engineering`  
> Part: `15`  
> Topik: Permission model, ownership, ACL, container user, mounted volume, dan runtime identity  
> Target Java: 8 hingga 25  
> Prasyarat langsung: Part 14 — File Attributes: Basic, POSIX, DOS, Owner, ACL

---

## 0. Tujuan Bagian Ini

Di part sebelumnya kita sudah membahas **file attributes**: metadata dasar, POSIX attribute, DOS attribute, owner, ACL, dan attribute view.

Bagian ini masuk lebih dalam ke pertanyaan yang lebih operasional:

> “Kenapa aplikasi Java saya tidak bisa membaca/menulis file padahal path-nya benar?”

Atau versi production-nya:

> “Kenapa aplikasi berjalan normal di laptop, tapi `AccessDeniedException` di server, container, Kubernetes, Windows server, mounted volume, atau shared storage?”

Setelah bagian ini, target pemahamanmu adalah:

1. Memahami permission bukan sebagai boolean `canRead/canWrite`, tetapi sebagai hasil evaluasi **identity + object metadata + OS policy + filesystem/provider capability**.
2. Membedakan POSIX mode bits, Windows ACL, owner/group, runtime user, umask, container UID/GID, dan mounted volume permission.
3. Memahami kapan Java bisa mengatur permission secara portable, kapan harus feature-detect, dan kapan harus menyerahkan ke provisioning/infrastruktur.
4. Mampu merancang file workflow yang aman: permission saat create, bukan chmod setelah create; least privilege; tidak bergantung pada Security Manager; tidak mengasumsikan root/non-root; dan tidak mengandalkan permission API yang tidak didukung provider.
5. Mampu membaca error permission sebagai sinyal desain, bukan sekadar exception yang di-retry.

---

## 1. Mental Model Besar: Permission Adalah Keputusan Runtime, Bukan Properti Tunggal

Banyak engineer melihat permission seperti ini:

```text
file.canRead() == true/false
file.canWrite() == true/false
```

Itu terlalu dangkal.

Model yang lebih benar:

```text
Process Identity
  + File/Directory Metadata
  + Parent Directory Permissions
  + Filesystem Rules
  + OS Security Model
  + Mount Options
  + Container/Kubernetes Security Context
  + Provider Support
  + Runtime Timing
  = Access Allowed / Access Denied
```

Artinya, “permission file” bukan satu angka final. Ia adalah hasil evaluasi banyak lapisan.

Contoh:

```text
File mode:        rw-r--r--
Owner:           appuser
Group:           appgroup
Java process:    uid=10001 gid=10001
Parent dir:      rwxr-x---
Mount:           read-only
Container root:  read-only filesystem
Kubernetes PVC:  owned by root:root
```

Walaupun file terlihat writable dari metadata tertentu, operasi write tetap bisa gagal karena:

- parent directory tidak writable,
- mount read-only,
- container root filesystem read-only,
- UID/GID runtime tidak cocok,
- ACL menolak akses,
- filesystem provider tidak mendukung operasi metadata tertentu,
- file sedang dikunci proses lain,
- path sebenarnya melewati symlink ke lokasi berbeda,
- permission berubah setelah dicek.

Top 1% engineer tidak bertanya:

> “Apakah file ini writable?”

Tapi bertanya:

> “Identitas runtime apa yang mencoba operasi apa terhadap objek mana, melalui path mana, di filesystem/provider apa, dengan parent permission dan mount semantics apa?”

---

## 2. Permission Harus Dipahami Per Operasi, Bukan Per File Saja

Permission file tidak cukup. Operasi berbeda membutuhkan permission berbeda.

| Operasi | Yang dibutuhkan secara konseptual |
|---|---|
| Membaca isi file | read permission pada file, plus search/execute pada directory path |
| Menulis isi file existing | write permission pada file, plus filesystem tidak read-only |
| Membuat file baru | write + execute/search pada parent directory |
| Menghapus file | write + execute/search pada parent directory, bukan hanya permission file |
| Rename/move dalam directory sama | write + execute/search pada directory terkait |
| Traverse directory | execute/search permission pada directory |
| List isi directory | read permission pada directory, plus execute/search untuk mengakses entry |
| Membaca metadata | tergantung OS/filesystem; biasanya butuh akses ke path parent |
| Mengubah permission | biasanya owner/root/admin atau privilege khusus |
| Mengubah owner | biasanya privilege elevated/root/admin |

Poin penting:

> Delete dan rename biasanya dikontrol oleh permission directory, bukan hanya permission file.

Misalnya di POSIX-like filesystem, file `a.txt` bisa mode `0444` alias read-only, tetapi bisa dihapus jika directory parent writable oleh user tersebut.

Ini sering mengejutkan engineer yang mengira file read-only berarti tidak bisa dihapus.

---

## 3. POSIX Permission Model

POSIX-style permission banyak ditemukan pada Linux, Unix, macOS, container Linux, dan banyak filesystem server.

Struktur klasiknya:

```text
owner   group   others
rwx     rwx     rwx
```

Contoh:

```text
-rw-r-----  appuser appgroup  config.yml
```

Artinya:

```text
owner:  read + write
 group:  read
others:  no access
```

Dalam mode numerik:

```text
rw- r-- ---
6   4   0
=> 0640
```

Mapping angka:

```text
read    = 4
write   = 2
execute = 1
```

Contoh umum:

| Mode | Arti umum |
|---|---|
| `0600` | owner read/write only |
| `0640` | owner read/write, group read |
| `0644` | owner read/write, semua bisa read |
| `0660` | owner/group read/write |
| `0700` | private directory/executable untuk owner |
| `0750` | owner full, group read/execute |
| `0755` | owner full, semua read/execute |
| `0777` | semua full access; hampir selalu red flag |

---

## 4. Makna `r`, `w`, `x` pada File vs Directory

Permission bit punya arti berbeda pada file dan directory.

### 4.1 Pada regular file

```text
r = boleh membaca content
w = boleh mengubah content
x = boleh mengeksekusi sebagai program/script, jika OS mendukung
```

### 4.2 Pada directory

```text
r = boleh list nama entry dalam directory
w = boleh create/delete/rename entry dalam directory
x = boleh traverse/search entry dalam directory
```

Inilah sumber banyak bug.

Directory tanpa `x` biasanya tidak bisa dimasuki, walaupun punya `r`.

Directory dengan `x` tapi tanpa `r` bisa dipakai mengakses file yang namanya sudah diketahui, tetapi tidak bisa listing.

Contoh:

```text
drwx--x--- appuser appgroup uploads/
```

Group bisa traverse `uploads/` jika tahu nama file, tetapi tidak bisa list isi directory.

---

## 5. Java Representation: `PosixFilePermission`

Java NIO menyediakan enum:

```java
java.nio.file.attribute.PosixFilePermission
```

Nilainya:

```java
OWNER_READ
OWNER_WRITE
OWNER_EXECUTE
GROUP_READ
GROUP_WRITE
GROUP_EXECUTE
OTHERS_READ
OTHERS_WRITE
OTHERS_EXECUTE
```

Contoh membaca permission:

```java
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Set;

public class ReadPermissionsExample {
    public static void main(String[] args) throws Exception {
        Path path = Path.of("config.yml");

        Set<PosixFilePermission> perms = Files.getPosixFilePermissions(path);

        System.out.println(perms);
    }
}
```

Java 8 version:

```java
Path path = Paths.get("config.yml");
```

Karena seri ini mencakup Java 8–25:

- Java 8: gunakan `Paths.get(...)`.
- Java 11+ dan terutama modern Java: gunakan `Path.of(...)`.

---

## 6. Mengubah POSIX Permission dengan Java

Contoh:

```java
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.util.EnumSet;
import java.util.Set;

public class SetPermissionsExample {
    public static void main(String[] args) throws Exception {
        Path path = Path.of("secret.txt");

        Set<PosixFilePermission> perms = EnumSet.of(
            PosixFilePermission.OWNER_READ,
            PosixFilePermission.OWNER_WRITE
        );

        Files.setPosixFilePermissions(path, perms);
    }
}
```

Ini kira-kira setara dengan:

```bash
chmod 600 secret.txt
```

Tetapi tidak portable ke semua filesystem.

Jika filesystem tidak mendukung POSIX attribute view, Java bisa melempar:

```text
UnsupportedOperationException
```

atau operasi dapat gagal dengan `IOException` tergantung provider dan kondisi OS.

---

## 7. `PosixFilePermissions.fromString` dan `asFileAttribute`

Java menyediakan helper:

```java
PosixFilePermissions.fromString("rw-------")
```

Contoh create file dengan permission eksplisit:

```java
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileAttribute;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Set;

public class CreatePrivateFileExample {
    public static void main(String[] args) throws Exception {
        Path path = Path.of("private-token.txt");

        Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rw-------");
        FileAttribute<Set<PosixFilePermission>> attr =
            PosixFilePermissions.asFileAttribute(perms);

        Files.createFile(path, attr);
    }
}
```

Ini penting karena permission diberikan **saat create**.

Kenapa penting?

Karena pola ini:

```java
Files.createFile(path);
Files.setPosixFilePermissions(path, privatePerms);
```

punya race window.

Di antara create dan chmod, file mungkin sempat punya permission default yang terlalu longgar.

Pola lebih aman:

```java
Files.createFile(path, attr);
```

atau:

```java
Files.createDirectory(path, attr);
```

---

## 8. Permission-at-Create vs Chmod-After-Create

Untuk file sensitif seperti:

- token,
- private key,
- credential cache,
- temporary upload,
- local keystore,
- signing artifact,
- audit export,
- intermediate report,
- decrypted payload,

hindari pola:

```java
Files.writeString(path, secret);
Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("rw-------"));
```

Masalah:

1. File dibuat dulu dengan default permission.
2. Default permission dipengaruhi umask/provider.
3. Ada interval pendek sebelum permission diperketat.
4. Pada host multi-user, itu bisa jadi exposure.
5. Jika proses crash sebelum `chmod`, file tertinggal dengan permission salah.

Lebih baik:

```java
Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rw-------");
FileAttribute<Set<PosixFilePermission>> attr = PosixFilePermissions.asFileAttribute(perms);

try (var out = Files.newOutputStream(path,
        Set.of(StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE).toArray(new OpenOption[0]))) {
    // This style cannot pass FileAttribute directly to newOutputStream.
}
```

Namun `newOutputStream` tidak menerima `FileAttribute`. Untuk create dengan attribute, gunakan API yang mendukung attribute, misalnya:

```java
Files.createFile(path, attr);
try (var writer = Files.newBufferedWriter(path, StandardOpenOption.WRITE)) {
    writer.write(secret);
}
```

Atau untuk temporary file:

```java
Path tmp = Files.createTempFile(
    path.getParent(),
    ".secret-",
    ".tmp",
    attr
);
```

Lalu tulis ke temp file yang sudah dibuat dengan permission ketat.

---

## 9. Umask: Permission yang Diminta Belum Tentu Permission Akhir

Di POSIX systems, ada konsep `umask`.

Secara sederhana:

```text
requested permission
AND NOT umask
= actual permission
```

Contoh:

```text
requested: 0666
umask:     0022
actual:    0644
```

Java tidak menyediakan API standar lintas platform untuk membaca/mengatur process umask.

Konsekuensinya:

- permission default hasil create dapat berbeda antar environment,
- file yang dibuat di laptop bisa `0644`, di server bisa `0640`, di container bisa berbeda,
- jangan mengandalkan default permission untuk file sensitif,
- untuk file sensitif gunakan permission-at-create jika provider mendukung.

Tetapi perhatikan:

> Bahkan saat meminta attribute eksplisit, provider/OS tetap dapat membatasi hasil akhirnya sesuai policy.

Jadi untuk production, setelah create file sensitif, kamu bisa melakukan verify:

```java
Set<PosixFilePermission> actual = Files.getPosixFilePermissions(path);
if (!actual.equals(expected)) {
    throw new IllegalStateException("Unsafe permissions: " + actual);
}
```

Namun verify juga harus dianggap sebagai guardrail, bukan mekanisme keamanan sempurna, karena permission bisa berubah setelah dicek.

---

## 10. Owner, Group, and Runtime Identity

Pada POSIX-like systems, access decision bergantung pada:

```text
effective UID
effective GID
supplementary groups
file owner
file group
mode bits
```

Java process tidak “punya permission Java”; ia memakai permission OS dari process yang menjalankan JVM.

Contoh:

```bash
ps -ef | grep java
id appuser
ls -l /data/uploads
```

Jika JVM berjalan sebagai:

```text
uid=10001(appuser) gid=10001(appgroup) groups=10001(appgroup),2000(shared)
```

maka akses file akan dievaluasi terhadap identity itu.

Dalam container, nama user mungkin tidak ada di `/etc/passwd`, tetapi UID tetap ada.

Contoh:

```text
uid=10001 gid=10001
```

Walaupun tidak ada username `appuser`, kernel tetap memakai UID/GID numerik.

---

## 11. Java API untuk Owner

Java menyediakan:

```java
FileOwnerAttributeView
UserPrincipal
UserPrincipalLookupService
```

Contoh membaca owner:

```java
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.UserPrincipal;

public class OwnerExample {
    public static void main(String[] args) throws Exception {
        Path path = Path.of("report.csv");

        UserPrincipal owner = Files.getOwner(path);
        System.out.println(owner.getName());
    }
}
```

Contoh mengubah owner:

```java
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.UserPrincipal;

public class ChangeOwnerExample {
    public static void main(String[] args) throws Exception {
        Path path = Path.of("report.csv");

        UserPrincipal user = FileSystems.getDefault()
            .getUserPrincipalLookupService()
            .lookupPrincipalByName("appuser");

        Files.setOwner(path, user);
    }
}
```

Namun di production:

- mengubah owner biasanya butuh privilege tinggi,
- nama principal berbeda antar OS/domain/container,
- lookup user bisa gagal,
- provider mungkin tidak mendukung owner view,
- di Kubernetes volume, ownership dapat dikelola oleh mount/security context, bukan aplikasi.

Aplikasi bisnis biasanya **tidak seharusnya melakukan chown** sebagai bagian normal flow.

Lebih sehat:

```text
Provisioning/infra menentukan ownership directory.
Aplikasi hanya menulis ke lokasi yang memang sudah disiapkan.
```

---

## 12. Group Access: Sering Lebih Penting daripada Owner

Dalam deployment modern, group permission sering lebih fleksibel daripada owner permission.

Contoh directory bersama:

```text
drwxrwx--- root appgroup /data/inbox
```

Aplikasi berjalan sebagai:

```text
uid=10001
primary gid=10001
supplementary group=2000(appgroup)
```

Maka aplikasi bisa menulis karena ia anggota group `appgroup`.

Di Kubernetes, ini sering dikelola lewat `fsGroup`.

Contoh konseptual:

```yaml
securityContext:
  runAsUser: 10001
  runAsGroup: 10001
  fsGroup: 2000
```

Maknanya:

- proses container berjalan sebagai UID 10001,
- primary group 10001,
- volume dapat dibuat/diubah agar group ownership cocok dengan `fsGroup`, tergantung volume plugin dan policy,
- process mendapatkan akses group ke mounted volume.

Ini sangat relevan untuk:

- PVC,
- shared volume,
- upload directory,
- report export directory,
- batch staging directory,
- file handoff antar container.

---

## 13. Sticky Bit, Setuid, Setgid: Konsep yang Perlu Dikenal

Walaupun Java API standar tidak menjadikan ini fokus utama, engineer file-system perlu tahu konsep ini.

### 13.1 Sticky bit pada directory

Contoh umum:

```text
/tmp
```

Mode biasanya:

```text
drwxrwxrwt
```

Sticky bit membuat user hanya bisa menghapus file miliknya sendiri di directory publik, walaupun directory writable oleh banyak user.

Tanpa sticky bit, directory `0777` bisa berbahaya karena user dapat menghapus/rename file milik user lain.

### 13.2 Setgid pada directory

Directory dengan setgid dapat membuat file baru mewarisi group directory.

Ini sering berguna untuk shared group directory:

```text
drwxrws--- root appgroup shared/
```

File yang dibuat di dalamnya cenderung memakai group `appgroup`, bukan primary group process.

### 13.3 Setuid pada executable

Setuid membuat executable berjalan dengan owner privilege tertentu.

Untuk aplikasi Java server modern, ini biasanya bukan desain yang disarankan.

---

## 14. Windows Permission Model: ACL, Bukan POSIX Mode Bits

Windows tidak native memakai POSIX `rwx` mode bits sebagai model utama. Windows memakai Access Control List.

ACL berisi ACE — Access Control Entry.

Secara konseptual:

```text
Principal A: allow read
Principal B: allow write
Principal C: deny delete
Administrators: full control
SYSTEM: full control
Inherited entries from parent directory
```

Java menyediakan:

```java
AclFileAttributeView
AclEntry
AclEntryPermission
AclEntryType
AclEntryFlag
```

Namun desain ACL jauh lebih kompleks daripada POSIX mode.

Contoh membaca ACL:

```java
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclFileAttributeView;
import java.util.List;

public class ReadAclExample {
    public static void main(String[] args) throws Exception {
        Path path = Path.of("C:/data/report.csv");

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

Top-level rule:

> Jangan mencoba membuat “universal chmod abstraction” sendiri yang menganggap Windows ACL bisa dipetakan sempurna ke POSIX mode bits.

Mapping itu lossy.

---

## 15. DOS Attribute Bukan Security Permission

Windows juga punya DOS-style attributes:

- hidden,
- readonly,
- system,
- archive.

Java menyediakan:

```java
DosFileAttributeView
```

Contoh:

```java
Files.setAttribute(path, "dos:hidden", true);
Files.setAttribute(path, "dos:readonly", true);
```

Namun:

```text
readonly attribute ≠ ACL write denial
hidden attribute   ≠ security boundary
```

Hidden file hanya presentation/visibility metadata.

Readonly dapat mempengaruhi operasi tertentu, tetapi jangan dianggap sebagai mekanisme keamanan utama.

Untuk security, lihat ACL/OS permission.

---

## 16. Feature Detection: Jangan Asumsikan Permission View Ada

Gunakan `FileStore` dan `FileSystem` untuk mendeteksi capability.

Contoh:

```java
import java.nio.file.FileStore;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.AclFileAttributeView;

public class PermissionCapabilityExample {
    public static void main(String[] args) throws Exception {
        Path path = Path.of("/data/app");
        FileStore store = Files.getFileStore(path);

        boolean posix = store.supportsFileAttributeView(PosixFileAttributeView.class);
        boolean acl = store.supportsFileAttributeView(AclFileAttributeView.class);

        System.out.println("POSIX: " + posix);
        System.out.println("ACL: " + acl);
    }
}
```

Atau via string name:

```java
store.supportsFileAttributeView("posix");
store.supportsFileAttributeView("acl");
store.supportsFileAttributeView("dos");
```

Jangan lakukan:

```java
Files.setPosixFilePermissions(path, perms); // tanpa cek capability
```

kecuali aplikasi memang hanya menargetkan POSIX filesystem.

---

## 17. Permission Check Sebelum Operasi Itu Race-Prone

Pola naïf:

```java
if (Files.isWritable(path)) {
    Files.writeString(path, "hello");
}
```

Masalah:

```text
T1: check writable -> true
T2: permission berubah / file diganti / mount berubah
T1: write -> AccessDeniedException
```

Permission check sebelum operasi hanya hint.

Pola yang lebih benar:

```java
try {
    Files.writeString(path, "hello", StandardOpenOption.CREATE_NEW);
} catch (AccessDeniedException e) {
    // classify and handle permission problem
} catch (FileAlreadyExistsException e) {
    // handle idempotency/conflict
} catch (IOException e) {
    // classify other I/O failure
}
```

Top 1% rule:

> Jangan memakai permission pre-check sebagai authorization final. Lakukan operasi secara atomic bila bisa, lalu tangani exception yang spesifik.

---

## 18. `Files.isReadable`, `isWritable`, `isExecutable`: Berguna Tapi Bukan Kontrak

API:

```java
Files.isReadable(path)
Files.isWritable(path)
Files.isExecutable(path)
```

Berguna untuk:

- diagnostics,
- startup validation,
- readiness check,
- user-friendly error message,
- preflight environment check.

Tidak cukup untuk:

- security authorization,
- correctness under concurrency,
- guarantee operasi berikutnya sukses,
- replacement untuk try/catch `IOException`.

Contoh penggunaan yang sehat:

```java
public final class StartupDirectoryValidator {
    public static void validateWritableDirectory(Path dir) throws IOException {
        if (!Files.isDirectory(dir)) {
            throw new IllegalStateException("Not a directory: " + dir);
        }
        if (!Files.isReadable(dir)) {
            throw new IllegalStateException("Directory is not readable: " + dir);
        }
        if (!Files.isWritable(dir)) {
            throw new IllegalStateException("Directory is not writable: " + dir);
        }

        Path probe = Files.createTempFile(dir, ".write-probe-", ".tmp");
        try {
            Files.writeString(probe, "probe");
        } finally {
            Files.deleteIfExists(probe);
        }
    }
}
```

Kenapa create probe lebih kuat?

Karena ia menguji operasi nyata: create + write + delete.

Tetap bukan guarantee masa depan, tapi jauh lebih representatif daripada `isWritable` saja.

---

## 19. Directory Permission untuk File Workflow

Untuk aplikasi server, permission directory sering lebih penting daripada permission file.

Contoh file intake:

```text
/data/intake/inbox
/data/intake/staging
/data/intake/processing
/data/intake/done
/data/intake/error
```

Kebutuhan permission:

```text
inbox      : create/read/rename claim
staging    : write temp payload
processing : rename claimed files
 done      : move final output
 error     : quarantine failed payload
```

Jika aplikasi perlu `move` file dari `staging` ke `done`, maka aplikasi perlu akses pada dua directory tersebut.

Desain permission harus dimulai dari operasi:

```text
Apa operasi file yang dilakukan aplikasi?
Pada directory mana?
Dengan identity runtime apa?
Apakah parent directory perlu write?
Apakah file perlu read/write atau hanya rename?
```

Jangan mulai dari:

```text
chmod -R 777 /data
```

Itu biasanya tanda desain permission tidak dipahami.

---

## 20. Anti-Pattern: `chmod -R 777`

Di production, `chmod -R 777` adalah bau desain.

Masalah:

1. Semua user/proses bisa membaca.
2. Semua user/proses bisa menulis.
3. Semua user/proses bisa menghapus/rename entry jika directory writable.
4. Multi-tenant isolation rusak.
5. Secret/temp file bisa bocor.
6. Attack surface meningkat.
7. Root cause permission tidak dipahami, hanya disembunyikan.

Alternatif:

```text
chown root:appgroup /data/app
chmod 2770 /data/app
```

atau:

```text
owner: root
 group: appgroup
 mode:  0750 / 0770 sesuai kebutuhan
```

Lalu jalankan aplikasi sebagai member group tersebut.

Dalam Kubernetes:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  fsGroup: 2000
```

Dengan catatan, behavior detail `fsGroup` tergantung volume type, driver, policy, dan Kubernetes version.

---

## 21. Container Runtime Identity

Dalam container, ada beberapa layer identity:

```text
Image Dockerfile USER
Pod/container securityContext.runAsUser
Pod/container securityContext.runAsGroup
Pod securityContext.fsGroup
Linux capabilities
hostPath/PVC ownership
readOnlyRootFilesystem
volume mount readOnly flag
```

Jangan mengira aplikasi berjalan sebagai user yang sama dengan laptop.

Cek dari dalam container:

```bash
id
whoami
ls -ld /data /data/uploads
mount | grep data
```

Contoh masalah umum:

```text
Application UID: 10001
Mounted volume owner: root:root
Mode: 0755
Operation: create file in /data/uploads
Result: AccessDeniedException
```

Kenapa?

Directory `0755` berarti:

```text
owner root: rwx
group root: r-x
others: r-x
```

UID 10001 hanya “others”, tidak punya write.

Solusi bukan di Java code, tetapi di deployment permission:

- set volume owner/group,
- gunakan `fsGroup`,
- init container untuk chown/chmod jika sesuai policy,
- provision PVC dengan ownership benar,
- mount ke path yang writable.

---

## 22. Kubernetes `fsGroup`: Berguna Tapi Bukan Magic

`fsGroup` membantu memberikan group-based access pada volume tertentu.

Contoh:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: file-app
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 10001
    runAsGroup: 10001
    fsGroup: 2000
  containers:
    - name: app
      image: example/file-app:1.0
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: file-app-data
```

Namun perhatikan:

1. Tidak semua volume type berperilaku sama.
2. Recursive ownership change pada volume besar bisa memperlambat startup.
3. Ada `fsGroupChangePolicy` untuk mengontrol behavior tertentu.
4. CSI driver tertentu punya behavior khusus.
5. `hostPath` punya risiko dan ownership host-side.
6. File yang sudah ada bisa tetap punya mode yang tidak group-writable.

Jadi readiness/startup validation tetap penting.

---

## 23. Read-Only Root Filesystem

Security hardening container sering memakai:

```yaml
securityContext:
  readOnlyRootFilesystem: true
```

Ini bagus untuk security, tetapi aplikasi Java yang menulis ke lokasi default bisa gagal.

Contoh lokasi yang mungkin ditulis:

- current working directory,
- `/tmp`,
- log file directory,
- uploaded file temp directory,
- cache directory,
- generated report directory,
- JVM temp dir: `java.io.tmpdir`,
- embedded server work dir,
- library cache.

Jika root filesystem read-only, sediakan writable mount eksplisit:

```yaml
volumeMounts:
  - name: tmp
    mountPath: /tmp
  - name: app-data
    mountPath: /data/app
volumes:
  - name: tmp
    emptyDir: {}
  - name: app-data
    persistentVolumeClaim:
      claimName: app-data
```

Dan set:

```bash
-Djava.io.tmpdir=/tmp
```

atau environment/application config yang eksplisit.

---

## 24. Java Temp Directory Permission

Banyak API Java dan library memakai temporary directory.

Cek:

```java
System.getProperty("java.io.tmpdir")
```

Masalah umum:

```text
java.io.tmpdir points to /tmp
but /tmp not writable in hardened container
```

atau:

```text
/tmp is shared and too permissive
secret temporary file created with unsafe permission
```

Pola sehat:

```text
App-specific temp directory
owned by app runtime user/group
mode 0700 or 0770 depending sharing need
configured explicitly
validated at startup
```

Contoh:

```bash
-Djava.io.tmpdir=/data/app/tmp
```

Lalu startup check:

```java
Path tmp = Path.of(System.getProperty("java.io.tmpdir"));
StartupDirectoryValidator.validateWritableDirectory(tmp);
```

---

## 25. Mounted Volume Read-Only Flag

Kubernetes/Docker volume bisa dimount read-only walaupun filesystem permission terlihat writable.

Contoh:

```yaml
volumeMounts:
  - name: config
    mountPath: /etc/app-config
    readOnly: true
```

Dari perspektif aplikasi:

```java
Files.isWritable(path)
```

bisa memberi hasil yang tidak cukup untuk semua kasus, dan operasi nyata bisa tetap gagal.

Error yang mungkin:

```text
Read-only file system
AccessDeniedException
FileSystemException
```

Rule:

> Permission bits menjelaskan policy objek; mount options bisa membatasi seluruh filesystem subtree.

---

## 26. Permission and Symlink: Jangan Cek Target yang Salah

Path bisa melewati symbolic link.

Contoh:

```text
/data/app/uploads -> /mnt/shared/uploads
```

Permission yang relevan bukan hanya `/data/app/uploads`, tapi target real path.

Jika kamu melakukan:

```java
Files.getPosixFilePermissions(path, LinkOption.NOFOLLOW_LINKS)
```

maka kamu membaca permission link itu sendiri, jika provider mendukung.

Jika tanpa `NOFOLLOW_LINKS`, banyak operasi mengikuti link ke target.

Security-sensitive code harus jelas:

```text
Apakah saya memeriksa link object atau target object?
Apakah saya membolehkan symlink di path ini?
Apakah containment check dilakukan terhadap real path?
```

Permission check yang benar bisa gagal total jika symlink race tidak dikendalikan.

Ini sudah dibahas di Part 12 dan 13, tapi penting diulang dalam konteks permission:

> Permission tidak melindungi sandbox jika attacker bisa mengganti directory entry menjadi symlink menuju lokasi lain sebelum operasi final.

---

## 27. Security Manager Bukan Lagi Sandboxing Strategy

Di Java lama, beberapa sistem memakai `SecurityManager` untuk membatasi file access dari dalam JVM.

Untuk Java 8–16, Security Manager masih ada dan bisa digunakan di sebagian konteks.

Namun untuk modern Java:

- Java 17: Security Manager dideprekasi untuk removal melalui JEP 411.
- Java 24: Security Manager dinonaktifkan secara permanen melalui JEP 486.
- Java 25: jangan desain security baru yang bergantung pada Security Manager.

Implikasi desain:

```text
Jangan mengandalkan Java-level sandbox untuk membatasi file access.
Gunakan OS/container isolation, process identity, filesystem permission, mount policy, chroot/container boundary, seccomp/AppArmor/SELinux, dan application-level validation.
```

Untuk server modern, defense-in-depth yang benar:

```text
Application validation
+ least privilege process user
+ restricted filesystem permission
+ read-only root filesystem where possible
+ explicit writable mounts only
+ container security context
+ platform policy
+ audit/monitoring
```

---

## 28. Least Privilege untuk File-Handling Service

Prinsip:

> Aplikasi hanya boleh punya permission minimum untuk menjalankan workflow-nya.

Contoh file intake service.

Kebutuhan:

```text
- receive upload
- write staging file
- read staged file
- move to processing
- write result metadata
- move failed file to quarantine
```

Tidak butuh:

```text
- write ke application binary directory
- read semua /etc
- write ke root filesystem
- chmod arbitrary file
- chown arbitrary file
- delete sibling service data
```

Directory layout:

```text
/opt/app                  read-only app binaries
/data/file-engine/tmp      rw private
/data/file-engine/inbox    rw controlled
/data/file-engine/work     rw private
/data/file-engine/done     rw controlled
/data/file-engine/error    rw controlled
```

Permission konsep:

```text
/opt/app                 root:root     0555 or image read-only
/data/file-engine        root:appgroup 0750
/data/file-engine/tmp    app:appgroup  0700 or 0770
/data/file-engine/work   app:appgroup  0700
/data/file-engine/done   app:appgroup  0750/0770 depending access
/data/file-engine/error  app:appgroup  0750/0770
```

---

## 29. Permission Design by Workflow State

Daripada satu directory besar writable, desain berdasarkan state.

Contoh:

```text
incoming/    external writer drops files
claimed/     app has claimed file
processing/  app internal work
done/        immutable output
error/       quarantine
archive/     retention
```

Permission bisa berbeda:

```text
incoming:
  external writer: write/create
  app: read/rename

processing:
  app only

done:
  app write once
  downstream read

error:
  app write
  operator read

archive:
  mostly read-only after retention move
```

Ini mencegah satu bug menghapus semua state.

---

## 30. Startup Permission Validation Pattern

Aplikasi production yang bergantung pada filesystem harus validasi environment saat startup.

Contoh struktur hasil validasi:

```text
[OK] /data/file-engine/tmp exists directory writable delete-probe ok
[OK] /data/file-engine/work exists directory writable delete-probe ok
[WARN] POSIX permissions cannot be verified on this provider
[FAIL] /data/file-engine/done is not writable by current runtime identity
```

Contoh Java:

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public final class FileEnvironmentChecks {
    private FileEnvironmentChecks() {}

    public static void requireWritableDirectory(Path dir) throws IOException {
        if (!Files.exists(dir)) {
            throw new IllegalStateException("Missing directory: " + dir);
        }
        if (!Files.isDirectory(dir)) {
            throw new IllegalStateException("Not a directory: " + dir);
        }

        Path probe = Files.createTempFile(dir, ".probe-", ".tmp");
        try {
            Files.writeString(
                probe,
                "probe",
                StandardOpenOption.WRITE,
                StandardOpenOption.TRUNCATE_EXISTING
            );
            Files.delete(probe);
        } finally {
            Files.deleteIfExists(probe);
        }
    }
}
```

Kenapa create/write/delete probe?

Karena workflow biasanya membutuhkan ketiganya.

Kalau aplikasi hanya butuh read, validasinya beda.

---

## 31. Permission Error Classification

Jangan tangkap semua sebagai `IOException` lalu retry buta.

Contoh:

```java
try {
    Files.writeString(path, payload, StandardOpenOption.CREATE_NEW);
} catch (AccessDeniedException e) {
    // permission / ACL / readonly / directory access problem
} catch (FileAlreadyExistsException e) {
    // idempotency conflict
} catch (NoSuchFileException e) {
    // missing parent or path changed
} catch (FileSystemException e) {
    // may contain reason like read-only filesystem, device issue, sharing violation
} catch (IOException e) {
    // generic I/O failure
}
```

Access denied biasanya bukan transient.

Retry tanpa perubahan kondisi sering hanya menghasilkan noise.

Lebih baik:

```text
Classify -> fail fast or circuit-break -> alert operator -> include diagnostics
```

Diagnostics minimal:

```text
operation
path
real path if safe
current user info if available
file store
attribute view support
exists/isDirectory/isRegularFile hints
parent directory status
mount/read-only suspicion
exception class + reason
```

Jangan log secret path jika path mengandung user data sensitif.

---

## 32. Diagnosing `AccessDeniedException`

Checklist:

```text
1. Apakah path benar?
2. Apakah parent directory exists?
3. Apakah parent directory traversable?
4. Apakah parent directory writable untuk operasi create/delete/rename?
5. Apakah file existing writable untuk operasi content write?
6. Apakah mount read-only?
7. Apakah root filesystem container read-only?
8. Apakah process UID/GID benar?
9. Apakah process punya supplementary group yang dibutuhkan?
10. Apakah ACL menolak akses?
11. Apakah symlink mengarah ke lokasi lain?
12. Apakah file sedang di-lock atau dibuka oleh proses lain?
13. Apakah antivirus/security agent mengintervensi?
14. Apakah provider mendukung operasi attribute yang diminta?
15. Apakah volume network filesystem punya semantics khusus?
```

Command OS yang biasa membantu:

```bash
id
pwd
ls -ld /data /data/app /data/app/uploads
ls -l /data/app/uploads
stat /data/app/uploads
mount | grep /data
namei -l /data/app/uploads/file.txt
```

`namei -l` sangat berguna di Linux untuk melihat permission setiap komponen path.

---

## 33. Java Diagnostic Helper

Contoh helper untuk mencetak informasi permission secara defensif:

```java
import java.io.IOException;
import java.nio.file.FileStore;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFileAttributes;
import java.nio.file.attribute.PosixFilePermissions;

public final class FilePermissionDiagnostics {
    private FilePermissionDiagnostics() {}

    public static void print(Path path) {
        System.out.println("Path: " + path);
        System.out.println("Absolute: " + path.toAbsolutePath());

        try {
            System.out.println("Real path: " + path.toRealPath());
        } catch (IOException e) {
            System.out.println("Real path: <unavailable> " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }

        System.out.println("exists: " + Files.exists(path));
        System.out.println("isDirectory: " + Files.isDirectory(path));
        System.out.println("isRegularFile: " + Files.isRegularFile(path));
        System.out.println("isReadable: " + Files.isReadable(path));
        System.out.println("isWritable: " + Files.isWritable(path));
        System.out.println("isExecutable: " + Files.isExecutable(path));

        try {
            FileStore store = Files.getFileStore(Files.exists(path) ? path : path.toAbsolutePath().getParent());
            System.out.println("FileStore: " + store);
            System.out.println("supports posix: " + store.supportsFileAttributeView(PosixFileAttributeView.class));
            System.out.println("supports acl: " + store.supportsFileAttributeView(AclFileAttributeView.class));
        } catch (Exception e) {
            System.out.println("FileStore: <unavailable> " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }

        try {
            PosixFileAttributes attrs = Files.readAttributes(path, PosixFileAttributes.class);
            System.out.println("owner: " + attrs.owner());
            System.out.println("group: " + attrs.group());
            System.out.println("permissions: " + PosixFilePermissions.toString(attrs.permissions()));
        } catch (Exception e) {
            System.out.println("POSIX attrs: <unavailable> " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }
}
```

Catatan:

- Jangan aktifkan helper ini untuk semua request production.
- Gunakan untuk startup diagnostics atau admin endpoint terbatas.
- Jangan bocorkan path/owner/group ke user tidak berwenang.

---

## 34. Permission untuk Secret Files

Secret file perlu default ketat.

Contoh:

- API token,
- private key,
- credential cache,
- decrypted config,
- local keystore,
- signing key,
- SAML/OIDC private material,
- temporary export sensitif.

Target POSIX umum:

```text
file:      0600
private dir: 0700
```

Contoh:

```java
Path secretDir = Path.of("/data/app/secret-cache");

FileAttribute<Set<PosixFilePermission>> dirAttr =
    PosixFilePermissions.asFileAttribute(
        PosixFilePermissions.fromString("rwx------")
    );

FileAttribute<Set<PosixFilePermission>> fileAttr =
    PosixFilePermissions.asFileAttribute(
        PosixFilePermissions.fromString("rw-------")
    );

if (!Files.exists(secretDir)) {
    Files.createDirectory(secretDir, dirAttr);
}

Path secretFile = secretDir.resolve("token.cache");
Files.createFile(secretFile, fileAttr);
Files.writeString(secretFile, token, StandardOpenOption.WRITE);
```

Tetapi untuk portable code:

```java
FileStore store = Files.getFileStore(secretDir);
if (store.supportsFileAttributeView("posix")) {
    // use POSIX attributes
} else if (store.supportsFileAttributeView("acl")) {
    // use ACL strategy or delegate to OS provisioning
} else {
    // fail closed for highly sensitive local secret storage
}
```

Fail-open untuk secret adalah risiko.

---

## 35. Permission untuk Upload Files

Upload file dari user tidak boleh langsung disimpan dengan nama/path user.

Permission concern:

1. File upload bisa mengandung konten berbahaya.
2. Nama file bisa path traversal.
3. File bisa executable jika permission salah.
4. File bisa dibaca oleh tenant lain jika directory permission salah.
5. Temporary upload bisa bocor sebelum validation.

Pola:

```text
private upload temp dir: 0700
stored file:             0600 initially
published file:          permission sesuai kebutuhan downstream
original filename:       metadata only, not path authority
```

Jangan buat upload directory:

```text
/data/uploads 0777
```

Lebih baik:

```text
/data/uploads root:appgroup 0770
```

atau per-tenant:

```text
/data/uploads/tenant-a app-a:app-a 0700
/data/uploads/tenant-b app-b:app-b 0700
```

---

## 36. Permission untuk Generated Reports dan Exports

Report/export sering berisi data sensitif.

Pertanyaan desain:

```text
Siapa yang perlu membaca file hasil export?
Apakah file perlu diakses user OS lain?
Apakah web server mengirim file dari disk?
Apakah file akan dipindah ke object storage?
Berapa lama retention-nya?
Apakah file perlu immutable setelah selesai?
```

Pola umum:

```text
work file:     0600
final file:    0640 if group reader needed
final dir:     0750
archive dir:   0750 or stricter
```

Jika report disajikan lewat aplikasi, tidak perlu membuat file world-readable.

Aplikasi bisa membaca file private lalu stream ke user yang sudah authorized pada application layer.

---

## 37. Permission untuk Log Files

Di container modern, log biasanya ke stdout/stderr.

Jika tetap perlu file log:

- pastikan log directory writable,
- jangan jalankan sebagai root hanya demi log file,
- jangan `chmod 777 /var/log/app`,
- gunakan group write atau mounted volume,
- pastikan rotation process punya akses,
- hindari log berisi secret/PII.

Contoh:

```text
/var/log/app root:appgroup 0770
```

Aplikasi:

```text
uid=10001 gid=10001 groups=appgroup
```

Logrotate/sidecar:

```text
member of appgroup or runs with appropriate permission
```

---

## 38. Permission untuk Atomic Update Pattern

Dari Part 07, atomic update memakai:

```text
write temp file in same directory
force
atomic move to target
```

Permission implication:

1. Perlu create/write di parent directory.
2. Perlu permission untuk rename entry di parent directory.
3. Temp file permission harus aman sejak create.
4. Setelah move, permission target biasanya mengikuti temp file, bukan file lama, tergantung operasi/provider.
5. Jika ingin preserve permission file lama, harus didesain eksplisit.

Contoh masalah:

```text
Existing config: 0640 root:appgroup
Temp file:       0600 appuser:appuser
Atomic move replaces config
Result: downstream group can no longer read config
```

Solusi:

- set temp file permission sesuai final expectation,
- atau setelah move set permission, dengan sadar bahwa ada state transition,
- atau gunakan provisioning pattern yang tidak butuh downstream OS read,
- atau simpan config melalui service/database/object store.

Untuk file sensitif, lebih baik final permission ketat.

Untuk file yang harus dibaca process lain, permission final harus dipikirkan.

---

## 39. Permission and Copy/Move

`Files.copy(..., COPY_ATTRIBUTES)` bisa mencoba preserve attribute, tetapi tidak semua attribute didukung atau bisa dicopy.

Cross-filesystem copy bisa kehilangan:

- owner,
- group,
- ACL,
- POSIX mode,
- DOS attribute,
- extended attribute,
- timestamps precision.

Karena itu, setelah copy/move penting, lakukan postcondition check:

```text
content copied?
size/hash match?
expected permission?
expected owner/group if required?
expected ACL if required?
```

Jika permission/metadata adalah bagian dari contract, jangan menganggap `copy` otomatis cukup.

---

## 40. Access Control di Application Layer vs Filesystem Layer

Filesystem permission tidak menggantikan authorization aplikasi.

Contoh:

```text
User A mengakses report B lewat endpoint aplikasi.
```

Walaupun file di disk private untuk process Java, aplikasi tetap harus memeriksa:

```text
Apakah authenticated user boleh mengakses report itu?
```

Model yang benar:

```text
Filesystem permission:
  melindungi file dari process/user OS yang tidak seharusnya.

Application authorization:
  melindungi data dari user bisnis yang tidak seharusnya.
```

Jangan menaruh semua file tenant dalam directory world-readable dan berharap endpoint aplikasi selalu benar.

Defense-in-depth:

```text
per-tenant storage boundary if high risk
private OS permission
application authorization
object metadata owner/tenant
signed URL only when needed
short TTL
logging/audit
```

---

## 41. Multi-Tenant File Isolation

Untuk multi-tenant system, ada beberapa level isolation.

### Level 1 — Logical only

```text
/data/uploads/{tenantId}/...
Same process, same OS user, same permission.
```

Aman hanya jika application validation sempurna.

### Level 2 — Directory permission boundary

```text
/data/uploads/tenant-a owned by app-a
/data/uploads/tenant-b owned by app-b
Different process identity per tenant.
```

Lebih kuat, tapi operasional lebih kompleks.

### Level 3 — Container/process boundary

```text
Separate pod/container/service account/volume per tenant class.
```

Lebih kuat lagi.

### Level 4 — Storage service boundary

```text
Object storage bucket/prefix policy
KMS key separation
IAM condition
```

Untuk high-sensitivity regulated workloads, jangan hanya mengandalkan path prefix.

---

## 42. File Permission with Object Storage-Like Providers

Beberapa `FileSystemProvider` bisa merepresentasikan storage yang bukan local POSIX filesystem.

Contoh:

- ZIP filesystem,
- in-memory filesystem,
- cloud/object storage wrappers,
- networked/custom provider.

Permission model bisa tidak ada, terbatas, atau berbeda total.

Pola:

```java
if (!store.supportsFileAttributeView("posix")) {
    // Do not pretend chmod is available.
}
```

Untuk object storage, access control biasanya bukan POSIX permission, melainkan:

- IAM policy,
- bucket policy,
- object ACL,
- encryption key policy,
- signed URL,
- service identity.

Jangan memaksa mental model POSIX ke object storage.

---

## 43. Designing Portable Permission Strategy

Ada tiga strategi.

### 43.1 POSIX-only application

Cocok jika deployment hanya Linux/container Linux.

```text
Require POSIX view.
Fail startup jika tidak ada.
Gunakan permission-at-create.
Gunakan UID/GID/fsGroup provisioning.
```

### 43.2 Windows-only application

```text
Require ACL view.
Provision ACL via installer/IaC/admin policy.
Java hanya validasi/read ACL jika perlu.
```

### 43.3 Portable application

```text
Do not promise exact chmod semantics.
Use provider capability detection.
Use app-private storage directory.
Delegate OS-specific hardening to deployment.
Fail closed for sensitive local secret storage.
```

Portable bukan berarti satu permission API untuk semua OS.

Portable berarti:

```text
Kode tahu capability environment dan tidak membuat asumsi palsu.
```

---

## 44. Java 8–25 Compatibility Notes

| Area | Java 8 | Java 11+ / 25 |
|---|---|---|
| Path creation | `Paths.get(...)` | `Path.of(...)` available and preferred in modern code |
| POSIX permissions | NIO.2 available | Still available |
| ACL view | Available | Still available |
| Owner view | Available | Still available |
| Security Manager | Available historically | Deprecated in Java 17, permanently disabled in Java 24+ |
| File attribute views | Provider-based | Provider-based |
| Permission semantics | OS/provider-specific | OS/provider-specific |

Important conclusion:

> Java 8 sampai 25 tidak mengubah fakta utama: filesystem permission tetap OS/provider-specific. API Java menyediakan abstraction, bukan jaminan semantic uniformity.

---

## 45. Robust Permission Utility

Contoh utility dengan feature detection:

```java
import java.io.IOException;
import java.nio.file.FileStore;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileAttribute;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Set;

public final class SecureFileCreator {
    private SecureFileCreator() {}

    public static Path createPrivateFile(Path path) throws IOException {
        Path parent = path.toAbsolutePath().getParent();
        if (parent == null) {
            throw new IllegalArgumentException("Path has no parent: " + path);
        }

        FileStore store = Files.getFileStore(parent);

        if (store.supportsFileAttributeView("posix")) {
            Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rw-------");
            FileAttribute<Set<PosixFilePermission>> attr =
                PosixFilePermissions.asFileAttribute(perms);
            return Files.createFile(path, attr);
        }

        // For high-sensitivity files, fail closed instead of creating insecurely.
        throw new UnsupportedOperationException(
            "Cannot create private file safely: POSIX permissions not supported by file store " + store
        );
    }
}
```

Untuk aplikasi portable, kamu bisa menyediakan OS-specific implementation:

```text
PermissionStrategy
  PosixPermissionStrategy
  WindowsAclPermissionStrategy
  NoopPermissionStrategy for non-sensitive files only
```

---

## 46. Windows ACL Strategy: Biasanya Provisioning Lebih Baik dari Java Runtime Mutation

Walaupun Java bisa membaca/mengatur ACL, banyak organisasi lebih memilih ACL dikelola oleh:

- installer,
- PowerShell script,
- Group Policy,
- IaC,
- administrator-controlled deployment,
- container/base image build.

Kenapa?

Karena ACL:

- kompleks,
- sering domain-dependent,
- principal name berbeda antar host/domain,
- inheritance penting,
- deny entry ordering penting,
- audit policy bisa terlibat,
- runtime app biasanya tidak punya privilege mengubah ACL.

Jadi aplikasi cukup:

```text
validate can perform required operation
fail fast with diagnostic if cannot
```

Bukan:

```text
try to repair ACL dynamically in business code
```

---

## 47. Permission Drift

Permission bisa berubah setelah deployment:

- operator menjalankan chmod manual,
- logrotate membuat file owner root,
- restore backup preserve owner lama,
- PVC remounted dengan ownership berbeda,
- new container UID berubah,
- init container gagal,
- security policy berubah,
- shared process menulis file dengan umask berbeda,
- atomic replace mengubah final permission,
- copy dari external source membawa metadata aneh.

Mitigasi:

```text
startup validation
periodic health check for critical dirs
postcondition checks after critical operations
observability on AccessDeniedException
infrastructure as code for ownership/mode
avoid manual chmod in runbook except emergency
```

---

## 48. Production Runbook: AccessDeniedException

Saat incident:

```text
Symptom:
  java.nio.file.AccessDeniedException: /data/file-engine/inbox/a.csv

Immediate questions:
  1. Operation apa? read/write/create/delete/move/chmod?
  2. Path exact apa?
  3. Parent directory apa?
  4. JVM berjalan sebagai UID/GID apa?
  5. Apakah deployment baru mengubah runAsUser/runAsGroup/fsGroup?
  6. Apakah volume baru/remount/readOnly?
  7. Apakah file/directory owner berubah?
  8. Apakah permission berubah setelah backup/restore?
  9. Apakah ini Windows sharing violation/lock?
 10. Apakah symlink target berubah?
```

Linux commands:

```bash
id
ls -ld /data /data/file-engine /data/file-engine/inbox
namei -l /data/file-engine/inbox/a.csv
stat /data/file-engine/inbox/a.csv
mount | grep /data
```

Kubernetes commands:

```bash
kubectl get pod <pod> -o yaml | grep -A20 securityContext
kubectl exec -it <pod> -- id
kubectl exec -it <pod> -- ls -ld /data /data/file-engine /data/file-engine/inbox
kubectl describe pod <pod>
```

Java-side logs should include:

```text
operation=create
path=/data/file-engine/inbox/a.csv
parent=/data/file-engine/inbox
exception=AccessDeniedException
reason=<reason if present>
fileStore=<store if available>
posixSupported=true/false
aclSupported=true/false
```

---

## 49. Design Checklist

Sebelum shipping fitur yang menulis file:

```text
[ ] Apakah path root eksplisit dan bukan current working directory implicit?
[ ] Apakah runtime user non-root?
[ ] Apakah writable directory disiapkan oleh deployment/IaC?
[ ] Apakah permission tidak memakai 777?
[ ] Apakah file sensitif dibuat dengan permission ketat saat create?
[ ] Apakah parent directory permission sesuai operasi create/delete/rename?
[ ] Apakah startup validation melakukan operasi nyata?
[ ] Apakah provider capability dicek sebelum POSIX/ACL operation?
[ ] Apakah Windows/POSIX/container behavior sudah dipisahkan?
[ ] Apakah aplikasi tidak bergantung pada Security Manager?
[ ] Apakah temp directory aman dan eksplisit?
[ ] Apakah mounted volume readOnly/root read-only dipertimbangkan?
[ ] Apakah AccessDeniedException diklasifikasi, bukan di-retry buta?
[ ] Apakah permission final setelah atomic move/copy sudah benar?
[ ] Apakah multi-tenant data punya boundary yang cukup?
```

---

## 50. Common Misconceptions

### Misconception 1 — “Kalau file writable, saya bisa delete.”

Belum tentu. Delete biasanya butuh write permission pada parent directory.

### Misconception 2 — “Kalau `Files.isWritable` true, write pasti sukses.”

Tidak. Itu hanya check saat itu. Bisa race, mount policy, lock, atau kondisi lain.

### Misconception 3 — “`chmod 777` menyelesaikan masalah.”

Ia menyembunyikan root cause dan membuka risiko.

### Misconception 4 — “POSIX permission portable ke Windows.”

Tidak. Windows ACL jauh lebih kompleks dan tidak map sempurna ke POSIX bits.

### Misconception 5 — “Container root sama dengan host root.”

Tergantung runtime, namespace, capability, security policy, dan mount. Jangan desain aplikasi butuh root.

### Misconception 6 — “Aplikasi bisa memperbaiki permission sendiri.”

Kadang bisa, tapi sering itu tanda deployment salah. Ownership dan volume permission biasanya tanggung jawab provisioning.

### Misconception 7 — “Readonly file tidak bisa dihapus.”

Pada POSIX-like filesystem, deletion dikontrol oleh directory entry permission, bukan semata write bit file.

### Misconception 8 — “Hidden file berarti aman.”

Hidden bukan security boundary.

### Misconception 9 — “Security Manager bisa dipakai untuk sandbox modern Java.”

Tidak untuk Java modern. Gunakan OS/container/platform isolation.

---

## 51. Practical Patterns

### Pattern A — Private Application Data Directory

```text
/data/myapp root:myapp 0750
/data/myapp/tmp myapp:myapp 0700
/data/myapp/work myapp:myapp 0700
```

Use case:

- local temp,
- cache,
- generated intermediate file,
- internal processing.

### Pattern B — Shared Group Handoff Directory

```text
/data/handoff root:handoff 2770
```

Use case:

- two processes exchange files,
- group-based access,
- setgid helps preserve group.

### Pattern C — Write-Private, Read-via-App

```text
files stored as 0600
only Java process can read
end users access through authorized API
```

Use case:

- report download,
- attachments,
- regulated documents.

### Pattern D — Provisioned Permission, App Validates

```text
Infra creates directory and permission.
App validates on startup with probe.
App does not chmod/chown during normal operation.
```

Use case:

- enterprise deployment,
- Kubernetes PVC,
- Windows service.

### Pattern E — Fail Closed for Secrets

```text
If secure permission cannot be guaranteed, do not write local secret file.
```

Use case:

- private keys,
- token cache,
- credential file.

---

## 52. Mini Case Study: Upload Service in Kubernetes

### Requirement

A Java service receives uploaded documents, stores them temporarily, validates them, then moves them to a processing directory.

### Bad design

```text
Container runs as root.
/data/uploads chmod 777.
Upload files use original filename.
Temporary files created in /tmp.
No startup validation.
```

Risks:

- privilege too broad,
- path traversal risk,
- user file readable by unrelated process,
- temp file exposure,
- incident root cause hidden,
- non-portable deployment.

### Better design

Kubernetes:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  fsGroup: 2000
  readOnlyRootFilesystem: true
```

Volumes:

```text
/tmp mounted as emptyDir
/data/uploads mounted as PVC
```

Directory:

```text
/data/uploads/tmp        0700 app user
/data/uploads/staging    0700 app user
/data/uploads/processing 0700 app user
/data/uploads/error      0700 or 0750 if operator needs read
```

Application:

```text
- random storage name
- permission-at-create if POSIX supported
- startup probe create/write/delete
- no original filename as path authority
- AccessDeniedException classified as deployment/config issue
```

---

## 53. Mini Case Study: Report Export Shared with Batch Job

### Requirement

Java web app generates report files. A separate batch process reads them.

### Key design question

Should the batch process read files directly from the same filesystem?

If yes:

```text
shared group: reportreaders
report directory: root:reportreaders 2770
web app process: member of reportreaders
batch process: member of reportreaders
final files: 0640 or 0660 depending mutation needs
```

But if report is sensitive and only app should enforce authorization:

```text
web app owns files 0600
batch requests report through internal API
```

The better architecture depends on trust boundary.

Top 1% reasoning:

```text
Direct filesystem sharing couples two processes through OS permission.
API-based sharing centralizes authorization but adds service dependency.
Object storage sharing may be better if distribution/retention is larger.
```

---

## 54. What Top 1% Engineers Internalize

They know:

1. Permission is evaluated by OS/provider at operation time.
2. File permission and directory permission are different but both matter.
3. `exists/isWritable/isReadable` are hints, not guarantees.
4. POSIX mode bits are not Windows ACL.
5. Container UID/GID mismatch is a common root cause.
6. `fsGroup` helps but is not universal magic.
7. `chmod -R 777` is almost never a real solution.
8. Secret files need permission-at-create.
9. Atomic move can change permission expectations if temp file metadata differs.
10. App-level authorization and filesystem permission solve different layers.
11. Security Manager is not a modern Java sandbox strategy.
12. Permission must be designed as part of deployment architecture, not patched after incidents.

---

## 55. Summary

Permission engineering in Java is not about memorizing `Files.setPosixFilePermissions`.

The real model is:

```text
Java code requests an operation.
The FileSystemProvider maps it to OS/filesystem behavior.
The OS evaluates process identity against file/directory metadata, ACL, mount policy, and runtime security constraints.
The operation either succeeds or fails at that moment.
```

For production-grade systems:

- create sensitive files with secure permission from the beginning,
- validate environment by doing real probe operations,
- treat pre-checks as diagnostics, not guarantees,
- separate POSIX, Windows ACL, and portable strategy,
- design directory permissions from workflow operations,
- run as non-root with least privilege,
- configure explicit writable mounts in containers,
- fail closed for secrets,
- classify permission failures carefully,
- do not rely on Java Security Manager for modern sandboxing.

The best filesystem engineers do not ask only:

```text
Can Java write this file?
```

They ask:

```text
Which identity performs which operation on which path, resolved through which provider, under which OS/filesystem/container/mount policy, and what invariant must hold before and after the operation?
```

That is the mental model needed before moving to the next topic: filesystem capacity, quotas, disk-full behavior, and operational guardrails.

---

## 56. References

- Java SE 25 API: `java.nio.file.attribute.PosixFilePermission`, `PosixFilePermissions`, `PosixFileAttributeView`, `FileOwnerAttributeView`, `AclFileAttributeView`.
- Java SE 25 API: `java.nio.file.FileStore#supportsFileAttributeView`.
- Java SE 25 API: `java.nio.file.Files` permission and attribute methods.
- Oracle/dev.java tutorial: Managing file metadata.
- OpenJDK JEP 411: Deprecate the Security Manager for Removal.
- OpenJDK JEP 486: Permanently Disable the Security Manager.
- Kubernetes documentation: Configure a Security Context for a Pod or Container, including `runAsUser`, `runAsGroup`, `fsGroup`, and `fsGroupChangePolicy`.

---

## 57. Status Seri

Selesai sampai:

```text
Part 15 — Permissions Model: POSIX, Windows ACL, Containers, and Runtime Identity
```

Seri belum selesai.

Berikutnya:

```text
Part 16 — FileStore and Filesystem Capacity: Disk Space, Quotas, and Operational Guardrails
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-io-file-filesystem-storage-engineering-part-14-file-attributes.md">⬅️ Part 14 — File Attributes: Basic, POSIX, DOS, Owner, ACL</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-io-file-filesystem-storage-engineering-part-16-filestore-filesystem-capacity.md">Part 16 — FileStore and Filesystem Capacity: Disk Space, Quotas, and Operational Guardrails ➡️</a>
</div>

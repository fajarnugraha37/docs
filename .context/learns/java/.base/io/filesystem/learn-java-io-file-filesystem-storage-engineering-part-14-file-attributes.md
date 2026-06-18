# learn-java-io-file-filesystem-storage-engineering — Part 14
# File Attributes: Basic, POSIX, DOS, Owner, ACL

> Seri: `learn-java-io-file-filesystem-storage-engineering`  
> Part: `14`  
> Topik: metadata file, attribute view, ownership, permission metadata, ACL, portability, provider capability  
> Target Java: 8–25  
> Prasyarat: Part 00–13, terutama `Path`, existence/type/identity, creation semantics, link-safe programming, dan path traversal security.

---

## 0. Tujuan Part Ini

Di bagian sebelumnya kita sudah melihat bahwa file operation tidak cukup dipahami sebagai operasi pada string path. File operation adalah kontrak antara:

```text
Java API
  -> FileSystemProvider
    -> OS syscall / platform API
      -> filesystem implementation
        -> storage / network / virtual backing store
```

Part ini memperdalam sisi **metadata file**.

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Membedakan **data file** dan **metadata file**.
2. Memahami `BasicFileAttributes` sebagai metadata minimum yang common di banyak filesystem.
3. Memahami attribute view sebagai kontrak kemampuan provider, bukan jaminan universal.
4. Membaca metadata secara batch dengan `Files.readAttributes(...)`.
5. Menulis metadata tertentu lewat `Files.setAttribute(...)` atau view type-safe.
6. Membedakan `basic`, `posix`, `dos`, `owner`, `acl`, dan `user` attribute view.
7. Mendesain kode yang portable antara Linux, Windows, macOS, container, network filesystem, dan virtual filesystem.
8. Menghindari asumsi berbahaya seperti:
   - `creationTime` selalu akurat
   - `isHidden` sama di semua OS
   - POSIX permission selalu tersedia
   - ACL Windows sama dengan POSIX mode
   - owner bisa selalu diubah
   - timestamp cukup sebagai identity/change detector
   - metadata check aman dari race condition

---

## 1. Mental Model: File Bukan Hanya Bytes

Secara sederhana, file sering dianggap begini:

```text
file = nama + isi
```

Untuk production engineering, model itu terlalu miskin. Model yang lebih benar:

```text
file object / filesystem entry
  ├── directory entry / name binding
  ├── content bytes
  ├── type metadata
  │     ├── regular file
  │     ├── directory
  │     ├── symlink
  │     ├── device / socket / fifo / other
  ├── size metadata
  ├── time metadata
  │     ├── last modified time
  │     ├── last access time
  │     └── creation / birth / change time depending on platform
  ├── ownership metadata
  │     ├── owner
  │     └── group, if supported
  ├── permission metadata
  │     ├── POSIX mode bits
  │     ├── DOS flags
  │     ├── ACL entries
  │     └── provider-specific controls
  ├── link metadata
  │     ├── symbolic link target
  │     ├── hard link count, not directly portable through Java standard API
  │     └── file key / inode-like identity when available
  └── extended/user metadata, if supported
```

Java `java.nio.file.attribute` memberi akses ke sebagian metadata ini lewat **attribute views**.

Key idea:

> File attribute bukan satu object universal. Ia adalah sekumpulan view yang tergantung provider dan filesystem.

---

## 2. Attribute View: Kontrak, Bukan Struktur Tunggal

Java NIO.2 mengenalkan konsep **file attribute view**.

Sebuah attribute view adalah cara melihat metadata file dalam bentuk yang lebih spesifik.

Contoh:

```text
basic  -> metadata umum: size, timestamps, type
posix  -> owner, group, rwx permissions
owner  -> owner only
acl    -> access control list
 dos   -> readonly, hidden, archive, system
user   -> user-defined / extended attributes
```

Secara konseptual:

```text
Path
  -> Files.readAttributes(path, BasicFileAttributes.class)
  -> Files.getFileAttributeView(path, PosixFileAttributeView.class)
  -> Files.getAttribute(path, "basic:size")
  -> Files.setAttribute(path, "dos:hidden", true)
```

Ada dua gaya akses:

### 2.1 Type-Safe Access

Contoh:

```java
BasicFileAttributes attrs = Files.readAttributes(
    path,
    BasicFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);

long size = attrs.size();
boolean directory = attrs.isDirectory();
FileTime modified = attrs.lastModifiedTime();
```

Kelebihan:

- compile-time type checking
- lebih mudah dibaca
- lebih aman untuk refactoring
- cocok untuk business logic serius

### 2.2 Dynamic String-Based Access

Contoh:

```java
Object size = Files.getAttribute(path, "basic:size", LinkOption.NOFOLLOW_LINKS);
Files.setAttribute(path, "dos:hidden", Boolean.TRUE);
```

Kelebihan:

- flexible
- berguna untuk tooling generic
- bisa dipakai jika attribute name ditentukan runtime

Kekurangan:

- raw `Object`
- typo baru ketahuan runtime
- tidak ideal untuk core domain logic

Rule praktis:

```text
Business logic normal  -> pakai type-safe view
Generic diagnostic tool -> dynamic attribute access boleh
```

---

## 3. Capability Model: Tidak Semua Filesystem Mendukung Semua View

Jangan pernah berasumsi bahwa semua view tersedia.

Contoh:

```java
FileStore store = Files.getFileStore(path);

boolean posix = store.supportsFileAttributeView(PosixFileAttributeView.class);
boolean dos = store.supportsFileAttributeView(DosFileAttributeView.class);
boolean acl = store.supportsFileAttributeView(AclFileAttributeView.class);
boolean user = store.supportsFileAttributeView(UserDefinedFileAttributeView.class);
```

Atau:

```java
FileSystem fs = path.getFileSystem();
Set<String> views = fs.supportedFileAttributeViews();
System.out.println(views); // e.g. [owner, dos, basic, acl, user]
```

Penting:

- `basic` wajib tersedia.
- `posix` biasanya ada di Unix-like filesystem, tetapi jangan diasumsikan di Windows.
- `dos` umum di Windows dan beberapa filesystem yang memetakan atribut DOS.
- `acl` tergantung platform/provider.
- `user`/extended attributes tergantung filesystem, mount option, provider, dan policy.
- Network filesystem dan virtual filesystem bisa memberi hasil yang tidak lengkap atau tidak akurat.

Mental model:

```text
FileSystem.supportedFileAttributeViews()
  = view yang secara umum didukung filesystem/provider

FileStore.supportsFileAttributeView(...)
  = view yang didukung storage tempat path berada

Files.getFileAttributeView(...)
  = handle view untuk path tertentu, bisa null kalau tidak supported
```

Defensive helper:

```java
static boolean supports(Path path, Class<? extends FileAttributeView> viewType) throws IOException {
    return Files.getFileStore(path).supportsFileAttributeView(viewType);
}
```

Namun jangan ubah capability check menjadi security guarantee. Capability bisa berbeda antar mount point, container volume, network filesystem, atau path yang berubah karena race.

---

## 4. BasicFileAttributes: Metadata Minimum yang Harus Dikuasai

`BasicFileAttributes` adalah view metadata paling fundamental.

Ia mencakup:

```text
size()
creationTime()
lastModifiedTime()
lastAccessTime()
isRegularFile()
isDirectory()
isSymbolicLink()
isOther()
fileKey()
```

Contoh:

```java
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.*;

public class BasicMetadataExample {
    public static void main(String[] args) throws IOException {
        Path path = Path.of("data/report.txt"); // Java 11+

        BasicFileAttributes attrs = Files.readAttributes(
            path,
            BasicFileAttributes.class,
            LinkOption.NOFOLLOW_LINKS
        );

        System.out.println("size=" + attrs.size());
        System.out.println("regular=" + attrs.isRegularFile());
        System.out.println("directory=" + attrs.isDirectory());
        System.out.println("symlink=" + attrs.isSymbolicLink());
        System.out.println("other=" + attrs.isOther());
        System.out.println("modified=" + attrs.lastModifiedTime());
        System.out.println("accessed=" + attrs.lastAccessTime());
        System.out.println("created=" + attrs.creationTime());
        System.out.println("fileKey=" + attrs.fileKey());
    }
}
```

Java 8 version:

```java
Path path = Paths.get("data/report.txt");
```

Semua sisanya sama.

---

## 5. Mengapa `readAttributes` Lebih Baik daripada Banyak Call Terpisah

Buruk:

```java
boolean regular = Files.isRegularFile(path);
boolean directory = Files.isDirectory(path);
long size = Files.size(path);
FileTime modified = Files.getLastModifiedTime(path);
```

Masalah:

1. Banyak syscall / provider call.
2. Lebih lambat untuk traversal skala besar.
3. Rentan melihat snapshot metadata berbeda jika file berubah di tengah.
4. Error handling tercerai-berai.

Lebih baik:

```java
BasicFileAttributes attrs = Files.readAttributes(
    path,
    BasicFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);

boolean regular = attrs.isRegularFile();
long size = attrs.size();
FileTime modified = attrs.lastModifiedTime();
```

Ini bukan berarti snapshot-nya sempurna dan immutable terhadap seluruh race condition, tapi jauh lebih baik sebagai satu operasi metadata retrieval.

Rule:

```text
Kalau butuh lebih dari satu metadata field, gunakan readAttributes.
```

---

## 6. File Type Attributes: Regular, Directory, Symlink, Other

`BasicFileAttributes` membedakan beberapa tipe:

```java
attrs.isRegularFile();
attrs.isDirectory();
attrs.isSymbolicLink();
attrs.isOther();
```

### 6.1 Regular File

File biasa yang berisi byte sequence.

Contoh:

```text
report.pdf
config.yaml
audit.log
```

Namun hati-hati:

- regular file bisa berubah setelah dicek
- regular file bisa diganti symlink oleh proses lain jika directory tidak aman
- regular file bisa punya size 0 tapi masih valid
- regular file bisa sparse, sehingga logical size berbeda dari disk usage aktual

### 6.2 Directory

Directory adalah struktur yang memetakan name ke filesystem entries.

Directory bukan “file biasa berisi daftar string” dalam abstraction Java. Perlakukan sebagai node tree dengan semantics khusus.

### 6.3 Symbolic Link

Jika membaca attributes dengan default behavior, banyak operasi mengikuti symlink ke target.

Untuk membaca metadata link itu sendiri:

```java
BasicFileAttributes attrs = Files.readAttributes(
    link,
    BasicFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);
```

### 6.4 Other

`isOther()` bisa berarti:

- device file
- socket
- FIFO
- platform-specific special file
- provider-specific object

Production rule:

```text
Jika workflow hanya menerima regular file, reject isOther().
```

Jangan diam-diam memproses special file.

---

## 7. Size Metadata: Sederhana tapi Banyak Jebakan

```java
long size = attrs.size();
```

Untuk regular file, ini biasanya logical byte length.

Namun size bukan selalu “disk usage”.

Contoh jebakan:

### 7.1 Sparse File

Sparse file bisa memiliki logical size besar tetapi block yang benar-benar dialokasikan kecil.

```text
logical size: 100 GB
disk blocks used: 10 MB
```

Java standard `BasicFileAttributes.size()` tidak memberikan allocated block count secara portable.

### 7.2 Directory Size

Directory size tidak portable sebagai “total isi directory”. Pada sebagian filesystem, size directory adalah ukuran internal directory entry structure.

Jangan gunakan:

```java
Files.size(directory)
```

untuk mengukur total ukuran tree.

Gunakan traversal:

```java
long total = 0;
try (Stream<Path> stream = Files.walk(root)) {
    total = stream
        .filter(p -> Files.isRegularFile(p, LinkOption.NOFOLLOW_LINKS))
        .mapToLong(p -> {
            try {
                return Files.size(p);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        })
        .sum();
}
```

Untuk production, lebih baik pakai `FileVisitor` agar error handling lebih eksplisit.

### 7.3 File Bisa Berubah Setelah Size Dibaca

```java
long expected = Files.size(path);
try (InputStream in = Files.newInputStream(path)) {
    // file mungkin sudah berubah
}
```

Size metadata bukan lock. Jika butuh consistency, gunakan workflow claim/rename/lock/snapshot sesuai kebutuhan.

---

## 8. Timestamps: Modified, Accessed, Created

`BasicFileAttributes` menyediakan:

```java
attrs.lastModifiedTime();
attrs.lastAccessTime();
attrs.creationTime();
```

Tipe return-nya `FileTime`.

```java
FileTime modified = attrs.lastModifiedTime();
Instant instant = modified.toInstant();
```

### 8.1 Last Modified Time

Biasanya waktu content atau metadata tertentu terakhir berubah, tergantung filesystem/platform.

Dipakai untuk:

- cache invalidation sederhana
- incremental scan
- sync tool
- diagnostic

Tidak cocok sebagai satu-satunya bukti integritas.

Kenapa?

- resolusi timestamp bisa kasar
- clock bisa berubah
- timestamp bisa diset manual
- copy/move bisa preserve atau tidak preserve timestamp
- network filesystem bisa punya behavior berbeda

### 8.2 Last Access Time

Sering tidak reliable untuk logic aplikasi.

Alasan:

- banyak filesystem mematikan/menunda update access time demi performa
- mount option seperti `noatime`/`relatime` dapat mengubah behavior
- membaca file bisa atau tidak bisa memperbarui access time

Rule:

```text
Jangan desain business workflow yang bergantung pada lastAccessTime akurat.
```

### 8.3 Creation Time

`creationTime()` bukan selalu “birth time” nyata.

Pada beberapa platform/filesystem:

- creation time didukung
- tidak didukung dan diisi implementation-specific value
- bisa berubah saat copy
- bisa tidak preserve saat move antar filesystem

Rule:

```text
creationTime cocok untuk metadata informasional, bukan invariant correctness universal.
```

### 8.4 Setting Timestamp

```java
FileTime now = FileTime.from(Instant.now());
Files.setLastModifiedTime(path, now);
```

Atau via view:

```java
BasicFileAttributeView view = Files.getFileAttributeView(
    path,
    BasicFileAttributeView.class,
    LinkOption.NOFOLLOW_LINKS
);

view.setTimes(
    FileTime.from(Instant.now()), // lastModifiedTime
    null,                         // lastAccessTime unchanged
    null                          // creationTime unchanged
);
```

`null` berarti tidak mengubah field tersebut.

---

## 9. `fileKey()`: Identity Hint, Bukan Contract Universal

`fileKey()` mengembalikan object yang dapat mengidentifikasi file secara unik, atau `null` jika tidak tersedia.

```java
Object key = attrs.fileKey();
```

Pada Unix, ini sering merepresentasikan kombinasi seperti device + inode, tetapi Java tidak menjamin bentuknya.

Gunakan untuk:

- cycle detection saat traversal dengan symlink
- diagnostic
- best-effort identity tracking

Jangan gunakan untuk:

- persisted database key jangka panjang tanpa fallback
- security boundary mutlak
- cross-machine identity
- cross-provider identity

Contoh diagnostic:

```java
BasicFileAttributes attrs = Files.readAttributes(path, BasicFileAttributes.class);
System.out.printf("path=%s key=%s size=%d%n", path, attrs.fileKey(), attrs.size());
```

Jika butuh identity lebih kuat untuk content, gunakan content hash. Jika butuh identity workflow, gunakan application-level ID.

---

## 10. Link Following: Metadata Target vs Metadata Link

Ini sangat penting.

Default banyak operasi metadata mengikuti symlink.

```java
BasicFileAttributes targetAttrs = Files.readAttributes(
    link,
    BasicFileAttributes.class
);
```

Untuk metadata link itu sendiri:

```java
BasicFileAttributes linkAttrs = Files.readAttributes(
    link,
    BasicFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);
```

Perbedaan:

```text
link -> /safe/data/report.txt

readAttributes(link)
  -> attributes /safe/data/report.txt

readAttributes(link, NOFOLLOW_LINKS)
  -> attributes link object itu sendiri
```

Security rule:

```text
Untuk validasi path dari input user, gunakan NOFOLLOW_LINKS pada fase inspeksi.
```

Tapi ingat dari Part 12–13:

> NOFOLLOW_LINKS saat cek metadata tidak otomatis mencegah race ketika kemudian membuka file.

Validasi metadata dan operasi file harus didesain sebagai workflow, bukan check terpisah yang dianggap final.

---

## 11. BasicFileAttributeView: Read + Update Timestamp

`BasicFileAttributeView` adalah view type-safe untuk basic attributes.

```java
BasicFileAttributeView view = Files.getFileAttributeView(
    path,
    BasicFileAttributeView.class,
    LinkOption.NOFOLLOW_LINKS
);

BasicFileAttributes attrs = view.readAttributes();
view.setTimes(
    FileTime.from(Instant.now()),
    null,
    null
);
```

Kapan pakai view dibanding `Files.readAttributes`?

```text
Sekali baca saja             -> Files.readAttributes
Baca + update timestamp       -> BasicFileAttributeView
Generic view-based abstraction -> getFileAttributeView
```

---

## 12. POSIX Attributes: Owner, Group, Permissions

`PosixFileAttributes` menambah:

```java
UserPrincipal owner();
GroupPrincipal group();
Set<PosixFilePermission> permissions();
```

Contoh:

```java
PosixFileAttributes attrs = Files.readAttributes(
    path,
    PosixFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);

System.out.println("owner=" + attrs.owner().getName());
System.out.println("group=" + attrs.group().getName());
System.out.println("perms=" + PosixFilePermissions.toString(attrs.permissions()));
```

Output contoh:

```text
owner=appuser
group=appgroup
perms=rw-r-----
```

### 12.1 POSIX Permission Enum

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

Contoh set permission:

```java
Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rw-r-----");
Files.setPosixFilePermissions(path, perms);
```

### 12.2 Permission Saat Create

Lebih aman set permission saat create daripada create longgar lalu chmod.

```java
Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rw-------");
FileAttribute<Set<PosixFilePermission>> attr = PosixFilePermissions.asFileAttribute(perms);

Path file = Files.createFile(path, attr);
```

Kenapa?

```text
create file world-readable
  -> chmod private
```

membuka window race singkat di mana file bisa terbaca oleh pihak lain.

Namun ingat: umask/platform/provider bisa mempengaruhi hasil aktual.

### 12.3 POSIX Tidak Sama Dengan Security Universal

POSIX permission hanya satu model. Di Windows, ACL lebih dominan. Di container, UID/GID mapping dapat membuat permission terlihat “aneh”. Di network filesystem, permission enforcement bisa dipengaruhi server.

Rule:

```text
POSIX permission adalah capability, bukan portability guarantee.
```

---

## 13. Owner Attribute: Owner Tanpa Group

Jika hanya butuh owner, gunakan `FileOwnerAttributeView`.

```java
FileOwnerAttributeView ownerView = Files.getFileAttributeView(
    path,
    FileOwnerAttributeView.class,
    LinkOption.NOFOLLOW_LINKS
);

if (ownerView != null) {
    UserPrincipal owner = ownerView.getOwner();
    System.out.println(owner.getName());
}
```

Mengubah owner:

```java
UserPrincipalLookupService lookup = path.getFileSystem().getUserPrincipalLookupService();
UserPrincipal user = lookup.lookupPrincipalByName("appuser");

Files.setOwner(path, user);
```

Atau:

```java
ownerView.setOwner(user);
```

Caveat:

- butuh permission OS
- user principal lookup bisa gagal
- nama user format berbeda antar OS/domain
- container mungkin tidak punya user database lengkap
- Windows domain identity berbeda dengan Unix username

Rule:

```text
Jangan hardcode owner name tanpa environment contract.
```

---

## 14. DOS Attributes: Readonly, Hidden, Archive, System

`DosFileAttributes` menyediakan flag legacy DOS-style:

```java
isReadOnly()
isHidden()
isArchive()
isSystem()
```

Contoh:

```java
DosFileAttributes attrs = Files.readAttributes(
    path,
    DosFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);

System.out.println("readonly=" + attrs.isReadOnly());
System.out.println("hidden=" + attrs.isHidden());
System.out.println("archive=" + attrs.isArchive());
System.out.println("system=" + attrs.isSystem());
```

Mengubah flag:

```java
DosFileAttributeView view = Files.getFileAttributeView(
    path,
    DosFileAttributeView.class,
    LinkOption.NOFOLLOW_LINKS
);

if (view != null) {
    view.setHidden(true);
    view.setReadOnly(true);
}
```

Atau dynamic:

```java
Files.setAttribute(path, "dos:hidden", true, LinkOption.NOFOLLOW_LINKS);
Files.setAttribute(path, "dos:readonly", true, LinkOption.NOFOLLOW_LINKS);
```

### 14.1 Hidden File: Windows vs Unix

Di Windows, hidden adalah metadata flag.

Di Unix-like systems, file umumnya dianggap hidden jika namanya diawali dot:

```text
.env
.gitignore
.config
```

`Files.isHidden(path)` mencoba memakai platform convention.

Tapi jangan samakan:

```text
DOS hidden flag == Unix dotfile
```

Untuk aplikasi portable, definisikan sendiri semantics “hidden” jika itu bagian domain.

---

## 15. ACL Attributes: Access Control List

`AclFileAttributeView` merepresentasikan ACL berbasis model NFSv4-style di Java API.

ACL adalah ordered list of entries:

```text
ACL
  ├── ACE 1: principal=A, type=ALLOW, permissions=[READ_DATA, ...]
  ├── ACE 2: principal=B, type=DENY,  permissions=[WRITE_DATA, ...]
  └── ACE 3: principal=C, type=ALLOW, permissions=[READ_ATTRIBUTES, ...]
```

Contoh membaca ACL:

```java
AclFileAttributeView view = Files.getFileAttributeView(
    path,
    AclFileAttributeView.class,
    LinkOption.NOFOLLOW_LINKS
);

if (view != null) {
    List<AclEntry> acl = view.getAcl();
    for (AclEntry entry : acl) {
        System.out.println(entry.type() + " " + entry.principal() + " " + entry.permissions());
    }
}
```

### 15.1 Membuat ACL Entry

```java
UserPrincipalLookupService lookup = path.getFileSystem().getUserPrincipalLookupService();
UserPrincipal user = lookup.lookupPrincipalByName("appuser");

AclEntry entry = AclEntry.newBuilder()
    .setType(AclEntryType.ALLOW)
    .setPrincipal(user)
    .setPermissions(
        AclEntryPermission.READ_DATA,
        AclEntryPermission.READ_ATTRIBUTES,
        AclEntryPermission.READ_ACL
    )
    .build();
```

Menulis ACL:

```java
List<AclEntry> acl = new ArrayList<>(view.getAcl());
acl.add(0, entry); // order matters
view.setAcl(acl);
```

### 15.2 ACL Order Matters

ACL bukan sekadar set. Urutan entry bisa mempengaruhi evaluasi access.

Jika kamu sembarang append/insert, hasil effective permission bisa berbeda.

Rule:

```text
Jangan menulis ACL tanpa memahami platform policy dan ordering.
```

### 15.3 ACL Mapping Tidak Universal

Java API memakai model ACL tertentu, tapi filesystem nyata bisa memiliki model berbeda. Mapping bisa implementation-dependent.

Contoh:

- Windows NTFS ACL
- NFSv4 ACL
- POSIX mode bits
- SMB server ACL mapping
- enterprise domain principal

Karena itu, ACL code sebaiknya sangat eksplisit dan environment-specific.

---

## 16. User-Defined Attributes: Extended Metadata

`UserDefinedFileAttributeView` memberi akses ke metadata custom yang melekat pada file.

Contoh use case:

- MIME type cache
- ingestion id
- checksum side metadata
- origin marker
- classification label

Namun ini tidak selalu didukung.

Cek support:

```java
FileStore store = Files.getFileStore(path);
if (store.supportsFileAttributeView(UserDefinedFileAttributeView.class)) {
    // may use xattrs-like metadata
}
```

Menulis user attribute:

```java
UserDefinedFileAttributeView view = Files.getFileAttributeView(
    path,
    UserDefinedFileAttributeView.class,
    LinkOption.NOFOLLOW_LINKS
);

if (view != null) {
    ByteBuffer value = StandardCharsets.UTF_8.encode("case-12345");
    view.write("app.ingestionId", value);
}
```

Membaca:

```java
int size = view.size("app.ingestionId");
ByteBuffer buf = ByteBuffer.allocate(size);
view.read("app.ingestionId", buf);
buf.flip();
String ingestionId = StandardCharsets.UTF_8.decode(buf).toString();
```

Caveat:

- tidak portable
- bisa hilang saat copy ke filesystem lain
- bisa tidak ikut saat archive/export
- bisa dibatasi size
- bisa disabled oleh mount option
- backup tool belum tentu preserve

Rule:

```text
Extended attribute boleh untuk optimization/annotation, jangan jadikan satu-satunya source of truth domain-critical.
```

Untuk metadata penting, biasanya lebih aman punya sidecar file atau database record.

---

## 17. Attribute Names: Dynamic Access Syntax

Dynamic attribute syntax:

```text
view-name:attribute-name
```

Contoh:

```java
Object size = Files.getAttribute(path, "basic:size");
Object owner = Files.getAttribute(path, "owner:owner");
Object hidden = Files.getAttribute(path, "dos:hidden");
```

Membaca beberapa attribute:

```java
Map<String, Object> attrs = Files.readAttributes(
    path,
    "basic:size,lastModifiedTime,isRegularFile",
    LinkOption.NOFOLLOW_LINKS
);

System.out.println(attrs.get("size"));
System.out.println(attrs.get("lastModifiedTime"));
System.out.println(attrs.get("isRegularFile"));
```

Membaca semua basic:

```java
Map<String, Object> attrs = Files.readAttributes(path, "basic:*", LinkOption.NOFOLLOW_LINKS);
```

Dynamic access cocok untuk diagnostic CLI:

```java
static void printAttributes(Path path) throws IOException {
    Map<String, Object> attrs = Files.readAttributes(path, "basic:*", LinkOption.NOFOLLOW_LINKS);
    attrs.forEach((k, v) -> System.out.println(k + "=" + v));
}
```

Untuk application core, type-safe API tetap lebih disarankan.

---

## 18. Metadata Saat Create: Atomic Attribute Set

Beberapa create method menerima `FileAttribute<?>... attrs`.

Contoh:

```java
Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rw-------");
FileAttribute<Set<PosixFilePermission>> attr = PosixFilePermissions.asFileAttribute(perms);

Files.createFile(path, attr);
```

Ini penting karena attribute diterapkan saat object dibuat, bukan setelahnya.

Secure file creation:

```java
static Path createPrivateFile(Path path) throws IOException {
    FileStore store = Files.getFileStore(path.getParent());

    if (store.supportsFileAttributeView(PosixFileAttributeView.class)) {
        FileAttribute<Set<PosixFilePermission>> privatePerms =
            PosixFilePermissions.asFileAttribute(
                PosixFilePermissions.fromString("rw-------")
            );
        return Files.createFile(path, privatePerms);
    }

    // Fallback for non-POSIX filesystems.
    // Must rely on directory security / ACL / OS policy.
    return Files.createFile(path);
}
```

Jangan menulis fallback yang pura-pura aman.

Lebih jujur:

```text
If POSIX is unsupported, this method cannot enforce POSIX private permissions.
The caller must ensure the parent directory / volume policy is secure.
```

---

## 19. Metadata Preservation Saat Copy/Move

Dari Part 08:

```java
Files.copy(source, target, StandardCopyOption.COPY_ATTRIBUTES);
```

Namun `COPY_ATTRIBUTES` bukan magic universal.

Pertanyaan yang harus ditanyakan:

```text
Attribute mana yang bisa dipreserve?
Apakah source dan target filesystem support view yang sama?
Apakah owner bisa diset oleh process ini?
Apakah creationTime bisa diset?
Apakah ACL mapping compatible?
Apakah xattr/user attributes ikut?
Apakah symlink metadata atau target metadata yang dicopy?
```

Safe copy metadata strategy:

1. Copy content.
2. Preserve basic timestamps best-effort.
3. Preserve POSIX permission hanya jika target support POSIX.
4. Preserve owner hanya jika policy mengizinkan.
5. Preserve ACL hanya untuk environment yang sama dan sudah diuji.
6. Log metadata preservation failures secara eksplisit.
7. Jangan gagal total kecuali metadata itu requirement domain.

Contoh:

```java
static void copyWithBestEffortMetadata(Path src, Path dst) throws IOException {
    Files.copy(src, dst, StandardCopyOption.REPLACE_EXISTING);

    BasicFileAttributes srcBasic = Files.readAttributes(
        src,
        BasicFileAttributes.class,
        LinkOption.NOFOLLOW_LINKS
    );

    try {
        Files.setLastModifiedTime(dst, srcBasic.lastModifiedTime());
    } catch (IOException e) {
        // log warning, depending on requirement
    }

    FileStore dstStore = Files.getFileStore(dst);
    if (dstStore.supportsFileAttributeView(PosixFileAttributeView.class)) {
        try {
            Set<PosixFilePermission> perms = Files.getPosixFilePermissions(src, LinkOption.NOFOLLOW_LINKS);
            Files.setPosixFilePermissions(dst, perms);
        } catch (UnsupportedOperationException | IOException e) {
            // log warning
        }
    }
}
```

---

## 20. Attribute Checks Are Race-Prone

Contoh anti-pattern:

```java
BasicFileAttributes attrs = Files.readAttributes(path, BasicFileAttributes.class);

if (attrs.isRegularFile() && attrs.size() < maxSize) {
    byte[] bytes = Files.readAllBytes(path);
}
```

Masalah:

```text
T1: check regular file and size
T2: attacker/process replaces path with different file
T1: reads different file
```

Metadata check bukan lock.

Lebih baik:

- claim file dengan atomic rename ke staging directory yang controlled
- gunakan safe parent directory permission
- gunakan `NOFOLLOW_LINKS` saat inspeksi
- buka file secara hati-hati
- re-check setelah open jika perlu
- gunakan content hash/length validation setelah baca
- jangan pakai path input user langsung

Pattern ingestion aman:

```text
incoming/user-visible dir
  -> validate filename string
  -> resolve under controlled root
  -> inspect with NOFOLLOW_LINKS
  -> atomic move to private staging dir
  -> process only from staging dir
  -> compute hash and size from actual bytes read
  -> publish result
```

---

## 21. Attribute and Permission in Containers

Container membuat metadata semakin tricky.

### 21.1 UID/GID Mapping

Di Linux container, filesystem permission memakai numeric UID/GID.

Masalah umum:

```text
host file owner = uid 1000
container process runs as uid 10001
mounted volume not writable
```

Java melihat:

```java
PosixFileAttributes attrs = Files.readAttributes(path, PosixFileAttributes.class);
System.out.println(attrs.owner().getName());
```

Tapi `owner().getName()` bisa:

- username jika resolvable
- numeric-like string
- gagal lookup pada operasi tertentu

### 21.2 ConfigMap / Secret Volumes

Di Kubernetes, ConfigMap/Secret mounted sebagai file punya behavior khusus:

- sering read-only
- update dilakukan lewat symlink/atomic directory switch implementation detail
- watcher behavior bisa tidak seperti file biasa
- permission mode bisa dikontrol tapi terbatas

Jangan menganggap bisa chmod/chown file ConfigMap dari aplikasi.

### 21.3 Read-Only Root Filesystem

Jika container root filesystem read-only, aplikasi hanya bisa menulis ke volume tertentu seperti:

```text
/tmp
/app/data
mounted PVC
emptyDir
```

Metadata write seperti `setLastModifiedTime`, `setOwner`, `setPosixFilePermissions` bisa gagal.

Rule:

```text
Aplikasi production harus punya explicit writable directory contract.
```

---

## 22. Attribute and Network Filesystems

Network filesystem dapat mengganggu asumsi metadata.

Contoh risiko:

```text
NFS attribute caching
SMB ACL mapping
EFS latency and throughput behavior
clock skew between clients
server-side permission policy
client-side stale metadata
```

Implication:

- `lastModifiedTime` bisa stale
- `supportsFileAttributeView` bisa tidak cukup akurat untuk semua path
- lock/permission behavior bisa berbeda antar client
- owner/group mapping bisa berbeda
- ACL write bisa gagal tergantung server policy

Rule:

```text
Untuk correctness distributed, jangan hanya mengandalkan metadata filesystem.
Gunakan application-level coordination jika konsekuensi salahnya besar.
```

---

## 23. Portable Attribute Strategy

Aplikasi portable harus punya layered strategy:

```text
Layer 1: Basic metadata
  wajib ada, tapi optional fields bisa implementation-specific

Layer 2: Capability detection
  cek POSIX/DOS/ACL/User attrs sebelum pakai

Layer 3: Policy abstraction
  define FileSecurityPolicy sendiri

Layer 4: Environment contract
  deployment memastikan directory owner/permission/ACL benar

Layer 5: Runtime verification
  fail fast jika mandatory metadata capability tidak ada
```

Contoh abstraction:

```java
interface FileSecurityPolicy {
    void applyPrivateFilePolicy(Path path) throws IOException;
    void verifyReadableByProcessOnly(Path path) throws IOException;
}
```

Implementasi POSIX:

```java
final class PosixPrivateFilePolicy implements FileSecurityPolicy {
    @Override
    public void applyPrivateFilePolicy(Path path) throws IOException {
        Files.setPosixFilePermissions(
            path,
            PosixFilePermissions.fromString("rw-------")
        );
    }

    @Override
    public void verifyReadableByProcessOnly(Path path) throws IOException {
        Set<PosixFilePermission> perms = Files.getPosixFilePermissions(path, LinkOption.NOFOLLOW_LINKS);
        Set<PosixFilePermission> expected = PosixFilePermissions.fromString("rw-------");
        if (!perms.equals(expected)) {
            throw new IOException("Unexpected file permissions: " + PosixFilePermissions.toString(perms));
        }
    }
}
```

Fallback non-POSIX:

```java
final class DirectoryControlledPolicy implements FileSecurityPolicy {
    @Override
    public void applyPrivateFilePolicy(Path path) throws IOException {
        // No-op: security is enforced by parent directory / OS ACL / deployment policy.
    }

    @Override
    public void verifyReadableByProcessOnly(Path path) throws IOException {
        // Cannot verify using POSIX permissions.
        // Fail if the application requires strict POSIX-like privacy.
        throw new UnsupportedOperationException("POSIX permission verification is not supported");
    }
}
```

This is better than pretending all platforms behave the same.

---

## 24. Common Exceptions and Their Meaning

### 24.1 `UnsupportedOperationException`

Biasanya berarti operation/view tidak supported oleh provider.

Contoh:

```java
Files.getPosixFilePermissions(path);
```

pada filesystem non-POSIX.

### 24.2 `AccessDeniedException`

Process tidak punya permission untuk membaca/mengubah metadata.

Bisa terjadi pada:

- read attributes
- set owner
- set permission
- set ACL
- read directory metadata

### 24.3 `NoSuchFileException`

Path tidak ada saat operation dilakukan.

Bisa terjadi meskipun sebelumnya `exists(path)` true.

### 24.4 `FileSystemLoopException`

Traversal mendeteksi cycle, biasanya saat follow symlinks.

### 24.5 `IOException`

General I/O failure:

- network issue
- stale handle
- disk error
- provider error
- permission issue yang tidak disubclass spesifik

Rule:

```text
Attribute operation harus dianggap I/O operation yang bisa gagal kapan saja.
```

---

## 25. Production Diagnostic Utility: Print Supported Views and Basic Metadata

Java 11+:

```java
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.*;
import java.util.Map;

public final class FileMetadataProbe {
    public static void main(String[] args) throws Exception {
        Path path = Path.of(args.length == 0 ? "." : args[0]);
        probe(path);
    }

    static void probe(Path path) throws IOException {
        System.out.println("path=" + path);
        System.out.println("absolute=" + path.toAbsolutePath());
        System.out.println("filesystem views=" + path.getFileSystem().supportedFileAttributeViews());

        FileStore store = Files.getFileStore(path);
        System.out.println("store name=" + store.name());
        System.out.println("store type=" + store.type());
        System.out.println("readonly=" + store.isReadOnly());
        System.out.println("supports basic=" + store.supportsFileAttributeView(BasicFileAttributeView.class));
        System.out.println("supports posix=" + store.supportsFileAttributeView(PosixFileAttributeView.class));
        System.out.println("supports dos=" + store.supportsFileAttributeView(DosFileAttributeView.class));
        System.out.println("supports acl=" + store.supportsFileAttributeView(AclFileAttributeView.class));
        System.out.println("supports user=" + store.supportsFileAttributeView(UserDefinedFileAttributeView.class));

        BasicFileAttributes basic = Files.readAttributes(
            path,
            BasicFileAttributes.class,
            LinkOption.NOFOLLOW_LINKS
        );

        System.out.println("isRegularFile=" + basic.isRegularFile());
        System.out.println("isDirectory=" + basic.isDirectory());
        System.out.println("isSymbolicLink=" + basic.isSymbolicLink());
        System.out.println("isOther=" + basic.isOther());
        System.out.println("size=" + basic.size());
        System.out.println("lastModifiedTime=" + basic.lastModifiedTime());
        System.out.println("lastAccessTime=" + basic.lastAccessTime());
        System.out.println("creationTime=" + basic.creationTime());
        System.out.println("fileKey=" + basic.fileKey());

        Map<String, Object> dynamic = Files.readAttributes(
            path,
            "basic:*",
            LinkOption.NOFOLLOW_LINKS
        );
        System.out.println("dynamic basic=" + dynamic);
    }
}
```

Java 8 adjustment:

```java
Path path = Paths.get(args.length == 0 ? "." : args[0]);
```

---

## 26. Production Pattern: Metadata Snapshot for Intake File

Saat menerima file untuk processing, kamu sering butuh metadata snapshot:

```java
record FileSnapshot(
    Path path,
    boolean regularFile,
    boolean symbolicLink,
    long size,
    FileTime lastModifiedTime,
    Object fileKey
) {}
```

Untuk Java 8, gunakan class biasa.

Java 16+ record version:

```java
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.*;

public record FileSnapshot(
    Path path,
    boolean regularFile,
    boolean symbolicLink,
    long size,
    FileTime lastModifiedTime,
    Object fileKey
) {
    public static FileSnapshot capture(Path path) throws IOException {
        BasicFileAttributes attrs = Files.readAttributes(
            path,
            BasicFileAttributes.class,
            LinkOption.NOFOLLOW_LINKS
        );

        return new FileSnapshot(
            path,
            attrs.isRegularFile(),
            attrs.isSymbolicLink(),
            attrs.size(),
            attrs.lastModifiedTime(),
            attrs.fileKey()
        );
    }
}
```

But important:

```text
Snapshot is evidence, not a lock.
```

Use it for:

- logging
- validation record
- change detection hint
- diagnostics

Do not use it alone to prove file cannot change.

---

## 27. Production Pattern: Attribute-Based Validation Result

Daripada langsung throw di setiap attribute mismatch, kadang lebih baik kumpulkan validation result.

```java
final class FileValidationResult {
    private final List<String> errors = new ArrayList<>();
    private final List<String> warnings = new ArrayList<>();

    void error(String message) {
        errors.add(message);
    }

    void warning(String message) {
        warnings.add(message);
    }

    boolean valid() {
        return errors.isEmpty();
    }

    List<String> errors() {
        return List.copyOf(errors);
    }

    List<String> warnings() {
        return List.copyOf(warnings);
    }
}
```

Java 8 compatible: return unmodifiable copy manually.

Validator:

```java
static FileValidationResult validateRegularReadableFile(Path path, long maxBytes) {
    FileValidationResult result = new FileValidationResult();

    try {
        BasicFileAttributes attrs = Files.readAttributes(
            path,
            BasicFileAttributes.class,
            LinkOption.NOFOLLOW_LINKS
        );

        if (attrs.isSymbolicLink()) {
            result.error("Symbolic link is not allowed");
        }

        if (!attrs.isRegularFile()) {
            result.error("Path is not a regular file");
        }

        if (attrs.size() > maxBytes) {
            result.error("File is too large: " + attrs.size());
        }

        if (!Files.isReadable(path)) {
            result.error("File is not readable by current process");
        }
    } catch (NoSuchFileException e) {
        result.error("File does not exist");
    } catch (AccessDeniedException e) {
        result.error("Access denied while reading metadata");
    } catch (IOException e) {
        result.error("I/O error while reading metadata: " + e.getMessage());
    }

    return result;
}
```

Note:

`Files.isReadable(path)` itself is still a check, not a guarantee that future open succeeds.

---

## 28. Design Decision Matrix

| Need | Preferred API | Caveat |
|---|---|---|
| Read size + type + time | `Files.readAttributes(path, BasicFileAttributes.class)` | Snapshot can be stale immediately |
| Avoid following symlink | Add `LinkOption.NOFOLLOW_LINKS` | Does not remove all race conditions |
| Read POSIX permission | `Files.getPosixFilePermissions` / `PosixFileAttributes` | Not supported everywhere |
| Set private POSIX permission at create | `Files.createFile(path, attr)` with `PosixFilePermissions.asFileAttribute` | umask/provider may affect behavior |
| Read owner only | `FileOwnerAttributeView` / `Files.getOwner` | Principal names differ by OS/domain |
| Read Windows-like flags | `DosFileAttributes` | DOS flags not universal semantics |
| Read/write ACL | `AclFileAttributeView` | Mapping/order/provider-specific |
| Store custom metadata | `UserDefinedFileAttributeView` | Not portable; may not be preserved |
| Generic tool | dynamic `Files.getAttribute/readAttributes` | Runtime type/typo risk |
| Production policy | abstraction + capability detection | Must define fallback honestly |

---

## 29. Anti-Patterns

### Anti-Pattern 1: Assuming POSIX Everywhere

```java
Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("rw-------"));
```

without capability check.

Better:

```java
if (Files.getFileStore(path).supportsFileAttributeView(PosixFileAttributeView.class)) {
    Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("rw-------"));
} else {
    // explicit fallback or fail
}
```

### Anti-Pattern 2: Treating Timestamp as Version

```java
if (Files.getLastModifiedTime(path).equals(previousModifiedTime)) {
    // file unchanged
}
```

Better:

```text
Use timestamp as cheap hint.
Use size/hash/version marker for stronger detection.
```

### Anti-Pattern 3: Metadata Check Then Unsafe Use

```java
if (Files.isRegularFile(path)) {
    process(path);
}
```

Better:

```text
claim -> inspect -> process from controlled location -> verify actual bytes
```

### Anti-Pattern 4: Ignoring Attribute Preservation Failure

```java
Files.copy(src, dst, COPY_ATTRIBUTES);
```

and assume everything preserved.

Better:

```text
Define which metadata matters, verify it, and log/fail explicitly if missing.
```

### Anti-Pattern 5: Hidden Means Same Everywhere

```java
if (Files.isHidden(path)) skip();
```

without understanding platform convention.

Better:

```text
Define application-specific hidden/excluded rules.
```

---

## 30. Java 8–25 Compatibility Notes

### Stable Since Java 7 / Available in Java 8

Most APIs in this part are available since Java 7 and therefore available in Java 8:

```text
Files.readAttributes
Files.getAttribute
Files.setAttribute
BasicFileAttributes
BasicFileAttributeView
PosixFileAttributes
PosixFileAttributeView
DosFileAttributes
DosFileAttributeView
FileOwnerAttributeView
AclFileAttributeView
UserDefinedFileAttributeView
FileStore.supportsFileAttributeView
LinkOption.NOFOLLOW_LINKS
```

### Java 11+ Convenience

Use:

```java
Path.of("...")
```

instead of:

```java
Paths.get("...")
```

But for Java 8 source compatibility, use `Paths.get`.

### Java 10+

`FileStore.getBlockSize()` exists since Java 10, but it is not central to this part and should be guarded if writing Java 8-compatible code.

### Java 16+

Records can simplify immutable metadata snapshot objects, but Java 8 requires normal classes.

---

## 31. Checklist: Reading Metadata Safely

Use this checklist when writing metadata-sensitive code:

```text
[ ] Do I need metadata of target or symlink object itself?
[ ] Should I use NOFOLLOW_LINKS?
[ ] Am I reading multiple fields? If yes, use readAttributes.
[ ] Is this metadata only a hint, or a correctness condition?
[ ] Could file be replaced after metadata read?
[ ] Is the filesystem local, network, container-mounted, or virtual?
[ ] Does the required attribute view exist?
[ ] What is the fallback if POSIX/DOS/ACL/user attrs are unsupported?
[ ] Do I need to preserve metadata across copy/move?
[ ] Do I verify preservation result?
[ ] Am I using timestamp as proof when I only have a hint?
[ ] Are owner/principal names environment-specific?
[ ] Do I log enough metadata for incident reconstruction?
```

---

## 32. Incident Thinking: Why Metadata Bugs Happen

### Case 1: Upload File Passes Validation but Processing Reads Different File

Root cause:

```text
metadata check and file open separated by race window
```

Fix:

```text
controlled staging directory + atomic move/claim + no symlink + validate actual bytes
```

### Case 2: App Works on Linux, Fails on Windows

Root cause:

```text
code assumes POSIX permissions
```

Fix:

```text
capability detection + environment-specific FileSecurityPolicy
```

### Case 3: Copy Tool Loses Audit Metadata

Root cause:

```text
COPY_ATTRIBUTES assumed to preserve all metadata across filesystems
```

Fix:

```text
explicit metadata preservation contract + verification report
```

### Case 4: Incremental Processor Misses Updates

Root cause:

```text
lastModifiedTime resolution/coalescing/stale network metadata
```

Fix:

```text
use size + mtime + hash/checkpoint, or producer manifest with monotonic sequence
```

### Case 5: Cleanup Job Deletes Symlink Target Accidentally

Root cause:

```text
traversal followed links or did not inspect link metadata
```

Fix:

```text
NOFOLLOW_LINKS + root containment + FileVisitor policy + safe delete guard
```

---

## 33. Summary Mental Model

File attributes adalah metadata yang melekat pada filesystem object, tetapi Java melihat metadata lewat provider-specific **attribute views**.

Core model:

```text
Path identifies potential object
Files.readAttributes retrieves metadata snapshot
AttributeView exposes capability-specific metadata
FileStore/FileSystem tells supported capabilities
LinkOption controls target-vs-link inspection
Metadata is evidence, not lock
Provider/platform/filesystem decide actual behavior
```

Yang harus melekat:

1. `basic` adalah baseline, tapi bahkan timestamp optional/implementation-specific bisa punya caveat.
2. POSIX, DOS, ACL, owner, dan user-defined attributes tidak universal.
3. `readAttributes` lebih baik daripada banyak metadata call terpisah.
4. `NOFOLLOW_LINKS` penting untuk security, tapi bukan silver bullet.
5. Metadata check tidak menghilangkan TOCTOU race.
6. Permission/owner/ACL harus diperlakukan sebagai environment contract.
7. Metadata preservation harus eksplisit, diverifikasi, dan punya fallback.
8. Untuk correctness penting, gunakan application-level invariants: hash, manifest, atomic move, database state, controlled directory.

---

## 34. Latihan

### Latihan 1 — Metadata Probe

Buat CLI Java yang menerima path dan mencetak:

```text
absolute path
file store name/type
supported attribute views
basic attributes
POSIX attributes if supported
DOS attributes if supported
owner if supported
user-defined attribute names if supported
```

Jalankan di:

```text
regular file
directory
symbolic link
temp file
mounted volume jika ada
```

Bandingkan hasilnya.

### Latihan 2 — Portable Private File Creation

Buat utility:

```java
Path createPrivateFile(Path path)
```

Requirement:

```text
If POSIX supported: create with rw------- atomically.
If POSIX unsupported: create file and return warning/capability result.
Do not silently claim strict privacy if platform cannot verify it.
```

### Latihan 3 — Metadata Preservation Report

Buat copy function:

```java
CopyReport copyWithMetadataReport(Path source, Path target)
```

Report harus mencatat:

```text
content copied
lastModifiedTime preserved or failed
POSIX permission preserved/skipped/failed
owner preserved/skipped/failed
ACL preserved/skipped/failed
user attrs preserved/skipped/failed
```

### Latihan 4 — Race Demonstration

Buat dua process/thread:

```text
Thread A: read attributes, sleep, read file
Thread B: replace file during sleep
```

Tunjukkan bahwa metadata check sebelumnya tidak menjamin file yang dibaca kemudian adalah file yang sama.

### Latihan 5 — Symlink Attribute Difference

Buat symlink lalu bandingkan:

```java
Files.readAttributes(link, BasicFileAttributes.class)
Files.readAttributes(link, BasicFileAttributes.class, NOFOLLOW_LINKS)
```

Catat perbedaan:

```text
isSymbolicLink
size
fileKey
lastModifiedTime
```

---

## 35. Bridge ke Part Berikutnya

Part ini membahas metadata dan capability. Part berikutnya akan masuk lebih dalam ke **permission model**:

```text
Part 15 — Permissions Model: POSIX, Windows ACL, Containers, and Runtime Identity
```

Di Part 15, fokusnya bukan hanya “cara set permission”, tetapi:

```text
runtime identity
UID/GID
umask
permission-at-create
Windows ACL mismatch
container mounted volume
Kubernetes securityContext
read-only filesystem
least privilege file layout
```

Dengan kata lain, Part 14 memberi kita **API dan metadata vocabulary**. Part 15 akan membangun **security and runtime permission mental model** di atasnya.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-io-file-filesystem-storage-engineering — Part 13](./learn-java-io-file-filesystem-storage-engineering-part-13-path-traversal-security.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: learn-java-io-file-filesystem-storage-engineering — Part 15](./learn-java-io-file-filesystem-storage-engineering-part-15-permissions-model.md)

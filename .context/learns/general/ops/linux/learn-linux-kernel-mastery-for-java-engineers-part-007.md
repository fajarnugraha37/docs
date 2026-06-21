# learn-linux-kernel-mastery-for-java-engineers-part-007.md

# Part 007 — Virtual Filesystems: VFS, inode, dentry, mount

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai bisa melakukan reasoning produksi, bukan sekadar menghafal command.  
> Fokus part ini: memahami bagaimana Linux merepresentasikan file, path, directory, mount, dan filesystem secara internal melalui VFS, inode, dentry, superblock, dan open file object.

---

## 0. Posisi Part Ini di Dalam Seri

Sampai part sebelumnya, kita sudah membangun fondasi:

1. Linux sebagai boundary antara aplikasi dan resource nyata.
2. Process sebagai unit runtime.
3. Thread/task sebagai unit scheduling.
4. System call sebagai kontrak resmi aplikasi ke kernel.
5. File descriptor sebagai handle universal ke kernel object.

Part ini melanjutkan pertanyaan natural berikutnya:

> Kalau file descriptor adalah handle, sebenarnya handle itu menunjuk ke apa?  
> Kalau Java membuka `/var/log/app/app.log`, kernel melihat apa?  
> Apakah path adalah file?  
> Apa bedanya filename, inode, dentry, file descriptor, dan open file?  
> Kenapa file yang sudah dihapus masih bisa menghabiskan disk?  
> Kenapa aplikasi di container melihat file yang berbeda dari host?  
> Kenapa rename bisa atomic, tetapi write biasa belum tentu durable?  

Jawaban atas pertanyaan ini ada di Virtual Filesystem layer, atau VFS.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus bisa:

1. Membedakan **path**, **filename**, **directory entry**, **inode**, **open file description**, dan **file descriptor**.
2. Menjelaskan kenapa Linux membutuhkan **VFS** sebagai layer abstraksi di atas banyak filesystem konkret.
3. Memahami object utama VFS:
   - `super_block`
   - `inode`
   - `dentry`
   - `file`
   - `vfsmount` / mount object secara konseptual
4. Menjelaskan flow path lookup dari string seperti `/var/log/app.log` menjadi kernel object.
5. Memahami hard link dan symbolic link dari sudut inode/dentry.
6. Memahami mount point, bind mount, pseudo filesystem, dan mount namespace.
7. Menghubungkan filesystem semantics ke Java service:
   - log file
   - upload file
   - config file
   - temporary file
   - lock file
   - deployment artifact
   - container volume
8. Mendiagnosis failure seperti:
   - deleted-but-open file
   - symlink confusion
   - permission mismatch
   - wrong mount point
   - file exists but Java cannot see it
   - file path changes but process still reads old FD
   - disk penuh karena open-but-unlinked file
9. Menggunakan command observability:
   - `stat`
   - `ls -li`
   - `find -inum`
   - `readlink`
   - `namei`
   - `mount`
   - `findmnt`
   - `df`
   - `du`
   - `lsof`
   - `/proc/<pid>/fd`
   - `/proc/<pid>/mountinfo`

---

## 2. Mental Model Besar: Path Bukan File

Banyak engineer secara tidak sadar berpikir seperti ini:

```text
/path/to/file.txt == file
```

Mental model ini berguna untuk pemakaian sehari-hari, tetapi salah untuk debugging produksi.

Model yang lebih akurat:

```text
path string
  -> path lookup
  -> directory entries / dentries
  -> inode
  -> filesystem-specific object/data
  -> maybe opened as a file object
  -> exposed to process as file descriptor
```

Dengan kata lain:

```text
"/var/log/app/app.log"
```

bukan file. Itu hanya **nama berbentuk string** yang harus diselesaikan kernel melalui directory tree dan mount tree untuk menemukan object yang dimaksud.

Satu file dapat punya banyak path.

Satu path dapat berubah menunjuk ke object lain.

Satu process dapat tetap memegang file lama walaupun path-nya sudah dihapus.

Satu container dapat melihat path yang sama tetapi object berbeda karena mount namespace berbeda.

Satu symbolic link dapat membuat path terlihat sederhana tetapi resolusinya menuju lokasi lain.

Inilah alasan debugging filesystem di Linux sering membingungkan kalau kita masih memakai mental model “path adalah file”.

---

## 3. Kenapa VFS Ada?

Linux mendukung banyak tipe filesystem:

- ext4
- XFS
- Btrfs
- tmpfs
- procfs
- sysfs
- devtmpfs
- overlayfs
- NFS
- FUSE
- cgroupfs
- squashfs
- ramfs
- iso9660
- dan banyak lagi.

Setiap filesystem punya cara internal berbeda untuk menyimpan metadata, block, directory, permission, journal, dan data.

Tetapi aplikasi user-space ingin API yang relatif sama:

```c
open("/tmp/a.txt", O_RDONLY)
read(fd, buf, len)
write(fd, buf, len)
close(fd)
stat("/tmp/a.txt", &st)
rename("a", "b")
unlink("b")
```

Java juga ingin abstraksi yang stabil:

```java
Files.readString(Path.of("/tmp/a.txt"));
Files.writeString(Path.of("/tmp/a.txt"), "hello");
Files.move(src, dst, StandardCopyOption.ATOMIC_MOVE);
```

VFS adalah layer kernel yang membuat berbagai filesystem terlihat melalui interface umum.

Secara konseptual:

```text
Java / JVM / libc / syscall
          |
          v
      VFS layer
          |
          +--> ext4 implementation
          +--> XFS implementation
          +--> tmpfs implementation
          +--> procfs implementation
          +--> overlayfs implementation
          +--> NFS client implementation
          +--> FUSE implementation
```

VFS bukan filesystem konkret. VFS adalah **abstraction layer**.

Ia menyediakan object model dan operation table sehingga kernel bisa mengatakan:

- “open file ini”
- “lookup nama ini di directory ini”
- “read dari inode ini”
- “write ke file ini”
- “rename entry ini”
- “unlink entry ini”

lalu filesystem konkret menjalankan detail implementasinya.

Dokumentasi kernel menyatakan bahwa VFS menyediakan abstraction layer yang memungkinkan user-space mengakses berbagai filesystem melalui system call yang sama. Kernel VFS melakukan path lookup sampai memperoleh dentry dan inode, lalu operasi seperti `open(2)` atau `stat(2)` dapat berjalan di atas object tersebut.

---

## 4. Object Utama VFS

VFS memiliki beberapa object konseptual yang wajib dipahami.

### 4.1 Superblock

Superblock merepresentasikan **instance filesystem yang sedang mounted**.

Contoh:

```text
/dev/nvme0n1p2 mounted at /
/dev/nvme0n1p3 mounted at /var
_tmpfs mounted at /run
proc mounted at /proc
```

Setiap mounted filesystem punya metadata global, misalnya:

- filesystem type
- block size
- root inode
- mount options
- operation table
- filesystem-private data

Mental model:

```text
superblock = metadata global untuk satu mounted filesystem instance
```

Jangan pikir superblock hanya “block di disk”. Di VFS, `struct super_block` adalah object kernel yang merepresentasikan mounted filesystem secara runtime.

Contoh implikasi:

- `/` dan `/var` bisa berada di filesystem berbeda.
- `rename` atomic biasanya dijamin dalam filesystem yang sama, tetapi bisa gagal cross-filesystem dengan `EXDEV`.
- `df /var` dan `df /tmp` bisa menunjukkan device/mount berbeda.
- Container overlayfs punya superblock/mount view yang berbeda dari host.

### 4.2 Inode

Inode merepresentasikan **file object** dalam filesystem.

Inode menyimpan metadata seperti:

- inode number
- file type
- permission mode
- owner UID/GID
- size
- timestamps
- link count
- block mapping atau filesystem-specific pointer
- operasi inode

Mental model:

```text
inode = identitas dan metadata file object, bukan nama file
```

Nama file tidak disimpan sebagai identitas utama di inode. Nama berada di directory entry.

Contoh:

```bash
ls -li file.txt
```

Output kira-kira:

```text
1234567 -rw-r--r-- 1 app app 12 Jun 21 10:00 file.txt
```

Angka `1234567` adalah inode number pada filesystem tersebut.

Penting:

```text
inode number hanya unik di dalam satu filesystem/superblock, bukan global seluruh mesin.
```

Jadi identitas file secara praktis adalah kombinasi:

```text
(device, inode)
```

Bukan hanya inode number.

### 4.3 Dentry

Dentry adalah singkatan dari directory entry.

Dentry merepresentasikan hubungan:

```text
directory + name -> inode
```

Contoh path:

```text
/var/log/app/app.log
```

Path ini terdiri dari komponen:

```text
/
var
log
app
app.log
```

Untuk menyelesaikan path tersebut, kernel melakukan lookup bertahap:

```text
root dentry
  -> lookup "var"
  -> lookup "log"
  -> lookup "app"
  -> lookup "app.log"
```

Setiap komponen path berhubungan dengan dentry.

Mental model:

```text
dentry = cached path component mapping to inode
```

Dentry sangat penting untuk performance. Kalau setiap `open("/var/log/app.log")` harus membaca directory dari disk, path lookup akan mahal. Kernel menyimpan dentry cache agar path lookup berikutnya cepat.

Ada juga negative dentry:

```text
name yang pernah dicari tetapi tidak ada
```

Ini mempercepat lookup file yang tidak ada, karena kernel bisa ingat bahwa nama tersebut tidak ditemukan, selama cache valid.

### 4.4 File Object

Dalam VFS, `struct file` merepresentasikan **open file description**.

Ini bukan file di disk. Ini adalah object runtime hasil `open()`.

Object ini menyimpan informasi seperti:

- current file offset
- open flags
- reference ke dentry/inode
- file operations
- private data

Mental model:

```text
file object = satu open instance terhadap object filesystem
```

Process melihatnya melalui file descriptor.

```text
process fd table
  fd 3 -> struct file -> dentry -> inode -> filesystem data
```

Relasi penting:

```text
file descriptor != file object != inode != path
```

Contoh:

```bash
exec 3< /tmp/a.txt
exec 4< /tmp/a.txt
```

FD 3 dan FD 4 bisa menunjuk ke open file object berbeda walaupun inode sama. Masing-masing punya offset sendiri.

Namun jika FD diduplikasi:

```bash
exec 3< /tmp/a.txt
exec 4<&3
```

FD 3 dan FD 4 menunjuk ke open file object yang sama. Offset dibagi.

### 4.5 Mount Object

Mount menghubungkan root dari sebuah filesystem ke titik tertentu dalam directory tree.

Contoh:

```text
/dev/nvme0n1p2 mounted at /
/dev/nvme0n1p3 mounted at /var
proc mounted at /proc
tmpfs mounted at /run
```

Path lookup bukan hanya berjalan di directory tree. Ia juga berjalan di **mount tree**.

Ketika lookup mencapai path yang merupakan mount point, kernel berpindah ke root filesystem yang mounted di sana.

Contoh:

```text
/
└── proc    <-- mount point
```

Saat membuka:

```bash
cat /proc/cpuinfo
```

kernel tidak membaca directory `/proc` dari ext4 root filesystem. Ia masuk ke procfs yang mounted di `/proc`.

Mental model:

```text
path lookup = directory traversal + mount traversal
```

---

## 5. Ringkasan Relasi Object

Diagram konseptual:

```text
User-space path string
    "/var/log/app/app.log"
              |
              v
        path lookup
              |
              v
         dentry chain
   / -> var -> log -> app -> app.log
              |
              v
            inode
              |
              v
     filesystem-specific data
              |
              v
          block/page/cache
```

Ketika file dibuka:

```text
process
  fd table
    3
    |
    v
  struct file                 <-- open file object
    |
    v
  dentry
    |
    v
  inode
    |
    v
  superblock / filesystem
```

Perbandingan:

| Konsep | Apa itu | Stabil setelah rename? | Stabil setelah unlink? | Terlihat di Java sebagai |
|---|---|---:|---:|---|
| Path | String lokasi/nama | Tidak | Tidak | `Path`, `File`, string |
| Dentry | Mapping nama dalam directory ke inode | Bisa berubah | Bisa hilang | Tidak langsung |
| Inode | Metadata/object file | Ya | Ya selama masih direferensikan | Tidak langsung, via `stat` |
| File object | Open instance | Ya | Ya selama FD terbuka | Stream/channel terbuka |
| FD | Integer handle di process | Ya | Ya selama belum close | FileInputStream/FileChannel/SocketChannel |
| Superblock | Mounted filesystem instance | Ya | Ya | Tidak langsung |
| Mount | Hubungan filesystem ke path tree | Bisa berubah | Bisa unmounted jika tidak busy | Path visibility |

---

## 6. Path Lookup: Dari String ke Inode

Ketika process memanggil:

```c
openat(AT_FDCWD, "/var/log/app/app.log", O_RDONLY)
```

atau Java memanggil:

```java
Files.newInputStream(Path.of("/var/log/app/app.log"));
```

kernel harus menyelesaikan path.

Secara konseptual:

```text
1. Tentukan starting point
   - absolute path: root directory process
   - relative path: current working directory atau dirfd pada openat

2. Pecah path menjadi komponen
   /var/log/app/app.log
   -> var
   -> log
   -> app
   -> app.log

3. Untuk setiap komponen:
   - cek dentry cache
   - jika tidak ada, panggil lookup filesystem konkret
   - validasi permission execute/search pada directory
   - handle symlink bila perlu
   - handle mount point bila masuk ke mount lain

4. Di komponen akhir:
   - lakukan operasi sesuai syscall
   - open/stat/unlink/rename/create/etc.
```

### 6.1 Absolute vs Relative Path

Absolute path:

```text
/var/log/app.log
```

dimulai dari root directory process.

Relative path:

```text
logs/app.log
```

dimulai dari current working directory process.

Penting:

```text
root directory process tidak selalu root host.
```

Di container, root `/` process bisa merupakan root filesystem container.

Di process yang memakai `chroot`, root directory bisa berbeda.

Di process dengan mount namespace berbeda, path yang sama bisa berarti object berbeda.

### 6.2 Search Permission pada Directory

Untuk mengakses:

```text
/var/log/app/app.log
```

process perlu permission “search” atau execute bit pada directory components:

```text
/
/var
/var/log
/var/log/app
```

Meskipun file `app.log` readable, kalau directory parent tidak searchable, akses bisa gagal.

Contoh:

```bash
chmod 600 /var/log/app
cat /var/log/app/app.log
```

Kemungkinan gagal:

```text
Permission denied
```

Karena directory perlu execute bit untuk traversal.

Ini sering menjelaskan kasus:

> File permission terlihat benar, tetapi aplikasi tetap `Permission denied`.

Yang harus dicek bukan hanya file, tetapi seluruh parent path.

Gunakan:

```bash
namei -l /var/log/app/app.log
```

### 6.3 Symlink Resolution

Symbolic link adalah file khusus yang isinya path target.

Contoh:

```bash
ln -s /opt/app/releases/v42/current /opt/app/current
```

Ketika membuka:

```text
/opt/app/current/config.yml
```

kernel mungkin harus resolve symlink `current` menuju target.

Symlink dapat berupa:

```text
absolute target: /opt/app/releases/v42
relative target: ../releases/v42
```

Symlink bukan inode target. Symlink punya inode sendiri, berisi path.

Implikasi:

- symlink dapat menunjuk ke target yang belum ada
- symlink dapat menjadi dangling
- permission symlink biasanya bukan permission target yang relevan
- race dapat terjadi jika program melakukan check path lalu open path terpisah

### 6.4 Mount Traversal

Misal:

```text
/var/lib/app/uploads
```

adalah mount point untuk volume lain.

Path lookup:

```text
/ -> var -> lib -> app -> uploads
```

saat mencapai `uploads`, kernel masuk ke filesystem mounted di situ.

Akibatnya:

```bash
df /var/lib/app/uploads
```

bisa berbeda dari:

```bash
df /var/lib/app
```

Ini penting untuk debugging disk full:

```text
Disk penuh di /var/lib/app/uploads tidak selalu berarti root filesystem penuh.
```

---

## 7. Inode: Identitas File yang Sering Diabaikan

### 7.1 Filename Bukan Identitas

Buat contoh:

```bash
mkdir -p /tmp/vfs-lab
cd /tmp/vfs-lab
printf 'hello\n' > a.txt
ls -li a.txt
```

Output:

```text
123456 -rw-r--r-- 1 user user 6 Jun 21 10:00 a.txt
```

Rename:

```bash
mv a.txt b.txt
ls -li b.txt
```

Output:

```text
123456 -rw-r--r-- 1 user user 6 Jun 21 10:00 b.txt
```

Inode sama, nama berubah.

Kesimpulan:

```text
rename mengubah directory entry, bukan mengganti inode file.
```

### 7.2 Hard Link

Hard link membuat nama lain untuk inode yang sama.

```bash
printf 'hello\n' > original.txt
ln original.txt alias.txt
ls -li original.txt alias.txt
```

Output:

```text
123456 -rw-r--r-- 2 user user 6 Jun 21 10:00 alias.txt
123456 -rw-r--r-- 2 user user 6 Jun 21 10:00 original.txt
```

Dua nama, satu inode.

Link count = 2.

Hapus satu nama:

```bash
rm original.txt
ls -li alias.txt
cat alias.txt
```

File tetap ada karena inode masih punya link count 1.

Mental model:

```text
unlink tidak selalu menghancurkan file data.
unlink menghapus satu directory entry.
Data dihapus ketika link count 0 dan tidak ada open reference.
```

### 7.3 Symbolic Link vs Hard Link

Hard link:

```text
name A -> same inode
name B -> same inode
```

Symlink:

```text
name A -> inode symlink -> path string target -> lookup lagi
```

Perbandingan:

| Aspek | Hard link | Symlink |
|---|---|---|
| Menunjuk ke | inode yang sama | path string |
| Bisa dangling | Tidak normalnya | Ya |
| Cross filesystem | Biasanya tidak | Ya |
| Link count target naik | Ya | Tidak |
| Punya inode sendiri | Tidak sebagai object target baru | Ya |
| Bisa ke directory | Umumnya tidak untuk user biasa | Ya |
| Resolusi perlu lookup tambahan | Tidak | Ya |

---

## 8. Deleted-but-Open File: Failure Klasik Produksi

Ini salah satu kasus Linux paling penting untuk backend engineer.

### 8.1 Eksperimen

Terminal 1:

```bash
mkdir -p /tmp/vfs-lab
cd /tmp/vfs-lab
printf 'line 1\n' > app.log
tail -f app.log
```

Terminal 2:

```bash
cd /tmp/vfs-lab
rm app.log
ls -l
```

File tidak terlihat lagi.

Tetapi `tail -f` di Terminal 1 masih memegang FD ke inode lama.

Lihat:

```bash
lsof | grep deleted
```

Atau:

```bash
ls -l /proc/$(pgrep -n tail)/fd
```

Mungkin terlihat:

```text
3 -> /tmp/vfs-lab/app.log (deleted)
```

### 8.2 Kenapa Bisa Begitu?

Karena `rm` melakukan `unlink`:

```text
hapus directory entry app.log
```

Tetapi kernel belum membebaskan inode/data selama masih ada open file object yang mereferensikannya.

Relasi:

```text
path removed
  but
process fd -> file object -> inode -> data still alive
```

### 8.3 Dampak Produksi

Kasus umum:

1. Java app menulis log ke `/var/log/app/app.log`.
2. Operator menghapus file log besar dengan `rm`.
3. `ls` menunjukkan file hilang.
4. `du /var/log/app` terlihat kecil.
5. Tetapi `df /var` masih penuh.
6. Penyebab: process masih memegang FD ke deleted inode.

Solusi:

- restart process
- kirim signal reload jika app/logging framework reopen file
- gunakan logrotate dengan mekanisme benar
- truncate file jika harus darurat:

```bash
: > /proc/<pid>/fd/<fd>
```

Hati-hati: truncating FD langsung harus dilakukan dengan pemahaman penuh.

### 8.4 `du` vs `df`

`du` menghitung file yang reachable dari directory tree.

`df` melihat pemakaian filesystem secara keseluruhan.

Deleted-but-open file:

```text
not reachable by path -> du tidak melihat
still allocated in filesystem -> df melihat
```

Jika:

```bash
df -h /var
```

besar, tetapi:

```bash
du -sh /var/*
```

kecil, curigai:

```bash
lsof +L1
```

atau:

```bash
lsof | grep deleted
```

---

## 9. Rename, Replace, dan Atomicity

### 9.1 Rename Mengubah Nama, Bukan Isi

```bash
mv new.conf app.conf
```

Jika dalam filesystem yang sama, rename biasanya atomic dari sisi namespace:

```text
observer melihat nama lama atau nama baru, bukan setengah nama
```

Ini dasar pola safe config update:

```bash
write app.conf.tmp
fsync app.conf.tmp
rename app.conf.tmp -> app.conf
fsync parent directory
```

Part durability detail akan dibahas di Part 008, tetapi part ini harus menegaskan:

```text
atomic visibility != durable after crash
```

Atomic rename membuat namespace update tampak utuh. Namun tanpa fsync yang benar, crash-consistency belum tentu sesuai ekspektasi.

### 9.2 Java Implication

Java:

```java
Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
```

Jika `tmp` dan `target` berada di filesystem berbeda, operasi bisa gagal karena atomic rename cross-filesystem tidak tersedia.

Error native biasanya terkait:

```text
EXDEV: Invalid cross-device link
```

Jangan asumsikan path yang “terlihat dekat” berada di filesystem sama.

Cek:

```bash
df -T /path/to/tmp /path/to/target
findmnt -T /path/to/tmp
findmnt -T /path/to/target
```

### 9.3 Deployment Symlink Pattern

Banyak deployment memakai:

```text
/opt/app/releases/2026-06-21-1000
/opt/app/releases/2026-06-21-1030
/opt/app/current -> /opt/app/releases/2026-06-21-1030
```

Switch release:

```bash
ln -sfn /opt/app/releases/2026-06-21-1030 /opt/app/current
```

Hati-hati:

- process yang sudah membuka file lama tetap memegang FD lama
- current working directory process bisa tetap berada di directory lama
- config reload harus membuka ulang path, bukan memakai FD lama
- symlink replacement perlu dilakukan dengan pola atomic yang benar

---

## 10. Mount: Directory Tree Tidak Sama Dengan Filesystem Tree

### 10.1 Apa itu Mount?

Mount membuat filesystem tersedia di path tertentu.

Contoh:

```bash
mount | head
findmnt /
findmnt /proc
findmnt /tmp
```

Contoh konseptual:

```text
root filesystem mounted at /
procfs mounted at /proc
tmpfs mounted at /run
xfs volume mounted at /var/lib/app
```

Path terlihat sebagai satu tree:

```text
/
├── bin
├── proc
├── run
└── var
    └── lib
        └── app
```

Tetapi secara mount:

```text
/              -> ext4/xfs root
/proc          -> procfs
/run           -> tmpfs
/var/lib/app   -> xfs volume
```

### 10.2 Mount Point Menutupi Directory Lama

Jika directory `/mnt/data` awalnya berisi file:

```bash
mkdir -p /mnt/data
touch /mnt/data/old.txt
```

Lalu filesystem lain dimount di `/mnt/data`, isi lama tersembunyi selama mount aktif.

```text
mount filesystem B at /mnt/data
```

Sekarang `/mnt/data` menampilkan root filesystem B.

File `old.txt` bukan hilang, tetapi tertutup oleh mount.

Dampak produksi:

- file “hilang” setelah volume mount
- app menulis ke local directory saat volume belum mounted
- setelah volume mounted, file lama tidak terlihat
- ketika volume gagal mount, app menulis ke root disk tanpa sadar

### 10.3 Bind Mount

Bind mount membuat path lain menunjuk ke subtree yang sama.

```bash
mount --bind /real/data /app/data
```

Sekarang:

```text
/real/data/file
/app/data/file
```

bisa merujuk object yang sama.

Container volume sering memakai bind mount.

Dampak:

- path di container berbeda dari path host
- permission tergantung UID/GID mapping
- file changes terlihat di dua path
- debugging harus tahu mount view process target

### 10.4 Pseudo Filesystems

Tidak semua path berisi file “di disk”.

Contoh:

```text
/proc
/sys
/dev
/run
/sys/fs/cgroup
```

`/proc/<pid>/status` bukan file biasa di ext4. Itu interface kernel yang disajikan sebagai file-like object.

Implikasi:

- `stat` bisa berhasil, tetapi semantics berbeda
- size bisa 0 walau read menghasilkan data
- seek/write mungkin tidak seperti file biasa
- permission dan capability matter

Java app jarang menulis langsung ke pseudo filesystem, tetapi runtime/container/agent/monitoring sering membaca `/proc`, `/sys`, dan cgroupfs.

---

## 11. Mount Namespace: Path yang Sama, Realitas Berbeda

Part khusus namespace akan datang nanti, tetapi untuk VFS kita perlu preview.

Mount namespace membuat process berbeda dapat melihat mount tree berbeda.

Host:

```text
/var/lib/app/config.yml
```

Container:

```text
/var/lib/app/config.yml
```

String path sama, tetapi bisa merujuk object berbeda karena root dan mount namespace berbeda.

Cek mount view process:

```bash
cat /proc/<pid>/mountinfo
```

Masuk ke mount namespace process:

```bash
nsenter -t <pid> -m sh
```

Lalu cek:

```bash
findmnt
ls -l /path/inside/process/view
```

Failure klasik:

1. Operator cek file di host: ada.
2. Java app dalam container error: `NoSuchFileException`.
3. Ternyata file tidak dimount ke container.

Atau:

1. App menulis `/app/data/output.txt`.
2. Operator cari di host `/app/data/output.txt`: tidak ada.
3. Ternyata path berada di writable layer container atau volume lain.

Production invariant:

```text
Debug filesystem dari mount namespace process yang mengalami masalah, bukan dari asumsi host view.
```

---

## 12. Permission: File, Directory, Parent Path, dan Identity

Permission Linux tidak cukup dicek di file terakhir.

Untuk membuka:

```text
/a/b/c/file.txt
```

kernel perlu:

- execute/search permission pada `/a`
- execute/search permission pada `/a/b`
- execute/search permission pada `/a/b/c`
- permission sesuai operasi pada `file.txt`

Untuk membuat file di directory:

- write + execute pada parent directory

Untuk menghapus file:

- write + execute pada parent directory
- bukan necessarily write pada file itu sendiri

Contoh penting:

```bash
mkdir /tmp/demo
chmod 777 /tmp/demo
printf hello > /tmp/demo/file
chmod 400 /tmp/demo/file
rm /tmp/demo/file
```

User yang punya permission write pada directory dapat menghapus entry, walaupun file tidak writable.

Ini sering membingungkan:

> Kenapa file read-only bisa dihapus?

Karena delete/unlink adalah operasi pada directory entry, bukan menulis isi file.

Sticky bit seperti pada `/tmp` mengubah aturan ini agar user tidak sembarang menghapus file milik user lain.

Cek:

```bash
ls -ld /tmp
```

Biasanya:

```text
drwxrwxrwt
```

`t` adalah sticky bit.

---

## 13. Java Perspective: Path, File, Channel, Stream

Java punya beberapa abstraksi:

```java
java.io.File
java.nio.file.Path
java.nio.file.Files
java.io.FileInputStream
java.io.FileOutputStream
java.nio.channels.FileChannel
```

Mapping kasar:

```text
Path/File object      -> user-space representation of path string
Files.* operation     -> syscall sequence
FileInputStream       -> open FD + stream abstraction
FileChannel           -> FD-backed channel
MappedByteBuffer      -> mmap-backed region
```

Penting:

```java
Path path = Path.of("/var/log/app.log");
```

belum membuka file.

Itu hanya object Java yang merepresentasikan path.

File baru benar-benar disentuh saat operasi seperti:

```java
Files.exists(path);
Files.readString(path);
Files.newInputStream(path);
Files.newByteChannel(path);
Files.move(src, dst);
```

### 13.1 `Files.exists` Bukan Validasi Aman

Anti-pattern:

```java
if (Files.exists(path)) {
    return Files.readString(path);
}
```

Masalah:

- file bisa hilang setelah check sebelum open
- symlink bisa berubah
- permission bisa berubah
- mount bisa berubah

Ini TOCTOU: time-of-check to time-of-use.

Lebih baik:

```java
try {
    return Files.readString(path);
} catch (NoSuchFileException e) {
    // handle not found
} catch (AccessDeniedException e) {
    // handle permission
}
```

Invariant:

```text
Di filesystem, check lalu act sering racy. Act dan handle error lebih benar.
```

### 13.2 Open FD Stabil Setelah Path Berubah

Java:

```java
try (InputStream in = Files.newInputStream(Path.of("/tmp/data.txt"))) {
    // file is open
}
```

Setelah FD terbuka, rename/unlink path tidak otomatis mengubah FD.

Process tetap membaca object lama.

Ini bisa baik atau buruk.

Baik:

- reader tidak terganggu oleh atomic replace
- writer bisa menghasilkan versi baru lalu rename

Buruk:

- app tetap memakai config lama walau path diganti
- log app tetap menulis deleted file
- reload tidak terjadi karena FD lama tidak ditutup/dibuka ulang

### 13.3 WatchService dan Filesystem Reality

Java `WatchService` sering digunakan untuk memonitor directory.

Namun behavior-nya bergantung OS/filesystem dan event semantics.

Hal yang perlu diingat:

- event bisa coalesced
- event bisa overflow
- atomic replace muncul sebagai create/delete/modify sequence
- symlink target changes tidak selalu seperti yang diharapkan
- network filesystem bisa punya behavior berbeda

Untuk config reload serius:

- gunakan polling + checksum jika perlu robustness
- handle partial writes
- handle atomic rename
- handle missing file transient
- log versi config yang dibaca

---

## 14. Path Lookup Cost dan Dentry Cache

Path lookup punya cost.

Membuka file:

```text
/a/b/c/d/e/file.txt
```

perlu memproses banyak komponen.

Dentry cache membantu, tetapi tidak membuat cost nol.

Workload yang sering membuka banyak file kecil dapat bottleneck pada:

- path lookup
- metadata operation
- inode cache pressure
- directory traversal
- permission check
- filesystem latency

Contoh Java workload:

- template engine membaca banyak file
- static asset server tanpa cache
- plugin loader membuka banyak jar/file
- scanning directory besar
- log framework membuka/menutup file terlalu sering
- batch job memproses jutaan file kecil

Optimisasi yang mungkin:

- reuse open file/channel bila benar
- batch operation
- avoid repeated existence check
- cache metadata dengan invalidation jelas
- hindari directory dengan jutaan entry tanpa strategi
- gunakan database/object storage bila namespace filesystem menjadi bottleneck

Namun jangan tuning sebelum observability.

Gunakan:

```bash
strace -c -p <pid>
strace -ttT -e trace=openat,newfstatat,statx,read,close -p <pid>
perf top
slabtop
```

`slabtop` bisa menunjukkan dentry/inode cache pressure.

---

## 15. Directory Besar dan Metadata-Heavy Workloads

Filesystem modern bisa menangani directory besar, tetapi tidak berarti semua pattern murah.

Masalah umum:

```text
/var/app/uploads/<millions of files>
```

Gejala:

- `ls` lambat
- backup lambat
- cleanup lambat
- startup scanner lambat
- high inode usage
- metadata I/O tinggi
- dentry/inode cache pressure

Desain lebih baik:

```text
/var/app/uploads/ab/cd/<object-id>
```

atau gunakan storage yang sesuai:

- object storage
- database metadata + blob store
- content-addressed layout
- sharded directory

Untuk Java service, jangan hanya pikir “file write cepat”. Pikir lifecycle:

- create
- lookup
- scan
- delete
- backup
- restore
- permission
- quota
- migration
- observability

---

## 16. Special Files: Device, Socket, FIFO, procfs

`ls -l` bisa menunjukkan tipe file:

```text
- regular file
d directory
l symbolic link
c character device
b block device
p FIFO
s socket
```

Contoh:

```bash
ls -l /dev/null /dev/sda /run/systemd/private
```

VFS menyatukan banyak object sebagai file-like.

Aplikasi bisa membuka `/dev/null` seperti file, tetapi semantics-nya bukan file biasa.

Unix domain socket bisa muncul di filesystem:

```text
/var/run/docker.sock
/run/postgresql/.s.PGSQL.5432
```

Permission path socket menentukan siapa bisa connect.

Ini penting untuk security:

```text
Akses write ke docker.sock biasanya setara root di host.
```

Untuk Java engineer:

- jangan asumsikan semua `Path` adalah regular file
- cek file type sebelum operasi sensitif
- hati-hati mengikuti symlink dari input user
- validasi canonical/real path dengan threat model yang benar

---

## 17. Symlink Race dan Path Traversal Security

Misal aplikasi menerima nama file upload:

```text
../../etc/passwd
```

Atau symlink dibuat attacker:

```text
/uploads/user-123/avatar.png -> /etc/passwd
```

Jika aplikasi hanya melakukan string normalization sederhana, bisa terjadi path traversal.

Anti-pattern:

```java
Path base = Path.of("/srv/uploads");
Path target = base.resolve(userInput).normalize();
if (!target.startsWith(base)) {
    throw new SecurityException();
}
Files.write(target, bytes);
```

Ini lebih baik dari naive concatenation, tetapi belum cukup untuk semua threat model karena symlink bisa berubah antara check dan use.

Lebih aman perlu mempertimbangkan:

- base directory yang permission-nya tidak writable oleh attacker
- tidak mengikuti symlink untuk operasi tertentu
- gunakan `NOFOLLOW_LINKS` bila sesuai
- gunakan random server-generated filename
- pisahkan metadata user dari filesystem path
- gunakan directory ownership/permission yang benar
- gunakan openat-style anchored operations di native systems bila perlu

Java murni tidak selalu memberikan semua primitive race-free seperti `openat2` policy. Karena itu desain permission dan ownership directory menjadi sangat penting.

Invariant security:

```text
Jangan izinkan attacker mengontrol path resolution penuh.
```

---

## 18. Observability: Command yang Harus Dikuasai

### 18.1 Melihat Inode

```bash
ls -li file.txt
stat file.txt
```

Contoh:

```bash
stat file.txt
```

Output penting:

```text
File: file.txt
Size: ...
Device: ...
Inode: ...
Links: ...
Access: ...
Uid: ...
Gid: ...
```

### 18.2 Mencari File dengan Inode Sama

```bash
find /path -xdev -inum <inode>
```

`-xdev` membatasi agar tidak melintasi filesystem lain.

### 18.3 Melihat Path Component Permission

```bash
namei -l /var/log/app/app.log
```

Sangat berguna untuk `Permission denied`.

### 18.4 Resolve Symlink

```bash
readlink linkname
readlink -f linkname
realpath linkname
```

Hati-hati: `readlink -f` menyelesaikan symlink dan bisa memberi gambaran berbeda dari path mentah.

### 18.5 Melihat Mount

```bash
mount
findmnt
findmnt -T /path/to/file
df -T /path/to/file
```

### 18.6 Melihat Mount View Process

```bash
cat /proc/<pid>/mountinfo
```

atau:

```bash
nsenter -t <pid> -m findmnt
```

### 18.7 Melihat FD Process

```bash
ls -l /proc/<pid>/fd
lsof -p <pid>
lsof +L1
```

### 18.8 Melihat Deleted File yang Masih Terbuka

```bash
lsof | grep deleted
lsof +L1
```

Atau spesifik process:

```bash
ls -l /proc/<pid>/fd | grep deleted
```

### 18.9 Melihat Syscall Filesystem

```bash
strace -f -ttT -e trace=openat,newfstatat,statx,read,write,close,rename,unlink -p <pid>
```

Gunakan hati-hati di production karena tracing bisa menambah overhead.

---

## 19. Lab 1 — Path, Inode, Hard Link, Symlink

Jalankan di mesin Linux non-production.

```bash
mkdir -p /tmp/vfs-lab
cd /tmp/vfs-lab
rm -rf ./*

printf 'hello\n' > original.txt
ls -li original.txt

ln original.txt hard.txt
ln -s original.txt soft.txt

ls -li original.txt hard.txt soft.txt
stat original.txt hard.txt soft.txt
```

Amati:

- `original.txt` dan `hard.txt` punya inode sama.
- link count naik.
- `soft.txt` punya inode sendiri.
- `soft.txt` menyimpan path target.

Hapus original:

```bash
rm original.txt
ls -li
cat hard.txt
cat soft.txt || true
```

Expected:

- `hard.txt` masih bisa dibaca.
- `soft.txt` menjadi dangling jika target `original.txt` hilang.

Reasoning:

```text
Hard link mempertahankan inode.
Symlink hanya menyimpan path target.
```

---

## 20. Lab 2 — Deleted-but-Open File

Terminal 1:

```bash
mkdir -p /tmp/vfs-lab
cd /tmp/vfs-lab
python3 - <<'PY'
import time
f = open('big.log', 'w')
for i in range(1000000):
    f.write('x' * 1024 + '\n')
    if i % 1000 == 0:
        f.flush()
        time.sleep(0.01)
PY
```

Alternatif lebih mudah, buat process yang keep file open:

```bash
cd /tmp/vfs-lab
python3 - <<'PY'
import time
f = open('held.log', 'w')
f.write('hello\n')
f.flush()
print('pid:', __import__('os').getpid())
time.sleep(3600)
PY
```

Terminal 2:

```bash
cd /tmp/vfs-lab
ls -li held.log
rm held.log
ls -l
lsof +L1 | grep held || true
```

Atau gunakan PID dari Terminal 1:

```bash
ls -l /proc/<pid>/fd
```

Amati:

```text
held.log (deleted)
```

Reasoning:

```text
Path sudah hilang, tetapi inode masih hidup karena FD terbuka.
```

---

## 21. Lab 3 — Permission pada Parent Directory

```bash
mkdir -p /tmp/vfs-lab/parent/child
printf 'secret\n' > /tmp/vfs-lab/parent/child/file.txt
chmod 644 /tmp/vfs-lab/parent/child/file.txt
chmod 600 /tmp/vfs-lab/parent/child

cat /tmp/vfs-lab/parent/child/file.txt || true
namei -l /tmp/vfs-lab/parent/child/file.txt
```

Amati:

- File readable.
- Tetapi directory child tidak searchable.
- Akses gagal.

Pulihkan:

```bash
chmod 755 /tmp/vfs-lab/parent/child
cat /tmp/vfs-lab/parent/child/file.txt
```

Invariant:

```text
Untuk path traversal, directory butuh execute/search bit.
```

---

## 22. Lab 4 — Mount Awareness dengan tmpfs

Butuh privilege root atau VM/container yang mendukung mount.

```bash
sudo mkdir -p /tmp/vfs-mount-demo
printf 'before mount\n' | sudo tee /tmp/vfs-mount-demo/hidden.txt
ls -l /tmp/vfs-mount-demo

sudo mount -t tmpfs tmpfs /tmp/vfs-mount-demo
ls -l /tmp/vfs-mount-demo
printf 'inside tmpfs\n' | sudo tee /tmp/vfs-mount-demo/visible.txt
findmnt -T /tmp/vfs-mount-demo/visible.txt

sudo umount /tmp/vfs-mount-demo
ls -l /tmp/vfs-mount-demo
```

Amati:

- `hidden.txt` terlihat sebelum mount.
- Setelah mount tmpfs, `hidden.txt` tersembunyi.
- Setelah unmount, `hidden.txt` muncul lagi.

Reasoning:

```text
Mount point menutupi subtree lama selama mount aktif.
```

---

## 23. Lab 5 — Java Open FD Stabil Setelah Rename

Buat file Java kecil:

```java
// File: HoldOpenRead.java
import java.io.*;
import java.nio.file.*;

public class HoldOpenRead {
    public static void main(String[] args) throws Exception {
        Path p = Path.of(args.length > 0 ? args[0] : "/tmp/vfs-lab/data.txt");
        try (InputStream in = Files.newInputStream(p)) {
            System.out.println("opened: " + p);
            System.out.println("pid: " + ProcessHandle.current().pid());
            Thread.sleep(30_000);
            System.out.println("reading after sleep:");
            System.out.println(new String(in.readAllBytes()));
        }
    }
}
```

Run:

```bash
mkdir -p /tmp/vfs-lab
printf 'old content\n' > /tmp/vfs-lab/data.txt
javac HoldOpenRead.java
java HoldOpenRead /tmp/vfs-lab/data.txt
```

Saat Java sleep, terminal lain:

```bash
mv /tmp/vfs-lab/data.txt /tmp/vfs-lab/data.old
printf 'new content\n' > /tmp/vfs-lab/data.txt
ls -li /tmp/vfs-lab/data.*
ls -l /proc/<java-pid>/fd
```

Java akan membaca dari FD lama, bukan otomatis dari path baru.

Reasoning:

```text
Path lookup terjadi saat open.
Setelah FD terbuka, FD menunjuk open file object lama.
```

---

## 24. Production Failure Mode Catalog

### 24.1 File Ada di Host, Tidak Ada di Container

Gejala:

```text
java.nio.file.NoSuchFileException: /app/config/application.yml
```

Operator:

```bash
ls /app/config/application.yml
# exists on host
```

Kemungkinan:

- path tidak dimount ke container
- mount namespace berbeda
- working directory berbeda
- root filesystem container berbeda
- symlink target tidak ada dalam container

Debug:

```bash
cat /proc/<pid>/mountinfo
nsenter -t <pid> -m sh
ls -l /app/config/application.yml
readlink -f /app/config/application.yml
```

Durable fix:

- deklarasikan mount secara eksplisit
- validasi startup config path dari dalam process namespace
- log resolved config path dan inode/device saat startup

### 24.2 Disk Penuh Tapi `du` Kecil

Gejala:

```bash
df -h /var
# 100% used

du -sh /var/*
# tidak menjelaskan total
```

Kemungkinan:

- deleted-but-open file
- reserved blocks
- mount mismatch
- hidden files under mount point

Debug:

```bash
lsof +L1
lsof | grep deleted
findmnt -T /var
```

Durable fix:

- log rotation benar
- reopen log on signal
- stdout logging in container if appropriate
- alert deleted open files

### 24.3 `Permission denied` Walau File Readable

Gejala:

```text
AccessDeniedException: /secure/app/config.yml
```

File:

```bash
ls -l /secure/app/config.yml
# -rw-r--r--
```

Kemungkinan:

- parent directory tidak searchable
- UID/GID process berbeda
- ACL
- SELinux/AppArmor
- mount option read-only/noexec/nosuid
- container user mapping

Debug:

```bash
namei -l /secure/app/config.yml
id <user>
getfacl /secure/app/config.yml
findmnt -T /secure/app/config.yml
```

Durable fix:

- set ownership benar
- set directory execute bit
- jangan jalankan app sebagai user yang tidak sesuai
- dokumentasikan runtime user

### 24.4 Atomic Move Gagal

Gejala Java:

```text
AtomicMoveNotSupportedException
FileSystemException: Invalid cross-device link
```

Kemungkinan:

- temp file dibuat di `/tmp`
- target di mounted volume lain
- cross-filesystem rename

Debug:

```bash
df -T /tmp /target/path
findmnt -T /tmp
findmnt -T /target/path
```

Durable fix:

- buat temp file di directory target yang sama
- fallback copy+fsync+rename dengan semantics jelas jika atomic tidak wajib
- jangan mengklaim atomic jika cross filesystem

### 24.5 Config Reload Tidak Mengambil Versi Baru

Gejala:

- file config sudah diganti
- app tetap memakai config lama

Kemungkinan:

- app membuka file sekali dan mempertahankan FD
- symlink `current` berubah tapi app tidak lookup ulang
- reload hanya membaca cached config
- watcher miss event

Debug:

```bash
ls -li config.yml
ls -l /proc/<pid>/fd | grep config
```

Durable fix:

- reload harus membuka ulang path
- log inode/device/version config yang aktif
- gunakan atomic replace pattern
- handle watcher overflow

### 24.6 App Menulis ke Root Disk Karena Volume Belum Mounted

Gejala:

- root filesystem penuh
- expected volume kosong
- app path benar menurut config

Kemungkinan:

- service start sebelum mount ready
- mount gagal
- directory fallback tersedia di root filesystem

Debug:

```bash
findmnt -T /var/lib/app/data
df -h /var/lib/app/data
systemctl status mount-unit
```

Durable fix:

- systemd dependency pada mount
- startup guard: verify mount type/device
- fail fast jika expected mount tidak ada
- Kubernetes: use volumeMount and readiness checks

---

## 25. Design Patterns untuk Java Service

### 25.1 Safe Config Read

Untuk config kecil:

- baca saat startup
- validate schema
- log path, real path, device, inode, version/hash
- fail fast jika invalid

Contoh log yang berguna:

```text
Loaded config path=/app/config/app.yml realPath=/mnt/config/app.yml dev=0:42 inode=123456 sha256=...
```

Kenapa inode/device penting?

Karena path sama bisa menunjuk object berbeda setelah deployment/mount/symlink switch.

### 25.2 Safe Config Update

Writer:

1. tulis ke temp file di directory yang sama
2. flush file
3. fsync file
4. rename atomically
5. fsync parent directory

Reader:

1. buka path baru saat reload
2. parse ke object baru
3. validate penuh
4. swap config reference atomically di memory
5. keep old config kalau new config invalid

### 25.3 Upload File Layout

Hindari:

```text
/uploads/<original-user-filename>
```

Lebih baik:

```text
/uploads/ab/cd/<server-generated-id>
```

Simpan metadata user filename di database.

Alasan:

- hindari path traversal
- hindari symlink attack
- hindari directory besar
- mudah sharding
- mudah cleanup
- path tidak bergantung input user

### 25.4 Log File Strategy

Di VM/systemd:

- logging ke journald atau file dengan logrotate benar
- pastikan reopen on rotation jika file logging
- monitor deleted open file

Di container:

- umumnya log ke stdout/stderr
- runtime menangani log collection
- hati-hati file logging dalam writable layer container

### 25.5 Temporary File

Gunakan temp directory yang benar:

- jika hasil akan di-rename ke target, buat temp di directory target
- jangan selalu pakai `/tmp` jika target berada di filesystem lain
- set permission sempit
- gunakan random filename server-generated
- cleanup orphan temp files

Java:

```java
Path dir = target.getParent();
Path tmp = Files.createTempFile(dir, ".tmp-", ".part");
```

bukan otomatis:

```java
Files.createTempFile("prefix", "suffix"); // default temp dir, mungkin beda filesystem
```

---

## 26. Invariant Produksi

Pegang invariant berikut:

1. **Path bukan file.** Path adalah input lookup.
2. **Inode bukan path.** Inode adalah object file di filesystem.
3. **Dentry menghubungkan nama ke inode.** Nama hidup di directory, bukan identitas utama file.
4. **File descriptor stabil setelah open.** Rename/unlink path tidak otomatis mengubah FD.
5. **Unlink menghapus nama, bukan langsung data.** Data bebas setelah link count nol dan reference terbuka habis.
6. **Mount mengubah realitas path.** Path sama bisa berarti object berbeda di namespace berbeda.
7. **Permission directory penting.** Execute bit pada parent directory diperlukan untuk traversal.
8. **Atomic rename bukan durability guarantee.** Atomic namespace update tidak sama dengan aman setelah power loss.
9. **Cross-filesystem operation punya batas.** Atomic move/hard link tidak selalu bisa lintas mount/filesystem.
10. **Debug dari view process bermasalah.** Host view bisa menyesatkan untuk container/process namespace.
11. **Check-then-act pada path racy.** Lebih baik lakukan operasi dan handle error.
12. **Symlink adalah path indirection, bukan reference aman.** Treat symlink carefully dalam threat model.

---

## 27. Common Misconceptions

### Misconception 1 — “Kalau `ls` tidak ada, berarti file sudah tidak makan disk.”

Salah.

Deleted-but-open file bisa tidak terlihat di directory tetapi masih mengalokasikan disk.

### Misconception 2 — “Inode adalah nama file.”

Salah.

Inode tidak menyimpan nama sebagai identitas utama. Directory entry menghubungkan nama ke inode.

### Misconception 3 — “Symlink sama seperti shortcut aman.”

Terlalu sederhana.

Symlink adalah path indirection dan bisa menjadi sumber race/security issue.

### Misconception 4 — “Permission file cukup dicek di file terakhir.”

Salah.

Parent directory butuh execute/search permission.

### Misconception 5 — “Path yang sama berarti file yang sama.”

Salah di container, chroot, mount namespace, bind mount, dan symlink.

### Misconception 6 — “Move selalu atomic.”

Tidak selalu.

Atomic rename berlaku dalam filesystem yang sama dan bergantung operasi/filesystem. Cross-device move bukan atomic rename.

### Misconception 7 — “`Files.exists()` membuat operasi berikutnya aman.”

Salah.

Ada race antara check dan use.

### Misconception 8 — “`du` dan `df` harus selalu cocok.”

Tidak.

Mereka menjawab pertanyaan berbeda.

---

## 28. Troubleshooting Playbook

### 28.1 Java Error: `NoSuchFileException`

Tanya:

1. Path absolute atau relative?
2. Working directory process apa?
3. File ada dalam mount namespace process?
4. Symlink target valid?
5. Case sensitivity benar?
6. App user punya traversal permission?

Command:

```bash
pwdx <pid>
ls -l /proc/<pid>/cwd
cat /proc/<pid>/mountinfo
nsenter -t <pid> -m sh
namei -l /path
readlink -f /path
```

### 28.2 Java Error: `AccessDeniedException`

Tanya:

1. UID/GID process?
2. Parent directories searchable?
3. File permission?
4. ACL?
5. SELinux/AppArmor?
6. Mount read-only?

Command:

```bash
ps -o user,group,pid,cmd -p <pid>
namei -l /path/to/file
getfacl /path/to/file
findmnt -T /path/to/file
```

### 28.3 Disk Full

Tanya:

1. Filesystem mana yang penuh?
2. `du` cocok dengan `df`?
3. Ada deleted open files?
4. Inode habis?
5. Ada mount hidden files?

Command:

```bash
df -h
df -ih
du -xhd1 /mountpoint
lsof +L1
findmnt
```

### 28.4 Atomic Move Failure

Tanya:

1. Source dan target satu filesystem?
2. Temp file dibuat di mana?
3. Filesystem mendukung operasi?
4. Target berada di overlay/NFS/FUSE?

Command:

```bash
df -T source target
findmnt -T source
findmnt -T target
strace -e trace=rename,renameat,renameat2 -f <command>
```

### 28.5 File Changed but App Reads Old Data

Tanya:

1. App membuka ulang file atau memakai FD lama?
2. Config cache di memory?
3. Symlink target berubah?
4. Watch event miss?

Command:

```bash
ls -li /path/to/file
ls -l /proc/<pid>/fd | grep file
lsof -p <pid> | grep file
```

---

## 29. Senior-Level Reasoning Questions

Gunakan pertanyaan ini untuk menguji apakah mental model sudah terbentuk.

### Q1

Sebuah Java service menulis log ke `/var/log/app/app.log`. File dihapus oleh operator, tetapi disk tetap penuh. Kenapa?

Expected reasoning:

- `rm` melakukan unlink directory entry.
- Java process masih memegang FD ke open file object.
- Inode/data belum dibebaskan.
- `du` tidak melihat karena path hilang.
- `df` melihat karena block masih allocated.
- Cek `lsof +L1`.
- Fix: reopen/restart/truncate FD/logrotate benar.

### Q2

`Files.move(tmp, target, ATOMIC_MOVE)` gagal di production tetapi sukses lokal. Kenapa?

Expected reasoning:

- tmp dan target mungkin berada di filesystem berbeda.
- Local dev mungkin satu filesystem.
- Production target mungkin volume mount.
- Atomic rename cross-device tidak bisa.
- Buat temp file di target directory.

### Q3

File `/app/config.yml` ada di host, tetapi container Java mendapat `NoSuchFileException`. Kenapa?

Expected reasoning:

- Container punya mount namespace/root berbeda.
- Host path tidak otomatis visible.
- Periksa `/proc/<pid>/mountinfo` atau `nsenter`.

### Q4

Kenapa file read-only bisa dihapus?

Expected reasoning:

- Delete/unlink adalah operasi pada parent directory.
- Butuh write+execute pada directory.
- File write permission mengatur isi file, bukan directory entry removal.

### Q5

Kenapa setelah symlink `current` diganti ke release baru, process masih membaca file lama?

Expected reasoning:

- Process mungkin sudah membuka FD lama.
- FD menunjuk open file object lama.
- Symlink resolution hanya terjadi saat path lookup/open.
- Reload harus close/open ulang.

### Q6

Bagaimana membuktikan dua path menunjuk file yang sama?

Expected reasoning:

- Bandingkan device dan inode via `stat`.
- Hard link punya inode sama dalam filesystem sama.
- Symlink perlu resolve target.

### Q7

Kenapa `du` dan `df` berbeda jauh?

Expected reasoning:

- deleted open files
- reserved blocks
- mount hidden files
- different measurement semantics
- `du` walks reachable directory tree; `df` filesystem allocation.

---

## 30. Minimal Command Cheat Sheet

```bash
# inode and metadata
ls -li file
stat file

# path component permissions
namei -l /path/to/file

# symlink resolution
readlink link
readlink -f link
realpath path

# mount view
mount
findmnt
findmnt -T /path/to/file
df -T /path/to/file

# process filesystem view
pwdx <pid>
ls -l /proc/<pid>/cwd
ls -l /proc/<pid>/root
cat /proc/<pid>/mountinfo

# file descriptors
ls -l /proc/<pid>/fd
lsof -p <pid>
lsof +L1

# filesystem syscalls
strace -f -ttT -e trace=openat,newfstatat,statx,read,write,close,rename,unlink -p <pid>

# disk usage
_df() { df -h "$@"; }
du -xhd1 /mountpoint
df -ih
```

---

## 31. Hubungan ke Part Berikutnya

Part ini membahas VFS object dan namespace/lookup semantics.

Part berikutnya, Part 008, akan masuk lebih dalam ke correctness filesystem:

- buffered I/O
- page cache
- writeback
- `fsync`
- `fdatasync`
- atomic rename pattern
- journaling
- direct I/O
- sparse files
- file locking
- crash consistency

Dengan kata lain:

```text
Part 007: “Path dan file itu sebenarnya apa?”
Part 008: “Kalau menulis file, kapan data benar-benar aman dan konsisten?”
```

---

## 32. Referensi Utama

Referensi berikut berguna untuk memperdalam part ini:

1. Linux Kernel Documentation — Overview of the Linux Virtual File System  
   `https://docs.kernel.org/filesystems/vfs.html`

2. Linux man-pages — `inode(7)`  
   `https://man7.org/linux/man-pages/man7/inode.7.html`

3. Linux man-pages — `path_resolution(7)`  
   `https://man7.org/linux/man-pages/man7/path_resolution.7.html`

4. Linux man-pages — `open(2)`  
   `https://man7.org/linux/man-pages/man2/open.2.html`

5. Linux man-pages — `stat(2)`  
   `https://man7.org/linux/man-pages/man2/stat.2.html`

6. Linux man-pages — `link(2)` and `unlink(2)`  
   `https://man7.org/linux/man-pages/man2/link.2.html`  
   `https://man7.org/linux/man-pages/man2/unlink.2.html`

7. Linux man-pages — `symlink(7)`  
   `https://man7.org/linux/man-pages/man7/symlink.7.html`

8. Linux man-pages — `mount(2)` and `mount_namespaces(7)`  
   `https://man7.org/linux/man-pages/man2/mount.2.html`  
   `https://man7.org/linux/man-pages/man7/mount_namespaces.7.html`

9. Linux man-pages — `proc(5)`  
   `https://man7.org/linux/man-pages/man5/proc.5.html`

10. OpenJDK / Java API Documentation — `java.nio.file.Files`, `Path`, `FileChannel`  
    `https://docs.oracle.com/en/java/javase/`

---

## 33. Ringkasan Akhir

VFS adalah salah satu abstraction layer paling penting di Linux. Bagi Java engineer, memahami VFS berarti memahami bahwa operasi seperti:

```java
Files.readString(path)
Files.write(path, bytes)
Files.move(src, dst)
new FileInputStream(file)
```

bukan operasi sederhana pada “string path”, melainkan rangkaian interaksi dengan:

- path lookup
- dentry cache
- inode
- mount tree
- permission checks
- file descriptor table
- open file object
- filesystem-specific implementation

Kesalahan mental model paling mahal adalah menganggap path sebagai file. Di production, banyak masalah storage dan filesystem muncul karena path berubah, mount berbeda, symlink berubah, FD lama masih hidup, atau object sebenarnya tidak sama dengan yang terlihat dari host.

Mental model yang benar:

```text
path is a lookup request
inode is file identity inside a filesystem
file descriptor is an open runtime handle
mount namespace defines what path tree a process sees
```

Jika kamu menguasai ini, kamu sudah punya fondasi kuat untuk memahami part berikutnya: correctness dan durability pada filesystem.

---

## 34. Status Seri

Part ini adalah:

```text
Part 007 — Virtual Filesystems: VFS, inode, dentry, mount
```

Status seri:

```text
BELUM SELESAI
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-008.md
Part 008 — Filesystem Semantics for Correct Applications
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-006.md">⬅️ Part 006 — File Descriptors: The Universal Handle</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-008.md">Learn Linux & Kernel Mastery for Java Engineers ➡️</a>
</div>

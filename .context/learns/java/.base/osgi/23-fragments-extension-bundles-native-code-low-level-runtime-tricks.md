# Part 23 — Fragments, Extension Bundles, Native Code, and Low-Level Runtime Tricks

Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
File: `23-fragments-extension-bundles-native-code-low-level-runtime-tricks.md`  
Target Java: 8 sampai 25  
Level: Advanced / platform engineering

---

## 0. Tujuan Pembelajaran

Pada part sebelumnya kita sudah membahas extender pattern: cara sebuah runtime OSGi menambahkan semantic baru di atas bundle biasa, misalnya Declarative Services, Blueprint, HTTP Whiteboard, JPA extender, dan custom rule extender.

Part ini masuk ke area yang lebih rendah levelnya: **fragment bundle, extension bundle, native code, dan teknik runtime yang biasanya hanya dipakai oleh engineer yang benar-benar memahami class loading, resolver, framework lifecycle, dan risiko operasional OSGi**.

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Memahami fragment bukan sebagai plugin biasa, tetapi sebagai **attachment ke host bundle**.
2. Menjelaskan kenapa fragment tidak memiliki lifecycle mandiri seperti bundle biasa.
3. Mendesain fragment untuk resource localization, platform-specific resource, test contribution, dan controlled patching.
4. Mengenali anti-pattern fragment: dependency shortcut, visibility bypass, hidden coupling, dan patch permanen.
5. Memahami `Bundle-NativeCode` dan bagaimana OSGi memilih native library berdasarkan OS, processor, language, dan environment.
6. Menghindari native library loading failure akibat classloader, architecture mismatch, extracted file conflict, atau Java module encapsulation.
7. Memahami extension bundle / framework extension sebagai teknik sangat rendah level yang harus diperlakukan sebagai last resort.
8. Menilai efek Java 9 sampai 25 terhadap teknik low-level seperti boot delegation, extension, reflection, native loading, dan internal JDK API access.
9. Membuat checklist desain sebelum memakai fragment/native/extension dalam production runtime.

Topik ini penting karena di OSGi, beberapa masalah production yang paling sulit bukan disebabkan oleh service logic, tetapi oleh **resource yang masuk dari fragment, class/resource precedence, native library yang salah dipilih, atau framework extension yang mengubah behavior global runtime**.

---

## 1. Mental Model: Fragment Bukan Bundle Mandiri

Bundle biasa memiliki:

- symbolic name
- version
- manifest
- classloader / bundle class space
- lifecycle
- activator atau DS component
- service registration
- ability to be started/stopped

Fragment bundle berbeda.

Fragment adalah bundle yang **menempel ke host bundle**. Fragment tidak berjalan sebagai unit runtime mandiri. Ia menyediakan tambahan content kepada host: class, resource, native library, localization file, atau metadata tertentu.

Mental model yang lebih tepat:

```text
Normal Bundle
  = runtime module with identity + lifecycle + class space + optional services

Fragment Bundle
  = content contribution attached to another bundle's class space
```

Fragment tidak dimaksudkan menjadi mini-plugin yang punya lifecycle sendiri. Fragment adalah mekanisme untuk mengatakan:

> “Saat host bundle di-resolve, gabungkan content saya ke host bundle sesuai aturan OSGi.”

Karena itu, fragment harus dipahami sebagai bagian dari **module layer and class space construction**, bukan bagian dari service layer.

---

## 2. Kenapa Fragment Ada?

Fragment menyelesaikan problem yang sulit jika hanya memakai bundle biasa.

Contoh problem:

1. Host bundle butuh resource berbeda per platform.
2. Host bundle butuh native library berbeda untuk Linux, Windows, macOS, x86_64, ARM64.
3. Host bundle ingin localization file dipisah per bahasa.
4. Test code perlu mengakses package internal host tanpa mengekspor package tersebut ke production bundle lain.
5. Vendor perlu memberikan patch resource/class ke host tertentu tanpa mengubah seluruh host artifact.
6. Eclipse/RCP-style product ingin kontribusi resource ke plugin tertentu.

Tanpa fragment, opsinya sering buruk:

- export internal package hanya untuk test
- embed semua native variant dalam satu host
- membuat host terlalu besar
- memakai classpath global
- membuat custom classloader
- menyalahi modular boundary

Fragment memberi cara yang lebih formal, tetapi tetap berbahaya jika dipakai sembarangan.

---

## 3. Fragment-Host Header

Fragment dideklarasikan dengan manifest header:

```text
Fragment-Host: com.example.host
```

Dengan version range:

```text
Fragment-Host: com.example.host;bundle-version="[1.2.0,2.0.0)"
```

Artinya fragment hanya bisa attach ke host `com.example.host` dengan version sesuai range.

Contoh manifest fragment:

```text
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.example.host.linux.x86_64
Bundle-Version: 1.0.0
Fragment-Host: com.example.host;bundle-version="[1.0.0,2.0.0)"
Bundle-NativeCode: lib/linux-x86_64/libnative.so; osname=Linux; processor=x86-64
```

Header `Fragment-Host` mengubah identitas runtime bundle tersebut. Ia tetap punya bundle ID dan symbolic name, tetapi content-nya ikut ke host ketika resolved.

---

## 4. Lifecycle Fragment

Fragment memiliki state seperti bundle lain di level framework, tetapi ia tidak dapat berjalan aktif seperti bundle biasa.

Secara praktis:

- Fragment dapat `INSTALLED`.
- Fragment dapat `RESOLVED` jika host ditemukan dan constraints cocok.
- Fragment tidak punya `ACTIVE` behavior sendiri.
- Fragment tidak memiliki `BundleActivator` yang dijalankan.
- Fragment tidak mendaftarkan service sendiri.
- Fragment tidak memiliki DS component yang aktif sendiri sebagai fragment.

Kalau kamu menaruh `Bundle-Activator` di fragment, desainnya sudah salah secara mental model. Fragment bukan unit behavior; fragment adalah unit contribution.

Konsekuensi penting:

```text
Jika kamu butuh behavior runtime, gunakan bundle biasa.
Jika kamu butuh content contribution ke host class space, fragment bisa dipertimbangkan.
```

---

## 5. Host dan Fragment Saat Resolve

Fragment attachment terjadi saat host di-resolve.

Proses simplifikasi:

```text
1. Framework melihat host bundle.
2. Framework melihat fragment yang memiliki Fragment-Host cocok.
3. Resolver mengevaluasi constraint host-fragment.
4. Jika cocok, fragment attached ke host.
5. Host bundle wiring memasukkan contribution dari fragment.
6. Host classloader dapat melihat resource/class/native library fragment sesuai aturan.
```

Hal yang sering disalahpahami:

- Fragment yang diinstall setelah host sudah resolved belum tentu otomatis terlihat sampai refresh/resolve ulang.
- Update fragment bisa membutuhkan refresh host.
- Removing fragment bisa memerlukan refresh host untuk membersihkan wiring lama.
- Attachment adalah bagian dari wiring; bukan dynamic service binding.

Jangan memperlakukan fragment seperti plugin hot-swap normal. Kalau use case-nya benar-benar dynamic runtime behavior, service registry lebih tepat.

---

## 6. Class Space: Fragment Content Menjadi Bagian Host

Saat fragment attach ke host, class dan resource fragment menjadi bagian dari class space host.

Ilustrasi:

```text
Host Bundle: com.example.host
  /com/example/host/HostService.class
  /config/default.properties

Fragment Bundle: com.example.host.id_ID
  /OSGI-INF/l10n/bundle_id_ID.properties
  /templates/email-id.html

Runtime Host Class Space:
  HostService.class
  config/default.properties
  OSGI-INF/l10n/bundle_id_ID.properties
  templates/email-id.html
```

Fragment tidak punya classloader terpisah untuk content yang dipakai host. Content fragment dimuat melalui host classloader/class space.

Ini alasan kenapa fragment bisa menyebabkan konflik tersembunyi:

- class dengan nama sama antara host dan fragment
- resource dengan path sama
- native library dengan nama sama
- test fragment yang tidak sengaja masuk production
- patch fragment yang menutupi resource host

---

## 7. Resource Precedence: Problem yang Sering Diremehkan

Resource loading di OSGi fragment bisa tricky.

Misal host melakukan:

```java
URL url = getClass().getResource("/config/rules.json");
```

Jika host dan fragment sama-sama punya `/config/rules.json`, hasilnya bergantung pada ordering yang ditentukan framework/resolution behavior. Kamu tidak boleh membuat desain production yang bergantung pada “kebetulan resource mana yang menang” kecuali aturan precedence sudah dikunci dan dites terhadap framework target.

Desain yang lebih aman:

```text
/config/default-rules.json
/config/platform/linux-rules.json
/config/tenant/agency-a-rules.json
```

Atau host eksplisit mencari resource berdasarkan convention:

```java
Enumeration<URL> urls = bundle.findEntries("/config/rules", "*.json", false);
```

Lalu host menggabungkan contribution secara deterministic:

1. sort by path
2. validate schema
3. reject duplicate ID
4. log source bundle
5. expose diagnostics

Top 1% rule:

> Jangan jadikan resource shadowing sebagai mekanisme konfigurasi. Jadikan fragment sebagai contribution source yang dibaca dan divalidasi secara eksplisit.

---

## 8. Use Case Fragment yang Legitimate

### 8.1 Localization Fragment

Ini salah satu use case paling aman.

Host:

```text
Bundle-SymbolicName: com.example.case.ui
Bundle-Version: 1.0.0
```

Fragment Indonesia:

```text
Bundle-SymbolicName: com.example.case.ui.nl.id
Bundle-Version: 1.0.0
Fragment-Host: com.example.case.ui;bundle-version="[1.0.0,2.0.0)"
```

Content:

```text
OSGI-INF/l10n/bundle_id.properties
OSGI-INF/l10n/bundle_id_ID.properties
```

Kelebihan:

- translation dapat dikirim terpisah
- host tidak perlu rebuild untuk semua language pack
- low behavior risk

Risiko:

- missing key
- inconsistent key version
- fragment tidak attached karena version range salah

Mitigasi:

- localization baseline test
- key coverage test
- runtime diagnostics untuk attached localization fragment

---

### 8.2 Platform-Specific Resource Fragment

Contoh:

```text
com.example.connector.core
com.example.connector.native.linux.x86_64
com.example.connector.native.linux.aarch64
com.example.connector.native.win32.x86_64
com.example.connector.native.macos.aarch64
```

Core host berisi Java abstraction.

Fragments menyediakan native binaries atau platform-specific resource.

Keuntungan:

- host tetap kecil
- deployment bisa hanya membawa fragment sesuai platform
- native code selection lebih jelas

Risiko:

- fragment yang salah ikut deploy
- OS/processor metadata salah
- native library conflict
- framework memilih clause yang tidak diharapkan

Mitigasi:

- test matrix OS/arch
- explicit `Bundle-NativeCode`
- startup self-check
- fail-fast dengan diagnostic jelas

---

### 8.3 Test Fragment

Test fragment bisa dipakai untuk mengakses internal host package tanpa mengekspor package internal ke production world.

Host:

```text
com.example.rules.engine
```

Test fragment:

```text
Bundle-SymbolicName: com.example.rules.engine.tests
Fragment-Host: com.example.rules.engine;bundle-version="[1.4.0,1.5.0)"
```

Use case:

- white-box runtime test
- resource contribution for tests
- testing package-private/internal classes

Keuntungan:

- tidak perlu mengekspor internal package hanya untuk test
- test code berjalan dalam host class space

Risiko:

- test fragment masuk production distribution
- tests bergantung terlalu kuat pada internal implementation
- host refactor membuat test fragment pecah

Mitigasi:

- classifier/test repository terpisah
- CI rule: test fragments tidak boleh masuk production runtime
- naming convention `.tests`
- feature repository separation

---

### 8.4 Patch Fragment

Patch fragment dapat memberi class/resource override untuk host.

Ini powerful tetapi sangat berbahaya.

Use case yang masih masuk akal:

- emergency vendor patch
- resource patch sementara
- compatibility shim
- platform-specific bug workaround

Risiko besar:

- patch tersembunyi dari source host
- patch tidak lagi valid setelah host update
- behavior production berbeda dari build artifact host
- troubleshooting sulit
- compliance/audit risk

Rule praktis:

```text
Patch fragment boleh sebagai emergency mechanism.
Patch fragment tidak boleh menjadi normal delivery mechanism.
Patch fragment harus memiliki expiry date, owner, reason, host version range sempit, dan automated compatibility test.
```

Manifest patch fragment harus ketat:

```text
Fragment-Host: com.vendor.host;bundle-version="[3.2.7,3.2.8)"
```

Jangan:

```text
Fragment-Host: com.vendor.host;bundle-version="[3.0.0,4.0.0)"
```

Patch untuk host versi tertentu hampir selalu tidak aman jika range terlalu luas.

---

## 9. Fragment Anti-Patterns

### 9.1 Fragment sebagai Dependency Shortcut

Salah:

```text
Host membutuhkan library X.
Daripada Import-Package, library X ditaruh di fragment.
```

Ini membuat dependency tidak terlihat sebagai dependency normal. Resolver tidak mendapatkan model dependency yang sehat.

Lebih baik:

- jadikan library X bundle sendiri
- host `Import-Package`
- atau embed secara eksplisit jika memang private implementation dependency

Fragment bukan dependency injection mechanism.

---

### 9.2 Fragment untuk Membypass Visibility

Salah:

```text
Package internal tidak diexport.
Bundle lain butuh akses.
Maka dibuat fragment agar bisa masuk class space host.
```

Ini merusak boundary. Kalau external behavior butuh akses, buat API/service resmi.

Fragment boleh dipakai untuk test white-box, bukan untuk production coupling antar modul.

---

### 9.3 Fragment dengan Behavior Tersembunyi

Jika fragment membawa class yang otomatis ditemukan oleh scanner host dan mengubah behavior secara signifikan, kamu harus memperlakukan fragment seperti plugin dengan governance.

Contoh bahaya:

- fragment menambah rule implementation
- host scan semua class dan menjalankan rule
- tidak ada metadata explicit
- tidak ada audit
- tidak ada health diagnostics

Lebih baik:

- gunakan service registry
- gunakan whiteboard service
- gunakan extender dengan metadata explicit

---

### 9.4 Fragment sebagai Normal Hotfix Permanen

Hotfix fragment yang dibiarkan bertahun-tahun akan menjadi technical debt paling sulit ditemukan.

Checklist patch fragment:

```text
[ ] Ada incident/ticket ID
[ ] Ada owner
[ ] Ada expiry date
[ ] Ada host version range sempit
[ ] Ada automated regression test
[ ] Ada startup log bahwa patch active
[ ] Ada operational command untuk list patch fragments
[ ] Ada rencana merge ke host utama
```

---

## 10. Extension Bundles dan Framework Extension

Extension bundle adalah mekanisme untuk memperluas framework atau boot class path behavior. Ini jauh lebih rendah level daripada fragment biasa.

Secara historis, extension bundle dipakai untuk:

- framework extension
- boot class path extension
- menambahkan package ke system bundle
- hook atau instrumentation tertentu

Tetapi di Java modern, khususnya Java 9+, teknik ini jauh lebih terbatas karena JPMS strong encapsulation dan perubahan security/runtime model.

Mental model:

```text
Normal Bundle     -> participates in OSGi runtime
Fragment Bundle   -> attaches to host bundle
Extension Bundle  -> may attach to framework/system bundle behavior
```

Extension bundle adalah teknik yang harus dianggap sebagai **last resort**.

---

## 11. System Bundle dan Extension Risk

Dalam OSGi, framework sendiri terepresentasi sebagai system bundle.

System bundle mengekspos package tertentu ke bundle lain, misalnya:

- Java platform packages
- OSGi framework packages
- configured system packages

Mengubah system bundle visibility berarti mengubah “hukum fisika” runtime.

Risiko:

- semua bundle bisa melihat package tambahan
- dependency yang harusnya explicit menjadi global
- migrasi Java versi baru menjadi sulit
- production behavior berbeda antar framework/config
- resolver graph menjadi kurang jujur

Contoh anti-pattern:

```text
Library internal dimasukkan ke system packages agar semua bundle bisa pakai tanpa Import-Package.
```

Ini kembali ke classpath global. Kalau dilakukan sembarangan, OSGi kehilangan manfaat utamanya.

Rule:

> System package customization harus minimal, documented, versioned, dan dianggap sebagai platform-level API.

---

## 12. Boot Delegation

Boot delegation memungkinkan bundle classloader mendelegasikan loading package tertentu ke parent/boot classloader.

Contoh konfigurasi:

```text
org.osgi.framework.bootdelegation=sun.*,com.sun.*
```

Kadang dipakai untuk compatibility library lama yang mengakses internal JDK atau agent tertentu.

Tetapi boot delegation adalah pisau tajam.

Risiko:

- bypass OSGi visibility
- class identity tidak sesuai wiring
- package yang seharusnya dari bundle malah dari parent
- sulit debug
- Java 9+ internal API makin tidak stabil

Guideline:

```text
Gunakan boot delegation hanya untuk compatibility edge case yang tidak bisa diselesaikan dengan wrapping, Import-Package, atau proper library upgrade.
```

Jangan memakai:

```text
org.osgi.framework.bootdelegation=*
```

Itu pada dasarnya mematikan isolasi OSGi.

---

## 13. Native Code di OSGi

Native code adalah library platform-specific yang dimuat via JNI/JNA/panama-bridge/lainnya.

Di Java biasa, kamu sering melihat:

```java
System.loadLibrary("foo");
```

Atau:

```java
System.load("/opt/app/lib/libfoo.so");
```

Dalam OSGi, native loading harus mempertimbangkan:

- bundle classloader
- bundle storage/cache
- native library extraction
- platform selection
- architecture selection
- library uniqueness per JVM
- refresh/update behavior
- fragment-host relationship

OSGi menyediakan header `Bundle-NativeCode` untuk mendeklarasikan native library dan selection constraint.

---

## 14. Bundle-NativeCode Header

Contoh:

```text
Bundle-NativeCode: \
  lib/linux-x86_64/libcrypto_adapter.so; osname=Linux; processor=x86-64,\
  lib/macos-aarch64/libcrypto_adapter.dylib; osname=MacOSX; processor=aarch64,\
  lib/windows-x86_64/crypto_adapter.dll; osname=Windows; processor=x86-64
```

Header ini memberitahu framework:

- native library apa yang tersedia
- clause mana cocok dengan environment runtime
- library mana yang dapat dipakai untuk `System.loadLibrary`

Native constraints dapat mencakup:

- OS name
- processor architecture
- OS version
- language
- selection filter

Dalam OSGi Core R8, native environment juga dimodelkan dengan namespace capability seperti `osgi.native`; native code dalam fragment dimuat oleh classloader host karena requirement native dari fragment diperlakukan sebagai bagian dari host saat fragment attach.

---

## 15. Native Library di Fragment

Pattern yang sering dipakai:

```text
Host Bundle:
  com.example.image.codec

Fragments:
  com.example.image.codec.native.linux.x86_64
  com.example.image.codec.native.linux.aarch64
  com.example.image.codec.native.macos.aarch64
  com.example.image.codec.native.windows.x86_64
```

Host Java code:

```java
public final class NativeCodecLoader {
    private static final AtomicBoolean LOADED = new AtomicBoolean(false);

    public static void load() {
        if (LOADED.compareAndSet(false, true)) {
            System.loadLibrary("image_codec");
        }
    }
}
```

Fragment manifest:

```text
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.example.image.codec.native.linux.x86_64
Bundle-Version: 1.0.0
Fragment-Host: com.example.image.codec;bundle-version="[1.0.0,1.1.0)"
Bundle-NativeCode: lib/linux-x86_64/libimage_codec.so; osname=Linux; processor=x86-64
```

Keuntungan:

- host code tetap portable
- native binaries dipaketkan per platform
- resolver bisa memilih platform yang cocok
- deployment bisa kecil

Risiko:

- host active tanpa fragment native yang cocok
- native binary incompatible dengan libc/OS version
- duplicate library loaded by different host versions
- update native library tidak efektif tanpa restart JVM

---

## 16. Native Library Loading Failure Taxonomy

### 16.1 `UnsatisfiedLinkError: no x in java.library.path`

Penyebab:

- native library tidak terdeklarasi di `Bundle-NativeCode`
- fragment tidak attached
- nama library salah
- framework tidak mengekstrak library
- code memakai `System.loadLibrary` dari classloader yang tidak tepat

Checklist:

```text
[ ] Fragment resolved?
[ ] Fragment attached to host?
[ ] Bundle-NativeCode clause cocok dengan OS/processor?
[ ] Library path dalam JAR benar?
[ ] Nama loadLibrary sesuai platform convention?
[ ] Host refreshed setelah fragment install/update?
```

---

### 16.2 `UnsatisfiedLinkError: wrong ELF class`

Penyebab:

- 32-bit library di 64-bit JVM
- x86_64 library di ARM64 JVM
- OS mismatch

Mitigasi:

- explicit `processor`
- startup self-check
- build artifact naming jelas
- CI matrix native artifact

---

### 16.3 `UnsatisfiedLinkError: already loaded in another classloader`

Java native library secara tradisional terikat pada classloader tertentu dan tidak selalu bisa dimuat ulang oleh classloader lain.

Dalam OSGi, ini bisa terjadi jika:

- dua host bundle memuat native library dengan nama sama
- bundle diupdate dan classloader baru mencoba load library yang sama
- library global singleton tidak support unload/reload

Mitigasi:

- satu native owner bundle
- stable host bundle untuk native loading
- jangan hot update native loader tanpa JVM restart kecuali sudah diuji
- gunakan unique extracted filename bila framework/tooling mendukung
- dokumentasikan bahwa native update memerlukan restart runtime

---

### 16.4 Native Dependency Chain Missing

Native library A bergantung pada native library B.

Error bisa muncul sebagai:

```text
libB.so: cannot open shared object file
```

Walaupun A ada.

Mitigasi:

- package dependent native libs
- set rpath/origin saat build native library
- dokumentasikan OS package dependency
- container image harus include required system libraries
- startup diagnostic menjalankan `ldd`/equivalent di CI, bukan di production path

---

## 17. Native Loading Design Patterns

### 17.1 Single Native Owner Service

Daripada banyak bundle memanggil `System.loadLibrary`, buat satu bundle/service sebagai native owner.

```text
com.example.crypto.native.api
com.example.crypto.native.impl
com.example.crypto.native.fragment.linux.x86_64
```

Service:

```java
public interface CryptoEngine {
    byte[] sign(byte[] input);
    boolean verify(byte[] input, byte[] signature);
}
```

Implementation bundle yang melakukan native load:

```java
@Component(service = CryptoEngine.class)
public final class NativeCryptoEngine implements CryptoEngine {
    @Activate
    void activate() {
        NativeLoader.loadOnce();
        NativeSelfTest.run();
    }
}
```

Keuntungan:

- native lifecycle terpusat
- failure isolated to one service
- consumer tidak peduli JNI/JNA
- fallback implementation bisa disediakan

---

### 17.2 Fallback Service Pattern

```text
CryptoEngine native implementation ranking=100
CryptoEngine pure Java implementation ranking=10
```

Jika native service gagal aktif, consumer masih bisa memakai pure Java fallback.

Tapi fallback harus explicit. Jangan diam-diam turun ke mode lambat tanpa observability.

Service property:

```text
engine.kind=native
engine.acceleration=true
engine.platform=linux-x86_64
```

Health output:

```json
{
  "service": "CryptoEngine",
  "implementation": "native",
  "platform": "linux-x86_64",
  "selfTest": "passed"
}
```

---

### 17.3 Fail-Fast Native Requirement

Untuk native dependency yang mandatory, fail fast saat activation.

Jangan menunggu request pertama gagal.

```java
@Activate
void activate() {
    try {
        NativeLoader.loadOnce();
        NativeSelfTest.runRequiredChecks();
    } catch (Throwable e) {
        throw new IllegalStateException("Native codec unavailable for this runtime", e);
    }
}
```

Ini membuat DS component unsatisfied/failed dengan alasan jelas.

---

### 17.4 Diagnostics First

Native integration harus punya diagnostics:

- OS name
- OS version
- architecture
- Java version
- loaded library version
- source bundle
- fragment attached
- self-test status
- fallback status

Tanpa itu, production troubleshooting akan menjadi tebak-tebakan.

---

## 18. Java 8 sampai 25: Dampak terhadap Fragment dan Native

### 18.1 Java 8

Java 8 adalah era sebelum JPMS.

Karakteristik:

- classpath mental model masih dominan
- Security Manager masih tersedia
- banyak library memakai internal JDK API
- JAXB/JAX-WS/Activation masih tersedia di JDK
- boot delegation hack lebih sering dipakai

OSGi di Java 8 relatif fleksibel, tetapi sering membawa technical debt:

- `sun.misc.Unsafe`
- `com.sun.*`
- old ASM/CGLIB
- classpath-era SPI discovery

---

### 18.2 Java 9–16

JPMS masuk.

Dampak:

- strong encapsulation mulai terasa
- illegal reflective access warnings
- internal package access makin rapuh
- module system memperkenalkan concept yang berbeda dari OSGi
- beberapa extension/boot hacks mulai bermasalah

Untuk fragment/native:

- native code tetap bisa, tetapi reflective access ke JDK internals butuh perhatian
- boot delegation bukan solusi untuk module encapsulation
- `--add-opens`/`--add-exports` mungkin diperlukan untuk library lama

---

### 18.3 Java 17

Java 17 sebagai LTS memperketat strong encapsulation. Banyak aplikasi OSGi legacy harus membersihkan:

- internal JDK API usage
- old bytecode libraries
- old JAXB/JAX-WS assumptions
- boot delegation broad wildcard

Fragment patch yang mengandalkan internal JDK behavior harus dievaluasi ulang.

---

### 18.4 Java 21

Java 21 membawa virtual threads sebagai fitur final.

Native/fragment impact tidak langsung, tetapi:

- native blocking call bisa pin carrier thread tergantung mekanisme
- JNI call yang blocking harus diperhatikan
- observability stack harus memahami virtual thread
- thread context classloader handling pada async/virtual thread perlu disiplin

Jika native service digunakan dalam request path, ukur behavior pada virtual threads.

---

### 18.5 Java 24/25

Security Manager sudah tidak bisa dijadikan basis sandbox modern. Strong encapsulation dan runtime integrity makin penting.

Konsekuensi:

- extension bundle tidak boleh dianggap sandbox workaround
- untrusted native code tidak boleh dimuat in-process
- plugin dengan native code harus dianggap high-risk
- process/container isolation lebih defensible
- signing dan repository governance menjadi mandatory untuk native fragments

Rule:

```text
Native fragment dari pihak tidak dipercaya = jangan dimuat dalam JVM production yang sama.
```

---

## 19. Fragment vs Service vs Extender vs Capability

Gunakan tabel ini untuk memilih mekanisme:

| Kebutuhan | Mekanisme yang cocok | Catatan |
|---|---|---|
| Tambah implementasi runtime | Service / DS | Dynamic, observable, lifecycle jelas |
| Tambah handler berbasis metadata | Whiteboard / Extender | Cocok untuk plugin behavior |
| Tambah resource localization | Fragment | Relatif aman |
| Tambah native binary per platform | Fragment + `Bundle-NativeCode` | Butuh matrix test |
| Tambah dependency library | Bundle biasa / Import-Package | Jangan pakai fragment |
| Test akses internal host | Test fragment | Jangan masuk production |
| Emergency override host resource | Patch fragment | Harus sementara dan diaudit |
| Ubah system/global framework behavior | Extension/framework hook | Last resort |

Decision rule:

```text
Jika yang berubah adalah behavior runtime, pilih service/extender.
Jika yang berubah adalah content host class space, fragment mungkin cocok.
Jika yang berubah adalah aturan global framework, berhenti dulu dan lakukan architecture review.
```

---

## 20. Patch Fragment Governance

Dalam regulated/enterprise environment, patch fragment harus punya governance ketat.

Minimal metadata:

```text
Bundle-SymbolicName: com.example.host.patch.CASE-2026-0142
Bundle-Version: 1.0.0
Fragment-Host: com.example.host;bundle-version="[2.4.3,2.4.4)"
Patch-Reason: CASE-2026-0142 temporary workaround for report template bug
Patch-Owner: platform-team
Patch-Expires: 2026-09-30
```

OSGi tidak menstandarkan custom headers seperti `Patch-Reason`, tapi kamu bisa membuat convention internal dan tooling untuk memvalidasinya.

CI rule:

```text
Reject patch fragment if:
- no ticket ID
- no owner
- no expiry
- host version range wider than allowed
- no test evidence
- no startup diagnostic
```

Runtime diagnostic:

```text
patch:list

Host                 Patch Bundle                         Reason              Expires
com.example.host     com.example.host.patch.CASE-2026...   report workaround   2026-09-30
```

Ini penting untuk auditability.

---

## 21. Fragment Versioning Strategy

Fragment harus mengikuti host compatibility.

### 21.1 Lockstep Version

```text
Host:     2.4.3
Fragment: 2.4.3
Range:    [2.4.3,2.4.4)
```

Cocok untuk:

- patch fragment
- test fragment
- native fragment yang sangat tied ke host JNI API

### 21.2 Minor-Compatible Fragment

```text
Host range: [2.4.0,2.5.0)
```

Cocok untuk:

- localization
- resource pack dengan schema stabil
- platform resource yang tidak tergantung internal class

### 21.3 Major-Compatible Fragment

```text
Host range: [2.0.0,3.0.0)
```

Hanya aman jika host-fragment contract benar-benar stabil dan dites lintas minor.

Jangan memakai broad range hanya untuk mengurangi maintenance.

---

## 22. Fragment Resource Contract

Kalau fragment menyumbang resource, buat kontrak eksplisit.

Contoh:

```text
/META-INF/com.example.rules/rule-pack.json
/templates/{template-id}.ftl
/i18n/messages_{locale}.properties
/native/{os}/{arch}/libfoo.so
```

Resource contract harus mendefinisikan:

- path convention
- schema
- version
- duplicate handling
- validation rule
- load order
- error behavior
- diagnostics

Contoh descriptor:

```json
{
  "schemaVersion": "1.0",
  "packId": "agency-a-rules",
  "targetHost": "com.example.rules.engine",
  "minHostVersion": "2.4.0",
  "rules": [
    { "id": "late-response-escalation", "file": "rules/late-response.json" }
  ]
}
```

Host tidak boleh menjalankan resource contribution tanpa validasi.

---

## 23. Native Contract Design

Native integration butuh contract antara Java host dan native binary.

Kontrak minimal:

- Java API version
- JNI symbol version
- native ABI version
- OS/arch support
- libc/runtime dependency
- thread-safety
- memory ownership
- error model
- timeout/cancellation behavior
- logging behavior
- self-test function

Contoh:

```java
public final class NativeInfo {
    public native String nativeVersion();
    public native String abiVersion();
    public native boolean selfTest();
}
```

Startup check:

```java
if (!"2".equals(nativeInfo.abiVersion())) {
    throw new IllegalStateException("Unsupported native ABI: " + nativeInfo.abiVersion());
}
```

Jangan hanya mengandalkan library filename sebagai compatibility guarantee.

---

## 24. Operational Handling: Install, Update, Refresh, Restart

### 24.1 Installing Fragment

Jika host belum resolved, fragment bisa attach saat host resolve.

Jika host sudah resolved, install fragment mungkin tidak cukup. Kamu mungkin perlu refresh host.

### 24.2 Updating Fragment

Update fragment dapat membutuhkan:

- host refresh
- dependent bundle refresh
- service restart
- full framework restart jika native library sudah dimuat

### 24.3 Removing Fragment

Removing fragment dari running host bisa meninggalkan old wiring sampai refresh.

### 24.4 Native Fragment Update

Native library update paling berisiko.

Karena native library unload dalam JVM tidak selalu reliable, policy production yang aman sering:

```text
Native code update requires process restart.
```

Ini tidak “kurang dynamic”; ini realistis.

---

## 25. Diagnostics untuk Fragment

Runtime harus bisa menjawab:

1. Fragment apa yang terinstall?
2. Fragment attach ke host apa?
3. Host version berapa?
4. Fragment version berapa?
5. Contribution apa yang diberikan?
6. Resource apa yang loaded?
7. Native library apa yang selected?
8. Apakah ada duplicate resource/class?
9. Apakah host perlu refresh?
10. Apakah fragment adalah patch/test/native/localization?

Minimal command internal:

```text
fragment:list
fragment:host com.example.host
fragment:resources com.example.host
native:list
patch:list
```

Jika memakai Karaf/Felix/Equinox shell, command custom bisa dibuat sebagai OSGi service.

---

## 26. Testing Strategy

### 26.1 Resolver Test

Pastikan fragment attach ke host yang benar.

Test scenario:

```text
- host 1.0.0 + fragment [1.0.0,2.0.0) => resolve OK
- host 2.0.0 + fragment [1.0.0,2.0.0) => resolve fail/not attach
- fragment without host => unresolved
```

### 26.2 Resource Contract Test

- resource path valid
- schema valid
- duplicate ID rejected
- load order deterministic
- missing resource reported clearly

### 26.3 Native Matrix Test

Matrix:

```text
Linux x86_64
Linux aarch64
Windows x86_64
macOS aarch64
Java 8 / 11 / 17 / 21 / 25 as applicable
```

Check:

- fragment resolved
- native selected
- native load succeeds
- self-test passes
- fallback behavior correct

### 26.4 Refresh Test

- install fragment after host active
- refresh host
- verify resource available
- uninstall fragment
- refresh host
- verify resource removed

### 26.5 Production Distribution Test

- test fragments excluded
- patch fragments explicitly listed
- native fragments match target image
- no broad boot delegation
- no unexpected system package additions

---

## 27. Case Study: Native Document Renderer in Modular Enforcement Platform

Bayangkan platform regulatory case management membutuhkan document rendering.

Requirements:

- core document rendering API stabil
- beberapa renderer bisa pure Java
- high-performance PDF renderer memakai native library
- Linux x86_64 untuk production
- macOS ARM64 untuk local development
- native renderer optional; fallback harus ada
- semua native component harus audit-able

### 27.1 Bundle Layout

```text
com.acme.document.render.api
com.acme.document.render.core
com.acme.document.render.pdf.java
com.acme.document.render.pdf.native
com.acme.document.render.pdf.native.linux.x86_64       fragment
com.acme.document.render.pdf.native.macos.aarch64      fragment
com.acme.document.render.diagnostics
```

### 27.2 API

```java
package com.acme.document.render.api;

public interface DocumentRenderer {
    RenderedDocument render(RenderRequest request) throws RenderException;
}
```

### 27.3 Native Implementation

```java
@Component(
    service = DocumentRenderer.class,
    property = {
        "renderer.format=pdf",
        "renderer.engine=native",
        "service.ranking:Integer=100"
    }
)
public final class NativePdfRenderer implements DocumentRenderer {

    @Activate
    void activate() {
        NativePdf.loadOnce();
        NativePdf.verifyAbi("2");
        NativePdf.selfTest();
    }

    @Override
    public RenderedDocument render(RenderRequest request) {
        return NativePdf.render(request);
    }
}
```

### 27.4 Fallback Implementation

```java
@Component(
    service = DocumentRenderer.class,
    property = {
        "renderer.format=pdf",
        "renderer.engine=java",
        "service.ranking:Integer=10"
    }
)
public final class JavaPdfRenderer implements DocumentRenderer {
    @Override
    public RenderedDocument render(RenderRequest request) {
        // pure Java fallback
        return renderWithJavaLibrary(request);
    }
}
```

### 27.5 Consumer

Consumer memilih berdasarkan service property, bukan class concrete.

```java
@Component
public final class DocumentGenerationService {
    private volatile DocumentRenderer renderer;

    @Reference(
        target = "(renderer.format=pdf)",
        policy = ReferencePolicy.DYNAMIC,
        policyOption = ReferencePolicyOption.GREEDY
    )
    void bindRenderer(DocumentRenderer renderer) {
        this.renderer = renderer;
    }

    void unbindRenderer(DocumentRenderer renderer) {
        if (this.renderer == renderer) {
            this.renderer = null;
        }
    }
}
```

### 27.6 Diagnostics Output

```json
{
  "documentRenderer": {
    "selected": "native",
    "serviceRanking": 100,
    "native": {
      "hostBundle": "com.acme.document.render.pdf.native",
      "fragment": "com.acme.document.render.pdf.native.linux.x86_64",
      "abi": "2",
      "selfTest": "passed"
    },
    "fallbackAvailable": true
  }
}
```

This is defensible engineering.

---

## 28. Case Study: Patch Fragment for Production Template Defect

Problem:

- Report template contains wrong regulatory wording.
- Full host release takes 2 weeks.
- Hotfix needed today.
- Template is loaded from host resource `/templates/final-notice.ftl`.

Bad solution:

```text
Drop random fragment that shadows /templates/final-notice.ftl with no metadata.
```

Better emergency solution:

```text
Bundle-SymbolicName: com.acme.case.notice.patch.CASE-2026-0142
Bundle-Version: 1.0.0
Fragment-Host: com.acme.case.notice;bundle-version="[4.8.2,4.8.3)"
Patch-Reason: CASE-2026-0142 corrected final notice wording
Patch-Owner: case-platform-team
Patch-Expires: 2026-07-31
```

But even better host design:

- host loads templates from explicit template registry
- fragment contributes descriptor
- duplicate template ID rejected unless patch mode explicitly enabled
- runtime logs source bundle of selected template

Patch selection descriptor:

```json
{
  "schemaVersion": "1.0",
  "templateId": "final-notice",
  "mode": "override",
  "reason": "CASE-2026-0142",
  "expires": "2026-07-31",
  "file": "templates/final-notice.ftl"
}
```

This makes the patch visible and auditable.

---

## 29. Framework-Specific Practical Notes

### 29.1 Apache Felix

Felix supports fragments and native code according to OSGi framework behavior. In practice, diagnostics rely on:

- bundle list
- headers
- wiring information
- Gogo commands
- framework logs

For production, add your own diagnostics for patch/native fragments because generic shell output is often not domain-specific enough.

### 29.2 Equinox

Equinox has strong heritage from Eclipse plugin/RCP model where fragments are common for:

- platform-specific fragments
- language packs
- product customization
- test fragments

Equinox/p2 product assembly can manage fragment variants, but this also means product definition must be reviewed carefully to avoid shipping wrong test/patch fragments.

### 29.3 Karaf

Karaf feature descriptors can include fragments. Operational risk:

- feature install may install host and fragment together
- feature update may require refresh
- native update may require process restart despite OSGi dynamism

For Karaf production:

- represent native fragments explicitly in features
- document restart requirement
- restrict deploy folder mutation
- prefer immutable custom distribution for critical runtime

---

## 30. Architecture Review Checklist

Before approving a fragment:

```text
[ ] Why is this a fragment instead of a normal bundle/service?
[ ] What host does it attach to?
[ ] Is host version range narrow enough?
[ ] Does it contain class, resource, native code, or metadata?
[ ] Does it shadow host content?
[ ] Is shadowing intentional and documented?
[ ] How is contribution discovered?
[ ] Is contribution validated?
[ ] What happens if fragment is missing?
[ ] What happens if wrong fragment is present?
[ ] What happens during host update?
[ ] What happens during fragment update?
[ ] Is refresh required?
[ ] Is JVM restart required?
[ ] Is there runtime diagnostics?
[ ] Is there CI resolver test?
[ ] Is there production distribution validation?
```

Before approving native code:

```text
[ ] Is native code truly required?
[ ] Is pure Java fallback possible?
[ ] Is native owner centralized?
[ ] Is ABI version checked?
[ ] Is self-test available?
[ ] Is OS/arch matrix tested?
[ ] Are transitive native dependencies known?
[ ] Is update policy documented?
[ ] Is restart requirement documented?
[ ] Is code signed/trusted?
[ ] Is untrusted native code prohibited?
```

Before approving extension/system/boot customization:

```text
[ ] Is this really impossible with normal OSGi mechanisms?
[ ] Is the global visibility change documented?
[ ] Is Java 17/21/25 behavior tested?
[ ] Does it rely on internal JDK APIs?
[ ] Does it weaken modular isolation?
[ ] Is there an exit plan?
```

---

## 31. Decision Framework

Use this decision flow:

```text
Need to add behavior at runtime?
  -> Use service registry / DS / whiteboard / extender.

Need to add resource to a specific host?
  -> Consider fragment.

Need to add localization/platform-specific resource?
  -> Fragment is often appropriate.

Need to add native binary for a host?
  -> Fragment + Bundle-NativeCode can be appropriate.

Need to patch host class/resource temporarily?
  -> Patch fragment only with strict governance.

Need to share library dependency?
  -> Use normal bundle/import/export, not fragment.

Need to change global framework/system visibility?
  -> Architecture review; likely avoid.
```

---

## 32. Key Takeaways

1. Fragment adalah content attachment ke host, bukan service/plugin behavior mandiri.
2. Fragment lifecycle berbeda dari normal bundle; jangan berharap activator/DS component fragment berjalan seperti bundle biasa.
3. Fragment cocok untuk localization, platform-specific resource, native binary packaging, test white-box, dan emergency patch yang diaudit.
4. Fragment buruk jika dipakai untuk menyembunyikan dependency, membypass visibility, atau menggantikan API/service contract.
5. Native code di OSGi harus diperlakukan sebagai platform-level risk: ABI, OS/arch, classloader, update, diagnostics, dan restart policy harus jelas.
6. Extension bundle, boot delegation, dan system package customization adalah low-level tricks yang harus dipakai sangat jarang.
7. Java 9–25 membuat banyak trik lama semakin rapuh karena strong encapsulation, Security Manager removal, dan runtime integrity concern.
8. Top-tier OSGi engineering bukan memakai fragment sebanyak mungkin, tetapi tahu kapan fragment adalah tool yang tepat dan kapan ia merusak modularity.

---

## 33. Latihan

### Latihan 1 — Classify the Mechanism

Untuk setiap kebutuhan berikut, pilih mekanisme: normal bundle, service, extender, fragment, native fragment, patch fragment, atau extension bundle.

1. Menambahkan rule validasi baru untuk modul case management.
2. Menambahkan translation bahasa Indonesia untuk UI bundle.
3. Menambahkan JNI library Linux ARM64 untuk PDF renderer.
4. Mengakses class internal host untuk runtime production integration.
5. Mengganti template notice karena typo legal wording yang urgent.
6. Membuat semua bundle bisa melihat package `com.vendor.legacy.*` tanpa import.
7. Menambahkan handler baru berdasarkan metadata XML dalam bundle.

Jawaban yang diharapkan:

```text
1. Service/whiteboard/extender
2. Fragment
3. Native fragment
4. Jangan; buat API/service resmi
5. Patch fragment sementara dengan governance
6. Hindari; bundle/import/export, bukan system global
7. Extender
```

### Latihan 2 — Review Fragment Manifest

Manifest:

```text
Bundle-SymbolicName: com.example.host.patch
Bundle-Version: 1.0.0
Fragment-Host: com.example.host;bundle-version="[1.0.0,3.0.0)"
```

Masalah:

- patch name terlalu generic
- host version range terlalu luas
- tidak ada reason/owner/expiry
- tidak jelas content apa yang diubah
- auditability rendah

Perbaikan:

```text
Bundle-SymbolicName: com.example.host.patch.CASE-2026-0142
Bundle-Version: 1.0.0
Fragment-Host: com.example.host;bundle-version="[1.4.7,1.4.8)"
Patch-Reason: CASE-2026-0142 final notice template correction
Patch-Owner: platform-team
Patch-Expires: 2026-07-31
```

### Latihan 3 — Native Failure Playbook

Error:

```text
java.lang.UnsatisfiedLinkError: libfoo.so: wrong ELF class: ELFCLASS32
```

Kemungkinan penyebab:

- 32-bit native lib dipakai pada 64-bit JVM
- `processor` metadata salah
- wrong fragment attached
- deployment membawa fragment yang salah

Actions:

```text
1. Print runtime OS/arch/JVM bitness.
2. List attached native fragments.
3. Inspect Bundle-NativeCode clause.
4. Verify artifact content.
5. Add CI matrix test.
6. Tighten feature/container distribution.
```

---

## 34. Referensi

Referensi utama untuk part ini:

- OSGi Core Release 8 — Module Layer, bundle manifest headers, fragment model, native code and namespaces.
- OSGi Core Release 8 — Framework Namespaces, including native namespace behavior.
- Apache Felix Framework documentation.
- Eclipse Equinox documentation and Eclipse Platform/RCP fragment usage patterns.
- Apache Karaf documentation for features/provisioning operational model.
- bnd/Bndtools documentation for bundle metadata, fragments, native code, and runtime assembly.
- OpenJDK documentation/JEPs related to JPMS, strong encapsulation, Security Manager deprecation/removal, and modern Java runtime behavior.

---

## 35. Posisi Part Ini dalam Series

Kita sudah menyelesaikan:

```text
Part 0  - OSGi mental model
Part 1  - Core architecture and runtime invariants
Part 2  - Bundle anatomy and manifest contracts
Part 3  - Class loading and visibility
Part 4  - Dependency model
Part 5  - Resolver engineering
Part 6  - Semantic versioning
Part 7  - Service layer fundamentals
Part 8  - Declarative Services deep dive
Part 9  - Advanced DS patterns
Part 10 - Configuration Admin and Metatype
Part 11 - bnd and Bndtools
Part 12 - Apache Felix runtime
Part 13 - Eclipse Equinox runtime
Part 14 - Apache Karaf runtime
Part 15 - Web and HTTP in OSGi
Part 16 - Persistence in OSGi
Part 17 - Messaging, events, and async runtime
Part 18 - Security model
Part 19 - JPMS and OSGi
Part 20 - Java 8 to 25 compatibility engineering
Part 21 - Enterprise integration
Part 22 - Extender pattern internals
Part 23 - Fragments, extension bundles, native code, and low-level runtime tricks
```

Berikutnya:

```text
Part 24 - Testing OSGi Systems: Unit, Bundle, Resolver, Integration, and Runtime Tests
```

Series belum selesai.

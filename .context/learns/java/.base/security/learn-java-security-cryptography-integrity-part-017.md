# learn-java-security-cryptography-integrity-part-017

# Part 17 — Secure File, Archive, and Data Transfer Integrity

> Seri: `learn-java-security-cryptography-integrity`  
> Part: `017` dari `034`  
> Status seri: **belum selesai**  
> Fokus: file sebagai trust boundary, archive extraction security, integrity manifest, secure handoff, atomic persistence, dan data-transfer integrity di sistem Java enterprise.

---

## 0. Peta Posisi dalam Seri

Pada part sebelumnya kita sudah membahas:

- security mental model,
- threat modeling,
- cryptographic guarantee,
- randomness,
- hashing,
- password verification,
- symmetric encryption,
- MAC,
- digital signature,
- asymmetric encryption/key agreement,
- key management,
- keystore/truststore,
- PKI,
- TLS/JSSE,
- TLS hardening,
- secure deserialization.

Part ini mengambil semua fondasi tersebut lalu menaruhnya pada satu area yang sangat sering dianggap sederhana tetapi sebenarnya berisiko tinggi: **file, archive, dan data transfer**.

Di sistem Java enterprise, file hampir selalu muncul dalam bentuk:

- upload dokumen,
- import CSV/Excel/XML/JSON,
- attachment case,
- evidence bundle,
- ZIP archive,
- report export,
- inter-agency file transfer,
- nightly batch handoff,
- document repository,
- object storage,
- signed artifact,
- archival package,
- migration dump,
- generated PDF,
- encrypted package,
- evidence record.

Security mistake yang sering terjadi:

> Engineer menganggap file sebagai data pasif, padahal file adalah **untrusted input, storage object, executable risk, parser trigger, metadata carrier, resource consumption vector, and evidence object**.

Mental model utama part ini:

> File tidak boleh dipercaya hanya karena berhasil di-upload, extension-nya benar, MIME type-nya terlihat wajar, berasal dari internal user, atau dikirim lewat TLS. File baru boleh masuk ke domain sistem setelah melewati boundary validation, canonicalization, scanning, storage isolation, integrity binding, dan lifecycle control.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu harus bisa:

1. Mendesain file upload pipeline yang aman untuk Java backend.
2. Membedakan validasi nama file, metadata, content type, magic bytes, struktur internal, dan business rule.
3. Mencegah path traversal dan arbitrary file overwrite.
4. Mengekstrak ZIP/archive secara defensif.
5. Mendeteksi dan membatasi archive bomb / decompression bomb.
6. Membuat manifest integrity untuk file transfer.
7. Menggunakan hash, HMAC, dan signature secara tepat untuk data transfer.
8. Mendesain secure file handoff antar service/agency/system.
9. Menyimpan file secara atomic agar tidak menghasilkan partial/corrupt state.
10. Menyusun review checklist untuk file pipeline enterprise.

---

## 2. Mengapa File Security Sulit

File security sulit karena file menyentuh banyak boundary sekaligus.

Satu file bisa membawa:

- **nama**: `../../etc/passwd`, `invoice.pdf.exe`, Unicode confusable name,
- **metadata**: MIME type, owner, timestamp, EXIF, author, macro indicator,
- **content**: binary payload, script, exploit, corrupted structure,
- **container**: ZIP, TAR, Office document, PDF, JAR,
- **nested object**: file dalam archive, macro dalam Office, embedded file dalam PDF,
- **parser trigger**: library membaca file lalu crash/RCE/DoS,
- **resource attack**: zip bomb, huge image, XML expansion, regex/pathological parser,
- **evidence value**: harus bisa dibuktikan tidak berubah,
- **privacy impact**: file bisa mengandung PII/sensitive data,
- **legal/audit implication**: file bisa menjadi bukti regulatory action.

Karena itu file pipeline tidak boleh hanya berisi:

```text
receive multipart file
→ save to /uploads
→ return success
```

Pipeline yang lebih aman harus memisahkan:

```text
receive untrusted bytes
→ assign server-side object id
→ write to quarantine/staging
→ validate metadata
→ inspect content
→ scan malware / disallow dangerous types
→ normalize/canonicalize
→ compute digest
→ persist immutable object
→ bind object to business record
→ authorize every access
→ log evidence events
→ retain/delete by policy
```

---

## 3. Core Security Properties untuk File

Dalam konteks file, security property tidak selalu berarti encryption.

| Property | Pertanyaan utama | Contoh failure |
|---|---|---|
| Confidentiality | Siapa yang boleh membaca file? | Evidence file bocor karena direct public URL |
| Integrity | Apakah file berubah sejak diterima/disetujui? | File diganti setelah case decision |
| Authenticity | Siapa pengirim/pembuat file yang valid? | File palsu dikirim seolah dari agency partner |
| Authorization | Apakah actor boleh upload/read/delete file ini? | User membaca attachment case tenant lain |
| Availability | Apakah file pipeline bisa dibuat down? | Zip bomb memenuhi disk/CPU |
| Non-repudiation | Bisakah pihak menyangkal pernah mengirim/menyetujui file? | Transfer tanpa signature/audit evidence |
| Freshness | Apakah file replay lama diterima ulang? | Old approval package dikirim kembali |
| Traceability | Bisakah lifecycle file diaudit? | Tidak tahu siapa mengganti dokumen |
| Retention | Apakah file disimpan/dihapus sesuai policy? | Sensitive file tidak pernah dihapus |
| Parser safety | Apakah membaca file bisa mengeksekusi/merusak sistem? | Deserialization/XML/macro/parser exploit |

Mental model:

> Hash memberi integrity detection, bukan access control. TLS memberi transport protection, bukan file authenticity jangka panjang. Signature memberi authenticity terhadap payload tertentu, bukan kebenaran business semantics. Storage ACL membatasi akses, bukan membuktikan file tidak pernah berubah.

---

## 4. File sebagai Trust Boundary

File adalah input dari boundary tidak dipercaya walaupun berasal dari:

- authenticated user,
- internal staff,
- trusted agency,
- SFTP partner,
- batch job internal,
- admin UI,
- another microservice,
- object storage event,
- email attachment,
- previous system migration.

Kenapa?

Karena “trusted source” tidak sama dengan “trusted bytes”.

Source bisa:

- compromised,
- misconfigured,
- replayed,
- using stale key,
- sending corrupted file,
- sending wrong format,
- including malicious nested payload,
- hit by supply-chain compromise,
- affected by human error.

File boundary harus diperlakukan seperti API boundary:

```text
untrusted external representation
→ validation
→ normalization
→ domain object admission
```

Jangan langsung menjadikan uploaded file sebagai domain object.

---

## 5. Canonical File Pipeline

Pipeline aman minimal:

```text
[1] Receive
    - multipart/request/SFTP/object event
    - enforce request size limit early
    - never trust client filename/path/MIME

[2] Assign Server Identity
    - generate object id server-side
    - do not use original filename as storage path
    - store original filename only as metadata after normalization

[3] Quarantine / Staging Write
    - isolated path/bucket/container
    - no execution permission
    - not directly web-accessible
    - strict quota

[4] Basic Validation
    - file size
    - extension allowlist
    - filename normalization
    - content-type sanity check
    - magic bytes check

[5] Deep Inspection
    - parser-level validation
    - archive-safe extraction if needed
    - malware scan if policy requires
    - macro detection / active content policy
    - image/PDF/document-specific checks

[6] Integrity Binding
    - compute digest over exact bytes accepted
    - optional HMAC/signature verification
    - store digest with algorithm/version
    - bind digest to business record

[7] Promotion to Durable Store
    - immutable object path
    - least privilege storage policy
    - encryption at rest if required
    - retention lifecycle

[8] Access Mediation
    - never expose raw storage path blindly
    - authorize every download
    - safe Content-Disposition
    - correct Content-Type and X-Content-Type-Options

[9] Audit
    - upload actor, time, source, digest, decision
    - validation result
    - promotion event
    - download access events for sensitive files

[10] Lifecycle
    - retention
    - deletion
    - legal hold
    - archival
    - re-scan on policy/signature update if needed
```

---

## 6. Receive Stage: Do Not Trust Multipart Metadata

In Java web apps, multipart upload usually gives you:

- original filename,
- submitted content type,
- size,
- input stream,
- possibly temporary file location.

Do not trust:

```java
multipartFile.getOriginalFilename();
multipartFile.getContentType();
```

These are client-controlled hints.

Unsafe pattern:

```java
Path uploadPath = Paths.get("/app/uploads", multipartFile.getOriginalFilename());
multipartFile.transferTo(uploadPath);
```

Problems:

- path traversal,
- overwrite existing file,
- filename collision,
- Unicode tricks,
- hidden extension,
- executable extension,
- Windows reserved names,
- direct web exposure,
- no integrity record,
- no quarantine.

Safer pattern:

```java
String objectId = UUID.randomUUID().toString();
Path stagingPath = stagingDir.resolve(objectId + ".upload");

try (InputStream in = multipartFile.getInputStream()) {
    Files.copy(in, stagingPath, StandardCopyOption.REPLACE_EXISTING);
}
```

But even this is only the first step. The file remains untrusted until validated and promoted.

---

## 7. Request Size and Streaming Limits

Never rely only on application-level checks after reading the whole file.

A malicious user can:

- send huge request body,
- exhaust memory,
- exhaust temp disk,
- hold slow connection,
- trigger multipart parser overhead,
- upload many small files concurrently.

Controls should exist at multiple layers:

```text
edge proxy / API gateway
→ app server multipart config
→ application stream limit
→ staging quota
→ per-user/business quota
→ async worker limit
```

Security invariant:

> No untrusted upload may consume unbounded memory, disk, CPU, file descriptors, threads, parser recursion, or decompressed output.

Java streaming limit example:

```java
public final class BoundedInputStream extends FilterInputStream {
    private final long maxBytes;
    private long count;

    public BoundedInputStream(InputStream in, long maxBytes) {
        super(in);
        this.maxBytes = maxBytes;
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        int n = super.read(b, off, len);
        if (n > 0) {
            count += n;
            if (count > maxBytes) {
                throw new IOException("Input exceeds maximum allowed size");
            }
        }
        return n;
    }

    @Override
    public int read() throws IOException {
        int n = super.read();
        if (n != -1) {
            count++;
            if (count > maxBytes) {
                throw new IOException("Input exceeds maximum allowed size");
            }
        }
        return n;
    }
}
```

Important nuance:

- compressed size limit is not enough,
- decompressed size limit is required,
- nested archive depth limit is required,
- parser object count limit may be required.

---

## 8. Filename Security

Original filename is metadata, not identity.

Never use original filename for:

- storage path,
- authorization decision,
- content type decision,
- extension-only security decision,
- business uniqueness,
- evidence identity.

### 8.1 Filename Threats

Examples:

```text
../../../../etc/passwd
..\..\windows\system32\drivers\etc\hosts
invoice.pdf.exe
invoice.pdf%00.exe
invoice .pdf
invoice.pdf     
CON
NUL
AUX
COM1
case-123/decision.pdf
case-123\decision.pdf
file

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 16 — Secure Serialization, Deserialization, and Object Integrity](./learn-java-security-cryptography-integrity-part-016.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 18 — XML Security, XXE, XML Signature, XML Encryption](./learn-java-security-cryptography-integrity-part-018.md)

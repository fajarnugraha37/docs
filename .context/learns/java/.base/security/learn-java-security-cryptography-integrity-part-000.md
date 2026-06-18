# learn-java-security-cryptography-integrity-part-000

# Part 0 — Security Mental Model for Senior Java Engineers

> Seri: `learn-java-security-cryptography-integrity`  
> Part: `000`  
> Status seri: belum selesai. Ini adalah bagian 0 dari 35 bagian, yaitu Part 0 sampai Part 34.  
> Fokus: mental model security sebelum masuk ke API Java security, cryptography, TLS, JWT, key management, audit integrity, dan secure runtime.

---

## 0. Tujuan Part Ini

Bagian ini membangun fondasi berpikir security untuk Java engineer senior. Tujuannya bukan membuat kamu hafal daftar vulnerability, bukan juga langsung memakai `Cipher`, `Mac`, `Signature`, `KeyStore`, atau `TrustManager`. Itu akan datang di bagian berikutnya.

Tujuan bagian ini adalah membuat kamu mampu berpikir seperti ini:

> “Sebelum saya menulis kode security, saya harus tahu asset apa yang dilindungi, actor siapa yang dipercaya/tidak dipercaya, trust boundary di mana, threat apa yang realistis, invariant apa yang tidak boleh rusak, failure mode apa yang mungkin terjadi, dan control apa yang benar-benar menutup threat tersebut.”

Dalam security, kode yang benar secara sintaks belum tentu aman. API yang sukses return response belum tentu memberi guarantee yang kamu kira. Desain yang terlihat rapi belum tentu punya trust boundary yang benar. Sistem yang lolos test happy path belum tentu aman terhadap tampering, replay, confused deputy, credential leakage, downgrade, dependency compromise, atau abuse flow.

Part ini akan membahas:

1. Apa arti security sebagai constraint sistem.
2. Perbedaan asset, actor, threat, vulnerability, exploit, risk, mitigation, dan residual risk.
3. Confidentiality, integrity, authenticity, availability, freshness, authorization, non-repudiation.
4. Trust boundary dan attack surface di Java enterprise system.
5. Cara membaca security requirement sebagai invariant.
6. Cara melakukan threat modeling lightweight yang berguna untuk engineer.
7. Cara membedakan bug biasa, vulnerability, weakness, exploitability, dan business abuse.
8. Cara berpikir secure-by-design sebelum secure-by-review.
9. Cara menggunakan mental model ini untuk seluruh seri berikutnya.

---

## 1. Kenapa Part 0 Penting

Banyak engineer belajar security dari daftar API atau daftar vulnerability:

- “Gunakan AES-GCM.”
- “Jangan pakai MD5.”
- “Jangan disable certificate validation.”
- “Tambahkan JWT validation.”
- “Gunakan mTLS.”
- “Hash password dengan bcrypt.”
- “Tambahkan rate limit.”

Semua itu benar dalam konteks tertentu. Tetapi tanpa mental model, engineer bisa tetap membuat desain yang insecure:

- AES-GCM dipakai, tetapi nonce reuse.
- JWT divalidasi signature-nya, tetapi `audience` tidak dicek.
- Password di-hash, tetapi reset token bocor di log.
- mTLS dipakai, tetapi service masih percaya header `X-User-Id` dari client eksternal.
- Audit trail dibuat, tetapi bisa diubah oleh admin database tanpa detection.
- File upload divalidasi extension-nya, tetapi tidak ada content validation dan path canonicalization.
- Secure random dipakai, tetapi token tidak punya expiry dan tidak binding ke purpose.
- Authorization ada di controller, tetapi batch job bisa mutate data tanpa policy check.

Security engineering adalah disiplin tentang **guarantee under adversarial conditions**.

Pertanyaannya bukan hanya:

> “Apakah kode ini berjalan?”

Tetapi:

> “Guarantee apa yang tetap benar ketika input jahat, network tidak dipercaya, dependency bisa compromised, user bisa abuse flow, log bisa bocor, clock bisa skew, retry bisa replay, dan operator punya akses production?”

---

## 2. Security sebagai Constraint, Bukan Fitur

Security bukan fitur tambahan seperti export PDF, dashboard, atau notification. Security adalah constraint yang membatasi bagaimana seluruh sistem boleh bekerja.

Contoh fitur biasa:

> “User bisa upload dokumen pendukung.”

Security constraint:

> “User hanya boleh upload dokumen untuk case yang dia berwenang akses; file tidak boleh dieksekusi; file path tidak boleh keluar dari storage boundary; file harus bisa diverifikasi integritasnya; metadata tidak boleh mengandung PII berlebih; upload tidak boleh menyebabkan denial of service; hasil scan harus menentukan apakah file boleh dipakai downstream.”

Fitur biasa cenderung didefinisikan oleh success path. Security didefinisikan oleh **forbidden path**.

Fitur bertanya:

> “Apa yang harus bisa dilakukan user?”

Security bertanya:

> “Apa yang tidak boleh bisa dilakukan siapa pun, bahkan jika mereka mencoba secara sengaja?”

Fitur bertanya:

> “Bagaimana sistem menghasilkan output?”

Security bertanya:

> “Apa yang harus tetap benar walaupun input, actor, network, dependency, storage, dan runtime tidak sepenuhnya dipercaya?”

---

## 3. Security Properties: Bahasa Dasar yang Harus Presisi

Security sering gagal karena tim memakai kata yang sama untuk guarantee yang berbeda. “Aman” terlalu kabur. Engineer harus memakai property yang lebih spesifik.

### 3.1 Confidentiality

Confidentiality berarti data hanya dapat dibaca oleh pihak yang berhak.

Contoh:

- Password asli tidak boleh diketahui oleh developer, DBA, support, atau attacker.
- Access token tidak boleh muncul di browser console, log, APM tag, atau error page.
- Dokumen evidence hanya boleh diakses oleh officer/case party yang authorized.
- Private key tidak boleh bisa diekstrak dari application pod.

Control umum:

- Encryption.
- Access control.
- Secret management.
- Token scoping.
- Data minimization.
- Redaction.
- Network isolation.

Namun confidentiality bukan hanya encryption. Data yang terenkripsi tetapi key-nya tersimpan di repo tetap tidak confidential. Data yang tidak pernah dienkripsi tetapi berada di memory process dengan akses ketat mungkin masih acceptable untuk beberapa threat model. Jadi confidentiality harus selalu dibaca bersama trust boundary dan key custody.

### 3.2 Integrity

Integrity berarti data, command, event, file, atau state tidak berubah secara tidak sah tanpa terdeteksi atau dicegah.

Contoh:

- Amount payment tidak boleh diubah di client sebelum submit.
- Case status tidak boleh loncat dari `DRAFT` ke `APPROVED` tanpa transition valid.
- Audit record tidak boleh diubah tanpa detection.
- File evidence tidak boleh diganti diam-diam setelah submission.
- Message dari service A ke service B tidak boleh dimodifikasi broker/operator tanpa detection jika broker tidak dipercaya penuh.

Control umum:

- Server-side validation.
- Authorization.
- Digital signature.
- MAC/HMAC.
- Hash manifest.
- Database constraint.
- Optimistic locking.
- State machine guard.
- Append-only log.
- Tamper-evident chain.

Integrity sering lebih penting daripada confidentiality dalam regulatory systems. Banyak data memang boleh dilihat oleh officer tertentu, tetapi tidak boleh diubah tanpa authorization, workflow, reason, timestamp, and evidence trail.

### 3.3 Authenticity

Authenticity berarti kita bisa memastikan identitas atau origin suatu actor, message, system, key, certificate, atau artifact.

Contoh:

- API request benar berasal dari client yang sah.
- Event benar dibuat oleh service tertentu.
- Certificate benar milik domain yang diakses.
- Artifact jar benar berasal dari build pipeline yang approved.
- Webhook benar berasal dari provider eksternal.

Control umum:

- Authentication.
- mTLS.
- Digital signature.
- HMAC request signing.
- Certificate validation.
- Artifact signing.
- OIDC token validation.

Authenticity bukan authorization. Mengetahui “siapa” tidak otomatis berarti “boleh melakukan apa”.

### 3.4 Authorization

Authorization berarti actor yang sudah diketahui identitasnya hanya bisa melakukan action yang diperbolehkan pada object yang diperbolehkan dalam context yang diperbolehkan.

Contoh:

- Officer A boleh melihat case di division-nya, tetapi tidak case division lain.
- Supervisor boleh approve hanya jika case berada di state `PENDING_REVIEW`.
- System user boleh publish event, tetapi tidak boleh mengubah master data.
- Admin teknis boleh rotate certificate, tetapi tidak boleh melihat confidential case content.

Authorization yang baik menjawab minimal empat hal:

```text
who    = actor / principal / service / delegated user
can do = action / command / operation
what   = resource / object / aggregate / record
when   = contextual condition / state / tenant / ownership / time / purpose
```

Authorization yang hanya berbasis role sering gagal pada object-level access control.

### 3.5 Availability

Availability berarti sistem tetap dapat digunakan sesuai kebutuhan walaupun ada load, fault, abuse, dependency degradation, atau attack.

Contoh:

- Login tidak mudah dilumpuhkan oleh brute-force attempt.
- File upload tidak bisa membuat storage habis dengan archive bomb.
- Search endpoint tidak bisa dipakai untuk query yang membakar database.
- Crypto operation tidak bisa dipakai sebagai CPU exhaustion vector.
- Downstream retry tidak menyebabkan retry storm.

Control umum:

- Rate limit.
- Quota.
- Timeout.
- Circuit breaker.
- Bulkhead.
- Backpressure.
- Input size limit.
- Cost-based guard.
- Resource isolation.

Availability sangat dekat dengan reliability, tetapi dalam security kita melihat availability dari sisi adversarial behavior.

### 3.6 Freshness

Freshness berarti data/request/token/event bukan replay lama yang dipakai ulang seolah-olah baru.

Contoh:

- Signed request dari 10 menit lalu tidak boleh bisa dikirim ulang.
- Password reset link tidak boleh valid selamanya.
- OTP tidak boleh reusable.
- Payment command tidak boleh diproses dua kali karena retry/replay.
- Event lama tidak boleh menimpa state baru.

Control umum:

- Timestamp window.
- Nonce.
- Idempotency key.
- Sequence number.
- Expiry.
- Replay cache.
- Version check.

Freshness sering dilupakan. Banyak sistem punya authenticity tetapi tidak punya replay protection.

### 3.7 Non-repudiation

Non-repudiation berarti pihak tertentu sulit menyangkal bahwa mereka melakukan action tertentu, karena ada evidence yang kuat.

Contoh:

- Officer tidak bisa menyangkal telah approve enforcement action.
- External agency tidak bisa menyangkal telah mengirim signed document.
- Build pipeline tidak bisa menyangkal artifact berasal dari commit tertentu.

Control umum:

- Digital signature.
- Strong authentication.
- Tamper-evident audit log.
- Trusted timestamp.
- Immutable evidence trail.
- Separation of duties.

Non-repudiation bukan hanya signature. Ia membutuhkan identity binding, key custody, audit integrity, process integrity, time integrity, dan legal/operational policy.

### 3.8 Privacy

Privacy bukan hanya confidentiality. Privacy membahas bagaimana data personal dikumpulkan, dipakai, dibagikan, disimpan, diminimalkan, dan dihapus.

Contoh:

- Jangan log NRIC/ID number lengkap jika hanya butuh last four digits.
- Jangan expose data personal ke AI tool eksternal.
- Jangan simpan data yang tidak punya purpose.
- Jangan kirim data personal ke service yang tidak punya legal basis.

Control umum:

- Data minimization.
- Purpose limitation.
- Retention policy.
- Masking.
- Pseudonymization.
- Consent/notice.
- Access audit.

---

## 4. Vocabulary yang Harus Dibedakan

### 4.1 Asset

Asset adalah sesuatu yang bernilai dan perlu dilindungi.

Dalam Java enterprise system, asset bisa berupa:

- Password hash.
- Session cookie.
- Access token.
- Refresh token.
- Signing key.
- TLS private key.
- Case data.
- Evidence file.
- Audit trail.
- Approval decision.
- Workflow state.
- Payment instruction.
- PII.
- Application configuration.
- Deployment artifact.
- Build credential.
- Database credential.
- KMS key alias.
- Admin endpoint.
- Log stream.
- Message queue.
- Internal API.

Asset bukan hanya data. Capability juga asset. Endpoint yang bisa approve case adalah asset karena memberi kemampuan mengubah state penting.

### 4.2 Actor

Actor adalah pihak yang berinteraksi dengan sistem.

Actor bisa berupa:

- Anonymous internet user.
- Authenticated citizen.
- Officer.
- Supervisor.
- System admin.
- DBA.
- Developer.
- CI/CD pipeline.
- Internal microservice.
- External agency system.
- Batch job.
- Message consumer.
- Malicious insider.
- Compromised dependency.
- Compromised pod.
- Attacker with stolen token.

Kesalahan umum: threat model hanya memasukkan “external hacker”, padahal banyak failure mode enterprise berasal dari internal over-privilege, compromised service account, operator mistake, leaked logs, atau overly trusted internal network.

### 4.3 Trust Boundary

Trust boundary adalah titik di mana level trust berubah.

Contoh trust boundary:

```text
Browser → API Gateway
API Gateway → Java backend
Java backend → database
Java backend → message broker
Message broker → async worker
Java service → external agency API
CI pipeline → artifact repository
Artifact repository → production runtime
Admin user → admin endpoint
Pod → cloud metadata service
```

Setiap kali data melewati trust boundary, kamu harus bertanya:

1. Apakah origin-nya authenticated?
2. Apakah actor-nya authorized?
3. Apakah payload-nya valid?
4. Apakah payload-nya tamper-evident?
5. Apakah request/event ini fresh atau replay?
6. Apakah data ini aman untuk dilog?
7. Apakah downstream boleh mempercayai metadata/header/context ini?
8. Apa yang terjadi jika boundary sebelumnya compromised?

### 4.4 Threat

Threat adalah potensi kejadian buruk yang bisa merusak security property.

Contoh:

- Attacker mencuri refresh token dari log.
- User mengubah `caseId` di request untuk mengakses case orang lain.
- Internal service mengirim event palsu ke broker.
- Operator mengganti file evidence di storage.
- Dependency compromised menjalankan exfiltration saat startup.
- TLS certificate expired menyebabkan service outage.
- JWT dengan audience salah diterima oleh service.
- Signed request valid dipakai ulang dalam replay attack.

Threat bukan kelemahan. Threat adalah skenario buruk.

### 4.5 Vulnerability

Vulnerability adalah kelemahan konkret yang bisa dieksploitasi untuk mewujudkan threat.

Contoh:

Threat:

> User mengakses case orang lain.

Vulnerability:

> Endpoint `/cases/{caseId}` hanya mengecek user login, tetapi tidak mengecek ownership/division/assignment terhadap `caseId`.

Threat:

> Token dicuri dari log.

Vulnerability:

> Request logging middleware mencetak semua header termasuk `Authorization`.

Threat:

> Webhook palsu diterima.

Vulnerability:

> Endpoint webhook tidak memverifikasi HMAC signature dan timestamp.

### 4.6 Weakness

Weakness adalah pola kelemahan umum yang bisa menyebabkan vulnerability. CWE adalah taksonomi umum untuk weakness di software/hardware. CWE membedakan root weakness dari CVE yang merupakan vulnerability spesifik dalam produk atau versi tertentu.

Contoh weakness:

- Improper authentication.
- Improper authorization.
- Trust boundary violation.
- Improper input validation.
- Exposure of sensitive information.
- Use of weak cryptography.
- Improper certificate validation.
- Deserialization of untrusted data.

### 4.7 Exploit

Exploit adalah teknik atau langkah konkret untuk memanfaatkan vulnerability.

Contoh:

- Mengubah `caseId` di URL.
- Mengirim JWT dengan `kid` menunjuk key attacker jika resolver tidak aman.
- Mengirim XML dengan external entity.
- Mengirim zip dengan path `../../../../etc/passwd`.
- Mengirim signed request lama berkali-kali.

### 4.8 Risk

Risk adalah kombinasi likelihood dan impact dalam context organisasi/sistem.

Contoh:

- Vulnerability yang sulit dieksploitasi tetapi impact-nya regulatory breach mungkin tetap high risk.
- Vulnerability yang mudah dieksploitasi tetapi hanya menyebabkan error harmless mungkin medium/low risk.
- Vulnerability di admin-only endpoint bisa high risk jika admin account sering dipakai bersama atau tidak memakai MFA.

Risk bukan hanya severity teknis. Risk mencakup business impact, regulatory impact, operational exposure, exploitability, detectability, dan compensating control.

### 4.9 Mitigation dan Control

Mitigation adalah tindakan untuk menurunkan likelihood atau impact.

Control adalah mekanisme pencegahan, deteksi, atau respons.

Contoh:

- Preventive: authorization check, signature verification, input limit.
- Detective: audit log, anomaly alert, checksum mismatch alert.
- Corrective: key rotation, token revocation, rollback.

Control harus dipetakan ke threat. Control yang tidak menutup threat hanya menambah rasa aman palsu.

### 4.10 Residual Risk

Residual risk adalah risk yang tersisa setelah control diterapkan.

Contoh:

- Kita memakai HMAC webhook, tetapi jika shared secret bocor, attacker bisa forge request.
- Kita memakai mTLS internal, tetapi compromised service dengan valid certificate masih bisa mengirim request.
- Kita memakai audit log append-only, tetapi jika root cloud account compromised, storage policy bisa diubah.

Senior engineer harus nyaman mengatakan:

> “Control ini menurunkan risiko X, tetapi residual risk Y masih ada. Kita accept, transfer, avoid, atau mitigate lebih lanjut?”

---

## 5. Security Invariant: Cara Paling Penting untuk Berpikir

Invariant adalah kondisi yang harus selalu benar.

Dalam security, invariant lebih berguna daripada requirement umum.

Requirement umum:

> “User hanya boleh melihat data sendiri.”

Security invariant:

> “Untuk setiap request read case detail, actor harus memiliki relationship valid terhadap case tersebut melalui assignment, ownership, delegation, or supervisory scope yang masih aktif pada saat request diproses. Relationship tersebut harus dicek server-side berdasarkan data authoritative, bukan berdasarkan client-provided role/resource metadata.”

Requirement umum:

> “Audit log tidak boleh diubah.”

Security invariant:

> “Setiap audit record setelah commit harus immutable dari aplikasi normal; setiap perubahan out-of-band terhadap record atau urutan record harus detectable melalui hash chain/signature verification; actor yang bisa menulis audit event tidak boleh bisa mengubah verification material tanpa separate privilege.”

Requirement umum:

> “Webhook harus aman.”

Security invariant:

> “Webhook request hanya diterima jika signature valid terhadap canonical payload, timestamp berada dalam allowed skew window, nonce/idempotency key belum pernah dipakai, source identity sesuai expected partner, dan payload schema valid sebelum business action dijalankan.”

Security invariant harus menjawab:

1. Scope: berlaku untuk operasi apa?
2. Subject: actor mana?
3. Object: resource mana?
4. Condition: state/context apa?
5. Authority: sumber kebenaran apa?
6. Enforcement point: dicek di mana?
7. Failure behavior: jika gagal, apa yang dilakukan?
8. Evidence: bagaimana membuktikan invariant ditegakkan?

---

## 6. Mental Model: Security Property Matrix

Untuk setiap feature, buat matrix sederhana:

```text
Feature: submit enforcement appeal

Asset:
- Appeal content
- Applicant identity
- Case relationship
- Uploaded evidence
- Submission timestamp
- Appeal status

Security properties:
- Confidentiality: appeal content hanya untuk authorized party
- Integrity: appeal content/evidence tidak boleh berubah setelah submit tanpa version trail
- Authenticity: submitter harus benar applicant/delegate authorized
- Authorization: submitter harus boleh submit untuk case tersebut
- Freshness: duplicate submit/replay tidak boleh membuat state ganda
- Availability: large upload tidak boleh melumpuhkan service
- Non-repudiation: submission harus punya evidence siapa/kapan/dari channel apa

Trust boundaries:
- Browser → backend
- Backend → object storage
- Backend → audit trail
- Backend → notification/event system

Potential threats:
- User submit appeal untuk case orang lain
- User mengubah status di request body
- File evidence diganti setelah submit
- Duplicate/replay submission
- Token dicuri dari browser/log
- Upload archive bomb
- Officer mengubah appeal tanpa audit
```

Matrix ini memaksa engineer untuk berpikir sistemik, bukan sekadar endpoint-by-endpoint.

---

## 7. Trust Boundary dalam Java Enterprise System

Java enterprise system biasanya punya banyak boundary yang terlihat “internal” tetapi tetap harus dianggap boundary security.

### 7.1 Browser to Backend

Risiko:

- Client mengirim field yang tidak boleh dipercaya.
- Client mengubah hidden field.
- Client mengubah object ID.
- Client replay request.
- Client mengirim payload besar.
- Client menyisipkan script/input berbahaya.

Rule:

> Semua data dari client adalah untrusted, termasuk data dari UI resmi kamu sendiri.

Jangan pernah percaya:

- `role` dari client.
- `userId` dari request body jika identity harus dari token/session.
- `status` transition dari client tanpa server-side state machine.
- `amount`, `fee`, `score`, `permission`, `tenantId`, `agencyCode` dari client tanpa authoritative validation.

### 7.2 API Gateway to Backend

Risiko:

- Backend terlalu percaya header dari gateway.
- Gateway misconfiguration.
- Internal caller bypass gateway.
- Header spoofing.
- Missing audience validation.

Rule:

> Header identity/context hanya boleh dipercaya jika backend bisa memastikan request benar datang dari trusted gateway path atau header tersebut dihasilkan/ditandatangani oleh trusted component.

Contoh bad pattern:

```text
X-User-Id: 123
X-Role: ADMIN
```

Backend menerima header ini tanpa mTLS, network restriction, signature, atau gateway-only enforcement.

### 7.3 Backend to Database

Risiko:

- Database menjadi confused deputy: aplikasi punya privilege terlalu besar.
- SQL injection.
- Missing row-level authorization.
- Audit trail bisa dimodifikasi.
- Secrets ada di connection string/log.
- Backup berisi data sensitif tidak terlindungi.

Rule:

> Database adalah authoritative store, tetapi bukan magic security layer. Aplikasi tetap harus menegakkan authorization dan integrity invariant.

### 7.4 Backend to Message Broker

Risiko:

- Event palsu.
- Event replay.
- Poison message.
- Consumer percaya event tanpa schema validation.
- Producer identity tidak jelas.
- Broker admin bisa inject/modify message.

Rule:

> Message dari broker harus diperlakukan seperti input dari boundary, terutama jika producer banyak, broker multi-tenant, atau admin/operator punya akses tinggi.

Pertanyaan penting:

1. Apakah event punya producer identity?
2. Apakah event punya schema version?
3. Apakah event punya idempotency/event ID?
4. Apakah event command-like dan bisa mengubah state?
5. Apakah consumer melakukan authorization/semantic validation?
6. Apakah replay event lama bisa merusak state?

### 7.5 Backend to External Agency/System

Risiko:

- TLS trust salah.
- Certificate expired.
- API response tampered.
- Partner mengirim payload invalid.
- Credential partner bocor.
- Replay callback.
- Contract drift.

Rule:

> External integration harus punya explicit trust contract: identity, transport, payload validation, replay protection, error semantics, and audit evidence.

### 7.6 CI/CD to Runtime

Risiko:

- Dependency compromised.
- Build script exfiltrates secret.
- Artifact diganti setelah build.
- Environment variable secret bocor di CI log.
- Unreviewed commit masuk release.
- Test artifact berbeda dari production artifact.

Rule:

> Production security dimulai dari source, dependency, build pipeline, artifact repository, dan deployment manifest.

---

## 8. Attack Surface: Bukan Hanya Endpoint Publik

Attack surface adalah semua titik yang bisa dipakai untuk memengaruhi sistem.

Dalam Java system, attack surface mencakup:

1. Public REST endpoints.
2. Internal REST endpoints.
3. Admin endpoints.
4. Actuator/JMX/management endpoints.
5. Message consumers.
6. Scheduled jobs.
7. File ingestion folder.
8. Object storage event trigger.
9. Database migration scripts.
10. CI/CD pipeline.
11. Build dependency resolution.
12. Logging pipeline.
13. Metrics labels.
14. Tracing baggage/header.
15. Cache keys.
16. Serialization/deserialization boundary.
17. XML/JSON/YAML parser.
18. Template engine.
19. Email/SMS notification template.
20. Third-party SDK.
21. Browser local storage/session storage/cookies.
22. Kubernetes manifest/config map/secret.
23. Cloud metadata service.
24. Runtime diagnostic endpoints.
25. Heap dump/thread dump/profile output.

Senior engineer harus terbiasa melihat attack surface non-obvious.

Contoh:

- APM tag bisa leak PII.
- Prometheus label dengan user input bisa menyebabkan cardinality explosion.
- Error detail bisa leak table/column/internal ID.
- Scheduled retry bisa memproses command lama setelah permission berubah.
- Cache key tanpa tenant prefix bisa menyebabkan cross-tenant data leak.
- Debug endpoint bisa expose env var.
- File name dari user bisa menyebabkan header injection saat download.

---

## 9. Secure by Design vs Secure by Review

### 9.1 Secure by Review

Secure by review berarti kita mendesain dan menulis kode dulu, lalu berharap review menemukan masalah.

Masalahnya:

- Reviewer sering tidak punya full context.
- Review terjadi terlalu lambat.
- Banyak flaw ada di architecture, bukan line of code.
- Fix mahal jika desain sudah salah.
- Review rawan checklist fatigue.

### 9.2 Secure by Design

Secure by design berarti security invariant, trust boundary, dan abuse case dimasukkan sejak desain.

Ciri secure-by-design:

1. Asset dan actor jelas.
2. Trust boundary eksplisit.
3. Security requirement ditulis sebagai invariant.
4. Misuse case dibahas sebelum implementasi.
5. Control dipetakan ke threat.
6. Failure behavior jelas.
7. Evidence/logging dirancang sejak awal.
8. Default deny, least privilege, secure defaults.
9. Review fokus pada invariant, bukan sekadar style.
10. Test mencakup negative/adversarial cases.

OWASP Top 10 secara eksplisit memasukkan insecure design sebagai kategori risiko, dan menekankan threat modeling, secure design patterns, serta reference architecture sebagai respons utama. OWASP Threat Modeling Cheat Sheet juga membagi threat modeling menjadi decomposition, threat identification/ranking, mitigations, dan review/validation.

---

## 10. Design Flaw vs Implementation Bug

Security vulnerability bisa muncul dari bug implementasi atau flaw desain.

### 10.1 Implementation Bug

Contoh:

- Developer lupa menambahkan `@PreAuthorize` di endpoint tertentu.
- Query memakai string concatenation sehingga SQL injection.
- Token expiry dibandingkan salah karena timezone bug.
- Log redaction regex salah.

Bug ini sering bisa ditemukan oleh SAST, test, review, atau scanner.

### 10.2 Design Flaw

Contoh:

- Sistem menganggap internal network selalu trusted.
- Audit log disimpan di table yang bisa diupdate oleh aplikasi yang sama.
- Authorization hanya berdasarkan role, padahal butuh object-level permission.
- Workflow state transition bisa dilakukan oleh batch job tanpa policy enforcement.
- Refresh token tidak punya rotation/reuse detection.
- File evidence tidak punya integrity manifest.
- Multi-service command tidak punya idempotency/freshness boundary.

Design flaw lebih berbahaya karena code bisa terlihat “clean” tetapi invariant salah.

### 10.3 Rule

> Security review yang hanya mencari bug di kode tidak cukup. Harus ada design review yang mencari invariant yang hilang.

---

## 11. Threat Modeling Lightweight untuk Engineer

Threat modeling tidak harus menjadi workshop besar selama seminggu. Untuk feature kecil, cukup 30–60 menit jika framework-nya disiplin.

Gunakan lima pertanyaan:

```text
1. What are we building?
2. What can go wrong?
3. What are we going to do about it?
4. Did we do a good enough job?
5. What evidence proves the control works?
```

OWASP Threat Modeling Cheat Sheet menggunakan pola decomposition, threat identification/ranking, mitigation, dan review/validation. Bentuk lightweight di atas adalah versi engineer-friendly dari pola tersebut.

### 11.1 Step 1 — Decompose the System

Tulis minimal:

- Feature name.
- Data flow.
- Actor.
- Asset.
- Trust boundary.
- External dependency.
- Privileged operation.

Contoh:

```text
Feature: approve compliance case

Actors:
- Officer
- Supervisor
- System scheduler
- Notification worker

Assets:
- Case status
- Approval decision
- Approval reason
- Evidence files
- Audit trail

Data flow:
Browser -> API -> Case Service -> DB
Case Service -> Audit Service -> Audit DB
Case Service -> Message Broker -> Notification Worker

Trust boundaries:
Browser/API
API/DB
API/Broker
Broker/Worker
```

### 11.2 Step 2 — Identify What Can Go Wrong

Gunakan categories seperti STRIDE:

| STRIDE | Pertanyaan |
|---|---|
| Spoofing | Siapa yang bisa berpura-pura menjadi actor lain? |
| Tampering | Data/state/message apa yang bisa diubah? |
| Repudiation | Siapa yang bisa menyangkal action? |
| Information Disclosure | Data apa yang bisa bocor? |
| Denial of Service | Resource apa yang bisa dihabiskan? |
| Elevation of Privilege | Actor apa yang bisa mendapat privilege lebih tinggi? |

Contoh untuk approve case:

```text
Spoofing:
- Attacker memakai stolen token supervisor.
- Internal service mengirim approval event palsu.

Tampering:
- Client mengubah status target menjadi APPROVED.
- DBA/operator mengubah approval reason.

Repudiation:
- Supervisor menyangkal approval.
- System tidak punya evidence IP/session/channel.

Information disclosure:
- Approval reason bocor di log/error.
- Notification membawa confidential details.

Denial of service:
- Repeated approval request menyebabkan lock contention.
- Notification retry storm.

Elevation of privilege:
- Officer biasa memanggil endpoint supervisor.
- User dari division lain approve case bukan scope-nya.
```

### 11.3 Step 3 — Rank Threat

Ranking sederhana:

```text
Risk = likelihood × impact × exposure modifier
```

Tidak perlu pseudo-scientific. Yang penting konsisten.

Gunakan skala:

```text
Likelihood:
1 = sulit/rare
2 = mungkin
3 = mudah/sering

Impact:
1 = minor
2 = significant
3 = severe/regulatory/systemic

Exposure:
1 = internal tightly controlled
2 = authenticated broad user
3 = public/external/multi-tenant/automated abuse possible
```

Contoh:

```text
Threat: officer approve case di luar scope
Likelihood = 2
Impact = 3
Exposure = 2
Priority = high
```

NIST SP 800-30 menempatkan risk assessment sebagai bagian dari risk management dan menggunakan faktor seperti threat, vulnerability, likelihood, impact, dan predisposing conditions. Untuk engineering team, versi ringan tetap harus mempertahankan logika dasar ini: risk bukan hanya daftar vulnerability, tetapi kombinasi context dan konsekuensi.

### 11.4 Step 4 — Define Controls

Setiap control harus menjawab threat tertentu.

Contoh:

| Threat | Control |
|---|---|
| Officer approve case luar scope | Object-level authorization berdasarkan assignment/division active pada server-side |
| Client mengirim target status palsu | Server-side state machine menentukan next status; client tidak boleh menentukan final state langsung |
| Replay approval request | Idempotency key + transition version check |
| Supervisor menyangkal action | Strong auth + audit event dengan actor/session/channel/timestamp + tamper-evident log |
| Approval reason bocor | Logging redaction + field classification |
| Internal event palsu | Producer authorization + schema validation + optional event signature/MAC untuk boundary berisiko |

### 11.5 Step 5 — Validate the Model

Threat model bukan selesai saat dokumen dibuat. Ia harus divalidasi:

- Apakah test mencakup negative path?
- Apakah code enforcement point sesuai desain?
- Apakah log/evidence cukup?
- Apakah operational control tersedia?
- Apakah residual risk diterima secara sadar?
- Apakah threat model berubah ketika deployment topology berubah?

---

## 12. Security Requirement sebagai Contract

Security requirement harus bisa dipakai developer, tester, reviewer, dan auditor.

### 12.1 Requirement Buruk

```text
System must be secure.
```

Tidak testable.

```text
Use encryption.
```

Tidak jelas: encryption apa, untuk data apa, threat apa, key di mana, integrity bagaimana.

```text
Validate user.
```

Tidak jelas authentication atau authorization.

### 12.2 Requirement Lebih Baik

```text
For every case-detail read request, the backend must verify that the authenticated principal has active authorization to access the requested case based on server-side assignment, ownership, delegated access, or supervisory scope. The backend must not rely on client-provided role, agency, division, or assignment metadata.
```

```text
Every externally received webhook must be rejected unless its HMAC signature is valid over the canonical request body, timestamp, method, and path; the timestamp must be within a five-minute skew window; and the nonce/event-id must not have been processed before.
```

```text
All post-submission evidence files must have a persisted SHA-256 digest and immutable storage version ID. Any later read used for regulatory decision must verify digest and storage version consistency before use.
```

### 12.3 Requirement Template

```text
For [operation], when [actor/context], the system must [security guarantee]
using [authoritative source/control], and must fail by [safe failure behavior]
with [audit/evidence], because [threat being mitigated].
```

Contoh:

```text
For approval submission, when an authenticated supervisor submits a decision,
the system must verify object-level authorization using server-side assignment
and case state, and must fail closed with no state mutation if authorization or
state guard fails, with an audit event for denied attempts, because otherwise an
officer could approve cases outside scope or force invalid state transitions.
```

---

## 13. Secure Defaults and Fail-Closed Thinking

Security-sensitive systems harus punya default aman.

### 13.1 Fail Open

Fail open berarti ketika control gagal, sistem tetap mengizinkan operasi.

Contoh:

```java
try {
    authorizationService.check(actor, action, resource);
} catch (Exception e) {
    log.warn("Authorization service failed, allowing request", e);
    return true;
}
```

Ini hampir selalu salah untuk authorization.

### 13.2 Fail Closed

Fail closed berarti ketika control gagal, sistem menolak operasi secara aman.

```java
try {
    authorizationService.check(actor, action, resource);
    return true;
} catch (Exception e) {
    log.error("Authorization check failed; denying request", e);
    return false;
}
```

Namun fail closed juga punya trade-off availability. Jika authorization service down, operasi sah bisa terblokir. Untuk operasi high-risk, ini biasanya benar. Untuk operasi low-risk/read-only tertentu, bisa ada degraded mode, tetapi harus explicit.

### 13.3 Safe Failure Behavior

Setiap security control harus punya failure behavior:

| Control | Safe failure |
|---|---|
| Authorization check | Deny mutation/read unless explicitly public |
| Signature verification | Reject request/event |
| Certificate validation | Reject connection |
| Password hash verification error | Reject login without leaking reason |
| Key loading failure | Fail startup for required key |
| Audit write failure | Usually fail business transaction for high-integrity workflows |
| Redaction failure | Prefer suppress field/log over leaking secret |
| Token parsing failure | Reject token |

---

## 14. Least Privilege and Capability Thinking

Least privilege berarti setiap actor/component hanya punya permission minimum untuk tugasnya.

Namun dalam sistem modern, lebih berguna berpikir dalam bentuk capability:

> “Apa kemampuan yang dimiliki actor ini jika credential-nya bocor?”

Contoh:

- DB user aplikasi bisa `SELECT/INSERT/UPDATE/DELETE` semua table? Jika bocor, blast radius seluruh database.
- Service account bisa membaca semua secret namespace? Jika pod compromised, semua credential bocor.
- CI token bisa publish artifact dan modify deployment? Jika pipeline compromised, attacker bisa ship malicious code.
- Admin API punya endpoint “impersonate user” tanpa audit? Jika admin token bocor, privilege escalation systemic.

Least privilege bukan hanya role name. Ia harus diukur dari blast radius.

### 14.1 Capability Inventory

Untuk setiap service:

```text
Service: Case Service

Capabilities:
- Read/write case records
- Read officer assignment
- Publish case events
- Read evidence metadata
- Write audit event
- Read DB credentials
- Read signing key? no
- Read encryption key? no, via KMS decrypt only
- Call Notification Service
- Call external agency? no
```

Pertanyaan:

1. Capability mana yang tidak perlu?
2. Capability mana yang terlalu broad?
3. Capability mana yang harus dibatasi per environment?
4. Capability mana yang harus punya audit?
5. Capability mana yang butuh separation of duties?

---

## 15. Defense in Depth: Bukan Menumpuk Control Sembarangan

Defense in depth berarti beberapa layer control yang saling melengkapi.

Bukan berarti menambah sebanyak mungkin control tanpa mapping.

Contoh buruk:

```text
Kami punya firewall, WAF, JWT, mTLS, encryption, scanner, jadi aman.
```

Pertanyaan yang benar:

```text
Threat apa yang ditutup firewall?
Threat apa yang ditutup WAF?
Threat apa yang ditutup JWT?
Threat apa yang ditutup mTLS?
Threat apa yang tetap terbuka jika salah satu layer gagal?
```

### 15.1 Layer yang Baik

Untuk endpoint mutation high-risk:

1. Network boundary: hanya gateway bisa akses backend.
2. Authentication: token/session valid.
3. Token validation: issuer/audience/expiry/signature valid.
4. Authorization: actor boleh melakukan action pada object.
5. State guard: resource berada di state yang boleh dimutate.
6. Input validation: payload valid secara schema dan semantic.
7. Business invariant: transition dan side effect konsisten.
8. Idempotency/replay control.
9. Audit event.
10. Monitoring anomaly.

Jika WAF gagal, authorization tetap ada. Jika token dicuri, object-level authorization dan anomaly detection masih membantu. Jika audit DB diubah, tamper-evident chain membantu detection.

---

## 16. Security Control Types

Security control bisa diklasifikasikan berdasarkan kapan bekerja.

### 16.1 Preventive Controls

Mencegah kejadian buruk.

Contoh:

- Authorization check.
- Input validation.
- TLS validation.
- Signature verification.
- Rate limit.
- Least privilege.
- Secure defaults.

### 16.2 Detective Controls

Mendeteksi kejadian buruk atau anomali.

Contoh:

- Audit log.
- Integrity verification job.
- Failed login alert.
- Token reuse detection.
- Unexpected role escalation alert.
- Dependency vulnerability alert.

### 16.3 Corrective Controls

Memulihkan atau mengurangi dampak setelah kejadian.

Contoh:

- Key rotation.
- Token revocation.
- User session invalidation.
- Rollback deployment.
- Restore from backup.
- Patch vulnerable dependency.

### 16.4 Deterrent Controls

Mencegah karena actor tahu tindakan tercatat/dapat dipertanggungjawabkan.

Contoh:

- Tamper-evident audit.
- Named admin account.
- Approval workflow.
- Break-glass audit.

---

## 17. Data Classification untuk Java Engineer

Sebelum memilih control, klasifikasikan data.

### 17.1 Suggested Classification

| Class | Contoh | Treatment |
|---|---|---|
| Public | static public content | integrity tetap penting |
| Internal | config non-secret, internal docs | access limited, not public |
| Confidential | case detail, business record | access control, log redaction |
| Restricted | PII, legal evidence, credential-adjacent data | strict access, audit, masking |
| Secret | password, private key, token, API key | never log, secret manager, rotation |
| Integrity-critical | audit trail, approval decision, evidence digest | tamper-evident, immutable/versioned |

Data bisa punya beberapa classification sekaligus. Evidence file bisa confidential, restricted, dan integrity-critical.

### 17.2 Data Lifecycle

Untuk setiap data class:

```text
collect -> validate -> process -> store -> transmit -> log -> cache -> backup -> archive -> delete
```

Pertanyaan:

1. Apakah data perlu dikumpulkan?
2. Apakah data perlu disimpan?
3. Apakah data masuk log?
4. Apakah data masuk cache?
5. Apakah data masuk queue/event?
6. Apakah data masuk tracing baggage?
7. Apakah data masuk test fixture?
8. Apakah data masuk backup?
9. Apakah data punya retention?
10. Apakah data bisa dihapus tanpa merusak audit/legal requirement?

---

## 18. Identity, Principal, Subject, Actor, Session, Credential

Security design sering rancu karena istilah identity tidak presisi.

### 18.1 Credential

Credential adalah bukti yang dipakai untuk membuktikan identity/capability.

Contoh:

- Password.
- Private key.
- Client secret.
- Access token.
- Refresh token.
- Session cookie.
- API key.
- Certificate.

Credential harus diperlakukan sebagai secret kecuali didesain public seperti public key/certificate public portion.

### 18.2 Identity

Identity adalah entitas yang dikenali sistem.

Contoh:

- User ID.
- Officer ID.
- Service account.
- Client ID.
- Device identity.

### 18.3 Principal

Principal adalah identity yang sudah diautentikasi dalam security context.

Contoh di Java web app:

```text
principal = authenticated user/service extracted from verified token/session
```

### 18.4 Subject

Subject sering berarti entity yang memiliki principal/credential/permissions. Dalam JAAS, `Subject` bisa memuat principal dan credential.

### 18.5 Actor

Actor adalah entity yang melakukan action dalam use case. Actor bisa human, service, batch, system, atau delegated user.

### 18.6 Session

Session adalah continuity context setelah authentication.

Session punya risk:

- fixation.
- hijacking.
- timeout salah.
- logout tidak invalidating server-side.
- cookie flags salah.
- idle timeout vs absolute timeout.

### 18.7 Delegation

Delegation terjadi ketika actor bertindak atas nama actor lain.

Contoh:

- Support officer impersonate user.
- Service A memanggil Service B atas nama user.
- External representative mengajukan aplikasi untuk applicant.

Delegation harus explicit. Jangan mencampur service identity dengan user identity tanpa model.

---

## 19. Authentication vs Authorization: Kesalahan Klasik

Authentication menjawab:

> “Siapa kamu?”

Authorization menjawab:

> “Apakah kamu boleh melakukan action ini terhadap resource ini dalam context ini?”

Kesalahan klasik:

```text
if (user.isAuthenticated()) {
    return caseRepository.findById(caseId);
}
```

Ini hanya authentication, bukan authorization.

Lebih benar:

```text
1. Verify session/token.
2. Extract principal.
3. Load resource from authoritative store.
4. Evaluate policy/action/resource/context.
5. Return only if allowed.
```

Authorization harus dekat dengan domain invariant, bukan hanya HTTP route.

---

## 20. Input Validation vs Sanitization vs Canonicalization

### 20.1 Input Validation

Validasi memastikan input sesuai shape, type, range, dan business constraint.

Contoh:

- `postalCode` harus 6 digit.
- `amount` harus positive dan tidak melebihi limit.
- `caseStatus` tidak boleh langsung ditentukan oleh client.

### 20.2 Sanitization

Sanitization mengubah input agar aman untuk context tertentu.

Contoh:

- HTML sanitization untuk rich text.
- Log redaction.
- Filename normalization.

Sanitization bukan pengganti authorization.

### 20.3 Canonicalization

Canonicalization mengubah input ke bentuk standar sebelum validation/comparison.

Contoh:

- Normalize path sebelum mengecek base directory.
- Normalize Unicode sebelum password/username comparison tertentu.
- Resolve URL sebelum allowlist host check.
- Lowercase canonical email jika policy memang case-insensitive.

Banyak bypass terjadi karena validation dilakukan sebelum canonicalization.

---

## 21. Trusting Data: Source of Authority

Tidak semua data punya authority yang sama.

Contoh field `role`:

| Source | Trust level |
|---|---|
| Request body dari browser | untrusted |
| JWT claim dari trusted issuer setelah signature/audience/issuer validation | trusted for token validity, but still may be stale |
| Database authorization table | authoritative for current permission |
| Cache authorization | trusted only within staleness window |
| Header dari gateway | trusted only if gateway boundary enforced |

Rule:

> Untuk setiap security decision, tentukan source of authority.

Pertanyaan:

1. Data ini berasal dari siapa?
2. Bagaimana data ini diautentikasi?
3. Apakah data ini bisa stale?
4. Apakah data ini bisa dimanipulasi client?
5. Apakah data ini bisa dimanipulasi internal service?
6. Apakah data ini cukup untuk decision?

---

## 22. Time as Security Dependency

Waktu sering menjadi bagian dari security:

- Token expiry.
- Certificate validity.
- Nonce window.
- Password reset expiry.
- Audit timestamp.
- Replay prevention.
- Retention.
- SLA/legal deadline.

Risiko:

- Clock skew antar service.
- Timezone bug.
- Server clock salah.
- Token accepted terlalu lama.
- Audit timestamp berasal dari client.
- Event lama overwrite event baru.

Rule:

> Security-critical timestamp harus berasal dari trusted server-side source, bukan client, dan desain harus mempertimbangkan skew.

Untuk high-integrity audit, pertimbangkan:

- Server receive timestamp.
- Commit timestamp.
- Trusted timestamp authority jika legal requirement tinggi.
- Monotonic sequence untuk ordering.
- Hash chain untuk sequence integrity.

---

## 23. Logging as Security Boundary

Log adalah blessing dan curse.

Log membantu detection, audit, and incident response. Tetapi log juga sering menjadi tempat kebocoran terbesar.

### 23.1 Jangan Log

Jangan log:

- Password.
- Password hash jika tidak perlu.
- Access token.
- Refresh token.
- Session ID.
- API key.
- Private key.
- Full authorization header.
- OTP.
- Reset token.
- Full PII tanpa kebutuhan.
- Full request/response body untuk endpoint sensitive.

### 23.2 Log untuk Security Evidence

Untuk high-risk operation, log/audit harus mencatat:

- Actor ID.
- Actor type.
- Action.
- Resource ID.
- Decision.
- Timestamp server-side.
- Source channel.
- Correlation ID.
- Request ID.
- Previous state.
- New state.
- Reason.
- Policy decision outcome.

Tetapi jangan mencatat secret/confidential payload berlebihan.

### 23.3 Audit Log vs Application Log

Application log:

- Debugging.
- Operational troubleshooting.
- Error diagnosis.

Audit log:

- Evidence.
- Accountability.
- Regulatory trace.
- Security investigation.

Audit log harus lebih structured, protected, immutable/tamper-evident, dan retention-aware.

---

## 24. Security and State Machines

Untuk regulatory/case management system, security sering melekat pada state transition.

Contoh:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> PENDING_APPROVAL -> APPROVED -> ENFORCED
```

Security invariant:

```text
Only applicant can submit DRAFT.
Only assigned officer can move SUBMITTED to UNDER_REVIEW.
Only supervisor can move PENDING_APPROVAL to APPROVED.
No actor can move APPROVED back to DRAFT without formal appeal/reopen process.
Every transition must emit audit event.
```

Kesalahan umum:

- Authorization hanya route-based, bukan transition-based.
- Client menentukan target state.
- Batch job bypass guard.
- Admin endpoint bisa mutate state tanpa reason/audit.
- Retry menyebabkan duplicate transition.
- Event lama menyebabkan state regression.

Rule:

> Untuk domain yang punya lifecycle, authorization harus dievaluasi bersama state transition guard.

---

## 25. Abuse Case: Melihat Sistem Seperti Attacker

Use case menjelaskan bagaimana user sah mencapai tujuan sah.

Abuse case menjelaskan bagaimana actor menyalahgunakan sistem.

Contoh use case:

```text
Officer approves a case after review.
```

Abuse cases:

```text
Officer approves a case assigned to another division.
Officer changes request body to force APPROVED status.
Officer approves then denies action by claiming system error.
Attacker replays approval request.
Compromised service publishes approval event directly.
Admin updates database row manually to skip workflow.
```

Abuse case membuat security requirement jauh lebih konkret.

---

## 26. Security Review Heuristics untuk PR/Design

Gunakan pertanyaan ini saat review:

### 26.1 Actor and Authorization

1. Siapa actor sebenarnya?
2. Apakah actor human, service, batch, atau delegated?
3. Apakah authentication cukup kuat untuk action ini?
4. Apakah authorization object-level?
5. Apakah authorization mempertimbangkan state/context?
6. Apakah ada path lain yang bypass authorization?

### 26.2 Input and Boundary

1. Data mana yang berasal dari untrusted source?
2. Apakah validation dilakukan setelah canonicalization?
3. Apakah size/range/format dibatasi?
4. Apakah parser aman?
5. Apakah error message leak detail?

### 26.3 Integrity

1. Field mana yang tidak boleh ditentukan client?
2. Apakah server menentukan derived/security-critical values?
3. Apakah state transition atomic?
4. Apakah duplicate/replay aman?
5. Apakah tampering bisa dideteksi?

### 26.4 Secrets

1. Apakah ada secret di code/config/log?
2. Apakah secret punya rotation path?
3. Apakah secret scope terlalu luas?
4. Apakah secret masuk exception, metrics, tracing, heap dump?

### 26.5 Cryptography

1. Apakah primitive sesuai property?
2. Apakah key management jelas?
3. Apakah randomness benar?
4. Apakah nonce/IV lifecycle benar?
5. Apakah payload format versioned?

### 26.6 Logging and Audit

1. Apakah security event tercatat?
2. Apakah log tidak leak sensitive data?
3. Apakah audit record immutable/tamper-evident jika dibutuhkan?
4. Apakah correlation cukup untuk investigation?

### 26.7 Failure Mode

1. Jika dependency security down, sistem fail open atau fail closed?
2. Jika key/cert expired, apa yang terjadi?
3. Jika audit write gagal, business transaction tetap commit?
4. Jika token invalid, apakah response leak reason?
5. Jika retry terjadi, apakah side effect duplicate?

---

## 27. Common Java Security Smells

Ini bukan pembahasan mendalam; detail akan muncul di part berikutnya. Untuk Part 0, gunakan daftar ini sebagai radar.

### 27.1 Crypto Smells

- `Cipher.getInstance("AES")` tanpa mode/padding eksplisit.
- ECB mode.
- Hardcoded key.
- Static IV/nonce.
- `Random` untuk token/security.
- MD5/SHA-1 untuk security integrity.
- Password dienkripsi reversible.
- Signature diverifikasi tanpa canonicalization.
- JWT signature valid tetapi issuer/audience/expiry tidak dicek.

### 27.2 TLS Smells

- Trust-all certificate manager.
- Hostname verification disabled.
- Self-signed cert diterima di production tanpa pinning/trust process.
- TLS error ditangani dengan fallback insecure.
- Certificate expiry tidak dimonitor.

### 27.3 Authorization Smells

- `isAuthenticated()` dianggap cukup.
- Authorization hanya di UI.
- Role check tanpa object check.
- Admin endpoint broad.
- Batch job bypass policy.
- Service-to-service call percaya header user tanpa validation.

### 27.4 Data/Logging Smells

- Full request/response logging.
- Authorization header tercetak.
- Exception message dikirim ke user.
- PII masuk metrics label.
- Token tersimpan di localStorage tanpa threat model.

### 27.5 Runtime/Operational Smells

- Actuator expose env/config publicly.
- JMX tanpa auth/network restriction.
- Container running as root.
- Pod bisa read all secrets.
- CI log menampilkan secret.
- Dependency version floating.

---

## 28. Security Decision Record

Untuk keputusan security penting, buat Security Decision Record singkat.

Template:

```text
# Security Decision Record: [title]

## Context
What system/feature is being designed?

## Assets
What must be protected?

## Threats
What can go wrong?

## Decision
What control/design is chosen?

## Alternatives Considered
What else was considered and rejected?

## Security Invariants
What must always remain true?

## Failure Behavior
What happens when control/dependency fails?

## Residual Risk
What remains?

## Operational Requirements
Monitoring, rotation, alerting, audit, runbook.

## Verification
Tests, review, evidence, audit query.
```

Contoh ringkas:

```text
Decision: Webhook requests from Partner X will use HMAC-SHA256 request signing over canonical method, path, timestamp, body digest, and nonce.

Rejected: IP allowlist only, because partner outbound IP may change and IP identity does not protect against payload tampering or replay.

Invariant: A webhook cannot trigger business mutation unless signature is valid, timestamp is fresh, nonce is unused, schema is valid, and event type is authorized for Partner X.

Residual risk: Shared secret compromise allows forgery until rotation. Mitigation: secret stored in secret manager, rotation every 90 days, anomaly alert on nonce/signature failures.
```

---

## 29. Mapping Security to Java Implementation Layers

Security concern tidak selalu ditempatkan di satu layer.

### 29.1 HTTP/Controller Layer

Cocok untuk:

- Request authentication extraction.
- Basic schema validation.
- Request size limit.
- CSRF/session checks.
- Content type enforcement.

Tidak cukup untuk:

- Domain authorization.
- State transition invariant.
- Cross-resource policy.

### 29.2 Application/Use Case Layer

Cocok untuk:

- Use-case authorization.
- Idempotency.
- Workflow guard.
- Audit event generation.
- Transaction boundary.

### 29.3 Domain Layer

Cocok untuk:

- State machine invariant.
- Aggregate consistency.
- Business rule.
- Transition validation.

### 29.4 Infrastructure Layer

Cocok untuk:

- Crypto provider usage.
- Key loading.
- TLS client configuration.
- DB access.
- Message signing/verification.
- File storage integrity.

### 29.5 Runtime/Platform Layer

Cocok untuk:

- Network policy.
- Secret injection.
- Container hardening.
- Certificate distribution.
- Monitoring.
- Audit sink protection.

Rule:

> Jangan letakkan seluruh security di satu layer. Tetapi pastikan setiap invariant punya enforcement point yang jelas dan tidak mudah dibypass.

---

## 30. Example: Secure Approval Flow Mental Model

### 30.1 Naive Flow

```text
POST /cases/{id}/approve
Authorization: Bearer <token>
Body: { "status": "APPROVED", "reason": "ok" }
```

Controller:

```java
if (user.isAuthenticated()) {
    case.status = request.status;
    case.reason = request.reason;
    repository.save(case);
}
```

Masalah:

1. Client menentukan status final.
2. Tidak ada object-level authorization.
3. Tidak ada state guard.
4. Tidak ada idempotency.
5. Tidak ada audit integrity.
6. Tidak ada protection dari replay.
7. Tidak ada separation antara command intent dan resulting state.

### 30.2 Better Mental Model

Command:

```text
ApproveCaseCommand
- caseId
- decisionReason
- idempotencyKey
```

Server determines:

```text
actor = authenticated principal
case = load from DB
allowed = policy.canApprove(actor, case)
nextState = stateMachine.transition(case.state, APPROVE)
audit = create from actor/action/resource/previous/new/timestamp/reason
```

Invariant:

```text
A case can be approved only if:
- actor is authenticated;
- actor has supervisor authority for the case scope;
- case is currently PENDING_APPROVAL;
- command idempotency key has not produced a different result;
- approval reason is valid;
- audit event is committed with the same transaction or reliable outbox;
- client cannot directly choose target status.
```

### 30.3 Security Controls

| Threat | Control |
|---|---|
| User approves other division case | Object-level authorization |
| Client forces status | Server-side state machine |
| Replay approval | Idempotency key + state version |
| Missing evidence | Audit required before/with commit |
| Operator tampering | Tamper-evident audit verification |
| Sensitive reason leaked | Redaction/data classification |

---

## 31. Example: Secure File Evidence Intake

### 31.1 Assets

- File content.
- File metadata.
- Submitter identity.
- Case relationship.
- Digest.
- Storage version ID.
- Malware scan result.
- Audit record.

### 31.2 Threats

- Upload to case not owned/authorized.
- Path traversal.
- Oversized file DoS.
- Archive bomb.
- MIME spoofing.
- Malware.
- Evidence replaced after submission.
- Evidence downloaded by unauthorized actor.
- File hash mismatch ignored.
- Sensitive file logged or previewed insecurely.

### 31.3 Invariants

```text
Evidence file can be attached only to a case the actor is authorized to update.
The server chooses storage path/key; client filename is metadata only.
The persisted evidence record must include digest, size, content type decision, storage version, submitter, case ID, and timestamp.
No downstream decision may rely on an evidence file whose digest/storage version verification fails.
```

### 31.4 Controls

- Object-level authorization before accepting upload.
- Server-generated object key.
- File size limit.
- Streaming digest.
- Malware scan or quarantine flow.
- Content validation.
- Immutable/versioned storage.
- Audit event.
- Download authorization.
- Secure response headers.

---

## 32. Example: Service-to-Service Trust

### 32.1 Bad Pattern

```text
Service A calls Service B:
X-User-Id: 123
X-Role: SUPERVISOR
```

Service B trusts these headers.

Problem:

- Any caller reaching Service B can spoof user/role.
- Service B cannot distinguish gateway-generated vs attacker-generated header.
- No audience binding.
- No delegation model.

### 32.2 Better Pattern

Options depend on architecture:

1. Service B validates end-user token directly, including issuer/audience/expiry.
2. Gateway exchanges token for internal token with constrained audience.
3. Service A calls Service B using service identity plus explicit delegated user context signed/bound by trusted issuer.
4. mTLS authenticates service identity, while authorization still checks whether service is allowed to perform action and whether user context is valid.

Invariant:

```text
Service B must not make authorization decisions from unauthenticated caller-supplied identity headers.
```

---

## 33. Example: Audit Trail Integrity

### 33.1 Weak Audit

```text
AUDIT_TRAIL table:
- id
- actor
- action
- resource
- timestamp
- metadata
```

Application can insert, update, delete. DBA can update manually. No detection.

This is useful logging, but weak evidence.

### 33.2 Stronger Audit Model

Additional controls:

- Append-only application permission.
- No update/delete for app user.
- Hash chain: each record includes previous record hash.
- Periodic anchoring/signing of batch root hash.
- Separate verification job.
- Storage retention policy.
- Alert on chain break.
- Separate role for audit verification material.

Invariant:

```text
After an audit event is committed, any deletion, mutation, reordering, or insertion gap must be detectable by verification.
```

This does not make tampering impossible by a superuser, but makes tampering detectable if verification material is protected separately.

---

## 34. Risk Appetite and Engineering Trade-offs

Security is not absolute. It is risk management.

Examples of trade-off:

- Short token lifetime improves security but increases refresh complexity.
- Fail-closed audit write improves integrity but can reduce availability.
- mTLS improves service authenticity but increases certificate lifecycle burden.
- HSM improves key custody but increases operational complexity/cost.
- Very high password hashing cost improves offline attack resistance but can cause login DoS if not capacity planned.
- Full payload audit improves evidence but increases privacy and storage risk.

Senior engineer must communicate trade-off honestly:

```text
Option A gives stronger integrity but can block business flow during audit sink outage.
Option B keeps availability but accepts risk of unaudited mutation for a short window.
Given regulatory importance of approval actions, I recommend fail-closed for approval mutation and fail-open-with-buffer only for low-risk notification events.
```

---

## 35. Security Anti-Patterns at Architecture Level

### 35.1 “Internal Network is Trusted”

Internal network reduces exposure; it does not eliminate threat.

Internal callers can be compromised. Pods can be compromised. Misrouting can happen. Operators can make mistakes. SSRF can reach internal service.

### 35.2 “We Use HTTPS, So Payload is Safe”

TLS protects transport between endpoints. It does not validate business authorization, payload semantics, replay, or downstream integrity after termination.

### 35.3 “JWT is Valid, So User Can Do It”

JWT validity proves token authenticity under certain checks. It does not prove object-level authorization.

### 35.4 “Encryption Solves Compliance”

Encryption without key management, access control, audit, retention, and operational procedure is incomplete.

### 35.5 “Admin Can Do Anything”

Admin capability should be explicit, audited, minimized, and separated. “Admin can do anything” creates systemic blast radius.

### 35.6 “Logs Are Safe Because Only Internal People Access Them”

Logs are copied, indexed, retained, exported, queried, and sometimes shared. Treat logs as a data boundary.

### 35.7 “Scanner Passed, So Secure”

Scanner finds known patterns. It rarely proves business authorization, workflow integrity, audit defensibility, or abuse-case resistance.

---

## 36. Security Thinking for Code Generation and LLM-Assisted Development

Karena modern engineer sering memakai AI coding tools, security mental model harus dipakai saat menerima generated code.

Generated code sering terlihat clean tetapi bisa salah di security invariant.

Review LLM-generated code dengan pertanyaan:

1. Apakah ia membuat authorization check yang hanya superficial?
2. Apakah ia mempercayai client-provided user ID/role/status?
3. Apakah ia memakai insecure crypto default?
4. Apakah ia menambahkan logging yang membocorkan secret?
5. Apakah ia men-disable TLS/certificate validation untuk “fix error”?
6. Apakah ia memakai broad catch lalu fail open?
7. Apakah ia membuat state mutation tanpa idempotency?
8. Apakah ia membuat parser/deserializer polymorphic tanpa guard?
9. Apakah ia membuat token tanpa expiry/purpose binding?
10. Apakah ia melewatkan negative/adversarial tests?

Rule:

> Treat generated code as untrusted draft until security invariant, trust boundary, and failure behavior are manually verified.

---

## 37. Practical Security Design Worksheet

Gunakan worksheet ini untuk setiap feature high-risk.

```text
# Security Design Worksheet

## 1. Feature
Name:
Business purpose:
Criticality:

## 2. Assets
Data assets:
Capability assets:
Integrity-critical records:
Secrets involved:

## 3. Actors
Human actors:
Service actors:
Admin/operator actors:
External actors:
Possible malicious/compromised actors:

## 4. Trust Boundaries
Boundary 1:
Boundary 2:
Boundary 3:

## 5. Data Flow
Source:
Processing components:
Storage:
Downstream propagation:
Logs/audit:

## 6. Security Properties Required
Confidentiality:
Integrity:
Authenticity:
Authorization:
Availability:
Freshness:
Non-repudiation:
Privacy:

## 7. Abuse Cases
Abuse case 1:
Abuse case 2:
Abuse case 3:

## 8. Security Invariants
Invariant 1:
Invariant 2:
Invariant 3:

## 9. Controls
Preventive:
Detective:
Corrective:

## 10. Failure Behavior
Auth service failure:
Key/cert failure:
Audit failure:
Downstream failure:
Replay/duplicate:

## 11. Residual Risk
Accepted risks:
Open questions:
Required sign-off:

## 12. Verification
Unit tests:
Integration tests:
Security tests:
Operational checks:
Audit queries:
```

---

## 38. Security Test Thinking

Security tests harus menguji forbidden path.

### 38.1 Authorization Tests

```text
Given user A and case owned by user B,
when user A requests case B detail,
then system returns forbidden and no sensitive data is returned.
```

```text
Given officer without supervisor scope,
when officer sends approve command,
then case state remains unchanged and denied attempt is audited.
```

### 38.2 Integrity Tests

```text
Given client sends target status APPROVED in request body,
when command is processed,
then server ignores client target status and computes transition from domain state machine.
```

### 38.3 Replay Tests

```text
Given same signed webhook event ID is submitted twice,
when second request arrives,
then system rejects or returns idempotent result without duplicate side effects.
```

### 38.4 Logging Tests

```text
Given request contains Authorization header,
when request is logged,
then token value is redacted.
```

### 38.5 Failure Mode Tests

```text
Given signature verification service fails,
when webhook request arrives,
then request is rejected and no business mutation occurs.
```

---

## 39. How This Part Connects to Future Parts

Part berikutnya akan membahas Java security architecture: JCA, JCE, JSSE, CertPath, `KeyStore`, `TrustStore`, provider architecture, and runtime security properties.

Mental model Part 0 akan terus dipakai:

| Future topic | Mental model from Part 0 |
|---|---|
| JCA/JCE | primitive harus dipilih berdasarkan property |
| SecureRandom | randomness sebagai dependency security |
| Hashing | integrity vs password storage vs checksum |
| AES-GCM | confidentiality + integrity + nonce invariant |
| HMAC | authenticity/integrity + key separation |
| Digital signature | authenticity + non-repudiation + key custody |
| TLS | transport authenticity/confidentiality/integrity |
| JWT | token authenticity bukan authorization lengkap |
| Key management | key lifecycle sebagai asset lifecycle |
| Audit trail | evidence integrity dan non-repudiation |
| Supply chain | artifact/build dependency sebagai trust boundary |
| Runtime hardening | JVM/container/cloud sebagai attack surface |

---

## 40. Summary

Security engineering untuk Java bukan dimulai dari API. Ia dimulai dari cara berpikir.

Hal paling penting dari Part 0:

1. Security adalah constraint sistem, bukan fitur tambahan.
2. “Aman” harus dipecah menjadi property: confidentiality, integrity, authenticity, authorization, availability, freshness, non-repudiation, privacy.
3. Asset bisa berupa data maupun capability.
4. Trust boundary adalah titik perubahan level trust; setiap boundary butuh validation/authentication/authorization/integrity reasoning.
5. Threat, vulnerability, weakness, exploit, risk, mitigation, dan residual risk harus dibedakan.
6. Security requirement terbaik ditulis sebagai invariant yang testable.
7. Secure-by-design lebih efektif daripada hanya secure-by-review.
8. Threat modeling lightweight cukup untuk banyak feature jika disiplin.
9. Authorization harus object/context/state-aware, bukan hanya authenticated atau role-based.
10. Logging dan audit adalah security boundary, bukan hanya debugging tool.
11. Java enterprise security mencakup browser, backend, DB, broker, file storage, CI/CD, runtime, dependency, cloud, and operators.
12. Semua part berikutnya akan memakai mental model ini untuk membahas Java security, cryptography, dan integrity secara detail.

---

## 41. Review Questions

Gunakan pertanyaan ini untuk mengecek pemahaman:

1. Apa bedanya confidentiality dan integrity? Berikan contoh di case management system.
2. Kenapa valid JWT belum cukup untuk authorization?
3. Apa bedanya vulnerability dan threat?
4. Kenapa internal service tetap perlu dianggap boundary?
5. Apa contoh security invariant yang lebih baik dari “user hanya boleh melihat data sendiri”?
6. Apa yang dimaksud fail closed? Kapan fail closed bisa punya trade-off availability?
7. Mengapa audit log biasa belum tentu cukup untuk non-repudiation?
8. Apa risiko dari mempercayai `X-User-Id` header?
9. Bagaimana replay attack bisa terjadi pada request yang signature-nya valid?
10. Apa yang harus dicek saat LLM menghasilkan kode security-sensitive?

---

## 42. Mini Exercise

Ambil satu feature nyata, misalnya:

```text
Submit application
Approve case
Upload evidence
Send notification
Receive webhook
Generate report
Sync external agency data
```

Isi ringkas:

```text
Asset:
Actor:
Trust boundaries:
Security properties:
Abuse cases:
Security invariants:
Preventive controls:
Detective controls:
Failure behavior:
Residual risk:
```

Jika kamu tidak bisa menuliskan security invariant untuk feature tersebut, desainnya belum siap untuk implementasi security-sensitive.

---

## 43. References

Referensi yang relevan untuk fondasi Part 0:

1. OWASP Threat Modeling Cheat Sheet — decomposition, threat identification/ranking, mitigation, and review/validation.  
   https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html

2. OWASP Threat Modeling overview — threat modeling as structured representation of information affecting application security.  
   https://owasp.org/www-community/Threat_Modeling

3. OWASP Application Security Verification Standard — basis for testing technical security controls and secure development requirements.  
   https://owasp.org/www-project-application-security-verification-standard/

4. OWASP Top 10 2025 — Insecure Design category emphasizes design and architectural flaws, threat modeling, secure design patterns, and reference architectures.  
   https://owasp.org/Top10/2025/A06_2025-Insecure_Design/

5. NIST SP 800-30 Rev. 1 — Guide for Conducting Risk Assessments.  
   https://csrc.nist.gov/pubs/sp/800/30/r1/final

6. NIST Cybersecurity Framework 2.0 — Govern, Identify, Protect, Detect, Respond, Recover.  
   https://nvlpubs.nist.gov/nistpubs/CSWP/NIST.CSWP.29.pdf

7. Oracle Secure Coding Guidelines for Java SE — Java-specific secure coding principles and examples.  
   https://www.oracle.com/java/technologies/javase/seccodeguide.html

8. Oracle Java Security Overview — Java platform security APIs and architecture.  
   https://docs.oracle.com/en/java/javase/25/security/java-security-overview1.html

9. Oracle Java Cryptography Architecture Reference Guide — provider architecture and cryptographic APIs.  
   https://docs.oracle.com/en/java/javase/25/security/java-cryptography-architecture-jca-reference-guide.html

10. MITRE CWE — common language for software and hardware weakness types.  
    https://cwe.mitre.org/

---

## 44. Seri Status

Seri belum selesai.

Progress:

```text
[x] Part 0  — Security Mental Model for Senior Java Engineers
[ ] Part 1  — Java Security Architecture: JCA, JCE, JAAS, JSSE, JGSS, SASL, CertPath
[ ] Part 2  — Threat Modeling for Java Systems
[ ] Part 3  — Cryptography Mental Model: What Crypto Can and Cannot Guarantee
[ ] Part 4  — Randomness, Entropy, Nonce, Salt, IV, Token
[ ] Part 5  — Hashing, Digest, Fingerprint, Checksum, and Integrity Boundaries
[ ] Part 6  — Password Storage, Password Verification, and Secret-Derived Keys
[ ] Part 7  — Symmetric Encryption in Java: AES, Modes, Padding, AEAD
[ ] Part 8  — Message Authentication Code: HMAC, CMAC, and Integrity Tokens
[ ] Part 9  — Digital Signature: RSA, ECDSA, EdDSA, Signing Semantics
[ ] Part 10 — Asymmetric Encryption and Key Agreement
[ ] Part 11 — Key Management: Lifecycle, Rotation, Wrapping, KMS, HSM
[ ] Part 12 — Java KeyStore, TrustStore, Certificates, and Private Key Custody
[ ] Part 13 — X.509, PKI, Certificate Path Validation, Revocation
[ ] Part 14 — TLS/JSSE Deep Dive for Java Engineers
[ ] Part 15 — TLS Hardening, Disabled Algorithms, and Runtime Security Properties
[ ] Part 16 — Secure Serialization, Deserialization, and Object Integrity
[ ] Part 17 — Secure File, Archive, and Data Transfer Integrity
[ ] Part 18 — XML Security, XXE, XML Signature, XML Encryption
[ ] Part 19 — JSON, JWT, JWS, JWE, JOSE, and Token Integrity
[ ] Part 20 — OAuth2/OIDC Security for Java Systems Without Repeating Jakarta/JAX-RS
[ ] Part 21 — Authorization Integrity: Policy, Permission, and Confused Deputy
[ ] Part 22 — Input Validation, Canonicalization, Injection Resistance
[ ] Part 23 — Secure Coding in Java: Dangerous APIs, Footguns, and Review Heuristics
[ ] Part 24 — Secrets Management in Java Applications
[ ] Part 25 — Secure Logging, Audit Trail Integrity, Evidence, and Non-Repudiation
[ ] Part 26 — Data Integrity in Distributed Java Systems
[ ] Part 27 — Supply Chain Security for Java: Maven, Gradle, SBOM, Provenance
[ ] Part 28 — Signed JARs, JAR Integrity, Classloading, and Runtime Trust
[ ] Part 29 — Secure Build, CI/CD, and Release Integrity for Java
[ ] Part 30 — Runtime Hardening: JVM, Container, OS, Network
[ ] Part 31 — Security Testing: Unit, Property, Fuzzing, SAST, DAST, IAST
[ ] Part 32 — Incident Response for Java Security Failures
[ ] Part 33 — Secure Design Patterns and Anti-Patterns for Java Enterprise Systems
[ ] Part 34 — Capstone: Designing a Secure Java Regulatory Case Management Platform
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-security-cryptography-integrity-part-001.md">Java Security Architecture: JCA, JCE, JAAS, JSSE, JGSS, SASL, CertPath ➡️</a>
</div>

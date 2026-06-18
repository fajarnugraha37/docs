# learn-java-security-cryptography-integrity-part-016

# Part 16 — Secure Serialization, Deserialization, and Object Integrity

> Seri: `learn-java-security-cryptography-integrity`  
> Bagian: `016` dari `034`  
> Status seri: **belum selesai**  
> Fokus: Java deserialization security, object integrity, trusted data boundary, object graph filtering, parser hardening, signed payload, schema boundary, dan safer data exchange pattern.

---

## 1. Tujuan Part Ini

Pada seri I/O sebelumnya, serialization mungkin sudah pernah dibahas dari sisi mekanik: `Serializable`, `ObjectOutputStream`, `ObjectInputStream`, stream, file, network, dan data transfer.

Part ini **tidak mengulang serialization sebagai fitur I/O**.

Part ini membahas serialization dari sudut security:

1. Kenapa **deserialization adalah execution boundary**, bukan sekadar parsing data.
2. Kenapa **object graph dari luar tidak boleh dipercaya**.
3. Bagaimana Java native serialization bisa berubah menjadi remote code execution, denial-of-service, privilege abuse, atau integrity violation.
4. Bagaimana `ObjectInputFilter` membantu membatasi class, depth, array length, object count, dan stream size.
5. Kenapa filter adalah mitigation, bukan pembenaran untuk menerima serialized object dari untrusted source.
6. Bagaimana membangun boundary DTO/schema yang aman.
7. Bagaimana menangani JSON/XML/YAML polymorphic deserialization dengan disiplin security.
8. Bagaimana membuat signed/verified payload tanpa jatuh ke false sense of security.
9. Bagaimana mendesain object integrity dalam sistem Java enterprise.

Target setelah part ini:

- Kamu bisa melihat setiap deserialization sebagai **trust transition**.
- Kamu bisa membedakan **data format** dari **object construction mechanism**.
- Kamu bisa menilai apakah sebuah endpoint, queue consumer, file import, cache restore, session restore, atau RMI/JMX/JMS integration punya risiko deserialization.
- Kamu bisa membuat review checklist yang usable untuk production Java system.

---

## 2. Mental Model Utama

### 2.1 Serialization adalah membekukan object graph

Serialization mengubah object graph runtime menjadi representation yang bisa disimpan atau dikirim.

Deserialization mengubah representation itu kembali menjadi object graph runtime.

Masalahnya:

> Object graph bukan data netral. Object graph membawa class name, field value, shape, reference topology, dan kadang behavior trigger.

Dalam Java native serialization, input stream dapat menentukan class apa yang akan direkonstruksi selama class tersebut tersedia di classpath dan lolos mekanisme resolution/filtering.

Artinya, ketika kamu melakukan:

```java
Object obj = objectInputStream.readObject();
```

secara mental kamu bukan sekadar membaca data.

Kamu sedang mengatakan:

> “Saya mengizinkan byte dari luar memengaruhi proses konstruksi object di JVM saya.”

Itu boundary besar.

---

### 2.2 Deserialization adalah controlled object construction

Constructor normal punya banyak guardrail:

```java
public Money(BigDecimal amount, Currency currency) {
    if (amount.signum() < 0) {
        throw new IllegalArgumentException("amount must not be negative");
    }
    this.amount = amount;
    this.currency = Objects.requireNonNull(currency);
}
```

Tetapi deserialization bisa mengisi field melalui mekanisme khusus dan memanggil hook tertentu seperti:

- `readObject`
- `readResolve`
- `readExternal`
- `validateObject`
- custom library deserializer
- reflection-based field setting
- polymorphic type resolution

Maka invariant class bisa rusak jika class tidak dirancang aman untuk deserialization.

Contoh invariant:

```text
Money.amount must be non-negative.
Case.status must be one of allowed state transitions.
User.role must not be escalated by inbound payload.
EvidenceFile.digest must match file content.
AuditRecord.createdBy must come from authenticated principal, not payload.
```

Jika deserialization melewati factory/service validation, object bisa terlihat valid secara type tetapi invalid secara domain.

---

### 2.3 Data format bukan trust boundary

Kesalahan umum:

```text
“Itu hanya JSON.”
“Itu hanya XML.”
“Itu hanya YAML.”
“Itu internal queue.”
“Itu file backup.”
“Itu dari cache.”
“Itu signed, jadi aman.”
```

Format tidak menentukan aman/tidaknya.

Yang penting:

1. Siapa yang bisa memproduksi payload?
2. Siapa yang bisa mengubah payload?
3. Class/type apa yang boleh dibangun?
4. Field apa yang authoritative?
5. Invariant apa yang diverifikasi ulang setelah parse?
6. Apakah parser/deserializer punya dynamic type loading?
7. Apakah ada code execution hook?
8. Apakah ada resource exhaustion risk?
9. Apakah payload punya version, schema, expiry, nonce, atau signature?
10. Apakah signature diverifikasi sebelum object construction berbahaya?

---

### 2.4 Deserialization failure classes

Risiko deserialization bisa dikelompokkan menjadi beberapa kelas:

| Failure Class | Bentuk | Dampak |
|---|---|---|
| Arbitrary class construction | Payload memaksa JVM membangun class tertentu | gadget chain, RCE |
| Gadget execution | Method hook dari object graph menjalankan behavior berbahaya | RCE, SSRF, file write |
| Resource exhaustion | Graph terlalu dalam/besar, array raksasa, cyclic structure | DoS, heap exhaustion, CPU spike |
| Invariant bypass | Object dibuat tanpa domain validation normal | privilege escalation, data corruption |
| Type confusion | Payload memilih subtype tak terduga | logic bypass |
| Mass assignment | Field sensitif diisi dari payload | role escalation, ownership spoofing |
| Parser feature abuse | XML entity, YAML tag, polymorphic type metadata | XXE/RCE/SSRF |
| Trust boundary collapse | Internal-only payload ternyata bisa dipengaruhi attacker | lateral compromise |
| Replay/stale object | Serialized object lama diterima kembali | rollback attack, state corruption |
| Signed-but-wrong semantics | Signature benar tetapi domain/context salah | confused payload reuse |

---

## 3. Problem yang Sering Salah Dipahami

### 3.1 “Kami tidak memakai Java serialization” belum tentu aman

Banyak sistem tidak secara eksplisit menulis `new ObjectInputStream(...)`, tetapi masih bisa terkena deserialization risk melalui:

- HTTP session replication.
- Distributed cache.
- Message broker payload.
- RMI.
- JMX.
- Legacy EJB.
- Java remoting framework.
- Old RPC framework.
- Workflow engine variable serialization.
- Job scheduler persistence.
- Binary object cache.
- Test/debug endpoint.
- Third-party library.
- XML decoder.
- JSON polymorphic deserialization.
- YAML parser dengan type tag.

Pertanyaan review bukan:

> “Apakah kita memakai Java serialization di business code?”

Pertanyaan yang lebih tepat:

> “Apakah ada komponen yang mengubah bytes/text dari storage/network/user menjadi object runtime dengan type yang bisa dipengaruhi payload?”

---

### 3.2 “Internal traffic” bukan trust guarantee

Internal channel sering dianggap aman:

- Kafka/RabbitMQ topic internal.
- Redis cache internal.
- S3 bucket internal.
- NFS share internal.
- Batch folder internal.
- Admin upload internal.
- Inter-service HTTP internal.

Tetapi dalam threat model modern, internal source tetap bisa compromised:

- service A sudah compromise dan mengirim payload ke service B;
- credential broker bocor;
- bucket policy salah;
- queue producer permission terlalu luas;
- CI job bisa menulis test artifact ke shared location;
- admin user upload file dari laptop yang compromised;
- backup restore mengambil file dari environment lama;
- cache poisoning terjadi lewat bug logic.

Maka internal payload tetap perlu bounded deserialization.

---

### 3.3 Signature tidak otomatis membuat deserialization aman

Signed payload hanya membuktikan payload berasal dari key tertentu dan belum berubah sejak ditandatangani.

Signature tidak membuktikan:

- payload aman untuk dideserialize;
- payload sesuai schema saat ini;
- payload belum expired;
- payload tidak replayed;
- payload tidak dipakai pada context yang salah;
- signer tidak compromised;
- signer punya authorization untuk action tersebut;
- object graph tidak mengandung gadget class berbahaya;
- field domain valid;
- version payload compatible;
- payload tidak terlalu besar.

Signature harus dikombinasikan dengan:

1. Verification sebelum parse berbahaya.
2. Canonicalization format.
3. Context binding.
4. Expiry/freshness.
5. Schema validation.
6. Type allowlist.
7. Domain invariant validation.
8. Authorization decision.

---

### 3.4 Filtering bukan silver bullet

`ObjectInputFilter` penting, tetapi bukan alasan untuk menerima native serialized object dari internet.

Filter membantu menjawab:

```text
Class apa yang boleh?
Class apa yang ditolak?
Seberapa dalam graph boleh?
Berapa banyak reference boleh?
Berapa besar array boleh?
Berapa bytes boleh dibaca?
```

Tetapi filter tidak otomatis memahami domain invariant:

```text
Apakah user boleh mengubah role?
Apakah case boleh lompat dari CLOSED ke APPROVED?
Apakah evidence hash valid?
Apakah object dibuat dari workflow yang sah?
Apakah timestamp replay?
```

Jadi filtering adalah **runtime containment**, bukan **business correctness**.

---

## 4. Core Concepts

## 4.1 Deserialization Source Taxonomy

Kamu perlu inventory semua tempat deserialization terjadi.

| Source | Typical Risk | Review Focus |
|---|---|---|
| HTTP request body | public attacker-controlled input | parser config, schema, size, polymorphism |
| File upload | attacker-controlled file | format validation, archive bomb, XML/YAML risk |
| Message queue | semi-trusted async input | producer authorization, schema, replay, poison message |
| Cache | trusted-looking mutable storage | cache poisoning, stale object, type confusion |
| Session store | user/session boundary | session fixation, object graph filter |
| Database serialized column | persistent object rehydration | stale schema, migration, tampering, object integrity |
| Backup/import | operational trust boundary | provenance, signature, schema version |
| RMI/JMX/JMS legacy | protocol-level object deserialization | disable, filter, network isolation |
| Third-party callback | external integration | signed canonical payload, replay protection |
| Admin import tool | high privilege input | strict validation, audit, sandboxing |

---

## 4.2 Trust Level Taxonomy

Tidak semua source sama.

```text
Level 0 — Fully attacker-controlled
Public HTTP body, unauthenticated upload, internet callback.

Level 1 — Authenticated but untrusted user-controlled
Logged-in user request, user-owned file, user-managed profile field.

Level 2 — Partner-controlled
Webhook, SFTP drop, external agency integration.

Level 3 — Internal service-controlled
Message from another service, internal API, internal batch.

Level 4 — Operator-controlled
Admin import, migration file, runbook-generated artifact.

Level 5 — Build/runtime-controlled
Application-owned persisted state, signed release artifact, generated cache.
```

Important point:

> Higher level means lower probability of malicious input, not zero validation requirement.

Even Level 5 can be corrupted by bugs, compromised credentials, rollback, deployment mismatch, or storage tampering.

---

## 4.3 Object Graph Risk

Serialized payload is not a flat record. It may encode an object graph.

Risk dimensions:

1. **Class set** — class apa saja yang bisa muncul?
2. **Graph depth** — seberapa dalam nested object?
3. **Reference count** — berapa banyak object/reference?
4. **Array length** — apakah payload bisa meminta array sangat besar?
5. **String length** — apakah bisa membuat memory spike?
6. **Cycles** — apakah ada circular reference?
7. **Polymorphism** — subtype apa yang muncul?
8. **Hooks** — method apa yang dipanggil saat rehydration?
9. **Transient data** — field apa yang tidak ikut diserialize?
10. **Invariant restoration** — validasi apa yang harus jalan setelah rehydration?

---

## 4.4 Gadget Chain Mental Model

Gadget chain adalah rangkaian class yang sebenarnya legitimate, tetapi ketika digabung dalam object graph tertentu dan diproses oleh deserialization/hook, menghasilkan behavior berbahaya.

Mental model:

```text
Payload bytes
  -> ObjectInputStream reads object graph
  -> class resolution loads existing classes
  -> readObject/readResolve/comparator/toString/hashCode/etc. invoked in flow tertentu
  -> library gadget performs behavior
  -> command execution / file write / network call / class loading / JNDI lookup / SSRF / DoS
```

Attacker tidak harus mengirim class baru.

Attacker hanya perlu menyusun object dari class yang sudah ada di classpath.

Itulah kenapa supply chain dan deserialization saling berhubungan:

> Semakin kaya classpath aplikasi, semakin luas gadget surface.

Enterprise Java app biasanya punya classpath besar: Spring, Jakarta, ORM, JSON/XML, logging, template engine, cloud SDK, database driver, cache client, messaging client, legacy libraries.

---

## 4.5 Object Integrity vs Transport Integrity

Transport integrity memastikan data tidak berubah saat transit.

Contoh:

- TLS message integrity.
- mTLS server/client authentication.
- request signing.
- HMAC webhook.

Object integrity memastikan object yang sudah diparse memenuhi invariant.

Contoh:

- `caseId` milik tenant yang benar.
- status transition valid.
- actor berasal dari authenticated principal.
- amount tidak negatif.
- role tidak bisa diisi dari request.
- evidence digest cocok dengan content.
- submittedAt tidak bisa di-backdate oleh client.

Keduanya berbeda.

```text
TLS bisa benar, tetapi payload tetap malicious.
Signature bisa benar, tetapi object tetap invalid.
Schema bisa valid, tetapi authorization tetap salah.
```

---

## 5. Java Native Serialization Security

## 5.1 Kenapa Java native serialization berisiko

Java native serialization didesain untuk menyimpan dan mengirim object graph Java, bukan sebagai universal secure data interchange format untuk untrusted input.

Risiko utamanya:

1. Payload dapat menentukan graph class tertentu.
2. Deserialization memanggil mekanisme khusus class.
3. Classpath besar membuka gadget surface.
4. Object bisa dibangun melewati constructor normal.
5. Graph bisa sangat besar/dalam.
6. Versioning sulit dan brittle.
7. Sulit diaudit dibanding schema eksplisit.
8. Format terikat pada Java class implementation.
9. Boundary domain dan persistence menjadi kabur.
10. Banyak framework legacy pernah memakai serialization secara implicit.

---

## 5.2 Dangerous pattern: direct `readObject` from untrusted input

Contoh buruk:

```java
@PostMapping("/restore")
public ResponseEntity<?> restore(@RequestBody byte[] body) throws Exception {
    try (ObjectInputStream in = new ObjectInputStream(new ByteArrayInputStream(body))) {
        Object object = in.readObject();
        restoreService.restore(object);
        return ResponseEntity.ok().build();
    }
}
```

Masalah:

- Tidak ada class allowlist.
- Tidak ada size limit yang jelas.
- Tidak ada graph depth limit.
- Tidak ada schema.
- Tidak ada signature/provenance.
- Tidak ada version envelope.
- Tidak ada domain validation sebelum use.
- HTTP client mengontrol object graph.

Versi lebih aman biasanya bukan “tambahkan filter lalu selesai”, tetapi ubah format menjadi DTO/schema eksplisit.

---

## 5.3 Safer alternative: explicit DTO boundary

```java
public record RestoreRequest(
        String exportVersion,
        String tenantId,
        List<CaseSnapshotDto> cases
) {}

public record CaseSnapshotDto(
        String caseId,
        String status,
        Instant lastUpdatedAt,
        List<EvidenceSnapshotDto> evidences
) {}
```

Flow aman:

```text
bytes
  -> size limit
  -> parse as JSON/CBOR/Protobuf with safe parser config
  -> schema validation
  -> DTO validation
  -> authorization check
  -> domain command construction
  -> aggregate/service enforces invariant
  -> persistence
```

Key point:

> Deserialized DTO bukan domain object final. DTO hanya input untuk domain operation.

---

## 5.4 If native serialization cannot be removed immediately

Kadang sistem legacy belum bisa langsung migrasi.

Mitigation minimum:

1. Jangan expose native serialization ke public boundary.
2. Isolate network access.
3. Apply `ObjectInputFilter` globally and per stream.
4. Use allowlist, not broad blocklist.
5. Limit depth, references, array length, and bytes.
6. Remove dangerous gadget libraries if possible.
7. Disable legacy endpoints/protocols not needed.
8. Add telemetry for rejected classes.
9. Add migration plan to explicit schema.
10. Treat this as technical debt with security severity.

---

## 6. ObjectInputFilter Deep Dive

## 6.1 What `ObjectInputFilter` does

`ObjectInputFilter` lets the application inspect incoming serialization stream metadata before/while deserialization proceeds.

It can decide:

- `ALLOWED`
- `REJECTED`
- `UNDECIDED`

Filtering can consider:

- class being deserialized;
- array length;
- graph depth;
- number of references;
- stream bytes;
- custom rules.

This is security-relevant because it narrows what the JVM is allowed to construct.

---

## 6.2 Pattern-based filter example

Example concept:

```java
ObjectInputFilter filter = ObjectInputFilter.Config.createFilter(
        "maxdepth=10;maxrefs=1000;maxbytes=1048576;" +
        "com.example.safe.dto.*;java.base/*;!*"
);

try (ObjectInputStream in = new ObjectInputStream(inputStream)) {
    in.setObjectInputFilter(filter);
    Object object = in.readObject();
}
```

Interpretation:

```text
maxdepth=10       -> reject very deep object graph
maxrefs=1000      -> reject graph with too many references
maxbytes=1 MiB    -> reject large stream
safe package      -> allow expected DTO package
java.base/*       -> allow required JDK base classes cautiously
!*                -> reject everything else
```

Important:

- Pattern syntax and package/class matching must be tested.
- Be careful with broad `java.*` or framework packages.
- A class allowlist should be minimal.
- Allowing a package means allowing future classes added to that package.

---

## 6.3 Programmatic filter example

```java
public final class SafeSnapshotObjectInputFilter implements ObjectInputFilter {

    private static final long MAX_ARRAY_LENGTH = 10_000;
    private static final long MAX_DEPTH = 12;
    private static final long MAX_REFERENCES = 2_000;
    private static final long MAX_BYTES = 2 * 1024 * 1024;

    private static final Set<String> ALLOWED_CLASS_NAMES = Set.of(
            "com.acme.caseexport.CaseExportSnapshot",
            "com.acme.caseexport.CaseExportEntry",
            "com.acme.caseexport.EvidenceExportEntry",
            "java.lang.String",
            "java.time.Instant",
            "java.util.ArrayList",
            "java.util.HashMap"
    );

    @Override
    public Status checkInput(FilterInfo info) {
        if (info.depth() > MAX_DEPTH) {
            return Status.REJECTED;
        }
        if (info.references() > MAX_REFERENCES) {
            return Status.REJECTED;
        }
        if (info.streamBytes() > MAX_BYTES) {
            return Status.REJECTED;
        }
        if (info.arrayLength() >= 0 && info.arrayLength() > MAX_ARRAY_LENGTH) {
            return Status.REJECTED;
        }

        Class<?> serialClass = info.serialClass();
        if (serialClass == null) {
            return Status.UNDECIDED;
        }

        if (serialClass.isArray()) {
            Class<?> componentType = serialClass.getComponentType();
            while (componentType != null && componentType.isArray()) {
                componentType = componentType.getComponentType();
            }
            if (componentType != null && componentType.isPrimitive()) {
                return Status.ALLOWED;
            }
            if (componentType != null && ALLOWED_CLASS_NAMES.contains(componentType.getName())) {
                return Status.ALLOWED;
            }
            return Status.REJECTED;
        }

        if (serialClass.isPrimitive()) {
            return Status.ALLOWED;
        }

        return ALLOWED_CLASS_NAMES.contains(serialClass.getName())
                ? Status.ALLOWED
                : Status.REJECTED;
    }
}
```

This is still only a containment control.

After `readObject`, you still need domain validation.

---

## 6.4 Global filter vs per-stream filter

### Per-stream filter

Best when each deserialization site has a clear context.

Example:

```text
Case export import accepts only CaseExportSnapshot classes.
Session replication accepts only session DTO classes.
Cache restore accepts only specific cache entry classes.
```

### Global filter

Best as baseline safety net.

Example:

```text
Reject known dangerous packages globally.
Set maxdepth/maxrefs/maxbytes globally.
Deny everything except known app and JDK classes in controlled runtime.
```

But global filter can break frameworks if too strict.

Recommended approach:

```text
1. Inventory deserialization sites.
2. Add observability/reporting mode where possible.
3. Build per-context allowlist.
4. Add conservative global resource limits.
5. Test under production-like workloads.
6. Roll out progressively.
```

---

## 6.5 Filter factory and context-specific filters

Modern Java supports more flexible filter configuration, including context-specific filters/filter factories.

Mental model:

```text
Different deserialization contexts should have different allowed classes.
```

Bad:

```text
One huge allowlist for entire JVM.
```

Better:

```text
Endpoint A -> only export DTO classes.
Queue B    -> only event DTO classes.
Cache C    -> only cache snapshot classes.
Session D  -> only session-safe classes.
```

Security invariant:

> The allowed class set must be derived from the context, not from convenience.

---

## 7. Designing Deserialization Boundaries

## 7.1 Boundary principle

At every ingress boundary:

```text
External representation must be converted into a safe internal command through explicit validation.
```

Not:

```text
External representation becomes domain object directly.
```

Better pipeline:

```text
Raw payload
  -> transport/authentication check
  -> size/rate limit
  -> parse using safe parser
  -> schema validation
  -> DTO construction
  -> semantic validation
  -> authorization
  -> command creation
  -> domain service/aggregate enforces invariant
```

---

## 7.2 DTO is not domain

DTO should be boring.

Good DTO:

- no behavior;
- no privileged methods;
- no lazy loading;
- no dependency injection;
- no file/network access;
- no lifecycle hook with side effect;
- no `readObject` behavior;
- no hidden policy decision;
- no authority fields trusted from client;
- no direct entity binding.

Bad DTO:

```java
public class UpdateUserRequest implements Serializable {
    public String userId;
    public String displayName;
    public boolean admin;
    public Set<String> roles;
}
```

Better:

```java
public record UpdateUserProfileRequest(
        String displayName
) {}
```

Role assignment should be a separate privileged command.

---

## 7.3 Domain object should protect invariant

Even after validation, domain object must protect itself.

```java
public final class CaseRecord {
    private CaseStatus status;

    public void transitionTo(CaseStatus next, Actor actor, Clock clock) {
        if (!status.canTransitionTo(next)) {
            throw new InvalidCaseTransitionException(status, next);
        }
        if (!actor.canTransitionCase(this, next)) {
            throw new AccessDeniedException("actor cannot transition case");
        }
        this.status = next;
        this.updatedAt = Instant.now(clock);
    }
}
```

Do not let deserialization set final business state directly.

---

## 7.4 Rehydrate persistence object safely

Sometimes database persistence uses serialization or ORM hydration.

Security concern:

```text
Data from DB is not necessarily trustworthy forever.
```

Reasons:

- SQL injection elsewhere may corrupt data.
- Admin script may change data.
- Migration bug may introduce invalid state.
- Backup restore may rollback old object state.
- Insider threat may update serialized blob.
- Multi-service writes may bypass invariant.

Therefore, for critical domain objects:

1. Validate after load.
2. Store schema version.
3. Avoid opaque serialized blobs for critical state.
4. Store important fields as queryable columns.
5. Use database constraints where possible.
6. Use audit log for state-changing commands.
7. Use hash/signature for high-integrity records if needed.

---

## 8. JSON Deserialization Security

## 8.1 JSON is safer than native serialization only when configured safely

JSON does not normally encode arbitrary Java object graph like native serialization.

But JSON deserialization can still be dangerous through:

- polymorphic type handling;
- default typing;
- mass assignment;
- unknown field acceptance;
- entity binding;
- nested payload DoS;
- large number/string memory pressure;
- duplicate field ambiguity;
- lenient parser behavior;
- custom deserializer side effects.

---

## 8.2 Avoid binding request directly to JPA entity

Bad:

```java
@PostMapping("/users/{id}")
public User update(@PathVariable UUID id, @RequestBody User user) {
    user.setId(id);
    return userRepository.save(user);
}
```

Why dangerous:

- client can set fields that should be server-controlled;
- unknown future fields may become assignable;
- object graph may include nested relationships;
- ownership/role/status may be overwritten;
- persistence cascade may produce unintended writes.

Better:

```java
public record UpdateUserProfileRequest(
        String displayName,
        String phoneNumber
) {}

@PostMapping("/users/{id}")
public UserProfileResponse update(
        @PathVariable UUID id,
        @Valid @RequestBody UpdateUserProfileRequest request,
        Authentication authentication
) {
    return userProfileService.updateProfile(
            UserId.from(id),
            AuthenticatedActor.from(authentication),
            request
    );
}
```

---

## 8.3 Polymorphic deserialization danger

Danger pattern:

```json
{
  "@class": "some.framework.DangerousType",
  "value": "..."
}
```

If a library allows inbound JSON to specify Java class/subtype, attacker may influence object construction.

Safer pattern:

- do not enable default typing for untrusted input;
- use explicit sealed/domain-known subtype mapping;
- use logical type names, not fully-qualified class names;
- restrict subtype set per field;
- validate semantic behavior after parse.

Example safer model:

```java
public sealed interface PaymentInstructionDto
        permits CardPaymentInstructionDto, BankTransferInstructionDto {}

public record CardPaymentInstructionDto(
        String tokenizedCardId,
        BigDecimal amount
) implements PaymentInstructionDto {}

public record BankTransferInstructionDto(
        String bankAccountToken,
        BigDecimal amount
) implements PaymentInstructionDto {}
```

JSON type discriminator should be a domain discriminator:

```json
{
  "type": "CARD",
  "tokenizedCardId": "tok_123",
  "amount": "100.00"
}
```

Not Java class name.

---

## 8.4 Unknown fields: strict vs tolerant

Strict mode rejects unknown fields.

Pros:

- catches unexpected client input;
- prevents silent mass assignment when DTO changes;
- improves API contract clarity;
- good for security-sensitive commands.

Cons:

- can break forward compatibility;
- less tolerant for public APIs.

Tolerant mode ignores unknown fields.

Pros:

- better forward/backward compatibility;
- useful for event consumers.

Cons:

- attackers can hide intent;
- debugging harder;
- client may think field was applied when ignored;
- security review must ensure ignored fields are not later logged/forwarded.

Recommendation:

```text
Security-sensitive commands: prefer strict unknown field rejection.
External event compatibility: tolerate only with explicit schema/version strategy.
```

---

## 9. XML Deserialization and XML Parser Risks

XML will have its own dedicated part later, but for secure deserialization we need the core risk here.

Common XML risks:

1. XXE.
2. External entity resolution.
3. Billion laughs/entity expansion.
4. XPath injection.
5. XML signature wrapping.
6. XML decoder object construction.
7. Large nested XML DoS.
8. Namespace confusion.
9. Schema poisoning.
10. Canonicalization mismatch.

Minimum parser posture:

```text
Disable external entities.
Disable DTD where not required.
Limit entity expansion.
Limit document size/depth.
Use secure processing features.
Validate against known schema.
Do not use XMLDecoder for untrusted input.
```

Danger example:

```java
XMLDecoder decoder = new XMLDecoder(inputStream);
Object object = decoder.readObject();
```

For untrusted input, this is extremely dangerous because XML can describe object construction.

---

## 10. YAML Deserialization Security

YAML is human-friendly but security-sensitive.

Risk patterns:

- YAML tags that instantiate classes;
- aliases/anchors causing expansion bombs;
- polymorphic object construction;
- config injection;
- unexpected type coercion;
- multi-document ambiguity;
- large nested structures.

Bad mental model:

```text
YAML is just config text.
```

Better mental model:

```text
YAML parser can be a programmable object construction surface depending on library and configuration.
```

Safer approach:

1. Use safe loader mode.
2. Bind only to simple config DTOs.
3. Reject unknown fields for security-sensitive config.
4. Limit size/depth/aliases.
5. Do not allow arbitrary class tags.
6. Validate semantic config after parse.
7. Treat config as code if it changes runtime behavior.

---

## 11. Schema Validation and Versioned Payloads

## 11.1 Why schema matters

Schema makes input shape explicit.

Without schema:

```text
Parser decides shape.
Library decides default.
Developer assumes intent.
Attacker probes ambiguity.
```

With schema:

```text
Allowed fields are explicit.
Types are explicit.
Required/optional fields are explicit.
Bounds can be explicit.
Version strategy can be explicit.
```

Schema does not replace domain validation, but it reduces ambiguity.

---

## 11.2 Versioned envelope pattern

For high-integrity payloads, use an envelope.

```json
{
  "envelopeVersion": 1,
  "payloadType": "CASE_EXPORT_SNAPSHOT",
  "payloadVersion": 3,
  "producer": "case-service",
  "tenantId": "tenant-123",
  "issuedAt": "2026-06-16T10:15:30Z",
  "expiresAt": "2026-06-16T10:20:30Z",
  "nonce": "base64url-random",
  "contentDigest": "sha256-base64url",
  "payload": {
    "cases": []
  },
  "signature": "base64url-signature"
}
```

The envelope gives you:

- type binding;
- version binding;
- producer binding;
- tenant binding;
- freshness;
- replay control;
- digest integrity;
- signature integrity;
- migration path.

---

## 11.3 Parse order for signed payloads

Important question:

> How do you verify signature before parsing payload if signature covers canonical payload?

Safer approach:

1. Enforce raw size limit.
2. Parse minimal envelope with safe parser and strict bounds.
3. Extract raw canonical payload bytes or canonical representation.
4. Verify signature/MAC over exact canonical bytes and context fields.
5. Verify expiry/nonce/replay.
6. Parse payload into DTO according to `payloadType` and `payloadVersion`.
7. Validate schema and domain invariant.
8. Execute command.

Do not deserialize arbitrary object graph before verification.

---

## 12. Signed Serialized Payloads

## 12.1 What signing solves

Signing can solve:

- tamper detection;
- source authenticity;
- non-repudiation in some contexts;
- provenance;
- chain of custody;
- offline verification.

Signing does not solve:

- unsafe parser;
- gadget chain;
- oversized payload;
- replay;
- wrong context;
- stale version;
- compromised signer;
- overprivileged signer;
- business invariant violation.

---

## 12.2 Context binding

Bad signature input:

```text
signature = Sign(payload)
```

Better signature input:

```text
signature = Sign(
  envelopeVersion ||
  payloadType ||
  payloadVersion ||
  producer ||
  intendedAudience ||
  tenantId ||
  issuedAt ||
  expiresAt ||
  nonce ||
  canonicalPayloadDigest
)
```

Why?

Because a valid payload in one context may be invalid in another.

Example:

```text
A signed “approve case” command from staging must not be accepted in production.
A signed evidence export for tenant A must not be replayed into tenant B.
A signed callback for payment service must not be accepted by case service.
```

---

## 12.3 Replay protection

A signed payload can be replayed.

Mitigation:

- nonce store;
- idempotency key;
- timestamp window;
- sequence number;
- event offset;
- command id uniqueness;
- short expiry;
- one-time token;
- state transition guard.

For business commands, state machine invariant is often the last line of defense.

---

## 13. Object Integrity in Domain Systems

## 13.1 Object integrity definition

Object integrity means:

> An object exists in a state that could only have been produced by valid operations under valid authority.

Not merely:

> The fields have correct Java types.

Example:

```json
{
  "caseId": "C-123",
  "status": "APPROVED",
  "approvedBy": "user-999",
  "approvedAt": "2026-06-16T10:00:00Z"
}
```

This object is type-valid.

But object integrity asks:

1. Was there a valid transition from previous status to APPROVED?
2. Did `user-999` have authority at that time?
3. Was approval within allowed time window?
4. Were required documents present?
5. Was conflict-of-interest checked?
6. Was this tenant correct?
7. Was audit record produced?
8. Was this update caused by an accepted command?

---

## 13.2 State transition as integrity defense

Instead of deserializing state directly:

```java
caseRecord.setStatus(APPROVED);
```

Use command:

```java
caseWorkflow.approveCase(caseId, actor, approvalReason, clock);
```

Then enforce:

```text
Only REVIEWED can move to APPROVED.
Actor must have approval permission.
Required checklist must be completed.
No active hold exists.
Audit record must be appended.
Notification event must be emitted.
```

This is why domain services and state machines are security controls, not just architecture style.

---

## 13.3 Integrity levels

| Level | Description | Example |
|---|---|---|
| Type integrity | fields have expected types | `status` is enum |
| Shape integrity | payload matches schema | required fields present |
| Semantic integrity | values make sense | amount >= 0 |
| Authority integrity | actor is allowed | only reviewer can approve |
| Transition integrity | state change is valid | DRAFT -> SUBMITTED only |
| Temporal integrity | time constraints valid | not expired/replayed |
| Provenance integrity | source is known | signed by producer |
| Tamper integrity | content unchanged | digest/signature valid |
| Audit integrity | action has evidence | append-only audit record |
| System integrity | operation preserves cross-service invariant | event/outbox consistency |

A mature Java system protects multiple levels.

---

## 14. Secure Deserialization Design Patterns

## 14.1 Schema-first import pattern

Use for batch import, partner integration, external agency file.

```text
File received
  -> store raw immutable copy
  -> compute digest
  -> verify signature/provenance if available
  -> scan/size limit
  -> parse schema
  -> validate DTO
  -> create import job
  -> process row by row with domain services
  -> produce audit summary
```

Invariant:

> Import never directly writes trusted domain state without passing through domain rules.

---

## 14.2 Safe envelope pattern

Use for signed commands/events.

```java
public record SignedEnvelope<T>(
        int envelopeVersion,
        String payloadType,
        int payloadVersion,
        String producer,
        String audience,
        String tenantId,
        Instant issuedAt,
        Instant expiresAt,
        String nonce,
        String payloadDigest,
        T payload,
        String signature
) {}
```

Rules:

1. Envelope is parsed with strict size/field limits.
2. `payloadType` maps to known DTO class.
3. Signature covers context and payload digest.
4. Payload parsed only after signature/freshness passes where feasible.
5. Domain validation still runs.

---

## 14.3 Quarantine pattern

Use when input is high risk.

```text
Inbound payload
  -> quarantine storage
  -> no direct processing
  -> metadata extraction only
  -> async scanner/validator
  -> human/system approval if needed
  -> controlled processing
```

Good for:

- untrusted uploads;
- archive files;
- migration imports;
- partner batch data;
- large XML/YAML files;
- evidence documents.

---

## 14.4 Anti-corruption DTO pattern

Use between external model and internal domain.

```text
PartnerPayloadDto
  -> PartnerPayloadValidator
  -> CanonicalCommand
  -> DomainService
  -> DomainEntity
```

Never let partner object model leak into internal domain entity.

---

## 14.5 Object filter as containment pattern

Use only when native serialization remains.

```text
ObjectInputStream
  -> context-specific ObjectInputFilter
  -> safe DTO class only
  -> post-deserialization validation
  -> convert to command
```

---

## 15. Anti-Patterns

## 15.1 Deserializing `Object`

```java
Object payload = objectInputStream.readObject();
```

Problem:

- no expected type boundary;
- difficult review;
- broad gadget exposure;
- domain validation unclear.

Better:

```java
CaseExportSnapshot snapshot = readExpectedSnapshot(inputStream);
```

Even better: avoid native serialization.

---

## 15.2 Trusting client-supplied class names

Bad:

```json
{
  "className": "com.acme.workflow.ApproveCaseCommand",
  "payload": { ... }
}
```

Better:

```json
{
  "commandType": "APPROVE_CASE",
  "payload": { ... }
}
```

And map command type to fixed DTO class server-side.

---

## 15.3 Entity deserialization

Bad:

```java
@RequestBody CaseEntity caseEntity
```

Problem:

- persistence model exposed;
- internal fields writable;
- relationships controllable;
- lazy/proxy behavior unpredictable;
- audit fields spoofable.

---

## 15.4 Deserialization before authentication/authorization

Bad:

```text
read full object graph
  -> then authenticate
```

Better:

```text
authenticate lightweight transport credentials
  -> enforce size/rate
  -> parse bounded DTO
  -> authorize action
  -> validate domain command
```

Do not spend expensive parsing on unauthenticated attacker input.

---

## 15.5 Blocklist-only filtering

Bad:

```text
Reject known dangerous classes.
Allow everything else.
```

Problem:

- gadget universe changes;
- dependency updates add new gadgets;
- application classes can become gadgets;
- blocklist always incomplete.

Better:

```text
Allow only expected classes per context.
Reject everything else.
```

---

## 15.6 Signed Java serialization blob

Bad:

```text
Verify signature over blob.
If valid, ObjectInputStream.readObject().
```

This can still be risky if signer can be compromised, signer is too broad, old payload can replay, or the allowed class graph is large.

Better:

```text
Signed schema payload -> bounded parser -> DTO -> domain command.
```

---

## 16. Failure Modes

## 16.1 Remote code execution

Condition:

- untrusted serialized object accepted;
- vulnerable gadget chain in classpath;
- deserialization hook triggers behavior.

Impact:

- command execution;
- file write;
- network call;
- credential exfiltration;
- container escape attempt;
- lateral movement.

Controls:

- remove native serialization boundary;
- allowlist filter;
- reduce classpath;
- patch dependencies;
- network egress restriction;
- least privilege container;
- runtime detection;
- no dangerous protocols exposed.

---

## 16.2 Denial of service

Condition:

- huge graph;
- deeply nested graph;
- large arrays;
- cyclic references;
- decompression/expansion bomb;
- parser recursion.

Impact:

- heap exhaustion;
- CPU spike;
- GC pressure;
- thread starvation;
- service restart loop.

Controls:

- max request size;
- max stream bytes;
- max graph depth;
- max references;
- max array length;
- parser limits;
- rate limiting;
- quarantine processing.

---

## 16.3 Privilege escalation through mass assignment

Condition:

- request binds directly to entity;
- entity has privileged fields;
- server does not overwrite/ignore authority fields.

Impact:

- user grants own role;
- ownership changed;
- workflow status bypassed;
- audit fields spoofed.

Controls:

- input DTO;
- explicit mapping;
- separate privileged commands;
- authorization check;
- server-controlled fields.

---

## 16.4 State corruption through stale object replay

Condition:

- old serialized object accepted;
- no version/freshness check;
- state overwritten.

Impact:

- rollback attack;
- lost updates;
- invalid workflow;
- audit inconsistency.

Controls:

- version field;
- optimistic locking;
- event sequence;
- command id;
- expiry;
- state transition validation.

---

## 16.5 Parser differential behavior

Condition:

- different services parse same payload differently;
- duplicate fields;
- lenient parsing;
- number precision mismatch;
- timezone ambiguity;
- Unicode normalization mismatch.

Impact:

- signature bypass;
- policy mismatch;
- audit mismatch;
- inconsistent decision.

Controls:

- canonicalization;
- strict parser;
- shared schema;
- duplicate field rejection;
- explicit timezone/number rules;
- sign canonical bytes.

---

## 17. Production Checklist

## 17.1 Inventory checklist

For each service, answer:

- [ ] Where do we deserialize native Java objects?
- [ ] Where do frameworks deserialize implicitly?
- [ ] Which HTTP endpoints parse JSON/XML/YAML?
- [ ] Which queue consumers parse external/internal messages?
- [ ] Which file import jobs parse uploaded/imported files?
- [ ] Which caches/session stores rehydrate object state?
- [ ] Which database columns store serialized blobs?
- [ ] Which admin tools import/export object data?
- [ ] Which third-party libraries enable polymorphic deserialization?
- [ ] Which protocols expose RMI/JMX/JMS/remoting?

---

## 17.2 Native serialization checklist

- [ ] No public endpoint accepts Java native serialization.
- [ ] No unauthenticated source reaches `ObjectInputStream`.
- [ ] Every `ObjectInputStream` has context-specific filter.
- [ ] Global filter/resource limits exist where appropriate.
- [ ] Filter is allowlist-based.
- [ ] Filter limits depth/references/array length/bytes.
- [ ] Rejected class telemetry is logged safely.
- [ ] Deserialized object is validated after reading.
- [ ] Deserialized object is converted to command/DTO before domain write.
- [ ] Migration plan exists to schema-based format.

---

## 17.3 JSON/XML/YAML checklist

- [ ] Request binds to DTO, not entity.
- [ ] Polymorphic deserialization disabled unless explicitly allowlisted.
- [ ] Type discriminator uses logical names, not Java class names.
- [ ] Unknown field strategy is deliberate.
- [ ] Duplicate field behavior is known.
- [ ] Parser size/depth limits exist.
- [ ] XML external entities are disabled where not needed.
- [ ] YAML safe loading is used.
- [ ] Schema validation exists for complex external payloads.
- [ ] Domain validation runs after parse.

---

## 17.4 Signed payload checklist

- [ ] Signature/MAC covers context fields, not only payload.
- [ ] Signature uses canonical representation.
- [ ] Payload has type and version.
- [ ] Payload has audience/tenant/producer binding.
- [ ] Expiry/freshness exists.
- [ ] Replay protection exists.
- [ ] Key id is validated safely.
- [ ] Key rotation is supported.
- [ ] Signature is verified before dangerous object construction.
- [ ] Domain authorization still runs.

---

## 18. Review Questions

Use these in design review or PR review.

### 18.1 Boundary questions

1. Is this payload controlled by user, partner, internal service, operator, or runtime?
2. Can a compromised upstream service produce this payload?
3. Can payload type/class be influenced by input?
4. Is parsing done before authentication or rate limiting?
5. What is the maximum allowed payload size?
6. What is the maximum allowed nesting depth?
7. What happens on parser failure?
8. Are rejected payloads logged without leaking secrets?
9. Is there quarantine for high-risk input?
10. Is the source provenance recorded?

### 18.2 Type questions

1. What exact DTO/class types can be built?
2. Are entities directly deserialized?
3. Are subtypes allowlisted?
4. Are class names accepted from input?
5. Are framework default typing features disabled?
6. Are custom deserializers side-effect free?
7. Are unknown fields rejected or ignored deliberately?
8. Are duplicate fields handled safely?
9. Are numeric/date formats deterministic?
10. Are Unicode normalization rules defined?

### 18.3 Domain integrity questions

1. Which fields are server-authoritative?
2. Which fields must never come from client?
3. What invariant must hold after parse?
4. Is transition validation enforced?
5. Is authorization based on authenticated actor, not payload actor?
6. Is tenant boundary checked?
7. Is replay possible?
8. Can stale payload overwrite newer state?
9. Is audit record produced from server context?
10. Is failure atomic?

---

## 19. Mini Case Study: Secure Case Export Import

### 19.1 Context

A regulatory case management platform needs export/import capability for case snapshots between environments or agencies.

Naive proposal:

```text
Serialize CaseAggregate using Java serialization.
Compress file.
Upload file to target environment.
Deserialize and save.
```

This is dangerous.

Problems:

1. Native serialized object graph crosses trust boundary.
2. Target environment must have compatible classpath.
3. Payload may construct unexpected classes.
4. Domain state can bypass transition rules.
5. Audit trail may be spoofed or incomplete.
6. Old export can replay and overwrite current state.
7. Environment/tenant mismatch possible.
8. File can be tampered with.
9. Large object graph can DoS import service.
10. Migration/versioning is brittle.

---

### 19.2 Secure design

Use explicit export package:

```text
case-export-v1.zip
  manifest.json
  cases.ndjson
  evidences/
    evidence-001.bin
    evidence-002.bin
  signature.jws
```

Manifest:

```json
{
  "exportFormatVersion": 1,
  "exportId": "exp_01H...",
  "sourceSystem": "case-service-prod",
  "sourceEnvironment": "prod",
  "targetAudience": "case-import-service",
  "tenantId": "agency-a",
  "issuedAt": "2026-06-16T10:00:00Z",
  "expiresAt": "2026-06-16T11:00:00Z",
  "caseCount": 120,
  "files": [
    {
      "path": "cases.ndjson",
      "sha256": "...",
      "bytes": 123456
    },
    {
      "path": "evidences/evidence-001.bin",
      "sha256": "...",
      "bytes": 9999
    }
  ]
}
```

Processing pipeline:

```text
Upload
  -> store raw package immutable
  -> verify zip structure/path traversal safety
  -> enforce size/count limits
  -> read manifest only
  -> verify signature over manifest + file digests
  -> verify audience/environment/tenant/expiry
  -> verify all file digests
  -> parse cases.ndjson line by line
  -> validate schema
  -> create ImportCaseCommand per case
  -> domain service applies rules
  -> append audit record
  -> produce import report
```

---

### 19.3 Security invariants

```text
Invariant 1: Import package cannot instantiate arbitrary Java classes.
Invariant 2: Import package cannot write outside import workspace.
Invariant 3: Import package cannot target wrong tenant/audience.
Invariant 4: Import package cannot be accepted after expiry.
Invariant 5: Import package cannot silently change evidence files.
Invariant 6: Import package cannot directly overwrite domain state without command validation.
Invariant 7: Import package cannot spoof importing actor.
Invariant 8: Import produces audit evidence for every accepted/rejected case.
Invariant 9: Import is idempotent by exportId/importId.
Invariant 10: Import failure does not leave partial untraceable state.
```

---

## 20. Java Implementation Sketches

## 20.1 Safe bounded input wrapper

```java
public final class BoundedInputStream extends FilterInputStream {
    private final long maxBytes;
    private long readBytes;

    public BoundedInputStream(InputStream in, long maxBytes) {
        super(Objects.requireNonNull(in));
        if (maxBytes <= 0) {
            throw new IllegalArgumentException("maxBytes must be positive");
        }
        this.maxBytes = maxBytes;
    }

    @Override
    public int read() throws IOException {
        int value = super.read();
        if (value != -1) {
            increment(1);
        }
        return value;
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        int count = super.read(b, off, len);
        if (count > 0) {
            increment(count);
        }
        return count;
    }

    private void increment(long count) throws IOException {
        readBytes += count;
        if (readBytes > maxBytes) {
            throw new IOException("input exceeds maximum allowed size");
        }
    }
}
```

Use this before parser/deserializer.

---

## 20.2 Expected type reader with filter

```java
public final class SafeObjectReader {

    private final ObjectInputFilter filter;

    public SafeObjectReader(ObjectInputFilter filter) {
        this.filter = Objects.requireNonNull(filter);
    }

    public <T> T read(InputStream rawInput, Class<T> expectedType) throws IOException {
        Objects.requireNonNull(rawInput);
        Objects.requireNonNull(expectedType);

        try (ObjectInputStream in = new ObjectInputStream(rawInput)) {
            in.setObjectInputFilter(filter);
            Object value = in.readObject();

            if (!expectedType.isInstance(value)) {
                throw new InvalidObjectException(
                        "unexpected root type: " + value.getClass().getName()
                );
            }

            T typedValue = expectedType.cast(value);
            validateAfterDeserialization(typedValue);
            return typedValue;
        } catch (ClassNotFoundException e) {
            InvalidObjectException failure = new InvalidObjectException("unknown class in stream");
            failure.initCause(e);
            throw failure;
        }
    }

    private <T> void validateAfterDeserialization(T value) throws InvalidObjectException {
        if (value instanceof SelfValidatingDeserializedObject selfValidating) {
            selfValidating.validateAfterDeserialization();
        }
    }
}
```

Still not recommended for untrusted public input, but better than direct `readObject`.

---

## 20.3 Self-validating deserialized object

```java
public interface SelfValidatingDeserializedObject {
    void validateAfterDeserialization() throws InvalidObjectException;
}

public final class CaseExportSnapshot
        implements Serializable, SelfValidatingDeserializedObject {

    private String exportId;
    private String tenantId;
    private List<CaseExportEntry> cases;

    @Override
    public void validateAfterDeserialization() throws InvalidObjectException {
        if (exportId == null || exportId.isBlank()) {
            throw new InvalidObjectException("exportId is required");
        }
        if (tenantId == null || tenantId.isBlank()) {
            throw new InvalidObjectException("tenantId is required");
        }
        if (cases == null || cases.size() > 10_000) {
            throw new InvalidObjectException("invalid case count");
        }
    }
}
```

Note:

- This helps preserve object invariant.
- It does not replace filter, schema, or domain validation.

---

## 20.4 DTO-to-command mapping

```java
public record ImportCaseDto(
        String externalCaseId,
        String applicantId,
        String requestedStatus,
        List<ImportEvidenceDto> evidences
) {}

public final class ImportCaseMapper {

    public ImportCaseCommand toCommand(
            ImportCaseDto dto,
            ImportContext context,
            AuthenticatedActor actor
    ) {
        Objects.requireNonNull(dto);
        Objects.requireNonNull(context);
        Objects.requireNonNull(actor);

        return new ImportCaseCommand(
                context.importId(),
                context.tenantId(),
                ExternalCaseId.parse(dto.externalCaseId()),
                ApplicantId.parse(dto.applicantId()),
                CaseStatus.parseImportableStatus(dto.requestedStatus()),
                mapEvidence(dto.evidences()),
                actor.userId(),
                context.receivedAt()
        );
    }
}
```

Authority comes from context/actor, not from DTO.

---

## 21. Testing Strategy

## 21.1 Negative tests for native serialization

Test that unexpected classes are rejected.

```java
@Test
void rejectsUnexpectedClass() {
    byte[] payload = serialize(new java.util.Date());

    SafeObjectReader reader = new SafeObjectReader(caseExportFilter());

    assertThrows(IOException.class, () ->
            reader.read(new ByteArrayInputStream(payload), CaseExportSnapshot.class)
    );
}
```

---

## 21.2 Resource limit tests

Test:

- depth too large;
- array too large;
- bytes too large;
- too many references;
- unknown class;
- wrong root type;
- corrupted stream;
- missing required field;
- invalid domain value.

---

## 21.3 Parser strictness tests

For JSON/XML/YAML:

- unknown field rejected if required;
- duplicate field behavior known;
- polymorphic class names rejected;
- huge nested object rejected;
- invalid enum rejected;
- numeric overflow rejected;
- timezone ambiguity rejected;
- Unicode normalization handled;
- external entity rejected;
- YAML class tag rejected.

---

## 21.4 Security regression corpus

Keep a corpus of malicious/invalid payloads:

```text
test-resources/security/deserialization/
  native-unexpected-class.bin
  native-too-deep.bin
  native-huge-array.bin
  json-unknown-field.json
  json-polymorphic-class-name.json
  json-duplicate-fields.json
  xml-xxe.xml
  xml-billion-laughs.xml
  yaml-class-tag.yaml
  yaml-alias-bomb.yaml
```

Every parser/deserializer change must pass this corpus.

---

## 22. Operational Controls

## 22.1 Telemetry

Log safely:

- deserialization source;
- payload type;
- payload version;
- rejection reason category;
- class rejected by filter, if safe;
- size/depth limit exceeded;
- correlation ID;
- tenant ID if non-sensitive;
- producer ID;
- import ID;
- actor ID;
- decision outcome.

Do not log:

- full payload;
- secrets;
- signed token body with PII;
- binary object stream;
- evidence content;
- private keys;
- password fields.

---

## 22.2 Alerting

Alert on:

- repeated rejected classes;
- parser bomb attempts;
- malformed payload burst;
- signature verification failures spike;
- replay detection;
- import from unexpected producer;
- old payload version use;
- sudden increase in payload size;
- deserialization exception from internal channel;
- JMX/RMI exposure detection.

---

## 22.3 Incident response signals

If deserialization attack suspected:

1. Identify ingress source.
2. Preserve raw payload if safe/legal and needed for forensics.
3. Identify rejected/accepted class names.
4. Check classpath for known gadget libraries.
5. Review network egress logs.
6. Review process execution/file write indicators.
7. Rotate secrets if RCE possible.
8. Patch/remove vulnerable dependency.
9. Tighten filter and parser limits.
10. Add regression payload.

---

## 23. Migration Strategy Away from Native Serialization

## 23.1 Stepwise migration

```text
Step 1: Inventory all native serialization usage.
Step 2: Classify by trust boundary and business criticality.
Step 3: Add ObjectInputFilter and resource limits immediately.
Step 4: Add telemetry for rejected/allowed classes.
Step 5: Design schema-based replacement format.
Step 6: Implement dual-read if needed.
Step 7: Write new format on new data.
Step 8: Backfill/migrate old blobs.
Step 9: Disable native deserialization at boundary.
Step 10: Remove legacy classes and dependencies.
```

---

## 23.2 Format selection

| Format | Good For | Security Notes |
|---|---|---|
| JSON | APIs, logs, human-readable integration | watch polymorphism, size, unknown fields |
| NDJSON | streaming records | good for large import/export |
| CBOR | compact binary structured data | still needs schema/limits |
| Protobuf | strongly typed service contracts | watch unknown fields/versioning |
| Avro | data pipelines/schema evolution | schema registry governance needed |
| XML | legacy/enterprise/legal docs | XXE/signature wrapping risk |
| YAML | config | use safe loader, limit aliases/tags |

For high-security boundaries, prefer schema-first and explicit versioning.

---

## 24. Secure Defaults for Java Teams

Recommended team policy:

```text
1. Native Java serialization must not be used for untrusted input.
2. Any ObjectInputStream usage requires security review.
3. All ObjectInputStream usage must have ObjectInputFilter.
4. Request bodies must bind to DTOs, not entities.
5. Polymorphic deserialization is disabled by default.
6. Class names must not be accepted from payload.
7. XML external entity resolution is disabled by default.
8. YAML arbitrary class construction is forbidden.
9. Signed payloads require context binding and replay protection.
10. Domain invariant validation is mandatory after parse.
```

---

## 25. Summary

Key takeaways:

1. Deserialization is not passive data reading; it is object construction across a trust boundary.
2. Java native serialization is especially risky for untrusted input because payloads can influence object graph construction.
3. `ObjectInputFilter` is an important containment tool, but not a full correctness or safety solution.
4. Use allowlists, not broad blocklists.
5. Limit depth, references, array length, and bytes.
6. Prefer explicit DTO/schema formats over native object graphs.
7. Never bind external payload directly to persistence entity or privileged domain object.
8. JSON/XML/YAML can also be unsafe if polymorphism, parser features, or type tags are misconfigured.
9. Signature/MAC proves integrity/provenance only within the signed context; it does not make unsafe deserialization safe.
10. Object integrity means state could only have been produced by valid authorized operations, not merely that fields have correct types.

---

## 26. Practical Mastery Exercise

Pick one Java service you know and create this table:

| Deserialization Site | Source | Format | Trust Level | Type Control | Size Limit | Schema | Domain Validation | Risk | Fix |
|---|---|---|---|---|---|---|---|---|---|
| `/api/import/cases` | admin upload | JSON zip | operator-controlled | DTO | yes | yes | partial | medium | add signed manifest + replay control |
| queue `case.events` | internal service | JSON | internal | event DTO | yes | schema registry | yes | low-medium | add producer validation |
| Redis session | app runtime | Java serialization | runtime/internal | broad | unknown | no | no | high | replace serializer/filter |
| legacy RMI | internal network | Java serialization | internal | unknown | unknown | no | no | high | disable/isolate/filter |

Then answer:

1. Which site can construct arbitrary classes?
2. Which site accepts payload before authentication?
3. Which site can bypass domain transition rules?
4. Which site lacks replay protection?
5. Which site would fail dangerously under large payload?
6. Which site should be migrated first?

---

## 27. References

- Oracle Java Serialization Filtering: https://docs.oracle.com/en/java/javase/21/core/java-serialization-filters.html
- Oracle Addressing Deserialization Vulnerabilities: https://docs.oracle.com/en/java/javase/21/core/addressing-serialization-vulnerabilities.html
- Oracle ObjectInputFilter API: https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/io/ObjectInputFilter.html
- OpenJDK JEP 290 — Filter Incoming Serialization Data: https://openjdk.org/jeps/290
- OWASP Deserialization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html
- OWASP Insecure Deserialization: https://owasp.org/www-community/vulnerabilities/Insecure_Deserialization
- OWASP Java Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Java_Security_Cheat_Sheet.html
- Oracle Secure Coding Guidelines for Java SE: https://www.oracle.com/java/technologies/javase/seccodeguide.html
- SEI CERT Oracle Coding Standard for Java: https://wiki.sei.cmu.edu/confluence/display/java/SEI%2BCERT%2BOracle%2BCoding%2BStandard%2Bfor%2BJava

---

# Status Seri

Seri **belum selesai**.

Kita sudah menyelesaikan:

- Part 0 — Security Mental Model for Senior Java Engineers
- Part 1 — Java Security Architecture: JCA, JCE, JAAS, JSSE, JGSS, SASL, CertPath
- Part 2 — Threat Modeling for Java Systems
- Part 3 — Cryptography Mental Model: What Crypto Can and Cannot Guarantee
- Part 4 — Randomness, Entropy, Nonce, Salt, IV, Token
- Part 5 — Hashing, Digest, Fingerprint, Checksum, and Integrity Boundaries
- Part 6 — Password Storage, Password Verification, and Secret-Derived Keys
- Part 7 — Symmetric Encryption in Java: AES, Modes, Padding, AEAD
- Part 8 — Message Authentication Code: HMAC, CMAC, and Integrity Tokens
- Part 9 — Digital Signature: RSA, ECDSA, EdDSA, Signing Semantics
- Part 10 — Asymmetric Encryption and Key Agreement
- Part 11 — Key Management: Lifecycle, Rotation, Wrapping, KMS, HSM
- Part 12 — Java KeyStore, TrustStore, Certificates, and Private Key Custody
- Part 13 — X.509, PKI, Certificate Path Validation, Revocation
- Part 14 — TLS/JSSE Deep Dive for Java Engineers
- Part 15 — TLS Hardening, Disabled Algorithms, and Runtime Security Properties
- Part 16 — Secure Serialization, Deserialization, and Object Integrity

Berikutnya:

- Part 17 — Secure File, Archive, and Data Transfer Integrity

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-security-cryptography-integrity-part-015](./learn-java-security-cryptography-integrity-part-015.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-security-cryptography-integrity-part-017](./learn-java-security-cryptography-integrity-part-017.md)

</div>
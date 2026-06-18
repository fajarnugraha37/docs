# learn-http-for-web-frontend-perspective-part-024.md

# Part 024 — Mutation Design: Idempotency, Optimistic UI, Concurrency, and Conflict

> Seri: `learn-http-for-web-frontend-perspective`  
> Perspektif: Java software engineer yang ingin memahami HTTP dari sisi web/frontend secara presisi, operasional, dan arsitektural.  
> Status: Part 024 dari 035.  
> Prasyarat internal: Part 000–023, terutama HTTP methods, status code, headers, body/representation, fetch, cookies/session, caching, redirect, API design, dan observability dasar.

---

## 0. Tujuan Bagian Ini

Bagian ini membahas **mutation design**: bagaimana operasi yang mengubah state server harus dirancang agar aman, jelas, bisa di-retry, bisa diobservasi, cocok dengan UI modern, dan tidak menghancurkan data ketika user, browser, network, atau backend berperilaku tidak ideal.

Dalam sistem web nyata, bug paling mahal sering muncul bukan di `GET`, tetapi di mutation:

- user klik tombol dua kali;
- request sukses di server tetapi response hilang di network;
- frontend melakukan retry dan menghasilkan duplikasi;
- dua tab mengedit resource yang sama;
- autosave menimpa perubahan user lain;
- optimistic UI menampilkan state yang ternyata ditolak server;
- refresh token terjadi bersamaan dengan mutation;
- user menekan back/refresh saat transaksi sedang berjalan;
- server menerima request yang sama dua kali karena retry gateway;
- operasi lama return belakangan dan mengalahkan state yang lebih baru;
- mobile network putus setelah server commit;
- backend mengembalikan `200 OK` untuk semua kasus sehingga frontend tidak tahu harus merge, retry, rollback, atau meminta user memilih.

Target akhir bagian ini: Anda bisa mendesain mutation seperti seorang engineer yang memahami **state transition**, bukan sekadar “panggil endpoint POST lalu update UI”.

---

## 1. Mutation sebagai State Transition, Bukan Sekadar Request

Dalam read operation, frontend meminta representasi state:

```http
GET /cases/CASE-123
```

Dalam mutation, frontend meminta server melakukan transisi:

```http
PATCH /cases/CASE-123
Content-Type: application/json

{
  "status": "APPROVED"
}
```

Secara konseptual, mutation bukan “kirim data”, tetapi:

```text
current server state + command + actor + precondition + policy
=> new server state OR rejected transition
```

Model ini penting karena mutation selalu punya pertanyaan tersembunyi:

1. **Apa resource yang berubah?**
2. **Apa intent user?**
3. **Apakah user punya authority?**
4. **Apakah state saat ini masih cocok dengan asumsi frontend?**
5. **Apakah operation boleh diulang?**
6. **Apakah operation sudah pernah diproses?**
7. **Apakah perubahan perlu sinkron dengan resource lain?**
8. **Bagaimana UI harus bereaksi jika server menerima, menunda, menolak, atau gagal?**

Frontend yang matang tidak menganggap mutation sebagai “fire and forget”. Frontend memperlakukan mutation sebagai **state machine**.

---

## 2. Mental Model Utama

### 2.1 Mutation Memiliki Dua State yang Berbeda

Untuk setiap mutation, ada minimal dua state:

```text
Client-perceived state
Server-authoritative state
```

Contoh user klik “Approve”. UI bisa langsung menampilkan status `Approved`, tetapi server mungkin:

- menerima dan commit;
- menolak karena user tidak berwenang;
- menolak karena case sudah berubah;
- menerima asynchronous processing;
- menerima sebagian;
- timeout tetapi sebenarnya commit berhasil;
- gagal sebelum commit;
- gagal setelah commit tetapi sebelum response terkirim.

Karena itu mutation design harus memisahkan:

```text
UI assumption != server truth
```

Optimistic UI boleh, tetapi harus ada mekanisme rollback, reconciliation, atau confirmation.

### 2.2 Response Bukan Bukti Tunggal

Frontend sering berpikir:

```text
response 2xx = mutation terjadi
response error = mutation tidak terjadi
```

Ini keliru.

Lebih presisi:

| Kondisi | Apa yang diketahui frontend? |
|---|---|
| Response 2xx diterima | Server menyatakan request berhasil diproses menurut kontrak response. |
| Response 4xx diterima | Server menolak request secara deterministik atau policy/domain. |
| Response 5xx diterima | Server/gateway gagal memenuhi request; mutation bisa saja belum terjadi, sebagian terjadi, atau terjadi tetapi response gagal, tergantung boundary. |
| Network error/timeout/abort | Frontend tidak tahu apakah server menerima atau commit. |
| Browser offline | Request kemungkinan belum terkirim, kecuali ada service worker/background sync. |

Mutation design yang baik memperlakukan network failure sebagai **unknown outcome**, bukan otomatis failure.

### 2.3 Mutation Harus Punya Identity

Tanpa identity, server sulit membedakan:

```text
request baru
vs
retry dari request lama
vs
duplicate submit
vs
user memang ingin membuat dua resource berbeda
```

Contoh:

```http
POST /payments
Content-Type: application/json

{
  "amount": 100000,
  "currency": "IDR"
}
```

Jika request ini dikirim dua kali, apakah hasilnya:

- satu payment?
- dua payment?
- error kedua?
- response yang sama untuk request yang sama?

Tanpa idempotency design, jawabannya ambigu.

---

## 3. HTTP Method Semantics untuk Mutation

Sebelum masuk idempotency dan UI, ulangi invariant dari Part 004 secara lebih aplikatif.

### 3.1 POST

`POST` berarti server diminta memproses payload berdasarkan semantics resource target. Biasanya dipakai untuk:

- create resource dengan server-generated ID;
- submit command;
- trigger workflow;
- perform search kompleks;
- create subordinate resource;
- invoke action yang tidak natural sebagai replace resource.

Contoh:

```http
POST /cases
Content-Type: application/json

{
  "type": "ENFORCEMENT",
  "subjectId": "SUBJ-123"
}
```

```http
POST /cases/CASE-123/approve
Content-Type: application/json

{
  "reason": "All evidence validated"
}
```

`POST` tidak inherently idempotent. Jika frontend melakukan retry, server perlu idempotency key atau operation identity bila duplikasi tidak boleh terjadi.

### 3.2 PUT

`PUT` berarti replace state resource target dengan representation yang dikirim.

```http
PUT /cases/CASE-123
Content-Type: application/json

{
  "id": "CASE-123",
  "title": "Updated title",
  "priority": "HIGH",
  "status": "OPEN"
}
```

Secara HTTP, `PUT` idempotent: request yang sama dikirim berkali-kali menghasilkan intended effect yang sama terhadap resource target.

Namun idempotent bukan berarti aman dari lost update. Dua user bisa tetap saling overwrite jika tidak ada precondition.

### 3.3 PATCH

`PATCH` berarti apply partial modification.

```http
PATCH /cases/CASE-123
Content-Type: application/json

{
  "priority": "HIGH"
}
```

`PATCH` tidak otomatis idempotent. Tergantung patch document.

Idempotent patch:

```json
{ "priority": "HIGH" }
```

Non-idempotent patch:

```json
{ "incrementVersionBy": 1 }
```

Dalam API modern, `PATCH` sering dipakai untuk partial update berbasis merge patch atau domain-specific patch. Pastikan kontraknya jelas.

### 3.4 DELETE

`DELETE` meminta resource target dihapus atau dibuat tidak tersedia.

```http
DELETE /cases/CASE-123/attachments/ATT-9
```

`DELETE` idempotent dalam intended effect: setelah dihapus, mengirim request yang sama lagi tetap menghasilkan resource absent.

Tetapi response bisa berbeda:

- pertama: `204 No Content`;
- kedua: `404 Not Found` atau `204 No Content`, tergantung kontrak.

Untuk frontend, pilih behavior yang stabil terhadap retry. Untuk operasi user-facing, `204` untuk delete yang sudah absent sering lebih ergonomis bila request identity sama dan tidak ada perbedaan domain penting.

### 3.5 OPTIONS dan Preflight

Mutation yang memakai:

- method selain simple methods;
- custom header;
- `Authorization`;
- `Content-Type: application/json` dalam cross-origin request;

sering memicu CORS preflight.

Artinya mutation design juga berdampak ke latency dan failure mode:

```text
actual mutation = OPTIONS preflight + actual request
```

Jika preflight gagal, mutation tidak terjadi. Jika actual request gagal setelah preflight, mutation mungkin sudah terjadi atau belum, tergantung failure point.

---

## 4. Idempotency: Konsep yang Sering Disalahpahami

### 4.1 Definisi Praktis

Idempotency berarti:

```text
Mengirim operation yang sama lebih dari sekali tidak mengubah final intended state lebih dari satu kali.
```

Contoh idempotent:

```http
PUT /user-profiles/U-1

{ "displayName": "Ayu" }
```

Dikirim 1 kali atau 5 kali, displayName tetap `Ayu`.

Contoh non-idempotent:

```http
POST /wallets/W-1/deposits

{ "amount": 100000 }
```

Dikirim 5 kali bisa menambah saldo 5 kali jika tidak ada idempotency key.

### 4.2 Idempotency Bukan Sama dengan Safe

Safe method tidak dimaksudkan mengubah server state secara bermakna. `GET` safe.

Idempotent method boleh mengubah state, tetapi repeat tidak mengubah outcome tambahan. `PUT` dan `DELETE` idempotent.

| Concept | Mengubah state? | Repeat effect? | Contoh |
|---|---:|---:|---|
| Safe | Tidak secara intended semantics | Tidak relevan | GET, HEAD |
| Idempotent | Bisa | Tidak berulang secara cumulative | PUT, DELETE |
| Non-idempotent | Bisa | Bisa berulang | POST payment, POST comment |

### 4.3 Idempotency Bukan Retry Policy

Idempotency membuat retry lebih aman, tetapi retry tetap perlu:

- batas jumlah retry;
- backoff;
- jitter;
- timeout;
- visibility ke user;
- idempotency key expiry;
- payload fingerprint validation;
- observability.

Tanpa itu, retry bisa tetap merusak sistem melalui traffic amplification.

### 4.4 Idempotency Bukan Hanya Masalah Payment

Idempotency penting untuk:

- create order;
- submit case;
- approve workflow;
- upload attachment metadata;
- create notification;
- invite user;
- send email;
- create audit-sensitive action;
- start background job;
- create export;
- submit enforcement decision;
- trigger external integration.

Prinsipnya: jika duplicate execution merugikan, mutation perlu idempotency strategy.

---

## 5. Idempotency Key

### 5.1 Masalah yang Diselesaikan

Bayangkan frontend membuat case:

```http
POST /cases
Content-Type: application/json

{
  "subjectId": "SUBJ-123",
  "type": "ENFORCEMENT"
}
```

Server berhasil create `CASE-777`, tetapi response hilang karena network timeout. Frontend tidak tahu outcome.

Jika frontend retry tanpa identity:

```http
POST /cases
```

server bisa membuat `CASE-778`.

Dengan idempotency key:

```http
POST /cases
Idempotency-Key: 01JABCDEF123456789
Content-Type: application/json

{
  "subjectId": "SUBJ-123",
  "type": "ENFORCEMENT"
}
```

Server bisa mengenali retry dan mengembalikan hasil yang sama:

```http
HTTP/1.1 201 Created
Location: /cases/CASE-777
Content-Type: application/json

{
  "id": "CASE-777",
  "status": "OPEN"
}
```

### 5.2 Kontrak Idempotency Key yang Baik

Kontrak harus menjelaskan:

1. Header atau field apa yang menjadi key.
2. Scope key: per endpoint, per actor, per tenant, atau global.
3. Masa berlaku key.
4. Apa yang terjadi jika key sama dan payload sama.
5. Apa yang terjadi jika key sama tetapi payload berbeda.
6. Apakah response pertama disimpan dan diputar ulang.
7. Apakah failure response juga disimpan.
8. Bagaimana pending/in-progress request ditangani.
9. Apa status code untuk conflict key.
10. Bagaimana correlation ID berbeda dari idempotency key.

Contoh dokumentasi ringkas:

```text
For POST /cases, clients SHOULD send Idempotency-Key.
The key is scoped by authenticated user + endpoint + tenant.
Keys are retained for 24 hours.
If the same key and same request fingerprint is received again, the server returns the original result.
If the same key is reused with a different fingerprint, the server returns 409 Conflict.
If the first request is still processing, the server returns 409 Conflict or 202 Accepted with the operation status URL, depending on operation type.
```

### 5.3 Idempotency Key vs Correlation ID

Jangan campur.

| Concept | Tujuan | Repeat request memakai value sama? | Dipakai untuk dedupe? |
|---|---|---:|---:|
| Correlation ID / Trace ID | Observability | Bisa berbeda per attempt atau sama per logical flow | Tidak |
| Idempotency Key | Operation identity | Ya, untuk logical operation yang sama | Ya |
| Request ID | Unique request attempt | Tidak, setiap attempt baru | Tidak |

Struktur yang sehat:

```http
POST /cases
Idempotency-Key: op_01JABCDEF
X-Request-ID: req_01JXYZ
traceparent: 00-...
```

Retry attempt berikutnya:

```http
POST /cases
Idempotency-Key: op_01JABCDEF
X-Request-ID: req_01JXYZ2
traceparent: 00-...
```

Logical operation sama, request attempt berbeda.

### 5.4 Payload Fingerprint

Server sebaiknya tidak hanya menyimpan key. Server juga menyimpan fingerprint payload.

Jika request pertama:

```json
{ "amount": 100000, "currency": "IDR" }
```

lalu request kedua dengan key sama tetapi payload berbeda:

```json
{ "amount": 999999, "currency": "IDR" }
```

server harus menolak:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/idempotency-key-reused",
  "title": "Idempotency key reused with different request payload",
  "status": 409,
  "code": "IDEMPOTENCY_KEY_REUSED",
  "retryable": false
}
```

Kalau tidak, bug client atau malicious replay bisa menghasilkan state tidak masuk akal.

### 5.5 Menyimpan Response Pertama

Untuk operation yang sudah commit, retry sebaiknya mengembalikan response original atau representasi equivalent.

Contoh:

```text
Attempt 1 -> server creates CASE-777 -> response lost
Attempt 2 with same key -> server returns CASE-777, not create new case
```

Ada dua pendekatan:

1. **Store complete response**: status, headers penting, body.
2. **Store operation result pointer**: resource ID/status, lalu reconstruct response.

Untuk sistem high-throughput, pendekatan kedua sering lebih scalable, tetapi harus tetap menjaga semantic stability.

### 5.6 Handling In-Progress Duplicate

Kasus sulit:

```text
T0: request A masuk dengan key K
T1: request A masih processing
T2: retry B masuk dengan key K
```

Pilihan response:

```http
409 Conflict
```

atau:

```http
202 Accepted
Location: /operations/OP-123
```

atau:

```http
425 Too Early
```

atau block sampai request pertama selesai.

Untuk frontend, kontrak terbaik biasanya:

```text
If duplicate is in progress, return 202 with operation status resource.
```

Tetapi untuk mutation cepat, `409 IN_PROGRESS` juga bisa diterima jika frontend punya retry-with-backoff.

---

## 6. Duplicate Submit dari Frontend

### 6.1 Double Click Bukan Edge Case

User bisa:

- double click submit;
- tekan Enter berkali-kali;
- refresh halaman;
- kembali ke halaman lalu submit lagi;
- membuka dua tab;
- kehilangan koneksi lalu menekan lagi;
- menggunakan browser autofill/form resubmission;
- trigger action via keyboard dan mouse bersamaan;
- memiliki extension yang mengganggu request.

Frontend harus mengurangi kemungkinan duplicate submit, tetapi backend tetap harus aman.

### 6.2 Frontend Guard Tidak Cukup

Guard umum:

```ts
if (isSubmitting) return;
setSubmitting(true);
await submit();
```

Ini membantu UX, tetapi tidak menjadi correctness guarantee karena:

- state component bisa remount;
- tab lain bisa submit;
- retry transport bisa terjadi;
- server/gateway bisa menerima duplicate;
- user bisa reload;
- mobile network bisa replay;
- malicious client bisa bypass UI.

Frontend guard adalah **convenience**, bukan **safety boundary**.

### 6.3 Pattern Frontend yang Sehat

```ts
async function createCase(input: CreateCaseInput): Promise<CaseDto> {
  const idempotencyKey = crypto.randomUUID();

  const response = await fetch('/api/cases', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(input),
    credentials: 'include',
    signal: abortSignalWithTimeout(15_000),
  });

  if (response.status === 201) return response.json();
  if (response.status === 202) return pollOperationThenReturnCase(response);
  throw await normalizeHttpError(response);
}
```

Catatan penting:

- generate key sekali per logical operation;
- jangan generate key ulang untuk retry operation yang sama;
- simpan key jika retry dilakukan setelah navigation/reload;
- jangan reuse key untuk operation berbeda.

### 6.4 Tombol Disable Bukan Idempotency

Disable tombol:

```text
reduces accidental duplicate intent
```

Idempotency key:

```text
prevents duplicate execution of same logical operation
```

Keduanya saling melengkapi.

---

## 7. Create Operation Design

### 7.1 Server-Generated ID

Pola umum:

```http
POST /cases
Content-Type: application/json
Idempotency-Key: op_abc

{
  "subjectId": "SUBJ-123",
  "type": "ENFORCEMENT"
}
```

Response:

```http
HTTP/1.1 201 Created
Location: /cases/CASE-777
Content-Type: application/json

{
  "id": "CASE-777",
  "subjectId": "SUBJ-123",
  "type": "ENFORCEMENT",
  "status": "DRAFT"
}
```

Frontend consequence:

- temporary client ID boleh dipakai di UI;
- setelah response, replace temp ID dengan server ID;
- retry harus memakai idempotency key sama;
- duplicate response harus map ke resource yang sama.

### 7.2 Client-Generated ID

Alternatif:

```http
PUT /cases/CASE-CLIENT-ULID-123
Content-Type: application/json

{
  "subjectId": "SUBJ-123",
  "type": "ENFORCEMENT"
}
```

Kelebihan:

- natural idempotency via target URI;
- offline-first lebih mudah;
- UI bisa refer ke ID final sejak awal.

Kekurangan:

- ID generation policy pindah ke client;
- security/tenant isolation harus hati-hati;
- server harus validate uniqueness dan ownership;
- tidak semua domain cocok.

Cocok untuk:

- draft lokal;
- offline-capable app;
- collaborative notes;
- temporary entities yang nanti disinkronkan.

Kurang cocok untuk:

- sequence legal/regulatory number;
- payment reference yang harus server-controlled;
- resource dengan ID yang mengandung domain authority.

### 7.3 Natural Key Create

Kadang resource punya natural uniqueness:

```http
PUT /users/by-email/ayu@example.com/preferences
```

atau:

```http
PUT /tenant/T1/settings/notification-policy
```

Ini bisa idempotent secara natural karena URI menunjuk resource tunggal.

Tetapi hati-hati: email bisa berubah, natural key bisa PII, dan path dengan identifier sensitif bisa bocor di logs/history.

---

## 8. Update Operation Design

### 8.1 Full Replace dengan PUT

`PUT` cocok jika frontend memegang representation lengkap dan memang ingin replace resource.

```http
PUT /cases/CASE-123
Content-Type: application/json
If-Match: "v7"

{
  "title": "Updated title",
  "priority": "HIGH",
  "status": "OPEN"
}
```

Jika resource berubah sejak frontend load:

```http
HTTP/1.1 412 Precondition Failed
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/stale-resource",
  "title": "The case has changed since you opened it",
  "status": 412,
  "code": "STALE_RESOURCE",
  "currentVersion": "v8",
  "retryable": false
}
```

Frontend harus:

- menampilkan conflict/stale message;
- fetch latest representation;
- membantu user merge atau reapply;
- jangan blind retry dengan payload lama.

### 8.2 Partial Update dengan PATCH

```http
PATCH /cases/CASE-123
Content-Type: application/merge-patch+json
If-Match: "v7"

{
  "priority": "HIGH"
}
```

Kelebihan:

- payload kecil;
- mengurangi overwrite field lain;
- cocok untuk form partial atau inline edit.

Kekurangan:

- semantics patch harus jelas;
- null vs absent sering membingungkan;
- validation partial lebih kompleks;
- conflict detection tetap diperlukan.

### 8.3 Domain Command Endpoint

Untuk workflow, kadang update field tidak cukup ekspresif:

```http
POST /cases/CASE-123/approve
Content-Type: application/json
Idempotency-Key: op_approve_123
If-Match: "v7"

{
  "decisionNote": "Evidence complete"
}
```

Ini lebih baik daripada:

```http
PATCH /cases/CASE-123

{ "status": "APPROVED" }
```

jika `APPROVED` bukan sekadar field value, tetapi domain transition yang:

- memvalidasi evidence;
- membuat audit event;
- mengirim notification;
- mengunci field tertentu;
- memicu SLA;
- mengubah permission;
- memanggil sistem eksternal.

Frontend consequence:

- UI action map langsung ke domain command;
- error bisa domain-specific;
- audit lebih jelas;
- idempotency key bisa per command;
- precondition bisa memastikan action dilakukan terhadap version yang user lihat.

---

## 9. Delete Operation Design

### 9.1 Hard Delete vs Soft Delete

HTTP `DELETE` tidak menentukan apakah server harus hard delete atau soft delete. Itu domain policy.

```http
DELETE /documents/DOC-123
```

Bisa berarti:

- hapus permanen;
- mark as deleted;
- move to trash;
- revoke visibility;
- schedule deletion;
- delete attachment binary tetapi retain audit metadata.

Frontend perlu tahu consequence melalui kontrak dan UI copy.

### 9.2 Response untuk DELETE

Umum:

```http
204 No Content
```

Jika delete asynchronous:

```http
202 Accepted
Content-Type: application/json

{
  "operationId": "OP-789",
  "statusUrl": "/operations/OP-789"
}
```

Jika conflict:

```http
409 Conflict
Content-Type: application/problem+json

{
  "code": "DOCUMENT_LOCKED",
  "message": "The document cannot be deleted while review is active."
}
```

Jika stale:

```http
412 Precondition Failed
```

Jika already absent, pilih dengan sadar:

- `404 Not Found`: jika absence perlu disampaikan sebagai fakta domain;
- `204 No Content`: jika delete intent sudah terpenuhi dan retry harus smooth.

### 9.3 Delete dan Undo

Frontend sering ingin “undo”. Jangan menganggap undo selalu berarti reverse DELETE.

Pilihan desain:

1. Soft delete + restore endpoint.
2. Trash resource.
3. Delayed deletion job.
4. Client-side optimistic hide, actual delete setelah delay.
5. Server-side undo token.

Contoh:

```http
POST /documents/DOC-123/trash
Idempotency-Key: op_trash_1
```

Undo:

```http
POST /documents/DOC-123/restore
Idempotency-Key: op_restore_1
```

Ini lebih eksplisit daripada DELETE jika domain sebenarnya adalah “move to trash”.

---

## 10. Optimistic UI

### 10.1 Apa itu Optimistic UI

Optimistic UI berarti frontend sementara mengasumsikan mutation akan berhasil dan langsung mengubah tampilan.

Contoh:

```text
User klik Like
UI langsung menaikkan count
Request dikirim ke server
Jika sukses: keep state
Jika gagal: rollback atau reconcile
```

Optimistic UI meningkatkan perceived performance, tetapi menambah kompleksitas correctness.

### 10.2 Kapan Optimistic UI Cocok

Cocok jika:

- operation kecil dan reversible;
- failure rate rendah;
- konflik jarang;
- user intent jelas;
- consequence tidak kritis;
- rollback mudah dipahami;
- stale UI sementara dapat diterima.

Contoh cocok:

- like/unlike;
- toggle favorite;
- rename draft lokal;
- reorder UI preference;
- mark notification as read.

### 10.3 Kapan Optimistic UI Berbahaya

Berbahaya jika:

- operasi irreversible;
- financial/legal/regulatory consequence;
- perlu approval/authorization kompleks;
- konflik sering;
- external side effect;
- user bisa mengambil keputusan lanjutan berdasarkan state palsu;
- rollback membingungkan;
- audit harus presisi.

Contoh:

- submit enforcement decision;
- approve case;
- send payment;
- delete legal evidence;
- invite external party;
- publish public content;
- revoke access.

Untuk sistem enforcement/regulatory, banyak mutation harus setidaknya **pessimistic confirmation** atau **optimistic with pending state**, bukan langsung final.

### 10.4 Tiga Level Optimism

#### Level 1 — Pessimistic UI

```text
User action -> loading -> server success -> UI update
```

Paling aman, tetapi terasa lambat.

#### Level 2 — Optimistic Pending

```text
User action -> UI shows pending intended state -> server confirms -> final state
```

Contoh:

```text
Status: Approval pending...
```

Bukan langsung:

```text
Status: Approved
```

Ini cocok untuk workflow serius.

#### Level 3 — Full Optimistic

```text
User action -> UI immediately shows final intended state -> rollback if failed
```

Cocok untuk action ringan.

### 10.5 Rollback Strategy

Rollback harus dirancang, bukan ad hoc.

Pilihan:

1. **Inverse patch**: simpan previous value lalu restore.
2. **Refetch authoritative state**: setelah failure, fetch latest.
3. **Mark as failed**: tetap tampilkan local item dengan error state.
4. **Conflict resolution**: minta user memilih.
5. **Compensating action**: kirim action pembalik ke server.

Contoh optimistic update dengan rollback konseptual:

```ts
async function updatePriority(caseId: string, newPriority: Priority) {
  const previous = queryClient.getQueryData<CaseDto>(['case', caseId]);

  queryClient.setQueryData(['case', caseId], old => ({
    ...old,
    priority: newPriority,
    _pending: true,
  }));

  try {
    const updated = await patchCasePriority(caseId, newPriority, previous!.version);
    queryClient.setQueryData(['case', caseId], updated);
  } catch (error) {
    if (isPreconditionFailed(error)) {
      await queryClient.invalidateQueries(['case', caseId]);
      showConflictMessage();
    } else {
      queryClient.setQueryData(['case', caseId], previous);
      showToast('Priority update failed. Your change was not saved.');
    }
  }
}
```

### 10.6 Optimistic UI dan Server Validation

Jangan pernah membuat optimistic UI berarti frontend menggantikan validation server.

Frontend validation:

```text
fast feedback and convenience
```

Server validation:

```text
authoritative rule enforcement
```

Jika server menolak mutation, frontend harus menerima keputusan server.

---

## 11. Concurrency dan Lost Update Problem

### 11.1 Lost Update

Lost update terjadi ketika dua actor membaca state yang sama, lalu update belakangan menimpa update sebelumnya tanpa sadar.

Timeline:

```text
T0: Alice GET /cases/CASE-1 -> version v1
T1: Bob   GET /cases/CASE-1 -> version v1
T2: Alice PATCH priority HIGH -> server v2
T3: Bob   PUT title Updated with old representation v1 -> server v3, priority balik ke old value
```

Bob tidak berniat menghapus perubahan Alice, tetapi payload lama menimpa field.

### 11.2 Optimistic Locking dengan ETag dan If-Match

Server mengirim ETag:

```http
HTTP/1.1 200 OK
ETag: "case-CASE-1-v1"
Content-Type: application/json

{
  "id": "CASE-1",
  "title": "Original",
  "priority": "NORMAL"
}
```

Frontend update dengan precondition:

```http
PATCH /cases/CASE-1
If-Match: "case-CASE-1-v1"
Content-Type: application/json

{
  "priority": "HIGH"
}
```

Jika masih v1:

```http
200 OK
ETag: "case-CASE-1-v2"
```

Jika sudah v2 oleh user lain:

```http
412 Precondition Failed
Content-Type: application/problem+json

{
  "code": "STALE_RESOURCE",
  "message": "This case was modified by another user.",
  "currentVersion": "case-CASE-1-v2"
}
```

### 11.3 409 vs 412

Gunakan bedanya dengan jelas.

| Status | Arti Praktis | Contoh |
|---|---|---|
| `409 Conflict` | Request bertentangan dengan current state/domain rule | approve case yang sudah closed; username sudah dipakai; transition invalid |
| `412 Precondition Failed` | Conditional header/precondition request tidak terpenuhi | `If-Match` tidak cocok karena resource berubah |
| `428 Precondition Required` | Server mensyaratkan precondition tetapi client tidak mengirim | update wajib pakai `If-Match` |

Untuk lost update, `412` lebih presisi daripada `409` jika conflict berasal dari failed precondition.

Untuk domain conflict, `409` lebih cocok.

### 11.4 Field-Level Merge vs Resource-Level Version

Jika update partial dan konflik hanya pada field berbeda, server bisa memilih:

1. reject semua jika version berbeda;
2. accept jika field yang diubah tidak konflik;
3. auto-merge;
4. return conflict details;
5. require user merge.

Contoh conflict details:

```json
{
  "type": "https://api.example.com/problems/edit-conflict",
  "title": "Edit conflict",
  "status": 409,
  "code": "EDIT_CONFLICT",
  "conflicts": [
    {
      "field": "priority",
      "clientBase": "NORMAL",
      "clientProposed": "HIGH",
      "serverCurrent": "URGENT"
    }
  ]
}
```

Untuk sistem kritis, eksplisit lebih baik daripada silent merge.

---

## 12. Concurrent Tabs dan Multi-Device

### 12.1 Masalah

User yang sama bisa membuka:

- dua tab pada case yang sama;
- mobile dan desktop;
- draft lama dari browser history;
- halaman yang state-nya disimpan oleh bfcache;
- offline tab yang baru sync belakangan.

Frontend state bukan single source of truth.

### 12.2 Pattern Mitigasi

1. Gunakan resource version/ETag.
2. Revalidate ketika tab visible lagi.
3. Revalidate sebelum mutation kritis.
4. Gunakan BroadcastChannel untuk sinkronisasi antar tab jika perlu.
5. Tampilkan stale indicator.
6. Gunakan server-side lock hanya jika domain membutuhkannya.
7. Jangan mengandalkan local state untuk authorization.

Contoh:

```ts
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    queryClient.invalidateQueries(['case', caseId]);
  }
});
```

### 12.3 Locking: Hati-Hati

Locking bisa membantu pada editing serius, tetapi membawa risiko:

- abandoned lock;
- lock timeout;
- user lupa menutup tab;
- mobile sleep;
- admin override;
- fairness;
- false confidence.

Jika menggunakan lock, jadikan lock sebagai domain resource:

```http
POST /cases/CASE-1/edit-locks
Idempotency-Key: op_lock_1
```

Response:

```json
{
  "lockId": "LOCK-123",
  "expiresAt": "2026-06-18T10:15:00Z",
  "holder": "user-1"
}
```

Refresh lock:

```http
PATCH /cases/CASE-1/edit-locks/LOCK-123
```

Release:

```http
DELETE /cases/CASE-1/edit-locks/LOCK-123
```

Tetap gunakan version check saat save. Lock mengurangi konflik, bukan menggantikan concurrency control.

---

## 13. Autosave

Autosave adalah salah satu mutation pattern paling rawan.

### 13.1 Risiko Autosave

- request berurutan bisa return tidak berurutan;
- request lama bisa overwrite request baru;
- user tidak tahu apakah tersimpan;
- offline state bisa diverge;
- validation error bisa muncul saat user masih mengetik;
- autosave bisa menyimpan draft invalid;
- tab lain bisa mengubah resource;
- save terakhir belum tentu response terakhir.

### 13.2 Sequence Number / Client Revision

Frontend bisa mengirim sequence:

```http
PATCH /drafts/DRAFT-1
Content-Type: application/json
If-Match: "v7"

{
  "clientRevision": 42,
  "fields": {
    "summary": "Updated summary"
  }
}
```

Frontend hanya menerima response jika response sequence >= current local sequence.

```ts
let latestMutationSeq = 0;

async function autosave(patch: DraftPatch) {
  const seq = ++latestMutationSeq;

  const response = await saveDraft({ ...patch, clientRevision: seq });

  if (seq < latestMutationSeq) {
    // stale response, do not let it overwrite newer local state
    return;
  }

  applyServerAck(response);
}
```

### 13.3 Debounce dan Flush

Autosave biasanya perlu:

- debounce user typing;
- max wait;
- flush on blur;
- flush before navigation jika aman;
- cancellation of obsolete request jika possible;
- queue jika operation harus ordered.

Namun cancellation di browser tidak berarti server membatalkan commit. `AbortController` menghentikan client waiting/reading; server mungkin sudah menerima request.

### 13.4 Draft vs Published Resource

Untuk domain serius, pisahkan:

```text
Draft mutation
vs
Submit/publish mutation
```

Draft boleh autosave partial invalid.

Submit harus menjalankan validation penuh dan domain transition.

```http
PATCH /case-drafts/DRAFT-123
```

```http
POST /case-drafts/DRAFT-123/submit
Idempotency-Key: op_submit_1
If-Match: "draft-v12"
```

Ini jauh lebih aman daripada autosave langsung ke official case.

---

## 14. Bulk Mutation dan Partial Success

### 14.1 Masalah Bulk Operation

Contoh:

```http
POST /cases/bulk-assign
Content-Type: application/json
Idempotency-Key: op_bulk_assign_1

{
  "caseIds": ["C1", "C2", "C3"],
  "assigneeId": "U7"
}
```

Pertanyaan:

- Apakah operation atomic?
- Jika C2 gagal, apakah C1 dan C3 tetap berubah?
- Bagaimana UI menampilkan partial success?
- Bagaimana retry tidak mengulang item yang sudah sukses?
- Apakah idempotency key berlaku untuk seluruh batch atau tiap item?

### 14.2 Atomic Bulk

Semua sukses atau semua gagal.

Response success:

```http
200 OK

{
  "updated": 3
}
```

Response failure:

```http
409 Conflict

{
  "code": "BULK_ASSIGNMENT_CONFLICT",
  "errors": [
    { "caseId": "C2", "code": "CASE_CLOSED" }
  ]
}
```

Cocok jika domain membutuhkan consistency kuat.

### 14.3 Partial Success Bulk

Sebagian sukses, sebagian gagal.

Hindari menyembunyikan partial success dalam `200 OK` tanpa detail.

Contoh:

```http
207 Multi-Status
Content-Type: application/json

{
  "results": [
    { "caseId": "C1", "status": "updated" },
    { "caseId": "C2", "status": "failed", "code": "CASE_CLOSED" },
    { "caseId": "C3", "status": "updated" }
  ]
}
```

`207 Multi-Status` berasal dari WebDAV dan tidak selalu dipakai API umum. Alternatif yang lebih lazim:

```http
200 OK
Content-Type: application/json

{
  "status": "PARTIAL_SUCCESS",
  "succeeded": ["C1", "C3"],
  "failed": [
    { "caseId": "C2", "code": "CASE_CLOSED", "message": "Case is already closed" }
  ]
}
```

Yang penting: kontrak eksplisit.

### 14.4 Per-Item Idempotency

Untuk bulk operation retryable, pertimbangkan item-level operation identity:

```json
{
  "items": [
    { "caseId": "C1", "operationId": "op-item-1" },
    { "caseId": "C2", "operationId": "op-item-2" },
    { "caseId": "C3", "operationId": "op-item-3" }
  ]
}
```

Atau server menyimpan idempotency untuk batch fingerprint.

Tanpa ini, retry partial success bisa menggandakan side effect untuk item yang sudah sukses.

---

## 15. Long-Running Mutation

### 15.1 Kenapa Tidak Semua Mutation Harus Synchronous

Beberapa mutation tidak cocok ditunggu dalam request-response normal:

- export report besar;
- import file;
- run validation batch;
- submit case ke external authority;
- generate PDF;
- video/image processing;
- mass reassignment;
- payment settlement;
- ML enrichment;
- legal document packaging.

Jika server menahan HTTP connection terlalu lama:

- browser timeout;
- gateway timeout;
- load balancer timeout;
- user refresh;
- duplicate submit;
- poor UX;
- resource server boros.

### 15.2 202 Accepted + Operation Resource

Pattern:

```http
POST /exports
Content-Type: application/json
Idempotency-Key: op_export_1

{
  "caseFilter": {
    "status": "OPEN"
  }
}
```

Response:

```http
HTTP/1.1 202 Accepted
Content-Type: application/json
Location: /operations/OP-123
Retry-After: 5

{
  "operationId": "OP-123",
  "status": "PENDING",
  "statusUrl": "/operations/OP-123"
}
```

Poll:

```http
GET /operations/OP-123
```

Response pending:

```json
{
  "operationId": "OP-123",
  "status": "RUNNING",
  "progress": {
    "completed": 40,
    "total": 100
  }
}
```

Response complete:

```json
{
  "operationId": "OP-123",
  "status": "SUCCEEDED",
  "result": {
    "downloadUrl": "/exports/EXP-123/download"
  }
}
```

Response failed:

```json
{
  "operationId": "OP-123",
  "status": "FAILED",
  "error": {
    "code": "EXPORT_TOO_LARGE",
    "message": "The export exceeds the maximum allowed size."
  }
}
```

### 15.3 Operation Resource Harus Punya State Machine

Contoh state:

```text
PENDING -> RUNNING -> SUCCEEDED
PENDING -> RUNNING -> FAILED
PENDING -> CANCELLED
RUNNING -> CANCELLING -> CANCELLED
RUNNING -> SUCCEEDED_WITH_WARNINGS
```

Jangan hanya `done: true/false` jika domain butuh diagnosis.

### 15.4 Cancel Operation

Jika operation bisa dibatalkan:

```http
POST /operations/OP-123/cancel
Idempotency-Key: op_cancel_1
```

atau:

```http
DELETE /operations/OP-123
```

Pilih semantics sesuai domain. Jika cancel adalah command dengan audit/side effect, endpoint command sering lebih jelas.

Frontend harus tahu:

- cancel requested tidak selalu cancel immediate;
- operation mungkin sudah selesai sebelum cancel;
- cancel harus idempotent;
- cancel response harus jelas.

---

## 16. Polling, Backoff, dan Retry-After

### 16.1 Polling Operation Resource

Frontend polling sederhana:

```ts
async function pollOperation(operationUrl: string) {
  let delayMs = 1000;

  while (true) {
    const response = await fetch(operationUrl, { credentials: 'include' });
    const operation = await response.json();

    if (operation.status === 'SUCCEEDED') return operation.result;
    if (operation.status === 'FAILED') throw operation.error;
    if (operation.status === 'CANCELLED') throw new Error('Cancelled');

    const retryAfter = response.headers.get('Retry-After');
    await sleep(retryAfter ? parseRetryAfter(retryAfter) : delayMs);
    delayMs = Math.min(delayMs * 1.5, 10_000);
  }
}
```

### 16.2 Jangan Polling Terlalu Agresif

Polling setiap 100ms untuk operation 5 menit adalah self-inflicted load.

Gunakan:

- `Retry-After`;
- exponential backoff;
- jitter;
- stop when tab hidden untuk operation non-critical;
- resume when visible;
- websocket/SSE jika perlu push.

### 16.3 Retry-After untuk Rate Limit dan Async

`Retry-After` bisa membantu frontend tahu kapan mencoba lagi untuk:

- `429 Too Many Requests`;
- `503 Service Unavailable`;
- operation polling;
- queued job.

Namun frontend tetap perlu maximum wait dan user feedback.

---

## 17. Mutation Retry Policy

### 17.1 Jangan Retry Semua Mutation

Default aman:

```text
Retry GET cautiously.
Do not blindly retry unsafe mutation unless idempotency is guaranteed.
```

Mutation boleh retry otomatis jika:

- operation idempotent secara method/URI (`PUT`, `DELETE`) dan server semantics benar;
- atau memakai idempotency key;
- atau mutation belum terkirim sama sekali;
- atau server secara eksplisit memberi retry instruction.

### 17.2 Failure Classification

| Failure | Outcome diketahui? | Retry otomatis? |
|---|---:|---:|
| Client validation error | Ya, request belum dikirim | Tidak perlu |
| 400 invalid payload | Ya, ditolak | Tidak |
| 401 session expired | Ditolak auth; bisa refresh lalu retry jika aman | Hati-hati |
| 403 forbidden | Ditolak policy | Tidak |
| 409 conflict | Ditolak domain/current state | Tidak blind retry |
| 412 stale precondition | Ditolak precondition | Refetch/merge, jangan blind retry |
| 429 rate limited | Ditolak sementara | Mungkin, ikuti Retry-After |
| 500 | Unknown/failed | Retry hanya jika idempotent/keyed |
| 502/503/504 | Unknown | Retry hanya jika idempotent/keyed |
| Network timeout | Unknown | Retry hanya jika idempotent/keyed |
| Abort by user | Unknown jika request sudah terkirim | Jangan asumsi server cancel |

### 17.3 Retry dan Auth Refresh

Skenario umum:

```text
mutation -> 401 -> refresh token -> retry mutation
```

Ini aman hanya jika mutation bisa diulang.

Jika mutation non-idempotent tanpa key, flow ini bisa duplicate dalam kasus:

```text
server actually processed mutation but response path returned 401/expired/gateway issue
client refreshes and retries
```

Untuk mutation penting, gunakan idempotency key sejak attempt pertama.

### 17.4 Retry Budget

Retry perlu budget:

```text
maxAttempts = 2 or 3
maxElapsedTime
backoff
jitter
circuit breaker-ish behavior
user cancellation
```

Tanpa budget, frontend bisa memperparah outage.

---

## 18. Race Condition di Frontend Mutation

### 18.1 Stale Response Wins

User mengetik search atau edit cepat:

```text
request A: set priority HIGH
request B: set priority URGENT
response B returns first -> UI URGENT
response A returns later -> UI HIGH (wrong)
```

Mitigasi:

- sequence number;
- cancel obsolete request;
- ignore stale response;
- server-side version/precondition;
- ordered mutation queue.

### 18.2 Route Change Race

User submit lalu pindah halaman. Response datang saat component unmounted.

Mitigasi:

- central mutation store;
- abort if operation truly irrelevant;
- do not set component state after unmount;
- for critical mutation, continue tracking operation globally;
- show notification after completion.

### 18.3 Mutation Queue

Untuk operasi yang harus ordered:

```text
edit title -> edit summary -> submit
```

Jangan biarkan submit mendahului autosave terakhir.

Gunakan queue:

```text
pending autosave flushed
then submit
```

atau server-side draft version:

```http
POST /drafts/D1/submit
If-Match: "draft-v12"
```

Jika autosave v13 belum selesai, submit v12 harus ditolak atau menunggu.

---

## 19. Response Design untuk Mutation

### 19.1 Return Representation atau Minimal Response?

Pilihan:

#### Return full updated resource

```http
200 OK
ETag: "v8"
Content-Type: application/json

{
  "id": "CASE-123",
  "priority": "HIGH",
  "status": "OPEN",
  "version": 8
}
```

Kelebihan:

- frontend langsung reconcile;
- ETag/version updated;
- server-derived fields tersedia;
- mengurangi follow-up GET.

Kekurangan:

- payload lebih besar;
- coupling dengan representation;
- expensive untuk resource besar.

#### Return 204 No Content

```http
204 No Content
ETag: "v8"
```

Kelebihan:

- ringan;
- cocok jika frontend tidak perlu body.

Kekurangan:

- frontend perlu update sendiri atau refetch;
- rawan mismatch jika server punya derived fields;
- ETag tetap sebaiknya dikirim jika berguna.

#### Return operation resource

Untuk async:

```http
202 Accepted
Location: /operations/OP-123
```

### 19.2 Prefer Header

Kadang client ingin mengontrol response verbosity:

```http
Prefer: return=minimal
```

atau:

```http
Prefer: return=representation
```

Server bisa menjawab:

```http
Preference-Applied: return=minimal
```

Ini advanced, tetapi berguna untuk API yang dipakai banyak client.

### 19.3 Location Header

Untuk create:

```http
201 Created
Location: /cases/CASE-777
```

Frontend sebaiknya tidak parsing ID dari Location jika body sudah menyediakan ID, tetapi Location tetap penting sebagai HTTP contract dan untuk non-JS clients/tooling.

---

## 20. Validation Error untuk Mutation

### 20.1 Field Error

```http
422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "code": "VALIDATION_ERROR",
  "fields": [
    {
      "path": "decisionNote",
      "code": "REQUIRED",
      "message": "Decision note is required."
    },
    {
      "path": "effectiveDate",
      "code": "MUST_BE_FUTURE_DATE",
      "message": "Effective date must be in the future."
    }
  ]
}
```

Frontend consequence:

- map field errors ke form;
- preserve user input;
- focus field pertama yang invalid;
- jangan clear form;
- jangan retry otomatis.

### 20.2 Domain Error

```http
409 Conflict

{
  "code": "INVALID_CASE_TRANSITION",
  "message": "A closed case cannot be approved.",
  "currentStatus": "CLOSED"
}
```

Frontend consequence:

- update local state;
- inform user state berubah;
- offer navigation/refetch;
- disable action.

### 20.3 Authorization Error

```http
403 Forbidden

{
  "code": "ACTION_NOT_ALLOWED",
  "message": "You do not have permission to approve this case."
}
```

Frontend consequence:

- do not retry;
- refresh permissions if stale;
- hide/disable action after confirmation;
- avoid exposing sensitive details.

---

## 21. HTTP Preconditions: If-Match, If-None-Match, 412, 428

### 21.1 If-Match untuk Update

`If-Match` menyatakan:

```text
Apply this mutation only if current resource validator matches one of these validators.
```

Contoh:

```http
PATCH /cases/CASE-1
If-Match: "v7"
```

Jika server current version bukan v7:

```http
412 Precondition Failed
```

### 21.2 If-None-Match untuk Create-if-Absent

Untuk create hanya jika belum ada:

```http
PUT /usernames/ayu
If-None-Match: *
Content-Type: application/json

{
  "userId": "U1"
}
```

Jika resource sudah ada, server menolak.

Ini berguna untuk avoiding race pada resource dengan URI known.

### 21.3 428 Precondition Required

Jika server mewajibkan conditional request:

```http
HTTP/1.1 428 Precondition Required
Content-Type: application/problem+json

{
  "code": "PRECONDITION_REQUIRED",
  "message": "This update requires If-Match. Refresh the resource and try again."
}
```

Frontend consequence:

- client bug atau stale client;
- fetch resource untuk memperoleh ETag;
- retry hanya setelah user/action valid.

---

## 22. Idempotency dan Database Transaction Boundary

Sebagai Java engineer, mutation design harus sampai ke backend transaction boundary.

### 22.1 Anti-Pattern: Check Then Insert tanpa Lock/Constraint

```java
if (!idempotencyRepository.exists(key)) {
    processPayment();
    idempotencyRepository.save(key, result);
}
```

Dua request parallel bisa melewati `exists` bersamaan.

Gunakan:

- unique constraint;
- insert-first reservation;
- transaction;
- row-level lock;
- compare-and-set state;
- deterministic operation table.

### 22.2 Idempotency Record State

Contoh table:

```text
idempotency_key
scope
request_fingerprint
status: IN_PROGRESS | SUCCEEDED | FAILED
resource_type
resource_id
response_status
response_body_ref
created_at
expires_at
```

Flow:

```text
1. Try insert key as IN_PROGRESS with fingerprint.
2. If insert succeeds, process operation.
3. Store result as SUCCEEDED/FAILED according to policy.
4. If insert conflicts, compare fingerprint.
5. If same and SUCCEEDED, return stored result.
6. If same and IN_PROGRESS, return pending/conflict.
7. If different fingerprint, return 409.
```

### 22.3 External Side Effects

Jika mutation memanggil external system:

```text
DB commit + external API + response
```

idempotency menjadi lebih sulit.

Gunakan pattern seperti:

- outbox;
- saga;
- external idempotency key propagation;
- operation state machine;
- reconciliation job;
- exactly-once illusion avoidance.

Frontend tidak perlu tahu semua detail, tetapi kontrak HTTP harus mencerminkan kemungkinan:

- accepted pending;
- external failure;
- retry status;
- final result later.

---

## 23. Mutation untuk Workflow/Regulatory Systems

Dalam regulatory/enforcement system, mutation sering berupa legal/auditable transition.

### 23.1 Jangan Treat Workflow sebagai CRUD Biasa

Buruk:

```http
PATCH /cases/CASE-1

{ "status": "ENFORCEMENT_APPROVED" }
```

Lebih baik:

```http
POST /cases/CASE-1/approve-enforcement
Idempotency-Key: op_approve_1
If-Match: "case-v17"
Content-Type: application/json

{
  "decisionNote": "Evidence threshold met",
  "effectiveDate": "2026-06-20",
  "attachments": ["ATT-1", "ATT-2"]
}
```

Kenapa:

- action punya actor;
- action punya reason;
- action punya policy;
- action punya validation;
- action punya audit trail;
- action bisa ditolak domain;
- action bukan sekadar assignment field.

### 23.2 Transition Response

```http
200 OK
ETag: "case-v18"
Content-Type: application/json

{
  "caseId": "CASE-1",
  "previousStatus": "UNDER_REVIEW",
  "currentStatus": "ENFORCEMENT_APPROVED",
  "transitionId": "TR-999",
  "auditId": "AUD-555",
  "nextActions": [
    "GENERATE_NOTICE",
    "ASSIGN_OFFICER"
  ]
}
```

Frontend bisa:

- update status;
- tampilkan audit reference;
- enable next actions;
- invalidate related queries;
- navigate ke next step.

### 23.3 Reject dengan Domain Explanation

```http
409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/transition-not-allowed",
  "title": "Transition not allowed",
  "status": 409,
  "code": "TRANSITION_NOT_ALLOWED",
  "message": "The case cannot be approved because mandatory evidence is missing.",
  "missingRequirements": [
    "SIGNED_REVIEW_NOTE",
    "VALID_SUBJECT_ADDRESS"
  ],
  "retryable": false
}
```

Frontend consequence:

- jangan tampilkan generic “Something went wrong”;
- arahkan user ke requirement yang belum terpenuhi;
- update action availability.

---

## 24. Mutation dan Cache Invalidation di Frontend

Setelah mutation sukses, cache harus disesuaikan.

### 24.1 Tiga Pilihan

1. **Set cache from response**
   - jika response berisi updated representation.
2. **Invalidate and refetch**
   - jika banyak derived data/list berubah.
3. **Optimistic patch then reconcile**
   - jika latency penting dan operation mudah diprediksi.

### 24.2 List Cache vs Detail Cache

Mutation detail bisa memengaruhi list.

Contoh update priority case:

- detail `/cases/CASE-1` berubah;
- list `/cases?status=OPEN&sort=priority` berubah posisi;
- dashboard count mungkin berubah;
- assigned queue mungkin berubah;
- audit timeline bertambah.

Frontend harus punya invalidation graph.

```text
mutation approve case
=> invalidate case detail
=> invalidate case list OPEN
=> invalidate case list APPROVED
=> invalidate dashboard counts
=> invalidate activity feed
```

Tanpa invalidation, UI terlihat inconsistent walau server benar.

### 24.3 Server Response Bisa Membantu

Response bisa menyertakan hints:

```json
{
  "case": { "id": "CASE-1", "status": "APPROVED" },
  "invalidates": [
    "case-list:open",
    "case-list:approved",
    "dashboard:case-counts"
  ]
}
```

Namun hati-hati coupling. Untuk internal enterprise apps, hints seperti ini bisa berguna bila distandarkan.

---

## 25. UI State Machine untuk Mutation

### 25.1 Minimal State

Jangan hanya `loading: boolean`.

Lebih realistis:

```text
idle
validating
submitting
submitted_pending_confirmation
succeeded
failed_validation
failed_conflict
failed_auth
failed_unknown
retrying
cancelled
```

### 25.2 State Machine Contoh

```text
IDLE
  -> SUBMITTING
SUBMITTING
  -> SUCCEEDED
  -> ACCEPTED_ASYNC
  -> FAILED_VALIDATION
  -> FAILED_CONFLICT
  -> FAILED_AUTH
  -> FAILED_UNKNOWN
ACCEPTED_ASYNC
  -> POLLING
POLLING
  -> SUCCEEDED
  -> FAILED_DOMAIN
  -> CANCEL_REQUESTED
CANCEL_REQUESTED
  -> CANCELLED
  -> SUCCEEDED_ALREADY_COMPLETED
FAILED_UNKNOWN
  -> RETRYING
  -> ABANDONED
```

### 25.3 UI Copy Berdasarkan State

| State | Copy buruk | Copy lebih baik |
|---|---|---|
| Submitting | Loading... | Saving changes... |
| Unknown timeout | Failed | We could not confirm whether the change was saved. Checking status... |
| Conflict | Error | This record changed since you opened it. Review latest version before saving. |
| Accepted async | Done | Export started. We will update this page when it is ready. |
| Validation | Error | Fix the highlighted fields before continuing. |

Copy adalah bagian dari correctness. User harus memahami apakah action sudah terjadi, belum terjadi, atau belum pasti.

---

## 26. Designing Mutation Contracts: Checklist

Untuk setiap mutation endpoint, jawab pertanyaan ini.

### 26.1 Intent

- Apakah ini create, replace, partial update, delete, atau domain command?
- Apakah endpoint URI merepresentasikan resource atau action?
- Apakah method sesuai semantics?

### 26.2 Idempotency

- Apakah duplicate execution berbahaya?
- Apakah method/URI sudah natural idempotent?
- Jika tidak, apakah perlu `Idempotency-Key`?
- Scope key apa?
- Berapa lama key disimpan?
- Apa response untuk key reused dengan payload berbeda?

### 26.3 Concurrency

- Apakah lost update mungkin?
- Apakah response GET menyediakan ETag/version?
- Apakah mutation mensyaratkan `If-Match`?
- Apa response untuk stale update?
- Apakah field-level merge dibutuhkan?

### 26.4 Response

- Apakah response return full representation, minimal, atau operation resource?
- Apakah `Location` diperlukan?
- Apakah `ETag` baru dikirim?
- Apakah error envelope konsisten?
- Apakah frontend bisa update cache dari response?

### 26.5 Failure

- Apa validation error format?
- Apa domain conflict format?
- Apa auth error behavior?
- Apa rate limit behavior?
- Apa unknown outcome strategy?
- Apakah retry aman?

### 26.6 UX

- Apakah UI pessimistic, optimistic pending, atau full optimistic?
- Apakah rollback jelas?
- Apakah user bisa cancel?
- Apakah operation bisa berjalan async?
- Apakah user perlu melihat progress?

### 26.7 Observability

- Apakah ada request ID?
- Apakah ada trace context?
- Apakah idempotency key dilog aman?
- Apakah domain transition punya audit ID?
- Apakah duplicate/retry bisa dianalisis?

---

## 27. Anti-Patterns dan Replacement

### 27.1 Anti-Pattern: Semua Mutation Pakai POST Tanpa Semantics

Buruk:

```http
POST /api/doAction

{ "action": "updateCase", "caseId": "C1", "priority": "HIGH" }
```

Masalah:

- tidak jelas resource target;
- sulit cache/invalidate;
- observability buruk;
- idempotency sulit;
- authorization policy kabur;
- tooling OpenAPI kurang berguna.

Lebih baik:

```http
PATCH /cases/C1
If-Match: "v3"

{ "priority": "HIGH" }
```

atau:

```http
POST /cases/C1/escalate
Idempotency-Key: op_escalate_1
If-Match: "v3"

{ "reason": "SLA breach" }
```

### 27.2 Anti-Pattern: Blind Retry Mutation

Buruk:

```ts
retry(() => fetch('/payments', { method: 'POST', body }))
```

Lebih baik:

```ts
retryOnlyIfIdempotent(() =>
  fetch('/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': operationKey },
    body,
  })
)
```

### 27.3 Anti-Pattern: No Version Check on Edit

Buruk:

```http
PUT /cases/C1

{ ...oldRepresentationWithUserChange }
```

Lebih baik:

```http
PUT /cases/C1
If-Match: "v7"

{ ...representation }
```

### 27.4 Anti-Pattern: Optimistic UI for Irreversible Domain Action

Buruk:

```text
User clicks Approve -> UI immediately shows Approved
```

Lebih baik:

```text
User clicks Approve -> UI shows Approving... -> server confirms -> Approved
```

Untuk action besar:

```text
Submit approval -> 202 Accepted -> operation status -> final transition result
```

### 27.5 Anti-Pattern: Error Message Tidak Membedakan Conflict vs Validation

Buruk:

```json
{ "message": "Something went wrong" }
```

Lebih baik:

```json
{
  "code": "STALE_RESOURCE",
  "status": 412,
  "message": "This case changed since you opened it.",
  "currentVersion": "v8"
}
```

---

## 28. Practical Frontend Mutation Client

Contoh konseptual TypeScript client:

```ts
type MutationOptions = {
  idempotencyKey?: string;
  etag?: string;
  timeoutMs?: number;
};

type ProblemDetails = {
  type?: string;
  title?: string;
  status: number;
  code?: string;
  message?: string;
  retryable?: boolean;
  fields?: Array<{ path: string; code: string; message: string }>;
};

async function httpMutation<TResponse>(
  input: {
    url: string;
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
  },
  options: MutationOptions = {},
): Promise<TResponse | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);

  try {
    const headers: Record<string, string> = {};

    if (input.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    if (options.etag) {
      headers['If-Match'] = options.etag;
    }

    const response = await fetch(input.url, {
      method: input.method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      credentials: 'include',
      signal: controller.signal,
    });

    if (response.status === 204) {
      return undefined;
    }

    if (response.status === 202) {
      const accepted = await response.json();
      throw new AsyncOperationAccepted(accepted);
    }

    if (!response.ok) {
      const problem = await safeReadProblem(response);
      throw classifyMutationError(response.status, problem);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new UnknownMutationOutcomeError('The request timed out or was aborted. Outcome is unknown.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
```

Hal penting:

- timeout/abort diklasifikasikan sebagai unknown outcome;
- idempotency key optional tetapi dipakai untuk non-idempotent mutation;
- ETag dikirim via `If-Match`;
- `202` tidak diperlakukan sebagai final success;
- HTTP error dinormalisasi.

---

## 29. Backend Contract Example: Case Approval

### 29.1 Read Case

```http
GET /cases/CASE-123
```

Response:

```http
200 OK
ETag: "case-123-v17"
Content-Type: application/json

{
  "id": "CASE-123",
  "status": "UNDER_REVIEW",
  "version": 17,
  "availableActions": ["APPROVE", "REQUEST_MORE_INFO"],
  "requiredEvidenceComplete": true
}
```

### 29.2 Approve

```http
POST /cases/CASE-123/approve
If-Match: "case-123-v17"
Idempotency-Key: op_01J_APPROVE_CASE_123
Content-Type: application/json

{
  "decisionNote": "Evidence reviewed and threshold met."
}
```

Success:

```http
200 OK
ETag: "case-123-v18"
Content-Type: application/json

{
  "id": "CASE-123",
  "previousStatus": "UNDER_REVIEW",
  "status": "APPROVED",
  "version": 18,
  "transitionId": "TR-456",
  "auditId": "AUD-789",
  "availableActions": ["GENERATE_NOTICE"]
}
```

Stale:

```http
412 Precondition Failed
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/stale-resource",
  "title": "Case changed",
  "status": 412,
  "code": "STALE_RESOURCE",
  "message": "This case changed since you opened it. Refresh and review the latest state before approving.",
  "currentVersion": "case-123-v18"
}
```

Domain conflict:

```http
409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/transition-not-allowed",
  "title": "Transition not allowed",
  "status": 409,
  "code": "TRANSITION_NOT_ALLOWED",
  "message": "The case cannot be approved because required evidence is incomplete.",
  "missingRequirements": ["SIGNED_REVIEW_NOTE"]
}
```

Validation:

```http
422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "code": "VALIDATION_ERROR",
  "fields": [
    {
      "path": "decisionNote",
      "code": "REQUIRED",
      "message": "Decision note is required."
    }
  ]
}
```

Duplicate same idempotency key after success:

```http
200 OK
ETag: "case-123-v18"
Content-Type: application/json

{
  "id": "CASE-123",
  "previousStatus": "UNDER_REVIEW",
  "status": "APPROVED",
  "version": 18,
  "transitionId": "TR-456",
  "auditId": "AUD-789",
  "availableActions": ["GENERATE_NOTICE"]
}
```

Duplicate key with different payload:

```http
409 Conflict
Content-Type: application/problem+json

{
  "code": "IDEMPOTENCY_KEY_REUSED",
  "message": "The idempotency key was already used with a different request payload."
}
```

This contract is defensible because:

- domain action is explicit;
- duplicate execution is controlled;
- stale update is prevented;
- conflict is domain-readable;
- validation maps to form;
- response gives frontend authoritative next state;
- audit reference is visible;
- retry behavior can be reasoned about.

---

## 30. Decision Matrix

| Mutation Type | Recommended Method | Idempotency Strategy | Concurrency Strategy | UI Strategy |
|---|---|---|---|---|
| Create with server ID | POST | Idempotency-Key | Usually none or uniqueness constraint | Pessimistic or optimistic pending |
| Create with client ID | PUT | URI identity | If-None-Match: * | Optimistic possible |
| Full replace | PUT | Method idempotency | If-Match required | Usually pessimistic/merge |
| Partial update | PATCH | Depends on patch; key if needed | If-Match recommended | Optimistic for low-risk fields |
| Domain command | POST action endpoint | Idempotency-Key | If-Match often required | Pending/confirmed |
| Delete | DELETE or command | Method idempotency/key if side effects | If-Match if stale matters | Optimistic hide only if reversible |
| Bulk operation | POST | Batch key + maybe item keys | Per-item version if needed | Progress/partial result |
| Long-running operation | POST -> 202 operation | Idempotency-Key | Operation state machine | Async progress |
| Autosave draft | PATCH | Sequence/client revision | Version/ordered queue | Pending saved indicator |

---

## 31. Deep Failure Modelling

### 31.1 Timeout After Commit

```text
Frontend sends approve
Server commits approve
Network drops before response
Frontend times out
```

Bad frontend:

```text
Show failed; user clicks approve again; duplicate transition/audit
```

Good design:

```text
Idempotency-Key reused; retry returns same transition result
or frontend checks operation/status/resource latest state
```

### 31.2 500 After Partial Side Effect

```text
Server writes DB
External notification fails
Server returns 500
```

Question: did mutation succeed?

Better design:

- DB transaction writes transition + outbox event;
- response success if transition committed;
- notification retried asynchronously;
- operation/audit status tracks downstream delivery if user cares.

Frontend should not be forced to infer internal partial state from `500`.

### 31.3 User Cancels Request

```text
User clicks Submit
Request sent
User navigates away
AbortController aborts fetch
Server still processes
```

Abort is not guaranteed cancel. If cancellation matters, model it as separate server command.

### 31.4 Refresh Token Race

```text
Mutation A returns 401
Mutation B returns 401
Both trigger refresh
Both retry
```

Mitigation:

- single-flight token refresh;
- queue pending requests;
- idempotency key for unsafe requests;
- do not retry non-idempotent mutation blindly.

### 31.5 Stale Permissions

Frontend shows Approve button because previous state said available.

User clicks, server returns 403/409 because role/state changed.

This is normal. Frontend must treat server as authority.

---

## 32. Exercises

### Exercise 1 — Payment-Like Operation

Design `POST /payments` such that:

- duplicate submit does not double charge;
- timeout outcome can be recovered;
- frontend can show pending/succeeded/failed;
- backend can call external provider;
- operation can be reconciled.

Expected concepts:

- idempotency key;
- operation resource;
- provider idempotency propagation;
- pending state;
- no blind retry without key;
- status polling.

### Exercise 2 — Case Edit Conflict

Design update flow for a case detail form where two users can edit simultaneously.

Expected concepts:

- GET with ETag;
- PATCH/PUT with If-Match;
- 412 stale response;
- conflict UI;
- refetch latest;
- merge or discard.

### Exercise 3 — Bulk Assign

Design bulk assignment for 500 cases.

Expected concepts:

- async operation;
- partial result;
- per-item errors;
- idempotency;
- progress;
- retry failed only.

### Exercise 4 — Autosave Draft

Design autosave for multi-section regulatory report.

Expected concepts:

- draft resource;
- debounce;
- sequence number;
- version;
- submit transition separate from draft save;
- stale response ignored;
- visible saved/pending/error indicator.

---

## 33. Practical Review Rubric

Saat mereview API mutation, tanyakan:

1. Jika request dikirim dua kali, apa yang terjadi?
2. Jika server commit tetapi response hilang, bagaimana client recover?
3. Jika user membuka dua tab, bagaimana lost update dicegah?
4. Jika operation lama return setelah operation baru, apakah UI bisa rusak?
5. Jika action domain ditolak, apakah frontend tahu alasan yang actionable?
6. Jika mutation membutuhkan waktu lama, mengapa bukan `202 + operation resource`?
7. Jika frontend melakukan retry setelah auth refresh, apakah aman?
8. Jika resource berubah sejak user membuka screen, apakah server menolak stale mutation?
9. Jika response sukses, apakah frontend punya authoritative state baru?
10. Jika gagal, apakah error status/body cukup untuk menentukan UI behavior?
11. Apakah idempotency key berbeda dari correlation/request ID?
12. Apakah operation punya audit identity jika domain kritis?
13. Apakah cache/list/detail invalidation jelas?
14. Apakah optimistic UI punya rollback/reconcile path?
15. Apakah backend transaction boundary mendukung kontrak HTTP?

---

## 34. Ringkasan Invariant

Pegang invariant berikut:

1. Mutation adalah state transition, bukan hanya request payload.
2. Network failure pada mutation sering berarti outcome unknown.
3. Non-idempotent mutation tidak boleh di-retry buta.
4. Idempotency key memberi identity untuk logical operation.
5. Correlation ID bukan idempotency key.
6. Frontend guard seperti disabled button bukan correctness guarantee.
7. Optimistic UI perlu rollback atau reconciliation.
8. Lost update dicegah dengan version/precondition, bukan harapan.
9. `If-Match` + ETag adalah alat HTTP-native untuk optimistic concurrency.
10. `412` berarti precondition gagal; `409` berarti conflict domain/current state.
11. Long-running mutation sebaiknya menjadi operation resource.
12. `AbortController` tidak menjamin server membatalkan mutation.
13. Autosave perlu ordering, stale-response protection, dan draft model.
14. Bulk mutation harus eksplisit soal atomic vs partial success.
15. Domain workflow serius sebaiknya dimodelkan sebagai command, bukan field patch biasa.
16. Response mutation harus membantu frontend reconcile state.
17. Mutation contract harus mencakup success, validation, conflict, stale, auth, rate limit, unknown outcome, dan retry behavior.

---

## 35. Koneksi ke Part Berikutnya

Part ini membahas desain mutation: idempotency, optimistic UI, concurrency, conflict, long-running operation, dan retry safety.

Part berikutnya, **Part 025 — Error Contract Design: Making Failures Useful to Humans and Machines**, akan memperdalam error response sebagai kontrak eksplisit:

- status code vs domain error code;
- problem details;
- validation errors;
- retryable vs non-retryable;
- user-actionable vs system-actionable;
- localization;
- correlation/support ID;
- mapping error ke UI;
- bagaimana error contract mendukung observability dan incident response.

Mutation tanpa error contract yang baik tetap rapuh, karena frontend tidak bisa membedakan “coba lagi”, “user harus memperbaiki input”, “resource sudah berubah”, “akses ditolak”, atau “outcome belum diketahui”.

---

## Referensi

- RFC 9110 — HTTP Semantics: method semantics, conditional requests, status codes, representation metadata.
- RFC 9111 — HTTP Caching: validator dan cache interaction.
- RFC 7240 — Prefer Header for HTTP: client preference seperti `return=minimal`, `return=representation`, dan `respond-async`.
- IETF HTTPAPI Idempotency-Key Header draft: `Idempotency-Key` untuk membuat request non-idempotent seperti `POST`/`PATCH` lebih fault-tolerant.
- MDN — `ETag`, `If-Match`, `If-None-Match`, `412 Precondition Failed`, `428 Precondition Required`, status codes, Fetch API.
- OWASP guidance terkait secure API behavior, CSRF, dan error handling.


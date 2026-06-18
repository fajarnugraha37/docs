# learn-http-for-web-frontend-perspective-part-023.md

# Part 023 — API Design for Frontend: Resource Shape, Pagination, Filtering, Sorting

> Seri: `learn-http-for-web-frontend-perspective`  
> Bagian: `023 / 035`  
> Fokus: mendesain API HTTP yang enak dipakai frontend, stabil untuk backend, efisien di network, aman terhadap evolusi produk, dan mudah didiagnosis ketika gagal.

---

## 0. Posisi Bagian Ini dalam Seri

Di bagian sebelumnya kita sudah membangun fondasi:

- URL, origin, site, path, query, fragment.
- HTTP message model.
- Method semantics.
- Status codes.
- Headers.
- Body, media type, representation.
- Fetch API dan non-fetch requests.
- CORS, cookies, session, CSRF.
- Browser cache, validation, redirect.
- Content negotiation.
- Resource loading, HTTP versions, TLS, security headers, browser isolation.

Sekarang kita masuk ke wilayah yang paling sering menjadi sumber friksi antar tim: **desain API untuk kebutuhan frontend**.

Banyak API terlihat “RESTful” di atas kertas, tetapi buruk bagi frontend:

- satu screen butuh 12 request berurutan;
- response terlalu besar;
- response terlalu kecil sehingga memicu under-fetching;
- pagination tidak stabil;
- filtering tidak konsisten;
- sorting tidak deterministic;
- field nullable tanpa aturan;
- error envelope tidak bisa dipetakan ke UI;
- backend mengirim bentuk database mentah, bukan kontrak produk;
- frontend menambal kekurangan API dengan state management kompleks;
- endpoint “generik” terlalu fleksibel sampai sulit di-cache, diamankan, dan diobservasi.

Bagian ini bukan tentang “cara membuat endpoint CRUD”. Tujuannya lebih dalam: membangun mental model untuk mendesain **HTTP API sebagai boundary produk, bukan sekadar wrapper database**.

---

## 1. Masalah Utama: API Bukan Database Remote

Kesalahan desain yang paling sering terjadi adalah memperlakukan API sebagai cara frontend “mengakses database lewat HTTP”.

Contoh buruk:

```http
GET /users
GET /roles
GET /departments
GET /permissions
GET /user_roles
GET /user_permissions
GET /audit_logs
```

Lalu frontend diminta menggabungkan semuanya sendiri untuk membuat satu halaman “User Detail”.

Secara backend, ini tampak modular. Secara frontend, ini menyebabkan:

- waterfall request;
- state orchestration kompleks;
- loading state berlapis;
- race condition;
- inconsistent snapshot;
- error handling sulit;
- performa buruk di jaringan mobile;
- duplikasi join logic di browser;
- kontrak produk tersebar di banyak endpoint kecil.

API yang baik bukan sekadar expose entity. API yang baik menjawab kebutuhan interaction boundary.

Mental model yang lebih sehat:

```text
UI intent -> HTTP contract -> domain/application operation -> data access
```

Bukan:

```text
database table -> repository -> controller -> frontend assembles everything
```

Frontend tidak butuh tahu bagaimana database di-normalisasi. Frontend butuh representasi yang stabil, efisien, dan sesuai kebutuhan user journey.

---

## 2. Resource vs Representation vs View Model

Dalam HTTP, resource adalah target konseptual yang diidentifikasi oleh URI. Response body adalah representation dari resource tersebut, bukan resource itu sendiri.

Contoh:

```http
GET /users/123
Accept: application/json
```

Response:

```json
{
  "id": "123",
  "name": "Ayu Pratama",
  "email": "ayu@example.com",
  "status": "ACTIVE"
}
```

`/users/123` adalah target resource. JSON di atas adalah representation.

Ini penting karena satu resource dapat punya beberapa representation:

```http
GET /users/123
Accept: application/json
```

```http
GET /users/123
Accept: text/html
```

```http
GET /users/123/avatar
Accept: image/webp
```

Dalam frontend API design, pertanyaan pentingnya bukan hanya “resource apa?”, tapi:

> representation seperti apa yang paling benar untuk konteks UI ini?

Ada tiga bentuk umum:

### 2.1 Domain Resource Representation

Representasi domain yang relatif umum.

Contoh:

```json
{
  "id": "case-123",
  "caseNumber": "ENF-2026-000123",
  "status": "UNDER_REVIEW",
  "openedAt": "2026-06-18T04:12:00Z",
  "subject": {
    "id": "org-789",
    "displayName": "PT Contoh Regulasi"
  }
}
```

Cocok untuk:

- detail entity;
- reusable API;
- domain-oriented clients;
- integrasi antar sistem;
- screen yang memang memodelkan resource tersebut.

Risiko:

- bisa terlalu mentah untuk UI;
- frontend perlu banyak request tambahan;
- database coupling kalau tidak hati-hati.

### 2.2 View-Oriented Representation

Representation yang disusun untuk kebutuhan screen tertentu.

Contoh:

```http
GET /case-workbench/cases/case-123
```

```json
{
  "case": {
    "id": "case-123",
    "caseNumber": "ENF-2026-000123",
    "status": "UNDER_REVIEW",
    "statusLabel": "Under review",
    "riskLevel": "HIGH"
  },
  "summaryCards": [
    {
      "key": "openFindings",
      "label": "Open findings",
      "value": 7
    },
    {
      "key": "pendingApprovals",
      "label": "Pending approvals",
      "value": 2
    }
  ],
  "availableActions": [
    {
      "code": "REQUEST_INFORMATION",
      "label": "Request information",
      "enabled": true
    },
    {
      "code": "CLOSE_CASE",
      "label": "Close case",
      "enabled": false,
      "disabledReason": "All findings must be resolved first."
    }
  ]
}
```

Cocok untuk:

- complex enterprise UI;
- dashboard;
- workflow screen;
- case management;
- regulatory system;
- multi-aggregate views;
- role-dependent UI.

Risiko:

- endpoint terlalu terikat ke UI tertentu;
- perlu versioning/evolution discipline;
- bisa menjadi “god endpoint” kalau semua kebutuhan dimasukkan tanpa boundary.

### 2.3 Projection / Read Model Representation

Representation yang dibuat sebagai read model khusus.

Contoh:

```http
GET /case-search-results?status=UNDER_REVIEW&assignedTo=me
```

```json
{
  "items": [
    {
      "id": "case-123",
      "caseNumber": "ENF-2026-000123",
      "subjectName": "PT Contoh Regulasi",
      "status": "UNDER_REVIEW",
      "statusLabel": "Under review",
      "assignedOfficerName": "Ayu",
      "lastActivityAt": "2026-06-18T04:12:00Z",
      "sla": {
        "state": "AT_RISK",
        "dueAt": "2026-06-21T17:00:00Z"
      }
    }
  ]
}
```

Cocok untuk:

- search/list pages;
- reporting-like UI;
- denormalized list rows;
- read-heavy systems;
- avoiding N+1 frontend calls.

Risiko:

- eventual consistency;
- stale projection;
- indexing complexity;
- projection drift dari domain state.

---

## 3. Prinsip Utama: API Harus Mengurangi Ambiguitas UI

Frontend yang baik bukan hanya rendering data. Frontend menjalankan state machine interaksi.

API yang buruk membuat frontend menebak:

- apakah tombol harus aktif?
- apakah user boleh melakukan action ini?
- apakah field nullable berarti belum ada, tidak berlaku, atau disembunyikan karena permission?
- apakah `status = PENDING` berarti loading, menunggu approval, atau stuck?
- apakah error bisa diretry?
- apakah halaman kosong karena filter terlalu sempit atau karena user tidak punya akses?

API yang baik mengurangi tebakan.

Contoh kurang baik:

```json
{
  "status": "PENDING",
  "amount": null
}
```

Frontend tidak tahu:

- `amount` belum dihitung?
- tidak applicable?
- user tidak punya permission?
- error saat compute?

Lebih baik:

```json
{
  "status": "PENDING_APPROVAL",
  "amount": {
    "state": "NOT_AVAILABLE",
    "reason": "WAITING_FOR_APPROVAL"
  }
}
```

Atau jika UI butuh label:

```json
{
  "status": {
    "code": "PENDING_APPROVAL",
    "label": "Pending approval",
    "category": "IN_PROGRESS"
  },
  "amount": {
    "visible": false,
    "reasonCode": "REQUIRES_APPROVAL",
    "message": "Amount will be available after approval."
  }
}
```

Top 1% engineer tidak hanya bertanya “field apa yang dikirim?”. Mereka bertanya:

> Keputusan UI apa yang bergantung pada field ini, dan apakah kontraknya cukup eksplisit untuk keputusan tersebut?

---

## 4. Endpoint Design: Resource Endpoint vs Screen Endpoint

Ada dua gaya utama endpoint untuk frontend.

### 4.1 Resource-Oriented API

Contoh:

```http
GET /cases/{caseId}
GET /cases/{caseId}/findings
GET /cases/{caseId}/tasks
GET /cases/{caseId}/documents
```

Kelebihan:

- reusable;
- mudah dipahami;
- cocok untuk banyak client;
- mapping domain jelas;
- caching per resource lebih mudah.

Kekurangan:

- bisa menyebabkan banyak request;
- frontend perlu orchestration;
- snapshot antar endpoint bisa tidak konsisten;
- UI logic tersebar.

### 4.2 Screen-Oriented / Experience API

Contoh:

```http
GET /workbench/cases/{caseId}/overview
GET /workbench/cases/{caseId}/review-panel
GET /workbench/cases/{caseId}/closure-readiness
```

Kelebihan:

- sesuai kebutuhan screen;
- mengurangi round trip;
- UI lebih sederhana;
- backend bisa mengoptimalkan query/join/cache;
- easier to ship product behavior consistently.

Kekurangan:

- endpoint lebih banyak;
- perlu naming discipline;
- risiko tight coupling ke UI;
- jika tidak dijaga, backend menjadi terlalu presentational.

### 4.3 Rule of Thumb

Gunakan resource-oriented API ketika:

- representation stabil dan reusable;
- client berbeda punya kebutuhan mirip;
- resource memang menjadi pusat interaksi;
- caching dan consistency per resource penting.

Gunakan screen-oriented API ketika:

- satu screen membutuhkan banyak aggregate;
- role/permission/action availability kompleks;
- latency menjadi masalah;
- business rules harus konsisten;
- frontend tidak boleh menebak domain decision.

Gunakan BFF ketika:

- banyak frontend client punya kebutuhan berbeda;
- backend domain API tidak ideal untuk UX;
- auth/session/cookie concern perlu dipusatkan;
- API composition perlu dekat dengan frontend;
- team topology mendukung ownership BFF.

---

## 5. Resource Shape: Stabilitas Lebih Penting dari Keindahan

Response shape yang baik memiliki karakteristik:

1. **predictable** — client tahu bentuk response tanpa banyak branch;
2. **explicit** — state penting tidak disembunyikan dalam `null` ambigu;
3. **evolvable** — field baru bisa ditambah tanpa breaking client;
4. **bounded** — tidak mengirim graph tak terbatas;
5. **cache-aware** — representation punya scope yang jelas;
6. **permission-aware** — tidak membocorkan data tersembunyi;
7. **UI-useful** — cukup untuk keputusan UI tanpa request tidak perlu.

### 5.1 Contoh Shape Buruk

```json
{
  "id": 123,
  "status": 1,
  "user": 456,
  "date": "18/06/26",
  "x": null,
  "y": true
}
```

Masalah:

- status numerik tanpa meaning;
- foreign key mentah;
- format tanggal ambigu;
- field `x` dan `y` tidak self-describing;
- tidak ada timezone;
- tidak ada display-friendly data;
- frontend harus tahu terlalu banyak internal mapping.

### 5.2 Shape Lebih Baik

```json
{
  "id": "case-123",
  "caseNumber": "ENF-2026-000123",
  "status": {
    "code": "UNDER_REVIEW",
    "label": "Under review",
    "category": "IN_PROGRESS"
  },
  "assignedOfficer": {
    "id": "user-456",
    "displayName": "Ayu Pratama"
  },
  "openedAt": "2026-06-18T04:12:00Z",
  "sla": {
    "state": "AT_RISK",
    "dueAt": "2026-06-21T17:00:00Z"
  }
}
```

Lebih baik karena:

- ID stable sebagai string;
- status eksplisit;
- tanggal ISO 8601 UTC;
- reference object cukup untuk UI;
- SLA dimodelkan sebagai konsep domain, bukan dihitung diam-diam di browser.

---

## 6. ID Design untuk Frontend

ID terlihat sepele, tetapi sangat penting untuk:

- routing;
- caching;
- state normalization;
- list rendering key;
- optimistic update;
- debugging;
- log correlation;
- security.

### 6.1 String ID Lebih Aman untuk Browser

JavaScript `Number` memiliki batas integer aman. Jangan mengirim ID besar sebagai number jika bisa melebihi safe integer.

Lebih aman:

```json
{
  "id": "9223372036854775807"
}
```

Daripada:

```json
{
  "id": 9223372036854775807
}
```

Untuk sistem Java, ini penting karena `Long` 64-bit bisa kehilangan presisi ketika masuk JavaScript number.

### 6.2 Opaque ID vs Semantic ID

Opaque ID:

```json
{
  "id": "case_01JY3K9P7VDP8Y6R7N4H9A2B1C"
}
```

Semantic/business identifier:

```json
{
  "caseNumber": "ENF-2026-000123"
}
```

Biasanya keduanya berguna:

```json
{
  "id": "case_01JY3K9P7VDP8Y6R7N4H9A2B1C",
  "caseNumber": "ENF-2026-000123"
}
```

Gunakan:

- `id` untuk internal API routing;
- `caseNumber` untuk display, search, support, human reference.

Jangan membuat frontend bergantung pada parsing ID bisnis untuk logic.

---

## 7. Nullability: Musuh Tersembunyi Kontrak API

`null` bukan satu makna. Dalam API nyata, `null` bisa berarti:

- belum ada value;
- tidak applicable;
- user tidak punya permission;
- value dihapus;
- value gagal dihitung;
- field legacy;
- backend bug;
- data migration belum selesai.

Kalau semua dimodelkan sebagai `null`, frontend menjadi penuh tebakan.

### 7.1 Buruk

```json
{
  "closedAt": null
}
```

Apa artinya?

- case belum ditutup?
- case tidak bisa ditutup?
- user tidak boleh melihat?
- data rusak?

### 7.2 Lebih Baik

Jika status cukup menjelaskan:

```json
{
  "status": "OPEN",
  "closedAt": null
}
```

Jika butuh eksplisit:

```json
{
  "closure": {
    "state": "NOT_CLOSED",
    "closedAt": null
  }
}
```

Jika permission-related:

```json
{
  "closure": {
    "visible": false,
    "reason": "INSUFFICIENT_PERMISSION"
  }
}
```

### 7.3 Rule

Gunakan `null` hanya ketika maknanya jelas dari schema dan konteks.

Kalau ada lebih dari satu kemungkinan makna, modelkan state secara eksplisit.

---

## 8. Empty State Semantics

Frontend sangat bergantung pada perbedaan:

- loading;
- empty because no data exists;
- empty because filter too narrow;
- empty because permission denied;
- empty because upstream unavailable;
- empty because feature disabled.

Jangan hanya mengembalikan:

```json
{
  "items": []
}
```

Untuk screen kompleks, lebih baik:

```json
{
  "items": [],
  "emptyState": {
    "reason": "NO_RESULTS_FOR_FILTER",
    "message": "No cases match the current filters.",
    "suggestedActions": [
      {
        "code": "CLEAR_FILTERS",
        "label": "Clear filters"
      }
    ]
  }
}
```

Atau untuk list API yang reusable:

```json
{
  "items": [],
  "page": {
    "size": 25,
    "hasNext": false
  },
  "totalCount": 0
}
```

Tingkat eksplisitnya tergantung endpoint:

- domain API boleh minimal;
- experience API sebaiknya UI-aware.

---

## 9. Pagination: Jangan Anggap Sekadar `page` dan `size`

Pagination adalah kombinasi antara:

- UX;
- database access pattern;
- consistency;
- caching;
- sorting;
- performance;
- correctness saat data berubah.

Ada tiga model utama.

---

## 10. Offset Pagination

Contoh:

```http
GET /cases?page=3&pageSize=25
```

Atau:

```http
GET /cases?offset=50&limit=25
```

Response:

```json
{
  "items": [
    { "id": "case-051", "caseNumber": "ENF-2026-000051" }
  ],
  "page": {
    "offset": 50,
    "limit": 25,
    "totalCount": 248,
    "hasNext": true
  }
}
```

### Kelebihan

- mudah dipahami;
- cocok untuk table UI;
- bisa lompat ke halaman tertentu;
- mudah untuk admin UI kecil;
- cocok ketika dataset relatif stabil.

### Kekurangan

- performa buruk untuk offset besar;
- data bisa bergeser ketika ada insert/delete;
- user bisa melihat item duplikat atau melewatkan item;
- `totalCount` bisa mahal;
- tidak ideal untuk infinite scroll.

### Failure Example

User membuka page 1:

```text
A B C D E
```

Lalu item baru `X` masuk di depan.

User membuka page 2 dengan offset:

```text
E F G H I
```

Item `E` muncul lagi. Ini bukan bug frontend. Ini konsekuensi offset pagination pada dataset berubah.

### Cocok Untuk

- admin screen kecil;
- dataset jarang berubah;
- reporting sederhana;
- kebutuhan jump-to-page;
- sort deterministic.

---

## 11. Cursor Pagination

Cursor pagination menggunakan token posisi.

Request pertama:

```http
GET /cases?limit=25&sort=-lastActivityAt
```

Response:

```json
{
  "items": [
    {
      "id": "case-123",
      "lastActivityAt": "2026-06-18T04:12:00Z"
    }
  ],
  "pageInfo": {
    "nextCursor": "eyJsYXN0QWN0aXZpdHlBdCI6IjIwMjYtMDYtMThUMDQ6MTI6MDBaIiwiaWQiOiJjYXNlLTEyMyJ9",
    "hasNext": true
  }
}
```

Request berikutnya:

```http
GET /cases?limit=25&sort=-lastActivityAt&cursor=eyJsYXN0QWN0aXZpdHlBdCI6...
```

### Kelebihan

- lebih stabil untuk infinite scroll;
- performa lebih baik untuk dataset besar;
- tidak bergantung offset besar;
- cocok untuk feed/activity/search result yang berubah.

### Kekurangan

- tidak mudah lompat ke page tertentu;
- cursor harus opaque;
- implementasi backend lebih kompleks;
- perlu sort order deterministic;
- cursor bisa invalid jika filter/sort berubah.

### Cursor Harus Opaque

Jangan minta frontend membangun cursor sendiri:

```http
GET /cases?afterLastActivityAt=2026-06-18T04:12:00Z&afterId=case-123
```

Lebih baik server mengirim opaque cursor:

```json
{
  "nextCursor": "opaque-token-from-server"
}
```

Frontend hanya menyimpan dan mengirim balik.

### Cocok Untuk

- infinite scroll;
- activity feed;
- timeline;
- notification list;
- large tables;
- mobile UX;
- dataset sering berubah.

---

## 12. Keyset Pagination

Keyset pagination adalah bentuk pagination berbasis kondisi sort key.

Contoh konseptual SQL:

```sql
SELECT *
FROM cases
WHERE (last_activity_at, id) < (:lastActivityAt, :lastId)
ORDER BY last_activity_at DESC, id DESC
LIMIT 25;
```

Dari sisi API, keyset sering diekspos sebagai cursor agar client tidak perlu tahu detail key.

Keyset membutuhkan sort deterministic.

Buruk:

```http
GET /cases?sort=-lastActivityAt
```

Jika banyak row punya `lastActivityAt` sama, urutan bisa tidak stabil.

Lebih baik secara backend:

```text
ORDER BY last_activity_at DESC, id DESC
```

API tetap bisa expose:

```http
GET /cases?sort=-lastActivityAt
```

Tetapi server harus menambahkan tie-breaker internal.

---

## 13. Pagination Response Shape

Jangan hanya mengembalikan array mentah:

```json
[
  { "id": "case-1" },
  { "id": "case-2" }
]
```

Itu membuat evolusi sulit.

Lebih baik:

```json
{
  "items": [
    { "id": "case-1" },
    { "id": "case-2" }
  ],
  "pageInfo": {
    "hasNext": true,
    "nextCursor": "abc",
    "limit": 25
  }
}
```

Untuk offset:

```json
{
  "items": [
    { "id": "case-1" },
    { "id": "case-2" }
  ],
  "page": {
    "offset": 0,
    "limit": 25,
    "totalCount": 248,
    "hasNext": true
  }
}
```

Untuk UI yang butuh metadata:

```json
{
  "items": [],
  "page": {
    "offset": 0,
    "limit": 25,
    "totalCount": 0,
    "hasNext": false
  },
  "appliedFilters": {
    "status": ["UNDER_REVIEW"],
    "assignedTo": "me"
  },
  "emptyState": {
    "reason": "NO_RESULTS_FOR_FILTER"
  }
}
```

---

## 14. `totalCount`: Mahal dan Sering Disalahgunakan

Frontend sering meminta `totalCount` untuk pagination UI.

Namun di backend, `COUNT(*)` untuk filter kompleks bisa mahal, terutama pada:

- dataset besar;
- search engine;
- permission-filtered data;
- multi-tenant systems;
- distributed stores;
- eventual-consistent indexes.

Pertanyaannya bukan “bisa kirim totalCount?”, tapi:

> Apakah UI benar-benar butuh angka total presisi?

Alternatif:

### 14.1 Exact Total

```json
{
  "totalCount": 248
}
```

Cocok untuk:

- dataset kecil;
- reporting;
- admin screen;
- legal/regulatory count requirement.

### 14.2 Estimated Total

```json
{
  "totalCount": {
    "type": "ESTIMATED",
    "value": 10000
  }
}
```

Cocok untuk:

- search result besar;
- analytics-ish display;
- approximate UX.

### 14.3 No Total, Only Has Next

```json
{
  "pageInfo": {
    "hasNext": true,
    "nextCursor": "abc"
  }
}
```

Cocok untuk:

- infinite scroll;
- feed;
- timeline;
- mobile list.

### 14.4 Threshold Count

```json
{
  "totalCount": {
    "type": "LOWER_BOUND",
    "value": 1000,
    "label": "1000+"
  }
}
```

Cocok untuk search UX yang tidak perlu presisi.

---

## 15. Filtering: Contract, Not String Concatenation

Filtering sering tumbuh liar.

Awalnya:

```http
GET /cases?status=OPEN
```

Lalu menjadi:

```http
GET /cases?status=OPEN&status=CLOSED&assignedTo=me&from=2026-01-01&to=2026-06-18&risk=HIGH&type=A&type=B&keyword=abc
```

Lalu butuh:

- AND/OR;
- range;
- contains;
- exact match;
- enum;
- null check;
- permission filtering;
- full-text search;
- saved filters.

Tanpa desain, filter grammar menjadi kacau.

---

## 16. Filtering Style 1: Simple Query Parameters

Contoh:

```http
GET /cases?status=UNDER_REVIEW&assignedTo=me&risk=HIGH
```

Kelebihan:

- sederhana;
- mudah cache;
- mudah share URL;
- mudah dibaca;
- bagus untuk filter umum.

Kekurangan:

- sulit untuk ekspresi kompleks;
- ambiguity untuk repeated params;
- tidak cocok untuk nested conditions.

### Repeated Parameter

```http
GET /cases?status=OPEN&status=UNDER_REVIEW
```

Makna harus jelas: apakah OR atau AND?

Untuk enum status, biasanya OR:

```text
status in [OPEN, UNDER_REVIEW]
```

Dokumentasikan secara eksplisit.

### Comma-Separated

```http
GET /cases?status=OPEN,UNDER_REVIEW
```

Lebih compact, tetapi perlu escaping kalau value bisa mengandung koma.

Untuk enum aman. Untuk free text tidak selalu aman.

---

## 17. Filtering Style 2: Operator Suffix

Contoh:

```http
GET /cases?openedAt.gte=2026-01-01&openedAt.lt=2026-07-01&risk.in=HIGH,CRITICAL
```

Kelebihan:

- ekspresif;
- masih URL-friendly;
- mudah dipakai di GET;
- cukup untuk banyak enterprise UI.

Kekurangan:

- perlu standardisasi operator;
- query parser lebih kompleks;
- validasi harus ketat.

Operator umum:

```text
eq      equals
ne      not equals
gt      greater than
gte     greater than or equal
lt      less than
lte     less than or equal
in      one of
contains substring/search-like match
exists  field exists / not null
```

Contoh:

```http
GET /cases?status.in=OPEN,UNDER_REVIEW&openedAt.gte=2026-01-01&openedAt.lt=2026-07-01
```

---

## 18. Filtering Style 3: JSON Filter Object

Untuk filter kompleks, GET query string bisa menjadi terlalu panjang.

Pilihan:

```http
POST /case-searches
Content-Type: application/json
```

```json
{
  "filter": {
    "and": [
      { "field": "status", "op": "in", "value": ["OPEN", "UNDER_REVIEW"] },
      { "field": "risk", "op": "eq", "value": "HIGH" },
      { "field": "openedAt", "op": "gte", "value": "2026-01-01T00:00:00Z" }
    ]
  },
  "sort": [
    { "field": "lastActivityAt", "direction": "desc" }
  ],
  "limit": 25
}
```

Response:

```json
{
  "items": [],
  "pageInfo": {
    "hasNext": false
  }
}
```

Pertanyaan penting: apakah memakai POST untuk search melanggar HTTP?

Tidak selalu. `GET` ideal untuk safe retrieval dan cacheability, tetapi request body pada GET tidak portable dan tidak selalu didukung dengan baik oleh intermediary/tooling. Untuk search kompleks dengan body, POST sering praktis.

Namun beri nama dengan jujur:

```http
POST /case-searches:query
```

atau:

```http
POST /cases/search
```

Jangan membuatnya terlihat seperti mutation resource biasa jika sebenarnya query.

Konsekuensi:

- browser/proxy caching default GET tidak didapat;
- shareable URL lebih sulit;
- perlu explicit caching jika dibutuhkan;
- observability harus mencatat filter dengan hati-hati agar tidak bocor PII.

---

## 19. Filtering dan Permission

Filter tidak boleh dianggap hanya query database.

Dalam sistem nyata, hasil filter adalah:

```text
requested filter
AND tenant boundary
AND permission boundary
AND data classification boundary
AND lifecycle visibility rules
AND feature flags
```

Contoh:

```http
GET /cases?assignedTo=all
```

User mungkin hanya boleh melihat subset.

Response sebaiknya tidak berkata:

```json
{
  "totalCount": 0
}
```

jika sebenarnya ada data tetapi user tidak berhak melihat.

Tergantung produk, bisa:

- tetap kirim empty tanpa membocorkan existence;
- kirim 403 untuk filter yang tidak allowed;
- kirim applied visibility metadata.

Contoh untuk admin-ish UI:

```json
{
  "items": [],
  "visibility": {
    "scope": "ASSIGNED_TO_ME",
    "reason": "USER_ROLE_LIMITATION"
  }
}
```

Untuk security-sensitive system, jangan bocorkan apakah data ada.

---

## 20. Sorting: Determinism adalah Invariant

Sorting tampak sederhana:

```http
GET /cases?sort=-lastActivityAt
```

Namun jika banyak item punya `lastActivityAt` sama, urutan bisa berubah antar request.

Sorting yang tidak deterministic merusak:

- pagination;
- infinite scroll;
- cursor;
- cache;
- user trust;
- test stability.

### 20.1 Sort Parameter Convention

Simple:

```http
GET /cases?sort=lastActivityAt
GET /cases?sort=-lastActivityAt
```

Multiple:

```http
GET /cases?sort=-lastActivityAt,caseNumber
```

Explicit object untuk POST search:

```json
{
  "sort": [
    { "field": "lastActivityAt", "direction": "desc" },
    { "field": "id", "direction": "desc" }
  ]
}
```

### 20.2 Server Tie-Breaker

Walaupun client hanya minta:

```http
GET /cases?sort=-lastActivityAt
```

Server harus memastikan internal order:

```text
ORDER BY last_activity_at DESC, id DESC
```

Kalau tie-breaker tidak exposed, tetap masukkan ke cursor.

### 20.3 Sort Field Allowlist

Jangan biarkan client sort by arbitrary DB column.

Buruk:

```http
GET /cases?sort=internal_risk_score_raw
```

Lebih baik:

```text
Allowed sort fields:
- caseNumber
- openedAt
- lastActivityAt
- riskLevel
- status
```

Jika field tidak valid:

```http
400 Bad Request
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.example.com/problems/invalid-sort",
  "title": "Invalid sort field",
  "status": 400,
  "detail": "Sort field 'internal_risk_score_raw' is not supported.",
  "invalidParams": [
    {
      "name": "sort",
      "reason": "Unsupported field: internal_risk_score_raw"
    }
  ]
}
```

---

## 21. Searching vs Filtering

Filtering biasanya deterministic structured predicate.

Search biasanya relevance-based.

Filter:

```http
GET /cases?status=OPEN&risk=HIGH
```

Search:

```http
GET /cases/search?q=late%20filing
```

Filter expectation:

- exact;
- explainable;
- stable;
- deterministic;
- good for audit.

Search expectation:

- relevance ranking;
- typo tolerance;
- stemming;
- synonym;
- scoring;
- less deterministic.

Jangan mencampur tanpa kontrak.

Untuk regulatory/case management systems, ini penting:

- filter cocok untuk compliance workflow;
- search cocok untuk discovery;
- audit decision tidak sebaiknya bergantung pada ranking search yang opaque.

---

## 22. Field Selection: Mengurangi Payload Tanpa Merusak Kontrak

Field selection memungkinkan client meminta subset field.

Contoh:

```http
GET /cases?fields=id,caseNumber,status,lastActivityAt
```

Atau gaya JSON:API sparse fieldsets:

```http
GET /articles?fields[articles]=title,body&fields[people]=name
```

Kelebihan:

- payload lebih kecil;
- reusable endpoint;
- mengurangi over-fetching;
- cocok untuk mobile/low bandwidth.

Kekurangan:

- cache key makin bervariasi;
- schema observability lebih kompleks;
- frontend bisa terlalu bebas dan menciptakan banyak kombinasi;
- authorization per field harus jelas;
- backend query planning lebih rumit.

### 22.1 Gunakan Preset Jika Kombinasi Terlalu Banyak

Daripada:

```http
GET /cases?fields=id,caseNumber,status,lastActivityAt,assignedOfficer,risk,sla,summary,permissions
```

Pertimbangkan:

```http
GET /cases?view=list
GET /cases?view=compact
GET /cases?view=detail
```

Atau:

```http
GET /cases?projection=list-row
```

Response contract lebih stabil:

```json
{
  "items": [
    {
      "id": "case-123",
      "caseNumber": "ENF-2026-000123",
      "status": "UNDER_REVIEW",
      "lastActivityAt": "2026-06-18T04:12:00Z"
    }
  ]
}
```

### 22.2 Rule

Field selection cocok ketika:

- client banyak;
- resource besar;
- field independent;
- authorization per field sederhana;
- caching strategy siap.

Projection preset cocok ketika:

- UI patterns jelas;
- kontrak ingin stabil;
- backend ingin mengontrol query shape;
- security/permission kompleks.

---

## 23. Include / Expand Pattern

Frontend sering membutuhkan related data.

Tanpa include:

```http
GET /cases/case-123
GET /users/user-456
GET /organizations/org-789
```

Dengan include:

```http
GET /cases/case-123?include=assignedOfficer,subject
```

Response:

```json
{
  "id": "case-123",
  "caseNumber": "ENF-2026-000123",
  "assignedOfficer": {
    "id": "user-456",
    "displayName": "Ayu Pratama"
  },
  "subject": {
    "id": "org-789",
    "displayName": "PT Contoh Regulasi"
  }
}
```

### Kelebihan

- mengurangi request;
- client lebih fleksibel;
- endpoint tetap resource-oriented.

### Risiko

- graph explosion;
- N+1 di backend;
- permission leak;
- cache key bervariasi;
- response terlalu besar;
- client bisa meminta nested include tak terbatas.

### Batasan yang Sehat

```text
Allowed includes:
- assignedOfficer
- subject
- latestFinding
- openTasks

Max include depth: 1
Max expanded collection size: 10
```

Untuk collection besar, jangan expand full list.

Buruk:

```http
GET /cases/case-123?include=allFindings,allDocuments,allAuditLogs
```

Lebih baik:

```http
GET /cases/case-123/summary
GET /cases/case-123/findings?limit=25
GET /cases/case-123/documents?limit=25
GET /cases/case-123/audit-logs?limit=50
```

Atau screen endpoint:

```http
GET /workbench/cases/case-123/overview
```

---

## 24. Over-Fetching dan Under-Fetching

### 24.1 Over-Fetching

Frontend menerima data lebih banyak dari yang dibutuhkan.

Contoh:

```http
GET /cases/case-123
```

Response berisi:

- 300 field;
- audit history;
- documents;
- comments;
- internal metadata;
- permission graph.

Padahal screen hanya butuh title dan status.

Dampak:

- payload besar;
- parsing lambat;
- memory pressure;
- data leak risk;
- cache invalidation lebih sering;
- mobile performance buruk.

### 24.2 Under-Fetching

Frontend harus melakukan banyak request tambahan.

Contoh:

```text
GET /cases/123
GET /cases/123/tasks
GET /cases/123/findings
GET /cases/123/documents
GET /users/456
GET /organizations/789
GET /cases/123/available-actions
```

Dampak:

- waterfall latency;
- inconsistent snapshot;
- loading state kompleks;
- higher failure surface;
- frontend composition logic berat.

### 24.3 Solusi Bukan Selalu GraphQL

GraphQL memang dirancang agar client memilih data yang dibutuhkan, dan spesifikasinya menekankan bahwa operasi memilih informasi yang dibutuhkan sehingga menghindari over-fetching dan under-fetching dalam model query tersebut.

Namun GraphQL bukan solusi otomatis untuk semua kasus:

- query cost perlu dikontrol;
- authorization per field lebih sulit;
- caching HTTP lebih tidak langsung;
- N+1 tetap bisa terjadi;
- schema governance tetap diperlukan;
- frontend bisa membuat query terlalu mahal.

Untuk banyak sistem enterprise, kombinasi berikut sering lebih pragmatis:

```text
Domain REST API + projection endpoints + BFF + strict contract + OpenAPI/schema validation
```

---

## 25. Batch Endpoints

Batch endpoint mengurangi request count.

Contoh:

```http
POST /users:batchGet
Content-Type: application/json
```

```json
{
  "ids": ["user-1", "user-2", "user-3"]
}
```

Response:

```json
{
  "items": [
    {
      "id": "user-1",
      "displayName": "Ayu"
    },
    {
      "id": "user-2",
      "displayName": "Bima"
    }
  ],
  "errors": [
    {
      "id": "user-3",
      "code": "NOT_FOUND"
    }
  ]
}
```

### Kapan Berguna

- frontend punya list IDs dari satu source;
- butuh hydrate display labels;
- menghindari N request kecil;
- data relatif independent;
- partial failure acceptable.

### Risiko

- caching per item lebih sulit;
- response partial failure perlu desain;
- endpoint bisa jadi escape hatch buruk;
- authorization per ID harus dicek.

### Jangan Gunakan Batch untuk Menutupi API yang Salah

Jika setiap screen selalu memanggil batch yang sama, mungkin Anda butuh projection endpoint.

Buruk:

```text
Screen selalu:
GET /cases
POST /users:batchGet
POST /organizations:batchGet
POST /sla:batchGet
POST /permissions:batchGet
```

Lebih baik:

```http
GET /case-workbench/list?status=UNDER_REVIEW
```

---

## 26. Composite Screen Endpoint

Composite endpoint mengirim data yang dibutuhkan satu screen.

Contoh:

```http
GET /workbench/home
```

Response:

```json
{
  "assignedCases": {
    "items": [
      {
        "id": "case-123",
        "caseNumber": "ENF-2026-000123",
        "status": "UNDER_REVIEW"
      }
    ],
    "pageInfo": {
      "hasNext": true
    }
  },
  "alerts": [
    {
      "id": "alert-1",
      "severity": "HIGH",
      "message": "Two cases are approaching SLA breach."
    }
  ],
  "metrics": {
    "openCases": 18,
    "atRiskCases": 3
  }
}
```

### Kelebihan

- fast first render;
- single consistent snapshot;
- simpler frontend;
- backend can optimize.

### Risiko

- endpoint grows too large;
- cache invalidation complex;
- partial failure semantics needed;
- screen coupling.

### Partial Failure Shape

Untuk composite endpoint, jangan selalu gagal total jika satu widget gagal.

Contoh:

```json
{
  "assignedCases": {
    "state": "READY",
    "items": []
  },
  "alerts": {
    "state": "ERROR",
    "error": {
      "code": "ALERT_SERVICE_UNAVAILABLE",
      "message": "Alerts are temporarily unavailable."
    }
  },
  "metrics": {
    "state": "READY",
    "openCases": 18,
    "atRiskCases": 3
  }
}
```

Ini membantu UI menampilkan sebagian halaman tanpa menipu user.

---

## 27. API Shape untuk Available Actions

Dalam workflow/case management, frontend sering perlu tahu action apa yang boleh dilakukan user.

Buruk:

```json
{
  "status": "UNDER_REVIEW",
  "role": "SUPERVISOR"
}
```

Lalu frontend hardcode:

```js
if (status === "UNDER_REVIEW" && role === "SUPERVISOR") {
  showApproveButton();
}
```

Masalah:

- business rule bocor ke frontend;
- rule duplication;
- sulit audit;
- permission drift;
- release frontend diperlukan untuk rule change.

Lebih baik:

```json
{
  "case": {
    "id": "case-123",
    "status": "UNDER_REVIEW"
  },
  "availableActions": [
    {
      "code": "APPROVE_REVIEW",
      "label": "Approve review",
      "enabled": true,
      "method": "POST",
      "href": "/cases/case-123/review-approval"
    },
    {
      "code": "CLOSE_CASE",
      "label": "Close case",
      "enabled": false,
      "disabledReason": "There are unresolved findings."
    }
  ]
}
```

Frontend tetap boleh punya UX logic, tapi authorization dan lifecycle decision berasal dari backend.

### Invariant

Frontend boleh memilih **cara menampilkan action**. Backend harus menjadi source of truth untuk **apakah action allowed**.

---

## 28. Links and Affordances

API bisa mengirim link/action affordance.

Contoh:

```json
{
  "id": "case-123",
  "caseNumber": "ENF-2026-000123",
  "links": {
    "self": "/cases/case-123",
    "findings": "/cases/case-123/findings",
    "documents": "/cases/case-123/documents"
  }
}
```

Untuk action:

```json
{
  "actions": [
    {
      "rel": "request-information",
      "method": "POST",
      "href": "/cases/case-123/information-requests",
      "requiredFields": ["recipientId", "message"]
    }
  ]
}
```

Ini bisa membantu decoupling, tetapi jangan berlebihan.

Hypermedia penuh jarang dipakai disiplin di banyak SPA enterprise. Namun affordance ringan sangat berguna untuk:

- workflow action;
- permission-aware buttons;
- navigation hints;
- downloadable resources;
- next/previous pagination.

---

## 29. Versioning dan Evolvability

Frontend API harus bisa berubah tanpa merusak client lama.

### 29.1 Perubahan yang Biasanya Aman

- menambah field baru;
- menambah enum value jika client siap fallback;
- menambah optional object;
- menambah link;
- menambah metadata;
- menambah endpoint baru.

### 29.2 Perubahan yang Biasanya Breaking

- menghapus field;
- mengganti tipe field;
- mengubah semantic field;
- mengubah date format;
- mengganti enum value tanpa compatibility;
- mengubah pagination contract;
- mengubah error envelope;
- mengubah default sort;
- mengubah nullability;
- mengubah permission visibility behavior.

### 29.3 Enum Evolution

Buruk:

```ts
switch (status) {
  case "OPEN":
  case "CLOSED":
    ...
}
```

Tanpa fallback, frontend rusak saat backend menambah:

```text
REOPENED
ESCALATED
UNDER_LEGAL_REVIEW
```

API bisa membantu dengan category:

```json
{
  "status": {
    "code": "UNDER_LEGAL_REVIEW",
    "label": "Under legal review",
    "category": "IN_PROGRESS"
  }
}
```

Frontend bisa fallback berdasarkan category.

---

## 30. Date and Time Design

Jangan kirim tanggal ambigu.

Buruk:

```json
{
  "openedAt": "18/06/2026"
}
```

Lebih baik untuk timestamp:

```json
{
  "openedAt": "2026-06-18T04:12:00Z"
}
```

Untuk date-only:

```json
{
  "dueDate": "2026-06-21"
}
```

Bedakan:

- instant/timestamp;
- local date;
- local time;
- timezone-aware schedule;
- duration;
- relative SLA.

Contoh SLA:

```json
{
  "sla": {
    "state": "AT_RISK",
    "dueAt": "2026-06-21T17:00:00Z",
    "businessTimezone": "Asia/Jakarta",
    "remainingBusinessHours": 12
  }
}
```

Untuk sistem regulasi, jangan membuat frontend menghitung SLA kompleks jika aturan business calendar ada di backend.

---

## 31. Money, Decimal, and Precision

JavaScript number adalah floating point. Untuk uang atau decimal presisi, hindari number ambigu.

Buruk:

```json
{
  "penaltyAmount": 1000000.25
}
```

Lebih aman:

```json
{
  "penaltyAmount": {
    "amount": "1000000.25",
    "currency": "IDR"
  }
}
```

Atau minor units:

```json
{
  "penaltyAmount": {
    "minorUnits": "100000025",
    "currency": "IDR",
    "scale": 2
  }
}
```

Pilihan tergantung domain, tetapi kontraknya harus eksplisit.

---

## 32. API and UI State Machines

HTTP response harus membantu frontend membangun state machine yang benar.

Contoh case lifecycle:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> CLOSED
```

UI state mungkin:

```text
loading
ready
saving
save_failed
readonly
forbidden
conflict
stale
```

API perlu memberi cukup informasi untuk transisi.

Contoh response detail:

```json
{
  "case": {
    "id": "case-123",
    "status": "UNDER_REVIEW",
    "version": 17
  },
  "editing": {
    "mode": "READ_WRITE",
    "lock": {
      "state": "NOT_LOCKED"
    }
  },
  "availableActions": [
    {
      "code": "SAVE_DRAFT",
      "enabled": true
    },
    {
      "code": "SUBMIT_FOR_APPROVAL",
      "enabled": false,
      "disabledReason": "Required field 'Finding summary' is missing."
    }
  ]
}
```

Frontend tidak perlu menebak dari banyak field mentah.

---

## 33. Consistency: Snapshot Problem

Jika screen memanggil banyak endpoint:

```text
GET /cases/123
GET /cases/123/findings
GET /cases/123/tasks
GET /cases/123/available-actions
```

Ada risiko data berasal dari waktu berbeda.

Contoh:

- `/cases/123` mengatakan status `UNDER_REVIEW`;
- `/available-actions` dihitung setelah case berubah ke `CLOSED`;
- UI menampilkan tombol yang salah.

Solusi:

### 33.1 Composite Endpoint

```http
GET /case-workbench/cases/123
```

Server menyusun snapshot konsisten.

### 33.2 Version Metadata

```json
{
  "case": {
    "id": "case-123",
    "version": 17
  },
  "availableActionsVersion": 17
}
```

### 33.3 Conditional Mutation

Mutation berikutnya membawa version:

```http
PATCH /cases/case-123
If-Match: "17"
```

Jika stale:

```http
412 Precondition Failed
```

Ini akan dibahas lebih dalam di Part 024.

---

## 34. API Response for Tables

Enterprise frontend sering punya table besar.

Table API yang baik bukan hanya `items`.

Contoh:

```json
{
  "items": [
    {
      "id": "case-123",
      "caseNumber": "ENF-2026-000123",
      "subjectName": "PT Contoh Regulasi",
      "status": {
        "code": "UNDER_REVIEW",
        "label": "Under review",
        "category": "IN_PROGRESS"
      },
      "riskLevel": "HIGH",
      "lastActivityAt": "2026-06-18T04:12:00Z",
      "rowActions": [
        {
          "code": "OPEN",
          "label": "Open",
          "href": "/cases/case-123"
        }
      ]
    }
  ],
  "pageInfo": {
    "nextCursor": "abc",
    "hasNext": true,
    "limit": 25
  },
  "sort": [
    {
      "field": "lastActivityAt",
      "direction": "desc"
    }
  ],
  "filters": {
    "applied": {
      "status": ["UNDER_REVIEW"],
      "assignedTo": "me"
    },
    "available": {
      "status": [
        { "code": "OPEN", "label": "Open" },
        { "code": "UNDER_REVIEW", "label": "Under review" }
      ]
    }
  }
}
```

Kenapa `available` filters berguna?

- filter options bisa permission-aware;
- label berasal dari backend/domain;
- frontend tidak hardcode enum;
- feature flag dapat mengubah options.

Namun jangan kirim metadata terlalu besar untuk setiap request jika tidak berubah. Bisa dipisahkan:

```http
GET /case-search/metadata
GET /case-search/results?status=UNDER_REVIEW
```

---

## 35. URL Design untuk Query API

URL harus membantu:

- readability;
- bookmarking;
- caching;
- logs;
- debugging;
- security review.

### 35.1 Good Query URL

```http
GET /cases?status=UNDER_REVIEW&assignedTo=me&sort=-lastActivityAt&limit=25
```

Jelas, shareable, log-friendly.

### 35.2 Bad Query URL

```http
GET /getData?type=case&mode=1&x=true&f=abc
```

Masalah:

- semantic kabur;
- sulit debug;
- sulit document;
- sulit observe;
- sulit evolve.

### 35.3 Path vs Query

Gunakan path untuk resource identity/hierarchy:

```http
GET /cases/case-123/findings
```

Gunakan query untuk selection/filter/sort/pagination:

```http
GET /cases?status=OPEN&sort=-openedAt
```

Jangan memindahkan filter dinamis ke path:

```http
GET /cases/status/OPEN/sort/openedAt/page/2
```

Itu sulit dievolusi.

---

## 36. API Contract untuk Form Options

Frontend form sering butuh dropdown options.

Buruk:

```js
const statuses = ["OPEN", "CLOSED"];
```

Lebih baik jika options domain-driven:

```http
GET /case-form-options
```

```json
{
  "statusOptions": [
    {
      "code": "OPEN",
      "label": "Open"
    },
    {
      "code": "UNDER_REVIEW",
      "label": "Under review"
    }
  ],
  "riskLevelOptions": [
    {
      "code": "LOW",
      "label": "Low"
    },
    {
      "code": "HIGH",
      "label": "High"
    }
  ]
}
```

Untuk permission-aware action form:

```json
{
  "action": "REQUEST_INFORMATION",
  "fields": [
    {
      "name": "recipientId",
      "type": "USER_REFERENCE",
      "required": true
    },
    {
      "name": "message",
      "type": "TEXTAREA",
      "required": true,
      "maxLength": 2000
    }
  ]
}
```

Hati-hati: jangan membangun full dynamic form engine kecuali benar-benar dibutuhkan. Dynamic form API sangat powerful tetapi kompleks untuk accessibility, validation, testing, dan UX consistency.

---

## 37. Validation Contract Preview

Validation error akan dibahas detail di Part 025, tetapi API design untuk frontend harus mempertimbangkannya sejak awal.

Untuk form, response error sebaiknya bisa dipetakan ke field.

Contoh:

```http
422 Unprocessable Content
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "invalidParams": [
    {
      "name": "recipientId",
      "reason": "Recipient is required."
    },
    {
      "name": "message",
      "reason": "Message must not exceed 2000 characters."
    }
  ]
}
```

Frontend bisa menampilkan inline field error.

Jangan hanya:

```json
{
  "error": "Invalid request"
}
```

---

## 38. BFF Pattern: Backend for Frontend

BFF adalah backend layer yang disesuaikan untuk kebutuhan frontend tertentu.

Topology:

```text
Browser SPA
   |
   | HTTPS, cookies, CORS/same-origin
   v
BFF
   |
   | service-to-service auth
   v
Domain APIs / microservices
```

### 38.1 Kapan BFF Berguna

- SPA butuh menggabungkan banyak service;
- auth cookie/session ingin disembunyikan dari browser;
- domain APIs terlalu granular;
- mobile dan web punya kebutuhan berbeda;
- UI membutuhkan projection khusus;
- frontend team perlu contract yang cepat dievolusi;
- API gateway tidak cukup untuk composition logic.

### 38.2 Apa yang BFF Boleh Lakukan

- compose data;
- adapt shape;
- enforce frontend session;
- translate error;
- hide internal service topology;
- aggregate permissions;
- provide screen-specific endpoints;
- optimize request count;
- normalize headers/correlation IDs.

### 38.3 Apa yang BFF Tidak Seharusnya Lakukan

- menjadi tempat business rule yang tidak dimiliki frontend;
- bypass domain invariants;
- melakukan data write langsung ke database domain;
- menjadi dumping ground semua logic;
- menyembunyikan inconsistency tanpa traceability.

### 38.4 BFF vs API Gateway

API Gateway biasanya:

- routing;
- auth enforcement;
- rate limiting;
- TLS termination;
- request/response policy;
- observability;
- coarse transformation.

BFF biasanya:

- experience composition;
- frontend-specific contract;
- UI state assistance;
- API orchestration;
- screen projection.

Jangan memaksa API Gateway menjadi BFF penuh jika platform/ownership tidak mendukungnya.

---

## 39. Schema and Contract Discipline

API untuk frontend harus punya schema.

Minimal:

- OpenAPI untuk REST-ish APIs;
- JSON Schema untuk payload validation;
- TypeScript types generated from schema;
- contract tests;
- mock server;
- examples;
- backward compatibility check.

Tanpa schema, frontend dan backend akan berkomunikasi lewat asumsi.

### 39.1 Contract Example

Endpoint:

```http
GET /cases/{caseId}
```

Contract harus menjelaskan:

- path params;
- query params;
- headers relevant;
- status codes;
- success body;
- error bodies;
- enum values;
- nullability;
- date format;
- pagination shape;
- examples;
- permission behavior;
- cache headers if relevant.

### 39.2 Example Lebih Penting dari Banyak Orang Sadari

Schema memberi tipe. Example memberi intent.

Satu schema bisa punya banyak state:

- open case;
- closed case;
- case with no findings;
- case with hidden fields;
- case with disabled actions;
- case with stale version.

Sediakan examples untuk state penting.

---

## 40. API Design dan Cacheability

Desain API mempengaruhi caching.

### 40.1 GET dengan Query Parameter

```http
GET /cases?status=OPEN&sort=-openedAt
```

Secara teori cacheable, tergantung header.

### 40.2 POST Search

```http
POST /cases/search
```

Lebih sulit di-cache oleh browser/intermediary secara default.

### 40.3 Personalized Response

Response yang tergantung user/session sebaiknya hati-hati:

```http
Cache-Control: private, max-age=60
```

Atau:

```http
Cache-Control: no-store
```

untuk data sensitif.

### 40.4 Vary Explosion

Jika API response berbeda berdasarkan:

- Authorization;
- Cookie;
- Accept-Language;
- feature flag;
- role;
- tenant;
- Origin;

maka caching harus eksplisit. Jangan asal public cache.

---

## 41. Observability by Design

API yang baik mudah didiagnosis.

Tambahkan konsep berikut:

### 41.1 Correlation ID

Request:

```http
X-Request-ID: req-abc
```

Response:

```http
X-Request-ID: req-abc
```

Atau gunakan trace context standar jika stack mendukung.

### 41.2 Response Metadata

Untuk list/search:

```json
{
  "items": [],
  "meta": {
    "queryId": "qry-123",
    "indexVersion": "case-search-2026-06-18",
    "generatedAt": "2026-06-18T07:00:00Z"
  }
}
```

Jangan kirim internal detail sensitif, tetapi cukup untuk support/debug.

### 41.3 Server-Timing

Untuk debugging performance, server bisa mengirim:

```http
Server-Timing: db;dur=42, app;dur=18, cache;desc="hit"
```

Frontend DevTools bisa menampilkan timing ini.

---

## 42. Security and Privacy by Shape

Response shape harus minimal secara security.

Jangan mengirim field tersembunyi lalu berharap frontend tidak menampilkannya.

Buruk:

```json
{
  "id": "case-123",
  "publicSummary": "...",
  "internalRiskScore": 97,
  "investigatorNotes": "Sensitive notes",
  "showInternalRiskScore": false
}
```

Data sudah bocor ke browser.

Lebih baik:

```json
{
  "id": "case-123",
  "publicSummary": "..."
}
```

Rule:

> Kalau user tidak boleh tahu, jangan kirim ke browser.

Ini berlaku untuk:

- hidden form fields;
- disabled buttons with secret reason;
- internal IDs;
- risk scores;
- audit metadata;
- other users' information;
- authorization hints.

---

## 43. Anti-Patterns

### 43.1 Generic `/api/query`

```http
POST /api/query
```

```json
{
  "entity": "case",
  "fields": ["*"],
  "where": "status = 'OPEN'"
}
```

Masalah:

- security risk;
- impossible governance;
- poor caching;
- weak contract;
- difficult observability;
- frontend coupled to data model.

### 43.2 Response Mirrors Database Table

```json
{
  "CASE_ID": 123,
  "CASE_STAT_CD": "UR",
  "CRT_TS": "20260618041200"
}
```

Masalah:

- database leaks;
- hard to evolve;
- poor developer experience;
- UI meaning unclear.

### 43.3 One Endpoint Returns Everything

```http
GET /dashboard/full
```

Response 3 MB.

Masalah:

- slow;
- no partial loading;
- no granular caching;
- any failure breaks all;
- hard to maintain.

### 43.4 Too Many Tiny Endpoints

```text
GET /case/id
GET /case/status
GET /case/subject
GET /case/officer
GET /case/sla
```

Masalah:

- round-trip explosion;
- frontend orchestration hell;
- inconsistent snapshot.

### 43.5 UI Reimplements Authorization

```js
if (user.role === "MANAGER" && case.status === "DRAFT") {
  showSubmitButton();
}
```

Masalah:

- duplicate rule;
- wrong under edge cases;
- insecure if backend also not enforcing;
- difficult audit.

Backend must enforce; API may expose action affordance for UX.

---

## 44. Decision Framework

Gunakan pertanyaan berikut saat mendesain API untuk frontend.

### 44.1 User Journey

- Screen/action apa yang dilayani?
- Apakah data untuk read, mutation, review, approval, search, atau reporting?
- Apakah first render harus cepat?
- Apakah partial loading acceptable?
- Apakah user butuh consistent snapshot?

### 44.2 Data Shape

- Apakah response terlalu mentah?
- Apakah response terlalu UI-specific?
- Field mana yang benar-benar dibutuhkan?
- Apakah nullability eksplisit?
- Apakah enum bisa berevolusi?
- Apakah date/time/money presisi?

### 44.3 Query Model

- Apakah pagination offset, cursor, atau keyset?
- Apakah sort deterministic?
- Apakah filter grammar konsisten?
- Apakah total count benar-benar perlu?
- Apakah URL shareable perlu?
- Apakah GET cukup atau butuh POST search?

### 44.4 Performance

- Berapa request untuk render screen?
- Apakah ada waterfall?
- Apakah payload terlalu besar?
- Apakah endpoint bisa di-cache?
- Apakah field selection/projection lebih baik?
- Apakah perlu BFF?

### 44.5 Security

- Apakah response mengirim data yang tidak boleh diketahui user?
- Apakah filter bisa bypass permission?
- Apakah include/expand bisa membocorkan related data?
- Apakah error membocorkan existence?
- Apakah query params mengandung PII?

### 44.6 Evolvability

- Apa breaking changes yang mungkin terjadi?
- Apakah client punya fallback?
- Apakah schema terdokumentasi?
- Apakah examples mencakup state penting?
- Apakah contract tests ada?

### 44.7 Observability

- Kalau user melapor “data tidak muncul”, apa yang bisa dilihat?
- Apakah ada request ID / trace ID?
- Apakah applied filters dikembalikan?
- Apakah partial failure eksplisit?
- Apakah backend bisa mencari query yang sama di log?

---

## 45. Worked Example: Case Workbench Search API

Kita desain API untuk regulatory case workbench.

### 45.1 Requirement

User perlu melihat daftar case:

- filter by status;
- filter by assigned officer;
- filter by risk;
- sort by last activity;
- infinite scroll;
- row action permission-aware;
- SLA indicator;
- harus stabil saat data berubah;
- tidak boleh expose data di luar permission.

### 45.2 Endpoint

```http
GET /case-workbench/cases?status=UNDER_REVIEW&assignedTo=me&risk=HIGH&sort=-lastActivityAt&limit=25
```

### 45.3 Response

```json
{
  "items": [
    {
      "id": "case_01JY3K9P7VDP8Y6R7N4H9A2B1C",
      "caseNumber": "ENF-2026-000123",
      "subject": {
        "id": "org_01JY3K9P7V8Y6R7N4H9A2B1C9D",
        "displayName": "PT Contoh Regulasi"
      },
      "status": {
        "code": "UNDER_REVIEW",
        "label": "Under review",
        "category": "IN_PROGRESS"
      },
      "riskLevel": {
        "code": "HIGH",
        "label": "High"
      },
      "assignedOfficer": {
        "id": "user_456",
        "displayName": "Ayu Pratama"
      },
      "lastActivityAt": "2026-06-18T04:12:00Z",
      "sla": {
        "state": "AT_RISK",
        "dueAt": "2026-06-21T17:00:00Z",
        "label": "At risk"
      },
      "rowActions": [
        {
          "code": "OPEN",
          "label": "Open",
          "href": "/cases/case_01JY3K9P7VDP8Y6R7N4H9A2B1C"
        },
        {
          "code": "REQUEST_INFORMATION",
          "label": "Request information",
          "enabled": true
        }
      ]
    }
  ],
  "pageInfo": {
    "limit": 25,
    "hasNext": true,
    "nextCursor": "opaque-cursor-token"
  },
  "sort": [
    {
      "field": "lastActivityAt",
      "direction": "desc"
    }
  ],
  "appliedFilters": {
    "status": ["UNDER_REVIEW"],
    "assignedTo": "me",
    "risk": ["HIGH"]
  },
  "visibility": {
    "scope": "CURRENT_USER_ASSIGNMENTS"
  },
  "meta": {
    "generatedAt": "2026-06-18T07:00:00Z",
    "queryId": "qry_01JY3KA7RT"
  }
}
```

### 45.4 Kenapa Desain Ini Kuat

- cursor cocok untuk infinite scroll;
- sort deterministic bisa dilakukan backend dengan tie-breaker internal;
- row shape cukup untuk list, tidak perlu fetch detail;
- status/risk punya label;
- SLA dihitung backend;
- actions permission-aware;
- applied filters membantu debugging;
- visibility scope eksplisit;
- queryId membantu support;
- cursor opaque menjaga backend bebas mengubah strategy.

### 45.5 Header yang Relevan

Untuk data user-specific:

```http
Cache-Control: private, max-age=30
Vary: Accept-Language
Content-Type: application/json
```

Jika sangat sensitif:

```http
Cache-Control: no-store
```

Jika ada request ID:

```http
X-Request-ID: req_01JY3KA9Z7
```

---

## 46. Checklist PR API Design untuk Frontend

Sebelum endpoint disetujui, jawab ini.

### 46.1 Shape

- [ ] Response tidak expose database schema mentah.
- [ ] ID dikirim sebagai string jika berisiko melewati JS safe integer.
- [ ] Date/time format eksplisit.
- [ ] Money/decimal tidak kehilangan presisi.
- [ ] Nullability punya makna jelas.
- [ ] Enum punya fallback/evolution strategy.
- [ ] Empty state bisa dibedakan jika UI perlu.

### 46.2 Query

- [ ] Filter grammar konsisten.
- [ ] Sort field allowlist jelas.
- [ ] Sort deterministic.
- [ ] Pagination sesuai UX dan dataset.
- [ ] Cursor opaque jika dipakai.
- [ ] `totalCount` hanya dipakai jika perlu.

### 46.3 UX

- [ ] Endpoint menghindari waterfall tidak perlu.
- [ ] Response cukup untuk first render.
- [ ] Available actions tidak di-hardcode dari role/status di frontend.
- [ ] Partial failure dimodelkan jika composite endpoint.

### 46.4 Security

- [ ] Permission enforced backend.
- [ ] Response tidak mengirim data tersembunyi.
- [ ] Include/expand dibatasi.
- [ ] Filter tidak bypass tenant/permission.
- [ ] Query params tidak berisi PII sensitif jika bisa dihindari.

### 46.5 Operations

- [ ] Status codes benar.
- [ ] Error envelope konsisten.
- [ ] Request/trace ID tersedia.
- [ ] Cache headers eksplisit.
- [ ] Examples mencakup edge cases.
- [ ] Contract test disiapkan.

---

## 47. Ringkasan Mental Model

API frontend yang baik bukan sekadar endpoint yang “mengembalikan data”. Ia adalah kontrak untuk menjalankan user journey.

Ingat invariants ini:

1. **Resource bukan database row.**  
   Resource adalah target konseptual. Representation harus sesuai kebutuhan kontrak.

2. **Frontend tidak boleh menebak business rule penting.**  
   Authorization, lifecycle action, SLA, dan permission-sensitive decision harus datang dari backend/domain/BFF.

3. **Pagination harus sesuai sifat data.**  
   Offset untuk dataset kecil/stabil; cursor/keyset untuk list besar/berubah/infinite scroll.

4. **Sorting harus deterministic.**  
   Tanpa deterministic order, pagination tidak reliable.

5. **Filter adalah contract.**  
   Bukan sekadar string yang ditempel ke SQL.

6. **Null harus punya makna.**  
   Jika tidak jelas, modelkan state eksplisit.

7. **Over-fetching dan under-fetching adalah architectural smell.**  
   Solusinya bisa projection, include, batch, composite endpoint, BFF, atau GraphQL—tergantung constraint.

8. **Jangan kirim data yang user tidak boleh tahu.**  
   Browser bukan trusted environment.

9. **Schema tanpa examples belum cukup.**  
   State penting harus punya example.

10. **API design adalah UX, performance, security, dan operations design sekaligus.**

---

## 48. Latihan

### Latihan 1 — Diagnose API Shape

Diberikan response:

```json
{
  "id": 1234567890123456789,
  "status": 2,
  "owner": 99,
  "closed_at": null,
  "risk": "H",
  "actions": ["A", "B"]
}
```

Tulis ulang menjadi response yang lebih aman untuk frontend.

Perhatikan:

- ID precision;
- status meaning;
- owner representation;
- nullability;
- risk label;
- action affordance.

### Latihan 2 — Pilih Pagination

Untuk masing-masing use case, pilih offset atau cursor/keyset dan jelaskan alasannya:

1. Admin table 200 rows, butuh jump to page.
2. Notification feed yang selalu bertambah.
3. Search result 1 juta case, sort by relevance.
4. Audit log append-only.
5. Report regulatory bulanan yang harus punya exact total.

### Latihan 3 — Design Case List API

Desain endpoint untuk case list dengan:

- filter by status, risk, assigned officer;
- sort by SLA due date;
- row actions;
- empty state;
- cursor pagination;
- permission-aware visibility.

Tentukan:

- URL;
- response body;
- error behavior;
- cache headers;
- observability metadata.

### Latihan 4 — Identify Over/Under Fetching

Ambil satu screen nyata di sistem Anda. Hitung:

- berapa request saat first render;
- mana yang sequential;
- mana yang bisa parallel;
- field mana yang tidak dipakai;
- field mana yang kurang sehingga butuh request tambahan;
- apakah lebih baik resource endpoint, projection endpoint, batch, atau BFF.

---

## 49. Referensi

- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 9111 — HTTP Caching: https://www.rfc-editor.org/rfc/rfc9111.html
- Azure Architecture Center — Best practices for RESTful web API design: https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design
- JSON:API Specification: https://jsonapi.org/format/
- GraphQL Specification: https://spec.graphql.org/
- MDN — HTTP response status codes: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status

---

## 50. Penutup

Part ini membahas API read/query design dari perspektif frontend: resource shape, pagination, filtering, sorting, field selection, include/expand, composite endpoint, BFF, security, cacheability, dan observability.

Bagian berikutnya akan masuk ke sisi yang lebih berbahaya: **mutation design**.

Read API yang buruk membuat UI lambat dan membingungkan. Mutation API yang buruk bisa menyebabkan duplicate submit, lost update, inconsistent state, conflict yang tidak jelas, dan audit trail yang cacat.

Lanjut ke:

```text
Part 024 — Mutation Design: Idempotency, Optimistic UI, Concurrency, and Conflict
```

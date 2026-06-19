# learn-openapi-mastery-for-java-engineers-part-003.md

# Part 003 — Anatomy of an OpenAPI Document

> Seri: OpenAPI Mastery for Java Engineers  
> Part: 003 / 030  
> Status: In Progress  
> Fokus: memahami struktur dokumen OpenAPI sebagai model kontrak, bukan sekadar file YAML  
> Baseline spec: OpenAPI Specification 3.2.0, dengan catatan kompatibilitas untuk 3.0.x dan 3.1.x

---

## 0. Tujuan Part Ini

Di part sebelumnya kita membahas landscape versi: Swagger, OAS 2.0, OAS 3.0, OAS 3.1, dan OAS 3.2. Sekarang kita masuk ke fondasi yang akan dipakai di seluruh seri: **anatomi dokumen OpenAPI**.

Bagian ini menjawab pertanyaan:

1. Apa saja blok utama dalam file OpenAPI?
2. Bagaimana membaca file OpenAPI secara struktural?
3. Bagaimana membedakan metadata, deployment information, API surface, reusable components, security, tags, dan external docs?
4. Apa bedanya OpenAPI document, OpenAPI Description, entry document, bundle, dan dereferenced document?
5. Bagaimana `$ref` bekerja secara mental model?
6. Bagaimana menilai apakah struktur OpenAPI sudah sehat atau mulai menjadi hutang arsitektur?

Targetnya bukan hanya bisa menulis YAML yang valid. Targetnya adalah bisa membaca OpenAPI seperti seorang engineer senior membaca boundary contract antar sistem.

---

## 1. Mental Model Utama

OpenAPI document adalah **representasi eksplisit dari API surface dan semantik publik yang ingin dikomunikasikan kepada consumer dan tool**.

Sebuah dokumen OpenAPI biasanya berisi:

```text
OpenAPI Document
├── Specification version marker
├── API metadata
├── Server/base URL information
├── Paths and operations
├── Request parameters
├── Request bodies
├── Responses
├── Reusable components
├── Security declarations
├── Tags/grouping metadata
├── External documentation pointers
└── Specification extensions
```

Namun cara berpikir yang lebih penting adalah ini:

```text
OpenAPI Document
├── What API is this?
├── Where can it be called?
├── What capabilities does it expose?
├── What inputs are accepted?
├── What outputs can happen?
├── What data shapes are promised?
├── What security assumptions apply?
├── What reusable vocabulary exists?
├── How should humans navigate the contract?
└── How should tools process the contract?
```

Seorang Java engineer biasanya tergoda melihat OpenAPI sebagai hasil dari controller annotation. Itu berbahaya. Kalau OpenAPI hanya dilihat sebagai output framework, maka yang terdokumentasi sering kali hanyalah kebetulan implementasi saat ini, bukan kontrak yang sengaja didesain.

---

## 2. OpenAPI Document vs OpenAPI Description

Dalam percakapan sehari-hari, orang sering menyebut semua ini sebagai “OpenAPI file” atau “Swagger file”. Untuk kerja profesional, istilahnya perlu lebih presisi.

### 2.1 OpenAPI Document

**OpenAPI document** adalah satu dokumen fisik/logis, biasanya:

```text
openapi.yaml
openapi.json
paths/cases.yaml
components/schemas/case.yaml
components/responses/errors.yaml
```

Satu document bisa berupa YAML atau JSON.

### 2.2 OpenAPI Description

**OpenAPI Description** adalah keseluruhan deskripsi API. Ia bisa terdiri dari satu dokumen atau banyak dokumen yang saling terhubung melalui `$ref`, URI references, dan implicit connections.

Contoh single-document:

```text
openapi.yaml
```

Contoh multi-document:

```text
openapi.yaml
paths/
  cases.yaml
  evidence.yaml
components/
  schemas/
    case.yaml
    evidence.yaml
  responses/
    errors.yaml
```

Dokumen utama tempat parsing dimulai biasa disebut **entry document**.

### 2.3 Mengapa Perbedaan Ini Penting?

Karena banyak problem production muncul dari asumsi yang salah:

```text
Asumsi salah:
"OpenAPI kami ada di satu file, jadi gampang."

Masalah:
Satu file bisa valid tetapi tidak maintainable.
```

```text
Asumsi salah:
"OpenAPI kami multi-file, berarti sudah rapi."

Masalah:
Multi-file bisa lebih kacau kalau boundary, naming, dan reference graph tidak disiplin.
```

Yang penting bukan single-file atau multi-file. Yang penting adalah apakah dokumen tersebut punya struktur yang:

1. mudah dibaca manusia,
2. stabil untuk tooling,
3. konsisten untuk review,
4. aman untuk evolusi,
5. jelas sebagai kontrak.

---

## 3. Minimal Valid OpenAPI Document

Contoh minimal realistis:

```yaml
openapi: 3.2.0
info:
  title: Case Management API
  version: 1.0.0
paths:
  /cases:
    get:
      operationId: listCases
      summary: List cases
      responses:
        '200':
          description: Cases returned successfully
          content:
            application/json:
              schema:
                type: array
                items:
                  type: object
                  required:
                    - id
                    - status
                  properties:
                    id:
                      type: string
                    status:
                      type: string
```

Ini kecil, tetapi sudah punya unsur penting:

```text
openapi  -> versi OAS yang dipakai
info     -> identitas API/document
paths    -> API surface
operation -> capability
responses -> outcome yang dijanjikan
schema   -> bentuk data
```

Namun untuk production, ini masih terlalu miskin. Belum ada:

1. server information,
2. error model,
3. reusable schemas,
4. security,
5. tags,
6. examples,
7. pagination model,
8. ownership metadata,
9. deprecation policy,
10. reusable responses.

Minimal valid bukan berarti cukup untuk sistem nyata.

---

## 4. Production-Grade Skeleton

Untuk API serius, skeleton biasanya lebih seperti ini:

```yaml
openapi: 3.2.0
info:
  title: Enforcement Case API
  summary: API for managing enforcement case lifecycle capabilities.
  description: |
    This API exposes case lifecycle capabilities for investigation,
    evidence intake, decision recording, escalation, and closure.
  version: 1.4.0
  contact:
    name: Enforcement Platform Team
    email: enforcement-platform@example.gov
  license:
    name: Internal Use Only
servers:
  - url: https://api.example.gov/enforcement/v1
    description: Production
  - url: https://sandbox-api.example.gov/enforcement/v1
    description: Sandbox
security:
  - OAuth2ClientCredentials:
      - cases:read
      - cases:write
tags:
  - name: Cases
    description: Case lifecycle operations.
  - name: Evidence
    description: Evidence upload and review operations.
paths:
  /cases:
    get:
      tags:
        - Cases
      operationId: listCases
      summary: List cases visible to the caller
      parameters:
        - $ref: '#/components/parameters/PageSize'
        - $ref: '#/components/parameters/PageCursor'
      responses:
        '200':
          $ref: '#/components/responses/ListCasesResponse'
        '401':
          $ref: '#/components/responses/UnauthorizedError'
        '403':
          $ref: '#/components/responses/ForbiddenError'
components:
  securitySchemes:
    OAuth2ClientCredentials:
      type: oauth2
      flows:
        clientCredentials:
          tokenUrl: https://auth.example.gov/oauth2/token
          scopes:
            cases:read: Read case data.
            cases:write: Create or update case data.
  parameters:
    PageSize:
      name: pageSize
      in: query
      required: false
      schema:
        type: integer
        minimum: 1
        maximum: 100
        default: 25
    PageCursor:
      name: cursor
      in: query
      required: false
      schema:
        type: string
  responses:
    UnauthorizedError:
      description: Authentication is missing or invalid.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
    ForbiddenError:
      description: Caller is authenticated but not allowed to access the resource.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
    ListCasesResponse:
      description: Cases returned successfully.
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/CaseListPage'
  schemas:
    CaseListPage:
      type: object
      required:
        - items
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/CaseSummary'
        nextCursor:
          type:
            - string
            - 'null'
    CaseSummary:
      type: object
      required:
        - id
        - referenceNumber
        - status
        - createdAt
      properties:
        id:
          type: string
        referenceNumber:
          type: string
        status:
          type: string
          enum:
            - intake
            - under_review
            - investigation
            - decision_pending
            - closed
        createdAt:
          type: string
          format: date-time
    Problem:
      type: object
      required:
        - type
        - title
        - status
      properties:
        type:
          type: string
          format: uri
        title:
          type: string
        status:
          type: integer
        detail:
          type: string
        instance:
          type: string
          format: uri
externalDocs:
  description: Internal API standards and lifecycle policy.
  url: https://docs.example.gov/api-standards
```

Skeleton ini memperlihatkan perbedaan antara:

1. API identity,
2. deployment environment,
3. operations,
4. reusable vocabulary,
5. authentication model,
6. error model,
7. schema model,
8. documentation navigation.

---

## 5. Root OpenAPI Object

Root object adalah pusat dokumen. Pada level paling atas, field umum yang sering dilihat adalah:

```yaml
openapi: 3.2.0
info: {}
servers: []
paths: {}
webhooks: {}
components: {}
security: []
tags: []
externalDocs: {}
```

Tidak semua wajib. Tetapi beberapa field punya peran yang sangat fundamental.

### 5.1 `openapi`

Contoh:

```yaml
openapi: 3.2.0
```

Ini menyatakan versi OpenAPI Specification yang dipakai oleh dokumen.

Jangan campur dengan:

```yaml
info:
  version: 1.0.0
```

Perbedaannya:

```text
openapi      -> versi bahasa/specification yang dipakai untuk membaca dokumen
info.version -> versi API/document yang Anda rilis ke consumer
```

Analogi Java:

```text
openapi: 3.2.0        seperti versi bahasa/grammar
info.version: 1.4.0   seperti versi artifact/library Anda
```

Kesalahan umum:

```yaml
openapi: 1.0.0 # salah secara konsep, kecuali memang versi spec valid, dan ini bukan
```

```yaml
info:
  version: 3.2.0 # mungkin valid, tapi kemungkinan besar salah maksud
```

### 5.2 `$self`

Di OAS 3.2, root object mengenal `$self` sebagai URI dokumen itu sendiri. Ini penting untuk reference resolution, terutama pada multi-document description.

Contoh:

```yaml
openapi: 3.2.0
$self: https://api.example.gov/descriptions/enforcement/openapi.yaml
info:
  title: Enforcement API
  version: 1.0.0
paths: {}
```

Mental model:

```text
$self memberi identitas URI pada dokumen,
sehingga reference tidak hanya bergantung pada lokasi file saat dibaca.
```

Ini berguna untuk:

1. multi-file specs,
2. registry/catalog,
3. reproducible bundling,
4. references yang tetap stabil saat file dipindahkan,
5. environment yang retrieval URI-nya berbeda.

Namun, karena tooling 3.2 masih tidak selalu merata, gunakan `$self` dengan memahami toolchain yang dipakai.

### 5.3 `info`

`info` adalah metadata API/document.

Contoh:

```yaml
info:
  title: Enforcement Case API
  summary: API for enforcement case lifecycle management.
  description: |
    Provides capabilities for intake, investigation, evidence handling,
    decision recording, escalation, appeal, and closure.
  version: 1.4.0
  contact:
    name: Enforcement Platform Team
    email: enforcement-platform@example.gov
  license:
    name: Internal Use Only
```

`info` menjawab:

```text
API ini apa?
Siapa pemiliknya?
Versi kontraknya berapa?
Apa konteks domainnya?
Ke mana consumer bertanya?
```

Anti-pattern:

```yaml
info:
  title: API
  version: 1.0.0
```

Ini valid tetapi miskin makna. Untuk organisasi besar, `info` yang buruk menyebabkan:

1. sulit mencari ownership,
2. sulit membedakan API mirip,
3. sulit melakukan audit,
4. sulit menghubungkan API dengan service atau product,
5. sulit mengelola lifecycle.

### 5.4 `servers`

`servers` menjelaskan base URL API.

Contoh:

```yaml
servers:
  - url: https://api.example.gov/enforcement/v1
    description: Production
  - url: https://sandbox-api.example.gov/enforcement/v1
    description: Sandbox
```

Server object bukan sekadar kosmetik Swagger UI. Ia mempengaruhi generated clients, mock servers, documentation, dan testing.

Kesalahan umum:

```yaml
servers:
  - url: http://localhost:8080
```

Untuk generated docs lokal, ini mungkin berguna. Untuk published API contract, ini buruk jika menjadi satu-satunya server karena consumer eksternal tidak membutuhkan localhost Anda.

Strategi umum:

```text
Internal dev spec:
  boleh punya localhost/dev server.

Published contract:
  harus punya server yang relevan untuk consumer.

Multi-environment API:
  production + sandbox sering masuk akal.

Kubernetes/service mesh internal API:
  jangan bocorkan internal service DNS ke external contract.
```

### 5.5 `paths`

`paths` adalah daftar endpoint/capability yang bisa dipanggil consumer.

Contoh:

```yaml
paths:
  /cases:
    get:
      operationId: listCases
      responses:
        '200':
          description: OK
```

`paths` adalah salah satu bagian paling penting karena di sinilah API surface terlihat.

Mental model:

```text
paths bukan daftar controller method.
paths adalah daftar kemampuan publik API.
```

Jadi pertanyaan review bukan hanya:

```text
Apakah endpoint ini ada di Spring Controller?
```

Tetapi:

```text
Apakah capability ini memang perlu diekspos?
Apakah naming-nya stabil?
Apakah operation-nya punya kontrak input/output jelas?
Apakah consumer bisa memahami failure mode-nya?
Apakah endpoint ini membocorkan internal implementation?
```

### 5.6 `webhooks`

`webhooks` mendeskripsikan request yang dapat diinisiasi provider API ke consumer API.

Contoh sederhana:

```yaml
webhooks:
  caseStatusChanged:
    post:
      summary: Case status changed notification
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CaseStatusChangedEvent'
      responses:
        '204':
          description: Notification accepted.
```

Gunakan `webhooks` saat API provider mengirim outbound calls ke consumer berdasarkan registrasi atau konfigurasi out-of-band.

Jangan pakai `webhooks` untuk menggantikan event streaming seperti Kafka. OpenAPI tetap berpusat pada HTTP API description. Untuk message/event systems, AsyncAPI sering lebih cocok. Namun bagian webhook di OpenAPI berguna untuk HTTP callback style integration.

### 5.7 `components`

`components` adalah tempat reusable objects.

Contoh:

```yaml
components:
  schemas:
    CaseSummary:
      type: object
      properties:
        id:
          type: string
  responses:
    UnauthorizedError:
      description: Unauthorized
  parameters:
    PageSize:
      name: pageSize
      in: query
      schema:
        type: integer
```

Mental model:

```text
components adalah vocabulary bersama, bukan tempat membuang semua hal supaya file kelihatan rapi.
```

Objek dalam `components` tidak mempengaruhi API kecuali direferensikan. Jadi schema yang ada di `components.schemas` tetapi tidak dipakai oleh path/operation/response/request body tidak menjadi bagian efektif dari API surface.

### 5.8 `security`

`security` pada root mendeklarasikan security requirement default untuk API.

Contoh:

```yaml
security:
  - OAuth2ClientCredentials:
      - cases:read
```

Biasanya ini bergantung pada security scheme di `components.securitySchemes`:

```yaml
components:
  securitySchemes:
    OAuth2ClientCredentials:
      type: oauth2
      flows:
        clientCredentials:
          tokenUrl: https://auth.example.gov/oauth2/token
          scopes:
            cases:read: Read cases.
```

Security di root bisa dioverride di operation level.

Contoh public endpoint:

```yaml
paths:
  /health:
    get:
      security: []
      responses:
        '200':
          description: Healthy
```

### 5.9 `tags`

`tags` membantu navigasi dan grouping.

Contoh:

```yaml
tags:
  - name: Cases
    description: Case lifecycle operations.
  - name: Evidence
    description: Evidence upload, review, and retrieval operations.
```

Operation bisa memakai tag:

```yaml
paths:
  /cases:
    get:
      tags:
        - Cases
```

Tag bukan bounded context otomatis. Tag adalah metadata navigasi. Namun kalau dipakai dengan disiplin, tag bisa mencerminkan capability groups.

Anti-pattern:

```yaml
tags:
  - name: case-controller
  - name: evidence-controller
```

Ini membocorkan struktur Spring Controller. Consumer tidak peduli nama controller Anda.

### 5.10 `externalDocs`

`externalDocs` menunjuk dokumentasi tambahan.

Contoh:

```yaml
externalDocs:
  description: Enforcement API lifecycle policy.
  url: https://docs.example.gov/enforcement/api-lifecycle
```

Gunakan untuk hal yang tidak cocok dimasukkan penuh ke OpenAPI:

1. domain narrative,
2. onboarding guide,
3. regulatory policy,
4. migration guide,
5. state machine visual,
6. security onboarding,
7. operational runbook.

Jangan gunakan `externalDocs` untuk menutupi kontrak yang tidak lengkap. Kalau field response wajib, ia harus ada di schema, bukan hanya dijelaskan di wiki.

---

## 6. YAML vs JSON

OpenAPI bisa ditulis dalam YAML atau JSON. Keduanya punya trade-off.

### 6.1 YAML

Kelebihan:

1. lebih mudah dibaca manusia,
2. komentar bisa dipakai,
3. lebih nyaman untuk review manual,
4. lebih ringkas,
5. umum dipakai di design-first workflow.

Kekurangan:

1. whitespace sensitif,
2. implicit typing bisa mengejutkan,
3. merge/anchor bisa membingungkan tooling,
4. string quoting sering disepelekan,
5. parser YAML bisa berbeda perilaku.

Contoh bug klasik:

```yaml
responses:
  200:
    description: OK
```

Secara YAML, `200` bisa diparse sebagai number oleh parser tertentu, padahal OpenAPI response code key sebaiknya string:

```yaml
responses:
  '200':
    description: OK
```

### 6.2 JSON

Kelebihan:

1. strict,
2. mudah diproses tool,
3. tidak ada ambiguity indentation,
4. natural untuk machine-generated artifact,
5. cocok untuk bundled output.

Kekurangan:

1. kurang nyaman dibaca manusia,
2. tidak ada komentar,
3. noisy untuk review,
4. trailing comma tidak boleh,
5. lebih panjang.

### 6.3 Praktik yang Direkomendasikan

Untuk banyak tim:

```text
Source of truth manusia:
  YAML

Bundled artifact untuk tool/publishing:
  JSON atau YAML hasil build

CI validation:
  terhadap source dan bundled output
```

Contoh pipeline:

```text
src/openapi/openapi.yaml
        │
        ├── validate
        ├── lint
        ├── bundle
        ├── diff
        └── publish

dist/openapi.json
```

---

## 7. `$ref` Mental Model

`$ref` adalah mekanisme untuk mereferensikan object lain.

Contoh local reference:

```yaml
schema:
  $ref: '#/components/schemas/CaseSummary'
```

Artinya:

```text
Gunakan schema yang berada pada path JSON Pointer:
#/components/schemas/CaseSummary
```

### 7.1 JSON Pointer Dasar

Reference lokal memakai JSON Pointer.

```text
#/components/schemas/CaseSummary
```

Dibaca sebagai:

```text
root document
└── components
    └── schemas
        └── CaseSummary
```

### 7.2 External Reference

Contoh:

```yaml
schema:
  $ref: './schemas/case-summary.yaml'
```

Atau:

```yaml
schema:
  $ref: './schemas/case.yaml#/CaseSummary'
```

Atau:

```yaml
schema:
  $ref: 'https://api.example.gov/schemas/common.yaml#/Problem'
```

External reference berguna untuk multi-file specs, tetapi menambah kompleksitas:

1. path resolution,
2. base URI,
3. remote availability,
4. security risks,
5. circular references,
6. bundling behavior,
7. tooling compatibility.

### 7.3 `$ref` Bukan Copy-Paste Tekstual

Kesalahan mental model yang sering terjadi:

```text
$ref = include/copy-paste isi object lain
```

Lebih tepat:

```text
$ref = pointer ke object lain yang harus diselesaikan oleh parser/tool
```

Efeknya:

1. resolution bisa dipengaruhi base URI,
2. cycles mungkin terjadi,
3. sibling fields punya aturan spesifik tergantung versi/spec,
4. tooling bisa berbeda dalam bundling/dereferencing.

### 7.4 Bundling vs Dereferencing

Ini penting.

#### Bundling

Bundling mengubah multi-file spec menjadi satu file, tetapi masih mempertahankan `$ref` internal.

```text
Before:
openapi.yaml
schemas/case.yaml
responses/errors.yaml

After bundle:
dist/openapi.yaml
with internal refs like #/components/schemas/Case
```

#### Dereferencing

Dereferencing mengganti `$ref` dengan object targetnya.

```yaml
schema:
  $ref: '#/components/schemas/CaseSummary'
```

Menjadi kira-kira:

```yaml
schema:
  type: object
  properties:
    id:
      type: string
```

Dereferencing bisa membuat file besar dan bermasalah bila ada circular references.

### 7.5 Practical Rule

Untuk kerja nyata:

```text
Gunakan source multi-file bila spec besar.
Publish bundled artifact.
Hindari dereferenced artifact kecuali tool tertentu membutuhkannya.
Validasi reference graph di CI.
```

---

## 8. Single-File vs Multi-File OpenAPI

### 8.1 Single-File

Contoh:

```text
openapi.yaml
```

Cocok untuk:

1. API kecil,
2. tutorial,
3. proof of concept,
4. public artifact sederhana,
5. early design iteration.

Kelebihan:

1. mudah dibuka,
2. mudah dikirim,
3. sedikit reference complexity,
4. tooling biasanya lebih aman.

Kekurangan:

1. cepat panjang,
2. sulit review per domain,
3. merge conflict besar,
4. ownership sulit dibagi,
5. components menjadi junk drawer.

### 8.2 Multi-File

Contoh:

```text
openapi.yaml
paths/
  cases.yaml
  evidence.yaml
  decisions.yaml
components/
  schemas/
    case.yaml
    evidence.yaml
    decision.yaml
  parameters/
    pagination.yaml
  responses/
    errors.yaml
```

Cocok untuk:

1. API besar,
2. banyak team contributor,
3. domain kompleks,
4. regulated API,
5. long-lived API,
6. API portfolio yang butuh reuse.

Kelebihan:

1. lebih modular,
2. review lebih fokus,
3. ownership lebih mudah,
4. struktur domain lebih terlihat,
5. reusable components lebih mudah dikelola.

Kekurangan:

1. reference graph lebih kompleks,
2. tooling harus disepakati,
3. relative path bisa rusak,
4. bundling wajib dipikirkan,
5. circular references lebih sulit dideteksi manual.

### 8.3 Rekomendasi untuk Java Team

Untuk service kecil:

```text
src/main/resources/openapi.yaml
```

Untuk service menengah:

```text
src/main/openapi/
  openapi.yaml
  paths/
  components/
```

Untuk API product besar:

```text
api-contracts/
  enforcement-case-api/
    openapi.yaml
    paths/
    components/
    examples/
    overlays/
    dist/
```

Untuk platform/API portfolio:

```text
api-catalog/
  standards/
  shared-components/
  services/
    enforcement-case-api/
    licensing-api/
    inspections-api/
```

---

## 9. Recommended Repository Layouts

### 9.1 Small Code-First Spring Boot Service

```text
case-service/
  src/main/java/...
  src/test/java/...
  src/main/resources/
  build.gradle
  generated/openapi.json
```

Cocok jika OpenAPI hanya artifact yang dihasilkan dari code. Tetapi untuk API serius, generated output harus tetap direview.

### 9.2 Contract-First Java Service

```text
case-service/
  api/
    openapi.yaml
    paths/
      cases.yaml
      evidence.yaml
    components/
      schemas/
      responses/
      parameters/
    examples/
  src/main/java/...
  build.gradle
```

Pipeline:

```text
api/openapi.yaml
  -> validate
  -> lint
  -> generate server interfaces
  -> compile Java implementation
  -> run contract tests
```

### 9.3 API Contract Separate Repository

```text
api-contracts/
  enforcement-case-api/
    openapi.yaml
    paths/
    components/
    examples/
    CHANGELOG.md
    VERSIONING.md
  common/
    problem.yaml
    pagination.yaml
    security.yaml
```

Cocok untuk:

1. public API,
2. partner API,
3. multi-team API,
4. regulated API,
5. API yang lifecycle-nya tidak selalu sama dengan service implementation.

Trade-off:

```text
Pro:
  contract menjadi first-class artifact.

Con:
  butuh mekanisme sinkronisasi dengan implementation repository.
```

---

## 10. Reading an OpenAPI Document Like a Senior Engineer

Saat membaca OpenAPI, jangan mulai dari detail schema. Mulai dari struktur besar.

### 10.1 Pass 1 — Identity

Cek:

```text
openapi
info.title
info.version
info.description
info.contact
servers
```

Pertanyaan:

1. API ini jelas milik siapa?
2. Versi spec dan versi API tidak tertukar?
3. Ada production/sandbox server yang masuk akal?
4. Judul dan deskripsi menjelaskan domain atau hanya generik?

### 10.2 Pass 2 — Surface Area

Cek:

```text
paths
operationId
summary
method
path template
```

Pertanyaan:

1. Apa capability utama API?
2. Operation names stabil dan consumer-oriented?
3. Endpoint terlihat seperti domain API atau controller dump?
4. Ada endpoint terlalu overloaded?
5. Ada path yang ambigu?

### 10.3 Pass 3 — Contract Completeness

Cek:

```text
parameters
requestBody
responses
content
schemas
examples
```

Pertanyaan:

1. Semua request input terdokumentasi?
2. Response selain 200 ada?
3. Error model konsisten?
4. Schema punya required fields yang jelas?
5. Nullable/optional tidak ambigu?
6. Examples valid dan representatif?

### 10.4 Pass 4 — Reuse and Coupling

Cek:

```text
components.schemas
components.parameters
components.responses
$ref graph
```

Pertanyaan:

1. Reuse membantu atau malah menciptakan coupling?
2. Ada schema generik seperti `ApiResponse`, `BaseResponse`, `CommonDto`?
3. Ada components tidak dipakai?
4. Ada schema yang terlalu mirip entity database?

### 10.5 Pass 5 — Security and Governance

Cek:

```text
security
components.securitySchemes
tags
externalDocs
x-* extensions
```

Pertanyaan:

1. Security scheme jelas?
2. Public/protected endpoint jelas?
3. Scope/permission bermakna?
4. Tags membantu navigasi?
5. Ada metadata ownership/lifecycle?
6. Ada external docs untuk domain policy?

---

## 11. Anatomy by Responsibility

Cara lain membaca OpenAPI adalah berdasarkan tanggung jawab.

### 11.1 Human Understanding Layer

```yaml
info:
tags:
externalDocs:
summary:
description:
examples:
```

Layer ini membantu manusia memahami API.

Kegagalan di layer ini menyebabkan:

1. onboarding lambat,
2. consumer salah interpretasi,
3. partner integration banyak bertanya,
4. API review berat,
5. dokumentasi formal tetapi tidak berguna.

### 11.2 Machine Processing Layer

```yaml
openapi:
paths:
operationId:
parameters:
requestBody:
responses:
components:
security:
```

Layer ini dipakai tool untuk:

1. generate docs,
2. generate clients,
3. generate server interfaces,
4. validate requests/responses,
5. mock server,
6. detect breaking changes,
7. publish catalog.

Kegagalan di layer ini menyebabkan:

1. generated client rusak,
2. contract test tidak berguna,
3. breaking change tidak terdeteksi,
4. mock berbeda dari production,
5. docs terlihat benar tetapi tidak executable.

### 11.3 Governance Layer

```yaml
info.version:
contact:
license:
tags:
externalDocs:
x-owner:
x-lifecycle:
x-data-classification:
x-api-domain:
x-deprecation-policy:
```

Layer ini sering tidak standar penuh, tetapi penting di organisasi besar.

Contoh extension:

```yaml
x-owner:
  team: Enforcement Platform
  slack: '#team-enforcement-platform'
  email: enforcement-platform@example.gov
x-lifecycle: active
x-data-classification: restricted
```

Specification extensions memakai prefix `x-`.

Gunakan extension untuk metadata organisasi, tetapi jangan menaruh kontrak inti hanya di extension. Tool umum mungkin mengabaikan extension.

---

## 12. Common Structural Smells

### 12.1 `info.title: API`

Bau:

```yaml
info:
  title: API
  version: 1.0.0
```

Masalah:

1. tidak menjelaskan domain,
2. buruk untuk catalog,
3. sulit dibedakan dengan API lain,
4. menunjukkan spec dibuat sebagai formalitas.

Lebih baik:

```yaml
info:
  title: Enforcement Case API
  summary: Case lifecycle API for enforcement operations.
```

### 12.2 `operationId` Hilang atau Tidak Stabil

Bau:

```yaml
paths:
  /cases:
    get:
      summary: get cases
```

Masalah:

1. generated clients membuat nama sendiri,
2. diff sulit,
3. traceability buruk,
4. automation tidak stabil.

Lebih baik:

```yaml
operationId: listCases
```

### 12.3 Semua Response Hanya `200`

Bau:

```yaml
responses:
  '200':
    description: OK
```

Masalah:

1. consumer tidak tahu error behavior,
2. SDK error handling buruk,
3. test tidak mencakup failure,
4. API terlihat lebih sederhana dari realita.

Lebih baik:

```yaml
responses:
  '200':
    $ref: '#/components/responses/ListCasesResponse'
  '400':
    $ref: '#/components/responses/ValidationError'
  '401':
    $ref: '#/components/responses/UnauthorizedError'
  '403':
    $ref: '#/components/responses/ForbiddenError'
  '500':
    $ref: '#/components/responses/InternalServerError'
```

### 12.4 Components Menjadi Tempat Sampah

Bau:

```yaml
components:
  schemas:
    Response:
    ApiResponse:
    BaseResponse:
    CommonResponse:
    ObjectDto:
    Data:
```

Masalah:

1. reuse tanpa makna,
2. coupling antar endpoint,
3. generated client tidak ergonomis,
4. perubahan satu schema merusak banyak operation.

Lebih baik:

```yaml
components:
  schemas:
    CaseSummary:
    CaseDetail:
    CreateCaseRequest:
    CreateCaseResponse:
    Problem:
    ValidationProblem:
```

### 12.5 Schema Mengikuti Entity

Bau:

```yaml
CaseEntity:
  properties:
    internalId:
    dbVersion:
    deleted:
    createdByUserId:
    updatedByUserId:
```

Masalah:

1. persistence leak,
2. security risk,
3. contract tidak stabil,
4. consumer bergantung pada field internal.

Lebih baik:

```yaml
CaseSummary:
  properties:
    id:
    referenceNumber:
    status:
    createdAt:
```

### 12.6 Path Mengikuti Method Name Internal

Bau:

```yaml
paths:
  /caseController/getAllCases:
```

Lebih baik:

```yaml
paths:
  /cases:
```

### 12.7 Inconsistent Pluralization

Bau:

```yaml
paths:
  /case:
  /cases/{id}:
  /evidenceItems:
  /evidences/{id}:
```

Masalah:

1. API terasa tidak matang,
2. generated clients tidak konsisten,
3. consumer ragu terhadap pattern.

Pilih standar dan konsisten.

---

## 13. OpenAPI as a Map of Commitments

Bagian penting: setiap field di OpenAPI seharusnya dianggap sebagai commitment.

```yaml
required:
  - id
  - status
```

Artinya:

```text
Server berkomitmen selalu mengirim id dan status untuk schema ini.
```

```yaml
maximum: 100
```

Artinya:

```text
Nilai di atas 100 tidak diterima atau tidak valid menurut contract.
```

```yaml
responses:
  '404':
    description: Case not found.
```

Artinya:

```text
Consumer boleh mengharapkan 404 sebagai salah satu failure mode.
```

```yaml
operationId: closeCase
```

Artinya:

```text
Ada capability stabil bernama closeCase yang bisa dipakai tooling sebagai key.
```

Jangan menulis OpenAPI seperti menulis catatan. Tulis seperti membuat komitmen lintas tim.

---

## 14. Java Engineer Perspective

### 14.1 Mapping Root Sections to Java/Spring Concepts

```text
OpenAPI                Java/Spring-ish analogy
------------------------------------------------------------
openapi                grammar/spec version
info                   artifact metadata / API product metadata
servers                deployment base URL, not controller mapping
paths                  externally visible request mappings
operation              capability, not just method
parameters             @PathVariable, @RequestParam, @RequestHeader, cookies
requestBody            @RequestBody / multipart/form-urlencoded input
responses              ResponseEntity / exception handling outcomes
components.schemas     API DTO schemas, not necessarily Java classes
securitySchemes        Spring Security/OAuth/API key documentation
security               default auth requirements
tags                   documentation grouping, not package names
externalDocs           docs/runbook/policy references
x-*                    organization-specific metadata
```

### 14.2 Annotation-Generated Spec Risk

Spring code:

```java
@GetMapping("/cases")
public List<CaseEntity> listCases() {
    return caseRepository.findAll();
}
```

Generated spec may expose:

```yaml
schema:
  type: array
  items:
    $ref: '#/components/schemas/CaseEntity'
```

This is dangerous because:

1. entity becomes contract,
2. lazy fields may leak,
3. internal field names become public,
4. database refactoring becomes API breaking change,
5. response shape is accidental.

Better Java boundary:

```java
@GetMapping("/cases")
public CaseListResponse listCases(...) {
    return caseQueryService.listCases(...);
}
```

With explicit API DTO:

```java
public record CaseSummaryResponse(
    String id,
    String referenceNumber,
    CaseStatus status,
    Instant createdAt
) {}
```

And explicit OpenAPI schema that describes external contract.

### 14.3 OpenAPI Should Not Be a Mirror of Code

Bad direction:

```text
Java implementation -> accidental OpenAPI -> consumer contract
```

Better direction:

```text
Consumer needs + domain capability -> OpenAPI contract -> Java implementation alignment
```

Hybrid practical direction:

```text
Initial Java discovery -> reviewed OpenAPI -> contract tests -> implementation correction
```

---

## 15. Path-Level Anatomy

A path item can contain operations:

```yaml
paths:
  /cases/{caseId}:
    parameters:
      - name: caseId
        in: path
        required: true
        schema:
          type: string
    get:
      operationId: getCase
      responses:
        '200':
          description: Case returned.
    patch:
      operationId: updateCase
      responses:
        '200':
          description: Case updated.
```

Path-level parameters apply to operations under that path unless overridden/combined according to rules.

Mental model:

```text
Path Item = shared context for one templated URL.
Operation = method-specific capability under that URL.
```

Use path-level parameters when truly shared. Do not overuse if it makes operation behavior harder to read.

---

## 16. Operation-Level Anatomy

Typical operation:

```yaml
post:
  tags:
    - Cases
  operationId: createCase
  summary: Create a new enforcement case
  description: |
    Creates a new enforcement case from an accepted intake record.
    The case starts in `intake` status.
  security:
    - OAuth2ClientCredentials:
        - cases:write
  parameters:
    - $ref: '#/components/parameters/IdempotencyKey'
  requestBody:
    required: true
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/CreateCaseRequest'
        examples:
          basic:
            value:
              intakeReference: INT-2026-0001
              subjectId: SUB-123
  responses:
    '201':
      $ref: '#/components/responses/CreateCaseResponse'
    '400':
      $ref: '#/components/responses/ValidationError'
    '409':
      $ref: '#/components/responses/ConflictError'
```

Operation anatomy answers:

```text
Who can call it?
What is it called by tools?
What does it do?
What inputs are accepted?
What body shape is required?
What success outcomes exist?
What failure outcomes exist?
What examples clarify behavior?
```

---

## 17. Components Anatomy

Common components sections:

```yaml
components:
  schemas: {}
  responses: {}
  parameters: {}
  examples: {}
  requestBodies: {}
  headers: {}
  securitySchemes: {}
  links: {}
  callbacks: {}
  pathItems: {}
```

### 17.1 `schemas`

Data shapes.

```yaml
components:
  schemas:
    CaseSummary:
      type: object
      required:
        - id
        - status
      properties:
        id:
          type: string
        status:
          type: string
```

### 17.2 `responses`

Reusable HTTP response definitions.

```yaml
components:
  responses:
    NotFoundError:
      description: Resource was not found.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
```

### 17.3 `parameters`

Reusable query/path/header/cookie parameters.

```yaml
components:
  parameters:
    CorrelationId:
      name: X-Correlation-ID
      in: header
      required: false
      schema:
        type: string
```

### 17.4 `requestBodies`

Reusable request body definitions.

```yaml
components:
  requestBodies:
    CreateCaseRequestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/CreateCaseRequest'
```

Use carefully. Request body reuse can cause coupling if create/update operations evolve differently.

### 17.5 `headers`

Reusable response header definitions.

```yaml
components:
  headers:
    RetryAfter:
      description: Seconds to wait before retrying.
      schema:
        type: integer
```

### 17.6 `securitySchemes`

Reusable security definitions.

```yaml
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

---

## 18. Naming Strategy

Naming in OpenAPI is architecture.

### 18.1 Operation IDs

Good:

```text
listCases
getCase
createCase
updateCase
closeCase
uploadEvidence
recordDecision
```

Bad:

```text
getAll
getData
caseControllerGet
postCaseUsingPOST
operation1
```

Rule:

```text
operationId should be stable, consumer-oriented, unique, and action-specific.
```

### 18.2 Schema Names

Good:

```text
CaseSummary
CaseDetail
CreateCaseRequest
CreateCaseResponse
UpdateCaseRequest
Problem
ValidationProblem
EvidenceUploadRequest
EvidenceMetadata
```

Bad:

```text
CaseDto
CaseEntity
CaseModel
Response
Data
Object
BaseDto
```

Rule:

```text
Schema name should communicate role in the API contract, not Java implementation type.
```

### 18.3 Parameter Names

Good:

```text
caseId
pageSize
cursor
sort
status
createdAfter
```

Bad:

```text
id2
filterString
queryParam1
p
sizeVal
```

Rule:

```text
Parameter name should be stable and self-explanatory from consumer perspective.
```

---

## 19. OpenAPI Document as a Review Artifact

A strong OpenAPI review does not ask only:

```text
Is the file valid?
```

It asks:

```text
Is the contract understandable?
Is the contract minimal but sufficient?
Is the contract stable?
Is the contract testable?
Is the contract secure?
Is the contract evolvable?
Is the contract aligned with domain language?
Is the contract free from implementation leakage?
```

Review checklist for part 003:

```text
[ ] `openapi` version is correct.
[ ] `info.title` is domain-specific.
[ ] `info.version` represents API/document release version.
[ ] `servers` are relevant for intended consumers.
[ ] `paths` represent capabilities, not internal controllers.
[ ] Every operation has stable `operationId`.
[ ] Every operation has meaningful summary.
[ ] Important operations have useful descriptions.
[ ] Success and failure responses are documented.
[ ] Reusable components are named by contract role.
[ ] Schemas do not leak persistence entities.
[ ] Security scheme exists when API is protected.
[ ] Tags help navigation.
[ ] External docs point to real supporting material.
[ ] `$ref` graph is valid.
[ ] File layout is understandable.
[ ] Generated/bundled artifact is reproducible.
```

---

## 20. Step-by-Step: Build a Small OpenAPI Document

### Step 1 — Start with identity

```yaml
openapi: 3.2.0
info:
  title: Enforcement Case API
  summary: API for managing enforcement case lifecycle.
  version: 0.1.0
```

### Step 2 — Add server

```yaml
servers:
  - url: https://sandbox-api.example.gov/enforcement/v1
    description: Sandbox
```

### Step 3 — Add one path

```yaml
paths:
  /cases:
    get:
      operationId: listCases
      summary: List cases visible to the caller
      responses:
        '200':
          description: Cases returned successfully.
```

### Step 4 — Add response content

```yaml
responses:
  '200':
    description: Cases returned successfully.
    content:
      application/json:
        schema:
          type: object
          required:
            - items
          properties:
            items:
              type: array
              items:
                type: object
                required:
                  - id
                  - status
                properties:
                  id:
                    type: string
                  status:
                    type: string
```

### Step 5 — Extract schema to components

```yaml
components:
  schemas:
    CaseListPage:
      type: object
      required:
        - items
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/CaseSummary'
    CaseSummary:
      type: object
      required:
        - id
        - status
      properties:
        id:
          type: string
        status:
          type: string
```

Then update response:

```yaml
schema:
  $ref: '#/components/schemas/CaseListPage'
```

### Step 6 — Add error responses

```yaml
components:
  responses:
    UnauthorizedError:
      description: Authentication is missing or invalid.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
  schemas:
    Problem:
      type: object
      required:
        - type
        - title
        - status
      properties:
        type:
          type: string
          format: uri
        title:
          type: string
        status:
          type: integer
```

### Step 7 — Add security

```yaml
security:
  - BearerAuth: []
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

### Step 8 — Add tags

```yaml
tags:
  - name: Cases
    description: Case lifecycle operations.
```

And operation:

```yaml
get:
  tags:
    - Cases
```

At this point, the document is not just valid. It is starting to become navigable, enforceable, and evolvable.

---

## 21. Complete Example for This Part

```yaml
openapi: 3.2.0
info:
  title: Enforcement Case API
  summary: API for managing enforcement case lifecycle.
  description: |
    This API exposes case lifecycle capabilities for authorized systems.
    It intentionally models external API contracts, not persistence entities.
  version: 0.1.0
servers:
  - url: https://sandbox-api.example.gov/enforcement/v1
    description: Sandbox
security:
  - BearerAuth: []
tags:
  - name: Cases
    description: Case lifecycle operations.
paths:
  /cases:
    get:
      tags:
        - Cases
      operationId: listCases
      summary: List cases visible to the caller
      parameters:
        - $ref: '#/components/parameters/PageSize'
        - $ref: '#/components/parameters/PageCursor'
      responses:
        '200':
          description: Cases returned successfully.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CaseListPage'
        '401':
          $ref: '#/components/responses/UnauthorizedError'
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
  parameters:
    PageSize:
      name: pageSize
      in: query
      required: false
      schema:
        type: integer
        minimum: 1
        maximum: 100
        default: 25
    PageCursor:
      name: cursor
      in: query
      required: false
      schema:
        type: string
  responses:
    UnauthorizedError:
      description: Authentication is missing or invalid.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
  schemas:
    CaseListPage:
      type: object
      required:
        - items
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/CaseSummary'
        nextCursor:
          type:
            - string
            - 'null'
    CaseSummary:
      type: object
      required:
        - id
        - referenceNumber
        - status
        - createdAt
      properties:
        id:
          type: string
        referenceNumber:
          type: string
        status:
          type: string
          enum:
            - intake
            - under_review
            - investigation
            - decision_pending
            - closed
        createdAt:
          type: string
          format: date-time
    Problem:
      type: object
      required:
        - type
        - title
        - status
      properties:
        type:
          type: string
          format: uri
        title:
          type: string
        status:
          type: integer
        detail:
          type: string
        instance:
          type: string
          format: uri
externalDocs:
  description: Enforcement API design and lifecycle policy.
  url: https://docs.example.gov/enforcement/api-policy
```

---

## 22. Common Misconceptions

### Misconception 1 — “Kalau Swagger UI tampil, berarti OpenAPI sudah benar”

Salah. Swagger UI bisa menampilkan spec yang valid secara syntax tetapi buruk secara kontrak.

Yang perlu dicek:

1. semantic correctness,
2. response completeness,
3. schema stability,
4. error model,
5. security clarity,
6. examples validity,
7. breaking change safety.

### Misconception 2 — “Components selalu membuat spec lebih baik”

Tidak selalu. Components membuat reuse lebih mudah, tetapi reuse bisa menciptakan coupling.

Jika `CreateCaseRequest`, `UpdateCaseRequest`, dan `CaseDetail` memakai schema sama karena field-nya kebetulan mirip hari ini, perubahan besok bisa menjadi sulit.

### Misconception 3 — “Multi-file pasti lebih enterprise”

Tidak. Multi-file tanpa struktur naming dan bundling pipeline hanya membuat chaos tersebar di banyak file.

### Misconception 4 — “OpenAPI adalah dokumentasi endpoint”

Terlalu sempit. OpenAPI adalah contract artifact yang bisa dipakai untuk docs, generation, validation, testing, mocking, governance, dan audit.

### Misconception 5 — “Generated OpenAPI dari Spring adalah source of truth”

Bisa, tetapi berisiko. Kalau tidak direview, yang menjadi source of truth adalah accidental implementation.

---

## 23. Failure Modelling: What Goes Wrong in Real Teams

### Failure 1 — Generated Entity Leak

Flow:

```text
JPA Entity -> Controller Response -> Generated OpenAPI -> Generated Client
```

Consequence:

```text
Database refactor becomes client breaking change.
```

Prevention:

```text
Use API-specific DTO/schema.
Review generated spec.
Validate response contract.
```

### Failure 2 — Path Explosion

Flow:

```text
Every use case gets ad-hoc endpoint.
No naming standard.
No capability map.
```

Consequence:

```text
API becomes impossible to learn and evolve.
```

Prevention:

```text
Group by resource/capability.
Review paths as API surface.
Use tags intentionally.
```

### Failure 3 — Error Contract Missing

Flow:

```text
Only 200 response documented.
Exception handler returns various shapes.
Clients parse strings.
```

Consequence:

```text
Consumer error handling becomes fragile.
```

Prevention:

```text
Define Problem schema.
Reuse error responses.
Test error responses.
```

### Failure 4 — `$ref` Graph Chaos

Flow:

```text
Multi-file spec grows.
References point everywhere.
No bundling validation.
```

Consequence:

```text
Docs build fails, generated clients inconsistent, CI becomes flaky.
```

Prevention:

```text
Define layout convention.
Bundle in CI.
Avoid remote refs unless necessary.
Validate reference graph.
```

### Failure 5 — Component Over-Reuse

Flow:

```text
One CommonCase schema reused for create, update, detail, search result.
```

Consequence:

```text
One endpoint's change breaks other endpoints.
```

Prevention:

```text
Name schemas by role.
Reuse only stable vocabulary.
Prefer duplication over wrong coupling.
```

---

## 24. Practical Heuristics

### 24.1 When to Inline

Inline when:

1. schema is tiny,
2. used once,
3. unlikely to be reused,
4. improves readability,
5. not part of shared vocabulary.

Example:

```yaml
schema:
  type: object
  properties:
    healthy:
      type: boolean
```

### 24.2 When to Extract to Components

Extract when:

1. reused in multiple operations,
2. important domain concept,
3. needs independent naming,
4. used by examples/tests,
5. needs governance or lifecycle management.

Example:

```yaml
$ref: '#/components/schemas/Problem'
```

### 24.3 When to Split Files

Split files when:

1. one file becomes hard to review,
2. multiple teams contribute,
3. components are domain-heavy,
4. paths exceed simple navigation,
5. repeated merge conflicts happen.

### 24.4 When Not to Split Files

Do not split just because:

1. it feels enterprise,
2. file is only 200 lines,
3. team has no bundling tool,
4. CI cannot validate refs,
5. contributors are not comfortable with `$ref`.

---

## 25. Exercises

### Exercise 1 — Identify Root Sections

Given this snippet:

```yaml
openapi: 3.2.0
info:
  title: API
  version: 1.0.0
paths:
  /users:
    get:
      responses:
        '200':
          description: OK
```

Answer:

1. Which sections exist?
2. Which important sections are missing?
3. What smells do you see?
4. What would you improve first?

Expected analysis:

```text
Exists:
- openapi
- info
- paths

Missing or weak:
- servers
- operationId
- tags
- real response schema
- error responses
- security if protected
- meaningful title

Smells:
- title too generic
- operation unnamed
- response undocumented beyond OK
```

### Exercise 2 — Refactor Inline Schema

Take an inline response schema and extract it to `components.schemas` with a meaningful name.

Before:

```yaml
schema:
  type: object
  properties:
    id:
      type: string
    status:
      type: string
```

After:

```yaml
schema:
  $ref: '#/components/schemas/CaseSummary'
```

With:

```yaml
components:
  schemas:
    CaseSummary:
      type: object
      required:
        - id
        - status
      properties:
        id:
          type: string
        status:
          type: string
```

### Exercise 3 — Spot Implementation Leakage

Which names leak implementation?

```text
CaseEntity
CaseDto
CaseControllerGetResponse
TblCase
JpaCase
UserModel
```

Better alternatives:

```text
CaseSummary
CaseDetail
CreateCaseRequest
CreateCaseResponse
CaseAssignee
CaseLifecycleState
```

### Exercise 4 — Design a File Layout

For an API with cases, evidence, decisions, and appeals, propose a multi-file layout.

Possible answer:

```text
openapi.yaml
paths/
  cases.yaml
  case-evidence.yaml
  case-decisions.yaml
  case-appeals.yaml
components/
  schemas/
    case.yaml
    evidence.yaml
    decision.yaml
    appeal.yaml
    problem.yaml
  parameters/
    pagination.yaml
    correlation.yaml
  responses/
    errors.yaml
examples/
  cases/
  errors/
```

---

## 26. Key Takeaways

1. OpenAPI document is a contract artifact, not just documentation.
2. Root object organizes identity, surface area, reusable vocabulary, security, and navigation.
3. `openapi` version and `info.version` are different concepts.
4. `paths` represent API capabilities, not controller methods.
5. `components` are reusable vocabulary, not a dumping ground.
6. `$ref` requires a clear mental model of reference resolution.
7. Single-file and multi-file both have valid use cases.
8. YAML is human-friendly but has parsing pitfalls.
9. JSON is machine-friendly but less ergonomic for authoring.
10. A good OpenAPI structure makes review, testing, generation, governance, and evolution easier.
11. For Java teams, the biggest risk is accidentally turning implementation shape into public contract.
12. Treat every schema, response, operation ID, and parameter as a long-lived commitment.

---

## 27. What Comes Next

Next part:

```text
Part 004 — Paths and Operations: Modelling API Capabilities Correctly
```

We will go deeper into:

1. path template semantics,
2. path naming,
3. operation object,
4. `operationId`,
5. operation-level overrides,
6. capability-oriented API modelling,
7. avoiding route/controller leakage,
8. designing operations that remain stable under implementation change.

---

## 28. Series Progress

```text
Current part: 003 / 030
Status: In progress
Series complete: No
Remaining parts: 27
Next: Part 004 — Paths and Operations: Modelling API Capabilities Correctly
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-002.md">⬅️ OpenAPI Mastery for Java Engineers — Part 002</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-004.md">OpenAPI Mastery for Java Engineers — Part 004 ➡️</a>
</div>

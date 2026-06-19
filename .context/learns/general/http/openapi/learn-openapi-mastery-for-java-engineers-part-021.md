# OpenAPI Mastery for Java Engineers — Part 021
# CI/CD Pipeline for OpenAPI: Validate, Lint, Bundle, Diff, Publish, Generate

> File: `learn-openapi-mastery-for-java-engineers-part-021.md`  
> Series: `learn-openapi-mastery-for-java-engineers`  
> Part: `021 / 030`  
> Audience: Java software engineer / tech lead  
> Focus: menjadikan OpenAPI sebagai artifact release yang tervalidasi, bisa direview, bisa diuji, bisa dipublikasi, dan bisa dipakai untuk automation tanpa drift.

---

## 0. Kenapa Part Ini Penting

Di banyak organisasi, OpenAPI hanya muncul sebagai efek samping runtime:

- aplikasi Spring Boot jalan,
- endpoint `/v3/api-docs` tersedia,
- Swagger UI bisa dibuka,
- semua merasa “API sudah terdokumentasi”.

Itu belum cukup.

Untuk sistem produksi yang serius, OpenAPI harus diperlakukan sebagai **artifact engineering**, mirip seperti:

- source code,
- database migration,
- Docker image,
- Helm chart,
- Terraform module,
- Java library,
- event schema,
- security policy.

Artinya OpenAPI perlu punya lifecycle:

1. ditulis atau digenerate,
2. divalidasi secara struktural,
3. dilint terhadap style guide,
4. dibundle menjadi artifact konsisten,
5. dibandingkan dengan versi sebelumnya,
6. diperiksa breaking change-nya,
7. diuji dengan example/schema,
8. dipublish ke registry/catalog/docs,
9. dipakai untuk generate SDK/server stub/mock,
10. diberi versi,
11. dilacak ownership dan history-nya.

Kalau lifecycle ini tidak ada, OpenAPI biasanya berubah menjadi file dokumentasi pasif yang cepat basi.

Part ini membangun mental model dan blueprint pipeline yang bisa dipakai di Java/Spring organization, baik untuk API internal, partner API, public API, maupun API regulated/high-risk.

---

## 1. Mental Model: OpenAPI Spec adalah Release Artifact

Cara berpikir yang salah:

```text
OpenAPI = dokumentasi API
```

Cara berpikir yang lebih kuat:

```text
OpenAPI = machine-readable contract artifact
```

Artinya:

- spec punya versi,
- spec punya owner,
- spec bisa gagal build,
- spec bisa direview,
- spec bisa dibandingkan,
- spec bisa dipublish,
- spec bisa digunakan downstream,
- spec bisa menjadi dasar testing,
- spec bisa menjadi bukti perubahan sistem.

Dalam Java ecosystem, kita terbiasa dengan artifact seperti:

```text
com.company.case:case-service-api:1.14.0
com.company.case:case-client-java:1.14.0
com.company.case:case-service-openapi:1.14.0
```

OpenAPI harus naik kelas menjadi artifact setara, bukan file temp yang muncul dari runtime.

---

## 2. Pipeline OpenAPI dalam Satu Gambar Mental

Pipeline minimal yang sehat:

```text
Developer changes API contract
        |
        v
Validate OpenAPI syntax/structure
        |
        v
Lint style and governance rules
        |
        v
Bundle multi-file spec into canonical artifact
        |
        v
Validate examples and schemas
        |
        v
Diff against baseline/main/latest released version
        |
        v
Detect breaking changes
        |
        v
Generate docs / SDK / mocks / server interfaces
        |
        v
Run contract tests
        |
        v
Publish versioned OpenAPI artifact
        |
        v
Notify consumers / update API catalog
```

Pipeline matang tidak harus menjalankan semua tahap dari hari pertama. Tetapi urutannya penting karena setiap tahap menjawab jenis risiko berbeda.

---

## 3. Risiko yang Dikendalikan oleh Pipeline

OpenAPI pipeline bukan sekadar “quality check”. Ia mengendalikan risiko.

| Risiko | Contoh | Stage yang Mengendalikan |
|---|---|---|
| Invalid spec | YAML valid tapi OpenAPI invalid | validate |
| Style inconsistency | error response tiap service beda | lint |
| `$ref` rusak | schema dipindah tapi reference tidak update | validate/bundle |
| Drift | implementation beda dari spec | contract test |
| Breaking change tak sengaja | field required baru ditambahkan | diff/breaking check |
| Docs basi | docs publish manual setelah release | publish from CI |
| SDK rusak | generated client tidak compile | generate + compile |
| Consumer tidak tahu perubahan | tidak ada changelog/notification | publish + notify |
| Governance tidak enforceable | style guide hanya dokumen PDF | lint gate |
| Audit gap | tidak tahu kapan contract berubah | versioned artifact + PR history |

Top 1% engineer tidak melihat pipeline sebagai ritual CI. Mereka melihat pipeline sebagai **risk control system**.

---

## 4. Source of Truth: Pertanyaan Pertama Pipeline

Sebelum membuat pipeline, tentukan satu hal:

```text
Apa source of truth OpenAPI kita?
```

Ada beberapa model.

### 4.1 Design-First Source of Truth

Spec ditulis manual atau semi-manual di repo.

```text
src/main/openapi/openapi.yaml
```

Lalu dari spec ini dihasilkan:

- server interface,
- DTO boundary,
- client SDK,
- documentation,
- mock server,
- contract tests.

Kelebihan:

- reviewable sebelum implementasi,
- cocok untuk public/partner API,
- cocok untuk regulated system,
- contract stabil.

Kekurangan:

- butuh disiplin menjaga implementasi sesuai spec,
- butuh mapping layer,
- butuh developer paham OpenAPI.

### 4.2 Code-First Source of Truth

Spec digenerate dari Java/Spring code.

```text
Controller + DTO + annotations -> /v3/api-docs -> openapi.yaml
```

Kelebihan:

- cepat untuk existing service,
- minim duplikasi awal,
- cocok untuk internal API sederhana,
- mudah bootstrap.

Kekurangan:

- spec sering menjadi dump implementasi,
- sulit review API design sebelum code,
- banyak semantics tidak otomatis tertangkap,
- breaking change bisa baru kelihatan setelah implementasi.

### 4.3 Hybrid Source of Truth

Spec baseline direview sebagai contract, tetapi sebagian detail bisa digenerate/di-sync dari code.

Contoh:

```text
- contract canonical ada di repo
- implementation expose generated runtime spec untuk drift check
- CI membandingkan canonical spec vs runtime spec
```

Ini sering paling realistis untuk organisasi besar.

### 4.4 Rule of Thumb

| API Type | Recommended Source of Truth |
|---|---|
| Public API | Design-first / contract-first |
| Partner API | Contract-first |
| Regulated API | Contract-first with approval history |
| Internal critical API | Hybrid |
| Internal low-risk CRUD API | Code-first acceptable |
| Legacy undocumented API | Generate first, curate later |

---

## 5. Repository Layout yang Sehat

### 5.1 Single Service Repository

Contoh layout untuk service Java/Spring:

```text
case-service/
  pom.xml
  src/
    main/
      java/
      resources/
      openapi/
        openapi.yaml
        paths/
          cases.yaml
          evidence.yaml
          decisions.yaml
        components/
          schemas/
            Case.yaml
            Evidence.yaml
            Problem.yaml
          parameters/
            Pagination.yaml
          responses/
            Errors.yaml
    test/
      java/
  .spectral.yaml
  openapi-generator-config.yaml
  scripts/
    bundle-openapi.sh
    diff-openapi.sh
```

Keuntungan:

- spec dekat dengan service,
- PR API dan implementation bisa satu tempat,
- ownership jelas,
- build bisa enforce consistency.

Kelemahan:

- sulit membuat API portfolio view lintas service,
- shared style guide perlu mekanisme distribusi.

### 5.2 Dedicated API Contract Repository

```text
api-contracts/
  case-service/
    v1/
      openapi.yaml
  payment-service/
    v1/
      openapi.yaml
  identity-service/
    v1/
      openapi.yaml
  shared/
    problem.yaml
    pagination.yaml
    security.yaml
  rulesets/
    company-openapi-rules.yaml
```

Kelebihan:

- mudah governance lintas API,
- cocok untuk platform/API management team,
- mudah publish catalog.

Kekurangan:

- risiko drift dengan implementation,
- PR perlu koordinasi lintas repo,
- developer bisa merasa jauh dari contract.

### 5.3 Monorepo Platform Layout

```text
platform/
  services/
    case-service/
      src/main/openapi/openapi.yaml
    evidence-service/
      src/main/openapi/openapi.yaml
  api/
    catalog.yaml
    rulesets/company-openapi-rules.yaml
    shared-components/
```

Cocok jika organisasi sudah punya monorepo dan platform tooling matang.

---

## 6. Canonical vs Source Spec

Dalam pipeline, bedakan:

```text
source spec      = file yang diedit manusia
canonical spec   = hasil normalisasi/bundling untuk publish/diff/generate
runtime spec     = spec yang diekspos oleh aplikasi saat berjalan
```

Contoh:

```text
src/main/openapi/openapi.yaml
        |
        v
build/openapi/case-service.openapi.bundle.yaml
        |
        v
published artifact / API catalog / SDK generation
```

Kenapa perlu canonical spec?

Karena source spec bisa multi-file, punya relative refs, komentar, atau format yang nyaman bagi manusia. Tapi downstream tools lebih stabil jika menerima satu file bundle.

Canonical spec harus:

- deterministic,
- generated consistently,
- tidak diedit manual,
- menjadi basis diff,
- menjadi basis publish,
- menjadi basis generation.

---

## 7. Stage 1 — Validate

Validation menjawab:

```text
Apakah file ini valid sebagai OpenAPI description?
```

Validation tidak menjawab:

- apakah API design bagus,
- apakah naming konsisten,
- apakah breaking change,
- apakah contoh realistis,
- apakah authorization benar.

Validation adalah baseline.

### 7.1 Yang Dicek

- root object valid,
- versi OpenAPI valid,
- required fields ada,
- path item valid,
- parameter object valid,
- schema object valid,
- `$ref` bisa di-resolve,
- response object valid,
- security scheme valid,
- media type object valid.

### 7.2 Contoh Command

Dengan OpenAPI Generator CLI:

```bash
openapi-generator-cli validate \
  -i src/main/openapi/openapi.yaml
```

Dengan Redocly CLI:

```bash
redocly lint src/main/openapi/openapi.yaml
```

Dengan Swagger CLI atau parser lain, konsepnya sama:

```bash
swagger-cli validate src/main/openapi/openapi.yaml
```

### 7.3 Validation Failure Example

```yaml
paths:
  /cases/{caseId}:
    get:
      parameters:
        - name: caseId
          in: path
          required: false # invalid untuk path parameter
          schema:
            type: string
```

Path parameter harus required karena path tidak bisa match tanpa nilai tersebut.

### 7.4 Best Practice

Validation harus berjalan:

- di local pre-commit/pre-push optional,
- di PR mandatory,
- sebelum bundle,
- sebelum generate,
- sebelum publish.

---

## 8. Stage 2 — Lint

Lint menjawab:

```text
Apakah OpenAPI ini mengikuti standar organisasi?
```

Contoh yang tidak selalu invalid menurut spec, tetapi buruk menurut organisasi:

```yaml
operationId: getData
```

Spec mungkin valid, tapi naming ini jelek karena tidak jelas data apa.

### 8.1 Lint vs Validate

| Aspect | Validate | Lint |
|---|---|---|
| Spec correctness | yes | sometimes |
| Style consistency | no | yes |
| Governance | no | yes |
| Naming | no | yes |
| Error model | no | yes |
| Pagination convention | no | yes |
| Security requirement | partial | yes |
| Organization-specific rules | no | yes |

### 8.2 Spectral-Style Ruleset

Contoh `.spectral.yaml` sederhana:

```yaml
extends:
  - spectral:oas

rules:
  operation-operationId-required:
    description: Every operation must have an operationId.
    severity: error
    given: $.paths[*][get,put,post,delete,patch,options,head,trace]
    then:
      field: operationId
      function: truthy

  operation-summary-required:
    description: Every operation must have a short summary.
    severity: warn
    given: $.paths[*][get,put,post,delete,patch]
    then:
      field: summary
      function: truthy

  no-default-only-error-response:
    description: Operations should document concrete 4xx/5xx responses, not only default.
    severity: warn
    given: $.paths[*][get,put,post,delete,patch].responses
    then:
      function: schema
      functionOptions:
        schema:
          not:
            required: [default]
            maxProperties: 1
```

### 8.3 Rules yang Biasanya Penting

Minimal rules untuk organisasi serius:

1. `operationId` wajib dan unik.
2. `summary` wajib.
3. `description` wajib untuk public/partner API.
4. Setiap operation punya response non-2xx yang jelas.
5. Error response harus pakai standard Problem schema.
6. Auth requirement eksplisit.
7. Path naming konsisten.
8. Query pagination memakai convention yang sama.
9. `tags` wajib untuk grouping.
10. Schema tidak boleh punya property tanpa type.
11. Tidak boleh `type: string` untuk timestamp tanpa `format`/description jelas.
12. Tidak boleh anonymous inline schema kompleks untuk response penting.
13. Tidak boleh `default` response sebagai satu-satunya error documentation.
14. Tidak boleh request/response schema memakai nama entity persistence.
15. Deprecated operation harus punya migration guidance.

### 8.4 Rule Severity Strategy

Jangan semua rule langsung `error`.

Gunakan maturity model:

```text
Phase 1: warn only
Phase 2: error for critical rules
Phase 3: error for most style rules
Phase 4: exception process for rule bypass
```

Contoh:

| Rule | New Project | Legacy Project |
|---|---:|---:|
| valid OpenAPI | error | error |
| operationId required | error | warn -> error later |
| standard error response | error | warn |
| description required | warn | warn |
| no inline complex schema | warn | off/warn |
| no undocumented security | error | warn/error based on risk |

Governance yang terlalu keras di awal sering membuat tim mematikan tooling.

---

## 9. Stage 3 — Bundle

Bundling menjawab:

```text
Bisakah spec multi-file diubah menjadi artifact tunggal yang stabil?
```

Source spec manusia biasanya seperti ini:

```yaml
openapi: 3.2.0
info:
  title: Case API
  version: 1.8.0
paths:
  /cases:
    $ref: ./paths/cases.yaml
components:
  schemas:
    Case:
      $ref: ./components/schemas/Case.yaml
```

Downstream tools sering lebih aman jika menerima:

```text
build/openapi/case-api.bundle.yaml
```

### 9.1 Bundle vs Dereference

Bundling:

```text
multi-file spec -> single file with internal refs preserved where possible
```

Dereferencing:

```text
all refs expanded inline
```

Biasanya untuk publish/generate, bundle lebih baik daripada full dereference karena:

- nama components tetap ada,
- schema reuse tetap terlihat,
- file tidak meledak terlalu besar,
- generated code lebih stabil.

### 9.2 Bundle Output Harus Deterministic

Masalah umum:

- urutan fields berubah-ubah,
- generated timestamp masuk file,
- absolute path masuk artifact,
- line endings beda,
- formatting tidak konsisten.

Kalau output tidak deterministic, diff jadi noisy.

Best practice:

```text
source spec -> bundle -> normalize -> diff/publish/generate
```

### 9.3 Jangan Commit Bundle Jika Tidak Perlu

Ada dua pendekatan.

Approach A: commit source only.

```text
src/main/openapi/**/*.yaml committed
build/openapi/*.bundle.yaml generated in CI
```

Approach B: commit source + generated canonical artifact.

```text
src/main/openapi/**/*.yaml committed
dist/openapi/openapi.bundle.yaml committed
```

Approach B berguna jika:

- repo consumer hanya mengambil file bundle,
- catalog pull dari repo,
- review ingin melihat bundle diff.

Tapi hati-hati: generated artifacts yang dicommit bisa sering drift.

---

## 10. Stage 4 — Validate Examples

OpenAPI examples sering terlihat bagus tetapi invalid.

Contoh schema:

```yaml
CaseSummary:
  type: object
  required: [id, status, createdAt]
  properties:
    id:
      type: string
    status:
      type: string
      enum: [OPEN, CLOSED]
    createdAt:
      type: string
      format: date-time
```

Example invalid:

```yaml
example:
  id: 12345
  status: IN_PROGRESS
  createdAt: "yesterday"
```

Masalah:

- `id` number, harus string,
- `status` bukan enum valid,
- `createdAt` bukan date-time.

### 10.1 Kenapa Example Validation Penting

Examples dipakai untuk:

- documentation,
- SDK tests,
- mock server,
- onboarding,
- contract tests,
- AI/API tooling,
- partner integration.

Invalid example adalah bug dokumentasi yang bisa menghasilkan bug integrasi.

### 10.2 Level Example Quality

| Level | Description |
|---|---|
| Level 0 | No examples |
| Level 1 | Happy path only |
| Level 2 | Happy + common errors |
| Level 3 | Edge cases + validation failures |
| Level 4 | Scenario examples across operations |
| Level 5 | Examples used as test fixtures |

Aim minimal: Level 2 untuk internal API, Level 3/4 untuk partner/public API.

---

## 11. Stage 5 — Diff

Diff menjawab:

```text
Apa yang berubah dari contract versi sebelumnya?
```

Diff bukan hanya text diff.

Text diff melihat:

```diff
- maxLength: 100
+ maxLength: 50
```

Semantic OpenAPI diff mengerti bahwa constraint response/request berubah.

### 11.1 Baseline yang Dipakai untuk Diff

Pertanyaan penting:

```text
Diff terhadap apa?
```

Pilihan:

1. terhadap branch `main`,
2. terhadap latest released version,
3. terhadap latest deployed production version,
4. terhadap consumer-pinned version,
5. terhadap previous tag.

Untuk PR check, biasanya:

```text
current PR bundled spec vs main branch bundled spec
```

Untuk release check:

```text
release candidate spec vs latest released spec
```

Untuk production safety:

```text
runtime spec in staging/prod vs published contract artifact
```

### 11.2 Diff Categories

Diff harus dikategorikan:

| Category | Example |
|---|---|
| Added operation | `POST /cases/{id}/close` added |
| Removed operation | `DELETE /cases/{id}` removed |
| Changed parameter | query param becomes required |
| Changed request schema | required field added |
| Changed response schema | field removed |
| Changed enum | enum value removed/added |
| Changed security | auth scheme added |
| Changed operationId | SDK method name changes |
| Changed description | documentation only |

### 11.3 Diff Output untuk Review

PR comment yang bagus:

```text
OpenAPI contract changes detected:

Non-breaking:
- Added optional response property: CaseSummary.assignedOfficerName
- Added 409 response to POST /cases/{caseId}/submit

Potentially breaking:
- Changed operationId from getCase to retrieveCase
- Added required request property CreateCaseRequest.source
- Removed enum value CaseStatus.UNDER_REVIEW

Action required:
- Either revert breaking changes, create new API version, or attach approved breaking-change exception.
```

---

## 12. Stage 6 — Breaking Change Detection

Breaking change detection menjawab:

```text
Apakah perubahan ini bisa merusak consumer yang sudah ada?
```

Tool seperti `oasdiff` dapat membantu mendeteksi breaking changes pada OpenAPI descriptions. Namun top 1% engineer tahu bahwa tidak semua breaking change bisa dideteksi secara struktural.

### 12.1 Structural Breaking Changes

Contoh mudah terdeteksi:

- operation removed,
- path removed,
- method removed,
- required request field added,
- response field removed,
- schema type changed,
- enum value removed,
- parameter becomes required,
- status code removed,
- security requirement tightened.

### 12.2 Semantic Breaking Changes

Contoh sulit dideteksi:

- field tetap ada tapi artinya berubah,
- default sorting berubah,
- pagination cursor semantics berubah,
- response time berubah drastis,
- idempotency behavior berubah,
- status `APPROVED` kini berarti hal berbeda,
- endpoint yang dulunya sync kini async,
- error code sama tapi recovery instruction beda,
- authorization rules diperketat tanpa contract metadata.

Pipeline harus menggabungkan:

```text
automated diff + human review + compatibility checklist
```

### 12.3 Breaking Change Policy

Contoh policy:

```text
Breaking changes are blocked on protected branches unless:

1. API is marked experimental; or
2. endpoint is internal and all known consumers approve; or
3. new major version is introduced; or
4. formal exception is attached with migration plan and sunset date.
```

### 12.4 Exception File

Beberapa organisasi membuat file exception:

```yaml
exceptions:
  - id: BC-2026-041
    api: case-service
    change: remove CaseResponse.legacyReference
    reason: field was never populated in production
    approvedBy:
      - api-governance@company.com
      - mobile-platform@company.com
    expiresAt: 2026-09-30
    migration: Use externalReference instead.
```

Jangan biarkan exception menjadi bypass permanen tanpa expiry.

---

## 13. Stage 7 — Generate

Generation menjawab:

```text
Apa artifact turunan yang harus dibuat dari OpenAPI?
```

Artifact umum:

- Java client SDK,
- TypeScript client SDK,
- server interface/stub,
- API documentation,
- mock server,
- Postman collection,
- test fixtures,
- gateway config fragment,
- validation middleware config.

### 13.1 Generation Harus Setelah Validate/Lint/Diff

Urutan yang salah:

```text
generate -> validate -> lint
```

Urutan yang lebih sehat:

```text
validate -> lint -> bundle -> diff -> generate
```

Kenapa?

Karena generated artifact dari contract buruk hanya mempercepat penyebaran keburukan.

### 13.2 Generated Java Client

Contoh dengan OpenAPI Generator Maven Plugin:

```xml
<plugin>
  <groupId>org.openapitools</groupId>
  <artifactId>openapi-generator-maven-plugin</artifactId>
  <version>${openapi-generator.version}</version>
  <executions>
    <execution>
      <id>generate-case-client</id>
      <phase>generate-sources</phase>
      <goals>
        <goal>generate</goal>
      </goals>
      <configuration>
        <inputSpec>${project.basedir}/src/main/openapi/openapi.yaml</inputSpec>
        <generatorName>java</generatorName>
        <library>webclient</library>
        <apiPackage>com.company.caseapi.client.api</apiPackage>
        <modelPackage>com.company.caseapi.client.model</modelPackage>
        <invokerPackage>com.company.caseapi.client</invokerPackage>
        <generateApiTests>false</generateApiTests>
        <generateModelTests>false</generateModelTests>
      </configuration>
    </execution>
  </executions>
</plugin>
```

### 13.3 Generated Spring Interface

Untuk contract-first server:

```xml
<configuration>
  <inputSpec>${project.basedir}/src/main/openapi/openapi.yaml</inputSpec>
  <generatorName>spring</generatorName>
  <interfaceOnly>true</interfaceOnly>
  <useSpringBoot3>true</useSpringBoot3>
  <apiPackage>com.company.caseapi.boundary</apiPackage>
  <modelPackage>com.company.caseapi.boundary.model</modelPackage>
</configuration>
```

Pattern yang sehat:

```text
Generated API interface
        |
        v
Manual controller/delegate implementation
        |
        v
Application service
        |
        v
Domain model
```

Jangan biarkan generated model masuk ke domain core.

### 13.4 Generated TypeScript Client

Biasanya berguna untuk frontend/mobile-for-web teams.

Hal yang perlu distandardisasi:

- HTTP client library,
- auth injection,
- error handling,
- date parsing,
- enum fallback,
- nullable behavior,
- package versioning.

### 13.5 Generated Artifact Must Compile

CI harus memastikan:

```text
OpenAPI spec -> generate SDK -> compile SDK -> run SDK basic tests
```

Kalau generated client tidak compile, spec secara praktis rusak untuk consumer.

---

## 14. Stage 8 — Contract Tests

OpenAPI pipeline tidak lengkap tanpa test alignment.

Minimal:

1. provider response conforms to OpenAPI,
2. provider rejects invalid request according to OpenAPI,
3. examples validate against schema,
4. generated client can call mock/provider,
5. implementation does not expose undocumented fields unintentionally.

### 14.1 Provider Test Example Mental Model

```text
Given OpenAPI says GET /cases/{caseId} returns CaseResponse
When provider returns response
Then response body validates against CaseResponse schema
And status/header/content-type match contract
```

### 14.2 Negative Test Example

```text
Given OpenAPI says CreateCaseRequest.title is required
When request body omits title
Then provider returns 400/422 with standard Problem response
```

### 14.3 Drift Test

Untuk code-first/hybrid Spring:

```text
canonical spec from repo
vs
runtime spec from /v3/api-docs in test environment
```

Jika beda, fail atau flag review.

Caution:

Runtime generated spec bisa mengandung ordering/metadata noise. Normalisasi dulu sebelum compare.

---

## 15. Stage 9 — Publish

Publish menjawab:

```text
Di mana contract resmi tersedia setelah merge/release?
```

Target publish:

- API catalog,
- developer portal,
- artifact repository,
- GitHub/GitLab release artifact,
- Maven artifact,
- S3/static docs bucket,
- internal documentation site,
- Backstage catalog,
- API gateway developer portal.

### 15.1 Publish Bukan Upload Manual

Anti-pattern:

```text
Developer updates Swagger UI manually after deployment.
```

Better:

```text
Merge/release triggers publish automatically.
```

### 15.2 Artifact Naming

```text
case-service-openapi-1.8.0.yaml
case-service-openapi-1.8.0.json
case-service-openapi-latest.yaml
case-service-openapi-1.8.0.sha256
```

Untuk regulated system, hindari hanya `latest`.

Selalu simpan immutable version.

### 15.3 Publish Metadata

Artifact harus punya metadata:

```yaml
x-api-id: case-service
x-api-owner: case-platform-team
x-api-lifecycle: production
x-api-audience: internal-partner
x-api-version-policy: semver
x-api-contact-slack: '#team-case-platform'
x-api-repository: https://git.company.com/case-service
x-api-change-policy: breaking-changes-require-approval
```

OpenAPI extension `x-*` berguna untuk metadata organisasi.

---

## 16. Stage 10 — Notify Consumers

Untuk API yang punya consumer nyata, publish saja tidak cukup.

Consumer perlu tahu:

- apa berubah,
- apakah breaking,
- kapan berlaku,
- apa yang perlu mereka lakukan,
- siapa yang bisa dihubungi,
- apakah SDK baru tersedia,
- apakah ada deprecation/sunset.

### 16.1 Generated Changelog

Changelog dapat berasal dari diff:

```md
# Case API 1.9.0

## Added
- Added `GET /cases/{caseId}/timeline`.
- Added optional field `CaseSummary.priority`.

## Changed
- `POST /cases/{caseId}/submit` now documents `409 Conflict` for invalid state transitions.

## Deprecated
- `CaseResponse.legacyReference` is deprecated. Use `externalReference`.

## Breaking
- None.
```

### 16.2 Consumer Notification Policy

| Change Type | Notification |
|---|---|
| Documentation only | changelog only |
| Additive non-breaking | changelog + release note |
| Deprecated field | targeted consumer notice |
| Breaking change | approval + migration plan + timeline |
| Security change | direct notification + risk review |

---

## 17. Versioning Strategy in Pipeline

OpenAPI has at least three versions that people confuse.

```yaml
openapi: 3.2.0
info:
  version: 1.8.0
```

- `openapi` = specification version.
- `info.version` = API description/API contract version.
- implementation version = service binary/container version.

These are not the same.

### 17.1 Example

```text
OpenAPI spec version: 3.2.0
API contract version: 1.8.0
Service build version: case-service:2026.06.20.1729
Java client SDK version: 1.8.0
```

### 17.2 Version Alignment Choices

Option A: API contract and SDK share version.

```text
case-api.yaml 1.8.0
case-client-java 1.8.0
```

Good for consumer clarity.

Option B: service and API version share version.

```text
case-service 1.8.0
case-api 1.8.0
```

Can be misleading if implementation changes without contract changes.

Option C: independent versions.

```text
case-service 2026.06.20.1
case-api 1.8.0
case-client-java 1.8.3
```

More accurate, but needs maturity.

### 17.3 Recommended

For serious APIs:

```text
API contract version independent from service deploy version.
Generated SDK version follows API contract version with optional patch build metadata.
```

---

## 18. Maven Pipeline Blueprint

Example for Java/Spring service.

### 18.1 Maven Lifecycle Concept

```text
validate phase:
  - validate OpenAPI
  - lint OpenAPI

generate-sources phase:
  - generate API interfaces/models if contract-first

test phase:
  - compile generated code
  - run contract tests

verify phase:
  - bundle spec
  - diff against baseline
  - fail on breaking changes

deploy phase:
  - publish artifact/docs/SDK
```

### 18.2 Example Makefile Wrapper

Even in Maven projects, a Makefile can make commands ergonomic:

```makefile
OPENAPI_SRC=src/main/openapi/openapi.yaml
OPENAPI_BUNDLE=build/openapi/case-api.bundle.yaml

.PHONY: openapi-validate
openapi-validate:
	openapi-generator-cli validate -i $(OPENAPI_SRC)

.PHONY: openapi-lint
openapi-lint:
	spectral lint $(OPENAPI_SRC)

.PHONY: openapi-bundle
openapi-bundle:
	redocly bundle $(OPENAPI_SRC) --output $(OPENAPI_BUNDLE)

.PHONY: openapi-diff
openapi-diff:
	oasdiff breaking baseline/openapi.yaml $(OPENAPI_BUNDLE)

.PHONY: openapi-check
openapi-check: openapi-validate openapi-lint openapi-bundle openapi-diff
```

### 18.3 Maven Plugin Boundary

Maven is good for Java generation/compilation.

But for lint/diff/bundle, external CLI tools in CI are often clearer than forcing everything into Maven plugins.

A practical split:

```text
Maven:
- generate Java code
- compile generated code
- run tests

CI shell/tools:
- lint
- bundle
- diff
- publish docs
```

---

## 19. Gradle Pipeline Blueprint

Gradle works well for generated source tasks.

Conceptual task graph:

```text
openApiValidate
openApiLint
openApiBundle
openApiDiff
openApiGenerateClient
compileJava
contractTest
publishOpenApiArtifact
```

Example sketch:

```kotlin
tasks.register<Exec>("openApiLint") {
    commandLine("spectral", "lint", "src/main/openapi/openapi.yaml")
}

tasks.register<Exec>("openApiBundle") {
    commandLine(
        "redocly", "bundle",
        "src/main/openapi/openapi.yaml",
        "--output", "build/openapi/case-api.bundle.yaml"
    )
}

tasks.register<Exec>("openApiDiff") {
    dependsOn("openApiBundle")
    commandLine(
        "oasdiff", "breaking",
        "baseline/openapi.yaml",
        "build/openapi/case-api.bundle.yaml"
    )
}

tasks.register("openApiCheck") {
    dependsOn("openApiLint", "openApiBundle", "openApiDiff")
}
```

Keep generation deterministic and generated output isolated:

```text
build/generated/openapi
```

not:

```text
src/main/java
```

unless you intentionally commit generated sources.

---

## 20. GitHub Actions Blueprint

Example CI pipeline:

```yaml
name: openapi-ci

on:
  pull_request:
    paths:
      - 'src/main/openapi/**'
      - '.spectral.yaml'
      - 'pom.xml'
      - '.github/workflows/openapi-ci.yaml'

jobs:
  openapi-check:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout PR
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install OpenAPI tools
        run: |
          npm install -g @stoplight/spectral-cli @redocly/cli @openapitools/openapi-generator-cli

      - name: Validate OpenAPI
        run: |
          openapi-generator-cli validate -i src/main/openapi/openapi.yaml

      - name: Lint OpenAPI
        run: |
          spectral lint src/main/openapi/openapi.yaml

      - name: Bundle OpenAPI
        run: |
          mkdir -p build/openapi
          redocly bundle src/main/openapi/openapi.yaml \
            --output build/openapi/case-api.bundle.yaml

      - name: Fetch baseline from main
        run: |
          git show origin/main:build/openapi/case-api.bundle.yaml > baseline.yaml || true

      - name: Diff OpenAPI
        run: |
          if [ -s baseline.yaml ]; then
            oasdiff breaking baseline.yaml build/openapi/case-api.bundle.yaml
          else
            echo "No baseline found; skipping breaking diff."
          fi

      - name: Build Java project
        run: |
          ./mvnw verify
```

### 20.1 Important Caveat

The baseline step above assumes the bundled artifact exists in `main`. If bundle is not committed, CI should generate baseline by checking out `main` separately and running the same bundle command.

Better approach:

```text
checkout main -> bundle baseline
checkout PR -> bundle candidate
compare baseline vs candidate
```

---

## 21. GitLab CI Blueprint

```yaml
stages:
  - openapi
  - build
  - test
  - publish

openapi_check:
  stage: openapi
  image: node:22
  script:
    - npm install -g @stoplight/spectral-cli @redocly/cli @openapitools/openapi-generator-cli
    - openapi-generator-cli validate -i src/main/openapi/openapi.yaml
    - spectral lint src/main/openapi/openapi.yaml
    - mkdir -p build/openapi
    - redocly bundle src/main/openapi/openapi.yaml --output build/openapi/case-api.bundle.yaml
    - oasdiff breaking baseline/openapi.yaml build/openapi/case-api.bundle.yaml
  artifacts:
    paths:
      - build/openapi/case-api.bundle.yaml
    expire_in: 30 days

java_build:
  stage: build
  image: eclipse-temurin:21
  script:
    - ./mvnw verify
  needs:
    - openapi_check
```

---

## 22. Jenkins Pipeline Blueprint

```groovy
pipeline {
  agent any

  stages {
    stage('OpenAPI Validate') {
      steps {
        sh 'openapi-generator-cli validate -i src/main/openapi/openapi.yaml'
      }
    }

    stage('OpenAPI Lint') {
      steps {
        sh 'spectral lint src/main/openapi/openapi.yaml'
      }
    }

    stage('OpenAPI Bundle') {
      steps {
        sh 'mkdir -p build/openapi'
        sh 'redocly bundle src/main/openapi/openapi.yaml --output build/openapi/case-api.bundle.yaml'
        archiveArtifacts artifacts: 'build/openapi/case-api.bundle.yaml', fingerprint: true
      }
    }

    stage('OpenAPI Breaking Diff') {
      steps {
        sh 'oasdiff breaking baseline/openapi.yaml build/openapi/case-api.bundle.yaml'
      }
    }

    stage('Build') {
      steps {
        sh './mvnw verify'
      }
    }
  }
}
```

---

## 23. Runtime Spec vs Build-Time Spec

Dalam Spring Boot code-first/hybrid setup, sering ada runtime endpoint:

```text
GET /v3/api-docs
```

Pertanyaannya:

```text
Apakah runtime spec boleh menjadi published contract?
```

Jawaban: bisa, tapi hati-hati.

### 23.1 Risiko Runtime-Only Spec

- spec baru tersedia setelah aplikasi jalan,
- PR review contract sulit,
- output bisa dipengaruhi profile/config,
- security/visibility bisa berbeda per environment,
- annotation omission menghasilkan dokumentasi tidak lengkap,
- implementation detail bocor.

### 23.2 Cara Memakai Runtime Spec dengan Aman

Gunakan runtime spec untuk drift detection:

```text
canonical contract spec
        vs
runtime generated spec from running app
```

Pipeline staging:

```text
Deploy candidate to test env
Fetch /v3/api-docs
Normalize
Compare with canonical published candidate spec
Fail if material drift detected
```

Ini sangat berguna untuk hybrid workflows.

---

## 24. API Catalog Integration

OpenAPI publish idealnya masuk ke API catalog.

Catalog memberi:

- discoverability,
- ownership,
- lifecycle state,
- docs,
- dependency map,
- consumers,
- SLA/SLO metadata,
- security classification,
- deprecation state.

### 24.1 Catalog Descriptor Example

```yaml
apiVersion: backstage.io/v1alpha1
kind: API
metadata:
  name: case-service-api
  description: Case management API for enforcement lifecycle workflows.
  tags:
    - openapi
    - case-management
    - regulated
spec:
  type: openapi
  lifecycle: production
  owner: case-platform-team
  system: enforcement-platform
  definition:
    $text: https://artifacts.company.com/apis/case-service/1.8.0/openapi.yaml
```

### 24.2 Metadata yang Sebaiknya Ada

```yaml
x-api-owner: case-platform-team
x-api-tier: critical
x-api-data-classification: confidential
x-api-audience: internal-partner
x-api-lifecycle: production
x-api-slack-channel: '#case-platform'
x-api-repository: https://git.company.com/case-service
x-api-support-policy: business-hours
x-api-breaking-change-policy: approval-required
```

---

## 25. Environment-Specific Server URLs

OpenAPI punya `servers`, tapi hati-hati dengan environment.

Bad:

```yaml
servers:
  - url: https://dev-case-service.internal.local
```

Jika spec yang sama dipublish ke production catalog, ini misleading.

Better:

```yaml
servers:
  - url: https://api.company.com/case/v1
    description: Production
  - url: https://staging-api.company.com/case/v1
    description: Staging
```

Atau gunakan server variables:

```yaml
servers:
  - url: https://{environment}.api.company.com/case/v1
    variables:
      environment:
        default: staging
        enum:
          - staging
          - api
```

Namun untuk public/partner API, jangan membuat variable yang membingungkan. Kadang explicit server list lebih jelas.

---

## 26. Multi-API and Multi-Version Pipeline

Untuk organisasi besar, satu repo bisa punya banyak APIs:

```text
apis/
  case/v1/openapi.yaml
  case/v2/openapi.yaml
  evidence/v1/openapi.yaml
  disclosure/v1/openapi.yaml
```

Pipeline harus mendeteksi spec mana yang berubah.

Pseudo-flow:

```bash
changed_specs=$(git diff --name-only origin/main...HEAD | grep 'openapi.yaml')

for spec in $changed_specs; do
  validate $spec
  lint $spec
  bundle $spec
  diff_against_baseline $spec
  publish_candidate_artifact $spec
done
```

Untuk monorepo, hindari menjalankan semua API checks jika hanya satu spec berubah, kecuali shared components berubah.

Jika shared component berubah:

```text
rebuild and diff all APIs that reference shared component
```

Ini penting karena perubahan kecil di shared schema bisa berdampak luas.

---

## 27. Shared Components Pipeline Risk

Shared components menggoda:

```text
shared/problem.yaml
shared/pagination.yaml
shared/security.yaml
shared/money.yaml
```

Tapi perubahan shared component bisa menjadi breaking change untuk banyak API.

Contoh:

```diff
Problem:
  required:
    - type
    - title
+   - traceId
```

Menambahkan required field ke shared error schema bisa memengaruhi semua API.

Pipeline harus punya dependency graph:

```text
shared/problem.yaml changed
        |
        v
case API affected
evidence API affected
identity API affected
```

Minimal, gunakan grep/reference scan.

Better, gunakan bundler/dependency analysis.

---

## 28. Generated SDK Publishing

Jika pipeline generate SDK, pikirkan seperti library release.

### 28.1 Java SDK Publishing

Artifact:

```text
com.company.apis:case-api-client:1.8.0
```

Publish ke:

- Maven Central untuk public,
- internal Nexus/Artifactory untuk enterprise,
- GitHub Packages,
- GitLab Package Registry.

### 28.2 SDK Release Gate

Sebelum publish SDK:

1. generate from canonical spec,
2. compile,
3. run unit tests,
4. run smoke test against mock server,
5. check binary/source compatibility if needed,
6. publish with changelog.

### 28.3 Avoid Manual SDK Patch

Bad:

```text
Generate SDK once, then manually edit generated files.
```

Better:

```text
Customize generator templates or wrap generated SDK with hand-written facade.
```

Pattern:

```text
generated-client-core
        |
        v
handwritten-company-client-wrapper
```

---

## 29. Documentation Publishing

Docs can be generated from canonical spec.

Options:

- Swagger UI,
- Redoc,
- Scalar,
- Stoplight,
- internal portal,
- static site.

### 29.1 Documentation Release Rule

Documentation should be published from the same spec artifact that was validated and diffed.

Bad:

```text
CI validates src/openapi.yaml
Docs generated from runtime /v3/api-docs
SDK generated from another checked-in YAML
```

Good:

```text
canonical bundle -> docs
canonical bundle -> SDK
canonical bundle -> mock
canonical bundle -> publish
```

One input, many outputs.

### 29.2 Documentation Preview in PR

For important APIs, PR should provide docs preview.

Flow:

```text
PR opened
  -> bundle spec
  -> generate static docs
  -> publish temporary preview
  -> comment preview URL in PR
```

This improves human review quality.

---

## 30. Security Checks in OpenAPI Pipeline

OpenAPI can leak sensitive information.

Pipeline should scan for:

- real tokens in examples,
- real emails/phone numbers/national IDs,
- internal hostnames in public specs,
- internal error messages,
- stack traces in examples,
- undocumented unauthenticated operations,
- risky query parameters,
- sensitive fields missing classification.

### 30.1 Example Rule: No Bearer Token Example

```yaml
bad:
  value:
    Authorization: Bearer eyJhbGciOi...
```

Use fake placeholders:

```yaml
good:
  value:
    Authorization: Bearer <access-token>
```

### 30.2 Security Metadata Extensions

```yaml
components:
  schemas:
    SubjectProfile:
      type: object
      x-data-classification: confidential
      properties:
        nationalId:
          type: string
          x-sensitive: true
          x-redaction-required: true
```

Lint can enforce that sensitive fields have classification metadata.

---

## 31. OpenAPI Pipeline for Regulated Systems

For regulated/high-risk APIs, pipeline should produce audit evidence.

Evidence artifacts:

```text
- validated OpenAPI bundle
- lint report
- diff report
- breaking change report
- approval record
- generated changelog
- contract test report
- published artifact hash
- release tag
```

### 31.1 Release Evidence Bundle

```text
release-evidence/
  case-api-1.8.0.openapi.yaml
  case-api-1.8.0.openapi.sha256
  lint-report.json
  diff-report.md
  breaking-change-report.json
  contract-test-report.xml
  approval-record.yaml
  changelog.md
```

### 31.2 Why Hash Matters

If an API contract is used as audit evidence, you need to prove exactly which file was approved/published.

```bash
sha256sum case-api-1.8.0.openapi.yaml > case-api-1.8.0.openapi.sha256
```

This is simple but powerful.

---

## 32. Pull Request Review Checklist

Use this checklist for OpenAPI contract PRs.

### 32.1 Structural

- [ ] Spec validates.
- [ ] `$ref` resolves.
- [ ] Bundle output is deterministic.
- [ ] No accidental generated noise.

### 32.2 Design

- [ ] Operation names are clear.
- [ ] Paths represent stable capabilities.
- [ ] Request and response schemas are endpoint-appropriate.
- [ ] No persistence entity leakage.
- [ ] Error responses are explicit.
- [ ] Pagination/filtering conventions are consistent.

### 32.3 Compatibility

- [ ] Diff reviewed.
- [ ] Breaking changes blocked or approved.
- [ ] Deprecated fields have migration guidance.
- [ ] Enum changes are consumer-safe.
- [ ] Constraint changes are reviewed.

### 32.4 Security

- [ ] Security requirements explicit.
- [ ] No secrets in examples.
- [ ] Sensitive fields classified.
- [ ] Public spec does not expose internal URLs or implementation detail.

### 32.5 Consumer Experience

- [ ] Examples validate.
- [ ] Docs are understandable.
- [ ] Generated client compiles if applicable.
- [ ] Changelog is clear.
- [ ] Owner/contact metadata exists.

---

## 33. Pipeline Anti-Patterns

### 33.1 OpenAPI Published Only from Runtime

Problem:

```text
No reviewable contract before deploy.
```

Better:

```text
Build/publish canonical spec in CI.
```

### 33.2 Lint Rules Too Strict Too Early

Problem:

```text
Teams bypass governance because adoption pain is too high.
```

Better:

```text
Warn -> baseline -> ratchet -> error.
```

### 33.3 Generated SDK Without Compilation Gate

Problem:

```text
Spec passes validation but generated client fails compile.
```

Better:

```text
Generate and compile SDK in CI.
```

### 33.4 Diff Against Wrong Baseline

Problem:

```text
PR compares against main, but production is older.
```

Better:

```text
Release diff against latest production contract.
```

### 33.5 Docs Generated from Different Spec

Problem:

```text
SDK says one thing, docs say another.
```

Better:

```text
Single canonical bundle powers every downstream artifact.
```

### 33.6 Breaking Change Tool Treated as Oracle

Problem:

```text
Tool says no breaking changes, but semantic behavior changed.
```

Better:

```text
Automated diff + human checklist + tests + consumer review.
```

### 33.7 Shared Components Without Impact Analysis

Problem:

```text
One shared schema change breaks ten services.
```

Better:

```text
Reference graph and affected API diff.
```

---

## 34. Mature Pipeline Levels

### Level 0 — No Pipeline

```text
OpenAPI exists only in Swagger UI.
```

Risk: very high drift.

### Level 1 — Validate Only

```text
CI checks spec is valid.
```

Good start, but no governance.

### Level 2 — Validate + Lint

```text
CI enforces basic style and structure.
```

Good for consistency.

### Level 3 — Bundle + Diff

```text
CI produces canonical artifact and shows semantic changes.
```

Good for review.

### Level 4 — Breaking Gate + Generate

```text
CI blocks breaking changes and compiles generated artifacts.
```

Good for consumer safety.

### Level 5 — Publish + Catalog + Notify

```text
CI publishes versioned artifacts and notifies consumers.
```

Good for platform maturity.

### Level 6 — Regulated Evidence Pipeline

```text
CI produces audit evidence bundle with approvals and immutable hashes.
```

Good for high-risk systems.

---

## 35. Recommended Minimum Pipeline by API Risk

| API Risk | Minimum Pipeline |
|---|---|
| Prototype | validate |
| Internal low-risk | validate + lint |
| Internal shared service | validate + lint + bundle + diff |
| Critical internal API | validate + lint + bundle + diff + breaking gate + contract tests |
| Partner API | all above + docs preview + SDK generation + changelog |
| Public API | all above + developer portal publish + deprecation policy |
| Regulated API | all above + evidence bundle + approval records + artifact hash |

---

## 36. Concrete End-to-End Pipeline Example

Imagine `case-service` owns this file:

```text
src/main/openapi/openapi.yaml
```

PR changes:

- adds `GET /cases/{caseId}/timeline`,
- adds optional response field `CaseSummary.priority`,
- deprecates `CaseResponse.legacyReference`,
- adds `409 Conflict` response to submit operation.

Pipeline runs:

```text
1. validate -> pass
2. lint -> warning: deprecated field missing migration description
3. bundle -> pass
4. example validation -> pass
5. diff -> changes detected
6. breaking detection -> no breaking changes
7. generate Java client -> pass
8. compile generated client -> pass
9. contract tests -> pass
10. docs preview -> published to PR
11. changelog -> generated
```

Reviewer sees:

```text
Non-breaking additions.
One governance warning: deprecated field requires migration guidance.
```

Developer updates schema:

```yaml
legacyReference:
  type: string
  deprecated: true
  description: >
    Deprecated. Use externalReference instead. This field will remain available
    until at least 2026-12-31.
```

Pipeline passes.

Merge happens.

Release pipeline publishes:

```text
case-api-1.9.0.openapi.yaml
case-api-1.9.0 docs
case-api-client-java 1.9.0
case-api-client-typescript 1.9.0
changelog 1.9.0
```

That is contract lifecycle maturity.

---

## 37. Practical Tool Stack Recommendation

A pragmatic stack:

```text
Spec validation:
- openapi-generator-cli validate
- Redocly CLI
- Swagger parser-based tooling

Lint:
- Spectral
- Redocly rules

Bundle:
- Redocly CLI
- swagger-cli

Diff/breaking changes:
- oasdiff
- OpenAPI diff tools integrated into API platform

Generation:
- OpenAPI Generator
- language-specific client generators

Docs:
- Swagger UI
- Redoc
- Scalar
- Stoplight/API portal

Testing:
- Schemathesis
- contract-test libraries
- Spring integration tests with schema validation
```

Tool choice matters less than lifecycle discipline.

---

## 38. Strong Defaults for Java Teams

For a Java/Spring team, use these defaults unless you have strong reasons otherwise:

```text
1. Keep canonical OpenAPI in repo or generate it deterministically in CI.
2. Validate and lint in every PR.
3. Require operationId for every operation.
4. Bundle before diff/generation/publish.
5. Diff against main for PR, latest release for release.
6. Block structural breaking changes by default.
7. Generate clients from canonical bundle only.
8. Compile generated Java client in CI.
9. Do not let generated DTOs leak into domain layer.
10. Publish immutable versioned OpenAPI artifacts.
11. Generate changelog from diff but review it manually.
12. Use runtime /v3/api-docs for drift detection, not as the only source of truth.
```

---

## 39. Final Mental Model

A weak OpenAPI practice says:

```text
We have Swagger UI, so consumers can see the API.
```

A strong OpenAPI practice says:

```text
Every API contract change is validated, linted, bundled, diffed, compatibility-checked,
used to generate artifacts, tested against implementation, published immutably,
and communicated to consumers.
```

That is the difference between documentation and contract engineering.

---

## 40. Key Takeaways

1. OpenAPI should be treated as a release artifact, not runtime decoration.
2. Validate checks spec correctness; lint checks organizational quality.
3. Bundle creates a deterministic canonical artifact for downstream tools.
4. Diff and breaking-change detection protect consumers.
5. Generated SDK/server/docs must come from the same canonical spec.
6. Runtime generated spec is useful for drift detection, but risky as the only source of truth.
7. Publishing should produce immutable versioned artifacts, not just “latest docs”.
8. Regulated systems should preserve evidence: spec, hash, diff, lint report, approval, and test results.
9. Pipeline maturity should match API risk.
10. Automation does not replace human API design review; it makes review safer and more repeatable.

---

## 41. Suggested Exercises

### Exercise 1 — Build a Minimal Pipeline

Create a repository with:

```text
src/main/openapi/openapi.yaml
.spectral.yaml
Makefile
```

Add commands:

```bash
make openapi-validate
make openapi-lint
make openapi-bundle
```

### Exercise 2 — Add Breaking Change Detection

Create two versions:

```text
baseline/openapi.yaml
candidate/openapi.yaml
```

Make these changes:

1. remove a response property,
2. add a required request property,
3. add an optional response property,
4. change operationId.

Run semantic diff and classify each change.

### Exercise 3 — Generate and Compile Java Client

Use OpenAPI Generator to generate a Java client.

Then ensure CI fails if generated code does not compile.

### Exercise 4 — Publish Evidence Bundle

Create a fake release folder:

```text
release-evidence/
  openapi.yaml
  openapi.sha256
  lint-report.json
  diff-report.md
  changelog.md
```

Practice what would be useful during audit or incident review.

---

## 42. References

- OpenAPI Specification v3.2.0 — official specification.
- OpenAPI Initiative — official project and ecosystem overview.
- OpenAPI Generator — official generator documentation for client libraries, server stubs, documentation, and configuration.
- OpenAPI Generator Maven/Gradle plugins — build integration for Java ecosystems.
- Spectral — JSON/YAML linter commonly used for OpenAPI rulesets.
- oasdiff — OpenAPI semantic diff and breaking change detection.
- Redocly CLI — OpenAPI linting, bundling, and documentation workflows.
- RFC 9110 — HTTP semantics.
- RFC 9457 — Problem Details for HTTP APIs.

---

## 43. Series Progress

```text
Current part: 021 / 030
Status: In progress
Series complete: No
Remaining parts: 9
Next: Part 022 — SDK and Client Generation: Power, Limits, and Architecture Decisions
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-020.md">⬅️ OpenAPI Mastery for Java Engineers — Part 020</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-022.md">OpenAPI Mastery for Java Engineers — Part 022 ➡️</a>
</div>

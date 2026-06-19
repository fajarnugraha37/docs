# learn-http-for-web-frontend-perspective-part-031.md

# Part 031 — Frontend HTTP Client Architecture

> Seri: `learn-http-for-web-frontend-perspective`  
> Bagian: `031`  
> Topik: Frontend HTTP Client Architecture  
> Perspektif: Java software engineer yang ingin memahami HTTP dari sisi web/frontend secara mendalam, praktis, dan arsitektural.

---

## 0. Posisi Bagian Ini dalam Seri

Sampai Part 030, kita sudah membangun banyak potongan mental model:

- HTTP message model: request, response, header, body.
- Method semantics: safe, idempotent, retryable, mutation consequences.
- Status code: outcome contract, bukan sekadar angka.
- Headers sebagai control plane.
- Body/media type/encoding.
- Fetch API dan non-fetch request.
- CORS, credentials, cookies, CSRF, browser auth reality.
- HTTP caching, validation, revalidation, deployment cache strategy.
- Redirect, content negotiation, resource loading, HTTP/1.1/2/3.
- TLS/HTTPS/security headers/browser isolation.
- API design, mutation design, error contract.
- Streaming/realtime.
- Service worker/offline.
- Observability.
- Performance.
- Reliability: retry, timeout, cancellation, backoff, stale response, rate limit.

Bagian ini menyatukan semuanya ke satu pertanyaan engineering:

> Bagaimana mendesain HTTP client layer di frontend supaya aplikasi tidak menyebarkan `fetch()` mentah ke seluruh codebase, tidak mencampur domain logic dengan transport logic, dan tetap aman terhadap auth, retry, timeout, cancellation, observability, parsing, error normalization, dan evolusi API?

Ini bukan sekadar membuat helper seperti:

```ts
export function apiGet(url: string) {
  return fetch(url).then(r => r.json())
}
```

Itu terlalu kecil untuk aplikasi nyata.

Yang kita inginkan adalah arsitektur client-side boundary yang punya tanggung jawab jelas:

1. membangun request secara konsisten;
2. menjalankan transport dengan timeout/cancellation/retry yang masuk akal;
3. memproses response secara aman;
4. mengubah HTTP failures menjadi typed application failures;
5. menjaga auth/credential behavior;
6. mengintegrasikan cache/query/mutation layer;
7. membawa observability context;
8. mudah dites;
9. mudah diganti sebagian tanpa rewrite aplikasi.

---

## 1. Problem Dasar: Kenapa Tidak Boleh Menyebar `fetch()` ke Mana-Mana?

Dalam aplikasi kecil, ini terlihat wajar:

```ts
async function loadUser(id: string) {
  const res = await fetch(`/api/users/${id}`)
  return res.json()
}
```

Lalu aplikasi bertumbuh:

```ts
async function saveUser(id: string, input: unknown) {
  const res = await fetch(`/api/users/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('token')}`,
    },
    body: JSON.stringify(input),
  })

  if (!res.ok) {
    alert('Failed')
    throw new Error('Failed')
  }

  return res.json()
}
```

Kemudian muncul kebutuhan:

- request timeout;
- cancellation saat route berubah;
- retry untuk `502/503/504`;
- jangan retry mutation non-idempotent;
- auth refresh token;
- logout saat session expired;
- `credentials: 'include'` untuk cookie session;
- correlation ID;
- parse error body;
- `204 No Content` tidak boleh `res.json()`;
- upload progress;
- download blob;
- normalize validation error;
- expose `Retry-After`;
- handle `429`;
- detect offline;
- avoid stale response winning;
- avoid refresh-token stampede;
- support OpenAPI-generated client;
- integrate TanStack Query/SWR;
- mock HTTP untuk test;
- collect telemetry.

Jika semua ini diselesaikan di tiap komponen, codebase berubah menjadi kumpulan policy lokal yang tidak konsisten.

### 1.1 Gejala HTTP Client Layer yang Buruk

Gejala umum:

- Ada banyak `fetch()` langsung di component.
- Ada banyak `axios.create()` berbeda-beda.
- Beberapa request pakai `credentials: 'include'`, beberapa lupa.
- Beberapa error dilempar sebagai `Error`, beberapa sebagai string, beberapa sebagai response object.
- `401` kadang logout, kadang refresh, kadang ditampilkan sebagai toast.
- `204` kadang crash karena `Unexpected end of JSON input`.
- `AbortError` kadang dianggap error user-visible.
- Retry dilakukan untuk semua method, termasuk `POST` tanpa idempotency key.
- `Authorization` header ditambahkan manual di tiap request.
- Request timeout tidak ada.
- Error logging kehilangan trace ID.
- Tests memakai mock yang tidak sama dengan real client behavior.
- UI data cache bertarung dengan HTTP cache.
- Generated client tidak bisa dipakai karena tidak cocok dengan auth/error policy aplikasi.

### 1.2 Prinsip Inti

HTTP client architecture yang baik bukan tentang “library apa yang dipakai”, tapi tentang boundary.

> HTTP client layer adalah boundary antara world of HTTP/browser/network dan world of domain/application UI.

Boundary ini harus menerjemahkan:

```txt
HTTP/browser reality
  ↓
normalized transport result
  ↓
typed API result/error
  ↓
query/mutation/domain state
  ↓
UI state
```

Kesalahan paling umum adalah melewati beberapa lapisan sekaligus:

```txt
fetch response langsung dipakai oleh component
```

Akibatnya component harus tahu terlalu banyak:

- status code;
- header;
- retryability;
- auth refresh;
- body parsing;
- error envelope;
- trace ID;
- pagination conventions;
- cache invalidation;
- mutation conflict.

Component seharusnya tahu domain state, bukan semua detail transport.

---

## 2. Mental Model: Layering HTTP Client Frontend

Arsitektur yang sehat biasanya memiliki beberapa layer:

```txt
┌─────────────────────────────────────────────────────┐
│ UI Components                                        │
│ - render state                                       │
│ - trigger user intent                                │
└──────────────────────────┬──────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────┐
│ Feature Hooks / Use Cases                            │
│ - useUserProfile()                                   │
│ - useUpdateUserEmail()                               │
│ - useSearchCases()                                   │
└──────────────────────────┬──────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────┐
│ Data Fetching / Query-Mutation Layer                 │
│ - query cache                                        │
│ - dedupe                                             │
│ - stale/refetch policy                               │
│ - optimistic update                                  │
│ - invalidation                                       │
└──────────────────────────┬──────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────┐
│ API Client / Endpoint Layer                          │
│ - getUser(id)                                        │
│ - patchUser(id, input)                               │
│ - searchCases(params)                                │
│ - typed request/response                             │
└──────────────────────────┬──────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────┐
│ HTTP Core / Transport Layer                          │
│ - base URL                                           │
│ - headers                                            │
│ - credentials                                        │
│ - timeout                                            │
│ - abort                                              │
│ - retry                                              │
│ - response parsing                                   │
│ - error normalization                                │
│ - telemetry                                          │
└──────────────────────────┬──────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────┐
│ Browser Fetch / XHR / Streams / Service Worker       │
│ - actual network                                     │
│ - browser policies                                   │
│ - CORS/cookies/cache                                 │
└─────────────────────────────────────────────────────┘
```

Tidak semua aplikasi butuh layer eksplisit sebanyak ini. Tetapi secara konseptual, boundary-nya tetap ada.

### 2.1 Tanggung Jawab Tiap Layer

#### UI Components

Tanggung jawab:

- render data;
- menampilkan loading/error/empty state;
- mengirim user intent;
- tidak tahu detail HTTP kecuali sangat perlu.

Komponen tidak seharusnya tahu:

- apakah API memakai cookie atau bearer token;
- apakah timeout 8 detik atau 30 detik;
- bagaimana parsing error envelope;
- apakah `409` harus merge conflict UI atau toast generic;
- bagaimana refresh token dijalankan.

#### Feature Hooks / Use Cases

Tanggung jawab:

- menghubungkan domain action dengan data layer;
- menentukan query key;
- menentukan invalidation;
- mengubah domain input menjadi API input;
- memilih UI-level error behavior.

Contoh:

```ts
export function useUserProfile(userId: UserId) {
  return useQuery({
    queryKey: ['user-profile', userId],
    queryFn: () => userApi.getProfile(userId),
  })
}
```

#### Data Fetching Layer

Tanggung jawab:

- caching application data;
- request deduplication;
- stale/refetch policy;
- retry untuk query;
- mutation state;
- optimistic update;
- invalidation.

Layer ini berbeda dari HTTP cache browser.

HTTP cache menyimpan response berdasarkan HTTP cache semantics. Query cache menyimpan domain/application data berdasarkan query key.

#### API Client / Endpoint Layer

Tanggung jawab:

- representasi endpoint typed;
- serialisasi params/body;
- memilih method/status expected;
- mengenali response schema;
- tidak berisi UI behavior.

Contoh:

```ts
export const userApi = {
  getProfile(userId: UserId) {
    return http.get<UserProfile>(`/users/${encodeURIComponent(userId)}`)
  },

  updateEmail(userId: UserId, input: UpdateEmailInput) {
    return http.patch<UserProfile>(`/users/${encodeURIComponent(userId)}/email`, {
      body: input,
      idempotencyKey: true,
    })
  },
}
```

#### HTTP Core / Transport Layer

Tanggung jawab:

- `fetch()` wrapper;
- base URL;
- default headers;
- credentials;
- timeout;
- abort signal;
- retry policy;
- error normalization;
- response parsing;
- observability.

Ini layer yang paling reusable.

---

## 3. Anti-Pattern: “One Giant API Utility”

Banyak codebase punya file seperti:

```ts
// api.ts
export async function request(method, path, data) {
  // 500 lines of auth, toast, router redirect, refresh token,
  // feature-specific conditions, tenant selection, error handling,
  // domain hacks, retries, and logging
}
```

Masalahnya bukan hanya panjang. Masalahnya adalah dependency direction rusak.

HTTP core tiba-tiba tahu:

- router;
- toast;
- feature flag;
- product-specific copywriting;
- domain-specific validation;
- modal behavior;
- business state.

Akibatnya:

- sulit dites;
- sulit dipakai di non-React context;
- sulit dipakai di worker;
- sulit dipakai oleh generated client;
- sulit melakukan migration;
- error handling menjadi global tapi domain butuh lokal;
- perubahan satu feature bisa memecahkan semua request.

### 3.1 Prinsip Dependency Direction

Arah dependency ideal:

```txt
UI → feature hooks → API endpoint → HTTP core
```

Bukan:

```txt
HTTP core → router/toast/feature/domain state
```

HTTP core boleh expose event/callback, tapi jangan hardcode UI behavior.

Contoh lebih baik:

```ts
const http = createHttpClient({
  baseUrl: config.apiBaseUrl,
  credentials: 'include',
  onAuthExpired: () => authEvents.emit({ type: 'AUTH_EXPIRED' }),
  onRequestObserved: telemetry.recordHttp,
})
```

Yang terjadi saat auth expired dapat ditangani layer aplikasi.

---

## 4. Desain Tipe Error: Jangan Lempar `Error` Mentah

Dalam Java, Anda terbiasa dengan typed exception hierarchy atau result object.

Di frontend TypeScript, banyak aplikasi hanya melakukan:

```ts
throw new Error('Request failed')
```

Itu membuang informasi penting:

- status code;
- error code;
- validation details;
- trace ID;
- retryability;
- response headers;
- request method/path;
- apakah error berasal dari network, timeout, abort, atau HTTP response.

### 4.1 Taxonomy Error yang Berguna

Kita butuh membedakan minimal:

```txt
ApiError
├── NetworkError
│   ├── Dns/Tls/Connection failure, usually opaque to JS
│   └── Browser-level fetch failure
├── TimeoutError
├── AbortError
├── HttpError
│   ├── status
│   ├── problem details / error envelope
│   ├── retryAfter
│   └── traceId
├── ParseError
│   ├── invalid JSON
│   ├── unexpected empty body
│   └── schema mismatch
└── ClientConfigError
    ├── invalid URL
    ├── unsupported body type
    └── missing base URL
```

### 4.2 Contoh TypeScript Error Model

```ts
export type ApiError =
  | NetworkFailure
  | TimeoutFailure
  | AbortFailure
  | HttpFailure
  | ParseFailure
  | SchemaFailure
  | ClientConfigFailure

export interface FailureBase {
  readonly kind: string
  readonly message: string
  readonly method?: string
  readonly path?: string
  readonly requestId?: string
  readonly traceId?: string
  readonly cause?: unknown
}

export interface NetworkFailure extends FailureBase {
  readonly kind: 'network'
}

export interface TimeoutFailure extends FailureBase {
  readonly kind: 'timeout'
  readonly timeoutMs: number
}

export interface AbortFailure extends FailureBase {
  readonly kind: 'abort'
}

export interface HttpFailure extends FailureBase {
  readonly kind: 'http'
  readonly status: number
  readonly statusText: string
  readonly retryable: boolean
  readonly retryAfterMs?: number
  readonly code?: string
  readonly details?: unknown
  readonly rawBody?: unknown
}

export interface ParseFailure extends FailureBase {
  readonly kind: 'parse'
  readonly status: number
  readonly contentType?: string
}

export interface SchemaFailure extends FailureBase {
  readonly kind: 'schema'
  readonly status: number
  readonly issues: unknown
}

export interface ClientConfigFailure extends FailureBase {
  readonly kind: 'client-config'
}
```

Dengan model ini, UI bisa melakukan branching yang jelas:

```ts
function getUserMessage(error: ApiError): string {
  switch (error.kind) {
    case 'timeout':
      return 'Request timed out. Please try again.'
    case 'network':
      return 'Network connection failed.'
    case 'abort':
      return ''
    case 'http':
      if (error.status === 401) return 'Your session has expired.'
      if (error.status === 403) return 'You do not have access.'
      if (error.status === 409) return 'The record was changed by someone else.'
      if (error.status === 429) return 'Too many requests. Please wait.'
      return 'Request failed.'
    case 'parse':
    case 'schema':
      return 'The server returned an unexpected response.'
    case 'client-config':
      return 'Application configuration error.'
  }
}
```

### 4.3 Abort Bukan Error User-Visible

Jika user pindah route, mengetik search baru, atau component unmount, request lama bisa dibatalkan.

Itu bukan “failure” bagi user.

Jangan tampilkan toast:

```txt
Request cancelled
```

Untuk UI, abort biasanya silent.

Tetapi untuk telemetry, abort tetap bisa dicatat sebagai cancellation event bila berguna.

---

## 5. Response Parsing: Bagian yang Sering Diremehkan

Banyak wrapper melakukan:

```ts
const data = await response.json()
```

Ini salah untuk banyak kasus.

### 5.1 Kasus Response Body

Response bisa berupa:

- JSON success body;
- JSON error body;
- empty body (`204 No Content`, `205 Reset Content`, `304 Not Modified`);
- text/plain;
- HTML error page dari proxy;
- blob/file download;
- stream;
- invalid JSON;
- body sudah consumed;
- content-type hilang;
- content-type salah.

### 5.2 Prinsip Parsing

HTTP client harus melihat:

- method;
- status;
- `Content-Type`;
- `Content-Length` bila ada;
- expected response type;
- apakah status mengizinkan body;
- apakah response error body punya format standard.

### 5.3 Status yang Tidak Seharusnya Diparse sebagai JSON Body

Secara praktis, jangan parse body untuk:

- `204 No Content`;
- `205 Reset Content`;
- `304 Not Modified`;
- response terhadap `HEAD`.

Contoh helper:

```ts
function responseMustBeBodyless(method: string, status: number): boolean {
  return method.toUpperCase() === 'HEAD'
    || status === 204
    || status === 205
    || status === 304
}
```

### 5.4 Expected Response Type

Jangan anggap semua response JSON.

```ts
type ResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream' | 'void'
```

Endpoint layer bisa memilih:

```ts
export const documentApi = {
  downloadPdf(id: string) {
    return http.get<Blob>(`/documents/${id}/pdf`, {
      responseType: 'blob',
    })
  },
}
```

---

## 6. Request Builder: Normalisasi Input Menjadi HTTP Request

HTTP client core harus bertanggung jawab untuk membangun request secara konsisten.

### 6.1 Hal yang Perlu Dinormalisasi

- base URL;
- path joining;
- query parameter serialization;
- headers;
- body serialization;
- credentials mode;
- cache mode;
- signal;
- timeout;
- idempotency key;
- trace/correlation headers;
- accept/content-type;
- request priority bila digunakan;
- keepalive bila relevan.

### 6.2 Query Parameter Serialization

Ini terlihat sederhana tapi banyak bug.

Pertanyaan desain:

- Array ditulis sebagai apa?
  - `?status=open&status=closed`
  - `?status=open,closed`
  - `?status[]=open&status[]=closed`
- Boolean ditulis sebagai `true/false`, `1/0`, atau presence-only?
- Date pakai ISO string atau epoch?
- Null/undefined dibuang atau dikirim?
- Sorting multi-field seperti apa?
- Search string perlu trimming?

Contoh helper:

```ts
type QueryValue = string | number | boolean | null | undefined

type QueryParams = Record<string, QueryValue | QueryValue[]>

export function buildQuery(params?: QueryParams): string {
  if (!params) return ''

  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue
        search.append(key, String(item))
      }
    } else {
      search.append(key, String(value))
    }
  }

  const qs = search.toString()
  return qs ? `?${qs}` : ''
}
```

### 6.3 Body Serialization

Body bukan selalu JSON.

Rules:

- Plain object → JSON + `Content-Type: application/json`.
- `FormData` → jangan set `Content-Type` manual, browser perlu memasang boundary.
- `Blob`/`ArrayBuffer` → content type tergantung use case.
- `URLSearchParams` → `application/x-www-form-urlencoded`.
- `ReadableStream` → advanced, perlu hati-hati.

Contoh:

```ts
function serializeBody(body: unknown, headers: Headers): BodyInit | undefined {
  if (body === undefined || body === null) return undefined

  if (body instanceof FormData) {
    // Do not set Content-Type. Browser will include multipart boundary.
    return body
  }

  if (body instanceof URLSearchParams) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8')
    }
    return body
  }

  if (body instanceof Blob || body instanceof ArrayBuffer) {
    return body
  }

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  return JSON.stringify(body)
}
```

---

## 7. Credentials and Auth: Jangan Campur Mekanisme

Ada dua pola besar untuk browser API auth:

1. cookie/session-based auth;
2. bearer-token-based auth.

Masing-masing punya implikasi HTTP client berbeda.

### 7.1 Cookie-Based Session

Biasanya client config:

```ts
credentials: 'include'
```

atau untuk same-origin saja:

```ts
credentials: 'same-origin'
```

Dengan cookie auth:

- JavaScript tidak perlu membaca token;
- `HttpOnly` cookie tidak terlihat JS;
- CORS credential harus benar jika cross-origin;
- CSRF perlu dipikirkan;
- logout harus clear cookie server-side;
- `SameSite`, `Secure`, `Domain`, `Path` sangat penting.

HTTP client layer harus konsisten mengirim credentials.

Jangan ada endpoint yang lupa `credentials`.

### 7.2 Bearer Token

Biasanya:

```ts
headers.set('Authorization', `Bearer ${accessToken}`)
```

Dengan bearer token:

- storage token menjadi keputusan besar;
- localStorage rentan jika XSS terjadi;
- memory-only token aman dari persistence tapi refresh/navigation lebih kompleks;
- refresh token rotation perlu single-flight;
- `Authorization` header memicu CORS preflight pada cross-origin request;
- caching harus hati-hati.

### 7.3 Jangan Membuat Client yang Mendukung Semua Mode Tanpa Disiplin

Anti-pattern:

```ts
if (token) headers.Authorization = `Bearer ${token}`
credentials = 'include'
```

Ini bisa menggabungkan cookie dan bearer token tanpa threat model jelas.

Lebih baik pilih auth strategy eksplisit:

```ts
type AuthStrategy =
  | { kind: 'cookie'; credentials: RequestCredentials }
  | { kind: 'bearer'; getAccessToken: () => string | null | Promise<string | null> }
  | { kind: 'none' }
```

Lalu client dibuat dengan strategi tertentu.

---

## 8. Token Refresh: Single-Flight atau Stampede

Jika access token expired, 10 request paralel bisa mendapat `401` bersamaan.

Desain buruk:

```txt
10 requests fail 401
10 refresh token calls
some refresh succeeds
some refresh fails
some overwrite token state
user randomly logged out
```

Kita butuh single-flight refresh.

### 8.1 Refresh Single-Flight Concept

```ts
let refreshPromise: Promise<void> | null = null

async function refreshOnce(): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = refreshToken().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}
```

### 8.2 Retry Setelah Refresh

Flow:

```txt
send request
  ↓
401?
  ↓
if endpoint is refresh/login/logout → do not refresh recursively
  ↓
refreshOnce()
  ↓
retry original request once
  ↓
still 401? auth expired
```

Pseudo-code:

```ts
async function requestWithAuthRetry<T>(req: HttpRequest): Promise<T> {
  const first = await send<T>(req)

  if (!isAuthExpired(first)) {
    return unwrap(first)
  }

  if (req.skipAuthRefresh) {
    return unwrap(first)
  }

  await refreshOnce()

  const second = await send<T>({
    ...req,
    retryAttempt: req.retryAttempt + 1,
  })

  return unwrap(second)
}
```

### 8.3 Guardrail Penting

- Jangan refresh untuk refresh endpoint.
- Jangan infinite loop.
- Jangan refresh untuk `403`.
- Jangan refresh untuk anonymous endpoints.
- Jangan menganggap semua `401` berarti token expired; bisa credential invalid.
- Jangan menampilkan banyak toast expired session.
- Jangan retry mutation non-idempotent setelah refresh tanpa memahami apakah request pertama mencapai server.

### 8.4 Cookie Session Renewal

Untuk cookie session, refresh bisa berupa:

- silent endpoint `/session/refresh`;
- BFF-managed session renewal;
- no explicit refresh: server returns `401`, app redirects login.

Tetap perlu single-flight bila banyak request paralel.

---

## 9. Retry Policy: Harus Dekat dengan HTTP Semantics

Retry tidak boleh global buta.

Pertanyaan:

- Method apa?
- Apakah request idempotent?
- Apakah ada idempotency key?
- Status apa?
- Apakah error network sebelum request terkirim atau setelah mungkin terkirim?
- Apakah user action masih relevan?
- Apakah request dibatalkan?
- Apakah ada `Retry-After`?

### 9.1 Default Retry Matrix

| Scenario | Default |
|---|---:|
| `GET` network failure | boleh retry terbatas |
| `GET` `502/503/504` | boleh retry dengan backoff |
| `GET` `429` | ikuti `Retry-After` bila ada |
| `POST` create tanpa idempotency key | jangan auto-retry |
| `POST` dengan idempotency key | boleh retry terbatas |
| `PUT` idempotent | boleh retry terbatas jika aman |
| `PATCH` | hati-hati; tergantung semantics |
| `DELETE` | bisa idempotent, tapi UI harus sadar |
| `401` | auth flow, bukan generic retry |
| `403` | jangan retry |
| `404` | jangan retry kecuali eventual consistency known |
| `409/412` | conflict handling, bukan retry buta |
| `500` | retry sangat terbatas, jangan storm |
| abort | jangan retry |
| timeout | tergantung idempotency |

### 9.2 Retry Budget

Retry harus punya budget:

```ts
interface RetryPolicy {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  jitter: boolean
  shouldRetry: (context: RetryContext) => boolean
}
```

Backoff:

```ts
function computeBackoffMs(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** attempt)
  const jitter = Math.random() * exponential * 0.3
  return exponential + jitter
}
```

### 9.3 TanStack Query/SWR Retry Tidak Menggantikan HTTP Core Sepenuhnya

Query library bisa retry query, tetapi HTTP core tetap perlu tahu:

- apa itu abort;
- bagaimana parse `Retry-After`;
- apa error kind;
- status mana retryable;
- mutation retry policy.

Query layer dapat memakai error metadata dari HTTP core.

---

## 10. Timeout and Cancellation

Fetch tidak punya timeout default yang sama seperti banyak HTTP client backend.

Modern browser mendukung `AbortController`, dan `AbortSignal.timeout()` tersedia di browser modern.

### 10.1 Timeout via AbortSignal

```ts
async function fetchWithTimeout(input: RequestInfo, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)

  try {
    return await fetch(input, {
      ...init,
      signal: mergeSignals(init.signal, controller.signal),
    })
  } finally {
    clearTimeout(timeout)
  }
}
```

Namun `mergeSignals` perlu hati-hati.

### 10.2 Signal Composition

Satu request bisa punya beberapa cancellation source:

- route changed;
- component unmounted;
- user clicked cancel;
- timeout expired;
- query library cancelled;
- parent operation cancelled.

Konsep:

```ts
function anySignal(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter(Boolean) as AbortSignal[]
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]

  const controller = new AbortController()

  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      return controller.signal
    }

    signal.addEventListener('abort', () => {
      if (!controller.signal.aborted) {
        controller.abort(signal.reason)
      }
    }, { once: true })
  }

  return controller.signal
}
```

### 10.3 Timeout Bukan Selalu Server Lambat

Timeout bisa disebabkan:

- DNS/connect/TLS delay;
- captive portal;
- radio mobile switching;
- browser queueing;
- service worker hang;
- proxy/CDN issue;
- backend slow;
- response body download lambat;
- main thread blocked sebelum handling response.

HTTP client hanya melihat sebagian dari realitas itu. Observability layer harus mengisi sisanya.

---

## 11. Observability Built into HTTP Client

Setiap request adalah peluang observability.

Minimal metadata:

- method;
- path/template, bukan full URL dengan PII;
- status;
- duration;
- error kind;
- retry count;
- timeout flag;
- abort flag;
- request ID;
- trace ID;
- response size bila tersedia;
- endpoint name;
- query/mutation name;
- environment;
- release version.

### 11.1 Jangan Log PII dari URL/Body

Bahaya:

```txt
GET /users?email=jane@example.com
POST body contains password
Authorization: Bearer ...
Cookie: session=...
```

HTTP client harus punya sanitization.

```ts
function sanitizePath(path: string): string {
  return path
    .replace(/[0-9a-fA-F-]{36}/g, ':uuid')
    .replace(/\b\d{4,}\b/g, ':id')
}
```

Lebih baik endpoint layer mengirim template:

```ts
http.get(`/users/${id}`, {
  endpointName: 'GetUserProfile',
  routeTemplate: '/users/:id',
})
```

### 11.2 Trace Context

Jika organisasi memakai distributed tracing, HTTP client bisa inject `traceparent` atau correlation header sesuai policy.

Namun jangan sembarang menambahkan custom header ke cross-origin public API karena bisa memicu preflight.

Untuk same-origin/BFF, trace header relatif aman.

Untuk cross-origin API, koordinasikan dengan CORS `Access-Control-Allow-Headers`.

### 11.3 Server Timing

HTTP client atau RUM collector bisa membaca `Server-Timing` jika browser mengeksposnya melalui Performance API.

Gunanya:

- memisahkan backend time vs network time;
- melihat cache hit/miss;
- melihat DB time;
- melihat gateway overhead.

---

## 12. Generated Client vs Handwritten Client

Ada dua pendekatan besar:

1. handwritten endpoint wrapper;
2. generated client dari OpenAPI.

### 12.1 Handwritten Client

Kelebihan:

- fleksibel;
- mudah disesuaikan dengan domain;
- bagus untuk API kecil/menengah;
- mudah dibaca.

Kekurangan:

- contract drift;
- response typing bisa bohong;
- banyak boilerplate;
- kurang coverage endpoint;
- perubahan backend bisa terlambat ketahuan.

### 12.2 Generated Client

Kelebihan:

- sinkron dengan API spec;
- endpoint lengkap;
- type generation;
- mengurangi boilerplate;
- bisa dipakai untuk contract tests.

Kekurangan:

- output kadang terlalu low-level;
- error handling default belum cocok;
- auth/cors/timeout/retry perlu adapter;
- generated code bisa besar;
- naming bisa buruk jika OpenAPI buruk;
- spec tidak selalu akurat.

### 12.3 Pola yang Biasanya Paling Sehat

Jangan langsung expose generated client ke component.

Gunakan adapter:

```txt
generated OpenAPI client
  ↓
API adapter / domain endpoint wrapper
  ↓
feature hooks
  ↓
UI
```

Contoh:

```ts
// generated client returns low-level DTO
const generated = new GeneratedUsersApi(config)

// domain wrapper normalizes naming/error/input shape
export const userApi = {
  async getProfile(userId: UserId): Promise<UserProfile> {
    const dto = await generated.getUserById({ userId })
    return mapUserDto(dto)
  },
}
```

### 12.4 OpenAPI Spec Quality Matters

Generated client hanya sebagus contract-nya.

Pastikan spec punya:

- status code lengkap;
- error schema;
- nullable fields akurat;
- enum akurat;
- pagination schema;
- security schemes;
- content types;
- request/response examples;
- operationId stabil;
- deprecation flags;
- versioning policy.

---

## 13. Runtime Validation: TypeScript Types Tidak Memvalidasi Response

TypeScript memberi compile-time types. Server response adalah runtime data.

```ts
const user = await http.get<User>('/user/me')
```

Ini tidak membuktikan response benar-benar `User`.

Jika backend berubah atau proxy mengembalikan HTML error page, TypeScript tetap percaya.

### 13.1 Kapan Runtime Validation Penting?

Tidak semua endpoint butuh runtime validation penuh. Tetapi sangat berguna untuk:

- critical auth/session response;
- feature flag/config response;
- payment/regulatory/mission-critical data;
- external API;
- API yang sering berubah;
- generated clients dari spec yang belum trusted;
- security-sensitive policy response.

### 13.2 Zod-Style Schema Validation

Contoh:

```ts
import { z } from 'zod'

const UserProfileSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  roles: z.array(z.string()),
})

type UserProfile = z.infer<typeof UserProfileSchema>

export async function getProfile(): Promise<UserProfile> {
  const raw = await http.get<unknown>('/me')
  return UserProfileSchema.parse(raw)
}
```

Atau lebih aman:

```ts
const parsed = UserProfileSchema.safeParse(raw)
if (!parsed.success) {
  throw makeSchemaFailure(parsed.error)
}
return parsed.data
```

### 13.3 Validation Boundary

Runtime validation idealnya dilakukan di API endpoint/domain adapter layer, bukan UI component.

```txt
HTTP core parses JSON unknown
  ↓
endpoint adapter validates DTO
  ↓
domain type returned to app
```

---

## 14. Query Cache vs HTTP Cache

Ini perbedaan penting.

### 14.1 HTTP Cache

Dikendalikan oleh:

- `Cache-Control`;
- `ETag`;
- `Last-Modified`;
- `Vary`;
- browser cache;
- CDN/shared cache.

Key berbasis HTTP semantics.

### 14.2 Query Cache

Dikendalikan oleh application layer:

- query key;
- stale time;
- cache time/gc time;
- invalidation;
- refetch on focus;
- refetch on reconnect;
- optimistic update;
- mutation side effects.

Key berbasis domain/application semantics.

### 14.3 Jangan Campur Mental Model

Contoh:

```ts
useQuery({
  queryKey: ['user', userId],
  queryFn: () => userApi.getProfile(userId),
  staleTime: 60_000,
})
```

`staleTime` bukan HTTP `max-age`.

Jika HTTP response punya `Cache-Control: no-store`, query cache masih bisa menyimpan data di memory aplikasi kecuali Anda melarangnya.

Untuk data sensitif, Anda perlu policy aplikasi:

- jangan persist query cache;
- clear cache on logout;
- short stale time;
- no devtools exposure di prod bila sensitif;
- avoid localStorage persistence.

### 14.4 Invalidation

Mutation harus tahu query mana yang menjadi stale.

```ts
const mutation = useMutation({
  mutationFn: userApi.updateEmail,
  onSuccess: (_, variables) => {
    queryClient.invalidateQueries({ queryKey: ['user-profile', variables.userId] })
  },
})
```

Ini bukan tugas HTTP core. Ini tugas feature/data layer.

---

## 15. Request Deduplication

Deduplication bisa terjadi di beberapa layer:

- browser HTTP cache;
- service worker;
- query library;
- custom in-flight map;
- CDN;
- backend.

HTTP client core harus hati-hati jika menambahkan dedupe sendiri.

### 15.1 Safe Dedupe

Biasanya aman untuk:

- GET query identical;
- same URL + same params + same auth context;
- request yang memang pure read.

### 15.2 Dangerous Dedupe

Berbahaya untuk:

- POST mutation;
- endpoint yang punya side effect walau GET;
- request dengan body berbeda tapi key salah;
- request berbeda tenant/user tapi URL sama;
- response tergantung header seperti language/feature flag.

### 15.3 Dedupe Key Harus Memperhitungkan Variants

Key minimal:

```txt
method + url + query + relevant headers + body hash + auth/tenant context
```

Dalam praktik, lebih baik query library yang melakukan dedupe berdasarkan query key domain.

---

## 16. Interceptors: Power and Danger

Banyak library menyediakan interceptor.

Interceptor berguna untuk:

- auth header;
- correlation ID;
- logging;
- normalization;
- retry;
- refresh token.

Tapi interceptor sering menjadi hidden control flow.

### 16.1 Masalah Interceptor

- Request behavior tidak terlihat di endpoint call.
- Order interceptor memengaruhi hasil.
- Interceptor bisa mutate config global.
- Error dilempar dari tempat tak terduga.
- Refresh token logic bisa recursive.
- Testing lebih sulit.
- Domain-specific exception masuk global layer.

### 16.2 Aturan Sehat

- Gunakan interceptor untuk cross-cutting concern saja.
- Jangan taruh UI behavior di interceptor.
- Jangan taruh domain mapping di interceptor.
- Jangan mutate request object secara tidak jelas.
- Dokumentasikan order.
- Pastikan retry/refresh punya guard.
- Pastikan telemetry melihat attempt count.

---

## 17. Example: Minimal but Serious Fetch-Based HTTP Client

Berikut contoh desain yang cukup serius namun tetap bisa dipahami.

Ini bukan library final, tapi blueprint.

### 17.1 Types

```ts
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

type ResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream' | 'void'

interface HttpClientOptions {
  baseUrl: string
  credentials?: RequestCredentials
  defaultTimeoutMs?: number
  defaultHeaders?: HeadersInit
  getAuthHeader?: () => Promise<string | null> | string | null
  onEvent?: (event: HttpClientEvent) => void
}

interface RequestOptions {
  query?: QueryParams
  headers?: HeadersInit
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
  responseType?: ResponseType
  retry?: Partial<RetryPolicy>
  idempotencyKey?: string | true
  endpointName?: string
  routeTemplate?: string
  skipAuth?: boolean
  skipAuthRefresh?: boolean
}

interface HttpClientEvent {
  type: 'request-start' | 'request-success' | 'request-failure' | 'request-retry'
  method: string
  path: string
  endpointName?: string
  status?: number
  durationMs?: number
  errorKind?: string
  attempt: number
}
```

### 17.2 Client Skeleton

```ts
export function createHttpClient(options: HttpClientOptions) {
  async function request<T>(
    method: HttpMethod,
    path: string,
    req: RequestOptions = {},
  ): Promise<T> {
    const startedAt = performance.now()
    let attempt = 0

    const retryPolicy = resolveRetryPolicy(method, req.retry)

    while (true) {
      try {
        options.onEvent?.({
          type: 'request-start',
          method,
          path: req.routeTemplate ?? path,
          endpointName: req.endpointName,
          attempt,
        })

        const result = await sendOnce<T>(options, method, path, req, attempt)

        options.onEvent?.({
          type: 'request-success',
          method,
          path: req.routeTemplate ?? path,
          endpointName: req.endpointName,
          status: result.status,
          durationMs: performance.now() - startedAt,
          attempt,
        })

        return result.data
      } catch (error) {
        const normalized = normalizeUnknownError(error, method, path)

        if (!shouldRetry(normalized, method, attempt, retryPolicy)) {
          options.onEvent?.({
            type: 'request-failure',
            method,
            path: req.routeTemplate ?? path,
            endpointName: req.endpointName,
            status: normalized.kind === 'http' ? normalized.status : undefined,
            durationMs: performance.now() - startedAt,
            errorKind: normalized.kind,
            attempt,
          })
          throw normalized
        }

        options.onEvent?.({
          type: 'request-retry',
          method,
          path: req.routeTemplate ?? path,
          endpointName: req.endpointName,
          status: normalized.kind === 'http' ? normalized.status : undefined,
          errorKind: normalized.kind,
          attempt,
        })

        await delay(computeBackoffMs(attempt, retryPolicy.baseDelayMs, retryPolicy.maxDelayMs))
        attempt += 1
      }
    }
  }

  return {
    get: <T>(path: string, req?: RequestOptions) => request<T>('GET', path, req),
    post: <T>(path: string, req?: RequestOptions) => request<T>('POST', path, req),
    put: <T>(path: string, req?: RequestOptions) => request<T>('PUT', path, req),
    patch: <T>(path: string, req?: RequestOptions) => request<T>('PATCH', path, req),
    delete: <T>(path: string, req?: RequestOptions) => request<T>('DELETE', path, req),
    head: <T>(path: string, req?: RequestOptions) => request<T>('HEAD', path, req),
  }
}
```

### 17.3 Send Once

```ts
async function sendOnce<T>(
  options: HttpClientOptions,
  method: HttpMethod,
  path: string,
  req: RequestOptions,
  attempt: number,
): Promise<{ status: number; data: T }> {
  const headers = new Headers(options.defaultHeaders)

  for (const [key, value] of new Headers(req.headers)) {
    headers.set(key, value)
  }

  if (!req.skipAuth && options.getAuthHeader) {
    const auth = await options.getAuthHeader()
    if (auth) headers.set('Authorization', auth)
  }

  if (req.idempotencyKey) {
    headers.set(
      'Idempotency-Key',
      req.idempotencyKey === true ? crypto.randomUUID() : req.idempotencyKey,
    )
  }

  const body = serializeBody(req.body, headers)
  const query = buildQuery(req.query)
  const url = joinUrl(options.baseUrl, path) + query

  const timeoutMs = req.timeoutMs ?? options.defaultTimeoutMs
  const timeoutSignal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
  const signal = anySignal([req.signal, timeoutSignal])

  let response: Response

  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      credentials: options.credentials,
      signal,
    })
  } catch (cause) {
    if (signal?.aborted && timeoutSignal?.aborted) {
      throw makeTimeoutFailure(method, path, timeoutMs!, cause)
    }
    if (signal?.aborted) {
      throw makeAbortFailure(method, path, cause)
    }
    throw makeNetworkFailure(method, path, cause)
  }

  const parsed = await parseResponse(response, method, req.responseType ?? 'json')

  if (!response.ok) {
    throw makeHttpFailure(response, method, path, parsed)
  }

  return {
    status: response.status,
    data: parsed as T,
  }
}
```

Catatan penting:

- `AbortSignal.timeout()` modern, tetapi untuk browser lama perlu fallback.
- `crypto.randomUUID()` modern, tetapi untuk browser lama perlu fallback.
- `response.ok` true untuk status 200–299.
- `fetch()` reject untuk network-level failure, bukan untuk HTTP 4xx/5xx.

---

## 18. Endpoint Layer: Typed Contract di Atas HTTP Core

HTTP core seharusnya generic. Endpoint layer memberi makna domain/API.

### 18.1 Contoh Endpoint Layer

```ts
export interface Page<T> {
  items: T[]
  nextCursor?: string
}

export interface CaseSummary {
  id: string
  title: string
  status: 'open' | 'closed' | 'escalated'
  updatedAt: string
}

export interface SearchCasesParams {
  q?: string
  status?: Array<'open' | 'closed' | 'escalated'>
  cursor?: string
  limit?: number
}

export const caseApi = {
  search(params: SearchCasesParams): Promise<Page<CaseSummary>> {
    return http.get<Page<CaseSummary>>('/cases', {
      query: params,
      endpointName: 'SearchCases',
      routeTemplate: '/cases',
    })
  },

  getById(caseId: string): Promise<CaseDetail> {
    return http.get<CaseDetail>(`/cases/${encodeURIComponent(caseId)}`, {
      endpointName: 'GetCaseDetail',
      routeTemplate: '/cases/:caseId',
    })
  },

  updateStatus(caseId: string, input: UpdateCaseStatusInput): Promise<CaseDetail> {
    return http.patch<CaseDetail>(`/cases/${encodeURIComponent(caseId)}/status`, {
      body: input,
      idempotencyKey: true,
      endpointName: 'UpdateCaseStatus',
      routeTemplate: '/cases/:caseId/status',
    })
  },
}
```

### 18.2 Endpoint Layer Boleh Mengetahui HTTP Semantics

Endpoint layer boleh tahu:

- method;
- URL path;
- expected status/body;
- idempotency key;
- response type;
- route template;
- schema validation;
- API-specific error code mapping.

Endpoint layer tidak seharusnya tahu:

- toast behavior;
- component state;
- router redirect;
- modal UI;
- query invalidation secara umum, kecuali melalui feature hook.

---

## 19. Feature Hooks: Tempat Query/Mutation Policy Tinggal

Feature hook mengikat endpoint ke UI data lifecycle.

### 19.1 Query Hook

```ts
export function useCaseDetail(caseId: string) {
  return useQuery({
    queryKey: ['case-detail', caseId],
    queryFn: ({ signal }) => caseApi.getById(caseId, { signal }),
    enabled: Boolean(caseId),
    staleTime: 30_000,
  })
}
```

Agar ini bekerja, endpoint method bisa menerima `signal`:

```ts
getById(caseId: string, options?: { signal?: AbortSignal }) {
  return http.get<CaseDetail>(`/cases/${encodeURIComponent(caseId)}`, {
    signal: options?.signal,
    endpointName: 'GetCaseDetail',
    routeTemplate: '/cases/:caseId',
  })
}
```

### 19.2 Mutation Hook

```ts
export function useUpdateCaseStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: caseApi.updateStatus,
    onSuccess: (updated) => {
      queryClient.setQueryData(['case-detail', updated.id], updated)
      queryClient.invalidateQueries({ queryKey: ['case-list'] })
    },
  })
}
```

### 19.3 Optimistic Update

Optimistic update adalah domain behavior, bukan HTTP core behavior.

```ts
export function useOptimisticCaseStatusUpdate(caseId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateCaseStatusInput) => caseApi.updateStatus(caseId, input),

    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['case-detail', caseId] })

      const previous = queryClient.getQueryData<CaseDetail>(['case-detail', caseId])

      if (previous) {
        queryClient.setQueryData<CaseDetail>(['case-detail', caseId], {
          ...previous,
          status: input.status,
        })
      }

      return { previous }
    },

    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['case-detail', caseId], context.previous)
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['case-detail', caseId] })
    },
  })
}
```

HTTP core hanya tahu request/response. Optimistic semantics ada di domain data layer.

---

## 20. Upload and Download Architecture

Upload/download biasanya butuh perlakuan khusus.

### 20.1 File Upload dengan FormData

```ts
export async function uploadEvidence(caseId: string, file: File): Promise<Evidence> {
  const form = new FormData()
  form.append('file', file)

  return http.post<Evidence>(`/cases/${encodeURIComponent(caseId)}/evidence`, {
    body: form,
    endpointName: 'UploadEvidence',
    routeTemplate: '/cases/:caseId/evidence',
    timeoutMs: 120_000,
  })
}
```

Jangan set `Content-Type` manual untuk `FormData`.

Browser harus memasang boundary.

### 20.2 Upload Progress

Fetch belum selalu memberi upload progress ergonomis seperti XHR untuk semua kasus.

Jika upload progress wajib, XHR masih sering dipakai:

```ts
function uploadWithProgress(url: string, form: FormData, onProgress: (pct: number) => void) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded / event.total)
      }
    }

    xhr.onload = () => resolve(xhr.responseText)
    xhr.onerror = () => reject(new Error('Upload failed'))
    xhr.send(form)
  })
}
```

Ini berarti HTTP architecture bisa memiliki transport adapter selain fetch.

```txt
HttpTransport
├── FetchTransport
└── XhrUploadTransport
```

### 20.3 Download Blob

```ts
export async function downloadReport(reportId: string): Promise<Blob> {
  return http.get<Blob>(`/reports/${encodeURIComponent(reportId)}/download`, {
    responseType: 'blob',
    endpointName: 'DownloadReport',
    routeTemplate: '/reports/:reportId/download',
    timeoutMs: 120_000,
  })
}
```

Content-Disposition filename parsing sebaiknya utility khusus, karena encoding filename bisa tricky.

---

## 21. Environment Configuration

HTTP client butuh konfigurasi environment yang benar.

### 21.1 Config yang Umum

- API base URL;
- credentials mode;
- auth strategy;
- timeout default;
- release version;
- telemetry endpoint;
- feature flag endpoint;
- environment name;
- whether to enable mocks;
- whether to use service worker;
- allowed origins.

### 21.2 Anti-Pattern

```ts
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.prod.example.com'
```

Fallback ke production berbahaya.

Lebih baik fail fast:

```ts
function requiredEnv(name: string): string {
  const value = import.meta.env[name]
  if (!value) throw new Error(`Missing required env: ${name}`)
  return value
}
```

### 21.3 Runtime Config vs Build-Time Config

Build-time config:

- dibundel ke JS;
- perlu rebuild untuk berubah;
- cocok untuk static values.

Runtime config:

- dimuat saat app start;
- bisa berbeda per deployment;
- cocok untuk enterprise multi-env;
- harus divalidasi runtime.

Runtime config endpoint harus sangat hati-hati caching-nya.

---

## 22. Testing HTTP Client Architecture

### 22.1 Test Level

| Level | Apa yang Dites |
|---|---|
| unit test HTTP core | parsing, timeout, retry, error normalization |
| unit test endpoint | URL/query/body/schema mapping |
| integration test feature hook | query/mutation/invalidation behavior |
| contract test | client sesuai OpenAPI/server contract |
| E2E | real browser behavior, CORS/cookies/redirects |

### 22.2 Mock Service Worker Style

Mocking di level network lebih realistis daripada mock function endpoint.

Manfaat:

- component tetap memakai real HTTP client;
- request method/path/body bisa diverifikasi;
- error status bisa disimulasikan;
- delay bisa disimulasikan;
- test mirip browser.

### 22.3 Golden Test untuk HTTP Core

Test wajib:

- `204` tidak memanggil `json()`;
- invalid JSON menghasilkan `ParseFailure`;
- `404` menjadi `HttpFailure` dengan status;
- `AbortError` menjadi `AbortFailure`;
- timeout menjadi `TimeoutFailure`;
- `Retry-After: 10` diparse;
- `GET 503` retry sesuai budget;
- `POST` tanpa idempotency key tidak retry;
- `POST` dengan idempotency key boleh retry;
- FormData tidak memasang `Content-Type` manual;
- query arrays serialized sesuai contract;
- credentials diset sesuai config;
- auth header tidak diset untuk `skipAuth`;
- refresh token single-flight;
- refresh endpoint tidak recursive;
- telemetry event muncul sekali per attempt.

### 22.4 Test Auth Refresh Race

Scenario:

```txt
3 requests start
all get 401
only 1 refresh call occurs
all 3 retry after refresh
all succeed
```

Test ini menangkap bug produksi yang sering mahal.

---

## 23. Security Considerations

HTTP client layer bisa menjadi titik kebocoran security jika tidak disiplin.

### 23.1 Jangan Log Secret

Never log:

- `Authorization`;
- `Cookie`;
- `Set-Cookie`;
- password;
- token;
- CSRF secret;
- PII query/body.

### 23.2 Jangan Global Attach Authorization ke Semua Origin

Jika base URL dinamis, validasi origin.

Bahaya:

```ts
fetch(userProvidedUrl, {
  headers: { Authorization: `Bearer ${token}` }
})
```

Token bisa bocor ke origin attacker.

### 23.3 SSRF-Like Frontend Issue

Browser bukan server, tetapi frontend tetap bisa dipakai untuk mengirim request ke endpoint yang tidak dimaksudkan, terutama bila app menerima URL remote dari input.

Guard:

- allowlist origin;
- jangan attach credentials ke arbitrary URL;
- jangan proxy arbitrary URL melalui BFF tanpa validation.

### 23.4 CSRF Header

Jika memakai CSRF token header, ingat:

- custom header memicu preflight untuk cross-origin;
- token harus diperoleh dengan aman;
- jangan simpan token di tempat yang memperluas risiko XSS;
- server tetap harus validasi.

### 23.5 Error Message Leakage

HTTP client tidak boleh menampilkan raw backend stack trace kepada user.

Jika response error HTML/stack trace, normalize menjadi generic error dan log sanitized metadata.

---

## 24. Performance Considerations

HTTP client bisa memengaruhi performance.

### 24.1 Avoid Chatty API Usage

HTTP client tidak bisa memperbaiki desain endpoint yang membuat 30 sequential requests.

Tetapi client architecture bisa mendeteksi:

- endpoint called too many times;
- duplicate request burst;
- sequential waterfall;
- slow TTFB;
- large payload;
- low cache hit.

### 24.2 Batching and Aggregation

Jangan membuat generic batch layer tanpa contract kuat.

Batching perlu mempertimbangkan:

- partial failure;
- cacheability;
- authorization per item;
- ordering;
- observability;
- retry semantics;
- response schema.

BFF sering lebih bersih daripada frontend custom batching.

### 24.3 Request Priority

Untuk critical render path, endpoint/resource loading perlu priority strategy.

Namun API `fetch` priority masih harus dipakai hati-hati dan diuji di browser target.

### 24.4 JSON Parse Cost

Large JSON parse bisa block main thread.

Mitigasi:

- kurangi payload;
- pagination;
- streaming bila cocok;
- Web Worker untuk heavy transform;
- binary format hanya jika benar-benar justified;
- hindari transform besar di render path.

---

## 25. Multi-Tenant and Regulatory Systems Angle

Untuk aplikasi enterprise/regulatory/case management, HTTP client layer harus lebih defensible.

### 25.1 Tenant Context

Tenant bisa berada di:

- subdomain;
- path;
- header;
- token claims;
- cookie/session;
- query parameter.

HTTP client harus memastikan tenant context konsisten.

Jangan sampai:

```txt
UI tenant A
request header tenant B
cookie session tenant C
```

### 25.2 Auditability

Mutation penting harus membawa:

- idempotency key;
- correlation ID;
- user/session context server-side;
- reason/comment bila domain butuh;
- version/ETag untuk concurrency;
- traceable endpoint name.

### 25.3 Case Lifecycle State Transitions

Untuk sistem lifecycle enforcement/case management, mutation bukan CRUD sederhana.

Frontend HTTP client harus mendukung:

- command endpoint;
- conflict response;
- validation detail;
- authorization failure detail yang tidak bocor;
- retry-safe command;
- long-running operation status;
- audit trail correlation.

Contoh:

```ts
caseApi.transition(caseId, {
  action: 'ESCALATE',
  reason: 'Evidence threshold met',
  expectedVersion: current.version,
})
```

HTTP mapping:

```txt
POST /cases/:caseId/transitions
Idempotency-Key: ...
If-Match: "case-version"
```

Possible outcomes:

- `200/201`: transition applied;
- `202`: accepted for async processing;
- `400/422`: invalid input;
- `403`: not allowed;
- `409`: domain conflict;
- `412`: version mismatch;
- `429`: rate limit;
- `503`: service unavailable.

Client layer should preserve enough metadata for feature layer to render correct state.

---

## 26. Suggested Directory Structure

Salah satu struktur praktis:

```txt
src/
  app/
    config/
      runtimeConfig.ts
    telemetry/
      httpTelemetry.ts
  shared/
    http/
      createHttpClient.ts
      errors.ts
      retry.ts
      parseResponse.ts
      queryParams.ts
      authStrategy.ts
      transport.ts
    validation/
      schemas.ts
  api/
    generated/
      ...
    users/
      userApi.ts
      userSchemas.ts
      userTypes.ts
      userMappers.ts
    cases/
      caseApi.ts
      caseSchemas.ts
      caseTypes.ts
      caseMappers.ts
  features/
    cases/
      hooks/
        useCaseDetail.ts
        useUpdateCaseStatus.ts
      components/
        CaseDetailPage.tsx
```

Tujuannya:

- HTTP core reusable;
- API per domain modular;
- generated code terisolasi;
- feature hooks dekat dengan UI use case;
- validation/mapping jelas;
- domain tidak bergantung langsung ke transport detail.

---

## 27. Decision Matrix: Library Choices

### 27.1 Native Fetch

Kelebihan:

- browser-native;
- stream support;
- no dependency;
- standard model;
- works well with AbortController;
- compatible with service worker.

Kekurangan:

- tidak reject pada HTTP errors;
- timeout perlu dibuat;
- interceptors tidak built-in;
- upload progress terbatas;
- response parsing harus dibuat.

### 27.2 Axios-Like Client

Kelebihan:

- ergonomics;
- interceptors;
- timeout built-in;
- transform request/response;
- mature ecosystem.

Kekurangan:

- abstraction berbeda dari Fetch;
- bundle dependency;
- cancellation model historically evolved;
- upload/download behavior perlu dipahami;
- bisa menyembunyikan browser semantics.

### 27.3 Generated Client

Kelebihan:

- type/contract-driven;
- endpoint coverage;
- reduces boilerplate.

Kekurangan:

- needs adapter;
- dependent on spec quality;
- generated API sometimes awkward.

### 27.4 Query Library

TanStack Query/SWR bukan HTTP client. Mereka data synchronization/cache layer.

Gunakan bersama HTTP client, bukan sebagai pengganti HTTP core.

---

## 28. Practical Build: Recommended Architecture for Serious Apps

Untuk aplikasi frontend serius, saya biasanya merekomendasikan:

```txt
1. Native fetch-based HTTP core
2. Typed error model
3. Explicit auth strategy
4. Endpoint-specific API modules
5. Runtime validation untuk critical endpoints
6. TanStack Query/SWR for query/mutation state
7. OpenAPI-generated types/client where spec quality is strong
8. Adapter layer over generated client
9. MSW-style network mocking for tests
10. Telemetry callback built into HTTP core
```

### 28.1 Why This Works

Karena memisahkan concern:

- Fetch handles browser transport.
- HTTP core handles protocol mechanics.
- API modules handle endpoint semantics.
- Query layer handles data synchronization.
- Feature hooks handle product behavior.
- UI handles rendering.

Tidak ada satu file yang menjadi “god client”.

---

## 29. Review Checklist: HTTP Client Architecture

Gunakan checklist ini saat review codebase.

### 29.1 Boundary

- [ ] Apakah component bebas dari raw `fetch()`?
- [ ] Apakah endpoint API punya module sendiri?
- [ ] Apakah HTTP core tidak bergantung pada router/toast/domain state?
- [ ] Apakah generated client tidak langsung bocor ke UI?

### 29.2 Request

- [ ] Base URL tervalidasi?
- [ ] Query serialization konsisten?
- [ ] Body serialization aman untuk JSON/FormData/blob?
- [ ] `Content-Type` tidak diset manual untuk FormData?
- [ ] Credentials/auth strategy eksplisit?
- [ ] Headers sensitif tidak bocor ke arbitrary origin?
- [ ] Idempotency key tersedia untuk retry-safe mutation?

### 29.3 Response

- [ ] `204/205/304/HEAD` tidak diparse sebagai JSON?
- [ ] `response.ok` dipakai dengan benar?
- [ ] Error body diparse aman?
- [ ] Invalid JSON menghasilkan parse error yang jelas?
- [ ] Blob/download didukung?
- [ ] Schema validation tersedia untuk endpoint kritis?

### 29.4 Error

- [ ] Error taxonomy jelas?
- [ ] Network/timeout/abort/http/parse/schema dibedakan?
- [ ] `401/403/409/412/429/5xx` punya behavior berbeda?
- [ ] `Retry-After` diparse?
- [ ] Abort tidak menjadi toast user-visible?

### 29.5 Reliability

- [ ] Timeout default ada?
- [ ] Cancellation didukung?
- [ ] Retry policy method/status-aware?
- [ ] Mutation tidak diretry sembarangan?
- [ ] Auth refresh single-flight?
- [ ] Tidak ada infinite refresh loop?
- [ ] Stale response bisa dicegah di query/search flows?

### 29.6 Observability

- [ ] Request duration tercatat?
- [ ] Endpoint name/route template tercatat?
- [ ] Status/error kind/retry count tercatat?
- [ ] Trace/correlation ID didukung?
- [ ] PII/secret tidak dilog?
- [ ] Release/environment metadata tersedia?

### 29.7 Data Layer

- [ ] Query keys stabil?
- [ ] Mutation invalidation jelas?
- [ ] Sensitive cache dibersihkan saat logout?
- [ ] Query cache tidak disamakan dengan HTTP cache?
- [ ] Optimistic update punya rollback?

### 29.8 Tests

- [ ] HTTP core punya golden tests?
- [ ] Endpoint URL/body/query mapping dites?
- [ ] Auth refresh race dites?
- [ ] Retry matrix dites?
- [ ] Network mock mendekati real browser behavior?

---

## 30. Common Failure Scenarios and Better Designs

### 30.1 “Unexpected end of JSON input”

Root cause:

```ts
await response.json()
```

untuk `204` atau empty body.

Better:

```ts
if (responseMustBeBodyless(method, response.status)) return undefined
```

### 30.2 “API Works but User Randomly Logged Out”

Root cause:

- parallel `401`;
- multiple refresh token calls;
- refresh rotation race;
- old refresh response overwrote new state.

Better:

- single-flight refresh;
- retry original request once;
- clear auth atomically;
- ignore stale refresh result.

### 30.3 “POST Created Duplicate Records”

Root cause:

- retry or double-click;
- no idempotency key;
- backend not deduping.

Better:

- disable duplicate submit in UI;
- idempotency key;
- server idempotency store;
- safe retry policy.

### 30.4 “Error Handling Inconsistent Across Screens”

Root cause:

- raw `fetch()` everywhere;
- no typed error model;
- component-level ad hoc parsing.

Better:

- shared error taxonomy;
- endpoint/domain-specific mapping;
- feature-level UI policy.

### 30.5 “CORS Suddenly Fails After Adding Header”

Root cause:

- custom header triggers preflight;
- server/gateway doesn't allow it.

Better:

- know which headers are truly needed;
- coordinate `Access-Control-Allow-Headers`;
- avoid unnecessary custom headers for cross-origin APIs.

### 30.6 “React Query Keeps Sensitive Data After Logout”

Root cause:

- query cache not cleared;
- persisted cache;
- logout only cleared token/cookie.

Better:

```ts
await logoutApi.logout()
queryClient.clear()
authStore.reset()
```

### 30.7 “Search Results Flash Old Data”

Root cause:

- old request completes after new search;
- no cancellation or response relevance check.

Better:

- query key includes search params;
- cancel previous query;
- ignore stale sequence;
- use AbortSignal.

---

## 31. Design Exercise

Desain HTTP client untuk aplikasi enterprise case management dengan requirements:

- SPA React/Vue;
- cookie-based session via BFF;
- CSRF token required for mutation;
- query cache for read screens;
- idempotency key for command endpoints;
- optimistic update for simple fields;
- conflict screen for state transition;
- file upload evidence with progress;
- PDF report download;
- correlation ID and trace propagation;
- runtime validation for session/config/case transition response;
- `401` redirects to login;
- `403` shows access denied;
- `409/412` shows conflict resolution;
- `429` respects `Retry-After`;
- service worker used only for static assets, not API caching;
- query cache cleared on logout.

### 31.1 Expected Architecture

```txt
Browser
  ↓
Fetch/XHR transport
  ↓
HTTP core
  - credentials: include
  - CSRF header for unsafe methods
  - timeout/abort
  - typed errors
  - telemetry
  - retry read-only/idempotent only
  ↓
API modules
  - caseApi
  - sessionApi
  - evidenceApi
  - reportApi
  ↓
Feature hooks
  - useCaseDetail
  - useTransitionCase
  - useUploadEvidence
  - useDownloadReport
  ↓
UI
```

### 31.2 Key Policies

- `GET` queries can retry `502/503/504` with backoff.
- Mutations retry only if idempotency key exists and error is retryable.
- `POST /case-transitions` always sends `Idempotency-Key`.
- `If-Match` used for version-sensitive transitions.
- CSRF header only sent to same trusted API origin.
- Upload progress uses XHR transport adapter.
- Download uses `blob` response type.
- API responses are not cached by service worker.
- Query cache is application memory, cleared on logout.
- HTTP cache strategy remains server-driven.
- Error envelope normalized to `ApiError`.
- Feature hooks map error to UI state.

---

## 32. Summary Mental Model

Frontend HTTP client architecture is not “how to call fetch”.

It is the design of the boundary where:

```txt
browser/network/protocol behavior
meets
application/domain/user experience behavior
```

A strong design has these invariants:

1. Raw `fetch()` does not leak everywhere.
2. HTTP core owns transport mechanics.
3. API modules own endpoint semantics.
4. Query/mutation layer owns data synchronization.
5. Feature hooks own product behavior.
6. UI owns rendering.
7. Errors are typed and meaningful.
8. Auth behavior is explicit.
9. Retry is semantic-aware.
10. Cancellation is first-class.
11. Observability is built in.
12. Sensitive data is protected.
13. Generated clients are adapted, not blindly exposed.
14. Runtime validation is used where correctness matters.
15. Tests exercise failure modes, not only happy path.

Top 1% frontend/backend engineers are not distinguished by knowing one HTTP client library. They are distinguished by knowing where each responsibility belongs, how failures propagate, and how to make the boundary stable under real production pressure.

---

## 33. Referensi Utama

- WHATWG Fetch Standard — browser fetching model, request/response/body/signal behavior.
- MDN Fetch API, Request, Response, Headers, AbortController, AbortSignal.
- RFC 9110 — HTTP semantics.
- RFC 9111 — HTTP caching semantics.
- RFC 9457 — Problem Details for HTTP APIs.
- OpenAPI Specification 3.1 — machine-readable HTTP API contract.
- OpenAPI Generator `typescript-fetch` documentation.
- TanStack Query documentation — query invalidation, retry, mutations, cancellation.
- Zod documentation — TypeScript-first runtime validation.
- OWASP guidance for secure error handling, CSRF, and HTTP security headers.

---

## 34. Apa yang Tidak Dibahas Mendalam di Bagian Ini

Bagian ini sengaja tidak membahas detail penuh:

- OpenAPI authoring;
- TanStack Query advanced patterns;
- service worker caching strategies;
- OAuth/OIDC full flow;
- WebSocket/realtime client architecture;
- frontend testing framework setup;
- SSR/server components data fetching architecture.

Topik-topik itu sudah dibahas sebagian di bagian lain atau layak menjadi seri sendiri.

---

## 35. Status Seri

```txt
Part 031 selesai.
Seri belum selesai.
Lanjut ke Part 032: Testing HTTP Behavior in Frontend Systems.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-030.md">⬅️ Part 030 — Reliability: Retries, Timeouts, Cancellation, Backoff, Rate Limits</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-032.md">Part 032 — Testing HTTP Behavior in Frontend Systems ➡️</a>
</div>

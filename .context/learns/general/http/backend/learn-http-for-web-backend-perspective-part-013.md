# learn-http-for-web-backend-perspective-part-013.md

# Part 013 — Caching for Backend Engineers

> Seri: `learn-http-for-web-backend-perspective`  
> Bagian: `013 / 032`  
> Topik: HTTP caching dari perspektif backend production  
> Target pembaca: Java backend engineer yang ingin memahami caching sebagai kontrak correctness, bukan sekadar optimasi performa.

---

## 0. Posisi Bagian Ini Dalam Seri

Pada bagian sebelumnya kita sudah membahas:

1. HTTP semantics dari sisi server.
2. Request lifecycle.
3. Method semantics.
4. Status code sebagai kontrak state.
5. Header sebagai control plane.
6. Message body dan framing.
7. URI dan resource modeling.
8. Content negotiation dan representation design.
9. Validation dan defensive boundary.
10. Error response design.
11. Idempotency dan retry.
12. Conditional request dan optimistic concurrency.

Bagian ini menyambungkan beberapa konsep tersebut ke **HTTP caching**.

Caching sering diajarkan secara terlalu dangkal:

```text
Cache-Control: max-age=3600
```

Lalu dianggap selesai.

Itu berbahaya untuk backend production.

Dalam sistem backend, caching adalah keputusan tentang:

1. **Siapa boleh menyimpan response.**
2. **Berapa lama response boleh dianggap fresh.**
3. **Kapan cache harus revalidate ke origin.**
4. **Input apa saja yang membedakan representation.**
5. **Apakah response user A mungkin bocor ke user B.**
6. **Apakah stale data masih aman secara domain.**
7. **Bagaimana client/proxy/CDN harus berperilaku saat origin gagal.**
8. **Bagaimana observability membedakan cache hit, cache miss, stale hit, dan origin hit.**

Kalau Part 012 membahas validator seperti `ETag` untuk concurrency dan revalidation, Part 013 membahas bagaimana validator itu bekerja bersama freshness policy dan cache layer.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus bisa:

1. Menjelaskan HTTP cache model dari perspektif backend.
2. Membedakan browser cache, shared cache, CDN cache, reverse proxy cache, application cache, dan database/query cache.
3. Mendesain `Cache-Control` untuk resource publik, private, authenticated, mutable, immutable, dan sensitive.
4. Menggunakan `ETag`, `Last-Modified`, `If-None-Match`, dan `If-Modified-Since` untuk revalidation.
5. Menentukan kapan menggunakan `no-store`, `no-cache`, `private`, `public`, `max-age`, `s-maxage`, `must-revalidate`, `stale-while-revalidate`, dan `stale-if-error`.
6. Memahami peran `Vary` dalam content negotiation dan authorization-sensitive responses.
7. Mencegah cache poisoning, cache deception, dan leakage antar-user/tenant.
8. Menghubungkan caching dengan idempotency, optimistic concurrency, security, observability, dan API evolution.
9. Mengimplementasikan caching dengan pola Java/Spring MVC dan WebFlux.
10. Membuat decision matrix production untuk endpoint backend.

---

## 2. Mental Model Utama: Cache Adalah Kontrak Reuse Representation

HTTP cache bukan sekadar memory map.

HTTP cache adalah mekanisme untuk menjawab pertanyaan:

> “Bolehkah response sebelumnya digunakan kembali untuk request sekarang tanpa bertanya lagi ke origin server?”

Dalam HTTP, yang di-cache biasanya adalah **response representation** untuk sebuah request tertentu.

Secara sederhana:

```text
Request:
GET /cases/CASE-123 HTTP/1.1
Accept: application/json
Authorization: Bearer ...

Response:
200 OK
Content-Type: application/json
Cache-Control: private, max-age=30
ETag: "case-123-v17"

{ ... representation ... }
```

Cache harus memutuskan:

1. Apakah response ini boleh disimpan?
2. Apakah response ini boleh digunakan untuk request lain?
3. Apakah response ini masih fresh?
4. Kalau sudah stale, apakah harus revalidate?
5. Kalau revalidation sukses dan tidak berubah, apakah cukup return `304 Not Modified`?
6. Kalau origin down, apakah stale response boleh tetap digunakan?

Backend menentukan jawaban awalnya melalui headers.

---

## 3. Kenapa Backend Engineer Harus Peduli?

Karena cache policy yang salah bisa menyebabkan:

1. **Data leak**  
   Response user A tersimpan di shared cache dan dikirim ke user B.

2. **Stale decision**  
   UI/API consumer membuat keputusan berdasarkan status lama.

3. **Authorization bypass**  
   Resource yang sebelumnya accessible tetap disajikan dari cache setelah permission dicabut.

4. **Broken audit trail**  
   Client melihat state yang tidak sesuai dengan state saat action dilakukan.

5. **Incident diagnosis sulit**  
   Log origin tidak menunjukkan traffic karena response dijawab CDN/cache.

6. **Cache poisoning**  
   Attacker memengaruhi response yang disimpan cache untuk victim.

7. **Cache stampede**  
   Banyak request stale bersamaan menghantam origin.

8. **Overload disguised as optimization**  
   Cache hit ratio rendah karena key salah atau `Vary` tidak tepat.

9. **Semantics inconsistent**  
   Backend mengirim `max-age=3600` untuk data mutable yang berubah tiap detik.

Top engineer tidak hanya bertanya:

```text
Can this be cached?
```

Mereka bertanya:

```text
By whom?
For whom?
For how long?
Under which request dimensions?
With what revalidation rule?
With what stale tolerance?
With what security consequence?
With what observability signal?
```

---

## 4. HTTP Cache Layer Dalam Arsitektur Production

Satu request bisa melewati banyak cache:

```text
Client Application
   |
   | browser/app cache
   v
Corporate Proxy / ISP Proxy / Browser Shared Stack
   |
   v
CDN / Edge Cache
   |
   v
API Gateway / Reverse Proxy Cache
   |
   v
Service Mesh / Sidecar
   |
   v
Backend Application
   |
   | application-level cache
   v
Database / Search / Object Storage
```

Tidak semua layer selalu ada, tetapi backend harus menyadari bahwa response header dapat dibaca oleh lebih dari satu aktor.

### 4.1 Browser Cache

Browser cache biasanya berada dekat user.

Cocok untuk:

1. Static assets.
2. Public resource.
3. Private user-specific response yang aman disimpan di device user.
4. Short-lived API response yang tidak sensitive.

Risiko:

1. Shared device.
2. Back button showing sensitive page.
3. Logout tidak otomatis menghapus semua cached response.
4. Browser behavior bisa berbeda pada reload/history navigation.

### 4.2 Shared Cache

Shared cache melayani banyak user.

Contoh:

1. CDN.
2. Reverse proxy cache.
3. Corporate proxy.
4. Gateway cache.

Shared cache sangat berbahaya untuk authenticated user-specific response jika policy salah.

Rule of thumb:

```text
Kalau response mengandung data user-specific/tenant-specific/sensitive,
jangan biarkan shared cache menyimpannya kecuali kamu benar-benar punya keying dan policy yang ketat.
```

### 4.3 CDN Cache

CDN cache bagus untuk:

1. Static files.
2. Public catalog.
3. Public reference data.
4. Public documentation.
5. Public read-heavy API.
6. Download file publik.

Tetapi CDN juga memperkenalkan:

1. Cache key configuration.
2. Header/query normalization.
3. Purge/invalidation API.
4. Edge-generated status code.
5. Stale serving behavior.
6. Debugging complexity.

### 4.4 Application Cache

Application cache seperti Caffeine, Redis, Hazelcast, atau local in-memory cache berbeda dari HTTP cache.

HTTP cache menyimpan **HTTP response representation**.

Application cache biasanya menyimpan:

1. Domain object.
2. Query result.
3. Authorization decision.
4. External API response.
5. Computed view model.

Perbedaan penting:

| Aspek | HTTP Cache | Application Cache |
|---|---|---|
| Unit | HTTP response representation | Object/query/computation |
| Controlled by | HTTP headers + cache config | Application code |
| Aware of status/header | Ya | Biasanya tidak |
| Aware of user identity | Hanya jika key/config benar | Tergantung implementation |
| Revalidation | Native via conditional request | Manual |
| Useful for client/proxy/CDN | Ya | Tidak langsung |

Keduanya bisa dipakai bersama, tetapi jangan mencampur mental modelnya.

---

## 5. Istilah Dasar HTTP Caching

### 5.1 Cacheable

Sebuah response cacheable jika secara semantics dan policy boleh disimpan untuk reuse.

Tidak semua response sukses otomatis cacheable, dan tidak semua cacheable response aman di-cache oleh semua jenis cache.

### 5.2 Fresh

Fresh berarti cache boleh menggunakan response tanpa revalidation ke origin.

Contoh:

```http
Cache-Control: max-age=60
```

Selama 60 detik sejak response time, cache dapat menganggap response fresh.

### 5.3 Stale

Stale berarti umur cached response melewati freshness lifetime.

Response stale tidak selalu unusable. Cache bisa:

1. Revalidate ke origin.
2. Serve stale jika policy mengizinkan.
3. Reject/forward request.

### 5.4 Revalidation

Revalidation adalah proses cache bertanya ke origin:

```text
“Representation yang saya punya masih valid tidak?”
```

Biasanya menggunakan:

```http
If-None-Match: "abc"
```

atau:

```http
If-Modified-Since: Wed, 18 Jun 2026 10:00:00 GMT
```

Jika belum berubah, origin dapat menjawab:

```http
304 Not Modified
```

Tanpa body.

### 5.5 Validator

Validator adalah metadata untuk membandingkan apakah representation berubah.

Validator umum:

1. `ETag`
2. `Last-Modified`

### 5.6 Cache Key

Cache key adalah identitas entry cache.

Secara konseptual:

```text
method + target URI + selected request headers based on Vary + cache-specific dimensions
```

Kalau cache key tidak memasukkan dimensi yang memengaruhi response, data bisa salah atau bocor.

### 5.7 Freshness Lifetime

Freshness lifetime adalah periode response dianggap fresh.

Bisa ditentukan oleh:

1. `Cache-Control: max-age=...`
2. `Cache-Control: s-maxage=...`
3. `Expires`
4. Heuristic caching oleh cache tertentu jika header tidak eksplisit.

Backend production sebaiknya eksplisit.

---

## 6. Response Cacheability Berdasarkan Method dan Status

HTTP caching paling umum untuk `GET` dan `HEAD`.

`POST` secara spesifikasi bisa memiliki cache semantics tertentu jika response mengizinkan, tetapi dalam API backend production, caching `POST` jarang dipakai karena lebih mudah salah dan tooling/cache support bervariasi.

Practical baseline:

| Method | Default backend caching advice |
|---|---|
| GET | Candidate utama untuk caching |
| HEAD | Sejalan dengan GET metadata |
| POST | Jangan cache kecuali sangat sadar desainnya |
| PUT | Umumnya tidak cache response; invalidates related cached GET secara domain/config |
| PATCH | Umumnya tidak cache response; invalidates related cached GET |
| DELETE | Umumnya tidak cache response; invalidates related cached GET |
| OPTIONS | Bisa cache short-lived untuk capability/preflight, tetapi hati-hati |

Status code yang sering terkait cache:

| Status | Caching consideration |
|---|---|
| 200 OK | Candidate utama |
| 203 Non-Authoritative Information | Bisa cache sesuai policy |
| 204 No Content | Bisa cache secara semantics tertentu, tetapi jarang untuk API mutable |
| 301 Moved Permanently | Sering cacheable; hati-hati migration |
| 302 Found | Cacheable hanya dengan explicit freshness dalam praktik modern |
| 304 Not Modified | Revalidation result, bukan representation baru penuh |
| 404 Not Found | Bisa cache, tetapi hati-hati eventual creation |
| 410 Gone | Bisa cache untuk tombstone |
| 429 Too Many Requests | Bisa diberi `Retry-After`, biasanya bukan cacheable response biasa |
| 500 | Jangan cache secara umum |
| 502/503/504 | Bisa dipadukan dengan stale-if-error dari cached success, bukan menyimpan error sembarangan |

---

## 7. Header Utama HTTP Caching

### 7.1 `Cache-Control`

`Cache-Control` adalah header utama untuk instruksi caching.

Contoh:

```http
Cache-Control: public, max-age=300
```

Atau:

```http
Cache-Control: private, no-cache
```

Atau:

```http
Cache-Control: no-store
```

Mari bedah directive penting.

---

## 8. `public`

```http
Cache-Control: public, max-age=300
```

Artinya response boleh disimpan oleh cache manapun, termasuk shared cache.

Gunakan untuk:

1. Public static asset.
2. Public reference data.
3. Public documentation.
4. Public API response yang sama untuk semua user.

Jangan gunakan jika response bergantung pada:

1. User identity.
2. Tenant.
3. Authorization.
4. Cookie/session.
5. Personalized fields.
6. Permission-filtered data.

Contoh aman:

```http
GET /api/reference/countries
Cache-Control: public, max-age=86400
```

Contoh berbahaya:

```http
GET /api/me
Cache-Control: public, max-age=300
```

Itu bisa membuat profil user tersimpan di shared cache.

---

## 9. `private`

```http
Cache-Control: private, max-age=60
```

Artinya response hanya boleh disimpan oleh private cache, misalnya browser cache user, bukan shared cache.

Gunakan untuk:

1. User-specific response yang boleh disimpan di device user.
2. Dashboard ringan.
3. Preferences.
4. Non-sensitive personalized response.

Tetap hati-hati untuk:

1. Data sangat sensitive.
2. Shared workstation.
3. Regulatory/legal data.
4. Session after logout.

Untuk data highly sensitive, lebih aman gunakan `no-store`.

---

## 10. `no-store`

```http
Cache-Control: no-store
```

Artinya cache tidak boleh menyimpan request/response.

Gunakan untuk:

1. Token response.
2. Login response.
3. Password reset.
4. Highly sensitive personal/regulatory data.
5. Export berisi data confidential.
6. Payment instrument detail.
7. Medical/legal/financial confidential data.
8. Admin action result yang tidak boleh tersimpan.

Contoh:

```http
HTTP/1.1 200 OK
Cache-Control: no-store
Pragma: no-cache
Content-Type: application/json

{ "access_token": "..." }
```

Catatan:

`Pragma: no-cache` adalah backward compatibility untuk HTTP/1.0 style clients/proxies. Untuk sistem modern, `Cache-Control` tetap utama.

### 10.1 `no-store` vs `no-cache`

Ini sering disalahpahami.

| Directive | Makna praktis |
|---|---|
| `no-store` | Jangan simpan sama sekali |
| `no-cache` | Boleh simpan, tetapi harus revalidate sebelum reuse |

Jadi `no-cache` bukan berarti “tidak boleh cache”.

Untuk sensitive data, gunakan `no-store`, bukan hanya `no-cache`.

---

## 11. `no-cache`

```http
Cache-Control: no-cache
ETag: "case-123-v17"
```

Artinya cache boleh menyimpan response, tetapi tidak boleh menggunakan kembali tanpa revalidation ke origin.

Cocok untuk:

1. Resource yang boleh disimpan tapi harus selalu dicek freshness.
2. Data mutable yang ingin menghemat bandwidth via `304`.
3. Response besar yang sering tidak berubah tetapi harus akurat.

Contoh:

```http
GET /api/cases/CASE-123
Cache-Control: private, no-cache
ETag: "case-123-v17"
```

Browser boleh menyimpan body, tetapi setiap reuse harus mengirim conditional request.

Jika belum berubah, origin menjawab:

```http
304 Not Modified
ETag: "case-123-v17"
Cache-Control: private, no-cache
```

Ini menghemat bandwidth tetapi tidak sepenuhnya menghilangkan round trip.

---

## 12. `max-age`

```http
Cache-Control: max-age=300
```

Artinya response fresh selama 300 detik untuk semua cache yang boleh menyimpan response tersebut.

Jika dipadukan dengan `private`:

```http
Cache-Control: private, max-age=60
```

Maka hanya private cache boleh reuse selama 60 detik.

Jika dipadukan dengan `public`:

```http
Cache-Control: public, max-age=3600
```

Maka shared cache juga boleh reuse selama 1 jam.

### 12.1 Memilih `max-age`

Jangan pilih berdasarkan angka cantik. Pilih berdasarkan domain tolerance.

Pertanyaan desain:

1. Seberapa sering data berubah?
2. Apa risiko client melihat data lama?
3. Apakah data digunakan untuk keputusan bisnis/legal?
4. Apakah user bisa melakukan action berbahaya berdasarkan stale data?
5. Apakah ada validator untuk revalidation?
6. Apakah invalidation event tersedia?
7. Apakah cache layer bisa dipurge?
8. Apakah data personalized?

Contoh:

| Resource | Suggested policy |
|---|---|
| Versioned static asset `/app.abc123.js` | `public, max-age=31536000, immutable` |
| Public country list | `public, max-age=86400, stale-while-revalidate=3600` |
| User profile summary | `private, max-age=60` atau `private, no-cache` |
| Case status for active investigation | `private, no-cache` atau `no-store` tergantung sensitivity |
| Access token response | `no-store` |
| Search result with authorization filtering | biasanya `private, no-cache` atau `no-store` |
| Public report PDF | `public, max-age=3600` jika truly public |

---

## 13. `s-maxage`

```http
Cache-Control: public, max-age=60, s-maxage=600
```

`s-maxage` berlaku untuk shared cache dan mengoverride `max-age` di shared cache.

Artinya:

1. Browser/private cache fresh selama 60 detik.
2. CDN/shared cache fresh selama 600 detik.

Gunakan saat kamu ingin shared cache punya policy berbeda dari browser cache.

Contoh:

```http
Cache-Control: public, max-age=30, s-maxage=300
```

Ini bisa berguna untuk public API dengan CDN.

Hati-hati: jangan gunakan `s-maxage` untuk response personalized kecuali cache key benar-benar memisahkan identity/tenant, dan itu jarang direkomendasikan untuk API sensitif.

---

## 14. `must-revalidate`

```http
Cache-Control: max-age=60, must-revalidate
```

Setelah stale, cache harus revalidate sebelum reuse. Cache tidak boleh sembarang serve stale saat disconnected kecuali ada directive lain yang relevan.

Cocok untuk:

1. Data yang boleh fresh sebentar.
2. Setelah stale, harus akurat.
3. Domain dengan stale tolerance rendah.

Contoh:

```http
Cache-Control: private, max-age=30, must-revalidate
```

---

## 15. `proxy-revalidate`

```http
Cache-Control: public, max-age=300, proxy-revalidate
```

Mirip `must-revalidate`, tetapi hanya untuk shared cache.

Jarang lebih penting daripada `must-revalidate` dalam desain API modern, tetapi kamu mungkin melihatnya di konfigurasi lama.

---

## 16. `immutable`

```http
Cache-Control: public, max-age=31536000, immutable
```

`immutable` memberi sinyal bahwa response tidak berubah selama freshness lifetime.

Cocok untuk versioned/fingerprinted static asset:

```text
/app.8f3a9c1.js
/logo.2026-06-18.svg
```

Jangan gunakan untuk URI yang isinya bisa berubah:

```text
/app.js
/api/config
/api/cases/CASE-123
```

Rule:

```text
Immutable aman jika URI berubah saat content berubah.
```

---

## 17. `stale-while-revalidate`

```http
Cache-Control: public, max-age=60, stale-while-revalidate=300
```

Artinya cache boleh menyajikan response stale selama 300 detik sambil melakukan revalidation di background.

Cocok untuk:

1. Public data yang tidak critical.
2. Reference data.
3. Read-heavy endpoint.
4. Landing/public content.
5. Dashboard non-critical.

Risiko:

1. User melihat data lama.
2. Backend menerima revalidation burst jika banyak stale bersamaan.
3. Tidak cocok untuk keputusan legal/financial real-time.

Contoh aman:

```http
GET /api/public/statistics/summary
Cache-Control: public, max-age=60, stale-while-revalidate=300
```

Contoh berisiko:

```http
GET /api/cases/CASE-123/current-assignee
Cache-Control: public, max-age=60, stale-while-revalidate=300
```

Jika assignment menentukan authorization/action, stale response bisa salah.

---

## 18. `stale-if-error`

```http
Cache-Control: public, max-age=60, stale-if-error=86400
```

Artinya jika origin error, cache boleh menyajikan stale response sampai 86400 detik.

Cocok untuk:

1. Public content.
2. Static-ish reference data.
3. Read-only public pages.
4. Graceful degradation.

Tidak cocok untuk:

1. Security-sensitive authorization state.
2. Account balance.
3. Enforcement decision state.
4. Data yang harus legally current.

Pertanyaan penting:

```text
Lebih buruk origin error atau data stale?
```

Untuk public country list, stale lebih baik.
Untuk legal case status, error mungkin lebih jujur daripada stale.

---

## 19. `Expires`

```http
Expires: Thu, 18 Jun 2026 10:00:00 GMT
```

`Expires` adalah mekanisme lama untuk freshness berdasarkan absolute time.

Dalam API modern, lebih baik gunakan `Cache-Control: max-age=...` karena relative terhadap response time dan lebih eksplisit.

Jika keduanya ada, `Cache-Control` biasanya menjadi kontrol utama untuk cache modern.

Gunakan `Expires` hanya untuk compatibility jika diperlukan.

---

## 20. `Age`

```http
Age: 42
```

`Age` biasanya ditambahkan cache untuk menunjukkan berapa detik response telah berada di cache sejak origin generation/revalidation.

Backend origin biasanya tidak perlu mengirim `Age`.

Namun saat debugging, `Age` penting untuk mengetahui apakah response berasal dari cache dan seberapa lama.

---

## 21. `Vary`: Header Kecil, Dampak Besar

`Vary` memberi tahu cache bahwa response bervariasi berdasarkan request header tertentu.

Contoh:

```http
Vary: Accept-Encoding
```

Artinya response gzip dan br mungkin berbeda.

Contoh content negotiation:

```http
Vary: Accept
```

Artinya response JSON dan CSV/PDF mungkin berbeda.

Contoh localization:

```http
Vary: Accept-Language
```

Artinya bahasa response berbeda.

### 21.1 `Vary: Authorization`

Untuk authenticated response, sebagian sistem menggunakan:

```http
Vary: Authorization
```

Ini memberi tahu cache bahwa response bergantung pada `Authorization` header.

Namun ini bukan magic security shield.

Masalah:

1. Banyak shared cache tidak menyimpan authenticated response kecuali explicitly allowed.
2. Jika cache dikonfigurasi override, keying harus benar.
3. Authorization token sebagai cache key bisa menimbulkan cardinality tinggi.
4. Permission bisa berubah meskipun token sama.
5. Tenant/user separation harus eksplisit.

Untuk sensitive authenticated API, biasanya lebih aman:

```http
Cache-Control: no-store
```

atau:

```http
Cache-Control: private, no-cache
```

### 21.2 `Vary: Origin`

Untuk CORS response dinamis:

```http
Access-Control-Allow-Origin: https://app.example.com
Vary: Origin
```

Jika server mengembalikan `Access-Control-Allow-Origin` berdasarkan request `Origin`, maka `Vary: Origin` penting agar shared cache tidak menyajikan CORS header origin A ke origin B.

### 21.3 Overusing `Vary`

`Vary` memperbesar cache key cardinality.

Contoh buruk:

```http
Vary: User-Agent
```

Ini bisa menghancurkan cache hit ratio karena variasi `User-Agent` sangat banyak.

Gunakan hanya header yang benar-benar memengaruhi representation.

---

## 22. `ETag` Untuk Revalidation

`ETag` adalah validator kuat/lemah untuk representation.

Contoh:

```http
ETag: "case-123-v17-json"
Cache-Control: private, no-cache
```

Client/cache dapat revalidate:

```http
GET /api/cases/CASE-123
If-None-Match: "case-123-v17-json"
```

Jika tidak berubah:

```http
304 Not Modified
ETag: "case-123-v17-json"
Cache-Control: private, no-cache
```

### 22.1 Strong vs Weak ETag

Strong ETag:

```http
ETag: "abc123"
```

Weak ETag:

```http
ETag: W/"abc123"
```

Strong validator menyiratkan equality yang lebih ketat terhadap representation bytes/semantics sesuai kebutuhan protocol. Weak validator cocok untuk semantic equivalence yang tidak byte-identical.

Backend practical rule:

1. Gunakan strong ETag untuk exact representation stability.
2. Gunakan weak ETag jika generated output bisa berbeda secara minor tetapi dianggap semantically sama.
3. Jangan gunakan ETag domain version yang sama untuk JSON dan PDF jika representation berbeda dan cache key tidak membedakan dengan benar.

### 22.2 ETag Harus Representation-Aware

Resource version saja kadang tidak cukup.

Misalnya:

```text
/cases/CASE-123
Accept: application/json
Accept-Language: en
```

vs:

```text
/cases/CASE-123
Accept: application/json
Accept-Language: id
```

Jika representation berbeda, ETag idealnya mempertimbangkan:

1. Resource version.
2. Representation media type.
3. Language.
4. Projection/view.
5. Authorization-dependent fields.

Contoh:

```text
"case-123-v17-json-en-view-basic"
```

Jangan bocorkan terlalu banyak internal structure dalam ETag jika itu sensitive. Bisa hash canonical input.

---

## 23. `Last-Modified`

```http
Last-Modified: Thu, 18 Jun 2026 09:30:00 GMT
```

Client/cache dapat revalidate dengan:

```http
If-Modified-Since: Thu, 18 Jun 2026 09:30:00 GMT
```

Jika tidak berubah:

```http
304 Not Modified
```

Kelemahan:

1. Precision sering detik, bukan sub-second.
2. Banyak perubahan dalam satu detik bisa terlewat.
3. Clock issues.
4. Tidak selalu cocok untuk representation yang berubah karena authorization/projection, bukan hanya resource updated time.

Rule:

```text
Gunakan ETag untuk validator utama jika memungkinkan.
Last-Modified boleh menjadi tambahan.
```

---

## 24. `304 Not Modified`: Response Tanpa Body, Tetapi Bukan Tanpa Kontrak

`304` dipakai untuk conditional GET/HEAD ketika cached representation masih valid.

Contoh flow:

```http
GET /api/reference/countries
If-None-Match: "countries-v42"
```

Response:

```http
304 Not Modified
ETag: "countries-v42"
Cache-Control: public, max-age=86400
```

Backend harus tetap mengirim metadata relevan agar cache dapat update stored response metadata.

Jangan kirim body pada `304`.

### 24.1 304 Bukan “Success Body Kosong”

`304` bukan `204`.

`304` berarti:

```text
Gunakan representation yang sudah kamu punya.
```

Kalau client tidak punya cached representation, `304` tidak berguna.

---

## 25. Caching dan Authenticated Responses

Ini bagian paling rawan.

### 25.1 Baseline Aman

Untuk token/session/login/password/security-sensitive endpoint:

```http
Cache-Control: no-store
```

Untuk user-specific tapi tidak terlalu sensitive:

```http
Cache-Control: private, max-age=60
```

atau:

```http
Cache-Control: private, no-cache
ETag: "..."
```

Untuk permission-filtered resource:

```http
Cache-Control: private, no-cache
Vary: Authorization
```

Namun jika data highly sensitive:

```http
Cache-Control: no-store
```

### 25.2 Authorization Bisa Berubah

Misalnya user punya akses ke case hari ini, lalu akses dicabut.

Jika browser menyimpan:

```http
Cache-Control: private, max-age=3600
```

User masih bisa melihat cached data selama satu jam di device-nya.

Apakah itu acceptable?

Jawaban bergantung domain.

Untuk regulatory enforcement system, sering kali tidak acceptable untuk data sensitif.

Gunakan:

```http
Cache-Control: no-store
```

atau:

```http
Cache-Control: private, no-cache
```

Dengan revalidation yang mengecek authorization terbaru.

### 25.3 Shared Cache dan Authorization

Shared cache biasanya harus sangat konservatif terhadap request dengan `Authorization`.

Namun CDN/gateway bisa dikonfigurasi untuk cache authenticated response dengan custom key.

Itu advanced dan risk tinggi.

Jika dilakukan, cache key harus mencakup dimensi seperti:

1. Tenant.
2. User/group/role or entitlement version.
3. Resource ID.
4. Representation variant.
5. Authorization policy version.

Dalam banyak enterprise/regulatory backend, lebih baik jangan shared-cache user-specific response.

---

## 26. Caching Error Responses

Error response juga bisa di-cache dalam kondisi tertentu, tetapi harus hati-hati.

### 26.1 404

`404 Not Found` bisa di-cache jika resource memang tidak ada.

Tapi dalam sistem yang resource bisa dibuat segera setelahnya, negative caching terlalu lama bisa menyebabkan client tetap melihat not found.

Contoh:

```http
Cache-Control: private, max-age=10
```

Untuk public slug yang jarang berubah:

```http
Cache-Control: public, max-age=60
```

### 26.2 410

`410 Gone` lebih kuat untuk tombstone.

Jika resource benar-benar tidak akan kembali:

```http
Cache-Control: public, max-age=86400
```

atau untuk private domain:

```http
Cache-Control: private, max-age=300
```

### 26.3 401/403

Biasanya jangan cache secara shared.

Untuk authenticated API:

```http
Cache-Control: no-store
```

Atau minimal:

```http
Cache-Control: private, no-cache
```

Kenapa?

Permission bisa berubah. Token bisa di-refresh. Role bisa berubah.

### 26.4 500/502/503/504

Jangan sengaja cache error internal sebagai ordinary response.

Untuk high availability, lebih baik gunakan cached prior success dengan:

```http
stale-if-error
```

daripada menyimpan response error.

---

## 27. Cache Invalidation: Bagian Tersulit

Kalimat klasik:

```text
There are only two hard things in Computer Science: cache invalidation and naming things.
```

Dalam HTTP backend, invalidation bisa dilakukan dengan beberapa pendekatan.

### 27.1 Short TTL

```http
Cache-Control: public, max-age=30
```

Keuntungan:

1. Simple.
2. Tidak butuh purge.
3. Bounded staleness.

Kekurangan:

1. Masih ada stale window.
2. Hit ratio terbatas.
3. Origin tetap kena traffic periodik.

### 27.2 Revalidation

```http
Cache-Control: no-cache
ETag: "..."
```

Keuntungan:

1. Correctness lebih baik.
2. Bandwidth hemat jika unchanged.
3. Cocok untuk mutable data.

Kekurangan:

1. Tetap perlu round trip ke origin.
2. Origin masih perlu mengevaluasi validator.
3. Authorization tetap harus dicek.

### 27.3 Versioned URI

Contoh:

```text
/assets/app.8f3a9c1.js
```

Policy:

```http
Cache-Control: public, max-age=31536000, immutable
```

Keuntungan:

1. Sangat efisien.
2. Invalidation tidak perlu purge.
3. Content berubah => URI berubah.

Cocok untuk static assets, bukan entity mutable seperti case.

### 27.4 Purge/Surrogate Key

CDN sering mendukung purge by URL atau surrogate key.

Contoh logical key:

```http
Surrogate-Key: case-CASE-123 tenant-TENANT-7
```

Lalu saat case berubah, sistem memanggil purge:

```text
purge key case-CASE-123
```

Catatan: `Surrogate-Key` bukan standar HTTP universal; ini pattern CDN/vendor-specific.

Keuntungan:

1. Long TTL + fast invalidation.
2. Cocok untuk public/read-heavy content.

Kekurangan:

1. Vendor-specific.
2. Purge failure harus dimonitor.
3. Race condition update vs purge.
4. Butuh eventing.

### 27.5 Event-Driven Invalidation

Domain event:

```text
CaseUpdated(caseId=CASE-123, version=18)
```

Consumer:

```text
Purge /api/public/cases/CASE-123
Evict app cache key case:CASE-123
Invalidate search projection
```

Risiko:

1. Event delay.
2. Event loss.
3. Out-of-order event.
4. Partial invalidation.
5. Cache layer unavailable.

Gunakan idempotent purge dan retry.

---

## 28. Caching dan Domain Correctness

Caching policy harus mengikuti domain semantics.

### 28.1 Public Reference Data

Contoh:

```text
GET /api/reference/countries
GET /api/reference/violation-types
GET /api/reference/legal-basis
```

Jika jarang berubah:

```http
Cache-Control: public, max-age=86400, stale-while-revalidate=3600
ETag: "reference-countries-v42"
```

Jika harus update cepat saat ada perubahan regulasi:

```http
Cache-Control: public, max-age=300, must-revalidate
ETag: "legal-basis-v2026-06-18"
```

### 28.2 User Dashboard

```text
GET /api/me/dashboard
```

Mungkin:

```http
Cache-Control: private, max-age=30
ETag: "user-123-dashboard-v91"
```

Tetapi jika dashboard berisi confidential assignments:

```http
Cache-Control: no-store
```

### 28.3 Case Detail

```text
GET /api/cases/CASE-123
```

Dalam regulatory system, sering sensitive.

Safer baseline:

```http
Cache-Control: no-store
```

Jika sistem ingin bandwidth optimization dan data tidak terlalu sensitive:

```http
Cache-Control: private, no-cache
ETag: "case-123-v17-view-investigator"
Vary: Authorization, Accept
```

Revalidation harus tetap mengecek authorization.

### 28.4 Public Case Summary

Jika ada public enforcement publication:

```text
GET /api/public/enforcement-actions/EA-2026-001
```

Bisa:

```http
Cache-Control: public, max-age=3600, stale-while-revalidate=300
ETag: "ea-2026-001-public-v4"
```

Jika publication bisa diretract karena legal issue, TTL harus lebih pendek atau gunakan purge.

### 28.5 Search Results

```text
GET /api/cases?status=OPEN&assignee=me
```

Search result sering:

1. User-specific.
2. Permission-filtered.
3. Highly dynamic.
4. Expensive to compute.

Policy possible:

```http
Cache-Control: private, max-age=15
```

atau:

```http
Cache-Control: no-store
```

Jangan shared-cache tanpa keying yang sangat matang.

---

## 29. Cache Key Design

Cache key salah adalah akar banyak bug.

Default conceptual key:

```text
GET + scheme + host + path + query + selected Vary headers
```

Namun CDN/gateway bisa mengubah:

1. Query parameter inclusion/exclusion.
2. Header inclusion.
3. Cookie inclusion.
4. Path normalization.
5. Case normalization.
6. Trailing slash handling.
7. Default port.
8. Host rewrite.

### 29.1 Query Parameter Problem

Contoh:

```text
GET /api/reports?year=2026&format=pdf
GET /api/reports?format=pdf&year=2026
```

Apakah cache menganggap sama?

Tergantung normalization.

Backend dan CDN harus punya kesepakatan.

### 29.2 Ignored Query Parameter

CDN kadang dikonfigurasi hanya key berdasarkan path.

Berbahaya:

```text
GET /api/cases?tenant=A
GET /api/cases?tenant=B
```

Jika query tidak masuk key, data tenant A bisa dikirim ke tenant B.

### 29.3 Header-Based Variants

Jika response dipengaruhi:

```http
Accept: application/json
Accept-Language: id
```

Response harus mengirim:

```http
Vary: Accept, Accept-Language
```

### 29.4 Cookie-Based Variants

Caching response yang bervariasi berdasarkan `Cookie` bisa membuat hit ratio buruk karena cookie banyak dan berubah-ubah.

Jika response user-specific karena cookie session, biasanya gunakan:

```http
Cache-Control: private
```

atau:

```http
Cache-Control: no-store
```

Bukan shared cache.

---

## 30. Cache Poisoning

Cache poisoning terjadi ketika attacker berhasil membuat cache menyimpan response berbahaya/salah yang kemudian disajikan ke victim.

Simplified flow:

```text
1. Attacker mengirim request dengan input aneh/header tertentu.
2. Origin menghasilkan response yang mencerminkan input tersebut.
3. Cache menyimpan response dengan key yang tidak memasukkan input pembeda itu.
4. Victim meminta URL normal.
5. Cache mengirim poisoned response.
```

### 30.1 Root Cause

1. Unkeyed input memengaruhi response.
2. Header reflection.
3. Query normalization mismatch.
4. Host header trust salah.
5. Cache stores response that should not be cached.
6. `Vary` missing.
7. CDN and origin disagree on request interpretation.

### 30.2 Example

Attacker:

```http
GET /api/public/config HTTP/1.1
Host: api.example.com
X-Forwarded-Host: evil.example
```

Origin salah menggunakan `X-Forwarded-Host` untuk generate absolute URL:

```json
{
  "loginUrl": "https://evil.example/login"
}
```

CDN menyimpan response untuk `/api/public/config` tanpa key berdasarkan `X-Forwarded-Host`.

Victim menerima poisoned config.

### 30.3 Defensive Rules

1. Jangan trust forwarded headers dari public internet.
2. Normalize request di edge.
3. Drop unknown/untrusted headers at gateway.
4. Gunakan allowlist header yang boleh memengaruhi response.
5. Pastikan semua response-varying headers masuk `Vary` atau cache key.
6. Jangan cache response yang dipengaruhi untrusted input tanpa keying jelas.
7. Hindari reflecting arbitrary header/query into cacheable response.
8. Monitor unusual cache hit/miss and status.

---

## 31. Web Cache Deception

Web cache deception berbeda dari poisoning.

Poisoning:

```text
Attacker membuat cache menyimpan response berbahaya untuk victim.
```

Deception:

```text
Attacker menipu cache agar menyimpan private response victim, lalu attacker mengaksesnya.
```

Contoh pola:

```text
https://example.com/account/profile/nonexistent.css
```

Origin routing mungkin menganggap itu `/account/profile` dan mengembalikan private profile.

CDN melihat suffix `.css` lalu menganggap cacheable static asset.

Akibatnya private profile tersimpan di shared cache.

### 31.1 Defensive Rules

1. Jangan cache berdasarkan extension/path pattern secara naif.
2. Private/authenticated routes harus selalu mengirim `Cache-Control: no-store` atau `private`.
3. Static asset harus berada di namespace jelas, misalnya `/assets/...`.
4. Dynamic app routes jangan fallback sembarangan untuk path ber-extension static.
5. Gateway/CDN cache rule harus align dengan app routing.
6. Test path confusion.

---

## 32. Caching Dengan `Authorization`, `Cookie`, dan `Set-Cookie`

### 32.1 Response Dengan `Set-Cookie`

Jika response mengandung:

```http
Set-Cookie: session=...
```

Jangan shared-cache kecuali kamu benar-benar tahu apa yang dilakukan.

Umumnya:

```http
Cache-Control: no-store
```

atau untuk non-sensitive personalized:

```http
Cache-Control: private
```

### 32.2 Response Untuk Request Dengan Cookie

Request dengan cookie sering user-specific.

CDN default behavior bervariasi. Banyak CDN tidak cache request dengan cookie kecuali dikonfigurasi.

Jangan mengandalkan default. Nyatakan policy di backend dan edge.

### 32.3 Authorization Header

Untuk API token:

```http
Authorization: Bearer ...
```

Safer policy:

```http
Cache-Control: no-store
```

atau:

```http
Cache-Control: private, no-cache
```

Kalau public resource tetap membutuhkan token untuk quota/API access, tetapi response sama untuk semua user, kamu bisa mempertimbangkan:

```http
Cache-Control: public, max-age=300
```

Namun gateway/CDN config harus memastikan token tidak masuk response dan cache key tidak menyebabkan leakage.

---

## 33. Caching dan CORS

Jika CORS response bergantung pada `Origin`:

```http
Origin: https://tenant-a.example
```

Response:

```http
Access-Control-Allow-Origin: https://tenant-a.example
Vary: Origin
```

Tanpa `Vary: Origin`, shared cache bisa menyajikan CORS header tenant A untuk tenant B.

### 33.1 Preflight Cache

Browser dapat cache preflight result via:

```http
Access-Control-Max-Age: 600
```

Itu bukan sama dengan HTTP cache response biasa, tetapi tetap memengaruhi backend traffic.

Pertimbangan:

1. Jika CORS policy sering berubah, jangan beri max-age terlalu lama.
2. Jika endpoint stabil, max-age membantu mengurangi OPTIONS traffic.
3. Jangan menjadikan CORS sebagai auth mechanism.

---

## 34. Caching dan Content Negotiation

Jika endpoint mendukung beberapa representation:

```text
GET /api/cases/CASE-123
Accept: application/json

GET /api/cases/CASE-123
Accept: application/pdf
```

Maka response harus membedakan:

```http
Vary: Accept
```

Jika tidak, cache bisa mengirim PDF ke client yang meminta JSON, atau sebaliknya.

Jika bahasa berbeda:

```http
Vary: Accept-Language
```

Jika encoding berbeda:

```http
Vary: Accept-Encoding
```

Server/proxy sering otomatis menangani `Accept-Encoding`, tetapi jangan asumsikan untuk semua layer custom.

---

## 35. Caching dan Pagination/Search

Endpoint list/search tricky.

Contoh:

```text
GET /api/public/enforcement-actions?page=1&size=20&sort=publishedAt,desc
```

Jika public dan stable-ish:

```http
Cache-Control: public, max-age=60
ETag: "public-enforcement-actions-page1-v20260618T1000"
```

Namun page 1 berubah saat item baru publish.

Pilihan:

1. TTL pendek.
2. Cursor-based pagination dengan stable cursor.
3. Cache only older pages.
4. Event-driven purge page 1.
5. Separate endpoint untuk recent data.

Untuk user-specific search:

```text
GET /api/cases?assignee=me&status=OPEN
```

Gunakan private/no-store policy.

---

## 36. Caching dan Mutating Requests

Setelah `POST`, `PUT`, `PATCH`, atau `DELETE`, related cached `GET` bisa stale.

HTTP cache tidak selalu tahu domain relationship.

Contoh:

```text
PATCH /api/cases/CASE-123/status
```

Harus mengubah/menyebabkan invalidasi:

```text
GET /api/cases/CASE-123
GET /api/cases?status=OPEN
GET /api/me/tasks
GET /api/dashboard/supervisor
```

Ini bukan otomatis hanya karena method mutating.

Backend/domain event harus membantu invalidation jika shared/app cache dipakai.

### 36.1 Mutation Response Policy

Mutation response sering:

```http
Cache-Control: no-store
```

atau tidak cacheable secara praktis.

Jika mutation returns updated representation, client boleh menggunakannya untuk local state, tetapi shared cache invalidation tetap perlu dipikirkan.

---

## 37. `Location`, `Content-Location`, dan Cache

### 37.1 `Location`

Untuk `201 Created`:

```http
201 Created
Location: /api/cases/CASE-123
```

`Location` menunjukkan URI resource baru.

Bukan caching header utama.

### 37.2 `Content-Location`

`Content-Location` dapat menunjukkan URI representation yang dikirim.

Jarang digunakan dalam API sehari-hari, tetapi penting secara semantics.

Jangan gunakan sembarangan jika tidak memahami cache implication.

---

## 38. Backend-Generated Cache Policy: Design Matrix

Gunakan matrix berikut saat mendesain endpoint.

| Endpoint type | Example | Suggested policy |
|---|---|---|
| Token/login/password | `/oauth/token`, `/login` | `no-store` |
| Highly sensitive case data | `/api/cases/{id}` | `no-store` atau `private, no-cache` |
| User-specific non-sensitive | `/api/me/preferences` | `private, max-age=60` atau `private, no-cache` |
| Public reference data | `/api/reference/countries` | `public, max-age=86400, stale-while-revalidate=3600` |
| Public mutable publication | `/api/public/enforcement-actions/{id}` | `public, max-age=300/3600`, ETag, purge if needed |
| Versioned static asset | `/assets/app.hash.js` | `public, max-age=31536000, immutable` |
| Search/list public newest | `/api/public/news?page=1` | `public, max-age=30/60`, ETag |
| Search/list private | `/api/cases?...` | `private, no-cache` or `no-store` |
| File export private | `/api/exports/{id}/download` | `no-store`, or short private if acceptable |
| Public downloadable file | `/files/public/report.pdf` | `public, max-age=3600`, ETag, Range support |
| 404 for public static missing | `/assets/missing.js` | short public negative cache |
| 410 tombstone public | `/api/public/old/{id}` | public longer TTL if permanent |

---

## 39. Java/Spring MVC Implementation Patterns

### 39.1 Setting Cache-Control With `ResponseEntity`

```java
@GetMapping("/api/reference/countries")
public ResponseEntity<List<CountryDto>> countries() {
    List<CountryDto> body = referenceService.getCountries();

    return ResponseEntity.ok()
        .cacheControl(CacheControl.maxAge(Duration.ofDays(1)).cachePublic())
        .eTag("\"countries-v42\"")
        .body(body);
}
```

Notes:

1. ETag value must be quoted in HTTP format.
2. Version should change when representation changes.
3. If representation varies by language/media type, account for that.

### 39.2 Private No-Cache With ETag

```java
@GetMapping("/api/cases/{caseId}")
public ResponseEntity<CaseDto> getCase(
    @PathVariable String caseId,
    @RequestHeader(value = "If-None-Match", required = false) String ifNoneMatch,
    Authentication authentication
) {
    CaseView view = caseService.getAuthorizedView(caseId, authentication);
    String etag = "\"case-" + caseId + "-v" + view.version() + "-" + view.viewName() + "\"";

    if (etag.equals(ifNoneMatch)) {
        return ResponseEntity.status(HttpStatus.NOT_MODIFIED)
            .cacheControl(CacheControl.noCache().cachePrivate())
            .eTag(etag)
            .build();
    }

    return ResponseEntity.ok()
        .cacheControl(CacheControl.noCache().cachePrivate())
        .eTag(etag)
        .body(view.dto());
}
```

Important:

Authorization is checked before returning `304`. A `304` is still a decision to allow reuse of cached representation.

### 39.3 Sensitive Endpoint

```java
@GetMapping("/api/cases/{caseId}/evidence/{evidenceId}")
public ResponseEntity<Resource> downloadEvidence(
    @PathVariable String caseId,
    @PathVariable String evidenceId,
    Authentication authentication
) {
    EvidenceDownload file = evidenceService.authorizedDownload(caseId, evidenceId, authentication);

    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .header(HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment()
                .filename(file.safeFilename(), StandardCharsets.UTF_8)
                .build()
                .toString())
        .contentType(file.mediaType())
        .contentLength(file.size())
        .body(file.resource());
}
```

### 39.4 `ShallowEtagHeaderFilter`

Spring menyediakan `ShallowEtagHeaderFilter` yang menghasilkan ETag berdasarkan response content.

Kelebihan:

1. Mudah dipasang.
2. Bisa menghemat bandwidth dengan `304`.

Keterbatasan penting:

1. Response tetap dirender untuk menghitung ETag.
2. Tidak menghemat biaya server rendering/query.
3. Kurang cocok untuk streaming/large response.
4. Tidak menggantikan domain-aware versioning.
5. Bisa berisiko jika representation user-specific tidak dipahami.

Untuk API production, domain-aware ETag sering lebih baik:

```text
ETag = hash(resourceVersion + representationVariant + authorizationViewVersion)
```

Bukan hash body setelah seluruh proses mahal selesai.

### 39.5 Spring MVC `WebRequest.checkNotModified`

Spring MVC menyediakan helper:

```java
@GetMapping("/api/reference/countries")
public ResponseEntity<?> countries(WebRequest request) {
    String etag = "\"countries-v42\"";

    if (request.checkNotModified(etag)) {
        return null; // Spring handles 304 in some controller styles
    }

    return ResponseEntity.ok()
        .eTag(etag)
        .cacheControl(CacheControl.maxAge(Duration.ofDays(1)).cachePublic())
        .body(referenceService.getCountries());
}
```

Dalam codebase besar, banyak tim lebih suka explicit `ResponseEntity` agar behavior lebih jelas dan testable.

---

## 40. WebFlux Implementation Patterns

### 40.1 Basic Cached Public Response

```java
@GetMapping("/api/reference/countries")
public Mono<ResponseEntity<List<CountryDto>>> countries() {
    return referenceService.getCountries()
        .map(countries -> ResponseEntity.ok()
            .cacheControl(CacheControl.maxAge(Duration.ofDays(1)).cachePublic())
            .eTag("\"countries-v42\"")
            .body(countries));
}
```

### 40.2 Conditional Request With Authorization

```java
@GetMapping("/api/cases/{caseId}")
public Mono<ResponseEntity<CaseDto>> getCase(
    @PathVariable String caseId,
    @RequestHeader(value = "If-None-Match", required = false) String ifNoneMatch,
    Principal principal
) {
    return caseService.getAuthorizedView(caseId, principal)
        .map(view -> {
            String etag = "\"case-" + caseId + "-v" + view.version() + "-" + view.viewName() + "\"";

            if (etag.equals(ifNoneMatch)) {
                return ResponseEntity.status(HttpStatus.NOT_MODIFIED)
                    .cacheControl(CacheControl.noCache().cachePrivate())
                    .eTag(etag)
                    .build();
            }

            return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache().cachePrivate())
                .eTag(etag)
                .body(view.dto());
        });
}
```

### 40.3 Reactive Caveat

Avoid computing expensive response body before checking cheap validators if you can.

Good:

```text
load metadata/version -> compare ETag -> return 304 or load full body
```

Bad:

```text
load full body -> serialize -> hash -> discover client already had it
```

---

## 41. Domain-Aware ETag Design

A robust ETag for backend API should answer:

```text
Does the representation this client is allowed to see differ from what it already has?
```

Possible ingredients:

1. Entity version.
2. Projection name.
3. Media type.
4. Language.
5. Tenant id.
6. Authorization view version.
7. Related aggregate version if representation embeds related data.
8. Redaction policy version.
9. Serialization schema version.

Example:

```text
raw = tenantId + ":" + caseId + ":" + caseVersion + ":" + viewType + ":" + schemaVersion
etag = base64url(sha256(raw))
```

Do not include raw sensitive identifiers if ETag is visible and can leak internal data. Hash if needed.

### 41.1 ETag and Embedded Data

If `/api/cases/{id}` embeds comments count, assignee name, or latest activity, case version alone may not change when embedded data changes.

Options:

1. Do not embed volatile data.
2. Include embedded component versions in ETag.
3. Use weak ETag for approximate semantic stability.
4. Use `no-cache` with server-side validation that checks all relevant versions.

---

## 42. Caching and Optimistic Concurrency Together

Same `ETag` concept can serve two related use cases:

1. `If-None-Match` for cache revalidation.
2. `If-Match` for preventing lost update.

Example read:

```http
GET /api/cases/CASE-123

200 OK
ETag: "case-123-v17"
```

Example update:

```http
PATCH /api/cases/CASE-123
If-Match: "case-123-v17"
```

If current version is still 17, update proceeds.

If current version is 18:

```http
412 Precondition Failed
```

Caution:

Representation ETag and update concurrency token are not always identical.

If representation includes fields not relevant for update concurrency, or if authorization redaction affects representation, you may use separate tokens:

1. HTTP ETag for representation cache.
2. Domain version/concurrency token for mutation.

But using one carefully designed strong validator can simplify client behavior.

---

## 43. Caching and Observability

If caching works, origin receives fewer requests. That is good, but it can blind backend monitoring.

You need observability at multiple layers.

### 43.1 Useful Headers

Common non-standard but useful headers:

```http
X-Cache: HIT
X-Cache: MISS
X-Cache: STALE
Cache-Status: cdn; hit; ttl=42
```

`Cache-Status` is a standardized response header field from RFC 9211, but support varies by product.

### 43.2 Metrics

Track:

1. Cache hit ratio.
2. Cache miss ratio.
3. Stale hit ratio.
4. Revalidation count.
5. `304` rate.
6. Origin request rate.
7. Purge success/failure.
8. Cache key cardinality.
9. Response age distribution.
10. Response size saved.
11. Top cache-busting query/header patterns.
12. Authorization-sensitive endpoint cached count should be zero unless intentionally designed.

### 43.3 Logs

At origin, log:

1. Request method/path/status.
2. `If-None-Match` presence.
3. `If-Modified-Since` presence.
4. ETag generated.
5. Cache policy selected.
6. Whether response was 304.
7. User/tenant dimensions carefully redacted/controlled.

At CDN/gateway, log:

1. Cache hit/miss/stale.
2. Cache key if safe or key hash.
3. Origin status.
4. TTL remaining.
5. Vary dimensions.
6. Purge event correlation.

---

## 44. Testing HTTP Cache Behavior

### 44.1 Manual With curl

First request:

```bash
curl -i https://api.example.com/api/reference/countries
```

Capture ETag:

```http
ETag: "countries-v42"
```

Revalidate:

```bash
curl -i \
  -H 'If-None-Match: "countries-v42"' \
  https://api.example.com/api/reference/countries
```

Expected:

```http
304 Not Modified
```

### 44.2 Test Private Data Not Shared

Send request as user A and user B through CDN/gateway test environment.

Verify:

1. User B never receives user A body.
2. `Cache-Control` is `private` or `no-store`.
3. CDN does not store response.
4. Cache key includes required dimensions if intentionally cached.

### 44.3 Test `Vary`

```bash
curl -i -H 'Accept: application/json' https://api.example.com/resource
curl -i -H 'Accept: application/pdf' https://api.example.com/resource
```

Verify:

```http
Vary: Accept
```

And cache does not confuse variants.

### 44.4 Test CORS Dynamic Origin

```bash
curl -i -H 'Origin: https://tenant-a.example' https://api.example.com/resource
curl -i -H 'Origin: https://tenant-b.example' https://api.example.com/resource
```

Verify:

```http
Vary: Origin
```

### 44.5 Test Cache Deception

Try suspicious suffixes in staging:

```text
/account/profile/test.css
/api/me/avatar/anything.js
/api/cases/CASE-123/fake.png
```

Expected:

1. No private response cached as static.
2. Dynamic private endpoints return `no-store`.
3. CDN cache rules do not cache these paths.

---

## 45. Common Backend Anti-Patterns

### 45.1 `Cache-Control: public` on Authenticated API

```http
Cache-Control: public, max-age=300
```

on:

```text
GET /api/me
```

This is a data leak waiting to happen.

### 45.2 `no-cache` Used for Sensitive Data

```http
Cache-Control: no-cache
```

This allows storage. Use:

```http
Cache-Control: no-store
```

for truly sensitive responses.

### 45.3 Missing `Vary`

Response changes by `Accept-Language`, but no:

```http
Vary: Accept-Language
```

Cache can serve wrong language.

Worse, response changes by `Origin`, but no:

```http
Vary: Origin
```

CORS policy can be confused.

### 45.4 Long TTL on Mutable Data

```http
Cache-Control: public, max-age=86400
```

on data that changes every minute.

This causes stale correctness bugs.

### 45.5 Caching Permission-Filtered Lists Shared

```text
GET /api/cases?status=OPEN
```

If result depends on user permissions, do not shared-cache without a precise key and invalidation model.

### 45.6 ETag Based Only on Entity Version

If representation changes due to language/projection/authorization/schema but ETag ignores those, `304` can be wrong.

### 45.7 Cache Policy Hidden in CDN Only

If origin sends no clear cache headers and CDN has implicit rules, developers/debuggers cannot reason locally.

Prefer origin-declared policy plus explicit CDN override only where necessary.

### 45.8 Cache Stampede Ignored

All cached entries expire at same time, many requests hit origin.

Mitigations:

1. Stagger TTL.
2. Use stale-while-revalidate.
3. Request coalescing.
4. Background refresh.
5. Application cache single-flight.

### 45.9 Logging Full Cached Response Data

Trying to debug cache by logging full body can leak sensitive data.

Log metadata, hashes, version, policy, and correlation id instead.

---

## 46. Decision Framework: Choosing Cache Policy

Ask in order.

### Step 1: Is the method cache-oriented?

Usually only `GET`/`HEAD`.

If mutation:

```text
Do not cache ordinary response unless special semantics are designed.
```

### Step 2: Is response sensitive?

If token, credential, confidential case data, personal data, legal data:

```http
Cache-Control: no-store
```

### Step 3: Is response user-specific?

If yes and not highly sensitive:

```http
Cache-Control: private, max-age=<short>
```

or:

```http
Cache-Control: private, no-cache
ETag: "..."
```

### Step 4: Is response same for everyone?

If yes:

```http
Cache-Control: public, max-age=<domain TTL>
```

Add validators:

```http
ETag: "..."
```

### Step 5: Does representation vary by request headers?

Add `Vary`:

```http
Vary: Accept, Accept-Language, Origin
```

Only for actual dimensions.

### Step 6: Is stale acceptable?

If yes:

```http
stale-while-revalidate=<seconds>
stale-if-error=<seconds>
```

If no:

```http
must-revalidate
```

or use `no-cache`.

### Step 7: Do you have invalidation?

If long TTL and mutable:

1. Need purge.
2. Need event-driven invalidation.
3. Need versioned URI.
4. Need short TTL fallback.

### Step 8: Can you observe it?

Before production rollout, ensure:

1. Cache hit/miss visible.
2. Policy testable.
3. Sensitive endpoint not cached accidentally.
4. Purge failure alerted.

---

## 47. Regulatory Case Management Example

Domain:

1. Cases are confidential.
2. Some publications are public.
3. Reference data is mostly public.
4. Permission can change.
5. Audit and defensibility matter.

### 47.1 Endpoint Policies

#### Login

```text
POST /auth/login
```

Response:

```http
Cache-Control: no-store
```

#### Current User

```text
GET /api/me
```

If contains role/permissions:

```http
Cache-Control: no-store
```

or if minimal and acceptable:

```http
Cache-Control: private, no-cache
ETag: "user-123-permission-v8"
```

#### Case Detail

```text
GET /api/cases/CASE-123
```

Policy:

```http
Cache-Control: no-store
```

Reason:

1. Sensitive.
2. Authorization can change.
3. Data may be legally confidential.
4. Browser/device cache leakage risk.

Alternative for less sensitive internal data:

```http
Cache-Control: private, no-cache
ETag: "case-123-v17-investigator-view"
```

Only if organization accepts device caching.

#### Public Enforcement Action

```text
GET /api/public/enforcement-actions/EA-2026-001
```

Policy:

```http
Cache-Control: public, max-age=600, stale-while-revalidate=60
ETag: "ea-2026-001-public-v4"
```

If legal retraction must propagate quickly, use purge and shorter TTL.

#### Reference Violation Types

```text
GET /api/reference/violation-types
```

Policy:

```http
Cache-Control: public, max-age=86400, stale-while-revalidate=3600
ETag: "violation-types-v2026-06-18"
```

If only authenticated users can access but same for all:

```http
Cache-Control: private, max-age=86400
```

or gateway-managed public cache if no sensitive content and legal allows it.

#### Evidence Download

```text
GET /api/cases/CASE-123/evidence/EVD-9/download
```

Policy:

```http
Cache-Control: no-store
Content-Disposition: attachment; filename="evidence.pdf"
```

Reason:

1. Confidential file.
2. Authorization-sensitive.
3. Often legally sensitive.

---

## 48. Cache Policy Review Checklist

For every endpoint, answer:

1. Is the method normally cacheable?
2. Does response contain personal, tenant, confidential, token, or permission-filtered data?
3. Can shared cache store this response?
4. Can browser/private cache store this response?
5. How long can data be stale without harm?
6. Is stale acceptable during origin error?
7. Does response vary by `Accept`, `Accept-Language`, `Origin`, `Authorization`, cookie, or custom header?
8. Is `Vary` correct and minimal?
9. Is there an `ETag` or `Last-Modified` validator?
10. Is ETag representation-aware?
11. Does revalidation re-check authorization?
12. Do mutation operations invalidate related cached reads?
13. Is CDN/gateway cache key aligned with origin behavior?
14. Are sensitive endpoints protected with `no-store`?
15. Are cache hit/miss/revalidation metrics visible?
16. Are purge failures observable?
17. Have cache poisoning/deception cases been tested?
18. Is policy documented in API contract?

---

## 49. Practical Defaults for Backend Teams

If your team lacks mature cache governance, start conservative.

### 49.1 Safe Defaults

For authenticated sensitive API:

```http
Cache-Control: no-store
```

For authenticated non-sensitive user-specific read:

```http
Cache-Control: private, no-cache
ETag: "..."
```

For public static versioned asset:

```http
Cache-Control: public, max-age=31536000, immutable
```

For public reference API:

```http
Cache-Control: public, max-age=3600
ETag: "..."
```

For public mutable API:

```http
Cache-Control: public, max-age=60
ETag: "..."
```

For dynamic CORS response:

```http
Vary: Origin
```

For negotiated response:

```http
Vary: Accept
```

For localized response:

```http
Vary: Accept-Language
```

### 49.2 Team Governance Rule

No endpoint should reach production with accidental/default cache behavior.

Every route should be classified as one of:

1. `NO_STORE_SENSITIVE`
2. `PRIVATE_REVALIDATED`
3. `PRIVATE_SHORT_TTL`
4. `PUBLIC_SHORT_TTL`
5. `PUBLIC_LONG_TTL_VERSIONED`
6. `PUBLIC_STALE_ALLOWED`
7. `CUSTOM_REVIEW_REQUIRED`

---

## 50. Exercises

### Exercise 1 — Classify Endpoint Cache Policy

Classify each endpoint:

```text
GET /api/me
GET /api/cases/CASE-123
GET /api/reference/countries
GET /api/public/enforcement-actions/EA-001
GET /api/cases?status=OPEN&assignee=me
GET /assets/app.1a2b3c.js
POST /api/cases
GET /api/cases/CASE-123/evidence/EVD-7/download
```

For each, define:

1. `Cache-Control`.
2. `ETag` yes/no.
3. `Vary` yes/no.
4. Shared cache allowed yes/no.
5. Private cache allowed yes/no.
6. Stale allowed yes/no.

### Exercise 2 — Find the Bug

Given:

```http
GET /api/me/dashboard
Authorization: Bearer user-a-token

200 OK
Cache-Control: public, max-age=300
Content-Type: application/json

{ "assignedCases": ["CASE-1", "CASE-2"] }
```

Explain:

1. What is wrong?
2. What could happen in shared cache?
3. What policy is safer?
4. What if dashboard is non-sensitive but personalized?

### Exercise 3 — Design ETag

Design an ETag strategy for:

```text
GET /api/cases/CASE-123?view=summary
Accept-Language: id
Authorization: Bearer ...
```

Representation depends on:

1. Case version.
2. View type.
3. Language.
4. User permission redaction.
5. Schema version.

Define raw ETag ingredients and whether you hash them.

### Exercise 4 — Cache Deception Review

Your CDN caches all paths ending with `.css`, `.js`, `.png`.

Your backend routes:

```text
GET /api/me/{anything}
```

Could this be dangerous?

Analyze:

```text
/api/me/profile.css
```

Define mitigations.

### Exercise 5 — Mutable Public Publication

Endpoint:

```text
GET /api/public/enforcement-actions/{id}
```

Publication is public, read-heavy, but can be retracted by legal team.

Design:

1. Cache-Control.
2. ETag.
3. Purge strategy.
4. Stale-if-error decision.
5. Observability.

---

## 51. Key Takeaways

1. HTTP caching is not just performance; it is a correctness and security contract.
2. `no-store` means do not store; `no-cache` means store but revalidate before reuse.
3. Shared cache is dangerous for user-specific or authorization-sensitive responses.
4. `private` allows browser/private cache but not shared cache.
5. `public` should only be used when response is safe for all users.
6. `max-age` encodes allowed freshness window.
7. `s-maxage` controls shared cache freshness separately.
8. `stale-while-revalidate` and `stale-if-error` are availability tools, but require domain stale tolerance.
9. `Vary` is essential when representation changes based on request headers.
10. ETag must be representation-aware, not blindly entity-version-only.
11. `304` still requires correct authorization logic.
12. Mutations do not automatically invalidate every domain-related cached read.
13. CDN/gateway cache key must align with origin semantics.
14. Cache poisoning and cache deception are real HTTP-layer attack classes.
15. Every production endpoint should have an explicit cache classification.

---

## 52. How This Connects to the Next Part

Part 013 completes the correctness block around:

1. Idempotency.
2. Optimistic concurrency.
3. Caching.

Next, we move to security identity boundary:

```text
Part 014 — Authentication over HTTP
```

That part will cover how backend should interpret and enforce authentication over HTTP using:

1. `Authorization` header.
2. Bearer tokens.
3. Basic auth.
4. Session cookies.
5. mTLS.
6. API keys.
7. JWT validation.
8. Token introspection.
9. 401 and `WWW-Authenticate`.
10. Trust boundaries between gateway, service mesh, and application.

---

## 53. Status Seri

Kamu sudah menyelesaikan:

```text
Part 000 — Orientation: HTTP Backend Mental Model
Part 001 — HTTP Semantics from Server Point of View
Part 002 — Request Lifecycle: From Socket to Controller
Part 003 — Methods Deep Dive for Backend Correctness
Part 004 — Status Codes as Backend State Contracts
Part 005 — Headers as Backend Control Plane
Part 006 — Request Body, Response Body, and Message Framing
Part 007 — URI, Routing, and Resource Modeling
Part 008 — Content Negotiation and Representation Design
Part 009 — Validation, Parsing, and Defensive Boundaries
Part 010 — Error Response Design and Problem Details
Part 011 — Idempotency, Retries, and Exactly-Once Illusions
Part 012 — Conditional Requests and Optimistic Concurrency
Part 013 — Caching for Backend Engineers
```

Seri belum selesai.

Masih lanjut ke:

```text
Part 014 — Authentication over HTTP
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-012.md">⬅️ Part 012 — Conditional Requests and Optimistic Concurrency</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-014.md">Part 014 — Authentication over HTTP ➡️</a>
</div>

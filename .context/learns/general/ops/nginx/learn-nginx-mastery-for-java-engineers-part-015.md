# learn-nginx-mastery-for-java-engineers-part-015.md

# Part 015 — Caching with Nginx: Reverse Proxy Cache as Performance and Resilience Tool

> Seri: `learn-nginx-mastery-for-java-engineers`  
> Bagian: `015 / 030`  
> Fokus: Nginx reverse proxy cache sebagai alat performa, resilience, traffic shaping, dan risk boundary untuk aplikasi Java.

---

## 0. Posisi Part Ini dalam Seri

Kita sudah membahas:

- konfigurasi dasar Nginx,
- server dan location selection,
- static serving,
- reverse proxy,
- proxy header contract,
- upstream/load balancing,
- timeout/retry/buffering/backpressure,
- connection management,
- TLS,
- HTTP/2/HTTP/3,
- compression.

Sekarang kita masuk ke **caching**.

Caching sering terlihat seperti optimisasi performa sederhana:

> “Kalau response sering sama, simpan saja supaya backend tidak dipanggil terus.”

Itu benar, tetapi tidak cukup.

Dalam production, cache adalah **stateful decision layer**. Ia dapat:

- menurunkan latency,
- mengurangi beban backend Java,
- melindungi database dari read spike,
- menjaga sebagian sistem tetap hidup saat upstream rusak,
- mempercepat static/API delivery,
- mengurangi biaya bandwidth/compute,
- tetapi juga bisa membocorkan data user,
- menyajikan data basi,
- menyembunyikan bug backend,
- memperbesar blast radius jika cache key salah,
- membuat debugging jauh lebih sulit.

Jadi mental model part ini:

> **Nginx cache bukan hanya storage response. Ia adalah policy engine yang memutuskan: apakah request boleh dilayani dari state lama, kapan origin dipanggil, siapa yang boleh memengaruhi cache, dan stale data seperti apa yang masih aman.**

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus bisa:

1. Menjelaskan perbedaan browser cache, CDN cache, dan Nginx reverse proxy cache.
2. Mendesain cache key yang aman untuk aplikasi Java.
3. Menggunakan `proxy_cache_path`, `proxy_cache`, `proxy_cache_key`, dan `proxy_cache_valid` dengan benar.
4. Memahami cache status seperti `HIT`, `MISS`, `BYPASS`, `EXPIRED`, `STALE`, `UPDATING`, dan `REVALIDATED`.
5. Menghindari cache poisoning dan private data leakage.
6. Menggunakan stale cache untuk resilience saat backend Java gagal.
7. Mencegah thundering herd dengan `proxy_cache_lock`.
8. Membedakan kapan response boleh di-cache dan kapan wajib tidak di-cache.
9. Membuat observability untuk cache behavior.
10. Mendesain cache policy yang bisa dipertanggungjawabkan secara production.

---

## 2. Cache dalam Arsitektur: Di Mana Nginx Berada?

Bayangkan request sederhana:

```text
Browser / Mobile Client
        |
        v
CDN / Cloud Edge
        |
        v
Load Balancer
        |
        v
Nginx
        |
        v
Java Application
        |
        v
Database / Redis / External API
```

Cache bisa ada di banyak tempat:

```text
[Browser Cache]
[CDN Cache]
[Nginx Reverse Proxy Cache]
[Application Cache]
[Redis/Memcached]
[Database Buffer Cache]
```

Masing-masing punya sifat berbeda.

### 2.1 Browser Cache

Browser cache berada di client.

Cocok untuk:

- static asset,
- gambar,
- CSS,
- JavaScript bundle,
- font,
- file yang punya URL versioned/hash.

Kelebihan:

- request bahkan tidak perlu sampai server,
- sangat murah,
- latency paling rendah.

Kelemahan:

- sulit dikendalikan setelah dikirim,
- tidak berguna untuk client baru,
- tidak mengurangi traffic dari semua user kalau cache belum warm,
- sangat berisiko jika salah memberi header pada private response.

### 2.2 CDN Cache

CDN cache berada di edge global.

Cocok untuk:

- public static assets,
- image/video,
- public API read-heavy,
- halaman public,
- file besar,
- geo-distributed traffic.

Kelebihan:

- dekat dengan user,
- mengurangi traffic ke origin,
- punya fitur purge, WAF, shield, image optimization tergantung provider.

Kelemahan:

- behavior vendor-specific,
- observability bisa terfragmentasi,
- cache key sering dipengaruhi header/query/cookie policy,
- purge/invalidation butuh disiplin.

### 2.3 Nginx Reverse Proxy Cache

Nginx cache berada dekat origin atau di edge internal.

Cocok untuk:

- public API read-heavy,
- backend fragment yang mahal,
- response dari Java service yang expensive tetapi relatif stabil,
- shielding backend dari traffic spike,
- fallback stale saat upstream error,
- caching di environment tanpa CDN,
- internal API acceleration.

Kelebihan:

- dekat dengan aplikasi,
- konfigurasi bisa sangat eksplisit,
- mudah dikaitkan dengan upstream status,
- bisa menjadi resilience layer,
- tidak bergantung pada browser.

Kelemahan:

- tetap menerima traffic dari client/CDN,
- disk/cache management harus dioperasikan,
- cache key salah bisa fatal,
- data leakage risk tinggi jika response user-specific di-cache.

### 2.4 Application Cache

Application cache berada di Java app atau external cache seperti Redis.

Cocok untuk:

- object/domain-level cache,
- query result,
- permission calculation,
- feature flag,
- expensive computation,
- data yang butuh invalidation domain-specific.

Kelebihan:

- paham domain,
- bisa dikaitkan dengan entity lifecycle,
- bisa menerapkan business invalidation.

Kelemahan:

- tetap membebani aplikasi,
- cache hit masih melewati Java runtime,
- thread pool tetap terpakai,
- perlu serialization/deserialization.

### 2.5 Ringkasan Perbandingan

| Cache Layer | Paling Cocok Untuk | Tidak Cocok Untuk | Risiko Utama |
|---|---|---|---|
| Browser | Static asset per user | Data yang harus segera dicabut | Stale client-side |
| CDN | Public global content | Highly personalized response | Wrong cache key / purge lag |
| Nginx | Origin shielding, public API, stale fallback | Sensitive per-user data | Private data leakage |
| Java/Redis | Domain object/cache | Full response acceleration | Complexity/invalidation |
| DB cache | Storage-level optimization | HTTP-level policy | Invisible to app semantics |

---

## 3. Mental Model: Cache sebagai State Machine

Cache bukan boolean `cached/not cached`. Cache punya state.

Simplified state machine:

```text
Request
  |
  v
Build cache key
  |
  v
Check cache storage
  |
  +-- no entry --------------------> MISS -> fetch origin -> maybe store -> return
  |
  +-- entry fresh -----------------> HIT -> return cached response
  |
  +-- entry expired ---------------+
                                  |
                                  +-> revalidate/fetch origin
                                  |
                                  +-> if allowed, serve STALE during error/update
```

Tambahkan bypass policy:

```text
Request
  |
  v
Should bypass cache?
  |
  +-- yes -> BYPASS -> origin -> maybe not store
  |
  +-- no  -> normal cache lookup
```

Tambahkan no-store policy:

```text
Origin response
  |
  v
Is response cacheable?
  |
  +-- yes -> store
  |
  +-- no  -> return only, do not store
```

Jadi cache decision minimal terdiri dari:

1. **cache key** — response ini disimpan sebagai apa?
2. **lookup policy** — request ini boleh mencari cache atau tidak?
3. **store policy** — response ini boleh disimpan atau tidak?
4. **freshness policy** — response dianggap fresh berapa lama?
5. **stale policy** — response expired masih boleh dipakai dalam kondisi apa?
6. **invalidation policy** — bagaimana data lama dibuang?
7. **observability policy** — bagaimana kita tahu keputusan cache?

---

## 4. Nginx Proxy Cache: Komponen Utama

Konfigurasi minimal biasanya terdiri dari dua layer:

1. `proxy_cache_path` di context `http`.
2. `proxy_cache` di context `server` atau `location`.

Contoh awal:

```nginx
http {
    proxy_cache_path /var/cache/nginx/api_cache
        levels=1:2
        keys_zone=api_cache_zone:100m
        max_size=10g
        inactive=60m
        use_temp_path=off;

    server {
        listen 80;
        server_name api.example.com;

        location /public-api/ {
            proxy_cache api_cache_zone;
            proxy_pass http://java_backend;
        }
    }
}
```

Ini terlihat sederhana, tetapi setiap parameter penting.

---

## 5. `proxy_cache_path`: Mendefinisikan Storage dan Metadata Cache

`proxy_cache_path` mendefinisikan cache zone.

Contoh:

```nginx
proxy_cache_path /var/cache/nginx/api_cache
    levels=1:2
    keys_zone=api_cache_zone:100m
    max_size=10g
    inactive=60m
    use_temp_path=off;
```

Mari pecah.

### 5.1 Path

```nginx
/var/cache/nginx/api_cache
```

Ini direktori tempat file cache disimpan.

Pertimbangan production:

- harus writable oleh worker process,
- disk harus cukup,
- disk full harus dimonitor,
- sebaiknya terpisah dari root filesystem jika cache besar,
- jangan taruh di storage lambat untuk high-throughput cache,
- jangan taruh di volume ephemeral kalau cache warm-up mahal, kecuali memang disposable.

### 5.2 `levels`

```nginx
levels=1:2
```

Nginx menyimpan cache file dengan path berdasarkan hash key. `levels` membuat struktur subdirektori agar tidak semua file masuk satu direktori besar.

Contoh konseptual:

```text
/var/cache/nginx/api_cache/a/1b/cache-file
/var/cache/nginx/api_cache/f/7c/cache-file
```

Kenapa penting?

Filesystem bisa lambat jika satu direktori berisi terlalu banyak file. `levels` membantu distribusi file.

### 5.3 `keys_zone`

```nginx
keys_zone=api_cache_zone:100m
```

Ini shared memory zone untuk metadata cache.

Penting:

- nama zone: `api_cache_zone`,
- ukuran metadata: `100m`,
- bukan ukuran total body cache,
- digunakan oleh worker untuk lookup metadata.

Jika zone terlalu kecil:

- cache metadata tidak cukup,
- effective cache capacity turun,
- hit ratio bisa buruk.

### 5.4 `max_size`

```nginx
max_size=10g
```

Batas ukuran disk cache.

Jika melebihi, Nginx cache manager akan menghapus item lama.

Pertanyaan desain:

- Berapa response rata-rata?
- Berapa working set yang ingin ditahan?
- Berapa TTL?
- Berapa traffic public endpoint?
- Berapa disk yang aman dipakai?
- Apa yang terjadi jika cache evict terlalu agresif?

### 5.5 `inactive`

```nginx
inactive=60m
```

Jika cache entry tidak diakses selama periode ini, ia bisa dihapus walaupun belum melewati freshness TTL tertentu.

Ini penting untuk membedakan:

- **validity/freshness**: berapa lama response dianggap fresh,
- **inactive retention**: berapa lama entry dipertahankan jika tidak diakses.

Contoh:

- `proxy_cache_valid 200 10m;`
- `inactive=60m;`

Artinya response `200` fresh selama 10 menit, tetapi entry bisa tetap ada di disk sampai 60 menit sejak terakhir diakses. Setelah expired, ia bisa menjadi kandidat stale atau revalidation tergantung policy.

### 5.6 `use_temp_path=off`

```nginx
use_temp_path=off
```

Ini membuat file temporer untuk cache ditulis di direktori cache yang sama, bukan proxy temp path terpisah.

Manfaat:

- menghindari copy antar filesystem,
- sering lebih efisien untuk cache besar.

Namun pastikan filesystem dan permission benar.

---

## 6. `proxy_cache`: Mengaktifkan Cache pada Location

`proxy_cache_path` hanya mendefinisikan zone. Untuk memakai cache:

```nginx
location /public-api/ {
    proxy_cache api_cache_zone;
    proxy_pass http://java_backend;
}
```

Tanpa `proxy_cache`, zone tidak digunakan untuk location tersebut.

Design principle:

> Jangan aktifkan cache global tanpa memahami route. Cache harus dimulai dari endpoint yang jelas aman.

Buruk:

```nginx
server {
    proxy_cache api_cache_zone;

    location / {
        proxy_pass http://java_backend;
    }
}
```

Ini berbahaya karena semua route berpotensi terkena cache.

Lebih aman:

```nginx
location /api/catalog/ {
    proxy_cache api_cache_zone;
    proxy_pass http://catalog_service;
}

location /api/orders/ {
    proxy_cache off;
    proxy_pass http://order_service;
}
```

---

## 7. Cache Key: Bagian Paling Berbahaya

Cache key menentukan identitas response.

Default Nginx proxy cache key secara konseptual mengandung scheme, method, host, dan request URI. Namun dalam sistem nyata, kamu sering perlu eksplisit.

Contoh:

```nginx
proxy_cache_key "$scheme$request_method$host$request_uri";
```

Atau untuk API public:

```nginx
proxy_cache_key "$scheme$host$request_uri";
```

### 7.1 Cache Key Harus Memuat Semua Variasi yang Mempengaruhi Response

Jika response berubah berdasarkan:

- path,
- query string,
- host,
- language,
- device type,
- authorization,
- cookie,
- tenant,
- region,
- feature flag,
- user role,
- AB test,

maka cache key harus mempertimbangkan variasi itu, atau response tidak boleh di-cache di Nginx.

Contoh fatal:

```nginx
proxy_cache_key "$uri";
```

Request:

```text
GET /api/profile
Authorization: Bearer token-user-a
```

Response user A disimpan dengan key `/api/profile`.

Lalu:

```text
GET /api/profile
Authorization: Bearer token-user-b
```

Jika cache lookup hanya berdasarkan URI, user B bisa menerima profile user A.

Ini bukan bug kecil. Ini data breach.

### 7.2 Query String

`$uri` tidak sama dengan `$request_uri`.

- `$uri`: normalized URI path, biasanya tanpa query string.
- `$request_uri`: original URI dengan query string.

Untuk endpoint search:

```text
/api/products?q=laptop
/api/products?q=phone
```

Jika cache key hanya `$uri`, dua response berbeda bisa tertukar.

Lebih aman:

```nginx
proxy_cache_key "$scheme$host$request_uri";
```

### 7.3 Host

Jika satu Nginx melayani banyak domain:

```text
tenant-a.example.com/products
tenant-b.example.com/products
```

Cache key harus menyertakan host jika response berbeda per host:

```nginx
proxy_cache_key "$scheme$host$request_uri";
```

Jika tidak, tenant A dan tenant B bisa saling melihat response.

### 7.4 Authorization dan Cookie

Rule praktis:

> Response yang bergantung pada `Authorization` atau session cookie jangan di-cache di shared proxy cache kecuali kamu benar-benar mendesain private/segmented cache key dengan sangat hati-hati.

Default aman:

```nginx
proxy_no_cache $http_authorization $cookie_session;
proxy_cache_bypass $http_authorization $cookie_session;
```

Artinya:

- request dengan Authorization tidak memakai cache,
- response dari request dengan Authorization tidak disimpan,
- request dengan session cookie tidak memakai cache,
- response dari request dengan session cookie tidak disimpan.

### 7.5 Accept-Language / Content Negotiation

Jika backend mengembalikan bahasa berbeda berdasarkan `Accept-Language`, cache key harus menyertakannya atau backend harus mengontrol lewat `Vary` dan policy yang benar.

Contoh eksplisit:

```nginx
proxy_cache_key "$scheme$host$request_uri|lang=$http_accept_language";
```

Namun ini bisa menyebabkan cache fragmentation karena header `Accept-Language` bisa sangat bervariasi.

Lebih baik sering kali normalisasi di aplikasi atau edge:

```text
Accept-Language: id-ID,id;q=0.9,en;q=0.8
=> lang_bucket=id
```

Lalu cache key memakai bucket yang terbatas.

---

## 8. Cacheability: Response Mana yang Boleh Disimpan?

Tidak semua response boleh disimpan.

Nginx dapat menyimpan response berdasarkan directive seperti:

```nginx
proxy_cache_valid 200 302 10m;
proxy_cache_valid 404 1m;
```

Artinya:

- response `200` dan `302` fresh selama 10 menit,
- response `404` fresh selama 1 menit.

### 8.1 Cache Status Code dengan Hati-Hati

Umumnya aman untuk dipertimbangkan:

- `200 OK` untuk public data,
- `301/302` jika redirect stabil,
- `404` untuk negative caching pendek,
- `410` untuk resource yang memang hilang permanen.

Biasanya jangan cache:

- `400`,
- `401`,
- `403`,
- `500`,
- `502`,
- `503`,
- `504`,
- response validasi user-specific,
- response error transient.

Negative caching `404` berguna, tetapi TTL harus pendek.

Contoh:

```nginx
proxy_cache_valid 200 5m;
proxy_cache_valid 404 30s;
```

Kenapa `404` bisa di-cache?

Misalnya endpoint public product:

```text
GET /api/catalog/products/non-existing-id
```

Jika bot/request spike terus meminta produk yang tidak ada, backend/database bisa terbebani. Caching `404` selama 30 detik bisa membantu.

Risiko:

- resource baru dibuat tetapi user masih melihat 404 sampai TTL habis.

### 8.2 Jangan Cache Response Personalized

Contoh jangan cache:

```text
GET /api/me
GET /api/profile
GET /api/cart
GET /api/orders
GET /api/notifications
GET /api/admin/users
GET /api/case-management/cases?assignedTo=me
```

Walaupun method GET, response ini user-specific.

Rule penting:

> GET tidak otomatis cacheable secara aman. Cacheability ditentukan oleh semantik data, bukan method saja.

### 8.3 Cache Public Read Model

Contoh kandidat cache:

```text
GET /api/catalog/categories
GET /api/catalog/products?category=books&page=1
GET /api/public/articles/latest
GET /api/public/config/client
GET /api/metadata/countries
GET /api/metadata/currencies
GET /api/public/status-page
```

Tetap evaluasi:

- apakah response sama untuk semua user?
- apakah query string memengaruhi response?
- apakah response berubah berdasarkan tenant?
- apakah authorization memengaruhi visibility?
- apakah data boleh stale?
- TTL aman berapa lama?

---

## 9. `proxy_cache_bypass` vs `proxy_no_cache`

Dua directive ini sering tertukar.

### 9.1 `proxy_cache_bypass`

`proxy_cache_bypass` menentukan kapan request **tidak membaca dari cache**.

Contoh:

```nginx
proxy_cache_bypass $http_authorization;
```

Jika request punya `Authorization`, Nginx tidak akan memakai cached response.

Namun response dari origin masih bisa disimpan kecuali dicegah oleh `proxy_no_cache`.

### 9.2 `proxy_no_cache`

`proxy_no_cache` menentukan kapan response **tidak disimpan ke cache**.

Contoh:

```nginx
proxy_no_cache $http_authorization;
```

Jika request punya `Authorization`, response tidak disimpan.

### 9.3 Gunakan Keduanya untuk Sensitive Request

Untuk session/authenticated request:

```nginx
proxy_cache_bypass $http_authorization $cookie_session;
proxy_no_cache     $http_authorization $cookie_session;
```

Makna:

- jangan layani dari cache,
- jangan simpan response.

### 9.4 Force Refresh untuk Debug/Admin

Kamu bisa membuat mekanisme bypass dengan header internal:

```nginx
map $http_cache_control $skip_cache_by_cache_control {
    default 0;
    ~*no-cache 1;
}

location /api/catalog/ {
    proxy_cache api_cache_zone;
    proxy_cache_bypass $skip_cache_by_cache_control;
    proxy_no_cache $skip_cache_by_cache_control;
    proxy_pass http://catalog_service;
}
```

Tetapi hati-hati: jika semua client bisa mengirim `Cache-Control: no-cache`, mereka bisa memaksa origin dipanggil dan mengurangi manfaat cache.

Untuk admin-only purge/bypass, gunakan kontrol akses.

---

## 10. Observability: Selalu Ekspor Cache Status

Tanpa observability, cache membuat sistem tampak “ajaib”.

Tambahkan header:

```nginx
add_header X-Cache-Status $upstream_cache_status always;
```

Kemungkinan status umum:

- `MISS`: tidak ada cache entry, origin dipanggil.
- `HIT`: response fresh dari cache.
- `BYPASS`: cache dilewati karena policy.
- `EXPIRED`: cache ada tapi expired, origin dipanggil.
- `STALE`: stale response dipakai karena policy.
- `UPDATING`: stale response dipakai sementara entry sedang di-update.
- `REVALIDATED`: cache divalidasi ulang dengan origin.

Tambahkan ke access log:

```nginx
log_format main_ext
    '$remote_addr - $remote_user [$time_local] '
    '"$request" $status $body_bytes_sent '
    '"$http_referer" "$http_user_agent" '
    'rt=$request_time '
    'uct=$upstream_connect_time '
    'uht=$upstream_header_time '
    'urt=$upstream_response_time '
    'ucs=$upstream_cache_status '
    'upstream=$upstream_addr';

access_log /var/log/nginx/access.log main_ext;
```

Pertanyaan yang harus bisa dijawab dari log:

- Endpoint mana yang cache hit ratio-nya rendah?
- Apakah cache benar-benar mengurangi upstream traffic?
- Apakah banyak `BYPASS` karena cookie/authorization?
- Apakah `STALE` muncul saat upstream error?
- Apakah `MISS` spike setelah deploy/restart?
- Apakah cache key terlalu fragmented?
- Apakah cache menyimpan terlalu banyak varian?

---

## 11. Stale Cache: Resilience, Bukan Hanya Performance

Cache bisa melayani response lama saat origin error.

Contoh:

```nginx
proxy_cache_use_stale error timeout http_500 http_502 http_503 http_504 updating;
```

Makna:

- jika upstream error,
- timeout,
- 500/502/503/504,
- atau cache sedang di-update,
- Nginx boleh mengembalikan stale cached response.

Ini sangat berguna untuk public read endpoint.

### 11.1 Contoh Skenario

Endpoint:

```text
GET /api/catalog/categories
```

Normal:

```text
Nginx -> Java catalog service -> DB
```

Saat Java service error:

```text
Nginx -> mencoba upstream -> error
Nginx -> menemukan stale cached categories
Nginx -> return stale categories ke client
```

User masih bisa melihat kategori lama, bukan error page.

### 11.2 Kapan Stale Aman?

Aman jika:

- data public,
- data tidak safety-critical,
- staleness bisa diterima,
- response tidak user-specific,
- user experience lebih baik dengan data lama daripada error.

Contoh aman:

- product category,
- public article,
- country list,
- public metadata,
- feature discovery public.

Tidak aman:

- account balance,
- legal status terkini,
- enforcement decision status,
- payment status,
- permission/access rights,
- inventory real-time jika overselling fatal,
- compliance deadline.

### 11.3 Stale Policy Harus Eksplisit

Jangan asal:

```nginx
proxy_cache_use_stale any;
```

Lebih baik eksplisit:

```nginx
proxy_cache_use_stale error timeout http_502 http_503 http_504 updating;
```

Hindari stale untuk `http_403` atau `http_401` kecuali sangat paham konsekuensinya.

---

## 12. Cache Lock: Mencegah Thundering Herd

Masalah klasik cache:

1. Cache entry expired.
2. Ribuan request masuk bersamaan.
3. Semua request MISS/EXPIRED.
4. Semua memukul upstream Java service.
5. Java service/database overload.

Ini disebut **thundering herd** atau **cache stampede**.

Nginx punya `proxy_cache_lock`.

```nginx
proxy_cache_lock on;
proxy_cache_lock_timeout 5s;
proxy_cache_lock_age 10s;
```

Makna konseptual:

- hanya satu request yang mengisi cache entry tertentu,
- request lain menunggu atau mengikuti policy,
- origin tidak dihantam oleh ribuan request identik.

Contoh lengkap:

```nginx
location /api/catalog/ {
    proxy_cache api_cache_zone;
    proxy_cache_key "$scheme$host$request_uri";

    proxy_cache_valid 200 5m;
    proxy_cache_use_stale error timeout http_502 http_503 http_504 updating;

    proxy_cache_lock on;
    proxy_cache_lock_timeout 5s;
    proxy_cache_lock_age 10s;

    proxy_pass http://catalog_service;
}
```

Trade-off:

- latency beberapa request bisa naik saat entry sedang diisi,
- lebih baik daripada upstream meltdown,
- harus dikombinasikan dengan timeout yang masuk akal.

---

## 13. Background Update dan Updating State

Untuk menghindari user menunggu refresh cache, kamu bisa memakai konsep stale while updating.

Contoh:

```nginx
proxy_cache_use_stale updating;
proxy_cache_background_update on;
```

Konsep:

- cache entry expired,
- request pertama memicu update,
- client tetap bisa menerima stale response,
- update dilakukan di background.

Cocok untuk:

- public data,
- expensive origin response,
- data yang boleh stale sedikit lebih lama,
- endpoint high traffic.

Risiko:

- user bisa melihat data lama lebih lama,
- debugging freshness lebih kompleks,
- harus punya header/log untuk cache status.

---

## 14. Revalidation: `ETag`, `Last-Modified`, dan Conditional Requests

Revalidation adalah mekanisme untuk bertanya ke origin:

> “Cache saya punya versi ini. Apakah masih valid?”

Header umum:

```text
If-None-Match: "etag-value"
If-Modified-Since: Wed, 21 Oct 2015 07:28:00 GMT
```

Origin bisa menjawab:

```text
304 Not Modified
```

Artinya body tidak perlu dikirim ulang.

Nginx dapat mendukung revalidation dengan directive seperti:

```nginx
proxy_cache_revalidate on;
```

Manfaat:

- mengurangi transfer body,
- tetap menjaga freshness,
- bagus untuk response besar.

Konsekuensi untuk Java backend:

- backend harus menghasilkan `ETag` atau `Last-Modified` dengan benar,
- `ETag` harus berubah jika representation berubah,
- `Last-Modified` harus stabil dan akurat,
- jangan membuat weak/unstable validator yang berubah setiap request.

Buruk:

```java
ETag = UUID.randomUUID().toString();
```

Ini membuat revalidation selalu gagal.

Lebih baik:

```text
ETag = hash(representationVersion + lastUpdatedAt + language + encodingVariant)
```

Tetapi hati-hati: jangan hash data sensitive ke header jika bisa bocor.

---

## 15. Cache-Control dari Backend vs Policy Nginx

Idealnya Java backend memberi header yang benar:

```text
Cache-Control: public, max-age=300
ETag: "product-list-v42"
```

Atau untuk private data:

```text
Cache-Control: private, no-store
```

Nginx bisa mengikuti atau override tergantung konfigurasi.

Design options:

### 15.1 Backend-Owned Cache Policy

Backend menentukan cacheability.

Kelebihan:

- domain semantics dekat dengan aplikasi,
- developer tahu data mana yang sensitive,
- policy bisa berubah per endpoint/entity.

Kelemahan:

- semua service harus disiplin,
- salah header bisa fatal,
- sulit enforce secara terpusat.

### 15.2 Nginx-Owned Cache Policy

Nginx menentukan path mana yang cacheable.

Kelebihan:

- centralized control,
- mudah audit edge behavior,
- tidak bergantung pada semua service.

Kelemahan:

- Nginx tidak paham domain sedalam aplikasi,
- route baru bisa ikut policy lama secara tidak sengaja,
- config bisa menjadi kompleks.

### 15.3 Hybrid Policy

Praktik paling sehat:

- Nginx hanya meng-cache allowlist endpoint.
- Backend tetap mengirim `Cache-Control` benar.
- Sensitive response selalu mengirim `no-store`.
- Nginx punya guardrail: bypass/no-cache untuk auth/cookie.

Contoh:

```nginx
location /api/catalog/ {
    proxy_cache api_cache_zone;
    proxy_cache_valid 200 5m;
    proxy_no_cache $http_authorization $cookie_session;
    proxy_cache_bypass $http_authorization $cookie_session;
    proxy_pass http://catalog_service;
}
```

Backend tetap:

```text
Cache-Control: public, max-age=300
```

Untuk private endpoint:

```text
Cache-Control: no-store
```

---

## 16. Caching dan HTTP Methods

Default aman:

- cache `GET`,
- mungkin cache `HEAD`,
- jangan cache `POST`, `PUT`, `PATCH`, `DELETE` kecuali kamu punya desain sangat spesifik.

Nginx memiliki directive terkait methods, tetapi untuk kebanyakan sistem Java business API:

```nginx
proxy_cache_methods GET HEAD;
```

Jangan tergoda cache POST hanya karena endpoint search menggunakan POST.

Contoh:

```text
POST /api/search
{
  "query": "nginx",
  "filters": {...}
}
```

Secara teori bisa dibuat cache key dari body, tapi di Nginx Open Source ini tidak semudah dan seaman kelihatannya. Lebih baik desain endpoint public search cacheable sebagai GET dengan query canonical, atau cache di application layer yang paham body semantics.

---

## 17. Cache Poisoning

Cache poisoning terjadi ketika attacker berhasil membuat cache menyimpan response yang salah, lalu response itu disajikan ke user lain.

### 17.1 Penyebab Umum

- cache key tidak mencakup header yang memengaruhi response,
- backend memakai Host/X-Forwarded-Host secara tidak aman,
- query parameter tidak dinormalisasi,
- response berbeda berdasarkan cookie tetapi cookie tidak masuk cache key,
- attacker mengirim header aneh yang memengaruhi backend,
- Nginx menyimpan error/redirect yang seharusnya tidak disimpan.

### 17.2 Contoh Host Header Poisoning

Request attacker:

```text
GET /reset-password-info HTTP/1.1
Host: evil.example
X-Forwarded-Host: evil.example
```

Backend Java membangun absolute URL dari host forwarded:

```text
https://evil.example/reset
```

Jika response di-cache untuk key yang tidak membedakan host dengan benar, user lain bisa menerima link/response beracun.

Mitigasi:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
```

Dan validasi host:

```nginx
server {
    listen 443 ssl default_server;
    server_name _;
    return 444;
}
```

### 17.3 Query Parameter Poisoning

Misalnya backend berubah behavior jika ada parameter debug:

```text
GET /api/catalog/products?debug=true
```

Jika cache key mengabaikan query string, debug response bisa disajikan untuk request normal.

Mitigasi:

- gunakan `$request_uri` jika query memengaruhi response,
- canonicalize query parameter di aplikasi/CDN jika perlu,
- jangan expose debug behavior di production,
- jangan cache response yang dipengaruhi parameter internal.

### 17.4 Cookie Poisoning

Backend mengembalikan varian berbeda jika cookie tertentu ada:

```text
Cookie: experiment=new-layout
```

Jika cache key tidak mempertimbangkan experiment, user lain bisa mendapat varian yang tidak diinginkan.

Mitigasi:

- jangan cache jika cookie ada,
- atau cache key memasukkan normalized experiment bucket,
- jangan masukkan seluruh cookie mentah ke key karena fragmentasi tinggi.

---

## 18. Private Data Leakage

Ini risiko paling serius.

### 18.1 Red Flag Endpoint

Jangan cache di Nginx shared cache:

```text
/api/me
/api/profile
/api/cart
/api/orders
/api/payments
/api/invoices
/api/messages
/api/notifications
/api/admin
/api/internal
/api/cases
/api/tasks?assignedTo=me
/api/reports/export
```

### 18.2 Red Flag Headers

Jika request punya:

```text
Authorization
Cookie: session=...
Cookie: JSESSIONID=...
```

maka default harus bypass dan no-cache.

Contoh map:

```nginx
map $http_authorization $has_authorization {
    default 1;
    "" 0;
}

map $http_cookie $has_cookie {
    default 1;
    "" 0;
}

map "$has_authorization$has_cookie" $skip_cache {
    default 1;
    "00" 0;
}
```

Lalu:

```nginx
proxy_cache_bypass $skip_cache;
proxy_no_cache $skip_cache;
```

Namun ini terlalu konservatif untuk static assets yang juga dikirim dengan cookie. Maka terapkan pada API location, bukan semua static asset.

---

## 19. Cache untuk Static Assets vs API Response

### 19.1 Static Assets

Untuk asset hashed:

```text
/app.8f3a2c.js
/styles.91bd.css
/logo.a83df.png
```

Bisa sangat agresif:

```nginx
location /assets/ {
    root /var/www/app;
    expires 1y;
    add_header Cache-Control "public, immutable" always;
}
```

Karena URL berubah jika content berubah.

### 19.2 SPA HTML

Untuk `index.html`, jangan cache terlalu agresif.

```nginx
location = /index.html {
    root /var/www/app;
    add_header Cache-Control "no-cache" always;
}
```

Alasan:

- index menunjuk bundle terbaru,
- jika index terlalu lama, user bisa memuat bundle lama yang sudah hilang.

### 19.3 API Response

Untuk API, cache policy harus domain-aware.

Contoh:

```nginx
location /api/catalog/ {
    proxy_cache api_cache_zone;
    proxy_cache_key "$scheme$host$request_uri";
    proxy_cache_valid 200 5m;
    proxy_cache_valid 404 30s;
    proxy_cache_use_stale error timeout http_502 http_503 http_504 updating;
    proxy_cache_lock on;
    add_header X-Cache-Status $upstream_cache_status always;
    proxy_pass http://catalog_service;
}
```

---

## 20. Cache Invalidation: Masalah Tersulit

Ada dua quote terkenal di dunia engineering:

> There are only two hard things in Computer Science: cache invalidation and naming things.

Cache invalidation sulit karena kamu menyimpan representasi lama dari state yang bisa berubah.

Strategi umum:

### 20.1 TTL-Based Invalidation

Biarkan cache expired setelah waktu tertentu.

```nginx
proxy_cache_valid 200 5m;
```

Kelebihan:

- sederhana,
- robust,
- tidak butuh event invalidation.

Kelemahan:

- user bisa melihat data lama sampai TTL habis.

Cocok untuk:

- public catalog,
- metadata,
- content list,
- low-risk stale data.

### 20.2 Versioned URL

Ubah URL saat content berubah.

```text
/assets/app.v42.js
/api/public/config?v=42
```

Kelebihan:

- cache lama tidak perlu dihapus,
- sangat baik untuk static assets.

Kelemahan:

- tidak cocok untuk semua API,
- butuh version propagation.

### 20.3 Purge

Purge menghapus cache entry tertentu.

Nginx Open Source tidak menyediakan semua fitur purge advanced secara default seperti beberapa distribusi/NGINX Plus/third-party module. NGINX documentation membahas purge dalam konteks konfigurasi tertentu dan NGINX Plus/fitur terkait. Jadi untuk Nginx Open Source, strategi umum biasanya:

- TTL pendek,
- cache key versioning,
- deploy-time cache directory clear,
- third-party purge module dengan risiko operasional,
- gunakan CDN/application cache untuk invalidation kompleks.

### 20.4 Event-Driven Invalidation

Misalnya product update memicu purge cache product.

Ini cocok jika:

- domain event reliable,
- cache key deterministic,
- purge API aman,
- idempotent,
- observable.

Namun kompleksitas meningkat.

### 20.5 Soft Invalidation

Alih-alih menghapus cache, ubah version namespace:

```nginx
proxy_cache_key "$scheme$host$cache_version$request_uri";
```

`$cache_version` bisa berasal dari map/static config/env templating.

Saat deploy:

```text
cache_version=v43
```

Semua key berubah, cache lama tidak dipakai lagi.

Risiko:

- cache lama tetap makan disk sampai evicted,
- cold start cache besar setelah version bump.

---

## 21. Caching dan Multi-Tenant System

Untuk multi-tenant SaaS/regulatory platform, cache key harus ekstra hati-hati.

Tenant bisa berasal dari:

- subdomain,
- path prefix,
- header,
- JWT claim,
- mTLS identity,
- organization context di session.

Contoh subdomain tenant:

```text
tenant-a.example.com/api/catalog
```

Cache key:

```nginx
proxy_cache_key "$scheme$host$request_uri";
```

Contoh header tenant:

```text
X-Tenant-Id: tenant-a
```

Cache key jika benar-benar public per tenant:

```nginx
proxy_cache_key "$scheme$host$request_uri|tenant=$http_x_tenant_id";
```

Tetapi hati-hati: header tenant dari client tidak boleh dipercaya mentah-mentah. Jika tenant berasal dari authenticated identity, Nginx mungkin tidak punya cukup konteks untuk safely cache. Dalam kasus itu, cache di application layer lebih aman.

Rule:

> Jika Nginx tidak bisa memverifikasi tenant boundary, jangan gunakan shared Nginx cache untuk response tenant-specific.

---

## 22. Caching dan Authorization

Ada dua jenis endpoint:

### 22.1 Public Without Auth

Contoh:

```text
GET /api/public/articles
GET /api/catalog/products
```

Bisa cache di Nginx jika benar-benar sama untuk semua client.

### 22.2 Authenticated but Same for Everyone

Contoh:

```text
GET /api/app-config
Authorization: Bearer ...
```

Walaupun response sama untuk semua authenticated user, shared proxy cache tetap tricky karena request membawa Authorization.

Pilihan:

1. Jangan cache di Nginx; cache di app/CDN public endpoint.
2. Pisahkan endpoint public config tanpa Authorization.
3. Gunakan `proxy_ignore_headers`/custom policy hanya jika yakin dan sudah threat-modeled.

Default enterprise-safe:

```nginx
proxy_cache_bypass $http_authorization;
proxy_no_cache $http_authorization;
```

### 22.3 Authenticated and Personalized

Jangan cache di shared Nginx cache.

---

## 23. Caching dan Set-Cookie

Response dengan `Set-Cookie` biasanya tidak boleh disimpan di shared cache.

Contoh:

```text
HTTP/1.1 200 OK
Set-Cookie: session=abc; HttpOnly; Secure
```

Jika response disimpan, client lain bisa menerima cookie atau variant yang salah.

Guardrail:

```nginx
proxy_no_cache $upstream_http_set_cookie;
```

Dan jika request punya cookie:

```nginx
proxy_cache_bypass $http_cookie;
proxy_no_cache $http_cookie;
```

Tetapi terlalu konservatif untuk beberapa site, karena browser sering mengirim cookie untuk semua path. Solusinya:

- pisahkan static domain tanpa cookie,
- pisahkan public API domain/path,
- atur cookie `Path` dan `Domain` dengan benar,
- jangan gunakan cookie global untuk semua route.

---

## 24. Caching dan Compression

Dari Part 014, kita tahu response bisa berbeda berdasarkan `Accept-Encoding`.

Pertanyaan:

> Apakah cache menyimpan compressed atau uncompressed response?

Jika Nginx menerima compressed response dari upstream atau melakukan gzip sendiri, cache behavior harus dipahami.

Risiko:

- client yang tidak support gzip menerima gzip,
- cache key tidak membedakan encoding variant,
- double compression,
- inconsistent `Vary: Accept-Encoding`.

Praktik sehat:

- biarkan Nginx melakukan compression di edge,
- cache representation yang stabil,
- pastikan `Vary` benar jika variasi encoding disimpan,
- jangan biarkan upstream dan Nginx saling compress tanpa desain.

Untuk static asset, precompressed file bisa lebih baik:

```text
app.js
app.js.gz
app.js.br
```

Tetapi itu lebih masuk static serving/CDN topic.

---

## 25. Caching dan Range Requests / Large Files

Untuk file besar, partial content/range request bisa muncul:

```text
Range: bytes=0-1023
```

Nginx punya module `slice` untuk caching response besar per potongan, tetapi module ini tidak selalu built-in by default dan perlu pertimbangan khusus.

Gunakan slice jika:

- file besar,
- banyak range request,
- origin mahal,
- kamu memahami storage impact.

Jangan gunakan kalau:

- response kecil,
- API JSON biasa,
- observability belum siap,
- upstream tidak support range dengan benar.

---

## 26. Caching dan Disk Behavior

Nginx proxy cache memakai disk untuk body cache dan shared memory untuk metadata.

Production concerns:

### 26.1 Disk Full

Jika cache disk memenuhi filesystem:

- Nginx bisa gagal menulis cache,
- log juga bisa gagal jika satu filesystem,
- service bisa terganggu.

Mitigasi:

- `max_size`,
- dedicated partition/volume,
- disk usage alert,
- log/cache separation,
- cleanup policy.

### 26.2 Cache Warm-Up

Setelah deploy/restart/cache clear:

- hit ratio turun,
- upstream traffic naik,
- latency naik,
- DB bisa spike.

Mitigasi:

- avoid unnecessary cache clear,
- warm critical endpoints,
- use stale policy,
- stagger deploy,
- monitor MISS spike.

### 26.3 I/O Bottleneck

Cache bukan gratis. Disk I/O bisa menjadi bottleneck.

Tanda:

- high iowait,
- slow cache HIT,
- Nginx worker latency naik,
- disk queue tinggi.

Mitigasi:

- faster disk,
- right-size cache,
- avoid caching huge low-hit responses,
- tune levels/max_size/inactive,
- use CDN for large assets.

---

## 27. Desain Cache Policy Berdasarkan Data Semantics

Jangan mulai dari directive. Mulai dari data.

Checklist per endpoint:

```text
Endpoint: GET /api/catalog/products

1. Apakah response public?
2. Apakah sama untuk semua user?
3. Apakah berubah berdasarkan query string?
4. Apakah berubah berdasarkan header?
5. Apakah berubah berdasarkan cookie?
6. Apakah berubah berdasarkan tenant?
7. Apakah Authorization memengaruhi hasil?
8. Berapa lama stale masih aman?
9. Apa dampak jika user melihat data lama?
10. Apa dampak jika response salah bocor ke user lain?
11. Bagaimana invalidation terjadi?
12. Bagaimana observability dilakukan?
```

Jika jawaban tidak jelas, jangan cache dulu di Nginx.

---

## 28. Pattern: Public Catalog Cache untuk Java Service

Use case:

- Spring Boot catalog service,
- product/category public,
- data berubah beberapa menit sekali,
- query string menentukan result,
- tidak personalized,
- ingin melindungi DB dari read spike.

### 28.1 Nginx Config

```nginx
http {
    proxy_cache_path /var/cache/nginx/catalog
        levels=1:2
        keys_zone=catalog_cache:200m
        max_size=20g
        inactive=30m
        use_temp_path=off;

    log_format cache_log
        '$remote_addr [$time_local] '
        '"$request" status=$status '
        'cache=$upstream_cache_status '
        'rt=$request_time urt=$upstream_response_time '
        'upstream=$upstream_addr';

    upstream catalog_service {
        server 10.0.10.11:8080 max_fails=3 fail_timeout=10s;
        server 10.0.10.12:8080 max_fails=3 fail_timeout=10s;
        keepalive 64;
    }

    server {
        listen 443 ssl http2;
        server_name api.example.com;

        access_log /var/log/nginx/api-access.log cache_log;

        location /api/catalog/ {
            proxy_http_version 1.1;
            proxy_set_header Connection "";

            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            proxy_cache catalog_cache;
            proxy_cache_key "$scheme$host$request_uri";

            proxy_cache_valid 200 5m;
            proxy_cache_valid 404 30s;

            proxy_cache_bypass $http_authorization $cookie_session;
            proxy_no_cache     $http_authorization $cookie_session $upstream_http_set_cookie;

            proxy_cache_use_stale error timeout http_502 http_503 http_504 updating;
            proxy_cache_lock on;
            proxy_cache_lock_timeout 5s;
            proxy_cache_lock_age 10s;

            add_header X-Cache-Status $upstream_cache_status always;

            proxy_connect_timeout 2s;
            proxy_read_timeout 10s;
            proxy_send_timeout 10s;

            proxy_pass http://catalog_service;
        }
    }
}
```

### 28.2 Kenapa Config Ini Masuk Akal?

- Cache hanya untuk `/api/catalog/`, bukan semua API.
- Key memakai scheme, host, dan request URI agar query string tidak hilang.
- Authorization dan session cookie menyebabkan bypass/no-store.
- `Set-Cookie` dari upstream mencegah store.
- `200` TTL 5 menit untuk normal data.
- `404` TTL 30 detik untuk negative caching pendek.
- Stale boleh dipakai saat upstream error/timeout.
- Cache lock mencegah stampede.
- Header dan log mengekspos cache status.
- Timeout tetap eksplisit agar cache tidak menunggu origin terlalu lama.

---

## 29. Pattern: Metadata Cache

Use case:

```text
GET /api/metadata/countries
GET /api/metadata/currencies
GET /api/metadata/document-types
```

Karakteristik:

- jarang berubah,
- public atau semi-public,
- kecil,
- banyak dipakai UI,
- stale biasanya aman.

Config:

```nginx
location /api/metadata/ {
    proxy_cache metadata_cache;
    proxy_cache_key "$scheme$host$request_uri";
    proxy_cache_valid 200 1h;
    proxy_cache_use_stale error timeout http_502 http_503 http_504 updating;
    proxy_cache_lock on;
    add_header X-Cache-Status $upstream_cache_status always;
    proxy_pass http://metadata_service;
}
```

Untuk metadata yang bisa berbeda per tenant, jangan pakai config ini tanpa tenant key yang aman.

---

## 30. Pattern: Stale-on-Error untuk Public Content

Use case:

```text
GET /public/articles/latest
```

Goal:

- user tetap melihat artikel lama jika CMS/backend down.

Config:

```nginx
location /public/articles/ {
    proxy_cache public_content_cache;
    proxy_cache_key "$scheme$host$request_uri";

    proxy_cache_valid 200 10m;
    proxy_cache_use_stale error timeout http_500 http_502 http_503 http_504 updating;

    proxy_cache_lock on;
    proxy_cache_background_update on;

    add_header X-Cache-Status $upstream_cache_status always;
    add_header X-Content-Stale-Policy "stale-on-error" always;

    proxy_pass http://content_service;
}
```

Catatan:

- header custom bisa membantu debugging,
- jangan pakai untuk data regulatory/legal yang harus real-time.

---

## 31. Anti-Pattern: Cache Semua GET

Buruk:

```nginx
location /api/ {
    proxy_cache api_cache;
    proxy_cache_valid 200 10m;
    proxy_pass http://java_backend;
}
```

Kenapa buruk?

Karena `/api/` bisa berisi:

- `/api/me`,
- `/api/orders`,
- `/api/admin`,
- `/api/search` dengan personalization,
- `/api/cases`,
- `/api/notifications`,
- `/api/profile`.

GET tidak berarti public.

Lebih aman:

```nginx
location /api/catalog/ {
    proxy_cache catalog_cache;
    proxy_pass http://catalog_service;
}

location /api/ {
    proxy_cache off;
    proxy_pass http://java_backend;
}
```

---

## 32. Anti-Pattern: Cache Key Mengabaikan Query String

Buruk:

```nginx
proxy_cache_key "$scheme$host$uri";
```

Untuk:

```text
/api/products?page=1
/api/products?page=2
```

Keduanya bisa dianggap sama jika hanya `$uri`.

Lebih aman:

```nginx
proxy_cache_key "$scheme$host$request_uri";
```

Atau canonical query key jika kamu punya normalisasi.

---

## 33. Anti-Pattern: Tidak Mengekspos Cache Status

Buruk:

```nginx
proxy_cache api_cache;
```

Tanpa:

```nginx
add_header X-Cache-Status $upstream_cache_status always;
```

Tanpa log:

```nginx
$upstream_cache_status
```

Akibat:

- sulit tahu cache bekerja atau tidak,
- sulit debug stale response,
- sulit bedakan backend slow vs cache miss,
- sulit menghitung hit ratio.

---

## 34. Anti-Pattern: TTL Terlalu Panjang Karena Ingin Cepat

Buruk:

```nginx
proxy_cache_valid 200 24h;
```

Untuk data yang berubah tiap beberapa menit.

Efek:

- user melihat data lama,
- support ticket naik,
- developer bingung karena backend sudah benar,
- cache menjadi sumber inkonsistensi.

Lebih baik:

- TTL pendek,
- stale-on-error,
- revalidation,
- domain-specific invalidation,
- versioned key.

---

## 35. Anti-Pattern: Menggunakan Nginx Cache untuk Authorization Result

Misalnya:

```text
GET /api/cases/123
```

Response tergantung:

- user role,
- assigned team,
- jurisdiction,
- case confidentiality,
- workflow state,
- legal hold,
- escalation status.

Nginx tidak tahu semua ini.

Jangan cache di shared proxy cache.

Gunakan:

- application-level cache dengan key per identity/role/permission version,
- domain-aware invalidation,
- strict audit.

---

## 36. Java Backend Design untuk Bekerja Baik dengan Nginx Cache

Aplikasi Java harus membantu proxy cache bekerja aman.

### 36.1 Kirim Cache-Control yang Benar

Public response:

```http
Cache-Control: public, max-age=300
```

Private response:

```http
Cache-Control: private, no-store
```

Sensitive response:

```http
Cache-Control: no-store
Pragma: no-cache
```

### 36.2 Jangan Set Cookie di Public Cacheable Response

Buruk:

```http
GET /api/catalog/products
Set-Cookie: tracking=abc
Cache-Control: public, max-age=300
```

Ini membuat response sulit/salah untuk shared cache.

Pisahkan tracking/session dari public API.

### 36.3 Stable ETag

Baik:

```http
ETag: "catalog-v123-lang-id"
```

Buruk:

```http
ETag: "random-every-request"
```

### 36.4 Canonical Response

Untuk endpoint cacheable:

- output ordering stabil,
- query parameter dinormalisasi,
- timestamp generated-now tidak dimasukkan sembarangan,
- response tidak mengandung request-specific debug info,
- tidak ada per-user field tersembunyi.

Buruk:

```json
{
  "products": [...],
  "generatedAt": "2026-06-19T10:11:12.123Z",
  "requestId": "abc-123"
}
```

Jika `generatedAt` berubah setiap request, ETag/revalidation bisa buruk.

Lebih baik:

```json
{
  "products": [...],
  "catalogVersion": 42
}
```

Request ID letakkan di header/log, bukan body cacheable.

---

## 37. Cache Hit Ratio: Cara Membaca

Hit ratio:

```text
HIT / total cacheable requests
```

Tetapi angka ini bisa menipu.

### 37.1 Hit Ratio Rendah Bisa Normal

Jika endpoint punya banyak kombinasi query:

```text
/api/search?q=...
```

hit ratio rendah wajar.

### 37.2 Hit Ratio Tinggi Bisa Berbahaya

Jika hit ratio tinggi karena private response ter-cache, itu bencana.

### 37.3 Metrik yang Lebih Berguna

- hit ratio per endpoint,
- upstream request reduction,
- p95 latency HIT vs MISS,
- stale served count,
- bypass reason,
- cache size,
- eviction rate,
- MISS spike after deploy,
- origin error masked by stale.

---

## 38. Debugging Cache Behavior

### 38.1 Cek Response Header

```bash
curl -I https://api.example.com/api/catalog/categories
```

Lihat:

```text
X-Cache-Status: MISS
```

Request kedua:

```bash
curl -I https://api.example.com/api/catalog/categories
```

Harusnya:

```text
X-Cache-Status: HIT
```

### 38.2 Test Query String

```bash
curl -I 'https://api.example.com/api/catalog/products?page=1'
curl -I 'https://api.example.com/api/catalog/products?page=2'
```

Pastikan tidak tertukar.

### 38.3 Test Authorization Bypass

```bash
curl -I \
  -H 'Authorization: Bearer fake' \
  https://api.example.com/api/catalog/categories
```

Expected:

```text
X-Cache-Status: BYPASS
```

Atau tidak HIT.

### 38.4 Test Cookie Bypass

```bash
curl -I \
  -H 'Cookie: session=abc' \
  https://api.example.com/api/catalog/categories
```

Expected sesuai policy.

### 38.5 Test Stale on Error

Ini harus dilakukan di staging.

1. Warm cache.
2. Matikan upstream.
3. Request endpoint.
4. Pastikan Nginx mengembalikan stale response jika policy mengizinkan.
5. Pastikan log menunjukkan `STALE`.

---

## 39. Production Checklist

Sebelum enable Nginx cache untuk endpoint:

### 39.1 Semantics

- [ ] Endpoint public atau cache key sudah mencakup boundary yang aman.
- [ ] Tidak mengandung data user-specific.
- [ ] Tidak bergantung pada Authorization/session cookie.
- [ ] Query string/header variation dipahami.
- [ ] Tenant boundary aman.
- [ ] Stale tolerance jelas.

### 39.2 Config

- [ ] `proxy_cache_path` punya `max_size`.
- [ ] `inactive` masuk akal.
- [ ] Cache directory permission benar.
- [ ] Cache key eksplisit.
- [ ] `proxy_cache_valid` hanya untuk status yang aman.
- [ ] `proxy_cache_bypass` untuk auth/cookie jika perlu.
- [ ] `proxy_no_cache` untuk auth/cookie/Set-Cookie jika perlu.
- [ ] `proxy_cache_use_stale` eksplisit.
- [ ] `proxy_cache_lock` untuk high traffic endpoint.

### 39.3 Observability

- [ ] `X-Cache-Status` aktif minimal di staging/debug.
- [ ] `$upstream_cache_status` masuk log.
- [ ] Hit/miss/bypass/stale dashboard tersedia.
- [ ] Disk usage dimonitor.
- [ ] MISS spike alert dipertimbangkan.

### 39.4 Security

- [ ] Sensitive response mengirim `Cache-Control: no-store`.
- [ ] `Set-Cookie` tidak disimpan.
- [ ] Host header divalidasi.
- [ ] Unknown host ditolak.
- [ ] No cache untuk admin/internal endpoints.
- [ ] Cache poisoning scenario diuji.

### 39.5 Operations

- [ ] Ada strategi invalidation.
- [ ] Ada strategi rollback.
- [ ] Ada cara clear cache safely jika emergency.
- [ ] Ada runbook stale data.
- [ ] Cache warm-up/cold-start dipahami.

---

## 40. Latihan Desain

### Latihan 1 — Product Catalog

Endpoint:

```text
GET /api/catalog/products?category=books&page=1&sort=popular
```

Pertanyaan:

1. Cache key apa yang aman?
2. TTL berapa?
3. Apakah `404` perlu di-cache?
4. Apakah Authorization harus bypass?
5. Apa stale policy yang cocok?
6. Apa metrik yang perlu dilihat?

Jawaban arah:

- gunakan `$scheme$host$request_uri`,
- TTL pendek seperti 1–5 menit,
- `404` boleh sangat pendek jika product ID endpoint,
- Authorization/cookie bypass jika endpoint public tapi kadang dipanggil user login,
- stale untuk 502/503/504/updating,
- log `$upstream_cache_status`.

### Latihan 2 — Case Management Dashboard

Endpoint:

```text
GET /api/cases?assignedTo=me&status=open
```

Pertanyaan:

1. Boleh cache di Nginx?
2. Kenapa?
3. Cache layer mana yang lebih cocok?

Jawaban arah:

- jangan cache di shared Nginx cache,
- response user-specific dan authorization-sensitive,
- jika perlu optimisasi, gunakan application/domain cache dengan identity/permission-aware key.

### Latihan 3 — Public Metadata

Endpoint:

```text
GET /api/metadata/countries
```

Pertanyaan:

1. TTL berapa?
2. Boleh stale saat upstream down?
3. Apa risiko utama?

Jawaban arah:

- TTL bisa 1 jam atau lebih tergantung business,
- stale-on-error aman,
- risiko utama perubahan metadata urgent tidak segera terlihat.

---

## 41. Ringkasan Mental Model

Caching di Nginx harus dipahami sebagai policy boundary.

Kalimat penting:

> Cache key adalah identitas data. Jika identitas salah, data salah bisa diberikan ke orang yang salah.

> TTL adalah janji staleness. Jangan pilih TTL hanya karena ingin cepat.

> `proxy_cache_bypass` mengatur pembacaan cache; `proxy_no_cache` mengatur penyimpanan cache.

> Stale cache adalah resilience tool, tetapi hanya aman untuk data yang boleh basi.

> Cache tanpa observability adalah hidden state yang akan menyulitkan incident response.

> Endpoint authenticated, personalized, tenant-sensitive, atau authorization-sensitive sebaiknya tidak di-cache di shared Nginx cache kecuali ada desain eksplisit dan threat model yang kuat.

---

## 42. Referensi Resmi yang Relevan

Untuk eksplorasi lanjutan, rujukan utama:

- NGINX `ngx_http_proxy_module`: `proxy_cache`, `proxy_cache_path`, `proxy_cache_key`, `proxy_cache_valid`, `proxy_cache_use_stale`, `proxy_cache_lock`, dan directive proxy cache lain.
- NGINX Admin Guide: content caching.
- NGINX `ngx_http_headers_module`: `expires`, `add_header`, dan response cache headers.
- NGINX blog caching guide untuk pemahaman status cache seperti `HIT`, `MISS`, `STALE`, `UPDATING`, dan `REVALIDATED`.

---

## 43. Apa yang Harus Dikuasai Sebelum Lanjut

Sebelum lanjut ke Part 016, pastikan kamu bisa menjawab:

1. Apa bedanya browser cache, CDN cache, Nginx cache, dan application cache?
2. Kenapa `$uri` bisa berbahaya sebagai cache key?
3. Apa beda `proxy_cache_bypass` dan `proxy_no_cache`?
4. Kapan stale cache aman?
5. Kenapa response dengan `Authorization` atau `Set-Cookie` harus dicurigai?
6. Bagaimana cara melihat apakah response berasal dari cache?
7. Bagaimana cache bisa menyebabkan data breach?
8. Kenapa cache lock penting untuk endpoint high traffic?
9. Apa strategi invalidation yang cocok untuk public catalog?
10. Endpoint Java seperti apa yang tidak boleh di-cache di Nginx?

---

# Status Seri

Bagian ini selesai.

Progress:

```text
Part 015 / 030 selesai.
```

Seri belum selesai.

Bagian berikutnya:

```text
Part 016 — Rate Limiting, Connection Limiting, and Abuse Resistance
```

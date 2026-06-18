# learn-http-for-web-frontend-perspective-part-007

# Body, Payload, Representation, Media Type, and Encoding

> Seri: `learn-http-for-web-frontend-perspective`  
> Bagian: `007`  
> Target pembaca: Java software engineer yang ingin menguasai HTTP dari perspektif browser/frontend secara mendalam.  
> Prasyarat: Part 000–006, terutama HTTP message model dan headers.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas HTTP message model dan header sebagai control plane. Sekarang kita masuk ke bagian yang sering terlihat sederhana tetapi sangat sering menjadi sumber bug produksi: **body, payload, representation, media type, dan encoding**.

Di banyak aplikasi frontend, bug terlihat seperti ini:

- `response.json()` melempar error padahal status `200`.
- Request `POST` terlihat benar, tetapi backend menerima body kosong.
- Upload file gagal hanya di browser, tetapi berhasil di Postman.
- API mengembalikan `204 No Content`, tetapi client mencoba parse JSON.
- Server mengirim HTML error page, tetapi frontend menganggap itu JSON.
- Download file corrupt karena salah membaca response sebagai text.
- Multipart upload gagal karena developer set `Content-Type` secara manual.
- Response besar membuat tab freeze karena seluruh body dimuat ke memory.
- Compression aktif di production, tetapi tidak di local, sehingga bug hanya muncul di environment tertentu.

Bagian ini membangun mental model agar Anda bisa melihat body bukan sebagai “data mentah”, tetapi sebagai **representasi resource yang dibungkus oleh metadata HTTP**.

Target akhirnya: ketika melihat request/response di DevTools, Anda bisa menjawab:

1. Apakah message ini memang boleh punya body?
2. Body ini merepresentasikan apa?
3. Media type-nya benar atau tidak?
4. Encoding-nya diinterpretasikan oleh browser atau aplikasi?
5. Parsing harus dilakukan oleh siapa dan kapan?
6. Apakah body bisa dibaca ulang?
7. Apa risiko memory/performance/security dari cara body diproses?
8. Apakah contract backend-frontend cukup eksplisit?

---

## 1. Core Mental Model

HTTP body adalah **aliran byte**, bukan otomatis JSON, bukan otomatis form, bukan otomatis file, bukan otomatis object JavaScript.

Browser, framework frontend, proxy, CDN, server framework, dan backend application hanya bisa memahami body dengan benar jika metadata-nya cukup jelas.

Mental model utama:

```text
HTTP message
├── start line / status line
├── headers: metadata/control plane
└── body: byte stream / representation data
```

Body tidak berdiri sendiri. Body selalu harus dibaca bersama:

```text
Body meaning = method/status semantics + headers + consumer expectation
```

Contoh:

```http
POST /users HTTP/1.1
Content-Type: application/json
Accept: application/json

{"name":"Ayu"}
```

Body di atas bermakna sebagai JSON request representation karena ada `Content-Type: application/json`.

Bandingkan dengan:

```http
POST /users HTTP/1.1
Content-Type: text/plain

{"name":"Ayu"}
```

Secara visual body-nya sama, tetapi secara kontrak HTTP, server diberi tahu bahwa body adalah plain text, bukan JSON.

Bandingkan lagi:

```http
GET /users HTTP/1.1
Content-Type: application/json

{"filter":"active"}
```

Ini problematis. HTTP tidak melarang semua client mengirim body pada GET secara absolut, tetapi semantik dan interoperabilitasnya buruk. Browser, proxy, cache, gateway, dan framework dapat memperlakukan GET body secara tidak konsisten. Untuk frontend web, hindari desain yang bergantung pada GET body.

---

## 2. Resource, Representation, Payload, dan Body

Istilah ini sering dicampur. Untuk engineering yang presisi, bedakan.

### 2.1 Resource

Resource adalah sesuatu yang diidentifikasi oleh URL.

Contoh:

```text
/users/123
/invoices/INV-2026-001
/products?category=book
```

Resource bukan body. Resource adalah target konseptual.

### 2.2 Representation

Representation adalah bentuk komunikasi dari state resource.

Satu resource bisa punya banyak representation:

```text
/users/123
├── application/json
├── text/html
├── application/xml
└── application/problem+json
```

Dalam browser/frontend, representation biasanya berupa:

- HTML document
- CSS stylesheet
- JavaScript module
- JSON API response
- image
- font
- video chunk
- file download
- error payload
- streaming event

### 2.3 Body

Body adalah bagian message yang membawa byte stream.

Body bisa membawa representation, tetapi tidak semua message punya body.

Contoh response dengan body:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":123,"name":"Ayu"}
```

Contoh response tanpa body:

```http
HTTP/1.1 204 No Content
```

### 2.4 Payload

Payload sering dipakai sebagai istilah praktis untuk “data yang dibawa request/response”. Dalam HTTP modern, istilah representation lebih presisi, tetapi dalam percakapan engineering sehari-hari payload masih umum.

Gunakan mental model ini:

```text
payload/body = byte yang dikirim
representation = body + metadata yang menjelaskan maknanya
resource = target konseptual yang direpresentasikan
```

---

## 3. Representation Metadata

Representation data tidak bisa dipahami tanpa metadata.

Header penting:

```text
Content-Type       -> tipe media asli representation
Content-Encoding   -> transformasi encoding terhadap representation, biasanya compression
Content-Language   -> bahasa target representation
Content-Location   -> lokasi alternatif/khusus representation
Content-Length     -> ukuran body dalam byte, bila diketahui
Transfer-Encoding  -> framing/transfer level, terutama historis HTTP/1.1 chunked
```

Pemisahan penting:

```text
Content-Type      menjawab: data ini formatnya apa?
Content-Encoding  menjawab: data ini dikodekan/dikompresi bagaimana?
Transfer-Encoding menjawab: data ini dikirim di wire bagaimana?
```

Contoh:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Content-Encoding: gzip

<gzip-compressed bytes>
```

Makna sebenarnya:

```text
representation type: JSON
representation encoded as: gzip
wire body: compressed bytes
consumer sees after decoding: JSON bytes/text
```

Di browser, decompression biasanya ditangani otomatis oleh network stack. JavaScript umumnya menerima body yang sudah didekode dari content encoding, bukan raw gzip bytes, kecuali konteks tertentu seperti download raw file yang memang dikirim sebagai media type tertentu.

---

## 4. `Content-Type` vs `Accept`

Dua header ini sering tertukar.

### 4.1 `Content-Type`

`Content-Type` menjelaskan body yang sedang dikirim.

Pada request:

```http
POST /users HTTP/1.1
Content-Type: application/json

{"name":"Ayu"}
```

Artinya:

```text
Client mengirim body berformat JSON.
```

Pada response:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":123,"name":"Ayu"}
```

Artinya:

```text
Server mengirim body berformat JSON.
```

### 4.2 `Accept`

`Accept` menjelaskan format response yang diinginkan client.

```http
GET /users/123 HTTP/1.1
Accept: application/json
```

Artinya:

```text
Client lebih memilih response application/json.
```

`Accept` tidak menjelaskan request body. Untuk request body, gunakan `Content-Type`.

### 4.3 Kesalahan Umum

Salah:

```http
POST /users HTTP/1.1
Accept: application/json

{"name":"Ayu"}
```

Jika tidak ada `Content-Type`, server belum tentu tahu body itu JSON.

Salah juga:

```http
GET /users/123 HTTP/1.1
Content-Type: application/json
```

GET biasanya tidak punya body. Header `Content-Type` pada GET tanpa body umumnya tidak bermakna dan dapat memicu kebingungan, termasuk pada CORS/preflight jika dikombinasikan dengan header tertentu.

---

## 5. Media Type: Bahasa Kontrak Body

Media type memberi nama format representation.

Format umum:

```text
type/subtype; parameter=value
```

Contoh:

```text
application/json
text/html; charset=utf-8
text/plain; charset=utf-8
multipart/form-data; boundary=----WebKitFormBoundary...
application/x-www-form-urlencoded
application/problem+json
application/octet-stream
image/png
font/woff2
```

### 5.1 `application/json`

Paling umum untuk API modern.

```http
Content-Type: application/json

{"id":123,"name":"Ayu"}
```

Frontend:

```js
const response = await fetch('/api/users/123');
const data = await response.json();
```

Tetapi jangan otomatis parse semua response sebagai JSON. Pastikan status dan content type sesuai.

### 5.2 `text/html`

Digunakan untuk document HTML.

```http
Content-Type: text/html; charset=utf-8

<!doctype html>
<html>...</html>
```

Bug umum: backend/gateway mengirim HTML error page untuk API, tetapi frontend memanggil `response.json()`.

Gejala:

```text
SyntaxError: Unexpected token '<', "<!doctype" is not valid JSON
```

Maknanya hampir selalu:

```text
Client mengira response JSON, tetapi body diawali HTML.
```

### 5.3 `text/plain`

Bisa digunakan untuk plain text response.

```http
Content-Type: text/plain; charset=utf-8

OK
```

Untuk API kompleks, jangan pakai `text/plain` untuk mengirim JSON string. Itu merusak contract.

### 5.4 `application/x-www-form-urlencoded`

Format klasik HTML form.

```text
name=Ayu&role=admin
```

Frontend:

```js
const body = new URLSearchParams();
body.set('name', 'Ayu');
body.set('role', 'admin');

await fetch('/users', {
  method: 'POST',
  body
});
```

Browser akan set content type yang sesuai.

### 5.5 `multipart/form-data`

Dipakai untuk form kompleks, terutama upload file.

```js
const form = new FormData();
form.append('name', 'Ayu');
form.append('avatar', fileInput.files[0]);

await fetch('/profile/avatar', {
  method: 'POST',
  body: form
});
```

Aturan penting:

```text
Jangan set Content-Type multipart/form-data secara manual saat memakai FormData di browser.
```

Kenapa?

Karena browser harus membuat boundary.

Salah:

```js
await fetch('/upload', {
  method: 'POST',
  headers: {
    'Content-Type': 'multipart/form-data'
  },
  body: form
});
```

Benar:

```js
await fetch('/upload', {
  method: 'POST',
  body: form
});
```

Browser akan menghasilkan header seperti:

```http
Content-Type: multipart/form-data; boundary=----WebKitFormBoundaryxYz...
```

Tanpa boundary, server tidak bisa memisahkan part.

### 5.6 `application/octet-stream`

Generic binary stream.

Digunakan jika tipe binary tidak lebih spesifik.

Contoh:

```http
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="report.bin"
```

Untuk file yang diketahui, lebih baik gunakan media type spesifik:

```text
application/pdf
image/png
text/csv
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
```

---

## 6. Charset dan Text Decoding

Untuk text, bytes harus diterjemahkan menjadi character.

Contoh:

```http
Content-Type: application/json; charset=utf-8
```

Pada web modern, UTF-8 adalah default yang paling aman dan paling umum.

Masalah terjadi ketika:

- server mengirim bytes bukan UTF-8;
- header charset salah;
- frontend membaca binary sebagai text;
- file CSV memakai encoding legacy;
- backend menulis response dengan encoding berbeda dari header.

Contoh bug:

```text
Nama: José
Muncul sebagai: JosÃ©
```

Ini biasanya tanda UTF-8 bytes dibaca sebagai Latin-1/Windows-1252 atau sebaliknya.

Untuk frontend API modern:

```text
Gunakan UTF-8 secara eksplisit dan konsisten.
```

---

## 7. Body Tidak Selalu Ada

Tidak semua HTTP message punya body. Ini sangat penting untuk parser frontend.

### 7.1 Response yang Tidak Boleh/Seharusnya Tidak Diparse Body

Umumnya:

```text
204 No Content
205 Reset Content
304 Not Modified
HEAD response
```

Contoh:

```http
HTTP/1.1 204 No Content
```

Frontend salah:

```js
const response = await fetch('/api/users/123', { method: 'DELETE' });
const data = await response.json(); // bisa error karena body kosong
```

Frontend lebih aman:

```js
const response = await fetch('/api/users/123', { method: 'DELETE' });

if (response.status === 204) {
  return null;
}

return await response.json();
```

### 7.2 Empty Body vs Empty JSON Object

Ini berbeda:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{}
```

Berbeda dari:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 0
```

Yang pertama adalah JSON valid. Yang kedua adalah body kosong; `response.json()` akan gagal karena empty string bukan JSON valid.

Jika contract mengatakan response JSON, server sebaiknya mengirim JSON valid:

```json
{}
```

atau:

```json
[]
```

Jangan mengirim body kosong dengan `Content-Type: application/json` kecuali client memang didesain untuk itu.

---

## 8. Fetch Response Body adalah Stream Sekali Pakai

Dalam Fetch API, response body adalah stream. Banyak method seperti `.json()`, `.text()`, `.blob()`, dan `.arrayBuffer()` membaca stream sampai selesai.

Implikasi:

```js
const response = await fetch('/api/users/123');

const text = await response.text();
const json = await response.json(); // error: body already consumed
```

Body hanya bisa dikonsumsi sekali.

Jika butuh membaca dua cara untuk debugging:

```js
const response = await fetch('/api/users/123');
const clone = response.clone();

const text = await clone.text();
console.log(text);

const data = await response.json();
```

Tetapi `clone()` bukan solusi gratis. Untuk response besar, cloning dapat meningkatkan penggunaan memory/buffering.

---

## 9. Safe JSON Parsing Pattern

Banyak client layer terlalu optimistis:

```js
const response = await fetch(url);
return response.json();
```

Ini rapuh karena:

- status bisa 204;
- server bisa mengirim HTML error page;
- body bisa kosong;
- content type bisa salah;
- JSON bisa malformed;
- response bisa binary;
- response bisa stream.

Pattern lebih defensif:

```js
async function parseJsonResponse(response) {
  if (response.status === 204 || response.status === 205 || response.status === 304) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json') || contentType.includes('+json');

  const text = await response.text();

  if (!text) {
    return null;
  }

  if (!isJson) {
    throw new Error(`Expected JSON but received Content-Type: ${contentType}`);
  }

  return JSON.parse(text);
}
```

Kenapa baca `text()` dulu?

Karena untuk error handling, logging, dan diagnostic, Anda sering butuh raw response text. `response.json()` langsung membuang konteks jika parsing gagal.

Production-grade version perlu:

- membatasi ukuran text yang dilog;
- tidak melog PII/token;
- menyertakan status, URL, method, trace ID;
- membedakan parse error vs HTTP error;
- menyimpan body snippet maksimum, bukan full body.

---

## 10. Request Body dari Browser

Browser `fetch()` menerima beberapa tipe body:

```text
string
Blob
ArrayBuffer
TypedArray / DataView
FormData
URLSearchParams
ReadableStream
```

### 10.1 JSON Request

```js
await fetch('/api/users', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  body: JSON.stringify({ name: 'Ayu' })
});
```

Checklist:

```text
[ ] Method cocok dengan intent?
[ ] Content-Type sesuai body?
[ ] Accept sesuai response yang diharapkan?
[ ] JSON.stringify dipakai?
[ ] Undefined/null behavior dipahami?
[ ] CORS preflight implication dipahami?
```

Catatan penting: `Content-Type: application/json` pada cross-origin request biasanya membuat request tidak termasuk simple request dan dapat memicu preflight.

### 10.2 URL Encoded Request

```js
const params = new URLSearchParams();
params.set('username', 'ayu');
params.set('password', 'secret');

await fetch('/login', {
  method: 'POST',
  body: params
});
```

Browser akan mengirim format form-urlencoded.

### 10.3 Multipart Request

```js
const form = new FormData();
form.append('title', 'Quarterly Report');
form.append('file', file);

await fetch('/documents', {
  method: 'POST',
  body: form
});
```

Jangan set boundary manual.

### 10.4 Binary Request

```js
await fetch('/upload/raw', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/octet-stream'
  },
  body: file
});
```

Untuk raw file upload, backend harus tahu metadata file dari header, query, path, atau side channel lain, karena body hanya binary stream.

---

## 11. Response Body Reading Choices

Pilih method sesuai tipe data.

| Response type | Fetch method | Output |
|---|---:|---|
| JSON API | `response.json()` atau safe parser | JS value |
| Plain text / HTML | `response.text()` | string |
| File download | `response.blob()` | Blob |
| Binary protocol | `response.arrayBuffer()` | ArrayBuffer |
| Form data | `response.formData()` | FormData |
| Streaming | `response.body.getReader()` | stream chunks |

### 11.1 JSON

```js
const data = await response.json();
```

Cocok jika Anda yakin body JSON valid dan tidak kosong.

### 11.2 Text

```js
const text = await response.text();
```

Cocok untuk HTML, plain text, atau diagnostic parsing.

### 11.3 Blob

```js
const blob = await response.blob();
const url = URL.createObjectURL(blob);
```

Cocok untuk download file, image preview, PDF preview.

Jangan lupa cleanup:

```js
URL.revokeObjectURL(url);
```

### 11.4 ArrayBuffer

```js
const buffer = await response.arrayBuffer();
```

Cocok untuk binary processing, WebCrypto, WASM, custom parser.

### 11.5 Stream

```js
const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value, { stream: true });
  console.log(chunk);
}
```

Cocok untuk response besar atau progressive rendering, tetapi membutuhkan handling backpressure, cancellation, dan partial data.

---

## 12. File Download Contract

File download bukan sekadar `GET`.

Header penting:

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="report.pdf"
Content-Length: 1048576
```

Frontend:

```js
const response = await fetch('/reports/2026.pdf');

if (!response.ok) {
  throw new Error('Download failed');
}

const blob = await response.blob();
const url = URL.createObjectURL(blob);

const a = document.createElement('a');
a.href = url;
a.download = 'report.pdf';
a.click();

URL.revokeObjectURL(url);
```

Jika filename berasal dari server, frontend perlu membaca `Content-Disposition`. Untuk cross-origin response, header itu tidak otomatis readable oleh JavaScript kecuali server mengeksposnya:

```http
Access-Control-Expose-Headers: Content-Disposition
```

Tanpa itu, header terlihat di DevTools tetapi tidak bisa dibaca oleh JS.

---

## 13. File Upload Contract

Upload perlu dipikirkan sebagai state machine, bukan satu request sederhana.

Pertanyaan desain:

```text
[ ] Apakah ukuran file dibatasi di frontend dan backend?
[ ] Apakah media type divalidasi?
[ ] Apakah extension dipercaya? Seharusnya tidak.
[ ] Apakah upload butuh progress?
[ ] Apakah upload bisa dibatalkan?
[ ] Apakah upload bisa di-resume?
[ ] Apakah metadata dikirim bersama file?
[ ] Apakah virus scanning asynchronous?
[ ] Apakah upload menghasilkan resource final atau temporary object?
[ ] Apakah response 201, 202, atau 204?
```

### 13.1 Upload dengan Progress

`fetch()` modern belum menyediakan upload progress event yang universal seperti XHR. Untuk progress upload di browser, `XMLHttpRequest` masih sering digunakan.

```js
const xhr = new XMLHttpRequest();
xhr.open('POST', '/upload');

xhr.upload.onprogress = (event) => {
  if (event.lengthComputable) {
    const percent = Math.round((event.loaded / event.total) * 100);
    console.log(percent);
  }
};

const form = new FormData();
form.append('file', file);
xhr.send(form);
```

### 13.2 Large Upload

Untuk file besar, pertimbangkan:

- direct-to-object-storage upload;
- signed URL;
- multipart/chunk upload;
- resumable upload protocol;
- checksum;
- server-side finalization step;
- asynchronous scan/process status.

HTTP contract bisa menjadi:

```text
1. POST /uploads/initiate
2. PUT signed upload URL per chunk/object
3. POST /uploads/{id}/complete
4. GET /uploads/{id}/status
```

Untuk frontend, ini bukan lagi “upload button”, tapi workflow dengan state:

```text
idle -> selecting -> validating -> initiating -> uploading -> finalizing -> processing -> complete
                                             \-> failed
                                             \-> canceled
```

---

## 14. Compression: `Content-Encoding`

Compression mengurangi bytes yang dikirim melalui network.

Umum:

```text
gzip
br
zstd
```

Browser mengirim:

```http
Accept-Encoding: gzip, deflate, br, zstd
```

Server/CDN bisa menjawab:

```http
Content-Encoding: br
Content-Type: application/javascript
```

Artinya:

```text
Aslinya JavaScript, dikompresi Brotli saat dikirim.
```

Yang perlu dipahami frontend:

1. DevTools sering menunjukkan ukuran transfer dan decoded size berbeda.
2. `Content-Length` bisa merepresentasikan compressed length, bukan decoded length, tergantung konteks transfer.
3. Response yang sangat kecil kadang tidak dikompresi karena overhead tidak worth it.
4. Binary format seperti JPEG/PNG/MP4 biasanya sudah compressed; recompress tidak banyak membantu.
5. JSON, HTML, CSS, JS biasanya sangat compressible.

Performance implication:

```text
Large JSON response mungkin terlihat “hanya” 500 KB over network, tetapi setelah decoded dan parsed bisa menjadi puluhan MB object graph di memory.
```

Jangan hanya optimasi transfer size. Perhatikan juga:

- parse time;
- memory allocation;
- GC pressure;
- main thread blocking;
- rendering cost.

---

## 15. `Content-Length`, Chunked Transfer, dan Streaming

### 15.1 `Content-Length`

Memberi tahu ukuran body dalam byte.

```http
Content-Length: 3492
```

Berguna untuk:

- progress download;
- connection management;
- validation;
- debugging;
- proxy behavior.

Tetapi tidak selalu tersedia, terutama pada streaming atau dynamically generated response.

### 15.2 Chunked Transfer

Pada HTTP/1.1, server bisa mengirim response tanpa tahu total length di awal dengan chunked transfer.

```http
Transfer-Encoding: chunked
```

Di level browser JS, Anda biasanya tidak memproses chunk framing HTTP secara manual. Anda melihat stream data melalui Fetch Streams API.

### 15.3 Streaming Response

Streaming berguna untuk:

- progressive rendering;
- large export;
- AI/token streaming;
- log tailing;
- newline-delimited JSON;
- server-sent events;
- incremental data processing.

Tetapi streaming membawa kompleksitas:

```text
[ ] Bagaimana partial data direpresentasikan?
[ ] Bagaimana error di tengah stream ditangani?
[ ] Bagaimana cancellation bekerja?
[ ] Bagaimana timeout idle dibedakan dari stream selesai?
[ ] Bagaimana retry/resume?
[ ] Bagaimana backpressure?
[ ] Bagaimana proxy buffering memengaruhi streaming?
```

---

## 16. JSON sebagai Contract: Kuat tapi Tidak Ajaib

JSON adalah format data, bukan contract lengkap.

JSON tidak menyatakan:

- field required atau optional;
- string format;
- enum valid;
- number range;
- nullable atau absent semantics;
- backward compatibility policy;
- timestamp timezone;
- decimal precision;
- error shape;
- pagination semantics.

Maka API contract perlu lebih dari `Content-Type: application/json`.

Minimal contract:

```json
{
  "id": "user_123",
  "name": "Ayu",
  "status": "ACTIVE",
  "createdAt": "2026-06-18T10:15:30Z"
}
```

Pertanyaan yang harus dijawab:

```text
[ ] Apakah id string atau number?
[ ] Apakah name nullable?
[ ] Apakah status enum?
[ ] Apakah createdAt selalu UTC?
[ ] Apakah field baru boleh ditambahkan?
[ ] Apakah client boleh mengabaikan unknown fields?
[ ] Apakah absent berbeda dari null?
```

### 16.1 Null vs Missing

Berbeda:

```json
{"middleName": null}
```

vs:

```json
{}
```

Kemungkinan makna:

```text
null    -> field diketahui kosong
missing -> field tidak diminta, tidak tersedia, tidak authorized, atau versi lama
```

Jika backend tidak konsisten, UI logic menjadi rapuh.

### 16.2 Number Precision

JavaScript number adalah IEEE 754 double. Integer besar bisa kehilangan presisi.

Masalah:

```json
{"id": 9223372036854775807}
```

Di JavaScript, ini tidak aman sebagai integer presisi penuh.

Untuk ID dari Java `long`, pertimbangkan kirim sebagai string:

```json
{"id": "9223372036854775807"}
```

### 16.3 Date/Time

Jangan kirim format ambigu:

```json
{"createdAt": "18/06/2026 10:00"}
```

Lebih baik:

```json
{"createdAt": "2026-06-18T03:00:00Z"}
```

atau jika domain memang local date:

```json
{"birthDate": "1990-05-21"}
```

Bedakan:

```text
instant timestamp -> titik waktu global
local date        -> tanggal tanpa timezone
local datetime    -> waktu lokal, butuh timezone context
```

---

## 17. Error Body Juga Representation

Error bukan sekadar status code. Error response body juga harus punya media type dan contract.

Buruk:

```http
HTTP/1.1 400 Bad Request
Content-Type: text/plain

Invalid input
```

Lebih baik:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more fields are invalid.",
  "errors": [
    { "field": "email", "code": "INVALID_EMAIL", "message": "Email format is invalid." }
  ],
  "traceId": "00-..."
}
```

Frontend bisa memetakan:

```text
HTTP status -> kategori outcome
error code  -> domain-specific handling
field error -> inline form rendering
trace ID    -> support/observability
```

Ingat: error body juga bisa gagal parse. Maka error handling harus defensif.

---

## 18. CORS dan Body: Hidden Coupling

Body dan media type memengaruhi CORS.

Cross-origin request tertentu dianggap “simple request” jika memenuhi batasan method dan header tertentu. `Content-Type` yang simple terbatas pada beberapa nilai seperti:

```text
application/x-www-form-urlencoded
multipart/form-data
text/plain
```

`application/json` bukan simple content type untuk CORS, sehingga cross-origin JSON POST biasanya memicu preflight.

Implikasi desain:

```text
Frontend menambahkan Content-Type: application/json
-> Browser melakukan OPTIONS preflight
-> Server/gateway tidak mengizinkan OPTIONS
-> Browser memblokir actual POST
-> Developer melihat “CORS error”
```

Ini bukan bug JSON. Ini konsekuensi body media type + browser security policy.

Jangan menyiasati dengan mengirim JSON sebagai `text/plain` hanya demi menghindari preflight. Itu mengorbankan contract correctness dan bisa membuka masalah security/observability.

---

## 19. Body dan Security

Body bisa membawa data sensitif.

Prinsip:

```text
Jangan log body secara sembarang.
Jangan taruh secret di body jika tidak perlu.
Jangan percaya Content-Type dari client.
Jangan percaya filename dari multipart.
Jangan percaya MIME type dari browser.
Validasi di server tetap wajib.
```

### 19.1 Request Body Logging

Bahaya:

- password;
- token;
- PII;
- dokumen pribadi;
- payment data;
- health/regulatory data;
- internal notes.

Jika logging dibutuhkan:

```text
[ ] redaction
[ ] size limit
[ ] sampling
[ ] environment gating
[ ] access control
[ ] retention policy
[ ] audit trail
```

### 19.2 JSON Injection / XSSI Context

Untuk API JSON modern dengan CORS dan correct content type, risiko historis tertentu jauh berkurang, tetapi tetap pastikan:

- response API memakai `application/json`;
- tidak menyajikan JSON sebagai executable JS;
- `X-Content-Type-Options: nosniff` dipertimbangkan;
- CSP dipakai untuk mengurangi script injection impact;
- jangan embed unescaped JSON langsung ke HTML.

### 19.3 File Upload Security

Frontend validation hanya UX, bukan security boundary.

Server harus validasi:

- size;
- actual content sniffing;
- extension;
- magic bytes;
- malware scan;
- authorization;
- storage path;
- filename normalization;
- content disposition on download;
- access control.

Frontend bisa membantu:

```text
[ ] reject file terlalu besar sebelum upload
[ ] tampilkan accepted file types
[ ] preview aman
[ ] informasikan progress
[ ] cancel upload
[ ] handle async scanning status
```

---

## 20. Memory dan Performance Pitfalls

### 20.1 `response.json()` Memuat Seluruh Body

`response.json()` membaca body sampai selesai lalu parse. Untuk response besar:

```text
network bytes -> decoded text -> parsed JS objects -> rendered UI
```

Setiap tahap bisa mahal.

Masalah:

- tab freeze;
- memory spike;
- garbage collection;
- slow rendering;
- mobile device crash;
- long task;
- bad INP/LCP depending interaction path.

Solusi desain:

- pagination;
- filtering server-side;
- field selection;
- streaming;
- compression;
- normalized data;
- virtualized rendering;
- avoid mega endpoint;
- avoid nested object explosion.

### 20.2 Base64 Overhead

Mengirim binary sebagai base64 di JSON menambah overhead sekitar 33% sebelum compression dan menambah parsing/memory cost.

Buruk untuk file besar:

```json
{
  "filename": "photo.png",
  "contentBase64": "iVBORw0KGgoAAA..."
}
```

Lebih baik:

- multipart upload;
- direct binary upload;
- signed URL;
- separate metadata and file upload.

### 20.3 Large Error Body

Error response juga bisa besar, terutama stack trace HTML atau proxy error page.

Client layer sebaiknya membatasi diagnostic body snippet:

```js
const MAX_ERROR_SNIPPET = 2048;
const snippet = text.slice(0, MAX_ERROR_SNIPPET);
```

---

## 21. Backend Java Perspective: What Frontend Needs from You

Karena Anda berlatar Java, penting melihat mapping server-side.

### 21.1 Spring / Jackson Example

Backend:

```java
@PostMapping(
    value = "/users",
    consumes = MediaType.APPLICATION_JSON_VALUE,
    produces = MediaType.APPLICATION_JSON_VALUE
)
public ResponseEntity<UserResponse> createUser(@RequestBody CreateUserRequest request) {
    UserResponse response = service.create(request);
    return ResponseEntity.status(HttpStatus.CREATED).body(response);
}
```

Kontrak jelas:

```text
consumes -> request Content-Type yang diterima
produces -> response Content-Type yang dihasilkan
status   -> semantic outcome
body     -> representation
```

Jika frontend mengirim `text/plain`, server harus menolak dengan jelas, misalnya `415 Unsupported Media Type`.

Jika frontend meminta format yang tidak didukung, server bisa merespons `406 Not Acceptable`.

### 21.2 Common Java Backend Mistakes Affecting Frontend

```text
[ ] Mengembalikan HTML error page dari API gateway
[ ] Tidak set Content-Type eksplisit
[ ] Mengembalikan 200 dengan body error string
[ ] Mengembalikan empty body padahal client expect JSON
[ ] Mengirim long ID sebagai JSON number
[ ] Date/time tanpa timezone
[ ] Field null/missing tidak konsisten
[ ] Multipart endpoint tidak jelas field name-nya
[ ] File download tanpa Content-Disposition
[ ] Error envelope berbeda antar service
[ ] Compression aktif hanya di proxy, tidak di local test
```

### 21.3 Contract as Defensive Boundary

Frontend dan backend perlu menyepakati:

```text
Request:
- method
- URL
- required headers
- request media type
- request schema
- max body size
- auth/credential mode

Response:
- status codes
- response media type per status
- success schema
- error schema
- empty response behavior
- caching headers
- exposed headers for browser
```

---

## 22. Browser DevTools: How to Inspect Body Correctly

Di Network tab, per request lihat:

```text
Headers
├── Request Headers
├── Response Headers
Payload / Request Payload / Form Data
Response / Preview
Timing
```

### 22.1 Request Payload

Periksa:

```text
[ ] Apakah body benar-benar terkirim?
[ ] Apakah JSON valid?
[ ] Apakah field name sesuai contract?
[ ] Apakah Content-Type sesuai?
[ ] Apakah FormData field name benar?
[ ] Apakah file masuk sebagai part?
[ ] Apakah body kosong karena JSON.stringify lupa?
```

Bug umum:

```js
await fetch('/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: { name: 'Ayu' }
});
```

Salah karena `body` object akan dikonversi tidak seperti yang diinginkan. Gunakan:

```js
body: JSON.stringify({ name: 'Ayu' })
```

### 22.2 Response

Periksa:

```text
[ ] Status code apa?
[ ] Content-Type apa?
[ ] Body kosong atau ada?
[ ] Body JSON valid?
[ ] Body error HTML?
[ ] Response compressed?
[ ] Content-Length masuk akal?
[ ] Header yang dibutuhkan JS diekspos?
```

### 22.3 Preview vs Response

DevTools Preview adalah interpretasi browser. Response adalah body mentah yang lebih dekat ke actual decoded content.

Jika Preview bagus tapi JS gagal, mungkin:

- body sudah consumed;
- CORS header tidak expose;
- parse path berbeda;
- response intercepted service worker;
- code membaca response sebagai tipe salah.

---

## 23. Practical API Client Design for Body Handling

HTTP client layer frontend sebaiknya punya fungsi parsing terpusat.

Contoh desain:

```js
class HttpError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'HttpError';
    this.details = details;
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...options.headers
    },
    body: options.body && !(options.body instanceof FormData)
      ? JSON.stringify(options.body)
      : options.body
  });

  const data = await parsePossiblyJson(response);

  if (!response.ok) {
    throw new HttpError(`HTTP ${response.status}`, {
      status: response.status,
      data
    });
  }

  return data;
}

async function parsePossiblyJson(response) {
  if ([204, 205, 304].includes(response.status)) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (!text) return null;

  if (contentType.includes('application/json') || contentType.includes('+json')) {
    return JSON.parse(text);
  }

  return text;
}
```

Catatan:

- Jangan otomatis set `Content-Type` saat body adalah `FormData`.
- Jangan parse `204` sebagai JSON.
- Jangan assume semua error body JSON.
- Jangan hilangkan raw diagnostic context sepenuhnya.

---

## 24. Contract Matrix: Body by Use Case

| Use case | Request body | Request `Content-Type` | Response body | Response `Content-Type` |
|---|---|---|---|---|
| Read resource | none | none | JSON | `application/json` |
| Create resource | JSON | `application/json` | created resource | `application/json` |
| Delete resource | optional/none | usually none | none or deletion result | none or `application/json` |
| Validation error | JSON request | `application/json` | error envelope | `application/problem+json` or `application/json` |
| Form login | form params | `application/x-www-form-urlencoded` | redirect or JSON | depends flow |
| File upload | multipart | browser-generated multipart | metadata/status | `application/json` |
| File download | none | none | binary/file | actual file media type |
| Async operation | JSON | `application/json` | operation resource | `application/json` |
| Stream | maybe JSON | `application/json` | chunks/events | `text/event-stream`, NDJSON, etc. |

---

## 25. Failure Model

### 25.1 JSON Parse Failure

Symptom:

```text
Unexpected end of JSON input
```

Possible causes:

```text
[ ] Body kosong
[ ] Response truncated
[ ] 204 parsed as JSON
[ ] Server closed connection early
[ ] Proxy issue
```

Symptom:

```text
Unexpected token '<'
```

Possible causes:

```text
[ ] HTML error page
[ ] SPA fallback returned index.html for API path
[ ] Gateway login redirect returned HTML
[ ] 404 page returned HTML
```

Symptom:

```text
body stream already read
```

Possible causes:

```text
[ ] response.text() then response.json()
[ ] logging middleware consumed body
[ ] interceptor consumed body
```

### 25.2 Backend Receives Empty Body

Possible causes:

```text
[ ] Missing JSON.stringify
[ ] Body not attached
[ ] Wrong method
[ ] Service worker/proxy modification
[ ] CORS preflight failed, actual request never sent
[ ] Server body parser not configured
[ ] Content-Type unsupported
[ ] Request exceeded size limit
```

### 25.3 Multipart Fails

Possible causes:

```text
[ ] Content-Type set manually without boundary
[ ] Field name mismatch
[ ] File size exceeds limit
[ ] Backend expects single file, frontend sends multiple
[ ] Backend multipart parser disabled
[ ] Proxy max body size too small
[ ] Upload timeout
```

### 25.4 Download Corrupt

Possible causes:

```text
[ ] Read as text instead of blob/arrayBuffer
[ ] Incorrect Content-Type
[ ] Server sends error JSON but frontend saves as file
[ ] Compression/proxy issue
[ ] Partial response
[ ] Auth redirect HTML saved as file
```

---

## 26. Design Rules You Can Use in Review

Gunakan rules berikut saat review API/frontend PR.

### 26.1 Request Body Rules

```text
1. Body harus punya media type yang benar.
2. JSON body harus di-JSON.stringify oleh frontend.
3. FormData tidak boleh diberi Content-Type manual.
4. GET body tidak boleh dipakai sebagai contract web frontend.
5. Request body size harus punya batas eksplisit.
6. Sensitive body tidak boleh dilog tanpa redaction.
7. File upload harus punya validation dan failure states.
```

### 26.2 Response Body Rules

```text
1. Response body harus sesuai status code.
2. 204/205/304 tidak boleh diparse sebagai JSON.
3. Error body harus punya shape konsisten.
4. File download harus punya Content-Type dan Content-Disposition.
5. JSON ID besar lebih aman sebagai string.
6. Date/time harus tidak ambigu.
7. Large response harus dipertanyakan sebelum diterima.
```

### 26.3 Frontend Client Rules

```text
1. Jangan scatter response.json() tanpa guard.
2. Jangan assume semua error body JSON.
3. Jangan consume body dua kali tanpa clone dan alasan jelas.
4. Jangan parse binary sebagai text.
5. Jangan simpan Blob URL tanpa revoke.
6. Jangan mengabaikan Content-Type.
7. Jangan membuat client layer yang menyembunyikan status code penting.
```

---

## 27. Latihan Praktis

### Latihan 1 — Debug Empty JSON

Backend mengembalikan:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 0
```

Frontend:

```js
const data = await response.json();
```

Pertanyaan:

1. Apa yang terjadi?
2. Apakah status `200` cukup untuk menyatakan body bisa diparse JSON?
3. Perbaikan paling benar di backend apa?
4. Perbaikan defensif di frontend apa?

Jawaban yang diharapkan:

```text
response.json() gagal karena body kosong bukan JSON valid.
Backend harus mengirim JSON valid seperti {} atau [] jika contract JSON,
atau memakai 204 jika memang tidak ada content.
Frontend harus guard status/body sebelum parsing.
```

### Latihan 2 — Multipart Boundary

Frontend:

```js
const form = new FormData();
form.append('file', file);

await fetch('/upload', {
  method: 'POST',
  headers: { 'Content-Type': 'multipart/form-data' },
  body: form
});
```

Pertanyaan:

1. Apa bug-nya?
2. Kenapa Postman mungkin berhasil?
3. Apa fix-nya?

Jawaban:

```text
Header multipart/form-data manual tidak menyertakan boundary.
Browser seharusnya membuat Content-Type lengkap dengan boundary.
Hapus header Content-Type saat body FormData.
```

### Latihan 3 — HTML Error Page

Error frontend:

```text
Unexpected token '<', "<!doctype" is not valid JSON
```

Pertanyaan:

1. Apa kemungkinan besar isi response?
2. Di DevTools tab mana Anda cek?
3. Apa kemungkinan root cause?

Jawaban:

```text
Response kemungkinan HTML, bukan JSON.
Cek Network -> Response dan Headers -> Content-Type.
Kemungkinan API path diarahkan ke SPA fallback, gateway login page, 404 HTML,
atau reverse proxy error page.
```

### Latihan 4 — Large JSON Freeze

API mengembalikan 50.000 rows JSON. Network transfer hanya 2 MB compressed, tetapi UI freeze.

Pertanyaan:

1. Kenapa transfer size kecil tidak menjamin cepat?
2. Tahap apa saja yang mahal?
3. Solusi desain apa?

Jawaban:

```text
Compressed transfer hanya satu tahap. Setelah diterima, body harus didecode,
diparse menjadi object graph, dialokasikan di memory, lalu dirender.
Solusi: pagination, filtering server-side, virtualization, field selection,
streaming, atau desain endpoint ulang.
```

---

## 28. Checklist Diagnostik Cepat

Saat ada bug body/payload, jalankan checklist ini:

```text
[ ] Method apa?
[ ] Status code apa?
[ ] Request punya body atau tidak?
[ ] Response punya body atau tidak?
[ ] Content-Type request benar?
[ ] Content-Type response benar?
[ ] Body kosong atau tidak?
[ ] JSON valid atau tidak?
[ ] Body dibaca sebagai tipe yang benar?
[ ] Body pernah dikonsumsi sebelumnya?
[ ] Ada compression?
[ ] Ada redirect ke HTML login/error page?
[ ] Ada CORS/preflight yang mencegah actual request?
[ ] Ada service worker yang intercept?
[ ] Ada proxy/CDN/gateway yang mengubah body/header?
[ ] Ukuran body masuk akal?
[ ] Ada data sensitif yang tidak sengaja dilog?
```

---

## 29. Ringkasan Mental Model

HTTP body adalah byte stream. Byte stream itu baru bermakna ketika dikaitkan dengan representation metadata dan protocol semantics.

Pemisahan paling penting:

```text
Resource         -> hal yang diidentifikasi URL
Representation   -> bentuk komunikasi state resource
Body             -> byte stream dalam message
Content-Type     -> format representation
Content-Encoding -> encoding/compression representation
Accept           -> format response yang diinginkan client
```

Frontend engineer top-tier tidak hanya menulis:

```js
await response.json()
```

Mereka bertanya:

```text
Apakah response ini memang punya body?
Apakah body ini memang JSON?
Apa yang terjadi jika body kosong?
Apa yang terjadi jika gateway mengirim HTML?
Apa yang terjadi jika response terlalu besar?
Apa yang terjadi jika body sudah consumed?
Apa contract error body-nya?
Apa implication-nya terhadap CORS, cache, security, dan observability?
```

---

## 30. Referensi Utama

- RFC 9110 — HTTP Semantics. Terutama bagian representation dan representation metadata.
- MDN Web Docs — `Content-Type` HTTP header.
- MDN Web Docs — Using the Fetch API.
- MDN Web Docs — `Response.json()`.
- MDN Web Docs — `Response.text()`.
- MDN Web Docs — `Response.arrayBuffer()`.
- MDN Web Docs — `Content-Disposition` HTTP header.

---

## 31. Apa yang Akan Dibahas Selanjutnya

Bagian berikutnya:

```text
learn-http-for-web-frontend-perspective-part-008.md
```

Topik:

```text
Fetch API Mental Model: What fetch() Actually Does
```

Di Part 008, kita akan masuk lebih dalam ke `fetch()` sebagai API browser:

- kenapa `fetch()` tidak reject untuk 404/500;
- apa itu `Request`, `Response`, `Headers`;
- mode, credentials, cache, redirect, referrer;
- AbortController;
- timeout pattern;
- body stream lifecycle;
- common production bug dalam HTTP client layer.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-006.md">⬅️ Part 006 — Headers Deep Dive: The Real Control Plane of HTTP</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-008.md">Part 008 — Fetch API Mental Model: What `fetch()` Actually Does ➡️</a>
</div>

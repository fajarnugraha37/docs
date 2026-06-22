# learn-go-part-030.md

# Go Security Engineering: TLS, x509, crypto APIs, FIPS 140 mode, secret handling, and secure defaults

> Seri: `learn-go`  
> Part: `030` dari `034`  
> Target pembaca: Java software engineer yang ingin naik ke level production-grade Go engineer  
> Target Go: Go 1.26.x  
> Status seri: belum selesai

---

## 0. Tujuan Part Ini

Part 029 membahas messaging dan async systems. Sekarang kita masuk ke security engineering.

Security di Go bukan hanya “pakai HTTPS” atau “import crypto”. Security engineering adalah kemampuan membuat sistem yang:

```text
confidential
integrity-protected
authenticated
authorized
auditable
resilient against misuse
safe by default
observable without leaking secrets
maintainable under vulnerability pressure
```

Sebagai Java engineer, kamu mungkin terbiasa dengan:

```text
JSSE
JCA/JCE
KeyStore
TrustStore
Bouncy Castle
Spring Security
TLS config
JWT libraries
PasswordEncoder
Secret Manager integration
OWASP controls
SAST/DAST/dependency scanning
```

Di Go, standard library menyediakan crypto dan TLS primitives yang kuat:

```go
crypto/tls
crypto/x509
crypto/rand
crypto/sha256
crypto/hmac
crypto/aes
crypto/cipher
crypto/ed25519
crypto/ecdsa
crypto/rsa
crypto/subtle
encoding/pem
```

Tetapi crypto API adalah sharp tool. Salah sedikit bisa menjadi vulnerability.

Target part ini:

1. memahami security boundary di Go service;
2. memahami TLS client/server config;
3. memahami x509 certificate validation;
4. memahami mTLS;
5. memahami random generation;
6. memahami hashing vs MAC vs encryption;
7. memahami AEAD;
8. memahami password hashing;
9. memahami constant-time comparison;
10. memahami token/secret handling;
11. memahami FIPS 140 mode di Go modern;
12. memahami secure HTTP defaults;
13. memahami supply-chain security;
14. memahami testing/review security;
15. membangun security checklist production.

---

## 1. Sumber Resmi dan Rujukan Utama

Rujukan utama:

- Package `crypto/tls`: https://pkg.go.dev/crypto/tls
- Package `crypto/x509`: https://pkg.go.dev/crypto/x509
- Package `crypto/rand`: https://pkg.go.dev/crypto/rand
- Package `crypto/hmac`: https://pkg.go.dev/crypto/hmac
- Package `crypto/sha256`: https://pkg.go.dev/crypto/sha256
- Package `crypto/aes`: https://pkg.go.dev/crypto/aes
- Package `crypto/cipher`: https://pkg.go.dev/crypto/cipher
- Package `crypto/subtle`: https://pkg.go.dev/crypto/subtle
- Package `encoding/pem`: https://pkg.go.dev/encoding/pem
- Go Security: https://go.dev/security/
- Go Vulnerability Management: https://go.dev/doc/security/vuln/
- FIPS 140-3 Compliance: https://go.dev/doc/security/fips140
- Go 1.26 Release Notes: https://go.dev/doc/go1.26
- OWASP Cheat Sheets: https://cheatsheetseries.owasp.org/
- RFC 8446 TLS 1.3: https://www.rfc-editor.org/rfc/rfc8446

Catatan Go 1.26:

- Go menyediakan FIPS 140-3 mode melalui Go Cryptographic Module; `crypto/tls` di FIPS mode akan mengabaikan protokol/cipher/signature/key exchange yang tidak disetujui FIPS 140-3.
- Go 1.26 menambahkan API di area `crypto/fips140` seperti `WithoutEnforcement` dan `Enforced` untuk kasus tertentu saat `GODEBUG=fips140=only`.
- FIPS 140-3 mode tidak didukung di semua platform; dokumentasi Go menyebut pengecualian seperti OpenBSD, Wasm, AIX, dan 32-bit Windows.
- `crypto/rand` adalah sumber random cryptographically secure di standard library.
- Package `crypto/tls` mengimplementasikan TLS 1.2 dan TLS 1.3; TLS 1.3 harus menjadi default modern kecuali compatibility memaksa lain.

---

## 2. Mental Model Besar

### 2.1 Security Is Boundary Discipline

Security boundary:

```text
network boundary
identity boundary
authorization boundary
data-at-rest boundary
data-in-transit boundary
config/secret boundary
process/container boundary
dependency/supply-chain boundary
logging/observability boundary
```

Setiap boundary harus menjawab:

```text
Who is calling?
Can we authenticate them?
Are they authorized?
Is data protected in transit?
Is data protected at rest?
Can input be trusted?
What happens if token leaks?
What is logged?
What is rotated?
What is audited?
```

### 2.2 Crypto Is Not Product Security

Crypto benar tidak cukup jika:

- token bocor di log;
- TLS certificate tidak diverifikasi;
- authz salah;
- secret hardcoded;
- SQL injection;
- SSRF;
- path traversal;
- dependency vulnerable;
- debug endpoint publik;
- pprof publik;
- permissive CORS;
- insecure cookie.

### 2.3 Secure Defaults

Production Go service should default to:

```text
TLS verify on
no InsecureSkipVerify
bounded request body
strict timeout
secrets not logged
least privilege
safe error messages
dependency scanning
secure random
constant-time compare for secrets
short-lived credentials
explicit trust roots
```

---

## 3. TLS Fundamentals

### 3.1 What TLS Provides

TLS provides:

```text
confidentiality
integrity
server authentication
optional client authentication
```

TLS does not provide:

```text
business authorization
input validation
protection after data reaches app
safe logging
database encryption automatically
```

### 3.2 Go TLS Server

```go
srv := &http.Server{
    Addr:              ":8443",
    Handler:           handler,
    ReadHeaderTimeout: 5 * time.Second,
    TLSConfig: &tls.Config{
        MinVersion: tls.VersionTLS12,
    },
}

err := srv.ListenAndServeTLS("server.crt", "server.key")
```

For modern internal systems, prefer TLS 1.3 when possible, but setting `MinVersion: tls.VersionTLS12` is often used for compatibility. Evaluate requirements.

### 3.3 Go TLS Client

```go
tr := &http.Transport{
    TLSClientConfig: &tls.Config{
        MinVersion: tls.VersionTLS12,
    },
}

client := &http.Client{
    Transport: tr,
    Timeout:   10 * time.Second,
}
```

Default client already verifies server certificates using system roots.

### 3.4 Never Use `InsecureSkipVerify` in Production

Bad:

```go
TLSClientConfig: &tls.Config{
    InsecureSkipVerify: true,
}
```

This disables certificate verification and makes MITM possible.

Acceptable only in tightly controlled test code, and even there prefer local test CA.

### 3.5 ServerName

When connecting to IP but certificate has DNS name:

```go
TLSClientConfig: &tls.Config{
    ServerName: "api.internal.example.com",
}
```

Certificate verification checks name.

Do not work around name mismatch with `InsecureSkipVerify`.

### 3.6 TLS Config Mutability

Treat `tls.Config` as immutable after use. Clone before modifying:

```go
cfg := base.Clone()
cfg.ServerName = "service.example.com"
```

---

## 4. x509 Certificates

### 4.1 Certificate Chain

A certificate chain links:

```text
leaf certificate
intermediate CA
root CA
```

Client trusts root CA.

### 4.2 Load Custom Root CA

For private CA:

```go
caPEM, err := os.ReadFile("ca.pem")
if err != nil {
    return err
}

roots := x509.NewCertPool()
if ok := roots.AppendCertsFromPEM(caPEM); !ok {
    return errors.New("no CA certs parsed")
}

tr := &http.Transport{
    TLSClientConfig: &tls.Config{
        RootCAs: roots,
        MinVersion: tls.VersionTLS12,
    },
}
```

### 4.3 Parse Certificate

```go
block, _ := pem.Decode(certPEM)
if block == nil {
    return errors.New("invalid pem")
}

cert, err := x509.ParseCertificate(block.Bytes)
if err != nil {
    return err
}
```

### 4.4 Verification

```go
opts := x509.VerifyOptions{
    DNSName: "service.example.com",
    Roots:   roots,
}

chains, err := cert.Verify(opts)
```

Most HTTP/TLS clients do this automatically. Manual verification is for special use cases.

### 4.5 Certificate Rotation

Plan:

```text
issue new cert before old expires
deploy trust roots before leaf rotation
support overlapping roots during migration
monitor expiration
avoid baking certs into image if frequent rotation
```

### 4.6 Certificate Expiry Monitoring

Monitor:

```text
leaf expiry
intermediate expiry
root expiry
mTLS client cert expiry
```

Cert expiry is common production incident.

---

## 5. mTLS

### 5.1 What mTLS Adds

TLS normally authenticates server to client.

mTLS authenticates both:

```text
client verifies server certificate
server verifies client certificate
```

Useful for service-to-service internal APIs.

### 5.2 Server mTLS Config

```go
caPEM, err := os.ReadFile("client-ca.pem")
if err != nil {
    return err
}

clientCAs := x509.NewCertPool()
if ok := clientCAs.AppendCertsFromPEM(caPEM); !ok {
    return errors.New("invalid client CA")
}

srv := &http.Server{
    Addr:    ":8443",
    Handler: handler,
    TLSConfig: &tls.Config{
        MinVersion: tls.VersionTLS12,
        ClientAuth: tls.RequireAndVerifyClientCert,
        ClientCAs:  clientCAs,
    },
}
```

### 5.3 Client mTLS Config

```go
cert, err := tls.LoadX509KeyPair("client.crt", "client.key")
if err != nil {
    return err
}

tr := &http.Transport{
    TLSClientConfig: &tls.Config{
        Certificates: []tls.Certificate{cert},
        MinVersion:   tls.VersionTLS12,
    },
}
```

### 5.4 Mapping Client Identity

Client certificate gives identity attributes:

```text
Subject
SAN DNS
SAN URI
SAN IP
custom extension
```

Do not blindly trust Common Name for modern identity design. Prefer SAN-based identity.

### 5.5 mTLS Is Authentication, Not Authorization

After mTLS:

```text
identity = service A
```

You still need authz:

```text
is service A allowed to call operation X on resource Y?
```

---

## 6. Randomness

### 6.1 Use `crypto/rand` for Security

```go
b := make([]byte, 32)
if _, err := rand.Read(b); err != nil {
    return err
}
```

`crypto/rand` implements cryptographically secure random generation.

### 6.2 Do Not Use `math/rand` for Security

Bad:

```go
token := rand.Int()
```

from `math/rand`.

`math/rand` is deterministic pseudo-random for simulations/tests, not secrets.

### 6.3 Token Generation

```go
func RandomToken(bytesLen int) (string, error) {
    b := make([]byte, bytesLen)
    if _, err := rand.Read(b); err != nil {
        return "", err
    }
    return base64.RawURLEncoding.EncodeToString(b), nil
}
```

Use at least 128 bits entropy for many tokens; 32 bytes is common.

### 6.4 Random Int

```go
n, err := rand.Int(rand.Reader, big.NewInt(max))
```

Avoid modulo bias:

```go
b[0] % 10
```

for security-sensitive random.

### 6.5 Random IDs vs Domain IDs

Random IDs are good for unguessability.

Domain IDs may need:

- uniqueness;
- sortability;
- partitioning;
- traceability;
- non-enumerability.

Choose intentionally.

---

## 7. Hashing, MAC, and Encryption

### 7.1 Hash

Hash provides digest.

```go
sum := sha256.Sum256(data)
```

Use for:

- integrity fingerprint;
- content addressing;
- non-secret checksum-like fingerprint.

Hash alone does not authenticate.

If attacker can change data and hash, hash is useless for tamper protection.

### 7.2 HMAC

HMAC authenticates data with shared secret.

```go
mac := hmac.New(sha256.New, key)
mac.Write(data)
tag := mac.Sum(nil)
```

Verify:

```go
func VerifyHMAC(key, data, tag []byte) bool {
    mac := hmac.New(sha256.New, key)
    mac.Write(data)
    expected := mac.Sum(nil)
    return hmac.Equal(expected, tag)
}
```

Use for:

- webhook signature;
- signed callback;
- internal message authentication;
- token-like signatures if design is simple.

### 7.3 Encryption

Encryption provides confidentiality.

But unauthenticated encryption is dangerous.

Use AEAD.

### 7.4 AEAD

AEAD provides:

```text
confidentiality + integrity/authenticity
```

Common:

- AES-GCM;
- ChaCha20-Poly1305.

AES-GCM example:

```go
func EncryptAESGCM(key, plaintext, aad []byte) ([]byte, error) {
    block, err := aes.NewCipher(key)
    if err != nil {
        return nil, err
    }

    aead, err := cipher.NewGCM(block)
    if err != nil {
        return nil, err
    }

    nonce := make([]byte, aead.NonceSize())
    if _, err := rand.Read(nonce); err != nil {
        return nil, err
    }

    ciphertext := aead.Seal(nil, nonce, plaintext, aad)

    out := append(nonce, ciphertext...)
    return out, nil
}
```

Decrypt:

```go
func DecryptAESGCM(key, data, aad []byte) ([]byte, error) {
    block, err := aes.NewCipher(key)
    if err != nil {
        return nil, err
    }

    aead, err := cipher.NewGCM(block)
    if err != nil {
        return nil, err
    }

    if len(data) < aead.NonceSize() {
        return nil, errors.New("ciphertext too short")
    }

    nonce := data[:aead.NonceSize()]
    ciphertext := data[aead.NonceSize():]

    return aead.Open(nil, nonce, ciphertext, aad)
}
```

### 7.5 Nonce Rule

For AES-GCM, nonce must be unique for a given key.

Random 96-bit nonce is common, but at huge volume you must reason about collision risk.

Never reuse same nonce/key pair.

### 7.6 Associated Data

AAD is not encrypted but authenticated.

Use for:

```text
tenant id
record id
schema version
context
```

So ciphertext cannot be moved across contexts undetected.

---

## 8. Password Handling

### 8.1 Do Not Hash Password with SHA-256

Bad:

```go
sha256.Sum256([]byte(password))
```

Password hashing requires slow, salted, memory-hard or work-factor based algorithms.

Use:

- Argon2id;
- bcrypt;
- scrypt;
- PBKDF2 depending policy.

Go standard library does not include high-level password hashing in `crypto` package. Common packages live under `golang.org/x/crypto`.

### 8.2 Password Storage

Store:

```text
algorithm
parameters
salt
hash
version
```

Example encoded:

```text
$argon2id$v=19$m=65536,t=3,p=2$base64salt$base64hash
```

### 8.3 Password Verification

Verification must:

- parse algorithm/params;
- derive hash with same params;
- constant-time compare;
- support rehash upgrade.

### 8.4 Rehash on Login

If parameters old:

```text
verify old hash
if valid and params outdated:
  compute new hash
  store new hash
```

### 8.5 Password Reset Tokens

Reset tokens should be:

- random high entropy;
- stored hashed in DB;
- short TTL;
- one-time use;
- invalidated on password change.

Do not store reset token plaintext.

---

## 9. Constant-Time Comparison

### 9.1 Timing Attack

Comparing secrets with `==` can leak where comparison failed.

Use:

```go
hmac.Equal(a, b)
```

or:

```go
subtle.ConstantTimeCompare(a, b) == 1
```

### 9.2 Use Cases

- HMAC signature;
- API token hash;
- password hash comparison output;
- CSRF token;
- webhook secret.

### 9.3 Length Leak

`hmac.Equal` handles comparison safely, but length mismatch may still be observable at protocol level. Usually acceptable if token length is fixed. Normalize fixed-length decoded values where appropriate.

---

## 10. Secret Handling

### 10.1 Secret Sources

```text
environment variables
mounted files
Kubernetes Secret
AWS Secrets Manager
AWS SSM Parameter Store
Vault
cloud metadata identity
```

### 10.2 Secret in Env

Convenient but can leak through:

- process inspection in some environments;
- crash dumps;
- accidental logging;
- shell history if exported badly;
- CI logs.

For high-value secrets, mounted files or secret manager may be better.

### 10.3 Do Not Hardcode

Bad:

```go
const apiKey = "..."
```

### 10.4 Redaction

Do not log full config.

If needed:

```go
type Redacted string

func (r Redacted) String() string {
    if r == "" {
        return ""
    }
    return "[REDACTED]"
}
```

But redaction type is not enough if JSON/reflection logs raw fields. Best control logging fields explicitly.

### 10.5 Secret Lifetime in Memory

Go strings are immutable and cannot be reliably zeroed.

For extremely sensitive data:

- prefer `[]byte`;
- zero after use if possible;
- keep lifetime short;
- avoid copies;
- use OS/KMS/HSM where appropriate.

But Go does not provide full memory secrecy guarantees against process compromise.

### 10.6 Rotation

Design for:

- credential reload or restart;
- dual valid keys during rotation;
- key ID (`kid`);
- monitoring expiry;
- runbook.

---

## 11. Tokens and JWT

### 11.1 Token Types

```text
opaque random token
signed token
encrypted token
JWT
session cookie
API key
```

Prefer opaque random tokens for sessions when server-side lookup is acceptable.

JWT is useful for stateless verification but harder to revoke.

### 11.2 JWT Risks

Common mistakes:

- accepting `alg=none`;
- algorithm confusion;
- not validating issuer;
- not validating audience;
- not validating expiry;
- long-lived token;
- storing sensitive data in token payload;
- not rotating keys;
- trusting token without authz.

### 11.3 JWT Validation Checklist

```text
signature valid
algorithm allowlist
issuer
audience
expiry
not-before
issued-at if needed
key id resolved safely
clock skew bounded
token type/use
subject mapping
authorization after authentication
```

### 11.4 Do Not Put Secrets in JWT Payload

JWT payload is usually base64url encoded, not encrypted.

Anyone with token can read claims unless using JWE.

---

## 12. Secure HTTP Server Defaults

### 12.1 Timeouts

From earlier HTTP parts:

```go
srv := &http.Server{
    ReadHeaderTimeout: 5 * time.Second,
    ReadTimeout:       30 * time.Second,
    WriteTimeout:      30 * time.Second,
    IdleTimeout:       120 * time.Second,
}
```

Protects against slowloris and slow clients.

### 12.2 Body Limits

```go
r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
```

### 12.3 Content-Type

Validate for JSON endpoints.

### 12.4 Security Headers

```go
func SecurityHeaders(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        h := w.Header()
        h.Set("X-Content-Type-Options", "nosniff")
        h.Set("Referrer-Policy", "no-referrer")
        h.Set("X-Frame-Options", "DENY")
        next.ServeHTTP(w, r)
    })
}
```

### 12.5 CORS

Do not use permissive wildcard blindly.

If credentials involved, specify allowed origins.

### 12.6 Cookies

Secure cookie settings:

```go
http.SetCookie(w, &http.Cookie{
    Name:     "session",
    Value:    token,
    Path:     "/",
    HttpOnly: true,
    Secure:   true,
    SameSite: http.SameSiteLaxMode,
})
```

Consider `SameSiteStrictMode` depending UX.

### 12.7 Error Responses

Do not leak internal errors:

```go
http.Error(w, "internal server error", http.StatusInternalServerError)
```

Log internal with request ID.

---

## 13. Input Validation Security

### 13.1 Validate at Boundary

```text
path params
query params
headers
body
file upload name
content type
size
enum values
IDs
time ranges
```

### 13.2 Path Traversal

From I/O part:

```text
never join user path without validation
```

### 13.3 SSRF

If server fetches URL from user input:

- allowlist hosts/schemes;
- block private IP ranges;
- resolve DNS carefully;
- protect against DNS rebinding;
- set timeout;
- limit response size;
- no redirect to internal hosts;
- do not send internal credentials.

### 13.4 SQL Injection

Use parameter binding.

Dynamic identifiers must be whitelisted.

### 13.5 Command Injection

Avoid shell.

Bad:

```go
exec.Command("sh", "-c", userInput)
```

Good:

```go
exec.Command("tool", "--arg", value)
```

Still validate.

### 13.6 File Upload

Validate:

- max size;
- extension if needed;
- MIME sniffing if needed;
- storage path;
- virus scan if required;
- never trust filename;
- do not execute uploaded files;
- store outside web root unless intended.

---

## 14. FIPS 140 Mode

### 14.1 What Is FIPS 140-3

FIPS 140-3 is a US/Canadian government standard for cryptographic modules.

Some regulated environments require FIPS-approved algorithms and validated modules.

### 14.2 Go Native FIPS Support

Modern Go includes native FIPS 140-3 support integrated into standard crypto libraries and the `go` command.

Go documentation states that in FIPS mode, `crypto/tls` ignores and does not negotiate non-approved protocol versions, cipher suites, signature algorithms, or key exchange mechanisms.

### 14.3 Operational Modes

Typical knobs include:

```text
GOFIPS140
GODEBUG=fips140=on
GODEBUG=fips140=only
```

Exact usage depends on Go version, target platform, and compliance needs. Always follow official Go FIPS documentation for your release.

### 14.4 FIPS Is Not Automatic Compliance

Using FIPS mode does not automatically make whole system compliant.

You still need:

- approved algorithms;
- correct key management;
- operational procedures;
- platform support;
- module version evidence;
- audit documentation;
- no non-approved crypto path where disallowed.

### 14.5 FIPS and TLS Compatibility

FIPS mode can reject peers requiring non-approved algorithms.

Test integrations before enabling strict mode.

### 14.6 Go 1.26 Notes

Go 1.26 release notes mention changes to `crypto/fips140` including APIs like `WithoutEnforcement`, `Enforced`, and `Version` in the context of FIPS 140-3 Go Cryptographic Module v1.26.0. Treat these as advanced/compliance-specific tools, not normal application-level toggles.

---

## 15. Supply Chain Security

### 15.1 Go Modules

Use:

```bash
go mod tidy
go mod verify
```

### 15.2 Vulnerability Scanning

Use official Go vulnerability tooling:

```bash
govulncheck ./...
```

It analyzes whether your code actually calls vulnerable symbols when possible.

### 15.3 Dependency Policy

Review:

- maintainer reputation;
- update cadence;
- transitive dependencies;
- license;
- security history;
- API stability;
- necessity.

### 15.4 Pin Versions

Go modules pin versions in `go.mod` and `go.sum`.

Do not blindly upgrade in production without tests.

### 15.5 Private Modules

Configure private module access:

```bash
GOPRIVATE=example.com/internal/*
```

Avoid leaking private module paths to public proxy/checksum DB where policy requires.

### 15.6 Reproducible Builds

Record:

- Go version;
- module versions;
- commit SHA;
- build flags;
- container base image digest.

### 15.7 SBOM and Signing

For mature environments:

- SBOM generation;
- artifact signing;
- provenance;
- container image scanning;
- least-privilege CI tokens.

---

## 16. Secure Logging and Observability

### 16.1 Do Not Log Secrets

Never log:

```text
Authorization header
cookies
passwords
private keys
API tokens
session IDs
raw JWT
PII-heavy payload
full request body
```

### 16.2 Structured Redaction

Log selected safe fields:

```go
logger.Info("login failed",
    "user_id", userID,
    "reason", "invalid_credentials",
    "request_id", requestID,
)
```

Not:

```go
logger.Info("login failed", "password", password)
```

### 16.3 pprof and Debug Endpoints

Protect:

```text
/debug/pprof
/debug/vars
admin endpoints
metrics if sensitive labels
```

Expose only on localhost/admin network or behind auth.

### 16.4 Error Message Hygiene

Client message:

```text
invalid credentials
```

Internal log:

```text
user not found
password mismatch
account locked
```

Even internal logs should avoid secrets.

### 16.5 Audit Logs

Audit logs should be tamper-resistant and structured.

Include:

```text
actor
action
resource
result
timestamp
request id
source
```

Do not include raw secrets.

---

## 17. Secure Configuration

### 17.1 Fail Closed

If required security config missing, fail startup.

Bad:

```go
if jwtKey == "" {
    logger.Warn("JWT disabled")
}
```

Good:

```go
if jwtKey == "" {
    return errors.New("JWT signing key required")
}
```

### 17.2 Environment-Specific Defaults

Development convenience must not leak into production.

Bad:

```go
if env == "prod" {
    secure = true
}
```

Better:

```go
secure default true
explicit local override required
```

### 17.3 Config Validation

Validate:

```text
TLS min version
allowed origins
token TTL
cookie secure true in prod
secret present
password hash params
rate limits positive
body size limits
admin listener binding
```

### 17.4 No Silent Fallback to Insecure

Bad:

```go
if cert missing {
    use HTTP
}
```

---

## 18. Production Example: Secure Webhook Verification

### 18.1 Requirements

External provider sends:

```text
X-Signature: base64(hmac_sha256(secret, timestamp + "." + body))
X-Timestamp: unix seconds
```

Need:

- body size limit;
- timestamp freshness;
- HMAC verification;
- constant-time compare;
- replay protection optional;
- no raw body logs.

### 18.2 Code

```go
func VerifyWebhook(secret []byte, timestamp string, body []byte, gotSigB64 string, now time.Time) error {
    ts, err := strconv.ParseInt(timestamp, 10, 64)
    if err != nil {
        return errors.New("invalid timestamp")
    }

    t := time.Unix(ts, 0)
    if now.Sub(t) > 5*time.Minute || t.Sub(now) > time.Minute {
        return errors.New("timestamp outside allowed window")
    }

    gotSig, err := base64.StdEncoding.DecodeString(gotSigB64)
    if err != nil {
        return errors.New("invalid signature encoding")
    }

    mac := hmac.New(sha256.New, secret)
    mac.Write([]byte(timestamp))
    mac.Write([]byte("."))
    mac.Write(body)

    expected := mac.Sum(nil)
    if !hmac.Equal(expected, gotSig) {
        return errors.New("invalid signature")
    }

    return nil
}
```

### 18.3 Handler

```go
func (h *WebhookHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
    defer r.Body.Close()

    body, err := io.ReadAll(r.Body)
    if err != nil {
        http.Error(w, "invalid body", http.StatusBadRequest)
        return
    }

    err = VerifyWebhook(
        h.secret,
        r.Header.Get("X-Timestamp"),
        body,
        r.Header.Get("X-Signature"),
        h.clock.Now(),
    )
    if err != nil {
        http.Error(w, "unauthorized", http.StatusUnauthorized)
        return
    }

    // process body
    w.WriteHeader(http.StatusNoContent)
}
```

### 18.4 Replay Protection

Timestamp window limits replay but does not eliminate it.

For high-risk webhook, store nonce/event ID and reject duplicates.

---

## 19. Production Example: mTLS Internal Client

### 19.1 Client Factory

```go
func NewMTLSClient(caPath, certPath, keyPath, serverName string) (*http.Client, error) {
    caPEM, err := os.ReadFile(caPath)
    if err != nil {
        return nil, fmt.Errorf("read ca: %w", err)
    }

    roots := x509.NewCertPool()
    if ok := roots.AppendCertsFromPEM(caPEM); !ok {
        return nil, errors.New("parse ca failed")
    }

    cert, err := tls.LoadX509KeyPair(certPath, keyPath)
    if err != nil {
        return nil, fmt.Errorf("load client certificate: %w", err)
    }

    tr := &http.Transport{
        TLSClientConfig: &tls.Config{
            RootCAs:      roots,
            Certificates: []tls.Certificate{cert},
            ServerName:   serverName,
            MinVersion:   tls.VersionTLS12,
        },
        TLSHandshakeTimeout: 3 * time.Second,
        ResponseHeaderTimeout: 5 * time.Second,
    }

    return &http.Client{
        Transport: tr,
        Timeout:   10 * time.Second,
    }, nil
}
```

### 19.2 Review Points

- CA is explicit.
- client certificate loaded from file/secret mount.
- server name verified.
- no `InsecureSkipVerify`.
- timeouts configured.
- cert rotation plan needed.

---

## 20. Production Example: AEAD Field Encryption

### 20.1 Use Case

Encrypt sensitive field before storing in DB.

Requirements:

- key from KMS/secret manager;
- key ID stored with ciphertext;
- random nonce;
- AAD binds record ID;
- rotation support.

### 20.2 Ciphertext Envelope

```go
type EncryptedValue struct {
    KeyID      string `json:"kid"`
    Algorithm  string `json:"alg"`
    Ciphertext string `json:"ciphertext"`
}
```

Binary layout inside ciphertext:

```text
nonce || encrypted bytes
```

### 20.3 Encrypt

```go
func EncryptField(keyID string, key []byte, recordID string, plaintext []byte) (EncryptedValue, error) {
    data, err := EncryptAESGCM(key, plaintext, []byte(recordID))
    if err != nil {
        return EncryptedValue{}, err
    }

    return EncryptedValue{
        KeyID:      keyID,
        Algorithm:  "AES-256-GCM",
        Ciphertext: base64.RawStdEncoding.EncodeToString(data),
    }, nil
}
```

### 20.4 Decrypt

```go
func DecryptField(keys map[string][]byte, recordID string, ev EncryptedValue) ([]byte, error) {
    if ev.Algorithm != "AES-256-GCM" {
        return nil, errors.New("unsupported algorithm")
    }

    key, ok := keys[ev.KeyID]
    if !ok {
        return nil, errors.New("unknown key id")
    }

    data, err := base64.RawStdEncoding.DecodeString(ev.Ciphertext)
    if err != nil {
        return nil, err
    }

    return DecryptAESGCM(key, data, []byte(recordID))
}
```

### 20.5 Caveats

- field encryption does not protect data while application is running;
- app can still log plaintext accidentally;
- query/search over encrypted field is hard;
- key management is the hardest part;
- use managed KMS/envelope encryption where possible.

---

## 21. Testing Security Code

### 21.1 Table Tests for Validation

Test:

- valid signature;
- invalid signature;
- old timestamp;
- future timestamp;
- malformed base64;
- body changed;
- empty secret.

### 21.2 Fuzz Parsers

Fuzz:

- token parser;
- signature header parser;
- certificate parsing wrapper;
- path sanitization;
- URL allowlist.

### 21.3 TLS Tests with `httptest`

```go
srv := httptest.NewTLSServer(handler)
defer srv.Close()

client := srv.Client()
```

For custom TLS:

```go
srv := httptest.NewUnstartedServer(handler)
srv.TLS = &tls.Config{MinVersion: tls.VersionTLS12}
srv.StartTLS()
defer srv.Close()
```

### 21.4 Race Tests

Security state often uses caches:

- key cache;
- token cache;
- nonce store;
- replay protection map.

Run:

```bash
go test -race ./...
```

### 21.5 Negative Tests

Security tests must include failure paths:

```text
wrong key
wrong audience
expired token
missing auth
invalid cert
oversized body
path traversal
```

### 21.6 Dependency Scanning

Run:

```bash
govulncheck ./...
```

in CI.

---

## 22. Threat Modeling Mini-Template

For each feature:

```text
Asset:
  what are we protecting?

Actors:
  who can access?

Entry points:
  HTTP endpoint, message, file, CLI, DB

Trust boundaries:
  where does data cross from untrusted to trusted?

Threats:
  spoofing, tampering, repudiation, information disclosure,
  denial of service, privilege escalation

Controls:
  authn, authz, validation, encryption, logging, rate limit,
  timeout, least privilege

Failure mode:
  what happens if dependency down or token invalid?

Audit:
  what event is recorded?
```

### 22.1 Example: Case Approval Endpoint

Asset:

```text
case status and approval authority
```

Threats:

```text
unauthorized approval
replay approval
tampered request
CSRF if cookie auth
excessive request body
audit deletion
```

Controls:

```text
authentication
authorization
idempotency key
body limit
strict JSON
audit event
transaction
rate limit
```

---

## 23. Common Anti-Patterns

### 23.1 `InsecureSkipVerify: true`

MITM vulnerability.

### 23.2 `math/rand` for Token

Predictable.

### 23.3 SHA-256 Password Hash

Fast hash not suitable for passwords.

### 23.4 AES-CBC Without Authentication

Malleable/insecure if not carefully MACed. Use AEAD.

### 23.5 Reusing GCM Nonce

Catastrophic.

### 23.6 Logging Authorization Header

Credential leak.

### 23.7 JWT Without Validating Audience/Issuer

Token confusion.

### 23.8 Trusting Client-Supplied User ID

Authentication bypass.

### 23.9 Permissive CORS

Cross-origin credential exposure.

### 23.10 No Body Limit

DoS.

### 23.11 Dynamic SQL Identifier Without Whitelist

SQL injection.

### 23.12 pprof Public

Information disclosure.

### 23.13 Secret Hardcoded in Source

Supply-chain and repo leak.

### 23.14 Silent Fallback to Insecure Mode

Dangerous production surprise.

---

## 24. Practical Commands

### Vulnerability Scan

```bash
govulncheck ./...
```

### Module Verify

```bash
go mod verify
```

### Test

```bash
go test ./...
go test -race ./...
```

### Fuzz

```bash
go test -fuzz=FuzzVerifyWebhook ./...
```

### Inspect Certificate

```bash
openssl x509 -in server.crt -text -noout
```

### Test TLS

```bash
openssl s_client -connect localhost:8443 -servername localhost
```

### Build with Version

```bash
go version
go env GOVERSION
```

### FIPS Documentation

Follow the official Go FIPS page for exact `GOFIPS140` and `GODEBUG=fips140` usage for your Go release and platform.

---

## 25. Hands-On Labs

### Lab 1: Secure Random Token

Implement `RandomToken(32)` using `crypto/rand`.

Test uniqueness and length.

### Lab 2: HMAC Webhook

Implement webhook verifier:

- body limit;
- timestamp window;
- HMAC SHA-256;
- constant-time compare.

### Lab 3: TLS Test Server

Use `httptest.NewTLSServer`.

Make client trust server cert.

### Lab 4: mTLS

Generate local CA, server cert, client cert.

Configure server `RequireAndVerifyClientCert`.

Reject client without certificate.

### Lab 5: AES-GCM

Implement encrypt/decrypt with AAD.

Test:

- valid decrypt;
- wrong AAD fails;
- modified ciphertext fails;
- wrong key fails.

### Lab 6: Secret Redaction

Create config with secret fields.

Ensure startup log does not expose secret.

### Lab 7: JWT Validation Checklist

Using a chosen JWT library, enforce:

- algorithm allowlist;
- issuer;
- audience;
- expiry;
- key id.

Write negative tests.

### Lab 8: SSRF Guard

Implement URL allowlist.

Reject localhost/private IP/risky schemes.

Test DNS and redirect behavior conceptually.

### Lab 9: govulncheck in CI

Add CI step:

```bash
govulncheck ./...
```

### Lab 10: Threat Model

Write threat model for case approval endpoint.

Map controls to code.

---

## 26. Review Questions

1. Apa yang disediakan TLS?
2. Apa yang tidak disediakan TLS?
3. Kenapa `InsecureSkipVerify` berbahaya?
4. Apa beda server TLS dan mTLS?
5. Kenapa mTLS bukan authorization?
6. Apa fungsi root CA?
7. Kenapa certificate expiry harus dimonitor?
8. Kenapa `crypto/rand` berbeda dari `math/rand`?
9. Apa beda hash dan HMAC?
10. Kenapa password tidak boleh SHA-256 biasa?
11. Apa itu AEAD?
12. Kenapa nonce AES-GCM tidak boleh reuse?
13. Apa fungsi AAD?
14. Kapan constant-time compare diperlukan?
15. Apa risiko JWT?
16. Apa yang harus divalidasi di JWT?
17. Apa itu FIPS 140 mode?
18. Kenapa FIPS mode bukan otomatis compliance penuh?
19. Apa risiko pprof publik?
20. Apa fungsi `govulncheck`?

---

## 27. Code Review Checklist

Saat review security-sensitive Go code:

```text
[ ] Apakah TLS verification aktif?
[ ] Apakah tidak ada InsecureSkipVerify di production path?
[ ] Apakah ServerName benar?
[ ] Apakah custom RootCAs diperlukan dan valid?
[ ] Apakah mTLS identity dimapping dengan aman?
[ ] Apakah authorization tetap ada setelah authentication?
[ ] Apakah token/random memakai crypto/rand?
[ ] Apakah password memakai password hashing algorithm yang tepat?
[ ] Apakah HMAC diverifikasi dengan hmac.Equal?
[ ] Apakah encryption memakai AEAD?
[ ] Apakah nonce/key reuse dicegah?
[ ] Apakah secret tidak hardcoded?
[ ] Apakah secret tidak dilog?
[ ] Apakah body size dibatasi?
[ ] Apakah CORS/cookie config aman?
[ ] Apakah JWT issuer/audience/exp/alg divalidasi?
[ ] Apakah pprof/admin endpoint terlindungi?
[ ] Apakah dynamic SQL/path/command divalidasi?
[ ] Apakah govulncheck dijalankan?
[ ] Apakah threat model ada untuk fitur kritikal?
```

---

## 28. Invariants

Pegang invariant berikut:

```text
Do not disable TLS verification.
Authentication is not authorization.
Use crypto/rand for secrets.
Hash is not authentication; use HMAC for keyed integrity.
Use AEAD for encryption.
Never reuse nonce with same AEAD key.
Do not use fast hash for passwords.
Do not log secrets.
JWT payload is not encrypted by default.
Validate issuer, audience, expiry, and algorithm.
Fail closed on missing security config.
Bound all untrusted input.
FIPS mode constrains crypto but does not make whole system compliant.
Security endpoints and debug endpoints must be protected.
```

---

## 29. Ringkasan

Go menyediakan standard library crypto/TLS yang kuat, tetapi security tetap bergantung pada desain dan disiplin engineer.

Core rules:

```text
verify TLS
use crypto/rand
use HMAC for signatures
use AEAD for encryption
hash passwords correctly
do not log secrets
validate tokens fully
limit input
fail closed
scan dependencies
protect debug endpoints
```

Sebagai Java engineer, analoginya:

```text
crypto/tls ~ JSSE
crypto/x509 ~ certificate path validation
crypto/* ~ JCA/JCE primitives
govulncheck ~ vulnerability reachability scanner
```

Tetapi Go cenderung memberi primitive lebih langsung. Tidak ada framework yang otomatis menyelamatkan desain yang salah.

Bug security production paling umum:

- `InsecureSkipVerify`;
- secret bocor di log;
- JWT tidak divalidasi audience/issuer;
- token dibuat dengan `math/rand`;
- password di-SHA256;
- body tidak dibatasi;
- pprof publik;
- permissive CORS;
- dynamic SQL/path/command injection;
- event/webhook signature dibanding dengan `==`;
- crypto custom tanpa review;
- FIPS mode dianggap cukup untuk compliance penuh.

Part berikutnya akan membahas observability: structured logging dengan `slog`, metrics, tracing, pprof di production, dan incident debugging.

---

## 30. Posisi Kita di Seri

Kita sudah menyelesaikan:

```text
000 - Orientation and Mental Model
001 - Toolchain, Workspace, Module, Build
002 - Syntax Core
003 - Functions
004 - Types
005 - Composition
006 - Interfaces
007 - Generics
008 - Error Handling
009 - Package Design
010 - Modules and Dependency Management
011 - Standard Library Mental Model
012 - Slices, Arrays, and Maps
013 - Memory Model for Application Engineers
014 - Runtime Deep Dive
015 - Go Garbage Collector
016 - Concurrency Primitives
017 - Concurrency Patterns
018 - Shared Memory Concurrency
019 - Context Propagation
020 - File, Stream, and Filesystem I/O
021 - Networking Fundamentals
022 - HTTP Server Engineering
023 - HTTP Client Engineering
024 - Serialization
025 - CLI, Daemon, and Configuration Engineering
026 - Testing
027 - Benchmarking and Profiling
028 - Database Engineering
029 - Messaging and Async Systems
030 - Security Engineering
```

Berikutnya:

```text
031 - Observability:
      structured logging with slog, metrics, tracing, pprof in production, and incident debugging
```

Status seri: **belum selesai**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-part-029.md">⬅️ Go Messaging and Async Systems: Kafka/RabbitMQ-style consumers, retries, idempotency, ordering, and poison messages</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-part-031.md">Go Observability: structured logging with slog, metrics, tracing, pprof in production, and incident debugging ➡️</a>
</div>

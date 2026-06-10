# Strict Coding Standards — Go Cryptography

Status: Mandatory  
Audience: LLM code agents, reviewers, maintainers  
Applies to: Go services, APIs, CLIs, workers, schedulers, event processors, key/token utilities, integration adapters, regulatory workflow systems  
Baseline: Go 1.24–1.26+, standard-library crypto first, no custom primitives

---

## 1. Purpose

Cryptography code has asymmetric failure cost: a small implementation mistake can silently invalidate confidentiality, integrity, authentication, non-repudiation, or regulatory defensibility.

The LLM MUST NOT treat cryptography as ordinary utility code.

The goal of this standard is to force the agent to:

- use proven primitives,
- avoid inventing protocols,
- choose correct randomness,
- separate hashing, signing, encryption, password hashing, and encoding,
- handle keys and secrets safely,
- use constant-time comparison where required,
- preserve algorithm agility and rotation,
- produce testable and auditable code,
- avoid cargo-cult snippets.

If the LLM is unsure whether a crypto design is safe, it MUST stop and require human cryptographic review rather than approximating.

---

## 2. Source authority

Primary references:

- Go `crypto` package documentation: https://pkg.go.dev/crypto
- Go `crypto/rand` package documentation: https://pkg.go.dev/crypto/rand
- Go `crypto/tls` package documentation: https://pkg.go.dev/crypto/tls
- Go `crypto/x509` package documentation: https://pkg.go.dev/crypto/x509
- Go `crypto/cipher` package documentation: https://pkg.go.dev/crypto/cipher
- Go `crypto/aes` package documentation: https://pkg.go.dev/crypto/aes
- Go `crypto/hmac` package documentation: https://pkg.go.dev/crypto/hmac
- Go `crypto/subtle` package documentation: https://pkg.go.dev/crypto/subtle
- Go `crypto/ed25519` package documentation: https://pkg.go.dev/crypto/ed25519
- Go `crypto/ecdsa` package documentation: https://pkg.go.dev/crypto/ecdsa
- Go `crypto/rsa` package documentation: https://pkg.go.dev/crypto/rsa
- Go `crypto/ecdh` package documentation: https://pkg.go.dev/crypto/ecdh
- Go `crypto/hpke` package documentation: https://pkg.go.dev/crypto/hpke
- Go FIPS 140-3 documentation: https://go.dev/doc/security/fips140
- Go 1.24 release notes, crypto and FIPS updates: https://go.dev/doc/go1.24
- Go 1.25 release notes, TLS/crypto updates: https://go.dev/doc/go1.25
- Go 1.26 release notes, `crypto/hpke`, FIPS, random parameter changes: https://go.dev/doc/go1.26
- Go `golang.org/x/crypto/bcrypt` documentation: https://pkg.go.dev/golang.org/x/crypto/bcrypt
- Go `golang.org/x/crypto/argon2` documentation: https://pkg.go.dev/golang.org/x/crypto/argon2

If this document conflicts with an approved architecture security standard, the stricter standard wins.

---

## 3. Cryptography classification

Before writing crypto code, the LLM MUST classify the intent.

| Intent                                     | Correct primitive family                             | Common wrong choice                |
| ------------------------------------------ | ---------------------------------------------------- | ---------------------------------- |
| Random token                               | `crypto/rand` bytes encoded safely                   | `math/rand`, timestamp, UUID alone |
| Password storage                           | password hashing such as bcrypt/Argon2id with policy | SHA-256/MD5/hash-only              |
| Data integrity with shared secret          | HMAC                                                 | plain hash                         |
| Data authenticity with public verification | digital signature                                    | HMAC if verifier must be public    |
| Confidentiality + integrity                | AEAD encryption                                      | AES-CBC without MAC, homemade mode |
| Transport security                         | TLS with verified certificates                       | disabling verification             |
| Key exchange / envelope encryption         | approved KEM/ECDH/HPKE/KMS                           | raw RSA encryption snippets        |
| Fingerprint/checksum, non-security         | SHA-256 or CRC depending intent                      | using checksum as MAC              |
| Constant-time secret comparison            | `crypto/subtle` or `hmac.Equal`                      | `==`, `bytes.Equal` for secrets    |
| Encoding binary data                       | base64/base64url/hex                                 | treating encoding as encryption    |

The LLM MUST NOT mix these categories.

---

## 4. Non-negotiable crypto rules

### 4.1 Do not invent cryptographic algorithms or protocols

Forbidden:

```go
func encrypt(data, key []byte) []byte {
	for i := range data {
		data[i] ^= key[i%len(key)]
	}
	return data
}
```

Rules:

- Do not design custom ciphers, modes, padding schemes, KDFs, signatures, MAC formats, key exchange protocols, or token formats.
- Do not combine primitives unless the construction is specified by an approved protocol.
- Do not copy crypto snippets from blogs without reviewing official package docs and security properties.
- Do not expose low-level primitives to application code unless wrapped behind a reviewed interface.

---

### 4.2 Use `crypto/rand`, never `math/rand`, for security randomness

Forbidden:

```go
token := strconv.FormatInt(time.Now().UnixNano()+rand.Int63(), 36)
```

Required:

```go
func RandomTokenBase64URL(nBytes int) (string, error) {
	if nBytes < 16 {
		return "", errors.New("token must have at least 128 bits of entropy")
	}
	buf := make([]byte, nBytes)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return "", fmt.Errorf("read crypto random: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
```

Rules:

- Use at least 128 bits of entropy for ordinary bearer tokens.
- Use more entropy where policy requires it.
- Always handle random read errors.
- Do not seed `math/rand` for security.
- Do not use time, counters, PID, hostname, or UUID alone as a secret.

---

### 4.3 Encoding is not encryption

Forbidden reasoning:

```text
The token is base64-encoded, therefore it is secure.
```

Rules:

- Base64, hex, URL encoding, PEM, ASN.1, and JSON are encodings, not security controls.
- Encoding MAY make binary values transport-safe but does not hide or authenticate content.
- If confidentiality is required, use encryption.
- If integrity/authenticity is required, use MAC/signature.

---

### 4.4 Hashing is not password storage

Forbidden:

```go
sum := sha256.Sum256([]byte(password))
store(hex.EncodeToString(sum[:]))
```

Required shape:

```go
func HashPassword(password []byte) ([]byte, error) {
	if len(password) < 12 {
		return nil, ErrWeakPassword
	}
	return bcrypt.GenerateFromPassword(password, bcrypt.DefaultCost)
}

func VerifyPassword(hash, password []byte) error {
	if err := bcrypt.CompareHashAndPassword(hash, password); err != nil {
		return ErrInvalidCredential
	}
	return nil
}
```

Rules:

- Use approved password hashing: bcrypt, Argon2id, scrypt, or project-approved identity provider.
- Store algorithm and parameters with the hash.
- Support rehash-on-login when cost parameters change.
- Apply password length limits to avoid resource exhaustion.
- Do not log passwords or password hashes.
- Do not compare password hashes manually.

---

### 4.5 Use HMAC for shared-secret authenticity

Forbidden:

```go
mac := sha256.Sum256(append(secret, message...))
```

Required:

```go
func SignHMACSHA256(key, msg []byte) []byte {
	m := hmac.New(sha256.New, key)
	_, _ = m.Write(msg)
	return m.Sum(nil)
}

func VerifyHMACSHA256(key, msg, provided []byte) bool {
	expected := SignHMACSHA256(key, msg)
	return hmac.Equal(expected, provided)
}
```

Rules:

- Use HMAC, not plain hash with concatenated secret.
- Compare MACs with `hmac.Equal` or constant-time comparison.
- Include canonicalized message bytes.
- Include version, algorithm id, timestamp, nonce/idempotency value, and context/domain separation where required.
- Reject replay if threat model requires freshness.

---

### 4.6 Use AEAD for application-level encryption

Preferred symmetric encryption family: AEAD such as AES-GCM or ChaCha20-Poly1305 where approved by project policy.

Required AES-GCM shape:

```go
type Ciphertext struct {
	Version   byte
	KeyID     string
	Nonce     []byte
	Data      []byte
}

func SealAESGCM(key, plaintext, aad []byte, keyID string) (Ciphertext, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return Ciphertext{}, fmt.Errorf("create AES cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return Ciphertext{}, fmt.Errorf("create GCM: %w", err)
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return Ciphertext{}, fmt.Errorf("read nonce: %w", err)
	}
	sealed := aead.Seal(nil, nonce, plaintext, aad)
	return Ciphertext{Version: 1, KeyID: keyID, Nonce: nonce, Data: sealed}, nil
}
```

Rules:

- Use AEAD, not unauthenticated encryption.
- Nonce uniqueness under the same key is mandatory.
- Prefer random nonces only when nonce size and volume make collision risk acceptable under policy.
- Store key id/version with ciphertext.
- Use additional authenticated data for context binding: tenant, record type, schema version, purpose, or resource id.
- Never reuse nonce/key pairs.
- Do not ignore authentication failure on decrypt/open.
- Do not decrypt then continue using partially trusted plaintext after authentication failure.

Forbidden:

```go
mode := cipher.NewCBCEncrypter(block, iv) // no MAC, padding risk
```

---

### 4.7 Do not disable TLS verification

Forbidden:

```go
&tls.Config{InsecureSkipVerify: true}
```

Required:

```go
client := &http.Client{
	Timeout: 10 * time.Second,
	Transport: &http.Transport{
		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
			ServerName: "api.example.gov",
		},
	},
}
```

Rules:

- `InsecureSkipVerify` is forbidden outside narrowly scoped local test code.
- If custom roots are required, use explicit `x509.CertPool` and document trust source.
- Server name verification MUST remain active.
- mTLS MUST verify client certificate chain and expected identity.
- Certificate pinning, if used, MUST include rotation strategy.
- Do not force obsolete TLS versions or cipher suites.

---

### 4.8 Use constant-time comparison for secrets

Forbidden:

```go
if provided == expected {
	return nil
}
```

Required for byte secrets:

```go
if subtle.ConstantTimeCompare(provided, expected) != 1 {
	return ErrInvalidSecret
}
```

Required for HMAC:

```go
if !hmac.Equal(expectedMAC, providedMAC) {
	return ErrInvalidMAC
}
```

Rules:

- Constant-time comparison is required for MACs, tokens, API keys, signatures after decoding, and other secret-derived values.
- Normalize representation before comparing.
- Reject length mismatch carefully; length may or may not be public depending on protocol.
- Do not compare secrets as strings if avoidable.
- Constant-time comparison does not fix weak token generation.

---

### 4.9 Do not use deprecated or weak primitives for security

Forbidden for new security code:

- MD5,
- SHA-1,
- DES,
- RC4,
- ECB mode,
- unauthenticated CBC/CFB/OFB,
- raw RSA encryption without approved padding/protocol,
- DSA for new designs,
- homegrown stream ciphers,
- short keys,
- static IVs/nonces,
- predictable random sources.

Allowed only for non-security compatibility:

```text
MD5/SHA-1 may be used only for legacy checksum/fingerprint compatibility when no security property is claimed and the code comments say so explicitly.
```

---

### 4.10 Separate key material from identifiers

Rules:

- Key ID is not the key.
- Certificate serial number is not proof of authorization.
- Public key fingerprint is an identifier, not a secret.
- Tenant ID, user ID, and case ID are not authorization proof.
- A signed token claim is not authorization by itself; policy still applies.

---

## 5. Key management

### 5.1 Do not hardcode keys or secrets

Forbidden:

```go
var hmacKey = []byte("secret")
```

Required:

```go
type KeyProvider interface {
	ActiveSigningKey(ctx context.Context) (Key, error)
	VerifyKeys(ctx context.Context) ([]Key, error)
}
```

Rules:

- Keys MUST come from approved key storage, KMS, HSM, secret manager, or secure environment injection.
- Code MUST support key id and rotation.
- Verification should support old keys during rotation windows.
- New signing/encryption should use active key only.
- Key loading errors MUST fail closed.
- Do not log keys, derived keys, or raw secret config.

### 5.2 Key rotation

Any persisted signed/encrypted value MUST carry enough metadata for rotation.

Required metadata:

- algorithm id,
- key id,
- version,
- creation time if relevant,
- purpose/context,
- nonce/IV if encryption,
- salt if password/KDF,
- parameters if password/KDF.

Example envelope:

```go
type Envelope struct {
	Version string `json:"version"`
	Alg     string `json:"alg"`
	KeyID   string `json:"kid"`
	Nonce   string `json:"nonce,omitempty"`
	Data    string `json:"data"`
}
```

Rules:

- Do not create opaque blobs with no version.
- Do not rotate by deleting old keys before all data/tokens are expired or rewrapped.
- Rotation policy MUST specify read-old/write-new behavior.

### 5.3 Domain separation

A key or derived value MUST not be reused across unrelated purposes unless approved by design.

Forbidden:

```text
Same HMAC key used for webhooks, CSRF, reset tokens, and internal events.
```

Required:

```go
func PurposeAAD(tenantID, resourceType string) []byte {
	return []byte("case-system:v1:" + tenantID + ":" + resourceType)
}
```

Rules:

- Separate keys or derive purpose-specific keys with an approved KDF.
- Include purpose/context in AEAD AAD or signed payload.
- Do not use a production key in test/staging.

---

## 6. Random tokens and identifiers

### 6.1 Bearer tokens

Rules:

- Use `crypto/rand`.
- Minimum 128 bits entropy; prefer 192/256 bits for high-value tokens.
- Encode with `base64.RawURLEncoding` for URLs.
- Store only a keyed hash or salted hash of long-lived bearer tokens when possible.
- Show token only once at creation time.
- Support revocation and expiry.
- Compare token verifier using constant-time comparison.

Example token storage shape:

```go
type APITokenRecord struct {
	ID           string
	TokenHash    []byte
	CreatedAt    time.Time
	ExpiresAt    time.Time
	LastUsedAt   sql.NullTime
	RevokedAt    sql.NullTime
}
```

### 6.2 UUIDs

Rules:

- UUIDs are identifiers, not secrets.
- Do not use UUID alone as password reset token or API secret unless it is generated with sufficient CSPRNG entropy and policy accepts it.
- Do not expose sequential IDs where enumeration is a risk unless authorization prevents data access.

---

## 7. Signing and verification

### 7.1 Digital signatures

Use digital signatures when verifiers should not possess the signing secret.

Rules:

- Prefer Ed25519 for new simple signature schemes if approved by project policy.
- Use ECDSA/RSA only with approved parameters and padding.
- Include algorithm and key id.
- Verify canonical bytes, not loosely re-serialized JSON unless canonicalization is specified.
- Include timestamp/nonce/replay protection where required.
- Never treat signature verification success as full authorization.

Required shape:

```go
type SignedMessage struct {
	Alg       string
	KeyID     string
	Payload   []byte
	Signature []byte
}
```

### 7.2 JWT/JWS/JWE

Rules:

- Do not implement JWT parsing manually unless writing infrastructure library with full test suite.
- Validate issuer, audience, expiry, not-before, signature, algorithm, and key id.
- Do not accept algorithm from token without allowlist.
- Do not trust claims before verification.
- Do not store sensitive data in a signed-only JWT.
- Authorization policy must still check resource access.

---

## 8. Certificates, X.509, and mTLS

Rules:

- Use `crypto/x509` and `crypto/tls` for certificate handling.
- Validate certificate chain, validity period, key usage, extended key usage, DNS/IP/SPIFFE/service identity as required.
- Do not compare only subject CN for identity; modern certificates use SANs.
- Do not silently accept expired certificates.
- Do not silently accept self-signed certificates except with explicit trusted root in test/local/private PKI.
- mTLS client identity MUST map to an authorized service principal.
- Certificate reload logic MUST be concurrency-safe and observable.

Example mTLS server config shape:

```go
func MTLSConfig(clientCAs *x509.CertPool, cert tls.Certificate) *tls.Config {
	return &tls.Config{
		MinVersion:   tls.VersionTLS12,
		Certificates: []tls.Certificate{cert},
		ClientCAs:    clientCAs,
		ClientAuth:   tls.RequireAndVerifyClientCert,
	}
}
```

---

## 9. FIPS 140-3 considerations

If FIPS 140-3 is required by environment or contract, the LLM MUST NOT assume ordinary builds are sufficient.

Rules:

- Follow project build policy for `GOFIPS140` and runtime `GODEBUG=fips140` settings.
- Check `crypto/fips140.Enabled()` where behavior must be verified at runtime.
- Do not enable FIPS mode casually for projects that do not require it.
- Do not use non-approved algorithms in FIPS-required paths.
- Test failure modes because FIPS-only behavior can reject algorithms.
- Document performance impact when key generation or ephemeral keys are affected.

The LLM MUST escalate if requirements mention government, defense, regulated cryptography, FIPS, HSM, or certified module and the project has no explicit crypto build policy.

---

## 10. Go 1.24–1.26 crypto-specific notes

### 10.1 Go 1.24

Relevant standards:

- Treat FIPS 140-3 mode as project-level build/runtime policy, not application guesswork.
- Use `crypto/subtle.WithDataIndependentTiming` only for reviewed constant-time critical sections where architecture support and threat model justify it.
- Do not assume data-independent timing on all platforms.

### 10.2 Go 1.25

Relevant standards:

- Review TLS defaults and post-quantum behavior when compatibility with legacy peers matters.
- Do not pin cipher suite behavior without checking release notes and package docs.
- Compatibility workarounds MUST be explicit, temporary, and tested.

### 10.3 Go 1.26

Relevant standards:

- `crypto/hpke` is available for HPKE use cases; do not implement HPKE manually.
- Randomness parameters in several crypto key-generation APIs may be ignored in favor of secure global randomness; tests must not depend on injecting weak random readers unless using official test support.
- `testing/cryptotest` may be used for deterministic crypto tests where appropriate.
- FIPS module versioning must be controlled through documented build settings.
- Experimental `runtime/secret` must not be introduced into production code without explicit project decision.

---

## 11. Secret memory handling

Rules:

- Use `[]byte` for secrets that must be cleared.
- Avoid converting secrets to `string` because strings are immutable and may be copied.
- Zero buffers when the value is no longer needed and the buffer is not shared.
- Do not assume zeroing removes all copies made by runtime, compiler, logs, traces, swaps, or crash dumps.
- Do not put secret bytes into `fmt.Errorf`, `slog`, panics, or test failure messages.
- Use OS/KMS/HSM controls for real key protection; application zeroing is only one layer.

Example:

```go
func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
```

---

## 12. Error handling in crypto

Rules:

- Authentication failure must be distinct internally from malformed input, but public responses may intentionally collapse both.
- Do not leak whether token id, MAC, padding, key id, or user id was the failing component unless safe.
- Do not continue after failed signature/MAC/decrypt verification.
- Do not wrap secrets into errors.
- Do not log plaintext or ciphertext for sensitive data.

Forbidden:

```go
return fmt.Errorf("decrypt %q with key %x failed: %w", ciphertext, key, err)
```

Preferred:

```go
return fmt.Errorf("decrypt envelope with key id %s: %w", env.KeyID, err)
```

---

## 13. Crypto logging and audit

Allowed log fields:

- key id,
- algorithm id,
- token id prefix/fingerprint if non-sensitive and policy allows,
- envelope version,
- operation type,
- public failure reason class,
- correlation id.

Forbidden log fields:

- raw key,
- raw password,
- raw token,
- private key PEM,
- decrypted plaintext,
- shared secret,
- seed material,
- full Authorization/Cookie headers,
- unredacted signed payload if it contains PII/secrets.

Example:

```go
slog.WarnContext(ctx, "signature verification failed",
	"alg", msg.Alg,
	"kid", msg.KeyID,
	"reason", "invalid_signature",
	"correlation_id", correlationID(ctx),
)
```

---

## 14. Serialization and canonicalization

Rules:

- Sign/MAC exact bytes, not a Go struct directly.
- If signing JSON, define canonicalization or sign the original received bytes.
- Do not rely on map iteration order for signed payloads.
- Include schema/version in signed or encrypted payloads.
- Include resource/purpose context to prevent cross-protocol replay.

Forbidden:

```go
b, _ := json.Marshal(map[string]any{"b": 1, "a": 2})
sig := Sign(b) // no canonicalization policy
```

Preferred:

```go
type WebhookPayload struct {
	Version   string `json:"version"`
	EventID   string `json:"event_id"`
	Timestamp string `json:"timestamp"`
	Body      json.RawMessage `json:"body"`
}
```

---

## 15. Replay protection

Crypto authenticity does not automatically prevent replay.

The LLM MUST add replay controls when processing:

- webhooks,
- payment callbacks,
- signed commands,
- password reset flows,
- activation links,
- case transition approvals,
- privileged admin actions,
- service-to-service commands.

Required controls may include:

- timestamp with skew limit,
- nonce,
- idempotency key,
- event id uniqueness,
- one-time token storage,
- version/concurrency check,
- expiry.

Example:

```go
if time.Since(msg.OccurredAt) > 5*time.Minute {
	return ErrSignatureExpired
}
if used, err := s.nonces.MarkUsed(ctx, msg.Nonce); err != nil {
	return err
} else if used {
	return ErrReplayDetected
}
```

---

## 16. Password reset and verification links

Rules:

- Generate high-entropy random token.
- Store only token hash, not raw token.
- Token must be single-use.
- Token must expire.
- Token must be bound to purpose and subject.
- Do not reveal whether email/account exists.
- Invalidate old tokens after successful use or password change.
- Rate-limit issuance and verification.

Example storage hash:

```go
func TokenLookupHash(token []byte, pepper []byte) []byte {
	m := hmac.New(sha256.New, pepper)
	_, _ = m.Write([]byte("password-reset:v1:"))
	_, _ = m.Write(token)
	return m.Sum(nil)
}
```

---

## 17. Webhook signature verification

Required behavior:

- Read bounded body.
- Verify timestamp freshness.
- Reconstruct exactly signed bytes according to provider spec.
- Verify with HMAC/signature using constant-time comparison.
- Reject replay.
- Parse JSON only after signature passes unless provider spec says otherwise.
- Log safe metadata only.

Required shape:

```go
body, err := io.ReadAll(io.LimitReader(r.Body, maxWebhookBytes))
if err != nil {
	return fmt.Errorf("read webhook body: %w", err)
}
if err := verifier.Verify(r.Header, body); err != nil {
	return ErrInvalidWebhookSignature
}
```

---

## 18. Test requirements

Crypto code MUST include tests for:

- valid case,
- invalid key,
- invalid signature/MAC/tag,
- malformed encoding,
- wrong algorithm id,
- wrong key id,
- expired timestamp,
- replayed nonce/event id,
- wrong AAD/context,
- corrupted ciphertext,
- empty input,
- oversized input,
- key rotation read-old/write-new,
- constant-time comparison path where feasible,
- public error redaction.

Where official test vectors exist, use them.

Required commands:

```bash
go test ./...
go test -race ./...
govulncheck ./...
```

Fuzzing is required for custom envelope parsing, token parsing, canonicalization, and untrusted crypto message decoders.

---

## 19. Approved crypto wrapper interface pattern

The LLM SHOULD isolate crypto behind small interfaces instead of spreading primitive calls across application code.

```go
type EnvelopeSealer interface {
	Seal(ctx context.Context, purpose string, plaintext []byte, aad []byte) (Envelope, error)
	Open(ctx context.Context, purpose string, env Envelope, aad []byte) ([]byte, error)
}

type TokenIssuer interface {
	Issue(ctx context.Context, subject string, ttl time.Duration) (raw string, record TokenRecord, err error)
	Verify(ctx context.Context, raw string) (TokenClaims, error)
}
```

Rules:

- Interface should represent business/security intent, not low-level cipher operations.
- Application code should not choose nonces, modes, or key ids directly unless it is crypto infrastructure code.
- Wrapper must be small enough to review.
- Wrapper must expose safe errors and safe telemetry.

---

## 20. Review checklist for LLM output

The LLM MUST self-review crypto-related code using this checklist:

- [ ] Did I classify the crypto intent correctly?
- [ ] Did I avoid inventing primitives or protocols?
- [ ] Did I use `crypto/rand` for all security randomness?
- [ ] Did I handle random generation errors?
- [ ] Did I distinguish encoding, hashing, MAC, signature, and encryption?
- [ ] Did I use password hashing for passwords?
- [ ] Did I use AEAD for encryption requiring confidentiality and integrity?
- [ ] Did I ensure nonce uniqueness?
- [ ] Did I include algorithm/version/key id metadata?
- [ ] Did I support rotation where values persist?
- [ ] Did I use constant-time comparison for secrets/MACs/tokens?
- [ ] Did I avoid weak/deprecated algorithms for new security code?
- [ ] Did I avoid disabling TLS verification?
- [ ] Did I validate certificates and identity correctly?
- [ ] Did I avoid logging secrets or plaintext?
- [ ] Did I add replay protection where signatures/tokens are reusable?
- [ ] Did I add tests for tampering, expiry, malformed input, and rotation?
- [ ] Did I run or request `govulncheck ./...`?
- [ ] Did I escalate if regulatory/FIPS/HSM requirements are unclear?

---

## 21. Mandatory escalation cases

The LLM MUST escalate rather than implement blindly when asked to:

- create a custom encryption algorithm,
- create a custom authentication/token protocol,
- disable TLS verification,
- use MD5/SHA-1/DES/RC4 for security,
- implement password storage with plain hash,
- hardcode production keys,
- bypass certificate validation,
- remove nonce/randomness handling,
- log raw tokens or private keys,
- introduce FIPS mode without build/runtime policy,
- use experimental `runtime/secret` in production without project decision,
- implement cryptography for legal/regulatory compliance without explicit requirements.

The escalation MUST state the unsafe part, the likely failure mode, and the safe alternative.

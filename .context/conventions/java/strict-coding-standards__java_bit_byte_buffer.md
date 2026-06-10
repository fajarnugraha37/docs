# Strict Coding Standards — Java Bit, Byte, and Buffer Handling

> **Purpose**: This document defines mandatory coding standards for Java code that works with bits, bytes, binary protocols, buffers, file/network payloads, hashes, encryption output, compression output, and low-level binary representations.
>
> **Audience**: LLM code agents, reviewers, Java developers, platform engineers, and security reviewers.
>
> **Compatibility**: Java 11, 17, 21, and 25 projects. Use only APIs available in the target project baseline. Do not introduce newer Java APIs unless the project baseline explicitly allows them.

---

## 1. Non-Negotiable Contract

An LLM or developer modifying byte/buffer code MUST preserve these invariants:

1. **Bytes are not text**. Do not convert arbitrary bytes to `String` unless the bytes are proven to be text and the charset is explicit.
2. **Binary format must be specified**. Endianness, field size, signedness, length prefix, padding, compression, encoding, and checksum rules must be documented.
3. **Buffer state must be explicit**. Any `ByteBuffer` code must make `position`, `limit`, `capacity`, and `order` effects obvious.
4. **No silent truncation**. Narrowing conversions, shifts, masks, and integer-to-byte conversions must be intentional and tested.
5. **No unbounded allocation from untrusted input**. Length-prefixed data must be validated before allocation.
6. **No shared mutable byte arrays without ownership rules**. Copies, slices, and views must be explicit.
7. **No default charset** at binary/text boundaries.
8. **No logging of raw binary secrets** such as keys, tokens, MACs, IVs when they identify sensitive data, encrypted payloads containing PII, or serialized credentials.

---

## 2. Terminology

| Term | Meaning |
|---|---|
| Byte | 8-bit value. Java `byte` is signed `-128..127`. |
| Octet | Protocol-neutral name for 8-bit byte. Prefer in protocol docs. |
| Bit field | Multiple logical values packed into one or more bytes. |
| Endianness | Byte order for multi-byte numeric values. Java `ByteBuffer` default is big-endian. |
| Heap buffer | `ByteBuffer.allocate(...)`, backed by Java heap. |
| Direct buffer | `ByteBuffer.allocateDirect(...)`, off-heap/native memory. |
| View buffer | Buffer view such as `asIntBuffer()` sharing same underlying content. |
| Slice/duplicate | Buffer object sharing content but with independent position/limit/mark. |
| Wire format | Binary representation sent over network or stored durably. |

---

## 3. API Selection Rules

### 3.1 Default Choices

| Use case | Preferred API | Notes |
|---|---|---|
| Small owned binary blob | `byte[]` | Simple, heap-owned, easy to copy. |
| Incremental binary building | `ByteArrayOutputStream` | Use bounded expectations; do not use for unbounded streams. |
| Parsing binary protocol | `ByteBuffer` or explicit index parser | Prefer explicit bounds checks. |
| File/channel I/O | `ByteBuffer` + `FileChannel` / `SocketChannel` | Handle partial reads/writes. |
| Text encoding/decoding | `CharsetEncoder` / `CharsetDecoder` or `String.getBytes(StandardCharsets.UTF_8)` | Charset must be explicit. |
| Hex encode/decode Java 17+ | `HexFormat` | Only when baseline is Java 17+. |
| Base64 | `java.util.Base64` | Choose basic, URL, or MIME variant explicitly. |
| Structured binary schema | Protobuf/Avro/CBOR/etc. | Prefer schema over hand-rolled format when interoperability matters. |
| Memory-mapped large file | `MappedByteBuffer` | Restricted; needs unmap/lifecycle and platform behavior review. |

### 3.2 Restricted APIs

These APIs are allowed only with justification:

- `ByteBuffer.allocateDirect(...)`
- `MappedByteBuffer`
- buffer pooling
- `Unsafe`
- reflection into `java.nio` internals
- `sun.misc.*` or `jdk.internal.*`
- custom binary serialization format
- memory-mapped file writes
- Java Foreign Function & Memory API (`MemorySegment`, `Arena`) unless baseline and project policy explicitly allow it

### 3.3 Forbidden by Default

Do not generate or approve:

```java
new String(bytes);                  // default charset
text.getBytes();                    // default charset
(byte) someInt;                     // without mask/range comment when protocol-relevant
buffer.array();                     // unless buffer is known heap-backed and full-array exposure is safe
buffer.get(bytes);                  // without checking remaining/length for untrusted format
ByteBuffer.allocate(lengthFromInput); // without max length validation
```

---

## 4. Signedness Rules

Java has no unsigned `byte`; `byte` is signed. Protocol bytes are usually unsigned octets. Convert explicitly.

### Required Pattern

```java
int unsigned = inputByte & 0xFF;
```

### Forbidden Pattern

```java
int value = inputByte; // wrong for protocol byte 0x80..0xFF
```

### Integer Narrowing

When converting int to byte for protocol output, prove range or mask intentionally:

```java
if (value < 0 || value > 255) {
    throw new IllegalArgumentException("value must fit unsigned byte: " + value);
}
out.put((byte) (value & 0xFF));
```

Do not rely on implicit wraparound unless the protocol explicitly requires modulo-256 behavior.

---

## 5. Bit Operation Rules

### 5.1 Masks Must Be Named

Do not scatter magic masks.

```java
private static final int FLAG_ACTIVE = 0b0000_0001;
private static final int FLAG_LOCKED = 0b0000_0010;
```

### 5.2 Shift Rules

- Prefer `>>>` for logical right shift on packed binary values.
- Use parentheses around shifts and masks.
- Do not shift by values derived from untrusted input without validation.
- Beware Java promotion: `byte` and `short` are promoted to `int` during arithmetic.

```java
int version = (header >>> 4) & 0x0F;
int type = header & 0x0F;
```

### 5.3 Boolean Flags

Use named methods when bit flags are part of a domain concept:

```java
static boolean isActive(int flags) {
    return (flags & FLAG_ACTIVE) != 0;
}
```

Do not expose raw bit arithmetic throughout business logic.

---

## 6. ByteBuffer Rules

### 6.1 Position/Limit Discipline

Any method that receives a `ByteBuffer` must document whether it:

- reads from current `position`
- writes at current `position`
- mutates `position` / `limit`
- preserves caller state
- duplicates/slices internally
- expects read mode or write mode

Example contract:

```java
/**
 * Reads one frame from {@code source} starting at its current position.
 * Advances position past the frame on success.
 * Leaves position unchanged if a complete frame is not available.
 */
Optional<Frame> tryReadFrame(ByteBuffer source)
```

### 6.2 Flip/Clear/Compact Semantics

Use `flip()` when switching from writing to reading.

```java
buffer.clear();          // prepare for writing from beginning
int n = channel.read(buffer);
buffer.flip();           // prepare to read what was written
```

Use `compact()` only when preserving unread bytes while preparing for more writes.

Do not use `clear()` when unread data must be retained.

### 6.3 Duplicate When Preserving Caller State

```java
ByteBuffer view = source.asReadOnlyBuffer();
int length = view.getInt();
```

Use `duplicate()` or `asReadOnlyBuffer()` when reading without consuming caller position.

### 6.4 Slices Share Content

`slice()`, `duplicate()`, typed views, and `wrap(byte[])` share content. A slice is not a deep copy.

Required comment when returning a slice:

```java
// Returns a read-only view sharing the same backing storage.
return payloadSlice.asReadOnlyBuffer();
```

Use copy when exposing data outside ownership boundary:

```java
byte[] copy = new byte[buffer.remaining()];
buffer.duplicate().get(copy);
return copy;
```

### 6.5 Endianness Must Be Explicit for Wire/Disk Format

```java
ByteBuffer buffer = ByteBuffer.allocate(16).order(ByteOrder.BIG_ENDIAN);
```

Do not rely on the default order in protocol code even if Java default is big-endian.

### 6.6 Read/Write Bounds

Before reading a multi-byte field, validate `remaining()`:

```java
if (buffer.remaining() < Integer.BYTES) {
    return Optional.empty();
}
int length = buffer.getInt();
```

For untrusted length prefix:

```java
if (length < 0 || length > MAX_FRAME_SIZE || length > buffer.remaining()) {
    throw new MalformedFrameException("invalid length");
}
```

---

## 7. Binary/Text Boundary

### 7.1 Text Encoding

Always use explicit charset:

```java
byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
String text = new String(bytes, StandardCharsets.UTF_8);
```

### 7.2 Arbitrary Binary Logging

Do not log raw bytes as text. If diagnostic representation is needed, use bounded hex/base64 and redact sensitive data.

```java
String preview = HexFormat.of().formatHex(Arrays.copyOf(bytes, Math.min(bytes.length, 32)));
logger.debug("payload preview hex={} length={}", preview, bytes.length);
```

For Java 11 baseline, use a vetted hex utility instead of `HexFormat`.

### 7.3 Charset Decoding Errors

For durable data formats, specify decoder behavior:

```java
CharsetDecoder decoder = StandardCharsets.UTF_8
    .newDecoder()
    .onMalformedInput(CodingErrorAction.REPORT)
    .onUnmappableCharacter(CodingErrorAction.REPORT);
```

Do not silently replace invalid bytes unless the business rule requires lossy decoding.

---

## 8. Length, Framing, and Parsing Rules

### 8.1 Length Prefix

Every length-prefixed format must define:

- length field size
- endianness
- whether length includes header
- maximum length
- behavior for negative length
- behavior for partial frame
- checksum/authentication coverage

### 8.2 Partial Read/Write

Network and channel I/O may be partial. Never assume a single `read` or `write` completes the operation.

```java
while (buffer.hasRemaining()) {
    int written = channel.write(buffer);
    if (written == 0) {
        // register interest / backoff / timeout depending on channel mode
        break;
    }
}
```

### 8.3 Parser State Machine

For streaming protocols, use an explicit parser state machine:

```text
READ_HEADER -> READ_PAYLOAD -> VERIFY -> EMIT_FRAME -> READ_HEADER
```

Do not build protocols using ad-hoc nested `if` statements without state documentation.

---

## 9. Memory and Allocation Rules

### 9.1 Maximum Size Required

Any allocation derived from input must be guarded:

```java
if (declaredLength > maxPayloadBytes) {
    throw new PayloadTooLargeException(declaredLength, maxPayloadBytes);
}
byte[] payload = new byte[declaredLength];
```

### 9.2 Direct Buffer Use

Direct buffers are restricted. Use only when:

- channel/native I/O benefit is measured or required
- lifetime is bounded
- allocation frequency is controlled
- memory budget includes off-heap usage
- no hidden unbounded cache/pool exists

Do not allocate direct buffers inside hot per-request paths without pooling/reuse strategy and measurement.

### 9.3 Buffer Pooling

Buffer pooling is restricted because it introduces ownership, leakage, stale data, and concurrency risks.

If used, define:

- max pool size
- buffer size classes
- borrower ownership
- zeroing policy for sensitive data
- return-on-exception strategy
- leak detection
- thread-safety

---

## 10. Security Rules

### 10.1 Sensitive Bytes

Sensitive bytes include:

- keys
- passwords
- tokens
- session IDs
- raw credential material
- decrypted PII
- private keys
- MAC signing secrets
- unredacted request/response payloads

Rules:

- Do not log sensitive bytes.
- Do not include sensitive bytes in exception messages.
- Prefer short-lived arrays when secret material must exist in memory.
- Zero mutable secret arrays after use where practical.
- Avoid immutable `String` for secrets.

### 10.2 Deserialization

Do not use Java native serialization for untrusted bytes.

### 10.3 Compression Bombs

Compressed payload processing must enforce:

- compressed size limit
- decompressed size limit
- expansion ratio limit
- streaming decompression
- timeout/cancellation

### 10.4 Checksums vs Authentication

CRC/checksum detects accidental corruption, not malicious tampering. Use MAC/signature/AEAD when authenticity matters.

---

## 11. Concurrency Rules

- `ByteBuffer` is mutable and must not be shared across threads without external synchronization or strict ownership transfer.
- Do not reuse a buffer after handing it to async code unless ownership transfer is explicit.
- Use read-only duplicate/copy for fan-out.
- Do not store mutable byte arrays in caches without copy-on-write/immutability rules.

---

## 12. Examples

### 12.1 Safe Unsigned Byte Read

```java
static int readUnsignedByte(ByteBuffer buffer) {
    if (!buffer.hasRemaining()) {
        throw new BufferUnderflowException();
    }
    return buffer.get() & 0xFF;
}
```

### 12.2 Safe Length-Prefixed Frame

```java
static Optional<byte[]> tryReadFrame(ByteBuffer source, int maxFrameBytes) {
    ByteBuffer view = source.duplicate();

    if (view.remaining() < Integer.BYTES) {
        return Optional.empty();
    }

    int length = view.getInt();
    if (length < 0 || length > maxFrameBytes) {
        throw new IllegalArgumentException("invalid frame length: " + length);
    }

    if (view.remaining() < length) {
        return Optional.empty();
    }

    byte[] frame = new byte[length];
    view.get(frame);
    source.position(view.position());
    return Optional.of(frame);
}
```

### 12.3 Explicit Endianness

```java
ByteBuffer header = ByteBuffer.allocate(8).order(ByteOrder.BIG_ENDIAN);
header.putInt(MAGIC);
header.putInt(payload.length);
header.flip();
```

---

## 13. Testing Requirements

Binary code must include tests for:

- zero-length payload
- minimum valid frame
- maximum valid frame
- length larger than remaining bytes
- negative length
- malformed header
- unsupported version
- endianness mismatch
- signed byte values `0x80..0xFF`
- partial read/write
- buffer position after success
- buffer position after incomplete input
- buffer position after malformed input
- concurrent ownership if async/threaded
- fuzz/property tests for parser if format is security-sensitive

---

## 14. Review Checklist

Before approving byte/buffer code:

- [ ] Binary/text boundary uses explicit charset.
- [ ] Endianness is explicit for wire/disk format.
- [ ] Signedness is handled via masks/range checks.
- [ ] Input-derived allocation has maximum size.
- [ ] `ByteBuffer` position/limit ownership is documented.
- [ ] Slices/views/copies are intentional.
- [ ] Partial I/O is handled.
- [ ] Sensitive bytes are not logged.
- [ ] Direct/mapped buffers are justified.
- [ ] Tests cover malformed and boundary inputs.

---

## 15. LLM Prompt Contract

When generating Java byte/buffer code, the LLM MUST answer internally before coding:

```text
1. Is this data text or binary?
2. What is the charset if text?
3. What is the binary format if binary?
4. What is the byte order?
5. Are bytes signed or unsigned at the protocol level?
6. What is the maximum payload length?
7. Who owns the byte[]/ByteBuffer after this method returns?
8. Does this method mutate ByteBuffer position/limit?
9. Can read/write be partial?
10. What malformed inputs must be tested?
```

If these answers are unknown, do not invent a binary format. Ask for or create an explicit local contract.

---

## 16. References

- Java SE ByteBuffer API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/ByteBuffer.html
- Java SE ByteOrder API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/ByteOrder.html
- Java SE StandardCharsets API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/charset/StandardCharsets.html
- Java SE Base64 API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Base64.html
- Java SE HexFormat API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/HexFormat.html

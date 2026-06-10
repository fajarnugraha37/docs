# Strict Coding Standards — Java Time, Date, Time Zone

> **Purpose**: This document defines mandatory rules for LLMs, code agents, and human contributors when implementing date/time logic in Java.
>
> **Scope**: Java 11, Java 17, Java 21, and Java 25 codebases. It covers `java.time`, legacy date/time interop, time zones, offsets, instants, clocks, durations, periods, formatting/parsing, scheduling, persistence, APIs, testing, and daylight-saving edge cases.
>
> **Mode**: Strict. Time is a domain boundary. If instant/local/zone/calendar semantics are not explicit, the implementation is incomplete.

---

## 0. Core Principle

Date/time values are not interchangeable.

A code agent must distinguish:

```text
Instant           = exact point on UTC time-line
OffsetDateTime    = date-time with fixed UTC offset
ZonedDateTime     = date-time with region time zone and DST rules
LocalDateTime     = wall-clock date-time without zone/offset
LocalDate         = calendar date without time/zone
LocalTime         = time-of-day without date/zone
Duration          = machine elapsed time, seconds/nanos
Period            = calendar amount, years/months/days
Clock             = injectable source of current time
ZoneId            = region zone, e.g. Asia/Jakarta
ZoneOffset        = fixed offset, e.g. +07:00
```

Using the wrong type is a correctness bug.

---

## 1. Version Compatibility Matrix

| Feature / API                  |           Java 11 |           Java 17 |           Java 21 |           Java 25 | Rule                                                         |
| ------------------------------ | ----------------: | ----------------: | ----------------: | ----------------: | ------------------------------------------------------------ |
| `java.time`                    |               Yes |               Yes |               Yes |               Yes | Required for new code                                        |
| `Instant`                      |               Yes |               Yes |               Yes |               Yes | Required for exact machine timestamps                        |
| `LocalDate`                    |               Yes |               Yes |               Yes |               Yes | Use for date-only domain values                              |
| `ZonedDateTime`                |               Yes |               Yes |               Yes |               Yes | Use for region-zone scheduling/display                       |
| `OffsetDateTime`               |               Yes |               Yes |               Yes |               Yes | Use for API timestamp with offset when zone rules not needed |
| `DateTimeFormatter`            |               Yes |               Yes |               Yes |               Yes | Required; do not use `SimpleDateFormat` in new code          |
| `Clock`                        |               Yes |               Yes |               Yes |               Yes | Required for testable current-time logic                     |
| `Duration` / `Period`          |               Yes |               Yes |               Yes |               Yes | Use instead of raw time numbers                              |
| `java.util.Date` / `Calendar`  |            Legacy |            Legacy |            Legacy |            Legacy | Interop only                                                 |
| `java.sql.Date/Time/Timestamp` |    Legacy/interop |    Legacy/interop |    Legacy/interop |    Legacy/interop | JDBC boundary only                                           |
| TZDB updates                   | Runtime-dependent | Runtime-dependent | Runtime-dependent | Runtime-dependent | Environment must be maintained                               |

---

## 2. Absolute Rules

### 2.1 Forbidden by Default

1. Using `new Date()` or `Calendar.getInstance()` in new domain/application code.
2. Using `LocalDateTime.now()` directly in business logic.
3. Using `System.currentTimeMillis()` for business time.
4. Using default system time zone implicitly.
5. Persisting `LocalDateTime` for an actual event timestamp.
6. Scheduling future user-facing events with only `OffsetDateTime` when region time-zone rules matter.
7. Parsing/formatting dates with `SimpleDateFormat` in new code.
8. Using raw `long` timestamps inside domain logic.
9. Storing dates/times as strings in the database unless required by legacy integration.
10. Adding `Duration.ofDays(1)` when business means “next calendar day” in a zone.
11. Adding `Period.ofDays(1)` when business means “exact 24 elapsed hours”.
12. Comparing date/time strings lexicographically unless format guarantees sortable semantics and this is documented.
13. Assuming every local day has 24 hours.
14. Assuming every local date-time exists.
15. Assuming a local date-time is unique.
16. Ignoring DST gaps/overlaps for scheduling.

### 2.2 Required by Default

1. Use `java.time` for all new code.
2. Inject `Clock` into services that need current time.
3. Use `Instant` for audit/event creation/update timestamps.
4. Use `LocalDate` for date-only business concepts like birth date, due date, effective date.
5. Use `ZonedDateTime` for future human schedules tied to a region.
6. Use explicit `ZoneId` when converting instant to local date/time.
7. Use ISO-8601 formats for machine APIs unless contract says otherwise.
8. Use explicit `DateTimeFormatter` and `Locale` for user-facing parse/format.
9. Define timezone policy at application boundary.
10. Test DST gap/overlap, leap year, month-end, and fixed-clock behavior.

---

## 3. Type Selection Matrix

| Domain requirement             | Correct type                           | Example                     |
| ------------------------------ | -------------------------------------- | --------------------------- |
| Audit timestamp                | `Instant`                              | `createdAt`, `updatedAt`    |
| Event occurrence in UTC        | `Instant`                              | Kafka event time            |
| REST timestamp with offset     | `OffsetDateTime` or ISO instant string | `2026-06-10T09:00:00+07:00` |
| User meeting in Jakarta        | `ZonedDateTime` + `ZoneId`             | future schedule             |
| Date-only legal effective date | `LocalDate`                            | `effectiveDate`             |
| Birth date                     | `LocalDate`                            | no time zone                |
| Store opening time             | `LocalTime` + zone/context             | `09:00` local               |
| Machine timeout                | `Duration`                             | HTTP timeout                |
| Subscription period            | `Period`                               | 1 month                     |
| Month/year reporting bucket    | `YearMonth`                            | 2026-06                     |
| Annual recurrence              | `MonthDay` or domain rule              | birthday                    |
| Current time source            | `Clock`                                | testable now                |
| Fixed UTC offset               | `ZoneOffset`                           | protocol offset only        |
| Region time zone               | `ZoneId`                               | `Asia/Jakarta`              |

---

## 4. `Clock` and Current Time

### 4.1 No Direct `now()` in Business Logic

Forbidden:

```java
public boolean isExpired() {
    return expiresAt.isBefore(Instant.now());
}
```

Required:

```java
public final class ExpiryPolicy {
    private final Clock clock;

    public ExpiryPolicy(Clock clock) {
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    public boolean isExpired(Instant expiresAt) {
        return !expiresAt.isAfter(clock.instant());
    }
}
```

Rules:

1. Inject `Clock` into services/policies.
2. Use `Clock.systemUTC()` at composition root unless app needs another zone.
3. Use `Clock.fixed` in tests.
4. Do not mock static time APIs.
5. Avoid multiple `now()` calls inside one logical decision; capture once.

### 4.2 Capture Once Rule

Bad:

```java
entity.setStartedAt(clock.instant());
// work
entity.setCompletedAt(clock.instant());
```

Allowed if elapsed duration matters. Otherwise capture a consistent timestamp:

```java
Instant now = clock.instant();
entity.markProcessed(now);
```

---

## 5. Instant vs Local Date-Time

### 5.1 Use `Instant` for Actual Events

Actual event timestamps include:

1. created at;
2. submitted at;
3. approved at;
4. sent at;
5. received at;
6. logged at;
7. message/event time;
8. lock expiration;
9. token expiration;
10. audit trail time.

Required:

```java
private Instant submittedAt;
```

Forbidden:

```java
private LocalDateTime submittedAt; // ambiguous for actual timeline event
```

### 5.2 Use `LocalDateTime` Only for Wall-Clock Concept

`LocalDateTime` is allowed only when value intentionally has no zone/offset yet.

Examples:

1. draft appointment form before user selects zone;
2. recurring local office hour template;
3. legacy DB field whose zone is supplied separately;
4. calendar local representation during UI conversion.

Rule: a `LocalDateTime` crossing a service boundary must include its zone policy separately.

---

## 6. Time Zone and Offset Rules

### 6.1 `ZoneId` vs `ZoneOffset`

Use `ZoneId` for human/geographic time:

```java
ZoneId zone = ZoneId.of("Asia/Jakarta");
```

Use `ZoneOffset` only for fixed-offset protocol values:

```java
ZoneOffset offset = ZoneOffset.of("+07:00");
```

Rules:

1. Do not use `+07:00` as replacement for `Asia/Jakarta` if future civil-time rules matter.
2. Store user/account/business zone as IANA `ZoneId` string.
3. Validate zone IDs against allowed policy if user-supplied.
4. Keep timezone database updated in runtime environment.
5. Do not invent time zone abbreviations like `CST` without explicit mapping.

### 6.2 Default Time Zone Is Forbidden in Domain Logic

Forbidden:

```java
LocalDate today = LocalDate.now();
ZonedDateTime zdt = instant.atZone(ZoneId.systemDefault());
```

Required:

```java
LocalDate today = LocalDate.now(clock.withZone(userZone));
ZonedDateTime zdt = instant.atZone(userZone);
```

### 6.3 Application Zone Policy

Every service must define:

```text
storage zone: UTC instant
business default zone: <e.g. Asia/Jakarta / tenant zone / user zone>
display zone: user preference or tenant policy
scheduler zone: explicit IANA ZoneId
API zone: ISO instant or offset timestamp
```

---

## 7. Daylight Saving Time and Civil Time

Even if your current region does not use DST, integrations/users may.

### 7.1 Gaps and Overlaps

A local date-time may:

1. not exist due to DST spring-forward gap;
2. occur twice due to DST fall-back overlap.

Rules:

1. Scheduling must define gap behavior.
2. Scheduling must define overlap behavior.
3. Tests must include at least one DST zone such as `Europe/Berlin` or `America/New_York`.
4. Do not assume `LocalDate.atStartOfDay(zone)` always maps to midnight; use API behavior intentionally.

### 7.2 Calendar Day vs 24 Hours

Different meanings:

```java
zoned.plusDays(1);              // next local calendar day
instant.plus(Duration.ofDays(1)); // exact 24 elapsed hours
```

Rule: choose based on domain language.

Examples:

| Requirement                    | Use                                              |
| ------------------------------ | ------------------------------------------------ |
| token expires in 24 hours      | `Instant + Duration.ofHours(24)`                 |
| report for next business day   | `LocalDate.plusDays(1)`                          |
| meeting tomorrow at 9 AM local | `ZonedDateTime` / local date + local time + zone |
| subscription renews monthly    | `Period.ofMonths(1)` with month-end rule         |

---

## 8. Duration vs Period

### 8.1 Duration

Use `Duration` for machine elapsed time:

1. timeout;
2. retry delay;
3. token TTL;
4. cache expiry;
5. lock lease;
6. latency measurement.

Allowed:

```java
Duration timeout = Duration.ofSeconds(30);
Instant expiresAt = clock.instant().plus(timeout);
```

### 8.2 Period

Use `Period` for calendar amounts:

1. age;
2. subscription months;
3. legal period in days/months/years;
4. date range in calendar terms.

Allowed:

```java
LocalDate renewalDate = startDate.plus(Period.ofMonths(1));
```

Rules:

1. Define month-end behavior.
2. Define leap-year behavior.
3. Define inclusive/exclusive end date.
4. Test Feb 29, Jan 31, month-end.

---

## 9. Parsing and Formatting

### 9.1 Machine Format

Preferred machine formats:

| Type             | Format                                        |
| ---------------- | --------------------------------------------- |
| `Instant`        | ISO-8601 instant, e.g. `2026-06-10T02:00:00Z` |
| `OffsetDateTime` | ISO offset date-time                          |
| `LocalDate`      | ISO local date, `yyyy-MM-dd`                  |
| `YearMonth`      | `yyyy-MM`                                     |
| `Duration`       | ISO-8601 duration or explicit numeric unit    |
| `ZoneId`         | IANA zone string, e.g. `Asia/Jakarta`         |

Rules:

1. Machine parsing must be strict.
2. Avoid ambiguous formats like `01/02/2026`.
3. Do not use locale display format for API contract.
4. Include offset/zone for exact event timestamps.
5. Do not accept multiple formats unless migration requires it and tests cover all variants.

### 9.2 User-Facing Format

Use explicit locale and zone:

```java
DateTimeFormatter formatter = DateTimeFormatter
        .ofPattern("dd MMM uuuu HH:mm", userLocale)
        .withZone(userZone);

String display = formatter.format(instant);
```

Rules:

1. User-facing format must specify locale.
2. User-facing timestamp must specify display zone.
3. Do not parse user input without locale and expected pattern.
4. Prefer strict resolver style for user-entered dates.

### 9.3 Formatter Reuse

`DateTimeFormatter` is immutable/thread-safe and can be reused.

Allowed:

```java
private static final DateTimeFormatter CASE_DATE_FORMATTER =
        DateTimeFormatter.ISO_LOCAL_DATE;
```

Forbidden:

```java
private static final SimpleDateFormat FORMAT = new SimpleDateFormat("yyyy-MM-dd");
```

---

## 10. API Boundary Rules

### 10.1 REST/JSON

Rules:

1. Use ISO-8601 strings for date/time.
2. Use `Instant` or offset timestamp for event timestamps.
3. Use `LocalDate` string for date-only fields.
4. Include zone ID for schedules that must preserve region rules.
5. Do not expose epoch milliseconds unless required by legacy clients.
6. If epoch is used, field name must include unit, e.g. `createdAtEpochMillis`.
7. Document timezone interpretation in OpenAPI.
8. Do not return server-local `LocalDateTime` without zone.

Examples:

```json
{
  "submittedAt": "2026-06-10T02:15:30Z",
  "effectiveDate": "2026-07-01",
  "hearingTime": "2026-07-01T09:00:00",
  "hearingZone": "Asia/Jakarta"
}
```

### 10.2 Request Validation

For every date/time request field define:

1. type;
2. format;
3. zone/offset requirement;
4. allowed range;
5. whether past/future allowed;
6. inclusive/exclusive boundaries;
7. default zone if omitted;
8. DST gap/overlap behavior;
9. error message/code.

---

## 11. Database Persistence Rules

### 11.1 Recommended Mapping

| Domain value          | Java type                                                          | Storage                                                    |
| --------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| Audit/event timestamp | `Instant`                                                          | UTC timestamp / timestamp with time zone, DB-specific      |
| Date-only             | `LocalDate`                                                        | DATE                                                       |
| Time-only local       | `LocalTime`                                                        | TIME                                                       |
| Future schedule       | local date-time + zone ID, or instant + zone depending requirement | TIMESTAMP + zone column                                    |
| Duration              | `Duration`                                                         | numeric seconds/millis/nanos or ISO string by policy       |
| Period                | `Period`                                                           | explicit years/months/days columns or ISO string by policy |
| Zone                  | `ZoneId`                                                           | VARCHAR IANA zone ID                                       |

Rules:

1. Do not store actual event timestamp as ambiguous local date-time.
2. Store zone ID when future civil schedule must survive rule changes.
3. Do not rely on database/session timezone defaults.
4. Set JDBC driver/session timezone policy if required.
5. Test persistence round-trip across time zones.
6. Migration scripts must document timezone assumptions.

### 11.2 Legacy Interop

`java.util.Date`, `Calendar`, and `java.sql.Timestamp` are allowed only at boundaries.

Conversion:

```java
Instant instant = legacyDate.toInstant();
Date legacyDate = Date.from(instant);
```

Rules:

1. Convert to `java.time` immediately at boundary.
2. Do not pass legacy types into domain logic.
3. Beware `java.sql.Date` losing time information.
4. Beware `Timestamp` nanosecond behavior and equality surprises.

---

## 12. Scheduling Rules

### 12.1 Future Human Schedule

For future events like appointments, hearings, business cutoffs:

Required data:

```text
local date
local time
IANA ZoneId
recurrence rule if applicable
gap/overlap policy
business calendar/holiday policy if applicable
```

Do not store only instant if the future event must remain “9 AM local” even if timezone rules change.

### 12.2 Recurrence

Recurring schedule must define:

1. frequency;
2. zone;
3. start date/time;
4. end condition;
5. skipped/invalid date policy;
6. DST gap/overlap policy;
7. holiday/business day adjustment;
8. idempotency key for job execution.

### 12.3 Job Execution Time

For background jobs:

1. calculate next fire time with zone-aware rules;
2. persist last successful execution instant;
3. avoid duplicate processing with idempotency;
4. do not rely only on local server clock;
5. monitor clock skew;
6. define catch-up behavior after downtime.

---

## 13. Time Ranges and Intervals

### 13.1 Inclusive/Exclusive Rule

Default for machine intervals:

```text
[startInclusive, endExclusive)
```

Rules:

1. Name fields clearly: `startInclusive`, `endExclusive`.
2. Validate start < end.
3. Avoid end-of-day `23:59:59.999` hacks.
4. For date ranges, convert to instant range using zone only at boundary.
5. For database queries, use `>= start AND < end`.

Allowed:

```java
Instant start = localDate.atStartOfDay(zone).toInstant();
Instant end = localDate.plusDays(1).atStartOfDay(zone).toInstant();
```

### 13.2 Date Range

For date-only range:

```java
public record DateRange(LocalDate startInclusive, LocalDate endExclusive) {
    public DateRange {
        Objects.requireNonNull(startInclusive, "startInclusive");
        Objects.requireNonNull(endExclusive, "endExclusive");
        if (!startInclusive.isBefore(endExclusive)) {
            throw new IllegalArgumentException("invalid date range");
        }
    }
}
```

---

## 14. Expiry, TTL, and Deadlines

### 14.1 Expiry

Use `Instant` for expiry:

```java
Instant expiresAt = clock.instant().plus(Duration.ofMinutes(15));
```

Rules:

1. Compare with injected clock.
2. Define whether equality means expired.
3. Store expiry as instant.
4. Avoid local server timezone.
5. Bound TTL min/max.

Recommended:

```java
boolean expired = !expiresAt.isAfter(clock.instant());
```

### 14.2 Deadline vs Timeout

| Concept  | Type                           | Meaning                 |
| -------- | ------------------------------ | ----------------------- |
| timeout  | `Duration`                     | relative allowed time   |
| deadline | `Instant`                      | absolute latest time    |
| schedule | `ZonedDateTime` / local + zone | future civil occurrence |

Do not confuse these in API names.

---

## 15. Logging and Audit

### 15.1 Audit Timestamp

Audit timestamps must be `Instant` and recorded once per logical event.

```java
Instant now = clock.instant();
audit.record(CaseApproved.of(caseId, actorId, now));
```

Rules:

1. Use UTC machine time for audit.
2. Include actor and event type.
3. Do not rely on display-local formatted strings.
4. Format for display only at UI/report boundary.
5. Ensure audit ordering handles same timestamp with sequence/version if needed.

### 15.2 Log Timestamp

Logging framework controls timestamp. Application log fields should use ISO instant strings or structured instant values.

---

## 16. Validation Rules

### 16.1 Date Validation

Examples:

1. birth date cannot be future;
2. effective date cannot be before policy start;
3. expiry must be after issued time;
4. end must be after start;
5. schedule must be within allowed business hours;
6. date must not fall on holiday/weekend if policy requires.

Validation must be domain-named, not generic utility hidden behavior.

### 16.2 Age Calculation

Use `Period` between `LocalDate`s, not milliseconds.

```java
int age = Period.between(dateOfBirth, today).getYears();
```

Rules:

1. Define timezone for `today`.
2. Define leap-day birthday policy if legally relevant.
3. Test Feb 29.

---

## 17. Concurrency and Time

### 17.1 Time Is Not Synchronization

Forbidden:

```java
Thread.sleep(1000); // as correctness synchronization
```

Rules:

1. Use concurrency primitives for synchronization.
2. Use timeouts to bound waiting, not prove ordering.
3. Use monotonic time for elapsed measurement where possible.
4. Use `System.nanoTime()` for elapsed durations, not wall-clock.
5. Use `Instant` for wall-clock/audit.

### 17.2 Measuring Elapsed Time

Allowed:

```java
long startNanos = System.nanoTime();
try {
    work.run();
} finally {
    Duration elapsed = Duration.ofNanos(System.nanoTime() - startNanos);
    metrics.record(elapsed);
}
```

Rules:

1. Do not use `currentTimeMillis` for elapsed measurement.
2. Do not persist `nanoTime` values.
3. Do not compare `nanoTime` across JVMs.

---

## 18. Security Rules

1. Token expiry must use `Instant`, not local date-time.
2. Validate JWT `iat`, `nbf`, `exp` with clock skew policy.
3. Bound allowed clock skew.
4. Do not trust client-supplied timestamps for authorization without validation.
5. Do not use timestamp alone as nonce/idempotency key.
6. Avoid predictable timestamp-based tokens.
7. Audit timestamps must be server-side.
8. Rate-limit windows must define clock source and distributed behavior.
9. Avoid leaking sensitive timing details in errors if relevant.

---

## 19. Testing Requirements

Every non-trivial date/time implementation must include tests for:

1. fixed clock;
2. UTC zone;
3. application/business zone;
4. user zone;
5. DST gap;
6. DST overlap;
7. leap year;
8. Feb 29;
9. month end: Jan 31 + one month;
10. end-exclusive range;
11. boundary equality for expiry;
12. invalid date input;
13. parsing with wrong format;
14. serialization/deserialization round trip;
15. database round trip;
16. legacy interop if used;
17. clock skew if security token logic;
18. large duration/period if applicable.

### 19.1 Required Test Fixtures

```java
static final ZoneId UTC = ZoneOffset.UTC;
static final ZoneId JAKARTA = ZoneId.of("Asia/Jakarta");
static final ZoneId BERLIN = ZoneId.of("Europe/Berlin");
static final ZoneId NEW_YORK = ZoneId.of("America/New_York");
static final Instant FIXED_INSTANT = Instant.parse("2026-06-10T02:00:00Z");
static final Clock FIXED_CLOCK = Clock.fixed(FIXED_INSTANT, UTC);
```

### 19.2 DST Test Examples

```java
// Europe/Berlin DST gap example: local time may be invalid around spring transition.
ZoneId zone = ZoneId.of("Europe/Berlin");
LocalDateTime local = LocalDateTime.of(2026, 3, 29, 2, 30);
ZonedDateTime resolved = local.atZone(zone);
```

Rule: tests must assert the chosen policy, not just call the API.

---

## 20. Anti-Patterns

### 20.1 LocalDateTime for Audit

Bad:

```java
private LocalDateTime createdAt;
```

Better:

```java
private Instant createdAt;
```

### 20.2 Server Default Zone

Bad:

```java
LocalDate today = LocalDate.now();
```

Better:

```java
LocalDate today = LocalDate.now(clock.withZone(businessZone));
```

### 20.3 End of Day Hack

Bad:

```java
LocalDateTime end = date.atTime(23, 59, 59, 999_000_000);
```

Better:

```java
Instant start = date.atStartOfDay(zone).toInstant();
Instant end = date.plusDays(1).atStartOfDay(zone).toInstant();
```

### 20.4 Raw Millis Everywhere

Bad:

```java
long expiresAt = System.currentTimeMillis() + 900000;
```

Better:

```java
Instant expiresAt = clock.instant().plus(Duration.ofMinutes(15));
```

### 20.5 Date as String in Domain

Bad:

```java
String effectiveDate;
```

Better:

```java
LocalDate effectiveDate;
```

---

## 21. LLM Implementation Protocol

Before generating or modifying date/time code, the agent must answer:

```text
1. Is this an instant, local date, local time, local date-time, zoned date-time, duration, or period?
2. Is this for audit/event time, display, scheduling, expiry, or date-only business rule?
3. What ZoneId applies, and where does it come from?
4. Is the value stored as UTC instant, local date, local time, or local+zone?
5. Is parsing/formatting machine-facing or user-facing?
6. What format, locale, and resolver strictness apply?
7. Are ranges inclusive/exclusive?
8. What are DST gap/overlap rules?
9. What Clock is used for current time?
10. What tests cover fixed clock, zones, DST, leap year, and persistence/API round trip?
```

If the agent cannot answer, it must not implement date/time logic.

---

## 22. Reviewer Checklist

- [ ] Is `java.time` used for new code?
- [ ] Is `Clock` injected where current time is needed?
- [ ] Are actual timestamps represented as `Instant` or offset timestamp, not ambiguous `LocalDateTime`?
- [ ] Are date-only concepts represented as `LocalDate`?
- [ ] Are future human schedules represented with region `ZoneId` where needed?
- [ ] Is default system timezone avoided in domain logic?
- [ ] Is parsing/formatting explicit about format, locale, and zone?
- [ ] Are machine API formats ISO and unambiguous?
- [ ] Are database timezone/session assumptions documented and tested?
- [ ] Are intervals `[startInclusive, endExclusive)` unless explicitly different?
- [ ] Are duration vs period semantics correct?
- [ ] Are DST gaps/overlaps tested?
- [ ] Are leap year/month-end cases tested?
- [ ] Are expiry equality semantics explicit?
- [ ] Are legacy `Date/Calendar/Timestamp` limited to boundaries?
- [ ] Are raw epoch numbers named with units if used at boundary?

---

## 23. Prompt Contract for LLM Code Agents

```text
You are implementing Java date/time logic under strict standards.

Mandatory rules:
- Use java.time for new code.
- Do not use LocalDateTime for actual event/audit timestamps; use Instant.
- Do not call Instant.now(), LocalDate.now(), LocalDateTime.now(), or ZonedDateTime.now() directly in business logic; inject Clock.
- Do not rely on ZoneId.systemDefault() in domain logic.
- Use LocalDate for date-only business concepts.
- Use ZonedDateTime or local date/time + IANA ZoneId for future human schedules where region rules matter.
- Use Duration for elapsed machine time and Period for calendar amounts.
- Use explicit DateTimeFormatter, Locale, and ZoneId for parse/format.
- Use [startInclusive, endExclusive) intervals by default.
- Include tests for fixed Clock, UTC, business/user zones, DST gap/overlap, leap year, month-end, expiry equality, and API/database round trip.

Before coding, state the selected temporal type, zone policy, storage format, API format, clock source, interval semantics, DST policy, and tests.
```

---

## 24. References

- Java SE `java.time` package summary: https://docs.oracle.com/javase/8/docs/api/java/time/package-summary.html
- Java SE `Instant` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/time/Instant.html
- Java SE `LocalDate` API: https://docs.oracle.com/javase/8/docs/api/java/time/LocalDate.html
- Java SE `ZonedDateTime` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/time/ZonedDateTime.html
- Java SE `OffsetDateTime` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/time/OffsetDateTime.html
- Java SE `Duration` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/time/Duration.html
- Java SE `Period` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/time/Period.html
- Java SE `Clock` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/time/Clock.html
- Java SE `DateTimeFormatter` API: https://docs.oracle.com/javase/8/docs/api/java/time/format/DateTimeFormatter.html
- IANA Time Zone Database: https://www.iana.org/time-zones
- ISO 8601 overview: https://www.iso.org/iso-8601-date-and-time-format.html

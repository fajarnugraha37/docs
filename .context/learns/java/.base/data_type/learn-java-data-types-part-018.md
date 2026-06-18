# learn-java-data-types-part-018.md

# Java Data Types — Part 018  
# Date and Time Types: Instant, LocalDate, ZonedDateTime, Duration, Period, Clock, dan Temporal Correctness

> Seri: **Advanced Java Data Types**  
> Bagian: **018**  
> Fokus: memahami date/time sebagai data type yang rawan bug production: machine time vs human time, timestamp vs date vs local date-time, time zone, offset, DST, clock injection, duration vs period, formatting/parsing, database/API mapping, scheduling, audit, testing, dan bagaimana memilih type `java.time` yang benar.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Date/Time Sulit](#2-kenapa-datetime-sulit)
3. [Mental Model: Machine Time vs Human Time](#3-mental-model-machine-time-vs-human-time)
4. [Legacy Problem: `Date`, `Calendar`, `SimpleDateFormat`](#4-legacy-problem-date-calendar-simpledateformat)
5. [Overview `java.time`](#5-overview-javatime)
6. [`Instant`: Titik pada Timeline](#6-instant-titik-pada-timeline)
7. [`LocalDate`: Tanggal Tanpa Time Zone](#7-localdate-tanggal-tanpa-time-zone)
8. [`LocalTime`: Jam Tanpa Tanggal dan Zone](#8-localtime-jam-tanpa-tanggal-dan-zone)
9. [`LocalDateTime`: Tanggal+Jam Tanpa Zone](#9-localdatetime-tanggaljam-tanpa-zone)
10. [`ZoneId` dan `ZoneOffset`](#10-zoneid-dan-zoneoffset)
11. [`OffsetDateTime`](#11-offsetdatetime)
12. [`ZonedDateTime`](#12-zoneddatetime)
13. [`Duration` vs `Period`](#13-duration-vs-period)
14. [`Clock`: Time as Dependency](#14-clock-time-as-dependency)
15. [Date/Time Arithmetic](#15-datetime-arithmetic)
16. [DST: Daylight Saving Time dan Ambiguous Time](#16-dst-daylight-saving-time-dan-ambiguous-time)
17. [Time Zone Database dan Political Time](#17-time-zone-database-dan-political-time)
18. [Formatting dan Parsing dengan `DateTimeFormatter`](#18-formatting-dan-parsing-dengan-datetimeformatter)
19. [Locale, Chronology, dan User Display](#19-locale-chronology-dan-user-display)
20. [Serialization: ISO-8601 dan API Contract](#20-serialization-iso-8601-dan-api-contract)
21. [Database Mapping](#21-database-mapping)
22. [JSON/API Boundary](#22-jsonapi-boundary)
23. [Scheduling dan Recurrence](#23-scheduling-dan-recurrence)
24. [Audit, CreatedAt, UpdatedAt, dan Event Time](#24-audit-createdat-updatedat-dan-event-time)
25. [Expiration, Timeout, SLA, dan Deadline](#25-expiration-timeout-sla-dan-deadline)
26. [Business Date dan Cut-Off Time](#26-business-date-dan-cut-off-time)
27. [Testing Time](#27-testing-time)
28. [Equality, Ordering, dan Comparison](#28-equality-ordering-dan-comparison)
29. [Nullability dan Optional Date/Time](#29-nullability-dan-optional-datetime)
30. [Domain-Specific Date/Time Types](#30-domain-specific-datetime-types)
31. [Performance dan Precision](#31-performance-dan-precision)
32. [Production Failure Modes](#32-production-failure-modes)
33. [Best Practices](#33-best-practices)
34. [Decision Matrix](#34-decision-matrix)
35. [Latihan](#35-latihan)
36. [Ringkasan](#36-ringkasan)
37. [Referensi](#37-referensi)

---

# 1. Tujuan Bagian Ini

Date/time adalah salah satu area paling sering menyebabkan bug production.

Contoh bug:

```java
LocalDateTime createdAt = LocalDateTime.now();
```

Terlihat benar, tetapi:

```text
createdAt di time zone mana?
Bisa dibandingkan antar server?
Aman untuk audit?
Apa artinya saat server pindah region?
```

Contoh lain:

```java
Instant expiresAt = Instant.now().plus(Period.ofDays(1)); // invalid concept
```

Atau:

```java
LocalDate dueDate = Instant.now(); // impossible without zone
```

Date/time sulit karena ada dua dunia:

```text
machine time:
  timeline global, timestamp, instant, duration

human time:
  calendar, local date, local time, time zone, business day, month, holiday
```

Tujuan bagian ini:

- memahami type utama `java.time`;
- memilih `Instant`, `LocalDate`, `LocalDateTime`, `OffsetDateTime`, `ZonedDateTime` secara benar;
- memahami time zone dan offset;
- memahami `Duration` vs `Period`;
- memakai `Clock` agar testable;
- memahami DST dan ambiguous local time;
- memahami database/API mapping;
- memahami scheduling dan recurrence;
- menghindari date/time production bugs.

---

# 2. Kenapa Date/Time Sulit

Date/time bukan sekadar angka.

## 2.1 Calendar is human convention

Manusia memakai:

- tahun;
- bulan;
- tanggal;
- hari kerja;
- akhir bulan;
- zona waktu;
- daylight saving time;
- holiday;
- local cut-off;
- fiscal period.

## 2.2 Timeline is machine concept

Mesin butuh:

- timestamp;
- ordering;
- expiration;
- duration;
- audit;
- event time;
- monotonic-ish comparisons.

## 2.3 Time zone changes

Time zone rules bisa berubah karena keputusan politik.

Offset `+07:00` bukan sama dengan zone `Asia/Jakarta`.

## 2.4 DST creates weird days

Di beberapa zone:

- satu hari bisa 23 jam;
- satu hari bisa 25 jam;
- local time bisa tidak ada;
- local time bisa terjadi dua kali.

## 2.5 Precision mismatch

Different systems store:

- seconds;
- milliseconds;
- microseconds;
- nanoseconds.

Precision mismatch can break equality.

## 2.6 Business meaning matters

```java
LocalDate dueDate
```

berbeda dengan:

```java
Instant deadline
```

Due date = tanggal bisnis.

Deadline = titik waktu absolut.

---

# 3. Mental Model: Machine Time vs Human Time

Ini mental model paling penting.

## 3.1 Machine time

Machine time menjawab:

```text
Kapan tepatnya ini terjadi di timeline global?
```

Use:

```java
Instant
Duration
Clock
```

Examples:

- event occurred at;
- created at;
- updated at;
- token expiration;
- log timestamp;
- message timestamp;
- SLA deadline absolute;
- ordering events globally.

## 3.2 Human time

Human time menjawab:

```text
Menurut kalender/jam manusia di lokasi tertentu, tanggal/jam berapa?
```

Use:

```java
LocalDate
LocalTime
LocalDateTime
ZonedDateTime
Period
ZoneId
```

Examples:

- birth date;
- license expiry date;
- appointment at 09:00 Singapore time;
- business day;
- monthly billing;
- yearly renewal;
- office opening hours.

## 3.3 Conversion requires zone

To convert `Instant` to local date/time, need `ZoneId`.

```java
LocalDate dateInSingapore = instant.atZone(ZoneId.of("Asia/Singapore")).toLocalDate();
```

## 3.4 LocalDateTime is incomplete for timeline

```java
LocalDateTime.of(2026, 6, 12, 10, 0)
```

This is not a unique instant unless zone/offset is known.

## 3.5 Rule

```text
Store machine events as Instant.
Model human business dates as LocalDate.
Model scheduled local appointment with ZoneId/ZonedDateTime.
```

---

# 4. Legacy Problem: `Date`, `Calendar`, `SimpleDateFormat`

Before Java 8, common types:

```java
java.util.Date
java.util.Calendar
java.text.SimpleDateFormat
```

Problems:

- confusing naming;
- mutable;
- `Date` has legacy deprecated date methods;
- `Calendar` complex and mutable;
- `SimpleDateFormat` not thread-safe;
- poor domain separation;
- timezone handling awkward.

## 4.1 `Date` is instant-like but bad API

`java.util.Date` represents timestamp internally, but name suggests date.

## 4.2 Calendar is mutable

Mutation bugs are common.

## 4.3 SimpleDateFormat thread safety

Sharing static SimpleDateFormat can cause data races.

Use `DateTimeFormatter`, which is immutable/thread-safe.

## 4.4 Migration

Convert legacy Date to Instant:

```java
Instant instant = date.toInstant();
Date date = Date.from(instant);
```

## 4.5 New code

Use `java.time`.

---

# 5. Overview `java.time`

Java SE 25 `java.time` package is the main API for dates, times, instants, and durations; it represents key concepts such as instants, durations, dates, times, time-zones, and periods. The package summary also states the classes are immutable and thread-safe.

Main types:

```java
Instant
LocalDate
LocalTime
LocalDateTime
OffsetDateTime
ZonedDateTime
ZoneId
ZoneOffset
Duration
Period
Clock
DateTimeFormatter
```

## 5.1 Immutable

Most `java.time` classes are immutable.

```java
LocalDate date = LocalDate.of(2026, 6, 12);
date.plusDays(1); // original unchanged
```

Need assign result:

```java
date = date.plusDays(1);
```

## 5.2 Thread-safe

Immutable date/time objects and formatters can be shared safely.

## 5.3 Domain-specific

Each type encodes different semantics.

Do not use one type for all time problems.

## 5.4 ISO calendar

Core java.time classes are ISO/Gregorian oriented. Other chronologies exist but most business apps use ISO.

---

# 6. `Instant`: Titik pada Timeline

`Instant` represents an instantaneous point on the timeline.

Use it for machine timestamps.

```java
Instant now = Instant.now();
```

## 6.1 Good use cases

- createdAt;
- updatedAt;
- deletedAt;
- event occurredAt;
- message publishedAt;
- token expiresAt;
- audit timestamp;
- ordering events;
- TTL/deadline absolute.

## 6.2 UTC-like concept

`Instant` itself has no time zone. It is a point on global timeline.

Display requires zone.

## 6.3 Current instant

Prefer injecting `Clock`:

```java
Instant now = clock.instant();
```

instead of direct:

```java
Instant.now()
```

in testable domain services.

## 6.4 Precision

Instant supports nanosecond precision, but actual clock/database may have lower precision.

## 6.5 Not for human date alone

Birth date:

```java
LocalDate
```

not `Instant`.

Because birth date has no universal exact instant without location/time.

## 6.6 Convert to ZonedDateTime

```java
ZonedDateTime singaporeTime = instant.atZone(ZoneId.of("Asia/Singapore"));
```

---

# 7. `LocalDate`: Tanggal Tanpa Time Zone

`LocalDate` is an immutable date-time object representing a date, often viewed as year-month-day. Java API explicitly notes it does not store or represent a time or time-zone and cannot represent an instant on the timeline without additional information.

```java
LocalDate date = LocalDate.of(2026, 6, 12);
```

## 7.1 Good use cases

- birth date;
- license expiry date;
- business date;
- billing date;
- holiday date;
- settlement date;
- due date when time is not relevant;
- report date.

## 7.2 Not timestamp

```java
LocalDate createdAt // bad
```

CreatedAt should be `Instant`.

## 7.3 Date arithmetic

```java
date.plusDays(1)
date.plusMonths(1)
date.withDayOfMonth(1)
```

## 7.4 End of month

```java
LocalDate end = date.with(TemporalAdjusters.lastDayOfMonth());
```

## 7.5 Convert to start of day

Need zone:

```java
Instant start = date.atStartOfDay(zone).toInstant();
```

Be careful: start of day may be affected by DST in some zones.

## 7.6 Date range

Use clear boundary:

```java
record DateRange(LocalDate startInclusive, LocalDate endExclusive) {}
```

End-exclusive often avoids off-by-one issues.

---

# 8. `LocalTime`: Jam Tanpa Tanggal dan Zone

`LocalTime` represents time of day without date or time zone.

```java
LocalTime opening = LocalTime.of(9, 0);
```

## 8.1 Good use cases

- office opening time;
- daily cut-off time;
- schedule time-of-day;
- recurring daily alarm local time.

## 8.2 Not instant

`09:00` is not a timestamp.

It happens every day and depends on zone/date.

## 8.3 Combine with date

```java
LocalDateTime ldt = LocalDateTime.of(date, opening);
```

Still no zone.

## 8.4 Combine with zone/date to get instant

```java
Instant instant = LocalDateTime.of(date, opening)
    .atZone(zone)
    .toInstant();
```

## 8.5 Business rule

```text
Cutoff at 17:00 Asia/Singapore
```

needs:

```java
LocalTime cutoff
ZoneId zone
```

and date context.

---

# 9. `LocalDateTime`: Tanggal+Jam Tanpa Zone

`LocalDateTime` is an immutable date-time object representing date-time without time-zone, such as `2007-12-03T10:15:30`, with nanosecond precision.

```java
LocalDateTime local = LocalDateTime.of(2026, 6, 12, 10, 30);
```

## 9.1 Good use cases

- user-entered local appointment before zone attached;
- local schedule template;
- database type that intentionally has no zone;
- civil date-time in known contextual zone.

## 9.2 Dangerous for audit

Bad:

```java
LocalDateTime createdAt = LocalDateTime.now();
```

Why bad?

Because no zone/offset. If two servers in different zones generate values, comparisons are ambiguous.

Use:

```java
Instant createdAt
```

## 9.3 Cannot uniquely convert to instant without zone

```java
local.atZone(zone).toInstant()
```

Need `ZoneId`.

## 9.4 DST invalid/ambiguous local time

Some local date-times don't exist or occur twice in certain zones.

Example concept:

```text
02:30 during DST spring gap may not exist.
01:30 during DST fall overlap may occur twice.
```

## 9.5 Use carefully

`LocalDateTime` is not “date-time best default”.

It is “local civil date-time without zone”.

---

# 10. `ZoneId` dan `ZoneOffset`

## 10.1 ZoneId

`ZoneId` identifies rules used to convert between `Instant` and `LocalDateTime`; example IDs include `Europe/Paris`.

```java
ZoneId singapore = ZoneId.of("Asia/Singapore");
ZoneId jakarta = ZoneId.of("Asia/Jakarta");
```

## 10.2 ZoneOffset

Fixed offset from UTC.

```java
ZoneOffset offset = ZoneOffset.of("+07:00");
```

## 10.3 ZoneId vs ZoneOffset

`Asia/Jakarta` is a zone with rules.

`+07:00` is just fixed offset.

If rules change, ZoneId can capture historical/future transitions.

## 10.4 Store user zone

For user preferences:

```java
ZoneId userZone
```

not just offset.

## 10.5 Validate zone ID

External zone string:

```java
ZoneId.of(raw)
```

can throw exception if invalid.

Map to validation error.

## 10.6 System default zone

Avoid relying on:

```java
ZoneId.systemDefault()
```

in domain logic.

Inject/configure zone explicitly.

---

# 11. `OffsetDateTime`

`OffsetDateTime` combines date-time with offset.

```java
OffsetDateTime odt = OffsetDateTime.now(ZoneOffset.UTC);
```

## 11.1 Good use cases

- API timestamps with offset;
- database `TIMESTAMP WITH OFFSET` style data;
- external protocols requiring offset date-time;
- representing local date-time plus fixed offset.

## 11.2 Not full time zone

Offset does not know zone rules.

```text
2026-06-12T10:00+07:00
```

does not say whether zone is `Asia/Jakarta`.

## 11.3 Instant conversion

```java
Instant instant = odt.toInstant();
```

## 11.4 Java API note

Java SE 25 `OffsetDateTime` documentation says it is intended that `ZonedDateTime` or `Instant` is used to model data in simpler applications, while `OffsetDateTime` may be used for more detail or communication with databases/network protocols.

## 11.5 API choice

For public API, ISO offset date-time is common:

```json
"2026-06-12T10:15:30+07:00"
```

But internally for event timestamp, use `Instant`.

---

# 12. `ZonedDateTime`

`ZonedDateTime` is an immutable representation of date-time with time-zone. Java SE 25 API describes it as storing date/time fields to nanosecond precision and a time-zone, with zone offset used to handle ambiguous local date-times.

```java
ZonedDateTime zdt = ZonedDateTime.now(ZoneId.of("Asia/Jakarta"));
```

## 12.1 Good use cases

- scheduled meeting in a real zone;
- recurring local events with zone rules;
- user-facing timestamp with zone;
- business cutoff in zone;
- converting instant to local display;
- date-time where zone rules matter.

## 12.2 Contains ZoneId and resolved offset

```java
2026-06-12T10:00+07:00[Asia/Jakarta]
```

## 12.3 Convert Instant to ZonedDateTime

```java
ZonedDateTime localView = instant.atZone(userZone);
```

## 12.4 Convert local to ZonedDateTime

```java
ZonedDateTime eventTime = LocalDateTime.of(date, time).atZone(zone);
```

Be aware of DST gaps/overlaps.

## 12.5 Not always ideal for storage

For audit/event storage, `Instant` is usually simpler.

Store `ZoneId` separately if original user zone matters.

## 12.6 Display

Use `ZonedDateTime` for display formatting in user zone.

---

# 13. `Duration` vs `Period`

## 13.1 Duration

Machine-based amount of time.

```java
Duration timeout = Duration.ofSeconds(30);
Duration ttl = Duration.ofHours(24);
```

Use for:

- timeout;
- TTL;
- latency;
- SLA duration;
- retry delay;
- elapsed time.

## 13.2 Period

Date-based amount in years/months/days.

```java
Period oneMonth = Period.ofMonths(1);
```

Use for:

- subscription period;
- age calculation;
- calendar month/year;
- license valid for 1 year;
- business date arithmetic.

## 13.3 Difference

```text
Duration.ofDays(1) = 24 hours
Period.ofDays(1) = next calendar date
```

In DST zones, next calendar day may not be 24 hours.

## 13.4 Example

```java
ZonedDateTime before = ...
before.plus(Duration.ofDays(1))
before.plus(Period.ofDays(1))
```

Can produce different local times around DST.

## 13.5 Rule

Use `Duration` for machine elapsed time.

Use `Period` for calendar date amount.

---

# 14. `Clock`: Time as Dependency

`Clock` provides access to current instant/date/time using a time-zone. Java SE 25 API notes `Clock` can be used instead of `System.currentTimeMillis()` and `TimeZone.getDefault()`.

## 14.1 Bad

```java
Instant now = Instant.now();
```

inside domain service makes test non-deterministic.

## 14.2 Good

```java
final class TokenService {
    private final Clock clock;

    TokenService(Clock clock) {
        this.clock = Objects.requireNonNull(clock);
    }

    Token issue(Duration ttl) {
        Instant now = clock.instant();
        return new Token(now, now.plus(ttl));
    }
}
```

## 14.3 Fixed clock in tests

```java
Clock fixed = Clock.fixed(
    Instant.parse("2026-06-12T00:00:00Z"),
    ZoneOffset.UTC
);
```

## 14.4 Offset clock

```java
Clock offset = Clock.offset(clock, Duration.ofHours(1));
```

## 14.5 System clock

```java
Clock.systemUTC()
Clock.system(zone)
```

## 14.6 Rule

Inject `Clock` into services that need current time.

---

# 15. Date/Time Arithmetic

## 15.1 Instant arithmetic

```java
instant.plus(Duration.ofMinutes(30))
instant.minus(Duration.ofDays(1))
```

Good for machine time.

## 15.2 LocalDate arithmetic

```java
date.plusDays(1)
date.plusMonths(1)
date.plusYears(1)
```

Calendar-aware.

## 15.3 ZonedDateTime arithmetic

```java
zdt.plusHours(24)
zdt.plusDays(1)
```

May differ around DST.

## 15.4 End-exclusive intervals

Prefer:

```java
[startInclusive, endExclusive)
```

Example:

```java
boolean contains(Instant x) {
    return !x.isBefore(start) && x.isBefore(end);
}
```

## 15.5 Month arithmetic

```java
LocalDate.of(2026, 1, 31).plusMonths(1)
```

Can become last valid day in February depending API behavior.

Know business rule.

## 15.6 Business day arithmetic

Business day is not just plusDays.

Need holiday/weekend calendar.

---

# 16. DST: Daylight Saving Time dan Ambiguous Time

Indonesia does not use DST currently, but systems often serve global users.

## 16.1 Gap

Spring forward: some local times do not exist.

```text
02:30 local time may be skipped.
```

## 16.2 Overlap

Fall back: some local times occur twice.

```text
01:30 local time may happen twice with different offsets.
```

## 16.3 LocalDateTime ambiguity

```java
LocalDateTime local = ...
```

without zone cannot resolve gap/overlap.

## 16.4 ZonedDateTime resolution

`ZonedDateTime` APIs resolve according to zone rules, with methods to handle offsets.

## 16.5 Scheduling implication

If event scheduled at 02:30 local time, what happens on DST gap day?

You need business policy:

- skip;
- run at next valid time;
- run before transition;
- fail validation.

## 16.6 Testing

Test date/time logic with DST zones, not only UTC/Jakarta.

Examples:

```java
Europe/Paris
America/New_York
```

---

# 17. Time Zone Database dan Political Time

Time zone rules change.

## 17.1 ZoneId depends on TZDB

JDK includes time-zone database.

Governments can change rules.

## 17.2 Store ZoneId for future scheduled events

If meeting is “every Monday 09:00 Asia/Singapore”, store:

```java
LocalTime
DayOfWeek
ZoneId
```

not only next Instant.

## 17.3 Future events

Future instant computed today might become wrong if zone rules change.

Depending domain, recompute using latest rules.

## 17.4 Offset not enough

`+07:00` lacks location/rule identity.

## 17.5 Operational concern

Keep JDK/tzdata updated for global scheduling systems.

---

# 18. Formatting dan Parsing dengan `DateTimeFormatter`

`DateTimeFormatter` formats and parses date-time objects. Java SE 25 API provides factory methods such as localized formatters and `ofPattern`, and `parse`.

## 18.1 ISO format

```java
Instant instant = Instant.parse("2026-06-12T10:15:30Z");
String text = instant.toString();
```

## 18.2 Formatter

```java
DateTimeFormatter formatter = DateTimeFormatter.ISO_OFFSET_DATE_TIME;
```

## 18.3 Custom pattern

```java
DateTimeFormatter formatter =
    DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm:ss", Locale.ROOT);
```

Use `uuuu` for proleptic year in many cases, not always `yyyy`.

## 18.4 Locale

```java
DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)
    .withLocale(locale);
```

## 18.5 Zone

Formatter can have zone:

```java
formatter.withZone(ZoneId.of("Asia/Jakarta"));
```

## 18.6 Thread-safety

`DateTimeFormatter` is immutable/thread-safe, unlike `SimpleDateFormat`.

## 18.7 Parsing errors

Parsing throws `DateTimeParseException`.

Map to validation error at API boundary.

---

# 19. Locale, Chronology, dan User Display

## 19.1 Locale affects display

```java
12 Jun 2026
Jun 12, 2026
12 juin 2026
```

## 19.2 User zone affects displayed date

Same instant can be different date in different zones.

```java
Instant instant = Instant.parse("2026-06-12T23:30:00Z");
```

In some zones, local date is June 13.

## 19.3 Store instant, display in user zone

```java
instant.atZone(userZone)
```

## 19.4 Chronology

Most apps use ISO calendar. Some apps need non-ISO calendars for display.

Keep storage/domain consistent unless requirements say otherwise.

## 19.5 Do not format for storage

Store machine-readable values, not localized strings.

---

# 20. Serialization: ISO-8601 dan API Contract

## 20.1 Recommended external formats

Examples:

```json
"2026-06-12"                         // LocalDate
"10:15:30"                           // LocalTime
"2026-06-12T10:15:30"                // LocalDateTime, no zone
"2026-06-12T10:15:30+07:00"          // OffsetDateTime
"2026-06-12T03:15:30Z"               // Instant UTC
"2026-06-12T10:15:30+07:00[Asia/Jakarta]" // Java ZonedDateTime string, not always desired API format
```

## 20.2 API should document type meaning

```text
createdAt: instant in UTC
dueDate: local date in agency business zone
appointmentTime: local date-time with zone ID
```

## 20.3 Avoid epoch milliseconds unless necessary

Epoch millis is compact but less readable and may create JS precision/timezone confusion.

## 20.4 LocalDateTime in API

Only use when no offset/zone is intentionally part of contract.

Otherwise prefer offset date-time or instant.

## 20.5 Preserve zone if semantically important

If user scheduled event in `Asia/Singapore`, do not serialize only instant if recurrence/local intent matters.

---

# 21. Database Mapping

## 21.1 SQL types vary

Common concepts:

- DATE;
- TIME;
- TIMESTAMP WITHOUT TIME ZONE;
- TIMESTAMP WITH TIME ZONE;
- BIGINT epoch;
- VARCHAR ISO string.

DB semantics differ across vendors.

## 21.2 Store Instant for audit

Recommended:

```java
Instant createdAt
```

DB column:

```text
TIMESTAMP WITH TIME ZONE
```

or UTC timestamp depending DB convention.

Be explicit.

## 21.3 LocalDate for date-only

```java
LocalDate birthDate
```

DB:

```sql
DATE
```

## 21.4 LocalDateTime for timestamp without zone

Use only when domain is local date-time without zone.

## 21.5 ZoneId storage

Store as string:

```sql
zone_id VARCHAR(64)
```

Example:

```text
Asia/Jakarta
Europe/Paris
```

## 21.6 Precision

DB may truncate nanos to micros/millis.

Equality tests should account for precision.

## 21.7 ORM

Modern JDBC/JPA support `java.time` types, but verify mapping per database and driver.

---

# 22. JSON/API Boundary

## 22.1 Request parsing

Validate date/time format strictly.

Do not accept ambiguous date formats:

```text
01/02/2026
```

Is it Jan 2 or Feb 1?

## 22.2 Response formatting

Use ISO-8601.

## 22.3 Zone policy

For timestamps:

```text
Always UTC Instant with Z
```

or:

```text
OffsetDateTime with client offset
```

Document.

## 22.4 Frontend JavaScript

JavaScript Date has its own quirks. Coordinate contract carefully.

## 22.5 Missing/null

Date field can be:

```json
{}
{"expiresAt": null}
{"expiresAt": "2026-06-12T00:00:00Z"}
```

Model missing/null semantics.

---

# 23. Scheduling dan Recurrence

Scheduling is not same as storing timestamp.

## 23.1 One-time absolute job

```java
Instant runAt
```

## 23.2 Local appointment

```java
LocalDateTime localDateTime
ZoneId zone
```

or:

```java
ZonedDateTime scheduledAt
```

## 23.3 Recurring schedule

```text
Every Monday at 09:00 Asia/Singapore
```

Model:

```java
DayOfWeek dayOfWeek
LocalTime time
ZoneId zone
```

Generate next Instant when needed.

## 23.4 Monthly recurrence

```text
31st of every month
```

Needs policy for February.

## 23.5 DST policy

Define what happens if local scheduled time is invalid/ambiguous.

## 23.6 Cron

Cron expressions often interpreted in a zone.

Always specify zone.

---

# 24. Audit, CreatedAt, UpdatedAt, dan Event Time

## 24.1 Audit fields

Use:

```java
Instant createdAt
Instant updatedAt
```

## 24.2 Source of truth

Use application clock or DB clock consistently.

Mixed clocks can create ordering issues.

## 24.3 Event time vs processing time

Event occurredAt:

```java
Instant occurredAt
```

Processing time:

```java
Instant processedAt
```

They differ.

## 24.4 ReceivedAt

For messages:

```java
publishedAt
receivedAt
processedAt
```

Each has different meaning.

## 24.5 Clock skew

Distributed systems have clock skew.

Do not assume timestamps prove strict causality unless architecture supports it.

Use sequence/version/event ordering where needed.

---

# 25. Expiration, Timeout, SLA, dan Deadline

## 25.1 Expiration

```java
Instant expiresAt = clock.instant().plus(ttl);
```

TTL type:

```java
Duration ttl
```

## 25.2 Timeout

Use `Duration`.

```java
Duration timeout = Duration.ofSeconds(5);
```

## 25.3 Deadline

Absolute point:

```java
Instant deadline
```

## 25.4 SLA

Could be:

```java
Duration responseSla
Instant dueAt
```

Depending if measuring elapsed or due timestamp.

## 25.5 Monotonic time

For measuring elapsed time in same JVM, `System.nanoTime()` is better than wall clock.

`Instant.now()` can move due clock adjustment.

## 25.6 Business deadline

If deadline is “by end of business day in Singapore”, use `LocalDate` + business calendar + ZoneId to compute `Instant`.

---

# 26. Business Date dan Cut-Off Time

## 26.1 Business date

A transaction at 01:00 may belong to previous business date depending cutoff.

Model explicitly:

```java
record BusinessDate(LocalDate value) {}
```

## 26.2 Cutoff

```java
record BusinessCutoff(LocalTime time, ZoneId zone) {}
```

## 26.3 Compute business date

```java
LocalDate businessDate(Instant instant, BusinessCutoff cutoff) {
    ZonedDateTime zdt = instant.atZone(cutoff.zone());
    LocalDate date = zdt.toLocalDate();
    if (zdt.toLocalTime().isBefore(cutoff.time())) {
        return date.minusDays(1);
    }
    return date;
}
```

## 26.4 Holidays/weekends

Business day requires calendar service/data.

## 26.5 Domain type

Do not use raw LocalDate everywhere if business date has special meaning.

Use `BusinessDate`.

---

# 27. Testing Time

## 27.1 Inject Clock

```java
Clock fixed = Clock.fixed(
    Instant.parse("2026-06-12T00:00:00Z"),
    ZoneOffset.UTC
);
```

## 27.2 Test zone conversions

```java
ZoneId.of("Asia/Jakarta")
ZoneId.of("UTC")
ZoneId.of("America/New_York")
```

## 27.3 Test DST

Use zones with DST.

## 27.4 Test boundary

- end of month;
- leap year;
- midnight;
- year boundary;
- DST gap/overlap;
- precision truncation;
- null input;
- invalid format.

## 27.5 Avoid sleeping tests

Bad:

```java
Thread.sleep(1000)
```

Better inject clock or fake scheduler.

## 27.6 Deterministic expiration

```java
Clock base = Clock.fixed(...);
```

Then assert `expiresAt`.

---

# 28. Equality, Ordering, dan Comparison

## 28.1 Instant comparison

```java
a.isBefore(b)
a.isAfter(b)
a.equals(b)
```

## 28.2 LocalDate comparison

```java
date.isBefore(other)
```

## 28.3 ZonedDateTime equality

Two `ZonedDateTime` can represent same instant but different zone.

```java
zdt1.toInstant().equals(zdt2.toInstant())
```

If timeline equality needed, compare Instant.

If local representation equality needed, compare ZonedDateTime.

## 28.4 OffsetDateTime

Same instant can have different offset representations.

Decide semantic.

## 28.5 Precision issue

DB truncation:

```java
2026-06-12T10:00:00.123456789Z
```

may come back as:

```java
2026-06-12T10:00:00.123456Z
```

Normalize/truncate before persistence or tests.

## 28.6 Sorting

Sort events by `Instant`, then stable tie-breaker:

```java
Comparator.comparing(Event::occurredAt)
    .thenComparing(Event::eventId)
```

---

# 29. Nullability dan Optional Date/Time

## 29.1 Required timestamp

```java
Instant createdAt
```

Non-null.

## 29.2 Optional timestamp

```java
Optional<Instant> completedAt()
```

as return accessor may be okay.

## 29.3 State-specific time

Instead of:

```java
Instant closedAt; // null unless closed
```

use sealed state:

```java
record Closed(Instant closedAt, ...) implements CaseState {}
```

## 29.4 DB nullable timestamp

Boundary may use nullable wrapper/reference, then map to domain.

## 29.5 Unknown vs absent

Unknown date is not same as absent date.

Model explicitly if important.

---

# 30. Domain-Specific Date/Time Types

## 30.1 CreatedAt

Maybe raw `Instant` enough.

But for strong domain:

```java
record CreatedAt(Instant value) {
    CreatedAt {
        Objects.requireNonNull(value);
    }
}
```

## 30.2 DateRange

```java
record DateRange(LocalDate startInclusive, LocalDate endExclusive) {
    DateRange {
        Objects.requireNonNull(startInclusive);
        Objects.requireNonNull(endExclusive);
        if (!startInclusive.isBefore(endExclusive)) {
            throw new IllegalArgumentException("start must be before end");
        }
    }

    boolean contains(LocalDate date) {
        return !date.isBefore(startInclusive) && date.isBefore(endExclusive);
    }
}
```

## 30.3 InstantRange

```java
record InstantRange(Instant startInclusive, Instant endExclusive) {}
```

## 30.4 BusinessDate

```java
record BusinessDate(LocalDate value) {}
```

## 30.5 Expiration

```java
record Expiration(Instant expiresAt) {
    boolean isExpired(Clock clock) {
        return !clock.instant().isBefore(expiresAt);
    }
}
```

## 30.6 AppointmentTime

```java
record AppointmentTime(LocalDateTime localDateTime, ZoneId zone) {
    ZonedDateTime zoned() {
        return localDateTime.atZone(zone);
    }
}
```

Add DST policy if needed.

---

# 31. Performance dan Precision

## 31.1 java.time objects allocation

They are objects. Fine for business logic.

For high-frequency telemetry, consider performance carefully.

## 31.2 Instant.now cost

System clock access has cost and can vary by OS/JVM.

Do not call repeatedly inside tight loop if one timestamp sufficient.

```java
Instant now = clock.instant();
for (...) {
    ...
}
```

## 31.3 Precision source

Clock may not actually provide nanosecond precision.

## 31.4 Database precision

Normalize:

```java
instant.truncatedTo(ChronoUnit.MILLIS)
```

if DB stores millis.

## 31.5 Epoch millis

For very high-volume storage, epoch millis/seconds may be used, but wrap with domain type and document unit.

## 31.6 Unit bugs

```java
long timeout = 5000; // ms? seconds?
```

Use `Duration`.

---

# 32. Production Failure Modes

## 32.1 LocalDateTime for createdAt

Server zone changes; timestamps inconsistent.

Fix:

```java
Instant createdAt
```

## 32.2 System default time zone dependency

Code works locally, fails in container/region.

Fix:

- explicit ZoneId;
- inject Clock.

## 32.3 DST gap scheduling bug

Job scheduled at nonexistent local time.

Fix:

- define DST policy;
- test DST zones.

## 32.4 Duration vs Period mix-up

Adding 24h vs next calendar day produces wrong business result.

Fix:

- Duration for machine elapsed;
- Period for calendar.

## 32.5 Offset stored instead of ZoneId

Future recurrence wrong after rule change.

Fix:

- store ZoneId for local recurring schedules.

## 32.6 Date parsed with ambiguous format

`01/02/2026` interpreted differently.

Fix:

- ISO format;
- strict formatter;
- locale-aware display only.

## 32.7 Precision equality failure

DB truncates nanos; tests fail.

Fix:

- truncate/normalize at boundary;
- compare with expected precision.

## 32.8 SimpleDateFormat shared static

Thread-safety bug.

Fix:

- DateTimeFormatter.

## 32.9 Expiration uses wall clock for elapsed time

Clock adjustment causes weird timeout measurement.

Fix:

- use monotonic time for elapsed measurement;
- Instant for absolute deadline.

## 32.10 Null closedAt with CLOSED status

Invalid state.

Fix:

- sealed state or constructor invariant.

## 32.11 API sends LocalDateTime without zone

Client interprets in its local zone.

Fix:

- send Instant/OffsetDateTime or include zone.

## 32.12 Business date cut-off bug

Transaction near midnight assigned wrong business date.

Fix:

- explicit BusinessDate/Cutoff/ZoneId logic.

---

# 33. Best Practices

## 33.1 Type choice

- Use `Instant` for machine timestamp/audit/event time.
- Use `LocalDate` for date-only business concepts.
- Use `LocalTime` for time-of-day concepts.
- Use `LocalDateTime` only when zone intentionally absent.
- Use `ZonedDateTime` for date-time with zone rules.
- Use `OffsetDateTime` for external protocol/database offset timestamp.
- Use `Duration` for elapsed machine time.
- Use `Period` for calendar amount.
- Use `Clock` for current time dependency.

## 33.2 Zone

- Avoid system default zone in domain logic.
- Store ZoneId when local human time matters.
- Do not confuse offset with zone.
- Test with DST zones.

## 33.3 Boundary

- Use ISO-8601 in APIs.
- Document semantics of each date/time field.
- Normalize database precision.
- Map parsing errors to validation responses.
- Define missing/null semantics.

## 33.4 Domain

- Use domain-specific types for ranges, business date, expiration, appointment.
- Prefer end-exclusive intervals.
- Avoid nullable time fields for state-specific data.
- Inject Clock in services.

## 33.5 Testing

- Use fixed Clock.
- Test leap years/end-of-month/DST.
- Avoid sleep-based tests.

---

# 34. Decision Matrix

| Situation | Recommended type |
|---|---|
| createdAt/updatedAt | `Instant` |
| event occurredAt | `Instant` |
| token expiration | `Instant` + `Duration` |
| timeout/retry delay | `Duration` |
| birth date | `LocalDate` |
| license expiry date | `LocalDate` or domain type |
| business date | `BusinessDate` wrapping `LocalDate` |
| office opens at 09:00 | `LocalTime` + `ZoneId` context |
| appointment in user zone | `ZonedDateTime` or `LocalDateTime` + `ZoneId` |
| recurring Monday 09:00 | `DayOfWeek` + `LocalTime` + `ZoneId` |
| API timestamp | `Instant` or `OffsetDateTime` |
| DB audit timestamp | `Instant` mapped explicitly |
| local DB date | `LocalDate` |
| elapsed latency | `Duration` or `System.nanoTime()` measurement |
| calendar subscription 1 month | `Period` |
| timestamp with fixed offset | `OffsetDateTime` |
| display to user | `Instant` -> `ZonedDateTime` with user zone |
| range | `InstantRange` / `DateRange` |
| current time in testable service | injected `Clock` |

---

# 35. Latihan

## Latihan 1 — createdAt

Refactor:

```java
LocalDateTime createdAt = LocalDateTime.now();
```

to:

```java
Instant createdAt = clock.instant();
```

## Latihan 2 — BirthDate

Create:

```java
record BirthDate(LocalDate value)
```

Validate not future.

## Latihan 3 — DateRange

Implement end-exclusive `DateRange` with `contains`.

## Latihan 4 — InstantRange

Implement `InstantRange` with overlap detection.

## Latihan 5 — Clock Testing

Create `TokenService` with injected Clock. Test expiration with fixed clock.

## Latihan 6 — Duration vs Period

In a DST zone, compare:

```java
zdt.plus(Duration.ofDays(1))
zdt.plus(Period.ofDays(1))
```

Explain difference.

## Latihan 7 — API Parsing

Parse ISO instant string. Map invalid format to validation error.

## Latihan 8 — Business Date

Implement business date calculation with cutoff 05:00 Asia/Jakarta.

## Latihan 9 — Precision

Simulate DB truncation to millis and fix equality test.

## Latihan 10 — Scheduling

Model recurring schedule:

```text
Every Monday 09:00 Europe/Paris
```

Generate next 5 instants and observe DST behavior.

## Latihan 11 — Zoned vs Offset

Compare storing:

```java
OffsetDateTime
ZonedDateTime
```

for future appointment. Explain trade-off.

## Latihan 12 — State-specific timestamp

Refactor:

```java
CaseStatus status;
Instant closedAt;
```

to sealed state where closedAt only exists in Closed variant.

---

# 36. Ringkasan

Date/time correctness dimulai dari memilih type yang tepat.

Mental model utama:

```text
Machine time:
  Instant, Duration, Clock

Human/civil time:
  LocalDate, LocalTime, LocalDateTime, ZonedDateTime, Period, ZoneId
```

Hal penting:

- `Instant` untuk timestamp global.
- `LocalDate` untuk date-only.
- `LocalDateTime` bukan timestamp global.
- `ZoneId` bukan sama dengan `ZoneOffset`.
- `ZonedDateTime` membawa local date-time + zone rules.
- `Duration` adalah elapsed time.
- `Period` adalah calendar amount.
- Inject `Clock` agar logic testable.
- DST membuat local time bisa invalid/ambiguous.
- API/DB harus punya format dan semantics jelas.
- Gunakan ISO-8601.
- Jangan bergantung pada system default zone.
- Hindari nullable timestamp untuk state-specific data; gunakan state modeling.
- Test edge cases: DST, leap year, end of month, precision.

Senior Java engineer tidak bertanya “pakai Date apa LocalDateTime?”, tetapi:

```text
Apakah ini titik timeline global?
Apakah ini tanggal manusia?
Apakah zone penting?
Apakah offset cukup?
Apakah ini elapsed duration atau calendar period?
Apakah current time harus testable?
Apakah boundary menyimpan precision yang sama?
```

Dari pertanyaan itu, type yang benar akan terlihat.

---

# 37. Referensi

1. Java SE 25 API — `java.time` package summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/package-summary.html

2. Java SE 25 API — `Instant`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Instant.html

3. Java SE 25 API — `LocalDate`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/LocalDate.html

4. Java SE 25 API — `LocalDateTime`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/LocalDateTime.html

5. Java SE 25 API — `ZoneId`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/ZoneId.html

6. Java SE 25 API — `OffsetDateTime`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/OffsetDateTime.html

7. Java SE 25 API — `ZonedDateTime`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/ZonedDateTime.html

8. Java SE 25 API — `Duration`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Duration.html

9. Java SE 25 API — `Period`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Period.html

10. Java SE 25 API — `Clock`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Clock.html

11. Java SE 25 API — `DateTimeFormatter`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/format/DateTimeFormatter.html

12. Oracle Java Tutorial — Date Time Overview  
    https://docs.oracle.com/javase/tutorial/datetime/iso/overview.html

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-data-types-part-017.md](./learn-java-data-types-part-017.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-data-types-part-019.md](./learn-java-data-types-part-019.md)

</div>
# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-030.md

# Part 030 — Domain Case Study I: Market Data / Trading Analytics

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami time-series database dan QuestDB sampai level production architecture.  
> Fokus part ini: menerapkan QuestDB pada domain market data dan trading analytics, bukan mengulang teori SQL, Kafka, atau OLAP umum.

---

## 0. Posisi Part Ini dalam Seri

Sampai part sebelumnya kita sudah membangun fondasi:

- mental model time-series;
- positioning QuestDB;
- architecture, storage, WAL, partitioning;
- ingestion model;
- Java ingestion client;
- event modeling;
- schema evolution;
- out-of-order data;
- deduplication;
- temporal SQL;
- materialized views;
- query engine;
- retention/capacity/deployment/observability/failure modes;
- backup/security/integration/pipeline/backfill/benchmark.

Part ini adalah **case study domain pertama**: market data dan trading analytics.

Tujuannya bukan membuat trading platform production-ready penuh, karena trading system memiliki concern tambahan seperti order management, risk, matching engine, compliance, exchange connectivity, dan low-latency networking. Fokus kita adalah bagian yang sangat cocok untuk QuestDB:

```text
high-volume time-stamped market observations
→ stored durably
→ queryable with temporal SQL
→ usable for analytics, replay, monitoring, and dashboarding
```

Market data adalah domain yang bagus untuk belajar QuestDB karena ia memaksa kita menghadapi hampir semua problem time-series secara ekstrem:

- timestamp presisi tinggi;
- ingest throughput besar;
- out-of-order ticks;
- duplicate messages;
- symbol cardinality;
- temporal joins;
- raw vs rollup retention;
- latest state query;
- OHLC/VWAP/spread analytics;
- historical backfill;
- correctness under sparse and irregular streams.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu harus mampu:

1. Mendesain model data QuestDB untuk trades, quotes, order book snapshots, dan derived bars.
2. Memahami timestamp semantics untuk market data: exchange timestamp, receive timestamp, ingest timestamp, sequence number.
3. Memilih `TIMESTAMP_NS`, `SYMBOL`, partition granularity, dan dedup key yang masuk akal.
4. Membangun ingestion gateway Java untuk tick stream.
5. Menulis query untuk latest price, spread, VWAP, OHLC, quote-at-trade-time, dan market data quality checks.
6. Menggunakan temporal join seperti `ASOF JOIN` untuk menghubungkan trade dengan quote terakhir.
7. Mendesain materialized views untuk candle/bar data.
8. Mengelola late ticks, corrections, replay, dan backfill.
9. Menyusun operational runbook market-data-specific.
10. Menilai apakah QuestDB cocok sebagai market data store untuk use case tertentu.

---

## 2. Batas Domain: Apa yang Dibahas dan Tidak Dibahas

### 2.1 Yang Dibahas

Kita fokus pada **market data analytics store**:

- trade ticks;
- quote ticks;
- best bid/ask;
- top-of-book snapshots;
- simple order book depth snapshots;
- OHLC bars;
- VWAP;
- spread;
- quote/trade alignment;
- replay/backfill;
- dashboard and query API;
- freshness monitoring;
- data quality validation.

### 2.2 Yang Tidak Dibahas Mendalam

Tidak dibahas secara detail:

- exchange gateway protocol internals;
- FIX protocol secara lengkap;
- matching engine design;
- order management system;
- risk engine;
- smart order routing;
- regulatory reporting format tertentu;
- FPGA/kernel-bypass ultra-low-latency architecture;
- market microstructure theory mendalam.

Namun beberapa konsep akan disinggung ketika memengaruhi data model QuestDB.

---

## 3. Mental Model Utama: Market Data Is Irregular Time-Series with Identity and Sequence

Data market tidak seperti metric server yang datang tiap 10 detik. Ia irregular:

```text
AAPL trade at 10:00:00.001234567
AAPL quote at 10:00:00.001235001
MSFT quote at 10:00:00.001235030
AAPL trade at 10:00:00.001235044
BTC-USD book update at 10:00:00.001235050
```

Tidak ada fixed interval yang aman diasumsikan.

Market data juga punya identitas kuat:

```text
instrument + venue + feed + event type + timestamp + sequence/trade id
```

Dan ia biasanya punya ordering metadata:

```text
exchange sequence
feed sequence
publisher sequence
receive order
```

Mental model yang tepat:

```text
market data row = observation about an instrument at a precise event time
                  with source identity, sequence identity, and measured values
```

Bukan:

```text
market data row = current price object
```

Jika kamu memodelkan market data sebagai mutable current state object, kamu akan kehilangan historical correctness, replayability, audit trail, dan temporal join ability.

---

## 4. Core Entities in Market Data

### 4.1 Instrument

Instrument adalah sesuatu yang diperdagangkan:

```text
AAPL
MSFT
BTC-USD
ETH-USDT
EUR/USD
US10Y
ESM6
```

Dalam table QuestDB, instrument biasanya menjadi `SYMBOL`.

Contoh columns:

```sql
symbol SYMBOL,
asset_class SYMBOL,
base_asset SYMBOL,
quote_asset SYMBOL
```

Namun jangan memasukkan metadata instrument yang berubah jarang ke semua tick jika tidak perlu. Metadata bisa tinggal di reference table atau service lain.

### 4.2 Venue

Venue adalah sumber/market/exchange:

```text
NASDAQ
NYSE
CME
BINANCE
COINBASE
LSE
internal_aggregated
```

Venue biasanya `SYMBOL`.

### 4.3 Feed

Feed membedakan data source:

```text
ITCH
FIX_MD
websocket
vendor_a
vendor_b
internal_normalized
```

Feed penting untuk:

- reconciliation;
- failover;
- data quality;
- vendor comparison;
- audit.

### 4.4 Trade

Trade adalah execution event yang terjadi di market:

```text
instrument traded at price P, quantity Q, at time T, on venue V
```

Common columns:

```text
symbol
venue
feed
trade_id
price
size
side/aggressor_side if available
exchange_ts
recv_ts
ingest_ts
sequence
condition
```

### 4.5 Quote

Quote adalah bid/ask update:

```text
best bid = x, bid size = y, best ask = a, ask size = b
```

Common columns:

```text
symbol
venue
feed
bid_price
bid_size
ask_price
ask_size
exchange_ts
recv_ts
ingest_ts
sequence
```

### 4.6 Order Book Snapshot / Depth

Order book data bisa berupa:

1. level update;
2. full snapshot;
3. top N levels snapshot;
4. reconstructed book state.

Untuk QuestDB analytics, sering kali lebih aman menyimpan:

- raw update stream;
- periodic top-of-book / depth snapshot;
- derived aggregate table.

Jangan buru-buru menyimpan full book sebagai JSON blob jika query akan membutuhkan level-specific analytics.

---

## 5. Timestamp Semantics in Market Data

Market data biasanya memiliki lebih dari satu timestamp.

### 5.1 Exchange Timestamp

Waktu event menurut exchange atau source utama.

```text
exchange_ts = when the market event happened according to the exchange/source
```

Ini biasanya kandidat terbaik untuk designated timestamp karena query market analytics biasanya bertanya:

```text
what happened in the market between T1 and T2?
```

Bukan:

```text
when did my server receive it?
```

### 5.2 Receive Timestamp

Waktu sistem kita menerima message.

```text
recv_ts = when our gateway received the event
```

Berguna untuk latency monitoring:

```text
recv_ts - exchange_ts
```

### 5.3 Ingest Timestamp

Waktu event ditulis ke QuestDB.

```text
ingest_ts = when the database ingestion layer accepted/sent the event
```

Berguna untuk pipeline lag:

```text
ingest_ts - recv_ts
```

### 5.4 Processing Timestamp

Waktu event diproses/normalized oleh service.

Berguna jika ada enrichment pipeline.

### 5.5 Sequence Number

Sequence bukan timestamp, tapi sangat penting.

```text
sequence = monotonic order from exchange/feed/channel
```

Sequence membantu mendeteksi:

- gap;
- duplicate;
- reorder;
- replay;
- feed reset;
- dropped message.

### 5.6 Recommended Pattern

Untuk trade/quote raw tables:

```text
designated timestamp = exchange_ts
columns include recv_ts and ingest_ts
columns include sequence/trade_id where available
```

Contoh:

```sql
CREATE TABLE trades (
    symbol SYMBOL,
    venue SYMBOL,
    feed SYMBOL,
    trade_id VARCHAR,
    sequence LONG,
    price DOUBLE,
    size DOUBLE,
    condition SYMBOL,
    recv_ts TIMESTAMP_NS,
    ingest_ts TIMESTAMP_NS,
    exchange_ts TIMESTAMP_NS
) TIMESTAMP(exchange_ts)
PARTITION BY DAY
WAL;
```

Kenapa `exchange_ts` sebagai designated timestamp?

Karena partitioning, range query, OHLC, VWAP, ASOF join, dan historical replay biasanya berbasis waktu market event.

---

## 6. Why `TIMESTAMP_NS` Often Matters

Market data bisa memiliki banyak event dalam mikrodetik yang sama.

Jika kamu memakai microsecond timestamp untuk data yang sebenarnya nanosecond-level, kamu bisa:

- membuat ordering ambiguous;
- memperbesar duplicate collision risk;
- membuat OHLC edge-case;
- merusak ASOF alignment;
- kehilangan ability membedakan event sequence.

Namun presisi timestamp bukan pengganti sequence.

Invariant:

```text
Timestamp gives time.
Sequence gives order.
Identity gives idempotency.
```

Jika dua event punya timestamp sama, sequence/trade_id tetap penting.

---

## 7. Table Design: Trades

### 7.1 Minimal Trades Table

```sql
CREATE TABLE trades (
    symbol SYMBOL,
    venue SYMBOL,
    feed SYMBOL,
    trade_id VARCHAR,
    sequence LONG,
    price DOUBLE,
    size DOUBLE,
    condition SYMBOL,
    recv_ts TIMESTAMP_NS,
    ingest_ts TIMESTAMP_NS,
    exchange_ts TIMESTAMP_NS
) TIMESTAMP(exchange_ts)
PARTITION BY DAY
WAL;
```

### 7.2 Why These Columns?

| Column | Purpose |
|---|---|
| `symbol` | instrument identity |
| `venue` | exchange/source venue |
| `feed` | feed/vendor/source path |
| `trade_id` | dedup/reconciliation if available |
| `sequence` | ordering/gap detection |
| `price` | executed price |
| `size` | executed quantity |
| `condition` | special trade condition |
| `recv_ts` | infrastructure latency |
| `ingest_ts` | pipeline latency |
| `exchange_ts` | market event time / designated timestamp |

### 7.3 Dedup Strategy for Trades

If `trade_id` is stable:

```sql
CREATE TABLE trades (
    symbol SYMBOL,
    venue SYMBOL,
    feed SYMBOL,
    trade_id VARCHAR,
    sequence LONG,
    price DOUBLE,
    size DOUBLE,
    condition SYMBOL,
    recv_ts TIMESTAMP_NS,
    ingest_ts TIMESTAMP_NS,
    exchange_ts TIMESTAMP_NS
) TIMESTAMP(exchange_ts)
PARTITION BY DAY
WAL
DEDUP UPSERT KEYS(exchange_ts, symbol, venue, feed, trade_id);
```

If no `trade_id` exists, you may need a composite key:

```text
exchange_ts + symbol + venue + feed + sequence
```

But be careful: if sequence resets per channel, include channel identity.

```text
exchange_ts + symbol + venue + feed + channel + sequence
```

### 7.4 Anti-Pattern: Dedup Only by Timestamp and Symbol

Bad:

```text
exchange_ts + symbol
```

Why bad?

Because multiple trades for the same symbol can happen at the same timestamp, especially at high resolution burst periods.

---

## 8. Table Design: Quotes

### 8.1 Best Bid/Ask Quote Table

```sql
CREATE TABLE quotes (
    symbol SYMBOL,
    venue SYMBOL,
    feed SYMBOL,
    sequence LONG,
    bid_price DOUBLE,
    bid_size DOUBLE,
    ask_price DOUBLE,
    ask_size DOUBLE,
    recv_ts TIMESTAMP_NS,
    ingest_ts TIMESTAMP_NS,
    exchange_ts TIMESTAMP_NS
) TIMESTAMP(exchange_ts)
PARTITION BY DAY
WAL;
```

### 8.2 Derived Columns?

You may compute spread at query time:

```sql
SELECT
    exchange_ts,
    symbol,
    ask_price - bid_price AS spread
FROM quotes
WHERE symbol = 'AAPL'
  AND exchange_ts >= '2026-06-01T00:00:00.000000000Z'
  AND exchange_ts <  '2026-06-02T00:00:00.000000000Z';
```

Or materialize if used constantly:

```sql
CREATE TABLE quotes_enriched (
    symbol SYMBOL,
    venue SYMBOL,
    feed SYMBOL,
    sequence LONG,
    bid_price DOUBLE,
    bid_size DOUBLE,
    ask_price DOUBLE,
    ask_size DOUBLE,
    mid_price DOUBLE,
    spread DOUBLE,
    recv_ts TIMESTAMP_NS,
    ingest_ts TIMESTAMP_NS,
    exchange_ts TIMESTAMP_NS
) TIMESTAMP(exchange_ts)
PARTITION BY DAY
WAL;
```

Trade-off:

```text
compute at query time = less storage, more CPU per query
store derived values = more storage, faster common queries, correction complexity
```

### 8.3 Quote Dedup

Common dedup key:

```text
exchange_ts + symbol + venue + feed + sequence
```

If sequence is globally unique per feed/channel, include channel if needed.

---

## 9. Table Design: Order Book Depth

Order book modeling is dangerous because it can explode in size quickly.

### 9.1 Option A: Level Snapshot Table

One row per level per timestamp:

```sql
CREATE TABLE book_levels (
    symbol SYMBOL,
    venue SYMBOL,
    feed SYMBOL,
    side SYMBOL,
    level INT,
    price DOUBLE,
    size DOUBLE,
    sequence LONG,
    recv_ts TIMESTAMP_NS,
    ingest_ts TIMESTAMP_NS,
    exchange_ts TIMESTAMP_NS
) TIMESTAMP(exchange_ts)
PARTITION BY DAY
WAL;
```

Example rows:

```text
AAPL NASDAQ bid level=1 price=100.01 size=500 exchange_ts=T
AAPL NASDAQ bid level=2 price=100.00 size=800 exchange_ts=T
AAPL NASDAQ ask level=1 price=100.05 size=300 exchange_ts=T
```

Pros:

- queryable by level/side;
- simple SQL;
- good for analytics.

Cons:

- many rows;
- snapshot frequency matters;
- duplication if full snapshot repeated frequently.

### 9.2 Option B: Wide Top-N Snapshot Table

One row per snapshot:

```sql
CREATE TABLE book_top5 (
    symbol SYMBOL,
    venue SYMBOL,
    feed SYMBOL,
    bid_px_1 DOUBLE,
    bid_sz_1 DOUBLE,
    bid_px_2 DOUBLE,
    bid_sz_2 DOUBLE,
    bid_px_3 DOUBLE,
    bid_sz_3 DOUBLE,
    bid_px_4 DOUBLE,
    bid_sz_4 DOUBLE,
    bid_px_5 DOUBLE,
    bid_sz_5 DOUBLE,
    ask_px_1 DOUBLE,
    ask_sz_1 DOUBLE,
    ask_px_2 DOUBLE,
    ask_sz_2 DOUBLE,
    ask_px_3 DOUBLE,
    ask_sz_3 DOUBLE,
    ask_px_4 DOUBLE,
    ask_sz_4 DOUBLE,
    ask_px_5 DOUBLE,
    ask_sz_5 DOUBLE,
    sequence LONG,
    recv_ts TIMESTAMP_NS,
    ingest_ts TIMESTAMP_NS,
    exchange_ts TIMESTAMP_NS
) TIMESTAMP(exchange_ts)
PARTITION BY DAY
WAL;
```

Pros:

- fewer rows than level table;
- fast top-N dashboard;
- easier latest snapshot query.

Cons:

- rigid schema;
- hard to query arbitrary depth;
- sparse if N varies.

### 9.3 Option C: Raw Update Table + Reconstructed Snapshot Table

A robust architecture often stores both:

```text
raw_book_updates      = replay/audit/reconstruction
book_topN_snapshots   = analytics/dashboard serving
```

This gives:

- raw fidelity;
- query performance;
- controlled derived table semantics.

### 9.4 Avoid JSON for Frequently Queried Book Levels

JSON blob:

```text
levels = '[{"bid":...}]'
```

May be acceptable for archive/audit, but bad for analytical queries that need:

- level 1 spread;
- depth imbalance;
- price ladder analysis;
- liquidity changes.

In QuestDB, if you need to query it often, model it as columns/rows.

---

## 10. Partitioning Strategy for Market Data

### 10.1 Common Starting Point

For many market data tables:

```sql
PARTITION BY DAY
```

Why?

- market queries commonly span intraday/day ranges;
- day partitions align with operational boundaries;
- retention/drop is manageable;
- avoids too many tiny partitions for moderate throughput;
- avoids huge monthly partitions for heavy feeds.

### 10.2 When `HOUR` Partition Might Be Better

Use `HOUR` if:

- ingest rate is very high;
- late data is usually within recent hours;
- you need fine-grained retention/drop;
- daily partitions become too large;
- recovery/compaction of one day is too expensive.

Trade-off:

```text
HOUR = smaller partitions, more partition metadata/files
DAY  = fewer partitions, larger rewrite/retention units
```

### 10.3 When `MONTH` Is Risky

For high-volume tick data, monthly partitions can become too large.

Problems:

- O3 merge cost can become large;
- TTL drops are coarse;
- backup/restore work unit is large;
- partition repair is painful.

Monthly may be acceptable for low-volume derived bars, but usually not for raw tick feeds.

---

## 11. Ingestion Architecture

### 11.1 Direct Producer to QuestDB

```text
exchange/vendor feed
→ Java normalization service
→ QuestDB ILP
```

Good when:

- feed is replayable elsewhere;
- data rate is manageable;
- freshness is more important than long broker retention;
- operational simplicity matters.

Risk:

- if QuestDB unavailable, producer must buffer/drop/failover;
- replay may depend on external vendor/feed.

### 11.2 Brokered Architecture

```text
exchange/vendor feed
→ Java gateway
→ Kafka topic
→ QuestDB ingestion consumer
→ QuestDB ILP
```

Good when:

- replay is required;
- multiple consumers need same feed;
- backpressure is needed;
- QuestDB downtime must not lose data;
- backfill/reprocess is common.

Trade-off:

- more moving parts;
- Kafka topic partitioning must be correct;
- consumer lag becomes part of freshness SLA.

### 11.3 Recommended Architecture for Serious Market Data

```text
Feed Handler
  - parse exchange/vendor messages
  - validate sequence
  - timestamp receive time
  - normalize event

Kafka / Durable Stream
  - partition by venue/feed/channel/symbol group
  - retain enough for replay
  - expose lag metrics

QuestDB Ingestion Service
  - batch ILP writes
  - enforce schema
  - classify live vs late vs invalid
  - handle retries
  - emit freshness metrics

QuestDB
  - raw trades
  - raw quotes
  - book snapshots
  - bars/materialized views

Query API
  - bounded time range
  - tenant/user access controls
  - route raw vs rollup
```

---

## 12. Kafka Partition Key for Market Data

A common mistake is partitioning only by symbol.

Better key depends on feed semantics.

Possible keys:

```text
venue + feed + channel
venue + feed + symbol
venue + feed + symbol_group
```

For sequence-sensitive feeds, preserve ordering within sequence channel.

If exchange sequence is per channel, then:

```text
partition key = venue + feed + channel
```

If ordering by symbol matters and feed is symbol-sharded:

```text
partition key = venue + feed + symbol
```

Invariant:

```text
Broker partitioning must preserve the ordering domain you rely on.
```

Do not invent an ordering domain after the broker.

---

## 13. Java Event Model

### 13.1 Trade Tick DTO

```java
import java.time.Instant;

public record TradeTick(
    String symbol,
    String venue,
    String feed,
    String tradeId,
    long sequence,
    double price,
    double size,
    String condition,
    Instant exchangeTime,
    Instant receiveTime,
    Instant ingestTime
) {}
```

But `Instant` has nanosecond field while many libraries and JDBC paths can lose precision if mishandled. For ILP nanosecond timestamp, a `long epochNanos` representation is often cleaner at the ingestion boundary.

### 13.2 Safer Internal Model

```java
public record MarketTimestamp(
    long exchangeEpochNanos,
    long receiveEpochNanos,
    long ingestEpochNanos
) {}

public record TradeTick(
    String symbol,
    String venue,
    String feed,
    String tradeId,
    long sequence,
    double price,
    double size,
    String condition,
    MarketTimestamp timestamps
) {}
```

### 13.3 Validation

Before sending to QuestDB:

```java
public final class MarketDataValidator {
    public void validate(TradeTick tick) {
        requireNonBlank(tick.symbol(), "symbol");
        requireNonBlank(tick.venue(), "venue");
        requireNonBlank(tick.feed(), "feed");

        if (tick.price() <= 0) {
            throw new InvalidMarketDataException("price must be positive");
        }
        if (tick.size() <= 0) {
            throw new InvalidMarketDataException("size must be positive");
        }
        if (tick.timestamps().exchangeEpochNanos() <= 0) {
            throw new InvalidMarketDataException("exchange timestamp missing");
        }
        if (tick.timestamps().receiveEpochNanos() < tick.timestamps().exchangeEpochNanos()) {
            // Not always impossible due to clock sync issues, but should be flagged.
            throw new SuspiciousMarketDataException("receive time earlier than exchange time");
        }
    }

    private static void requireNonBlank(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new InvalidMarketDataException(name + " is required");
        }
    }
}
```

Do not let arbitrary malformed symbol names or unknown venues create unbounded symbol dictionaries.

---

## 14. ILP Writing Pattern for Trades

Pseudo-code:

```java
import io.questdb.client.Sender;

public final class QuestDbTradeWriter implements AutoCloseable {
    private final Sender sender;

    public QuestDbTradeWriter(Sender sender) {
        this.sender = sender;
    }

    public void write(TradeTick tick) {
        sender.table("trades")
            .symbol("symbol", tick.symbol())
            .symbol("venue", tick.venue())
            .symbol("feed", tick.feed())
            .stringColumn("trade_id", tick.tradeId())
            .longColumn("sequence", tick.sequence())
            .doubleColumn("price", tick.price())
            .doubleColumn("size", tick.size())
            .symbol("condition", tick.condition())
            .timestampColumn("recv_ts", tick.timestamps().receiveEpochNanos())
            .timestampColumn("ingest_ts", tick.timestamps().ingestEpochNanos())
            .at(tick.timestamps().exchangeEpochNanos());
    }

    public void flush() {
        sender.flush();
    }

    @Override
    public void close() {
        sender.close();
    }
}
```

Key points:

- `at()` uses designated timestamp.
- `symbol()` should be used only for controlled, repeated dimensions.
- `trade_id` may be `VARCHAR`/string if high-cardinality and not commonly filtered.
- batching and flush policy should be explicit.
- retry must be idempotent if possible.

---

## 15. Freshness and Latency Metrics

Market data systems care about multiple lags.

### 15.1 Exchange to Receive Latency

```sql
SELECT
    symbol,
    avg((recv_ts - exchange_ts) / 1000) AS avg_us
FROM trades
WHERE exchange_ts >= dateadd('m', -5, now())
SAMPLE BY 10s;
```

This measures feed/network latency.

### 15.2 Receive to Ingest Latency

```sql
SELECT
    symbol,
    avg((ingest_ts - recv_ts) / 1000) AS avg_us
FROM trades
WHERE exchange_ts >= dateadd('m', -5, now())
SAMPLE BY 10s;
```

This measures internal pipeline latency.

### 15.3 Latest Tick Freshness

```sql
SELECT *
FROM trades
WHERE symbol = 'AAPL'
LATEST ON exchange_ts PARTITION BY symbol;
```

Then compare latest `exchange_ts` to wall clock or expected market session.

### 15.4 Important Caveat

A stale symbol may be normal if market is closed or instrument is inactive.

Freshness alert must consider:

- trading session;
- instrument activity;
- venue status;
- feed status;
- expected tick frequency.

Bad alert:

```text
alert if AAPL has no tick in 5 seconds
```

Better alert:

```text
alert if active symbols on active venue have no updates while feed heartbeat is healthy and peer symbols are updating
```

---

## 16. Query Pattern: Latest Price per Symbol

### 16.1 Latest Trade

```sql
SELECT
    symbol,
    venue,
    price,
    size,
    exchange_ts
FROM trades
WHERE venue = 'NASDAQ'
LATEST ON exchange_ts PARTITION BY symbol;
```

This gives latest trade per symbol for a venue.

### 16.2 Latest Quote

```sql
SELECT
    symbol,
    venue,
    bid_price,
    bid_size,
    ask_price,
    ask_size,
    exchange_ts
FROM quotes
WHERE venue = 'NASDAQ'
LATEST ON exchange_ts PARTITION BY symbol;
```

### 16.3 Latest Mid Price

```sql
SELECT
    symbol,
    (bid_price + ask_price) / 2 AS mid_price,
    ask_price - bid_price AS spread,
    exchange_ts
FROM quotes
WHERE venue = 'NASDAQ'
LATEST ON exchange_ts PARTITION BY symbol;
```

### 16.4 Production Guardrail

For API endpoints:

```text
GET /market/latest?venue=NASDAQ
```

Avoid unbounded global latest across all venues/feeds unless intentionally designed.

Add:

- venue filter;
- symbol list filter;
- max result limit;
- active instrument filter;
- permission check.

---

## 17. Query Pattern: OHLC Bars

### 17.1 One-Minute OHLC

```sql
SELECT
    symbol,
    first(price) AS open,
    max(price) AS high,
    min(price) AS low,
    last(price) AS close,
    sum(size) AS volume
FROM trades
WHERE symbol = 'AAPL'
  AND venue = 'NASDAQ'
  AND exchange_ts >= '2026-06-01T13:30:00.000000000Z'
  AND exchange_ts <  '2026-06-01T20:00:00.000000000Z'
SAMPLE BY 1m;
```

### 17.2 Multi-Symbol OHLC

```sql
SELECT
    symbol,
    first(price) AS open,
    max(price) AS high,
    min(price) AS low,
    last(price) AS close,
    sum(size) AS volume
FROM trades
WHERE venue = 'NASDAQ'
  AND symbol IN ('AAPL', 'MSFT', 'NVDA')
  AND exchange_ts >= '2026-06-01T13:30:00.000000000Z'
  AND exchange_ts <  '2026-06-01T20:00:00.000000000Z'
SAMPLE BY 1m;
```

### 17.3 Correctness Issues

OHLC correctness depends on:

- timestamp ordering;
- trade condition filtering;
- handling cancelled/corrected trades;
- market session boundaries;
- venue selection;
- whether odd lots or special trades are included;
- late ticks.

Naive OHLC can be wrong if it includes invalid trade conditions.

You may need:

```sql
WHERE condition NOT IN ('CANCELLED', 'CORRECTION', 'NON_REGULAR')
```

Actual condition values depend on feed normalization.

---

## 18. Materialized OHLC Bars

Raw OHLC queries over tick data can be expensive if dashboard refreshes every second.

Use a rollup table/materialized view strategy.

### 18.1 One-Minute Bars Table

```sql
CREATE MATERIALIZED VIEW trades_1m_bars AS (
    SELECT
        symbol,
        venue,
        first(price) AS open,
        max(price) AS high,
        min(price) AS low,
        last(price) AS close,
        sum(size) AS volume
    FROM trades
    SAMPLE BY 1m
) PARTITION BY DAY;
```

Exact syntax and options may vary by QuestDB version and deployment mode, but the design principle is stable:

```text
raw trades = source of truth
1m bars = serving layer
higher bars = derived from lower bars only if statistically safe
```

### 18.2 Sufficient Statistics Problem

You cannot derive all metrics safely from OHLC alone.

From 1m OHLC you can derive:

- higher-level high = max(high);
- higher-level low = min(low);
- volume = sum(volume);

But deriving open/close requires correct first/last bucket order.

VWAP requires:

```text
sum(price * size)
sum(size)
```

So include sufficient statistics:

```sql
SELECT
    symbol,
    venue,
    first(price) AS open,
    max(price) AS high,
    min(price) AS low,
    last(price) AS close,
    sum(size) AS volume,
    sum(price * size) AS notional
FROM trades
SAMPLE BY 1m;
```

Then:

```text
vwap = notional / volume
```

---

## 19. VWAP Query

### 19.1 Raw VWAP

```sql
SELECT
    symbol,
    sum(price * size) / sum(size) AS vwap,
    sum(size) AS volume
FROM trades
WHERE symbol = 'AAPL'
  AND venue = 'NASDAQ'
  AND exchange_ts >= '2026-06-01T13:30:00.000000000Z'
  AND exchange_ts <  '2026-06-01T20:00:00.000000000Z';
```

### 19.2 Sampled VWAP

```sql
SELECT
    symbol,
    sum(price * size) / sum(size) AS vwap,
    sum(size) AS volume
FROM trades
WHERE symbol = 'AAPL'
  AND venue = 'NASDAQ'
  AND exchange_ts >= '2026-06-01T13:30:00.000000000Z'
  AND exchange_ts <  '2026-06-01T20:00:00.000000000Z'
SAMPLE BY 1m;
```

### 19.3 VWAP Edge Cases

Handle:

- zero size;
- cancelled trades;
- special trade conditions;
- duplicated trades;
- corrected trades;
- out-of-session trades;
- venue selection;
- multi-currency instruments.

VWAP is not just SQL arithmetic; it is domain semantics.

---

## 20. Spread and Mid Price Analytics

### 20.1 Spread Over Time

```sql
SELECT
    symbol,
    avg(ask_price - bid_price) AS avg_spread,
    min(ask_price - bid_price) AS min_spread,
    max(ask_price - bid_price) AS max_spread
FROM quotes
WHERE symbol = 'AAPL'
  AND venue = 'NASDAQ'
  AND exchange_ts >= '2026-06-01T13:30:00.000000000Z'
  AND exchange_ts <  '2026-06-01T20:00:00.000000000Z'
SAMPLE BY 1m;
```

### 20.2 Mid Price

```sql
SELECT
    symbol,
    avg((bid_price + ask_price) / 2) AS avg_mid
FROM quotes
WHERE symbol = 'AAPL'
  AND venue = 'NASDAQ'
  AND exchange_ts >= '2026-06-01T13:30:00.000000000Z'
  AND exchange_ts <  '2026-06-01T20:00:00.000000000Z'
SAMPLE BY 1m;
```

### 20.3 Bad Quote Filtering

Quotes can be invalid:

```text
bid_price <= 0
ask_price <= 0
ask_price < bid_price
bid_size < 0
ask_size < 0
```

Use data quality flags or filters:

```sql
WHERE bid_price > 0
  AND ask_price > 0
  AND ask_price >= bid_price
```

But filtering at query time does not replace ingestion validation.

---

## 21. ASOF JOIN: Trade with Latest Quote

A classic market data problem:

```text
For each trade, what was the best quote immediately before or at the trade time?
```

This is exactly where temporal joins shine.

### 21.1 Query

```sql
SELECT
    t.symbol,
    t.venue,
    t.exchange_ts AS trade_ts,
    t.price AS trade_price,
    t.size AS trade_size,
    q.bid_price,
    q.ask_price,
    (q.bid_price + q.ask_price) / 2 AS mid_price,
    t.price - ((q.bid_price + q.ask_price) / 2) AS trade_vs_mid
FROM trades t
ASOF JOIN quotes q
ON t.symbol = q.symbol
AND t.venue = q.venue
WHERE t.symbol = 'AAPL'
  AND t.venue = 'NASDAQ'
  AND t.exchange_ts >= '2026-06-01T13:30:00.000000000Z'
  AND t.exchange_ts <  '2026-06-01T20:00:00.000000000Z';
```

Concept:

```text
for each trade row t,
find latest quote q such that:
q.symbol = t.symbol
q.venue = t.venue
q.exchange_ts <= t.exchange_ts
```

### 21.2 Stale Quote Problem

A quote from 30 minutes ago should not enrich a current trade.

Add staleness logic if needed:

```sql
SELECT *
FROM (
    SELECT
        t.symbol,
        t.venue,
        t.exchange_ts AS trade_ts,
        t.price AS trade_price,
        q.exchange_ts AS quote_ts,
        q.bid_price,
        q.ask_price,
        t.exchange_ts - q.exchange_ts AS quote_age
    FROM trades t
    ASOF JOIN quotes q
    ON t.symbol = q.symbol
    AND t.venue = q.venue
    WHERE t.symbol = 'AAPL'
      AND t.venue = 'NASDAQ'
      AND t.exchange_ts >= '2026-06-01T13:30:00.000000000Z'
      AND t.exchange_ts <  '2026-06-01T20:00:00.000000000Z'
)
WHERE quote_age <= 1000000000; -- example: 1 second in ns, depending on expression type
```

Exact interval arithmetic should be verified against QuestDB version/type semantics, but the design requirement is clear:

```text
Temporal enrichment needs staleness bounds.
```

### 21.3 Feed Alignment Problem

If trades and quotes come from different feeds/vendors, timestamps and sequence semantics may not align perfectly.

You may need:

```text
same venue only
same feed only
trusted quote feed only
source priority
clock offset correction
```

---

## 22. Trade Direction / Aggressor Inference

If feed does not provide aggressor side, simple inference uses quote context:

```text
if trade_price >= ask_price → buyer-initiated candidate
if trade_price <= bid_price → seller-initiated candidate
otherwise → midpoint/unknown
```

Example:

```sql
SELECT
    symbol,
    trade_ts,
    trade_price,
    bid_price,
    ask_price,
    CASE
        WHEN trade_price >= ask_price THEN 'BUY'
        WHEN trade_price <= bid_price THEN 'SELL'
        ELSE 'UNKNOWN'
    END AS inferred_aggressor
FROM trade_quote_enriched;
```

Caveats:

- stale quotes;
- locked/crossed markets;
- hidden liquidity;
- auction prints;
- special trade conditions;
- delayed reporting;
- feed latency differences.

Never treat naive inference as absolute truth without domain validation.

---

## 23. Data Quality Checks

### 23.1 Sequence Gap Detection

If sequence should be monotonic per channel:

```sql
SELECT
    venue,
    feed,
    channel,
    sequence,
    sequence - lag(sequence) OVER (PARTITION BY venue, feed, channel ORDER BY exchange_ts) AS seq_delta
FROM raw_feed_events
WHERE exchange_ts >= dateadd('m', -5, now());
```

If QuestDB window function support/semantics differ for your version, you can do this in a validation pipeline or external checker. The architectural point remains:

```text
sequence quality must be monitored separately from insert success.
```

### 23.2 Negative Spread

```sql
SELECT
    symbol,
    venue,
    exchange_ts,
    bid_price,
    ask_price
FROM quotes
WHERE exchange_ts >= dateadd('m', -10, now())
  AND ask_price < bid_price;
```

### 23.3 Zero/Invalid Price

```sql
SELECT
    symbol,
    venue,
    exchange_ts,
    price,
    size
FROM trades
WHERE exchange_ts >= dateadd('m', -10, now())
  AND (price <= 0 OR size <= 0);
```

### 23.4 Latency Outliers

```sql
SELECT
    symbol,
    venue,
    max((recv_ts - exchange_ts) / 1000) AS max_exchange_to_recv_us
FROM trades
WHERE exchange_ts >= dateadd('m', -10, now())
SAMPLE BY 10s;
```

### 23.5 Inactive Symbol vs Broken Feed

Do not alert only per-symbol. Compare:

- number of active symbols updated;
- feed heartbeat;
- venue session;
- peer feed activity;
- sequence gaps;
- latest update per channel.

---

## 24. Late Ticks and Corrections

### 24.1 Late Tick

A late tick is a valid historical event that arrives after newer events.

Example:

```text
received at 10:01:05, exchange_ts = 10:00:01
```

QuestDB can ingest O3 data, but high late volume can increase write amplification.

### 24.2 Correction

A correction is not merely late. It changes meaning of a previous event.

Examples:

```text
trade cancelled
trade price corrected
size corrected
condition corrected
```

### 24.3 Modeling Corrections

Option A: overwrite using dedup/upsert key.

Good for serving latest corrected view.

Risk:

- loses original fact unless raw audit table exists.

Option B: append correction event.

Good for audit.

Risk:

- query must interpret latest correction.

Recommended serious pattern:

```text
raw_trade_events      = append-only audit including corrections
trades_current        = deduplicated/corrected serving table
trades_1m_bars        = derived from trades_current with correction policy
```

### 24.4 Correction and Materialized Views

If correction affects old bucket, your rollup must be corrected too.

Possible strategies:

1. allow materialized view refresh to handle bounded late/correction window;
2. rebuild affected partitions/buckets;
3. maintain correction-aware derived table;
4. separate official EOD bars from live provisional bars.

Mental model:

```text
live bars are provisional until correction window closes
```

---

## 25. Session Semantics

Market data queries often need market sessions:

```text
regular trading hours
pre-market
after-hours
auction
holiday
maintenance window
crypto 24/7
```

QuestDB stores timestamps; session logic is a domain layer.

Do not assume:

```text
day partition = trading session
```

A trading session may cross UTC date boundaries depending on venue/timezone.

For Java APIs:

```text
GET /bars?symbol=AAPL&session=regular&date=2026-06-01
```

should translate to exact UTC time range using a market calendar service.

Do not bury exchange calendars in ad-hoc SQL strings.

---

## 26. Query API Design

### 26.1 Latest Endpoint

```text
GET /market/latest?venue=NASDAQ&symbols=AAPL,MSFT
```

Rules:

- require venue or explicit all-venue permission;
- limit symbol count;
- return timestamp and freshness;
- include source/feed if relevant.

### 26.2 Bars Endpoint

```text
GET /market/bars?symbol=AAPL&venue=NASDAQ&from=...&to=...&interval=1m
```

Rules:

- require bounded range;
- route interval to materialized view if available;
- enforce max bars;
- include whether bars are provisional;
- define trade condition policy.

### 26.3 Trade/Quote Endpoint

```text
GET /market/trades?symbol=AAPL&from=...&to=...&limit=10000
```

Rules:

- bounded range;
- pagination by timestamp + sequence, not offset;
- max range for raw ticks;
- permission control;
- optional condition filters.

### 26.4 Bad API Pattern

Bad:

```text
GET /query?sql=SELECT * FROM trades
```

A raw SQL endpoint is a data exfiltration and query storm risk.

Use query templates and controlled parameters.

---

## 27. Pagination for Tick Data

Offset pagination is bad for high-volume time-series.

Bad:

```sql
ORDER BY exchange_ts LIMIT 10000 OFFSET 10000000
```

Better:

```text
cursor = last_exchange_ts + last_sequence + last_trade_id
```

Query:

```sql
SELECT *
FROM trades
WHERE symbol = 'AAPL'
  AND venue = 'NASDAQ'
  AND exchange_ts >= '2026-06-01T13:30:00.000000000Z'
  AND exchange_ts <  '2026-06-01T20:00:00.000000000Z'
  AND (
        exchange_ts > '2026-06-01T14:00:00.123456789Z'
        OR (exchange_ts = '2026-06-01T14:00:00.123456789Z' AND sequence > 123456)
      )
ORDER BY exchange_ts, sequence
LIMIT 10000;
```

Exact SQL support for tuple comparison/order semantics should be tested, but cursor principle is stable:

```text
paginate by time and stable tie-breaker
```

---

## 28. Retention Strategy

### 28.1 Raw Tick Retention

Raw ticks can be huge.

Possible policy:

```text
raw trades/quotes hot native: 7–30 days
raw ticks cold Parquet/object storage: months/years
1m bars native: 1–2 years
1h/daily bars: many years
```

### 28.2 Regulatory/Audit Retention

If regulatory/audit use is required:

- do not rely only on derived bars;
- preserve raw source identity;
- preserve corrections/cancellations;
- preserve feed/vendor metadata;
- preserve ingestion timestamps;
- validate backup restore;
- document retention policy.

### 28.3 Query Routing by Age

Java API may route:

```text
last 7 days raw ticks → QuestDB native table
older raw ticks → cold path / Parquet-enabled table / archive workflow
bars → materialized rollup table
```

Do not promise p99 low-latency raw tick queries across years unless storage/query design supports it.

---

## 29. Capacity Planning Example

Assume:

```text
symbols = 5,000
avg trades/sec total = 50,000
avg quotes/sec total = 250,000
trading hours/day = 6.5
```

Rows/day:

```text
trades/day = 50,000 * 6.5 * 3600
           = 1,170,000,000 rows/day

quotes/day = 250,000 * 6.5 * 3600
           = 5,850,000,000 rows/day
```

This is already billions of rows/day.

Implications:

- raw quote retention must be carefully bounded;
- partition size matters;
- quote materialized views matter;
- object storage/cold lifecycle matters;
- capacity planning must include WAL and backup overhead;
- benchmark must use realistic cardinality and row width.

Do not estimate market data capacity by testing with 1 million rows.

---

## 30. Performance Benchmark for Market Data

A market-data benchmark should include:

### 30.1 Ingestion Workload

- realistic rows/sec;
- symbol cardinality;
- venue/feed dimensions;
- burst pattern around market open;
- O3 percentage;
- duplicate/retry percentage;
- row width matching production schema.

### 30.2 Query Workload

- latest quotes for watchlist;
- OHLC for one symbol/day;
- OHLC for 500 symbols/current session;
- VWAP for one symbol/day;
- ASOF trade quote join;
- spread over time;
- raw tick pagination;
- dashboard concurrent load.

### 30.3 Operational Metrics

Measure:

- ingest rows/sec;
- ILP flush latency;
- WAL lag;
- query p50/p95/p99;
- disk write throughput;
- disk usage growth;
- CPU;
- native memory/page cache pressure;
- O3 impact;
- materialized view freshness.

Benchmark result without freshness metric is incomplete.

---

## 31. Failure Modes Specific to Market Data

### 31.1 Feed Gap

Symptoms:

- sequence jump;
- no updates for channel;
- downstream latest stale;
- some symbols stale but others active.

Runbook:

1. Check feed heartbeat.
2. Check sequence per channel.
3. Check Kafka lag if brokered.
4. Check QuestDB ingestion lag.
5. Determine if gap is upstream or DB-side.
6. Trigger replay/backfill if needed.

### 31.2 Duplicate Storm

Symptoms:

- row rate spike;
- duplicate count spike;
- WAL lag rises;
- materialized views lag.

Runbook:

1. Identify source feed/consumer.
2. Verify dedup keys.
3. Pause offending replay if needed.
4. Confirm table dedup behavior.
5. Reconcile row counts.

### 31.3 Clock Skew

Symptoms:

- receive timestamp earlier than exchange timestamp;
- negative latency;
- weird freshness alerts;
- data appears in wrong partition.

Runbook:

1. Check gateway clock sync.
2. Compare feed exchange timestamps.
3. Quarantine suspicious producer.
4. Avoid blindly correcting stored exchange time unless source is known wrong.

### 31.4 O3 Storm

Symptoms:

- old ticks replayed into hot live table;
- WAL apply lag;
- disk IO spike;
- materialized view refresh lag.

Runbook:

1. Separate replay lane from live lane.
2. Sort by timestamp.
3. Reduce parallelism.
4. Load partition by partition.
5. Pause non-critical dashboard queries.
6. Rebuild affected rollups if needed.

### 31.5 Bad Symbol Explosion

Symptoms:

- sudden increase in distinct symbols;
- malformed symbols;
- memory/dictionary growth;
- queries slow due to cardinality.

Runbook:

1. Stop offending producer.
2. Identify malformed values.
3. Apply ingestion validation.
4. Decide whether to drop/rebuild polluted table/partition.
5. Add symbol allowlist or canonicalizer.

---

## 32. Testing Strategy

### 32.1 Unit Tests

Test:

- timestamp conversion;
- symbol normalization;
- trade validation;
- quote validation;
- dedup key construction;
- line protocol escaping;
- retry classifier.

### 32.2 Integration Tests

Test against QuestDB:

- insert trades;
- insert quotes;
- latest query;
- OHLC query;
- ASOF join;
- duplicate replay;
- late tick ingestion;
- invalid row handling.

### 32.3 Replay Tests

Use recorded feed slice:

- load once;
- load again;
- compare row count/dedup behavior;
- validate OHLC/VWAP;
- validate latest state.

### 32.4 Backfill Tests

- sorted vs unsorted load;
- partition by partition;
- parallelism limit;
- WAL lag behavior;
- rollup freshness;
- restore from checkpoint.

---

## 33. Architecture Review Checklist

Before approving QuestDB for market data, ask:

### 33.1 Workload Fit

- Is the workload append-heavy?
- Are queries mostly time-bounded?
- Is temporal SQL useful?
- Is raw tick retention bounded?
- Are updates/corrections understood?

### 33.2 Timestamp Semantics

- What is designated timestamp?
- Are exchange, receive, and ingest timestamps stored separately?
- Is nanosecond precision required?
- Are clocks synchronized?

### 33.3 Identity and Dedup

- What is the stable trade/quote identity?
- Are sequence numbers stored?
- Are replay and retry idempotent?
- Is correction modeled explicitly?

### 33.4 Schema

- Are `SYMBOL` columns controlled?
- Are high-cardinality IDs stored as non-symbol fields?
- Is order book modeled queryably?
- Are data quality flags included?

### 33.5 Partitioning and Retention

- Is partition granularity justified?
- What is raw tick retention?
- What is bar retention?
- Are cold storage and backup policies defined?

### 33.6 Query/API

- Are raw queries bounded?
- Are dashboard queries served by rollups where needed?
- Are ASOF joins bounded by time and symbol/venue?
- Is pagination cursor-based?

### 33.7 Operations

- Are WAL lag and freshness monitored?
- Are sequence gaps monitored?
- Are stale feeds detected?
- Is backfill lane separate from live lane?
- Are O3 storms handled?

---

## 34. Reference Architecture

```text
                 ┌────────────────────┐
                 │ Exchange / Vendor   │
                 │ Market Data Feed    │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ Java Feed Handler   │
                 │ parse/validate/seq  │
                 │ recv timestamp      │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ Kafka / Durable Log │
                 │ replay/backpressure │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ Java QuestDB Sink   │
                 │ ILP batch/retry     │
                 │ schema guardrail    │
                 └─────────┬──────────┘
                           │
                           ▼
          ┌────────────────────────────────────┐
          │ QuestDB                             │
          │                                    │
          │ raw trades                         │
          │ raw quotes                         │
          │ book snapshots                     │
          │ materialized bars                  │
          │ freshness/data quality queries     │
          └─────────┬──────────────────────────┘
                    │
                    ▼
          ┌────────────────────────────────────┐
          │ Java Market Data API                │
          │ latest / bars / trades / analytics │
          │ query guardrails / auth / limits   │
          └────────────────────────────────────┘
```

---

## 35. Anti-Patterns

### 35.1 Using Ingestion Time as Market Event Time

Bad unless the source has no event timestamp.

Consequence:

- OHLC wrong;
- ASOF join wrong;
- replay changes history;
- late data becomes impossible to reason about.

### 35.2 Storing Only Latest Price

Bad for analytics and audit.

You lose:

- history;
- replay;
- correction ability;
- temporal joins;
- forensic analysis.

### 35.3 Making Every ID a `SYMBOL`

Trade IDs and order IDs can be extremely high-cardinality.

Usually avoid storing them as `SYMBOL` unless you have a strong repeated-filtering reason.

### 35.4 Unbounded Raw Tick API

Bad:

```text
GET /trades?symbol=AAPL
```

without from/to/limit.

### 35.5 No Correction Policy

If you generate bars but ignore trade corrections, your analytics may be wrong.

### 35.6 Treating Broker Offset as Market Sequence

Kafka offset is ingestion pipeline order, not exchange event order.

Store exchange/feed sequence separately.

### 35.7 No Session Calendar

Using UTC date as session boundary can be wrong for many markets.

---

## 36. Hands-On Lab

### Lab 1 — Create Tables

Create:

- `trades`
- `quotes`
- `book_top5`
- `trades_1m_bars`

Use:

- `TIMESTAMP_NS`
- `SYMBOL` for controlled dimensions
- `PARTITION BY DAY`
- `WAL`
- dedup keys where identity exists

### Lab 2 — Write Java Tick Generator

Generate synthetic:

- 100 symbols;
- 2 venues;
- trades and quotes;
- realistic irregular intervals;
- some late ticks;
- some duplicates;
- some bad quotes.

Write through QuestDB Java ILP client.

### Lab 3 — Query Analytics

Implement:

- latest quote per symbol;
- OHLC 1m;
- VWAP;
- spread over time;
- trade-to-quote ASOF join;
- invalid quote detector;
- feed freshness query.

### Lab 4 — Backfill

Replay 1 hour of synthetic historical ticks:

- unsorted once;
- sorted once;
- compare WAL lag and ingestion duration;
- replay duplicate dataset;
- verify dedup behavior.

### Lab 5 — API Guardrails

Build Java API methods:

```java
List<Bar> getBars(Symbol symbol, Venue venue, Instant from, Instant to, Duration interval);
List<Trade> getTrades(Symbol symbol, Venue venue, Cursor cursor, int limit);
LatestQuote getLatestQuote(Symbol symbol, Venue venue);
```

Enforce:

- max range;
- max symbols;
- max limit;
- allowed intervals;
- tenant/permission checks;
- no raw SQL pass-through.

---

## 37. Summary

Market data is one of the strongest domains for QuestDB because it is:

- append-heavy;
- timestamp-centric;
- high-volume;
- queryable through temporal SQL;
- naturally partitioned by time;
- dependent on latest state, rollups, and ASOF joins.

But QuestDB only works well if the architecture respects the domain invariants:

```text
exchange time != receive time != ingest time
```

```text
timestamp gives time
sequence gives order
identity gives idempotency
```

```text
raw ticks are source of truth
rollups are serving projections
corrections must be modeled explicitly
```

```text
freshness is not insert success
freshness = feed health + broker lag + WAL apply + latest event time
```

QuestDB is a strong market data analytics store when you use it for what it is optimized for:

- raw time-series ingestion;
- temporal SQL;
- fast range queries;
- latest state;
- sample/rollup queries;
- ASOF-style enrichment;
- hot/warm/cold lifecycle.

It is not a replacement for:

- exchange feed handler;
- matching engine;
- order management system;
- risk engine;
- durable stream broker;
- regulatory archive by itself;
- unrestricted SQL sandbox.

The top 1% engineering move is not merely choosing QuestDB. It is making the boundaries explicit:

```text
feed handler owns protocol correctness
broker owns replay/backpressure
QuestDB owns queryable time-series state
Java API owns access, query guardrails, and domain semantics
operations owns freshness, WAL, capacity, and incident response
```

---

## 38. What Comes Next

Next part:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-031.md
Domain Case Study II: Industrial IoT / Telemetry Platform
```

Part berikutnya akan menerapkan semua konsep pada telemetry/IoT:

- device hierarchy;
- sparse metrics;
- calibration events;
- state vs measurement;
- offline replay;
- downsampling;
- alert query pattern;
- data quality flags;
- multi-tenant retention;
- operational dashboards.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-029.md">⬅️ Performance Engineering and Benchmarking</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-031.md">Part 031 — Domain Case Study II: Industrial IoT / Telemetry Platform ➡️</a>
</div>

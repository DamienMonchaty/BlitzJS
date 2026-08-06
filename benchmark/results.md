# BlitzJS vs Elysia vs Fastify Benchmark

Config: autocannon, 50 connections, 10s per route.

## Route `/`

| Framework | Req/sec | Avg Latency (ms) | p99 Latency (ms) | Throughput (MB/s) | Errors |
|---|---|---|---|---|---|
| BlitzJS | 82821 | 0.13 | 1.00 | 15.01 | 0 |
| Elysia | 86419 | 0.10 | 1.00 | 10.71 | 0 |
| Fastify | 61886 | 0.31 | 2.00 | 10.56 | 0 |

## Route `/json`

| Framework | Req/sec | Avg Latency (ms) | p99 Latency (ms) | Throughput (MB/s) | Errors |
|---|---|---|---|---|---|
| BlitzJS | 83450 | 0.13 | 1.00 | 17.11 | 0 |
| Elysia | 84000 | 0.11 | 1.00 | 12.42 | 0 |
| Fastify | 57638 | 0.34 | 2.00 | 11.21 | 0 |

## Route `/user/42`

| Framework | Req/sec | Avg Latency (ms) | p99 Latency (ms) | Throughput (MB/s) | Errors |
|---|---|---|---|---|---|
| BlitzJS | 79398 | 0.14 | 1.00 | 15.90 | 0 |
| Elysia | 82208 | 0.13 | 1.00 | 11.76 | 0 |
| Fastify | 59795 | 0.31 | 2.00 | 11.35 | 0 |


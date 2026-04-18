# Observability

## Runtime surface

Server publishes:

- `GET /health`
- `GET /health/live`
- `GET /health/ready`
- `GET /metrics`

`/metrics` returns Prometheus exposition with:

- HTTP RED metrics
- background worker and cron metrics
- process/runtime saturation gauges
- DB readiness
- outbox backlog and dead-letter depth
- due reminder backlog

## Structured logging

Request completion is logged as JSON with:

- `msg=http.request.complete`
- `method`
- `route`
- `statusCode`
- `durationMs`
- `requestId`
- `correlationId`
- `traceId`
- `spanId`
- `apiVersion`

Worker and cron also log JSON events for:

- startup/shutdown
- successful outbox deliveries
- retries and backoff decisions
- dead-letter transitions
- reminder enqueue runs

## Tracing

OpenTelemetry starts when `OTEL_ENABLED=true`.

Supported runtime env:

- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
- `OTEL_SERVICE_NAME`

If inbound `traceparent` is present, trace identifiers are propagated into:

- response headers
- audit events
- RFC7807 error bodies
- request logs

## Dashboards and alerts

Reference artifacts:

- [ops/grafana/family-app-dashboard.json](</abs/path/C:/Users/stepa/OneDrive/Рабочий стол/Family App/ops/grafana/family-app-dashboard.json>)
- [ops/prometheus/alerts.yml](</abs/path/C:/Users/stepa/OneDrive/Рабочий стол/Family App/ops/prometheus/alerts.yml>)

Dashboard panels cover:

- request rate by route
- p95 latency
- 4xx/5xx rate
- in-flight requests
- outbox queue depth
- background job throughput
- reminder backlog
- event-loop lag
- memory footprint

Alert rules cover:

- elevated 5xx rate
- elevated p95 latency
- outbox dead letters
- worker retry spike
- DB readiness failures
- event-loop lag saturation

## Operational notes

- `/health/live` should be used for liveness.
- `/health/ready` should be used for readiness gating.
- `/metrics` is intentionally unauthenticated and should be protected by network policy or ingress rules in production.
- OTel bootstrap is optional and degrades gracefully if exporter packages are absent.

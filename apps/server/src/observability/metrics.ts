import { monitorEventLoopDelay } from "node:perf_hooks";
import { prisma } from "../lib/prisma.js";

type LabelValue = string | number | boolean | null | undefined;
type Labels = Record<string, LabelValue>;

type HistogramMetric = {
  help: string;
  buckets: number[];
  values: Map<string, number>;
  counts: Map<string, number>;
  sums: Map<string, number>;
};

type CounterMetric = {
  help: string;
  values: Map<string, number>;
};

type GaugeMetric = {
  help: string;
  values: Map<string, number>;
};

const histogramBucketsMs = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000];

const eventLoopLag = monitorEventLoopDelay({ resolution: 20 });
eventLoopLag.enable();

function normalizeLabels(labels: Labels) {
  return Object.entries(labels)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right));
}

function toSeriesKey(labels: Labels) {
  return normalizeLabels(labels)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

function parseSeriesKey(key: string) {
  return Object.fromEntries(
    key
      .split(",")
      .filter(Boolean)
      .map((part) => {
        const [label, ...rest] = part.split("=");
        return [label, rest.join("=")];
      })
  );
}

function formatLabelString(labels: Labels) {
  const normalized = normalizeLabels(labels);
  if (!normalized.length) {
    return "";
  }

  const encoded = normalized
    .map(
      ([key, value]) =>
        `${key}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
    )
    .join(",");

  return `{${encoded}}`;
}

function incrementCounter(metric: CounterMetric, labels: Labels, value = 1) {
  const key = toSeriesKey(labels);
  metric.values.set(key, (metric.values.get(key) ?? 0) + value);
}

function setGauge(metric: GaugeMetric, labels: Labels, value: number) {
  metric.values.set(toSeriesKey(labels), value);
}

function observeHistogram(metric: HistogramMetric, labels: Labels, value: number) {
  const baseKey = toSeriesKey(labels);
  metric.counts.set(baseKey, (metric.counts.get(baseKey) ?? 0) + 1);
  metric.sums.set(baseKey, (metric.sums.get(baseKey) ?? 0) + value);

  for (const bucket of metric.buckets) {
    if (value <= bucket) {
      const bucketKey = toSeriesKey({ ...labels, le: bucket });
      metric.values.set(bucketKey, (metric.values.get(bucketKey) ?? 0) + 1);
    }
  }

  const infKey = toSeriesKey({ ...labels, le: "+Inf" });
  metric.values.set(infKey, (metric.values.get(infKey) ?? 0) + 1);
}

const httpRequestsTotal: CounterMetric = {
  help: "Total HTTP requests processed by Family App API.",
  values: new Map()
};

const httpRequestErrorsTotal: CounterMetric = {
  help: "Total HTTP requests that resulted in 4xx or 5xx responses.",
  values: new Map()
};

const httpRequestDurationMs: HistogramMetric = {
  help: "HTTP request latency in milliseconds.",
  buckets: histogramBucketsMs,
  values: new Map(),
  counts: new Map(),
  sums: new Map()
};

const httpRequestsInFlight: GaugeMetric = {
  help: "Current number of in-flight HTTP requests.",
  values: new Map()
};

const backgroundJobRunsTotal: CounterMetric = {
  help: "Total background worker and cron runs by component and status.",
  values: new Map()
};

const backgroundJobDurationMs: HistogramMetric = {
  help: "Background worker and cron run durations in milliseconds.",
  buckets: histogramBucketsMs,
  values: new Map(),
  counts: new Map(),
  sums: new Map()
};

const runtimeMetrics: GaugeMetric = {
  help: "Runtime, queue, and readiness gauges.",
  values: new Map()
};

let inFlightRequests = 0;
let previousCpuUsage = process.cpuUsage();
let cpuUserSecondsTotal = 0;
let cpuSystemSecondsTotal = 0;

export function observeHttpRequestStart() {
  inFlightRequests += 1;
  setGauge(httpRequestsInFlight, {}, inFlightRequests);
}

export function observeHttpRequestEnd(params: {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}) {
  inFlightRequests = Math.max(0, inFlightRequests - 1);
  setGauge(httpRequestsInFlight, {}, inFlightRequests);

  const statusClass = `${Math.floor(params.statusCode / 100)}xx`;
  const labels = {
    method: params.method.toUpperCase(),
    route: params.route,
    status_class: statusClass
  };

  incrementCounter(httpRequestsTotal, labels);
  observeHistogram(httpRequestDurationMs, labels, params.durationMs);

  if (params.statusCode >= 400) {
    incrementCounter(httpRequestErrorsTotal, labels);
  }
}

export function observeBackgroundJob(params: {
  component: "worker" | "cron";
  job: string;
  status: "success" | "retry" | "dead" | "error";
  durationMs?: number;
}) {
  const labels = {
    component: params.component,
    job: params.job,
    status: params.status
  };

  incrementCounter(backgroundJobRunsTotal, labels);
  if (params.durationMs !== undefined) {
    observeHistogram(backgroundJobDurationMs, labels, params.durationMs);
  }
}

async function collectRuntimeGauges() {
  const memoryUsage = process.memoryUsage();
  const processWithInternals = process as NodeJS.Process & {
    _getActiveHandles?: () => unknown[];
    _getActiveRequests?: () => unknown[];
  };

  const cpuDiff = process.cpuUsage(previousCpuUsage);
  previousCpuUsage = process.cpuUsage();
  cpuUserSecondsTotal += cpuDiff.user / 1_000_000;
  cpuSystemSecondsTotal += cpuDiff.system / 1_000_000;

  setGauge(runtimeMetrics, { metric: "process_resident_memory_bytes" }, memoryUsage.rss);
  setGauge(runtimeMetrics, { metric: "process_heap_used_bytes" }, memoryUsage.heapUsed);
  setGauge(runtimeMetrics, { metric: "process_heap_total_bytes" }, memoryUsage.heapTotal);
  setGauge(runtimeMetrics, { metric: "process_external_memory_bytes" }, memoryUsage.external);
  setGauge(runtimeMetrics, { metric: "process_uptime_seconds" }, process.uptime());
  setGauge(runtimeMetrics, { metric: "process_cpu_user_seconds_total" }, cpuUserSecondsTotal);
  setGauge(runtimeMetrics, { metric: "process_cpu_system_seconds_total" }, cpuSystemSecondsTotal);
  setGauge(
    runtimeMetrics,
    { metric: "nodejs_eventloop_lag_seconds" },
    eventLoopLag.mean / 1_000_000_000
  );
  setGauge(
    runtimeMetrics,
    { metric: "nodejs_active_handles_total" },
    processWithInternals._getActiveHandles?.().length ?? 0
  );
  setGauge(
    runtimeMetrics,
    { metric: "nodejs_active_requests_total" },
    processWithInternals._getActiveRequests?.().length ?? 0
  );
}

async function collectDatabaseGauges() {
  try {
    const [outboxPending, outboxProcessing, outboxDead, dueReminders] = await Promise.all([
      prisma.outboxEvent.count({ where: { status: "PENDING" } }),
      prisma.outboxEvent.count({ where: { status: "PROCESSING" } }),
      prisma.outboxEvent.count({ where: { status: "DEAD" } }),
      prisma.task.count({
        where: {
          reminderAt: { lte: new Date() },
          reminderSentAt: null,
          status: { notIn: ["DONE", "CANCELLED"] }
        }
      })
    ]);

    setGauge(runtimeMetrics, { metric: "family_app_outbox_events", status: "pending" }, outboxPending);
    setGauge(
      runtimeMetrics,
      { metric: "family_app_outbox_events", status: "processing" },
      outboxProcessing
    );
    setGauge(runtimeMetrics, { metric: "family_app_outbox_events", status: "dead" }, outboxDead);
    setGauge(runtimeMetrics, { metric: "family_app_due_reminders_total" }, dueReminders);
    setGauge(runtimeMetrics, { metric: "family_app_readiness", check: "database" }, 1);
  } catch {
    setGauge(runtimeMetrics, { metric: "family_app_readiness", check: "database" }, 0);
  }
}

function appendCounter(lines: string[], name: string, metric: CounterMetric) {
  lines.push(`# HELP ${name} ${metric.help}`);
  lines.push(`# TYPE ${name} counter`);

  for (const [key, value] of metric.values.entries()) {
    lines.push(`${name}${formatLabelString(parseSeriesKey(key))} ${value}`);
  }
}

function appendGauge(lines: string[], name: string, metric: GaugeMetric) {
  lines.push(`# HELP ${name} ${metric.help}`);
  lines.push(`# TYPE ${name} gauge`);

  for (const [key, value] of metric.values.entries()) {
    lines.push(`${name}${formatLabelString(parseSeriesKey(key))} ${value}`);
  }
}

function appendHistogram(lines: string[], name: string, metric: HistogramMetric) {
  lines.push(`# HELP ${name} ${metric.help}`);
  lines.push(`# TYPE ${name} histogram`);

  for (const [key, value] of metric.values.entries()) {
    lines.push(`${name}_bucket${formatLabelString(parseSeriesKey(key))} ${value}`);
  }

  for (const [key, value] of metric.counts.entries()) {
    const labels = parseSeriesKey(key);
    lines.push(`${name}_count${formatLabelString(labels)} ${value}`);
    lines.push(`${name}_sum${formatLabelString(labels)} ${metric.sums.get(key) ?? 0}`);
  }
}

export async function renderPrometheusMetrics() {
  await Promise.all([collectRuntimeGauges(), collectDatabaseGauges()]);

  const lines: string[] = [];
  appendCounter(lines, "family_app_http_requests_total", httpRequestsTotal);
  appendCounter(lines, "family_app_http_request_errors_total", httpRequestErrorsTotal);
  appendHistogram(lines, "family_app_http_request_duration_ms", httpRequestDurationMs);
  appendGauge(lines, "family_app_http_requests_in_flight", httpRequestsInFlight);
  appendCounter(lines, "family_app_background_job_runs_total", backgroundJobRunsTotal);
  appendHistogram(lines, "family_app_background_job_duration_ms", backgroundJobDurationMs);
  appendGauge(lines, "family_app_runtime", runtimeMetrics);
  return `${lines.join("\n")}\n`;
}

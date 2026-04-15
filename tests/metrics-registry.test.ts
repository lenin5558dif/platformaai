import { describe, expect, test, beforeEach } from "vitest";
import { metricsRegistry } from "@/lib/metrics";

describe("metrics registry", () => {
  beforeEach(() => {
    metricsRegistry.resetForTests();
  });

  test("renders histogram buckets without double-counting", () => {
    const histogram = metricsRegistry.histogram("test_duration_seconds", "Test duration");

    metricsRegistry.observeHistogram(histogram as any, undefined, 0.2);
    metricsRegistry.observeHistogram(histogram as any, undefined, 0.6);

    const rendered = metricsRegistry.renderPrometheus();

    expect(rendered).toContain('test_duration_seconds_bucket{le="0.1"} 0');
    expect(rendered).toContain('test_duration_seconds_bucket{le="0.25"} 1');
    expect(rendered).toContain('test_duration_seconds_bucket{le="0.5"} 1');
    expect(rendered).toContain('test_duration_seconds_bucket{le="1"} 2');
    expect(rendered).toContain('test_duration_seconds_bucket{le="+Inf"} 2');
  });

  test("escapes prometheus text fields", () => {
    const histogram = metricsRegistry.histogram(
      "escaped_metric",
      'Line 1 "quoted" \\ path\nLine 2'
    );

    const rendered = metricsRegistry.renderPrometheus();

    expect(rendered).toContain('# HELP escaped_metric Line 1 \\"quoted\\" \\\\ path\\nLine 2');
    expect(rendered).toContain("# TYPE escaped_metric histogram");
    expect(histogram.name).toBe("escaped_metric");
  });

  test("supports labeled counters and gauges and validates label names", () => {
    const requests = metricsRegistry.counter("requests_total", "Requests", [
      "service",
      "status",
    ]);
    const sameRequests = metricsRegistry.counter("requests_total", "Ignored", [
      "service",
      "status",
    ]);
    const latency = metricsRegistry.gauge("request_latency_seconds", "Latency", [
      "service",
    ]);

    expect(sameRequests).toBe(requests);

    metricsRegistry.incCounter(requests as any, {
      service: "api",
      status: "ok",
    });
    metricsRegistry.setGauge(latency as any, { service: "api" }, 1.25);

    expect(metricsRegistry.getCounterValue(requests as any, {
      service: "api",
      status: "ok",
    })).toBe(1);
    expect(metricsRegistry.getGaugeValue(latency as any, { service: "api" })).toBe(1.25);

    const rendered = metricsRegistry.renderPrometheus();
    expect(rendered).toContain('requests_total{service="api",status="ok"} 1');
    expect(rendered).toContain('request_latency_seconds{service="api"} 1.25');

    expect(() =>
      metricsRegistry.incCounter(requests as any, {
        service: "api",
      } as any)
    ).toThrow("Missing label: status");
    expect(() =>
      metricsRegistry.incCounter(requests as any, {
        service: "api",
        status: "ok",
        extra: "boom",
      } as any)
    ).toThrow("Unknown label: extra");
  });

  test("supports labeled histograms and resetForTests clears values", () => {
    const requests = metricsRegistry.counter("requests_total", "Requests", [
      "service",
      "status",
    ]);
    const latency = metricsRegistry.gauge("request_latency_seconds", "Latency", [
      "service",
    ]);
    const histogram = metricsRegistry.histogram(
      "job_duration_seconds",
      "Job duration",
      ["queue"],
      [0.5, 1, 2]
    );
    const sameHistogram = metricsRegistry.histogram(
      "job_duration_seconds",
      "Ignored",
      ["queue"],
      [0.5, 1, 2]
    );

    expect(sameHistogram).toBe(histogram);

    metricsRegistry.observeHistogram(histogram as any, { queue: "default" }, 0.25);
    metricsRegistry.observeHistogram(histogram as any, { queue: "default" }, 1.5);

    expect(metricsRegistry.getHistogramCount(histogram as any, { queue: "default" })).toBe(2);

    const rendered = metricsRegistry.renderPrometheus();
    expect(rendered).toContain('job_duration_seconds_bucket{le="0.5",queue="default"} 1');
    expect(rendered).toContain('job_duration_seconds_bucket{le="1",queue="default"} 1');
    expect(rendered).toContain('job_duration_seconds_bucket{le="2",queue="default"} 2');
    expect(rendered).toContain('job_duration_seconds_bucket{le="+Inf",queue="default"} 2');
    expect(rendered).toContain('job_duration_seconds_sum{queue="default"} 1.75');
    expect(rendered).toContain('job_duration_seconds_count{queue="default"} 2');

    metricsRegistry.resetForTests();

    expect(metricsRegistry.getHistogramCount(histogram as any, { queue: "default" })).toBe(0);
    expect(metricsRegistry.getCounterValue(requests as any, {
      service: "api",
      status: "ok",
    })).toBe(0);
    expect(metricsRegistry.getGaugeValue(latency as any, { service: "api" })).toBe(0);
  });
});

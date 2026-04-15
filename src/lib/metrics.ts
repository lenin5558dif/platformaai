type MetricLabels = Record<string, string>;

function serializeLabels(labels: MetricLabels | undefined) {
  if (!labels) return "";
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  const parts = keys.map((k) => `${k}="${labels[k].replaceAll('"', '\\"')}"`);
  return `{${parts.join(",")}}`;
}

type CounterDef = {
  type: "counter";
  name: string;
  help: string;
  labelNames: string[];
  values: Map<string, number>;
};

type GaugeDef = {
  type: "gauge";
  name: string;
  help: string;
  labelNames: string[];
  values: Map<string, number>;
};

type HistogramDef = {
  type: "histogram";
  name: string;
  help: string;
  labelNames: string[];
  buckets: number[];
  bucketCounts: Map<string, number[]>;
  sum: Map<string, number>;
  count: Map<string, number>;
};

type MetricDef = CounterDef | GaugeDef | HistogramDef;

function ensureLabelNames(def: { labelNames: string[] }, labels: MetricLabels | undefined) {
  const used = labels ?? {};
  for (const name of def.labelNames) {
    if (!(name in used)) {
      throw new Error(`Missing label: ${name}`);
    }
  }
  for (const key of Object.keys(used)) {
    if (!def.labelNames.includes(key)) {
      throw new Error(`Unknown label: ${key}`);
    }
  }
}

function labelKey(def: { labelNames: string[] }, labels: MetricLabels | undefined) {
  if (!labels || def.labelNames.length === 0) return "";
  const parts = def.labelNames.map((k) => `${k}=${labels[k]}`);
  return parts.join("|");
}

class MetricsRegistry {
  private metrics = new Map<string, MetricDef>();

  counter(name: string, help: string, labelNames: string[] = []) {
    const existing = this.metrics.get(name);
    if (existing) return existing as CounterDef;

    const def: CounterDef = {
      type: "counter",
      name,
      help,
      labelNames,
      values: new Map(),
    };
    this.metrics.set(name, def);
    return def;
  }

  gauge(name: string, help: string, labelNames: string[] = []) {
    const existing = this.metrics.get(name);
    if (existing) return existing as GaugeDef;

    const def: GaugeDef = {
      type: "gauge",
      name,
      help,
      labelNames,
      values: new Map(),
    };
    this.metrics.set(name, def);
    return def;
  }

  histogram(
    name: string,
    help: string,
    labelNames: string[] = [],
    buckets: number[] = [0.1, 0.25, 0.5, 1, 2.5, 5, 10]
  ) {
    const existing = this.metrics.get(name);
    if (existing) return existing as HistogramDef;

    const def: HistogramDef = {
      type: "histogram",
      name,
      help,
      labelNames,
      buckets,
      bucketCounts: new Map(),
      sum: new Map(),
      count: new Map(),
    };
    this.metrics.set(name, def);
    return def;
  }

  incCounter(def: CounterDef, labels: MetricLabels | undefined, by = 1) {
    ensureLabelNames(def, labels);
    const key = labelKey(def, labels);
    def.values.set(key, (def.values.get(key) ?? 0) + by);
  }

  setGauge(def: GaugeDef, labels: MetricLabels | undefined, value: number) {
    ensureLabelNames(def, labels);
    const key = labelKey(def, labels);
    def.values.set(key, value);
  }

  observeHistogram(def: HistogramDef, labels: MetricLabels | undefined, value: number) {
    ensureLabelNames(def, labels);
    const key = labelKey(def, labels);
    const bucketCounts = def.bucketCounts.get(key) ?? new Array(def.buckets.length).fill(0);
    for (let i = 0; i < def.buckets.length; i++) {
      if (value <= def.buckets[i]) {
        bucketCounts[i] += 1;
      }
    }
    def.bucketCounts.set(key, bucketCounts);
    def.sum.set(key, (def.sum.get(key) ?? 0) + value);
    def.count.set(key, (def.count.get(key) ?? 0) + 1);
  }

  getCounterValue(def: CounterDef, labels: MetricLabels | undefined) {
    const key = labelKey(def, labels);
    return def.values.get(key) ?? 0;
  }

  getGaugeValue(def: GaugeDef, labels: MetricLabels | undefined) {
    const key = labelKey(def, labels);
    return def.values.get(key) ?? 0;
  }

  getHistogramCount(def: HistogramDef, labels: MetricLabels | undefined) {
    const key = labelKey(def, labels);
    return def.count.get(key) ?? 0;
  }

  renderPrometheus() {
    const lines: string[] = [];
    for (const def of this.metrics.values()) {
      lines.push(`# HELP ${def.name} ${def.help}`);
      lines.push(`# TYPE ${def.name} ${def.type}`);

      if (def.type === "counter" || def.type === "gauge") {
        for (const [k, v] of def.values.entries()) {
          const labels: MetricLabels = {};
          if (k) {
            const parts = k.split("|");
            for (const part of parts) {
              const [name, value] = part.split("=");
              labels[name] = value;
            }
          }
          lines.push(`${def.name}${serializeLabels(labels)} ${v}`);
        }
      } else {
        for (const [k, counts] of def.bucketCounts.entries()) {
          const labels: MetricLabels = {};
          if (k) {
            const parts = k.split("|");
            for (const part of parts) {
              const [name, value] = part.split("=");
              labels[name] = value;
            }
          }

          let cumulative = 0;
          for (let i = 0; i < def.buckets.length; i++) {
            cumulative += counts[i];
            lines.push(
              `${def.name}_bucket${serializeLabels({ ...labels, le: String(def.buckets[i]) })} ${cumulative}`
            );
          }
          lines.push(
            `${def.name}_bucket${serializeLabels({ ...labels, le: "+Inf" })} ${def.count.get(k) ?? 0}`
          );
          lines.push(`${def.name}_sum${serializeLabels(labels)} ${def.sum.get(k) ?? 0}`);
          lines.push(`${def.name}_count${serializeLabels(labels)} ${def.count.get(k) ?? 0}`);
        }
      }
    }
    return lines.join("\n") + "\n";
  }

  resetForTests() {
    for (const def of this.metrics.values()) {
      if (def.type === "counter" || def.type === "gauge") {
        def.values.clear();
      } else {
        def.bucketCounts.clear();
        def.sum.clear();
        def.count.clear();
      }
    }
  }
}

export const metricsRegistry = new MetricsRegistry();

/** Prometheus-compatible metrics collector. */

interface Counter {
  name: string;
  help: string;
  value: number;
  labels: Record<string, string>;
}

interface Gauge {
  name: string;
  help: string;
  value: number;
}

const counters = new Map<string, Counter>();
const gauges = new Map<string, Gauge>();

function counterKey(name: string, labels: Record<string, string>): string {
  const sorted = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${labels[k]}"`)
    .join(',');
  return `${name}{${sorted}}`;
}

/** Increment a labeled counter. */
export function incrementCounter(
  name: string,
  help: string,
  labels: Record<string, string> = {},
  amount = 1
): void {
  const key = counterKey(name, labels);
  const existing = counters.get(key);
  if (existing) {
    existing.value += amount;
  } else {
    counters.set(key, { name, help, value: amount, labels });
  }
}

/** Set a gauge value. */
export function setGauge(name: string, help: string, value: number): void {
  gauges.set(name, { name, help, value });
}

function formatLabels(labels: Record<string, string>): string {
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${labels[k]}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
}

/** Render metrics in Prometheus text exposition format. */
export function renderMetrics(): string {
  const lines: string[] = [];
  const seenHelps = new Set<string>();

  for (const gauge of gauges.values()) {
    if (!seenHelps.has(gauge.name)) {
      lines.push(`# HELP ${gauge.name} ${gauge.help}`);
      lines.push(`# TYPE ${gauge.name} gauge`);
      seenHelps.add(gauge.name);
    }
    lines.push(`${gauge.name} ${gauge.value}`);
  }

  const counterHelps = new Set<string>();
  for (const counter of counters.values()) {
    if (!counterHelps.has(counter.name)) {
      lines.push(`# HELP ${counter.name} ${counter.help}`);
      lines.push(`# TYPE ${counter.name} counter`);
      counterHelps.add(counter.name);
    }
    lines.push(`${counter.name}${formatLabels(counter.labels)} ${counter.value}`);
  }

  return lines.join('\n') + '\n';
}
import type { Request, Response, NextFunction } from "express";
import type { InternalConfig } from "../../config/internalConfig";

type Labels = Record<string, string>;

class Counter {
  private store = new Map<string, number>();
  inc(labels: Labels, value = 1) {
    const key = JSON.stringify(labels);
    this.store.set(key, (this.store.get(key) ?? 0) + value);
  }
  snapshot() {
    return Array.from(this.store.entries()).map(([k, v]) => ({ labels: JSON.parse(k), value: v }));
  }
}

class Summary {
  private store = new Map<string, { count: number; sum: number }>();
  observe(labels: Labels, value: number) {
    const key = JSON.stringify(labels);
    const cur = this.store.get(key) ?? { count: 0, sum: 0 };
    cur.count += 1;
    cur.sum += value;
    this.store.set(key, cur);
  }
  snapshot() {
    return Array.from(this.store.entries()).map(([k, v]) => ({ labels: JSON.parse(k), ...v }));
  }
}

export class Metrics {
  private requests = new Counter();
  private durations = new Summary();
  constructor(private config: InternalConfig) {}

  middleware() {
    const self = this;
    return function (req: Request, res: Response, next: NextFunction) {
      if (!self.config.server.metricsEnabled) return next();
      const start = Date.now();
      res.on("finish", () => {
        const route = req.route?.path || req.path || req.originalUrl || "unknown";
        self.requests.inc({ method: req.method, route, code: String(res.statusCode) });
        self.durations.observe({ route }, Date.now() - start);
      });
      next();
    };
  }

  renderPrometheus() {
    const lines: string[] = [];
    lines.push(`# HELP autocrud_requests_total Total HTTP requests`);
    lines.push(`# TYPE autocrud_requests_total counter`);
    for (const r of this.requests.snapshot()) {
      const lbl = Object.entries(r.labels)
        .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
        .join(",");
      lines.push(`autocrud_requests_total{${lbl}} ${r.value}`);
    }
    lines.push(`# HELP autocrud_request_duration_ms Summary of request durations`);
    lines.push(`# TYPE autocrud_request_duration_ms summary`);
    for (const s of this.durations.snapshot()) {
      const lbl = Object.entries(s.labels)
        .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
        .join(",");
      lines.push(`autocrud_request_duration_ms_sum{${lbl}} ${s.sum}`);
      lines.push(`autocrud_request_duration_ms_count{${lbl}} ${s.count}`);
    }
    return lines.join("\n") + "\n";
  }
}


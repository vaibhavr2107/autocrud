import pino from "pino";
import type { InternalConfig } from "../../config/internalConfig";
import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";

export function createLogger(config: InternalConfig) {
  const logger = pino({ level: config.server.logLevel });

  function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
    if (!config.server.tracingEnabled) return next();
    // Prefer incoming header, else generate
    const incoming = (req.headers["x-request-id"] as string) || undefined;
    const id = incoming || crypto.randomUUID();
    (req as any).id = id;
    res.setHeader("X-Request-Id", id);
    next();
  }

  function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction) {
    if (!config.server.loggingEnabled) return next();
    const start = Date.now();
    const id = (req as any).id;
    logger.debug({ id, method: req.method, url: req.originalUrl }, "req:start");
    res.on("finish", () => {
      const duration = Date.now() - start;
      logger.info({ id, method: req.method, url: req.originalUrl, status: res.statusCode, duration }, "req:finish");
    });
    next();
  }

  return { logger, requestIdMiddleware, requestLoggerMiddleware };
}


import Fastify from "fastify";
import crypto from "node:crypto";
import cors from "@fastify/cors";

import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { AppError, buildErrorPayload } from "./errors.js";
import { trustpilotRoutes } from "./routes/trustpilot.js";

const isCorsOriginAllowed = (origin, allowedDomains) => {
  if (typeof origin !== "string") return false;

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") {
    return false;
  }

  const hostname = parsedOrigin.hostname.toLowerCase();
  return allowedDomains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
};

export const buildApp = () => {
  const app = Fastify({
    logger: true,
    genReqId: () => `req_${crypto.randomUUID().replaceAll("-", "")}`,
  });

  app.register(cors, {
    methods: ["GET", "HEAD", "POST", "OPTIONS"],
    allowedHeaders: ["Accept", "Content-Type", "Authorization"],
    maxAge: 86400,
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(null, isCorsOriginAllowed(origin, config.corsAllowedDomains));
    },
  });

  app.register(async (instance) => {
    instance.get("/health", async (request) => {
      try {
        await pool.query("SELECT 1");
        return {
          data: { status: "ok", database: "up" },
          meta: { request_id: request.id, generated_at: new Date().toISOString() },
        };
      } catch {
        return {
          data: { status: "degraded", database: "down" },
          meta: { request_id: request.id, generated_at: new Date().toISOString() },
        };
      }
    });

    instance.register(trustpilotRoutes, { prefix: config.apiBasePath });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send(buildErrorPayload(request.id, error));
      return;
    }

    // PostgreSQL/network surface as internal error with stable contract.
    if (
      error?.code?.startsWith?.("ECONN") ||
      error?.code?.startsWith?.("57") ||
      error?.code?.startsWith?.("08")
    ) {
      const wrapped = new AppError({
        statusCode: 500,
        type: "internal_error",
        code: "database_error",
        message: "Database operation failed.",
      });
      reply.status(500).send(buildErrorPayload(request.id, wrapped));
      return;
    }

    const fallback = new AppError();
    reply.status(500).send(buildErrorPayload(request.id, fallback));
  });

  return app;
};

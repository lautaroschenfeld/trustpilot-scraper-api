import Fastify from "fastify";
import crypto from "node:crypto";

import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { AppError, buildErrorPayload } from "./errors.js";
import { trustpilotRoutes } from "./routes/trustpilot.js";

export const buildApp = () => {
  const app = Fastify({
    logger: true,
    genReqId: () => `req_${crypto.randomUUID().replaceAll("-", "")}`,
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

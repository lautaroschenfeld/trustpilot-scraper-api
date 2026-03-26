import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { buildApp } from "./app.js";

const app = buildApp();

const start = async () => {
  try {
    await app.listen({
      port: config.port,
      host: config.host,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

const shutdown = async () => {
  await app.close().catch(() => undefined);
  await pool.end().catch(() => undefined);
};

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});

start();


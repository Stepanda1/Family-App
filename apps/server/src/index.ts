import "./lib/load-env.js";
import { startOpenTelemetry } from "./observability/otel.js";
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 4000);
const host = "0.0.0.0";

await startOpenTelemetry();
const app = await buildApp();

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

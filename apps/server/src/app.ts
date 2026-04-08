import cors from "@fastify/cors";
import Fastify from "fastify";
import { registerFamilyRoutes } from "./routes/families.js";
import { registerTaskRoutes } from "./routes/tasks.js";

export async function buildApp() {
  const app = Fastify({
    logger: true
  });

  await app.register(cors, {
    origin: true
  });

  app.get("/health", async () => ({
    ok: true,
    service: "family-app-api"
  }));

  await registerFamilyRoutes(app);
  await registerTaskRoutes(app);

  return app;
}

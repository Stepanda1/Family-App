import "fastify";
import type { RequestContext } from "../lib/http/request-context.js";

declare module "fastify" {
  interface FastifyRequest {
    requestContext: RequestContext;
    observabilityStartNs?: bigint;
  }
}

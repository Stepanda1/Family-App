ALTER TABLE "audit_events"
ADD COLUMN "traceId" VARCHAR(32),
ADD COLUMN "spanId" VARCHAR(16);

CREATE INDEX "audit_events_traceId_idx" ON "audit_events"("traceId");
CREATE INDEX "audit_events_actorSessionId_createdAt_idx" ON "audit_events"("actorSessionId", "createdAt");

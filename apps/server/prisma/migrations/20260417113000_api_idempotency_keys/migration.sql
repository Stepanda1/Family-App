-- CreateEnum
CREATE TYPE "ApiIdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "api_idempotency_keys" (
    "id" UUID NOT NULL,
    "idempotencyKey" VARCHAR(255) NOT NULL,
    "operation" VARCHAR(120) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "status" "ApiIdempotencyStatus" NOT NULL DEFAULT 'PROCESSING',
    "responseStatusCode" INTEGER,
    "responseHeaders" JSONB,
    "responseBody" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "api_idempotency_keys_expiresAt_idx" ON "api_idempotency_keys"("expiresAt");

-- CreateIndex
CREATE INDEX "api_idempotency_keys_status_createdAt_idx" ON "api_idempotency_keys"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "api_idempotency_keys_idempotencyKey_operation_subject_key" ON "api_idempotency_keys"("idempotencyKey", "operation", "subject");

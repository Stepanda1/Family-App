-- CreateEnum
CREATE TYPE "AppLanguage" AS ENUM ('ru', 'en');

-- CreateEnum
CREATE TYPE "AccountProvider" AS ENUM ('GOOGLE', 'APPLE', 'TELEGRAM');

-- AlterTable
ALTER TABLE "families" ADD COLUMN     "appLanguage" "AppLanguage" NOT NULL DEFAULT 'ru';

-- CreateTable
CREATE TABLE "account_connections" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "provider" "AccountProvider" NOT NULL,
    "accountEmail" VARCHAR(140) NOT NULL,
    "displayName" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_connections_familyId_idx" ON "account_connections"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "account_connections_familyId_provider_accountEmail_key" ON "account_connections"("familyId", "provider", "accountEmail");

-- AddForeignKey
ALTER TABLE "account_connections" ADD CONSTRAINT "account_connections_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "FamilyAccessRole" AS ENUM ('OWNER', 'PARENT', 'CHILD', 'GUEST');

-- CreateTable
CREATE TABLE "family_memberships" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "FamilyAccessRole" NOT NULL,
    "participantId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "family_memberships_userId_idx" ON "family_memberships"("userId");

-- CreateIndex
CREATE INDEX "family_memberships_familyId_idx" ON "family_memberships"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "family_memberships_familyId_userId_key" ON "family_memberships"("familyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "family_memberships_participantId_key" ON "family_memberships"("participantId");

-- AddForeignKey
ALTER TABLE "family_memberships" ADD CONSTRAINT "family_memberships_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_memberships" ADD CONSTRAINT "family_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_memberships" ADD CONSTRAINT "family_memberships_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;


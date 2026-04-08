-- CreateEnum
CREATE TYPE "FamilyRole" AS ENUM ('PARENT', 'CHILD');

-- CreateEnum
CREATE TYPE "ExecutorKind" AS ENUM ('FAMILY_MEMBER', 'EXTERNAL_HELPER');

-- CreateEnum
CREATE TYPE "PlannerItemType" AS ENUM ('TASK', 'EVENT', 'SHOPPING');

-- CreateEnum
CREATE TYPE "PlannerPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "PlannerStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('SUCCESS', 'LATE', 'SKIPPED');

-- CreateTable
CREATE TABLE "families" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "timezone" VARCHAR(80) NOT NULL DEFAULT 'Asia/Yekaterinburg',
    "inviteCode" VARCHAR(12) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participants" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "displayName" VARCHAR(80) NOT NULL,
    "role" "FamilyRole" NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    "phone" VARCHAR(20),
    "birthDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "executors" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "participantId" UUID,
    "displayName" VARCHAR(80) NOT NULL,
    "kind" "ExecutorKind" NOT NULL,
    "contactInfo" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "executors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "itemType" "PlannerItemType" NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "creatorParticipantId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "title" VARCHAR(140) NOT NULL,
    "description" TEXT,
    "itemType" "PlannerItemType" NOT NULL,
    "priority" "PlannerPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "PlannerStatus" NOT NULL DEFAULT 'NEW',
    "listName" VARCHAR(80),
    "location" VARCHAR(140),
    "scheduledStartAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "reminderAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "taskId" UUID NOT NULL,
    "executorId" UUID NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "reminderOffsetMinutes" INTEGER,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("taskId","executorId")
);

-- CreateTable
CREATE TABLE "task_executions" (
    "participantId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualDurationMinutes" INTEGER,
    "status" "ExecutionStatus" NOT NULL,
    "note" TEXT,

    CONSTRAINT "task_executions_pkey" PRIMARY KEY ("participantId","taskId","executedAt")
);

-- CreateIndex
CREATE UNIQUE INDEX "families_inviteCode_key" ON "families"("inviteCode");

-- CreateIndex
CREATE INDEX "participants_familyId_idx" ON "participants"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "participants_familyId_displayName_key" ON "participants"("familyId", "displayName");

-- CreateIndex
CREATE UNIQUE INDEX "executors_participantId_key" ON "executors"("participantId");

-- CreateIndex
CREATE INDEX "executors_familyId_idx" ON "executors"("familyId");

-- CreateIndex
CREATE INDEX "categories_familyId_itemType_idx" ON "categories"("familyId", "itemType");

-- CreateIndex
CREATE UNIQUE INDEX "categories_familyId_itemType_name_key" ON "categories"("familyId", "itemType", "name");

-- CreateIndex
CREATE INDEX "tasks_familyId_itemType_scheduledStartAt_idx" ON "tasks"("familyId", "itemType", "scheduledStartAt");

-- CreateIndex
CREATE INDEX "tasks_familyId_status_dueAt_idx" ON "tasks"("familyId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "assignments_executorId_idx" ON "assignments"("executorId");

-- CreateIndex
CREATE INDEX "task_executions_taskId_executedAt_idx" ON "task_executions"("taskId", "executedAt");

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executors" ADD CONSTRAINT "executors_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executors" ADD CONSTRAINT "executors_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_creatorParticipantId_fkey" FOREIGN KEY ("creatorParticipantId") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_executorId_fkey" FOREIGN KEY ("executorId") REFERENCES "executors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

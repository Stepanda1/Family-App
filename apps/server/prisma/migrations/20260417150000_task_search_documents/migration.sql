CREATE TABLE "task_search_documents" (
  "id" UUID NOT NULL,
  "familyId" UUID NOT NULL,
  "taskId" UUID NOT NULL,
  "itemType" "PlannerItemType" NOT NULL,
  "status" "PlannerStatus" NOT NULL,
  "priority" "PlannerPriority" NOT NULL,
  "title" VARCHAR(140) NOT NULL,
  "description" TEXT,
  "categoryName" VARCHAR(80),
  "listName" VARCHAR(80),
  "location" VARCHAR(140),
  "executorNamesText" TEXT,
  "contentPlain" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_search_documents_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "task_search_documents"
  ADD CONSTRAINT "task_search_documents_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "task_search_documents_taskId_key"
  ON "task_search_documents"("taskId");

CREATE INDEX "task_search_documents_familyId_updatedAt_idx"
  ON "task_search_documents"("familyId", "updatedAt" DESC);

CREATE INDEX "task_search_documents_familyId_itemType_status_idx"
  ON "task_search_documents"("familyId", "itemType", "status");

ALTER TABLE "task_search_documents"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("categoryName", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce("executorNamesText", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce("listName", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce("location", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce("description", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce("contentPlain", '')), 'D')
  ) STORED;

CREATE INDEX "task_search_documents_searchVector_idx"
  ON "task_search_documents"
  USING GIN ("searchVector");

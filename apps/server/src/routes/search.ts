import { PlannerItemType, PlannerPriority, PlannerStatus, Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireFamilyCapability } from "../lib/authz/family-access.js";
import { readThroughScopedJsonCache } from "../lib/cache/store.js";
import { prisma } from "../lib/prisma.js";

const familyParamsSchema = z.object({
  familyId: z.string().uuid()
});

const searchTasksQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  itemType: z.nativeEnum(PlannerItemType).optional(),
  status: z.nativeEnum(PlannerStatus).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional()
});

const searchCursorSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string().datetime(),
  rank: z.number().min(0)
});

type SearchTaskRow = {
  id: string;
  taskId: string;
  title: string;
  itemType: PlannerItemType;
  status: PlannerStatus;
  priority: PlannerPriority;
  categoryName: string | null;
  listName: string | null;
  location: string | null;
  executorNamesText: string | null;
  updatedAt: Date;
  rank: number;
};

function combineConditions(conditions: Prisma.Sql[]) {
  if (!conditions.length) {
    return Prisma.sql`TRUE`;
  }

  return conditions.slice(1).reduce(
    (acc, condition) => Prisma.sql`${acc} AND ${condition}`,
    conditions[0]
  );
}

function encodeCursor(input: z.infer<typeof searchCursorSchema>) {
  return Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
}

function decodeCursor(cursor: string) {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return searchCursorSchema.parse(parsed);
  } catch {
    throw new Error("INVALID_CURSOR");
  }
}

export async function registerSearchRoutes(app: FastifyInstance<any, any, any, any>) {
  app.get("/api/families/:familyId/search/tasks", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const query = searchTasksQuerySchema.parse(request.query);

    const ctx = await requireFamilyCapability({
      request,
      familyId,
      capability: "planner.read"
    });

    const { value, cacheStatus } = await readThroughScopedJsonCache({
      scopes: [{ kind: "family_search", id: familyId }],
      keyParts: [
        "task-search",
        ctx.userId,
        ctx.role,
        query.q ?? null,
        query.itemType ?? null,
        query.status ?? null,
        query.limit,
        query.cursor ?? null
      ],
      ttlSeconds: 30,
      loader: async () => {
        const cursor = query.cursor ? decodeCursor(query.cursor) : null;
        const limit = query.limit;
        const searchTerm = query.q?.trim() || null;
        const rankExpression = searchTerm
          ? Prisma.sql`ts_rank_cd("searchVector", websearch_to_tsquery('simple', ${searchTerm}))`
          : Prisma.sql`0::double precision`;

        const conditions: Prisma.Sql[] = [
          Prisma.sql`"familyId" = CAST(${familyId} AS uuid)`
        ];

        if (searchTerm) {
          conditions.push(
            Prisma.sql`"searchVector" @@ websearch_to_tsquery('simple', ${searchTerm})`
          );
        }

        if (query.itemType) {
          conditions.push(Prisma.sql`"itemType" = ${query.itemType}::"PlannerItemType"`);
        }

        if (query.status) {
          conditions.push(Prisma.sql`"status" = ${query.status}::"PlannerStatus"`);
        }

        if (cursor) {
          if (searchTerm) {
            conditions.push(
              Prisma.sql`(
                ${rankExpression} < ${cursor.rank}
                OR (
                  ${rankExpression} = ${cursor.rank}
                  AND (
                    "updatedAt" < ${new Date(cursor.updatedAt)}
                    OR (
                      "updatedAt" = ${new Date(cursor.updatedAt)}
                      AND id < CAST(${cursor.id} AS uuid)
                    )
                  )
                )
              )`
            );
          } else {
            conditions.push(
              Prisma.sql`(
                "updatedAt" < ${new Date(cursor.updatedAt)}
                OR (
                  "updatedAt" = ${new Date(cursor.updatedAt)}
                  AND id < CAST(${cursor.id} AS uuid)
                )
              )`
            );
          }
        }

        const whereClause = combineConditions(conditions);

        const rows = await prisma.$queryRaw<SearchTaskRow[]>(Prisma.sql`
          SELECT
            id,
            "taskId",
            title,
            "itemType",
            status,
            priority,
            "categoryName",
            "listName",
            location,
            "executorNamesText",
            "updatedAt",
            ${rankExpression}::double precision AS rank
          FROM "task_search_documents"
          WHERE ${whereClause}
          ORDER BY
            ${rankExpression} DESC,
            "updatedAt" DESC,
            id DESC
          LIMIT ${limit + 1}
        `);

        const items = rows.slice(0, limit).map((row) => ({
          id: row.id,
          taskId: row.taskId,
          title: row.title,
          itemType: row.itemType,
          status: row.status,
          priority: row.priority,
          category: row.categoryName,
          listName: row.listName,
          location: row.location,
          executorNames: row.executorNamesText
            ? row.executorNamesText.split(" ").filter(Boolean)
            : [],
          updatedAt: row.updatedAt.toISOString(),
          rank: Number(row.rank.toFixed(6))
        }));

        const next = rows.length > limit ? rows[limit - 1] : null;

        return {
          items,
          nextCursor: next
            ? encodeCursor({
                id: next.id,
                updatedAt: next.updatedAt.toISOString(),
                rank: Number(next.rank)
              })
            : null
        };
      }
    });

    reply.header("x-cache", cacheStatus);
    return reply.send(value);
  });
}

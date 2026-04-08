import "../src/lib/load-env.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.taskExecution.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.task.deleteMany();
  await prisma.executor.deleteMany();
  await prisma.category.deleteMany();
  await prisma.participant.deleteMany();
  await prisma.family.deleteMany();

  const family = await prisma.family.create({
    data: {
      name: "ДомВместе Demo",
      timezone: "Asia/Yekaterinburg",
      inviteCode: "FAMDEMO",
      appLanguage: "ru",
      participants: {
        create: [
          {
            displayName: "Анна",
            role: "PARENT",
            color: "#0EA5E9"
          },
          {
            displayName: "Максим",
            role: "PARENT",
            color: "#F97316"
          },
          {
            displayName: "Ника",
            role: "CHILD",
            color: "#8B5CF6"
          }
        ]
      }
    },
    include: {
      participants: true
    }
  });

  const [alexey, marina, ira] = family.participants;

  const executors = await Promise.all(
    family.participants.map((participant) =>
      prisma.executor.create({
        data: {
          familyId: family.id,
          participantId: participant.id,
          displayName: participant.displayName,
          kind: "FAMILY_MEMBER"
        }
      })
    )
  );

  const categories = await Promise.all([
    prisma.category.create({
      data: {
        familyId: family.id,
        name: "Дом",
        itemType: "TASK",
        color: "#22C55E"
      }
    }),
    prisma.category.create({
      data: {
        familyId: family.id,
        name: "Семейные события",
        itemType: "EVENT",
        color: "#0EA5E9"
      }
    }),
    prisma.category.create({
      data: {
        familyId: family.id,
        name: "Покупки",
        itemType: "SHOPPING",
        color: "#F97316"
      }
    })
  ]);

  const taskCategory = categories[0];
  const eventCategory = categories[1];
  const shoppingCategory = categories[2];

  const dinner = await prisma.task.create({
    data: {
      familyId: family.id,
      creatorParticipantId: marina.id,
      categoryId: eventCategory.id,
      title: "Семейный ужин",
      itemType: "EVENT",
      priority: "MEDIUM",
      status: "NEW",
      scheduledStartAt: new Date("2026-04-08T18:30:00+05:00"),
      dueAt: new Date("2026-04-08T20:00:00+05:00"),
      location: "Дом"
    }
  });

  const groceries = await prisma.task.create({
    data: {
      familyId: family.id,
      creatorParticipantId: alexey.id,
      categoryId: shoppingCategory.id,
      title: "Купить молоко и овощи",
      itemType: "SHOPPING",
      listName: "Неделя",
      priority: "HIGH",
      status: "IN_PROGRESS",
      dueAt: new Date("2026-04-08T20:00:00+05:00")
    }
  });

  const cleanRoom = await prisma.task.create({
    data: {
      familyId: family.id,
      creatorParticipantId: marina.id,
      categoryId: taskCategory.id,
      title: "Убрать детскую",
      itemType: "TASK",
      priority: "MEDIUM",
      status: "NEW",
      dueAt: new Date("2026-04-09T19:00:00+05:00")
    }
  });

  await prisma.assignment.createMany({
    data: [
      { taskId: dinner.id, executorId: executors[0].id },
      { taskId: dinner.id, executorId: executors[1].id },
      { taskId: dinner.id, executorId: executors[2].id },
      { taskId: groceries.id, executorId: executors[0].id },
      { taskId: cleanRoom.id, executorId: executors[2].id }
    ]
  });

  await prisma.taskExecution.create({
    data: {
      participantId: ira.id,
      taskId: cleanRoom.id,
      executedAt: new Date("2026-04-09T18:00:00+05:00"),
      actualDurationMinutes: 25,
      status: "SUCCESS",
      note: "Сделано до ужина"
    }
  });

  await prisma.accountConnection.createMany({
    data: [
      {
        familyId: family.id,
        provider: "GOOGLE",
        accountEmail: "anna.family@example.com",
        displayName: "Анна Google"
      },
      {
        familyId: family.id,
        provider: "TELEGRAM",
        accountEmail: "domvmeste_demo@telegram.local",
        displayName: "Семейный Telegram"
      }
    ]
  });
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

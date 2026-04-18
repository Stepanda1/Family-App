import "../src/lib/load-env.js";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/passwords.js";

const prisma = new PrismaClient();

async function main() {
  await prisma.authChallenge.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.oAuthAccount.deleteMany();
  await prisma.familyMembership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.taskExecution.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.task.deleteMany();
  await prisma.executor.deleteMany();
  await prisma.category.deleteMany();
  await prisma.participant.deleteMany();
  await prisma.family.deleteMany();

  const [ownerUser, parentUser, childUser, guestUser] = await Promise.all([
    prisma.user.create({
      data: {
        email: "demo@family.app",
        displayName: "Demo Owner",
        passwordHash: await hashPassword("DemoPassw0rd!")
      }
    }),
    prisma.user.create({
      data: {
        email: "parent@family.app",
        displayName: "Demo Parent",
        passwordHash: await hashPassword("DemoPassw0rd!")
      }
    }),
    prisma.user.create({
      data: {
        email: "child@family.app",
        displayName: "Demo Child",
        passwordHash: await hashPassword("DemoPassw0rd!")
      }
    }),
    prisma.user.create({
      data: {
        email: "guest@family.app",
        displayName: "Demo Guest",
        passwordHash: await hashPassword("DemoPassw0rd!")
      }
    })
  ]);

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

  const [anna, maxim, nika] = family.participants;

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
      creatorParticipantId: maxim.id,
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
      creatorParticipantId: anna.id,
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
      creatorParticipantId: maxim.id,
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
      participantId: nika.id,
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

  await prisma.familyMembership.createMany({
    data: [
      { familyId: family.id, userId: ownerUser.id, role: "OWNER", participantId: anna.id },
      { familyId: family.id, userId: parentUser.id, role: "PARENT", participantId: maxim.id },
      { familyId: family.id, userId: childUser.id, role: "CHILD", participantId: nika.id },
      { familyId: family.id, userId: guestUser.id, role: "GUEST" }
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

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const polls = await prisma.poll.findMany({
    orderBy: { id: 'desc' },
    take: 5
  });
  console.log(JSON.stringify(polls, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());

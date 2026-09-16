import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const event = await prisma.event.findFirst();
  if (!event) return console.log('no event');
  const poll = await prisma.poll.create({
    data: {
      eventId: event.id,
      question: 'Test',
      status: 'live',
      launchedAt: new Date()
    }
  });
  console.log("Date.now() before:", Date.now());
  console.log("launchedAt from Prisma:", poll.launchedAt);
  console.log("toISOString:", poll.launchedAt?.toISOString());
  console.log("getTime:", poll.launchedAt?.getTime());
  console.log("Date.now() after:", Date.now());
  
  if (poll.launchedAt) {
    console.log("elapsed diff:", Math.floor((Date.now() - poll.launchedAt.getTime()) / 1000));
  }
}
main();

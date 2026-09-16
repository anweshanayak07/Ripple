import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const p = await prisma.poll.findFirst({ where: { status: 'closed' } });
  console.log("launchedAt from Prisma:", p?.launchedAt);
  console.log("toISOString:", p?.launchedAt?.toISOString());
  console.log("getTime:", p?.launchedAt?.getTime());
  console.log("Date.now():", Date.now());
  
  if (p?.launchedAt) {
    console.log("elapsed diff:", Math.floor((Date.now() - p.launchedAt.getTime()) / 1000));
  }
}
main();

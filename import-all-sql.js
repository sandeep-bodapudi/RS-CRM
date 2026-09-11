const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "mysql://u988844918_RS_CRM:RSCRMrs369@82.25.121.145/u988844918_RS_DB"
    }
  }
});

async function main() {
  const filePath = '../../docs/architecture/u988844918_RSCRM_DB (4).sql';
  let buffer = fs.readFileSync(filePath);
  let content = buffer[0] === 0xff && buffer[1] === 0xfe ? buffer.toString('utf16le') : buffer.toString('utf8');

  // Find the exact line and extract until the next "INSERT INTO" or "CREATE TABLE" or "--"
  const startIndex = content.indexOf('INSERT INTO `DailyReport`');
  if (startIndex === -1) {
    console.log('DailyReport not found');
    return;
  }
  
  let endIndex = content.indexOf(';\r\n', startIndex);
  if (endIndex === -1) endIndex = content.indexOf(';\n', startIndex);
  
  // if not found, just grab until the next statement
  if (endIndex === -1) {
    endIndex = content.indexOf('--\r\n', startIndex);
  }

  let query = content.substring(startIndex, endIndex + 1);
  console.log(`Executing DailyReport length: ${query.length}`);
  
  try {
    await prisma.$executeRawUnsafe(query);
    console.log(` - Success`);
  } catch (e) {
    console.error(` - Error inserting into DailyReport:`, e.message);
  }

  const rCount = await prisma.dailyReport.count();
  console.log(`Final check - DailyReport: ${rCount}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());

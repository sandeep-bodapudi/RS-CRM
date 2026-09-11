const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const filePath = '../../docs/architecture/u988844918_RSCRM_DB (4).sql';
  // Try reading as utf8 first, if it contains null bytes, it might be utf16le
  let buffer = fs.readFileSync(filePath);
  let content = '';
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    content = buffer.toString('utf16le');
  } else {
    content = buffer.toString('utf8');
  }

  // Find AttendanceLog INSERT
  const attendanceMatch = content.match(/INSERT INTO `AttendanceLog`[^;]+;/s);
  if (attendanceMatch) {
    console.log('Found AttendanceLog data. Importing...');
    try {
      await prisma.$executeRawUnsafe(attendanceMatch[0]);
      console.log('Successfully imported AttendanceLog!');
    } catch (e) {
      console.error('Error importing AttendanceLog:', e.message);
    }
  } else {
    console.log('No AttendanceLog INSERT found.');
  }

  // Find DailyReport INSERT
  const reportMatch = content.match(/INSERT INTO `DailyReport`[^;]+;/s);
  if (reportMatch) {
    console.log('Found DailyReport data. Importing...');
    try {
      await prisma.$executeRawUnsafe(reportMatch[0]);
      console.log('Successfully imported DailyReport!');
    } catch (e) {
      console.error('Error importing DailyReport:', e.message);
    }
  } else {
    console.log('No DailyReport INSERT found.');
  }

  const aCount = await prisma.attendanceLog.count();
  const rCount = await prisma.dailyReport.count();
  console.log(`Final count -> AttendanceLog: ${aCount}, DailyReport: ${rCount}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());

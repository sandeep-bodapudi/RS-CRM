const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "mysql://u988844918_RS_CRM:RSCRMrs369@82.25.121.145/u988844918_RS_DB"
    }
  }
});

async function main() {
  const eCount = await prisma.employee.count();
  const aCount = await prisma.attendanceLog.count();
  const rCount = await prisma.dailyReport.count();
  console.log(`Explicit DB - Employees: ${eCount}, AttendanceLog: ${aCount}, DailyReport: ${rCount}`);
}

main().finally(() => prisma.$disconnect());

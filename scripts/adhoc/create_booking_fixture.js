const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const customer = await p.customer.create({
    data: {
      customer_code: 'VERIFY-CUST-001',
      company_id: 2,
      first_name: 'Verify',
      last_name: 'Customer',
      phone: '9999900001',
    },
  });
  const booking = await p.booking.create({
    data: {
      booking_code: 'VERIFY-BOOK-001',
      company_id: 2,
      customer_id: customer.id,
      property_id: 8885475,
      status: 'CONFIRMED',
      agreed_price: 5000000,
      booking_amount: 500000,
      balance_amount: 4500000,
    },
  });
  const installment = await p.installment.create({
    data: {
      booking_id: booking.id,
      installment_number: 1,
      expected_amount: 500000,
      received_amount: 200000,
      due_date: new Date(),
      status: 'PARTIALLY_RECEIVED',
    },
  });
  console.log(JSON.stringify({ customerId: customer.id, bookingId: booking.id, installmentId: installment.id }, null, 2));
  await p.$disconnect();
})();

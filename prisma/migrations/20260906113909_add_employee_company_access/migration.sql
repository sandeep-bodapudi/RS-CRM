-- CreateTable
CREATE TABLE `EmployeeCompanyAccess` (
    `employee_id` INTEGER NOT NULL,
    `company_id` INTEGER NOT NULL,

    PRIMARY KEY (`employee_id`, `company_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EmployeeCompanyAccess` ADD CONSTRAINT `EmployeeCompanyAccess_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmployeeCompanyAccess` ADD CONSTRAINT `EmployeeCompanyAccess_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


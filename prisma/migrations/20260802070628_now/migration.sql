/*
  Warnings:

  - You are about to drop the column `guarantorName` on the `RiderProfile` table. All the data in the column will be lost.
  - You are about to drop the column `guarantorPhone` on the `RiderProfile` table. All the data in the column will be lost.
  - You are about to drop the column `verificationDocumentType` on the `RiderProfile` table. All the data in the column will be lost.
  - You are about to drop the column `verificationDocumentUrl` on the `RiderProfile` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[referralCode]` on the table `RiderProfile` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[referralCode]` on the table `VendorProfile` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "RiderProfile" DROP COLUMN "guarantorName",
DROP COLUMN "guarantorPhone",
DROP COLUMN "verificationDocumentType",
DROP COLUMN "verificationDocumentUrl",
ADD COLUMN     "bvnNumber" TEXT,
ADD COLUMN     "ninNumber" TEXT,
ADD COLUMN     "passportUrl" TEXT,
ADD COLUMN     "referralCode" TEXT,
ALTER COLUMN "accountName" DROP NOT NULL,
ALTER COLUMN "accountNumber" DROP NOT NULL,
ALTER COLUMN "bankName" DROP NOT NULL;

-- AlterTable
ALTER TABLE "VendorProfile" ADD COLUMN     "referralCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "RiderProfile_referralCode_key" ON "RiderProfile"("referralCode");

-- CreateIndex
CREATE INDEX "RiderProfile_referralCode_idx" ON "RiderProfile"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "VendorProfile_referralCode_key" ON "VendorProfile"("referralCode");

-- CreateIndex
CREATE INDEX "VendorProfile_referralCode_idx" ON "VendorProfile"("referralCode");

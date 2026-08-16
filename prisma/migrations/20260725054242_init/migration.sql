/*
  Warnings:

  - Added the required column `guarantorName` to the `RiderProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `guarantorPhone` to the `RiderProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `verificationDocumentType` to the `RiderProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `verificationDocumentUrl` to the `RiderProfile` table without a default value. This is not possible if the table is not empty.
  - Made the column `accountName` on table `RiderProfile` required. This step will fail if there are existing NULL values in that column.
  - Made the column `accountNumber` on table `RiderProfile` required. This step will fail if there are existing NULL values in that column.
  - Made the column `bankName` on table `RiderProfile` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "VerificationDocumentType" AS ENUM ('NIN', 'VOTERS_CARD', 'DRIVERS_LICENSE', 'INTERNATIONAL_PASSPORT');

-- AlterTable
ALTER TABLE "RiderProfile" ADD COLUMN     "guarantorName" TEXT NOT NULL,
ADD COLUMN     "guarantorPhone" TEXT NOT NULL,
ADD COLUMN     "verificationDocumentType" "VerificationDocumentType" NOT NULL,
ADD COLUMN     "verificationDocumentUrl" TEXT NOT NULL,
ALTER COLUMN "accountName" SET NOT NULL,
ALTER COLUMN "accountNumber" SET NOT NULL,
ALTER COLUMN "bankName" SET NOT NULL;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "status" SET DEFAULT 'PENDING';

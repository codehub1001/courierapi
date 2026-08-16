/*
  Warnings:

  - A unique constraint covering the columns `[ninNumber]` on the table `RiderProfile` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[bvnNumber]` on the table `RiderProfile` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "RiderProfile" ADD COLUMN     "selfieUrl" TEXT,
ADD COLUMN     "verificationProvider" TEXT,
ADD COLUMN     "verificationReference" TEXT,
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "RiderProfile_ninNumber_key" ON "RiderProfile"("ninNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RiderProfile_bvnNumber_key" ON "RiderProfile"("bvnNumber");

-- CreateIndex
CREATE INDEX "RiderProfile_verificationStatus_idx" ON "RiderProfile"("verificationStatus");

-- CreateIndex
CREATE INDEX "RiderProfile_isVerified_idx" ON "RiderProfile"("isVerified");

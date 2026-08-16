-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "deliveryId" TEXT;

-- CreateIndex
CREATE INDEX "Notification_deliveryId_idx" ON "Notification"("deliveryId");

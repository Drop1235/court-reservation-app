/*
  Warnings:

  - You are about to drop the column `maintenanceMode` on the `CourtSetting` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Reservation_date_courtId_startMin_endMin_key";

-- AlterTable
ALTER TABLE "CourtSetting" DROP COLUMN "maintenanceMode",
ADD COLUMN     "notice" TEXT,
ADD COLUMN     "preparing" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CourtBlock" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "courtId" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourtBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminConfig" (
    "id" TEXT NOT NULL,
    "adminPin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourtBlock_date_idx" ON "CourtBlock"("date");

-- CreateIndex
CREATE INDEX "CourtBlock_date_courtId_idx" ON "CourtBlock"("date", "courtId");

-- CreateIndex
CREATE INDEX "CourtBlock_date_courtId_startMin_endMin_idx" ON "CourtBlock"("date", "courtId", "startMin", "endMin");

-- CreateIndex
CREATE INDEX "Reservation_date_courtId_startMin_endMin_idx" ON "Reservation"("date", "courtId", "startMin", "endMin");

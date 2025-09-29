/*
  Warnings:

  - A unique constraint covering the columns `[date,courtId,startMin,endMin]` on the table `Reservation` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "pin" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_date_courtId_startMin_endMin_key" ON "Reservation"("date", "courtId", "startMin", "endMin");

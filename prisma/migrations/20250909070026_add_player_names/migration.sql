/*
  Warnings:

  - You are about to drop the column `playerName` on the `Reservation` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Reservation" DROP COLUMN "playerName",
ADD COLUMN     "playerNames" TEXT[];

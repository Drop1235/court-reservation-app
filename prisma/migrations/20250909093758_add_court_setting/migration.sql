-- CreateTable
CREATE TABLE "CourtSetting" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "courtCount" INTEGER NOT NULL,
    "courtNames" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourtSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourtSetting_date_key" ON "CourtSetting"("date");

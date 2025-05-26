-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "lastContentId" TEXT;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_lastContentId_fkey" FOREIGN KEY ("lastContentId") REFERENCES "Content"("id") ON DELETE SET NULL ON UPDATE CASCADE;

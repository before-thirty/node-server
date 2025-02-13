-- AlterTable
ALTER TABLE "PlaceCache" ADD COLUMN     "currentOpeningHours" JSONB,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "rating" DOUBLE PRECISION,
ADD COLUMN     "regularOpeningHours" JSONB,
ADD COLUMN     "userRatingCount" INTEGER,
ADD COLUMN     "websiteUri" TEXT;

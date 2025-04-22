/*
  Warnings:

  - You are about to drop the column `firebase_id` on the `User` table. All the data in the column will be lost.
  - Added the required column `firebaseId` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "firebase_id",
ADD COLUMN     "firebaseId" TEXT NOT NULL;

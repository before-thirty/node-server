/*
  Warnings:

  - Added the required column `firebase_id` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "firebase_id" TEXT NOT NULL;

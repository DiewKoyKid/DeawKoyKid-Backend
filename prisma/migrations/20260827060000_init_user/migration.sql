-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "firstname" VARCHAR(80) NOT NULL,
    "lastname" VARCHAR(80) NOT NULL,
    "gender" CHAR(1),
    "bdate" DATE,
    "bankAccount" VARCHAR(20),
    "phoneNumber" VARCHAR(20),
    "instagram" VARCHAR(40),
    "line" VARCHAR(40),
    "facebook" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

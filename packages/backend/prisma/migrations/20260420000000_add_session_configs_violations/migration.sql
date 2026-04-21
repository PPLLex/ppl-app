-- CreateEnum
CREATE TYPE "ViolationType" AS ENUM ('NO_SIGNUP', 'WRONG_TIME');

-- CreateEnum
CREATE TYPE "ViolationStatus" AS ENUM ('PENDING', 'PAID', 'WAIVED');

-- CreateTable
CREATE TABLE "session_type_configs" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sessionType" "SessionType" NOT NULL,
    "label" TEXT NOT NULL,
    "maxCapacity" INTEGER NOT NULL DEFAULT 8,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "registrationCutoffHours" INTEGER NOT NULL DEFAULT 2,
    "cancellationCutoffHours" INTEGER NOT NULL DEFAULT 1,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_type_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_violations" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "locationId" TEXT NOT NULL,
    "type" "ViolationType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "ViolationStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "assessedById" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "waivedAt" TIMESTAMP(3),
    "waivedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_violations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_violations_clientId_idx" ON "attendance_violations"("clientId");

-- CreateIndex
CREATE INDEX "attendance_violations_sessionId_idx" ON "attendance_violations"("sessionId");

-- CreateIndex
CREATE INDEX "attendance_violations_status_idx" ON "attendance_violations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "session_type_configs_locationId_sessionType_key" ON "session_type_configs"("locationId", "sessionType");

-- AddForeignKey
ALTER TABLE "session_type_configs" ADD CONSTRAINT "session_type_configs_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_violations" ADD CONSTRAINT "attendance_violations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_violations" ADD CONSTRAINT "attendance_violations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_violations" ADD CONSTRAINT "attendance_violations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_violations" ADD CONSTRAINT "attendance_violations_assessedById_fkey" FOREIGN KEY ("assessedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropTable (remove waitlist if it exists)
DROP TABLE IF EXISTS "waitlists";

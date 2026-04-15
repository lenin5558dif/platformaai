-- CreateTable
CREATE TABLE "OrgMembershipAllowedCostCenter" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgMembershipAllowedCostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgMembershipAllowedCostCenter_membershipId_idx" ON "OrgMembershipAllowedCostCenter"("membershipId");

-- CreateIndex
CREATE INDEX "OrgMembershipAllowedCostCenter_costCenterId_idx" ON "OrgMembershipAllowedCostCenter"("costCenterId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgMembershipAllowedCostCenter_membershipId_costCenterId_key" ON "OrgMembershipAllowedCostCenter"("membershipId", "costCenterId");

-- CreateIndex
CREATE INDEX "QuotaBucket_scope_subjectId_periodEnd_idx" ON "QuotaBucket"("scope", "subjectId", "periodEnd");

-- CreateIndex
CREATE INDEX "QuotaReservation_orgId_reservedAt_idx" ON "QuotaReservation"("orgId", "reservedAt");

-- AddForeignKey
ALTER TABLE "OrgMembershipAllowedCostCenter" ADD CONSTRAINT "OrgMembershipAllowedCostCenter_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrgMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMembershipAllowedCostCenter" ADD CONSTRAINT "OrgMembershipAllowedCostCenter_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

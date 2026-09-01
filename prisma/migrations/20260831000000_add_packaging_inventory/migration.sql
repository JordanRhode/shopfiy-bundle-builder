-- CreateTable
CREATE TABLE "PackagingType" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "lowThreshold" INTEGER NOT NULL DEFAULT 0,
    "notifyEmails" TEXT,
    "lastNotifiedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackagingType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagingAssignment" (
    "id" TEXT NOT NULL,
    "packagingTypeId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyVariantId" TEXT NOT NULL DEFAULT '*',
    "productTitle" TEXT,
    "variantTitle" TEXT,
    "unitsPerItem" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackagingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagingLedgerEntry" (
    "id" TEXT NOT NULL,
    "packagingTypeId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "shopifyOrderId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackagingLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PackagingType_shopDomain_idx" ON "PackagingType"("shopDomain");

-- CreateIndex
CREATE UNIQUE INDEX "PackagingType_shopDomain_name_key" ON "PackagingType"("shopDomain", "name");

-- CreateIndex
CREATE INDEX "PackagingAssignment_shopDomain_shopifyProductId_idx" ON "PackagingAssignment"("shopDomain", "shopifyProductId");

-- CreateIndex
CREATE UNIQUE INDEX "PackagingAssignment_packagingTypeId_shopifyProductId_shopif_key" ON "PackagingAssignment"("packagingTypeId", "shopifyProductId", "shopifyVariantId");

-- CreateIndex
CREATE INDEX "PackagingLedgerEntry_shopDomain_createdAt_idx" ON "PackagingLedgerEntry"("shopDomain", "createdAt");

-- CreateIndex
CREATE INDEX "PackagingLedgerEntry_shopifyOrderId_idx" ON "PackagingLedgerEntry"("shopifyOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PackagingLedgerEntry_packagingTypeId_reason_sourceId_key" ON "PackagingLedgerEntry"("packagingTypeId", "reason", "sourceId");

-- AddForeignKey
ALTER TABLE "PackagingAssignment" ADD CONSTRAINT "PackagingAssignment_packagingTypeId_fkey" FOREIGN KEY ("packagingTypeId") REFERENCES "PackagingType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagingLedgerEntry" ADD CONSTRAINT "PackagingLedgerEntry_packagingTypeId_fkey" FOREIGN KEY ("packagingTypeId") REFERENCES "PackagingType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

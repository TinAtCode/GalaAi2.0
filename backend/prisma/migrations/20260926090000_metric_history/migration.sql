-- CreateTable
CREATE TABLE "MetricSample" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "instance" TEXT NOT NULL,
    "requests" INTEGER NOT NULL,
    "serverErrors" INTEGER NOT NULL,
    "latencyBuckets" INTEGER[],
    "eventLoopP99Seconds" DOUBLE PRECISION NOT NULL,
    "rssBytes" DOUBLE PRECISION NOT NULL,
    "ocrWaiting" INTEGER NOT NULL,
    "mailFailures" INTEGER NOT NULL,

    CONSTRAINT "MetricSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetricSample_at_idx" ON "MetricSample"("at");


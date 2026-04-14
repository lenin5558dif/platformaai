-- Add modelId to EventLog for filtering/export
ALTER TABLE "EventLog" ADD COLUMN "modelId" TEXT;

CREATE INDEX "EventLog_modelId_idx" ON "EventLog"("modelId");

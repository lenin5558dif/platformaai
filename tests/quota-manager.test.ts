import { test } from "vitest";
import assert from "node:assert/strict";

import {
  buildQuotaChain,
  buildReservationRequestId,
  getAllTimePeriod,
  getUtcDayPeriod,
  getUtcMonthPeriod,
  parseReservationRequestId,
  periodFromKey,
} from "../src/lib/quota-manager";

test("getUtcDayPeriod uses UTC boundaries", () => {
  const now = new Date(Date.UTC(2026, 1, 3, 12, 34, 56));
  const period = getUtcDayPeriod(now);

  assert.equal(period.kind, "day");
  assert.equal(period.start.toISOString(), "2026-02-03T00:00:00.000Z");
  assert.equal(period.end.toISOString(), "2026-02-04T00:00:00.000Z");
  assert.ok(period.key.startsWith("day:"));
});

test("getUtcMonthPeriod uses UTC boundaries", () => {
  const now = new Date(Date.UTC(2026, 1, 3, 12, 34, 56));
  const period = getUtcMonthPeriod(now);

  assert.equal(period.kind, "month");
  assert.equal(period.start.toISOString(), "2026-02-01T00:00:00.000Z");
  assert.equal(period.end.toISOString(), "2026-03-01T00:00:00.000Z");
  assert.ok(period.key.startsWith("month:"));
});

test("buildQuotaChain orders USER -> COST_CENTER -> ORG", () => {
  const chain = buildQuotaChain({
    orgId: "org_1",
    userId: "user_1",
    costCenterId: "cc_1",
  });

  assert.deepEqual(chain, {
    orgId: "org_1",
    subjects: [
      { scope: "USER", subjectId: "user_1" },
      { scope: "COST_CENTER", subjectId: "cc_1" },
      { scope: "ORG", subjectId: "org_1" },
    ],
  });
});

test("reservation requestId round-trips via parseReservationRequestId", () => {
  const period = getAllTimePeriod();
  const requestId = buildReservationRequestId({
    idempotencyKey: "req_123",
    periodKey: period.key,
    scope: "ORG",
    subjectId: "org_1",
  });

  const parsed = parseReservationRequestId(requestId);
  assert.ok(parsed);
  assert.equal(parsed.idempotencyKey, "req_123");
  assert.equal(parsed.periodKey, "all_time");
  assert.equal(parsed.scope, "ORG");
  assert.equal(parsed.subjectId, "org_1");
});

test("periodFromKey parses day/month/all_time", () => {
  const day = getUtcDayPeriod(new Date(Date.UTC(2026, 1, 3, 0, 0, 0)));
  const month = getUtcMonthPeriod(new Date(Date.UTC(2026, 1, 3, 0, 0, 0)));

  assert.equal(periodFromKey(day.key).end.toISOString(), day.end.toISOString());
  assert.equal(periodFromKey(month.key).end.toISOString(), month.end.toISOString());
  assert.equal(periodFromKey("all_time").key, "all_time");
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SLEEP_CHAPTER,
  SLEEP_MINUTES,
  nearestSleepMinute,
  nextSleepChoice,
} from "../docs/sleep.js";

describe("sleep timer choices", () => {
  it("keeps the minute steps and puts 本章結束 after 60", () => {
    assert.deepEqual(SLEEP_MINUTES, [0, 15, 30, 45, 60]);
    assert.equal(nextSleepChoice(0), 15);
    assert.equal(nextSleepChoice(15), 30);
    assert.equal(nextSleepChoice(30), 45);
    assert.equal(nextSleepChoice(45), 60);
    assert.equal(nextSleepChoice(60), SLEEP_CHAPTER);
    assert.equal(nextSleepChoice(SLEEP_CHAPTER), 0);
  });

  it("still steps from the nearest remaining minute", () => {
    assert.equal(nearestSleepMinute(0), 0);
    assert.equal(nearestSleepMinute(1), 15);
    assert.equal(nearestSleepMinute(15), 15);
    assert.equal(nearestSleepMinute(16), 30);
    assert.equal(nearestSleepMinute(60), 60);
    assert.equal(nextSleepChoice(nearestSleepMinute(60)), SLEEP_CHAPTER);
  });
});

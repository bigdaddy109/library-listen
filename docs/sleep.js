/** Sleep-timer choices. Minutes stay numbers; chapter-end is a mode, not a duration. */
export const SLEEP_MINUTES = [0, 15, 30, 45, 60];
export const SLEEP_CHAPTER = "chapter";

export function sleepSteps() {
  return [...SLEEP_MINUTES, SLEEP_CHAPTER];
}

/** Minute choice that matches time left. 0 means the timer is off. */
export function nearestSleepMinute(remainingMinutes) {
  const remaining = Math.max(0, Number(remainingMinutes) || 0);
  let nearest = SLEEP_MINUTES[0];
  for (let i = 0; i < SLEEP_MINUTES.length; i += 1) {
    if (SLEEP_MINUTES[i] >= remaining) return SLEEP_MINUTES[i];
    nearest = SLEEP_MINUTES[i];
  }
  return nearest;
}

/** Next tap: off → 15 → 30 → 45 → 60 → chapter → off. */
export function nextSleepChoice(current) {
  const steps = sleepSteps();
  const index = steps.indexOf(current);
  const at = index < 0 ? 0 : index;
  return steps[(at + 1) % steps.length];
}

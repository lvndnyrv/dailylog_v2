export function dailyLogEntryCount(log) {
  return (log?.mealCount || 0)
    + (log?.sleepCount || 0)
    + (log?.diaperCount || 0)
    + (log?.activityCount || 0);
}

export function isDailyLogReady(log) {
  if (!log || log.sent_to_parents) return false;
  return Boolean(
    log.notes?.trim()
    || log.comments?.trim()
    || dailyLogEntryCount(log) >= 2
  );
}


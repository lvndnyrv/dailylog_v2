export function validateRoomSettings(values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.name?.trim() || values.name.trim().length > 100) errors.name = "Enter a room name (up to 100 characters).";
  if (!values.age_group?.trim() || values.age_group.trim().length > 100) errors.age_group = "Enter an age-band name (up to 100 characters).";
  for (const [key, min, max] of [["min_age_months", 0, 215], ["max_age_months", 1, 216], ["capacity", 1, 9999], ["ratio", 1, 999]] as const) {
    if (!/^\d+$/.test(values[key] ?? "") || Number(values[key]) < min || Number(values[key]) > max) {
      errors[key] = `Enter a whole number from ${min} to ${max}.`;
    }
  }
  if (!errors.min_age_months && !errors.max_age_months && Number(values.max_age_months) <= Number(values.min_age_months)) {
    errors.max_age_months = "Oldest age must be after youngest age.";
  }
  if (Boolean(values.nap_start) !== Boolean(values.nap_end) || (values.nap_start && values.nap_start >= values.nap_end)) {
    errors.nap_start = "Provide both nap times, with the end after the start.";
    errors.nap_end = errors.nap_start;
  }
  return errors;
}

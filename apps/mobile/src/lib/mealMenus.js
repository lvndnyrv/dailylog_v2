export const MEAL_SLOTS = [
  {
    id: 'morning_snack',
    label: 'Morning snack',
    defaultTime: '09:30:00',
  },
  {
    id: 'lunch',
    label: 'Lunch',
    defaultTime: '11:45:00',
  },
  {
    id: 'afternoon_snack',
    label: 'Afternoon snack',
    defaultTime: '15:00:00',
  },
];

export function mealSlotById(id) {
  return MEAL_SLOTS.find(slot => slot.id === id) || MEAL_SLOTS[0];
}

export function formatMealTime(value) {
  if (!value) return '';
  const [hourText, minute = '00'] = value.split(':');
  const hour = Number(hourText);
  if (Number.isNaN(hour)) return value;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

export function effectiveMenuItems(rows, classroomId) {
  const byType = new Map();
  (rows || [])
    .filter(row => row.classroom_id == null)
    .forEach(row => byType.set(row.meal_type, row));
  (rows || [])
    .filter(row => row.classroom_id === classroomId)
    .forEach(row => byType.set(row.meal_type, row));

  return [...byType.values()].sort((left, right) =>
    String(left.meal_time).localeCompare(String(right.meal_time))
  );
}

export function preferredMeal(items, now = new Date()) {
  if (!items?.length) return null;
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const scored = items.map(item => {
    const [hour = '0', minute = '0'] = String(item.meal_time || '00:00').split(':');
    const scheduledMinute = Number(hour) * 60 + Number(minute);
    return { item, distance: Math.abs(scheduledMinute - minuteOfDay) };
  });
  scored.sort((left, right) => left.distance - right.distance);
  return scored[0].item;
}

function normalizedWords(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function allergyConflicts(child, allergens) {
  if (!child?.allergies?.length || !allergens?.length) return [];
  const menuWords = new Set(allergens.flatMap(normalizedWords));
  return child.allergies.filter(allergy =>
    normalizedWords(allergy).some(word => menuWords.has(word))
  );
}

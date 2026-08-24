import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import * as Calendar from 'expo-calendar/legacy';

import { supabase } from '../lib/supabase';
import { useEnrollmentJourney } from './useEnrollmentJourney';

function requireData(data, error, fallback) {
  if (error) throw new Error(error.message || fallback);
  if (!data) throw new Error(fallback);
  return data;
}

export function useParentInquiryJourney() {
  const access = useEnrollmentJourney();
  const { beginJourney, centerId, code } = access;
  const [center, setCenter] = useState(null);
  const [journey, setJourney] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  const loadCenter = useCallback(async (daycareId = centerId) => {
    if (!daycareId) return null;
    const { data, error: loadError } = await supabase.rpc('get_parent_inquiry_center', {
      p_daycare_id: daycareId,
    });
    const next = requireData(data, loadError, 'This inquiry link is unavailable.');
    if (mounted.current) setCenter(next);
    return next;
  }, [centerId]);

  const loadJourney = useCallback(async (journeyCode = code) => {
    if (!journeyCode) return null;
    const { data, error: loadError } = await supabase.rpc('get_parent_inquiry_journey', {
      p_code: journeyCode,
    });
    const next = requireData(data, loadError, 'This family link is unavailable.');
    if (mounted.current) {
      setJourney(next);
      setCenter(next.daycare || null);
    }
    return next;
  }, [code]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = code ? await loadJourney() : await loadCenter();
      if (mounted.current) setError(null);
      return result;
    } catch (loadError) {
      if (mounted.current) setError(loadError.message);
      return null;
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [code, loadCenter, loadJourney]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  const submitInquiry = useCallback(async (values) => {
    setBusy(true);
    try {
      const { data, error: submitError } = await supabase.rpc(
        'submit_parent_enrollment_inquiry',
        {
          p_daycare_id: centerId,
          p_guardian_name: values.guardianName,
          p_guardian_email: values.guardianEmail,
          p_guardian_phone: values.guardianPhone || null,
          p_child_full_name: values.childName,
          p_child_date_of_birth: values.childDateOfBirth || null,
          p_classroom_id: values.classroomId || null,
          p_desired_start: values.desiredStart || null,
          p_days_per_week: values.daysPerWeek,
        },
      );
      const result = requireData(data, submitError, 'Your inquiry could not be sent.');
      await beginJourney(result.journey_code);
      return await loadJourney(result.journey_code);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [beginJourney, centerId, loadJourney]);

  const bookTour = useCallback(async (slotId) => {
    setBusy(true);
    try {
      const { data, error: bookingError } = await supabase.rpc('book_parent_enrollment_tour', {
        p_code: code,
        p_slot_id: slotId,
      });
      const next = requireData(data, bookingError, 'That tour could not be booked.');
      if (mounted.current) setJourney(next);
      return next;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [code]);

  const cancelTour = useCallback(async () => {
    setBusy(true);
    try {
      const { data, error: cancellationError } = await supabase.rpc(
        'cancel_parent_enrollment_tour',
        { p_code: code },
      );
      const next = requireData(data, cancellationError, 'That tour could not be cancelled.');
      if (mounted.current) setJourney(next);
      return next;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [code]);

  const respondToWaitlist = useCallback(async (keepSpot) => {
    setBusy(true);
    try {
      const { data, error: responseError } = await supabase.rpc(
        'respond_parent_waitlist_checkin',
        { p_code: code, p_keep_spot: keepSpot },
      );
      const next = requireData(data, responseError, 'Your response could not be saved.');
      if (mounted.current) setJourney(next);
      return next;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [code]);

  const addTourToCalendar = useCallback(async () => {
    if (!journey?.tour) throw new Error('No tour is booked.');
    if (!(await Calendar.isAvailableAsync())) throw new Error('Calendar is unavailable on this device.');
    return Calendar.createEventInCalendarAsync({
      title: `${journey.daycare?.name || 'Daycare'} tour`,
      startDate: new Date(journey.tour.starts_at),
      endDate: new Date(journey.tour.ends_at),
      location: journey.daycare?.address || undefined,
      notes: `Tour for ${journey.child?.first_name || 'your family'}`,
      alarms: [{ relativeOffset: -60 }],
    });
  }, [journey]);

  const getDirections = useCallback(async () => {
    const address = journey?.daycare?.address || center?.address;
    if (!address) throw new Error('The center has not added an address yet.');
    await Linking.openURL(`https://maps.apple.com/?q=${encodeURIComponent(address)}`);
  }, [center?.address, journey?.daycare?.address]);

  return {
    ...access,
    center,
    journey,
    loading,
    error,
    busy,
    refresh,
    submitInquiry,
    bookTour,
    cancelTour,
    respondToWaitlist,
    addTourToCalendar,
    getDirections,
  };
}

-- October 25, 2026: Grand Ballroom preparation ONLY.
-- Run as database owner. No bookings opened, capacity activation, or payments.
-- All ten arrival times use ONE existing 950-seat physical capacity resource.
-- Safe to repeat while this service remains scheduled and has no reservations.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Briefly prevent competing setup/reservation writes during validation + setup.
LOCK TABLE public.reservations IN SHARE MODE;
LOCK TABLE public.venue_spaces, public.sunday_services, public.seating_times,
  public.payment_policy, public.capacity_resources, public.capacity_control
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  room public.venue_spaces%ROWTYPE;
  resource public.capacity_resources%ROWTYPE;
  service public.sunday_services%ROWTYPE;
  service_id uuid;
  restaurant_tz text;
  starts text[] := ARRAY[
    '12:00','12:30','13:00','13:30','14:00',
    '14:30','15:00','15:30','16:00','16:30'
  ];
  i integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.capacity_control WHERE id = 1 AND ready = false
  ) THEN
    RAISE EXCEPTION 'Capacity must still be inactive for this preparation script. Nothing was changed.';
  END IF;

  SELECT restaurant_timezone INTO STRICT restaurant_tz
    FROM public.payment_policy WHERE id = 1;
  IF restaurant_tz IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE name = restaurant_tz
  ) THEN
    RAISE EXCEPTION 'Configure a valid restaurant timezone first. Nothing was changed.';
  END IF;

  SELECT * INTO STRICT room FROM public.venue_spaces
    WHERE slug = 'grand-ballroom';
  IF NOT room.is_active OR room.space_type <> 'general_dining'
     OR room.reported_capacity <> 950 THEN
    RAISE EXCEPTION 'Expected an active general-dining Grand Ballroom with reported capacity 950. Review room configuration.';
  END IF;

  SELECT * INTO STRICT resource FROM public.capacity_resources
    WHERE space_id = room.id;
  IF NOT resource.is_active OR resource.resource_type <> 'standalone'
     OR resource.parent_id IS NOT NULL OR resource.total_capacity <> 950 THEN
    RAISE EXCEPTION 'Expected the existing active standalone 950-seat Ballroom capacity resource. Nothing was changed.';
  END IF;

  IF (SELECT count(*) FROM public.sunday_services
      WHERE date = DATE '2026-10-25' AND space_id = room.id) > 1 THEN
    RAISE EXCEPTION 'Multiple October 25 Ballroom services exist. Resolve duplicates before setup.';
  END IF;

  SELECT * INTO service FROM public.sunday_services
    WHERE date = DATE '2026-10-25' AND space_id = room.id;
  service_id := service.id;

  IF service_id IS NOT NULL THEN
    IF service.status <> 'scheduled' THEN
      RAISE EXCEPTION 'Existing October 25 service is %, not scheduled. It was not modified.', service.status;
    END IF;
    IF EXISTS (SELECT 1 FROM public.reservations WHERE sunday_service_id = service_id) THEN
      RAISE EXCEPTION 'This service already has reservation history. Review it before changing configuration.';
    END IF;
    IF service.capacity_resource_id IS NOT NULL
       AND service.capacity_resource_id <> resource.id THEN
      RAISE EXCEPTION 'Existing service has a different capacity override. Nothing was changed.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.seating_times
      WHERE sunday_service_id = service_id
      GROUP BY start_time HAVING count(*) > 1
    ) OR EXISTS (
      SELECT 1 FROM public.seating_times
      WHERE sunday_service_id = service_id
        AND (NOT (start_time = ANY(starts))
          OR end_time::time <> start_time::time + interval '150 minutes')
    ) THEN
      RAISE EXCEPTION 'Existing arrival times conflict with the approved timetable. No times were overwritten.';
    END IF;
  END IF;

  -- The room ceiling is shared configuration. Do not change other open sales.
  IF room.online_booking_limit IS DISTINCT FROM 950 AND EXISTS (
    SELECT 1 FROM public.sunday_services
    WHERE space_id = room.id AND is_active AND status = 'open'
      AND id IS DISTINCT FROM service_id
  ) THEN
    RAISE EXCEPTION 'Another Ballroom service is open. Review its room-wide ceiling before changing it.';
  END IF;

  UPDATE public.venue_spaces SET online_booking_limit = 950, updated_by = NULL
    WHERE id = room.id AND online_booking_limit IS DISTINCT FROM 950;

  IF service_id IS NULL THEN
    INSERT INTO public.sunday_services
      (date, label, status, space_id, online_booking_limit,
       capacity_resource_id, is_active, display_order, created_by, updated_by)
    VALUES
      (DATE '2026-10-25', 'Launch Sunday - October 25', 'scheduled', room.id,
       950, NULL, true, 25, NULL, NULL)
    RETURNING id INTO service_id;
  ELSE
    UPDATE public.sunday_services
      SET online_booking_limit = 950, is_active = true, updated_by = NULL
      WHERE id = service_id
        AND (online_booking_limit IS DISTINCT FROM 950 OR NOT is_active);
  END IF;

  IF public.capacity_resource_for_service_0019(service_id) IS DISTINCT FROM resource.id THEN
    RAISE EXCEPTION 'Service did not resolve to the shared Ballroom capacity resource. Setup rolled back.';
  END IF;

  FOR i IN 1..array_length(starts, 1) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.seating_times
      WHERE sunday_service_id = service_id AND start_time = starts[i]
    ) THEN
      INSERT INTO public.seating_times
        (sunday_service_id, label, start_time, end_time,
         online_booking_limit, is_active, display_order, created_by, updated_by)
      VALUES
        (service_id, starts[i], starts[i],
         to_char(DATE '2026-10-25' + starts[i]::time + interval '150 minutes', 'HH24:MI'),
         950, true, i - 1, NULL, NULL);
    ELSE
      UPDATE public.seating_times
        SET online_booking_limit = 950, is_active = true, updated_by = NULL
        WHERE sunday_service_id = service_id AND start_time = starts[i]
          AND (online_booking_limit IS DISTINCT FROM 950 OR NOT is_active);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Verification only: expect 10 rows, scheduled, ready=false, and one resource.
SELECT s.id AS service_id, s.date, s.status, v.name AS room,
  p.restaurant_timezone, c.ready AS capacity_ready,
  public.capacity_resource_for_service_0019(s.id) AS shared_capacity_resource_id,
  v.online_booking_limit AS room_limit,
  s.online_booking_limit AS service_limit,
  t.start_time AS arrival, t.end_time AS dining_ends,
  t.online_booking_limit AS seating_limit
FROM public.sunday_services s
JOIN public.venue_spaces v ON v.id = s.space_id
JOIN public.seating_times t ON t.sunday_service_id = s.id
CROSS JOIN public.payment_policy p
CROSS JOIN public.capacity_control c
WHERE s.date = DATE '2026-10-25' AND v.slug = 'grand-ballroom'
  AND p.id = 1 AND c.id = 1
ORDER BY t.start_time;

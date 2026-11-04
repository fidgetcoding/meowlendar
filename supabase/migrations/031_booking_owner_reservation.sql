-- Serialize reservations across every link belonging to one host. A trigger also
-- protects status changes and direct DB writes. Existing bookings are preserved.
create function public.guard_owner_booking_reservation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  owner_id uuid;
  buffer_mins int;
begin
  if new.status not in ('confirmed', 'pending') then return new; end if;
  select user_id, coalesce(buffer_minutes, 0) into owner_id, buffer_mins
    from public.booking_links where id = new.booking_link_id;
  if owner_id is null then return new; end if; -- FK reports an invalid link.
  -- Held until commit/rollback. The subsequent query obtains a fresh snapshot
  -- after a competing reservation commits (PostgREST uses READ COMMITTED).
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 4733));
  if exists (
    select 1 from public.bookings b
    join public.booking_links l on l.id = b.booking_link_id
    where l.user_id = owner_id and b.id <> new.id
      and b.status in ('confirmed', 'pending')
      and new.start_time < b.end_time + make_interval(mins => buffer_mins + coalesce(l.buffer_minutes, 0))
      and new.end_time > b.start_time - make_interval(mins => buffer_mins + coalesce(l.buffer_minutes, 0))
  ) then
    raise exception 'Time slot no longer available' using errcode = '23P01';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_owner_booking_reservation() from public, anon, authenticated;
create trigger guard_owner_booking_reservation
  before insert or update of booking_link_id, start_time, end_time, status on public.bookings
  for each row execute function public.guard_owner_booking_reservation();

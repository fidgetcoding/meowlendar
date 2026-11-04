-- The stored cleanup target is privileged input to the cancellation worker.
-- It must belong to the booking-link owner, including writes made via RLS.
create function public.guard_booking_google_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.google_account_id is not null and not exists (
    select 1 from public.booking_links l
    join public.google_accounts a on a.user_id = l.user_id
    where l.id = new.booking_link_id and a.id = new.google_account_id
  ) then
    raise exception 'Google account does not belong to the booking owner' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_booking_google_owner() from public, anon, authenticated;
create trigger guard_booking_google_owner
  before insert or update of booking_link_id, google_account_id on public.bookings
  for each row execute function public.guard_booking_google_owner();

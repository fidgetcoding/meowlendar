-- Keep the exact target alongside the reservation before any remote create.
alter table public.bookings
  add column google_account_id uuid references public.google_accounts(id) on delete set null,
  add column google_calendar_id text;

create function public.record_booking_google_tombstone()
returns trigger language plpgsql security definer set search_path = public as $$
declare target public.bookings;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() <> 1 then return old; end if;
    target := old;
  else
    if new.status <> 'cancelled' or old.status = 'cancelled' then return new; end if;
    target := new;
  end if;
  if target.google_event_id is not null and target.google_calendar_id is not null then
    insert into public.google_event_tombstones(user_id, google_account_id, google_calendar_id, google_event_id)
      select l.user_id, a.id, target.google_calendar_id, target.google_event_id
      from public.booking_links l join public.google_accounts a on a.user_id = l.user_id
      where l.id = target.booking_link_id and a.id = target.google_account_id;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public.record_booking_google_tombstone() from public, anon, authenticated;
create trigger record_booking_google_tombstone
  before delete or update of status on public.bookings
  for each row execute function public.record_booking_google_tombstone();

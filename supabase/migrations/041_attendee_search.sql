-- PostgREST does not allow casts inside filters. Expose the same JSON text as
-- a computed field, evaluated only on event rows visible under the caller's RLS.
create function public.attendee_search_text(public.events)
returns text language sql immutable security invoker set search_path = public as $$
  select $1.attendees::text;
$$;
revoke all on function public.attendee_search_text(public.events) from public, anon;
grant execute on function public.attendee_search_text(public.events) to authenticated, service_role;

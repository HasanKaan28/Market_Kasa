-- Goods receipts taken back (`purchaseVoids`) are events: written once, never changed.
--
-- `app.event_tables()` is redefined from the list the server already has, so every event table
-- on it stays, those added there by hand included; only `purchaseVoids` is added, and only once.
-- `app.entity_tables()` is left alone: the live server's also lists Restoran Kasa's tables.
do $$
declare
  v_tables text[] := app.event_tables();
begin
  if not ('purchaseVoids' = any (v_tables)) then
    v_tables := v_tables || array['purchaseVoids'];
  end if;
  execute format(
    'create or replace function app.event_tables() returns text[] language sql immutable as %L',
    format('select %L::text[]', v_tables));
end
$$;

-- `create or replace` drops the function's settings; put the empty search path back.
alter function app.event_tables() set search_path = '';

-- The security advisor's "role mutable search_path": the app functions name every object in full,
-- so an empty search_path changes nothing they do and leaves no schema for a caller to plant.
alter function app.entity_tables() set search_path = '';
alter function app.event_tables() set search_path = '';
alter function app.lock_market(text) set search_path = '';
alter function app.current_device() set search_path = '';
alter function app.resend(text, text, text) set search_path = '';
alter function app.normalized(text, jsonb) set search_path = '';
alter function app.settle_barcode(text, text) set search_path = '';
alter function app.apply_op(text, jsonb) set search_path = '';
alter function app.is_owner(text) set search_path = '';
alter function app.create_market(text, text, text) set search_path = '';

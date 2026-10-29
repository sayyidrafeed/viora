-- Dibuat dari outboxDdl('identity', 'identity-svc') di service-kit, lalu trigger identity (§6).
create table if not exists identity.outbox (
      id uuid primary key,
      seq bigint generated always as identity,
      xid xid8 not null default pg_current_xact_id(),
      topic text not null,
      key text not null,
      headers jsonb not null default '{}',
      payload jsonb not null,
      published_at timestamptz
    );
--> statement-breakpoint
create index if not exists outbox_unpublished on identity.outbox (xid, seq) where published_at is null;
--> statement-breakpoint
create or replace function identity.uuid_v7() returns uuid language sql volatile as $fn$
      select encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
        placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
        from 1 for 6), 52, 1), 53, 1), 'hex')::uuid
    $fn$;
--> statement-breakpoint
-- traceparent dibaca dari set_config('viora.traceparent', ..., true) yang dipasang service di transaksi yang sama.
    create or replace function identity.outbox_emit(p_topic text, p_type text, p_key text, p_data jsonb, p_version int default 1)
    returns jsonb language plpgsql volatile as $fn$
    declare
      v_id uuid := identity.uuid_v7();
      v_envelope jsonb;
    begin
      v_envelope := jsonb_build_object(
        'id', v_id, 'type', p_type, 'version', p_version,
        'occurredAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'producer', 'identity-svc', 'key', p_key, 'data', p_data);
      insert into identity.outbox (id, topic, key, headers, payload)
      values (v_id, p_topic, p_key,
        jsonb_strip_nulls(jsonb_build_object('traceparent', nullif(current_setting('viora.traceparent', true), ''))),
        v_envelope);
      return v_envelope;
    end
    $fn$;
--> statement-breakpoint
create function identity.bump_state_version() returns trigger language plpgsql as $fn$
begin
  new.state_version := old.state_version + 1;
  return new;
end
$fn$;
--> statement-breakpoint
create trigger user_state_version before update on identity."user"
  for each row execute function identity.bump_state_version();
--> statement-breakpoint
create trigger channel_state_version before update on identity.channel
  for each row execute function identity.bump_state_version();
--> statement-breakpoint
-- Pemetaan perubahan kolom ke event (§6 Identitas). Penghapusan ditulis eksplisit oleh DELETE /v1/me, bukan di sini.
create function identity.user_outbox() returns trigger language plpgsql as $fn$
begin
  if tg_op = 'INSERT' then
    perform identity.outbox_emit('identity.v1', 'user.registered', new.id,
      jsonb_build_object('userId', new.id, 'name', new.name, 'image', new.image, 'stateVersion', new.state_version));
    if new.email_verified then
      perform identity.outbox_emit('identity.v1', 'user.email_verified', new.id,
        jsonb_build_object('userId', new.id, 'email', new.email));
    end if;
    return null;
  end if;

  if new.email_verified and not old.email_verified then
    perform identity.outbox_emit('identity.v1', 'user.email_verified', new.id,
      jsonb_build_object('userId', new.id, 'email', new.email));
  end if;
  if new.name is distinct from old.name or new.image is distinct from old.image then
    perform identity.outbox_emit('identity.v1', 'user.profile_updated', new.id,
      jsonb_build_object('userId', new.id, 'name', new.name, 'image', new.image, 'stateVersion', new.state_version));
  end if;
  if new.banned and not old.banned then
    perform identity.outbox_emit('identity.v1', 'user.banned', new.id,
      jsonb_build_object('userId', new.id, 'reason', new.ban_reason, 'expiresAt', to_jsonb(new.ban_expires)));
  elsif old.banned and not new.banned then
    perform identity.outbox_emit('identity.v1', 'user.unbanned', new.id, jsonb_build_object('userId', new.id));
  end if;
  return null;
end
$fn$;
--> statement-breakpoint
create trigger user_outbox after insert or update on identity."user"
  for each row execute function identity.user_outbox();
--> statement-breakpoint
create function identity.channel_outbox() returns trigger language plpgsql as $fn$
begin
  if tg_op = 'UPDATE' and (new.handle, new.name, new.avatar_key) is not distinct from (old.handle, old.name, old.avatar_key) then
    return null;
  end if;
  perform identity.outbox_emit('identity.v1',
    case tg_op when 'INSERT' then 'channel.created' else 'channel.updated' end,
    new.owner_user_id,
    jsonb_build_object('channelId', new.id, 'ownerUserId', new.owner_user_id, 'handle', new.handle,
      'name', new.name, 'avatarKey', new.avatar_key, 'stateVersion', new.state_version));
  return null;
end
$fn$;
--> statement-breakpoint
create trigger channel_outbox after insert or update on identity.channel
  for each row execute function identity.channel_outbox();

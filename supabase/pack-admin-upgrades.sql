-- RKBO pack administration and per-card collectible cosmetics (2026-10-26).
-- Admins are provisioned from existing verified Supabase users, never ?admin=1 alone.
create table if not exists public.rkbo_pack_admins(
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.rkbo_pack_admins enable row level security;
revoke all on public.rkbo_pack_admins from public,anon,authenticated;

-- Bootstrap the original signed-in RKBO owner's existing Google account.
insert into public.rkbo_pack_admins(user_id)
select id from auth.users where lower(email)=lower('king1015ka@gmail.com')
on conflict do nothing;

create or replace function public.rkbo_is_pack_admin()
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.rkbo_pack_admins a where a.user_id=auth.uid()) $$;
revoke all on function public.rkbo_is_pack_admin() from public,anon,authenticated;
grant execute on function public.rkbo_is_pack_admin() to anon,authenticated;

create table if not exists public.rkbo_pack_settings(
 season integer primary key check(season between 1 and 60),
 label text not null check(char_length(btrim(label)) between 2 and 70),
 image_url text not null,
 active boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table public.rkbo_pack_settings enable row level security;
revoke all on public.rkbo_pack_settings from public,anon,authenticated;
grant select on public.rkbo_pack_settings to anon,authenticated;
drop policy if exists rkbo_pack_settings_read on public.rkbo_pack_settings;
create policy rkbo_pack_settings_read on public.rkbo_pack_settings
 for select to anon,authenticated
 using(active or (select public.rkbo_is_pack_admin()));
insert into public.rkbo_pack_settings(season,label,image_url,active)
values(60,'60차 시즌 카드팩','https://raw.githubusercontent.com/p0emkite/RKBO-/main/pack.webp',true)
on conflict (season) do nothing;

-- Public images: write permission is restricted to the real account administrator.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('rkbo-pack-art','rkbo-pack-art',true,3145728,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
set public=true,file_size_limit=3145728,allowed_mime_types=array['image/png','image/jpeg','image/webp'];
drop policy if exists rkbo_pack_art_insert on storage.objects;
drop policy if exists rkbo_pack_art_update on storage.objects;
drop policy if exists rkbo_pack_art_delete on storage.objects;
create policy rkbo_pack_art_insert on storage.objects
 for insert to authenticated with check(bucket_id='rkbo-pack-art' and (select public.rkbo_is_pack_admin()));
create policy rkbo_pack_art_update on storage.objects
 for update to authenticated using(bucket_id='rkbo-pack-art' and (select public.rkbo_is_pack_admin()))
 with check(bucket_id='rkbo-pack-art' and (select public.rkbo_is_pack_admin()));
create policy rkbo_pack_art_delete on storage.objects
 for delete to authenticated using(bucket_id='rkbo-pack-art' and (select public.rkbo_is_pack_admin()));

alter table public.rkbo_card_inventory drop constraint if exists rkbo_card_inventory_quantity_check;
alter table public.rkbo_card_inventory add constraint rkbo_card_inventory_quantity_check check(quantity>=0);
alter table public.rkbo_card_inventory add column if not exists gold_border boolean not null default false;
alter table public.rkbo_card_inventory add column if not exists prism boolean not null default false;
create table if not exists public.rkbo_card_upgrades(
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 card_id text not null references public.rkbo_pack_cards(card_id),
 kind text not null check(kind in ('gold','prism')),
 spent integer not null check(spent in (5,10)),
 created_at timestamptz not null default now(),
 unique(user_id,card_id,kind)
);
alter table public.rkbo_card_upgrades enable row level security;
revoke all on public.rkbo_card_upgrades from public,anon,authenticated;
grant select on public.rkbo_card_upgrades to authenticated;
drop policy if exists rkbo_card_upgrades_owner_read on public.rkbo_card_upgrades;
create policy rkbo_card_upgrades_owner_read on public.rkbo_card_upgrades
 for select to authenticated using((select auth.uid())=user_id);

create or replace function public.rkbo_manage_pack(
 p_season integer,
 p_label text,
 p_image_url text,
 p_active boolean,
 p_cards jsonb default null
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_card jsonb;
 v_pos text;
 v_id text;
 v_grade text;
 v_count integer;
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'role','') <> 'authenticated'
    or not public.rkbo_is_pack_admin() then
  raise exception '제작자 계정만 팩을 관리할 수 있습니다' using errcode='42501';
 end if;
 if p_season is null or p_season not between 1 and 60 then
  raise exception '차수는 1~60 사이여야 합니다' using errcode='22023';
 end if;
 if length(btrim(coalesce(p_label,''))) not between 2 and 70 then
  raise exception '팩 이름은 2~70자로 지정해 주세요' using errcode='22023';
 end if;
 if length(coalesce(p_image_url,''))>700 or
  not (
   p_image_url like 'https://raw.githubusercontent.com/p0emkite/%' or
   p_image_url like 'https://stajnaagugudgsabntuq.supabase.co/storage/v1/object/public/rkbo-pack-art/%'
  ) then raise exception '허용된 팩 이미지 주소가 아닙니다' using errcode='22023';
 end if;
 if p_cards is not null then
  if jsonb_typeof(p_cards)<>'array' or jsonb_array_length(p_cards) not between 1 and 1000 then
   raise exception '공식 카드 목록은 1~1000개 배열이어야 합니다' using errcode='22023';
  end if;
  for v_card in select value from jsonb_array_elements(p_cards) loop
   v_id:=v_card->>'id';
   v_grade:=v_card->>'grade';
   v_pos:=v_card->>'pos';
   if v_id is null or left(v_id,length(p_season::text)+1)<>p_season::text||'-'
    or length(v_id)>120 or
    coalesce(v_grade,'') not in ('브론즈','실버','골드','코랄','다이아몬드') or
    length(coalesce(v_card->>'name','')) not between 1 and 100 or
    length(coalesce(v_card->>'team','')) not between 1 and 20 or
    length(coalesce(v_pos,'')) not between 1 and 12 or
    coalesce(v_card->>'type','') not in ('타자','투수') or
    (v_card->>'ovr') is null or
    (v_card->>'ovr') !~ '^[0-9]{1,2}$' or
    (v_card->>'ovr')::integer not between 1 and 99 then
     raise exception '차수/선수/등급 데이터가 올바르지 않습니다' using errcode='22023';
   end if;
   insert into public.rkbo_pack_cards(card_id,season,grade,name,team,position,card_type,ovr)
   values(v_id,p_season,v_grade,v_card->>'name',v_card->>'team',v_pos,v_card->>'type',(v_card->>'ovr')::integer)
   on conflict(card_id) do update set
    grade=excluded.grade,name=excluded.name,team=excluded.team,
    position=excluded.position,card_type=excluded.card_type,ovr=excluded.ovr;
  end loop;
 end if;
 if coalesce(p_active,false) then
  select count(distinct grade) into v_count from public.rkbo_pack_cards where season=p_season;
  if v_count<>5 then
   raise exception '브론즈~다이아몬드 5개 등급이 있는 시즌만 활성화할 수 있습니다' using errcode='22023';
  end if;
 end if;
 insert into public.rkbo_pack_settings(season,label,image_url,active,updated_at)
 values(p_season,btrim(p_label),p_image_url,coalesce(p_active,false),now())
 on conflict(season) do update set label=excluded.label,image_url=excluded.image_url,
   active=excluded.active,updated_at=now();
 return jsonb_build_object('season',p_season,'active',coalesce(p_active,false),'success',true);
end;
$$;
revoke all on function public.rkbo_manage_pack(integer,text,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.rkbo_manage_pack(integer,text,text,boolean,jsonb) to authenticated;

create or replace function public.rkbo_upgrade_card(p_card_id text,p_kind text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_user uuid:=auth.uid();
 v_inv public.rkbo_card_inventory%rowtype;
 v_cost integer;
begin
 if v_user is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
  or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
  raise exception '로그인이 필요합니다' using errcode='28000';
 end if;
 v_cost:=case p_kind when 'gold' then 5 when 'prism' then 10 else null end;
 if v_cost is null or p_card_id is null then
  raise exception '강화 종류 또는 선수 ID가 올바르지 않습니다' using errcode='22023';
 end if;
 select * into v_inv from public.rkbo_card_inventory
  where user_id=v_user and card_id=p_card_id for update;
 if not found then raise exception '해당 선수 카드를 보유하지 않습니다' using errcode='22023';end if;
 if (p_kind='gold' and v_inv.gold_border) or (p_kind='prism' and v_inv.prism) then
  raise exception '이미 적용된 강화입니다' using errcode='22023';
 end if;
 if v_inv.quantity<v_cost then
  raise exception '강화에 필요한 중복 카드가 부족합니다' using errcode='22023';
 end if;
 update public.rkbo_card_inventory
 set quantity=quantity-v_cost,
   gold_border=gold_border or p_kind='gold',
   prism=prism or p_kind='prism'
 where user_id=v_user and card_id=p_card_id;
 insert into public.rkbo_card_upgrades(user_id,card_id,kind,spent)
 values(v_user,p_card_id,p_kind,v_cost);
 return jsonb_build_object('cardId',p_card_id,'kind',p_kind,
 'quantity',v_inv.quantity-v_cost,
 'goldBorder',v_inv.gold_border or p_kind='gold',
 'prism',v_inv.prism or p_kind='prism');
end;
$$;
revoke all on function public.rkbo_upgrade_card(text,text) from public,anon,authenticated;
grant execute on function public.rkbo_upgrade_card(text,text) to authenticated;

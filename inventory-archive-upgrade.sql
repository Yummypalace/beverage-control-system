-- 产品停用 / 归档：保留全部历史记录，不再永久删除饮料资料。
alter table public.inventory_items
  add column if not exists is_active boolean not null default true,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text not null default '';

update public.inventory_items
set is_active=true
where is_active is null;

create or replace function public.set_inventory_item_archived(
  p_item uuid,
  p_archived boolean
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  i public.inventory_items%rowtype;
  email text := coalesce(auth.jwt()->>'email','');
begin
  if not public.is_app_active() then
    raise exception '此账号已停用';
  end if;
  if not public.is_app_admin() then
    raise exception '仅 Admin 可以停用或恢复饮料';
  end if;

  select * into i
  from public.inventory_items
  where id=p_item
  for update;

  if not found then
    raise exception '找不到饮料';
  end if;

  if p_archived then
    if coalesce(i.fridge_quantity,0) <> 0 or coalesce(i.warehouse_quantity,0) <> 0 then
      raise exception '当前仍有库存，请先把冰箱和仓库库存处理到 0';
    end if;

    update public.inventory_items
    set is_active=false,
        archived_at=now(),
        archived_by=email,
        updated_at=now()
    where id=i.id;
  else
    update public.inventory_items
    set is_active=true,
        archived_at=null,
        archived_by='',
        updated_at=now()
    where id=i.id;
  end if;

  return jsonb_build_object(
    'ok',true,
    'item_id',i.id,
    'archived',p_archived
  );
end;
$$;

grant execute on function public.set_inventory_item_archived(uuid,boolean) to authenticated;

-- 不再允许客户端永久删除 inventory_items，避免月结 / POS / ENT / 人工核对被级联删除。
drop policy if exists "admin can delete inventory" on public.inventory_items;

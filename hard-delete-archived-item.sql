-- 已停用饮料的永久删除能力。
-- 仅 Admin 可执行；只能删除已停用且当前库存为 0 的饮料。
-- 永久删除会清除该饮料的库存记录、提成、POS/月结、ENT、盘点资料。
-- 若不存在其他同名饮料，也会清理旧版 item_id 为空的同名孤立记录，避免日后重建同名产品时旧历史重新挂上。

create or replace function public.block_inventory_item_delete()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if current_setting('app.hard_delete_item', true)='on'
     and public.is_app_admin() then
    return old;
  end if;

  raise exception '饮料资料不可永久删除，请使用停用 / 归档';
end;
$$;

create or replace function public.block_locked_dated_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  old_month text;
  new_month text;
begin
  if current_setting('app.hard_delete_item', true)='on'
     and public.is_app_admin() then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if tg_op in ('UPDATE','DELETE') then
    old_month := to_char(old.operation_date,'YYYY-MM');
    if public.is_month_locked(old_month) then
      raise exception '% 已锁定，不能修改该月份记录', old_month;
    end if;
  end if;

  if tg_op in ('INSERT','UPDATE') then
    new_month := to_char(new.operation_date,'YYYY-MM');
    if public.is_month_locked(new_month) then
      raise exception '% 已锁定，不能新增或修改该月份记录', new_month;
    end if;
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.block_locked_month_key_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  old_month text;
  new_month text;
begin
  if current_setting('app.hard_delete_item', true)='on'
     and public.is_app_admin() then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if tg_op in ('UPDATE','DELETE') then
    old_month := old.month_key;
    if public.is_month_locked(old_month) then
      raise exception '% 已锁定，不能修改该月份月结资料', old_month;
    end if;
  end if;

  if tg_op in ('INSERT','UPDATE') then
    new_month := new.month_key;
    if public.is_month_locked(new_month) then
      raise exception '% 已锁定，不能新增或修改该月份月结资料', new_month;
    end if;
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.hard_delete_inventory_item(p_item uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  i public.inventory_items%rowtype;
  other_same_name integer := 0;
  c_inventory_logs integer := 0;
  c_inventory_logs_orphan integer := 0;
  c_commission_logs integer := 0;
  c_commission_logs_orphan integer := 0;
  c_pos integer := 0;
  c_ent integer := 0;
  c_review integer := 0;
  c_stocktake integer := 0;
begin
  if not public.is_app_active() then
    raise exception '此账号已停用';
  end if;
  if not public.is_app_admin() then
    raise exception '仅 Admin 可以永久删除饮料';
  end if;

  select * into i
  from public.inventory_items
  where id=p_item
  for update;

  if not found then
    raise exception '找不到饮料';
  end if;

  if i.is_active is distinct from false then
    raise exception '只能从“已停用饮料”永久删除，请先停用这项饮料';
  end if;

  if coalesce(i.fridge_quantity,0)<>0
     or coalesce(i.warehouse_quantity,0)<>0 then
    raise exception '当前仍有库存，不能永久删除';
  end if;

  select count(*) into other_same_name
  from public.inventory_items
  where id<>i.id and name=i.name;

  perform set_config('app.hard_delete_item','on',true);

  delete from public.monthly_reconciliation_review where item_id=i.id;
  get diagnostics c_review = row_count;

  delete from public.monthly_ent_actual where item_id=i.id;
  get diagnostics c_ent = row_count;

  delete from public.monthly_pos_sales where item_id=i.id;
  get diagnostics c_pos = row_count;

  delete from public.monthly_stocktake_records where item_id=i.id;
  get diagnostics c_stocktake = row_count;

  delete from public.commission_logs where item_id=i.id;
  get diagnostics c_commission_logs = row_count;

  delete from public.inventory_logs where item_id=i.id;
  get diagnostics c_inventory_logs = row_count;

  if other_same_name=0 then
    delete from public.commission_logs
    where item_id is null and item_name=i.name;
    get diagnostics c_commission_logs_orphan = row_count;

    delete from public.inventory_logs
    where item_id is null and item_name=i.name;
    get diagnostics c_inventory_logs_orphan = row_count;
  end if;

  delete from public.inventory_items where id=i.id;

  return jsonb_build_object(
    'ok',true,
    'item_id',i.id,
    'name',i.name,
    'deleted',jsonb_build_object(
      'inventory_logs',c_inventory_logs,
      'inventory_logs_orphan',c_inventory_logs_orphan,
      'commission_logs',c_commission_logs,
      'commission_logs_orphan',c_commission_logs_orphan,
      'monthly_pos_sales',c_pos,
      'monthly_ent_actual',c_ent,
      'monthly_reconciliation_review',c_review,
      'monthly_stocktake_records',c_stocktake
    )
  );
end;
$$;

revoke execute on function public.hard_delete_inventory_item(uuid) from anon;
revoke execute on function public.hard_delete_inventory_item(uuid) from public;
grant execute on function public.hard_delete_inventory_item(uuid) to authenticated;

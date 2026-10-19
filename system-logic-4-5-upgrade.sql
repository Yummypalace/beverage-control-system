-- 系统逻辑强化 4 + 5
-- 4) 编辑饮料资料不允许改变库存数量。
-- 5) 月结完成后可锁定月份；只有 Admin 可重新开启。

-- ===== 4. 编辑资料不影响库存 =====
create or replace function public.save_inventory_item_atomic(
  p_item uuid,
  p_name text,
  p_category text,
  p_spec text,
  p_unit text,
  p_fridge_quantity numeric,
  p_warehouse_quantity numeric,
  p_min_quantity numeric,
  p_cost_price numeric,
  p_commission_per_unit numeric,
  p_operation_date date
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  i public.inventory_items%rowtype;
  email text := coalesce(auth.jwt()->>'email','');
  is_edit boolean := p_item is not null;
begin
  if not public.is_app_active() then raise exception '此账号已停用'; end if;
  if p_operation_date is null then raise exception '请选择日期'; end if;
  if coalesce(trim(p_name),'')='' then raise exception '请输入名称'; end if;
  if coalesce(p_min_quantity,0) < 0 then raise exception '最低库存不能小于 0'; end if;
  if coalesce(p_cost_price,0) < 0 then raise exception '成本价不能小于 0'; end if;
  if coalesce(p_commission_per_unit,0) < 0 then raise exception '提成不能小于 0'; end if;

  if is_edit then
    select * into i
    from public.inventory_items
    where id=p_item
    for update;

    if not found then raise exception '找不到饮料'; end if;

    -- 编辑资料只改名称 / 类别 / 规格 / 单位 / 最低库存 / 成本 / 提成。
    -- 冰箱、仓库、总库存完全保留，不接受编辑页面传入的库存数量。
    update public.inventory_items
    set name=trim(p_name),
        category=coalesce(nullif(trim(p_category),''),'其他'),
        spec=coalesce(p_spec,''),
        unit=coalesce(nullif(trim(p_unit),''),'瓶'),
        min_quantity=coalesce(p_min_quantity,0),
        cost_price=coalesce(p_cost_price,0),
        commission_per_unit=coalesce(p_commission_per_unit,0),
        updated_at=now()
    where id=p_item
    returning * into i;

    insert into public.inventory_logs(
      item_id,item_name,action,quantity,note,user_email,operation_date
    ) values (
      i.id,i.name,'EDIT',coalesce(i.fridge_quantity,0)+coalesce(i.warehouse_quantity,0),
      '编辑资料｜不影响库存',
      email,p_operation_date
    );
  else
    if p_fridge_quantity is null or p_fridge_quantity < 0 then raise exception '冰箱库存不能小于 0'; end if;
    if p_warehouse_quantity is null or p_warehouse_quantity < 0 then raise exception '仓库库存不能小于 0'; end if;

    insert into public.inventory_items(
      name,category,spec,unit,fridge_quantity,warehouse_quantity,quantity,
      min_quantity,cost_price,commission_per_unit,updated_at
    ) values (
      trim(p_name),
      coalesce(nullif(trim(p_category),''),'其他'),
      coalesce(p_spec,''),
      coalesce(nullif(trim(p_unit),''),'瓶'),
      p_fridge_quantity,p_warehouse_quantity,p_fridge_quantity+p_warehouse_quantity,
      coalesce(p_min_quantity,0),coalesce(p_cost_price,0),coalesce(p_commission_per_unit,0),now()
    )
    returning * into i;

    insert into public.inventory_logs(
      item_id,item_name,action,quantity,note,user_email,operation_date
    ) values (
      i.id,i.name,'CREATE',p_fridge_quantity+p_warehouse_quantity,
      '新增饮料（冰箱 '||p_fridge_quantity||' / 仓库 '||p_warehouse_quantity||'）',
      email,p_operation_date
    );
  end if;

  return jsonb_build_object(
    'ok',true,
    'item_id',i.id,
    'name',i.name,
    'fridge_quantity',i.fridge_quantity,
    'warehouse_quantity',i.warehouse_quantity,
    'total',coalesce(i.fridge_quantity,0)+coalesce(i.warehouse_quantity,0),
    'action',case when is_edit then 'EDIT' else 'CREATE' end
  );
end;
$$;

grant execute on function public.save_inventory_item_atomic(
  uuid,text,text,text,text,numeric,numeric,numeric,numeric,numeric,date
) to authenticated;

-- ===== 5. 月结锁定 =====
create table if not exists public.monthly_period_locks (
  month_key text primary key,
  is_locked boolean not null default true,
  locked_at timestamptz,
  locked_by text not null default '',
  unlocked_at timestamptz,
  unlocked_by text not null default '',
  updated_at timestamptz not null default now(),
  constraint monthly_period_locks_month_key_check check (month_key ~ '^[0-9]{4}-[0-9]{2}$')
);

alter table public.monthly_period_locks enable row level security;

drop policy if exists monthly_period_locks_select on public.monthly_period_locks;
create policy monthly_period_locks_select
on public.monthly_period_locks
for select to authenticated
using (public.is_app_active());

drop policy if exists monthly_period_locks_insert on public.monthly_period_locks;
create policy monthly_period_locks_insert
on public.monthly_period_locks
for insert to authenticated
with check (public.is_app_admin());

drop policy if exists monthly_period_locks_update on public.monthly_period_locks;
create policy monthly_period_locks_update
on public.monthly_period_locks
for update to authenticated
using (public.is_app_admin())
with check (public.is_app_admin());

drop policy if exists monthly_period_locks_delete on public.monthly_period_locks;
create policy monthly_period_locks_delete
on public.monthly_period_locks
for delete to authenticated
using (public.is_app_admin());

grant select,insert,update,delete on public.monthly_period_locks to authenticated;

create or replace function public.is_month_locked(p_month text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.monthly_period_locks
    where month_key=p_month and is_locked=true
  );
$$;

grant execute on function public.is_month_locked(text) to authenticated;

create or replace function public.set_month_lock(
  p_month text,
  p_locked boolean
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  email text := coalesce(auth.jwt()->>'email','');
  current_month text := to_char(timezone('Asia/Singapore',now()),'YYYY-MM');
  result_row public.monthly_period_locks%rowtype;
begin
  if not public.is_app_active() then
    raise exception '此账号已停用';
  end if;
  if not public.is_app_admin() then
    raise exception '仅 Admin 可以锁定或重新开启月份';
  end if;
  if p_month is null or p_month !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception '月份格式不正确';
  end if;
  if p_locked and p_month >= current_month then
    raise exception '本月尚未结束，不能锁定';
  end if;

  insert into public.monthly_period_locks(
    month_key,is_locked,locked_at,locked_by,unlocked_at,unlocked_by,updated_at
  ) values (
    p_month,
    p_locked,
    case when p_locked then now() else null end,
    case when p_locked then email else '' end,
    case when not p_locked then now() else null end,
    case when not p_locked then email else '' end,
    now()
  )
  on conflict (month_key) do update
  set is_locked=excluded.is_locked,
      locked_at=case when excluded.is_locked then now() else monthly_period_locks.locked_at end,
      locked_by=case when excluded.is_locked then email else monthly_period_locks.locked_by end,
      unlocked_at=case when excluded.is_locked then null else now() end,
      unlocked_by=case when excluded.is_locked then '' else email end,
      updated_at=now()
  returning * into result_row;

  return jsonb_build_object(
    'ok',true,
    'month_key',result_row.month_key,
    'is_locked',result_row.is_locked,
    'locked_at',result_row.locked_at,
    'locked_by',result_row.locked_by,
    'unlocked_at',result_row.unlocked_at,
    'unlocked_by',result_row.unlocked_by
  );
end;
$$;

grant execute on function public.set_month_lock(text,boolean) to authenticated;

-- 锁定后，任何属于该月份的库存 / 提成记录都不能新增、修改或撤销。
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

drop trigger if exists trg_inventory_logs_month_lock on public.inventory_logs;
create trigger trg_inventory_logs_month_lock
before insert or update or delete on public.inventory_logs
for each row execute function public.block_locked_dated_change();

drop trigger if exists trg_commission_logs_month_lock on public.commission_logs;
create trigger trg_commission_logs_month_lock
before insert or update or delete on public.commission_logs
for each row execute function public.block_locked_dated_change();

-- POS、ENT、人工核对、盘点月末记录都跟 month_key 一起锁。
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

drop trigger if exists trg_monthly_pos_sales_month_lock on public.monthly_pos_sales;
create trigger trg_monthly_pos_sales_month_lock
before insert or update or delete on public.monthly_pos_sales
for each row execute function public.block_locked_month_key_change();

drop trigger if exists trg_monthly_ent_actual_month_lock on public.monthly_ent_actual;
create trigger trg_monthly_ent_actual_month_lock
before insert or update or delete on public.monthly_ent_actual
for each row execute function public.block_locked_month_key_change();

drop trigger if exists trg_monthly_reconciliation_review_month_lock on public.monthly_reconciliation_review;
create trigger trg_monthly_reconciliation_review_month_lock
before insert or update or delete on public.monthly_reconciliation_review
for each row execute function public.block_locked_month_key_change();

drop trigger if exists trg_monthly_stocktake_records_month_lock on public.monthly_stocktake_records;
create trigger trg_monthly_stocktake_records_month_lock
before insert or update or delete on public.monthly_stocktake_records
for each row execute function public.block_locked_month_key_change();

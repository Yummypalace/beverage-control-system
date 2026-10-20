-- 系统历史日期边界：2026-09-01 起才允许新增/修改/撤销记录。
-- 2026-09 及以后仍继续受月结锁定控制。

create or replace function public.block_locked_dated_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  old_month text;
  new_month text;
  minimum_date constant date := date '2026-09-01';
begin
  if current_setting('app.hard_delete_item', true)='on'
     and public.is_app_admin() then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if tg_op in ('UPDATE','DELETE') then
    if old.operation_date < minimum_date then
      raise exception '系统只允许操作 2026年9月1日及以后的日期';
    end if;
    old_month := to_char(old.operation_date,'YYYY-MM');
    if public.is_month_locked(old_month) then
      raise exception '% 已锁定，不能修改该月份记录', old_month;
    end if;
  end if;

  if tg_op in ('INSERT','UPDATE') then
    if new.operation_date < minimum_date then
      raise exception '系统只允许填写 2026年9月1日及以后的日期';
    end if;
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
  minimum_month constant text := '2026-09';
begin
  if current_setting('app.hard_delete_item', true)='on'
     and public.is_app_admin() then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if tg_op in ('UPDATE','DELETE') then
    old_month := old.month_key;
    if old_month < minimum_month then
      raise exception '系统只允许操作 2026年9月及以后的月份';
    end if;
    if public.is_month_locked(old_month) then
      raise exception '% 已锁定，不能修改该月份月结资料', old_month;
    end if;
  end if;

  if tg_op in ('INSERT','UPDATE') then
    new_month := new.month_key;
    if new_month < minimum_month then
      raise exception '系统只允许填写 2026年9月及以后的月份';
    end if;
    if public.is_month_locked(new_month) then
      raise exception '% 已锁定，不能新增或修改该月份月结资料', new_month;
    end if;
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

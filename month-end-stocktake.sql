-- 月底盘点调整
-- 一次性更新冰箱与仓库实际库存，并以 ADJUST 记录保留调整前/后的数量。
create or replace function public.apply_month_end_stocktake(
  p_item uuid,
  p_operation_date date,
  p_fridge_actual numeric,
  p_warehouse_actual numeric,
  p_note text default '月底盘点调整'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  i public.inventory_items%rowtype;
  old_f numeric;
  old_w numeric;
  new_f numeric;
  new_w numeric;
  email text := coalesce(auth.jwt()->>'email','');
  note_text text := coalesce(nullif(trim(p_note),''),'月底盘点调整');
  changed_count integer := 0;
begin
  if not public.is_app_active() then raise exception '此账号已停用'; end if;
  if p_item is null then raise exception '请选择饮料'; end if;
  if p_operation_date is null then raise exception '请选择盘点日期'; end if;
  if to_char(p_operation_date,'YYYY-MM') <> to_char(current_date,'YYYY-MM') then
    raise exception '盘点调整日期必须是当前月份';
  end if;
  if p_fridge_actual is null or p_fridge_actual < 0 then raise exception '冰箱实际库存不能小于 0'; end if;
  if p_warehouse_actual is null or p_warehouse_actual < 0 then raise exception '仓库实际库存不能小于 0'; end if;

  select * into i from public.inventory_items where id=p_item for update;
  if not found then raise exception '找不到饮料'; end if;

  old_f := coalesce(i.fridge_quantity,0);
  old_w := coalesce(i.warehouse_quantity,0);
  new_f := p_fridge_actual;
  new_w := p_warehouse_actual;

  update public.inventory_items
  set fridge_quantity=new_f,
      warehouse_quantity=new_w,
      quantity=new_f+new_w,
      updated_at=now()
  where id=i.id;

  if old_f is distinct from new_f then
    insert into public.inventory_logs(item_id,item_name,action,quantity,note,user_email,operation_date,out_type)
    values(
      i.id,i.name,'ADJUST',new_f,
      '冰箱｜盘点调整｜调整前 '||old_f||'｜调整后 '||new_f||'｜'||note_text,
      email,p_operation_date,null
    );
    changed_count := changed_count + 1;
  end if;

  if old_w is distinct from new_w then
    insert into public.inventory_logs(item_id,item_name,action,quantity,note,user_email,operation_date,out_type)
    values(
      i.id,i.name,'ADJUST',new_w,
      '仓库｜盘点调整｜调整前 '||old_w||'｜调整后 '||new_w||'｜'||note_text,
      email,p_operation_date,null
    );
    changed_count := changed_count + 1;
  end if;

  return jsonb_build_object(
    'ok',true,
    'item_id',i.id,
    'fridge_before',old_f,
    'fridge_after',new_f,
    'warehouse_before',old_w,
    'warehouse_after',new_w,
    'total_before',old_f+old_w,
    'total_after',new_f+new_w,
    'changed_locations',changed_count
  );
end;
$function$;

grant execute on function public.apply_month_end_stocktake(uuid,date,numeric,numeric,text) to authenticated;

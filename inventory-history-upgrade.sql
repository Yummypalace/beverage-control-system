-- 把能唯一按名称对应到现有饮料的旧版 inventory_logs 补回 item_id。
-- 无法唯一对应的旧记录保留原样；前端历史引擎仍会在安全范围内按名称兼容。
with unique_items as (
  select name,(array_agg(id))[1] as item_id,count(*) as c
  from public.inventory_items
  group by name
)
update public.inventory_logs l
set item_id=u.item_id
from unique_items u
where l.item_id is null
  and u.c=1
  and l.item_name=u.name;

with rates as materialized (
 select s as season,p as points,rkbo_private.combo_rates(p,s) as odds from generate_series(1,60)s cross join generate_series(3,150)p
), totals as (
 select season,points,sum(value::numeric) as total,min(value::numeric) as minimum from rates cross join lateral jsonb_each_text(odds) group by season,points
), tails as (
 select season,points,g.ord,sum((odds->>x.grade)::numeric) as tail
 from rates cross join unnest(array['브론즈','실버','골드','코랄','다이아몬드','특수']) with ordinality g(grade,ord)
 cross join unnest(array['브론즈','실버','골드','코랄','다이아몬드','특수']) with ordinality x(grade,ord)
 where x.ord>=g.ord group by season,points,g.ord
), deltas as (
 select *,tail-lag(tail) over(partition by season,ord order by points) as improvement from tails
)
select jsonb_build_object(
'distributions',(select count(*) from totals),
'invalid_totals',(select count(*) from totals where total<>100 or minimum<0),
'cdf_inversions',(select count(*) from deltas where improvement < -0.000003),
'coral5_s60',rkbo_private.combo_rates(75,60),
'coral5_s59',rkbo_private.combo_rates(75,59),
'coral5_s1',rkbo_private.combo_rates(75,1),
'homogeneous_s60',(select jsonb_agg(jsonb_build_object('points',p,'odds',rkbo_private.combo_rates(p,60)) order by p) from unnest(array[3,4,5,9,12,15,21,28,35,45,60,75,90,120,150])p)
) as probability_checks;

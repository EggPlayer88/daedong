-- 학교 관리자에게 새 명부·편성·명시적 계정 연결을 제공한다. 기존 로그인 계정과 역할은 생성·수정하지 않는다.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM teacher_roster.installs WHERE batch='TR1-01') OR EXISTS(SELECT 1 FROM teacher_roster.installs WHERE batch='TR1-02') THEN RAISE EXCEPTION 'TR1 installation order';END IF;
END $$;
CREATE FUNCTION teacher_roster.txt(v jsonb,n integer) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT COALESCE(jsonb_typeof(v)='string' AND length(v#>>'{}') BETWEEN 1 AND n AND (v#>>'{}')=btrim(v#>>'{}',E' \t\n\r\u000b\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff') AND (v#>>'{}')!~E'[\\x01-\\x1f\\x7f\\u0080-\\u009f]',false)
$$;
CREATE FUNCTION teacher_roster.id(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT COALESCE(jsonb_typeof(v)='string' AND (v#>>'{}')~'^[A-Za-z0-9_-]{1,80}$',false) $$;
CREATE FUNCTION teacher_roster.num(v jsonb,lo integer,hi integer) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT COALESCE(jsonb_typeof(v)='number' AND (v#>>'{}')~'^[0-9]+$' AND (v#>>'{}')::numeric BETWEEN lo AND hi,false) $$;
CREATE FUNCTION teacher_roster.day(v jsonb) RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE d date; BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR (v#>>'{}')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 d:=(v#>>'{}')::date;IF to_char(d,'YYYY-MM-DD')<>v#>>'{}' OR d<'2020-01-01' OR d>'2100-12-31' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;RETURN d;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'INVALID_INPUT';END $$;
CREATE FUNCTION teacher_roster.validate_plan(p jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE k text;r jsonb;seen text[];lim integer; BEGIN
 IF NOT workhub_private.p1_exact(p,ARRAY['id','termId','title','from','until','teachers','classes','courses','slots','lessons','homerooms'])
 OR NOT teacher_roster.id(p->'id') OR NOT teacher_roster.id(p->'termId') OR NOT teacher_roster.txt(p->'title',120) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF teacher_roster.day(p->'from')>=teacher_roster.day(p->'until') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 FOREACH k IN ARRAY ARRAY['teachers','classes','courses','slots','lessons','homerooms'] LOOP
 lim:=CASE k WHEN 'teachers' THEN 300 WHEN 'classes' THEN 200 WHEN 'courses' THEN 4000 WHEN 'slots' THEN 140 WHEN 'lessons' THEN 12000 ELSE 200 END;
 IF jsonb_typeof(p->k) IS DISTINCT FROM 'array' OR jsonb_array_length(p->k)>lim THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF k<>'homerooms' THEN
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->k) x WHERE NOT teacher_roster.id(x->'id')) OR
 (SELECT count(*) FROM jsonb_array_elements(p->k))<>(SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p->k) x) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;END IF;
 END LOOP;
 FOR r IN SELECT value FROM jsonb_array_elements(p->'teachers') LOOP
 IF NOT workhub_private.p1_exact(r,ARRAY['id','name','kind']) OR NOT teacher_roster.txt(r->'name',100) OR r->>'kind' NOT IN('person','vacancy') OR jsonb_typeof(r->'kind') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 END LOOP;
 FOR r IN SELECT value FROM jsonb_array_elements(p->'classes') LOOP
 IF NOT workhub_private.p1_exact(r,ARRAY['id','grade','number','name','officialId']) OR NOT teacher_roster.txt(r->'name',30)
 OR NOT teacher_roster.num(r->'grade',1,20) OR NOT teacher_roster.num(r->'number',1,99) OR NOT(r->'officialId'='null' OR teacher_roster.id(r->'officialId')) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'classes') x GROUP BY x->>'grade',x->>'number' HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'classes') x WHERE x->'officialId'<>'null' GROUP BY x->>'officialId' HAVING count(*)>1) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p->'courses') LOOP
 IF NOT workhub_private.p1_exact(r,ARRAY['id','name','subject','teacherId','classId','weeklyHours']) OR NOT teacher_roster.txt(r->'name',120) OR NOT teacher_roster.txt(r->'subject',50)
 OR NOT teacher_roster.num(r->'weeklyHours',1,140) OR NOT teacher_roster.id(r->'teacherId') OR NOT teacher_roster.id(r->'classId') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'teachers') x WHERE x->>'id'=r->>'teacherId')
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'classes') x WHERE x->>'id'=r->>'classId') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 END LOOP;
 FOR r IN SELECT value FROM jsonb_array_elements(p->'slots') LOOP
 IF NOT workhub_private.p1_exact(r,ARRAY['id','day','period','start','end']) OR NOT teacher_roster.num(r->'day',1,7) OR NOT teacher_roster.num(r->'period',1,20)
 OR NOT teacher_roster.num(r->'start',0,1439) OR NOT teacher_roster.num(r->'end',1,1440) OR (r->>'start')::integer>=(r->>'end')::integer THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'slots') x GROUP BY x->>'day',x->>'period' HAVING count(*)>1) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p->'lessons') LOOP
 IF NOT workhub_private.p1_exact(r,ARRAY['id','courseId','slotId']) OR NOT teacher_roster.id(r->'courseId') OR NOT teacher_roster.id(r->'slotId') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'courses') x WHERE x->>'id'=r->>'courseId')
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'slots') x WHERE x->>'id'=r->>'slotId') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 END LOOP;
 FOR r IN SELECT value FROM jsonb_array_elements(p->'homerooms') LOOP
 IF NOT workhub_private.p1_exact(r,ARRAY['classId','teacherId']) OR NOT teacher_roster.id(r->'classId') OR NOT teacher_roster.id(r->'teacherId') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'teachers') x WHERE x->>'id'=r->>'teacherId')
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'classes') x WHERE x->>'id'=r->>'classId') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'homerooms') x GROUP BY x->>'classId' HAVING count(*)>1) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
END $$;
CREATE FUNCTION teacher_roster.findings(p jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE out jsonb:='[]';r record; BEGIN
 IF jsonb_array_length(p->'teachers')=0 OR jsonb_array_length(p->'classes')=0 OR jsonb_array_length(p->'courses')=0 OR jsonb_array_length(p->'lessons')=0 THEN
 out:=out||jsonb_build_array(jsonb_build_object('code','EMPTY','message','교사·학급·수업과 교시 배치를 채워 주세요.','ids','[]'::jsonb));END IF;
 FOR r IN SELECT c->>'id' id,c->>'name' name FROM jsonb_array_elements(p->'courses') c
 WHERE (SELECT count(*) FROM jsonb_array_elements(p->'lessons') l WHERE l->>'courseId'=c->>'id')<>(c->>'weeklyHours')::integer LOOP
 out:=out||jsonb_build_array(jsonb_build_object('code','HOURS','message',r.name||'의 주당 시수와 배치 수가 다릅니다.','ids',jsonb_build_array(r.id)));END LOOP;
 FOR r IN WITH expanded AS (
 SELECT l->>'id' id,c->>'teacherId' teacher_id,c->>'classId' class_id,(s->>'day')::integer weekday,(s->>'start')::integer a,(s->>'end')::integer b
 FROM jsonb_array_elements(p->'lessons') l JOIN jsonb_array_elements(p->'courses') c ON c->>'id'=l->>'courseId' JOIN jsonb_array_elements(p->'slots') s ON s->>'id'=l->>'slotId')
 SELECT a.id,b.id other FROM expanded a JOIN expanded b ON a.id<b.id AND a.weekday=b.weekday AND a.a<b.b AND b.a<a.b AND(a.teacher_id=b.teacher_id OR a.class_id=b.class_id) LOOP
 out:=out||jsonb_build_array(jsonb_build_object('code','OVERLAP','message','같은 시간에 교사 또는 학급 수업이 겹칩니다.','ids',jsonb_build_array(r.id,r.other)));
 IF jsonb_array_length(out)>=12000 THEN EXIT;END IF;
 END LOOP;RETURN out;
END $$;
CREATE FUNCTION teacher_roster.grid(p jsonb) RETURNS TABLE(lesson_id text,teacher_id text,class_id text,weekday integer,starts integer,ends integer) LANGUAGE sql SET search_path='' AS $$
 SELECT l->>'id',c->>'teacherId',c->>'classId',(s->>'day')::integer,(s->>'start')::integer,(s->>'end')::integer
 FROM jsonb_array_elements(p->'lessons') l JOIN jsonb_array_elements(p->'courses') c ON c->>'id'=l->>'courseId' JOIN jsonb_array_elements(p->'slots') s ON s->>'id'=l->>'slotId'
$$;
CREATE FUNCTION teacher_roster.actor(mid text,writing boolean) RETURNS workhub_private.actor_context LANGUAGE plpgsql SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;BEGIN
 ctx:=workhub_private.member_actor(mid,writing);
 IF writing THEN PERFORM workhub_private.lock_member_roles(ctx);END IF;
 IF NOT workhub_private.member_has_perm(ctx,'year.manage') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 RETURN ctx;
END $$;
CREATE FUNCTION teacher_roster.envelope(ctx workhub_private.actor_context,data jsonb) RETURNS jsonb LANGUAGE sql SET search_path='' AS $$
 SELECT jsonb_build_object('contract','teacher-roster.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id,'data',data)
$$;
CREATE FUNCTION teacher_roster.snapshot(ctx workhub_private.actor_context) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE result jsonb; BEGIN
 SELECT jsonb_build_object('revision',COALESCE((SELECT revision FROM teacher_roster.schools WHERE school_id=ctx.school_id),0),
 'terms',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',y.school_year||' · '||t.label,'from',t.starts_on,'until',t.ends_on) ORDER BY t.starts_on DESC)
 FROM workhub.terms t JOIN workhub.academic_years y ON y.id=t.academic_year_id WHERE t.school_id=ctx.school_id AND t.state<>'closed'),'[]'),
 'teachers',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind) ORDER BY name,id) FROM teacher_roster.teachers WHERE school_id=ctx.school_id),'[]'),
 'members',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'name',a.display_name,'from',m.valid_from,'until',m.valid_to) ORDER BY a.display_name,m.id)
 FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id WHERE m.school_id=ctx.school_id AND workhub_private.p9_teacher_assignable(ctx.school_id,m.id)),'[]'),
 'classes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'officialId',c.id,'yearId',c.academic_year_id,'grade',c.grade,'number',c.class_no,'name',c.name) ORDER BY c.academic_year_id,c.grade,c.class_no,c.id)
 FROM workhub.year_classes c WHERE c.school_id=ctx.school_id AND c.removed_at IS NULL AND c.class_no IS NOT NULL),'[]'),
 'plans',COALESCE((SELECT jsonb_agg(jsonb_build_object('version',version,'state',state,'plan',body) ORDER BY updated_at DESC,id) FROM teacher_roster.plans WHERE school_id=ctx.school_id),'[]'),
 'links',COALESCE((SELECT jsonb_agg(jsonb_build_object('teacherId',teacher_id,'memberId',member_id,'from',from_date,'until',until_date) ORDER BY teacher_id,from_date) FROM teacher_roster.links WHERE school_id=ctx.school_id),'[]')) INTO result;
 IF jsonb_array_length(result->'teachers')>300 OR jsonb_array_length(result->'members')>300 OR jsonb_array_length(result->'plans')>100 OR jsonb_array_length(result->'terms')>200 OR jsonb_array_length(result->'classes')>2000 OR jsonb_array_length(result->'links')>3000 THEN RAISE EXCEPTION 'CONFLICT';END IF;
 RETURN result;
END $$;
CREATE FUNCTION teacher_roster.evaluate(ctx workhub_private.actor_context,i jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p jsonb;row teacher_roster.plans;t workhub.terms;m workhub.memberships;f jsonb:='[]';k text;i_from date;i_until date;teacher_row teacher_roster.teachers;
BEGIN
 IF NOT teacher_roster.num(i->'expectedRevision',0,2147483646) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF COALESCE((SELECT revision FROM teacher_roster.schools WHERE school_id=ctx.school_id),0)<>(i->>'expectedRevision')::integer THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF NOT EXISTS(SELECT 1 FROM workhub.school_admin_activations WHERE school_id=ctx.school_id AND state='active') OR EXISTS(SELECT 1 FROM teacher_roster.schools WHERE school_id=ctx.school_id AND NOT enabled) THEN RAISE EXCEPTION 'NOT_READY';END IF;
 k:=i->>'kind';
 IF k='save' THEN
 IF NOT workhub_private.p1_exact(i,ARRAY['kind','expectedRevision','plan']) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;p:=i->'plan';PERFORM teacher_roster.validate_plan(p);
 SELECT * INTO row FROM teacher_roster.plans WHERE school_id=ctx.school_id AND id=p->>'id';
 IF row.state='published' OR row.id IS NOT NULL AND row.term_id<>p->>'termId' THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'teachers') x JOIN teacher_roster.teachers r ON r.school_id=ctx.school_id AND r.id=x->>'id' WHERE (r.name,r.kind) IS DISTINCT FROM (x->>'name',x->>'kind')) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 ELSIF k='publish' THEN
 IF NOT workhub_private.p1_exact(i,ARRAY['kind','expectedRevision','planId','version']) OR NOT teacher_roster.id(i->'planId') OR NOT teacher_roster.num(i->'version',1,2147483646) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 SELECT * INTO row FROM teacher_roster.plans WHERE school_id=ctx.school_id AND id=i->>'planId';
 IF row.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF row.state<>'draft' OR row.version<>(i->>'version')::integer THEN RAISE EXCEPTION 'CONFLICT';END IF;
 p:=row.body;PERFORM teacher_roster.validate_plan(p);f:=teacher_roster.findings(p);
 IF (p->>'from')::date<ctx.school_today THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF EXISTS(SELECT 1 FROM teacher_roster.plans x WHERE x.school_id=ctx.school_id AND x.state='published' AND daterange((x.body->>'from')::date,(x.body->>'until')::date,'[)')&&daterange((p->>'from')::date,(p->>'until')::date,'[)')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(x.body->'classes') a JOIN jsonb_array_elements(p->'classes') b ON(a->>'grade',a->>'number')=(b->>'grade',b->>'number'))) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF EXISTS(SELECT 1 FROM teacher_roster.plans x CROSS JOIN LATERAL teacher_roster.grid(x.body) a JOIN teacher_roster.grid(p) b ON a.teacher_id=b.teacher_id AND a.weekday=b.weekday AND a.starts<b.ends AND b.starts<a.ends
 WHERE x.school_id=ctx.school_id AND x.state='published' AND daterange((x.body->>'from')::date,(x.body->>'until')::date,'[)')&&daterange((p->>'from')::date,(p->>'until')::date,'[)')) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 ELSE
 IF k IS DISTINCT FROM 'link' OR NOT workhub_private.p1_exact(i,ARRAY['kind','expectedRevision','teacherId','memberId','from','until']) OR NOT teacher_roster.id(i->'teacherId') OR NOT teacher_roster.id(i->'memberId') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF NOT workhub_private.member_has_perm(ctx,'membership.approve') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 i_from:=teacher_roster.day(i->'from');i_until:=teacher_roster.day(i->'until');IF i_from<ctx.school_today OR i_until<=i_from THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 SELECT * INTO teacher_row FROM teacher_roster.teachers WHERE school_id=ctx.school_id AND id=i->>'teacherId';
 IF teacher_row.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT * INTO m FROM workhub.memberships WHERE school_id=ctx.school_id AND id=i->>'memberId' FOR SHARE;
 IF NOT workhub_private.p9_teacher_assignable(ctx.school_id,m.id) OR m.id IS NULL OR i_from<m.valid_from OR m.valid_to IS NOT NULL AND i_until>m.valid_to THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF EXISTS(SELECT 1 FROM teacher_roster.links WHERE school_id=ctx.school_id AND(teacher_id=teacher_row.id OR member_id=m.id) AND daterange(from_date,until_date,'[)')&&daterange(i_from,i_until,'[)')) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 RETURN jsonb_build_object('findings',f,'summary',jsonb_build_object('teachers',1,
 'lessons',(SELECT count(*) FROM teacher_roster.plans rp CROSS JOIN LATERAL jsonb_array_elements(rp.body->'lessons') le JOIN LATERAL jsonb_array_elements(rp.body->'courses') co ON co->>'id'=le->>'courseId' WHERE rp.school_id=ctx.school_id AND rp.state='published' AND co->>'teacherId'=teacher_row.id AND daterange((rp.body->>'from')::date,(rp.body->>'until')::date,'[)')&&daterange(i_from,i_until,'[)')),
 'courses',(SELECT count(*) FROM teacher_roster.course_maps cm JOIN workhub.courses co ON co.id=cm.course_id AND co.school_id=cm.school_id WHERE cm.school_id=ctx.school_id AND cm.teacher_id=teacher_row.id AND daterange(co.valid_from,co.valid_to,'[)')&&daterange(i_from,i_until,'[)')),
 'homerooms',(SELECT count(*) FROM teacher_roster.plans rp CROSS JOIN LATERAL jsonb_array_elements(rp.body->'homerooms') hr WHERE rp.school_id=ctx.school_id AND rp.state='published' AND hr->>'teacherId'=teacher_row.id AND daterange((rp.body->>'from')::date,(rp.body->>'until')::date,'[)')&&daterange(i_from,i_until,'[)'))));
 END IF;
 SELECT * INTO t FROM workhub.terms WHERE school_id=ctx.school_id AND id=p->>'termId' FOR SHARE;
 IF t.id IS NULL OR t.state='closed' OR (p->>'from')::date<t.starts_on OR (p->>'until')::date>t.ends_on THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'classes') c WHERE c->'officialId'<>'null' AND NOT EXISTS(SELECT 1 FROM workhub.year_classes y WHERE y.school_id=ctx.school_id AND y.academic_year_id=t.academic_year_id AND y.id=c->>'officialId' AND y.removed_at IS NULL AND y.grade=(c->>'grade')::integer AND y.class_no=(c->>'number')::integer)) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF k='publish' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p->'classes') c JOIN workhub.year_classes y ON y.school_id=ctx.school_id AND y.academic_year_id=t.academic_year_id AND y.grade=(c->>'grade')::integer AND y.class_no=(c->>'number')::integer AND y.removed_at IS NULL WHERE c->'officialId'='null') THEN
 f:=f||jsonb_build_array(jsonb_build_object('code','CLASS_EXISTS','message','같은 학년·반이 이미 있습니다. 초안에서 기존 학급을 선택하세요.','ids','[]'::jsonb));END IF;
 RETURN jsonb_build_object('findings',f,'summary',jsonb_build_object('teachers',jsonb_array_length(p->'teachers'),'lessons',jsonb_array_length(p->'lessons'),'courses',jsonb_array_length(p->'courses'),'homerooms',jsonb_array_length(p->'homerooms')));
END $$;
-- 기존 담당은 수정하지 않고 새 계획의 담당만 유효한 계정 연결에서 추가한다.
CREATE FUNCTION teacher_roster.bridge(ctx workhub_private.actor_context,p_teacher text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r record;h record;a date;b date; BEGIN
 FOR r IN SELECT cm.*,c.academic_year_id,c.subject_id,c.valid_from,c.valid_to,l.member_id,l.from_date,l.until_date,m.account_id
 FROM teacher_roster.course_maps cm JOIN workhub.courses c ON c.school_id=cm.school_id AND c.id=cm.course_id
 JOIN teacher_roster.links l ON l.school_id=cm.school_id AND l.teacher_id=cm.teacher_id
 JOIN workhub.memberships m ON m.school_id=l.school_id AND m.id=l.member_id
 WHERE cm.school_id=ctx.school_id AND(p_teacher IS NULL OR cm.teacher_id=p_teacher) LOOP
 a:=greatest(r.valid_from,r.from_date);b:=least(r.valid_to,r.until_date);
 IF a>=b OR b<=ctx.school_today THEN CONTINUE;END IF;
 IF NOT EXISTS(SELECT 1 FROM workhub.course_assignments x WHERE x.school_id=ctx.school_id AND x.course_id=r.course_id AND x.membership_id=r.member_id AND x.valid_from=a AND x.valid_to=b) THEN
 IF NOT workhub_private.p9_teacher_assignable(ctx.school_id,r.member_id) OR NOT EXISTS(SELECT 1 FROM workhub.memberships m WHERE m.school_id=ctx.school_id AND m.id=r.member_id AND m.valid_from<=a AND(m.valid_to IS NULL OR m.valid_to>=b)) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 INSERT INTO workhub.course_assignments(school_id,course_id,membership_id,account_id,valid_from,valid_to,created_by_membership_id) VALUES(ctx.school_id,r.course_id,r.member_id,r.account_id,a,b,ctx.membership_id);END IF;
 IF NOT EXISTS(SELECT 1 FROM workhub.staff_assignments x WHERE x.school_id=ctx.school_id AND x.academic_year_id=r.academic_year_id AND x.membership_id=r.member_id AND x.kind='subject' AND x.subject_id=r.subject_id AND x.status='active' AND x.valid_from<=a AND x.valid_to>=b) THEN
 INSERT INTO workhub.staff_assignments(school_id,academic_year_id,membership_id,kind,subject_id,label,valid_from,valid_to,assigned_by_membership_id)
 VALUES(ctx.school_id,r.academic_year_id,r.member_id,'subject',r.subject_id,'교과 담당',a,b,ctx.membership_id);END IF;
 END LOOP;
 FOR h IN SELECT p.body,p.term_id,hr.value hr,cm.official_id,l.member_id,l.from_date,l.until_date,t.academic_year_id
 FROM teacher_roster.plans p CROSS JOIN LATERAL jsonb_array_elements(p.body->'homerooms') hr
 JOIN teacher_roster.class_maps cm ON cm.school_id=p.school_id AND cm.plan_id=p.id AND cm.local_id=hr.value->>'classId'
 JOIN teacher_roster.links l ON l.school_id=p.school_id AND l.teacher_id=hr.value->>'teacherId'
 JOIN workhub.terms t ON t.school_id=p.school_id AND t.id=p.term_id
 WHERE p.school_id=ctx.school_id AND p.state='published' AND(p_teacher IS NULL OR l.teacher_id=p_teacher) LOOP
 a:=greatest((h.body->>'from')::date,h.from_date);b:=least((h.body->>'until')::date,h.until_date);IF a>=b OR b<=ctx.school_today THEN CONTINUE;END IF;
 IF NOT EXISTS(SELECT 1 FROM workhub.staff_assignments x WHERE x.school_id=ctx.school_id AND x.membership_id=h.member_id AND x.kind='homeroom' AND x.class_id=h.official_id AND x.status='active' AND x.valid_from<=a AND x.valid_to>=b) THEN
 IF NOT workhub_private.p9_teacher_assignable(ctx.school_id,h.member_id) OR NOT EXISTS(SELECT 1 FROM workhub.memberships m WHERE m.school_id=ctx.school_id AND m.id=h.member_id AND m.valid_from<=a AND(m.valid_to IS NULL OR m.valid_to>=b)) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 INSERT INTO workhub.staff_assignments(school_id,academic_year_id,membership_id,kind,class_id,label,valid_from,valid_to,assigned_by_membership_id)
 VALUES(ctx.school_id,h.academic_year_id,h.member_id,'homeroom',h.official_id,'담임',a,b,ctx.membership_id);END IF;
 END LOOP;
END $$;
CREATE FUNCTION teacher_roster.apply(ctx workhub_private.actor_context,i jsonb) RETURNS text LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p jsonb;r jsonb;t workhub.terms;official text;subject_id text;target text; BEGIN
 IF i->>'kind'='save' THEN
 p:=i->'plan';target:=p->>'id';
 FOR r IN SELECT value FROM jsonb_array_elements(p->'teachers') LOOP
 INSERT INTO teacher_roster.teachers(school_id,id,name,kind) VALUES(ctx.school_id,r->>'id',r->>'name',r->>'kind') ON CONFLICT(school_id,id) DO NOTHING;END LOOP;
 INSERT INTO teacher_roster.plans(school_id,id,term_id,version,body,created_by) VALUES(ctx.school_id,target,p->>'termId',1,p,ctx.membership_id)
 ON CONFLICT(school_id,id) DO UPDATE SET body=EXCLUDED.body,version=teacher_roster.plans.version+1,updated_at=clock_timestamp();
 ELSIF i->>'kind'='publish' THEN
 target:=i->>'planId';SELECT body INTO p FROM teacher_roster.plans WHERE school_id=ctx.school_id AND id=target;
 SELECT * INTO t FROM workhub.terms WHERE school_id=ctx.school_id AND id=p->>'termId';
 FOR r IN SELECT value FROM jsonb_array_elements(p->'classes') LOOP
 official:=r->>'officialId';IF official IS NULL THEN
 official:=r->>'id';INSERT INTO workhub.year_classes(id,school_id,academic_year_id,grade,class_no,name,kind,sort_order)
 VALUES(official,ctx.school_id,t.academic_year_id,(r->>'grade')::integer,(r->>'number')::integer,r->>'name','regular',(r->>'grade')::integer*100+(r->>'number')::integer);END IF;
 INSERT INTO teacher_roster.class_maps VALUES(ctx.school_id,target,r->>'id',official);END LOOP;
 FOR r IN SELECT value FROM jsonb_array_elements(p->'courses') LOOP
 SELECT id INTO subject_id FROM workhub.year_subjects WHERE school_id=ctx.school_id AND academic_year_id=t.academic_year_id AND name=r->>'subject' AND removed_at IS NULL;
 IF subject_id IS NULL THEN INSERT INTO workhub.year_subjects(school_id,academic_year_id,name,sort_order) VALUES(ctx.school_id,t.academic_year_id,r->>'subject',0) RETURNING id INTO subject_id;END IF;
 INSERT INTO workhub.courses(id,school_id,academic_year_id,term_id,subject_id,label,valid_from,valid_to,created_by_membership_id)
 VALUES(r->>'id',ctx.school_id,t.academic_year_id,t.id,subject_id,r->>'name',(p->>'from')::date,(p->>'until')::date,ctx.membership_id);
 SELECT official_id INTO official FROM teacher_roster.class_maps WHERE school_id=ctx.school_id AND plan_id=target AND local_id=r->>'classId';
 INSERT INTO teacher_roster.course_maps VALUES(ctx.school_id,target,r->>'id',r->>'teacherId',official);
 INSERT INTO workhub.timetable_course_links(school_id,course_id,academic_year_id,student_group,updated_by_membership_id) VALUES(ctx.school_id,r->>'id',t.academic_year_id,false,ctx.membership_id);
 INSERT INTO workhub.timetable_course_link_classes(school_id,course_id,academic_year_id,class_id) VALUES(ctx.school_id,r->>'id',t.academic_year_id,official);
 END LOOP;
 UPDATE teacher_roster.plans SET state='published',version=version+1,updated_at=clock_timestamp() WHERE school_id=ctx.school_id AND id=target;
 PERFORM teacher_roster.bridge(ctx);
 UPDATE workhub.school_admin_activations SET revision=revision+1,updated_at=clock_timestamp() WHERE school_id=ctx.school_id;
 ELSE
 target:=i->>'teacherId';INSERT INTO teacher_roster.links(school_id,teacher_id,member_id,from_date,until_date,linked_by) VALUES(ctx.school_id,target,i->>'memberId',(i->>'from')::date,(i->>'until')::date,ctx.membership_id);
 PERFORM teacher_roster.bridge(ctx,target);
 END IF;RETURN target;
END $$;
CREATE FUNCTION public.workhub_teacher_roster_get(p_member_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;BEGIN ctx:=teacher_roster.actor(p_member_id,false);RETURN teacher_roster.envelope(ctx,teacher_roster.snapshot(ctx));END $$;
CREATE FUNCTION public.workhub_teacher_roster_preview(p_member_id text,p_intent jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;x jsonb;p teacher_roster.previews;BEGIN
 ctx:=teacher_roster.actor(p_member_id,false);x:=teacher_roster.evaluate(ctx,p_intent);
 INSERT INTO teacher_roster.previews(school_id,member_id,intent,fingerprint,findings,expires_at)
 VALUES(ctx.school_id,ctx.membership_id,p_intent,workhub_private.request_sha256(jsonb_build_object('intent',p_intent,'source',teacher_roster.snapshot(ctx))),x->'findings',clock_timestamp()+interval '10 minutes') RETURNING * INTO p;
 RETURN teacher_roster.envelope(ctx,jsonb_build_object('id',p.id,'hash',p.fingerprint,'expiresAt',p.expires_at,'intent',p.intent,'findings',p.findings,'summary',x->'summary'));
 EXCEPTION WHEN raise_exception THEN
 IF SQLERRM IN('FORBIDDEN','NOT_READY','INVALID_INPUT','CONFLICT','NOT_FOUND') AND ctx.school_id IS NOT NULL THEN RETURN jsonb_build_object('contract','teacher-roster.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id,'error',jsonb_build_object('code',SQLERRM));END IF;RAISE;
 WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN RETURN jsonb_build_object('contract','teacher-roster.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id,'error',jsonb_build_object('code','INVALID_INPUT'));
END $$;
CREATE FUNCTION teacher_roster.execute(mid text,c jsonb,k text,closing boolean) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;p teacher_roster.previews;r teacher_roster.requests;h text;x jsonb;v integer;target text;before_value jsonb;BEGIN
 ctx:=teacher_roster.actor(mid,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('workhub.school_admin:'||ctx.school_id,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('teacher_roster:'||ctx.school_id,0));
 IF NOT workhub_private.p1_exact(c,ARRAY['previewId','hash','intent']) OR NOT teacher_roster.id(c->'previewId') OR jsonb_typeof(c->'hash') IS DISTINCT FROM 'string' OR c->>'hash'!~'^[0-9a-f]{64}$' OR k IS NULL OR k!~'^[A-Za-z0-9_-]{8,80}$' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 h:=workhub_private.request_sha256(c);
 SELECT * INTO r FROM teacher_roster.requests WHERE school_id=ctx.school_id AND member_id=ctx.membership_id AND request_key=k;
 IF FOUND THEN
 IF r.command_hash<>h THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
 IF closing THEN RETURN jsonb_build_object('outcome',r.outcome,'receipt',r.result);END IF;
 IF r.outcome='closed' THEN RAISE EXCEPTION 'CONFLICT';END IF;RETURN r.result;END IF;
 SELECT * INTO p FROM teacher_roster.previews WHERE id=c->>'previewId' AND school_id=ctx.school_id AND member_id=ctx.membership_id FOR SHARE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF p.fingerprint<>c->>'hash' OR p.intent<>c->'intent' OR EXISTS(SELECT 1 FROM teacher_roster.requests WHERE preview_id=p.id) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF closing THEN
 INSERT INTO teacher_roster.requests VALUES(ctx.school_id,ctx.membership_id,k,h,p.id,'closed',NULL,clock_timestamp());RETURN jsonb_build_object('outcome','closed','receipt',NULL);END IF;
 IF p.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'CONFLICT';END IF;
 x:=teacher_roster.evaluate(ctx,p.intent);before_value:=teacher_roster.snapshot(ctx);
 IF jsonb_array_length(x->'findings')>0 OR p.fingerprint<>workhub_private.request_sha256(jsonb_build_object('intent',p.intent,'source',before_value)) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 target:=teacher_roster.apply(ctx,p.intent);
 INSERT INTO teacher_roster.schools(school_id,revision) VALUES(ctx.school_id,1) ON CONFLICT(school_id) DO UPDATE SET revision=teacher_roster.schools.revision+1 RETURNING revision INTO v;
 x:=jsonb_build_object('requestKey',k,'revision',v,'kind',p.intent->>'kind','targetId',target);
 INSERT INTO teacher_roster.requests VALUES(ctx.school_id,ctx.membership_id,k,h,p.id,'applied',x,clock_timestamp());
 INSERT INTO teacher_roster.history(school_id,member_id,request_key,intent,before_value,after_value) VALUES(ctx.school_id,ctx.membership_id,k,p.intent,before_value,teacher_roster.snapshot(ctx));
 RETURN x;
END $$;
CREATE FUNCTION public.workhub_teacher_roster_commit(p_member_id text,p_command jsonb,p_request_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;x jsonb;BEGIN ctx:=teacher_roster.actor(p_member_id,true);x:=teacher_roster.execute(p_member_id,p_command,p_request_key,false);RETURN teacher_roster.envelope(ctx,x);
 EXCEPTION WHEN raise_exception THEN
 IF SQLERRM IN('FORBIDDEN','NOT_READY','INVALID_INPUT','CONFLICT','NOT_FOUND','IDEMPOTENCY_CONFLICT') AND ctx.school_id IS NOT NULL THEN RETURN jsonb_build_object('contract','teacher-roster.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id,'error',jsonb_build_object('code',SQLERRM));END IF;RAISE;
 WHEN unique_violation OR exclusion_violation OR foreign_key_violation THEN RETURN jsonb_build_object('contract','teacher-roster.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id,'error',jsonb_build_object('code','CONFLICT'));
END $$;
CREATE FUNCTION public.workhub_teacher_roster_close(p_member_id text,p_command jsonb,p_request_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;BEGIN ctx:=teacher_roster.actor(p_member_id,true);RETURN teacher_roster.envelope(ctx,teacher_roster.execute(p_member_id,p_command,p_request_key,true));
 EXCEPTION WHEN raise_exception THEN
 IF SQLERRM IN('FORBIDDEN','NOT_READY','INVALID_INPUT','CONFLICT','NOT_FOUND','IDEMPOTENCY_CONFLICT') AND ctx.school_id IS NOT NULL THEN RETURN jsonb_build_object('contract','teacher-roster.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id,'error',jsonb_build_object('code',SQLERRM));END IF;RAISE;END $$;
-- 기존 시간표 접근 게이트를 그대로 사용한다. 명부 연결은 업무 참여 허용이나 관리자 권한이 아니다.
CREATE FUNCTION public.workhub_teacher_roster_published(p_member_id text,p_date text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;d date;ready boolean;plans jsonb;mine jsonb;BEGIN
 IF to_regprocedure('workhub_private.op1_actor_timetable(text,boolean)') IS NOT NULL THEN
 EXECUTE 'SELECT (workhub_private.op1_actor_timetable($1,false)).*' INTO ctx USING p_member_id;
 ELSE ctx:=workhub_private.member_actor(p_member_id,false);END IF;
 d:=teacher_roster.day(to_jsonb(p_date));ready:=false;
 IF to_regprocedure('workhub_private.t2_ready(text)') IS NOT NULL THEN EXECUTE 'SELECT workhub_private.t2_ready($1)' INTO ready USING ctx.school_id;END IF;
 ready:=ready AND NOT EXISTS(SELECT 1 FROM teacher_roster.schools WHERE school_id=ctx.school_id AND NOT enabled);
 SELECT COALESCE(jsonb_agg(body ORDER BY id),'[]') INTO plans FROM teacher_roster.plans WHERE ready AND school_id=ctx.school_id AND state='published' AND (body->>'from')::date<=d AND (body->>'until')::date>d;
 IF jsonb_array_length(plans)>100 THEN RAISE EXCEPTION 'CONFLICT';END IF;
 SELECT COALESCE(jsonb_agg(teacher_id ORDER BY teacher_id),'[]') INTO mine FROM teacher_roster.links l WHERE l.school_id=ctx.school_id AND l.member_id=ctx.membership_id AND l.from_date<=d AND l.until_date>d AND EXISTS(SELECT 1 FROM jsonb_array_elements(plans) p CROSS JOIN LATERAL jsonb_array_elements(p->'teachers') t WHERE t->>'id'=l.teacher_id);
 RETURN teacher_roster.envelope(ctx,jsonb_build_object('date',p_date,'timeZone',ctx.school_timezone,'available',ready,'plans',plans,'myTeacherIds',mine));
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA teacher_roster FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.workhub_teacher_roster_get(text),public.workhub_teacher_roster_preview(text,jsonb),public.workhub_teacher_roster_commit(text,jsonb,text),public.workhub_teacher_roster_close(text,jsonb,text),public.workhub_teacher_roster_published(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.workhub_teacher_roster_get(text),public.workhub_teacher_roster_preview(text,jsonb),public.workhub_teacher_roster_commit(text,jsonb,text),public.workhub_teacher_roster_close(text,jsonb,text),public.workhub_teacher_roster_published(text,text) TO authenticated;
INSERT INTO teacher_roster.installs VALUES('TR1-02',clock_timestamp());
COMMIT;
SELECT 'TR1-02' AS no,'ok' AS status;

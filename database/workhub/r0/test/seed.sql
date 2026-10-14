-- 시험 자료: 정상 회원 3, 프로필 없는 auth 1, auth 없는 프로필 1, 제출 4(파일 상태 다양)
insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000001','a@x.kr','{"full_name":"관리자"}'),
 ('00000000-0000-0000-0000-000000000002','b@x.kr','{"full_name":"교사1"}'),
 ('00000000-0000-0000-0000-000000000003','c@x.kr','{"full_name":"대기"}');
update public.users set role='superadmin' where id='00000000-0000-0000-0000-000000000001';
update public.users set is_active=false where id='00000000-0000-0000-0000-000000000003';
alter table auth.users disable trigger on_auth_user_created;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-000000000004','d@x.kr');
alter table auth.users enable trigger on_auth_user_created;
insert into public.users(id,email,name) values ('99999999-0000-0000-0000-000000000009','z@x.kr','고아프로필');
insert into public.doc_submissions(user_id,subject,grade,file_name,file_path,status) values
 ('00000000-0000-0000-0000-000000000002','국어',1,'a.hwpx','00000000-0000-0000-0000-000000000002/1_a.hwpx','submitted'),
 ('00000000-0000-0000-0000-000000000002','국어',1,'b.hwpx','00000000-0000-0000-0000-000000000002/2_b.hwpx','replaced'),
 ('00000000-0000-0000-0000-000000000002','수학',2,'c.hwpx','00000000-0000-0000-0000-000000000002/3_c.hwpx','submitted'),
 ('00000000-0000-0000-0000-000000000002','과학',3,'d.hwpx','00000000-0000-0000-0000-000000000002/4_d.hwpx','deleted');
insert into storage.objects(bucket_id,name,metadata) values
 ('submissions','00000000-0000-0000-0000-000000000002/1_a.hwpx','{"size":100}'),
 ('submissions','00000000-0000-0000-0000-000000000002/2_b.hwpx','{"size":100}'),
 ('submissions','00000000-0000-0000-0000-000000000002/4_d.hwpx','{"size":100}'),
 ('submissions','00000000-0000-0000-0000-000000000002/9_orphan.hwpx','{"size":5}');
-- R0 시험용 추가: 두 번째 superadmin(대기 상태), 일반 교사 1
insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000005','e@x.kr','{"full_name":"부관리자"}'),
 ('00000000-0000-0000-0000-000000000006','f@x.kr','{"full_name":"교사2"}');
update public.users set role='superadmin', is_active=false where id='00000000-0000-0000-0000-000000000005';
update public.users set is_active=true where id in ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000006');

-- Bucket privado para fotos/PDFs de receitas anteriores enviadas pelo paciente (Typebot/n8n)
insert into storage.buckets (id, name, public)
values ('receitas-anteriores', 'receitas-anteriores', false)
on conflict (id) do update set public = false;

-- Apenas service_role (backend/n8n via backend) gerencia objetos neste bucket
drop policy if exists "service role receitas anteriores select" on storage.objects;
create policy "service role receitas anteriores select"
  on storage.objects for select
  to service_role
  using (bucket_id = 'receitas-anteriores');

drop policy if exists "service role receitas anteriores insert" on storage.objects;
create policy "service role receitas anteriores insert"
  on storage.objects for insert
  to service_role
  with check (bucket_id = 'receitas-anteriores');

drop policy if exists "service role receitas anteriores update" on storage.objects;
create policy "service role receitas anteriores update"
  on storage.objects for update
  to service_role
  using (bucket_id = 'receitas-anteriores')
  with check (bucket_id = 'receitas-anteriores');

drop policy if exists "service role receitas anteriores delete" on storage.objects;
create policy "service role receitas anteriores delete"
  on storage.objects for delete
  to service_role
  using (bucket_id = 'receitas-anteriores');

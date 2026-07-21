-- Fase 3 pedido 3 — alinha os nomes de coluna às variáveis oficiais do
-- documento de fluxo (seção 24, "Variável oficial"). Rename preserva dados
-- existentes; nenhuma linha é recriada.
alter table public.patient_outcomes
  rename column q1_access_alternative to final_question_access_alternative;
alter table public.patient_outcomes
  rename column q2_avoided_interruption to final_question_avoided_interruption;
alter table public.patient_outcomes
  rename column q3_would_use_again to final_question_use_again;

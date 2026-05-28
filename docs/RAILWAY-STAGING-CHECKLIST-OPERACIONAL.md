# Railway Staging - Checklist Operacional

Use este checklist durante a criacao manual dos servicos staging no Railway.

- [ ] backend criado
- [ ] backend conectado ao repositorio correto
- [ ] backend usando branch `codex/legacy-compat-infra`
- [ ] backend root directory configurado como `mdoctor-backend`
- [ ] backend env configurado
- [ ] `/health` OK
- [ ] `/readyz` OK
- [ ] login JWT OK no backend staging
- [ ] painel criado
- [ ] painel conectado ao repositorio correto
- [ ] painel usando branch `codex/legacy-compat-infra`
- [ ] painel root directory configurado como `mdoctor-panel`
- [ ] `NEXT_PUBLIC_API_URL` configurado
- [ ] `/login` OK
- [ ] `/dashboard` OK
- [ ] fluxo mock OK
- [ ] logs sem erro critico
- [ ] Supabase service role apenas no backend
- [ ] Memed real nao ativada
- [ ] WhatsApp real nao ativado
- [ ] pagamento/Stripe nao ativado
- [ ] producao nao alterada

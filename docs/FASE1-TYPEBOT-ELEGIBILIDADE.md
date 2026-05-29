# Fase 1 — Typebot e critérios de elegibilidade

## Objetivo

Ajustar o bot oficial (`doctor-prescreve-8rmljgu`) para triagem clínica conservadora, bloqueio antes do pagamento e payload estruturado para n8n/backend — **sem recriar o Typebot**.

## Arquivos

| Arquivo | Função |
|---------|--------|
| `docs/typebot/typebot-doctor-prescreve-staging-safe.json` | Export principal (patcheado) |
| `docs/typebot/typebot-export-doctor-prescreve-8rmljgu (5).json` | Espelho do export oficial |
| `mdoctor-backend/scripts/patch-typebot-reorganize.js` | Reorganização completa do fluxo |
| `mdoctor-backend/scripts/patch-typebot-eligibility.js` | Alias do script acima |
| `docs/TYPEBOT-FLUXO-REORGANIZADO.md` | Documentação do fluxo reorganizado |
| `mdoctor-backend/scripts/embed-n8n-typebot-payload.js` | Atualiza n8n com normalizador |
| `docs/n8n-workflows/lib/typebot-webhook-payload.code.js` | Normaliza data + variáveis no n8n |
| `mdoctor-backend/src/services/typebot-payload.mapper.js` | Mapeamento Typebot → elegibilidade |
| `mdoctor-backend/scripts/test-typebot-eligibility.js` | Testes locais de elegibilidade |

## Fluxo (resumo)

Ver detalhes em `docs/TYPEBOT-FLUXO-REORGANIZADO.md`.

1. LGPD → doença crônica → tempo de uso → sinais de alerta → declaração de elegibilidade  
2. **Dados pessoais** (nome, nascimento, CPF, WhatsApp, e-mail, endereço, CEP)  
3. **Receita anterior + foto disponível** (confirmação, sem upload) → se não: bloqueio  
4. Gate elegível → **pagamento**  
5. Quantidade de medicamentos (1–3) + coleta estruturada (`med1_*` … `med3_*`)  
6. **Upload da foto da receita** (obrigatório, `previous_prescription_file`)  
7. Confirmação → webhook n8n staging  
8. Backend aplica motor de elegibilidade; inelegível **não** entra na fila médica  

Mensagem padrão para inelegível:

> Pelas informações fornecidas, não será possível seguir com a renovação por teleconsulta neste momento. Recomendamos atendimento médico presencial para melhor avaliação.

## Variáveis enviadas ao n8n

`patient_name`, `birth_date`, `cpf`, `whatsapp`, `email`, `address`, `cep`, `chronic_condition`, `medication_count`, `medications[]`, `medication_name`, `medication_dose`, `medication_frequency`, `medication_route`, `continuous_use_days`, `has_previous_prescription`, `previous_prescription_file`, `has_warning_signs`, `eligibility_status`, `ineligibility_reason`.

Data de nascimento: aceita `dd/mm/aaaa`, `ddmmaaaa`, `dd-mm-aaaa` — normalizada para `yyyy-mm-dd` no n8n.

## Critérios no backend (reforço)

- Doença crônica no protocolo (HAS, DM2, DLP, hipotireoidismo)  
- Uso contínuo ≥ 30 dias  
- Receita anterior + foto obrigatória  
- Sem sinais de alerta  
- Sem medicamento controlado  
- `eligibility_status=ineligible` bloqueia fila  

## Comandos

```bash
# Reaplicar reorganização no JSON do Typebot
node mdoctor-backend/scripts/patch-typebot-reorganize.js

# Validar export
node mdoctor-backend/scripts/validate-typebot-staging-safe.js

# Testes de elegibilidade
node mdoctor-backend/scripts/test-typebot-eligibility.js

# Embutir normalizador no workflow n8n
node mdoctor-backend/scripts/embed-n8n-typebot-payload.js
```

## Deploy

1. Importar/publicar JSON no Typebot (`higij2z0xihxxkr378rmljgu`).  
2. Republicar workflow `typebot-webhook-staging` no n8n staging.  
3. Redeploy backend staging (mapper + engine).  

## Testes manuais sugeridos

- [ ] Elegível completo (HAS, >6 meses, receita+foto, sem alertas) → pagamento → painel  
- [ ] Sem receita anterior → bloqueio antes do pagamento  
- [ ] Sinal de alerta → bloqueio  
- [ ] Medicamento controlado (ex.: clonazepam) → bloqueio no backend  
- [ ] Foto ausente → bloqueio  

---
name: gerador-flyer
description: Cria flyers, banners publicitários e imagens promocionais de nível profissional de agência usando IA pura (Gemini Image / DALL-E). Proíbe terminantemente desenhos toscos de Canvas com coordenadas manuais.
---

# Skill de Criação de Flyers e Artes com IA

Quando o usuário pedir para criar um **flyer**, **banner**, **anúncio**, **arte para Instagram/Facebook** ou **imagem promocional**:

## ⛔ REGRA DE OURO E PROIBIÇÃO ABSOLUTA:
**NUNCA crie scripts de Canvas (Node-Canvas / Canvas 2D) desenhando caixas, círculos ou coordenadas manuais no Paint!** 
Isso gera imagens toscas, textos sobrepostos e não atende o padrão profissional.

---

## ✅ COMO GERAR A IMAGEM PROFISSIONAL POR IA:

Execute o gerador oficial de IA via terminal:
```bash
node scripts/generate_ai_image.mjs "<prompt rico e descritivo em inglês com estilo fotográfico 8k, iluminação e textos entre aspas>" "flyers/<nome-do-arquivo>.png"
```

### Exemplo de execução:
```bash
node scripts/generate_ai_image.mjs "A professional marketing advertising flyer poster in vertical 3:4 portrait format for Instagram feed. Modern dark aesthetic with warm orange neon lighting. High-end gaming PC with tempered glass case and glowing orange RGB fans, modern laptop, mechanical keyboard, gaming headset. Bold modern typography: 'PC+ INFORMÁTICA' and 'Seu próximo upgrade começa aqui!'. 8k resolution, cinematic lighting, sharp crisp detail." "flyers/pc-plus-informatica.png"
```

---

## 💾 Onde salvar:
Sempre salve a imagem final dentro da pasta:
👉 `flyers/<nome-do-arquivo>.png`

O sistema do Agent Office detecta automaticamente os arquivos na pasta `flyers/` e exibe o botão **⬇ Baixar** direto na tela do usuário!

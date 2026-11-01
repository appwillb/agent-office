import fs from 'node:fs';
import path from 'node:path';

const apiKey = process.env.GEMINI_API_KEY;

async function main() {
  const [,, prompt, outputFile = 'flyers/ai_flyer.png'] = process.argv;
  if (!prompt) {
    console.error('Uso: node scripts/generate_ai_image.mjs <prompt> [saida.png]');
    process.exit(1);
  }

  if (!apiKey) {
    console.error('[Gemini Image AI] GEMINI_API_KEY não configurada nas variáveis de ambiente.');
    process.exit(1);
  }

  const outDir = path.dirname(outputFile);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log(`[Gemini Image AI] Gerando imagem com a chave Gemini para: "${prompt.slice(0, 50)}..."`);
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Gemini Image AI] Erro HTTP ${response.status}:`, errorText);
    process.exit(1);
  }

  const json = await response.json();
  const parts = json?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData && part.inlineData.data) {
      const buffer = Buffer.from(part.inlineData.data, 'base64');
      fs.writeFileSync(outputFile, buffer);
      console.log(`[Gemini Image AI] Flyer de IA salvo com sucesso: ${outputFile}`);
      return;
    }
  }

  console.error('[Gemini Image AI] Nenhuma imagem inline retornada.');
  process.exit(1);
}

main().catch(err => {
  console.error('[Gemini Image AI] Falha na execução:', err);
  process.exit(1);
});

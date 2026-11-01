import fs from 'node:fs';
import path from 'node:path';

let apiKey = process.env.GEMINI_API_KEY;

// Fallback: tenta ler de .env caso não esteja no process.env
if (!apiKey && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  const match = envContent.match(/GEMINI_API_KEY\s*=\s*(.+)/);
  if (match) {
    apiKey = match[1].trim().replace(/^['"]|['"]$/g, '');
  }
}

async function main() {
  const args = process.argv.slice(2);
  let prompt = args[0];
  let outputFile = args[1] || 'flyers/novo_flyer.png';

  if (!prompt || prompt.startsWith('-')) {
    prompt = "Flyer profissional publicitário para PC+ Informática, tema setup gamer com iluminação neon laranja e preta, texto nítido em português 'PC+ Informática - Especialistas em Manutenção e PC Gamer', alta resolução 1080x1350";
  }

  if (!apiKey) {
    console.error('[IA Image Generator] ERRO: GEMINI_API_KEY não configurada nas variáveis de ambiente.');
    process.exit(1);
  }

  const outDir = path.dirname(outputFile);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log(`[IA Image Generator] Chamando Gemini 2.5 Flash Image para: "${prompt.slice(0, 70)}..."`);
  
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
    console.error(`[IA Image Generator] Erro na API do Gemini (${response.status}):`, errorText);
    process.exit(1);
  }

  const json = await response.json();
  const parts = json?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData && part.inlineData.data) {
      const buffer = Buffer.from(part.inlineData.data, 'base64');
      fs.writeFileSync(outputFile, buffer);
      console.log(`[IA Image Generator] Flyer de IA gerado com sucesso em: ${outputFile}`);
      return;
    }
  }

  console.error('[IA Image Generator] Nenhuma imagem foi retornada pelo modelo Gemini.');
  process.exit(1);
}

main().catch(err => {
  console.error('[IA Image Generator] Falha:', err);
  process.exit(1);
});

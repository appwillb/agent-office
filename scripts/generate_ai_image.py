#!/usr/bin/env python3
"""
Script de geração de imagem por IA para os agentes do Agent Office.
Usa a API do Google Gemini (gemini-2.5-flash-image) com suporte a DALL-E 3 como alternativa.
"""

import os
import sys
import json
import base64
import urllib.request
from pathlib import Path

def generate_with_gemini_image(prompt, output_file):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("[Gemini Image AI] GEMINI_API_KEY não encontrada nas variáveis de ambiente.", file=sys.stderr)
        return False
    
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key={api_key}"
        headers = {"Content-Type": "application/json"}
        payload = {
            "contents": [{
                "parts": [{
                    "text": prompt
                }]
            }]
        }
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers)
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode())
            parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
            for p in parts:
                inline = p.get("inlineData")
                if inline and inline.get("data"):
                    img_bytes = base64.b64decode(inline["data"])
                    Path(output_file).write_bytes(img_bytes)
                    print(f"[Gemini Image AI] Flyer gerado e salvo em: {output_file}")
                    return True
        print("[Gemini Image AI] Nenhuma imagem inline retornada.", file=sys.stderr)
        return False
    except Exception as e:
        print(f"[Gemini Image AI] Erro: {e}", file=sys.stderr)
        return False

def generate_with_dalle(prompt, output_file):
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key or api_key.startswith("nvapi"):
        return False
    try:
        url = "https://api.openai.com/v1/images/generations"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        data = {
            "model": "dall-e-3",
            "prompt": prompt,
            "n": 1,
            "size": "1024x1792",
            "quality": "standard"
        }
        req = urllib.request.Request(url, data=json.dumps(data).encode(), headers=headers)
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode())
            image_url = result["data"][0]["url"]
            urllib.request.urlretrieve(image_url, output_file)
            print(f"[DALL-E 3] Imagem salva em: {output_file}")
            return True
    except Exception as e:
        print(f"[DALL-E 3] Falha: {e}", file=sys.stderr)
        return False

def main():
    if len(sys.argv) < 2:
        print("Uso: python3 scripts/generate_ai_image.py <prompt> [saida.png]")
        sys.exit(1)
    
    prompt = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else "flyers/ai_flyer.png"
    
    Path(output_file).parent.mkdir(parents=True, exist_ok=True)
    
    # 1. Tenta Gemini 2.5 Flash Image
    if generate_with_gemini_image(prompt, output_file):
        sys.exit(0)
        
    # 2. Tenta DALL-E 3 se OPENAI_API_KEY estiver presente
    if generate_with_dalle(prompt, output_file):
        sys.exit(0)
        
    sys.exit(1)

if __name__ == "__main__":
    main()

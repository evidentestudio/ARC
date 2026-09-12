// API da ARC — Agenda Rock Cristão
// Extrai agendas (banda, cidade, local, data, horário) de uma imagem de post
// (flyer/story) usando a Claude API (visão + saída estruturada).
// Variável de ambiente necessária no Vercel:
//   ANTHROPIC_API_KEY

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN_PASSCODE = process.env.ARC_ADMIN_PASSCODE;

const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
// ~4MB de base64 (imagem original de até ~3MB) — folga sob o limite de
// payload das funções serverless da Vercel (4.5MB).
const MAX_BASE64_LENGTH = 4 * 1024 * 1024;

const EventoSchema = z.object({
  banda: z.string(),
  estado: z.string().nullable(),
  cidade: z.string(),
  local: z.string(),
  data: z.string(),
  horario: z.string(),
});

const ExtracaoSchema = z.object({
  eventos: z.array(EventoSchema),
  avisos: z.array(z.string()),
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não suportado.' });
  }

  // Protegido pela mesma senha do painel "Gerar slides" — só o admin pode
  // acionar chamadas à IA (evita custo/abuso vindo do formulário público).
  const key = req.headers['x-admin-key'];
  if (!ADMIN_PASSCODE || key !== ADMIN_PASSCODE) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Servidor não configurado (ANTHROPIC_API_KEY ausente).' });
  }

  const body = req.body || {};
  const { imageBase64, mediaType } = body;

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ error: 'Imagem ausente.' });
  }
  if (!MEDIA_TYPES.has(mediaType)) {
    return res.status(400).json({ error: 'Formato de imagem não suportado (use PNG, JPEG, WEBP ou GIF).' });
  }
  if (imageBase64.length > MAX_BASE64_LENGTH) {
    return res.status(400).json({ error: 'Imagem muito grande — tente uma versão menor (até ~3MB) ou comprimida.' });
  }

  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const anoAtual = new Date().getUTCFullYear();

    const response = await client.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 8192,
      system:
        'Você extrai dados de agenda de shows/eventos de bandas de rock cristão a partir ' +
        'de imagens de posts de redes sociais (flyers, stories, cards de divulgação). ' +
        'A imagem pode conter um ou vários eventos — extraia todos. Para cada evento, leia: ' +
        'nome da banda/atração, cidade, estado (sigla de 2 letras maiúsculas, ex: SC — use null ' +
        'se não for possível identificar com confiança), nome do local/casa de shows/igreja, ' +
        'data (formato DD/MM, sem ano) e horário (formato HH:mm, 24h — converta formatos como ' +
        '"20h" ou "20h30" para "20:00"/"20:30"). Nunca invente informação que não esteja visível ' +
        'na imagem: se um campo não estiver legível, deixe-o como string vazia "" e explique o ' +
        'motivo em "avisos" (uma frase curta em português por problema encontrado).',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            {
              type: 'text',
              text:
                'Extraia os eventos de agenda desta imagem. O ano atual é ' + anoAtual +
                ', mas não inclua o ano no campo "data" (use apenas DD/MM).',
            },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(ExtracaoSchema) },
    });

    if (!response.parsed_output) {
      return res.status(502).json({ error: 'A IA não conseguiu interpretar a imagem. Tente uma imagem mais nítida.' });
    }

    return res.status(200).json(response.parsed_output);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Falha ao extrair dados da imagem.' });
  }
}

// API da ARC — Agenda Rock Cristão
// Usa Upstash Redis (mesmo padrão do Mappa) via REST API.
// Variáveis de ambiente necessárias no Vercel:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
//   ARC_ADMIN_PASSCODE   (senha do painel "Gerar slides")

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_PASSCODE = process.env.ARC_ADMIN_PASSCODE;

async function redis(command) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    throw new Error(`Redis error: ${res.status}`);
  }
  const data = await res.json();
  return data.result;
}

// Estrutura no Redis: uma lista (LPUSH/LRANGE) chamada "arc:agendas"
// contendo os registros em JSON, mais simples que manter chaves separadas.

const LIMITE_MENSAL = 200;

function chaveContadorMes() {
  const agora = new Date();
  const mes = String(agora.getUTCMonth() + 1).padStart(2, '0');
  return `arc:agendas:count:${agora.getUTCFullYear()}-${mes}`;
}

function validarEntrada(body) {
  const obrigatorios = ['tipo', 'banda', 'estado', 'cidade', 'local', 'data', 'horario', 'segueArc'];
  for (const campo of obrigatorios) {
    if (!body[campo] || typeof body[campo] !== 'string' || !body[campo].trim()) {
      return `Campo obrigatório ausente: ${campo}`;
    }
  }
  if (!/^\d{2}\/\d{2}$/.test(body.data)) {
    return 'Data em formato inválido (esperado DD/MM).';
  }
  if (body.tipo !== 'own' && body.tipo !== 'other') {
    return 'Tipo de agenda inválido.';
  }
  if (body.local.trim().length > 40) {
    return 'Nome do local muito longo (máximo de 40 caracteres) — tente abreviar.';
  }
  return null;
}

function sanitizar(str, max = 200) {
  return String(str).trim().slice(0, max);
}

export default async function handler(req, res) {
  // CORS básico — ajuste o domínio conforme necessário
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ error: 'Servidor não configurado (variáveis do Redis ausentes).' });
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const erro = validarEntrada(body);
      if (erro) {
        return res.status(400).json({ error: erro });
      }

      const chaveMes = chaveContadorMes();
      const totalMes = await redis(['INCR', chaveMes]);
      if (totalMes === 1) {
        // primeira inscrição do mês: define expiração de limpeza (40 dias, com folga)
        await redis(['EXPIRE', chaveMes, 60 * 60 * 24 * 40]);
      }
      if (totalMes > LIMITE_MENSAL) {
        return res.status(429).json({ error: 'Desculpe, atingimos o limite de inscrições para este mês.' });
      }

      const entry = {
        tipo: body.tipo === 'other' ? 'other' : 'own',
        banda: sanitizar(body.banda, 100),
        estado: sanitizar(body.estado, 2).toUpperCase(),
        cidade: sanitizar(body.cidade, 100),
        local: sanitizar(body.local, 150),
        data: sanitizar(body.data, 5),
        horario: sanitizar(body.horario, 5),
        linkPrint: body.linkPrint ? sanitizar(body.linkPrint, 100) : null,
        reportadoPor: body.reportadoPor ? sanitizar(body.reportadoPor, 100) : null,
        segueArc: body.segueArc === 'sim' ? 'sim' : 'nao',
        criadoEm: new Date().toISOString(),
      };

      await redis(['LPUSH', 'arc:agendas', JSON.stringify(entry)]);

      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Falha ao salvar a agenda.' });
    }
  }

  if (req.method === 'GET') {
    // Leitura das agendas exige senha de admin (header x-admin-key)
    const key = req.headers['x-admin-key'];
    if (!ADMIN_PASSCODE || key !== ADMIN_PASSCODE) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }

    try {
      const raw = await redis(['LRANGE', 'arc:agendas', '0', '-1']);
      const entries = (raw || [])
        .map((item, i) => {
          try {
            return { ...JSON.parse(item), _i: i };
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      return res.status(200).json({ entries });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Falha ao carregar as agendas.' });
    }
  }

  if (req.method === 'DELETE') {
    // Exclusão exige senha de admin (header x-admin-key)
    const key = req.headers['x-admin-key'];
    if (!ADMIN_PASSCODE || key !== ADMIN_PASSCODE) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }

    const body = req.body || {};
    const indice = Number(body.index);
    if (!Number.isInteger(indice) || indice < 0) {
      return res.status(400).json({ error: 'Índice da agenda inválido.' });
    }

    try {
      const raw = await redis(['LRANGE', 'arc:agendas', '0', '-1']);
      if (!raw || indice >= raw.length) {
        return res.status(404).json({ error: 'Agenda não encontrada.' });
      }
      const restante = raw.filter((_, i) => i !== indice);
      await redis(['DEL', 'arc:agendas']);
      if (restante.length > 0) {
        await redis(['RPUSH', 'arc:agendas', ...restante]);
      }
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Falha ao excluir a agenda.' });
    }
  }

  return res.status(405).json({ error: 'Método não suportado.' });
}

import type { VercelRequest, VercelResponse } from '@vercel/node'

const GEMINI_KEY = process.env.GEMINI_API_KEY || ''
const DEMO_EXPIRES = new Date('2026-03-12T00:00:00Z').getTime()

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (Date.now() >= DEMO_EXPIRES) return res.status(403).json({ error: 'Demo expired' })
  if (!GEMINI_KEY) return res.status(500).json({ error: 'Server key not configured' })

  const { model, body } = req.body as { model: string; body: unknown }
  if (!model) return res.status(400).json({ error: 'Missing model parameter' })

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )

    const data = await upstream.json()
    return res.status(upstream.status).json(data)
  } catch (err) {
    return res.status(502).json({ error: 'Upstream request failed' })
  }
}

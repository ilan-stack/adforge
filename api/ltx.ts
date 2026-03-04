import type { VercelRequest, VercelResponse } from '@vercel/node'

const LTX_KEY = process.env.LTX_API_KEY || ''
const DEMO_EXPIRES = new Date('2026-03-12T00:00:00Z').getTime()

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (Date.now() >= DEMO_EXPIRES) return res.status(403).json({ error: 'Demo expired' })
  if (!LTX_KEY) return res.status(500).json({ error: 'Server key not configured' })

  try {
    const upstream = await fetch('https://api.ltx.video/v1/image-to-video', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LTX_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    })

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}))
      return res.status(upstream.status).json(err)
    }

    // LTX returns binary MP4 — stream it through
    const buffer = Buffer.from(await upstream.arrayBuffer())
    res.setHeader('Content-Type', 'video/mp4')
    res.setHeader('Content-Length', buffer.length)
    return res.status(200).send(buffer)
  } catch (err) {
    return res.status(502).json({ error: 'Upstream request failed' })
  }
}

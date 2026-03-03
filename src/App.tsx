import { useState, useRef, useEffect, useCallback } from 'react'
import './index.css'

const LTX_API_BASE = '/api'

type Tone = 'fun' | 'premium' | 'urgent'
type Status = 'idle' | 'uploading' | 'generating' | 'polling' | 'done' | 'error'

interface ProductAnalysis {
  product: string
  colors: string
  material: string
  shape: string
  background: string
  scene: string
  camera: string
  alternate_angle: string
}

const TONE_CONFIG: Record<Tone, { label: string; emoji: string; description: string; style: string }> = {
  fun: {
    label: 'Fun & Energetic',
    emoji: '🎉',
    description: 'Playful, colorful, high energy',
    style: 'border-yellow-500 bg-yellow-500/10 text-yellow-400',
  },
  premium: {
    label: 'Premium & Elegant',
    emoji: '✨',
    description: 'Sophisticated, clean, luxurious',
    style: 'border-blue-500 bg-blue-500/10 text-blue-400',
  },
  urgent: {
    label: 'Urgent & Bold',
    emoji: '🔥',
    description: 'Direct, high-contrast, action-driven',
    style: 'border-red-500 bg-red-500/10 text-red-400',
  },
}

const CAMERA_MOTIONS = ['dolly_in', 'dolly_out', 'dolly_left', 'dolly_right', 'jib_up', 'jib_down', 'static', 'focus_shift'] as const
type CameraMotion = typeof CAMERA_MOTIONS[number]


async function analyzeWithGemini(base64Data: string, mimeType: string, geminiKey: string): Promise<ProductAnalysis> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Data,
              },
            },
            {
              text: `You are a creative director analyzing a product photo for a video advertisement.

Respond with ONLY valid JSON, no markdown, no backticks:
{
  "product": "<what the product is, e.g. 'matte black wireless headphones'>",
  "colors": "<dominant colors, e.g. 'black, silver accents, subtle blue LED'>",
  "material": "<surface material, e.g. 'soft-touch matte plastic, brushed aluminum'>",
  "shape": "<shape description for camera movement, e.g. 'compact rounded form, ear cups create depth'>",
  "background": "<describe what's behind/around the product in the photo, e.g. 'plain white backdrop' or 'wooden table with blurred kitchen'. Then suggest a creative cinematic background that would look amazing as the camera moves — e.g. 'gradient from deep navy to warm amber with floating light particles' or 'dark studio with neon streaks that shift color'. Keep it complementary to the product colors.>",
  "scene": "<a vivid 2-sentence scene description for a product video ad. Describe the studio setup, lighting, surface, and atmosphere. Describe CAMERA movement (orbiting, gliding, pushing in) — NOT product movement. The product stays on its surface, the camera moves around it to reveal different angles. Be cinematic and specific.>",
  "camera": "<best camera motion from this list: dolly_in, dolly_out, dolly_left, dolly_right, jib_up, jib_down, static, focus_shift — pick the one that best showcases this specific product's shape>",
  "alternate_angle": "<imagine what this SAME product looks like from a different angle (side, back, three-quarter, or top-down). Describe ONLY what is physically visible from that angle — specific features, textures, labels, ports, buttons, seams, curves. Be concrete and realistic. Example: 'From the side, the headphones show the slim metal headband, padded ear cushions with stitched leather edges, and a small USB-C charging port on the left cup.'>"
}`
            },
          ],
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 500,
        },
      }),
    }
  )

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status}`)
  }

  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  return JSON.parse(cleaned)
}

async function geminiGenerateImage(base64Data: string, mimeType: string, prompt: string, geminiKey: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType, data: base64Data } },
              { text: prompt },
            ],
          }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
          },
        }),
      }
    )

    if (!res.ok) {
      console.warn('Gemini image gen failed:', res.status, await res.text().catch(() => ''))
      return null
    }

    const data = await res.json()
    const parts = data.candidates?.[0]?.content?.parts || []
    for (const part of parts) {
      const inlined = part.inlineData || part.inline_data
      if (inlined) {
        const mime = inlined.mimeType || inlined.mime_type
        if (mime?.startsWith('image/')) {
          return `data:${mime};base64,${inlined.data}`
        }
      }
    }
    console.warn('Gemini image gen: no image in response', JSON.stringify(parts).slice(0, 500))
    return null
  } catch (err) {
    console.warn('Gemini image gen error:', err)
    return null
  }
}

function buildEnhancePrompt(analysis: ProductAnalysis, tone: Tone, audience: string): string {
  const toneDirection: Record<Tone, string> = {
    fun: `Use a bright, colorful, playful setting with warm cheerful lighting — think energetic and inviting. Vibrant colors, maybe pastel or candy tones. The vibe should appeal to ${audience || 'a broad audience'}.`,
    premium: `Use a dark, elegant, luxurious setting with dramatic moody lighting — think high-end magazine ad. Rich textures, deep shadows, refined surfaces. The vibe should appeal to ${audience || 'a discerning audience'}.`,
    urgent: `Use a bold, high-contrast setting with striking directional lighting — think eye-catching and dynamic. Strong colors, sharp shadows, attention-grabbing backdrop. The vibe should appeal to ${audience || 'action-oriented buyers'}.`,
  }
  return `Edit this product photo: place this exact same ${analysis.product} in an ideal commercial setting. Keep the product IDENTICAL — same ${analysis.colors} colors, same ${analysis.material} material, same angle and shape. Only change the background and lighting. ${toneDirection[tone]} The result should look like a real professional product photo.`
}

function buildAltAnglePrompt(analysis: ProductAnalysis, enhanced: boolean, tone: Tone, audience: string): string {
  const settingNote = enhanced
    ? `Use the EXACT same background setting, colors, props, and lighting style as the input image — just show the product from a different angle within that same scene.`
    : tone === 'fun'
      ? `Place it in a bright, colorful, playful setting with warm cheerful lighting that appeals to ${audience || 'a broad audience'}. Professional product photography.`
      : tone === 'urgent'
        ? `Place it in a bold, high-contrast setting with striking directional lighting that appeals to ${audience || 'action-oriented buyers'}. Professional product photography.`
        : `Place it in a dark, elegant, luxurious setting with dramatic moody lighting that appeals to ${audience || 'a discerning audience'}. Professional product photography.`
  return `Generate a photorealistic image of this exact same ${analysis.product} but viewed from a different angle. Show: ${analysis.alternate_angle}. Keep the same product, same colors (${analysis.colors}), same material (${analysis.material}). ${settingNote} High quality.`
}

function buildPrompt(analysis: ProductAnalysis, audience: string, tone: Tone): string {
  const environment: Record<Tone, string> = {
    fun: `Bright warm studio. Soft golden light rays drift through the air. Tiny floating dust particles catch the light. Colorful bokeh lights shift gently in the blurred background.`,
    premium: `Dark moody studio. A single elegant key light slowly sweeps across the ${analysis.material}, revealing subtle texture. Thin wisps of mist drift behind the product. Shallow depth of field with creamy bokeh.`,
    urgent: `High-contrast studio. Bold directional light rakes across the ${analysis.material}. Dramatic light streaks cut through a thin atmospheric haze. Deep shadows shift subtly.`,
  }

  const reveal = analysis.alternate_angle
    ? ` The camera slowly moves to reveal a new angle of the same product: ${analysis.alternate_angle}`
    : ''

  return `A ${analysis.product} centered on a surface, perfectly still and unchanged. ${analysis.colors} colors, ${analysis.shape}. ${environment[tone]}${reveal} The product never morphs or deforms — it is a real physical object filmed by a moving camera. Photorealistic product commercial for ${audience}.`
}

function buildFallbackPrompt(audience: string, tone: Tone): string {
  const fallback: Record<Tone, string> = {
    fun: 'A product centered on a surface. Bright warm studio with golden light rays and floating dust particles. Colorful bokeh in the background.',
    premium: 'A product centered on a dark polished surface. An elegant key light sweeps across it. Thin mist drifts behind. Creamy bokeh.',
    urgent: 'A product centered on a dark surface. Bold directional light with dramatic streaks through atmospheric haze.',
  }
  return `${fallback[tone]} The product stays perfectly still — all motion comes from the lighting and atmosphere around it. Photorealistic product commercial for ${audience}.`
}

export default function App() {
  const [ltxKey, setLtxKey] = useState(() => localStorage.getItem('adforge_ltx_key') || '')
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem('adforge_gemini_key') || '')
  const [showSettings, setShowSettings] = useState(false)
  const [image, setImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [audience, setAudience] = useState('')
  const [tone, setTone] = useState<Tone>('premium')
  const [status, setStatus] = useState<Status>('idle')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [analysis, setAnalysis] = useState<ProductAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [editablePrompt, setEditablePrompt] = useState('')
  const [showPrompt, setShowPrompt] = useState(false)
  const [duration, setDuration] = useState(6)
  const [generateAudio, setGenerateAudio] = useState(true)
  const [cameraMotion, setCameraMotion] = useState<CameraMotion>('dolly_in')
  const [altAngleImage, setAltAngleImage] = useState<string | null>(null)
  const [generatingAltImage, setGeneratingAltImage] = useState(false)
  const [enhancedImage, setEnhancedImage] = useState<string | null>(null)
  const [generatingEnhanced, setGeneratingEnhanced] = useState(false)
  const [useEnhanced, setUseEnhanced] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Auto-rebuild prompt when analysis, audience, or tone change
  const rebuildPrompt = useCallback(() => {
    if (analysis && audience.trim()) {
      setEditablePrompt(buildPrompt(analysis, audience, tone))
      const cam = CAMERA_MOTIONS.includes(analysis.camera as CameraMotion)
        ? analysis.camera as CameraMotion
        : 'dolly_in'
      setCameraMotion(cam)
    } else if (audience.trim()) {
      setEditablePrompt(buildFallbackPrompt(audience, tone))
      setCameraMotion(tone === 'fun' ? 'dolly_right' : 'dolly_in')
    }
  }, [analysis, audience, tone])

  useEffect(() => {
    rebuildPrompt()
  }, [rebuildPrompt])

  // Smooth progress animation during generation
  const startProgressAnimation = () => {
    setProgress(30)
    const start = Date.now()
    const duration = 70000 // ~70s expected generation time
    progressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - start
      // Ease out: fast at start, slows toward 85%
      const t = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setProgress(30 + eased * 55) // 30% to 85%
    }, 500)
  }

  const stopProgressAnimation = () => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current)
      progressTimerRef.current = null
    }
  }

  const regenerateAnalysis = async () => {
    if (!image || analyzing) return
    setAnalyzing(true)
    setAltAngleImage(null)
    setEnhancedImage(null)
    setUseEnhanced(false)
    try {
      const base64 = await fileToBase64(image)
      const result = await analyzeWithGemini(base64, image.type, geminiKey)
      setAnalysis(result)

      // Generate enhanced first frame, then alt angle using the enhanced image
      setGeneratingEnhanced(true)
      if (result.alternate_angle) setGeneratingAltImage(true)
      geminiGenerateImage(base64, image.type, buildEnhancePrompt(result, tone, audience), geminiKey)
        .then((enhImg) => {
          if (enhImg) { setEnhancedImage(enhImg); setUseEnhanced(true) }
          setGeneratingEnhanced(false)
          if (result.alternate_angle) {
            const altMime = enhImg ? 'image/png' : image.type
            const altBase64 = enhImg ? enhImg.split(',')[1] : base64
            geminiGenerateImage(altBase64, altMime, buildAltAnglePrompt(result, !!enhImg, tone, audience), geminiKey)
              .then((img) => setAltAngleImage(img))
              .finally(() => setGeneratingAltImage(false))
          }
        })
        .catch(() => { setGeneratingEnhanced(false); setGeneratingAltImage(false) })
    } catch {
      // keep existing analysis on failure
    } finally {
      setAnalyzing(false)
    }
  }

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return
    setImage(file)
    setVideoUrl(null)
    setError(null)
    setStatus('idle')
    setAnalysis(null)
    setEditablePrompt('')
    setShowPrompt(false)
    setAltAngleImage(null)

    const reader = new FileReader()
    reader.onload = (e) => setImagePreview(e.target?.result as string)
    reader.readAsDataURL(file)

    setAnalyzing(true)
    setEnhancedImage(null)
    setUseEnhanced(false)
    try {
      const base64 = await fileToBase64(file)
      const result = await analyzeWithGemini(base64, file.type, geminiKey)
      setAnalysis(result)

      // Generate enhanced first frame, then alt angle using the enhanced image
      setGeneratingEnhanced(true)
      if (result.alternate_angle) setGeneratingAltImage(true)
      geminiGenerateImage(base64, file.type, buildEnhancePrompt(result, tone, audience), geminiKey)
        .then((enhImg) => {
          if (enhImg) { setEnhancedImage(enhImg); setUseEnhanced(true) }
          setGeneratingEnhanced(false)
          if (result.alternate_angle) {
            const altMime = enhImg ? 'image/png' : file.type
            const altBase64 = enhImg ? enhImg.split(',')[1] : base64
            geminiGenerateImage(altBase64, altMime, buildAltAnglePrompt(result, !!enhImg, tone, audience), geminiKey)
              .then((img) => setAltAngleImage(img))
              .finally(() => setGeneratingAltImage(false))
          }
        })
        .catch(() => { setGeneratingEnhanced(false); setGeneratingAltImage(false) })
    } catch {
      setAnalysis(null)
    } finally {
      setAnalyzing(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        resolve(result.split(',')[1])
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const fileToDataUri = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const generate = async () => {
    if (!image || !audience.trim()) return

    setStatus('uploading')
    setError(null)
    setVideoUrl(null)
    setProgress(10)

    try {
      const imageUri = (useEnhanced && enhancedImage) ? enhancedImage : await fileToDataUri(image)
      setProgress(25)

      const prompt = editablePrompt || buildFallbackPrompt(audience, tone)

      setStatus('generating')
      startProgressAnimation()

      const res = await fetch(`${LTX_API_BASE}/image-to-video`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ltxKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_uri: imageUri,
          prompt,
          model: duration > 10 ? 'ltx-2-fast' : 'ltx-2-pro',
          duration,
          resolution: '1920x1080',
          camera_motion: cameraMotion,
          generate_audio: generateAudio,
        }),
      })

      stopProgressAnimation()

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error?.message || err.message || `API error ${res.status}`)
      }

      setProgress(95)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      setVideoUrl(url)
      setProgress(100)
      setStatus('done')

    } catch (err: unknown) {
      stopProgressAnimation()
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setStatus('error')
    }
  }

  const reset = () => {
    setImage(null)
    setImagePreview(null)
    setVideoUrl(null)
    setError(null)
    setStatus('idle')
    setProgress(0)
    setAudience('')
    setDuration(6)
    setAnalysis(null)
    setEditablePrompt('')
    setShowPrompt(false)
    setAltAngleImage(null)
    setGeneratingAltImage(false)
    setEnhancedImage(null)
    setGeneratingEnhanced(false)
    setUseEnhanced(false)
    stopProgressAnimation()
  }

  const saveLtxKey = (key: string) => { setLtxKey(key); localStorage.setItem('adforge_ltx_key', key) }
  const saveGeminiKey = (key: string) => { setGeminiKey(key); localStorage.setItem('adforge_gemini_key', key) }
  const hasKeys = ltxKey.trim() && geminiKey.trim()

  const isGenerating = status === 'uploading' || status === 'generating' || status === 'polling'
  const canGenerate = image && audience.trim() && !isGenerating && hasKeys

  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center text-sm font-bold">
              A
            </div>
            <span className="text-lg font-semibold tracking-tight">AdForge</span>
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
              LTX-2 + Gemini Vision
            </span>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
              hasKeys
                ? 'border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-500'
                : 'border-amber-500 bg-amber-500/10 text-amber-400 animate-pulse'
            }`}
          >
            {hasKeys ? 'API Keys' : 'Set API Keys'}
          </button>
        </div>
        {(showSettings || !hasKeys) && (
          <div className="max-w-4xl mx-auto mt-4 bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
            {!hasKeys && (
              <p className="text-sm text-amber-400">Enter your API keys to get started.</p>
            )}
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">LTX Video API Key</label>
              <input
                type="password"
                value={ltxKey}
                onChange={(e) => saveLtxKey(e.target.value)}
                placeholder="ltxv_..."
                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Gemini API Key</label>
              <input
                type="password"
                value={geminiKey}
                onChange={(e) => saveGeminiKey(e.target.value)}
                placeholder="AIza..."
                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors font-mono"
              />
            </div>
            <p className="text-[10px] text-gray-600">Keys are saved in your browser's localStorage — never sent to our servers.</p>
          </div>
        )}
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight mb-3">
            Turn your product into a{' '}
            <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              video ad
            </span>
          </h1>
          <p className="text-gray-400 text-lg">
            Drop a product image — AI understands it, then generates a cinematic video ad.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left Column — Inputs */}
          <div className="space-y-6">
            {/* Image Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Product Image
              </label>
              <div
                ref={dropRef}
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileRef.current?.click()}
                className={`
                  relative border-2 border-dashed rounded-xl cursor-pointer transition-all
                  ${imagePreview
                    ? 'border-blue-500 bg-blue-500/5'
                    : 'border-gray-700 hover:border-gray-500 bg-gray-900'
                  }
                `}
              >
                {imagePreview ? (
                  <div className="relative">
                    <img
                      src={imagePreview}
                      alt="Product"
                      className="w-full h-48 object-contain rounded-xl p-2"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center">
                      <span className="text-sm text-white">Click to change</span>
                    </div>
                  </div>
                ) : (
                  <div className="h-48 flex flex-col items-center justify-center gap-3">
                    <div className="text-4xl">📦</div>
                    <div className="text-center">
                      <p className="text-gray-300 text-sm font-medium">Drop your product image</p>
                      <p className="text-gray-600 text-xs mt-1">or click to browse</p>
                    </div>
                  </div>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
              </div>
            </div>

            {/* AI Analysis Card */}
            {(analyzing || analysis) && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-5 h-5 bg-gradient-to-br from-blue-500 to-cyan-400 rounded flex items-center justify-center">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                  </div>
                  <span className="text-xs font-semibold text-gray-300">AI Vision Analysis</span>
                  {analyzing && <span className="text-xs text-blue-400 animate-pulse ml-auto">Analyzing...</span>}
                  {analysis && !analyzing && (
                    <button
                      onClick={regenerateAnalysis}
                      className="text-[10px] text-gray-500 hover:text-blue-400 ml-auto transition-colors"
                      title="Re-analyze with Gemini for a fresh creative direction"
                    >
                      🔄 Regenerate
                    </button>
                  )}
                </div>
                {analyzing && !analysis && (
                  <div className="space-y-2">
                    <div className="h-3 bg-gray-800 rounded animate-pulse w-3/4" />
                    <div className="h-3 bg-gray-800 rounded animate-pulse w-1/2" />
                    <div className="h-3 bg-gray-800 rounded animate-pulse w-2/3" />
                  </div>
                )}
                {analysis && (
                  <div className="space-y-2 text-xs">
                    <div className="flex gap-2">
                      <span className="text-gray-500 shrink-0 w-16">Product</span>
                      <span className="text-gray-200">{analysis.product}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-gray-500 shrink-0 w-16">Colors</span>
                      <span className="text-gray-200">{analysis.colors}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-gray-500 shrink-0 w-16">Material</span>
                      <span className="text-gray-200">{analysis.material}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-gray-500 shrink-0 w-16">Camera</span>
                      <span className="text-blue-400">{analysis.camera?.replace(/_/g, ' ')}</span>
                    </div>
                    {analysis.background && (
                      <div className="mt-2 pt-2 border-t border-gray-800">
                        <span className="text-gray-500 text-[10px] uppercase tracking-wider">Background Evolution</span>
                        <p className="text-gray-300 mt-1 leading-relaxed">{analysis.background}</p>
                      </div>
                    )}
                    {analysis.alternate_angle && (
                      <div className="mt-2 pt-2 border-t border-gray-800">
                        <span className="text-gray-500 text-[10px] uppercase tracking-wider">Camera Reveals</span>
                        <p className="text-gray-300 mt-1 leading-relaxed">{analysis.alternate_angle}</p>
                      </div>
                    )}
                    <div className="mt-2 pt-2 border-t border-gray-800">
                      <span className="text-gray-500 text-[10px] uppercase tracking-wider">AI Scene Direction</span>
                      <p className="text-gray-300 mt-1 leading-relaxed">{analysis.scene}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Target Audience */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Target Audience
              </label>
              <input
                type="text"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="e.g. fitness enthusiasts aged 25-35"
                className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            {/* Tone Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Ad Tone
              </label>
              <div className="space-y-2">
                {(Object.keys(TONE_CONFIG) as Tone[]).map((t) => {
                  const cfg = TONE_CONFIG[t]
                  return (
                    <button
                      key={t}
                      onClick={() => setTone(t)}
                      className={`
                        w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left
                        ${tone === t ? cfg.style : 'border-gray-800 bg-gray-900 hover:border-gray-600 text-gray-400'}
                      `}
                    >
                      <span className="text-xl">{cfg.emoji}</span>
                      <div>
                        <p className="text-sm font-medium">{cfg.label}</p>
                        <p className="text-xs opacity-70">{cfg.description}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Duration */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Duration — {duration}s
              </label>
              <div className="flex gap-2">
                {[6, 8, 10, 15, 20].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDuration(d)}
                    className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                      duration === d
                        ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                        : 'border-gray-800 bg-gray-900 text-gray-500 hover:border-gray-600'
                    }`}
                  >
                    {d}s
                  </button>
                ))}
              </div>
              {duration > 10 && (
                <p className="text-[10px] text-amber-500 mt-1">Uses LTX-2 Fast model (Pro supports up to 10s)</p>
              )}
            </div>

            {/* Options row: Audio + Camera */}
            <div className="flex gap-3">
              <button
                onClick={() => setGenerateAudio(!generateAudio)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                  generateAudio
                    ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                    : 'border-gray-800 bg-gray-900 text-gray-500'
                }`}
              >
                {generateAudio ? '🔊' : '🔇'}
                <span>Audio {generateAudio ? 'On' : 'Off'}</span>
              </button>
              <select
                value={cameraMotion}
                onChange={(e) => setCameraMotion(e.target.value as CameraMotion)}
                className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-3 py-3 text-sm text-gray-300 focus:outline-none focus:border-blue-500 transition-colors cursor-pointer"
              >
                {CAMERA_MOTIONS.map((m) => (
                  <option key={m} value={m}>
                    🎥 {m.replace(/_/g, ' ')}
                    {analysis?.camera === m ? ' (AI pick)' : ''}
                  </option>
                ))}
              </select>
            </div>



            {/* Editable Prompt */}
            {editablePrompt && (
              <div>
                <button
                  onClick={() => setShowPrompt(!showPrompt)}
                  className="flex items-center gap-2 text-xs font-medium text-gray-500 hover:text-gray-300 transition-colors mb-2"
                >
                  <svg
                    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                    className={`transition-transform ${showPrompt ? 'rotate-90' : ''}`}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  {showPrompt ? 'Hide' : 'View & Edit'} LTX-2 Prompt
                </button>
                {showPrompt && (
                  <div className="space-y-2">
                    <textarea
                      value={editablePrompt}
                      onChange={(e) => setEditablePrompt(e.target.value)}
                      rows={5}
                      className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-xs text-gray-300 leading-relaxed focus:outline-none focus:border-blue-500 transition-colors resize-none font-mono"
                    />
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-gray-600">{editablePrompt.length} chars — edit freely, this is what LTX-2 receives</span>
                      <button
                        onClick={rebuildPrompt}
                        className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        Reset to AI-generated
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Video Journey — First Frame → End Frame */}
            {imagePreview && (generatingEnhanced || enhancedImage || generatingAltImage || altAngleImage) && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-300">Video Journey</span>
                    <span className="text-[10px] text-gray-600">Gemini Imagen</span>
                  </div>
                  {enhancedImage && (
                    <button
                      onClick={() => setUseEnhanced(!useEnhanced)}
                      className={`text-[10px] px-2.5 py-1 rounded-full border transition-all ${
                        useEnhanced
                          ? 'border-blue-500 bg-blue-500/20 text-blue-400'
                          : 'border-gray-700 bg-gray-800 text-gray-500'
                      }`}
                    >
                      {useEnhanced ? '✨ Enhanced first frame' : 'Original first frame'}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* First Frame */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">First Frame</p>
                    {generatingEnhanced && !enhancedImage ? (
                      <div className="w-full h-28 rounded-lg bg-gray-800 flex items-center justify-center">
                        <span className="text-xs text-blue-400 animate-pulse">Enhancing...</span>
                      </div>
                    ) : useEnhanced && enhancedImage ? (
                      <img src={enhancedImage} alt="Enhanced first frame" className="w-full h-28 object-contain rounded-lg bg-gray-800" />
                    ) : (
                      <img src={imagePreview} alt="Original first frame" className="w-full h-28 object-contain rounded-lg bg-gray-800" />
                    )}
                  </div>
                  {/* Arrow */}
                  <div className="text-gray-600 text-lg shrink-0">→</div>
                  {/* End Frame */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">End Frame</p>
                    {generatingAltImage && !altAngleImage ? (
                      <div className="w-full h-28 rounded-lg bg-gray-800 flex items-center justify-center">
                        <span className="text-xs text-blue-400 animate-pulse">Generating...</span>
                      </div>
                    ) : altAngleImage ? (
                      <img src={altAngleImage} alt="Predicted end frame" className="w-full h-28 object-contain rounded-lg bg-gray-800" />
                    ) : (
                      <div className="w-full h-28 rounded-lg bg-gray-800 flex items-center justify-center">
                        <span className="text-[10px] text-gray-600">Camera reveals new angle</span>
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-gray-600 mt-2">
                  AI-generated preview of how LTX-2 will animate your product — from first frame to camera reveal
                </p>
              </div>
            )}

            {/* Generate Button */}
            <button
              onClick={generate}
              disabled={!canGenerate}
              className={`
                w-full py-4 rounded-xl font-semibold text-sm transition-all
                ${canGenerate
                  ? 'bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white cursor-pointer shadow-lg shadow-blue-500/20'
                  : 'bg-gray-800 text-gray-600 cursor-not-allowed'
                }
              `}
            >
              {isGenerating ? '⚡ Generating your ad...' : '🎬 Generate Video Ad'}
            </button>
          </div>

          {/* Right Column — Output */}
          <div className="flex flex-col">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Your Video Ad
            </label>

            <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden min-h-64">
              {status === 'idle' && (
                <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
                  <div className="text-5xl">🎬</div>
                  <div>
                    <p className="text-gray-400 text-sm font-medium">Your video ad will appear here</p>
                    <p className="text-gray-600 text-xs mt-1">
                      Upload a product image and configure your ad to get started
                    </p>
                  </div>
                </div>
              )}

              {isGenerating && (
                <div className="h-full flex flex-col items-center justify-center gap-6 p-8">
                  <div className="relative w-16 h-16">
                    <div className="absolute inset-0 rounded-full border-4 border-gray-800" />
                    <div className="absolute inset-0 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
                  </div>
                  <div className="text-center">
                    <p className="text-gray-300 text-sm font-medium">
                      {status === 'uploading' ? 'Preparing image...' : 'Generating with LTX-2 Pro...'}
                    </p>
                    <p className="text-gray-600 text-xs mt-1">
                      {status === 'generating' && `${Math.round(progress)}% — typically 60-90 seconds`}
                    </p>
                  </div>
                  {progress > 0 && (
                    <div className="w-full bg-gray-800 rounded-full h-1.5">
                      <div
                        className="bg-gradient-to-r from-blue-500 to-cyan-500 h-1.5 rounded-full transition-all duration-1000 ease-out"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                  {status === 'generating' && (
                    <div className="w-full bg-gray-800/50 border border-gray-800 rounded-lg p-3">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Prompt sent to LTX-2</p>
                      <p className="text-[11px] text-gray-400 leading-relaxed line-clamp-3">{editablePrompt}</p>
                    </div>
                  )}
                </div>
              )}

              {status === 'done' && videoUrl && (
                <div className="h-full flex flex-col">
                  <video
                    src={videoUrl}
                    controls
                    autoPlay
                    loop
                    className="w-full flex-1 object-contain"
                  />
                  <div className="p-4 border-t border-gray-800 flex gap-3">
                    <a
                      href={videoUrl}
                      download="adforge-video-ad.mp4"
                      className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium py-2.5 px-4 rounded-lg text-center transition-colors"
                    >
                      ⬇️ Download
                    </a>
                    <button
                      onClick={reset}
                      className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium py-2.5 px-4 rounded-lg transition-colors"
                    >
                      🔄 New Ad
                    </button>
                  </div>
                </div>
              )}

              {status === 'error' && (
                <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
                  <div className="text-4xl">⚠️</div>
                  <div>
                    <p className="text-red-400 text-sm font-medium">Generation failed</p>
                    <p className="text-gray-600 text-xs mt-1">{error}</p>
                  </div>
                  <button
                    onClick={reset}
                    className="text-xs text-gray-500 hover:text-gray-300 underline transition-colors"
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>

            {/* Format hints */}
            {status === 'idle' && (
              <div className="mt-4 flex gap-2">
                {['TikTok', 'Instagram', 'YouTube'].map((platform) => (
                  <span
                    key={platform}
                    className="text-xs text-gray-600 bg-gray-900 border border-gray-800 px-2 py-1 rounded-full"
                  >
                    {platform}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-16 py-6 px-6">
        <div className="max-w-4xl mx-auto flex items-center justify-between text-xs text-gray-700">
          <span>AdForge — Built with LTX-2 by Lightricks</span>
          <span>Made with ❤️ as a creative AI prototype</span>
        </div>
      </footer>
    </div>
  )
}

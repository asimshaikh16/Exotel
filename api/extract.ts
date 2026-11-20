// Vercel serverless function: keeps GEMINI_API_KEY on the server.
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Server configuration error: GEMINI_API_KEY is missing. Add it to the Exotel project Environment Variables in Vercel, then redeploy.'
    });
  }

  const { imageBase64, mimeType } = req.body || {};
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!imageBase64 || typeof imageBase64 !== 'string' || !allowedTypes.includes(mimeType)) {
    return res.status(400).json({ error: 'Invalid image. Please upload a JPG, PNG, or WEBP screenshot.' });
  }
  if (imageBase64.length > 6_000_000) {
    return res.status(413).json({ error: 'Image is too large. Please upload a screenshot smaller than 4 MB.' });
  }

  try {
    const prompt = [
      'Read this call-center dashboard screenshot carefully.',
      'Extract exactly these two values:',
      '1. Total Login Duration (the value beside the label "Total Login Duration").',
      '2. Total Break Duration (the value beside the label "Total Break Duration").',
      'Convert both to HH:MM:SS. Examples: "7h 3m 57s" => "07:03:57"; "1h 18m 1s" => "01:18:01"; "31m 48s" => "00:31:48".',
      'Do not confuse Total Offered Calls, Average Talk Time, Average Handling Time, or other metrics with these durations.',
      'Return only a JSON object with string fields loginDuration and breakDuration. Do not guess. If either duration is not readable, return an empty string for that field.'
    ].join(' ');

    const geminiResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: imageBase64 } }
            ]
          }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      }
    );

    const geminiData = await geminiResponse.json().catch(() => ({}));
    if (!geminiResponse.ok) {
      const detail = geminiData?.error?.message || 'Gemini API request failed.';
      const status = geminiResponse.status;
      return res.status(status >= 400 && status < 500 ? 502 : 502).json({
        error: `Gemini API error (${status}): ${detail}`
      });
    }

    const text = geminiData?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part.text || '')
      .join('')
      .trim();

    if (!text) {
      return res.status(502).json({ error: 'Gemini returned no readable text. Please try the screenshot again.' });
    }

    let extracted;
    try {
      extracted = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: 'Gemini returned an unreadable result. Please try again.' });
    }

    const isDuration = (value: unknown) =>
      typeof value === 'string' && /^\d{2,}:\d{2}:\d{2}$/.test(value);

    if (!isDuration(extracted.loginDuration) || !isDuration(extracted.breakDuration)) {
      return res.status(422).json({
        error: 'Could not clearly read both Total Login Duration and Total Break Duration. Please upload a clearer dashboard screenshot.'
      });
    }

    return res.status(200).json({
      loginDuration: extracted.loginDuration,
      breakDuration: extracted.breakDuration
    });
  } catch (error) {
    console.error('Gemini OCR server error:', error);
    return res.status(500).json({ error: 'Server error while processing the screenshot. Please try again.' });
  }
}

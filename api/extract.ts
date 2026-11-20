export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: 'Server configuration error: GEMINI_API_KEY is missing.'
    });
  }

  const { imageBase64, mimeType } = req.body || {};
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

  if (
    !imageBase64 ||
    typeof imageBase64 !== 'string' ||
    !allowedTypes.includes(mimeType)
  ) {
    return res.status(400).json({
      error: 'Invalid image. Please upload a JPG, PNG, or WEBP screenshot.'
    });
  }

  if (imageBase64.length > 6_000_000) {
    return res.status(413).json({
      error: 'Image is too large. Please upload a screenshot smaller than 4 MB.'
    });
  }

  const prompt = [
    'Read this call-center dashboard screenshot carefully.',
    'Extract exactly these two values:',
    '1. Total Login Duration (the value beside the label "Total Login Duration").',
    '2. Total Break Duration (the value beside the label "Total Break Duration").',
    'Convert both to HH:MM:SS.',
    'Examples: "7h 3m 57s" => "07:03:57";',
    '"1h 18m 1s" => "01:18:01"; "31m 48s" => "00:31:48".',
    'Do not confuse Total Offered Calls, Average Talk Time,',
    'Average Handling Time, or other metrics with these durations.',
    'Return only a JSON object with string fields loginDuration and breakDuration.',
    'Do not guess. If either duration is not readable, return an empty string.'
  ].join(' ');

  const models = [
    'gemini-3.8-flash',
    'gemini-3.5-flash-lite'
  ];

  async function callGemini(model: string) {
    return fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
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
              {
                inlineData: {
                  mimeType,
                  data: imageBase64
                }
              }
            ]
          }],
          generationConfig: {
            responseMimeType: 'application/json'
          }
        })
      }
    );
  }

  try {
    let geminiResponse: Response | null = null;
    let geminiData: any = null;
    let lastError = '';

    for (const model of models) {
      // Try each model up to twice for temporary errors
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          geminiResponse = await callGemini(model);
          geminiData = await geminiResponse.json().catch(() => ({}));

          if (geminiResponse.ok) {
            break;
          }

          const status = geminiResponse.status;
          lastError = geminiData?.error?.message || 'Gemini request failed.';

          // Retry/fallback for temporary errors
          if (status === 429 || status === 503 || status >= 500) {
            if (attempt < 2) {
              await new Promise(resolve => setTimeout(resolve, 1500));
              continue;
            }
            break;
          }

          // Do not retry permanent errors
          return res.status(502).json({
            error: `Gemini API error (${status}): ${lastError}`
          });
        } catch (error) {
          lastError = 'Network error while contacting Gemini.';
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 1500));
            continue;
          }
        }
      }

      if (geminiResponse?.ok) {
        break;
      }

      // Move to the backup model
      console.warn(`Model ${model} failed. Trying next model.`);
    }

    if (!geminiResponse?.ok) {
      return res.status(503).json({
        error: `Gemini is temporarily unavailable. Please try again later. ${lastError}`
      });
    }

    const text = geminiData?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part.text || '')
      .join('')
      .trim();

    if (!text) {
      return res.status(502).json({
        error: 'Gemini returned no readable text. Please try again.'
      });
    }

    let extracted;

    try {
      extracted = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: 'Gemini returned an unreadable result. Please try again.'
      });
    }

    const isDuration = (value: unknown) =>
      typeof value === 'string' &&
      /^\d{2,}:\d{2}:\d{2}$/.test(value);

    if (
      !isDuration(extracted.loginDuration) ||
      !isDuration(extracted.breakDuration)
    ) {
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

    return res.status(500).json({
      error: 'Server error while processing the screenshot. Please try again.'
    });
  }
}

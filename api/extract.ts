export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY is missing.'
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
      error: 'Please upload a JPG, PNG, or WEBP screenshot.'
    });
  }

  if (imageBase64.length > 6_000_000) {
    return res.status(413).json({
      error: 'Image too large. Upload a screenshot smaller than 4 MB.'
    });
  }

  const prompt = `
Read this call-center dashboard screenshot carefully.

Extract exactly:
1. Total Login Duration
2. Total Break Duration

Convert both values to HH:MM:SS.

Examples:
7h 3m 57s = 07:03:57
1h 18m 1s = 01:18:01
31m 48s = 00:31:48

Do not confuse these values with calls, talk time,
handling time, or other metrics.

Return only JSON:
{
  "loginDuration": "HH:MM:SS",
  "breakDuration": "HH:MM:SS"
}

Do not guess. If unreadable, return empty strings.
`;

  const models = [
    'gemini-3.8-flash',
    'gemini-3.5-flash-lite'
  ];

  let lastError = '';

  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          signal: controller.signal,
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

      const data: any = await response.json().catch(() => ({}));

      if (!response.ok) {
        lastError = data?.error?.message || `HTTP ${response.status}`;

        if (
          response.status === 401 ||
          response.status === 403 ||
          response.status === 400
        ) {
          return res.status(502).json({
            error: `Gemini API error: ${lastError}`
          });
        }

        console.warn(`${model} failed. Trying backup model.`);
        continue;
      }

      const text = data?.candidates?.[0]?.content?.parts
        ?.map((part: any) => part.text || '')
        .join('')
        .trim();

      if (!text) {
        lastError = 'Gemini returned empty text.';
        continue;
      }

      let result;

      try {
        result = JSON.parse(text);
      } catch {
        lastError = 'Gemini returned invalid JSON.';
        continue;
      }

      const validDuration = (value: any) =>
        typeof value === 'string' &&
        /^\d{2,}:\d{2}:\d{2}$/.test(value);

      if (
        !validDuration(result.loginDuration) ||
        !validDuration(result.breakDuration)
      ) {
        lastError = 'Could not read both durations.';
        continue;
      }

      return res.status(200).json({
        loginDuration: result.loginDuration,
        breakDuration: result.breakDuration
      });

    } catch (error: any) {
      lastError = error?.name === 'AbortError'
        ? `${model} timed out after 20 seconds.`
        : 'Connection to Gemini failed.';

      console.warn(lastError);

    } finally {
      clearTimeout(timeout);
    }
  }

  return res.status(503).json({
    error: `OCR temporarily unavailable. Please try again. ${lastError}`
  });
}

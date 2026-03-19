import express from 'express';
import { PrismaClient } from '@prisma/client';
import Groq from 'groq-sdk';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

router.use(authMiddleware);

const BUSINESS_CONTEXTS: Record<string, string> = {
  car_dealership: 'a car dealership selling new and used vehicles in Africa',
  restaurant:     'a restaurant or food business serving local cuisine',
  real_estate:    'a real estate agency selling and renting properties',
  gym:            'a gym or fitness centre offering memberships and classes',
  salon:          'a hair and beauty salon offering grooming services',
  general:        'a small business serving local customers',
};

const PLATFORM_RULES: Record<string, string> = {
  facebook:  'Facebook ad (max 125 chars primary text, include a clear CTA, friendly tone)',
  instagram: 'Instagram caption (engaging, use line breaks, end with 3-5 relevant hashtags)',
  whatsapp:  'WhatsApp message (conversational, personal, max 160 chars, include phone CTA)',
  sms:       'SMS message (max 160 chars, include business name, clear CTA)',
  email:     'email subject line (max 60 chars, curiosity-driven, no spam words)',
};

// ── Generate ad copy ──────────────────────────────────────────────────────────
router.post('/generate-copy', async (req, res) => {
  try {
    const {
      businessType = 'general',
      goal,
      platforms,
      productOrService,
      tone = 'professional',
      extraContext,
    } = req.body;

    if (!goal) return res.status(400).json({ error: 'goal is required' });
    if (!platforms || platforms.length === 0) return res.status(400).json({ error: 'at least one platform is required' });

    const businessContext = BUSINESS_CONTEXTS[businessType] || BUSINESS_CONTEXTS.general;
    const platformInstructions = platforms
      .map((p: string) => `- ${p.toUpperCase()}: ${PLATFORM_RULES[p.toLowerCase()] || 'short marketing copy with a clear CTA'}`)
      .join('\n');

    const prompt = `You are an expert African marketing copywriter for ${businessContext}.

Business goal: ${goal}
${productOrService ? `Product/Service: ${productOrService}` : ''}
Tone: ${tone}
${extraContext ? `Extra context: ${extraContext}` : ''}

Write ad copy for each of the following platforms. Return ONLY valid JSON, no markdown, no explanation:

{
  "headline": "a punchy 8-10 word headline that works across all platforms",
  "copies": {
    ${platforms.map((p: string) => `"${p.toLowerCase()}": "copy for this platform"`).join(',\n    ')}
  },
  "callToAction": "one strong CTA phrase e.g. Book now, Call us today, Visit us",
  "tips": ["one brief tip for this campaign"]
}

Platform requirements:
${platformInstructions}

Make copy relevant to African markets. Be direct, benefit-focused, and culturally appropriate.`;

    const completion = await groq.chat.completions.create({
      model:       'llama-3.1-8b-instant',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens:  1000,
    });

    const raw = completion.choices[0]?.message?.content || '';

    let parsed;
    try {
      const clean = raw.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      return res.status(500).json({ error: 'AI returned invalid response', raw });
    }

    await prisma.analytics.upsert({
      where: {
        tenantId_date: {
          tenantId: req.user!.tenantId,
          date:     new Date(new Date().toDateString()),
        },
      },
      create: {
        tenantId:        req.user!.tenantId,
        date:            new Date(new Date().toDateString()),
        aiCopyGenerated: 1,
      },
      update: {
        aiCopyGenerated: { increment: 1 },
      },
    });

    res.json({ success: true, ...parsed, platforms, businessType, goal });
  } catch (error) {
    console.error('POST /ai/generate-copy error:', error);
    res.status(500).json({ error: String(error) });
  }
});

// ── Generate campaign steps using AI ─────────────────────────────────────────
router.post('/generate-campaign', async (req, res) => {
  try {
    const { businessType = 'general', goal, channel = 'EMAIL', steps = 3 } = req.body;
    if (!goal) return res.status(400).json({ error: 'goal is required' });

    const businessContext = BUSINESS_CONTEXTS[businessType] || BUSINESS_CONTEXTS.general;

    const prompt = `You are an expert email/SMS marketing strategist for ${businessContext}.

Create a ${steps}-step ${channel} drip campaign for this goal: ${goal}

Return ONLY valid JSON, no markdown:
{
  "campaignName": "short campaign name",
  "steps": [
    {
      "stepNumber": 1,
      "delayDays": 0,
      "subject": "email subject (for EMAIL only)",
      "body": "full message body"
    }
  ]
}

Rules:
- Step 1 delay is always 0 days
- Space steps 2-3 days apart
- Each step should have a different angle (value, urgency, social proof)
- ${channel === 'SMS' ? 'Keep each SMS under 160 characters' : 'Use simple HTML for email body'}
- Make it relevant to African small businesses`;

    const completion = await groq.chat.completions.create({
      model:       'llama-3.1-8b-instant',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens:  1500,
    });

    const raw = completion.choices[0]?.message?.content || '';
    let parsed;
    try {
      const clean = raw.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      return res.status(500).json({ error: 'AI returned invalid response', raw });
    }

    res.json({ success: true, ...parsed, channel, goal });
  } catch (error) {
    console.error('POST /ai/generate-campaign error:', error);
    res.status(500).json({ error: String(error) });
  }
});

export default router;

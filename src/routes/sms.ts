import express from 'express';
import { PrismaClient } from '@prisma/client';
import twilio from 'twilio';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

function getTwilio() {
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

router.use(authMiddleware);

// ── Send a single SMS ─────────────────────────────────────────────────────────
router.post('/send', async (req, res) => {
  try {
    const { to, message, leadId } = req.body;
    if (!to)      return res.status(400).json({ error: 'to (phone number) is required' });
    if (!message) return res.status(400).json({ error: 'message is required' });

    const client = getTwilio();
    const result = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER!,
      to,
    });

    if (leadId) {
      await prisma.message.create({
        data: {
          leadId,
          tenantId:  req.user!.tenantId,
          direction: 'OUTBOUND',
          channel:   'SMS',
          content:   message,
          isAI:      false,
        },
      });
    }

    await prisma.analytics.upsert({
      where: {
        tenantId_date: {
          tenantId: req.user!.tenantId,
          date:     new Date(new Date().toDateString()),
        },
      },
      create: { tenantId: req.user!.tenantId, date: new Date(new Date().toDateString()), smsSent: 1 },
      update: { smsSent: { increment: 1 } },
    });

    res.json({ success: true, sid: result.sid, status: result.status, to });
  } catch (error: any) {
    console.error('POST /sms/send error:', error);
    res.status(500).json({ error: error.message || String(error) });
  }
});

// ── Send bulk SMS to multiple leads ──────────────────────────────────────────
router.post('/bulk', async (req, res) => {
  try {
    const { leadIds, message } = req.body;
    if (!leadIds || leadIds.length === 0) return res.status(400).json({ error: 'leadIds array is required' });
    if (!message) return res.status(400).json({ error: 'message is required' });

    const leads = await prisma.lead.findMany({
      where: {
        id:       { in: leadIds },
        tenantId: req.user!.tenantId,
        phone:    { not: null },
      },
    });

    if (leads.length === 0) return res.status(400).json({ error: 'No leads with phone numbers found' });

    const client  = getTwilio();
    const results = [];

    for (const lead of leads) {
      try {
        const result = await client.messages.create({
          body: message.replace('[First Name]', lead.firstName),
          from: process.env.TWILIO_PHONE_NUMBER!,
          to:   lead.phone!,
        });

        await prisma.message.create({
          data: {
            leadId:    lead.id,
            tenantId:  req.user!.tenantId,
            direction: 'OUTBOUND',
            channel:   'SMS',
            content:   message,
            isAI:      false,
          },
        });

        results.push({ leadId: lead.id, phone: lead.phone, status: 'sent', sid: result.sid });
      } catch (err: any) {
        results.push({ leadId: lead.id, phone: lead.phone, status: 'failed', error: err.message });
      }
    }

    const sent   = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;

    await prisma.analytics.upsert({
      where: {
        tenantId_date: {
          tenantId: req.user!.tenantId,
          date:     new Date(new Date().toDateString()),
        },
      },
      create: { tenantId: req.user!.tenantId, date: new Date(new Date().toDateString()), smsSent: sent },
      update: { smsSent: { increment: sent } },
    });

    res.json({ success: true, sent, failed, results });
  } catch (error: any) {
    console.error('POST /sms/bulk error:', error);
    res.status(500).json({ error: error.message || String(error) });
  }
});

// ── Get SMS history for a lead ────────────────────────────────────────────────
router.get('/history/:leadId', async (req, res) => {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.leadId, tenantId: req.user!.tenantId },
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const messages = await prisma.message.findMany({
      where:   { leadId: req.params.leadId, channel: 'SMS' },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ── Twilio webhook for incoming SMS ──────────────────────────────────────────
router.post('/webhook/incoming', async (req, res) => {
  try {
    const { From, Body } = req.body;

    const lead = await prisma.lead.findFirst({
      where: { phone: From },
    });

    if (lead) {
      await prisma.message.create({
        data: {
          leadId:    lead.id,
          tenantId:  lead.tenantId,
          direction: 'INBOUND',
          channel:   'SMS',
          content:   Body,
          isAI:      false,
        },
      });
    }

    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');
  } catch (error) {
    console.error('SMS webhook error:', error);
    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');
  }
});

export default router;

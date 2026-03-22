import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

// ── Get analytics summary ─────────────────────────────────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const days     = parseInt(req.query.days as string) || 30;
    const from     = new Date();
    from.setDate(from.getDate() - days);

    const [
      totalLeads,
      newLeads,
      convertedLeads,
      analytics,
      campaigns,
      leadsByStatus,
      recentLeads,
    ] = await Promise.all([
      prisma.lead.count({ where: { tenantId } }),
      prisma.lead.count({ where: { tenantId, createdAt: { gte: from } } }),
      prisma.lead.count({ where: { tenantId, status: 'CONVERTED' } }),
      prisma.analytics.findMany({
        where:   { tenantId, date: { gte: from } },
        orderBy: { date: 'asc' },
      }),
      prisma.campaign.findMany({
        where:   { tenantId },
        include: { _count: { select: { enrollments: true } } },
      }),
      prisma.lead.groupBy({
        by:   ['status'],
        where: { tenantId },
        _count: { status: true },
      }),
      prisma.lead.findMany({
        where:   { tenantId, createdAt: { gte: from } },
        orderBy: { createdAt: 'asc' },
        select:  { createdAt: true, status: true, source: true },
      }),
    ]);

    const totalEmailsSent  = analytics.reduce((a, r) => a + r.emailsSent, 0);
    const totalEmailsOpened = analytics.reduce((a, r) => a + r.emailsOpened, 0);
    const totalSmsSent     = analytics.reduce((a, r) => a + r.smsSent, 0);
    const totalAiCopy      = analytics.reduce((a, r) => a + r.aiCopyGenerated, 0);

    const leadsByDay = recentLeads.reduce((acc: Record<string, number>, lead) => {
      const day = lead.createdAt.toISOString().split('T')[0];
      acc[day] = (acc[day] || 0) + 1;
      return acc;
    }, {});

    const leadsBySource = recentLeads.reduce((acc: Record<string, number>, lead) => {
      acc[lead.source] = (acc[lead.source] || 0) + 1;
      return acc;
    }, {});

    res.json({
      summary: {
        totalLeads,
        newLeads,
        convertedLeads,
        conversionRate: totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : '0',
        totalEmailsSent,
        totalEmailsOpened,
        emailOpenRate: totalEmailsSent > 0 ? ((totalEmailsOpened / totalEmailsSent) * 100).toFixed(1) : '0',
        totalSmsSent,
        totalAiCopy,
        activeCampaigns: campaigns.filter(c => c.status === 'ACTIVE').length,
        totalEnrollments: campaigns.reduce((a, c) => a + c._count.enrollments, 0),
      },
      leadsByStatus: leadsByStatus.map(s => ({ status: s.status, count: s._count.status })),
      leadsByDay:    Object.entries(leadsByDay).map(([date, count]) => ({ date, count })),
      leadsBySource: Object.entries(leadsBySource).map(([source, count]) => ({ source, count })),
      campaigns:     campaigns.map(c => ({
        id:          c.id,
        name:        c.name,
        channel:     c.channel,
        status:      c.status,
        enrollments: c._count.enrollments,
      })),
    });
  } catch (error) {
    console.error('GET /analytics/summary error:', error);
    res.status(500).json({ error: String(error) });
  }
});

export default router;
